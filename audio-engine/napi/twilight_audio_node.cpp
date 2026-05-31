#include "twilight_audio_engine.h"

#include <node_api.h>

#include <mutex>
#include <string>
#include <vector>

namespace {

TAE_EngineHandle g_engine = nullptr;
std::mutex g_eventMutex;
std::string g_lastError;

std::string unescapeJsonString(const std::string& value) {
  std::string out;
  out.reserve(value.size());
  bool escaped = false;
  for (char ch : value) {
    if (escaped) {
      switch (ch) {
        case 'n':
          out += '\n';
          break;
        case 'r':
          out += '\r';
          break;
        case 't':
          out += '\t';
          break;
        default:
          out += ch;
          break;
      }
      escaped = false;
    } else if (ch == '\\') {
      escaped = true;
    } else {
      out += ch;
    }
  }
  return out;
}

std::string errorMessageFromPayload(const char* payload) {
  if (!payload) return {};
  const std::string json(payload);
  const std::string key = "\"message\":\"";
  const size_t start = json.find(key);
  if (start == std::string::npos) return json;
  const size_t valueStart = start + key.size();
  size_t end = valueStart;
  bool escaped = false;
  for (; end < json.size(); ++end) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (json[end] == '\\') {
      escaped = true;
      continue;
    }
    if (json[end] == '"') break;
  }
  return unescapeJsonString(json.substr(valueStart, end - valueStart));
}

void eventCallback(const char* eventType, const char* payloadJson, void*) {
  if (!eventType || std::string(eventType) != "error") return;
  std::lock_guard lock(g_eventMutex);
  g_lastError = errorMessageFromPayload(payloadJson);
}

void clearLastError() {
  std::lock_guard lock(g_eventMutex);
  g_lastError.clear();
}

std::string consumeLastError() {
  std::lock_guard lock(g_eventMutex);
  std::string out = g_lastError;
  g_lastError.clear();
  return out;
}

napi_value makeUndefined(napi_env env) {
  napi_value value;
  napi_get_undefined(env, &value);
  return value;
}

std::string getStringArg(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);
  std::vector<char> buffer(length + 1, '\0');
  napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length);
  return std::string(buffer.data(), length);
}

double getNumberArg(napi_env env, napi_value value, double fallback) {
  double out = fallback;
  napi_get_value_double(env, value, &out);
  return out;
}

void ensureEngine() {
  if (!g_engine) {
    if (TAE_CreateEngine(&g_engine) == TAE_RESULT_OK && g_engine) {
      TAE_SetEventCallback(g_engine, eventCallback, nullptr);
    }
  }
}

napi_value throwOnError(napi_env env, TAE_Result result) {
  if (result != TAE_RESULT_OK) {
    std::string message = consumeLastError();
    if (message.empty()) {
      message = "原生音频引擎命令失败，结果码：" + std::to_string(static_cast<int>(result));
    }
    napi_throw_error(env, nullptr, message.c_str());
  }
  return makeUndefined(env);
}

napi_value readJson(napi_env env, TAE_Result (*fn)(TAE_EngineHandle, char*, size_t, size_t*)) {
  ensureEngine();
  size_t required = 0;
  fn(g_engine, nullptr, 0, &required);
  std::vector<char> buffer(required == 0 ? 1 : required);
  const TAE_Result result = fn(g_engine, buffer.data(), buffer.size(), &required);
  if (result != TAE_RESULT_OK) return throwOnError(env, result);
  napi_value json;
  napi_create_string_utf8(env, buffer.data(), NAPI_AUTO_LENGTH, &json);
  return json;
}

napi_value Play(napi_env env, napi_callback_info info) {
  ensureEngine();
  clearLastError();
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "Play requires a source");
    return makeUndefined(env);
  }
  const std::string source = getStringArg(env, argv[0]);
  const double start = argc > 1 ? getNumberArg(env, argv[1], 0.0) : 0.0;
  return throwOnError(env, TAE_Play(g_engine, source.c_str(), start));
}

napi_value Pause(napi_env env, napi_callback_info) {
  ensureEngine();
  clearLastError();
  return throwOnError(env, TAE_Pause(g_engine));
}

napi_value Stop(napi_env env, napi_callback_info) {
  ensureEngine();
  clearLastError();
  return throwOnError(env, TAE_Stop(g_engine));
}

napi_value Seek(napi_env env, napi_callback_info info) {
  ensureEngine();
  clearLastError();
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  return throwOnError(env, TAE_Seek(g_engine, argc > 0 ? getNumberArg(env, argv[0], 0.0) : 0.0));
}

