#include "WasapiExclusiveBackend.h"

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <mutex>
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

double referenceTimeToMilliseconds(REFERENCE_TIME duration) {
  return duration > 0 ? static_cast<double>(duration) / 10000.0 : 0.0;
}
#endif

}  // namespace

struct WasapiExclusiveBackend::Impl {
  AudioFormat outputFormat;
  OutputInfo outputInfo;
  OutputInfo::Diagnostics diagnostics;
  DopRuntimeFacts dopRuntimeFacts;
  std::string deviceName = "系统默认";
  OutputConfig outputConfig;
  mutable std::mutex infoMutex;

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
  TypedRenderCallback typedCallback;
  OutputEventCallback eventCallback;
  std::vector<float> renderScratch;
  std::vector<uint8_t> waveFormatBytes;
  bool ownerComInitialized = false;

  void resetFailureInfo() {
    OutputInfo::Diagnostics lifetime = diagnostics;
    diagnostics = {};
    diagnostics.lifetimeUnderrunCount = lifetime.lifetimeUnderrunCount;
    diagnostics.lifetimeBufferDropCount = lifetime.lifetimeBufferDropCount;
    diagnostics.lifetimeRecoveryCount = lifetime.lifetimeRecoveryCount;
    diagnostics.driverRestartCount = lifetime.driverRestartCount;
    diagnostics.deviceLostCount = lifetime.deviceLostCount;

    std::lock_guard lock(infoMutex);
    outputInfo = {};
    dopRuntimeFacts = {};
    outputInfo.exclusive = true;
    outputInfo.accessMode = "exclusive";
    outputInfo.supportsOutputPerfect = false;
    outputInfo.sourceExact = false;
    outputInfo.outputPerfect = false;
    outputInfo.pcmPassthrough = false;
    outputInfo.backend = "wasapi-exclusive";
    outputInfo.actualBackend = "wasapi-exclusive";
    outputInfo.devicePathKind = "default";
    outputInfo.deviceName = deviceName;
    outputInfo.actualDeviceName = deviceName;
    outputInfo.diagnostics = diagnostics;
  }

  void recordFailure(const char* reasonCode, const std::string& reason, std::string* error = nullptr) {
    diagnostics.lastError = reason;
    std::lock_guard lock(infoMutex);
    outputInfo.perfectReasonCode = reasonCode ? reasonCode : "backend_open_failure";
    outputInfo.capabilityReason = reason;
    outputInfo.perfectReason = reason;
    outputInfo.diagnostics = diagnostics;
    if (error) *error = reason;
  }

  bool fail(std::string* error, const std::string& reason) {
    recordFailure("backend_open_failure", reason, error);
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
      dopRuntimeFacts = negotiator.dopRuntimeFacts();
      outputInfo.deviceName = deviceName;
      outputInfo.actualDeviceName = deviceName;
      outputInfo.diagnostics = diagnostics;
      return false;
    }

    outputFormat = negotiator.outputFormat();
    outputInfo = negotiator.outputInfo();
    dopRuntimeFacts = negotiator.dopRuntimeFacts();
    outputInfo.deviceName = deviceName;
    outputInfo.actualDeviceName = deviceName;
    outputInfo.diagnostics = diagnostics;
    waveFormatBytes.assign(
        reinterpret_cast<const uint8_t*>(negotiator.waveFormat()),
        reinterpret_cast<const uint8_t*>(negotiator.waveFormat()) + negotiator.waveFormatSize());
    const auto* waveFormat = reinterpret_cast<const WAVEFORMATEX*>(waveFormatBytes.data());
    const std::string negotiatedPerfectReasonCode = outputInfo.perfectReasonCode;
    const std::string negotiatedCapabilityReason = outputInfo.capabilityReason;
    const std::string negotiatedPerfectReason = outputInfo.perfectReason;
    auto restoreNegotiatedReason = [&]() {
      diagnostics.lastError.clear();
      outputInfo.perfectReasonCode = negotiatedPerfectReasonCode;
      outputInfo.capabilityReason = negotiatedCapabilityReason;
      outputInfo.perfectReason = negotiatedPerfectReason;
      outputInfo.diagnostics = diagnostics;
    };

