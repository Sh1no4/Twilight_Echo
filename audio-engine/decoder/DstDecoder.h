#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace twilight::audio {

class DstDecoder {
 public:
  bool init(int channels, int sampleRate, std::string* error);
  void reset();

  size_t decodeFrame(const uint8_t* dstFrameBytes,
                     size_t dstFrameSize,
                     uint8_t* dsdOut,
                     size_t dsdOutSize,
                     std::string* error);

  int channels() const;
  int sampleRate() const;
  size_t frameBytesPerChannel() const;

 private:
  int channels_ = 0;
  int sampleRate_ = 0;
  size_t frameBytesPerChannel_ = 0;
};

}  // namespace twilight::audio
