#include "SpectrumAnalyzer.h"

#include <algorithm>
#include <cmath>

namespace twilight::audio {

void fillIdleSpectrum(float* buffer, size_t count, double phase) {
  if (!buffer) return;
  for (size_t i = 0; i < count; ++i) {
    const double x = static_cast<double>(i) / static_cast<double>(count == 0 ? 1 : count);
    buffer[i] = static_cast<float>((std::sin((x * 12.0 + phase) * 3.141592653589793) + 1.0) * 0.25);
  }
}

void SpectrumAnalyzer::capture(const float* interleaved, size_t frames, int channels) {
  if (!interleaved || frames == 0 || channels <= 0) return;

  constexpr size_t kBuckets = 64;
  std::vector<float> next(kBuckets, 0.0f);
  const size_t framesPerBucket = std::max<size_t>(1, frames / kBuckets);

  for (size_t bucket = 0; bucket < kBuckets; ++bucket) {
    const size_t begin = bucket * framesPerBucket;
    const size_t end = bucket == kBuckets - 1 ? frames : std::min(frames, begin + framesPerBucket);
    if (begin >= end) break;

    double sum = 0.0;
    size_t samples = 0;
    for (size_t frame = begin; frame < end; ++frame) {
      for (int ch = 0; ch < channels; ++ch) {
        const float sample = interleaved[frame * static_cast<size_t>(channels) + static_cast<size_t>(ch)];
        sum += static_cast<double>(sample) * static_cast<double>(sample);
        ++samples;
      }
    }
    next[bucket] = samples > 0 ? static_cast<float>(std::sqrt(sum / static_cast<double>(samples))) : 0.0f;
  }

  std::lock_guard lock(mutex_);
  buckets_ = std::move(next);
}

size_t SpectrumAnalyzer::read(float* buffer, size_t pointCount, double idlePhase) const {
  if (!buffer || pointCount == 0) return 0;

  std::lock_guard lock(mutex_);
  if (buckets_.empty()) {
    fillIdleSpectrum(buffer, pointCount, idlePhase);
    return pointCount;
  }

  for (size_t i = 0; i < pointCount; ++i) {
    const size_t bucket = i * buckets_.size() / pointCount;
    buffer[i] = std::clamp(buckets_[std::min(bucket, buckets_.size() - 1)], 0.0f, 1.0f);
  }
  return pointCount;
}

}  // namespace twilight::audio
