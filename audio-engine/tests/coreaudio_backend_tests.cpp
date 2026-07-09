#include "../output/coreaudio/CoreAudioBackend.h"
#include "../output/coreaudio/CoreAudioExclusiveBackend.h"
#include "../output/coreaudio/CoreAudioRenderUtils.h"
#include "../output/coreaudio/MockCoreAudioHost.h"

#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
#include <cmath>

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

std::string readTextFile(const std::filesystem::path& path) {
  std::ifstream in(path, std::ios::binary);
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

std::string extractFunctionBody(const std::string& source, const std::string& signature) {
  const size_t signaturePos = source.find(signature);
  assert(signaturePos != std::string::npos);
  const size_t bodyStart = source.find('{', signaturePos);
  assert(bodyStart != std::string::npos);
  int depth = 0;
  for (size_t i = bodyStart; i < source.size(); ++i) {
    if (source[i] == '{') {
      ++depth;
    } else if (source[i] == '}') {
      --depth;
      if (depth == 0) return source.substr(bodyStart, i - bodyStart + 1);
    }
  }
  assert(false);
  return {};
}

void testCoreAudioRenderCallbacksDoNotResizeScratchBuffers() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path coreAudioPath =
      testFilePath.parent_path().parent_path() / "output" / "coreaudio" / "CoreAudioBackend.cpp";
  const std::filesystem::path exclusivePath =
      testFilePath.parent_path().parent_path() / "output" / "coreaudio" / "CoreAudioExclusiveBackend.cpp";

  const std::string sharedRender = extractFunctionBody(
      readTextFile(coreAudioPath),
      "size_t render(uint32_t frameCount, CoreAudioBufferList* ioData)");
  const std::string exclusiveRender = extractFunctionBody(
      readTextFile(exclusivePath),
      "size_t render(uint32_t frameCount, CoreAudioBufferList* ioData)");

  assert(sharedRender.find(".resize(") == std::string::npos);
  assert(exclusiveRender.find(".resize(") == std::string::npos);
}

void testCoreAudioRenderCallbacksDoNotBlockOnBackendMutex() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path coreAudioPath =
      testFilePath.parent_path().parent_path() / "output" / "coreaudio" / "CoreAudioBackend.cpp";
  const std::filesystem::path exclusivePath =
      testFilePath.parent_path().parent_path() / "output" / "coreaudio" / "CoreAudioExclusiveBackend.cpp";

  const std::string sharedRender = extractFunctionBody(
      readTextFile(coreAudioPath),
      "size_t render(uint32_t frameCount, CoreAudioBufferList* ioData)");
  const std::string exclusiveRender = extractFunctionBody(
      readTextFile(exclusivePath),
      "size_t render(uint32_t frameCount, CoreAudioBufferList* ioData)");

  assert(sharedRender.find("mutex") != std::string::npos);
  assert(exclusiveRender.find("mutex") != std::string::npos);
  assert(sharedRender.find("std::lock_guard lock(mutex)") == std::string::npos);
  assert(exclusiveRender.find("std::lock_guard lock(mutex)") == std::string::npos);
}

void testCoreAudioRenderCallbacksDoNotCopyStringDiagnostics() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path coreAudioPath =
      testFilePath.parent_path().parent_path() / "output" / "coreaudio" / "CoreAudioBackend.cpp";
  const std::filesystem::path exclusivePath =
      testFilePath.parent_path().parent_path() / "output" / "coreaudio" / "CoreAudioExclusiveBackend.cpp";

  const std::string sharedRender = extractFunctionBody(
      readTextFile(coreAudioPath),
      "size_t render(uint32_t frameCount, CoreAudioBufferList* ioData)");
  const std::string exclusiveRender = extractFunctionBody(
      readTextFile(exclusivePath),
      "size_t render(uint32_t frameCount, CoreAudioBufferList* ioData)");

  assert(sharedRender.find("lastError =") == std::string::npos);
  assert(exclusiveRender.find("lastError =") == std::string::npos);
  assert(sharedRender.find("outputInfo.diagnostics =") == std::string::npos);
  assert(exclusiveRender.find("outputInfo.diagnostics =") == std::string::npos);
}

void testRealCoreAudioHostAudioUnitCallbackUsesNonOwningBuffers() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath =
      testFilePath.parent_path().parent_path() / "output" / "coreaudio" / "RealCoreAudioHost.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string setCallbackBody =
      extractFunctionBody(source, "bool RealCoreAudioHost::setRenderCallback(CoreAudioAudioUnit unit, CoreAudioRenderCallback callback, std::string* error)");

  assert(setCallbackBody.find("toHostBufferList(ioData)") == std::string::npos);
  assert(setCallbackBody.find("copyToNative(ioData, hostList)") == std::string::npos);
  assert(source.find("buffer.data.assign") == std::string::npos);
  assert(source.find("out.buffers.resize") == std::string::npos);
}

