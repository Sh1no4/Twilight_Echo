#include "AlsaBackend.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
#include <alsa/asoundlib.h>
#endif

namespace twilight::audio {
namespace {

float clampSample(float sample) {
  return std::clamp(sample, -1.0f, 1.0f);
}

int32_t floatToInt24(float sample) {
  const float clamped = clampSample(sample);
  if (clamped <= -1.0f) return -8388608;
  return static_cast<int32_t>(std::lrint(static_cast<double>(clamped) * 8388607.0));
}

int16_t floatToInt16(float sample) {
  const float clamped = clampSample(sample);
  if (clamped <= -1.0f) return -32768;
  return static_cast<int16_t>(std::lrint(static_cast<double>(clamped) * 32767.0));
}

int32_t floatToInt32(float sample) {
  const float clamped = clampSample(sample);
  if (clamped <= -1.0f) return -2147483647 - 1;
  return static_cast<int32_t>(std::lrint(static_cast<double>(clamped) * 2147483647.0));
}

void writeLe16(uint8_t* out, int16_t value) {
  const auto raw = static_cast<uint16_t>(value);
  out[0] = static_cast<uint8_t>(raw & 0xffu);
  out[1] = static_cast<uint8_t>((raw >> 8) & 0xffu);
}

void writeLe24(uint8_t* out, int32_t value) {
  const auto raw = static_cast<uint32_t>(value);
  out[0] = static_cast<uint8_t>(raw & 0xffu);
  out[1] = static_cast<uint8_t>((raw >> 8) & 0xffu);
  out[2] = static_cast<uint8_t>((raw >> 16) & 0xffu);
}

void writeLe32(uint8_t* out, int32_t value) {
  const auto raw = static_cast<uint32_t>(value);
  out[0] = static_cast<uint8_t>(raw & 0xffu);
  out[1] = static_cast<uint8_t>((raw >> 8) & 0xffu);
  out[2] = static_cast<uint8_t>((raw >> 16) & 0xffu);
  out[3] = static_cast<uint8_t>((raw >> 24) & 0xffu);
}

bool exactFormatMatch(const AudioFormat& requested, const AudioFormat& actual) {
  return requested.sampleRate == actual.sampleRate && requested.channelCount == actual.channelCount &&
         effectivePcmBitDepth(requested) == effectivePcmBitDepth(actual) &&
         requested.sampleFormat == actual.sampleFormat;
}

bool startsWith(const std::string& value, const char* prefix) {
  return value.rfind(prefix, 0) == 0;
}

std::string formatDescription(const AudioFormat& format) {
  return sampleFormatToString(format.sampleFormat) + " " + std::to_string(effectivePcmBitDepth(format)) + "bit " +
         std::to_string(format.sampleRate) + "Hz " + std::to_string(format.channelCount) + "ch";
}

AudioFormat dopCandidateForRequestedFormat(const AudioFormat& requestedFormat) {
  if (isDopCarrierFormat(requestedFormat)) return requestedFormat;

  AudioFormat candidate;
  candidate.channelCount = requestedFormat.channelCount;
  candidate.bitDepth = 24;
  candidate.sampleFormat = AudioSampleFormat::Int24Interleaved;
  switch (requestedFormat.sampleRate) {
    case 2822400:
      candidate.sampleRate = 176400;
      return candidate;
    case 5644800:
      candidate.sampleRate = 352800;
      return candidate;
    default:
      return {};
  }
}

DopRuntimeFacts unprovenDopRuntimeFacts(
    const AudioFormat& requestedFormat,
    const AudioFormat& actualFormat,
    const std::string& reason) {
  DopRuntimeFacts facts;
  const AudioFormat candidateFormat = dopCandidateForRequestedFormat(requestedFormat);
  const bool dopLikeRequest = requestedFormat.sampleRate >= 2500000 || isDopCarrierFormat(requestedFormat);
  if (!dopLikeRequest && !isDopCarrierFormat(actualFormat)) return facts;

  facts.state = DopRuntimeFactState::Unproven;
  facts.candidateFormat = candidateFormat;
  facts.actualFormat = isDopCarrierFormat(actualFormat) ? actualFormat : AudioFormat{};
  facts.reason = reason;
  return facts;
}

}  // namespace

struct AlsaBackend::Impl {
  mutable std::mutex mutex;
  RenderCallback callback;
  OutputEventCallback eventCallback;
  OutputConfig outputConfig;
  AudioFormat outputFormat;
  OutputInfo outputInfo;
  DopRuntimeFacts dopRuntimeFacts;
  OutputInfo::Diagnostics diagnostics;
  std::string deviceId = "default";
  std::string deviceName = "ALSA default";
  std::atomic<bool> running{false};
  std::thread renderThread;
  std::vector<float> renderScratch;
  std::vector<uint8_t> packedScratch;

#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  snd_pcm_t* pcm = nullptr;
  snd_pcm_format_t pcmFormat = SND_PCM_FORMAT_FLOAT_LE;
  snd_pcm_uframes_t periodSize = 512;
  snd_pcm_uframes_t bufferSize = 2048;
  size_t bytesPerFrame = 0;

