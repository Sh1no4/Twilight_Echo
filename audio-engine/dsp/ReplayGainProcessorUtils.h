#pragma once

#include <algorithm>
#include <cstddef>

namespace twilight::audio::replaygain {

inline void applyReplayGain(float* samples, size_t sampleCount, double gainLinear, bool clip) {
  if (!samples || sampleCount == 0) return;

  if (clip) {
    for (size_t i = 0; i < sampleCount; ++i) {
      samples[i] = static_cast<float>(std::clamp(static_cast<double>(samples[i]) * gainLinear, -1.0, 1.0));
    }
    return;
  }

  for (size_t i = 0; i < sampleCount; ++i) {
    samples[i] = static_cast<float>(static_cast<double>(samples[i]) * gainLinear);
  }
}

}  // namespace twilight::audio::replaygain
