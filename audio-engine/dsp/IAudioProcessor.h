#pragma once

#include "DspTypes.h"

#include <cstddef>

namespace twilight::audio {

class IAudioProcessor {
 public:
  virtual ~IAudioProcessor() = default;

  virtual void configure(const DspConfig& config) = 0;
  virtual void prepare(const AudioFormat& format) = 0;
  virtual void setTrackContext(const DspTrackContext& context) = 0;
  virtual void process(float* samples, size_t frameCount) = 0;
  virtual void reset() = 0;
  virtual bool isActive() const = 0;
};

}  // namespace twilight::audio
