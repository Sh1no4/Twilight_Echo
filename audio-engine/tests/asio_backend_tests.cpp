#include "../output/asio/AsioBackend.h"
#include "../output/asio/MockAsioHost.h"

#include <algorithm>
#include <cassert>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

using namespace twilight::audio;

namespace {

AudioFormat sourceFormat(
    int sampleRate = 88200,
    int bitDepth = 24,
    int channels = 2,
    AudioSampleFormat sampleFormat = AudioSampleFormat::Float32Interleaved) {
  AudioFormat format;
  format.sampleRate = sampleRate;
  format.channelCount = channels;
  format.bitDepth = bitDepth;
  format.sampleFormat = sampleFormat;
  return format;
}

std::unique_ptr<MockAsioHost> makeHost() {
  auto host = std::make_unique<MockAsioHost>();
  host->devices.push_back(makeMockAsioDevice("asio:mock", {44100, 48000, 96000}, 2));
  return host;
}

int16_t readInt16(const std::vector<uint8_t>& bytes) {
  int16_t value = 0;
  std::memcpy(&value, bytes.data(), sizeof(value));
  return value;
}

int32_t readInt32(const std::vector<uint8_t>& bytes) {
  int32_t value = 0;
  std::memcpy(&value, bytes.data(), sizeof(value));
  return value;
}

int32_t readInt24In32(const std::vector<uint8_t>& bytes) {
  return readInt32(bytes) >> 8;
}

void testFormatNegotiation() {
  auto host = makeHost();
  auto* rawHost = host.get();
  AsioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("asio:mock", sourceFormat(), &error));
  assert(rawHost->lastOpenConfig.format.sampleRate == 96000);
  assert(rawHost->lastOpenConfig.format.bitDepth == 24);
  assert(backend.outputInfo().supportsOutputPerfect);
  assert(backend.outputInfo().actualBackend == "asio");
}

void testOpenFailureAndFallbackFormats() {
  {
    auto host = std::make_unique<MockAsioHost>();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(!backend.open("auto", sourceFormat(48000, 24), &error));
    assert(!error.empty());
  }
  {
    auto host = makeHost();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(!backend.open("asio:missing", sourceFormat(48000, 24), &error));
    assert(!error.empty());
  }
  {
    auto host = std::make_unique<MockAsioHost>();
    auto device = makeMockAsioDevice("asio:default-rate", {}, 2);
    device.supportedSampleRates.clear();
    device.defaultSampleRate = 192000;
    host->devices.push_back(device);
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:default-rate", sourceFormat(192000, 24), &error));
    assert(rawHost->lastOpenConfig.format.sampleRate == 192000);
  }
}

void testExtremeSampleRates() {
  const std::vector<int> rates = {8000, 44100, 48000, 96000, 192000, 384000, 768000};
  auto host = std::make_unique<MockAsioHost>();
  host->devices.push_back(makeMockAsioDevice("asio:rates", rates, 2));
  auto* rawHost = host.get();
  AsioBackend backend(std::move(host));
  std::string error;
  for (int rate : rates) {
    assert(backend.open("asio:rates", sourceFormat(rate, 24), &error));
    assert(rawHost->lastOpenConfig.format.sampleRate == rate);
  }
}

