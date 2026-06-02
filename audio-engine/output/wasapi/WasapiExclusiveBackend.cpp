#include "WasapiExclusiveBackend.h"

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <sstream>
#include <thread>
#include <utility>
#include <vector>

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
#include "WasapiCommon.h"
#include "WasapiFormatNegotiator.h"

#include <avrt.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mmdeviceapi.h>
#include <propidl.h>
#include <propsys.h>
#include <wrl/client.h>
#endif

namespace twilight::audio {
namespace {

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
std::string hresultSuffix(HRESULT hr) {
  std::ostringstream stream;
  stream << "0x" << std::hex << std::uppercase << static_cast<unsigned long>(hr);
  return stream.str();
}

std::string outputFormatSummary(const AudioFormat& format) {
  return std::to_string(format.sampleRate) + "Hz " + std::to_string(format.channelCount) + "ch " +
         sampleFormatToString(format.sampleFormat) + " " + std::to_string(format.bitDepth) + "bit";
}
#endif

}  // namespace

struct WasapiExclusiveBackend::Impl {
  AudioFormat outputFormat;
  OutputInfo outputInfo;
  std::string deviceName = "系统默认";

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  Microsoft::WRL::ComPtr<IMMDevice> device;
  Microsoft::WRL::ComPtr<IAudioClient> audioClient;
  Microsoft::WRL::ComPtr<IAudioRenderClient> renderClient;
  wasapi::UniqueHandle samplesReadyEvent;
  std::thread renderThread;
  std::atomic<bool> running{false};
  UINT32 bufferFrameCount = 0;
  REFERENCE_TIME bufferDuration = 0;
  RenderCallback callback;
  OutputEventCallback eventCallback;
  std::vector<float> renderScratch;
  std::vector<uint8_t> waveFormatBytes;
  bool ownerComInitialized = false;

  void resetFailureInfo() {
    outputInfo = {};
    outputInfo.exclusive = true;
    outputInfo.supportsOutputPerfect = false;
    outputInfo.sourceExact = false;
    outputInfo.outputPerfect = false;
    outputInfo.pcmPassthrough = false;
    outputInfo.backend = "wasapi-exclusive";
    outputInfo.actualBackend = "wasapi-exclusive";
    outputInfo.deviceName = deviceName;
    outputInfo.actualDeviceName = deviceName;
  }

  bool fail(std::string* error, const std::string& reason) {
    outputInfo.perfectReason = reason;
    outputInfo.diagnostics.lastError = reason;
    if (error) *error = reason;
    return false;
  }

  bool failHr(std::string* error, const std::string& reason, HRESULT hr) {
    return fail(error, reason + " (错误码 " + hresultSuffix(hr) + ")");
  }

