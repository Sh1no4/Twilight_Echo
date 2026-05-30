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
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <propidl.h>
#include <wrl/client.h>
#include <windows.h>
#endif

namespace twilight::audio {

struct WasapiSharedBackend::Impl {
  AudioFormat outputFormat;
  std::string deviceName = "System default";

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  Microsoft::WRL::ComPtr<IMMDevice> device;
  Microsoft::WRL::ComPtr<IAudioClient> audioClient;
  Microsoft::WRL::ComPtr<IAudioRenderClient> renderClient;
  HANDLE samplesReadyEvent = nullptr;
  std::thread renderThread;
  std::atomic<bool> running{false};
  UINT32 bufferFrameCount = 0;
  RenderCallback callback;
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
      std::snprintf(buffer, sizeof(buffer), "%s (HRESULT 0x%08lx)", message, static_cast<unsigned long>(hr));
      *error = buffer;
    }
    return false;
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
    desired.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;

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
         IsEqualGUID(reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(mix)->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT));
    if (!mixIsFloat) {
      if (error) *error = "WASAPI shared mix format is not float32, and float32 shared mode was rejected";
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
      if (FAILED(audioClient->GetCurrentPadding(&padding))) continue;
      const UINT32 framesAvailable = bufferFrameCount > padding ? bufferFrameCount - padding : 0;
      if (framesAvailable == 0) continue;

      BYTE* data = nullptr;
      if (FAILED(renderClient->GetBuffer(framesAvailable, &data))) continue;

      const size_t samples = static_cast<size_t>(framesAvailable) * static_cast<size_t>(outputFormat.channelCount);
      std::fill(reinterpret_cast<float*>(data), reinterpret_cast<float*>(data) + samples, 0.0f);
      if (callback) {
        callback(reinterpret_cast<float*>(data), framesAvailable);
      }
      renderClient->ReleaseBuffer(framesAvailable, 0);
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
  if (!Impl::succeeded(hr, error, "Unable to initialize COM for WASAPI")) return false;

  Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator;
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (!Impl::succeeded(hr, error, "Unable to create WASAPI device enumerator")) {
    (void)shouldUninitialize;
    return failAfterCom();
  }

  if (deviceId.empty() || deviceId == "auto") {
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &impl_->device);
  } else {
    const std::wstring id = Impl::utf8ToWide(deviceId);
    hr = enumerator->GetDevice(id.c_str(), &impl_->device);
  }
  if (!Impl::succeeded(hr, error, "Unable to open WASAPI output device")) {
    return failAfterCom();
  }
  impl_->loadDeviceName();

  hr = impl_->device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &impl_->audioClient);
  if (!Impl::succeeded(hr, error, "Unable to activate WASAPI audio client")) {
    return failAfterCom();
  }

  WAVEFORMATEX* mixFormat = nullptr;
  hr = impl_->audioClient->GetMixFormat(&mixFormat);
  if (!Impl::succeeded(hr, error, "Unable to read WASAPI mix format")) {
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
  if (!Impl::succeeded(hr, error, "Unable to initialize WASAPI shared stream")) {
    return failAfterCom();
  }

  impl_->samplesReadyEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!impl_->samplesReadyEvent) {
    if (error) *error = "Unable to create WASAPI render event";
    return failAfterCom();
  }
  hr = impl_->audioClient->SetEventHandle(impl_->samplesReadyEvent);
  if (!Impl::succeeded(hr, error, "Unable to attach WASAPI render event")) {
    return failAfterCom();
  }

  hr = impl_->audioClient->GetBufferSize(&impl_->bufferFrameCount);
  if (!Impl::succeeded(hr, error, "Unable to read WASAPI buffer size")) {
    return failAfterCom();
  }
  hr = impl_->audioClient->GetService(IID_PPV_ARGS(&impl_->renderClient));
  if (!Impl::succeeded(hr, error, "Unable to get WASAPI render client")) {
    return failAfterCom();
  }

  impl_->outputFormat.sampleRate = static_cast<int>(activeFormat->nSamplesPerSec);
  impl_->outputFormat.channelCount = static_cast<int>(activeFormat->nChannels);
  impl_->outputFormat.bitDepth = 32;
  impl_->outputFormat.sampleFormat = AudioSampleFormat::Float32Interleaved;
  (void)requestedFormat;

  return true;
#else
  (void)deviceId;
  (void)requestedFormat;
  if (error) *error = "WASAPI is only available in Windows builds with TAE_ENABLE_WASAPI";
  return false;
#endif
}

bool WasapiSharedBackend::start(RenderCallback callback, std::string* error) {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  if (!impl_->audioClient || !impl_->renderClient) {
    if (error) *error = "WASAPI backend is not open";
    return false;
  }

  impl_->callback = std::move(callback);

  BYTE* data = nullptr;
  HRESULT hr = impl_->renderClient->GetBuffer(impl_->bufferFrameCount, &data);
  if (!Impl::succeeded(hr, error, "Unable to prefill WASAPI buffer")) return false;
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
  if (!Impl::succeeded(hr, error, "Unable to start WASAPI stream")) {
    impl_->stop();
    return false;
  }
  return true;
#else
  (void)callback;
  if (error) *error = "WASAPI is only available in Windows builds with TAE_ENABLE_WASAPI";
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
