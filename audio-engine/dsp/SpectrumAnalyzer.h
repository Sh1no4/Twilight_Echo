#pragma once

#include <cstddef>
#include <mutex>
#include <vector>

namespace twilight::audio {

class SpectrumAnalyzer {
 public:
  void capture(const float* interleaved, size_t frames, int channels);
  size_t read(float* buffer, size_t pointCount, double idlePhase) const;

 private:
  mutable std::mutex mutex_;
  std::vector<float> buckets_;
};

void fillIdleSpectrum(float* buffer, size_t count, double phase);

}  // namespace twilight::audio