void testDopCarrierProfile() {
  MockAsioHost::DsdProfile profile;
  profile.dopCapable = true;
  profile.dopCarrierSampleRates = {176400, 352800};
  profile.dopCarrierSampleFormats = {
      AudioSampleFormat::Int24In32Interleaved,
      AudioSampleFormat::Int32Interleaved,
  };

  auto host = std::make_unique<MockAsioHost>();
  host->devices.push_back(makeMockAsioDevice("asio:dop", {44100, 48000}, 2, AudioSampleFormat::Float32Interleaved, profile));
  auto* rawHost = host.get();
  AsioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("asio:dop", sourceFormat(352800, 24, 2, AudioSampleFormat::Int24In32Interleaved), &error));
  assert(rawHost->lastOpenConfig.format.sampleRate == 352800);
  assert(rawHost->lastOpenConfig.format.sampleFormat == AudioSampleFormat::Int24In32Interleaved);

  const OutputInfo info = backend.outputInfo();
  assert(info.driverDopCapable);
  assert(!info.driverNativeDsdCapable);
  assert(info.driverDopCarrierSampleRates.size() == 2);
  assert(info.driverDopCarrierSampleRates[0] == 176400);
  assert(info.driverDopCarrierSampleRates[1] == 352800);
  assert(info.driverDopCarrierFormats.size() == 2);
  assert(info.driverDopCarrierFormats[0] == "int24-in32");
  assert(info.driverDopCarrierFormats[1] == "int32");
  assert(!info.outputPerfect);
  assert(!info.pcmPassthrough);

  const DopRuntimeFacts candidateFacts = backend.dopRuntimeFacts();
  assert(candidateFacts.state == DopRuntimeFactState::Candidate);
  assert(candidateFacts.explicitlyCapable);
  assert(candidateFacts.candidateFormat.sampleRate == 352800);
  assert(candidateFacts.candidateFormat.bitDepth == 24);
  assert(candidateFacts.candidateFormat.sampleFormat == AudioSampleFormat::Int24In32Interleaved);
  assert(!hasConcreteAudioFormat(candidateFacts.actualFormat));

  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
  const DopRuntimeFacts provenFacts = backend.dopRuntimeFacts();
  assert(provenFacts.state == DopRuntimeFactState::Proven);
  assert(provenFacts.explicitlyCapable);
  assert(pcmFormatsExactMatch(provenFacts.candidateFormat, provenFacts.actualFormat));
}

void testDopRuntimeFactsUnprovenWithoutExplicitCapability() {
  auto host = std::make_unique<MockAsioHost>();
  auto device = makeMockAsioDevice("asio:dop-unproven", {352800}, 2, AudioSampleFormat::Int24In32Interleaved);
  device.dopCapable = false;
  device.sampleFormats = {AudioSampleFormat::Int24In32Interleaved};
  device.bitDepths = {24};
  host->devices.push_back(device);
  auto* rawHost = host.get();
  rawHost->channelFormats = {
      AudioSampleFormat::Int24In32Interleaved,
      AudioSampleFormat::Int24In32Interleaved,
  };

  AsioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("asio:dop-unproven", sourceFormat(352800, 24, 2, AudioSampleFormat::Int24In32Interleaved), &error));
  assert(backend.dopRuntimeFacts().state == DopRuntimeFactState::Candidate);
  assert(!backend.dopRuntimeFacts().explicitlyCapable);

  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
  const DopRuntimeFacts facts = backend.dopRuntimeFacts();
  assert(facts.state == DopRuntimeFactState::Unproven);
  assert(!facts.explicitlyCapable);
  assert(pcmFormatsExactMatch(facts.candidateFormat, facts.actualFormat));
}

void testDopRuntimeFactsMismatchWhenActualFormatDiffers() {
  MockAsioHost::DsdProfile profile;
  profile.dopCapable = true;
  profile.dopCarrierSampleRates = {176400};
  profile.dopCarrierSampleFormats = {AudioSampleFormat::Int24In32Interleaved};

  auto host = std::make_unique<MockAsioHost>();
  auto device = makeMockAsioDevice("asio:dop-mismatch", {176400}, 2, AudioSampleFormat::Int24In32Interleaved, profile);
  device.sampleFormats = {
      AudioSampleFormat::Int24In32Interleaved,
      AudioSampleFormat::Float32Interleaved,
  };
  host->devices.push_back(device);
  auto* rawHost = host.get();
  rawHost->channelFormats = {
      AudioSampleFormat::Float32Interleaved,
      AudioSampleFormat::Float32Interleaved,
  };

  AsioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("asio:dop-mismatch", sourceFormat(176400, 24, 2, AudioSampleFormat::Int24In32Interleaved), &error));
  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));

  const DopRuntimeFacts facts = backend.dopRuntimeFacts();
  assert(facts.state == DopRuntimeFactState::Mismatch);
  assert(facts.explicitlyCapable);
  assert(!hasConcreteAudioFormat(facts.actualFormat));
  assert(facts.reason.find("not a DoP carrier") != std::string::npos);
}

