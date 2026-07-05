#pragma once

#include <algorithm>
#include <cstddef>
#include <ostream>
#include <vector>

namespace twilight::audio::fft {

inline void writeWindowedFftInput(
    const std::vector<float>& timeDomain,
    const std::vector<float>& window,
    size_t resolution,
    std::vector<float>& scratch) {
  scratch.resize(resolution);
  const size_t count = std::min({resolution, timeDomain.size(), window.size()});
  for (size_t i = 0; i < count; ++i) {
    scratch[i] = timeDomain[i] * window[i];
  }
  for (size_t i = count; i < resolution; ++i) {
    scratch[i] = 0.0f;
  }
}

inline void resizeWindowForOverwrite(std::vector<float>& window, size_t resolution) {
  if (window.size() != resolution) window.resize(resolution);
}

inline void resizeMagnitudesForOverwrite(std::vector<float>& magnitudes, size_t bins) {
  if (magnitudes.size() != bins) magnitudes.resize(bins);
}

inline void writeReducedArrayJson(
    std::ostream& json,
    const std::vector<float>& values,
    size_t points,
    bool active,
    bool clampToUnitRange = false) {
  json << "[";
  for (size_t i = 0; i < points; ++i) {
    if (i > 0) json << ",";
    if (!active || values.empty()) {
      json << 0.0f;
      continue;
    }
    const size_t bucket = i * values.size() / points;
    float value = values[std::min(bucket, values.size() - 1)];
    if (clampToUnitRange) value = std::clamp(value, -1.0f, 1.0f);
    json << value;
  }
  json << "]";
}

inline bool resetCaptureCanSkipBufferClear(
    bool hasCapture,
    bool spectrumDirty,
    bool spectrogramEmpty,
    bool captureBuffersSilent,
    double peakDb,
    double rmsDb,
    double lufsMomentary) {
  return !hasCapture && !spectrumDirty && spectrogramEmpty && captureBuffersSilent && peakDb <= -120.0 &&
         rmsDb <= -120.0 && lufsMomentary <= -70.0;
}

}  // namespace twilight::audio::fft
