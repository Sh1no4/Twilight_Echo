#include "AudioPipeline.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <utility>
#include <vector>

namespace twilight::audio {
namespace {

constexpr size_t kDecodeChunkFrames = 2048;
constexpr double kUnityVolumeEpsilon = 0.0001;
AudioPipeline::BackendFactory& backendFactoryOverride() {
  static AudioPipeline::BackendFactory factory;
  return factory;
}

QueueItem makeManualItem(const std::string& source) {
  QueueItem item;
  item.id = source;
  item.source = source;
  item.title = source;
  return item;
}

AudioSampleFormat sampleFormatFromOutputLabel(const std::string& label, AudioSampleFormat fallback) {
  if (label == "int16" || label == "s16" || label == "S16_LE") return AudioSampleFormat::Int16Interleaved;
  if (label == "int24" || label == "s24_3le" || label == "S24_3LE") return AudioSampleFormat::Int24Interleaved;
  if (label == "int24-in32" || label == "s24_le" || label == "S24_LE") {
    return AudioSampleFormat::Int24In32Interleaved;
  }
  if (label == "int32" || label == "s32" || label == "S32_LE") return AudioSampleFormat::Int32Interleaved;
  if (label == "float32" || label == "FLOAT_LE") return AudioSampleFormat::Float32Interleaved;
  return fallback;
}

AudioFormat actualOutputPcmFormat(const AudioFormat& fallback, const OutputInfo& info) {
  AudioFormat format = fallback;
  if (info.actualSampleRate > 0) format.sampleRate = info.actualSampleRate;
  if (info.actualChannels > 0) format.channelCount = info.actualChannels;
  if (info.actualBitDepth > 0) {
    format.bitDepth = info.actualBitDepth;
  } else if (info.outputBitDepth > 0) {
    format.bitDepth = info.outputBitDepth;
  }
  format.sampleFormat = sampleFormatFromOutputLabel(info.actualOutputFormat, fallback.sampleFormat);
  return format;
}

bool backendCanAttemptDop(const std::string& backendId) {
  return backendId == "asio" || backendId == "wasapi-exclusive";
}

bool backendCanTypedPassthrough(const std::string& backendId) {
  return backendId == "asio" || backendId == "wasapi-exclusive";
}

bool formatCanTypedPassthrough(const AudioFormat& format) {
  return format.sampleRate > 0 && format.channelCount > 0 && audioFormatBytesPerFrame(format) > 0;
}

bool sampleFormatCanCarryDop(AudioSampleFormat format) {
  return format == AudioSampleFormat::Int24Interleaved || format == AudioSampleFormat::Int24In32Interleaved;
}

bool formatCanCarryDop(const AudioFormat& format, int dsdRate, int channels) {
  const auto expected = dopCarrierFormatForDsd(dsdRate, channels);
  return expected.has_value() && format.sampleRate == expected->sampleRate &&
         format.channelCount == expected->channelCount && effectivePcmBitDepth(format) == 24 &&
         sampleFormatCanCarryDop(format.sampleFormat);
}

std::string nativeDsdRuntimeStateToString(NativeDsdRuntimeFactState state) {
  switch (state) {
    case NativeDsdRuntimeFactState::Candidate:
      return "candidate";
    case NativeDsdRuntimeFactState::Unproven:
      return "unproven";
    case NativeDsdRuntimeFactState::Mismatch:
      return "mismatch";
    case NativeDsdRuntimeFactState::Proven:
      return "proven";
    case NativeDsdRuntimeFactState::Unsupported:
    default:
      return "unsupported";
  }
}

void applyNativeDsdRuntimeFacts(OutputInfo* info, const NativeDsdRuntimeFacts& facts) {
  if (!info) return;
  info->nativeDsdRuntimeState = nativeDsdRuntimeStateToString(facts.state);
  info->nativeDsdRequestedRate = facts.requestedDsdRate;
  info->nativeDsdActualRate = facts.actualDsdRate;
  info->nativeDsdChannels = facts.channelCount;
  info->nativeDsdExplicitlyCapable = facts.explicitlyCapable;
  info->nativeDsdAdvertisedSampleRates = facts.advertisedSampleRates;
  info->nativeDsdRuntimeReason = facts.reason;
}

int32_t signed24FromBytes(uint8_t low, uint8_t mid, uint8_t high) {
  int32_t value = static_cast<int32_t>(low) | (static_cast<int32_t>(mid) << 8) |
                  (static_cast<int32_t>(high) << 16);
  if ((value & 0x800000) != 0) value |= ~0x00ffffff;
  return value;
}

float signed24ToFloat(int32_t value) {
  return static_cast<float>(std::clamp(static_cast<double>(value) / 8388608.0, -1.0, 1.0));
}

float int16ToFloat(int16_t value) {
  return static_cast<float>(std::clamp(static_cast<double>(value) / 32768.0, -1.0, 1.0));
}

float int32ToFloat(int32_t value) {
  return static_cast<float>(std::clamp(static_cast<double>(value) / 2147483648.0, -1.0, 1.0));
}

void typedPcmToFloat(const PcmBlock& block, float* output, size_t frames) {
  if (!block.data || !output || frames == 0 || block.format.channelCount <= 0) return;
  const int channels = std::max(1, block.format.channelCount);
  const size_t availableFrames = std::min(frames, block.frames);
  const size_t samples = availableFrames * static_cast<size_t>(channels);
  std::fill(output, output + frames * static_cast<size_t>(channels), 0.0f);
  switch (block.format.sampleFormat) {
    case AudioSampleFormat::Int16Interleaved: {
      const auto* input = reinterpret_cast<const int16_t*>(block.data);
      for (size_t i = 0; i < samples; ++i) output[i] = int16ToFloat(input[i]);
      break;
    }
    case AudioSampleFormat::Int24Interleaved: {
      for (size_t i = 0; i < samples; ++i) {
        const size_t offset = i * 3;
        output[i] = signed24ToFloat(signed24FromBytes(block.data[offset], block.data[offset + 1], block.data[offset + 2]));
      }
      break;
    }
    case AudioSampleFormat::Int24In32Interleaved: {
      const auto* input = reinterpret_cast<const int32_t*>(block.data);
      for (size_t i = 0; i < samples; ++i) output[i] = signed24ToFloat(input[i] >> 8);
      break;
    }
    case AudioSampleFormat::Int32Interleaved: {
      const auto* input = reinterpret_cast<const int32_t*>(block.data);
      for (size_t i = 0; i < samples; ++i) output[i] = int32ToFloat(input[i]);
      break;
    }
    case AudioSampleFormat::Float32Interleaved:
    default:
      std::memcpy(output, block.data, samples * sizeof(float));
      break;
  }
}

void dopBytesToFloatCarrier(
    const std::vector<uint8_t>& bytes,
    AudioSampleFormat format,
    float* output,
    size_t sampleCount) {
  if (!output || sampleCount == 0) return;
  const size_t bytesPerSample = format == AudioSampleFormat::Int24In32Interleaved ? 4 : 3;
  const size_t availableSamples = bytes.size() / bytesPerSample;
  const size_t count = std::min(sampleCount, availableSamples);
  for (size_t i = 0; i < count; ++i) {
    const size_t offset = i * bytesPerSample;
    int32_t value = 0;
    if (format == AudioSampleFormat::Int24In32Interleaved) {
      value = signed24FromBytes(bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    } else {
      value = signed24FromBytes(bytes[offset + 0], bytes[offset + 1], bytes[offset + 2]);
    }
    output[i] = signed24ToFloat(value);
  }
  std::fill(output + count, output + sampleCount, 0.0f);
}

DsdBitOrder dsdBitOrderFromInfo(const DsdStreamInfo& info) {
  return info.bitOrder;
}

DsdPacking dsdPackingFromInfo(const DsdStreamInfo& info) {
  return info.packing;
}

AudioStreamInfo streamInfoFromDsd(const QueueItem& item, const DsdStreamInfo& dsd, DsdMode mode) {
  AudioStreamInfo stream;
  stream.source = item.source;
  stream.codec = "dsd";
  stream.durationSeconds = item.durationSeconds > 0.0 ? item.durationSeconds : dsd.durationSeconds;
  stream.sourceFormat.sampleRate = dsd.dsdSampleRate;
  stream.sourceFormat.channelCount = dsd.channelCount;
  stream.sourceFormat.bitDepth = 1;
  stream.sourceFormat.sampleFormat = AudioSampleFormat::Float32Interleaved;
  stream.decodedFormat = stream.sourceFormat;
  stream.sourceLossless = true;
  stream.isDsd = true;
  stream.dsdMode = mode;
  stream.dsdRate = dsd.dsdRate;
  return stream;
}

bool dsdOutputModePrefersPcm(DsdOutputMode mode) {
  return mode == DsdOutputMode::Pcm;
}

bool dsdOutputModeRequestsDop(DsdOutputMode mode) {
  return mode == DsdOutputMode::Auto || mode == DsdOutputMode::Dop;
}

AudioFormat pcmFallbackRequestFormat(
    const AudioStreamInfo& stream,
    const std::optional<DsdStreamInfo>& dsdProbe) {
  AudioFormat requested = stream.decodedFormat;
  requested.channelCount =
      stream.sourceFormat.channelCount > 0 ? stream.sourceFormat.channelCount : std::max(1, requested.channelCount);
  requested.bitDepth = 32;
  requested.sampleFormat = AudioSampleFormat::Float32Interleaved;

  const auto assignRate = [&](int sampleRate) {
    if (sampleRate > 0) requested.sampleRate = sampleRate;
  };

  if (dsdProbe.has_value()) {
    assignRate(dsdProbe->dsdSampleRate / 16);
  } else if (stream.dsdRate > 0 && stream.sourceFormat.sampleRate > 0) {
    assignRate(stream.sourceFormat.sampleRate / 16);
  }

  if (requested.sampleRate <= 0) requested.sampleRate = stream.sourceFormat.sampleRate;
  if (requested.sampleRate <= 0) requested.sampleRate = 176400;
  return requested;
}

}  // namespace

struct AudioPipeline::DecodeStream {
  enum class Mode {
    Pcm,
    Dop
  };