  struct FormatCandidate {
    snd_pcm_format_t alsaFormat;
    AudioSampleFormat sampleFormat;
    int bitDepth;
    const char* label;
  };

  static std::string alsaError(const char* context, int code) {
    return std::string(context) + ": " + snd_strerror(code);
  }

  static std::string normalizeDeviceId(const std::string& requested) {
    if (requested.empty() || requested == "auto") return "default";
    if (requested.rfind("alsa:", 0) == 0) return requested.substr(5);
    return requested;
  }

  static bool isDirectHwDevice(const std::string& id) {
    return startsWith(id, "hw:");
  }

  static bool isPlugHwDevice(const std::string& id) {
    return startsWith(id, "plughw:");
  }

  static std::string pluginPathReason(const std::string& id) {
    if (id == "default") {
      return "ALSA default 可能经过 dmix/plug 插件链，无法证明硬件直通";
    }
    if (isPlugHwDevice(id)) {
      return "ALSA plughw: 可能自动转换采样率、位深或声道，无法证明硬件直通";
    }
    if (id == "null") {
      return "ALSA null 是测试输出设备，不是硬件直通路径";
    }
    return "ALSA 输出未使用 hw: 直连设备，可能经过插件链或格式转换";
  }

  static std::string formatMismatchReason(const AudioFormat& requested, const AudioFormat& actual) {
    return "ALSA hw: 实际输出格式与请求格式不完全匹配: requested " + formatDescription(requested) +
           ", actual " + formatDescription(actual);
  }

  static std::vector<FormatCandidate> candidatesFor(const AudioFormat& requested) {
    const int bitDepth = effectivePcmBitDepth(requested);
    std::vector<FormatCandidate> candidates;
    auto add = [&](snd_pcm_format_t alsa, AudioSampleFormat format, int depth, const char* label) {
      const auto duplicate = std::find_if(candidates.begin(), candidates.end(), [&](const FormatCandidate& item) {
        return item.alsaFormat == alsa;
      });
      if (duplicate == candidates.end()) candidates.push_back(FormatCandidate{alsa, format, depth, label});
    };

    if (requested.sampleFormat == AudioSampleFormat::Float32Interleaved || bitDepth >= 32) {
      add(SND_PCM_FORMAT_FLOAT_LE, AudioSampleFormat::Float32Interleaved, 32, "float32");
      add(SND_PCM_FORMAT_S32_LE, AudioSampleFormat::Int32Interleaved, 32, "s32");
    }
    if (bitDepth == 24) {
      add(SND_PCM_FORMAT_S24_3LE, AudioSampleFormat::Int24Interleaved, 24, "s24_3le");
      add(SND_PCM_FORMAT_S24_LE, AudioSampleFormat::Int24In32Interleaved, 24, "s24_le");
    }
    if (bitDepth <= 16) {
      add(SND_PCM_FORMAT_S16_LE, AudioSampleFormat::Int16Interleaved, 16, "s16");
    }

    add(SND_PCM_FORMAT_FLOAT_LE, AudioSampleFormat::Float32Interleaved, 32, "float32");
    add(SND_PCM_FORMAT_S32_LE, AudioSampleFormat::Int32Interleaved, 32, "s32");
    add(SND_PCM_FORMAT_S24_3LE, AudioSampleFormat::Int24Interleaved, 24, "s24_3le");
    add(SND_PCM_FORMAT_S24_LE, AudioSampleFormat::Int24In32Interleaved, 24, "s24_le");
    add(SND_PCM_FORMAT_S16_LE, AudioSampleFormat::Int16Interleaved, 16, "s16");
    return candidates;
  }

