#include "../core/AudioTypes.h"
#include "../output/asio/AsioBackend.h"
#include "../output/asio/DeviceCapabilityCache.h"
#include "../output/asio/MockAsioHost.h"

#include <cassert>
#include <cstring>
#include <memory>
#include <string>

using namespace twilight::audio;

namespace {

AudioFormat sourceFormat(int channels = 2) {
  AudioFormat format;
  format.sampleRate = 48000;
  format.channelCount = channels;
  format.bitDepth = 32;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;
  return format;
}

std::unique_ptr<MockAsioHost> makeHost(int channels = 8) {
  auto host = std::make_unique<MockAsioHost>();
  auto device = makeMockAsioDevice("asio:phase5b", {48000}, channels);
  device.minBufferSize = 64;
  device.maxBufferSize = 2048;
  device.bufferGranularity = 64;
  device.preferredBufferSize = 256;
  device.outputLatencyFrames = 96;
  host->devices.push_back(device);
  return host;
}

float readFloat(const std::vector<uint8_t>& bytes) {
  float value = 0.0f;
  std::memcpy(&value, bytes.data(), sizeof(value));
  return value;
}

void testBufferSizeAutoAndFallback() {
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:phase5b", sourceFormat(), &error));
    assert(rawHost->lastOpenConfig.bufferSizeFrames == 256);
    assert(backend.outputInfo().bufferSizeFrames == 256);
  }
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    OutputConfig config;
    config.preferredBufferSize = 100;
    std::string error;
    assert(!backend.setOutputConfig(config, &error));
    config.preferredBufferSize = 1024;
    assert(backend.setOutputConfig(config, &error));
    assert(backend.open("asio:phase5b", sourceFormat(), &error));
    assert(rawHost->lastOpenConfig.bufferSizeFrames == 1024);
  }
  {
    auto host = makeHost();
    host->devices[0].bufferGranularity = 128;
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    OutputConfig config;
    config.preferredBufferSize = 512;
    std::string error;
    assert(backend.setOutputConfig(config, &error));
    assert(backend.open("asio:phase5b", sourceFormat(), &error));
    assert(rawHost->lastOpenConfig.bufferSizeFrames == 448);
  }
}

void testCapabilityCacheAndVersion() {
  auto& cache = DeviceCapabilityCache::instance();
  AsioDeviceInfo info = makeMockAsioDevice("asio:cache", {44100, 48000}, 2);
  info.capabilityVersion = 7;
  info.dopCapable = true;
  info.dopCarrierSampleRates = {176400};
  info.dopCarrierSampleFormats = {AudioSampleFormat::Int24In32Interleaved};
  info.nativeDsdCapable = true;
  info.nativeDsdSampleRates = {2822400};
  cache.put(info);
  auto hit = cache.get("asio:cache");
  assert(hit);
  assert(hit->capabilityVersion == 7);
  assert(hit->dopCapable);
  assert(hit->dopCarrierSampleRates.size() == 1);
  assert(hit->dopCarrierSampleRates[0] == 176400);
  assert(hit->dopCarrierSampleFormats.size() == 1);
  assert(hit->dopCarrierSampleFormats[0] == AudioSampleFormat::Int24In32Interleaved);
  assert(hit->nativeDsdCapable);
  assert(hit->nativeDsdSampleRates.size() == 1);
  assert(hit->nativeDsdSampleRates[0] == 2822400);
  assert(!cache.dirty("asio:cache"));

  const uint64_t bumped = cache.bumpVersion("asio:cache");
  assert(bumped == 8);
  assert(cache.dirty("asio:cache"));
  assert(!cache.get("asio:cache"));
  assert(cache.version("asio:cache") == 8);
}

void testLatencyInfoAndPlaybackInfo() {
  auto host = makeHost();
  AsioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("asio:phase5b", sourceFormat(), &error));
  const OutputInfo info = backend.outputInfo();
  assert(info.actualBackend == "asio");
  assert(info.actualDeviceName == "Mock ASIO");
  assert(info.actualDriverName == "Mock ASIO");
  assert(info.supportsOutputPerfect);
  assert(info.latencyInfo.bufferLatencyMs > 5.0);
  assert(info.latencyInfo.outputLatencyMs > 0.0);
  assert(info.latencyInfo.totalLatencyMs >= info.latencyInfo.bufferLatencyMs);
}

