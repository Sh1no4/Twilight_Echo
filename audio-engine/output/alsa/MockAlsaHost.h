#pragma once

#include "IAlsaHost.h"

#include <cstdint>
#include <string>
#include <vector>

namespace twilight::audio {

class MockAlsaHost final : public IAlsaHost {
 public:
  std::vector<AlsaPcmFormat> acceptedFormats = {
      AlsaPcmFormat::S16Le,
      AlsaPcmFormat::S24_3Le,
      AlsaPcmFormat::S24Le,
      AlsaPcmFormat::S32Le,
      AlsaPcmFormat::FloatLe};
  std::vector<AlsaPcmFormat> testedFormats;
  std::vector<AlsaPcmFormat> setFormats;
  std::vector<int> pendingWriteErrors;
  std::string lastDevice;
  unsigned requestedRate = 0;
  unsigned requestedChannels = 0;
  uint64_t requestedPeriodSize = 0;
  uint64_t requestedBufferSize = 0;
  unsigned negotiatedRate = 0;
  unsigned negotiatedChannels = 0;
  uint64_t negotiatedPeriodSize = 4;
  uint64_t negotiatedBufferSize = 16;
  // When captureFrameBytes > 0, writei captures frames * captureFrameBytes bytes from the
  // buffer into capturedWriteBytes, enabling byte-exact DSD bypass verification.
  size_t captureFrameBytes = 0;
  std::vector<uint8_t> capturedWriteBytes;
  int openCalls = 0;
  int closeCalls = 0;
  int prepareCalls = 0;
  int drainCalls = 0;
  int dropCalls = 0;
  int writeCalls = 0;
  int resumeCalls = 0;
  int hwParamsApplyCalls = 0;
  int hwParamsAnyCalls = 0;
  int hwParamsSetAccessCalls = 0;
  int hwParamsSetRateNearCalls = 0;
  int hwParamsSetChannelsNearCalls = 0;
  int hwParamsSetPeriodSizeNearCalls = 0;
  int hwParamsSetBufferSizeNearCalls = 0;
  int swParamsConfigureCalls = 0;
  int prepareReturn = 0;
  int resumeReturn = 0;
  int openReturnCode = 0;
  bool opened = false;

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
};

}  // namespace twilight::audio