  static size_t bytesPerSample(AudioSampleFormat format) {
    switch (format) {
      case AudioSampleFormat::Int16Interleaved:
        return 2;
      case AudioSampleFormat::Int24Interleaved:
        return 3;
      case AudioSampleFormat::Int24In32Interleaved:
      case AudioSampleFormat::Int32Interleaved:
      case AudioSampleFormat::Float32Interleaved:
      default:
        return 4;
    }
  }

  void pack(const float* input, size_t frames, int channels) {
    const size_t bytesPerSampleValue = bytesPerSample(outputFormat.sampleFormat);
    bytesPerFrame = bytesPerSampleValue * static_cast<size_t>(channels);
    packedScratch.assign(frames * bytesPerFrame, 0);

    for (size_t frame = 0; frame < frames; ++frame) {
      for (int channel = 0; channel < channels; ++channel) {
        const float sample = input[frame * static_cast<size_t>(channels) + static_cast<size_t>(channel)];
        uint8_t* out = packedScratch.data() + frame * bytesPerFrame + static_cast<size_t>(channel) * bytesPerSampleValue;
        switch (outputFormat.sampleFormat) {
          case AudioSampleFormat::Float32Interleaved: {
            const float clamped = clampSample(sample);
            std::memcpy(out, &clamped, sizeof(clamped));
            break;
          }
          case AudioSampleFormat::Int16Interleaved:
            writeLe16(out, floatToInt16(sample));
            break;
          case AudioSampleFormat::Int24Interleaved:
            writeLe24(out, floatToInt24(sample));
            break;
          case AudioSampleFormat::Int24In32Interleaved:
            writeLe32(out, floatToInt24(sample) << 8);
            break;
          case AudioSampleFormat::Int32Interleaved:
          default:
            writeLe32(out, floatToInt32(sample));
            break;
        }
      }
    }
  }

  void recordXrun(const std::string& message) {
    std::lock_guard lock(mutex);
    ++diagnostics.sessionUnderrunCount;
    ++diagnostics.lifetimeUnderrunCount;
    ++diagnostics.sessionRecoveryCount;
    ++diagnostics.lifetimeRecoveryCount;
    diagnostics.lastError = message;
    outputInfo.diagnostics = diagnostics;
    outputInfo.deviceRecovered = true;
    outputInfo.recoveryCount = static_cast<int>(diagnostics.sessionRecoveryCount);
  }

  bool recoverFromWriteError(int code) {
    if (!pcm) return false;
    if (code == -EPIPE) {
      recordXrun("ALSA xrun recovered with snd_pcm_prepare");
      return snd_pcm_prepare(pcm) >= 0;
    }
    if (code == -ESTRPIPE) {
      while (running.load()) {
        const int resume = snd_pcm_resume(pcm);
        if (resume == 0) return true;
        if (resume != -EAGAIN) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
      }
      recordXrun("ALSA suspend recovered with snd_pcm_prepare");
      return snd_pcm_prepare(pcm) >= 0;
    }
    std::lock_guard lock(mutex);
    diagnostics.lastError = alsaError("ALSA write failed", code);
    outputInfo.diagnostics = diagnostics;
    return false;
  }

  void renderLoop() {
    while (running.load()) {
      RenderCallback renderCallback;
      int channels = 0;
      snd_pcm_uframes_t frames = 0;
      {
        std::lock_guard lock(mutex);
        renderCallback = callback;
        channels = std::max(1, outputFormat.channelCount);
        frames = std::max<snd_pcm_uframes_t>(1, periodSize);
      }

      const size_t frameCount = static_cast<size_t>(frames);
      renderScratch.assign(frameCount * static_cast<size_t>(channels), 0.0f);
      if (renderCallback) {
        const size_t rendered = std::min(renderCallback(renderScratch.data(), frameCount), frameCount);
        if (rendered < frameCount) {
          std::fill(
              renderScratch.begin() + static_cast<std::ptrdiff_t>(rendered * static_cast<size_t>(channels)),
              renderScratch.end(),
              0.0f);
        }
      }
      pack(renderScratch.data(), frameCount, channels);

      snd_pcm_sframes_t offset = 0;
      while (running.load() && offset < static_cast<snd_pcm_sframes_t>(frames)) {
        const auto remaining = static_cast<snd_pcm_uframes_t>(static_cast<snd_pcm_sframes_t>(frames) - offset);
        const auto byteOffset = static_cast<size_t>(offset) * bytesPerFrame;
        const snd_pcm_sframes_t written = snd_pcm_writei(pcm, packedScratch.data() + byteOffset, remaining);
        if (written > 0) {
          offset += written;
          continue;
        }
        if (!recoverFromWriteError(static_cast<int>(written))) {
          OutputEventCallback failureCallback;
          {
            std::lock_guard lock(mutex);
            failureCallback = eventCallback;
          }
          running = false;
          if (failureCallback) failureCallback(OutputBackendEvent::RenderError, "ALSA 输出写入失败");
          break;
        }
      }
    }
  }
#endif

