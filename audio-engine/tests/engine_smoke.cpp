#include "twilight_audio_engine.h"

#include <cassert>
#include <cstring>
#include <vector>

int main() {
  TAE_EngineHandle engine = nullptr;
  assert(TAE_CreateEngine(&engine) == TAE_RESULT_OK);
  assert(engine != nullptr);

  assert(TAE_LoadQueue(engine, "[{\"id\":\"1\",\"source\":\"test.flac\"}]", 0) == TAE_RESULT_OK);
  const TAE_Result playResult = TAE_Play(engine, "test.flac", 0.0);
  assert(playResult == TAE_RESULT_OK || playResult == TAE_RESULT_BACKEND_UNAVAILABLE);
  assert(TAE_SetVolume(engine, 1.0) == TAE_RESULT_OK);

  size_t required = 0;
  assert(TAE_GetPlaybackInfo(engine, nullptr, 0, &required) == TAE_RESULT_OK);
  assert(required > 1);
  std::vector<char> json(required);
  assert(TAE_GetPlaybackInfo(engine, json.data(), json.size(), &required) == TAE_RESULT_OK);
  assert(std::strstr(json.data(), "\"state\":\"playing\"") != nullptr ||
         std::strstr(json.data(), "\"state\":\"stopped\"") != nullptr);

  const char* dspConfig =
      "{\"volumeNormalization\":\"track\",\"replayGainPreamp\":1.5,"
      "\"replayGainFallback\":-6,\"replayGainClip\":true,"
      "\"eqEnabled\":true,\"eqMode\":\"parametric\",\"eqPreamp\":-1,"
      "\"eqBands\":[{\"frequency\":1000,\"gain\":3,\"q\":1,"
      "\"filterType\":\"peak\"}]}";
  assert(TAE_SetDspConfig(engine, dspConfig) == TAE_RESULT_OK);
  required = 0;
  assert(TAE_GetPlaybackInfo(engine, nullptr, 0, &required) == TAE_RESULT_OK);
  json.assign(required, '\0');
  assert(TAE_GetPlaybackInfo(engine, json.data(), json.size(), &required) == TAE_RESULT_OK);
  assert(std::strstr(json.data(), "\"dspActive\":true") != nullptr);
  assert(std::strstr(json.data(), "\"replayGainActive\":true") != nullptr);
  assert(std::strstr(json.data(), "\"eqActive\":true") != nullptr);
  assert(std::strstr(json.data(), "\"bitPerfect\":false") != nullptr);

  float spectrum[16] = {};
  size_t written = 0;
  assert(TAE_GetSpectrumData(engine, spectrum, 16, &written) == TAE_RESULT_OK);
  assert(written == 16);

  TAE_DestroyEngine(engine);
  return 0;
}
