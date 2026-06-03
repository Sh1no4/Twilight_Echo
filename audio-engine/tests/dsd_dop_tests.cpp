#include "../decoder/DopPacker.h"
#include "../decoder/DsdReader.h"

#include <cassert>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

using namespace twilight::audio;

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

void writeBe16(std::ofstream& out, uint16_t value) {
  out.put(static_cast<char>((value >> 8) & 0xff));
  out.put(static_cast<char>(value & 0xff));
}

void writeBe32(std::ofstream& out, uint32_t value) {
  writeBe16(out, static_cast<uint16_t>((value >> 16) & 0xffff));
  writeBe16(out, static_cast<uint16_t>(value & 0xffff));
}

void writeBe64(std::ofstream& out, uint64_t value) {
  writeBe32(out, static_cast<uint32_t>((value >> 32) & 0xffffffffULL));
  writeBe32(out, static_cast<uint32_t>(value & 0xffffffffULL));
}

std::filesystem::path writeDsfFixture(const std::string& name, int sampleRate = 2822400) {
  const auto path = std::filesystem::temp_directory_path() / name;
  constexpr uint32_t kChannels = 2;
  constexpr uint32_t kBlockSizePerChannel = 8;
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
  writeLe32(out, static_cast<uint32_t>(sampleRate));
  writeLe32(out, 1);
  writeLe64(out, kBlockSizePerChannel * 8);
  writeLe32(out, kBlockSizePerChannel);
  writeLe32(out, 0);
  out.write("data", 4);
  writeLe64(out, 12 + kDataBytes);
  for (uint8_t byte : {0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88}) out.put(static_cast<char>(byte));
  for (uint8_t byte : {0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xf0, 0x0f}) out.put(static_cast<char>(byte));
  return path;
}

std::filesystem::path writeDffFixture(const std::string& name) {
  const auto path = std::filesystem::temp_directory_path() / name;
  const uint64_t propPayload = 4 + (12 + 4) + (12 + 2);
  const uint64_t dsdPayload = 16;
  const uint64_t formSize = 4 + (12 + propPayload) + (12 + dsdPayload);

  std::ofstream out(path, std::ios::binary);
  out.write("FRM8", 4);
  writeBe64(out, formSize);
  out.write("DSD ", 4);
  out.write("PROP", 4);
  writeBe64(out, propPayload);
  out.write("SND ", 4);
  out.write("FS  ", 4);
  writeBe64(out, 4);
  writeBe32(out, 5644800);
  out.write("CHNL", 4);
  writeBe64(out, 2);
  writeBe16(out, 2);
  out.write("DSD ", 4);
  writeBe64(out, dsdPayload);
  for (int i = 0; i < 16; ++i) out.put(static_cast<char>(0x80 + i));
  return path;
}

void testDsfReader() {
  const auto path = writeDsfFixture("twilight-dsd-reader.dsf");
  DsdReader reader;
  std::string error;
  assert(reader.open(path.string(), &error));
  const auto info = reader.streamInfo();
  assert(info.container == "DSF");
  assert(info.channelCount == 2);
  assert(info.dsdSampleRate == 2822400);
  assert(info.dsdRate == 64);
  assert(info.bitOrder == DsdBitOrder::LsbFirst);
  assert(info.packing == DsdPacking::DsfPlanarBlocks);
  assert(info.durationSeconds > 0.0);

  std::vector<uint8_t> bytes(16);
  assert(reader.readBytes(bytes.data(), bytes.size()) == 16);
  assert(bytes[0] == 0x11);
  assert(bytes[8] == 0x99);
  std::filesystem::remove(path);
}

void testDffReader() {
  const auto path = writeDffFixture("twilight-dsd-reader.dff");
  DsdReader reader;
  std::string error;
  assert(reader.open(path.string(), &error));
  const auto info = reader.streamInfo();
  assert(info.container == "DFF");
  assert(info.channelCount == 2);
  assert(info.dsdSampleRate == 5644800);
  assert(info.dsdRate == 128);
  assert(info.bitOrder == DsdBitOrder::MsbFirst);
  assert(info.packing == DsdPacking::DffInterleaved);
  std::filesystem::remove(path);
}

void testDopPackerInt24() {
  DopPacker packer;
  DopPackerConfig config;
  config.channelCount = 2;
  config.dsdRate = 64;
  config.outputFormat = AudioSampleFormat::Int24Interleaved;
  std::string error;
  assert(packer.configure(config, &error));
  const uint8_t dsd[] = {0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88};
  std::vector<uint8_t> pcm;
  assert(packer.pack(dsd, sizeof(dsd), &pcm) == 2);
  assert(pcm.size() == 12);
  assert(pcm[0] == 0x11 && pcm[1] == 0x22 && pcm[2] == 0x05);
  assert(pcm[3] == 0x33 && pcm[4] == 0x44 && pcm[5] == 0x05);
  assert(pcm[6] == 0x55 && pcm[7] == 0x66 && pcm[8] == 0xfa);
  assert(pcm[9] == 0x77 && pcm[10] == 0x88 && pcm[11] == 0xfa);
}

void testDopPackerInt24In32() {
  DopPacker packer;
  DopPackerConfig config;
  config.channelCount = 1;
  config.dsdRate = 128;
  config.outputFormat = AudioSampleFormat::Int24In32Interleaved;
  std::string error;
  assert(packer.configure(config, &error));
  const uint8_t dsd[] = {0x12, 0x34, 0x56, 0x78};
  std::vector<uint8_t> pcm;
  assert(packer.pack(dsd, sizeof(dsd), &pcm) == 2);
  assert(pcm.size() == 8);
  assert(pcm[0] == 0x00 && pcm[1] == 0x12 && pcm[2] == 0x34 && pcm[3] == 0x05);
  assert(pcm[4] == 0x00 && pcm[5] == 0x56 && pcm[6] == 0x78 && pcm[7] == 0xfa);
}

}  // namespace

int main() {
  testDsfReader();
  testDffReader();
  testDopPackerInt24();
  testDopPackerInt24In32();
  assert(sourceLooksDsfOrDff("song.DSF"));
  assert(sourceLooksDsfOrDff("song.dff"));
  assert(sourceLooksSacdIso("album.iso"));
  assert(inferDsdRateFromSampleRate(11289600) == 256);
  return 0;
}
