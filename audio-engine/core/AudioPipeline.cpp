#include "AudioPipeline.h"
#include "AudioPipelineDsdUtils.h"
#include "AudioPipelineRenderUtils.h"
#include "../dsp/ChannelRouter.h"
#include "../decoder/SacdIsoProbe.h"

#include <algorithm>
#include <bit>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <deque>
#include <thread>
#include <utility>
#include <vector>

namespace twilight::audio {
namespace {

constexpr size_t kDecodeChunkFrames = 2048;
constexpr size_t kVisualizationFftResolution = 8192;
constexpr double kUnityVolumeEpsilon = 0.0001;

uint64_t doubleBits(double value) noexcept {
  return std::bit_cast<uint64_t>(value);
}

double doubleFromBits(uint64_t bits) noexcept {
  return std::bit_cast<double>(bits);
}

uint32_t floatBits(float value) noexcept {
  return std::bit_cast<uint32_t>(value);
}

float floatFromBits(uint32_t bits) noexcept {
  return std::bit_cast<float>(bits);
}

double loadAtomicDouble(
    const std::atomic<uint64_t>& bits,
    std::memory_order order = std::memory_order_seq_cst) noexcept {
  return doubleFromBits(bits.load(order));
}

void storeAtomicDouble(
    std::atomic<uint64_t>& bits,
    double value,
    std::memory_order order = std::memory_order_seq_cst) noexcept {
  bits.store(doubleBits(value), order);
}

UpmixConfig upmixConfigFromOutputConfig(const OutputConfig& config) noexcept {
  UpmixConfig upmix;
  upmix.centerGain = config.upmixCenterGain;
  upmix.lfeGain = config.upmixLfeGain;
  upmix.lfeLowpassHz = config.upmixLfeLowpassHz;
  upmix.surroundGain = config.upmixSurroundGain;
  upmix.sideGain = config.upmixSideGain;
  upmix.surroundDelayMs = config.upmixSurroundDelayMs;
  return upmix;
}

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

AudioFormat actualOutputFormat(const AudioFormat& fallback, const OutputInfo& info) {
  AudioFormat format = actualOutputPcmFormat(fallback, info);
  if (isDsdSampleFormat(fallback.sampleFormat)) {
    format.bitDepth = 1;
    if (info.actualOutputFormat == "dsd-int8-msb1") {
      format.sampleFormat = AudioSampleFormat::DsdInt8Msb1;
    } else if (info.actualOutputFormat == "dsd-int8-ner8") {
      format.sampleFormat = AudioSampleFormat::DsdInt8Ner8;
    } else {
      format.sampleFormat = AudioSampleFormat::DsdInt8Lsb1;
    }
  }
  return format;
}

bool backendCanAttemptDop(const std::string& backendId) {
  return backendId == "asio" || backendId == "wasapi-exclusive" || backendId == "coreaudio-exclusive";
}

bool backendCanAttemptNativeDsd(const std::string& backendId) {
  return backendId == "asio" || backendId == "alsa";
}

bool backendCanTypedPassthrough(const std::string& backendId) {
  return backendId == "asio" || backendId == "wasapi-exclusive" || backendId == "coreaudio-exclusive";
}

bool formatCanTypedPassthrough(const AudioFormat& format) {
  return format.sampleRate > 0 && format.channelCount > 0 && audioFormatBytesPerFrame(format) > 0;
}

bool sampleFormatCanCarryDop(AudioSampleFormat format) {
  return format == AudioSampleFormat::Int24Interleaved || format == AudioSampleFormat::Int24In32Interleaved;
}

AudioSampleFormat nativeDsdSampleFormatForBitOrder(DsdBitOrder bitOrder) {
  return bitOrder == DsdBitOrder::MsbFirst ? AudioSampleFormat::DsdInt8Msb1 : AudioSampleFormat::DsdInt8Lsb1;
}

AudioFormat nativeDsdFormatForStream(const DsdStreamInfo& dsd) {
  AudioFormat format;
  format.sampleRate = dsd.dsdSampleRate;
  format.channelCount = dsd.channelCount;
  format.bitDepth = 1;
  format.sampleFormat = nativeDsdSampleFormatForBitOrder(dsd.bitOrder);
  return format;
}

bool formatCanCarryDop(const AudioFormat& format, int dsdRate, int sourceSampleRate, int channels) {
  const auto expected = dopCarrierFormatForDsd(dsdRate, sourceSampleRate, channels);
  return expected.has_value() && format.sampleRate == expected->sampleRate &&
         format.channelCount == expected->channelCount && effectivePcmBitDepth(format) == 24 &&
         sampleFormatCanCarryDop(format.sampleFormat);
}

bool nativeDsdRuntimeFactsMatchRequested(const NativeDsdRuntimeFacts& facts, const AudioFormat& requested) {
  return facts.explicitlyCapable &&
         (facts.state == NativeDsdRuntimeFactState::Candidate || facts.state == NativeDsdRuntimeFactState::Proven) &&
         facts.requestedDsdRate == requested.sampleRate && facts.actualDsdRate == requested.sampleRate &&
         facts.channelCount == requested.channelCount;
}

bool nativeDsdOutputMatchesRequested(
    const AudioFormat& outputFormat,
    const AudioFormat& requested,
    const NativeDsdRuntimeFacts& facts) {
  if (!isDsdSampleFormat(outputFormat.sampleFormat) || outputFormat.channelCount != requested.channelCount) {
    return false;
  }
  if (outputFormat.sampleRate == requested.sampleRate) return true;
  return nativeDsdRuntimeFactsMatchRequested(facts, requested);
}

bool dspConfigProcessingRequiresPcm(
    const DspConfig& dspConfig,
    const OutputConfig& outputConfig,
    double volume) {
  return (dspConfig.enabled &&
          (dspConfig.replayGainMode != ReplayGainMode::Off || dspConfig.eqEnabled || dspConfig.convolverEnabled ||
           dspConfig.crossfeedEnabled)) ||
         dspConfig.crossfadeSeconds > 0.0001 || outputConfig.routingMode != ChannelRoutingMode::Auto ||
         std::abs(volume - 1.0) > kUnityVolumeEpsilon;
}

bool dopRuntimeFactsRequirePcmFallback(const DopRuntimeFacts& facts) {
  return facts.state == DopRuntimeFactState::Candidate || facts.state == DopRuntimeFactState::Mismatch ||
         facts.state == DopRuntimeFactState::Unproven || facts.state == DopRuntimeFactState::Unsupported;
}

std::string dopPcmFallbackReason(const DopRuntimeFacts& facts) {
  return facts.state == DopRuntimeFactState::Mismatch ? "DoP carrier mismatch" : "DoP backend could not prove passthrough";
}

bool nativeDsdRuntimeFactsRequirePcmFallback(const NativeDsdRuntimeFacts& facts) {
  return facts.state == NativeDsdRuntimeFactState::Mismatch || facts.state == NativeDsdRuntimeFactState::Unproven ||
         facts.state == NativeDsdRuntimeFactState::Unsupported;
}

std::string nativeDsdPcmFallbackReason(const NativeDsdRuntimeFacts& facts) {
  return facts.reason.empty() ? "ASIO Native DSD could not prove raw DSD output" : facts.reason;
}

int positionSampleRateForStream(const AudioStreamInfo& stream, const AudioFormat& outputFormat) {
  if (stream.isDsd && stream.dsdMode == DsdMode::Native && stream.decodedFormat.sampleRate > 0) {
    return stream.decodedFormat.sampleRate;
  }
  return outputFormat.sampleRate;
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

void typedPcmToFloat(const PcmBlock& block, float* output, size_t frames) {
  render::typedPcmToFloatWithTailSilence(block, output, frames);
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

size_t dsdBytesToInterleaved(
    const uint8_t* dsdBytes,
    size_t byteCount,
    const DsdStreamInfo& info,
    AudioSampleFormat targetFormat,
    std::vector<uint8_t>* output) {
  return render::dsdBytesToInterleavedResizeOnly(dsdBytes, byteCount, info, targetFormat, output);
}

uint64_t dsdRenderedFrameUnits(size_t byteFrames, const AudioFormat& format) {
  return static_cast<uint64_t>(byteFrames) * (isDsdSampleFormat(format.sampleFormat) ? 8U : 1U);
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

bool dsdOutputModeRequestsNative(DsdOutputMode mode) {
  return mode == DsdOutputMode::Auto || mode == DsdOutputMode::Native;
}

bool dsdOutputModeRequestsDop(DsdOutputMode mode) {
  return mode == DsdOutputMode::Auto || mode == DsdOutputMode::Dop || mode == DsdOutputMode::Native;
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

size_t visualizationFftResolutionForConfig(size_t configuredFftResolution) {
  if (configuredFftResolution == 0) return kVisualizationFftResolution;
  return std::max(configuredFftResolution, kVisualizationFftResolution);
}

struct AudioPipeline::DecodeStream {
  enum class Mode {
    Pcm,
    Dop,
    NativeDsd
  };

  QueueItem item;
  AudioStreamInfo stream;
  AudioFormat decodeFormat;
  std::unique_ptr<FFmpegDecoder> decoder;
  std::unique_ptr<DsdReader> dsdReader;
  // DSD-preserving DST decoder provider, injected into dsdReader so SACD ISO
  // DST-compressed tracks are playable through the DoP / native-DSD pipeline.
  std::unique_ptr<SacdDstDecoderProvider> dstProvider = createDefaultSacdDstDecoderProvider();
  DopPacker dopPacker;
  AudioBuffer buffer;
  std::vector<uint8_t> floatReadScratch;
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
    dsdReader->setDstDecoderProvider(dstProvider.get());
    if (!dsdReader->open(item.source, error)) {
      dsdReader.reset();
      return false;
    }
    stream = streamInfoFromDsd(item, dsdReader->streamInfo(), DsdMode::Dop);
    return true;
  }

  bool openNativeDsdSource(const QueueItem& queueItem, std::string* error) {
    stop();
    decoder.reset();
    item = queueItem;
    mode = Mode::NativeDsd;
    dsdReader = std::make_unique<DsdReader>();
    dsdReader->setDstDecoderProvider(dstProvider.get());
    if (!dsdReader->open(item.source, error)) {
      dsdReader.reset();
      return false;
    }
    stream = streamInfoFromDsd(item, dsdReader->streamInfo(), DsdMode::Native);
    return true;
  }

  bool configure(
      const AudioFormat& outputFormat,
      double startTimeSeconds,
      std::string* error,
      bool useTypedPassthrough = false) {
    if (mode == Mode::Dop) return configureDop(outputFormat, startTimeSeconds, error);
    if (mode == Mode::NativeDsd) return configureNativeDsd(outputFormat, startTimeSeconds, error);
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
    if (!formatCanCarryDop(outputFormat, dsd.dsdRate, dsd.dsdSampleRate, dsd.channelCount)) {
      if (error) *error = "DoP carrier format mismatch";
      return false;
    }

    DopPackerConfig config;
    config.channelCount = dsd.channelCount;
    config.dsdRate = dsd.dsdRate;
    config.sourceSampleRate = dsd.dsdSampleRate;
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

  bool configureNativeDsd(const AudioFormat& outputFormat, double startTimeSeconds, std::string* error) {
    if (!dsdReader) {
      if (error) *error = "DSD reader is not open";
      return false;
    }
    const DsdStreamInfo& dsd = dsdReader->streamInfo();
    if (!isDsdSampleFormat(outputFormat.sampleFormat) || outputFormat.channelCount != dsd.channelCount) {
      if (error) *error = "Native DSD output format mismatch";
      return false;
    }
    if (startTimeSeconds > 0.0 && !dsdReader->seek(startTimeSeconds, error)) return false;
    decodeFormat = outputFormat;
    stream.decodedFormat = nativeDsdFormatForStream(dsd);
    stream.dsdMode = DsdMode::Native;
    typedPassthrough = true;
    eof = false;
    buffer.reset(decodeFormat, static_cast<size_t>(std::max(dsd.dsdSampleRate / 8, 8192)));
    return true;
  }

  void start() {
    if ((!decoder && !dsdReader) || running.load()) return;
    running = true;
    decodeThread = std::thread([this] { decodeLoop(); });
  }

  void requestStop() {
    running = false;
    buffer.notifyAll();
  }

  void stop() {
    requestStop();
    if (decodeThread.joinable()) decodeThread.join();
  }

  bool seek(double seconds, std::string* error) {
    if (!decoder && !dsdReader) return false;
    stop();
    const bool ok = (mode == Mode::Dop || mode == Mode::NativeDsd)
                        ? dsdReader->seek(std::max(0.0, seconds), error)
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

  void prepareFloatReadScratch(size_t maxFrames) {
    const AudioFormat bufferFormat = buffer.format();
    if (bufferFormat.sampleFormat == AudioSampleFormat::Float32Interleaved) {
      floatReadScratch.clear();
      return;
    }
    const size_t bytesPerFrame = audioFormatBytesPerFrame(bufferFormat);
    if (bytesPerFrame == 0) {
      floatReadScratch.clear();
      return;
    }
    floatReadScratch.resize(std::max<size_t>(1, maxFrames) * bytesPerFrame);
  }

  size_t readFloat(float* output, size_t frameCount) {
    if (!output || frameCount == 0) return 0;
    const AudioFormat bufferFormat = buffer.format();
    if (bufferFormat.sampleFormat == AudioSampleFormat::Float32Interleaved) {
      return buffer.read(output, frameCount);
    }

    const size_t bytesPerFrame = audioFormatBytesPerFrame(bufferFormat);
    if (bytesPerFrame == 0) return 0;
    size_t readableFrames = frameCount;
    const size_t scratchFrames = floatReadScratch.size() / bytesPerFrame;
    if (scratchFrames == 0) {
      const size_t samples = frameCount * static_cast<size_t>(std::max(1, bufferFormat.channelCount));
      std::fill(output, output + samples, 0.0f);
      return 0;
    }
    readableFrames = std::min(readableFrames, scratchFrames);
    const size_t requiredBytes = readableFrames * bytesPerFrame;
    PcmBlock block;
    block.format = bufferFormat;
    block.data = floatReadScratch.data();
    block.frames = readableFrames;
    block.byteSize = requiredBytes;
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

  bool waitForPreroll(size_t targetFrames, std::chrono::milliseconds timeout) const {
    return buffer.waitForAvailableFrames(targetFrames, timeout, running, eof) > 0 || eof.load();
  }

 private:
  void markEof() {
    eof = true;
    buffer.notifyAll();
  }

  void decodeLoop() {
    if (mode == Mode::Dop) {
      decodeDopLoop();
      return;
    }
    if (mode == Mode::NativeDsd) {
      decodeNativeDsdLoop();
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
        markEof();
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
        markEof();
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

  void decodeNativeDsdLoop() {
    const DsdStreamInfo info = dsdReader ? dsdReader->streamInfo() : DsdStreamInfo{};
    const int channels = std::max(1, decodeFormat.channelCount);
    const size_t dsdBytesPerChunk =
        info.packing == DsdPacking::DsfPlanarBlocks && info.blockSizePerChannel > 0
            ? static_cast<size_t>(info.blockSizePerChannel) * static_cast<size_t>(channels)
            : kDecodeChunkFrames * static_cast<size_t>(channels);
    std::vector<uint8_t> dsdBytes(dsdBytesPerChunk);
    std::vector<uint8_t> interleaved;

    while (running.load()) {
      if (!dsdReader) break;
      const size_t read = dsdReader->readBytes(dsdBytes.data(), dsdBytes.size());
      if (read == 0) {
        markEof();
        break;
      }
      const size_t frames = dsdBytesToInterleaved(dsdBytes.data(), read, info, decodeFormat.sampleFormat, &interleaved);
      if (frames == 0) continue;
      PcmBlock block;
      block.format = decodeFormat;
      block.data = interleaved.data();
      block.frames = frames;
      block.byteSize = frames * audioFormatBytesPerFrame(decodeFormat);
      buffer.writeBlocking(block, running);
    }
  }
};

struct AudioPipeline::DecodeStreamReaper {
  DecodeStreamReaper() : worker([this] { run(); }) {}

  ~DecodeStreamReaper() {
    {
      std::lock_guard lock(mutex);
      stopping = true;
    }
    cv.notify_one();
    if (worker.joinable()) worker.join();
    drain();
  }

  void retire(std::unique_ptr<DecodeStream> stream) {
    if (!stream) return;
    stream->requestStop();
    {
      std::lock_guard lock(mutex);
      queue.push_back(std::move(stream));
    }
    cv.notify_one();
  }

 private:
  void run() {
    while (true) {
      std::unique_ptr<DecodeStream> stream;
      {
        std::unique_lock lock(mutex);
        cv.wait(lock, [this] { return stopping || !queue.empty(); });
        if (queue.empty()) {
          if (stopping) break;
          continue;
        }
        stream = std::move(queue.front());
        queue.pop_front();
      }
      stream->stop();
      stream.reset();
    }
  }

  void drain() {
    std::deque<std::unique_ptr<DecodeStream>> remaining;
    {
      std::lock_guard lock(mutex);
      remaining.swap(queue);
    }
    for (auto& stream : remaining) {
      if (stream) stream->stop();
    }
  }

  std::mutex mutex;
  std::condition_variable cv;
  std::deque<std::unique_ptr<DecodeStream>> queue;
  std::thread worker;
  bool stopping = false;
};

AudioPipeline::AudioPipeline() = default;

void AudioPipeline::LatestControlCommandSlot::publish(const ControlCommand& command) noexcept {
  sequence.fetch_add(1, std::memory_order_acq_rel);
  volumeBits.store(doubleBits(command.volume), std::memory_order_relaxed);
  revision.store(command.revision, std::memory_order_relaxed);
  sequence.fetch_add(1, std::memory_order_release);
}

bool AudioPipeline::LatestControlCommandSlot::read(ControlCommand* command) const noexcept {
  if (!command) return false;
  const uint64_t before = sequence.load(std::memory_order_acquire);
  if ((before & 1U) != 0U) return false;
  ControlCommand snapshot;
  snapshot.type = ControlCommandType::Volume;
  snapshot.volume = doubleFromBits(volumeBits.load(std::memory_order_relaxed));
  snapshot.revision = revision.load(std::memory_order_relaxed);
  const uint64_t after = sequence.load(std::memory_order_acquire);
  if (before != after || (after & 1U) != 0U) return false;
  *command = snapshot;
  return snapshot.revision != 0;
}

void AudioPipeline::LatestRoutingCommandSlot::publish(const ControlCommand& command) noexcept {
  sequence.fetch_add(1, std::memory_order_acq_rel);
  routingMode.store(static_cast<uint32_t>(command.routingMode), std::memory_order_relaxed);
  centerGainBits.store(floatBits(command.upmix.centerGain), std::memory_order_relaxed);
  lfeGainBits.store(floatBits(command.upmix.lfeGain), std::memory_order_relaxed);
  lfeLowpassHzBits.store(floatBits(command.upmix.lfeLowpassHz), std::memory_order_relaxed);
  surroundGainBits.store(floatBits(command.upmix.surroundGain), std::memory_order_relaxed);
  sideGainBits.store(floatBits(command.upmix.sideGain), std::memory_order_relaxed);
  surroundDelayMsBits.store(floatBits(command.upmix.surroundDelayMs), std::memory_order_relaxed);
  sequence.fetch_add(1, std::memory_order_release);
}

bool AudioPipeline::LatestRoutingCommandSlot::read(ControlCommand* command) const noexcept {
  if (!command) return false;
  const uint64_t before = sequence.load(std::memory_order_acquire);
  if ((before & 1U) != 0U) return false;

  ControlCommand snapshot;
  snapshot.type = ControlCommandType::Routing;
  snapshot.routingMode = static_cast<ChannelRoutingMode>(routingMode.load(std::memory_order_relaxed));
  snapshot.upmix.centerGain = floatFromBits(centerGainBits.load(std::memory_order_relaxed));
  snapshot.upmix.lfeGain = floatFromBits(lfeGainBits.load(std::memory_order_relaxed));
  snapshot.upmix.lfeLowpassHz = floatFromBits(lfeLowpassHzBits.load(std::memory_order_relaxed));
  snapshot.upmix.surroundGain = floatFromBits(surroundGainBits.load(std::memory_order_relaxed));
  snapshot.upmix.sideGain = floatFromBits(sideGainBits.load(std::memory_order_relaxed));
  snapshot.upmix.surroundDelayMs = floatFromBits(surroundDelayMsBits.load(std::memory_order_relaxed));

  const uint64_t after = sequence.load(std::memory_order_acquire);
  if (before != after || (after & 1U) != 0U) return false;
  snapshot.revision = after;
  *command = snapshot;
  return after != 0;
}

AudioPipeline::~AudioPipeline() {
  stop();
}

std::shared_ptr<AudioPipeline::DecodeStream> AudioPipeline::makeDecodeStream() {
  return std::shared_ptr<DecodeStream>(
      new DecodeStream(),
      [](DecodeStream* stream) {
        decodeStreamReaper().retire(std::unique_ptr<DecodeStream>(stream));
      });
}

AudioPipeline::DecodeStreamReaper& AudioPipeline::decodeStreamReaper() {
  static DecodeStreamReaper reaper;
  return reaper;
}

bool AudioPipeline::retireDecodeStreamLocked(std::shared_ptr<DecodeStream> stream) {
  if (!stream) return true;
  stream->requestStop();
  if (retiredStreamCount_ >= retiredStreams_.size()) {
    deferredRetiredStreams_.push_back(std::move(stream));
    return true;
  }
  retiredStreams_[retiredStreamCount_++] = std::move(stream);
  return true;
}

void AudioPipeline::cleanupRetiredDecodeStreams() const {
  if (renderState_.load(std::memory_order_acquire) != PipelineState::Stopped) return;
  std::array<std::shared_ptr<DecodeStream>, kRetiredStreamSlots> retired;
  std::vector<std::shared_ptr<DecodeStream>> deferred;
  size_t retiredCount = 0;
  {
    std::lock_guard lock(mutex_);
    retiredCount = retiredStreamCount_;
    for (size_t i = 0; i < retiredCount; ++i) {
      retired[i] = std::move(retiredStreams_[i]);
    }
    retiredStreamCount_ = 0;
    deferred.swap(deferredRetiredStreams_);
  }
  for (size_t i = 0; i < retiredCount; ++i) {
    if (retired[i]) retired[i]->stop();
  }
  for (const auto& stream : deferred) {
    if (stream) stream->stop();
  }
}

void AudioPipeline::tryCleanupRetiredDecodeStreams() const {
  if (renderState_.load(std::memory_order_acquire) != PipelineState::Stopped) return;
  std::array<std::shared_ptr<DecodeStream>, kRetiredStreamSlots> retired;
  std::vector<std::shared_ptr<DecodeStream>> deferred;
  size_t retiredCount = 0;
  {
    std::unique_lock lock(mutex_, std::try_to_lock);
    if (!lock.owns_lock()) return;
    retiredCount = retiredStreamCount_;
    for (size_t i = 0; i < retiredCount; ++i) {
      retired[i] = std::move(retiredStreams_[i]);
    }
    retiredStreamCount_ = 0;
    deferred.swap(deferredRetiredStreams_);
  }
  for (size_t i = 0; i < retiredCount; ++i) {
    if (retired[i]) retired[i]->stop();
  }
  for (const auto& stream : deferred) {
    if (stream) stream->stop();
  }
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
    bool allowNativeDsd,
    bool allowDop,
    const std::string& forcedDsdFallbackReason,
    std::string* error) {
  stop();
  if (item.source.empty()) return TAE_RESULT_INVALID_ARGUMENT;
  const double requestedPlaybackVolume = std::clamp(volume, 0.0, 1.0);
  if (std::abs(loadAtomicDouble(requestedVolumeBits_, std::memory_order_acquire) - requestedPlaybackVolume) >
      kUnityVolumeEpsilon) {
    setVolume(requestedPlaybackVolume);
  }

  OutputConfig outputConfig;
  {
    std::lock_guard lock(mutex_);
    outputConfig = outputConfig_;
  }

  const DspConfig requestedDspConfig = DspChain::parseConfigJson(dspConfigJson);
  const bool processingRequiresPcm =
      dspConfigProcessingRequiresPcm(requestedDspConfig, outputConfig, requestedPlaybackVolume);

  crossfadeMixActive_ = false;
  crossfadeFramesProcessed_ = 0;
  crossfadeTotalFrames_ = 0;

  std::optional<DsdStreamInfo> dsdProbe;
  if (sourceLooksDsfOrDff(item.source) || sourceLooksSacdIso(item.source)) {
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
                             requestedPlaybackVolume,
                             backendId);
  const bool canTryNativeDsd =
      allowNativeDsd && shouldAttemptNativeDsdForCurrentConfig(
                            requestedDspConfig,
                            outputConfig,
                            dsdProbe,
                            requestedPlaybackVolume,
                            backendId);

  std::shared_ptr<DecodeStream> active;
  std::unique_ptr<IOutputBackend> output;
  AudioFormat outputFormat;
  bool dopPath = false;
  bool nativeDsdPath = false;
  std::string nativeAttemptError;
  std::string dopAttemptError;

  if (canTryNativeDsd) {
    auto nativeActive = makeDecodeStream();
    if (nativeActive->openNativeDsdSource(item, &nativeAttemptError)) {
      output = backendFactoryOverride() ? backendFactoryOverride()(backendId) : createOutputBackend(backendId);
      if (!output) {
        nativeAttemptError = "请求的音频输出后端不可用：" + backendId;
      } else if (!output->setOutputConfig(outputConfig, &nativeAttemptError)) {
        output.reset();
      } else {
        AudioFormat requested = nativeDsdFormatForStream(dsdProbe.value());
        if (output->open(deviceId, requested, &nativeAttemptError)) {
          outputFormat = output->outputFormat();
          const NativeDsdRuntimeFacts nativeFacts = output->nativeDsdRuntimeFacts();
          if (nativeDsdOutputMatchesRequested(outputFormat, requested, nativeFacts) &&
              nativeActive->configure(outputFormat, startTimeSeconds, &nativeAttemptError)) {
            active = nativeActive;
            nativeDsdPath = true;
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

  if (canTryDop && !active) {
    auto dopActive = makeDecodeStream();
    if (dopActive->openDsdSource(item, &dopAttemptError)) {
      output = backendFactoryOverride() ? backendFactoryOverride()(backendId) : createOutputBackend(backendId);
      if (!output) {
        dopAttemptError = "请求的音频输出后端不可用：" + backendId;
      } else if (!output->setOutputConfig(outputConfig, &dopAttemptError)) {
        output.reset();
      } else {
        AudioFormat requested =
            dopCarrierFormatForDsd(dsdProbe->dsdRate, dsdProbe->dsdSampleRate, dsdProbe->channelCount).value();
        requested.sampleFormat = AudioSampleFormat::Int24Interleaved;
        if (output->open(deviceId, requested, &dopAttemptError)) {
          outputFormat = output->outputFormat();
          if (formatCanCarryDop(outputFormat, dsdProbe->dsdRate, dsdProbe->dsdSampleRate, dsdProbe->channelCount) &&
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
    active = makeDecodeStream();
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
    AudioFormat requestedPcmFormat =
        active->stream.isDsd ? pcmFallbackRequestFormat(active->stream, dsdProbe) : active->stream.sourceFormat;

    switch (outputConfig.routingMode) {
      case ChannelRoutingMode::MonoToStereo:
      case ChannelRoutingMode::Stereo:
        requestedPcmFormat.channelCount = 2;
        break;
      case ChannelRoutingMode::StereoTo51:
        requestedPcmFormat.channelCount = 6;
        break;
      case ChannelRoutingMode::StereoTo71:
        requestedPcmFormat.channelCount = 8;
        break;
      default:
        break;
    }
    if (!output->open(deviceId, requestedPcmFormat, error)) {
      return TAE_RESULT_BACKEND_UNAVAILABLE;
    }

    outputFormat = output->outputFormat();
    const bool canUseTypedPassthrough =
        !active->stream.isDsd && !processingRequiresPcm && backendCanTypedPassthrough(backendId) &&
        formatCanTypedPassthrough(active->stream.sourceFormat) &&
        pcmFormatsExactMatch(active->stream.sourceFormat, outputFormat);
    AudioFormat decodeFormat = outputFormat;
    if (outputConfig.routingMode != ChannelRoutingMode::Auto) {
      decodeFormat.channelCount = std::max(1, active->stream.sourceFormat.channelCount);
    }

    if (!active->configure(decodeFormat, startTimeSeconds, error, canUseTypedPassthrough)) {
      output->close();
      return TAE_RESULT_INTERNAL_ERROR;
    }

    if (active->stream.isDsd) {
      active->stream.dsdMode = DsdMode::Pcm;
      dopAttemptError = determineDsdPcmFallbackReason(
          requestedDspConfig,
          outputConfig,
          active->stream,
          requestedPlaybackVolume,
          forcedDsdFallbackReason.empty()
              ? (!nativeAttemptError.empty() ? nativeAttemptError : dopAttemptError)
              : forcedDsdFallbackReason,
          dsdOutputModeRequestsDop(requestedDspConfig.dsdOutputMode));
    }
  }

  if (dopPath) {
    const DopRuntimeFacts dopFacts = output->dopRuntimeFacts();
    if (dopRuntimeFactsRequirePcmFallback(dopFacts)) {
      const std::string fallbackReason = dopPcmFallbackReason(dopFacts);
      output->close();
      return playInternal(
          item,
          upcomingItem,
          startTimeSeconds,
          backendId,
          deviceId,
          requestedPlaybackVolume,
          dspConfigJson,
          gaplessEnabled,
          false,
          false,
          fallbackReason,
          error);
    }
  }

  if (nativeDsdPath) {
    const NativeDsdRuntimeFacts nativeFacts = output->nativeDsdRuntimeFacts();
    if (nativeDsdRuntimeFactsRequirePcmFallback(nativeFacts)) {
      const std::string fallbackReason = nativeDsdPcmFallbackReason(nativeFacts);
      output->close();
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
          true,
          fallbackReason,
          error);
    }
  }

  {
    std::lock_guard lock(mutex_);
    output_ = std::move(output);
    activeStream_ = active;
    preloadStream_.reset();
    stream_ = activeStream_->stream;
    outputFormat_ = outputFormat;
    decodeFormat_ = outputFormat;
    if (outputConfig.routingMode != ChannelRoutingMode::Auto) {
      decodeFormat_.channelCount = std::max(1, stream_.sourceFormat.channelCount);
    }
    // Allocate routing state before the callback starts. Runtime route changes
    // are delivered through the SPSC queue and do not resize these buffers.
    channelRouter_.setUpmixConfig(upmixConfigFromOutputConfig(outputConfig));
    channelRouter_.prepareForRealtime(outputFormat_.sampleRate, 1000.0f);
    channelRouter_.reset();
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
    dspChain_.prepare(decodeFormat_);
    dspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
    preloadDspChain_.configure(dspConfig_);
    preloadDspChain_.prepare(decodeFormat_);
    preloadDspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
    dspStatus_ = dspChain_.status();
    dspActive_ = dspStatus_.dspActive || std::abs(requestedPlaybackVolume - 1.0) > 0.0001;
    spectrum_.prepare(outputFormat_, visualizationFftResolutionForConfig(dspConfig_.fftResolution));
    spectrum_.setEnabled(dspConfig_.fftEnabled);
    gaplessEnabled_ = gaplessEnabled && !dopPath && !nativeDsdPath && !activeStream_->typedPassthrough;
    dopPathActive_ = dopPath;
    nativeDsdPathActive_ = nativeDsdPath;
    typedPassthroughActive_ = !dopPath && activeStream_->typedPassthrough;
    activeUsesPreloadDspChain_ = false;
    const size_t maxRenderFrames = outputInfo_.bufferSizeFrames > 0
                                       ? static_cast<size_t>(outputInfo_.bufferSizeFrames)
                                       : static_cast<size_t>(std::max(1, outputFormat_.sampleRate / 100));
    prepareRenderScratchLocked(maxRenderFrames);
    if (activeStream_) activeStream_->prepareFloatReadScratch(maxRenderFrames);
    if (preloadStream_) preloadStream_->prepareFloatReadScratch(maxRenderFrames);
    updatePerfectLocked();
    state_ = PipelineState::Playing;
    renderedFrames_ = static_cast<uint64_t>(
        std::max(0.0, startTimeSeconds) * static_cast<double>(positionSampleRateForStream(stream_, outputFormat_)));
    ended_ = false;
    deviceInvalidated_ = false;
    trackStarted_ = false;
    outputEventMessage_.clear();
    preloadDspStatus_ = preloadDspChain_.status();
    renderChannelCount_ = std::max(1, outputFormat_.channelCount);
    renderOutputFormat_ = outputFormat_;
    renderDecodeFormat_ = decodeFormat_;
    renderActiveStream_.store(activeStream_.get(), std::memory_order_release);
    renderPreloadStream_.store(nullptr, std::memory_order_release);
    renderGaplessEnabled_.store(gaplessEnabled_, std::memory_order_release);
    renderDopPathActive_.store(dopPathActive_, std::memory_order_release);
    renderNativeDsdPathActive_.store(nativeDsdPathActive_, std::memory_order_release);
    renderTypedPassthroughActive_.store(typedPassthroughActive_, std::memory_order_release);
    renderActiveUsesPreloadDspChain_.store(false, std::memory_order_release);
    renderPromotionPending_.store(false, std::memory_order_release);
    renderCrossfadeResetRequested_.store(false, std::memory_order_release);
    renderRoutingMode_.store(static_cast<uint32_t>(outputConfig_.routingMode), std::memory_order_release);
    storeAtomicDouble(renderCrossfadeSecondsBits_, dspConfig_.crossfadeSeconds, std::memory_order_release);
    renderCrossfadeMixActive_ = false;
    renderCrossfadeFramesProcessed_ = 0;
    renderCrossfadeTotalFrames_ = 0;
    renderState_.store(PipelineState::Playing, std::memory_order_release);
    publishStatusLocked();
  }

  const size_t prerollFrames = outputInfo_.bufferSizeFrames > 0
                                   ? static_cast<size_t>(outputInfo_.bufferSizeFrames)
                                   : static_cast<size_t>(std::max(1, outputFormat_.sampleRate / 100));
  active->start();
  active->waitForPreroll(prerollFrames, std::chrono::milliseconds(500));
  if (gaplessEnabled && !dopPath && !nativeDsdPath && !active->typedPassthrough) {
    std::string preloadError;
    preloadNext(upcomingItem, &preloadError);
  }

  auto eventCallback = [this](OutputBackendEvent event, const std::string& message) {
    std::lock_guard lock(mutex_);
    outputEventMessage_ = message;
    if (event == OutputBackendEvent::DeviceInvalidated) {
      deviceInvalidated_ = true;
    } else if (event == OutputBackendEvent::RenderError) {
      renderError_ = true;
    }
    state_ = PipelineState::Stopped;
    renderState_.store(PipelineState::Stopped, std::memory_order_release);
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
    if (dopRuntimeFactsRequirePcmFallback(dopFacts)) {
      const std::string fallbackReason = dopPcmFallbackReason(dopFacts);
      stop();
      return playInternal(
          item,
          upcomingItem,
          startTimeSeconds,
          backendId,
          deviceId,
          requestedPlaybackVolume,
          dspConfigJson,
          gaplessEnabled,
          false,
          false,
          fallbackReason,
          error);
    }
  }

  if (nativeDsdPath) {
    const NativeDsdRuntimeFacts nativeFacts = output_->nativeDsdRuntimeFacts();
    if (nativeDsdRuntimeFactsRequirePcmFallback(nativeFacts)) {
      const std::string fallbackReason = nativeDsdPcmFallbackReason(nativeFacts);
      stop();
      return playInternal(
          item,
          upcomingItem,
          startTimeSeconds,
          backendId,
          deviceId,
          requestedPlaybackVolume,
          dspConfigJson,
          gaplessEnabled,
          false,
          true,
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
  if (dspConfigProcessingRequiresPcm(dspConfig, outputConfig, volume)) return false;
  if (!backendCanAttemptDop(backendId)) return false;
  return dopCarrierFormatForDsd(dsdProbe->dsdRate, dsdProbe->dsdSampleRate, dsdProbe->channelCount).has_value();
}

bool AudioPipeline::shouldAttemptNativeDsdForCurrentConfig(
    const DspConfig& dspConfig,
    const OutputConfig& outputConfig,
    const std::optional<DsdStreamInfo>& dsdProbe,
    double volume,
    const std::string& backendId) const {
  if (!dsdProbe.has_value()) return false;
  if (!dsdOutputModeRequestsNative(dspConfig.dsdOutputMode)) return false;
  if (dspConfigProcessingRequiresPcm(dspConfig, outputConfig, volume)) return false;
  if (!backendCanAttemptNativeDsd(backendId)) return false;
  return dsdProbe->dsdRate == 64 || dsdProbe->dsdRate == 128 || dsdProbe->dsdRate == 256 ||
         dsdProbe->dsdRate == 512;
}

std::string AudioPipeline::determineDsdPcmFallbackReason(
    const DspConfig& dspConfig,
    const OutputConfig& outputConfig,
    const AudioStreamInfo& stream,
    double volume,
    const std::string& attemptedDopReason,
    bool dopModeRequested) const {
  if (dspConfigProcessingRequiresPcm(dspConfig, outputConfig, volume)) {
    return "DSD processing active; falling back to PCM";
  }
  if (dspConfig.dsdOutputMode == DsdOutputMode::Pcm) return "DSD output mode forced PCM";
  if (!attemptedDopReason.empty()) return attemptedDopReason;
  if (dspConfig.dsdOutputMode == DsdOutputMode::Native) return "ASIO Native DSD could not prove raw DSD output";
  if (stream.dsdRate >= 256) {
    return "DSD" + std::to_string(stream.dsdRate) + " currently falls back to PCM";
  }
  if (dopModeRequested) return "DoP backend could not prove passthrough";
  return "DSD converted to PCM";
}

TAE_Result AudioPipeline::togglePause() {
  std::lock_guard lock(mutex_);
  if (state_ == PipelineState::Playing) {
    state_ = PipelineState::Paused;
    renderState_.store(PipelineState::Paused, std::memory_order_release);
    spectrum_.resetCapture();
  } else if (state_ == PipelineState::Paused) {
    state_ = PipelineState::Playing;
    renderState_.store(PipelineState::Playing, std::memory_order_release);
  }
  publishStatusLocked();
  return TAE_RESULT_OK;
}

TAE_Result AudioPipeline::stop() {
  std::unique_ptr<IOutputBackend> output;
  std::shared_ptr<DecodeStream> active;
  std::shared_ptr<DecodeStream> preload;
  std::array<std::shared_ptr<DecodeStream>, kRetiredStreamSlots> retired;
  std::vector<std::shared_ptr<DecodeStream>> deferred;
  size_t retiredCount = 0;
  {
    std::lock_guard lock(mutex_);
    state_ = PipelineState::Stopped;
    renderState_.store(PipelineState::Stopped, std::memory_order_release);
    output = std::move(output_);
    active = std::move(activeStream_);
    preload = std::move(preloadStream_);
    retiredCount = retiredStreamCount_;
    for (size_t i = 0; i < retiredCount; ++i) {
      retired[i] = std::move(retiredStreams_[i]);
    }
    retiredStreamCount_ = 0;
    deferred.swap(deferredRetiredStreams_);
  }

  if (output) {
    output->stop();
    output->close();
  }
  if (active) active->stop();
  if (preload) preload->stop();
  for (size_t i = 0; i < retiredCount; ++i) {
    if (retired[i]) retired[i]->stop();
  }
  for (const auto& stream : deferred) {
    if (stream) stream->stop();
  }

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
    renderChannelCount_ = 2;
    renderOutputFormat_ = {};
    renderDecodeFormat_ = {};
    renderActiveStream_.store(nullptr, std::memory_order_release);
    renderPreloadStream_.store(nullptr, std::memory_order_release);
    renderGaplessEnabled_.store(true, std::memory_order_release);
    renderDopPathActive_.store(false, std::memory_order_release);
    renderNativeDsdPathActive_.store(false, std::memory_order_release);
    renderTypedPassthroughActive_.store(false, std::memory_order_release);
    renderActiveUsesPreloadDspChain_.store(false, std::memory_order_release);
    renderPromotionPending_.store(false, std::memory_order_release);
    renderCrossfadeResetRequested_.store(false, std::memory_order_release);
    renderRoutingMode_.store(static_cast<uint32_t>(ChannelRoutingMode::Auto), std::memory_order_release);
    storeAtomicDouble(renderCrossfadeSecondsBits_, 0.0, std::memory_order_release);
    renderCrossfadeMixActive_ = false;
    renderCrossfadeFramesProcessed_ = 0;
    renderCrossfadeTotalFrames_ = 0;
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
    nativeDsdPathActive_ = false;
    typedPassthroughActive_ = false;
    activeUsesPreloadDspChain_ = false;
    crossfadeMixActive_ = false;
    crossfadeFramesProcessed_ = 0;
    crossfadeTotalFrames_ = 0;
    preloadDspStatus_ = {};
    spectrum_.resetCapture();
    publishStatusLocked();
  }
  return TAE_RESULT_OK;
}

TAE_Result AudioPipeline::seek(double seconds, std::string* error) {
  std::shared_ptr<DecodeStream> active;
  {
    std::lock_guard lock(mutex_);
    synchronizeRenderPromotionLocked();
    if (!activeStream_ || outputFormat_.sampleRate <= 0) return TAE_RESULT_NOT_INITIALIZED;
    active = activeStream_;
  }

  if (!active->seek(seconds, error)) return TAE_RESULT_INTERNAL_ERROR;

  {
    std::lock_guard lock(mutex_);
    renderedFrames_ = static_cast<uint64_t>(
        std::max(0.0, seconds) * static_cast<double>(positionSampleRateForStream(stream_, outputFormat_)));
    ended_ = false;
    DspChain& activeDspChain = activeDspChainLocked();
    activeDspChain.setTrackContext(DspTrackContext{stream_, currentItem_});
    dspStatus_ = activeDspChain.status();
    dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
    updatePerfectLocked();
    publishStatusLocked();
  }
  return TAE_RESULT_OK;
}

void AudioPipeline::setVolume(double volume) {
  const double requested = std::clamp(volume, 0.0, 1.0);
  storeAtomicDouble(requestedVolumeBits_, requested, std::memory_order_release);
  const uint64_t revision = requestedConfigRevision_.fetch_add(1, std::memory_order_acq_rel) + 1;
  enqueueControlCommand(ControlCommand{ControlCommandType::Volume, requested, revision});
}

void AudioPipeline::enqueueControlCommand(const ControlCommand& command) noexcept {
  if (controlCommands_.push(command)) return;
  if (command.type == ControlCommandType::Volume) {
    latestOverflowCommand_.publish(command);
  } else if (command.type == ControlCommandType::Routing) {
    latestRoutingCommand_.publish(command);
  }
}

void AudioPipeline::applyControlCommand(const ControlCommand& command) noexcept {
  if (command.type == ControlCommandType::Volume) {
    if (command.revision <= appliedConfigRevision_.load(std::memory_order_relaxed)) return;
    storeAtomicDouble(appliedVolumeBits_, command.volume, std::memory_order_relaxed);
    appliedConfigRevision_.store(command.revision, std::memory_order_release);
    return;
  }
  if (command.type == ControlCommandType::Routing) {
    renderRoutingMode_.store(static_cast<uint32_t>(command.routingMode), std::memory_order_release);
    channelRouter_.setUpmixConfig(command.upmix);
  }
}

void AudioPipeline::applyPendingControlCommands() noexcept {
  ControlCommand command;
  for (size_t processed = 0; processed < kControlCommandCapacity; ++processed) {
    if (!controlCommands_.pop(command)) break;
    applyControlCommand(command);
  }
  if (latestOverflowCommand_.read(&command)) applyControlCommand(command);
  if (latestRoutingCommand_.read(&command) && command.revision != appliedLatestRoutingSequence_) {
    applyControlCommand(command);
    appliedLatestRoutingSequence_ = command.revision;
  }
}

void AudioPipeline::setDspConfig(const std::string& dspConfigJson) {
  std::shared_ptr<DecodeStream> disabledPreload;
  const DspConfig nextConfig = DspChain::parseConfigJson(dspConfigJson);
  {
    std::lock_guard lock(mutex_);
    synchronizeRenderPromotionLocked();
    dspConfig_ = nextConfig;
    gaplessEnabled_ = !dopPathActive_ && !nativeDsdPathActive_ && !typedPassthroughActive_ && dspConfig_.gapless;
    renderGaplessEnabled_.store(gaplessEnabled_, std::memory_order_release);
    storeAtomicDouble(renderCrossfadeSecondsBits_, dspConfig_.crossfadeSeconds, std::memory_order_release);
    if (!gaplessEnabled_) {
      disabledPreload = std::move(preloadStream_);
      renderPreloadStream_.store(nullptr, std::memory_order_release);
      crossfadeMixActive_ = false;
      crossfadeFramesProcessed_ = 0;
      crossfadeTotalFrames_ = 0;
      renderCrossfadeResetRequested_.store(true, std::memory_order_release);
    }
    DspChain& activeDspChain = activeDspChainLocked();
    DspChain& spareDspChain = spareDspChainLocked();
    activeDspChain.configure(dspConfig_);
    spareDspChain.configure(dspConfig_);
    if (decodeFormat_.sampleRate > 0 && decodeFormat_.channelCount > 0) {
      activeDspChain.prepare(decodeFormat_);
      activeDspChain.setTrackContext(DspTrackContext{stream_, currentItem_});
      spareDspChain.prepare(decodeFormat_);
      const DspTrackContext preloadContext =
          preloadStream_ ? DspTrackContext{preloadStream_->stream, preloadStream_->item}
                         : DspTrackContext{stream_, currentItem_};
      spareDspChain.setTrackContext(preloadContext);
    }
    if (outputFormat_.sampleRate > 0 && outputFormat_.channelCount > 0) {
      spectrum_.prepare(outputFormat_, visualizationFftResolutionForConfig(dspConfig_.fftResolution));
    }
    spectrum_.setEnabled(dspConfig_.fftEnabled);
    dspStatus_ = activeDspChain.status();
    preloadDspStatus_ = spareDspChain.status();
    dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
    updatePerfectLocked();
    publishStatusLocked();
  }
  if (disabledPreload) {
    std::lock_guard lock(mutex_);
    retireDecodeStreamLocked(std::move(disabledPreload));
  }
}

bool AudioPipeline::setOutputConfig(const OutputConfig& config, std::string* error) {
  std::lock_guard lock(mutex_);
  synchronizeRenderPromotionLocked();
  outputConfig_ = config;
  const ControlCommand routingCommand{
      ControlCommandType::Routing,
      1.0,
      0,
      outputConfig_.routingMode,
      upmixConfigFromOutputConfig(outputConfig_)};
  if (renderState_.load(std::memory_order_acquire) == PipelineState::Stopped) {
    renderRoutingMode_.store(static_cast<uint32_t>(routingCommand.routingMode), std::memory_order_release);
    channelRouter_.setUpmixConfig(routingCommand.upmix);
  } else {
    enqueueControlCommand(routingCommand);
  }
  if (output_ && !output_->setOutputConfig(outputConfig_, error)) return false;
  if (output_) {
    outputInfo_ = output_->outputInfo();
    updatePerfectLocked();
  }
  publishStatusLocked();
  return true;
}

bool AudioPipeline::loadImpulseResponse(const std::string& path, std::string* error) {
  std::lock_guard lock(mutex_);
  DspChain& activeDspChain = activeDspChainLocked();
  DspChain& spareDspChain = spareDspChainLocked();
  const bool ok = activeDspChain.loadImpulseResponse(path, error);
  if (ok) {
    std::string spareError;
    spareDspChain.loadImpulseResponse(path, &spareError);
  }
  dspStatus_ = activeDspChain.status();
  preloadDspStatus_ = spareDspChain.status();
  dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
  updatePerfectLocked();
  publishStatusLocked();
  return ok;
}

void AudioPipeline::unloadImpulseResponse() {
  std::lock_guard lock(mutex_);
  DspChain& activeDspChain = activeDspChainLocked();
  DspChain& spareDspChain = spareDspChainLocked();
  activeDspChain.unloadImpulseResponse();
  spareDspChain.unloadImpulseResponse();
  dspStatus_ = activeDspChain.status();
  preloadDspStatus_ = spareDspChain.status();
  dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
  updatePerfectLocked();
  publishStatusLocked();
}

ConvolverInfo AudioPipeline::convolverInfo() const {
  std::lock_guard lock(mutex_);
  return activeDspChainLocked().convolverInfo();
}

bool AudioPipeline::setEqBands(const std::string& json, std::string* error) {
  std::lock_guard lock(mutex_);
  DspChain& activeDspChain = activeDspChainLocked();
  DspChain& spareDspChain = spareDspChainLocked();
  const bool ok = activeDspChain.setEqBandsFromJson(json, error);
  if (ok) spareDspChain.setEqBandsFromJson(json, error);
  dspStatus_ = activeDspChain.status();
  preloadDspStatus_ = spareDspChain.status();
  dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
  updatePerfectLocked();
  publishStatusLocked();
  return ok;
}

bool AudioPipeline::setEqPreset(const std::string& json, std::string* error) {
  std::lock_guard lock(mutex_);
  DspChain& activeDspChain = activeDspChainLocked();
  DspChain& spareDspChain = spareDspChainLocked();
  const bool ok = activeDspChain.setEqPresetFromJson(json, error);
  if (ok) spareDspChain.setEqPresetFromJson(json, error);
  dspStatus_ = activeDspChain.status();
  preloadDspStatus_ = spareDspChain.status();
  dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
  updatePerfectLocked();
  publishStatusLocked();
  return ok;
}

void AudioPipeline::setCrossfeedStrength(double strength) {
  std::lock_guard lock(mutex_);
  DspChain& activeDspChain = activeDspChainLocked();
  DspChain& spareDspChain = spareDspChainLocked();
  activeDspChain.setCrossfeedStrength(strength);
  spareDspChain.setCrossfeedStrength(strength);
  dspStatus_ = activeDspChain.status();
  preloadDspStatus_ = spareDspChain.status();
  dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
  updatePerfectLocked();
  publishStatusLocked();
}

void AudioPipeline::setReplayGainMode(ReplayGainMode mode, double preampDb, double fallbackDb, bool clip) {
  std::lock_guard lock(mutex_);
  DspChain& activeDspChain = activeDspChainLocked();
  DspChain& spareDspChain = spareDspChainLocked();
  activeDspChain.setReplayGainMode(mode, preampDb, fallbackDb, clip);
  spareDspChain.setReplayGainMode(mode, preampDb, fallbackDb, clip);
  dspStatus_ = activeDspChain.status();
  preloadDspStatus_ = spareDspChain.status();
  dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
  updatePerfectLocked();
  publishStatusLocked();
}

void AudioPipeline::setNativeDspPluginChain(const std::string& json) {
  std::lock_guard lock(mutex_);
  dspChain_.setNativeDspPluginChain(json);
  preloadDspChain_.setNativeDspPluginChain(json);
  dspStatus_ = activeDspChainLocked().status();
  preloadDspStatus_ = spareDspChainLocked().status();
  dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
  updatePerfectLocked();
  publishStatusLocked();
}

std::string AudioPipeline::nativeDspPluginStatusJson() const {
  std::lock_guard lock(mutex_);
  return activeDspChainLocked().nativeDspPluginStatusJson();
}

bool AudioPipeline::preloadNext(const std::optional<QueueItem>& item, std::string* error) {
  cleanupRetiredDecodeStreams();

  if (!item || item->source.empty()) {
    std::shared_ptr<DecodeStream> previous;
    {
      std::lock_guard lock(mutex_);
      synchronizeRenderPromotionLocked();
      previous = std::move(preloadStream_);
      renderPreloadStream_.store(nullptr, std::memory_order_release);
      preloadDspStatus_ = {};
      publishStatusLocked();
    }
    if (previous) {
      std::lock_guard lock(mutex_);
      retireDecodeStreamLocked(std::move(previous));
    }
    return true;
  }

  AudioFormat outputFormat;
  bool gapless = false;
  uint32_t bufferSizeFrames = 0;
  {
    std::lock_guard lock(mutex_);
    synchronizeRenderPromotionLocked();
    if (preloadStream_ && preloadStream_->item.source == item->source) return true;
    outputFormat = outputFormat_;
    gapless = gaplessEnabled_;
    bufferSizeFrames = outputInfo_.bufferSizeFrames;
  }
  if (!gapless || outputFormat.sampleRate <= 0 || outputFormat.channelCount <= 0) return false;

  auto stream = makeDecodeStream();
  if (!stream->openSource(*item, error)) return false;
  if (!stream->configure(outputFormat, 0.0, error)) return false;
  const size_t maxRenderFrames = bufferSizeFrames > 0
                                     ? static_cast<size_t>(bufferSizeFrames)
                                     : static_cast<size_t>(std::max(1, outputFormat.sampleRate / 100));
  stream->prepareFloatReadScratch(maxRenderFrames);
  stream->start();

  std::shared_ptr<DecodeStream> previous;
  {
    std::lock_guard lock(mutex_);
    synchronizeRenderPromotionLocked();
    previous = std::move(preloadStream_);
    preloadStream_ = std::move(stream);
    DspChain& spareDspChain = spareDspChainLocked();
    spareDspChain.configure(dspConfig_);
    spareDspChain.prepare(outputFormat_);
    spareDspChain.setTrackContext(DspTrackContext{preloadStream_->stream, preloadStream_->item});
    preloadDspStatus_ = spareDspChain.status();
    renderPreloadStream_.store(preloadStream_.get(), std::memory_order_release);
    publishStatusLocked();
  }
  if (previous) {
    std::lock_guard lock(mutex_);
    retireDecodeStreamLocked(std::move(previous));
  }
  return true;
}

bool AudioPipeline::skipToPreloaded(const QueueItem& item, std::string* error) {
  std::shared_ptr<DecodeStream> oldActive;
  {
    std::lock_guard lock(mutex_);
    synchronizeRenderPromotionLocked();
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
    renderActiveStream_.store(activeStream_.get(), std::memory_order_release);
    renderPreloadStream_.store(nullptr, std::memory_order_release);
    stream_ = activeStream_->stream;
    currentItem_ = activeStream_->item;
    renderedFrames_ = 0;
    ended_ = false;
    trackStarted_ = true;
    activeUsesPreloadDspChain_ = !activeUsesPreloadDspChain_;
    renderActiveUsesPreloadDspChain_.store(activeUsesPreloadDspChain_, std::memory_order_release);
    dspStatus_ = preloadDspStatus_;
    preloadDspStatus_ = {};
    dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
    crossfadeMixActive_ = false;
    crossfadeFramesProcessed_ = 0;
    crossfadeTotalFrames_ = 0;
    renderCrossfadeResetRequested_.store(true, std::memory_order_release);
    updatePerfectLocked();
    publishStatusLocked();
  }
  if (oldActive) {
    std::lock_guard lock(mutex_);
    retireDecodeStreamLocked(std::move(oldActive));
  }
  return true;
}

PipelineStatus AudioPipeline::buildStatusLocked() {
  PipelineStatus status;
  status.state = state_;
  const int positionSampleRate = positionSampleRateForStream(stream_, outputFormat_);
  status.positionSeconds =
      positionSampleRate > 0
          ? static_cast<double>(renderedFrames_.load()) / static_cast<double>(positionSampleRate)
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
  status.nativeDspActive = dspStatus_.nativeDspActive;
  status.crossfadeActive = dspStatus_.crossfadeActive || dspConfig_.crossfadeSeconds > 0.0001;
  status.fftActive = spectrum_.isActive();
  status.irResampled = dspStatus_.irResampled;
  status.replayGainDb = dspStatus_.replayGainDb;
  status.crossfeedStrength = dspStatus_.crossfeedStrength;
  status.crossfadeSeconds = status.crossfadeActive ? dspConfig_.crossfadeSeconds : 0.0;
  status.convolverLatencyFrames = dspStatus_.convolverLatencyFrames;
  status.partitionSize = dspStatus_.partitionSize;
  status.channelMappingMode = dspStatus_.channelMappingMode;
  status.nativeDspJson = dspStatus_.nativeDspJson;
  status.sourceExact = outputInfo_.sourceExact;
  status.outputPerfect = outputPerfect_;
  status.gaplessActive =
      gaplessEnabled_ && dspConfig_.crossfadeSeconds <= 0.0001 && preloadStream_ != nullptr && !crossfadeMixActive_;
  status.preloadReady = preloadStream_ && preloadStream_->readyForRender();
  status.perfectReason = perfectReason_;
  status.requestedConfigRevision = requestedConfigRevision_.load(std::memory_order_acquire);
  status.appliedConfigRevision = appliedConfigRevision_.load(std::memory_order_acquire);
  return status;
}

PipelineStatus AudioPipeline::fallbackStatus() const {
  std::lock_guard lock(statusMutex_);
  PipelineStatus status = lastStatus_;
  const int positionSampleRate = positionSampleRateForStream(status.stream, status.outputFormat);
  status.positionSeconds =
      positionSampleRate > 0
          ? static_cast<double>(renderedFrames_.load()) / static_cast<double>(positionSampleRate)
          : 0.0;
  status.requestedConfigRevision = requestedConfigRevision_.load(std::memory_order_acquire);
  status.appliedConfigRevision = appliedConfigRevision_.load(std::memory_order_acquire);
  return status;
}

void AudioPipeline::publishStatusLocked() {
  PipelineStatus status = buildStatusLocked();
  std::lock_guard lock(statusMutex_);
  lastStatus_ = std::move(status);
}

PipelineStatus AudioPipeline::status() {
  const bool requiresFreshStatus =
      ended_.load() || deviceInvalidated_.load() || renderError_.load() || trackStarted_.load();
  if (requiresFreshStatus) {
    cleanupRetiredDecodeStreams();
  } else {
    tryCleanupRetiredDecodeStreams();
  }

  std::unique_lock lock(mutex_, std::try_to_lock);
  if (!lock.owns_lock()) {
    if (!requiresFreshStatus) return fallbackStatus();
    lock.lock();
  }
  synchronizeRenderPromotionLocked();
  if (ended_.load(std::memory_order_acquire) && state_ == PipelineState::Playing &&
      renderState_.load(std::memory_order_acquire) == PipelineState::Stopped) {
    state_ = PipelineState::Stopped;
  }
  dspStatus_ = activeDspChainLocked().status();
  dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
  updatePerfectLocked();
  PipelineStatus status = buildStatusLocked();
  {
    std::lock_guard statusLock(statusMutex_);
    lastStatus_ = status;
  }
  return status;
}

bool AudioPipeline::isDopPathActive() const {
  std::lock_guard lock(mutex_);
  return dopPathActive_;
}

bool AudioPipeline::isNativeDsdPathActive() const {
  std::lock_guard lock(mutex_);
  return nativeDsdPathActive_;
}

bool AudioPipeline::needsPcmFallback(std::string* reason) const {
  std::lock_guard lock(mutex_);
  const bool processingActive =
      dspStatus_.replayGainActive || dspStatus_.eqActive || dspStatus_.convolverActive || dspStatus_.crossfeedActive ||
      dspStatus_.nativeDspActive || dspStatus_.crossfadeActive || dspConfig_.crossfadeSeconds > 0.0001 ||
      std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > kUnityVolumeEpsilon ||
      outputConfig_.routingMode != ChannelRoutingMode::Auto;

  if (nativeDsdPathActive_ && stream_.isDsd && stream_.dsdMode == DsdMode::Native) {
    if (output_) {
      const NativeDsdRuntimeFacts facts = output_->nativeDsdRuntimeFacts();
      if (facts.state != NativeDsdRuntimeFactState::Proven) {
        if (reason) {
          *reason = facts.reason.empty() ? "ASIO Native DSD could not prove raw DSD output" : facts.reason;
        }
        return true;
      }
    }
    if (!processingActive) return false;
    if (reason) *reason = "DSD processing active; falling back to PCM";
    return true;
  }

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

bool AudioPipeline::consumeRenderError(std::string* message) {
  if (!renderError_.exchange(false)) return false;
  std::lock_guard lock(mutex_);
  if (message) *message = outputEventMessage_.empty() ? "音频渲染失败" : outputEventMessage_;
  outputEventMessage_.clear();
  return true;
}

bool AudioPipeline::consumeTrackStarted(QueueItem* item) {
  if (!trackStarted_.exchange(false)) return false;
  std::lock_guard lock(mutex_);
  synchronizeRenderPromotionLocked();
  if (item) *item = currentItem_;
  return true;
}

size_t AudioPipeline::getSpectrumData(float* buffer, size_t pointCount) const {
  double sampleRate = 0.0;
  {
    std::lock_guard lock(mutex_);
    sampleRate = positionSampleRateForStream(stream_, outputFormat_);
  }
  const double phase =
      sampleRate > 0.0 ? static_cast<double>(renderedFrames_.load()) / sampleRate : 0.0;
  return spectrum_.read(buffer, pointCount, phase);
}

std::string AudioPipeline::getVisualizationDataJson(
    size_t spectrumPoints,
    size_t waveformPoints,
    size_t spectrogramFrames,
    size_t oscilloscopePoints) const {
  return spectrum_.readVisualizationJson(spectrumPoints, waveformPoints, spectrogramFrames, oscilloscopePoints);
}

bool AudioPipeline::configureActiveStreamLocked(
    const std::shared_ptr<DecodeStream>& stream,
    const QueueItem& item,
    double startTimeSeconds,
    std::string* error) {
  if (!stream) return false;
  if (!stream->openSource(item, error)) return false;
  if (!stream->configure(decodeFormat_, startTimeSeconds, error)) return false;
  return true;
}

bool AudioPipeline::updatePerfectLocked() {
  const OutputInfo backendInfo = output_ ? output_->outputInfo() : outputInfo_;
  const DopRuntimeFacts dopFacts = output_ ? output_->dopRuntimeFacts() : DopRuntimeFacts{};
  const NativeDsdRuntimeFacts nativeDsdFacts =
      output_ ? output_->nativeDsdRuntimeFacts() : unsupportedNativeDsdRuntimeFacts("No output backend is active");
  AudioFormat semanticOutputFormat = actualOutputFormat(outputFormat_, backendInfo);
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
    } else if (stream_.dsdMode == DsdMode::Native) {
      evaluation.nativeDsdRequested = true;
      evaluation.nativeDsdPassthroughProven = nativeDsdFacts.state == NativeDsdRuntimeFactState::Proven;
      if (nativeDsdFacts.state == NativeDsdRuntimeFactState::Proven && nativeDsdFacts.actualDsdRate > 0) {
        semanticOutputFormat.sampleRate = nativeDsdFacts.actualDsdRate;
        evaluation.outputFormat = semanticOutputFormat;
      }
    }
  }
  evaluation.supportsOutputPerfect = backendInfo.supportsOutputPerfect;
  evaluation.backendResampled = backendResampled;
  evaluation.backendPerfectReasonCode = backendInfo.perfectReasonCode;
  evaluation.backendPerfectReason = backendPerfectReason;
  evaluation.volume = loadAtomicDouble(requestedVolumeBits_);
  evaluation.replayGainActive = dspStatus_.replayGainActive;
  evaluation.eqActive = dspStatus_.eqActive;
  evaluation.convolverActive = dspStatus_.convolverActive;
  evaluation.crossfeedActive = dspStatus_.crossfeedActive;
  evaluation.nativeDspActive = dspStatus_.nativeDspActive;
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

DspChain& AudioPipeline::activeDspChainLocked() {
  return activeUsesPreloadDspChain_ ? preloadDspChain_ : dspChain_;
}

const DspChain& AudioPipeline::activeDspChainLocked() const {
  return activeUsesPreloadDspChain_ ? preloadDspChain_ : dspChain_;
}

DspChain& AudioPipeline::spareDspChainLocked() {
  return activeUsesPreloadDspChain_ ? dspChain_ : preloadDspChain_;
}

void AudioPipeline::synchronizeRenderPromotionLocked() {
  if (!renderPromotionPending_.exchange(false, std::memory_order_acq_rel)) return;

  DecodeStream* const promoted = renderActiveStream_.load(std::memory_order_acquire);
  if (!promoted || !preloadStream_ || preloadStream_.get() != promoted) return;

  std::shared_ptr<DecodeStream> previous = std::move(activeStream_);
  activeStream_ = std::move(preloadStream_);
  stream_ = activeStream_->stream;
  currentItem_ = activeStream_->item;
  activeUsesPreloadDspChain_ = renderActiveUsesPreloadDspChain_.load(std::memory_order_acquire);
  dspStatus_ = activeDspChainLocked().status();
  preloadDspStatus_ = {};
  dspActive_ = dspStatus_.dspActive || std::abs(loadAtomicDouble(requestedVolumeBits_) - 1.0) > 0.0001;
  crossfadeMixActive_ = false;
  crossfadeFramesProcessed_ = 0;
  crossfadeTotalFrames_ = 0;
  updatePerfectLocked();
  // The callback has already published the new raw pointer before raising the
  // promotion flag, so releasing the former owner on this control path cannot
  // destroy a stream that is still being rendered.
  previous.reset();
}

void AudioPipeline::prepareRenderScratchLocked(size_t maxFrames) {
  const size_t frames = std::max<size_t>(1, maxFrames);
  const size_t outputChannels = static_cast<size_t>(std::max(1, outputFormat_.channelCount));
  const size_t decodeChannels = static_cast<size_t>(std::max(1, decodeFormat_.channelCount));
  const size_t outputSamples = frames * outputChannels;
  const size_t decodeSamples = frames * decodeChannels;

  routingScratch_.resize(decodeSamples);
  preloadRoutingScratch_.resize(decodeSamples);
  preloadMixScratch_.resize(outputSamples);
  typedVisualizationScratch_.resize(outputSamples);
}

size_t AudioPipeline::renderTyped(PcmBlock& output) {
  if (!output.data || output.frames == 0) return 0;
  applyPendingControlCommands();

  const PipelineState state = renderState_.load(std::memory_order_acquire);
  DecodeStream* const active = renderActiveStream_.load(std::memory_order_acquire);
  const AudioFormat outputFormat = renderOutputFormat_;
  const bool typedPassthroughActive = renderTypedPassthroughActive_.load(std::memory_order_acquire);
  const bool nativeDsdPathActive = renderNativeDsdPathActive_.load(std::memory_order_acquire);

  if (state != PipelineState::Playing || !active) {
    if (typedPassthroughActive && output.byteSize > 0) std::memset(output.data, 0, output.byteSize);
    spectrum_.tryResetCapture();
    return typedPassthroughActive ? output.frames : 0;
  }

  const bool outputMatches =
      isDsdSampleFormat(output.format.sampleFormat) || isDsdSampleFormat(outputFormat.sampleFormat)
          ? dsdFormatsExactMatch(output.format, outputFormat)
          : pcmFormatsExactMatch(output.format, outputFormat);
  const bool bufferMatches =
      isDsdSampleFormat(active->bufferFormat().sampleFormat) || isDsdSampleFormat(output.format.sampleFormat)
          ? dsdFormatsExactMatch(active->bufferFormat(), output.format)
          : pcmFormatsExactMatch(active->bufferFormat(), output.format);
  if (!typedPassthroughActive || !outputMatches || !bufferMatches) {
    if (output.byteSize > 0) std::memset(output.data, 0, output.byteSize);
    return 0;
  }

  const size_t read = active->read(output);
  if (read > 0) {
    renderedFrames_ += dsdRenderedFrameUnits(read, output.format);
    if (nativeDsdPathActive || isDsdSampleFormat(output.format.sampleFormat)) {
      spectrum_.tryResetCapture();
    } else {
      const int channels = std::max(1, output.format.channelCount);
      const size_t visualizationSamples = read * static_cast<size_t>(channels);
      if (typedVisualizationScratch_.size() >= visualizationSamples) {
        PcmBlock captured = output;
        captured.frames = read;
        captured.byteSize = read * audioFormatBytesPerFrame(output.format);
        typedPcmToFloat(captured, typedVisualizationScratch_.data(), read);
        spectrum_.capture(typedVisualizationScratch_.data(), read, channels);
      } else {
        spectrum_.tryResetCapture();
      }
    }
  } else if (active->drained()) {
    ended_ = true;
    renderState_.store(PipelineState::Stopped, std::memory_order_release);
    spectrum_.tryResetCapture();
  } else {
    spectrum_.tryResetCapture();
  }

  if (read > 0 || active->drained()) return output.frames;
  return nativeDsdPathActive || isDsdSampleFormat(output.format.sampleFormat) ? 0 : output.frames;
}

size_t AudioPipeline::render(float* output, size_t frameCount) {
  if (!output || frameCount == 0) return 0;
  applyPendingControlCommands();
  if (renderCrossfadeResetRequested_.exchange(false, std::memory_order_acq_rel)) {
    renderCrossfadeMixActive_ = false;
    renderCrossfadeFramesProcessed_ = 0;
    renderCrossfadeTotalFrames_ = 0;
  }

  const PipelineState state = renderState_.load(std::memory_order_acquire);
  const AudioFormat outputFormat = renderOutputFormat_;
  const AudioFormat decodeFormat = renderDecodeFormat_;
  const int channels = std::max(1, outputFormat.channelCount);
  DecodeStream* active = renderActiveStream_.load(std::memory_order_acquire);
  DecodeStream* preload = renderPreloadStream_.load(std::memory_order_acquire);
  const double crossfadeSeconds = loadAtomicDouble(renderCrossfadeSecondsBits_, std::memory_order_acquire);
  const bool dopPathActive = renderDopPathActive_.load(std::memory_order_acquire);
  bool activeUsesPreloadDspChain = renderActiveUsesPreloadDspChain_.load(std::memory_order_acquire);
  const ChannelRoutingMode routingMode =
      static_cast<ChannelRoutingMode>(renderRoutingMode_.load(std::memory_order_acquire));
  const double volume = loadAtomicDouble(appliedVolumeBits_, std::memory_order_acquire);
  bool crossfadeMixActive = renderCrossfadeMixActive_;
  uint64_t crossfadeFramesProcessed = renderCrossfadeFramesProcessed_;
  uint64_t crossfadeTotalFrames = renderCrossfadeTotalFrames_;

  if (state != PipelineState::Playing || !active) {
    std::fill(output, output + frameCount * static_cast<size_t>(channels), 0.0f);
    spectrum_.tryResetCapture();
    return frameCount;
  }

  const bool wantsCrossfade = crossfadeSeconds > 0.0001;
  DspChain* activeDspChain = activeUsesPreloadDspChain ? &preloadDspChain_ : &dspChain_;
  DspChain* preloadDspChain = activeUsesPreloadDspChain ? &dspChain_ : &preloadDspChain_;
  size_t totalRead = 0;
  size_t positionRead = 0;
  while (totalRead < frameCount) {
    float* segment = output + totalRead * static_cast<size_t>(channels);
    const int decodeChannels = std::max(1, decodeFormat.channelCount);
    const bool routingRequired = !dopPathActive && (decodeChannels != channels || routingMode != ChannelRoutingMode::Auto);

    size_t requestedFrames = frameCount - totalRead;
    if (routingRequired) {
      requestedFrames = std::min(requestedFrames, routingScratch_.size() / static_cast<size_t>(decodeChannels));
    }
    if (requestedFrames == 0) {
      break;
    }

    float* readBuffer = routingRequired ? routingScratch_.data() : segment;
    const size_t read = active->readFloat(readBuffer, requestedFrames);

    if (read > 0 && !dopPathActive) {
      activeDspChain->process(readBuffer, read);
      if (routingRequired) {
        channelRouter_.route(readBuffer, segment, read, decodeChannels, channels, routingMode);
      }
    }
    totalRead += read;
    positionRead += read;

    if (wantsCrossfade && preload && preload->readyForRender() && outputFormat.sampleRate > 0) {
      const uint64_t requestedFrames =
          static_cast<uint64_t>(std::max(1.0, crossfadeSeconds * static_cast<double>(outputFormat.sampleRate)));
      if (!crossfadeMixActive) {
        const double secondsRemaining =
            active->stream.durationSeconds > 0.0
                ? std::max(0.0, active->stream.durationSeconds -
                                     (static_cast<double>(renderedFrames_.load() + positionRead) /
                                      static_cast<double>(outputFormat.sampleRate)))
                : 0.0;
        if (secondsRemaining <= crossfadeSeconds + 0.02) {
          crossfadeMixActive = true;
          crossfadeFramesProcessed = 0;
          crossfadeTotalFrames = requestedFrames;
          renderCrossfadeMixActive_ = true;
          renderCrossfadeFramesProcessed_ = 0;
          renderCrossfadeTotalFrames_ = requestedFrames;
        }
      }

      if (crossfadeMixActive) {
        const size_t preloadSampleCount = read * static_cast<size_t>(channels);
        const bool crossfadeScratchReady =
            preloadMixScratch_.size() >= preloadSampleCount &&
            (!routingRequired || preloadRoutingScratch_.size() >= read * static_cast<size_t>(decodeChannels));
        if (!crossfadeScratchReady) break;
        float* preloadReadBuffer = routingRequired ? preloadRoutingScratch_.data() : preloadMixScratch_.data();
        const size_t mixedFrames = preload->readFloat(preloadReadBuffer, read);
        if (mixedFrames > 0 && !dopPathActive) {
          preloadDspChain->process(preloadReadBuffer, mixedFrames);
          if (routingRequired) {
            channelRouter_.route(
                preloadReadBuffer,
                preloadMixScratch_.data(),
                mixedFrames,
                decodeChannels,
                channels,
                routingMode);
          }
          render::mixCrossfadeSegment(
              output + (totalRead - read) * static_cast<size_t>(channels),
              preloadMixScratch_.data(),
              mixedFrames,
              channels,
              crossfadeFramesProcessed,
              crossfadeTotalFrames);
          crossfadeFramesProcessed += mixedFrames;
          renderCrossfadeFramesProcessed_ = crossfadeFramesProcessed;
        }
      }
    }

    if (totalRead >= frameCount || !active->drained()) break;

    const bool canPromotePreload = preload && preload->readyForRender();
    if ((!renderGaplessEnabled_.load(std::memory_order_acquire) && !renderCrossfadeMixActive_) ||
        !canPromotePreload) {
      break;
    }
    active = preload;
    preload = nullptr;
    renderActiveStream_.store(active, std::memory_order_release);
    renderPreloadStream_.store(nullptr, std::memory_order_release);
    renderedFrames_ = 0;
    positionRead = 0;
    ended_ = false;
    trackStarted_ = true;
    activeUsesPreloadDspChain = !activeUsesPreloadDspChain;
    renderActiveUsesPreloadDspChain_.store(activeUsesPreloadDspChain, std::memory_order_release);
    renderPromotionPending_.store(true, std::memory_order_release);
    crossfadeMixActive = false;
    crossfadeFramesProcessed = 0;
    crossfadeTotalFrames = 0;
    renderCrossfadeMixActive_ = false;
    renderCrossfadeFramesProcessed_ = 0;
    renderCrossfadeTotalFrames_ = 0;
    activeDspChain = activeUsesPreloadDspChain ? &preloadDspChain_ : &dspChain_;
    preloadDspChain = activeUsesPreloadDspChain ? &dspChain_ : &preloadDspChain_;
  }

  if (totalRead < frameCount) {
    std::fill(
        output + totalRead * static_cast<size_t>(channels),
        output + frameCount * static_cast<size_t>(channels),
        0.0f);
  }

  if (!dopPathActive && std::abs(volume - 1.0) > 0.0001) {
    render::applyVolumeToRenderedFrames(output, totalRead, frameCount, channels, volume);
  }

  if (positionRead > 0) {
    renderedFrames_ += positionRead;
    spectrum_.capture(output, totalRead, channels);
  } else if (active->drained()) {
    ended_ = true;
    renderState_.store(PipelineState::Stopped, std::memory_order_release);
    spectrum_.tryResetCapture();
  } else {
    spectrum_.tryResetCapture();
  }

  return frameCount;
}

}  // namespace twilight::audio
