#include "MockAsioHost.h"

#include <algorithm>

namespace twilight::audio {
namespace {

size_t bytesPerSample(AudioSampleFormat format) {
  switch (format) {
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

}  // namespace

std::vector<AsioDeviceInfo> MockAsioHost::enumerateDevices() {
  return devices;
}

bool MockAsioHost::open(const AsioOpenConfig& config, AsioOpenResult* result, std::string* error) {
  ++openCalls;
  lastOpenConfig = config;
  if (failOpenCount > 0) {
    --failOpenCount;
    if (error) *error = "mock open failure";
    return false;
  }
  openResult.actualFormat = config.format;
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

bool MockAsioHost::outputReady() {
  ++outputReadyCalls;
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
    AudioSampleFormat sampleFormat) {
  AsioDeviceInfo device;
  device.id = std::move(id);
  device.name = "Mock ASIO";
  device.driverName = "Mock ASIO";
  device.driverVersion = 42;
  device.outputChannels = channels;
  device.supportedSampleRates = std::move(sampleRates);
  device.defaultSampleRate = device.supportedSampleRates.empty() ? 48000 : device.supportedSampleRates.front();
  device.defaultSampleFormat = sampleFormat;
  device.defaultBitDepth = bitDepthForFormat(sampleFormat);
  device.bitDepths = {16, 24, 32};
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
