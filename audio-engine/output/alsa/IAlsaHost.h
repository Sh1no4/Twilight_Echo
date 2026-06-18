#pragma once

#include <cstdint>
#include <memory>
#include <string>

namespace twilight::audio {

enum class AlsaPcmFormat {
  Unknown,
  S16Le,
  S24_3Le,
  S24Le,
  S32Le,
  FloatLe,
  DsdU8,
  DsdU16Le,
  DsdU32Le
};

enum class AlsaPcmAccess {
  RwInterleaved
};

constexpr int kAlsaErrEpipe = -32;
constexpr int kAlsaErrEstrpipe = -86;
constexpr int kAlsaErrEagain = -11;

class IAlsaHost {
 public:
  virtual ~IAlsaHost() = default;

  virtual int pcmOpen(const std::string& device, bool playback) = 0;
  virtual int close() = 0;
  virtual int drain() = 0;
  virtual int drop() = 0;
  virtual bool isOpen() const = 0;

  virtual int hwParamsAny() = 0;
  virtual int hwParamsSetAccess(AlsaPcmAccess access) = 0;
  virtual int hwParamsTestFormat(AlsaPcmFormat format) = 0;
  virtual int hwParamsSetFormat(AlsaPcmFormat format) = 0;
  virtual int hwParamsSetRateNear(unsigned* rate, int* dir) = 0;
  virtual int hwParamsSetChannelsNear(unsigned* channels) = 0;
  virtual int hwParamsSetPeriodSizeNear(uint64_t* period, int* dir) = 0;
  virtual int hwParamsSetBufferSizeNear(uint64_t* buffer) = 0;
  virtual int hwParamsApply() = 0;
  virtual int hwParamsGetRate(unsigned* rate, int* dir) = 0;
  virtual int hwParamsGetChannels(unsigned* channels) = 0;
  virtual int hwParamsGetPeriodSize(uint64_t* period, int* dir) = 0;
  virtual int hwParamsGetBufferSize(uint64_t* buffer) = 0;

  virtual int swParamsConfigure(uint64_t availMin, uint64_t startThreshold) = 0;

  virtual int prepare() = 0;
  virtual int64_t writei(const void* buffer, uint64_t frames) = 0;
  virtual int resume() = 0;

  virtual std::string strError(int code) const = 0;
};

std::unique_ptr<IAlsaHost> createRealAlsaHost();

}  // namespace twilight::audio
