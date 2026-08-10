/*
 * Windows-only dynamic N-API symbol loader for the SMTC Node addon.
 *
 * The addon must load inside Electron's main process without linking against
 * node.lib. Every N-API entry point below is resolved from the host process
 * (electron.exe / node.exe) at first use, matching the audio-engine addon.
 */

#if defined(_WIN32)

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>

#include <node_api.h>

namespace {

FARPROC resolveNodeApiSymbol(const char* name) {
  if (!name) return nullptr;

  if (HMODULE currentProcess = GetModuleHandleW(nullptr)) {
    if (FARPROC proc = GetProcAddress(currentProcess, name)) return proc;
  }

  const wchar_t* fallbackModules[] = {
      L"node.dll",
      L"node.exe",
      L"electron.exe",
  };
  for (const wchar_t* moduleName : fallbackModules) {
    if (HMODULE module = GetModuleHandleW(moduleName)) {
      if (FARPROC proc = GetProcAddress(module, name)) return proc;
    }
  }

  return nullptr;
}

template <typename Fn>
Fn loadNodeApi(const char* name) {
  return reinterpret_cast<Fn>(resolveNodeApiSymbol(name));
}

}  // namespace

extern "C" napi_status NAPI_CDECL napi_get_undefined(napi_env env,
                                                     napi_value* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, napi_value*);
  static Fn fn = loadNodeApi<Fn>("napi_get_undefined");
  return fn ? fn(env, result) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_get_boolean(napi_env env, bool value,
                                                   napi_value* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, bool, napi_value*);
  static Fn fn = loadNodeApi<Fn>("napi_get_boolean");
  return fn ? fn(env, value, result) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_create_object(napi_env env,
                                                     napi_value* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, napi_value*);
  static Fn fn = loadNodeApi<Fn>("napi_create_object");
  return fn ? fn(env, result) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_create_double(napi_env env,
                                                     double value,
                                                     napi_value* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, double, napi_value*);
  static Fn fn = loadNodeApi<Fn>("napi_create_double");
  return fn ? fn(env, value, result) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_create_string_utf8(
    napi_env env, const char* str, size_t length, napi_value* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, const char*, size_t,
                                      napi_value*);
  static Fn fn = loadNodeApi<Fn>("napi_create_string_utf8");
  return fn ? fn(env, str, length, result) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_create_function(
    napi_env env, const char* utf8name, size_t length, napi_callback cb,
    void* data, napi_value* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, const char*, size_t,
                                      napi_callback, void*, napi_value*);
  static Fn fn = loadNodeApi<Fn>("napi_create_function");
  return fn ? fn(env, utf8name, length, cb, data, result)
            : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_get_cb_info(
    napi_env env, napi_callback_info cbinfo, size_t* argc, napi_value* argv,
    napi_value* thisArg, void** data) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, napi_callback_info, size_t*,
                                      napi_value*, napi_value*, void**);
  static Fn fn = loadNodeApi<Fn>("napi_get_cb_info");
  return fn ? fn(env, cbinfo, argc, argv, thisArg, data)
            : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_get_value_double(
    napi_env env, napi_value value, double* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, napi_value, double*);
  static Fn fn = loadNodeApi<Fn>("napi_get_value_double");
  return fn ? fn(env, value, result) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_get_value_bool(
    napi_env env, napi_value value, bool* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, napi_value, bool*);
  static Fn fn = loadNodeApi<Fn>("napi_get_value_bool");
  return fn ? fn(env, value, result) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_get_value_string_utf8(
    napi_env env, napi_value value, char* buffer, size_t bufferSize,
    size_t* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, napi_value, char*, size_t,
                                      size_t*);
  static Fn fn = loadNodeApi<Fn>("napi_get_value_string_utf8");
  return fn ? fn(env, value, buffer, bufferSize, result)
            : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_set_named_property(
    napi_env env, napi_value object, const char* utf8name, napi_value value) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, napi_value, const char*,
                                      napi_value);
  static Fn fn = loadNodeApi<Fn>("napi_set_named_property");
  return fn ? fn(env, object, utf8name, value) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_has_named_property(
    napi_env env, napi_value object, const char* utf8name, bool* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, napi_value, const char*,
                                      bool*);
  static Fn fn = loadNodeApi<Fn>("napi_has_named_property");
  return fn ? fn(env, object, utf8name, result) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_get_named_property(
    napi_env env, napi_value object, const char* utf8name, napi_value* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, napi_value, const char*,
                                      napi_value*);
  static Fn fn = loadNodeApi<Fn>("napi_get_named_property");
  return fn ? fn(env, object, utf8name, result) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_throw_error(napi_env env,
                                                   const char* code,
                                                   const char* msg) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, const char*, const char*);
  static Fn fn = loadNodeApi<Fn>("napi_throw_error");
  return fn ? fn(env, code, msg) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_call_function(
    napi_env env, napi_value recv, napi_value func, size_t argc,
    const napi_value* argv, napi_value* result) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, napi_value, napi_value,
                                      size_t, const napi_value*, napi_value*);
  static Fn fn = loadNodeApi<Fn>("napi_call_function");
  return fn ? fn(env, recv, func, argc, argv, result) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_add_env_cleanup_hook(
    node_api_basic_env env, napi_cleanup_hook fun, void* arg) {
  using Fn = napi_status(NAPI_CDECL*)(node_api_basic_env, napi_cleanup_hook,
                                      void*);
  static Fn fn = loadNodeApi<Fn>("napi_add_env_cleanup_hook");
  return fn ? fn(env, fun, arg) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_create_threadsafe_function(
    napi_env env, napi_value func, napi_value async_resource,
    napi_value async_resource_name, size_t max_queue_size,
    size_t initial_thread_count, void* thread_finalize_data,
    napi_finalize thread_finalize_cb, void* context,
    napi_threadsafe_function_call_js call_js_cb,
    napi_threadsafe_function* result) {
  using Fn = napi_status(NAPI_CDECL*)(
      napi_env, napi_value, napi_value, napi_value, size_t, size_t, void*,
      napi_finalize, void*, napi_threadsafe_function_call_js,
      napi_threadsafe_function*);
  static Fn fn = loadNodeApi<Fn>("napi_create_threadsafe_function");
  return fn ? fn(env, func, async_resource, async_resource_name,
                 max_queue_size, initial_thread_count, thread_finalize_data,
                 thread_finalize_cb, context, call_js_cb, result)
            : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_call_threadsafe_function(
    napi_threadsafe_function func, void* data,
    napi_threadsafe_function_call_mode is_blocking) {
  using Fn = napi_status(NAPI_CDECL*)(napi_threadsafe_function, void*,
                                      napi_threadsafe_function_call_mode);
  static Fn fn = loadNodeApi<Fn>("napi_call_threadsafe_function");
  return fn ? fn(func, data, is_blocking) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_release_threadsafe_function(
    napi_threadsafe_function func, napi_threadsafe_function_release_mode mode) {
  using Fn = napi_status(NAPI_CDECL*)(napi_threadsafe_function,
                                      napi_threadsafe_function_release_mode);
  static Fn fn = loadNodeApi<Fn>("napi_release_threadsafe_function");
  return fn ? fn(func, mode) : napi_generic_failure;
}

extern "C" napi_status NAPI_CDECL napi_unref_threadsafe_function(
    node_api_basic_env env, napi_threadsafe_function func) {
  using Fn = napi_status(NAPI_CDECL*)(napi_env, napi_threadsafe_function);
  static Fn fn = loadNodeApi<Fn>("napi_unref_threadsafe_function");
  return fn ? fn(env, func) : napi_generic_failure;
}

#endif  // defined(_WIN32)

