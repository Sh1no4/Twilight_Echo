#include "twilight_audio_dsp_plugin.h"

namespace {

tae_dsp_result create(tae_dsp_plugin_handle*) {
  return TAE_DSP_RESULT_ERROR;
}

void destroy(tae_dsp_plugin_handle) {}
tae_dsp_result prepare(tae_dsp_plugin_handle, const tae_dsp_audio_format*) { return TAE_DSP_RESULT_OK; }
tae_dsp_result process(tae_dsp_plugin_handle, float*, uint32_t) { return TAE_DSP_RESULT_OK; }
tae_dsp_result setParam(tae_dsp_plugin_handle, const char*, double) { return TAE_DSP_RESULT_OK; }
tae_dsp_result reset(tae_dsp_plugin_handle) { return TAE_DSP_RESULT_OK; }

const tae_dsp_parameter_info kParameters[] = {
    {nullptr, "Broken", TAE_DSP_PARAMETER_FLOAT, 0.0, 0.0, 1.0, 0.01, "", nullptr}};

const tae_dsp_plugin_info kInfo = {
    sizeof(tae_dsp_plugin_info),
    TAE_DSP_PLUGIN_ABI_VERSION,
    "com.twilightecho.test.invalid-param",
    "Invalid Param",
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
