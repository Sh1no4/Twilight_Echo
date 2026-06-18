#include "DstDecoder.h"

#include "vendor/dstdec/dstdec.h"

namespace twilight::audio {

bool DstDecoder::init(int channels, int sampleRate, std::string* error) {
  if (channels <= 0 || channels > 6) {
    if (error) *error = "DST channel count must be between 1 and 6";
    reset();
    return false;
  }
  const size_t frameBytesPerChannel = dstdec::frameBytesPerChannelForSampleRate(sampleRate);
  if (frameBytesPerChannel == 0) {
    if (error) *error = "Unsupported DST sample rate";
    reset();
    return false;
  }

  channels_ = channels;
  sampleRate_ = sampleRate;
  frameBytesPerChannel_ = frameBytesPerChannel;
  return true;
}

void DstDecoder::reset() {
  channels_ = 0;
  sampleRate_ = 0;
  frameBytesPerChannel_ = 0;
}

size_t DstDecoder::decodeFrame(const uint8_t* dstFrameBytes,
                               size_t dstFrameSize,
                               uint8_t* dsdOut,
                               size_t dsdOutSize,
                               std::string* error) {
  if (channels_ <= 0 || sampleRate_ <= 0 || frameBytesPerChannel_ == 0) {
    if (error) *error = "DST decoder is not initialized";
    return 0;
  }
  size_t bytesWritten = 0;
  if (!dstdec::decodeFrame(dstFrameBytes, dstFrameSize, channels_, sampleRate_, dsdOut, dsdOutSize, &bytesWritten, error)) {
    return 0;
  }
  return bytesWritten;
}

int DstDecoder::channels() const {
  return channels_;
}

int DstDecoder::sampleRate() const {
  return sampleRate_;
}

size_t DstDecoder::frameBytesPerChannel() const {
  return frameBytesPerChannel_;
}

}  // namespace twilight::audio
