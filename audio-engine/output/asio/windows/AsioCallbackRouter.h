#pragma once

#include "../abi/AsioAbi.h"

#include <string>

namespace twilight::audio::asio_windows {

class AsioCallbackTarget {
 public:
  virtual ~AsioCallbackTarget() = default;
  virtual void onAsioBufferSwitch(int32_t bufferIndex) noexcept = 0;
  virtual void onAsioSampleRateChanged(double sampleRate) noexcept = 0;
  virtual int32_t onAsioMessage(int32_t selector, int32_t value, void* message, double* option) noexcept = 0;
};

class AsioCallbackRouter final {
 public:
  static bool install(AsioCallbackTarget* target, std::string* error);
  static bool uninstall(AsioCallbackTarget* target, std::string* error);
  static asio_abi::AsioCallbacks callbacks();
};

}  // namespace twilight::audio::asio_windows