void testNativeDsdCapabilityProfile() {
  {
    auto host = makeHost();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:mock", sourceFormat(96000, 32), &error));
    const OutputInfo info = backend.outputInfo();
    assert(!info.driverDopCapable);
    assert(!info.driverNativeDsdCapable);
    assert(info.driverDopCarrierSampleRates.empty());
    assert(info.driverDopCarrierFormats.empty());
    assert(info.driverNativeDsdSampleRates.empty());
  }
  {
    MockAsioHost::DsdProfile profile;
    profile.nativeDsdCapable = true;
    profile.nativeDsdSampleRates = {2822400, 5644800};
    auto host = std::make_unique<MockAsioHost>();
    host->devices.push_back(makeMockAsioDevice("asio:native-dsd", {48000}, 2, AudioSampleFormat::Float32Interleaved, profile));
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:native-dsd", sourceFormat(48000, 32), &error));
    assert(rawHost->lastOpenConfig.format.sampleRate == 48000);

    const OutputInfo info = backend.outputInfo();
    assert(!info.driverDopCapable);
    assert(info.driverNativeDsdCapable);
    assert(info.driverNativeDsdSampleRates.size() == 2);
    assert(info.driverNativeDsdSampleRates[0] == 2822400);
    assert(info.driverNativeDsdSampleRates[1] == 5644800);
    assert(!info.outputPerfect);
    assert(!info.pcmPassthrough);
  }
}

void testChannelCounts() {
  for (int channels : {1, 2, 6, 8}) {
    auto host = std::make_unique<MockAsioHost>();
    host->devices.push_back(makeMockAsioDevice("asio:channels", {48000}, 8));
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:channels", sourceFormat(48000, 32, channels), &error));
    assert(rawHost->lastOpenConfig.format.channelCount == channels);
    assert(backend.outputInfo().actualChannels == channels);
  }
  {
    auto host = std::make_unique<MockAsioHost>();
    host->devices.push_back(makeMockAsioDevice("asio:limited", {48000}, 2));
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:limited", sourceFormat(48000, 32, 8), &error));
    assert(rawHost->lastOpenConfig.format.channelCount == 2);
    assert(backend.outputInfo().actualChannels == 2);
  }
}

void testLifecycleAndPlaybackInfo() {
  auto host = makeHost();
  auto* rawHost = host.get();
  AsioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("asio:mock", sourceFormat(96000, 32), &error));
  assert(backend.start([](float* output, size_t frames) {
    for (size_t i = 0; i < frames * 2; ++i) output[i] = 0.25f;
    return frames;
  }, nullptr, &error));
  rawHost->triggerBufferSwitch(0);
  assert(rawHost->startCalls == 1);
  assert(rawHost->outputReadyCalls == 1);
  const OutputInfo info = backend.outputInfo();
  assert(info.driverName == "Mock ASIO");
  assert(info.driverVersion == 1);
  assert(info.bufferSizeFrames == 4);
  assert(info.latencyFrames == 8);
  assert(info.actualChannels == 2);
  backend.stop();
  assert(rawHost->stopCalls >= 1);
}

void testActualOutputFormats() {
  struct Case {
    AudioSampleFormat sampleFormat;
    int bitDepth;
    const char* name;
  };
  const Case cases[] = {
      {AudioSampleFormat::Int16Interleaved, 16, "int16"},
      {AudioSampleFormat::Int24Interleaved, 24, "int24"},
      {AudioSampleFormat::Int24In32Interleaved, 24, "int24-in32"},
      {AudioSampleFormat::Int32Interleaved, 32, "int32"},
      {AudioSampleFormat::Float32Interleaved, 32, "float32"},
  };

  for (const auto& item : cases) {
    auto host = std::make_unique<MockAsioHost>();
    auto device = makeMockAsioDevice("asio:format", {48000}, 2, item.sampleFormat);
    device.sampleFormats = {item.sampleFormat};
    device.bitDepths = {item.bitDepth};
    host->devices.push_back(device);
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:format", sourceFormat(48000, item.bitDepth, 2, item.sampleFormat), &error));
    const OutputInfo info = backend.outputInfo();
    assert(info.actualOutputFormat == item.name);
    assert(info.actualBitDepth == item.bitDepth);
    assert(!info.outputPerfect);
    assert(!info.pcmPassthrough);
  }
}

void testActualOutputFormatRefreshAfterBuffers() {
  auto host = makeHost();
  auto* rawHost = host.get();
  rawHost->channelFormats = {AudioSampleFormat::Int24In32Interleaved, AudioSampleFormat::Int24In32Interleaved};
  AsioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("asio:mock", sourceFormat(96000, 32, 2, AudioSampleFormat::Float32Interleaved), &error));
  assert(backend.outputInfo().actualOutputFormat == "float32");
  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
  const auto info = backend.outputInfo();
  assert(info.actualOutputFormat == "int24-in32");
  assert(info.actualBitDepth == 24);
  assert(info.outputBitDepth == 24);
  assert(info.perfectReason.find("actual output format differs") != std::string::npos);
}

