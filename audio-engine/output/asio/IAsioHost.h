#pragma once

#include "../../core/AudioTypes.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace twilight::audio {

enum class AsioHostEvent {
  DriverReset,
  DriverRestart,
  DeviceLost,
  BufferFailure
};

struct AsioDeviceInfo {
  std::string id;
  std::string name;
  std::string driverName;
  long driverVersion = 0;
  int outputChannels = 0;
  std::vector<int> supportedSampleRates;
  std::vector<int> bitDepths;
  int defaultSampleRate = 0;
  int defaultBitDepth = 32;
  AudioSampleFormat defaultSampleFormat = AudioSampleFormat::Float32Interleaved;
  long minBufferSize = 0;
  long maxBufferSize = 0;
  long bufferGranularity = 0;
  long preferredBufferSize = 0;
  long outputLatencyFrames = 0;
  uint64_t capabilityVersion = 0;
  bool isDefault = false;
};

struct AsioOpenConfig {
  std::string deviceId;
  AudioFormat format;
  long bufferSizeFrames = 0;
};

struct AsioOpenResult {
  AudioFormat actualFormat;
  long bufferSizeFrames = 0;
  long latencyFrames = 0;
  std::string driverName;
  long driverVersion = 0;
};

using AsioBufferSwitchCallback = std::function<void(long bufferIndex)>;
using AsioEventCallback = std::function<void(AsioHostEvent event, const std::string& message)>;

class IAsioHost {
 public:
  virtual ~IAsioHost() = default;

  virtual std::vector<AsioDeviceInfo> enumerateDevices() = 0;
  virtual bool open(const AsioOpenConfig& config, AsioOpenResult* result, std::string* error) = 0;
  virtual bool createBuffers(AsioBufferSwitchCallback bufferSwitch, AsioEventCallback eventCallback, std::string* error) = 0;
  virtual bool start(std::string* error) = 0;
  virtual void stop() = 0;
  virtual void close() = 0;

  virtual void* outputBuffer(long channel, long bufferIndex) = 0;
  virtual AudioSampleFormat outputSampleFormat(long channel) const = 0;
  virtual bool outputReady() = 0;
};

std::unique_ptr<IAsioHost> createRealAsioHost();

std::vector<int> asioDefaultSampleRateProbeSet();
std::string asioSampleFormatName(AudioSampleFormat format);
std::string enumerateAsioDevicesJson();

}  // namespace twilight::audio
