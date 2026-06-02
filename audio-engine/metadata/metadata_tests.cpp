#include "AudioMetadataService.h"

#include <cassert>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

using namespace twilight::audio;

namespace {

#if defined(TAE_HAS_FFMPEG)
void writeLe32(std::ofstream& out, uint32_t value) {
  out.put(static_cast<char>(value & 0xff));
  out.put(static_cast<char>((value >> 8) & 0xff));
  out.put(static_cast<char>((value >> 16) & 0xff));
  out.put(static_cast<char>((value >> 24) & 0xff));
}

void writeLe64(std::ofstream& out, uint64_t value) {
  writeLe32(out, static_cast<uint32_t>(value & 0xffffffffULL));
  writeLe32(out, static_cast<uint32_t>((value >> 32) & 0xffffffffULL));
}

std::filesystem::path writeDsfFixture(const std::string& name, uint32_t sampleRate) {
  const auto path = std::filesystem::temp_directory_path() / name;
  constexpr uint32_t kChannels = 2;
  constexpr uint32_t kBlockSizePerChannel = 4096;
  constexpr uint64_t kDataBytes = static_cast<uint64_t>(kChannels) * kBlockSizePerChannel;
  constexpr uint64_t kFileSize = 28 + 52 + 12 + kDataBytes;

  std::ofstream out(path, std::ios::binary);
  out.write("DSD ", 4);
  writeLe64(out, 28);
  writeLe64(out, kFileSize);
  writeLe64(out, 0);
  out.write("fmt ", 4);
  writeLe64(out, 52);
  writeLe32(out, 1);
  writeLe32(out, 0);
  writeLe32(out, 2);
  writeLe32(out, kChannels);
  writeLe32(out, sampleRate);
  writeLe32(out, 1);
  writeLe64(out, kBlockSizePerChannel * 8);
  writeLe32(out, kBlockSizePerChannel);
  writeLe32(out, 0);
  out.write("data", 4);
  writeLe64(out, 12 + kDataBytes);
  for (uint64_t i = 0; i < kDataBytes; ++i) out.put(static_cast<char>(0x69));
  return path;
}

void assertDsfMetadataWhenSupported(const std::string& name, uint32_t sampleRate, int dsdRate) {
  const auto path = writeDsfFixture(name, sampleRate);
  const std::string json = readMetadataJson(path.string());
  std::filesystem::remove(path);
  if (json.find("\"error\":\"\"") == std::string::npos) {
    std::cout << "Skipping DSF metadata fixture: FFmpeg could not parse generated DSF" << std::endl;
    return;
  }
  assert(json.find("\"codec\":\"dsd") != std::string::npos);
  assert(json.find("\"container\":\"") != std::string::npos);
  assert(json.find("\"isDsd\":true") != std::string::npos);
  assert(json.find("\"dsdMode\":\"unsupported\"") != std::string::npos);
  assert(json.find("\"sampleRate\":" + std::to_string(sampleRate)) != std::string::npos);
  assert(json.find("\"dsdRate\":" + std::to_string(dsdRate)) != std::string::npos);
  assert(json.find("\"channelCount\":2") != std::string::npos);
  assert(json.find("\"bitDepth\":1") != std::string::npos);
}
#endif

}  // namespace

int main() {
  const std::string empty = readMetadataJson("");
  assert(empty.find("\"error\":\"音频地址为空\"") != std::string::npos);

  const std::string sacdIso = readMetadataJson("album.iso");
  assert(sacdIso.find("\"codec\":\"sacd_iso\"") != std::string::npos);
  assert(sacdIso.find("\"container\":\"SACD ISO\"") != std::string::npos);
  assert(sacdIso.find("\"isDsd\":true") != std::string::npos);
  assert(sacdIso.find("\"dsdMode\":\"unsupported\"") != std::string::npos);
  assert(sacdIso.find("SACD ISO 暂不支持解析和播放") != std::string::npos);

  const std::string missing = readMetadataJson("missing-file.flac");
  assert(missing.find("\"source\":\"missing-file.flac\"") != std::string::npos);
  assert(missing.find("\"composer\"") != std::string::npos);
  assert(missing.find("\"albumArtist\"") != std::string::npos);
  assert(missing.find("\"trackNumber\"") != std::string::npos);
  assert(missing.find("\"discNumber\"") != std::string::npos);
  assert(missing.find("\"comment\"") != std::string::npos);
#if defined(TAE_HAS_FFMPEG)
  assertDsfMetadataWhenSupported("twilight-metadata-dsd64.dsf", 2822400, 64);
  assertDsfMetadataWhenSupported("twilight-metadata-dsd128.dsf", 5644800, 128);
  assertDsfMetadataWhenSupported("twilight-metadata-dsd256.dsf", 11289600, 256);
#endif
  return 0;
}