    REFERENCE_TIME defaultPeriod = 0;
    REFERENCE_TIME minimumPeriod = 0;
    HRESULT hr = audioClient->GetDevicePeriod(&defaultPeriod, &minimumPeriod);
    if (FAILED(hr)) {
      return failHr(error, "WASAPI 独占 init failure：无法读取设备缓冲周期", hr);
    }

    REFERENCE_TIME requestedDuration = 0;
    if (outputConfig.preferredBufferSize > 0) {
      requestedDuration = wasapi::framesToReferenceTime(outputConfig.preferredBufferSize, outputFormat.sampleRate);
    }
    if (requestedDuration <= 0) {
      requestedDuration = minimumPeriod > 0 ? minimumPeriod : defaultPeriod;
    }
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
    outputInfo.latencyInfo.bufferLatencyMs =
        outputFormat.sampleRate > 0
            ? static_cast<double>(bufferFrameCount) * 1000.0 / static_cast<double>(outputFormat.sampleRate)
            : 0.0;
    REFERENCE_TIME streamLatency = 0;
    hr = audioClient->GetStreamLatency(&streamLatency);
    if (SUCCEEDED(hr)) {
      const double streamLatencyMs = referenceTimeToMilliseconds(streamLatency);
      outputInfo.latencyInfo.outputLatencyMs = std::max(0.0, streamLatencyMs - outputInfo.latencyInfo.bufferLatencyMs);
      outputInfo.latencyInfo.totalLatencyMs =
          outputInfo.latencyInfo.bufferLatencyMs + outputInfo.latencyInfo.outputLatencyMs;
    } else {
      outputInfo.latencyInfo.outputLatencyMs = 0.0;
      outputInfo.latencyInfo.totalLatencyMs = outputInfo.latencyInfo.bufferLatencyMs;
    }
    outputInfo.latencyMs = outputInfo.latencyInfo.totalLatencyMs;

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

    if (typedCallback) {
      PcmBlock block;
      block.format = outputFormat;
      block.data = data;
      block.frames = frameCount;
      block.byteSize = static_cast<size_t>(frameCount) * audioFormatBytesPerFrame(outputFormat);
      const size_t rendered = typedCallback(block);
      if (rendered > 0) {
        hr = renderClient->ReleaseBuffer(frameCount, 0);
        if (FAILED(hr)) {
          notifyFailure(hr, "无法提交独占输出缓冲区");
          return false;
        }
        return true;
      }
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
    if (wasapi::isDeviceInvalidated(hr)) {
      ++diagnostics.deviceLostCount;
      recordFailure("device_lost", fallbackMessage + std::string(" (错误码 ") + hresultSuffix(hr) + ")");
      if (eventCallback) eventCallback(OutputBackendEvent::DeviceInvalidated, "输出设备已失效");
      return;
    }
    char buffer[160] = {};
    std::snprintf(buffer, sizeof(buffer), "%s (错误码 0x%08lx)", fallbackMessage, static_cast<unsigned long>(hr));
    ++diagnostics.sessionBufferDropCount;
    ++diagnostics.lifetimeBufferDropCount;
    recordFailure("render_failure", buffer);
    if (eventCallback) eventCallback(OutputBackendEvent::RenderError, buffer);
  }

