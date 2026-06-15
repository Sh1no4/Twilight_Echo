#include "twilight_audio_dsp_plugin.h"

#include <new>

namespace {

struct CrashState {
  uint32_t channels = 0;
};

tae_dsp_result create(tae_dsp_plugin_handle* out_handle) {
  if (!out_handle) return TAE_DSP_RESULT_ERROR;
  auto* state = new (std::nothrow) CrashState();
  if (!state) return TAE_DSP_RESULT_ERROR;
  *out_handle = state;
  return TAE_DSP_RESULT_OK;
}

void destroy(tae_dsp_plugin_handle handle) {
  delete static_cast<CrashState*>(handle);
}

tae_dsp_result prepare(tae_dsp_plugin_handle handle, const tae_dsp_audio_format* format) {
  auto* state = static_cast<CrashState*>(handle);
  if (!state || !format) return TAE_DSP_RESULT_ERROR;
  state->channels = format->channels;
  return TAE_DSP_RESULT_OK;
}

tae_dsp_result process(tae_dsp_plugin_handle, float*, uint32_t) {
  volatile int* crash = nullptr;
  *crash = 1;
  return TAE_DSP_RESULT_ERROR;
}

tae_dsp_result setParam(tae_dsp_plugin_handle, const char*, double) {
  return TAE_DSP_RESULT_OK;
}

tae_dsp_result reset(tae_dsp_plugin_handle) {
  return TAE_DSP_RESULT_OK;
}

const tae_dsp_plugin_info kInfo = {
    sizeof(tae_dsp_plugin_info),
    TAE_DSP_PLUGIN_ABI_VERSION,
    "com.twilightecho.test.crash",
    "Crash Fixture",
    "1.0.0",
    0,
    nullptr,
    create,
    destroy,
    prepare,
    process,
    setParam,
    reset};

}  // namespace

extern "C" TAE_DSP_EXPORT const tae_dsp_plugin_info* tae_plugin_get_info(void) {
  return &kInfo;
}
