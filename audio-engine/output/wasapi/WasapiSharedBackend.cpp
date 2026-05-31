#include "WasapiSharedBackend.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <utility>
#include <vector>

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <audioclient.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <propidl.h>
#include <propsys.h>
#include <functiondiscoverykeys_devpkey.h>
#include <wrl/client.h>
#endif

namespace twilight::audio {

struct WasapiSharedBackend::Impl {
  AudioFormat outputFormat;
  OutputInfo outputInfo;
  std::string deviceName = "系统默认";

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  Microsoft::WRL::ComPtr<IMMDevice> device;
  Microsoft::WRL::ComPtr<IAudioClient> audioClient;
  Microsoft::WRL::ComPtr<IAudioRenderClient> renderClient;
  HANDLE samplesReadyEvent = nullptr;
  std::thread renderThread;
  std::atomic<bool> running{false};
  UINT32 bufferFrameCount = 0;
  RenderCallback callback;
  OutputEventCallback eventCallback;
  bool ownerComInitialized = false;

  static std::wstring utf8ToWide(const std::string& value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
    if (size <= 0) return {};
    std::wstring wide(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, wide.data(), size);
    if (!wide.empty() && wide.back() == L'\0') wide.pop_back();
    return wide;
  }

  static std::string wideToUtf8(const wchar_t* value) {
    if (!value) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string out(static_cast<size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, out.data(), size, nullptr, nullptr);
    if (!out.empty() && out.back() == '\0') out.pop_back();
    return out;
  }

  static bool succeeded(HRESULT hr, std::string* error, const char* message) {
    if (SUCCEEDED(hr)) return true;
    if (error) {
      char buffer[128] = {};
      std::snprintf(buffer, sizeof(buffer), "%s (错误码 0x%08lx)", message, static_cast<unsigned long>(hr));
      *error = buffer;
    }
    return false;
  }

  static bool isDeviceInvalidated(HRESULT hr) {
    return hr == AUDCLNT_E_DEVICE_INVALIDATED || hr == AUDCLNT_E_RESOURCES_INVALIDATED ||
           hr == AUDCLNT_E_SERVICE_NOT_RUNNING;
  }

