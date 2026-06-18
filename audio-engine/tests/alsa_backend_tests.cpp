#include "../output/alsa/AlsaBackend.h"
#include "../output/alsa/MockAlsaHost.h"

#include <algorithm>
#include <cassert>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <thread>

using namespace twilight::audio;

namespace {

AudioFormat sourceFormat(
    int sampleRate = 96000,
    int bitDepth = 24,
    int channels = 2,
    AudioSampleFormat sampleFormat = AudioSampleFormat::Int24Interleaved) {
  AudioFormat format;
  format.sampleRate = sampleRate;
  format.bitDepth = bitDepth;
  format.channelCount = channels;
  format.sampleFormat = sampleFormat;
  return format;
}

bool waitForWrites(MockAlsaHost* host, int minimumWrites, std::chrono::milliseconds timeout = std::chrono::milliseconds(80)) {
  const auto deadline = std::chrono::steady_clock::now() + timeout;
  while (std::chrono::steady_clock::now() < deadline) {
    if (host->writeCalls >= minimumWrites) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return host->writeCalls >= minimumWrites;
}

void testAlsaOpenNegotiatesPcm() {
  auto host = std::make_unique<MockAlsaHost>();
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;

  assert(backend.open("default", sourceFormat(), &error));
  assert(!rawHost->setFormats.empty());
  assert(rawHost->setFormats.front() == AlsaPcmFormat::S24_3Le);
  assert(rawHost->requestedRate == 96000);
  assert(rawHost->hwParamsApplyCalls == 1);

  const OutputInfo info = backend.outputInfo();
  assert(info.actualOutputFormat == sampleFormatToString(AudioSampleFormat::Int24Interleaved));
  assert(info.actualBitDepth == 24);
  assert(info.actualChannels == 2);
  assert(info.actualSampleRate == 96000);
}

void testAlsaFormatFallback() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::S16Le};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;

  assert(backend.open("default", sourceFormat(), &error));
  assert(std::find(rawHost->testedFormats.begin(), rawHost->testedFormats.end(), AlsaPcmFormat::S24_3Le) !=
         rawHost->testedFormats.end());
  assert(!rawHost->setFormats.empty());
  assert(rawHost->setFormats.front() == AlsaPcmFormat::S16Le);
  assert(backend.outputInfo().actualBitDepth == 16);
}

void testAlsaXrunRecovery() {
  auto host = std::make_unique<MockAlsaHost>();
  host->pendingWriteErrors = {kAlsaErrEpipe};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;

  assert(backend.open("default", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));
  assert(backend.start([](float*, size_t frames) {
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
    return frames;
  }, nullptr, &error));
  assert(waitForWrites(rawHost, 2));
  backend.stop();

  const OutputInfo info = backend.outputInfo();
  assert(info.diagnostics.sessionUnderrunCount >= 1);
  assert(info.diagnostics.sessionRecoveryCount >= 1);
  assert(info.deviceRecovered);
  assert(rawHost->prepareCalls >= 2);
}

void testAlsaSuspendRecovery() {
  auto host = std::make_unique<MockAlsaHost>();
  host->pendingWriteErrors = {kAlsaErrEstrpipe};
  host->resumeReturn = 0;
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;

  assert(backend.open("default", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));
  assert(backend.start([](float*, size_t frames) {
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
    return frames;
  }, nullptr, &error));
  assert(waitForWrites(rawHost, 2));
  backend.stop();

  const OutputInfo info = backend.outputInfo();
  assert(info.diagnostics.sessionUnderrunCount >= 1);
  assert(info.diagnostics.sessionRecoveryCount >= 1);
  assert(info.deviceRecovered);
  assert(rawHost->resumeCalls >= 1);
  assert(rawHost->prepareCalls >= 2);
}

void testAlsaHwDevicePathKind() {
  {
    auto host = std::make_unique<MockAlsaHost>();
    AlsaBackend backend(std::move(host));
    std::string error;
    assert(backend.open("hw:0,0", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));
    const OutputInfo info = backend.outputInfo();
    assert(info.accessMode == "direct");
    assert(info.devicePathKind == "hw");
    assert(info.exclusive);
  }
  {
    auto host = std::make_unique<MockAlsaHost>();
    AlsaBackend backend(std::move(host));
    std::string error;
    assert(backend.open("plughw:0,0", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));
    const OutputInfo info = backend.outputInfo();
    assert(info.devicePathKind == "plughw");
    assert(info.accessMode == "plugin");
  }
  {
    auto host = std::make_unique<MockAlsaHost>();
    AlsaBackend backend(std::move(host));
    std::string error;
    assert(backend.open("default", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));
    assert(backend.outputInfo().devicePathKind == "default");
  }
}

// --- Native DSD tests (DSD64/128/256/512 via DSD_U8 / DSD_U16_LE / DSD_U32_LE) ---

AudioFormat dsdFormat(int bitClock, int channels = 2) {
  return sourceFormat(bitClock, 1, channels, AudioSampleFormat::DsdInt8Msb1);
}

void testAlsaDsd64SelectsU8() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU8};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(2822400), &error));
  assert(!rawHost->setFormats.empty());
  assert(rawHost->setFormats.front() == AlsaPcmFormat::DsdU8);
  // ALSA rate = 2822400 / 8 (phys_width bits) = 352800
  assert(rawHost->requestedRate == 352800);
  const NativeDsdRuntimeFacts facts = backend.nativeDsdRuntimeFacts();
  assert(facts.requestedDsdRate == 2822400);
  assert(facts.actualDsdRate == 2822400);
  assert(facts.state == NativeDsdRuntimeFactState::Candidate);
}

