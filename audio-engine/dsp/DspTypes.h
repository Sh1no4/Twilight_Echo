#pragma once

#include "../core/AudioTypes.h"

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
  ReplayGainMode replayGainMode = ReplayGainMode::Off;
  double replayGainPreampDb = 0.0;
  double replayGainFallbackDb = 0.0;
  bool replayGainClip = true;

  bool eqEnabled = false;
  EqMode eqMode = EqMode::Graphic;
  double eqPreampDb = 0.0;
  std::vector<DspEqBand> eqBands;
};

struct DspTrackContext {
  AudioStreamInfo stream;
  QueueItem item;
};

struct DspStatus {
  bool dspActive = false;
  bool replayGainActive = false;
  bool eqActive = false;
};

}  // namespace twilight::audio
