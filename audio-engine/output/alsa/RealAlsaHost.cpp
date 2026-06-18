#include "RealAlsaHost.h"

#include <memory>

namespace twilight::audio {

#if defined(__linux__) && defined(TAE_ENABLE_ALSA)

static_assert(-kAlsaErrEpipe == EPIPE, "kAlsaErrEpipe must mirror EPIPE");
static_assert(-kAlsaErrEstrpipe == ESTRPIPE, "kAlsaErrEstrpipe must mirror ESTRPIPE");
static_assert(-kAlsaErrEagain == EAGAIN, "kAlsaErrEagain must mirror EAGAIN");

namespace {

snd_pcm_format_t toNativeFormat(AlsaPcmFormat format) {
  switch (format) {
    case AlsaPcmFormat::S16Le:
      return SND_PCM_FORMAT_S16_LE;
    case AlsaPcmFormat::S24_3Le:
      return SND_PCM_FORMAT_S24_3LE;
    case AlsaPcmFormat::S24Le:
      return SND_PCM_FORMAT_S24_LE;
    case AlsaPcmFormat::S32Le:
      return SND_PCM_FORMAT_S32_LE;
    case AlsaPcmFormat::FloatLe:
      return SND_PCM_FORMAT_FLOAT_LE;
    case AlsaPcmFormat::DsdU8:
      return SND_PCM_FORMAT_DSD_U8;
    case AlsaPcmFormat::DsdU16Le:
      return SND_PCM_FORMAT_DSD_U16_LE;
    case AlsaPcmFormat::DsdU32Le:
      return SND_PCM_FORMAT_DSD_U32_LE;
    case AlsaPcmFormat::Unknown:
    default:
      return SND_PCM_FORMAT_UNKNOWN;
  }
}

snd_pcm_access_t toNativeAccess(AlsaPcmAccess access) {
  switch (access) {
    case AlsaPcmAccess::RwInterleaved:
    default:
      return SND_PCM_ACCESS_RW_INTERLEAVED;
  }
}

}  // namespace

#endif

RealAlsaHost::~RealAlsaHost() {
  close();
}

int RealAlsaHost::pcmOpen(const std::string& device, bool playback) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  close();
  snd_pcm_t* pcm = nullptr;
  const int code = snd_pcm_open(&pcm, device.c_str(), playback ? SND_PCM_STREAM_PLAYBACK : SND_PCM_STREAM_CAPTURE, 0);
  if (code < 0) return code;
  pcm_ = pcm;
  return snd_pcm_hw_params_malloc(&hw_);
#else
  (void)device;
  (void)playback;
  return -1;
#endif
}

int RealAlsaHost::close() {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  int code = 0;
  if (hw_) {
    snd_pcm_hw_params_free(hw_);
    hw_ = nullptr;
  }
  if (pcm_) {
    code = snd_pcm_close(pcm_);
    pcm_ = nullptr;
  }
  return code;
#else
  return -1;
#endif
}

int RealAlsaHost::drain() {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ ? snd_pcm_drain(pcm_) : -1;
#else
  return -1;
#endif
}

int RealAlsaHost::drop() {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ ? snd_pcm_drop(pcm_) : -1;
#else
  return -1;
#endif
}

bool RealAlsaHost::isOpen() const {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ != nullptr;
#else
  return false;
#endif
}

int RealAlsaHost::hwParamsAny() {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ && hw_ ? snd_pcm_hw_params_any(pcm_, hw_) : -1;
#else
  return -1;
#endif
}

int RealAlsaHost::hwParamsSetAccess(AlsaPcmAccess access) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ && hw_ ? snd_pcm_hw_params_set_access(pcm_, hw_, toNativeAccess(access)) : -1;
#else
  (void)access;
  return -1;
#endif
}

int RealAlsaHost::hwParamsTestFormat(AlsaPcmFormat format) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ && hw_ ? snd_pcm_hw_params_test_format(pcm_, hw_, toNativeFormat(format)) : -1;
#else
  (void)format;
  return -1;
#endif
}

int RealAlsaHost::hwParamsSetFormat(AlsaPcmFormat format) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ && hw_ ? snd_pcm_hw_params_set_format(pcm_, hw_, toNativeFormat(format)) : -1;
#else
  (void)format;
  return -1;
#endif
}

int RealAlsaHost::hwParamsSetRateNear(unsigned* rate, int* dir) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ && hw_ ? snd_pcm_hw_params_set_rate_near(pcm_, hw_, rate, dir) : -1;
#else
  (void)rate;
  (void)dir;
  return -1;
#endif
}

