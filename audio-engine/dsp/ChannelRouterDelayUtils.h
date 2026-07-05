#pragma once

#include "../core/AudioTypes.h"

#include <cstddef>
#include <vector>

namespace twilight::audio::channel_router {

inline void prepareDelayLine(std::vector<float>& delayLine, size_t delaySamples, size_t& cursor) {
  delayLine.assign(delaySamples, 0.0f);
  cursor = 0;
}

inline float pushDelaySample(std::vector<float>& delayLine, size_t& cursor, float sample) {
  if (delayLine.empty()) return sample;
  if (cursor >= delayLine.size()) cursor = 0;

  const float delayed = delayLine[cursor];
  delayLine[cursor] = sample;
  cursor = (cursor + 1) % delayLine.size();
  return delayed;
}

inline bool canFastRouteMonoToStereo(int sourceChannels, int destinationChannels, ChannelRoutingMode mode) {
  return sourceChannels == 1 && destinationChannels == 2 && mode == ChannelRoutingMode::MonoToStereo;
}

inline void routeMonoToStereo(const float* source, float* destination, size_t frames) {
  if (!source || !destination || frames == 0) return;
  for (size_t frame = 0; frame < frames; ++frame) {
    const float sample = source[frame];
    const size_t offset = frame * 2;
    destination[offset] = sample;
    destination[offset + 1] = sample;
  }
}

}  // namespace twilight::audio::channel_router
