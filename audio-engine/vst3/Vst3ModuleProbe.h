#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace twilight::vst3 {

struct Vst3ParameterDescriptor {
  uint32_t id = 0;
  std::string title;
  std::string unit;
  double defaultNormalizedValue = 0.0;
  int32_t stepCount = 0;
  int32_t flags = 0;
};

struct AudioEffectDescriptor {
  std::string classId;
  std::string name;
  std::string vendor;
  std::string version;
  std::string category;
  std::vector<std::string> supportedLayouts;
  std::vector<Vst3ParameterDescriptor> parameters;
};

struct ModuleProbeResult {
  std::vector<AudioEffectDescriptor> audioEffects;
  std::string error;

  [[nodiscard]] bool ok() const noexcept { return error.empty() && !audioEffects.empty(); }
};

ModuleProbeResult probeModule(const std::string& modulePath);
std::string scannerDescriptorJson(const ModuleProbeResult& result);
std::string hostInspectionJson(const ModuleProbeResult& result);
std::string jsonEscape(const std::string& value);

}  // namespace twilight::vst3