  void resetSessionState() {
    OutputInfo::Diagnostics lifetime = diagnostics;
    diagnostics = {};
    diagnostics.lifetimeUnderrunCount = lifetime.lifetimeUnderrunCount;
    diagnostics.lifetimeBufferDropCount = lifetime.lifetimeBufferDropCount;
    diagnostics.lifetimeRecoveryCount = lifetime.lifetimeRecoveryCount;
    diagnostics.driverRestartCount = lifetime.driverRestartCount;
    diagnostics.deviceLostCount = lifetime.deviceLostCount;
    outputFormat = {};
    outputInfo = {};
    dopRuntimeFacts = {};
    deviceId = "default";
    deviceName = "ALSA default";
  }
};

AlsaBackend::AlsaBackend() : impl_(std::make_unique<Impl>()) {}

AlsaBackend::~AlsaBackend() {
  close();
}

const char* AlsaBackend::id() const {
  return "alsa";
}

bool AlsaBackend::open(const std::string& deviceId, const AudioFormat& requestedFormat, std::string* error) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  close();
  impl_->resetSessionState();

  if (requestedFormat.sampleRate <= 0 || requestedFormat.channelCount <= 0) {
    if (error) *error = "请求的 ALSA 输出格式无效";
    return false;
  }

  impl_->deviceId = Impl::normalizeDeviceId(deviceId);
  impl_->deviceName = "ALSA " + impl_->deviceId;

  int code = snd_pcm_open(&impl_->pcm, impl_->deviceId.c_str(), SND_PCM_STREAM_PLAYBACK, 0);
  if (code < 0) {
    if (error) *error = Impl::alsaError("无法打开 ALSA PCM 输出", code);
    impl_->diagnostics.lastError = error ? *error : "无法打开 ALSA PCM 输出";
    return false;
  }

  snd_pcm_hw_params_t* hw = nullptr;
  snd_pcm_hw_params_alloca(&hw);
  code = snd_pcm_hw_params_any(impl_->pcm, hw);
  if (code < 0) {
    if (error) *error = Impl::alsaError("无法读取 ALSA hw params", code);
    close();
    return false;
  }

  code = snd_pcm_hw_params_set_access(impl_->pcm, hw, SND_PCM_ACCESS_RW_INTERLEAVED);
  if (code < 0) {
    if (error) *error = Impl::alsaError("ALSA 设备不支持 interleaved PCM", code);
    close();
    return false;
  }

  const auto candidates = Impl::candidatesFor(requestedFormat);
  const Impl::FormatCandidate* selected = nullptr;
  for (const auto& candidate : candidates) {
    if (snd_pcm_hw_params_test_format(impl_->pcm, hw, candidate.alsaFormat) == 0) {
      selected = &candidate;
      break;
    }
  }
  if (!selected) {
    if (error) *error = "ALSA 设备没有可用的 PCM 输出格式";
    close();
    return false;
  }

  code = snd_pcm_hw_params_set_format(impl_->pcm, hw, selected->alsaFormat);
  if (code < 0) {
    if (error) *error = Impl::alsaError("无法设置 ALSA PCM 格式", code);
    close();
    return false;
  }

  unsigned int rate = static_cast<unsigned int>(requestedFormat.sampleRate);
  int dir = 0;
  code = snd_pcm_hw_params_set_rate_near(impl_->pcm, hw, &rate, &dir);
  if (code < 0 || rate == 0) {
    if (error) *error = Impl::alsaError("无法协商 ALSA 采样率", code);
    close();
    return false;
  }

