#include "../decoder/FFmpegDecoder.h"
#include "../decoder/FFmpegDecoderUtils.h"
#include "AudioFixtureLibrary.h"

#include <cassert>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

using namespace twilight::audio;
using namespace twilight::audio::test;

namespace {

std::string readTextFile(const std::filesystem::path& path) {
  std::ifstream input(path);
  std::ostringstream buffer;
  buffer << input.rdbuf();
  return buffer.str();
}

void assertDecoderInt24AppendAvoidsUnalignedInt32Reads() {
  const std::filesystem::path sourcePath =
      std::filesystem::path(__FILE__).parent_path().parent_path() / "decoder" / "FFmpegDecoderUtils.h";
  const std::string source = readTextFile(sourcePath);
  if (source.empty() || source.find("reinterpret_cast<const int32_t*>(source)") != std::string::npos) {
    std::abort();
  }
}

void assertDecoderContinuesWhenResamplerOutputsNoSamples() {
  const std::filesystem::path sourcePath =
      std::filesystem::path(__FILE__).parent_path().parent_path() / "decoder" / "FFmpegDecoder.cpp";
  const std::string source = readTextFile(sourcePath);
  if (source.empty() || source.find("return ok && !pending.empty();") != std::string::npos ||
      source.find("if (pending.empty())") == std::string::npos) {
    std::abort();
  }
}

void assertDecoderReportsPcm(const std::string& name, int bitsPerSample) {
  const auto fixture = writePcmWavFixture({name, 48000, 2, bitsPerSample, 32, false});
  FFmpegDecoder decoder;
  std::string error;
  assert(decoder.open(fixture.string(), &error));
  const AudioStreamInfo stream = decoder.streamInfo();
  assert(stream.sourceLossless);
  assert(!stream.isDsd);
  assert(stream.sourceFormat.sampleRate == 48000);
  assert(stream.sourceFormat.channelCount == 2);
  assert(stream.sourceFormat.bitDepth == bitsPerSample);
  assert(stream.decodedFormat.sampleRate == 48000);
  assert(stream.decodedFormat.channelCount == 2);
  assert(stream.decodedFormat.bitDepth == bitsPerSample);
  if (bitsPerSample == 16) {
    assert(stream.decodedFormat.sampleFormat == AudioSampleFormat::Int16Interleaved);
  } else if (bitsPerSample == 24) {
    assert(stream.decodedFormat.sampleFormat == AudioSampleFormat::Int24Interleaved);
  } else {
    assert(stream.decodedFormat.sampleFormat == AudioSampleFormat::Int32Interleaved);
  }
  decoder.close();
}

void assertDecoderTailZeroHelperPreservesCopiedFrames() {
  AudioFormat format;
  format.sampleRate = 48000;
  format.channelCount = 2;
  format.bitDepth = 32;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;

  std::vector<uint8_t> bytes(3 * audioFormatBytesPerFrame(format), 0x7f);
  PcmBlock block;
  block.format = format;
  block.data = bytes.data();
  block.frames = 3;
  block.byteSize = bytes.size();

  ffmpeg::zeroPcmBlockTail(block, 1);

  const size_t bytesPerFrame = audioFormatBytesPerFrame(format);
  for (size_t i = 0; i < bytesPerFrame; ++i) {
    assert(bytes[i] == 0x7f);
  }
  for (size_t i = bytesPerFrame; i < bytes.size(); ++i) {
    assert(bytes[i] == 0);
  }
}

void assertDecoderDirectPendingHelperShrinksToActualSamples() {
  std::vector<uint8_t> pending = {0xaa, 0xbb};
  const size_t start = pending.size();
  uint8_t* write = ffmpeg::resizePendingForDirectWrite(
      pending,
      4,
      AudioSampleFormat::Float32Interleaved);
  assert(write == pending.data() + start);
  assert(pending.size() == start + 4 * sizeof(float));

  ffmpeg::commitPendingDirectWrite(
      pending,
      start,
      2,
      AudioSampleFormat::Float32Interleaved);
  assert(pending.size() == start + 2 * sizeof(float));
  assert(pending[0] == 0xaa);
  assert(pending[1] == 0xbb);

  assert(ffmpeg::resizePendingForDirectWrite(
             pending,
             4,
             AudioSampleFormat::Int24Interleaved) == nullptr);
}

void assertDecoderReportsDsdFallbackWhenSupported() {
  const auto fixture = writeDsfFixture("twilight-decoder-dsd64.dsf");
  FFmpegDecoder decoder;
  std::string error;
  if (!decoder.open(fixture.string(), &error)) {
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
}

std::filesystem::path pathFromUtf8Bytes(const std::string& utf8) {
  return std::filesystem::path(reinterpret_cast<const char8_t*>(utf8.c_str()));
}

void assertDecoderOpensUtf8Path() {
  const std::string chinesePath = "\xe4\xb8\xad\xe6\x96\x87\xe8\xb7\xaf\xe5\xbe\x84";
  const std::filesystem::path unicodeDir =
      std::filesystem::temp_directory_path() / pathFromUtf8Bytes("twilight-" + chinesePath);
  std::error_code fsError;
  std::filesystem::create_directories(unicodeDir, fsError);
  assert(!fsError);

  auto fixture = writePcmWavFixture(
      {(unicodeDir / pathFromUtf8Bytes("twilight-" + chinesePath + "-s16.wav")).string(), 48000, 2, 16, 32, false});
  assert(std::filesystem::exists(fixture.path()));

  FFmpegDecoder decoder;
  std::string error;
  const bool opened = decoder.open(fixture.string(), &error);
  if (!opened) {
    std::fprintf(stderr, "UTF-8 path fixture failed to decode: %s\nerror: %s\n", fixture.string().c_str(), error.c_str());
  }
  assert(opened);
  assert(decoder.streamInfo().source == fixture.string());
  assert(decoder.streamInfo().sourceFormat.sampleRate == 48000);
  assert(decoder.streamInfo().sourceFormat.channelCount == 2);
  decoder.close();

  fixture.cleanup();
  std::filesystem::remove(unicodeDir, fsError);
}

void assertDecoderOpensExternalFixturesWhenProvided() {
  const auto fixtures = findExternalAudioFixtures();
  if (fixtures.empty()) return;

  for (const auto& fixture : fixtures) {
    if (fixture.extension() == ".iso" || fixture.extension() == ".ISO") continue;
    FFmpegDecoder decoder;
    std::string error;
    const bool opened = decoder.open(fixture.string(), &error);
    if (!opened) {
      std::fprintf(stderr, "External fixture failed to decode: %s\nerror: %s\n", fixture.string().c_str(), error.c_str());
    }
    assert(opened);
    assert(decoder.streamInfo().source == fixture.string());
    assert(decoder.streamInfo().sourceFormat.sampleRate > 0);
    assert(decoder.streamInfo().sourceFormat.channelCount > 0);
    assert(decoder.streamInfo().decodedFormat.sampleRate > 0);
    assert(decoder.streamInfo().decodedFormat.channelCount > 0);
    decoder.close();
  }
}

}  // namespace

int main() {
  assertDecoderInt24AppendAvoidsUnalignedInt32Reads();
  assertDecoderContinuesWhenResamplerOutputsNoSamples();
  assertDecoderTailZeroHelperPreservesCopiedFrames();
  assertDecoderDirectPendingHelperShrinksToActualSamples();
#if defined(TAE_HAS_FFMPEG)
  assertDecoderReportsPcm("twilight-fixture-s16.wav", 16);
  assertDecoderReportsPcm("twilight-fixture-s24.wav", 24);
  assertDecoderReportsPcm("twilight-fixture-s32.wav", 32);
  assertDecoderReportsDsdFallbackWhenSupported();
  assertDecoderOpensUtf8Path();
  assertDecoderOpensExternalFixturesWhenProvided();
#endif
  return 0;
}