napi_value SetVolume(napi_env env, napi_callback_info info) {
  ensureEngine();
  clearLastError();
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  return throwOnError(env, TAE_SetVolume(g_engine, argc > 0 ? getNumberArg(env, argv[0], 1.0) : 1.0));
}

napi_value SetOutputDevice(napi_env env, napi_callback_info info) {
  ensureEngine();
  clearLastError();
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  const std::string device = argc > 0 ? getStringArg(env, argv[0]) : "auto";
  return throwOnError(env, TAE_SetOutputDevice(g_engine, device.c_str()));
}

napi_value SetOutputBackend(napi_env env, napi_callback_info info) {
  ensureEngine();
  clearLastError();
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  const std::string backend = argc > 0 ? getStringArg(env, argv[0]) : "wasapi";
  return throwOnError(env, TAE_SetOutputBackend(g_engine, backend.c_str()));
}

napi_value LoadQueue(napi_env env, napi_callback_info info) {
  ensureEngine();
  clearLastError();
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  const std::string queue = argc > 0 ? getStringArg(env, argv[0]) : "[]";
  const int start = argc > 1 ? static_cast<int>(getNumberArg(env, argv[1], 0.0)) : 0;
  return throwOnError(env, TAE_LoadQueue(g_engine, queue.c_str(), start));
}

napi_value Next(napi_env env, napi_callback_info) {
  ensureEngine();
  clearLastError();
  return throwOnError(env, TAE_Next(g_engine));
}

napi_value Previous(napi_env env, napi_callback_info) {
  ensureEngine();
  clearLastError();
  return throwOnError(env, TAE_Previous(g_engine));
}

napi_value SetDspConfig(napi_env env, napi_callback_info info) {
  ensureEngine();
  clearLastError();
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  const std::string json = argc > 0 ? getStringArg(env, argv[0]) : "{}";
  return throwOnError(env, TAE_SetDspConfig(g_engine, json.c_str()));
}

napi_value GetPlaybackInfo(napi_env env, napi_callback_info) {
  return readJson(env, TAE_GetPlaybackInfo);
}

napi_value GetQueue(napi_env env, napi_callback_info) {
  return readJson(env, TAE_GetQueue);
}

napi_value GetDspConfig(napi_env env, napi_callback_info) {
  return readJson(env, TAE_GetDspConfig);
}

napi_value EnumerateDevices(napi_env env, napi_callback_info) {
  return readJson(env, TAE_EnumerateDevices);
}

napi_value EnumerateBackends(napi_env env, napi_callback_info) {
  return readJson(env, TAE_EnumerateBackends);
}

napi_value GetSpectrumData(napi_env env, napi_callback_info info) {
  ensureEngine();
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  const size_t points = argc > 0 ? static_cast<size_t>(getNumberArg(env, argv[0], 64.0)) : 64;
  std::vector<float> spectrum(points);
  size_t written = 0;
  TAE_GetSpectrumData(g_engine, spectrum.data(), spectrum.size(), &written);
  napi_value array;
  napi_create_array_with_length(env, written, &array);
  for (size_t i = 0; i < written; ++i) {
    napi_value value;
    napi_create_double(env, spectrum[i], &value);
    napi_set_element(env, array, static_cast<uint32_t>(i), value);
  }
  return array;
}

void cleanup(void*) {
  if (g_engine) {
    TAE_DestroyEngine(g_engine);
    g_engine = nullptr;
  }
}

void define(napi_env env, napi_value exports, const char* name, napi_callback callback) {
  napi_value fn;
  napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, nullptr, &fn);
  napi_set_named_property(env, exports, name, fn);
}

napi_value Init(napi_env env, napi_value exports) {
  napi_add_env_cleanup_hook(env, cleanup, nullptr);
  define(env, exports, "Play", Play);
  define(env, exports, "Pause", Pause);
  define(env, exports, "Stop", Stop);
  define(env, exports, "Seek", Seek);
  define(env, exports, "SetVolume", SetVolume);
  define(env, exports, "SetOutputDevice", SetOutputDevice);
  define(env, exports, "SetOutputBackend", SetOutputBackend);
  define(env, exports, "LoadQueue", LoadQueue);
  define(env, exports, "Next", Next);
  define(env, exports, "Previous", Previous);
  define(env, exports, "SetDspConfig", SetDspConfig);
  define(env, exports, "GetPlaybackInfo", GetPlaybackInfo);
  define(env, exports, "GetQueue", GetQueue);
  define(env, exports, "GetDspConfig", GetDspConfig);
  define(env, exports, "EnumerateDevices", EnumerateDevices);
  define(env, exports, "EnumerateBackends", EnumerateBackends);
  define(env, exports, "GetSpectrumData", GetSpectrumData);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