  bool loadDeviceName() {
    Microsoft::WRL::ComPtr<IPropertyStore> properties;
    if (!device || FAILED(device->OpenPropertyStore(STGM_READ, &properties))) return false;
    PROPVARIANT value;
    PropVariantInit(&value);
    if (SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &value)) && value.vt == VT_LPWSTR) {
      deviceName = wasapi::wideToUtf8(value.pwszVal);
    }
    PropVariantClear(&value);
    return true;
  }

  bool activateAudioClient(std::string* error) {
    audioClient.Reset();
    renderClient.Reset();
    HRESULT hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audioClient);
    if (SUCCEEDED(hr)) return true;
    return failHr(error, "WASAPI 独占 open failure：无法激活音频客户端", hr);
  }

  bool initializeAudioClient(const WAVEFORMATEX* format, REFERENCE_TIME requestedDuration, std::string* error) {
    HRESULT hr = audioClient->Initialize(
        AUDCLNT_SHAREMODE_EXCLUSIVE,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_NOPERSIST,
        requestedDuration,
        requestedDuration,
        format,
        nullptr);
    if (hr == S_OK) {
      bufferDuration = requestedDuration;
      return true;
    }

    if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
      UINT32 alignedFrames = 0;
      if (SUCCEEDED(audioClient->GetBufferSize(&alignedFrames)) && alignedFrames > 0) {
        if (!activateAudioClient(error)) return false;
        const REFERENCE_TIME alignedDuration =
            std::max<REFERENCE_TIME>(1, wasapi::framesToReferenceTime(alignedFrames, outputFormat.sampleRate));
        hr = audioClient->Initialize(
            AUDCLNT_SHAREMODE_EXCLUSIVE,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_NOPERSIST,
            alignedDuration,
            alignedDuration,
            format,
            nullptr);
        if (hr == S_OK) {
          bufferDuration = alignedDuration;
          return true;
        }
      }
    }

    return failHr(
        error,
        "WASAPI 独占 init failure：设备拒绝协商格式 " + outputFormatSummary(outputFormat),
        hr);
  }

  bool configureStream(const AudioFormat& requestedFormat, std::string* error) {
    WasapiFormatNegotiator negotiator(audioClient.Get());
    if (!negotiator.negotiate(requestedFormat, error)) {
      outputInfo = negotiator.outputInfo();
      outputInfo.deviceName = deviceName;
      outputInfo.actualDeviceName = deviceName;
      return false;
    }

    outputFormat = negotiator.outputFormat();
    outputInfo = negotiator.outputInfo();
    outputInfo.deviceName = deviceName;
    outputInfo.actualDeviceName = deviceName;
    waveFormatBytes.assign(
        reinterpret_cast<const uint8_t*>(negotiator.waveFormat()),
        reinterpret_cast<const uint8_t*>(negotiator.waveFormat()) + negotiator.waveFormatSize());
    const auto* waveFormat = reinterpret_cast<const WAVEFORMATEX*>(waveFormatBytes.data());
    const std::string negotiatedPerfectReason = outputInfo.perfectReason;
    auto restoreNegotiatedReason = [&]() {
      outputInfo.perfectReason = negotiatedPerfectReason;
      outputInfo.diagnostics.lastError.clear();
    };

    REFERENCE_TIME defaultPeriod = 0;
    REFERENCE_TIME minimumPeriod = 0;
    HRESULT hr = audioClient->GetDevicePeriod(&defaultPeriod, &minimumPeriod);
    if (FAILED(hr)) {
      return failHr(error, "WASAPI 独占 init failure：无法读取设备缓冲周期", hr);
    }

    REFERENCE_TIME requestedDuration = minimumPeriod > 0 ? minimumPeriod : defaultPeriod;
    if (requestedDuration <= 0) {
      requestedDuration = std::max<REFERENCE_TIME>(1, wasapi::framesToReferenceTime(256, outputFormat.sampleRate));
    }

    if (!initializeAudioClient(waveFormat, requestedDuration, error)) {
      if (defaultPeriod > requestedDuration && activateAudioClient(error) &&
          initializeAudioClient(waveFormat, defaultPeriod, error)) {
        restoreNegotiatedReason();
        return true;
      }
      return false;
    }

    restoreNegotiatedReason();
    return true;
  }

  bool attachEventAndRenderClient(std::string* error) {
    samplesReadyEvent.reset(CreateEventW(nullptr, FALSE, FALSE, nullptr));
    if (!samplesReadyEvent) {
      return fail(error, "WASAPI 独占 init failure：无法创建事件回调句柄");
    }

    HRESULT hr = audioClient->SetEventHandle(samplesReadyEvent.get());
    if (FAILED(hr)) return failHr(error, "WASAPI 独占 init failure：无法绑定事件回调", hr);

    hr = audioClient->GetBufferSize(&bufferFrameCount);
    if (FAILED(hr)) return failHr(error, "WASAPI 独占 init failure：无法读取缓冲区大小", hr);
    outputInfo.bufferSizeFrames = static_cast<int>(bufferFrameCount);
    outputInfo.latencyFrames = static_cast<int>(bufferFrameCount);
    outputInfo.latencyMs = outputFormat.sampleRate > 0
                               ? static_cast<double>(bufferFrameCount) * 1000.0 / static_cast<double>(outputFormat.sampleRate)
                               : 0.0;
    outputInfo.latencyInfo.bufferLatencyMs = outputInfo.latencyMs;
    outputInfo.latencyInfo.totalLatencyMs = outputInfo.latencyMs;

    hr = audioClient->GetService(IID_PPV_ARGS(&renderClient));
    if (SUCCEEDED(hr)) return true;
    return failHr(error, "WASAPI 独占 init failure：无法获取渲染客户端", hr);
  }

  bool renderPacket(UINT32 frameCount) {
    if (frameCount == 0) return true;

    BYTE* data = nullptr;
    HRESULT hr = renderClient->GetBuffer(frameCount, &data);
    if (FAILED(hr)) {
      notifyFailure(hr, "无法获取独占输出缓冲区");
      return false;
    }

    const size_t sampleCount = static_cast<size_t>(frameCount) * static_cast<size_t>(outputFormat.channelCount);
    renderScratch.assign(sampleCount, 0.0f);
    if (callback) {
      callback(renderScratch.data(), frameCount);
    }

    wasapi::packFloatToPcm(
        renderScratch.data(),
        frameCount,
        outputFormat.channelCount,
        outputFormat.sampleFormat,
        data);

    hr = renderClient->ReleaseBuffer(frameCount, 0);
    if (FAILED(hr)) {
      notifyFailure(hr, "无法提交独占输出缓冲区");
      return false;
    }
    return true;
  }

  void notifyFailure(HRESULT hr, const char* fallbackMessage) {
    if (!eventCallback) return;
    if (wasapi::isDeviceInvalidated(hr)) {
      eventCallback(OutputBackendEvent::DeviceInvalidated, "输出设备已失效");
      return;
    }
    char buffer[160] = {};
    std::snprintf(buffer, sizeof(buffer), "%s (错误码 0x%08lx)", fallbackMessage, static_cast<unsigned long>(hr));
    eventCallback(OutputBackendEvent::RenderError, buffer);
  }

  void renderLoop() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    DWORD taskIndex = 0;
    HANDLE mmcssHandle = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);

    while (running.load()) {
      const DWORD waitResult = WaitForSingleObject(samplesReadyEvent.get(), 2000);
      if (!running.load()) break;
      if (waitResult != WAIT_OBJECT_0) continue;

      UINT32 padding = 0;
      HRESULT hr = audioClient->GetCurrentPadding(&padding);
      if (FAILED(hr)) {
        notifyFailure(hr, "无法读取独占输出缓冲状态");
        break;
      }

      const UINT32 framesAvailable = bufferFrameCount > padding ? bufferFrameCount - padding : 0;
      if (framesAvailable == 0) continue;
      if (!renderPacket(framesAvailable)) break;
    }

    if (mmcssHandle) AvRevertMmThreadCharacteristics(mmcssHandle);
    CoUninitialize();
  }

  void stop() {
    running = false;
    if (samplesReadyEvent) SetEvent(samplesReadyEvent.get());
    if (renderThread.joinable()) renderThread.join();
    if (audioClient) audioClient->Stop();
  }

  void close() {
    stop();
    renderClient.Reset();
    audioClient.Reset();
    device.Reset();
    samplesReadyEvent.reset();
    bufferFrameCount = 0;
    bufferDuration = 0;
    callback = nullptr;
    eventCallback = nullptr;
    renderScratch.clear();
    waveFormatBytes.clear();
    if (ownerComInitialized) {
      CoUninitialize();
      ownerComInitialized = false;
    }
  }
