#include "../output/coreaudio/CoreAudioBackend.h"
#include "../output/coreaudio/CoreAudioExclusiveBackend.h"
#include "../output/coreaudio/CoreAudioRenderUtils.h"
#include "../output/coreaudio/MockCoreAudioHost.h"

#include <cassert>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

using namespace twilight::audio;

namespace {

AudioFormat sourceFormat(
    int sampleRate = 48000,
    int bitDepth = 32,
    int channels = 2,
    AudioSampleFormat sampleFormat = AudioSampleFormat::Float32Interleaved) {
  AudioFormat format;
  format.sampleRate = sampleRate;
  format.bitDepth = bitDepth;
  format.channelCount = channels;
  format.sampleFormat = sampleFormat;
  return format;
}

std::unique_ptr<MockCoreAudioHost> makeHost(double nominalRate = 48000.0) {
  auto host = std::make_unique<MockCoreAudioHost>();
  MockCoreAudioHost::Device device;
  device.id = 42;
  device.name = "Mock CoreAudio DAC";
  device.channelCount = 2;
  device.nominalSampleRate = nominalRate;
  device.availableSampleRates = {44100.0, 48000.0, 96000.0};
  host->devices.push_back(device);
  return host;
}

void testCoreAudioHogPrecheckRejectsOwnedDevice() {
  auto host = makeHost();
  auto* rawHost = host.get();
  rawHost->existingHogOwnerPid = 1234;
  CoreAudioExclusiveBackend backend(std::move(host));
  std::string error;
  assert(!backend.open("auto", sourceFormat(), &error));
  assert(backend.outputInfo().perfectReasonCode == "hog_mode_failed");
  assert(backend.outputInfo().capabilityReason.find("already hogged by pid 1234") != std::string::npos);
  assert(error.find("already hogged by pid 1234") != std::string::npos);
  assert(rawHost->hogModeOwnerPidCalls == 1);
  assert(rawHost->acquireHogModeCalls == 0);
}

void testCoreAudioHogAcquireRelease() {
  auto host = makeHost();
  auto* rawHost = host.get();
  rawHost->existingHogOwnerPid = -1;
  CoreAudioExclusiveBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  assert(rawHost->hogModeOwnerPidCalls == 1);
  assert(rawHost->acquireHogModeCalls == 1);
  assert(rawHost->releaseHogModeCalls == 0);
  backend.close();
  assert(rawHost->releaseHogModeCalls == 1);
}

void testCoreAudioDeviceLostFiresInvalidated() {
  auto host = makeHost();
  auto* rawHost = host.get();
  CoreAudioExclusiveBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  bool invalidated = false;
  assert(backend.start(
      [](float*, size_t frames) { return frames; },
      [&](OutputBackendEvent event, const std::string& message) {
        invalidated = event == OutputBackendEvent::DeviceInvalidated &&
                      message.find("mock device lost") != std::string::npos;
      },
      &error));
  rawHost->triggerDeviceLost("mock device lost");
  const auto info = backend.outputInfo();
  assert(invalidated);
  assert(info.diagnostics.deviceLostCount == 1);
  assert(!info.deviceRecovered);
}

void testCoreAudioUnderrunDiagnostics() {
  auto host = makeHost();
  auto* rawHost = host.get();
  CoreAudioExclusiveBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  assert(backend.start([](float*, size_t frames) { return frames > 1 ? frames - 1 : 0; }, nullptr, &error));
  const size_t rendered = rawHost->triggerRender(64);
  assert(rendered == 63);
  const auto info = backend.outputInfo();
  assert(info.diagnostics.sessionUnderrunCount == 1);
  assert(info.diagnostics.lifetimeUnderrunCount == 1);
}

void testCoreAudioSampleRateMatch() {
  auto host = makeHost(44100.0);
  auto* rawHost = host.get();
  CoreAudioExclusiveBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(48000), &error));
  assert(rawHost->supportsNominalSampleRateCalls == 1);
  assert(rawHost->setNominalSampleRateCalls >= 1);
  assert(backend.outputInfo().supportsOutputPerfect);
}

void testCoreAudioNativeDsdUnsupported() {
  auto sharedHost = makeHost();
  CoreAudioBackend shared(std::move(sharedHost));
  assert(shared.nativeDsdRuntimeFacts().state == NativeDsdRuntimeFactState::Unsupported);
  assert(shared.nativeDsdRuntimeFacts().reason.find("no native DSD path") != std::string::npos);

  auto exclusiveHost = makeHost();
  CoreAudioExclusiveBackend exclusive(std::move(exclusiveHost));
  assert(exclusive.nativeDsdRuntimeFacts().state == NativeDsdRuntimeFactState::Unsupported);
  assert(exclusive.nativeDsdRuntimeFacts().reason.find("no native DSD path") != std::string::npos);
}