void testRealCoreAudioHostInstallsNativeDeviceLostListeners() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath =
      testFilePath.parent_path().parent_path() / "output" / "coreaudio" / "RealCoreAudioHost.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string addListenerBody =
      extractFunctionBody(source, "CoreAudioListenerToken RealCoreAudioHost::addDeviceLostListener(");
  const std::string removeListenerBody =
      extractFunctionBody(source, "void RealCoreAudioHost::removeDeviceLostListener(");

  assert(addListenerBody.find("(void)callback") == std::string::npos);
  assert(addListenerBody.find("AudioObjectAddPropertyListener") != std::string::npos);
  assert(addListenerBody.find("deviceAlivePropertyAddress()") != std::string::npos);
  assert(addListenerBody.find("hardwareDevicesPropertyAddress()") != std::string::npos);
  assert(source.find("kAudioDevicePropertyDeviceIsAlive") != std::string::npos);
  assert(source.find("kAudioHardwarePropertyDevices") != std::string::npos);
  assert(addListenerBody.find("coreAudioDeviceLostListenerProc") != std::string::npos);
  assert(removeListenerBody.find("AudioObjectRemovePropertyListener") != std::string::npos);
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

void testCoreAudioSharedCloseStopsAudioUnitBeforeDispose() {
  auto host = makeHost();
  auto* rawHost = host.get();
  CoreAudioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));

  backend.close();

  assert(rawHost->audioUnitStopCalls == 1);
  const auto findCall = [&](const std::string& prefix) {
    for (size_t index = 0; index < rawHost->callLog.size(); ++index) {
      if (rawHost->callLog[index].find(prefix) == 0) return index;
    }
    return rawHost->callLog.size();
  };
  const size_t stopIndex = findCall("audioUnitStop:");
  const size_t uninitializeIndex = findCall("audioUnitUninitialize:");
  const size_t disposeIndex = findCall("disposeAudioUnit:");
  assert(stopIndex < uninitializeIndex);
  assert(stopIndex < disposeIndex);
}

void testCoreAudioSharedDeviceLostCloseStopsBeforeDispose() {
  auto host = makeHost();
  auto* rawHost = host.get();
  CoreAudioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));

  rawHost->triggerDeviceLost("mock device lost");
  backend.close();

  const auto findCall = [&](const std::string& prefix) {
    for (size_t index = 0; index < rawHost->callLog.size(); ++index) {
      if (rawHost->callLog[index].find(prefix) == 0) return index;
    }
    return rawHost->callLog.size();
  };
  const size_t stopIndex = findCall("audioUnitStop:");
  const size_t uninitializeIndex = findCall("audioUnitUninitialize:");
  const size_t disposeIndex = findCall("disposeAudioUnit:");
  assert(rawHost->audioUnitStopCalls == 1);
  assert(stopIndex < uninitializeIndex);
  assert(stopIndex < disposeIndex);
}

void testCoreAudioSharedRejectsRepeatedStart() {
  auto host = makeHost();
  auto* rawHost = host.get();
  CoreAudioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));

  error.clear();
  assert(!backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));

  assert(!error.empty());
  assert(rawHost->audioUnitStartCalls == 1);
  backend.stop();
  assert(rawHost->audioUnitStopCalls == 1);
}

void testCoreAudioExclusiveStopIsIdempotentAcrossClose() {
  auto host = makeHost();
  auto* rawHost = host.get();
  CoreAudioExclusiveBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));

  backend.stop();
  backend.close();

  assert(rawHost->audioUnitStopCalls == 1);
}

void testCoreAudioExclusiveDeviceLostCloseStopsBeforeDispose() {
  auto host = makeHost();
  auto* rawHost = host.get();
  CoreAudioExclusiveBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));

  rawHost->triggerDeviceLost("mock device lost");
  backend.close();

  const auto findCall = [&](const std::string& prefix) {
    for (size_t index = 0; index < rawHost->callLog.size(); ++index) {
      if (rawHost->callLog[index].find(prefix) == 0) return index;
    }
    return rawHost->callLog.size();
  };
  const size_t stopIndex = findCall("audioUnitStop:");
  const size_t uninitializeIndex = findCall("audioUnitUninitialize:");
  const size_t disposeIndex = findCall("disposeAudioUnit:");
  assert(rawHost->audioUnitStopCalls == 1);
  assert(stopIndex < uninitializeIndex);
  assert(stopIndex < disposeIndex);
}

void testCoreAudioExclusiveRejectsRepeatedStart() {
  auto host = makeHost();
  auto* rawHost = host.get();
  CoreAudioExclusiveBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));

  error.clear();
  assert(!backend.startTyped(
      [](PcmBlock& block) { return block.frames; },
      [](float*, size_t frames) { return frames; },
      nullptr,
      &error));

  assert(!error.empty());
  assert(rawHost->audioUnitStartCalls == 1);
  backend.stop();
  assert(rawHost->audioUnitStopCalls == 1);
}

