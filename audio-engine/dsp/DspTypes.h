#pragma once

#include "../core/AudioTypes.h"

#include <cstdint>
#include <string>
#include <vector>

namespace twilight::audio {

enum class ReplayGainMode {
  Off,
  Track,
  Album
};

enum class EqMode {
  Graphic,
  Parametric
};

enum class DsdOutputMode {
  Auto,
  Pcm,
  Dop,
  Native
};

enum class SacdProgramMode {
  Auto,
  Stereo,
  Multichannel
};

enum class DspFilterType {
  Peak,
  LowShelf,
  HighShelf,
  LowPass,
  HighPass,
  BandPass,
  AllPass,
  Notch
};

enum class CrossfeedAlgorithm {
  Custom,
  Bauer,
  Bs2b,
  Meier
};

enum class DspResamplerQuality {
  Native,
  High,
  Ultra
};

enum class DspDitherMode {
  Off,
  Tpdf,
  HighpassTpdf,
  NoiseShaped
};

struct DspEqBand {
  double frequency = 1000.0;
  double gainDb = 0.0;
  double q = 1.0;
  DspFilterType type = DspFilterType::Peak;
  bool enabled = true;
  uint32_t channelMask = 0xffffffffu;
};

struct DspDynamicEqBand {
  double frequency = 1000.0;
  double gainDb = 0.0;
  double q = 1.0;
  double thresholdDb = -24.0;
  double ratio = 2.0;
  double rangeDb = -6.0;
  double attackMs = 15.0;
  double releaseMs = 180.0;
  DspFilterType type = DspFilterType::Peak;
  bool enabled = true;
  uint32_t channelMask = 0xffffffffu;
};

struct DspMultibandCompressorBand {
  double thresholdDb = -18.0;
  double ratio = 2.0;
  double attackMs = 15.0;
  double releaseMs = 180.0;
  double makeupDb = 0.0;
  bool enabled = true;
};

struct DspConfig {
  bool enabled = false;
  bool clipGuard = true;
  bool fftEnabled = true;
  size_t fftResolution = 8192;
  bool gapless = true;
  DsdOutputMode dsdOutputMode = DsdOutputMode::Auto;
  SacdProgramMode sacdProgramMode = SacdProgramMode::Auto;

  ReplayGainMode replayGainMode = ReplayGainMode::Off;
  double replayGainPreampDb = 0.0;
  double replayGainFallbackDb = 0.0;
  bool replayGainClip = true;

  bool eqEnabled = false;
  EqMode eqMode = EqMode::Graphic;
  double eqPreampDb = 0.0;
  std::vector<DspEqBand> eqBands;

  bool convolverEnabled = false;
  std::string impulseResponsePath;
  double convolverWet = 1.0;
  double convolverDry = 0.0;
  double convolverGainDb = 0.0;
  bool convolverPolarityInverted = false;
  double convolverDelayMs = 0.0;
  uint32_t convolverPartitionSize = 0;
  std::vector<double> convolverMatrix;

  bool crossfeedEnabled = false;
  CrossfeedAlgorithm crossfeedAlgorithm = CrossfeedAlgorithm::Custom;
  double crossfeedStrength = 0.0;
  double crossfeedDelayMs = 0.35;
  double crossfeedCutoffHz = 700.0;

  double crossfadeSeconds = 0.0;

  bool channelMatrixEnabled = false;
  std::vector<double> channelMatrix;

  struct ChannelStripChannel {
    double gainDb = 0.0;
    double delayMs = 0.0;
    bool polarityInverted = false;
    bool muted = false;
  };
  bool channelStripEnabled = false;
  std::vector<ChannelStripChannel> channelStripChannels;

  bool bassManagementEnabled = false;
  double bassCrossoverHz = 80.0;
  double bassLfeGainDb = 0.0;
  bool bassRedirectLfe = true;

  bool gateEnabled = false;
  double gateThresholdDb = -60.0;
  double gateAttackMs = 2.0;
  double gateReleaseMs = 120.0;

  bool compressorEnabled = false;
  double compressorThresholdDb = -18.0;
  double compressorRatio = 2.0;
  double compressorAttackMs = 15.0;
  double compressorReleaseMs = 180.0;
  double compressorMakeupDb = 0.0;

  bool dynamicEqEnabled = false;
  std::vector<DspDynamicEqBand> dynamicEqBands;

  bool multibandCompressorEnabled = false;
  std::vector<double> multibandCrossoversHz;
  std::vector<DspMultibandCompressorBand> multibandCompressorBands;

  bool stereoFieldEnabled = false;
  double stereoWidth = 1.0;
  double stereoBalance = 0.0;
  double stereoMidGainDb = 0.0;
  double stereoSideGainDb = 0.0;
  bool stereoSwap = false;
  bool stereoMono = false;
  bool stereoInvertLeft = false;
  bool stereoInvertRight = false;

  bool loudnessContourEnabled = false;
  double loudnessContourAmount = 0.0;
  double loudnessReferenceVolume = 0.75;

  bool truePeakLimiterEnabled = false;
  double truePeakCeilingDb = -0.1;
  double truePeakAttackMs = 0.2;
  double truePeakReleaseMs = 80.0;
  double truePeakLookaheadMs = 1.0;

  bool meterEnabled = false;

  int outputTargetSampleRate = 0;
  DspResamplerQuality resamplerQuality = DspResamplerQuality::Native;
  DspDitherMode ditherMode = DspDitherMode::Off;
  bool outputSafetyClamp = true;
};

struct DspTrackContext {
  AudioStreamInfo stream;
  QueueItem item;
};

struct DspStatus {
  bool dspActive = false;
  bool replayGainActive = false;
  bool eqActive = false;
  bool convolverActive = false;
  bool crossfeedActive = false;
  bool channelMatrixActive = false;
  bool channelStripActive = false;
  bool bassManagementActive = false;
  bool gateActive = false;
  bool compressorActive = false;
  bool dynamicEqActive = false;
  bool multibandCompressorActive = false;
  bool stereoFieldActive = false;
  bool loudnessContourActive = false;
  bool truePeakLimiterActive = false;
  bool meterActive = false;
  bool nativeDspActive = false;
  bool vst3DspActive = false;
  bool crossfadeActive = false;
  bool irResampled = false;
  double replayGainDb = 0.0;
  double crossfeedStrength = 0.0;
  double crossfadeSeconds = 0.0;
  uint32_t convolverLatencyFrames = 0;
  uint32_t partitionSize = 0;
  std::string channelMappingMode;
  std::string nativeDspJson = "{\"plugins\":[]}";
  double integratedLufs = 0.0;
  double momentaryLufs = 0.0;
  double shortTermLufs = 0.0;
  double loudnessRangeLu = 0.0;
  double truePeakDb = 0.0;
  double correlation = 0.0;
  uint64_t clipCount = 0;
};

struct ConvolverInfo {
  bool loaded = false;
  bool active = false;
  bool bypassed = false;
  bool irResampled = false;
  std::string path;
  int sampleRate = 0;
  int channels = 0;
  uint64_t lengthFrames = 0;
  double lengthMs = 0.0;
  uint32_t partitionSize = 0;
  uint32_t latencyFrames = 0;
  uint64_t tailFrames = 0;
  uint64_t memoryBytes = 0;
  bool loading = false;
  uint64_t overrunCount = 0;
  double lastProcessMs = 0.0;
  double maxProcessMs = 0.0;
  std::string channelMappingMode;
  std::string warning;
  std::string lastError;
};

}  // namespace twilight::audio
