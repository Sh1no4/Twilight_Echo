#include "ChannelRouter.h"

#include <algorithm>
#include <cstring>

namespace twilight::audio {

void routeChannels(
    const float* source,
    float* destination,
    size_t frameCount,
    int sourceChannels,
    int destinationChannels,
    ChannelRoutingMode mode) {
  if (frameCount == 0 || sourceChannels <= 0 || destinationChannels <= 0) return;

  if (sourceChannels == destinationChannels && mode == ChannelRoutingMode::Auto) {
    if (source != destination) {
      std::memcpy(destination, source, frameCount * static_cast<size_t>(sourceChannels) * sizeof(float));
    }
    return;
  }

  for (size_t frame = 0; frame < frameCount; ++frame) {
    const float* srcFrame = source + frame * static_cast<size_t>(sourceChannels);
    float* dstFrame = destination + frame * static_cast<size_t>(destinationChannels);

    for (int dst = 0; dst < destinationChannels; ++dst) {
      float sample = 0.0f;
      switch (mode) {
        case ChannelRoutingMode::MonoToStereo:
        case ChannelRoutingMode::MonoToMultichannel:
          if (dst < 2) {
             sample = srcFrame[0];
          } else if (mode == ChannelRoutingMode::MonoToMultichannel && dst < destinationChannels) {
             sample = srcFrame[0];
          }
          break;
        case ChannelRoutingMode::Stereo:
        case ChannelRoutingMode::StereoTo51:
        case ChannelRoutingMode::StereoTo71:
          if (dst < 2 && sourceChannels > dst) {
            sample = srcFrame[dst];
          }
          break;
        case ChannelRoutingMode::Auto:
        default:
          if (dst < sourceChannels) {
            sample = srcFrame[dst];
          }
          break;
      }
      dstFrame[dst] = sample;
    }
  }
}

}  // namespace twilight::audio
