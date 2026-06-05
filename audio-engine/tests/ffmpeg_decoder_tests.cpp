#include "../decoder/FFmpegDecoder.h"

#include <cassert>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

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

std::filesystem::path writePcmWav(const std::string& name, int bitsPerSample) {
  const auto path = std::filesystem::temp_directory_path() / name;
  const int sampleRate = 48000;
  const int channels = 2;
  const int bytesPerSample = bitsPerSample / 8;
  const int frameCount = 32;
  const int dataBytes = frameCount * channels * bytesPerSample;

  std::ofstream out(path, std::ios::binary);
  out.write("RIFF", 4);
  writeLe32(out, 36 + static_cast<uint32_t>(dataBytes));
  out.write("WAVE", 4);
  out.write("fmt ", 4);
  writeLe32(out, 16);
  writeLe16(out, 1);
  writeLe16(out, static_cast<uint16_t>(channels));
  writeLe32(out, sampleRate);
  writeLe32(out, static_cast<uint32_t>(sampleRate * channels * bytesPerSample));
  writeLe16(out, static_cast<uint16_t>(channels * bytesPerSample));
  writeLe16(out, static_cast<uint16_t>(bitsPerSample));
  out.write("data", 4);
  writeLe32(out, static_cast<uint32_t>(dataBytes));
  for (int frame = 0; frame < frameCount; ++frame) {
    for (int channel = 0; channel < channels; ++channel) {
      if (bitsPerSample == 16) {
        writeLe16(out, static_cast<uint16_t>(frame * 64));
      } else if (bitsPerSample == 24) {
        const int32_t value = frame * 512;
        out.put(static_cast<char>(value & 0xff));
        out.put(static_cast<char>((value >> 8) & 0xff));
        out.put(static_cast<char>((value >> 16) & 0xff));
      } else {
        writeLe32(out, static_cast<uint32_t>(frame * 1024));
      }
    }
  }
  return path;
}

std::filesystem::path writeDsfFixture(const std::string& name) {
  const auto path = std::filesystem::temp_directory_path() / name;
  constexpr uint32_t kChannels = 2;
  constexpr uint32_t kSampleRate = 2822400;
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
  writeLe32(out, kSampleRate);
  writeLe32(out, 1);
  writeLe64(out, kBlockSizePerChannel * 8);
  writeLe32(out, kBlockSizePerChannel);
  writeLe32(out, 0);
  out.write("data", 4);
  writeLe64(out, 12 + kDataBytes);
  for (uint64_t i = 0; i < kDataBytes; ++i) out.put(static_cast<char>(0x69));
  return path;
}

void assertDecoderReportsPcm(const std::string& name, int bitsPerSample) {
  const auto path = writePcmWav(name, bitsPerSample);
  FFmpegDecoder decoder;
  std::string error;
  assert(decoder.open(path.string(), &error));
  const AudioStreamInfo stream = decoder.streamInfo();
  assert(stream.sourceLossless);
  assert(!stream.isDsd);
  assert(stream.sourceFormat.sampleRate == 48000);
  assert(stream.sourceFormat.channelCount == 2);
  assert(stream.sourceFormat.bitDepth == bitsPerSample);
  assert(stream.decodedFormat.sampleRate == 48000);
  assert(stream.decodedFormat.channelCount == 2);
  assert(stream.decodedFormat.bitDepth == 32);
  assert(stream.decodedFormat.sampleFormat == AudioSampleFormat::Float32Interleaved);
  decoder.close();
  std::filesystem::remove(path);
}

void assertDecoderReportsDsdFallbackWhenSupported() {
  const auto path = writeDsfFixture("twilight-decoder-dsd64.dsf");
  FFmpegDecoder decoder;
  std::string error;
  if (!decoder.open(path.string(), &error)) {
    std::filesystem::remove(path);
    std::cout << "Skipping DSF decoder fixture: " << error << std::endl;
    return;
  }

  const AudioStreamInfo stream = decoder.streamInfo();
  assert(stream.isDsd);
  assert(stream.dsdMode == DsdMode::Pcm);
  assert(stream.dsdRate == 64);
  assert(stream.sourceLossless);
  assert(stream.sourceFormat.sampleRate == 2822400);
  assert(stream.sourceFormat.channelCount == 2);
  assert(stream.sourceFormat.bitDepth == 1);
  assert(stream.decodedFormat.channelCount == 2);
  assert(stream.decodedFormat.bitDepth == 32);
  assert(stream.decodedFormat.sampleFormat == AudioSampleFormat::Float32Interleaved);
  assert(stream.decodedFormat.sampleRate > 0);
  decoder.close();
  std::filesystem::remove(path);
}

}  // namespace

int main() {
#if defined(TAE_HAS_FFMPEG)
  assertDecoderReportsPcm("twilight-fixture-s16.wav", 16);
  assertDecoderReportsPcm("twilight-fixture-s24.wav", 24);
  assertDecoderReportsPcm("twilight-fixture-s32.wav", 32);
  assertDecoderReportsDsdFallbackWhenSupported();
#endif
  return 0;
}
