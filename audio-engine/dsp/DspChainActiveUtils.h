#pragma once

#include "IAudioProcessor.h"

#include <memory>
#include <vector>

namespace twilight::audio::dsp {

inline std::vector<IAudioProcessor*> collectActiveProcessors(const std::vector<IAudioProcessor*>& processors) {
  std::vector<IAudioProcessor*> active;
  active.reserve(processors.size());
  for (IAudioProcessor* processor : processors) {
    if (processor && processor->isActive()) active.push_back(processor);
  }
  return active;
}

inline std::vector<IAudioProcessor*> collectActiveProcessors(
    const std::vector<std::unique_ptr<IAudioProcessor>>& processors) {
  std::vector<IAudioProcessor*> active;
  active.reserve(processors.size());
  for (const auto& processor : processors) {
    if (processor && processor->isActive()) active.push_back(processor.get());
  }
  return active;
}

}  // namespace twilight::audio::dsp
