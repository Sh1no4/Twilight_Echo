#include "twilight_audio_dsp_plugin.h"

#include <chrono>
#include <new>
#include <thread>

namespace {

struct FaultState {
  double mode = 0.0;
  uint32_t channels = 0;
};

tae_dsp_result create(tae_dsp_plugin_handle* out_handle) {
  if (!out_handle) return TAE_DSP_RESULT_ERROR;
  auto* state = new (std::nothrow) FaultState();
  if (!state) return TAE_DSP_RESULT_ERROR;
  *out_handle = state;
  return TAE_DSP_RESULT_OK;
}

void destroy(tae_dsp_plugin_handle handle) {
  delete static_cast<FaultState*>(handle);
}

tae_dsp_result prepare(tae_dsp_plugin_handle handle, const tae_dsp_audio_format* format) {
  auto* state = static_cast<FaultState*>(handle);
  if (!state || !format) return TAE_DSP_RESULT_ERROR;
  state->channels = format->channels;
  return state->mode == 3.0 ? TAE_DSP_RESULT_ERROR : TAE_DSP_RESULT_OK;
}

tae_dsp_result process(tae_dsp_plugin_handle handle, float*, uint32_t) {
  auto* state = static_cast<FaultState*>(handle);
  if (!state) return TAE_DSP_RESULT_ERROR;
  if (state->mode == 1.0) return TAE_DSP_RESULT_ERROR;
  if (state->mode == 2.0) {
    std::this_thread::sleep_for(std::chrono::milliseconds(8));
  }
  return TAE_DSP_RESULT_OK;
}

tae_dsp_result setParam(tae_dsp_plugin_handle handle, const char* id, double value) {
  auto* state = static_cast<FaultState*>(handle);
  if (!state || !id) return TAE_DSP_RESULT_ERROR;
  if (id[0] != 'm') return TAE_DSP_RESULT_ERROR;
  state->mode = value;
  return TAE_DSP_RESULT_OK;
}

tae_dsp_result reset(tae_dsp_plugin_handle) {
  return TAE_DSP_RESULT_OK;
}

const tae_dsp_parameter_info kParameters[] = {
    {"mode", "Fault Mode", TAE_DSP_PARAMETER_ENUM, 0.0, 0.0, 3.0, 1.0, "",
     "[\"ok\",\"process-error\",\"slow\",\"prepare-error\"]"}};

const tae_dsp_plugin_info kInfo = {
    sizeof(tae_dsp_plugin_info),
    TAE_DSP_PLUGIN_ABI_VERSION,
    "com.twilightecho.test.fault",
    "Test Fault",
    "1.0.0",
    1,
    kParameters,
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