  void renderLoop() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    DWORD taskIndex = 0;
    HANDLE mmcssHandle = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);

    auto lastWakeTime = std::chrono::high_resolution_clock::now();
    auto lastLatencyQueryTime = lastWakeTime;

    while (running.load()) {
      const DWORD waitResult = WaitForSingleObject(samplesReadyEvent.get(), 2000);
      if (!running.load()) break;
      if (waitResult != WAIT_OBJECT_0) {
        if (waitResult == WAIT_TIMEOUT) {
           ++diagnostics.sessionUnderrunCount;
           ++diagnostics.lifetimeUnderrunCount;
        }
        continue;
      }

      auto now = std::chrono::high_resolution_clock::now();
      double elapsedMs = std::chrono::duration<double, std::milli>(now - lastWakeTime).count();
      lastWakeTime = now;

      // In exclusive mode, the expected wakeup interval is roughly bufferLatencyMs.
      // If we wake up much later than expected, we missed a deadline.
      if (outputInfo.latencyInfo.bufferLatencyMs > 0 && elapsedMs > outputInfo.latencyInfo.bufferLatencyMs * 1.5) {
        ++diagnostics.sessionUnderrunCount;
        ++diagnostics.lifetimeUnderrunCount;
      }

      if (std::chrono::duration<double, std::milli>(now - lastLatencyQueryTime).count() > 1000.0) {
        lastLatencyQueryTime = now;
        REFERENCE_TIME streamLatency = 0;
        if (SUCCEEDED(audioClient->GetStreamLatency(&streamLatency))) {
          const double streamLatencyMs = referenceTimeToMilliseconds(streamLatency);
          outputInfo.latencyInfo.outputLatencyMs = std::max(0.0, streamLatencyMs - outputInfo.latencyInfo.bufferLatencyMs);
          outputInfo.latencyInfo.totalLatencyMs = outputInfo.latencyInfo.bufferLatencyMs + outputInfo.latencyInfo.outputLatencyMs;
          outputInfo.latencyMs = outputInfo.latencyInfo.totalLatencyMs;
        }
      }

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
    typedCallback = nullptr;
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

  if (wasapi::isDefaultDeviceAlias(deviceId)) {
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
  impl_->outputConfig = config;
  (void)error;
  return true;
}

bool WasapiExclusiveBackend::start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error) {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  if (!impl_->audioClient || !impl_->renderClient) {
    impl_->recordFailure("backend_start_failure", "独占输出后端尚未打开", error);
    return false;
  }

  impl_->callback = std::move(callback);
  impl_->typedCallback = nullptr;
  impl_->eventCallback = std::move(eventCallback);

  if (!impl_->renderPacket(impl_->bufferFrameCount)) {
    if (error) *error = impl_->diagnostics.lastError.empty() ? "无法预填充独占输出缓冲区" : impl_->diagnostics.lastError;
    return false;
  }

  impl_->running = true;
  impl_->renderThread = std::thread([this] { impl_->renderLoop(); });

  HRESULT hr = impl_->audioClient->Start();
  if (!wasapi::succeeded(hr, error, "无法启动独占输出音频流")) {
    if (wasapi::isDeviceInvalidated(hr)) ++impl_->diagnostics.deviceLostCount;
    impl_->recordFailure(
        wasapi::isDeviceInvalidated(hr) ? "device_lost" : "backend_start_failure",
        "无法启动独占输出音频流 (错误码 " + hresultSuffix(hr) + ")",
        error);
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

bool WasapiExclusiveBackend::startTyped(
    TypedRenderCallback callback,
    RenderCallback fallbackCallback,
    OutputEventCallback eventCallback,
    std::string* error) {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  if (!impl_->audioClient || !impl_->renderClient) {
    impl_->recordFailure("backend_start_failure", "独占输出后端尚未打开", error);
    return false;
  }

  impl_->typedCallback = std::move(callback);
  impl_->callback = std::move(fallbackCallback);
  impl_->eventCallback = std::move(eventCallback);

  if (!impl_->renderPacket(impl_->bufferFrameCount)) {
    if (error) *error = impl_->diagnostics.lastError.empty() ? "无法预填充独占输出缓冲区" : impl_->diagnostics.lastError;
    return false;
  }

  impl_->running = true;
  impl_->renderThread = std::thread([this] { impl_->renderLoop(); });

  HRESULT hr = impl_->audioClient->Start();
  if (!wasapi::succeeded(hr, error, "无法启动独占输出音频流")) {
    if (wasapi::isDeviceInvalidated(hr)) ++impl_->diagnostics.deviceLostCount;
    impl_->recordFailure(
        wasapi::isDeviceInvalidated(hr) ? "device_lost" : "backend_start_failure",
        "无法启动独占输出音频流 (错误码 " + hresultSuffix(hr) + ")",
        error);
    impl_->stop();
    return false;
  }

  return true;
#else
  (void)callback;
  (void)fallbackCallback;
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
  std::lock_guard lock(impl_->infoMutex);
  return impl_->outputInfo;
}

DopRuntimeFacts WasapiExclusiveBackend::dopRuntimeFacts() const {
  return impl_->dopRuntimeFacts;
}

NativeDsdRuntimeFacts WasapiExclusiveBackend::nativeDsdRuntimeFacts() const {
  return unsupportedNativeDsdRuntimeFacts("WASAPI exclusive output supports PCM/DoP only; Native DSD is unavailable");
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
