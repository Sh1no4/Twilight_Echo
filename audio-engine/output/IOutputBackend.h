#pragma once

#include "../core/AudioTypes.h"

#include <cstddef>
#include <functional>
#include <memory>
#include <string>

namespace twilight::audio {

using RenderCallback = std::function<size_t(float* interleaved, size_t frameCount)>;

class IOutputBackend {
 public:
  virtual ~IOutputBackend() = default;

  virtual const char* id() const = 0;
  virtual bool open(const std::string& deviceId, const AudioFormat& requestedFormat, std::string* error) = 0;
  virtual bool start(RenderCallback callback, std::string* error) = 0;
  virtual void stop() = 0;
  virtual void close() = 0;

  virtual AudioFormat outputFormat() const = 0;
  virtual std::string deviceName() const = 0;
};

std::unique_ptr<IOutputBackend> createOutputBackend(const std::string& backendId);

}  // namespace twilight::audio
