#include "../decoder/DopPacker.h"
#include "../decoder/DopPackerUtils.h"
#include "../decoder/DsdReader.h"
#include "../decoder/SacdIsoDemuxer.h"
#include "../decoder/SacdIsoDemuxerUtils.h"
#include "../decoder/SacdIsoProbe.h"
#include "../core/AudioPipelineDsdUtils.h"

#include <cassert>
#include <array>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

using namespace twilight::audio;

namespace {

void testSacdIsoByteScratchResizePreservesSameSizedScratch() {
  std::vector<uint8_t> scratch = {0x11, 0x22, 0x33};
  const uint8_t* before = scratch.data();

  sacd::resizeByteScratchForOverwrite(scratch, scratch.size());

  assert(scratch.data() == before);
  assert((scratch == std::vector<uint8_t>{0x11, 0x22, 0x33}));
}

std::string readTextFile(const std::filesystem::path& path) {
  std::ifstream input(path);
  std::ostringstream buffer;
  buffer << input.rdbuf();
  return buffer.str();
}

void testSacdDstDecodePathDoesNotPreclearDecodedFrameBuffer() {
  const std::filesystem::path sourcePath =
      std::filesystem::path(__FILE__).parent_path().parent_path() / "decoder" / "SacdIsoDemuxer.cpp";
  const std::string source = readTextFile(sourcePath);

  if (source.empty() || source.find("decodedDsdBuffer.assign(decodedFrameBytes, 0)") != std::string::npos) {
    std::abort();
  }
}

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

void writeLe32To(uint8_t* data, uint32_t value) {
  data[0] = static_cast<uint8_t>(value & 0xff);
  data[1] = static_cast<uint8_t>((value >> 8) & 0xff);
  data[2] = static_cast<uint8_t>((value >> 16) & 0xff);
  data[3] = static_cast<uint8_t>((value >> 24) & 0xff);
}

void writeBe32To(uint8_t* data, uint32_t value) {
  data[0] = static_cast<uint8_t>((value >> 24) & 0xff);
  data[1] = static_cast<uint8_t>((value >> 16) & 0xff);
  data[2] = static_cast<uint8_t>((value >> 8) & 0xff);
  data[3] = static_cast<uint8_t>(value & 0xff);
}

void writeTwilightTrack(
    std::vector<uint8_t>& toc,
    size_t offset,
    int trackNumber,
    uint32_t startSector,
    uint32_t sectorCount,
    uint32_t channelCount,
    uint32_t sampleRate,
    bool dst,
    const std::string& fileName) {
  assert(offset + 64 <= toc.size());
  std::memcpy(toc.data() + offset, "TWTE1", 5);
  writeLe32To(toc.data() + offset + 8, static_cast<uint32_t>(trackNumber));
  writeLe32To(toc.data() + offset + 12, startSector);
  writeLe32To(toc.data() + offset + 16, sectorCount);
  writeLe32To(toc.data() + offset + 20, channelCount);
  writeLe32To(toc.data() + offset + 24, sampleRate);
  writeLe32To(toc.data() + offset + 28, dst ? 1U : 0U);
  std::copy(fileName.begin(), fileName.end(), toc.begin() + static_cast<std::ptrdiff_t>(offset + 32));
}

void writeDirectoryRecord(
    std::vector<uint8_t>& directory,
    size_t offset,
    uint32_t extent,
    uint32_t size,
    bool isDirectory,
    const std::string& name) {
  const size_t nameLength = name.size();
  const size_t recordLength = 33 + nameLength + ((nameLength % 2) == 0 ? 1 : 0);
  assert(offset + recordLength <= directory.size());
  directory[offset] = static_cast<uint8_t>(recordLength);
  writeLe32To(directory.data() + offset + 2, extent);
  writeBe32To(directory.data() + offset + 6, extent);
  writeLe32To(directory.data() + offset + 10, size);
  writeBe32To(directory.data() + offset + 14, size);
  directory[offset + 25] = isDirectory ? 0x02 : 0x00;
  directory[offset + 28] = 1;
  directory[offset + 31] = 1;
  directory[offset + 32] = static_cast<uint8_t>(nameLength);
  std::copy(name.begin(), name.end(), directory.begin() + static_cast<std::ptrdiff_t>(offset + 33));
}

void writeSpecialDirectoryRecord(
    std::vector<uint8_t>& directory,
    size_t offset,
    uint32_t extent,
    uint32_t size,
    uint8_t name) {
  directory[offset] = 34;
  writeLe32To(directory.data() + offset + 2, extent);
  writeBe32To(directory.data() + offset + 6, extent);
  writeLe32To(directory.data() + offset + 10, size);
  writeBe32To(directory.data() + offset + 14, size);
  directory[offset + 25] = 0x02;
  directory[offset + 28] = 1;
  directory[offset + 31] = 1;
  directory[offset + 32] = 1;
  directory[offset + 33] = name;
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

std::filesystem::path writeSacdIsoFixture(const std::string& name) {
  const auto path = std::filesystem::temp_directory_path() / name;
  constexpr uint32_t kRootSector = 20;
  constexpr uint32_t kSacdSector = 21;
  constexpr uint32_t kSectorSize = 2048;
  std::vector<uint8_t> image(28 * kSectorSize, 0);

  uint8_t* pvd = image.data() + 16 * kSectorSize;
  pvd[0] = 1;
  std::memcpy(pvd + 1, "CD001", 5);
  pvd[6] = 1;
  std::memcpy(pvd + 40, "TWILIGHT_SACD_FIXTURE", 21);
  pvd[80] = 28;
  writeLe32To(pvd + 156 + 2, kRootSector);
  writeBe32To(pvd + 156 + 6, kRootSector);
  writeLe32To(pvd + 156 + 10, kSectorSize);
  writeBe32To(pvd + 156 + 14, kSectorSize);
  pvd[156] = 34;
  pvd[156 + 25] = 0x02;
  pvd[156 + 28] = 1;
  pvd[156 + 31] = 1;
  pvd[156 + 32] = 1;

  uint8_t* terminator = image.data() + 17 * kSectorSize;
  terminator[0] = 255;
  std::memcpy(terminator + 1, "CD001", 5);
  terminator[6] = 1;

  std::vector<uint8_t> root(kSectorSize, 0);
  writeSpecialDirectoryRecord(root, 0, kRootSector, kSectorSize, 0);
  writeSpecialDirectoryRecord(root, 34, kRootSector, kSectorSize, 1);
  writeDirectoryRecord(root, 68, kSacdSector, kSectorSize, true, "SACD");
  std::copy(root.begin(), root.end(), image.begin() + kRootSector * kSectorSize);

  std::vector<uint8_t> sacd(kSectorSize, 0);
  writeSpecialDirectoryRecord(sacd, 0, kSacdSector, kSectorSize, 0);
  writeSpecialDirectoryRecord(sacd, 34, kRootSector, kSectorSize, 1);
  writeDirectoryRecord(sacd, 68, 22, 128, false, "MASTER.TOC");
  writeDirectoryRecord(sacd, 112, 23, 2048, false, "TWOCH_AREA.TOC");
  writeDirectoryRecord(sacd, 160, 24, 2048, false, "MCH_AREA.TOC");
  writeDirectoryRecord(sacd, 206, 25, 256, false, "TRACK01.DSD");
  writeDirectoryRecord(sacd, 250, 26, 256, false, "TRACK01.DST");
  std::copy(sacd.begin(), sacd.end(), image.begin() + kSacdSector * kSectorSize);

  std::vector<uint8_t> twoch(kSectorSize, 0);
  std::memcpy(twoch.data(), "TWTEAREA", 8);
  writeLe32To(twoch.data() + 8, 2);
  writeTwilightTrack(twoch, 16, 1, 25, 1, 2, 2822400, false, "TRACK01.DSD");
  writeTwilightTrack(twoch, 80, 2, 26, 1, 2, 2822400, true, "TRACK01.DST");
  std::copy(twoch.begin(), twoch.end(), image.begin() + 23 * kSectorSize);

  std::vector<uint8_t> mch(kSectorSize, 0);
  std::memcpy(mch.data(), "TWTEAREA", 8);
  writeLe32To(mch.data() + 8, 1);
  writeTwilightTrack(mch, 16, 1, 25, 1, 6, 2822400, false, "TRACK01.DSD");
  std::copy(mch.begin(), mch.end(), image.begin() + 24 * kSectorSize);

  for (int i = 0; i < 256; ++i) image[25 * kSectorSize + i] = static_cast<uint8_t>(0x80 + (i & 0x3f));
  for (int i = 0; i < 256; ++i) image[26 * kSectorSize + i] = static_cast<uint8_t>(0x40 + (i & 0x3f));

  std::ofstream out(path, std::ios::binary);
  out.write(reinterpret_cast<const char*>(image.data()), static_cast<std::streamsize>(image.size()));
  return path;
}

std::filesystem::path writeNonSacdIsoFixture(const std::string& name) {
  const auto path = std::filesystem::temp_directory_path() / name;
  std::array<uint8_t, 4096> bytes{};
  std::ofstream out(path, std::ios::binary);
  out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
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
  reader.close();
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
  reader.close();
  std::filesystem::remove(path);
}

void testDsdInterleaveHelperConvertsPlanarBlocks() {
  DsdStreamInfo info;
  info.channelCount = 2;
  info.bitOrder = DsdBitOrder::LsbFirst;
  info.packing = DsdPacking::DsfPlanarBlocks;

  const uint8_t dsd[] = {
      0x11, 0x22,
      0x99, 0xaa,
  };
  std::vector<uint8_t> output(4, 0xee);

  const size_t frames =
      render::dsdBytesToInterleavedResizeOnly(dsd, sizeof(dsd), info, AudioSampleFormat::DsdInt8Lsb1, &output);

  const std::vector<uint8_t> expected = {0x11, 0x99, 0x22, 0xaa};
  assert(frames == 2);
  assert(output == expected);
}

void testDsdInterleaveHelperConvertsBitOrderWithoutPreclearSentinel() {
  DsdStreamInfo info;
  info.channelCount = 2;
  info.bitOrder = DsdBitOrder::LsbFirst;
  info.packing = DsdPacking::DffInterleaved;

  const uint8_t dsd[] = {
      0x80, 0x01,
      0xf0, 0x0f,
  };
  std::vector<uint8_t> output(4, 0xee);

  const size_t frames =
      render::dsdBytesToInterleavedResizeOnly(dsd, sizeof(dsd), info, AudioSampleFormat::DsdInt8Msb1, &output);

  const std::vector<uint8_t> expected = {0x01, 0x80, 0x0f, 0xf0};
  assert(frames == 2);
  assert(output == expected);
}

void testDsdInterleaveHelperCanCopyDffWhenBitOrderMatches() {
  DsdStreamInfo info;
  info.channelCount = 2;
  info.bitOrder = DsdBitOrder::MsbFirst;
  info.packing = DsdPacking::DffInterleaved;

  if (!render::canCopyDsdBytesToInterleaved(info, AudioSampleFormat::DsdInt8Msb1)) std::abort();
  if (render::canCopyDsdBytesToInterleaved(info, AudioSampleFormat::DsdInt8Lsb1)) std::abort();
}

void testDopPackerInt24() {
  DopPacker packer;
  DopPackerConfig config;
  config.channelCount = 2;
  config.dsdRate = 64;
  config.sourceSampleRate = 2822400;
  config.outputFormat = AudioSampleFormat::Int24Interleaved;
  std::string error;
  assert(packer.configure(config, &error));
  const uint8_t dsd[] = {0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88};
  std::vector<uint8_t> pcm;
  assert(packer.pack(dsd, sizeof(dsd), &pcm) == 2);
  assert(pcm.size() == 12);
  assert(pcm[0] == 0x11 && pcm[1] == 0x22 && pcm[2] == 0x05);
  assert(pcm[3] == 0x55 && pcm[4] == 0x66 && pcm[5] == 0x05);
  assert(pcm[6] == 0x33 && pcm[7] == 0x44 && pcm[8] == 0xfa);
  assert(pcm[9] == 0x77 && pcm[10] == 0x88 && pcm[11] == 0xfa);
}

void testDopPackerHelperPacksInterleavedInt24In32WithoutPreclear() {
  const uint8_t dsd[] = {
      0x80, 0x01,
      0xf0, 0x0f,
  };
  std::vector<uint8_t> pcm(16, 0xee);
  size_t markerIndex = 0;

  const size_t frames = dop::packDopFramesResizeOnly(
      dsd,
      sizeof(dsd),
      1,
      DsdPacking::DffInterleaved,
      DsdBitOrder::MsbFirst,
      AudioSampleFormat::Int24In32Interleaved,
      markerIndex,
      &pcm);

  const std::vector<uint8_t> expected = {
      0x00, 0x01, 0x80, 0x05,
      0x00, 0x0f, 0xf0, 0xfa,
  };
  assert(frames == 2);
  assert(markerIndex == 2);
  assert(pcm == expected);
}

void testDopPackerDsd256() {
  DopPacker packer;
  DopPackerConfig config;
  config.channelCount = 2;
  config.dsdRate = 256;
  config.sourceSampleRate = 11289600;
  config.outputFormat = AudioSampleFormat::Int24Interleaved;
  std::string error;
  assert(packer.configure(config, &error));
  assert(packer.carrierFormat().sampleRate == 705600);
  assert(packer.carrierFormat().bitDepth == 24);
  assert(packer.carrierFormat().sampleFormat == AudioSampleFormat::Int24Interleaved);

  const uint8_t dsd[] = {0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88};
  std::vector<uint8_t> pcm;
  assert(packer.pack(dsd, sizeof(dsd), &pcm) == 2);
  assert(pcm.size() == 12);
  assert(pcm[0] == 0x11 && pcm[1] == 0x22 && pcm[2] == 0x05);
  assert(pcm[3] == 0x55 && pcm[4] == 0x66 && pcm[5] == 0x05);
  assert(pcm[6] == 0x33 && pcm[7] == 0x44 && pcm[8] == 0xfa);
  assert(pcm[9] == 0x77 && pcm[10] == 0x88 && pcm[11] == 0xfa);
}

void testDopPackerDsd512() {
  DopPacker packer;
  DopPackerConfig config;
  config.channelCount = 2;
  config.dsdRate = 512;
  config.sourceSampleRate = 22579200;
  config.outputFormat = AudioSampleFormat::Int24Interleaved;
  std::string error;
  assert(packer.configure(config, &error));
  assert(packer.carrierFormat().sampleRate == 1411200);
  assert(packer.carrierFormat().bitDepth == 24);
  assert(packer.carrierFormat().sampleFormat == AudioSampleFormat::Int24Interleaved);

  const uint8_t dsd[] = {0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0};
  std::vector<uint8_t> pcm;
  assert(packer.pack(dsd, sizeof(dsd), &pcm) == 2);
  assert(pcm.size() == 12);
  assert(pcm[0] == 0x12 && pcm[1] == 0x34 && pcm[2] == 0x05);
  assert(pcm[3] == 0x9a && pcm[4] == 0xbc && pcm[5] == 0x05);
  assert(pcm[6] == 0x56 && pcm[7] == 0x78 && pcm[8] == 0xfa);
  assert(pcm[9] == 0xde && pcm[10] == 0xf0 && pcm[11] == 0xfa);
}

void testDopPackerInt24In32() {
  DopPacker packer;
  DopPackerConfig config;
  config.channelCount = 1;
  config.dsdRate = 128;
  config.sourceSampleRate = 5644800;
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

void testSacdIsoProbePlayableEntry() {
  const auto notIso = probeSacdIsoEntry("album.dsf");
  assert(!notIso.isSacdIso());
  assert(!notIso.unsupported());
  assert(notIso.status == SacdIsoEntryStatus::NotSacdIso);
  assert(notIso.reasonCode.empty());
  assert(!notIso.isDsd);
  assert(!notIso.playable);

  const auto nestedPath = probeSacdIsoEntry("library.iso/track.dsf");
  assert(!nestedPath.isSacdIso());

  const auto nonIso = writeNonSacdIsoFixture("twilight-not-sacd.iso");
  const auto rejectedProbe = probeSacdIsoEntry(nonIso.string());
  assert(!rejectedProbe.isSacdIso());
  assert(rejectedProbe.isIso9660 == false);
  assert(rejectedProbe.reasonCode == kSacdIsoNotIso9660ReasonCode);
  {
    std::error_code ignored;
    std::filesystem::remove(nonIso, ignored);
  }

  const auto iso = writeSacdIsoFixture("twilight-sacd-fixture.iso");
  const auto probe = probeSacdIsoEntry(iso.string());
  assert(probe.isSacdIso());
  assert(!probe.unsupported());
  assert(probe.status == SacdIsoEntryStatus::Supported);
  assert(probe.source == iso.string());
  assert(probe.reasonCode.empty());
  assert(probe.reason.empty());
  assert(probe.codec == kSacdIsoCodecName);
  assert(probe.container == kSacdIsoContainerName);
  assert(probe.isIso9660);
  assert(probe.hasSacdMarkers);
  assert(probe.isDsd);
  assert(probe.hasDst);
  assert(probe.playable);

  DsdReader reader;
  std::string error;
  assert(reader.open((iso.string() + "?area=stereo&track=1"), &error));
  assert(reader.streamInfo().container == "SACD ISO");
  assert(reader.streamInfo().channelCount == 2);
  assert(reader.streamInfo().dsdRate == 64);
  std::vector<uint8_t> bytes(16);
  assert(reader.readBytes(bytes.data(), bytes.size()) == bytes.size());
  assert(bytes[0] == 0x80);
  reader.close();

  assert(!reader.open((iso.string() + "?area=stereo&track=2"), &error));
  assert(error == kSacdDstDsdProviderUnavailableReason);
  {
    std::error_code ignored;
    std::filesystem::remove(iso, ignored);
  }
}

void testSacdIsoDemuxerTracksAndSeek() {
  const auto iso = writeSacdIsoFixture("twilight-sacd-demuxer-fixture.iso");
  SacdIsoDemuxer demuxer;
  std::string error;
  assert(demuxer.open(iso.string(), &error));
  assert(demuxer.tracks().size() == 3);
  assert(demuxer.selectTrack("stereo", 1, &error));
  assert(demuxer.streamInfo().source.find("area=stereo&track=1") != std::string::npos);
  std::vector<uint8_t> bytes(8);
  assert(demuxer.readBytes(bytes.data(), bytes.size()) == bytes.size());
  assert(bytes[0] == 0x80);
  assert(demuxer.seek(0.0, &error));
  assert(demuxer.readBytes(bytes.data(), bytes.size()) == bytes.size());
  assert(bytes[0] == 0x80);
  assert(!demuxer.selectTrack("stereo", 2, &error));
  assert(error == kSacdDstDsdProviderUnavailableReason);
  {
    std::error_code ignored;
    std::filesystem::remove(iso, ignored);
  }
}

class RejectingDstProvider final : public SacdDstProvider {
 public:
  const char* name() const override {
    return "rejecting-test-provider";
  }

  bool available(std::string* reason) const override {
    if (reason) *reason = "test provider disabled";
    return false;
  }
};

class AcceptingDstProvider final : public SacdDstProvider {
 public:
  const char* name() const override {
    return "accepting-test-provider";
  }

  bool available(std::string* reason) const override {
    if (reason) reason->clear();
    return true;
  }

  bool preservesDsd() const override {
    return true;
  }
};

class PartialDstDecoderProvider final : public SacdDstDecoderProvider {
 public:
  const char* name() const override {
    return "partial-dst-decoder-test-provider";
  }

  bool available(std::string* reason) const override {
    if (reason) reason->clear();
    return true;
  }

  bool open(int channels, int sampleRate, std::string* error) override {
    (void)channels;
    (void)sampleRate;
    if (error) error->clear();
    frameIndex_ = 0;
    return true;
  }

  size_t decodeFrame(
      const uint8_t* dstFrameBytes,
      size_t dstFrameSize,
      uint8_t* dsdOut,
      size_t dsdOutSize,
      std::string* error) override {
    (void)dstFrameBytes;
    (void)dstFrameSize;
    if (error) error->clear();
    if (dsdOutSize < 3) return 0;
    const uint8_t base = static_cast<uint8_t>(0x10 + frameIndex_ * 0x10);
    dsdOut[0] = base;
    dsdOut[1] = static_cast<uint8_t>(base + 1);
    dsdOut[2] = static_cast<uint8_t>(base + 2);
    ++frameIndex_;
    return 3;
  }

  size_t frameBytesPerChannel(int sampleRate) const override {
    (void)sampleRate;
    return 4;
  }

  void reset() override {
    frameIndex_ = 0;
  }

 private:
  size_t frameIndex_ = 0;
};

class PcmOnlyDstProvider final : public SacdDstProvider {
 public:
  const char* name() const override {
    return "pcm-only-test-provider";
  }

  bool available(std::string* reason) const override {
    if (reason) reason->clear();
    return true;
  }
};

void testSacdDstProviderSelection() {
  auto ffmpeg = selectSacdDstProvider(true, nullptr);
  assert(!ffmpeg.available);
  assert(ffmpeg.provider == kSacdDstFfmpegProviderName);
  assert(ffmpeg.reasonCode == kSacdDstDsdProviderUnavailableReasonCode);
  assert(ffmpeg.reason == kSacdDstDsdProviderUnavailableReason);

  auto none = selectSacdDstProvider(false, nullptr);
  assert(!none.available);
  assert(none.reasonCode == kSacdDstDsdProviderUnavailableReasonCode);
  assert(none.reason == kSacdDstDsdProviderUnavailableReason);

  RejectingDstProvider rejecting;
  auto rejected = selectSacdDstProvider(false, &rejecting);
  assert(!rejected.available);
  assert(rejected.provider == "rejecting-test-provider");
  assert(rejected.reasonCode == kSacdDstProviderRejectedReasonCode);
  assert(rejected.reason == "test provider disabled");

  PcmOnlyDstProvider pcmOnly;
  auto pcmOnlyRejected = selectSacdDstProvider(false, &pcmOnly);
  assert(!pcmOnlyRejected.available);
  assert(pcmOnlyRejected.provider == "pcm-only-test-provider");
  assert(pcmOnlyRejected.reasonCode == kSacdDstDsdProviderUnavailableReasonCode);
  assert(pcmOnlyRejected.reason == kSacdDstDsdProviderUnavailableReason);

  AcceptingDstProvider accepting;
  auto accepted = selectSacdDstProvider(false, &accepting);
  assert(accepted.available);
  assert(accepted.provider == "accepting-test-provider");
  assert(accepted.reasonCode.empty());
}

void testSacdDstTrackPlayableWithProvider() {
  // When a DSD-preserving DST decoder provider is registered, SACD ISO DST
  // tracks flip to playable and selectTrack succeeds (no longer rejected with
  // dst_dsd_provider_unavailable). The fixture's DST track carries synthetic
  // payload (not a real compressed DST frame), so readBytes may stop at EOF
  // when the decoder cannot parse it; the contract under test is that the
  // track is selectable and the provider is wired up.
  const auto iso = writeSacdIsoFixture("twilight-sacd-dst-provider-fixture.iso");
  auto provider = createDefaultSacdDstDecoderProvider();
  assert(provider != nullptr);
  std::string reason;
  assert(provider->available(&reason));

  SacdIsoDemuxer demuxer;
  demuxer.setDstDecoderProvider(provider.get());
  std::string error;
  assert(demuxer.open(iso.string(), &error));
  // The fixture has a DST track (stereo track 2). With a provider registered
  // it must report playable=true (no dst_dsd_provider_unavailable reason).
  bool foundDst = false;
  for (const auto& track : demuxer.tracks()) {
    if (track.isDst) {
      foundDst = true;
      assert(track.playable);
      assert(track.reasonCode.empty());
      assert(track.reason.empty());
    }
  }
  assert(foundDst);
  // selectTrack on the DST track must succeed now that a provider is wired up.
  assert(demuxer.selectTrack("stereo", 2, &error));
  assert(demuxer.streamInfo().isDsd);
  assert(demuxer.streamInfo().codec == "dst");
  {
    std::error_code ignored;
    std::filesystem::remove(iso, ignored);
  }
}

void testSacdDstReadBytesDrainsOnlyDecodedBytes() {
  const auto iso = writeSacdIsoFixture("twilight-sacd-dst-partial-decode-fixture.iso");
  PartialDstDecoderProvider provider;
  SacdIsoDemuxer demuxer;
  demuxer.setDstDecoderProvider(&provider);
  std::string error;
  if (!demuxer.open(iso.string(), &error) || !demuxer.selectTrack("stereo", 2, &error)) {
    std::abort();
  }

  std::vector<uint8_t> bytes(8, 0xee);
  const size_t read = demuxer.readBytes(bytes.data(), bytes.size());
  const std::vector<uint8_t> expected = {0x10, 0x11, 0x12, 0x20, 0x21, 0x22, 0x30, 0x31};
  if (read != bytes.size() || bytes != expected) {
    std::abort();
  }

  {
    std::error_code ignored;
    std::filesystem::remove(iso, ignored);
  }
}

void testSacdDstTrackUnplayableWithoutProvider() {
  // Without a provider, DST tracks remain unplayable (regression guard for
  // the dst_dsd_provider_unavailable contract).
  const auto iso = writeSacdIsoFixture("twilight-sacd-dst-no-provider-fixture.iso");
  SacdIsoDemuxer demuxer;
  std::string error;
  assert(demuxer.open(iso.string(), &error));
  bool foundDst = false;
  for (const auto& track : demuxer.tracks()) {
    if (track.isDst) {
      foundDst = true;
      assert(!track.playable);
      assert(track.reasonCode == kSacdDstDsdProviderUnavailableReasonCode);
    }
  }
  assert(foundDst);
  assert(!demuxer.selectTrack("stereo", 2, &error));
  assert(error == kSacdDstDsdProviderUnavailableReason);
  {
    std::error_code ignored;
    std::filesystem::remove(iso, ignored);
  }
}

}  // namespace

int main() {
  testSacdIsoByteScratchResizePreservesSameSizedScratch();
  testSacdDstDecodePathDoesNotPreclearDecodedFrameBuffer();
  testDsfReader();
  testDffReader();
  testDsdInterleaveHelperConvertsPlanarBlocks();
  testDsdInterleaveHelperConvertsBitOrderWithoutPreclearSentinel();
  testDsdInterleaveHelperCanCopyDffWhenBitOrderMatches();
  testDopPackerHelperPacksInterleavedInt24In32WithoutPreclear();
  testDopPackerInt24();
  testDopPackerDsd256();
  testDopPackerDsd512();
  testDopPackerInt24In32();
  testSacdIsoProbePlayableEntry();
  testSacdIsoDemuxerTracksAndSeek();
  testSacdDstProviderSelection();
  testSacdDstTrackPlayableWithProvider();
  testSacdDstReadBytesDrainsOnlyDecodedBytes();
  testSacdDstTrackUnplayableWithoutProvider();
  assert(sourceLooksDsfOrDff("song.DSF"));
  assert(sourceLooksDsfOrDff("song.dff"));
  assert(inferDsdRateFromSampleRate(11289600) == 256);
  return 0;
}