void testBufferSizeMatrix() {
  const uint32_t sizes[] = {0, 64, 128, 256, 512, 1024, 2048};
  for (const auto size : sizes) {
    auto host = makeHost();
    auto* rawHost = host.get();
    rawHost->devices[0].minBufferSize = 64;
    rawHost->devices[0].maxBufferSize = 2048;
    rawHost->devices[0].bufferGranularity = 64;
    rawHost->devices[0].preferredBufferSize = 256;
    AsioBackend backend(std::move(host));
    OutputConfig config;
    config.preferredBufferSize = size;
    std::string error;
    assert(backend.setOutputConfig(config, &error));
    assert(backend.open("asio:mock", sourceFormat(48000, 32), &error));
    const long expected = size == 0 ? 256 : static_cast<long>(size);
    assert(rawHost->lastOpenConfig.bufferSizeFrames == expected);
    assert(backend.outputInfo().bufferSizeFrames == expected);
  }
}

void testPacking() {
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    rawHost->channelFormats = {AudioSampleFormat::Int16Interleaved, AudioSampleFormat::Int16Interleaved};
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:mock", sourceFormat(96000, 16), &error));
    assert(backend.start([](float* output, size_t frames) {
      for (size_t frame = 0; frame < frames; ++frame) {
        output[frame * 2] = 1.0f;
        output[frame * 2 + 1] = -1.0f;
      }
      return frames;
    }, nullptr, &error));
    rawHost->triggerBufferSwitch(0);
    assert(readInt16(rawHost->channelBuffers[0].buffers[0]) == 32767);
    assert(readInt16(rawHost->channelBuffers[1].buffers[0]) == -32768);
  }
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    rawHost->channelFormats = {AudioSampleFormat::Float32Interleaved, AudioSampleFormat::Int32Interleaved};
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:mock", sourceFormat(96000, 32), &error));
    assert(backend.start([](float* output, size_t frames) {
      for (size_t frame = 0; frame < frames; ++frame) {
        output[frame * 2] = 0.5f;
        output[frame * 2 + 1] = 0.5f;
      }
      return frames;
    }, nullptr, &error));
    rawHost->triggerBufferSwitch(0);
    float packedFloat = 0.0f;
    std::memcpy(&packedFloat, rawHost->channelBuffers[0].buffers[0].data(), sizeof(float));
    assert(packedFloat == 0.5f);
    assert(readInt32(rawHost->channelBuffers[1].buffers[0]) > 1000000000);
  }
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    rawHost->channelFormats = {AudioSampleFormat::Int24Interleaved, AudioSampleFormat::Int24Interleaved};
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:mock", sourceFormat(96000, 24), &error));
    assert(backend.start([](float* output, size_t frames) {
      for (size_t frame = 0; frame < frames; ++frame) {
        output[frame * 2] = 1.0f;
        output[frame * 2 + 1] = 0.0f;
      }
      return frames;
    }, nullptr, &error));
    rawHost->triggerBufferSwitch(0);
    const auto& bytes = rawHost->channelBuffers[0].buffers[0];
    assert(bytes[0] == 0xff && bytes[1] == 0xff && bytes[2] == 0x7f);
  }
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    rawHost->channelFormats = {AudioSampleFormat::Int24In32Interleaved, AudioSampleFormat::Int24In32Interleaved};
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:mock", sourceFormat(96000, 24), &error));
    assert(backend.start([](float* output, size_t frames) {
      for (size_t frame = 0; frame < frames; ++frame) {
        output[frame * 2] = 1.0f;
        output[frame * 2 + 1] = -1.0f;
      }
      return frames;
    }, nullptr, &error));
    rawHost->triggerBufferSwitch(0);
    assert(readInt24In32(rawHost->channelBuffers[0].buffers[0]) == 8388607);
    assert(readInt24In32(rawHost->channelBuffers[1].buffers[0]) == -8388608);
  }
}

