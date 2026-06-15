#include "twilight_audio_dsp_plugin.h"

namespace {

const tae_dsp_plugin_info kInfo = {
    sizeof(tae_dsp_plugin_info),
    TAE_DSP_PLUGIN_ABI_VERSION + 1,
    "com.twilightecho.test.bad-abi",
    "Bad ABI",
    "1.0.0",
    0,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    nullptr};

}  // namespace

extern "C" TAE_DSP_EXPORT const tae_dsp_plugin_info* tae_plugin_get_info(void) {
  return &kInfo;
}
