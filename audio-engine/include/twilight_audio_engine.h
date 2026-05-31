#pragma once

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#  if defined(TAE_BUILDING_LIBRARY)
#    define TAE_API __declspec(dllexport)
#  else
#    define TAE_API __declspec(dllimport)
#  endif
#else
#  define TAE_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef void* TAE_EngineHandle;

typedef enum TAE_Result {
  TAE_RESULT_OK = 0,
  TAE_RESULT_INVALID_ARGUMENT = 1,
  TAE_RESULT_NOT_INITIALIZED = 2,
  TAE_RESULT_BACKEND_UNAVAILABLE = 3,
  TAE_RESULT_INTERNAL_ERROR = 4
} TAE_Result;

typedef void (*TAE_EventCallback)(const char* event_type, const char* payload_json, void* user_data);

TAE_API TAE_Result TAE_CreateEngine(TAE_EngineHandle* out_engine);
TAE_API void TAE_DestroyEngine(TAE_EngineHandle engine);
TAE_API TAE_Result TAE_SetEventCallback(TAE_EngineHandle engine, TAE_EventCallback callback, void* user_data);

TAE_API TAE_Result TAE_Play(TAE_EngineHandle engine, const char* source, double start_time_seconds);
TAE_API TAE_Result TAE_Pause(TAE_EngineHandle engine);
TAE_API TAE_Result TAE_Stop(TAE_EngineHandle engine);
TAE_API TAE_Result TAE_Seek(TAE_EngineHandle engine, double position_seconds);
TAE_API TAE_Result TAE_SetVolume(TAE_EngineHandle engine, double volume);
TAE_API TAE_Result TAE_SetOutputDevice(TAE_EngineHandle engine, const char* device_id);
TAE_API TAE_Result TAE_SetOutputBackend(TAE_EngineHandle engine, const char* backend_id);

TAE_API TAE_Result TAE_LoadQueue(TAE_EngineHandle engine, const char* queue_json, int start_index);
TAE_API TAE_Result TAE_AddToQueue(TAE_EngineHandle engine, const char* item_json);
TAE_API TAE_Result TAE_RemoveFromQueue(TAE_EngineHandle engine, int index);
TAE_API TAE_Result TAE_Next(TAE_EngineHandle engine);
TAE_API TAE_Result TAE_Previous(TAE_EngineHandle engine);
TAE_API TAE_Result TAE_SetPlayMode(TAE_EngineHandle engine, const char* mode);
TAE_API TAE_Result TAE_GetQueue(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size);
TAE_API TAE_Result TAE_GetUpcomingTrack(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size);

TAE_API TAE_Result TAE_SetDspConfig(TAE_EngineHandle engine, const char* dsp_config_json);
TAE_API TAE_Result TAE_GetDspConfig(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size);
TAE_API TAE_Result TAE_EnumerateDevices(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size);
TAE_API TAE_Result TAE_EnumerateBackends(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size);

TAE_API TAE_Result TAE_GetPlaybackInfo(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size);
TAE_API TAE_Result TAE_GetSpectrumData(TAE_EngineHandle engine, float* buffer, size_t point_count, size_t* written_count);
TAE_API const char* TAE_GetVersion(void);

#ifdef __cplusplus
}
#endif
