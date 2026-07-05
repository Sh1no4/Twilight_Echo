#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace twilight::audio::sacd {

inline void resizeByteScratchForOverwrite(std::vector<uint8_t>& scratch, size_t byteSize) {
  if (scratch.size() != byteSize) scratch.resize(byteSize);
}

}  // namespace twilight::audio::sacd
