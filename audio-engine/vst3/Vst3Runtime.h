#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace twilight::vst3 {

struct RuntimeConfig {
  std::string modulePath;
  std::string classId;
  uint32_t sampleRate = 0;
  uint32_t channels = 0;
  uint32_t maxFrames = 0;
  std::string parametersJson;
  std::string statePath;
  std::string stateFormat;
};

struct RuntimeInfo {
  uint32_t latencyFrames = 0;
  uint32_t tailFrames = 0;
  std::string error;
};

class Vst3Runtime {
 public:
  Vst3Runtime();
  ~Vst3Runtime();

  Vst3Runtime(const Vst3Runtime&) = delete;
  Vst3Runtime& operator=(const Vst3Runtime&) = delete;

  bool initialize(const RuntimeConfig& config);
  bool process(const float* input, float* output, uint32_t frames);
  void shutdown();
  const RuntimeInfo& info() const noexcept { return info_; }

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
  RuntimeInfo info_;
};

}  // namespace twilight::vst3
