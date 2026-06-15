#include "twilight_audio_dsp_plugin.h"

#include <algorithm>
#include <new>
#include <string>

namespace {

struct GainState {
  double gain = 0.5;
  uint32_t channels = 0;
};

tae_dsp_result create(tae_dsp_plugin_handle* out_handle) {
  if (!out_handle) return TAE_DSP_RESULT_ERROR;
  auto* state = new (std::nothrow) GainState();
  if (!state) return TAE_DSP_RESULT_ERROR;
  *out_handle = state;
  return TAE_DSP_RESULT_OK;
}

void destroy(tae_dsp_plugin_handle handle) {
  delete static_cast<GainState*>(handle);
}

tae_dsp_result prepare(tae_dsp_plugin_handle handle, const tae_dsp_audio_format* format) {
  if (!handle || !format || format->sample_format != TAE_DSP_SAMPLE_FLOAT32_INTERLEAVED) {
    return TAE_DSP_RESULT_ERROR;
  }
  static_cast<GainState*>(handle)->channels = format->channels;
  return format->sample_rate > 0 && format->channels > 0 ? TAE_DSP_RESULT_OK : TAE_DSP_RESULT_ERROR;
}

tae_dsp_result process(tae_dsp_plugin_handle handle, float* interleaved, uint32_t frames) {
  auto* state = static_cast<GainState*>(handle);
  if (!state || !interleaved || state->channels == 0) return TAE_DSP_RESULT_ERROR;
  const size_t samples = static_cast<size_t>(frames) * static_cast<size_t>(state->channels);
  for (size_t index = 0; index < samples; ++index) {
    interleaved[index] = static_cast<float>(
        std::clamp(static_cast<double>(interleaved[index]) * state->gain, -1.0, 1.0));
  }
  return TAE_DSP_RESULT_OK;
}

tae_dsp_result setParam(tae_dsp_plugin_handle handle, const char* id, double value) {
  auto* state = static_cast<GainState*>(handle);
  if (!state || !id) return TAE_DSP_RESULT_ERROR;
  if (std::string(id) != "gain") return TAE_DSP_RESULT_ERROR;
  state->gain = std::clamp(value, 0.0, 2.0);
  return TAE_DSP_RESULT_OK;
}

tae_dsp_result reset(tae_dsp_plugin_handle) {
  return TAE_DSP_RESULT_OK;
}

const tae_dsp_parameter_info kParameters[] = {
    {"gain", "Gain", TAE_DSP_PARAMETER_FLOAT, 0.5, 0.0, 2.0, 0.01, "x", nullptr}};

const tae_dsp_plugin_info kInfo = {
    sizeof(tae_dsp_plugin_info),
    TAE_DSP_PLUGIN_ABI_VERSION,
    "com.twilightecho.test.gain",
    "Test Gain",
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
