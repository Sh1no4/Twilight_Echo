#pragma once

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#  define TAE_DSP_EXPORT __declspec(dllexport)
#else
#  define TAE_DSP_EXPORT __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define TAE_DSP_PLUGIN_ABI_VERSION 1u
#define TAE_DSP_PLUGIN_ABI_VERSION_V2 2u

typedef void* tae_dsp_plugin_handle;

typedef enum tae_dsp_result {
  TAE_DSP_RESULT_OK = 0,
  TAE_DSP_RESULT_BYPASS = 1,
  TAE_DSP_RESULT_ERROR = 2
} tae_dsp_result;

typedef enum tae_dsp_sample_format {
  TAE_DSP_SAMPLE_FLOAT32_INTERLEAVED = 1
} tae_dsp_sample_format;

typedef enum tae_dsp_parameter_type {
  TAE_DSP_PARAMETER_BOOL = 1,
  TAE_DSP_PARAMETER_INT = 2,
  TAE_DSP_PARAMETER_FLOAT = 3,
  TAE_DSP_PARAMETER_ENUM = 4
} tae_dsp_parameter_type;

typedef struct tae_dsp_audio_format {
  uint32_t sample_rate;
  uint32_t channels;
  tae_dsp_sample_format sample_format;
} tae_dsp_audio_format;

typedef struct tae_dsp_parameter_info {
  const char* id;
  const char* name;
  tae_dsp_parameter_type type;
  double default_value;
  double min_value;
  double max_value;
  double step;
  const char* unit;
  const char* enum_values_json;
} tae_dsp_parameter_info;

typedef tae_dsp_result (*tae_dsp_create_fn)(tae_dsp_plugin_handle* out_handle);
typedef void (*tae_dsp_destroy_fn)(tae_dsp_plugin_handle handle);
typedef tae_dsp_result (*tae_dsp_prepare_fn)(tae_dsp_plugin_handle handle, const tae_dsp_audio_format* format);
typedef tae_dsp_result (*tae_dsp_process_fn)(tae_dsp_plugin_handle handle, float* interleaved, uint32_t frames);
typedef tae_dsp_result (*tae_dsp_set_param_fn)(tae_dsp_plugin_handle handle, const char* id, double value);
typedef tae_dsp_result (*tae_dsp_reset_fn)(tae_dsp_plugin_handle handle);

typedef struct tae_dsp_plugin_info {
  uint32_t struct_size;
  uint32_t tae_plugin_abi_version;
  const char* id;
  const char* name;
  const char* version;
  uint32_t parameter_count;
  const tae_dsp_parameter_info* parameters;
  tae_dsp_create_fn create;
  tae_dsp_destroy_fn destroy;
  tae_dsp_prepare_fn prepare;
  tae_dsp_process_fn process;
  tae_dsp_set_param_fn set_param;
  tae_dsp_reset_fn reset;
} tae_dsp_plugin_info;

typedef enum tae_dsp_channel_layout_mask {
  TAE_DSP_CHANNEL_LAYOUT_MONO = 1u << 0,
  TAE_DSP_CHANNEL_LAYOUT_STEREO = 1u << 1,
  TAE_DSP_CHANNEL_LAYOUT_5_1 = 1u << 2,
  TAE_DSP_CHANNEL_LAYOUT_7_1 = 1u << 3
} tae_dsp_channel_layout_mask;

typedef tae_dsp_result (*tae_dsp_flush_fn)(
    tae_dsp_plugin_handle handle,
    float* interleaved,
    uint32_t* inout_frames);

/*
 * ABI v2 appends fields after the v1 prefix. Hosts must first inspect
 * struct_size before accessing these fields. ABI v1 remains binary stable.
 */
typedef struct tae_dsp_plugin_info_v2 {
  uint32_t struct_size;
  uint32_t tae_plugin_abi_version;
  const char* id;
  const char* name;
  const char* version;
  uint32_t parameter_count;
  const tae_dsp_parameter_info* parameters;
  tae_dsp_create_fn create;
  tae_dsp_destroy_fn destroy;
  tae_dsp_prepare_fn prepare;
  tae_dsp_process_fn process;
  tae_dsp_set_param_fn set_param;
  tae_dsp_reset_fn reset;
  uint32_t supported_channel_layouts;
  uint32_t minimum_sample_rate;
  uint32_t maximum_sample_rate;
  uint32_t latency_frames;
  uint32_t tail_frames;
  tae_dsp_flush_fn flush;
} tae_dsp_plugin_info_v2;

typedef const tae_dsp_plugin_info* (*tae_plugin_get_info_fn)(void);

TAE_DSP_EXPORT const tae_dsp_plugin_info* tae_plugin_get_info(void);

#ifdef __cplusplus
}
#endif