  QueueItem item;
  AudioStreamInfo stream;
  AudioFormat decodeFormat;
  std::unique_ptr<FFmpegDecoder> decoder;
  std::unique_ptr<DsdReader> dsdReader;
  DopPacker dopPacker;
  AudioBuffer buffer;
  std::atomic<bool> running{false};
  std::atomic<bool> eof{false};
  std::thread decodeThread;
  Mode mode = Mode::Pcm;
  bool typedPassthrough = false;

  ~DecodeStream() {
    stop();
  }

  bool openSource(const QueueItem& queueItem, std::string* error) {
    stop();
    dsdReader.reset();
    item = queueItem;
    mode = Mode::Pcm;
    decoder = std::make_unique<FFmpegDecoder>();
    if (!decoder->open(item.source, error)) {
      decoder.reset();
      return false;
    }
    stream = decoder->streamInfo();
    stream.source = item.source;
    if (item.durationSeconds > 0.0) stream.durationSeconds = item.durationSeconds;
    return true;
  }

  bool openDsdSource(const QueueItem& queueItem, std::string* error) {
    stop();
    decoder.reset();
    item = queueItem;
    mode = Mode::Dop;
    dsdReader = std::make_unique<DsdReader>();
    if (!dsdReader->open(item.source, error)) {
      dsdReader.reset();
      return false;
    }
    stream = streamInfoFromDsd(item, dsdReader->streamInfo(), DsdMode::Dop);
    return true;
  }

  bool configure(
      const AudioFormat& outputFormat,
      double startTimeSeconds,
      std::string* error,
      bool useTypedPassthrough = false) {
    if (mode == Mode::Dop) return configureDop(outputFormat, startTimeSeconds, error);
    return configurePcm(outputFormat, startTimeSeconds, error, useTypedPassthrough);
  }

  bool configurePcm(
      const AudioFormat& outputFormat,
      double startTimeSeconds,
      std::string* error,
      bool useTypedPassthrough) {
    if (!decoder) {
      if (error) *error = "解码器尚未打开";
      return false;
    }

    decodeFormat = outputFormat;
    typedPassthrough = useTypedPassthrough;
    if (!typedPassthrough) {
      decodeFormat.bitDepth = 32;
      decodeFormat.sampleFormat = AudioSampleFormat::Float32Interleaved;
    }
    if (!decoder->setOutputFormat(decodeFormat, error)) return false;
    decodeFormat = decoder->outputFormat();
    stream.decodedFormat = decodeFormat;
    if (startTimeSeconds > 0.0 && !decoder->seek(startTimeSeconds, error)) return false;

    eof = false;
    buffer.reset(decodeFormat, static_cast<size_t>(std::max(decodeFormat.sampleRate * 2, 8192)));
    return true;
  }

  bool configureDop(const AudioFormat& outputFormat, double startTimeSeconds, std::string* error) {
    if (!dsdReader) {
      if (error) *error = "DSD reader is not open";
      return false;
    }
    const DsdStreamInfo& dsd = dsdReader->streamInfo();
    if (!formatCanCarryDop(outputFormat, dsd.dsdRate, dsd.channelCount)) {
      if (error) *error = "DoP carrier format mismatch";
      return false;
    }

    DopPackerConfig config;
    config.channelCount = dsd.channelCount;
    config.dsdRate = dsd.dsdRate;
    config.bitOrder = dsdBitOrderFromInfo(dsd);
    config.packing = dsdPackingFromInfo(dsd);
    config.outputFormat = outputFormat.sampleFormat;
    if (!dopPacker.configure(config, error)) return false;
    if (startTimeSeconds > 0.0 && !dsdReader->seek(startTimeSeconds, error)) return false;

    decodeFormat = dopPacker.carrierFormat();
    stream.decodedFormat = decodeFormat;
    stream.dsdMode = DsdMode::Dop;
    typedPassthrough = false;
    eof = false;
    // DoP keeps the existing float carrier ring buffer; typed PCM passthrough is only for ordinary PCM.
    buffer.reset(decodeFormat.channelCount, static_cast<size_t>(std::max(decodeFormat.sampleRate * 2, 8192)));
    return true;
  }

  void start() {
    if ((!decoder && !dsdReader) || running.load()) return;
    running = true;
    decodeThread = std::thread([this] { decodeLoop(); });
  }

  void stop() {
    running = false;
    buffer.notifyAll();
    if (decodeThread.joinable()) decodeThread.join();
  }

