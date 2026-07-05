#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace twilight::audio {

inline void resetStorageForAudioBuffer(std::vector<uint8_t>& storage, size_t byteSize) {
  if (storage.size() == byteSize) return;
  storage.resize(byteSize);
}

}  // namespace twilight::audio