  bool loadDeviceName() {
    Microsoft::WRL::ComPtr<IPropertyStore> properties;
    if (!device || FAILED(device->OpenPropertyStore(STGM_READ, &properties))) return false;
    PROPVARIANT value;
    PropVariantInit(&value);
    if (SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &value)) && value.vt == VT_LPWSTR) {
      deviceName = wideToUtf8(value.pwszVal);
    }
    PropVariantClear(&value);
    return true;
  }

  bool chooseFloatMixFormat(WAVEFORMATEX* mix, std::vector<uint8_t>* formatBytes, std::string* error) {
    if (!mix || !formatBytes) return false;

    const GUID ieeeFloatSubFormat = {
        0x00000003, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};
    const WORD channels = mix->nChannels;
    const DWORD sampleRate = mix->nSamplesPerSec;
    DWORD channelMask = 0;
    if (mix->wFormatTag == WAVE_FORMAT_EXTENSIBLE && mix->cbSize >= sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)) {
      const auto* extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(mix);
      channelMask = extensible->dwChannelMask;
    }

    WAVEFORMATEXTENSIBLE desired{};
    desired.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
    desired.Format.nChannels = channels;
    desired.Format.nSamplesPerSec = sampleRate;
    desired.Format.wBitsPerSample = 32;
    desired.Format.nBlockAlign = static_cast<WORD>(channels * sizeof(float));
    desired.Format.nAvgBytesPerSec = desired.Format.nSamplesPerSec * desired.Format.nBlockAlign;
    desired.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
    desired.Samples.wValidBitsPerSample = 32;
    desired.dwChannelMask = channelMask;
    desired.SubFormat = ieeeFloatSubFormat;

    WAVEFORMATEX* closest = nullptr;
    HRESULT hr = audioClient->IsFormatSupported(AUDCLNT_SHAREMODE_SHARED, &desired.Format, &closest);
    if (closest) CoTaskMemFree(closest);

    if (hr == S_OK) {
      formatBytes->resize(sizeof(WAVEFORMATEXTENSIBLE));
      std::memcpy(formatBytes->data(), &desired, sizeof(WAVEFORMATEXTENSIBLE));
      return true;
    }

    const bool mixIsFloat =
        mix->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
        (mix->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
         IsEqualGUID(reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(mix)->SubFormat, ieeeFloatSubFormat));
    if (!mixIsFloat) {
      if (error) *error = "共享输出混音格式不是 32 位浮点，且设备拒绝 32 位浮点共享输出";
      return false;
    }

    const size_t bytes = sizeof(WAVEFORMATEX) + mix->cbSize;
    formatBytes->resize(bytes);
    std::memcpy(formatBytes->data(), mix, bytes);
    return true;
  }

  void renderLoop() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    while (running.load()) {
      const DWORD waitResult = WaitForSingleObject(samplesReadyEvent, 2000);
      if (!running.load()) break;
      if (waitResult != WAIT_OBJECT_0) continue;

      UINT32 padding = 0;
      HRESULT hr = audioClient->GetCurrentPadding(&padding);
      if (FAILED(hr)) {
        if (eventCallback && isDeviceInvalidated(hr)) {
          eventCallback(OutputBackendEvent::DeviceInvalidated, "输出设备已失效");
          break;
        }
        continue;
      }
      const UINT32 framesAvailable = bufferFrameCount > padding ? bufferFrameCount - padding : 0;
      if (framesAvailable == 0) continue;

      BYTE* data = nullptr;
      hr = renderClient->GetBuffer(framesAvailable, &data);
      if (FAILED(hr)) {
        if (eventCallback && isDeviceInvalidated(hr)) {
          eventCallback(OutputBackendEvent::DeviceInvalidated, "输出设备已失效");
          break;
        }
        continue;
      }

      const size_t samples = static_cast<size_t>(framesAvailable) * static_cast<size_t>(outputFormat.channelCount);
      std::fill(reinterpret_cast<float*>(data), reinterpret_cast<float*>(data) + samples, 0.0f);
      if (callback) {
        callback(reinterpret_cast<float*>(data), framesAvailable);
      }
      hr = renderClient->ReleaseBuffer(framesAvailable, 0);
      if (FAILED(hr) && eventCallback && isDeviceInvalidated(hr)) {
        eventCallback(OutputBackendEvent::DeviceInvalidated, "输出设备已失效");
        break;
      }
    }

    CoUninitialize();
  }

  void stop() {
    running = false;
    if (samplesReadyEvent) SetEvent(samplesReadyEvent);
    if (renderThread.joinable()) renderThread.join();
    if (audioClient) audioClient->Stop();
  }

  void close() {
    stop();
    renderClient.Reset();
    audioClient.Reset();
    device.Reset();
    if (samplesReadyEvent) {
      CloseHandle(samplesReadyEvent);
      samplesReadyEvent = nullptr;
    }
    bufferFrameCount = 0;
    callback = nullptr;
    eventCallback = nullptr;
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

WasapiSharedBackend::WasapiSharedBackend() : impl_(std::make_unique<Impl>()) {}

WasapiSharedBackend::~WasapiSharedBackend() {
  close();
}

const char* WasapiSharedBackend::id() const {
  return "wasapi";
}

bool WasapiSharedBackend::open(const std::string& deviceId, const AudioFormat& requestedFormat, std::string* error) {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  close();

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool shouldUninitialize = SUCCEEDED(hr);
  impl_->ownerComInitialized = shouldUninitialize;
  auto failAfterCom = [&]() {
    if (impl_->ownerComInitialized) {
      CoUninitialize();
      impl_->ownerComInitialized = false;
    }
    return false;
  };
  if (hr == RPC_E_CHANGED_MODE) {
    hr = S_OK;
  }
  if (!Impl::succeeded(hr, error, "无法初始化音频输出所需环境")) return false;

  Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator;
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (!Impl::succeeded(hr, error, "无法创建设备枚举器")) {
    (void)shouldUninitialize;
    return failAfterCom();
  }

  if (deviceId.empty() || deviceId == "auto") {
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &impl_->device);
  } else {
    const std::wstring id = Impl::utf8ToWide(deviceId);
    hr = enumerator->GetDevice(id.c_str(), &impl_->device);
  }
  if (!Impl::succeeded(hr, error, "无法打开输出设备")) {
    return failAfterCom();
  }
  impl_->loadDeviceName();

  hr = impl_->device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &impl_->audioClient);
  if (!Impl::succeeded(hr, error, "无法激活输出设备音频客户端")) {
    return failAfterCom();
  }

  WAVEFORMATEX* mixFormat = nullptr;
  hr = impl_->audioClient->GetMixFormat(&mixFormat);
  if (!Impl::succeeded(hr, error, "无法读取共享输出混音格式")) {
    return failAfterCom();
  }

  std::vector<uint8_t> activeFormatBytes;
  const bool choseFormat = impl_->chooseFloatMixFormat(mixFormat, &activeFormatBytes, error);
  CoTaskMemFree(mixFormat);
  if (!choseFormat) {
    return failAfterCom();
  }

  auto* activeFormat = reinterpret_cast<WAVEFORMATEX*>(activeFormatBytes.data());
  constexpr REFERENCE_TIME kBufferDuration = 1000000;  // 100 ms.
  hr = impl_->audioClient->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_NOPERSIST,
      kBufferDuration,
      0,
      activeFormat,
      nullptr);
  if (!Impl::succeeded(hr, error, "无法初始化共享输出音频流")) {
    return failAfterCom();
  }

  impl_->samplesReadyEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!impl_->samplesReadyEvent) {
    if (error) *error = "无法创建输出事件";
    return failAfterCom();
  }
  hr = impl_->audioClient->SetEventHandle(impl_->samplesReadyEvent);
  if (!Impl::succeeded(hr, error, "无法绑定输出事件")) {
    return failAfterCom();
  }

  hr = impl_->audioClient->GetBufferSize(&impl_->bufferFrameCount);
  if (!Impl::succeeded(hr, error, "无法读取输出缓冲区大小")) {
    return failAfterCom();
  }
  hr = impl_->audioClient->GetService(IID_PPV_ARGS(&impl_->renderClient));
  if (!Impl::succeeded(hr, error, "无法获取输出渲染客户端")) {
    return failAfterCom();
  }

  impl_->outputFormat.sampleRate = static_cast<int>(activeFormat->nSamplesPerSec);
  impl_->outputFormat.channelCount = static_cast<int>(activeFormat->nChannels);
  impl_->outputFormat.bitDepth = 32;
  impl_->outputFormat.sampleFormat = AudioSampleFormat::Float32Interleaved;
  impl_->outputInfo.exclusive = false;
  impl_->outputInfo.supportsBitPerfect = false;
  impl_->outputInfo.bitPerfect = false;
  impl_->outputInfo.resampled = requestedFormat.sampleRate != impl_->outputFormat.sampleRate ||
                                requestedFormat.channelCount != impl_->outputFormat.channelCount ||
                                requestedFormat.bitDepth != impl_->outputFormat.bitDepth;
  impl_->outputInfo.outputSampleRate = impl_->outputFormat.sampleRate;
  impl_->outputInfo.outputBitDepth = impl_->outputFormat.bitDepth;
  impl_->outputInfo.backend = "wasapi";
  impl_->outputInfo.actualBackend = "wasapi";
  impl_->outputInfo.deviceName = impl_->deviceName;
  impl_->outputInfo.actualDeviceName = impl_->deviceName;
  impl_->outputInfo.actualOutputFormat = "float32";
  impl_->outputInfo.actualSampleRate = impl_->outputFormat.sampleRate;
  impl_->outputInfo.actualBitDepth = impl_->outputFormat.bitDepth;
  impl_->outputInfo.actualChannels = impl_->outputFormat.channelCount;
  impl_->outputInfo.bufferSizeFrames = static_cast<int>(impl_->bufferFrameCount);
  impl_->outputInfo.latencyInfo.bufferLatencyMs =
      impl_->outputFormat.sampleRate > 0
          ? static_cast<double>(impl_->bufferFrameCount) * 1000.0 / static_cast<double>(impl_->outputFormat.sampleRate)
          : 0.0;
  impl_->outputInfo.latencyInfo.totalLatencyMs = impl_->outputInfo.latencyInfo.bufferLatencyMs;

  return true;