  bool seek(double seconds, std::string* error) {
    if (!decoder && !dsdReader) return false;
    stop();
    const bool ok = mode == Mode::Dop ? dsdReader->seek(std::max(0.0, seconds), error)
                                      : decoder->seek(std::max(0.0, seconds), error);
    if (!ok) {
      start();
      return false;
    }
    buffer.clear();
    eof = false;
    start();
    return true;
  }

  size_t read(float* output, size_t frameCount) {
    return buffer.read(output, frameCount);
  }

  size_t readFloat(float* output, size_t frameCount) {
    if (!output || frameCount == 0) return 0;
    const AudioFormat bufferFormat = buffer.format();
    if (bufferFormat.sampleFormat == AudioSampleFormat::Float32Interleaved) {
      return buffer.read(output, frameCount);
    }

    const size_t bytesPerFrame = audioFormatBytesPerFrame(bufferFormat);
    if (bytesPerFrame == 0) return 0;
    std::vector<uint8_t> scratch(frameCount * bytesPerFrame);
    PcmBlock block;
    block.format = bufferFormat;
    block.data = scratch.data();
    block.frames = frameCount;
    block.byteSize = scratch.size();
    const size_t read = buffer.read(block);
    block.frames = read;
    typedPcmToFloat(block, output, frameCount);
    return read;
  }

  size_t read(PcmBlock& output) {
    return buffer.read(output);
  }

  AudioFormat bufferFormat() const {
    return buffer.format();
  }

  bool drained() const {
    return eof.load() && buffer.availableFrames() == 0;
  }

  bool readyForRender() const {
    return buffer.availableFrames() > 0 || eof.load();
  }

 private:
  void decodeLoop() {
    if (mode == Mode::Dop) {
      decodeDopLoop();
      return;
    }

    const int channels = std::max(1, decodeFormat.channelCount);
    const size_t bytesPerFrame = audioFormatBytesPerFrame(decodeFormat);
    std::vector<float> frames;
    std::vector<uint8_t> typedFrames;
    if (decodeFormat.sampleFormat == AudioSampleFormat::Float32Interleaved) {
      frames.assign(kDecodeChunkFrames * static_cast<size_t>(channels), 0.0f);
    } else {
      typedFrames.assign(kDecodeChunkFrames * bytesPerFrame, 0);
    }

    while (running.load()) {
      if (!decoder) break;
      std::string error;
      size_t decoded = 0;
      if (decodeFormat.sampleFormat == AudioSampleFormat::Float32Interleaved) {
        decoded = decoder->readFrames(frames.data(), kDecodeChunkFrames, &error);
      } else {
        PcmBlock block;
        block.format = decodeFormat;
        block.data = typedFrames.data();
        block.frames = kDecodeChunkFrames;
        block.byteSize = typedFrames.size();
        decoded = decoder->readFrames(block, &error);
      }
      if (decoded == 0) {
        eof = true;
        break;
      }
      if (decodeFormat.sampleFormat == AudioSampleFormat::Float32Interleaved) {
        buffer.writeBlocking(frames.data(), decoded, running);
      } else {
        PcmBlock block;
        block.format = decodeFormat;
        block.data = typedFrames.data();
        block.frames = decoded;
        block.byteSize = decoded * bytesPerFrame;
        buffer.writeBlocking(block, running);
      }
    }
  }