void testCoreAudioFloatRenderHelperZerosOnlyUnrenderedTail() {
  std::vector<float> buffer = {
      -1.0f, -1.0f,
      -1.0f, -1.0f,
      -1.0f, -1.0f,
  };

  const size_t rendered = coreaudio::renderFloatCallbackWithTailSilence(
      buffer.data(),
      3,
      2,
      [](float* output, size_t frames) {
        assert(frames == 3);
        output[0] = 0.125f;
        output[1] = -0.125f;
        return static_cast<size_t>(1);
      });

  assert(rendered == 1);
  assert(buffer[0] == 0.125f);
  assert(buffer[1] == -0.125f);
  for (size_t index = 2; index < buffer.size(); ++index) {
    assert(buffer[index] == 0.0f);
  }
}

void testCoreAudioFloatRenderHelperDoesNotPreclearFullRender() {
  std::vector<float> buffer = {
      -1.0f, -1.0f,
      -1.0f, -1.0f,
  };

  const size_t rendered = coreaudio::renderFloatCallbackWithTailSilence(
      buffer.data(),
      2,
      2,
      [](float* output, size_t frames) {
        assert(frames == 2);
        for (size_t sample = 0; sample < frames * 2; ++sample) {
          assert(output[sample] == -1.0f);
          output[sample] = static_cast<float>(sample + 1);
        }
        return frames;
      });

  assert(rendered == 2);
  assert(buffer[0] == 1.0f);
  assert(buffer[1] == 2.0f);
  assert(buffer[2] == 3.0f);
  assert(buffer[3] == 4.0f);
}

void testCoreAudioFloatRenderHelperZerosAllWithoutCallback() {
  std::vector<float> buffer = {
      -1.0f, -1.0f,
      -1.0f, -1.0f,
  };

  const size_t rendered = coreaudio::renderFloatCallbackWithTailSilence(
      buffer.data(),
      2,
      2,
      RenderCallback{});

  assert(rendered == 0);
  for (float sample : buffer) {
    assert(sample == 0.0f);
  }
}

void testCoreAudioTypedRenderHelperDoesNotPreclearFullRender() {
  std::vector<uint8_t> buffer = {
      0xee, 0xee,
      0xee, 0xee,
      0xee, 0xee,
      0xee, 0xee,
  };

  AudioFormat format = sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved);
  const size_t rendered = coreaudio::renderTypedCallbackWithTailSilence(
      buffer.data(),
      2,
      format,
      [&](PcmBlock& block) {
        assert(block.frames == 2);
        assert(block.byteSize == buffer.size());
        for (uint8_t byte : buffer) {
          assert(byte == 0xee);
        }
        const uint8_t bytes[] = {0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08};
        std::memcpy(block.data, bytes, sizeof(bytes));
        return block.frames;
      });

  assert(rendered == 2);
  const std::vector<uint8_t> expected = {0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08};
  assert(buffer == expected);
}

void testCoreAudioTypedRenderHelperZerosOnlyUnrenderedTail() {
  std::vector<uint8_t> buffer = {
      0xee, 0xee,
      0xee, 0xee,
      0xee, 0xee,
      0xee, 0xee,
  };

  AudioFormat format = sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved);
  const size_t rendered = coreaudio::renderTypedCallbackWithTailSilence(
      buffer.data(),
      2,
      format,
      [&](PcmBlock& block) {
        assert(block.frames == 2);
        const uint8_t bytes[] = {0x11, 0x22, 0x33, 0x44};
        std::memcpy(block.data, bytes, sizeof(bytes));
        return static_cast<size_t>(1);
      });

  assert(rendered == 1);
  const std::vector<uint8_t> expected = {0x11, 0x22, 0x33, 0x44, 0x00, 0x00, 0x00, 0x00};
  assert(buffer == expected);
}

}  // namespace

int main() {
  testCoreAudioHogPrecheckRejectsOwnedDevice();
  testCoreAudioHogAcquireRelease();
  testCoreAudioDeviceLostFiresInvalidated();
  testCoreAudioUnderrunDiagnostics();
  testCoreAudioSampleRateMatch();
  testCoreAudioNativeDsdUnsupported();
  testCoreAudioFloatRenderHelperZerosOnlyUnrenderedTail();
  testCoreAudioFloatRenderHelperDoesNotPreclearFullRender();
  testCoreAudioFloatRenderHelperZerosAllWithoutCallback();
  testCoreAudioTypedRenderHelperDoesNotPreclearFullRender();
  testCoreAudioTypedRenderHelperZerosOnlyUnrenderedTail();
  return 0;
}
