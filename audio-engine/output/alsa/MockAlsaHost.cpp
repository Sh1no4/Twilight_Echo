#include "MockAlsaHost.h"

#include <algorithm>

namespace twilight::audio {

int MockAlsaHost::pcmOpen(const std::string& device, bool playback) {
  (void)playback;
  ++openCalls;
  lastDevice = device;
  if (openReturnCode < 0) return openReturnCode;
  opened = true;
  return openReturnCode;
}

int MockAlsaHost::close() {
  ++closeCalls;
  opened = false;
  return 0;
}

int MockAlsaHost::drain() {
  ++drainCalls;
  return 0;
}

int MockAlsaHost::drop() {
  ++dropCalls;
  return 0;
}

bool MockAlsaHost::isOpen() const {
  return opened;
}

int MockAlsaHost::hwParamsAny() {
  ++hwParamsAnyCalls;
  return 0;
}

int MockAlsaHost::hwParamsSetAccess(AlsaPcmAccess access) {
  (void)access;
  ++hwParamsSetAccessCalls;
  return 0;
}

int MockAlsaHost::hwParamsTestFormat(AlsaPcmFormat format) {
  testedFormats.push_back(format);
  return std::find(acceptedFormats.begin(), acceptedFormats.end(), format) != acceptedFormats.end() ? 0 : -1;
}

int MockAlsaHost::hwParamsSetFormat(AlsaPcmFormat format) {
  setFormats.push_back(format);
  return 0;
}

int MockAlsaHost::hwParamsSetRateNear(unsigned* rate, int* dir) {
  (void)dir;
  ++hwParamsSetRateNearCalls;
  if (!rate) return -1;
  requestedRate = *rate;
  if (negotiatedRate == 0) negotiatedRate = *rate;
  *rate = negotiatedRate;
  return 0;
}

int MockAlsaHost::hwParamsSetChannelsNear(unsigned* channels) {
  ++hwParamsSetChannelsNearCalls;
  if (!channels) return -1;
  requestedChannels = *channels;
  if (negotiatedChannels == 0) negotiatedChannels = *channels;
  *channels = negotiatedChannels;
  return 0;
}

int MockAlsaHost::hwParamsSetPeriodSizeNear(uint64_t* period, int* dir) {
  (void)dir;
  ++hwParamsSetPeriodSizeNearCalls;
  if (!period) return -1;
  requestedPeriodSize = *period;
  if (negotiatedPeriodSize == 0) negotiatedPeriodSize = *period;
  *period = negotiatedPeriodSize;
  return 0;
}

int MockAlsaHost::hwParamsSetBufferSizeNear(uint64_t* buffer) {
  ++hwParamsSetBufferSizeNearCalls;
  if (!buffer) return -1;
  requestedBufferSize = *buffer;
  if (negotiatedBufferSize == 0) negotiatedBufferSize = *buffer;
  *buffer = negotiatedBufferSize;
  return 0;
}

int MockAlsaHost::hwParamsApply() {
  ++hwParamsApplyCalls;
  return 0;
}

int MockAlsaHost::hwParamsGetRate(unsigned* rate, int* dir) {
  (void)dir;
  if (!rate) return -1;
  *rate = negotiatedRate;
  return 0;
}

int MockAlsaHost::hwParamsGetChannels(unsigned* channels) {
  if (!channels) return -1;
  *channels = negotiatedChannels;
  return 0;
}

int MockAlsaHost::hwParamsGetPeriodSize(uint64_t* period, int* dir) {
  (void)dir;
  if (!period) return -1;
  *period = negotiatedPeriodSize;
  return 0;
}

int MockAlsaHost::hwParamsGetBufferSize(uint64_t* buffer) {
  if (!buffer) return -1;
  *buffer = negotiatedBufferSize;
  return 0;
}

int MockAlsaHost::swParamsConfigure(uint64_t availMin, uint64_t startThreshold) {
  (void)availMin;
  (void)startThreshold;
  ++swParamsConfigureCalls;
  return 0;
}

int MockAlsaHost::prepare() {
  ++prepareCalls;
  return prepareReturn;
}

int64_t MockAlsaHost::writei(const void* buffer, uint64_t frames) {
  if (captureFrameBytes > 0 && buffer) {
    const size_t byteCount = static_cast<size_t>(frames) * captureFrameBytes;
    const auto* bytes = static_cast<const uint8_t*>(buffer);
    capturedWriteBytes.assign(bytes, bytes + byteCount);
  }
  ++writeCalls;
  if (!pendingWriteErrors.empty()) {
    const int code = pendingWriteErrors.front();
    pendingWriteErrors.erase(pendingWriteErrors.begin());
    return code;
  }
  return static_cast<int64_t>(frames);
}

int MockAlsaHost::resume() {
  ++resumeCalls;
  return resumeReturn;
}

std::string MockAlsaHost::strError(int code) const {
  return "alsa mock error " + std::to_string(code);
}

}  // namespace twilight::audio
