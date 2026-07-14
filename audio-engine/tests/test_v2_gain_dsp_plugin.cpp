#include "twilight_audio_dsp_plugin.h"

#include <algorithm>
#include <new>

namespace {

struct State {
  uint32_t channels = 0;
};

tae_dsp_result create(tae_dsp_plugin_handle* outHandle) {
  if (!outHandle) return TAE_DSP_RESULT_ERROR;
  auto* state = new (std::nothrow) State();
  if (!state) return TAE_DSP_RESULT_ERROR;
  *outHandle = state;
  return TAE_DSP_RESULT_OK;
}

void destroy(tae_dsp_plugin_handle handle) {
  delete static_cast<State*>(handle);
}

tae_dsp_result prepare(tae_dsp_plugin_handle handle, const tae_dsp_audio_format* format) {
  if (!handle || !format || format->sample_format != TAE_DSP_SAMPLE_FLOAT32_INTERLEAVED) {
    return TAE_DSP_RESULT_ERROR;
  }
  static_cast<State*>(handle)->channels = format->channels;
  return format->sample_rate >= 44100 && format->channels > 0 ? TAE_DSP_RESULT_OK : TAE_DSP_RESULT_ERROR;
}

tae_dsp_result process(tae_dsp_plugin_handle handle, float* interleaved, uint32_t frames) {
  auto* state = static_cast<State*>(handle);
  if (!state || !interleaved || state->channels == 0) return TAE_DSP_RESULT_ERROR;
  const size_t samples = static_cast<size_t>(frames) * state->channels;
  for (size_t index = 0; index < samples; ++index) {
    interleaved[index] = static_cast<float>(std::clamp(interleaved[index] * 0.5f, -1.0f, 1.0f));
  }
  return TAE_DSP_RESULT_OK;
}

tae_dsp_result setParam(tae_dsp_plugin_handle, const char*, double) {
  return TAE_DSP_RESULT_OK;
}

tae_dsp_result reset(tae_dsp_plugin_handle) {
  return TAE_DSP_RESULT_OK;
}

const tae_dsp_plugin_info_v2 kInfo = {
    sizeof(tae_dsp_plugin_info_v2),
    TAE_DSP_PLUGIN_ABI_VERSION_V2,
    "com.twilightecho.test.v2-gain",
    "Test V2 Gain",
    "2.0.0",
    0,
    nullptr,
    create,
    destroy,
    prepare,
    process,
    setParam,
    reset,
    TAE_DSP_CHANNEL_LAYOUT_MONO | TAE_DSP_CHANNEL_LAYOUT_STEREO,
    44100,
    192000,
    32,
    64,
    nullptr};

}  // namespace

extern "C" TAE_DSP_EXPORT const tae_dsp_plugin_info* tae_plugin_get_info(void) {
  return reinterpret_cast<const tae_dsp_plugin_info*>(&kInfo);
}