void testCoreAudioExclusiveTypedZeroFallsBackToFloatCallback() {
  auto host = makeHost();
  auto* rawHost = host.get();
  CoreAudioExclusiveBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  bool fallbackCalled = false;
  assert(backend.startTyped(
      [](PcmBlock&) { return static_cast<size_t>(0); },
      [&](float* output, size_t frames) {
        fallbackCalled = true;
        for (size_t sample = 0; sample < frames * 2; ++sample) {
          output[sample] = 0.25f;
        }
        return frames;
      },
      nullptr,
      &error));

  const size_t rendered = rawHost->triggerRender(64);
  assert(fallbackCalled);
  assert(rendered == 64);
}

void testCoreAudioSharedUsesDeviceBufferSizeForRenderAndLatency() {
  auto host = makeHost();
  auto* rawHost = host.get();
  rawHost->devices.front().bufferFrameSize = 1024;
  CoreAudioBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  const auto openedInfo = backend.outputInfo();
  assert(openedInfo.bufferSizeFrames == 1024);
  assert(openedInfo.latencyFrames == 1024);
  assert(std::fabs(openedInfo.latencyInfo.bufferLatencyMs - (1024.0 * 1000.0 / 48000.0)) < 0.001);
  assert(std::fabs(openedInfo.latencyInfo.outputLatencyMs - (128.0 * 1000.0 / 48000.0)) < 0.001);
  assert(std::fabs(openedInfo.latencyInfo.totalLatencyMs -
                   (openedInfo.latencyInfo.bufferLatencyMs + openedInfo.latencyInfo.outputLatencyMs)) < 0.001);
  assert(openedInfo.latencyMs == openedInfo.latencyInfo.totalLatencyMs);

  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
  const size_t rendered = rawHost->triggerRender(1024);
  assert(rendered == 1024);
  assert(backend.outputInfo().diagnostics.sessionUnderrunCount == 0);
  assert(rawHost->currentBufferFrameSizeCalls >= 1);
}

void testCoreAudioExclusiveUsesDeviceBufferSizeForRenderAndLatency() {
  auto host = makeHost();
  auto* rawHost = host.get();
  rawHost->devices.front().bufferFrameSize = 1024;
  CoreAudioExclusiveBackend backend(std::move(host));
  std::string error;
  assert(backend.open("auto", sourceFormat(), &error));
  const auto openedInfo = backend.outputInfo();
  assert(openedInfo.bufferSizeFrames == 1024);
  assert(openedInfo.latencyFrames == 1024);
  assert(std::fabs(openedInfo.latencyInfo.bufferLatencyMs - (1024.0 * 1000.0 / 48000.0)) < 0.001);
  assert(std::fabs(openedInfo.latencyInfo.outputLatencyMs - (128.0 * 1000.0 / 48000.0)) < 0.001);
  assert(std::fabs(openedInfo.latencyInfo.totalLatencyMs -
                   (openedInfo.latencyInfo.bufferLatencyMs + openedInfo.latencyInfo.outputLatencyMs)) < 0.001);
  assert(openedInfo.latencyMs == openedInfo.latencyInfo.totalLatencyMs);

  assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
  const size_t rendered = rawHost->triggerRender(1024);
  assert(rendered == 1024);
  assert(backend.outputInfo().diagnostics.sessionUnderrunCount == 0);
  assert(rawHost->currentBufferFrameSizeCalls >= 1);
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
  testCoreAudioRenderCallbacksDoNotResizeScratchBuffers();
  testCoreAudioRenderCallbacksDoNotBlockOnBackendMutex();
  testCoreAudioRenderCallbacksDoNotCopyStringDiagnostics();
  testRealCoreAudioHostAudioUnitCallbackUsesNonOwningBuffers();
  testRealCoreAudioHostInstallsNativeDeviceLostListeners();
  testCoreAudioHogPrecheckRejectsOwnedDevice();
  testCoreAudioHogAcquireRelease();
  testCoreAudioSharedCloseStopsAudioUnitBeforeDispose();
  testCoreAudioSharedDeviceLostCloseStopsBeforeDispose();
  testCoreAudioSharedRejectsRepeatedStart();
  testCoreAudioExclusiveStopIsIdempotentAcrossClose();
  testCoreAudioExclusiveDeviceLostCloseStopsBeforeDispose();
  testCoreAudioExclusiveRejectsRepeatedStart();
  testCoreAudioExclusiveTypedZeroFallsBackToFloatCallback();
  testCoreAudioSharedUsesDeviceBufferSizeForRenderAndLatency();
  testCoreAudioExclusiveUsesDeviceBufferSizeForRenderAndLatency();
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
