#include "FftSpectrumAnalyzer.h"

#include "KissFftAdapter.h"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <sstream>

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
  spectrogram_.clear();
  peakDb_ = -120.0;
  rmsDb_ = -120.0;
  lufsMomentary_ = -70.0;
  hasCapture_ = false;
}

void FftSpectrumAnalyzer::setEnabled(bool enabled) {
  std::lock_guard lock(mutex_);
  enabled_ = enabled;
  if (!enabled_) {
    hasCapture_ = false;
    spectrogram_.clear();
    peakDb_ = -120.0;
    rmsDb_ = -120.0;
    lufsMomentary_ = -70.0;
    std::fill(magnitudes_.begin(), magnitudes_.end(), 0.0f);
  }
}

void FftSpectrumAnalyzer::resetCapture() {
  std::lock_guard lock(mutex_);
  hasCapture_ = false;
  spectrogram_.clear();
  peakDb_ = -120.0;
  rmsDb_ = -120.0;
  lufsMomentary_ = -70.0;
  std::fill(timeDomain_.begin(), timeDomain_.end(), 0.0f);
  std::fill(magnitudes_.begin(), magnitudes_.end(), 0.0f);
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
  double peakSample = 0.0;
  double sumSquares = 0.0;
  size_t measuredSamples = 0;
  for (size_t i = 0; i < copyFrames; ++i) {
    double mono = 0.0;
    for (int channel = 0; channel < channels; ++channel) {
      const float sample = interleaved[(srcStart + i) * static_cast<size_t>(channels) + static_cast<size_t>(channel)];
      mono += sample;
      peakSample = std::max(peakSample, std::abs(static_cast<double>(sample)));
      sumSquares += static_cast<double>(sample) * static_cast<double>(sample);
      ++measuredSamples;
    }
    timeDomain_[dstStart + i] = static_cast<float>(mono / static_cast<double>(channels));
  }
  const double rms = measuredSamples > 0 ? std::sqrt(sumSquares / static_cast<double>(measuredSamples)) : 0.0;
  peakDb_ = 20.0 * std::log10(std::max(peakSample, 1.0e-6));
  rmsDb_ = 20.0 * std::log10(std::max(rms, 1.0e-6));
  lufsMomentary_ = std::max(-70.0, rmsDb_ - 0.691);

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
  spectrogram_.push_back(magnitudes_);
  constexpr size_t kMaxSpectrogramFrames = 96;
  if (spectrogram_.size() > kMaxSpectrogramFrames) {
    spectrogram_.erase(spectrogram_.begin(), spectrogram_.begin() + static_cast<std::ptrdiff_t>(spectrogram_.size() - kMaxSpectrogramFrames));
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

std::string FftSpectrumAnalyzer::readVisualizationJson(
    size_t spectrumPoints,
    size_t waveformPoints,
    size_t spectrogramFrames) const {
  std::lock_guard lock(mutex_);
  spectrumPoints = std::clamp<size_t>(spectrumPoints == 0 ? 64 : spectrumPoints, 8, 256);
  waveformPoints = std::clamp<size_t>(waveformPoints == 0 ? 128 : waveformPoints, 16, 512);
  spectrogramFrames = std::clamp<size_t>(spectrogramFrames == 0 ? 48 : spectrogramFrames, 1, 96);
  const bool active = enabled_ && hasCapture_;

  auto writeArray = [](std::ostringstream& json, const std::vector<float>& values) {
    json << "[";
    for (size_t i = 0; i < values.size(); ++i) {
      if (i > 0) json << ",";
      json << values[i];
    }
    json << "]";
  };

  std::vector<float> spectrum(spectrumPoints, 0.0f);
  if (active && !magnitudes_.empty()) {
    for (size_t i = 0; i < spectrumPoints; ++i) {
      const size_t bucket = i * magnitudes_.size() / spectrumPoints;
      spectrum[i] = magnitudes_[std::min(bucket, magnitudes_.size() - 1)];
    }
  }

  std::vector<float> waveform(waveformPoints, 0.0f);
  if (active && !timeDomain_.empty()) {
    for (size_t i = 0; i < waveformPoints; ++i) {
      const size_t bucket = i * timeDomain_.size() / waveformPoints;
      waveform[i] = std::clamp(timeDomain_[std::min(bucket, timeDomain_.size() - 1)], -1.0f, 1.0f);
    }
  }

  const size_t firstFrame =
      spectrogram_.size() > spectrogramFrames ? spectrogram_.size() - spectrogramFrames : 0;

  std::ostringstream json;
  json << "{\"spectrum\":";
  writeArray(json, spectrum);
  json << ",\"waveform\":";
  writeArray(json, waveform);
  json << ",\"peakDb\":" << (active ? peakDb_ : -120.0)
       << ",\"rmsDb\":" << (active ? rmsDb_ : -120.0)
       << ",\"lufsMomentary\":";
  if (active) {
    json << lufsMomentary_;
  } else {
    json << "null";
  }
  json << ",\"spectrogram\":[";
  if (active) {
    for (size_t frame = firstFrame; frame < spectrogram_.size(); ++frame) {
      if (frame > firstFrame) json << ",";
      const auto& bins = spectrogram_[frame];
      std::vector<float> reduced(spectrumPoints, 0.0f);
      if (!bins.empty()) {
        for (size_t i = 0; i < spectrumPoints; ++i) {
          const size_t bucket = i * bins.size() / spectrumPoints;
          reduced[i] = bins[std::min(bucket, bins.size() - 1)];
        }
      }
      writeArray(json, reduced);
    }
  }
  json << "],\"sampleRate\":" << format_.sampleRate
       << ",\"active\":" << (active ? "true" : "false") << "}";
  return json.str();
}

bool FftSpectrumAnalyzer::isActive() const {
  std::lock_guard lock(mutex_);
  return enabled_ && hasCapture_;
}

}  // namespace twilight::audio
