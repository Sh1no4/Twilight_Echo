#pragma once

#include "DsdReader.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace twilight::audio {

struct DopPackerConfig {
  int channelCount = 0;
  int dsdRate = 0;
  int sourceSampleRate = 0;
  DsdBitOrder bitOrder = DsdBitOrder::LsbFirst;
  DsdPacking packing = DsdPacking::DsfPlanarBlocks;
  AudioSampleFormat outputFormat = AudioSampleFormat::Int24Interleaved;
};

class DopPacker {
 public:
  bool configure(const DopPackerConfig& config, std::string* error);
  size_t pack(const uint8_t* dsdBytes, size_t byteCount, std::vector<uint8_t>* pcmBytes);
  void reset();

  const AudioFormat& carrierFormat() const;

 private:
  DopPackerConfig config_;
  AudioFormat carrierFormat_;
  size_t markerIndex_ = 0;
};

}  // namespace twilight::audio