  unsigned int channels = static_cast<unsigned int>(requestedFormat.channelCount);
  code = snd_pcm_hw_params_set_channels_near(impl_->pcm, hw, &channels);
  if (code < 0 || channels == 0) {
    if (error) *error = Impl::alsaError("无法协商 ALSA 声道数", code);
    close();
    return false;
  }

  snd_pcm_uframes_t period = impl_->outputConfig.preferredBufferSize > 0 ? impl_->outputConfig.preferredBufferSize : 512;
  dir = 0;
  snd_pcm_hw_params_set_period_size_near(impl_->pcm, hw, &period, &dir);
  snd_pcm_uframes_t buffer = std::max<snd_pcm_uframes_t>(period * 4, period + 1);
  snd_pcm_hw_params_set_buffer_size_near(impl_->pcm, hw, &buffer);

  code = snd_pcm_hw_params(impl_->pcm, hw);
  if (code < 0) {
    if (error) *error = Impl::alsaError("无法应用 ALSA hw params", code);
    close();
    return false;
  }

  snd_pcm_hw_params_get_rate(hw, &rate, &dir);
  snd_pcm_hw_params_get_channels(hw, &channels);
  snd_pcm_hw_params_get_period_size(hw, &period, &dir);
  snd_pcm_hw_params_get_buffer_size(hw, &buffer);
  impl_->periodSize = std::max<snd_pcm_uframes_t>(1, period);
  impl_->bufferSize = std::max<snd_pcm_uframes_t>(impl_->periodSize, buffer);
  impl_->pcmFormat = selected->alsaFormat;
  impl_->outputFormat.sampleRate = static_cast<int>(rate);
  impl_->outputFormat.channelCount = static_cast<int>(channels);
  impl_->outputFormat.bitDepth = selected->bitDepth;
  impl_->outputFormat.sampleFormat = selected->sampleFormat;
  impl_->bytesPerFrame =
      Impl::bytesPerSample(impl_->outputFormat.sampleFormat) * static_cast<size_t>(impl_->outputFormat.channelCount);

  snd_pcm_sw_params_t* sw = nullptr;
  snd_pcm_sw_params_alloca(&sw);
  if (snd_pcm_sw_params_current(impl_->pcm, sw) == 0) {
    snd_pcm_sw_params_set_avail_min(impl_->pcm, sw, impl_->periodSize);
    snd_pcm_sw_params_set_start_threshold(impl_->pcm, sw, impl_->periodSize);
    snd_pcm_sw_params(impl_->pcm, sw);
  }

  const bool directHw = Impl::isDirectHwDevice(impl_->deviceId);
  const bool formatMatched = exactFormatMatch(requestedFormat, impl_->outputFormat);
  const bool supportsOutputPerfect = directHw && formatMatched;
  const double sampleRate = impl_->outputFormat.sampleRate > 0 ? static_cast<double>(impl_->outputFormat.sampleRate) : 0.0;

