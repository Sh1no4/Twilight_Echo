#include "../core/AudioBuffer.h"
#include "../core/AudioBufferResetUtils.h"

#include <array>
#include <cassert>
#include <atomic>
#include <cstdint>
#include <vector>

using namespace twilight::audio;

namespace {

void testResetMakesOldFramesUnreadableAndEmptyReadsSilent() {
  AudioBuffer buffer;
  buffer.reset(2, 4);

  std::atomic<bool> running{true};
  const std::array<float, 4> input{0.25f, -0.25f, 0.5f, -0.5f};
  assert(buffer.writeBlocking(input.data(), 2, running) == 2);
  assert(buffer.availableFrames() == 2);

  buffer.reset(2, 4);

  std::array<float, 4> output{9.0f, 9.0f, 9.0f, 9.0f};
  assert(buffer.read(output.data(), 2) == 0);
  for (float sample : output) {
    assert(sample == 0.0f);
  }
}

void testResetStorageResizeDoesNotRewriteSameSizedStorage() {
  std::vector<uint8_t> storage{0x11, 0x22, 0x33, 0x44};
  const uint8_t* before = storage.data();

  resetStorageForAudioBuffer(storage, storage.size());

  assert(storage.data() == before);
  assert((storage == std::vector<uint8_t>{0x11, 0x22, 0x33, 0x44}));
}

void testResetStorageResizeShrinksWithoutClearingPrefix() {
  std::vector<uint8_t> storage{0x10, 0x20, 0x30, 0x40};

  resetStorageForAudioBuffer(storage, 2);

  assert((storage == std::vector<uint8_t>{0x10, 0x20}));
}

}  // namespace

int main() {
  testResetMakesOldFramesUnreadableAndEmptyReadsSilent();
  testResetStorageResizeDoesNotRewriteSameSizedStorage();
  testResetStorageResizeShrinksWithoutClearingPrefix();
  return 0;
}
