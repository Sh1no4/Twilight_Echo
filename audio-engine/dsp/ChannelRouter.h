#pragma once

#include "../core/AudioTypes.h"
#include <cstddef>
#include <vector>

namespace twilight::audio {

void routeChannels(
    const float* source,
    float* destination,
    size_t frameCount,
    int sourceChannels,
    int destinationChannels,
    ChannelRoutingMode mode);

}  // namespace twilight::audio