#else
  (void)deviceId;
  (void)requestedFormat;
  if (error) *error = "当前构建未启用系统音频输出";
  return false;
#endif
}

bool WasapiSharedBackend::setOutputConfig(const OutputConfig& config, std::string* error) {
  (void)config;
  (void)error;
  return true;
}

bool WasapiSharedBackend::start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error) {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  if (!impl_->audioClient || !impl_->renderClient) {
    if (error) *error = "共享输出后端尚未打开";
    return false;
  }

  impl_->callback = std::move(callback);
  impl_->eventCallback = std::move(eventCallback);

  BYTE* data = nullptr;
  HRESULT hr = impl_->renderClient->GetBuffer(impl_->bufferFrameCount, &data);
  if (!Impl::succeeded(hr, error, "无法预填充输出缓冲区")) return false;
  const size_t samples =
      static_cast<size_t>(impl_->bufferFrameCount) * static_cast<size_t>(impl_->outputFormat.channelCount);
  std::fill(reinterpret_cast<float*>(data), reinterpret_cast<float*>(data) + samples, 0.0f);
  if (impl_->callback) {
    impl_->callback(reinterpret_cast<float*>(data), impl_->bufferFrameCount);
  }
  impl_->renderClient->ReleaseBuffer(impl_->bufferFrameCount, 0);

  impl_->running = true;
  impl_->renderThread = std::thread([this] { impl_->renderLoop(); });

  hr = impl_->audioClient->Start();
  if (!Impl::succeeded(hr, error, "无法启动共享输出音频流")) {
    impl_->stop();
    return false;
  }
  return true;
#else
  (void)callback;
  (void)eventCallback;
  if (error) *error = "当前构建未启用系统音频输出";
  return false;
#endif
}

void WasapiSharedBackend::stop() {
  impl_->stop();
}

void WasapiSharedBackend::close() {
  impl_->close();
}

AudioFormat WasapiSharedBackend::outputFormat() const {
  return impl_->outputFormat;
}

OutputInfo WasapiSharedBackend::outputInfo() const {
  return impl_->outputInfo;
}

std::string WasapiSharedBackend::deviceName() const {
  return impl_->deviceName;
}

bool wasapiSharedBackendAvailable() {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  return true;
#else
  return false;
#endif
}

}  // namespace twilight::audio
