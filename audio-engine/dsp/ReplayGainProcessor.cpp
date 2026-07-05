#include "ReplayGainProcessor.h"
#include "ReplayGainProcessorUtils.h"

#include <cmath>

namespace twilight::audio {
namespace {

constexpr double kGainEpsilonDb = 0.0001;

double dbToLinear(double db) {
  return std::pow(10.0, db / 20.0);
}

}  // namespace

void ReplayGainProcessor::configure(const DspConfig& config) {
  config_ = config;
  updateGain({});
}

void ReplayGainProcessor::prepare(const AudioFormat& format) {
  format_ = format;
}

void ReplayGainProcessor::setTrackContext(const DspTrackContext& context) {
  updateGain(context.stream.replayGain);
}

void ReplayGainProcessor::process(float* samples, size_t frameCount) {
  if (!active_ || !samples || frameCount == 0) return;

  const size_t sampleCount = frameCount * static_cast<size_t>(std::max(1, format_.channelCount));
  replaygain::applyReplayGain(samples, sampleCount, gainLinear_, config_.replayGainClip);
}

void ReplayGainProcessor::reset() {
}

bool ReplayGainProcessor::isActive() const {
  return active_;
}

double ReplayGainProcessor::currentGainDb() const {
  return active_ ? gainDb_ : 0.0;
}

void ReplayGainProcessor::updateGain(const ReplayGainInfo& info) {
  if (!config_.enabled || config_.replayGainMode == ReplayGainMode::Off) {
    gainDb_ = 0.0;
    gainLinear_ = 1.0;
    active_ = false;
    return;
  }

  std::optional<double> selected;
  if (config_.replayGainMode == ReplayGainMode::Track) {
    selected = info.trackGainDb ? info.trackGainDb : info.r128TrackGainDb;
  } else {
    selected = info.albumGainDb ? info.albumGainDb : info.r128AlbumGainDb;
  }

  gainDb_ = selected.value_or(config_.replayGainFallbackDb) + config_.replayGainPreampDb;
  gainLinear_ = dbToLinear(gainDb_);
  active_ = std::abs(gainDb_) > kGainEpsilonDb;
}

}  // namespace twilight::audio