void testStartFailurePaths() {
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    rawHost->failDriverInitCount = 1;
    AsioBackend backend(std::move(host));
    std::string error;
    assert(!backend.open("asio:mock", sourceFormat(96000, 32), &error));
    assert(error == "mock driver init failure");
    assert(backend.outputInfo().diagnostics.lastError == "mock driver init failure");
    assert(backend.outputInfo().perfectReason == "mock driver init failure");
    assert(rawHost->openCalls == 1);
    assert(rawHost->createBuffersCalls == 0);
    assert(rawHost->startCalls == 0);
  }
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    rawHost->failDriverOpenCount = 1;
    AsioBackend backend(std::move(host));
    std::string error;
    assert(!backend.open("asio:mock", sourceFormat(96000, 32), &error));
    assert(error == "mock open failure");
    assert(backend.outputInfo().diagnostics.lastError == "mock open failure");
    assert(backend.outputInfo().perfectReason == "mock open failure");
    assert(rawHost->openCalls == 1);
    assert(rawHost->createBuffersCalls == 0);
    assert(rawHost->startCalls == 0);
  }
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:mock", sourceFormat(96000, 32), &error));
    rawHost->failCreateBuffersCount = 1;
    assert(!backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
    const auto info = backend.outputInfo();
    assert(info.diagnostics.sessionBufferDropCount == 1);
    assert(info.diagnostics.lifetimeBufferDropCount == 1);
    assert(info.diagnostics.lastError == "mock create buffers failure");
    assert(info.perfectReason.find("buffer creation failed") != std::string::npos);
    assert(info.actualBackend == "asio");
    assert(rawHost->openCalls == 1);
    assert(rawHost->createBuffersCalls == 1);
    assert(rawHost->startCalls == 0);
  }
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:mock", sourceFormat(96000, 32), &error));
    rawHost->failStartCount = 1;
    assert(!backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
    const auto info = backend.outputInfo();
    assert(info.diagnostics.lastError == "mock start failure");
    assert(info.perfectReason.find("start failed") != std::string::npos);
    assert(info.actualBackend == "asio");
    assert(rawHost->openCalls == 1);
    assert(rawHost->createBuffersCalls == 1);
    assert(rawHost->startCalls == 1);
  }
}

void testRecovery() {
  auto host = makeHost();
  auto* rawHost = host.get();
  rawHost->failOpenCount = 1;
  AsioBackend backend(std::move(host));
  std::string error;
  assert(!backend.open("asio:mock", sourceFormat(96000, 32), &error));

  auto recoveryHost = makeHost();
  auto* rawRecoveryHost = recoveryHost.get();
  AsioBackend recoveryBackend(std::move(recoveryHost));
  assert(recoveryBackend.open("asio:mock", sourceFormat(96000, 32), &error));
  assert(recoveryBackend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
  rawRecoveryHost->failOpenCount = 1;
  rawRecoveryHost->triggerEvent(AsioHostEvent::BufferFailure, "buffer failed");
  auto recoveredInfo = recoveryBackend.outputInfo();
  assert(recoveredInfo.deviceRecovered);
  assert(recoveredInfo.recoveryCount == 1);
  assert(recoveredInfo.diagnostics.sessionRecoveryCount == 1);
  assert(recoveredInfo.diagnostics.lifetimeRecoveryCount == 1);
  assert(recoveredInfo.diagnostics.sessionUnderrunCount == 1);
  assert(recoveredInfo.diagnostics.lastError.find("ASIO buffer failure") != std::string::npos);

  auto failHost = makeHost();
  auto* rawFailHost = failHost.get();
  AsioBackend failBackend(std::move(failHost));
  assert(failBackend.open("asio:mock", sourceFormat(96000, 32), &error));
  bool gotError = false;
  assert(failBackend.start(
      [](float*, size_t frames) { return frames; },
      [&](OutputBackendEvent, const std::string&) { gotError = true; },
      &error));
  rawFailHost->failOpenCount = 3;
  rawFailHost->triggerEvent(AsioHostEvent::DeviceLost, "lost");
  assert(gotError);
  const auto failedInfo = failBackend.outputInfo();
  assert(!failedInfo.deviceRecovered);
  assert(failedInfo.recoveryCount == 0);
  assert(failedInfo.diagnostics.deviceLostCount == 1);
  assert(failedInfo.diagnostics.lastError == "mock open failure");
}

void testRecoveryEventDiagnostics() {
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:mock", sourceFormat(96000, 32), &error));
    assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
    rawHost->triggerEvent(AsioHostEvent::DriverRestart, "restart requested");
    const auto info = backend.outputInfo();
    assert(info.diagnostics.driverRestartCount == 1);
    assert(info.diagnostics.lastError.find("ASIO driver restart") != std::string::npos);
    assert(info.deviceRecovered);
  }
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:mock", sourceFormat(96000, 32), &error));
    assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
    rawHost->triggerEvent(AsioHostEvent::DeviceLost, "device disappeared");
    const auto info = backend.outputInfo();
    assert(info.diagnostics.deviceLostCount == 1);
    assert(info.diagnostics.lastError.find("ASIO device lost") != std::string::npos);
    assert(info.deviceRecovered);
  }
}

