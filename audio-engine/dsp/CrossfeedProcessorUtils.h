#pragma once

#include <cstddef>

namespace twilight::audio::crossfeed {

inline void advanceDelayIndex(size_t& index, size_t delaySize) {
  if (delaySize == 0) {
    index = 0;
    return;
  }
  ++index;
  if (index >= delaySize) index = 0;
}

}  // namespace twilight::audio::crossfeed
