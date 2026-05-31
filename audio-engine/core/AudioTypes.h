#pragma once

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

struct AudioFormat {
  int sampleRate = 0;
  int channelCount = 0;
  int bitDepth = 0;
  AudioSampleFormat sampleFormat = AudioSampleFormat::Float32Interleaved;
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
  ReplayGainInfo replayGain;
  bool isDsd = false;
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
  bool supportsBitPerfect = false;
  bool bitPerfect = false;
  bool resampled = false;
  int outputSampleRate = 0;
  int outputBitDepth = 0;
  std::string backend;
  std::string actualBackend;
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
  int bufferSizeFrames = 0;
  int latencyFrames = 0;
  double latencyMs = 0.0;
  LatencyInfo latencyInfo;
  std::string channelRoutingMode = "auto";
  std::string resampleReason;
  Diagnostics diagnostics;
  bool deviceRecovered = false;
  int recoveryCount = 0;
};

struct BitPerfectEvaluation {
  AudioFormat sourceFormat;
  AudioFormat outputFormat;
  bool supportsBitPerfect = false;
  bool backendResampled = false;
  std::string backendResampleReason;
  double volume = 1.0;
  bool replayGainActive = false;
  bool eqActive = false;
  bool convolverActive = false;
  bool crossfeedActive = false;
  ChannelRoutingMode routingMode = ChannelRoutingMode::Auto;
};

struct BitPerfectResult {
  bool bitPerfect = false;
  bool resampled = false;
  bool processingActive = false;
  bool formatMatched = false;
  bool routingPreservesSemantics = false;
  std::string resampleReason;
};

std::string channelRoutingModeToString(ChannelRoutingMode mode);
ChannelRoutingMode parseChannelRoutingMode(const std::string& mode);
int normalizedPcmBitDepth(int bitDepth);
int effectivePcmBitDepth(const AudioFormat& format);
BitPerfectResult evaluateBitPerfect(const BitPerfectEvaluation& evaluation);

}  // namespace twilight::audio
