#include "WasapiExclusiveBackend.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <deque>
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
  std::thread recoveryThread;
  std::mutex threadMutex;
  std::atomic<bool> running{false};
  std::atomic<bool> stopRequested{false};
  UINT32 bufferFrameCount = 0;
  REFERENCE_TIME bufferDuration = 0;
  std::atomic<double> renderBufferLatencyMs{0.0};
  RenderCallback callback;
  TypedRenderCallback typedCallback;
  OutputEventCallback eventCallback;
  std::vector<float> renderScratch;
  std::vector<uint8_t> waveFormatBytes;
  bool ownerComInitialized = false;

  // ── 自动恢复状态 ──
  std::atomic<bool> recoveryInProgress{false};
  std::atomic<bool> recoveryQueued{false};
  int recoveryAttempts = 0;
  uint64_t recoveryCount = 0;
  std::chrono::steady_clock::time_point recoveryCooldownUntil{};
  std::deque<std::chrono::steady_clock::time_point> recoveryWindow;
  const char* queuedRecoveryReason = nullptr;
  const char* queuedRenderFailureMessage = nullptr;
  std::atomic<long> queuedRenderFailureHr{S_OK};
  std::atomic<bool> renderErrorEventQueued{false};
  std::atomic<bool> deviceInvalidatedEventQueued{false};
  // 恢复所需的上下文快照（open 时保存，reopen 时使用）
  std::string openDeviceId;
  AudioFormat openRequestedFormat;

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
    renderBufferLatencyMs.store(0.0);
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
    DWORD streamFlags = AUDCLNT_STREAMFLAGS_NOPERSIST;
    if (!outputConfig.wasapiExclusivePushMode) {
      streamFlags |= AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
    }
    HRESULT hr = audioClient->Initialize(
        AUDCLNT_SHAREMODE_EXCLUSIVE,
        streamFlags,
        requestedDuration,
        requestedDuration,
        format,
        nullptr);
    if (wasapi::isDeviceInUse(hr)) {
      for (int attempt = 0; attempt < 5 && wasapi::isDeviceInUse(hr); ++attempt) {
        std::this_thread::sleep_for(std::chrono::milliseconds(25));
        if (!activateAudioClient(error)) return false;
        hr = audioClient->Initialize(
            AUDCLNT_SHAREMODE_EXCLUSIVE,
            streamFlags,
            requestedDuration,
            requestedDuration,
            format,
            nullptr);
      }
    }
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
            streamFlags,
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

    REFERENCE_TIME requestedDuration = wasapi::chooseExclusiveBufferDuration(
        outputConfig.preferredBufferSize,
        outputFormat.sampleRate,
        defaultPeriod,
        minimumPeriod);

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
    HRESULT hr = S_OK;
    if (!outputConfig.wasapiExclusivePushMode) {
      samplesReadyEvent.reset(CreateEventW(nullptr, FALSE, FALSE, nullptr));
      if (!samplesReadyEvent) {
        return fail(error, "WASAPI 独占 init failure：无法创建事件回调句柄");
      }

      hr = audioClient->SetEventHandle(samplesReadyEvent.get());
      if (FAILED(hr)) return failHr(error, "WASAPI 独占 init failure：无法绑定事件回调", hr);
    }

    hr = audioClient->GetBufferSize(&bufferFrameCount);
    if (FAILED(hr)) return failHr(error, "WASAPI 独占 init failure：无法读取缓冲区大小", hr);
    renderScratch.resize(
        static_cast<size_t>(bufferFrameCount) * static_cast<size_t>(std::max(1, outputFormat.channelCount)));
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
    renderBufferLatencyMs.store(outputInfo.latencyInfo.bufferLatencyMs);

    hr = audioClient->GetService(IID_PPV_ARGS(&renderClient));
    if (SUCCEEDED(hr)) return true;
    return failHr(error, "WASAPI 独占 init failure：无法获取渲染客户端", hr);
  }

  HRESULT renderPacket(UINT32 frameCount) {
    if (frameCount == 0) return S_OK;

    BYTE* data = nullptr;
    HRESULT hr = renderClient->GetBuffer(frameCount, &data);
    if (FAILED(hr)) return hr;
    const size_t byteCount = static_cast<size_t>(frameCount) * audioFormatBytesPerFrame(outputFormat);

    if (typedCallback) {
      PcmBlock block;
      block.format = outputFormat;
      block.data = data;
      block.frames = frameCount;
      block.byteSize = byteCount;
      const size_t rendered = typedCallback(block);
      if (rendered > 0) {
        const size_t renderedFrames = std::min<size_t>(rendered, frameCount);
        const size_t renderedBytes = renderedFrames * audioFormatBytesPerFrame(outputFormat);
        if (data && renderedBytes < byteCount) std::memset(data + renderedBytes, 0, byteCount - renderedBytes);
        hr = renderClient->ReleaseBuffer(frameCount, 0);
        if (FAILED(hr)) return hr;
        return S_OK;
      }
    }

    if (outputFormat.sampleFormat == AudioSampleFormat::Float32Interleaved) {
      wasapi::renderFloatCallbackWithTailSilence(
          reinterpret_cast<float*>(data),
          frameCount,
          outputFormat.channelCount,
          callback);
      hr = renderClient->ReleaseBuffer(frameCount, 0);
      if (FAILED(hr)) return hr;
      return S_OK;
    }

    const size_t sampleCount = static_cast<size_t>(frameCount) * static_cast<size_t>(outputFormat.channelCount);
    const size_t scratchFrames =
        outputFormat.channelCount > 0
            ? std::min<size_t>(frameCount, renderScratch.size() / static_cast<size_t>(outputFormat.channelCount))
            : 0;
    wasapi::renderFloatCallbackWithTailSilence(
        renderScratch.data(),
        scratchFrames,
        outputFormat.channelCount,
        callback);

    wasapi::packFloatToPcm(
        renderScratch.data(),
        scratchFrames,
        outputFormat.channelCount,
        outputFormat.sampleFormat,
        data);
    if (scratchFrames < frameCount) {
      const size_t bytesPerFrame = audioFormatBytesPerFrame(outputFormat);
      const size_t renderedBytes = scratchFrames * bytesPerFrame;
      if (data && renderedBytes < byteCount) std::memset(data + renderedBytes, 0, byteCount - renderedBytes);
    }

    hr = renderClient->ReleaseBuffer(frameCount, 0);
    if (FAILED(hr)) return hr;
    return S_OK;
  }

  void notifyFailure(HRESULT hr, const char* fallbackMessage) {
    if (wasapi::isDeviceInvalidated(hr)) {
      ++diagnostics.deviceLostCount;
      recordFailure("device_lost", fallbackMessage + std::string(" (错误码 ") + hresultSuffix(hr) + ")");
      // 不在此处通知上层 DeviceInvalidated — 由 handleRenderFailure 决定恢复或通知
      return;
    }
    char buffer[160] = {};
    std::snprintf(buffer, sizeof(buffer), "%s (错误码 0x%08lx)", fallbackMessage, static_cast<unsigned long>(hr));
    ++diagnostics.sessionBufferDropCount;
    ++diagnostics.lifetimeBufferDropCount;
    recordFailure("render_failure", buffer);
    if (eventCallback) eventCallback(OutputBackendEvent::RenderError, buffer);
  }

  void recordRenderFailureFromRenderThread(HRESULT hr, const char* message) {
    char buffer[160] = {};
    std::snprintf(buffer, sizeof(buffer), "%s (错误码 0x%08lx)", message, static_cast<unsigned long>(hr));

    std::unique_lock lock(infoMutex, std::try_to_lock);
    if (!lock.owns_lock()) return;

    diagnostics.lastError = buffer;
    if (wasapi::isDeviceInvalidated(hr)) {
      ++diagnostics.deviceLostCount;
      outputInfo.perfectReasonCode = "device_lost";
    } else {
      ++diagnostics.sessionBufferDropCount;
      ++diagnostics.lifetimeBufferDropCount;
      outputInfo.perfectReasonCode = "render_failure";
    }
    outputInfo.capabilityReason = buffer;
    outputInfo.perfectReason = buffer;
    outputInfo.diagnostics = diagnostics;
  }

  void recordRenderUnderrun() {
    std::unique_lock lock(infoMutex, std::try_to_lock);
    if (!lock.owns_lock()) return;
    ++diagnostics.sessionUnderrunCount;
    ++diagnostics.lifetimeUnderrunCount;
    outputInfo.diagnostics = diagnostics;
  }

  void refreshLatencyTelemetry() {
    REFERENCE_TIME streamLatency = 0;
    if (FAILED(audioClient->GetStreamLatency(&streamLatency))) return;

    const double bufferLatencyMs = renderBufferLatencyMs.load();
    const double streamLatencyMs = referenceTimeToMilliseconds(streamLatency);
    std::unique_lock lock(infoMutex, std::try_to_lock);
    if (!lock.owns_lock()) return;
    outputInfo.latencyInfo.outputLatencyMs = std::max(0.0, streamLatencyMs - bufferLatencyMs);
    outputInfo.latencyInfo.totalLatencyMs = bufferLatencyMs + outputInfo.latencyInfo.outputLatencyMs;
    outputInfo.latencyMs = outputInfo.latencyInfo.totalLatencyMs;
  }

  void renderLoop() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    DWORD taskIndex = 0;
    HANDLE mmcssHandle = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);

    auto lastWakeTime = std::chrono::high_resolution_clock::now();
    auto lastLatencyQueryTime = lastWakeTime;

    const double initialBufferLatencyMs = renderBufferLatencyMs.load();
    const double sleepMsDouble = initialBufferLatencyMs > 0 ? initialBufferLatencyMs * 0.5 : 5.0;
    const DWORD sleepMs = std::max<DWORD>(1, static_cast<DWORD>(sleepMsDouble));

    while (running.load()) {
      if (outputConfig.wasapiExclusivePushMode) {
        std::this_thread::sleep_for(std::chrono::milliseconds(sleepMs));
        if (!running.load()) break;
      } else {
        const DWORD waitResult = WaitForSingleObject(samplesReadyEvent.get(), 2000);
        if (!running.load()) break;
        if (waitResult != WAIT_OBJECT_0) {
          if (waitResult == WAIT_TIMEOUT) {
             recordRenderUnderrun();
          }
          continue;
        }
      }

      auto now = std::chrono::high_resolution_clock::now();
      double elapsedMs = std::chrono::duration<double, std::milli>(now - lastWakeTime).count();
      lastWakeTime = now;

      // In exclusive mode, the expected wakeup interval is roughly bufferLatencyMs.
      // If we wake up much later than expected, we missed a deadline.
      const double bufferLatencyMs = renderBufferLatencyMs.load();
      if (!outputConfig.wasapiExclusivePushMode && bufferLatencyMs > 0 && elapsedMs > bufferLatencyMs * 1.5) {
        recordRenderUnderrun();
      }

      if (std::chrono::duration<double, std::milli>(now - lastLatencyQueryTime).count() > 1000.0) {
        lastLatencyQueryTime = now;
        refreshLatencyTelemetry();
      }

      UINT32 padding = 0;
      HRESULT hr = audioClient->GetCurrentPadding(&padding);
      if (FAILED(hr)) {
        if (!handleRenderFailure(hr, "无法读取独占输出缓冲状态")) break;
        continue;
      }

      const UINT32 framesAvailable =
          wasapi::exclusiveRenderFrames(bufferFrameCount, padding, outputConfig.wasapiExclusivePushMode);
      if (framesAvailable == 0) continue;
      const HRESULT renderHr = renderPacket(framesAvailable);
      if (FAILED(renderHr)) {
        if (!handleRenderFailure(renderHr, "独占输出渲染失败")) break;
        continue;
      }
    }

    if (mmcssHandle) AvRevertMmThreadCharacteristics(mmcssHandle);
    CoUninitialize();

    if (recoveryQueued.load() && !stopRequested.load()) {
      startQueuedRecoveryAfterRenderExit(queuedRecoveryReason);
      return;
    }

    if (renderErrorEventQueued.exchange(false) && eventCallback) {
      char buffer[160] = {};
      const char* message = queuedRenderFailureMessage ? queuedRenderFailureMessage : "独占输出渲染失败";
      std::snprintf(
          buffer,
          sizeof(buffer),
          "%s (错误码 0x%08lx)",
          message,
          static_cast<unsigned long>(queuedRenderFailureHr.load()));
      eventCallback(OutputBackendEvent::RenderError, buffer);
    }
    if (deviceInvalidatedEventQueued.exchange(false) && eventCallback) {
      eventCallback(OutputBackendEvent::DeviceInvalidated, "输出设备已失效");
    }
  }

  void launchRenderThread() {
    std::lock_guard lock(threadMutex);
    renderThread = std::thread([this] { renderLoop(); });
  }

  bool startWithCallbacks(
      RenderCallback nextCallback,
      TypedRenderCallback nextTypedCallback,
      OutputEventCallback nextEventCallback,
      std::string* error) {
    if (!audioClient || !renderClient) {
      recordFailure("backend_start_failure", "独占输出后端尚未打开", error);
      return false;
    }
    if (running.load()) {
      recordFailure("backend_start_failure", "独占输出后端已经在运行", error);
      return false;
    }

    callback = std::move(nextCallback);
    typedCallback = std::move(nextTypedCallback);
    eventCallback = std::move(nextEventCallback);
    stopRequested = false;

    if (FAILED(renderPacket(wasapi::exclusiveInitialRenderFrames(
            bufferFrameCount,
            outputConfig.wasapiExclusivePushMode)))) {
      if (error) *error = diagnostics.lastError.empty() ? "无法预填充独占输出缓冲区" : diagnostics.lastError;
      return false;
    }

    if (!outputConfig.wasapiExclusivePushMode) {
      running = true;
      launchRenderThread();
    }

    HRESULT hr = audioClient->Start();
    if (!wasapi::succeeded(hr, error, "无法启动独占输出音频流")) {
      if (wasapi::isDeviceInvalidated(hr)) ++diagnostics.deviceLostCount;
      recordFailure(
          wasapi::isDeviceInvalidated(hr) ? "device_lost" : "backend_start_failure",
          "无法启动独占输出音频流 (错误码 " + hresultSuffix(hr) + ")",
          error);
      stop();
      return false;
    }

    if (outputConfig.wasapiExclusivePushMode) {
      running = true;
      launchRenderThread();
    }

    return true;
  }

  void joinRenderThread() {
    std::thread threadToJoin;
    {
      std::lock_guard lock(threadMutex);
      if (renderThread.joinable() && renderThread.get_id() != std::this_thread::get_id()) {
        threadToJoin = std::move(renderThread);
      }
    }
    if (threadToJoin.joinable()) threadToJoin.join();
  }

  void joinRecoveryThread() {
    std::thread threadToJoin;
    {
      std::lock_guard lock(threadMutex);
      if (recoveryThread.joinable() && recoveryThread.get_id() != std::this_thread::get_id()) {
        threadToJoin = std::move(recoveryThread);
      }
    }
    if (threadToJoin.joinable()) threadToJoin.join();
  }

  void stop() {
    stopRequested = true;
    running = false;
    if (samplesReadyEvent) SetEvent(samplesReadyEvent.get());
    joinRenderThread();
    joinRecoveryThread();
    if (audioClient) {
      audioClient->Stop();
      audioClient->Reset();
    }
  }

  void close() {
    stop();
    renderClient.Reset();
    audioClient.Reset();
    device.Reset();
    samplesReadyEvent.reset();
    bufferFrameCount = 0;
    bufferDuration = 0;
    renderBufferLatencyMs.store(0.0);
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

  // ── 自动恢复：重新打开设备 ──
  bool reopenDevice() {
    if (audioClient) {
      audioClient->Stop();
      audioClient->Reset();
    }
    renderClient.Reset();
    audioClient.Reset();
    samplesReadyEvent.reset();

    // 重新枚举设备（设备可能已变化/被拔出后重新插入）
    Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator;
    HRESULT hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
    if (FAILED(hr)) return false;

    device.Reset();
    if (wasapi::isDefaultDeviceAlias(openDeviceId)) {
      hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
    } else {
      const std::wstring id = wasapi::utf8ToWide(openDeviceId);
      hr = enumerator->GetDevice(id.c_str(), &device);
    }
    if (FAILED(hr)) return false;

    loadDeviceName();
    if (!activateAudioClient(nullptr)) return false;
    if (!configureStream(openRequestedFormat, nullptr)) return false;
    if (!attachEventAndRenderClient(nullptr)) return false;
    return true;
  }

  void recordRecoverySuccess() {
    std::lock_guard lock(infoMutex);
    ++recoveryCount;
    ++diagnostics.sessionRecoveryCount;
    ++diagnostics.lifetimeRecoveryCount;
    outputInfo.deviceRecovered = true;
    outputInfo.recoveryCount = static_cast<int>(recoveryCount);
    outputInfo.diagnostics = diagnostics;
  }

  // ── 自动恢复：带退避/限流的重试 ──
  bool attemptRecovery(const std::string& reason) {
    static constexpr int kMaxAttempts = 3;
    static constexpr int kBackoffMs[] = {500, 1000, 2000};
    static constexpr auto kRecoveryWindow = std::chrono::seconds(10);
    static constexpr auto kRecoveryCooldown = std::chrono::seconds(10);

    const auto now = std::chrono::steady_clock::now();

    // 清理过期的窗口记录
    while (!recoveryWindow.empty() && now - recoveryWindow.front() > kRecoveryWindow) {
      recoveryWindow.pop_front();
    }

    // 已有恢复在进行中
    if (recoveryInProgress.load()) return false;

    // 冷却期内不恢复
    if (now < recoveryCooldownUntil) return false;

    // 窗口内恢复次数超限 → 进入冷却
    if (recoveryWindow.size() >= static_cast<size_t>(kMaxAttempts)) {
      recoveryCooldownUntil = now + kRecoveryCooldown;
      return false;
    }

    recoveryWindow.push_back(now);
    recoveryInProgress = true;
    recoveryAttempts = 0;

    for (int attempt = 0; attempt < kMaxAttempts; ++attempt) {
      recoveryAttempts = attempt;
      std::this_thread::sleep_for(std::chrono::milliseconds(kBackoffMs[attempt]));

      if (stopRequested.load()) {
        recoveryInProgress = false;
        return false;
      }
      if (!reopenDevice()) continue;
      if (stopRequested.load()) {
        recoveryInProgress = false;
        return false;
      }

      // 恢复成功：预填充缓冲并启动
      const UINT32 initialFrames = wasapi::exclusiveInitialRenderFrames(
          bufferFrameCount, outputConfig.wasapiExclusivePushMode);
      if (FAILED(renderPacket(initialFrames))) continue;

      HRESULT startHr = audioClient->Start();
      if (FAILED(startHr)) continue;

      // 成功
      recoveryInProgress = false;
      recoveryAttempts = 0;
      recordRecoverySuccess();
      return true;
    }

    // 全部失败
    recoveryInProgress = false;
    recoveryAttempts = kMaxAttempts;
    return false;
  }

  void runQueuedRecovery(std::string reason) {
    joinRenderThread();
    if (stopRequested.load()) {
      recoveryQueued = false;
      return;
    }

    const bool recovered = attemptRecovery(reason);
    if (recovered && !stopRequested.load()) {
      running = true;
      launchRenderThread();
    } else if (!recovered && !stopRequested.load() && eventCallback) {
      eventCallback(OutputBackendEvent::DeviceInvalidated, "输出设备已失效");
    }
    recoveryQueued = false;
    queuedRecoveryReason = nullptr;
  }

  void startQueuedRecoveryAfterRenderExit(const char* reason) {
    joinRecoveryThread();
    const char* fallbackReason = reason ? reason : "输出设备已失效";
    {
      std::lock_guard lock(threadMutex);
      recoveryThread = std::thread([this, recoveryReason = std::string(fallbackReason)] {
        runQueuedRecovery(recoveryReason);
      });
    }
  }

  bool queueRecoveryFromRenderThread(const char* reason) {
    bool expected = false;
    if (!recoveryQueued.compare_exchange_strong(expected, true)) return false;

    running = false;
    queuedRecoveryReason = reason;
    if (samplesReadyEvent) SetEvent(samplesReadyEvent.get());
    return true;
  }

  // ── 统一渲染失败处理：记录 + 恢复 + 通知 ──
  // 返回 true = 已恢复可以继续渲染；false = 需退出渲染循环
  bool handleRenderFailure(HRESULT hr, const char* message) {
    const bool devInvalidated = wasapi::isDeviceInvalidated(hr);
    recordRenderFailureFromRenderThread(hr, message);
    if (!devInvalidated) {
      queuedRenderFailureMessage = message;
      queuedRenderFailureHr.store(hr);
      renderErrorEventQueued.store(true);
      running = false;
      if (samplesReadyEvent) SetEvent(samplesReadyEvent.get());
      return false;
    }
    if (queueRecoveryFromRenderThread(message)) return false;
    deviceInvalidatedEventQueued.store(true);
    return false;
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
    impl_->close();
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

  // 保存恢复所需的上下文
  impl_->openDeviceId = deviceId;
  impl_->openRequestedFormat = requestedFormat;
  impl_->recoveryInProgress = false;
  impl_->recoveryQueued = false;
  impl_->recoveryAttempts = 0;
  impl_->recoveryCount = 0;
  impl_->recoveryWindow.clear();
  impl_->recoveryCooldownUntil = {};
  impl_->queuedRecoveryReason = nullptr;
  impl_->queuedRenderFailureMessage = nullptr;
  impl_->queuedRenderFailureHr.store(S_OK);
  impl_->renderErrorEventQueued.store(false);
  impl_->deviceInvalidatedEventQueued.store(false);

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
  return impl_->startWithCallbacks(std::move(callback), nullptr, std::move(eventCallback), error);
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
  return impl_->startWithCallbacks(std::move(fallbackCallback), std::move(callback), std::move(eventCallback), error);
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
