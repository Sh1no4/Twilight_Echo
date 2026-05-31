#pragma once

#include "../core/AudioTypes.h"

#include <cstddef>
#include <mutex>
#include <vector>

namespace twilight::audio {

class FftSpectrumAnalyzer {
 public:
  void prepare(const AudioFormat& format, size_t resolution);
  void setEnabled(bool enabled);
  void capture(const float* interleaved, size_t frames, int channels);
  size_t read(float* output, size_t points, double idlePhase = 0.0) const;
  bool isActive() const;

 private:
  mutable std::mutex mutex_;
  AudioFormat format_;
  size_t resolution_ = 64;
  bool enabled_ = true;
  bool hasCapture_ = false;
  std::vector<float> window_;
  std::vector<float> timeDomain_;
  std::vector<float> magnitudes_;
};

void fillIdleSpectrum(float* buffer, size_t count, double phase);

}  // namespace twilight::audio