int RealAlsaHost::hwParamsSetChannelsNear(unsigned* channels) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ && hw_ ? snd_pcm_hw_params_set_channels_near(pcm_, hw_, channels) : -1;
#else
  (void)channels;
  return -1;
#endif
}

int RealAlsaHost::hwParamsSetPeriodSizeNear(uint64_t* period, int* dir) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  if (!pcm_ || !hw_ || !period) return -1;
  snd_pcm_uframes_t nativePeriod = static_cast<snd_pcm_uframes_t>(*period);
  const int code = snd_pcm_hw_params_set_period_size_near(pcm_, hw_, &nativePeriod, dir);
  *period = static_cast<uint64_t>(nativePeriod);
  return code;
#else
  (void)period;
  (void)dir;
  return -1;
#endif
}

int RealAlsaHost::hwParamsSetBufferSizeNear(uint64_t* buffer) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  if (!pcm_ || !hw_ || !buffer) return -1;
  snd_pcm_uframes_t nativeBuffer = static_cast<snd_pcm_uframes_t>(*buffer);
  const int code = snd_pcm_hw_params_set_buffer_size_near(pcm_, hw_, &nativeBuffer);
  *buffer = static_cast<uint64_t>(nativeBuffer);
  return code;
#else
  (void)buffer;
  return -1;
#endif
}

int RealAlsaHost::hwParamsApply() {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ && hw_ ? snd_pcm_hw_params(pcm_, hw_) : -1;
#else
  return -1;
#endif
}

int RealAlsaHost::hwParamsGetRate(unsigned* rate, int* dir) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return hw_ ? snd_pcm_hw_params_get_rate(hw_, rate, dir) : -1;
#else
  (void)rate;
  (void)dir;
  return -1;
#endif
}

int RealAlsaHost::hwParamsGetChannels(unsigned* channels) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return hw_ ? snd_pcm_hw_params_get_channels(hw_, channels) : -1;
#else
  (void)channels;
  return -1;
#endif
}

int RealAlsaHost::hwParamsGetPeriodSize(uint64_t* period, int* dir) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  if (!hw_ || !period) return -1;
  snd_pcm_uframes_t nativePeriod = 0;
  const int code = snd_pcm_hw_params_get_period_size(hw_, &nativePeriod, dir);
  *period = static_cast<uint64_t>(nativePeriod);
  return code;
#else
  (void)period;
  (void)dir;
  return -1;
#endif
}

int RealAlsaHost::hwParamsGetBufferSize(uint64_t* buffer) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  if (!hw_ || !buffer) return -1;
  snd_pcm_uframes_t nativeBuffer = 0;
  const int code = snd_pcm_hw_params_get_buffer_size(hw_, &nativeBuffer);
  *buffer = static_cast<uint64_t>(nativeBuffer);
  return code;
#else
  (void)buffer;
  return -1;
#endif
}

int RealAlsaHost::swParamsConfigure(uint64_t availMin, uint64_t startThreshold) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  if (!pcm_) return -1;
  snd_pcm_sw_params_t* sw = nullptr;
  snd_pcm_sw_params_alloca(&sw);
  int code = snd_pcm_sw_params_current(pcm_, sw);
  if (code < 0) return code;
  code = snd_pcm_sw_params_set_avail_min(pcm_, sw, static_cast<snd_pcm_uframes_t>(availMin));
  if (code < 0) return code;
  code = snd_pcm_sw_params_set_start_threshold(pcm_, sw, static_cast<snd_pcm_uframes_t>(startThreshold));
  if (code < 0) return code;
  return snd_pcm_sw_params(pcm_, sw);
#else
  (void)availMin;
  (void)startThreshold;
  return -1;
#endif
}

int RealAlsaHost::prepare() {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ ? snd_pcm_prepare(pcm_) : -1;
#else
  return -1;
#endif
}

int64_t RealAlsaHost::writei(const void* buffer, uint64_t frames) {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ ? static_cast<int64_t>(snd_pcm_writei(pcm_, buffer, static_cast<snd_pcm_uframes_t>(frames))) : -1;
#else
  (void)buffer;
  (void)frames;
  return -1;
#endif
}

int RealAlsaHost::resume() {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return pcm_ ? snd_pcm_resume(pcm_) : -1;
#else
  return -1;
#endif
}

std::string RealAlsaHost::strError(int code) const {
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return snd_strerror(code);
#else
  (void)code;
  return "当前构建未启用 ALSA 输出";
#endif
}

std::unique_ptr<IAlsaHost> createRealAlsaHost() {
  return std::make_unique<RealAlsaHost>();
}

}  // namespace twilight::audio
