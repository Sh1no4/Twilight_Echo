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

enum class DspFilterType {
  Peak,
  LowShelf,
  HighShelf,
  LowPass,
  HighPass,
  BandPass,
  AllPass
};

struct DspEqBand {
  double frequency = 1000.0;
  double gainDb = 0.0;
  double q = 1.0;
  DspFilterType type = DspFilterType::Peak;
};

struct DspConfig {
  bool enabled = false;
  bool clipGuard = true;
  bool fftEnabled = true;
  size_t fftResolution = 64;
  bool gapless = true;

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

  bool crossfeedEnabled = false;
  double crossfeedStrength = 0.0;
  double crossfeedDelayMs = 0.35;
  double crossfeedCutoffHz = 700.0;

  double crossfadeSeconds = 0.0;
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
  bool crossfadeActive = false;
  bool irResampled = false;
  double replayGainDb = 0.0;
  double crossfeedStrength = 0.0;
  double crossfadeSeconds = 0.0;
  uint32_t convolverLatencyFrames = 0;
  uint32_t partitionSize = 0;
  std::string channelMappingMode;
};

struct ConvolverInfo {
  bool loaded = false;
  bool active = false;
  bool irResampled = false;
  std::string path;
  int sampleRate = 0;
  int channels = 0;
  uint64_t lengthFrames = 0;
  double lengthMs = 0.0;
  uint32_t partitionSize = 0;
  uint32_t latencyFrames = 0;
  std::string channelMappingMode;
  std::string warning;
  std::string lastError;
};

}  // namespace twilight::audio
