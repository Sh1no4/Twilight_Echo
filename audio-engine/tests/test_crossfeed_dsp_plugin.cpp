#include "twilight_audio_dsp_plugin.h"

#include <algorithm>
#include <cmath>
#include <new>
#include <numbers>
#include <string_view>
#include <vector>

namespace {

struct CrossfeedState {
  double strength = 0.35;
  double delayMs = 0.35;
  double cutoffHz = 700.0;
  uint32_t sampleRate = 0;
  uint32_t channels = 0;
  std::vector<float> delayLeft;
  std::vector<float> delayRight;
  size_t delayIndex = 0;
  double lowpassLeft = 0.0;
  double lowpassRight = 0.0;
  double alpha = 0.0;

  void rebuild() {
    if (sampleRate == 0 || channels != 2) return;
    const auto delaySamples = static_cast<size_t>(
        std::max(1.0, std::round(static_cast<double>(sampleRate) * std::clamp(delayMs, 0.05, 2.0) / 1000.0)));
    delayLeft.assign(delaySamples, 0.0f);
    delayRight.assign(delaySamples, 0.0f);
    delayIndex = 0;
    const double cutoff = std::clamp(cutoffHz, 80.0, 4000.0);
    const double dt = 1.0 / static_cast<double>(sampleRate);
    const double rc = 1.0 / (2.0 * std::numbers::pi * cutoff);
    alpha = dt / (rc + dt);
  }
};

tae_dsp_result create(tae_dsp_plugin_handle* out_handle) {
  if (!out_handle) return TAE_DSP_RESULT_ERROR;
  auto* state = new (std::nothrow) CrossfeedState();
  if (!state) return TAE_DSP_RESULT_ERROR;
  *out_handle = state;
  return TAE_DSP_RESULT_OK;
}

void destroy(tae_dsp_plugin_handle handle) {
  delete static_cast<CrossfeedState*>(handle);
}

tae_dsp_result prepare(tae_dsp_plugin_handle handle, const tae_dsp_audio_format* format) {
  auto* state = static_cast<CrossfeedState*>(handle);
  if (!state || !format || format->sample_format != TAE_DSP_SAMPLE_FLOAT32_INTERLEAVED || format->channels != 2) {
    return TAE_DSP_RESULT_ERROR;
  }
  state->sampleRate = format->sample_rate;
  state->channels = format->channels;
  state->rebuild();
  return TAE_DSP_RESULT_OK;
}

tae_dsp_result process(tae_dsp_plugin_handle handle, float* interleaved, uint32_t frames) {
  auto* state = static_cast<CrossfeedState*>(handle);
  if (!state || !interleaved || state->channels != 2 || state->delayLeft.empty()) return TAE_DSP_RESULT_ERROR;
  const double strength = std::clamp(state->strength, 0.0, 1.0);
  const double directGain = 1.0 - 0.08 * strength;
  const double crossGain = 0.38 * strength;
  for (uint32_t frame = 0; frame < frames; ++frame) {
    const size_t index = static_cast<size_t>(frame) * 2;
    const double left = interleaved[index];
    const double right = interleaved[index + 1];
    const double delayedLeft = state->delayLeft[state->delayIndex];
    const double delayedRight = state->delayRight[state->delayIndex];
    state->delayLeft[state->delayIndex] = static_cast<float>(left);
    state->delayRight[state->delayIndex] = static_cast<float>(right);
    state->delayIndex = (state->delayIndex + 1) % state->delayLeft.size();
    state->lowpassLeft += state->alpha * (delayedLeft - state->lowpassLeft);
    state->lowpassRight += state->alpha * (delayedRight - state->lowpassRight);
    interleaved[index] = static_cast<float>(std::clamp(left * directGain + state->lowpassRight * crossGain, -4.0, 4.0));
    interleaved[index + 1] =
        static_cast<float>(std::clamp(right * directGain + state->lowpassLeft * crossGain, -4.0, 4.0));
  }
  return TAE_DSP_RESULT_OK;
}

tae_dsp_result setParam(tae_dsp_plugin_handle handle, const char* id, double value) {
  auto* state = static_cast<CrossfeedState*>(handle);
  if (!state || !id) return TAE_DSP_RESULT_ERROR;
  const std::string_view key(id);
  if (key == "strength") state->strength = std::clamp(value, 0.0, 1.0);
  else if (key == "delayMs") state->delayMs = std::clamp(value, 0.05, 2.0);
  else if (key == "cutoffHz") state->cutoffHz = std::clamp(value, 80.0, 4000.0);
  else return TAE_DSP_RESULT_ERROR;
  if (state->sampleRate > 0) state->rebuild();
  return TAE_DSP_RESULT_OK;
}

tae_dsp_result reset(tae_dsp_plugin_handle handle) {
  auto* state = static_cast<CrossfeedState*>(handle);
  if (!state) return TAE_DSP_RESULT_ERROR;
  std::fill(state->delayLeft.begin(), state->delayLeft.end(), 0.0f);
  std::fill(state->delayRight.begin(), state->delayRight.end(), 0.0f);
  state->delayIndex = 0;
  state->lowpassLeft = 0.0;
  state->lowpassRight = 0.0;
  return TAE_DSP_RESULT_OK;
}

const tae_dsp_parameter_info kParameters[] = {
    {"strength", "Strength", TAE_DSP_PARAMETER_FLOAT, 0.35, 0.0, 1.0, 0.01, "", nullptr},
    {"delayMs", "Delay", TAE_DSP_PARAMETER_FLOAT, 0.35, 0.05, 2.0, 0.01, "ms", nullptr},
    {"cutoffHz", "Cutoff", TAE_DSP_PARAMETER_FLOAT, 700.0, 80.0, 4000.0, 1.0, "Hz", nullptr}};

const tae_dsp_plugin_info kInfo = {
    sizeof(tae_dsp_plugin_info),
    TAE_DSP_PLUGIN_ABI_VERSION,
    "com.twilightecho.dsp.crossfeed",
    "Twilight Crossfeed",
    "1.0.0",
    3,
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