void testAlsaDsd256SelectsU16Le() {
  auto host = std::make_unique<MockAlsaHost>();
  // Only accept U16Le — U8 and U32Le must be rejected first (MPD order: U8→U32Le→U16Le)
  host->acceptedFormats = {AlsaPcmFormat::DsdU16Le};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(11289600), &error));
  assert(std::find(rawHost->testedFormats.begin(), rawHost->testedFormats.end(), AlsaPcmFormat::DsdU8) !=
         rawHost->testedFormats.end());
  assert(std::find(rawHost->testedFormats.begin(), rawHost->testedFormats.end(), AlsaPcmFormat::DsdU32Le) !=
         rawHost->testedFormats.end());
  assert(!rawHost->setFormats.empty());
  assert(rawHost->setFormats.front() == AlsaPcmFormat::DsdU16Le);
  // ALSA rate = 11289600 / 16 = 705600
  assert(rawHost->requestedRate == 705600);
  const NativeDsdRuntimeFacts facts = backend.nativeDsdRuntimeFacts();
  assert(facts.requestedDsdRate == 11289600);
  assert(facts.actualDsdRate == 11289600);
}

void testAlsaDsd512SelectsU32Le() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU32Le};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(22579200), &error));
  assert(!rawHost->setFormats.empty());
  assert(rawHost->setFormats.front() == AlsaPcmFormat::DsdU32Le);
  // ALSA rate = 22579200 / 32 = 705600
  assert(rawHost->requestedRate == 705600);
  const NativeDsdRuntimeFacts facts = backend.nativeDsdRuntimeFacts();
  assert(facts.requestedDsdRate == 22579200);
  assert(facts.actualDsdRate == 22579200);
}

void testAlsaNativeDsdRuntimeFactsCandidateAtOpen() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU8};
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(2822400), &error));
  const NativeDsdRuntimeFacts facts = backend.nativeDsdRuntimeFacts();
  assert(facts.state == NativeDsdRuntimeFactState::Candidate);
  assert(facts.explicitlyCapable);
  assert(facts.requestedDsdRate == 2822400);
  assert(facts.actualDsdRate == 2822400);
  assert(facts.channelCount == 2);
  assert(facts.advertisedSampleRates.size() == 4);
}

void testAlsaNativeDsdRuntimeFactsProvenAfterWritei() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU8};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(2822400), &error));
  assert(backend.nativeDsdRuntimeFacts().state == NativeDsdRuntimeFactState::Candidate);

  assert(backend.startTyped(
      [](PcmBlock& block) {
        std::memset(block.data, 0xaa, block.byteSize);
        return block.frames;
      },
      [](float*, size_t frames) { return frames; },
      nullptr,
      &error));
  assert(waitForWrites(rawHost, 1));
  backend.stop();

  const NativeDsdRuntimeFacts facts = backend.nativeDsdRuntimeFacts();
  assert(facts.state == NativeDsdRuntimeFactState::Proven);
  assert(facts.actualDsdRate == 2822400);
}

void testAlsaDsdBypassesFloat() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU8};
  host->negotiatedPeriodSize = 4;
  host->negotiatedChannels = 2;
  // DsdU8 stereo: 1 byte/sample * 2 channels = 2 bytes/frame
  host->captureFrameBytes = 2;
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(2822400), &error));

  assert(backend.startTyped(
      [](PcmBlock& block) {
        for (size_t i = 0; i < block.byteSize; ++i) {
          block.data[i] = static_cast<uint8_t>((i * 17 + 0x5a) & 0xff);
        }
        return block.frames;
      },
      [](float*, size_t frames) { return frames; },
      nullptr,
      &error));
  assert(waitForWrites(rawHost, 1));
  backend.stop();

  // Raw byte copy — no float→int conversion, output must equal input DSD bytes.
  assert(!rawHost->capturedWriteBytes.empty());
  for (size_t i = 0; i < rawHost->capturedWriteBytes.size(); ++i) {
    assert(rawHost->capturedWriteBytes[i] == static_cast<uint8_t>((i * 17 + 0x5a) & 0xff));
  }
}

void testAlsaDsdSilenceIs0x69() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU8};
  host->negotiatedPeriodSize = 4;
  host->negotiatedChannels = 2;
  host->captureFrameBytes = 2;
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(2822400), &error));

  // Typed callback renders 0 frames — remainder must be DSD silence 0x69, not 0x00.
  assert(backend.startTyped(
      [](PcmBlock& block) { return static_cast<size_t>(0); },
      [](float*, size_t frames) { return frames; },
      nullptr,
      &error));
  assert(waitForWrites(rawHost, 1));
  backend.stop();

  assert(!rawHost->capturedWriteBytes.empty());
  for (uint8_t byte : rawHost->capturedWriteBytes) {
    assert(byte == 0x69);
  }
}

}  // namespace

int main() {
  testAlsaOpenNegotiatesPcm();
  testAlsaFormatFallback();
  testAlsaXrunRecovery();
  testAlsaSuspendRecovery();
  testAlsaHwDevicePathKind();
  testAlsaDsd64SelectsU8();
  testAlsaDsd256SelectsU16Le();
  testAlsaDsd512SelectsU32Le();
  testAlsaNativeDsdRuntimeFactsCandidateAtOpen();
  testAlsaNativeDsdRuntimeFactsProvenAfterWritei();
  testAlsaDsdBypassesFloat();
  testAlsaDsdSilenceIs0x69();
  return 0;
}
