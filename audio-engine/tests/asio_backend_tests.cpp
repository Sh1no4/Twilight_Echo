#include "../output/asio/AsioBackend.h"
#include "../output/asio/MockAsioHost.h"

#include <cassert>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

using namespace twilight::audio;

namespace {

AudioFormat sourceFormat(int sampleRate = 88200, int bitDepth = 24, int channels = 2) {
  AudioFormat format;
  format.sampleRate = sampleRate;
  format.channelCount = channels;
  format.bitDepth = bitDepth;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;
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
  assert(backend.outputInfo().supportsBitPerfect);
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
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:mock", sourceFormat(96000, 32), &error));
    rawHost->failCreateBuffersCount = 1;
    assert(!backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
    const auto info = backend.outputInfo();
    assert(info.diagnostics.sessionBufferDropCount == 1);
    assert(info.diagnostics.lifetimeBufferDropCount == 1);
    assert(info.diagnostics.lastError == "mock create buffers failure");
  }
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:mock", sourceFormat(96000, 32), &error));
    rawHost->failStartCount = 1;
    assert(!backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
    assert(backend.outputInfo().diagnostics.lastError == "mock start failure");
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

}  // namespace

int main() {
  testFormatNegotiation();
  testOpenFailureAndFallbackFormats();
  testExtremeSampleRates();
  testChannelCounts();
  testLifecycleAndPlaybackInfo();
  testPacking();
  testStartFailurePaths();
  testRecovery();
  testRecoveryCooldown();
  return 0;
}