#else
  void stop() {}
  void close() {}
#endif
};

WasapiExclusiveBackend::WasapiExclusiveBackend() : impl_(std::make_unique<Impl>()) {}

WasapiExclusiveBackend::~WasapiExclusiveBackend() {
  close();
}

const char* WasapiExclusiveBackend::id() const {
  return "wasapi-exclusive";
}

bool WasapiExclusiveBackend::open(const std::string& deviceId, const AudioFormat& requestedFormat, std::string* error) {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  close();
  impl_->resetFailureInfo();

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  impl_->ownerComInitialized = SUCCEEDED(hr);
  if (hr == RPC_E_CHANGED_MODE) hr = S_OK;
  auto failAfterCom = [&]() {
    if (impl_->ownerComInitialized) {
      CoUninitialize();
      impl_->ownerComInitialized = false;
    }
    return false;
  };
  if (FAILED(hr)) {
    return impl_->failHr(error, "WASAPI 独占 open failure：无法初始化 COM 环境", hr);
  }

  Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator;
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (FAILED(hr)) {
    impl_->failHr(error, "WASAPI 独占 open failure：无法创建设备枚举器", hr);
    return failAfterCom();
  }

  if (deviceId.empty() || deviceId == "auto") {
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &impl_->device);
  } else {
    const std::wstring id = wasapi::utf8ToWide(deviceId);
    hr = enumerator->GetDevice(id.c_str(), &impl_->device);
  }
  if (FAILED(hr)) {
    impl_->failHr(error, "WASAPI 独占 open failure：无法打开输出设备", hr);
    return failAfterCom();
  }

  impl_->loadDeviceName();
  if (!impl_->activateAudioClient(error)) return failAfterCom();
  if (!impl_->configureStream(requestedFormat, error)) return failAfterCom();
  if (!impl_->attachEventAndRenderClient(error)) return failAfterCom();

  return true;
#else
  (void)deviceId;
  (void)requestedFormat;
  if (error) *error = "当前构建未启用独占输出";
  return false;
#endif
}

bool WasapiExclusiveBackend::setOutputConfig(const OutputConfig& config, std::string* error) {
  (void)config;
  (void)error;
  return true;
}

bool WasapiExclusiveBackend::start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error) {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  if (!impl_->audioClient || !impl_->renderClient) {
    if (error) *error = "独占输出后端尚未打开";
    return false;
  }

  impl_->callback = std::move(callback);
  impl_->eventCallback = std::move(eventCallback);

  if (!impl_->renderPacket(impl_->bufferFrameCount)) {
    if (error) *error = "无法预填充独占输出缓冲区";
    return false;
  }

  impl_->running = true;
  impl_->renderThread = std::thread([this] { impl_->renderLoop(); });

  HRESULT hr = impl_->audioClient->Start();
  if (!wasapi::succeeded(hr, error, "无法启动独占输出音频流")) {
    impl_->stop();
    return false;
  }

  return true;
#else
  (void)callback;
  (void)eventCallback;
  if (error) *error = "当前构建未启用独占输出";
  return false;
#endif
}

void WasapiExclusiveBackend::stop() {
  impl_->stop();
}

void WasapiExclusiveBackend::close() {
  impl_->close();
}

AudioFormat WasapiExclusiveBackend::outputFormat() const {
  return impl_->outputFormat;
}

OutputInfo WasapiExclusiveBackend::outputInfo() const {
  return impl_->outputInfo;
}

std::string WasapiExclusiveBackend::deviceName() const {
  return impl_->deviceName;
}

bool wasapiExclusiveBackendAvailable() {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  return true;
#else
  return false;
#endif
}

}  // namespace twilight::audio
