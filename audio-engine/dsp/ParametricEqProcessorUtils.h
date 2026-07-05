#pragma once

#include <algorithm>
#include <cstddef>

namespace twilight::audio::eq {

inline float clampEqSample(double sample) {
  return static_cast<float>(std::clamp(sample, -4.0, 4.0));
}

inline void applyPreampOnly(float* samples, size_t sampleCount, double preampLinear) {
  if (!samples || sampleCount == 0) return;
  for (size_t i = 0; i < sampleCount; ++i) {
    samples[i] = clampEqSample(static_cast<double>(samples[i]) * preampLinear);
  }
}

}  // namespace twilight::audio::eq
