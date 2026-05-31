#include "twilight_audio_engine.h"

#include <cassert>
#include <string>
#include <vector>

namespace {

std::string callString(TAE_EngineHandle engine, TAE_Result (*fn)(TAE_EngineHandle, char*, size_t, size_t*)) {
  size_t required = 0;
  assert(fn(engine, nullptr, 0, &required) == TAE_RESULT_OK);
  assert(required > 1);
  std::vector<char> buffer(required);
  assert(fn(engine, buffer.data(), buffer.size(), &required) == TAE_RESULT_OK);
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
  assert(TAE_CreateEngine(&engine) == TAE_RESULT_OK);
  assert(engine != nullptr);

  const std::string backendsJson = callString(engine, TAE_EnumerateBackends);
  const std::string playbackJson = callString(engine, TAE_GetPlaybackInfo);
  const std::string defaultId = stringField(playbackJson, "outputBackend");
  TAE_DestroyEngine(engine);

  if (defaultId.empty() || defaultId == "none") {
    assert(backendsJson == "[]");
  } else {
    assert(backendsJson.find("\"id\":\"" + defaultId + "\"") != std::string::npos);
  }

  return 0;
}