void testRecoveryCooldown() {
  auto host = makeHost();
  auto* rawHost = host.get();
  AsioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("asio:mock", sourceFormat(96000, 32), &error));
  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));

  rawHost->triggerEvent(AsioHostEvent::BufferFailure, "storm 1");
  rawHost->triggerEvent(AsioHostEvent::BufferFailure, "storm 2");
  rawHost->triggerEvent(AsioHostEvent::BufferFailure, "storm 3");
  const int openCalls = rawHost->openCalls;
  const int createBuffersCalls = rawHost->createBuffersCalls;
  const int startCalls = rawHost->startCalls;

  rawHost->triggerEvent(AsioHostEvent::BufferFailure, "storm 4");
  const auto info = backend.outputInfo();
  assert(info.deviceRecovered);
  assert(info.recoveryCount == 3);
  assert(info.diagnostics.sessionRecoveryCount == 3);
  assert(info.diagnostics.lifetimeRecoveryCount == 3);
  assert(info.diagnostics.sessionUnderrunCount == 4);
  assert(info.diagnostics.lastError.find("cooldown") != std::string::npos);
  assert(rawHost->openCalls == openCalls);
  assert(rawHost->createBuffersCalls == createBuffersCalls);
  assert(rawHost->startCalls == startCalls);
}

bool runRealAsioSmokeRequested() {
  const char* value = std::getenv("TAE_RUN_REAL_ASIO_SMOKE");
  return value && std::string(value) == "1";
}

void testRealAsioSmokeOptIn() {
  if (!runRealAsioSmokeRequested()) return;

  auto host = createRealAsioHost();
  const auto devices = host->enumerateDevices();
  if (devices.empty()) {
    std::cerr << "TAE_RUN_REAL_ASIO_SMOKE=1 but no ASIO devices were enumerated; skipping real smoke\n";
    return;
  }

  const auto& device = devices.front();
  AudioFormat format;
  format.sampleRate = device.defaultSampleRate > 0
                          ? device.defaultSampleRate
                          : (device.supportedSampleRates.empty() ? 48000 : device.supportedSampleRates.front());
  format.channelCount = device.outputChannels > 0 ? std::min(2, device.outputChannels) : 2;
  format.sampleFormat = device.defaultSampleFormat;
  format.bitDepth = device.defaultBitDepth > 0 ? device.defaultBitDepth : 32;

  AsioOpenConfig config;
  config.deviceId = device.id;
  config.format = format;
  config.bufferSizeFrames = device.preferredBufferSize > 0 ? device.preferredBufferSize : 128;

  AsioOpenResult result;
  std::string error;
  assert(host->open(config, &result, &error));
  assert(result.actualFormat.sampleRate > 0);
  assert(result.actualFormat.channelCount > 0);
  assert(!result.driverName.empty());
  assert(host->createBuffers([](long) {}, [](AsioHostEvent, const std::string&) {}, &error));
  assert(host->start(&error));
  host->stop();
  host->close();
}

}  // namespace

int main() {
  testFormatNegotiation();
  testOpenFailureAndFallbackFormats();
  testExtremeSampleRates();
  testDopCarrierProfile();
  testDopRuntimeFactsUnprovenWithoutExplicitCapability();
  testDopRuntimeFactsMismatchWhenActualFormatDiffers();
  testNativeDsdCapabilityProfile();
  testChannelCounts();
  testLifecycleAndPlaybackInfo();
  testActualOutputFormats();
  testActualOutputFormatRefreshAfterBuffers();
  testBufferSizeMatrix();
  testPacking();
  testStartFailurePaths();
  testRecovery();
  testRecoveryEventDiagnostics();
  testRecoveryCooldown();
  testRealAsioSmokeOptIn();
  return 0;
}
