#include "CrossfeedProcessor.h"
#include "CrossfeedProcessorUtils.h"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace twilight::audio {

void CrossfeedProcessor::configure(const DspConfig& config) {
  const bool wasEnabled = config_.crossfeedEnabled && config_.crossfeedStrength > 0.0001;
  config_ = config;
  active_ = config_.enabled && config_.crossfeedEnabled && config_.crossfeedStrength > 0.0001 &&
            format_.channelCount == 2 && format_.sampleRate > 0;
  if (wasEnabled && !active_) reset();
}

void CrossfeedProcessor::prepare(const AudioFormat& format) {
  const bool formatChanged = format.sampleRate != format_.sampleRate || format.channelCount != format_.channelCount;
  format_ = format;
  rebuildDelay();
  active_ = config_.enabled && config_.crossfeedEnabled && config_.crossfeedStrength > 0.0001 &&
            format_.channelCount == 2 && format_.sampleRate > 0;
  if (formatChanged) reset();
}

void CrossfeedProcessor::setTrackContext(const DspTrackContext&) {
}

void CrossfeedProcessor::process(float* samples, size_t frameCount) {
  if (!active_ || !samples || frameCount == 0 || delayLeft_.empty() || delayRight_.empty()) return;

  const double strength = std::clamp(config_.crossfeedStrength, 0.0, 1.0);
  const double directGain = 1.0 - 0.08 * strength;
  const double crossGain = 0.38 * strength;

  for (size_t frame = 0; frame < frameCount; ++frame) {
    const size_t index = frame * 2;
    const double left = samples[index];
    const double right = samples[index + 1];

    const double delayedLeft = delayLeft_[delayIndex_];
    const double delayedRight = delayRight_[delayIndex_];
    delayLeft_[delayIndex_] = static_cast<float>(left);
    delayRight_[delayIndex_] = static_cast<float>(right);
    crossfeed::advanceDelayIndex(delayIndex_, delayLeft_.size());

    lowpassLeft_ += alpha_ * (delayedLeft - lowpassLeft_);
    lowpassRight_ += alpha_ * (delayedRight - lowpassRight_);

    samples[index] = static_cast<float>(std::clamp(left * directGain + lowpassRight_ * crossGain, -4.0, 4.0));
    samples[index + 1] = static_cast<float>(std::clamp(right * directGain + lowpassLeft_ * crossGain, -4.0, 4.0));
  }
}

void CrossfeedProcessor::reset() {
  std::fill(delayLeft_.begin(), delayLeft_.end(), 0.0f);
  std::fill(delayRight_.begin(), delayRight_.end(), 0.0f);
  delayIndex_ = 0;
  lowpassLeft_ = 0.0;
  lowpassRight_ = 0.0;
}

bool CrossfeedProcessor::isActive() const {
  return active_;
}

double CrossfeedProcessor::strength() const {
  return active_ ? std::clamp(config_.crossfeedStrength, 0.0, 1.0) : 0.0;
}

void CrossfeedProcessor::rebuildDelay() {
  if (format_.sampleRate <= 0) return;
  const double delayMs = std::clamp(config_.crossfeedDelayMs, 0.05, 2.0);
  const size_t delaySamples = static_cast<size_t>(
      std::max(1.0, std::round(static_cast<double>(format_.sampleRate) * delayMs / 1000.0)));
  delayLeft_.assign(delaySamples, 0.0f);
  delayRight_.assign(delaySamples, 0.0f);
  delayIndex_ = 0;

  const double cutoff = std::clamp(config_.crossfeedCutoffHz, 80.0, 4000.0);
  const double dt = 1.0 / static_cast<double>(format_.sampleRate);
  const double rc = 1.0 / (2.0 * std::numbers::pi * cutoff);
  alpha_ = dt / (rc + dt);
}

}  // namespace twilight::audio