  void decodeDopLoop() {
    const int channels = std::max(1, decodeFormat.channelCount);
    const size_t dsdBytesPerChunk = kDecodeChunkFrames * static_cast<size_t>(channels) * 2;
    std::vector<uint8_t> dsdBytes(dsdBytesPerChunk);
    std::vector<uint8_t> pcmBytes;
    std::vector<float> frames(kDecodeChunkFrames * static_cast<size_t>(channels));

    while (running.load()) {
      if (!dsdReader) break;
      const size_t read = dsdReader->readBytes(dsdBytes.data(), dsdBytes.size());
      if (read == 0) {
        eof = true;
        break;
      }
      const size_t packedFrames = dopPacker.pack(dsdBytes.data(), read, &pcmBytes);
      if (packedFrames == 0) continue;
      const size_t sampleCount = packedFrames * static_cast<size_t>(channels);
      frames.resize(sampleCount);
      dopBytesToFloatCarrier(pcmBytes, decodeFormat.sampleFormat, frames.data(), sampleCount);
      buffer.writeBlocking(frames.data(), packedFrames, running);
    }
  }
};

AudioPipeline::AudioPipeline() = default;

AudioPipeline::~AudioPipeline() {
  stop();
}

void AudioPipeline::setBackendFactoryForTests(BackendFactory factory) {
  backendFactoryOverride() = std::move(factory);
}

TAE_Result AudioPipeline::play(
    const std::string& source,
    double startTimeSeconds,
    const std::string& backendId,
    const std::string& deviceId,
    double volume,
    const std::string& dspConfigJson,
    std::string* error) {
  return playInternal(
      makeManualItem(source),
      std::nullopt,
      startTimeSeconds,
      backendId,
      deviceId,
      volume,
      dspConfigJson,
      false,
      true,
      {},
      error);
}

TAE_Result AudioPipeline::play(
    const QueueItem& item,
    const std::optional<QueueItem>& upcomingItem,
    double startTimeSeconds,
    const std::string& backendId,
    const std::string& deviceId,
    double volume,
    const std::string& dspConfigJson,
    bool gaplessEnabled,
    std::string* error) {
  return playInternal(
      item,
      upcomingItem,
      startTimeSeconds,
      backendId,
      deviceId,
      volume,
      dspConfigJson,
      gaplessEnabled,
      true,
      {},
      error);
}

TAE_Result AudioPipeline::playInternal(
    const QueueItem& item,
    const std::optional<QueueItem>& upcomingItem,
    double startTimeSeconds,
    const std::string& backendId,
    const std::string& deviceId,
    double volume,
    const std::string& dspConfigJson,
    bool gaplessEnabled,
    bool allowDop,
    const std::string& forcedDsdFallbackReason,
    std::string* error) {
  stop();
  if (item.source.empty()) return TAE_RESULT_INVALID_ARGUMENT;

  OutputConfig outputConfig;
  {
    std::lock_guard lock(mutex_);
    outputConfig = outputConfig_;
  }

  const DspConfig requestedDspConfig = DspChain::parseConfigJson(dspConfigJson);
  const bool processingRequiresPcm =
      dspConfigRequiresProcessing(dspConfigJson) || std::abs(volume - 1.0) > kUnityVolumeEpsilon ||
      outputConfig.routingMode != ChannelRoutingMode::Auto;

  crossfadeMixActive_ = false;
  crossfadeFramesProcessed_ = 0;
  crossfadeTotalFrames_ = 0;

  std::optional<DsdStreamInfo> dsdProbe;
  if (sourceLooksDsfOrDff(item.source)) {
    DsdReader probe;
    std::string probeError;
    if (probe.open(item.source, &probeError)) {
      dsdProbe = probe.streamInfo();
    }
  }

  const bool canTryDop = allowDop &&
                         shouldAttemptDopForCurrentConfig(
                             requestedDspConfig,
                             outputConfig,
                             dsdProbe,
                             volume,
                             backendId);

  std::shared_ptr<DecodeStream> active;
  std::unique_ptr<IOutputBackend> output;
  AudioFormat outputFormat;
  bool dopPath = false;
  std::string dopAttemptError;

  if (canTryDop) {
    auto dopActive = std::make_shared<DecodeStream>();
    if (dopActive->openDsdSource(item, &dopAttemptError)) {
      output = backendFactoryOverride() ? backendFactoryOverride()(backendId) : createOutputBackend(backendId);
      if (!output) {
        dopAttemptError = "请求的音频输出后端不可用：" + backendId;
      } else if (!output->setOutputConfig(outputConfig, &dopAttemptError)) {
        output.reset();
      } else {
        AudioFormat requested = dopCarrierFormatForDsd(dsdProbe->dsdRate, dsdProbe->channelCount).value();
        requested.sampleFormat = AudioSampleFormat::Int24Interleaved;
        if (output->open(deviceId, requested, &dopAttemptError)) {
          outputFormat = output->outputFormat();
          if (formatCanCarryDop(outputFormat, dsdProbe->dsdRate, dsdProbe->channelCount) &&
              dopActive->configure(outputFormat, startTimeSeconds, &dopAttemptError)) {
            active = dopActive;
            dopPath = true;
          } else {
            output->close();
            output.reset();
          }
        } else {
          output.reset();
        }
      }
    }
  }

  if (!active) {
    active = std::make_shared<DecodeStream>();
    if (!active->openSource(item, error)) {
      return TAE_RESULT_BACKEND_UNAVAILABLE;
    }

    output = backendFactoryOverride() ? backendFactoryOverride()(backendId) : createOutputBackend(backendId);
    if (!output) {
      if (error) *error = "请求的音频输出后端不可用：" + backendId;
      return TAE_RESULT_BACKEND_UNAVAILABLE;
    }
    if (!output->setOutputConfig(outputConfig, error)) {
      return TAE_RESULT_INVALID_ARGUMENT;
    }
    const AudioFormat requestedPcmFormat =
        active->stream.isDsd ? pcmFallbackRequestFormat(active->stream, dsdProbe) : active->stream.sourceFormat;
    if (!output->open(deviceId, requestedPcmFormat, error)) {
      return TAE_RESULT_BACKEND_UNAVAILABLE;
    }

    outputFormat = output->outputFormat();
    const bool canUseTypedPassthrough =
        !active->stream.isDsd && !processingRequiresPcm && backendCanTypedPassthrough(backendId) &&
        formatCanTypedPassthrough(active->stream.sourceFormat) &&
        pcmFormatsExactMatch(active->stream.sourceFormat, outputFormat);
    if (!active->configure(outputFormat, startTimeSeconds, error, canUseTypedPassthrough)) {
      output->close();
      return TAE_RESULT_INTERNAL_ERROR;
    }

    if (active->stream.isDsd) {
      active->stream.dsdMode = DsdMode::Pcm;
      dopAttemptError = determineDsdPcmFallbackReason(
          requestedDspConfig,
          outputConfig,
          active->stream,
          volume,
          forcedDsdFallbackReason.empty() ? dopAttemptError : forcedDsdFallbackReason,
          dsdOutputModeRequestsDop(requestedDspConfig.dsdOutputMode));
    }
  }

  {
    std::lock_guard lock(mutex_);
    output_ = std::move(output);
    activeStream_ = active;
    preloadStream_.reset();
    stream_ = activeStream_->stream;
    outputFormat_ = outputFormat;
    currentItem_ = item;
    backendId_ = backendId == "wasapi-shared" ? "wasapi" : backendId;
    deviceName_ = output_->deviceName();
    outputInfo_ = output_->outputInfo();
    outputInfo_.backend = backendId_;
    outputInfo_.deviceName = deviceName_;
    dsdFallbackReason_ =
        (!dopAttemptError.empty() && activeStream_->stream.isDsd && activeStream_->stream.dsdMode == DsdMode::Pcm)
            ? dopAttemptError
            : "";
    if (!dsdFallbackReason_.empty()) {
      outputInfo_.perfectReason = dopAttemptError;
    }
    dspConfig_ = requestedDspConfig;
    dspChain_.configure(dspConfig_);
    dspChain_.prepare(outputFormat_);
    dspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
    preloadDspChain_.configure(dspConfig_);
    preloadDspChain_.prepare(outputFormat_);
    preloadDspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
    dspStatus_ = dspChain_.status();
    volume_ = std::clamp(volume, 0.0, 1.0);
    dspActive_ = dspStatus_.dspActive || std::abs(volume - 1.0) > 0.0001;
    spectrum_.prepare(outputFormat_, dspConfig_.fftResolution);
    spectrum_.setEnabled(dspConfig_.fftEnabled);
    gaplessEnabled_ = gaplessEnabled && !dopPath && !activeStream_->typedPassthrough;
    dopPathActive_ = dopPath;
    typedPassthroughActive_ = !dopPath && activeStream_->typedPassthrough;
    updatePerfectLocked();
    state_ = PipelineState::Playing;
    renderedFrames_ = static_cast<uint64_t>(std::max(0.0, startTimeSeconds) * outputFormat_.sampleRate);
    ended_ = false;
    deviceInvalidated_ = false;
    trackStarted_ = false;
    outputEventMessage_.clear();
  }

  active->start();
  if (gaplessEnabled && !dopPath && !active->typedPassthrough) {
    std::string preloadError;
    preloadNext(upcomingItem, &preloadError);
  }

  auto eventCallback = [this](OutputBackendEvent event, const std::string& message) {
    std::lock_guard lock(mutex_);
    outputEventMessage_ = message;
    if (event == OutputBackendEvent::DeviceInvalidated) {
      deviceInvalidated_ = true;
    }
    state_ = PipelineState::Stopped;
  };

  if (!output_->startTyped(
          [this](PcmBlock& block) { return renderTyped(block); },
          [this](float* data, size_t frames) { return render(data, frames); },
          eventCallback,
          error)) {
    stop();
    return TAE_RESULT_BACKEND_UNAVAILABLE;
  }

  if (dopPath) {
    const DopRuntimeFacts dopFacts = output_->dopRuntimeFacts();
    if (dopFacts.state == DopRuntimeFactState::Candidate || dopFacts.state == DopRuntimeFactState::Mismatch ||
        dopFacts.state == DopRuntimeFactState::Unproven || dopFacts.state == DopRuntimeFactState::Unsupported) {
      const std::string fallbackReason =
          dopFacts.state == DopRuntimeFactState::Mismatch ? "DoP carrier mismatch"
                                                          : "DoP backend could not prove passthrough";
      stop();
      return playInternal(
          item,
          upcomingItem,
          startTimeSeconds,
          backendId,
          deviceId,
          volume,
          dspConfigJson,
          gaplessEnabled,
          false,
          fallbackReason,
          error);
    }
  }

  {
    std::lock_guard lock(mutex_);
    outputFormat_ = output_->outputFormat();
    outputInfo_ = output_->outputInfo();
    outputInfo_.backend = backendId_;
    outputInfo_.deviceName = deviceName_;
    updatePerfectLocked();
  }

  return TAE_RESULT_OK;
}

bool AudioPipeline::shouldAttemptDopForCurrentConfig(
    const DspConfig& dspConfig,
    const OutputConfig& outputConfig,
    const std::optional<DsdStreamInfo>& dsdProbe,
    double volume,
    const std::string& backendId) const {
  if (!dsdProbe.has_value()) return false;
  if (!dsdOutputModeRequestsDop(dspConfig.dsdOutputMode)) return false;
  if (dspConfig.dsdOutputMode == DsdOutputMode::Native) return false;
  if (dspConfigRequiresProcessing("{}")) {
    // Never reached; kept to make the decision tree explicit near DSD policy.
  }
  const bool processingRequiresPcm =
      (dspConfig.enabled &&
       (dspConfig.replayGainMode != ReplayGainMode::Off || dspConfig.eqEnabled || dspConfig.convolverEnabled ||
        dspConfig.crossfeedEnabled)) ||
      dspConfig.crossfadeSeconds > 0.0001 || outputConfig.routingMode != ChannelRoutingMode::Auto ||
      std::abs(volume - 1.0) > kUnityVolumeEpsilon;
  if (processingRequiresPcm) return false;
  if (!backendCanAttemptDop(backendId)) return false;
  return dopCarrierFormatForDsd(dsdProbe->dsdRate, dsdProbe->channelCount).has_value();
}

std::string AudioPipeline::determineDsdPcmFallbackReason(
    const DspConfig& dspConfig,
    const OutputConfig& outputConfig,
    const AudioStreamInfo& stream,
    double volume,
    const std::string& attemptedDopReason,
    bool dopModeRequested) const {
  const bool processingRequiresPcm =
      (dspConfig.enabled &&
       (dspConfig.replayGainMode != ReplayGainMode::Off || dspConfig.eqEnabled || dspConfig.convolverEnabled ||
        dspConfig.crossfeedEnabled)) ||
      dspConfig.crossfadeSeconds > 0.0001 || outputConfig.routingMode != ChannelRoutingMode::Auto ||
      std::abs(volume - 1.0) > kUnityVolumeEpsilon;

  if (processingRequiresPcm) return "DSD processing active; falling back to PCM";
  if (dspConfig.dsdOutputMode == DsdOutputMode::Pcm) return "DSD output mode forced PCM";
  if (dspConfig.dsdOutputMode == DsdOutputMode::Native) return "Native DSD not yet available; falling back to PCM";
  if (stream.dsdRate >= 256) {
    return "DSD" + std::to_string(stream.dsdRate) + " currently falls back to PCM";
  }
  if (!attemptedDopReason.empty()) return attemptedDopReason;
  if (dopModeRequested) return "DoP backend could not prove passthrough";
  return "DSD converted to PCM";
}

TAE_Result AudioPipeline::togglePause() {
  std::lock_guard lock(mutex_);
  if (state_ == PipelineState::Playing) {
    state_ = PipelineState::Paused;
    spectrum_.resetCapture();
  } else if (state_ == PipelineState::Paused) {
    state_ = PipelineState::Playing;
  }
  return TAE_RESULT_OK;
}

TAE_Result AudioPipeline::stop() {
  std::unique_ptr<IOutputBackend> output;
  std::shared_ptr<DecodeStream> active;
  std::shared_ptr<DecodeStream> preload;
  {
    std::lock_guard lock(mutex_);
    state_ = PipelineState::Stopped;
    output = std::move(output_);
    active = std::move(activeStream_);
    preload = std::move(preloadStream_);
  }

  if (output) {
    output->stop();
    output->close();
  }
  if (active) active->stop();
  if (preload) preload->stop();

  {
    std::lock_guard lock(mutex_);
    stream_ = {};
    outputFormat_ = {};
    currentItem_ = {};
    backendId_.clear();
    deviceName_.clear();
    perfectReason_.clear();
    dsdFallbackReason_.clear();
    outputInfo_ = {};
    renderedFrames_ = 0;
    ended_ = false;
    deviceInvalidated_ = false;
    trackStarted_ = false;
    outputEventMessage_.clear();
    dspStatus_ = {};
    dspConfig_ = {};
    dspActive_ = false;
    outputPerfect_ = false;
    gaplessEnabled_ = true;
    dopPathActive_ = false;
    typedPassthroughActive_ = false;
    crossfadeMixActive_ = false;
    crossfadeFramesProcessed_ = 0;
    crossfadeTotalFrames_ = 0;
    spectrum_.resetCapture();
  }
  return TAE_RESULT_OK;
}

TAE_Result AudioPipeline::seek(double seconds, std::string* error) {
  std::shared_ptr<DecodeStream> active;
  {
    std::lock_guard lock(mutex_);
    if (!activeStream_ || outputFormat_.sampleRate <= 0) return TAE_RESULT_NOT_INITIALIZED;
    active = activeStream_;
  }

  if (!active->seek(seconds, error)) return TAE_RESULT_INTERNAL_ERROR;

  {
    std::lock_guard lock(mutex_);
    renderedFrames_ = static_cast<uint64_t>(std::max(0.0, seconds) * outputFormat_.sampleRate);
    ended_ = false;
    dspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
    dspStatus_ = dspChain_.status();
    dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
    updatePerfectLocked();
  }
  return TAE_RESULT_OK;
}

void AudioPipeline::setVolume(double volume) {
  volume_ = std::clamp(volume, 0.0, 1.0);
  std::lock_guard lock(mutex_);
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updatePerfectLocked();
}

void AudioPipeline::setDspConfig(const std::string& dspConfigJson) {
  std::shared_ptr<DecodeStream> disabledPreload;
  {
    std::lock_guard lock(mutex_);
    dspConfig_ = DspChain::parseConfigJson(dspConfigJson);
    gaplessEnabled_ = !dopPathActive_ && !typedPassthroughActive_ && dspConfig_.gapless;
    if (!gaplessEnabled_) {
      disabledPreload = std::move(preloadStream_);
      crossfadeMixActive_ = false;
      crossfadeFramesProcessed_ = 0;
      crossfadeTotalFrames_ = 0;
    }
    dspChain_.configure(dspConfig_);
    if (outputFormat_.sampleRate > 0 && outputFormat_.channelCount > 0) {
      dspChain_.prepare(outputFormat_);
      dspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
      preloadDspChain_.prepare(outputFormat_);
      preloadDspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
      spectrum_.prepare(outputFormat_, dspConfig_.fftResolution);
    }
    spectrum_.setEnabled(dspConfig_.fftEnabled);
    dspStatus_ = dspChain_.status();
    dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
    updatePerfectLocked();
  }
  if (disabledPreload) disabledPreload->stop();
}

bool AudioPipeline::setOutputConfig(const OutputConfig& config, std::string* error) {
  std::lock_guard lock(mutex_);
  outputConfig_ = config;
  if (output_ && !output_->setOutputConfig(outputConfig_, error)) return false;
  if (output_) {
    outputInfo_ = output_->outputInfo();
    updatePerfectLocked();
  }
  return true;
}

bool AudioPipeline::loadImpulseResponse(const std::string& path, std::string* error) {
  std::lock_guard lock(mutex_);
  const bool ok = dspChain_.loadImpulseResponse(path, error);
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updatePerfectLocked();
  return ok;
}

void AudioPipeline::unloadImpulseResponse() {
  std::lock_guard lock(mutex_);
  dspChain_.unloadImpulseResponse();
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updatePerfectLocked();
}

ConvolverInfo AudioPipeline::convolverInfo() const {
  return dspChain_.convolverInfo();
}

bool AudioPipeline::setEqBands(const std::string& json, std::string* error) {
  std::lock_guard lock(mutex_);
  const bool ok = dspChain_.setEqBandsFromJson(json, error);
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updatePerfectLocked();
  return ok;
}

bool AudioPipeline::setEqPreset(const std::string& json, std::string* error) {
  std::lock_guard lock(mutex_);
  const bool ok = dspChain_.setEqPresetFromJson(json, error);
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updatePerfectLocked();
  return ok;
}

void AudioPipeline::setCrossfeedStrength(double strength) {
  std::lock_guard lock(mutex_);
  dspChain_.setCrossfeedStrength(strength);
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updatePerfectLocked();
}

void AudioPipeline::setReplayGainMode(ReplayGainMode mode, double preampDb, double fallbackDb, bool clip) {
  std::lock_guard lock(mutex_);
  dspChain_.setReplayGainMode(mode, preampDb, fallbackDb, clip);
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updatePerfectLocked();
}

bool AudioPipeline::preloadNext(const std::optional<QueueItem>& item, std::string* error) {
  if (!item || item->source.empty()) {
    std::shared_ptr<DecodeStream> previous;
    {
      std::lock_guard lock(mutex_);
      previous = std::move(preloadStream_);
    }
    if (previous) previous->stop();
    return true;
  }

  AudioFormat outputFormat;
  bool gapless = false;
  {
    std::lock_guard lock(mutex_);
    if (preloadStream_ && preloadStream_->item.source == item->source) return true;
    outputFormat = outputFormat_;
    gapless = gaplessEnabled_;
  }
  if (!gapless || outputFormat.sampleRate <= 0 || outputFormat.channelCount <= 0) return false;

  auto stream = std::make_shared<DecodeStream>();
  if (!stream->openSource(*item, error)) return false;
  if (!stream->configure(outputFormat, 0.0, error)) return false;
  stream->start();

  std::shared_ptr<DecodeStream> previous;
  {
    std::lock_guard lock(mutex_);
    previous = std::move(preloadStream_);
    preloadStream_ = std::move(stream);
  }
  if (previous) previous->stop();
  return true;
}

bool AudioPipeline::skipToPreloaded(const QueueItem& item, std::string* error) {
  std::shared_ptr<DecodeStream> oldActive;
  {
    std::lock_guard lock(mutex_);
    if (crossfadeMixActive_) {
      if (error) *error = "crossfade overlap 已经消耗了预加载流起始数据";
      return false;
    }
    if (!preloadStream_ || preloadStream_->item.source != item.source) {
      if (error) *error = "下一首尚未完成预加载";
      return false;
    }
    oldActive = std::move(activeStream_);
    activeStream_ = std::move(preloadStream_);
    preloadStream_.reset();
    stream_ = activeStream_->stream;
    currentItem_ = activeStream_->item;
    renderedFrames_ = 0;
    ended_ = false;
    trackStarted_ = true;
    dspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
    dspStatus_ = dspChain_.status();
    dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
    crossfadeMixActive_ = false;
    crossfadeFramesProcessed_ = 0;
    crossfadeTotalFrames_ = 0;
    updatePerfectLocked();
  }
  if (oldActive) oldActive->stop();
  return true;
}

PipelineStatus AudioPipeline::status() const {
  std::lock_guard lock(mutex_);
  PipelineStatus status;
  status.state = state_;
  status.positionSeconds =
      outputFormat_.sampleRate > 0
          ? static_cast<double>(renderedFrames_.load()) / static_cast<double>(outputFormat_.sampleRate)
          : 0.0;
  status.stream = stream_;
  status.outputFormat = outputFormat_;
  OutputInfo backendInfo = output_ ? output_->outputInfo() : outputInfo_;
  backendInfo.sourceExact = outputInfo_.sourceExact;
  backendInfo.outputPerfect = outputInfo_.outputPerfect;
  backendInfo.pcmPassthrough = outputInfo_.pcmPassthrough;
  backendInfo.resampled = outputInfo_.resampled;
  backendInfo.isDsd = outputInfo_.isDsd;
  backendInfo.dsdMode = outputInfo_.dsdMode;
  backendInfo.dsdRate = outputInfo_.dsdRate;
  if (output_) applyNativeDsdRuntimeFacts(&backendInfo, output_->nativeDsdRuntimeFacts());
  backendInfo.channelRoutingMode = outputInfo_.channelRoutingMode;
  backendInfo.perfectReasonCode = outputInfo_.perfectReasonCode;
  backendInfo.perfectReason = outputInfo_.perfectReason;
  status.outputInfo = backendInfo;
  status.backendId = backendId_;
  status.deviceName = deviceName_;
  status.currentItem = currentItem_;
  status.dspActive = dspActive_;
  status.replayGainActive = dspStatus_.replayGainActive;
  status.eqActive = dspStatus_.eqActive;
  status.convolverActive = dspStatus_.convolverActive;
  status.crossfeedActive = dspStatus_.crossfeedActive;
  status.crossfadeActive = dspStatus_.crossfadeActive || dspConfig_.crossfadeSeconds > 0.0001;
  status.fftActive = spectrum_.isActive();
  status.irResampled = dspStatus_.irResampled;
  status.replayGainDb = dspStatus_.replayGainDb;
  status.crossfeedStrength = dspStatus_.crossfeedStrength;
  status.crossfadeSeconds = status.crossfadeActive ? dspConfig_.crossfadeSeconds : 0.0;
  status.convolverLatencyFrames = dspStatus_.convolverLatencyFrames;
  status.partitionSize = dspStatus_.partitionSize;
  status.channelMappingMode = dspStatus_.channelMappingMode;
  status.sourceExact = outputInfo_.sourceExact;
  status.outputPerfect = outputPerfect_;
  status.gaplessActive =
      gaplessEnabled_ && dspConfig_.crossfadeSeconds <= 0.0001 && preloadStream_ != nullptr && !crossfadeMixActive_;
  status.preloadReady = preloadStream_ && preloadStream_->readyForRender();
  status.perfectReason = perfectReason_;
  return status;
}

bool AudioPipeline::isDopPathActive() const {
  std::lock_guard lock(mutex_);
  return dopPathActive_;
}

bool AudioPipeline::needsPcmFallback(std::string* reason) const {
  std::lock_guard lock(mutex_);
  const bool processingActive =
      dspStatus_.replayGainActive || dspStatus_.eqActive || dspStatus_.convolverActive || dspStatus_.crossfeedActive ||
      dspStatus_.crossfadeActive || dspConfig_.crossfadeSeconds > 0.0001 ||
      std::abs(volume_.load() - 1.0) > kUnityVolumeEpsilon ||
      outputConfig_.routingMode != ChannelRoutingMode::Auto;

  if (typedPassthroughActive_) {
    if (!processingActive) return false;
    if (reason) *reason = "PCM processing active; falling back to Float32";
    return true;
  }

  if (!dopPathActive_ || !stream_.isDsd || stream_.dsdMode != DsdMode::Dop) return false;
  if (output_) {
    const DopRuntimeFacts dopFacts = output_->dopRuntimeFacts();
    if (dopFacts.state == DopRuntimeFactState::Mismatch) {
      if (reason) *reason = "DoP carrier mismatch";
      return true;
    }
    if (dopFacts.state == DopRuntimeFactState::Candidate || dopFacts.state == DopRuntimeFactState::Unproven ||
        dopFacts.state == DopRuntimeFactState::Unsupported) {
      if (reason) *reason = "DoP backend could not prove passthrough";
      return true;
    }
  }
  if (!processingActive) return false;
  if (reason) *reason = "DSD processing active; falling back to PCM";
  return true;
}

void AudioPipeline::setRerouteInProgress(bool active, const std::string& reason) {
  std::lock_guard lock(mutex_);
  rerouteInProgress_ = active;
  if (active && !reason.empty()) {
    dsdFallbackReason_ = reason;
    outputInfo_.perfectReason = reason;
    perfectReason_ = reason;
  }
}

bool AudioPipeline::consumeEnded() {
  return ended_.exchange(false);
}

bool AudioPipeline::consumeDeviceInvalidated(std::string* message) {
  if (!deviceInvalidated_.exchange(false)) return false;
  std::lock_guard lock(mutex_);
  if (message) *message = outputEventMessage_.empty() ? "输出设备已失效" : outputEventMessage_;
  outputEventMessage_.clear();
  return true;
}

bool AudioPipeline::consumeTrackStarted(QueueItem* item) {
  if (!trackStarted_.exchange(false)) return false;
  std::lock_guard lock(mutex_);
  if (item) *item = currentItem_;
  return true;
}

size_t AudioPipeline::getSpectrumData(float* buffer, size_t pointCount) const {
  const double phase =
      outputFormat_.sampleRate > 0
          ? static_cast<double>(renderedFrames_.load()) / static_cast<double>(outputFormat_.sampleRate)
          : 0.0;
  return spectrum_.read(buffer, pointCount, phase);
}

std::string AudioPipeline::getVisualizationDataJson(
    size_t spectrumPoints,
    size_t waveformPoints,
    size_t spectrogramFrames) const {
  return spectrum_.readVisualizationJson(spectrumPoints, waveformPoints, spectrogramFrames);
}

bool AudioPipeline::configureActiveStreamLocked(
    const std::shared_ptr<DecodeStream>& stream,
    const QueueItem& item,
    double startTimeSeconds,
    std::string* error) {
  if (!stream) return false;
  if (!stream->openSource(item, error)) return false;
  if (!stream->configure(outputFormat_, startTimeSeconds, error)) return false;
  return true;
}

bool AudioPipeline::updatePerfectLocked() {
  const OutputInfo backendInfo = output_ ? output_->outputInfo() : outputInfo_;
  const DopRuntimeFacts dopFacts = output_ ? output_->dopRuntimeFacts() : DopRuntimeFacts{};
  const NativeDsdRuntimeFacts nativeDsdFacts =
      output_ ? output_->nativeDsdRuntimeFacts() : unsupportedNativeDsdRuntimeFacts("No output backend is active");
  AudioFormat semanticOutputFormat = actualOutputPcmFormat(outputFormat_, backendInfo);
  const bool backendResampled = backendInfo.resampled;
  const std::string backendPerfectReason =
      stream_.isDsd && stream_.dsdMode == DsdMode::Pcm && !dsdFallbackReason_.empty()
          ? dsdFallbackReason_
          : backendInfo.perfectReason;
  PerfectEvaluation evaluation;
  evaluation.sourceFormat = stream_.sourceFormat;
  evaluation.decodedFormat = stream_.decodedFormat;
  evaluation.outputFormat = semanticOutputFormat;
  evaluation.sourceLossless = stream_.sourceLossless;
  evaluation.sourceDsd = stream_.isDsd;
  if (stream_.isDsd) {
    evaluation.dsdMode = stream_.dsdMode;
    evaluation.dsdRate = stream_.dsdRate;
    if (stream_.dsdMode == DsdMode::Dop) {
      evaluation.dopCarrierFormat = stream_.decodedFormat;
      evaluation.dopCarrierMatched = pcmFormatsExactMatch(stream_.decodedFormat, semanticOutputFormat);
      if (dopFacts.state == DopRuntimeFactState::Mismatch && hasConcreteAudioFormat(dopFacts.actualFormat)) {
        evaluation.dopCarrierFormat = dopFacts.actualFormat;
        evaluation.dopCarrierMatched = pcmFormatsExactMatch(dopFacts.actualFormat, semanticOutputFormat);
      }
      evaluation.dopPassthroughProven =
          dopFacts.state == DopRuntimeFactState::Proven && evaluation.dopCarrierMatched && !backendResampled;
    }
  }
  evaluation.supportsOutputPerfect = backendInfo.supportsOutputPerfect;
  evaluation.backendResampled = backendResampled;
  evaluation.backendPerfectReason = backendPerfectReason;
  evaluation.volume = volume_.load();
  evaluation.replayGainActive = dspStatus_.replayGainActive;
  evaluation.eqActive = dspStatus_.eqActive;
  evaluation.convolverActive = dspStatus_.convolverActive;
  evaluation.crossfeedActive = dspStatus_.crossfeedActive;
  evaluation.crossfadeActive = dspStatus_.crossfadeActive || dspConfig_.crossfadeSeconds > 0.0001;
  evaluation.routingMode = outputConfig_.routingMode;
  evaluation.pcmPassthrough = pcmFormatsExactMatch(evaluation.decodedFormat, evaluation.outputFormat) && !backendResampled;
  const PerfectResult result = evaluatePerfect(evaluation);
  dspActive_ = result.processingActive;
  outputPerfect_ = result.outputPerfect;
  outputInfo_.sourceExact = result.sourceExact;
  outputInfo_.resampled = result.resampled;
  outputInfo_.outputPerfect = outputPerfect_;
  outputInfo_.pcmPassthrough = result.pcmPassthrough;
  outputInfo_.isDsd = stream_.isDsd;
  outputInfo_.dsdMode = stream_.isDsd ? dsdModeToString(stream_.dsdMode) : dsdModeToString(DsdMode::Pcm);
  outputInfo_.dsdRate = stream_.isDsd ? stream_.dsdRate : 0;
  applyNativeDsdRuntimeFacts(&outputInfo_, nativeDsdFacts);
  outputInfo_.channelRoutingMode = channelRoutingModeToString(outputConfig_.routingMode);
  outputInfo_.perfectReasonCode = result.perfectReasonCode;
  outputInfo_.perfectReason = result.perfectReason;
  perfectReason_ = result.perfectReason;
  return outputPerfect_;
}

size_t AudioPipeline::renderTyped(PcmBlock& output) {
  if (!output.data || output.frames == 0) return 0;
  if (output.byteSize > 0) std::memset(output.data, 0, output.byteSize);

  PipelineState state = PipelineState::Stopped;
  std::shared_ptr<DecodeStream> active;
  AudioFormat outputFormat;
  bool typedPassthroughActive = false;
  {
    std::lock_guard lock(mutex_);
    state = state_;
    active = activeStream_;
    outputFormat = outputFormat_;
    typedPassthroughActive = typedPassthroughActive_;
  }

  if (state != PipelineState::Playing || !active) {
    spectrum_.resetCapture();
    return typedPassthroughActive ? output.frames : 0;
  }

  if (!typedPassthroughActive || !pcmFormatsExactMatch(output.format, outputFormat) ||
      !pcmFormatsExactMatch(active->bufferFormat(), output.format)) {
    return 0;
  }

  const size_t read = active->read(output);
  if (read > 0) {
    const int channels = std::max(1, output.format.channelCount);
    std::vector<float> visualization(output.frames * static_cast<size_t>(channels), 0.0f);
    PcmBlock captured = output;
    captured.frames = read;
    captured.byteSize = read * audioFormatBytesPerFrame(output.format);
    typedPcmToFloat(captured, visualization.data(), output.frames);
    renderedFrames_ += read;
    spectrum_.capture(visualization.data(), output.frames, channels);
  } else if (active->drained()) {
    ended_ = true;
    std::lock_guard lock(mutex_);
    if (state_ == PipelineState::Playing) state_ = PipelineState::Stopped;
    spectrum_.resetCapture();
  } else {
    spectrum_.resetCapture();
  }

  return output.frames;
}

size_t AudioPipeline::render(float* output, size_t frameCount) {
  if (!output || frameCount == 0) return 0;

  PipelineState state = PipelineState::Stopped;
  int channels = 0;
  std::shared_ptr<DecodeStream> active;
  std::shared_ptr<DecodeStream> preload;
  DspConfig dspConfig;
  AudioFormat outputFormat;
  bool dopPathActive = false;
  double volume = 1.0;
  bool crossfadeMixActive = false;
  uint64_t crossfadeFramesProcessed = 0;
  uint64_t crossfadeTotalFrames = 0;
  {
    std::lock_guard lock(mutex_);
    state = state_;
    outputFormat = outputFormat_;
    channels = std::max(1, outputFormat.channelCount);
    active = activeStream_;
    preload = preloadStream_;
    dspConfig = dspConfig_;
    dopPathActive = dopPathActive_;
    volume = volume_.load();
    crossfadeMixActive = crossfadeMixActive_;
    crossfadeFramesProcessed = crossfadeFramesProcessed_;
    crossfadeTotalFrames = crossfadeTotalFrames_;
  }

  std::fill(output, output + frameCount * static_cast<size_t>(channels), 0.0f);
  if (state != PipelineState::Playing || !active) {
    spectrum_.resetCapture();
    return frameCount;
  }

  const bool wantsCrossfade = dspConfig.crossfadeSeconds > 0.0001;
  size_t totalRead = 0;
  size_t positionRead = 0;
  while (totalRead < frameCount) {
    float* segment = output + totalRead * static_cast<size_t>(channels);
    const size_t read = active->readFloat(segment, frameCount - totalRead);
    if (read > 0 && !dopPathActive) {
      dspChain_.process(segment, read);
    }
    totalRead += read;
    positionRead += read;

    if (wantsCrossfade && preload && preload->readyForRender() && outputFormat.sampleRate > 0) {
      const uint64_t requestedFrames =
          static_cast<uint64_t>(std::max(1.0, dspConfig.crossfadeSeconds * static_cast<double>(outputFormat.sampleRate)));
      if (!crossfadeMixActive) {
        const double secondsRemaining =
            active->stream.durationSeconds > 0.0
                ? std::max(0.0, active->stream.durationSeconds -
                                     (static_cast<double>(renderedFrames_.load() + positionRead) /
                                      static_cast<double>(outputFormat.sampleRate)))
                : 0.0;
        if (secondsRemaining <= dspConfig.crossfadeSeconds + 0.02) {
          crossfadeMixActive = true;
          crossfadeFramesProcessed = 0;
          crossfadeTotalFrames = requestedFrames;
          preloadDspChain_.configure(dspConfig);
          preloadDspChain_.prepare(outputFormat);
          preloadDspChain_.setTrackContext(DspTrackContext{preload->stream, preload->item});
          {
            std::lock_guard lock(mutex_);
            if (preloadStream_ == preload) {
              crossfadeMixActive_ = true;
              crossfadeFramesProcessed_ = 0;
              crossfadeTotalFrames_ = requestedFrames;
            }
          }
        }
      }

      if (crossfadeMixActive) {
        std::vector<float> preloadFrames((frameCount - totalRead + read) * static_cast<size_t>(channels), 0.0f);
        const size_t mixedFrames = preload->readFloat(preloadFrames.data(), read);
        if (mixedFrames > 0 && !dopPathActive) {
          preloadDspChain_.process(preloadFrames.data(), mixedFrames);
          const uint64_t totalFrames = std::max<uint64_t>(1, crossfadeTotalFrames);
          for (size_t frame = 0; frame < mixedFrames; ++frame) {
            const double fadeOut =
                1.0 - std::clamp(static_cast<double>(crossfadeFramesProcessed + frame) / static_cast<double>(totalFrames), 0.0, 1.0);
            const double fadeIn =
                std::clamp(static_cast<double>(crossfadeFramesProcessed + frame) / static_cast<double>(totalFrames), 0.0, 1.0);
            for (int channel = 0; channel < channels; ++channel) {
              const size_t index = (totalRead - read + frame) * static_cast<size_t>(channels) + static_cast<size_t>(channel);
              output[index] = static_cast<float>(std::clamp(
                  static_cast<double>(output[index]) * fadeOut +
                      static_cast<double>(preloadFrames[frame * static_cast<size_t>(channels) + static_cast<size_t>(channel)]) * fadeIn,
                  -1.0,
                  1.0));
            }
          }
          crossfadeFramesProcessed += mixedFrames;
          {
            std::lock_guard lock(mutex_);
            if (preloadStream_ == preload && crossfadeMixActive_) {
              crossfadeFramesProcessed_ += mixedFrames;
            }
          }
        }
      }
    }

    if (totalRead >= frameCount || !active->drained()) break;

    std::shared_ptr<DecodeStream> next;
    std::shared_ptr<DecodeStream> oldActive;
    {
      std::lock_guard lock(mutex_);
      const bool canPromotePreload = preloadStream_ && preloadStream_->readyForRender();
      if ((!gaplessEnabled_ && !crossfadeMixActive_) || !canPromotePreload) {
        break;
      }
      oldActive = activeStream_;
      activeStream_ = preloadStream_;
      preloadStream_.reset();
      active = activeStream_;
      next = activeStream_;
      stream_ = activeStream_->stream;
      currentItem_ = activeStream_->item;
      renderedFrames_ = 0;
      positionRead = 0;
      ended_ = false;
      trackStarted_ = true;
      dspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
      dspStatus_ = dspChain_.status();
      dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
      crossfadeMixActive_ = false;
      crossfadeFramesProcessed_ = 0;
      crossfadeTotalFrames_ = 0;
      updatePerfectLocked();
    }
    if (oldActive) oldActive->stop();
    if (!next) break;
  }

  if (!dopPathActive && std::abs(volume - 1.0) > 0.0001) {
    const size_t sampleCount = frameCount * static_cast<size_t>(channels);
    for (size_t i = 0; i < sampleCount; ++i) {
      output[i] = static_cast<float>(std::clamp(static_cast<double>(output[i]) * volume, -1.0, 1.0));
    }
  }

  if (positionRead > 0) {
    renderedFrames_ += positionRead;
    spectrum_.capture(output, frameCount, channels);
  } else if (active->drained()) {
    ended_ = true;
    std::lock_guard lock(mutex_);
    if (state_ == PipelineState::Playing) state_ = PipelineState::Stopped;
    spectrum_.resetCapture();
  } else {
    spectrum_.resetCapture();
  }

  return frameCount;
}

}  // namespace twilight::audio
