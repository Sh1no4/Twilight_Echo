#pragma once

#include "../IAsioHost.h"
#include "AsioCallbackRouter.h"
#include "AsioControlThread.h"
#include "AsioDriverCatalog.h"

#include <memory>
#include <string>

namespace twilight::audio::asio_windows {

class AsioDriverSession final {
 public:
  AsioDriverSession(AsioDriverEntry entry, std::shared_ptr<AsioControlThread> controlThread);
  ~AsioDriverSession();

  bool open(const AsioOpenConfig& config, AsioOpenResult* result, std::string* error);
  bool createBuffers(
      AsioBufferSwitchCallback bufferSwitch,
      AsioEventCallback eventCallback,
      std::string* error);
  bool start(std::string* error);
  void stop();
  void close();
  void* outputBuffer(long channel, long bufferIndex) const;
  AsioChannelFormat outputChannelFormat(long channel) const;
  bool outputReady();

 private:
  struct State;

  AsioDriverEntry entry_;
  std::shared_ptr<AsioControlThread> controlThread_;
  std::shared_ptr<State> state_;
};

}  // namespace twilight::audio::asio_windows
