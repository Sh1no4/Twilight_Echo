#pragma once

#include "IAsioHost.h"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace twilight::audio {

class MockAsioHost final : public IAsioHost {
 public:
  struct ChannelBuffer {
    std::array<std::vector<uint8_t>, 2> buffers;
  };

  std::vector<AsioDeviceInfo> devices;
  AsioOpenConfig lastOpenConfig;
  AsioOpenResult openResult;
  std::vector<AudioSampleFormat> channelFormats;
  std::vector<ChannelBuffer> channelBuffers;
  int openCalls = 0;
  int startCalls = 0;
  int stopCalls = 0;
  int closeCalls = 0;
  int createBuffersCalls = 0;
  int outputReadyCalls = 0;
  int failOpenCount = 0;
  int failCreateBuffersCount = 0;
  int failStartCount = 0;
  bool started = false;

  std::vector<AsioDeviceInfo> enumerateDevices() override;
  bool open(const AsioOpenConfig& config, AsioOpenResult* result, std::string* error) override;
  bool createBuffers(AsioBufferSwitchCallback bufferSwitch, AsioEventCallback eventCallback, std::string* error) override;
  bool start(std::string* error) override;
  void stop() override;
  void close() override;

  void* outputBuffer(long channel, long bufferIndex) override;
  AudioSampleFormat outputSampleFormat(long channel) const override;
  bool outputReady() override;

  void triggerBufferSwitch(long bufferIndex);
  void triggerEvent(AsioHostEvent event, const std::string& message);

 private:
  AsioBufferSwitchCallback bufferSwitch_;
  AsioEventCallback eventCallback_;
};

AsioDeviceInfo makeMockAsioDevice(
    std::string id,
    std::vector<int> sampleRates,
    int channels = 2,
    AudioSampleFormat sampleFormat = AudioSampleFormat::Float32Interleaved);

}  // namespace twilight::audio