void testChannelRouting() {
  auto host = makeHost(8);
  auto* rawHost = host.get();
  AsioBackend backend(std::move(host));
  OutputConfig config;
  config.routingMode = ChannelRoutingMode::StereoTo71;
  std::string error;
  assert(backend.setOutputConfig(config, &error));
  assert(backend.open("asio:phase5b", sourceFormat(2), &error));
  assert(rawHost->lastOpenConfig.format.channelCount == 8);
  assert(backend.start([](float* output, size_t frames) {
    for (size_t frame = 0; frame < frames; ++frame) {
      output[frame * 2] = 0.25f;
      output[frame * 2 + 1] = -0.5f;
    }
    return frames;
  }, nullptr, &error));
  rawHost->triggerBufferSwitch(0);
  assert(readFloat(rawHost->channelBuffers[0].buffers[0]) == 0.25f);
  assert(readFloat(rawHost->channelBuffers[1].buffers[0]) == -0.5f);
  assert(readFloat(rawHost->channelBuffers[2].buffers[0]) == 0.0f);
  assert(backend.outputInfo().channelRoutingMode == "stereo-to-7.1");
}

void testMonoRouting() {
  auto host = makeHost(6);
  auto* rawHost = host.get();
  AsioBackend backend(std::move(host));
  OutputConfig config;
  config.routingMode = ChannelRoutingMode::MonoToMultichannel;
  std::string error;
  assert(backend.setOutputConfig(config, &error));
  assert(backend.open("asio:phase5b", sourceFormat(1), &error));
  assert(rawHost->lastOpenConfig.format.channelCount == 6);
  assert(backend.start([](float* output, size_t frames) {
    for (size_t frame = 0; frame < frames; ++frame) output[frame] = 0.75f;
    return frames;
  }, nullptr, &error));
  rawHost->triggerBufferSwitch(0);
  assert(readFloat(rawHost->channelBuffers[0].buffers[0]) == 0.75f);
  assert(readFloat(rawHost->channelBuffers[1].buffers[0]) == 0.75f);
  assert(readFloat(rawHost->channelBuffers[2].buffers[0]) == 0.0f);
}

void testDiagnostics() {
  auto host = makeHost();
  auto* rawHost = host.get();
  AsioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("asio:phase5b", sourceFormat(), &error));
  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
  rawHost->failOpenCount = 1;
  rawHost->triggerEvent(AsioHostEvent::DriverRestart, "restart");
  const auto info = backend.outputInfo();
  assert(info.diagnostics.driverRestartCount == 1);
  assert(info.diagnostics.sessionRecoveryCount == 1);
  assert(info.diagnostics.lifetimeRecoveryCount == 1);
  assert(info.deviceRecovered);
}

void testDeviceLostAndBufferFailureDiagnostics() {
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:phase5b", sourceFormat(), &error));
    assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
    rawHost->triggerEvent(AsioHostEvent::DeviceLost, "device lost");
    const auto info = backend.outputInfo();
    assert(info.diagnostics.deviceLostCount == 1);
    assert(info.diagnostics.sessionRecoveryCount == 1);
    assert(info.diagnostics.lastError.find("ASIO device lost") != std::string::npos);
  }
  {
    auto host = makeHost();
    auto* rawHost = host.get();
    AsioBackend backend(std::move(host));
    std::string error;
    assert(backend.open("asio:phase5b", sourceFormat(), &error));
    assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
    rawHost->triggerEvent(AsioHostEvent::BufferFailure, "buffer failed");
    const auto info = backend.outputInfo();
    assert(info.diagnostics.sessionUnderrunCount == 1);
    assert(info.diagnostics.lifetimeUnderrunCount == 1);
    assert(info.diagnostics.sessionRecoveryCount == 1);
    assert(info.diagnostics.lastError.find("ASIO buffer failure") != std::string::npos);
  }
}

}  // namespace

int main() {
  testBufferSizeAutoAndFallback();
  testCapabilityCacheAndVersion();
  testLatencyInfoAndPlaybackInfo();
  testChannelRouting();
  testMonoRouting();
  testDiagnostics();
  testDeviceLostAndBufferFailureDiagnostics();
  return 0;
}
