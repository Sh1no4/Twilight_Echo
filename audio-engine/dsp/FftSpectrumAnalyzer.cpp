#include "FftSpectrumAnalyzer.h"

#include "KissFftAdapter.h"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace twilight::audio {
namespace {

size_t normalizeResolution(size_t value) {
  const size_t allowed[] = {64, 128, 256, 512, 1024, 2048};
  size_t best = allowed[0];
  size_t bestDistance = value > best ? value - best : best - value;
  for (size_t candidate : allowed) {
    const size_t distance = value > candidate ? value - candidate : candidate - value;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

}  // namespace

void fillIdleSpectrum(float* buffer, size_t count, double phase) {
  if (!buffer) return;
  for (size_t i = 0; i < count; ++i) {
    const double x = static_cast<double>(i) / static_cast<double>(count == 0 ? 1 : count);
    buffer[i] = static_cast<float>((std::sin((x * 12.0 + phase) * std::numbers::pi) + 1.0) * 0.25);
  }
}

void FftSpectrumAnalyzer::prepare(const AudioFormat& format, size_t resolution) {
  std::lock_guard lock(mutex_);
  format_ = format;
  resolution_ = normalizeResolution(resolution);
  window_.assign(resolution_, 1.0f);
  for (size_t i = 0; i < resolution_; ++i) {
    window_[i] = static_cast<float>(0.5 - 0.5 * std::cos(2.0 * std::numbers::pi * static_cast<double>(i) /
                                                        static_cast<double>(std::max<size_t>(1, resolution_ - 1))));
  }
  timeDomain_.assign(resolution_, 0.0f);
  magnitudes_.assign(resolution_ / 2, 0.0f);
  hasCapture_ = false;
}

void FftSpectrumAnalyzer::setEnabled(bool enabled) {
  std::lock_guard lock(mutex_);
  enabled_ = enabled;
  if (!enabled_) {
    hasCapture_ = false;
    std::fill(magnitudes_.begin(), magnitudes_.end(), 0.0f);
  }
}

void FftSpectrumAnalyzer::capture(const float* interleaved, size_t frames, int channels) {
  if (!interleaved || frames == 0 || channels <= 0) return;

  std::lock_guard lock(mutex_);
  if (!enabled_ || resolution_ == 0) return;

  const size_t copyFrames = std::min(frames, resolution_);
  if (copyFrames < resolution_) {
    std::move(timeDomain_.begin() + static_cast<std::ptrdiff_t>(copyFrames), timeDomain_.end(), timeDomain_.begin());
  }

  const size_t dstStart = resolution_ - copyFrames;
  const size_t srcStart = frames - copyFrames;
  for (size_t i = 0; i < copyFrames; ++i) {
    double mono = 0.0;
    for (int channel = 0; channel < channels; ++channel) {
      mono += interleaved[(srcStart + i) * static_cast<size_t>(channels) + static_cast<size_t>(channel)];
    }
    timeDomain_[dstStart + i] = static_cast<float>(mono / static_cast<double>(channels));
  }

  std::vector<float> fftInput(resolution_, 0.0f);
  for (size_t i = 0; i < resolution_; ++i) {
    fftInput[i] = timeDomain_[i] * window_[i];
  }

  std::vector<KissFftAdapter::Complex> spectrum;
  KissFftAdapter::forward(fftInput, &spectrum);
  const size_t bins = resolution_ / 2;
  magnitudes_.assign(bins, 0.0f);
  double peak = 1.0e-9;
  for (size_t i = 0; i < bins; ++i) {
    const double magnitude = std::abs(spectrum[i]);
    peak = std::max(peak, magnitude);
    magnitudes_[i] = static_cast<float>(magnitude);
  }
  for (auto& value : magnitudes_) {
    const double normalized = std::sqrt(static_cast<double>(value) / peak);
    value = static_cast<float>(std::clamp(normalized, 0.0, 1.0));
  }
  hasCapture_ = true;
}

size_t FftSpectrumAnalyzer::read(float* output, size_t points, double idlePhase) const {
  if (!output || points == 0) return 0;
  std::lock_guard lock(mutex_);
  if (!enabled_ || !hasCapture_ || magnitudes_.empty()) {
    fillIdleSpectrum(output, points, idlePhase);
    return points;
  }

  for (size_t i = 0; i < points; ++i) {
    const size_t bucket = i * magnitudes_.size() / points;
    output[i] = magnitudes_[std::min(bucket, magnitudes_.size() - 1)];
  }
  return points;
}

bool FftSpectrumAnalyzer::isActive() const {
  std::lock_guard lock(mutex_);
  return enabled_ && hasCapture_;
}

}  // namespace twilight::audio
