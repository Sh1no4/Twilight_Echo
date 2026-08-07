#include "MockAsioHost.h"

#include <algorithm>

namespace twilight::audio {
namespace {

size_t bytesPerSample(AudioSampleFormat format) {
  switch (format) {
    case AudioSampleFormat::DsdInt8Lsb1:
    case AudioSampleFormat::DsdInt8Msb1:
    case AudioSampleFormat::DsdInt8Ner8:
      return 1;
    case AudioSampleFormat::Int16Interleaved:
      return 2;
    case AudioSampleFormat::Int24Interleaved:
      return 3;
    case AudioSampleFormat::Int24In32Interleaved:
    case AudioSampleFormat::Int32Interleaved:
    case AudioSampleFormat::Float32Interleaved:
    default:
      return 4;
  }
}

int bitDepthForFormat(AudioSampleFormat format) {
  switch (format) {
    case AudioSampleFormat::DsdInt8Lsb1:
    case AudioSampleFormat::DsdInt8Msb1:
    case AudioSampleFormat::DsdInt8Ner8:
      return 1;
    case AudioSampleFormat::Int16Interleaved:
      return 16;
    case AudioSampleFormat::Int24Interleaved:
    case AudioSampleFormat::Int24In32Interleaved:
      return 24;
    case AudioSampleFormat::Int32Interleaved:
    case AudioSampleFormat::Float32Interleaved:
    default:
      return 32;
  }
}

AsioChannelFormat channelFormatFor(AudioSampleFormat format) {
  AsioChannelFormat descriptor;
  descriptor.logicalFormat = format;
  switch (format) {
    case AudioSampleFormat::DsdInt8Lsb1:
      descriptor.containerBits = 8;
      descriptor.validBits = 1;
      descriptor.dsdPacking = AsioDsdPacking::Lsb1;
      break;
    case AudioSampleFormat::DsdInt8Msb1:
      descriptor.containerBits = 8;
      descriptor.validBits = 1;
      descriptor.dsdPacking = AsioDsdPacking::Msb1;
      break;
    case AudioSampleFormat::DsdInt8Ner8:
      descriptor.containerBits = 8;
      descriptor.validBits = 8;
      descriptor.dsdPacking = AsioDsdPacking::Ner8;
      break;
    case AudioSampleFormat::Int16Interleaved:
      descriptor.containerBits = 16;
      descriptor.validBits = 16;
      break;
    case AudioSampleFormat::Int24Interleaved:
      descriptor.containerBits = 24;
      descriptor.validBits = 24;
      break;
    case AudioSampleFormat::Int24In32Interleaved:
      descriptor.containerBits = 32;
      descriptor.validBits = 24;
      descriptor.validBitsAreMostSignificant = true;
      break;
    case AudioSampleFormat::Int32Interleaved:
    case AudioSampleFormat::Float32Interleaved:
    default:
      break;
  }
  return descriptor;
}

}  // namespace

std::vector<AsioDeviceInfo> MockAsioHost::enumerateDevices() {
  return devices;
}

AsioHostDiagnostics MockAsioHost::diagnostics() const {
  AsioHostDiagnostics result;
  result.processArchitecture = sizeof(void*) == 8 ? "x64" : "x86";
  result.buildEnabled = true;
  result.registeredDriverCount64 = static_cast<int>(devices.size());
  result.loadableDriverCount64 = static_cast<int>(devices.size());
  return result;
}

bool MockAsioHost::open(const AsioOpenConfig& config, AsioOpenResult* result, std::string* error) {
  ++openCalls;
  lastOpenConfig = config;
  if (failOpenCount > 0) {
    --failOpenCount;
    if (error) {
      *error = openFailure == OpenFailure::DriverInit ? "mock driver init failure" : "mock open failure";
    }
    return false;
  }
  if (failDriverInitCount > 0) {
    --failDriverInitCount;
    if (error) *error = "mock driver init failure";
    return false;
  }
  if (failDriverOpenCount > 0) {
    --failDriverOpenCount;
    if (error) *error = "mock open failure";
    return false;
  }
  openResult.actualFormat = actualFormatOverride.value_or(config.format);
  openResult.bufferSizeFrames = config.bufferSizeFrames > 0 ? config.bufferSizeFrames : 128;
  openResult.latencyFrames = openResult.bufferSizeFrames * 2;
  if (openResult.driverName.empty()) openResult.driverName = "Mock ASIO";
  if (openResult.driverVersion == 0) openResult.driverVersion = 1;
  if (result) *result = openResult;
  return true;
}

bool MockAsioHost::createBuffers(
    AsioBufferSwitchCallback bufferSwitch,
    AsioEventCallback eventCallback,
    std::string* error) {
  ++createBuffersCalls;
  if (failCreateBuffersCount > 0) {
    --failCreateBuffersCount;
    if (error) *error = "mock create buffers failure";
    return false;
  }
  bufferSwitch_ = std::move(bufferSwitch);
  eventCallback_ = std::move(eventCallback);

  const int channels = std::max(1, lastOpenConfig.format.channelCount);
  const size_t frames = static_cast<size_t>(std::max<long>(1, openResult.bufferSizeFrames));
  if (channelFormats.empty()) {
    channelFormats.assign(static_cast<size_t>(channels), lastOpenConfig.format.sampleFormat);
  }
  channelBuffers.assign(static_cast<size_t>(channels), ChannelBuffer{});
  for (int channel = 0; channel < channels; ++channel) {
    const AudioSampleFormat format =
        channel < static_cast<int>(channelFormats.size()) ? channelFormats[static_cast<size_t>(channel)] : lastOpenConfig.format.sampleFormat;
    const size_t bytes = frames * bytesPerSample(format);
    channelBuffers[static_cast<size_t>(channel)].buffers[0].assign(bytes, 0);
    channelBuffers[static_cast<size_t>(channel)].buffers[1].assign(bytes, 0);
  }
  return true;
}

bool MockAsioHost::start(std::string* error) {
  ++startCalls;
  if (failStartCount > 0) {
    --failStartCount;
    if (error) *error = "mock start failure";
    return false;
  }
  started = true;
  return true;
}

void MockAsioHost::stop() {
  ++stopCalls;
  started = false;
}

void MockAsioHost::close() {
  ++closeCalls;
  started = false;
}

void* MockAsioHost::outputBuffer(long channel, long bufferIndex) {
  if (channel < 0 || bufferIndex < 0 || bufferIndex > 1) return nullptr;
  const size_t channelIndex = static_cast<size_t>(channel);
  if (channelIndex >= channelBuffers.size()) return nullptr;
  return channelBuffers[channelIndex].buffers[static_cast<size_t>(bufferIndex)].data();
}

AudioSampleFormat MockAsioHost::outputSampleFormat(long channel) const {
  if (channel < 0 || static_cast<size_t>(channel) >= channelFormats.size()) {
    return AudioSampleFormat::Float32Interleaved;
  }
  return channelFormats[static_cast<size_t>(channel)];
}

AsioChannelFormat MockAsioHost::outputChannelFormat(long channel) const {
  ++outputChannelFormatCalls;
  if (channel >= 0 && static_cast<size_t>(channel) < channelDescriptors.size()) {
    return channelDescriptors[static_cast<size_t>(channel)];
  }
  return channelFormatFor(outputSampleFormat(channel));
}

bool MockAsioHost::outputReady() {
  ++outputReadyCalls;
  if (failOutputReadyCount > 0) {
    --failOutputReadyCount;
    return false;
  }
  return true;
}

void MockAsioHost::triggerBufferSwitch(long bufferIndex) {
  if (bufferSwitch_) bufferSwitch_(bufferIndex);
}

void MockAsioHost::triggerEvent(AsioHostEvent event, const std::string& message) {
  if (eventCallback_) eventCallback_(event, message);
}

AsioDeviceInfo makeMockAsioDevice(
    std::string id,
    std::vector<int> sampleRates,
    int channels,
    AudioSampleFormat sampleFormat,
    MockAsioHost::DsdProfile dsdProfile) {
  AsioDeviceInfo device;
  device.id = std::move(id);
  device.name = "Mock ASIO";
  device.driverName = "Mock ASIO";
  device.driverVersion = 42;
  device.outputChannels = channels;
  device.supportedSampleRates = std::move(sampleRates);
  device.dopCapable = dsdProfile.dopCapable;
  device.nativeDsdCapable = dsdProfile.nativeDsdCapable;
  device.dopCarrierSampleRates = std::move(dsdProfile.dopCarrierSampleRates);
  device.dopCarrierSampleFormats = std::move(dsdProfile.dopCarrierSampleFormats);
  device.nativeDsdSampleRates = std::move(dsdProfile.nativeDsdSampleRates);
  device.nativeDsdSampleFormats = std::move(dsdProfile.nativeDsdSampleFormats);
  device.defaultSampleRate = device.supportedSampleRates.empty() ? 48000 : device.supportedSampleRates.front();
  device.defaultSampleFormat = sampleFormat;
  device.defaultBitDepth = bitDepthForFormat(sampleFormat);
  device.sampleFormats = {
      AudioSampleFormat::Int16Interleaved,
      AudioSampleFormat::Int24Interleaved,
      AudioSampleFormat::Int24In32Interleaved,
      AudioSampleFormat::Int32Interleaved,
      AudioSampleFormat::Float32Interleaved};
  if (device.nativeDsdCapable) {
    if (device.nativeDsdSampleFormats.empty()) {
      device.nativeDsdSampleFormats = {AudioSampleFormat::DsdInt8Lsb1};
    }
    for (const auto format : device.nativeDsdSampleFormats) {
      if (std::find(device.sampleFormats.begin(), device.sampleFormats.end(), format) == device.sampleFormats.end()) {
        device.sampleFormats.push_back(format);
      }
    }
  }
  device.bitDepths = {16, 24, 32};
  if (device.nativeDsdCapable) device.bitDepths.push_back(1);
  device.minBufferSize = 4;
  device.maxBufferSize = 2048;
  device.bufferGranularity = 4;
  device.preferredBufferSize = 4;
  device.outputLatencyFrames = 8;
  device.capabilityVersion = 1;
  device.isDefault = true;
  return device;
}

}  // namespace twilight::audio
