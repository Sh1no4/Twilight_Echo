#include "twilight_audio_engine.h"

#include <iostream>
#include <string>
#include <vector>

namespace {

std::string callString(TAE_EngineHandle engine, TAE_Result (*fn)(TAE_EngineHandle, char*, size_t, size_t*)) {
  size_t required = 0;
  if (fn(engine, nullptr, 0, &required) != TAE_RESULT_OK || required <= 1) {
    return {};
  }
  std::vector<char> buffer(required);
  if (fn(engine, buffer.data(), buffer.size(), &required) != TAE_RESULT_OK) {
    return {};
  }
  return buffer.data();
}

std::string stringField(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\":\"";
  const size_t start = json.find(marker);
  if (start == std::string::npos) return {};
  const size_t valueStart = start + marker.size();
  const size_t valueEnd = json.find('"', valueStart);
  if (valueEnd == std::string::npos) return {};
  return json.substr(valueStart, valueEnd - valueStart);
}

}  // namespace

int main() {
  TAE_EngineHandle engine = nullptr;
  if (TAE_CreateEngine(&engine) != TAE_RESULT_OK || !engine) {
    std::cerr << "TAE_CreateEngine failed\n";
    return 1;
  }

  const std::string backendsJson = callString(engine, TAE_EnumerateBackends);
  const std::string playbackJson = callString(engine, TAE_GetPlaybackInfo);
  const std::string defaultId = stringField(playbackJson, "outputBackend");
  TAE_DestroyEngine(engine);

  if (defaultId.empty() || defaultId == "none") {
    if (backendsJson != "[]") {
      std::cerr << "Expected no backend for empty default, got: " << backendsJson << "\n";
      return 1;
    }
  } else {
    const std::string expected = "\"id\":\"" + defaultId + "\"";
    if (backendsJson.find(expected) == std::string::npos) {
      std::cerr << "Default backend " << defaultId << " missing from: " << backendsJson << "\n";
      return 1;
    }
  }

  return 0;
}
