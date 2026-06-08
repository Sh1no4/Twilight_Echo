#include "AudioFixtureLibrary.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>

namespace twilight::audio::test {
namespace {

void writeLe16(std::ofstream& out, uint16_t value) {
  out.put(static_cast<char>(value & 0xff));
  out.put(static_cast<char>((value >> 8) & 0xff));
}

void writeLe32(std::ofstream& out, uint32_t value) {
  writeLe16(out, static_cast<uint16_t>(value & 0xffff));
  writeLe16(out, static_cast<uint16_t>((value >> 16) & 0xffff));
}

void writeLe64(std::ofstream& out, uint64_t value) {
  writeLe32(out, static_cast<uint32_t>(value & 0xffffffffULL));
  writeLe32(out, static_cast<uint32_t>((value >> 32) & 0xffffffffULL));
}

std::filesystem::path tempPathFor(const std::string& name) {
  return std::filesystem::temp_directory_path() / name;
}

std::string lowercaseExtension(const std::filesystem::path& path) {
  std::string extension = path.extension().string();
  std::transform(extension.begin(), extension.end(), extension.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return extension;
}

bool isSupportedExternalFixture(const std::filesystem::path& path) {
  static constexpr std::array<const char*, 10> kExtensions = {
      ".wav", ".flac", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".dsf", ".dff", ".aiff"};
  const std::string extension = lowercaseExtension(path);
  return std::find(kExtensions.begin(), kExtensions.end(), extension) != kExtensions.end();
}

}  // namespace

TempAudioFixture::TempAudioFixture(std::filesystem::path path) : path_(std::move(path)) {}

TempAudioFixture::TempAudioFixture(TempAudioFixture&& other) noexcept : path_(std::move(other.path_)) {
  other.path_.clear();
}

TempAudioFixture& TempAudioFixture::operator=(TempAudioFixture&& other) noexcept {
  if (this != &other) {
    cleanup();
    path_ = std::move(other.path_);
    other.path_.clear();
  }
  return *this;
}

TempAudioFixture::~TempAudioFixture() {
  cleanup();
}

void TempAudioFixture::cleanup() {
  if (path_.empty()) return;
  std::error_code ignored;
  std::filesystem::remove(path_, ignored);
  path_.clear();
}

TempAudioFixture writePcmWavFixture(const PcmWavFixtureSpec& spec) {
  const auto path = tempPathFor(spec.name);
  const int bytesPerSample = spec.bitsPerSample / 8;
  const int dataBytes = spec.frameCount * spec.channels * bytesPerSample;
  const uint16_t formatTag = spec.floatingPoint ? 3 : 1;

  std::ofstream out(path, std::ios::binary);
  out.write("RIFF", 4);
  writeLe32(out, 36 + static_cast<uint32_t>(dataBytes));
  out.write("WAVE", 4);
  out.write("fmt ", 4);
  writeLe32(out, 16);
  writeLe16(out, formatTag);
  writeLe16(out, static_cast<uint16_t>(spec.channels));
  writeLe32(out, static_cast<uint32_t>(spec.sampleRate));
  writeLe32(out, static_cast<uint32_t>(spec.sampleRate * spec.channels * bytesPerSample));
  writeLe16(out, static_cast<uint16_t>(spec.channels * bytesPerSample));
  writeLe16(out, static_cast<uint16_t>(spec.bitsPerSample));
  out.write("data", 4);
  writeLe32(out, static_cast<uint32_t>(dataBytes));

  for (int frame = 0; frame < spec.frameCount; ++frame) {
    for (int channel = 0; channel < spec.channels; ++channel) {
      if (spec.floatingPoint) {
        const float value = static_cast<float>(frame) / static_cast<float>(std::max(1, spec.frameCount));
        out.write(reinterpret_cast<const char*>(&value), sizeof(value));
      } else if (spec.bitsPerSample == 16) {
        writeLe16(out, static_cast<uint16_t>(frame * 64));
      } else if (spec.bitsPerSample == 24) {
        const int32_t value = frame * 512;
        out.put(static_cast<char>(value & 0xff));
        out.put(static_cast<char>((value >> 8) & 0xff));
        out.put(static_cast<char>((value >> 16) & 0xff));
      } else {
        writeLe32(out, static_cast<uint32_t>(frame * 1024));
      }
    }
  }

  return TempAudioFixture(path);
}

TempAudioFixture writeDsfFixture(const std::string& name, int sampleRate, int blockSizePerChannel) {
  const auto path = tempPathFor(name);
  constexpr uint32_t kChannels = 2;
  const uint32_t blockSize = static_cast<uint32_t>(std::max(1, blockSizePerChannel));
  const uint64_t dataBytes = static_cast<uint64_t>(kChannels) * blockSize;
  const uint64_t fileSize = 28 + 52 + 12 + dataBytes;

  std::ofstream out(path, std::ios::binary);
  out.write("DSD ", 4);
  writeLe64(out, 28);
  writeLe64(out, fileSize);
  writeLe64(out, 0);
  out.write("fmt ", 4);
  writeLe64(out, 52);
  writeLe32(out, 1);
  writeLe32(out, 0);
  writeLe32(out, 2);
  writeLe32(out, kChannels);
  writeLe32(out, static_cast<uint32_t>(sampleRate));
  writeLe32(out, 1);
  writeLe64(out, static_cast<uint64_t>(blockSize) * 8);
  writeLe32(out, blockSize);
  writeLe32(out, 0);
  out.write("data", 4);
  writeLe64(out, 12 + dataBytes);
  for (uint64_t i = 0; i < dataBytes; ++i) out.put(static_cast<char>(0x69));

  return TempAudioFixture(path);
}

std::vector<std::filesystem::path> findExternalAudioFixtures() {
  const char* rawDir = std::getenv("TAE_AUDIO_FIXTURES_DIR");
  if (!rawDir || std::string(rawDir).empty()) return {};

  std::error_code error;
  const std::filesystem::path root(rawDir);
  if (!std::filesystem::exists(root, error) || !std::filesystem::is_directory(root, error)) return {};

  std::vector<std::filesystem::path> fixtures;
  for (const auto& entry : std::filesystem::recursive_directory_iterator(root, error)) {
    if (error) break;
    if (!entry.is_regular_file(error)) continue;
    if (!isSupportedExternalFixture(entry.path())) continue;
    fixtures.push_back(entry.path());
    if (fixtures.size() >= 64) break;
  }
  std::sort(fixtures.begin(), fixtures.end());
  return fixtures;
}

}  // namespace twilight::audio::test
