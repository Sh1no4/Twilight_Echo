#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace twilight::audio {

enum class AudioSampleFormat {
  Float32Interleaved,
  Int16Interleaved,
  Int24Interleaved,
  Int24In32Interleaved,
  Int32Interleaved
};

enum class DsdMode {
  Pcm,
  Dop,
  Native,
  Unsupported
};

struct AudioFormat {
  int sampleRate = 0;
  int channelCount = 0;
  int bitDepth = 0;
  AudioSampleFormat sampleFormat = AudioSampleFormat::Float32Interleaved;
};

struct PcmBlock {
  AudioFormat format;
  uint8_t* data = nullptr;
  size_t frames = 0;
  size_t byteSize = 0;
};

enum class ChannelRoutingMode {
  Auto,
  Stereo,
  StereoTo51,
  StereoTo71,
  MonoToStereo,
  MonoToMultichannel
};

struct OutputConfig {
  uint32_t preferredBufferSize = 0;
  ChannelRoutingMode routingMode = ChannelRoutingMode::Auto;
};

struct ReplayGainInfo {
  std::optional<double> trackGainDb;
  std::optional<double> albumGainDb;
  std::optional<double> r128TrackGainDb;
  std::optional<double> r128AlbumGainDb;
};

struct AudioStreamInfo {
  std::string source;
  std::string codec = "未知";
  int64_t bitrate = 0;
  double durationSeconds = 0.0;
  AudioFormat sourceFormat;
  AudioFormat decodedFormat;
  ReplayGainInfo replayGain;
  bool sourceLossless = false;
  bool isDsd = false;
  DsdMode dsdMode = DsdMode::Pcm;
  int dsdRate = 0;
};

struct QueueItem {
  std::string id;
  std::string source;
  std::string title;
  std::string artist;
  std::string album;
  std::string codec;
  double durationSeconds = 0.0;
  int sampleRate = 0;
  int64_t bitrate = 0;
  int bitDepth = 0;
};

struct OutputInfo {
  struct LatencyInfo {
    double bufferLatencyMs = 0.0;
    double outputLatencyMs = 0.0;
    double totalLatencyMs = 0.0;
  };

  struct Diagnostics {
    uint64_t sessionUnderrunCount = 0;
    uint64_t sessionBufferDropCount = 0;
    uint64_t sessionRecoveryCount = 0;
    uint64_t lifetimeUnderrunCount = 0;
    uint64_t lifetimeBufferDropCount = 0;
    uint64_t lifetimeRecoveryCount = 0;
    uint64_t driverRestartCount = 0;
    uint64_t deviceLostCount = 0;
    std::string lastError;
  };

  bool exclusive = false;
  std::string accessMode = "shared";
  bool supportsOutputPerfect = false;
  bool sourceExact = false;
  bool outputPerfect = false;
  bool pcmPassthrough = false;
  bool resampled = false;
  bool isDsd = false;
  std::string dsdMode = "pcm";
  int dsdRate = 0;
  int outputSampleRate = 0;
  int outputBitDepth = 0;
  std::string backend;
  std::string actualBackend;
  std::string devicePathKind = "default";
  std::string deviceName;
  std::string actualDeviceName;
  std::string driverName;
  std::string actualDriverName;
  long driverVersion = 0;
  long actualDriverVersion = 0;
  std::string actualOutputFormat;
  int actualSampleRate = 0;
  int actualBitDepth = 0;
  int actualChannels = 0;
  std::string perfectReasonCode;
  std::string capabilityReason;
  bool driverDopCapable = false;
  bool driverNativeDsdCapable = false;
  std::vector<int> driverDopCarrierSampleRates;
  std::vector<std::string> driverDopCarrierFormats;
  std::vector<int> driverNativeDsdSampleRates;
  std::string nativeDsdRuntimeState = "unsupported";
  int nativeDsdRequestedRate = 0;
  int nativeDsdActualRate = 0;
  int nativeDsdChannels = 0;
  bool nativeDsdExplicitlyCapable = false;
  std::vector<int> nativeDsdAdvertisedSampleRates;
  std::string nativeDsdRuntimeReason;
  int bufferSizeFrames = 0;
  int latencyFrames = 0;
  double latencyMs = 0.0;
  LatencyInfo latencyInfo;
  std::string channelRoutingMode = "auto";
  std::string perfectReason;
  Diagnostics diagnostics;
  bool deviceRecovered = false;
  int recoveryCount = 0;
};

struct PerfectEvaluation {
  AudioFormat sourceFormat;
  AudioFormat decodedFormat;
  AudioFormat outputFormat;
  bool sourceLossless = false;
  bool sourceDsd = false;
  DsdMode dsdMode = DsdMode::Pcm;
  int dsdRate = 0;
  AudioFormat dopCarrierFormat;
  bool dopCarrierMatched = false;
  bool dopPassthroughProven = false;
  bool nativeDsdRequested = false;
  bool sacdIsoSource = false;
  bool supportsOutputPerfect = false;
  bool backendResampled = false;
  std::string backendPerfectReason;
  double volume = 1.0;
  bool replayGainActive = false;
  bool eqActive = false;
  bool convolverActive = false;
  bool crossfeedActive = false;
  bool crossfadeActive = false;
  ChannelRoutingMode routingMode = ChannelRoutingMode::Auto;
  bool pcmPassthrough = false;
};

struct PerfectResult {
  bool sourceExact = false;
  bool outputPerfect = false;
  bool pcmPassthrough = false;
  bool resampled = false;
  bool processingActive = false;
  bool formatMatched = false;
  bool sourceFormatMatched = false;
  bool routingPreservesSemantics = false;
  std::string perfectReasonCode;
  std::string perfectReason;
};

std::string channelRoutingModeToString(ChannelRoutingMode mode);
ChannelRoutingMode parseChannelRoutingMode(const std::string& mode);
std::string dsdModeToString(DsdMode mode);
std::string sampleFormatToString(AudioSampleFormat format);
size_t audioSampleFormatBytes(AudioSampleFormat format);
size_t audioFormatBytesPerFrame(const AudioFormat& format);
int normalizedPcmBitDepth(int bitDepth);
int effectivePcmBitDepth(const AudioFormat& format);
bool pcmFormatsExactMatch(const AudioFormat& left, const AudioFormat& right);
std::optional<AudioFormat> dopCarrierFormatForDsd(int dsdRate, int channelCount);
PerfectResult evaluatePerfect(const PerfectEvaluation& evaluation);

}  // namespace twilight::audio
