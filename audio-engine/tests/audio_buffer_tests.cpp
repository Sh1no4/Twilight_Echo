#include "../core/AudioBuffer.h"
#include "../core/AudioBufferResetUtils.h"

#include <array>
#include <atomic>
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <vector>

using namespace twilight::audio;

namespace {

std::string readTextFile(const std::filesystem::path& path) {
  std::ifstream in(path, std::ios::binary);
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

std::string extractFunctionBody(const std::string& source, const std::string& signature) {
  const size_t signaturePos = source.find(signature);
  assert(signaturePos != std::string::npos);
  const size_t bodyStart = source.find('{', signaturePos);
  assert(bodyStart != std::string::npos);
  int depth = 0;
  for (size_t i = bodyStart; i < source.size(); ++i) {
    if (source[i] == '{') {
      ++depth;
    } else if (source[i] == '}') {
      --depth;
      if (depth == 0) return source.substr(bodyStart, i - bodyStart + 1);
    }
  }
  assert(false);
  return {};
}

void assertSharedFormatStateReadAfterLock(const std::string& body) {
  const size_t firstSharedRead = std::min(
      body.find("format_"),
      body.find("channels_"));
  const size_t firstLock = std::min(
      body.find("std::lock_guard"),
      body.find("std::unique_lock"));
  assert(firstSharedRead == std::string::npos || (firstLock != std::string::npos && firstLock < firstSharedRead));
}

void testAudioBufferFormatStateIsReadUnderMutex() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioBuffer.cpp";
  const std::string source = readTextFile(sourcePath);

  assertSharedFormatStateReadAfterLock(
      extractFunctionBody(source, "size_t AudioBuffer::writeBlocking(const float* data, size_t frames, const std::atomic<bool>& running)"));
  assertSharedFormatStateReadAfterLock(
      extractFunctionBody(source, "size_t AudioBuffer::writeBlocking(const PcmBlock& block, const std::atomic<bool>& running)"));
  assertSharedFormatStateReadAfterLock(
      extractFunctionBody(source, "size_t AudioBuffer::read(float* data, size_t frames)"));
  assertSharedFormatStateReadAfterLock(
      extractFunctionBody(source, "size_t AudioBuffer::read(PcmBlock& block)"));
}

void testAudioBufferRenderReadablePathsUseNonBlockingLocks() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioBuffer.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string readFloatBody = extractFunctionBody(source, "size_t AudioBuffer::read(float* data, size_t frames)");
  const std::string readBlockBody = extractFunctionBody(source, "size_t AudioBuffer::read(PcmBlock& block)");
  const std::string availableFramesBody = extractFunctionBody(source, "size_t AudioBuffer::availableFrames() const");
  const std::string formatBody = extractFunctionBody(source, "AudioFormat AudioBuffer::format() const");

  assert(readFloatBody.find("std::try_to_lock") != std::string::npos);
  assert(readBlockBody.find("std::try_to_lock") != std::string::npos);
  assert(availableFramesBody.find("std::try_to_lock") != std::string::npos);
  assert(formatBody.find("std::try_to_lock") != std::string::npos);
  assert(readFloatBody.find("std::lock_guard lock(mutex_)") == std::string::npos);
  assert(readBlockBody.find("std::lock_guard lock(mutex_)") == std::string::npos);
  assert(availableFramesBody.find("std::lock_guard lock(mutex_)") == std::string::npos);
  assert(formatBody.find("std::lock_guard lock(mutex_)") == std::string::npos);
}

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
  testAudioBufferFormatStateIsReadUnderMutex();
  testAudioBufferRenderReadablePathsUseNonBlockingLocks();
  testResetMakesOldFramesUnreadableAndEmptyReadsSilent();
  testResetStorageResizeDoesNotRewriteSameSizedStorage();
  testResetStorageResizeShrinksWithoutClearingPrefix();
  return 0;
}