  impl_->outputInfo = {};
  impl_->outputInfo.exclusive = directHw;
  impl_->outputInfo.accessMode = directHw ? "direct" : "plugin";
  impl_->outputInfo.supportsOutputPerfect = supportsOutputPerfect;
  impl_->outputInfo.sourceExact = false;
  impl_->outputInfo.outputPerfect = false;
  impl_->outputInfo.pcmPassthrough = false;
  impl_->outputInfo.resampled = !formatMatched;
  impl_->outputInfo.outputSampleRate = impl_->outputFormat.sampleRate;
  impl_->outputInfo.outputBitDepth = impl_->outputFormat.bitDepth;
  impl_->outputInfo.backend = "alsa";
  impl_->outputInfo.actualBackend = "alsa";
  impl_->outputInfo.devicePathKind =
      directHw ? "hw" : (impl_->deviceId.rfind("plughw:", 0) == 0 ? "plughw" : "default");
  impl_->outputInfo.deviceName = impl_->deviceName;
  impl_->outputInfo.actualDeviceName = impl_->deviceName;
  impl_->outputInfo.actualOutputFormat = sampleFormatToString(impl_->outputFormat.sampleFormat);
  impl_->outputInfo.actualSampleRate = impl_->outputFormat.sampleRate;
  impl_->outputInfo.actualBitDepth = impl_->outputFormat.bitDepth;
  impl_->outputInfo.actualChannels = impl_->outputFormat.channelCount;
  impl_->outputInfo.bufferSizeFrames = static_cast<int>(impl_->bufferSize);
  impl_->outputInfo.latencyFrames = static_cast<int>(impl_->bufferSize);
  impl_->outputInfo.latencyMs =
      sampleRate > 0.0 ? static_cast<double>(impl_->bufferSize) * 1000.0 / sampleRate : 0.0;
  impl_->outputInfo.latencyInfo.bufferLatencyMs =
      sampleRate > 0.0 ? static_cast<double>(impl_->periodSize) * 1000.0 / sampleRate : 0.0;
  impl_->outputInfo.latencyInfo.outputLatencyMs =
      sampleRate > 0.0
          ? static_cast<double>(impl_->bufferSize > impl_->periodSize ? impl_->bufferSize - impl_->periodSize : 0) *
                1000.0 / sampleRate
          : 0.0;
  impl_->outputInfo.latencyInfo.totalLatencyMs = impl_->outputInfo.latencyMs;
  impl_->outputInfo.channelRoutingMode = channelRoutingModeToString(impl_->outputConfig.routingMode);
  impl_->outputInfo.diagnostics = impl_->diagnostics;
  if (!supportsOutputPerfect) {
    impl_->outputInfo.perfectReasonCode = directHw ? "pcm_converted" : "plugin_path";
    impl_->outputInfo.perfectReason =
        directHw ? Impl::formatMismatchReason(requestedFormat, impl_->outputFormat) : Impl::pluginPathReason(impl_->deviceId);
    impl_->outputInfo.capabilityReason = impl_->outputInfo.perfectReason;
  }
  impl_->dopRuntimeFacts = unprovenDopRuntimeFacts(
      requestedFormat,
      impl_->outputFormat,
      directHw ? "ALSA direct path does not provide explicit DoP runtime proof" : Impl::pluginPathReason(impl_->deviceId));

  return true;
#else
  (void)deviceId;
  (void)requestedFormat;
  if (error) *error = "当前构建未启用 ALSA 输出";
  return false;
#endif
}

bool AlsaBackend::setOutputConfig(const OutputConfig& config, std::string* error) {
  (void)error;
  std::lock_guard lock(impl_->mutex);
  impl_->outputConfig = config;
  impl_->outputInfo.channelRoutingMode = channelRoutingModeToString(impl_->outputConfig.routingMode);
  return true;
}

bool AlsaBackend::start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  if (!impl_->pcm) {
    if (error) *error = "ALSA 后端尚未打开";
    return false;
  }
  {
    std::lock_guard lock(impl_->mutex);
    impl_->callback = std::move(callback);
    impl_->eventCallback = std::move(eventCallback);
  }
  const int code = snd_pcm_prepare(impl_->pcm);
  if (code < 0) {
    if (error) *error = Impl::alsaError("无法 prepare ALSA PCM", code);
    return false;
  }
  impl_->running = true;
  impl_->renderThread = std::thread([this] { impl_->renderLoop(); });
  return true;
#else
  (void)callback;
  (void)eventCallback;
  if (error) *error = "当前构建未启用 ALSA 输出";
  return false;
#endif
}

void AlsaBackend::stop() {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  impl_->running = false;
  if (impl_->renderThread.joinable()) impl_->renderThread.join();
  if (impl_->pcm) snd_pcm_drop(impl_->pcm);
#endif
}

void AlsaBackend::close() {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  stop();
  if (impl_->pcm) {
    snd_pcm_close(impl_->pcm);
    impl_->pcm = nullptr;
  }
  {
    std::lock_guard lock(impl_->mutex);
    impl_->callback = nullptr;
    impl_->eventCallback = nullptr;
    impl_->renderScratch.clear();
    impl_->packedScratch.clear();
  }
#endif
}

AudioFormat AlsaBackend::outputFormat() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->outputFormat;
}

OutputInfo AlsaBackend::outputInfo() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->outputInfo;
}

DopRuntimeFacts AlsaBackend::dopRuntimeFacts() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->dopRuntimeFacts;
}

NativeDsdRuntimeFacts AlsaBackend::nativeDsdRuntimeFacts() const {
  return unsupportedNativeDsdRuntimeFacts("ALSA Native DSD output is not implemented in this build");
}

std::string AlsaBackend::deviceName() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->deviceName;
}

bool alsaBackendAvailable() {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return true;
#else
  return false;
#endif
}

}  // namespace twilight::audio
