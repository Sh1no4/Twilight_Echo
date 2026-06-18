#pragma once

#include "IAlsaHost.h"

#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
#include <alsa/asoundlib.h>
#endif

namespace twilight::audio {

class RealAlsaHost final : public IAlsaHost {
 public:
  RealAlsaHost() = default;
  ~RealAlsaHost() override;

  int pcmOpen(const std::string& device, bool playback) override;
  int close() override;
  int drain() override;
  int drop() override;
  bool isOpen() const override;

  int hwParamsAny() override;
  int hwParamsSetAccess(AlsaPcmAccess access) override;
  int hwParamsTestFormat(AlsaPcmFormat format) override;
  int hwParamsSetFormat(AlsaPcmFormat format) override;
  int hwParamsSetRateNear(unsigned* rate, int* dir) override;
  int hwParamsSetChannelsNear(unsigned* channels) override;
  int hwParamsSetPeriodSizeNear(uint64_t* period, int* dir) override;
  int hwParamsSetBufferSizeNear(uint64_t* buffer) override;
  int hwParamsApply() override;
  int hwParamsGetRate(unsigned* rate, int* dir) override;
  int hwParamsGetChannels(unsigned* channels) override;
  int hwParamsGetPeriodSize(uint64_t* period, int* dir) override;
  int hwParamsGetBufferSize(uint64_t* buffer) override;

  int swParamsConfigure(uint64_t availMin, uint64_t startThreshold) override;

  int prepare() override;
  int64_t writei(const void* buffer, uint64_t frames) override;
  int resume() override;
  std::string strError(int code) const override;

 private:
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  snd_pcm_t* pcm_ = nullptr;
  snd_pcm_hw_params_t* hw_ = nullptr;
#endif
};

}  // namespace twilight::audio
