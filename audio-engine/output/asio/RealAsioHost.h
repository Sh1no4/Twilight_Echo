#pragma once

#include "IAsioHost.h"

#include <memory>
#include <string>
#include <vector>

#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
#include <asiosys.h>
#include <asio.h>
#endif

namespace twilight::audio {

class RealAsioHost final : public IAsioHost {
 public:
  RealAsioHost();
  ~RealAsioHost() override;

  std::vector<AsioDeviceInfo> enumerateDevices() override;
  bool open(const AsioOpenConfig& config, AsioOpenResult* result, std::string* error) override;
  bool createBuffers(AsioBufferSwitchCallback bufferSwitch, AsioEventCallback eventCallback, std::string* error) override;
  bool start(std::string* error) override;
  void stop() override;
  void close() override;

  void* outputBuffer(long channel, long bufferIndex) override;
  AudioSampleFormat outputSampleFormat(long channel) const override;
  bool outputReady() override;

#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  void handleHostEvent(AsioHostEvent event, const std::string& message);
  void handleBufferSwitch(long bufferIndex);
#endif

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace twilight::audio
