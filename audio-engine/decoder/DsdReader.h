#pragma once

#include "../core/AudioTypes.h"
#include "SacdIsoDemuxer.h"

#include <cstddef>
#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

namespace twilight::audio {

enum class DsdBitOrder {
  LsbFirst,
  MsbFirst
};

enum class DsdPacking {
  DsfPlanarBlocks,
  DffInterleaved
};

struct DsdStreamInfo {
  std::string source;
  std::string container;
  int channelCount = 0;
  int dsdSampleRate = 0;
  int dsdRate = 0;
  DsdBitOrder bitOrder = DsdBitOrder::LsbFirst;
  DsdPacking packing = DsdPacking::DsfPlanarBlocks;
  double durationSeconds = 0.0;
  uint64_t dataOffset = 0;
  uint64_t dataSize = 0;
  uint32_t blockSizePerChannel = 0;
};

bool sourceLooksDsfOrDff(const std::string& source);
bool sourceLooksSacdIso(const std::string& source);
int inferDsdRateFromSampleRate(int sampleRate);

class DsdReader {
 public:
  DsdReader();
  ~DsdReader();

  DsdReader(const DsdReader&) = delete;
  DsdReader& operator=(const DsdReader&) = delete;

  bool open(const std::string& source, std::string* error);
  void close();
  bool seek(double seconds, std::string* error);
  size_t readBytes(uint8_t* output, size_t maxBytes);
  bool eof() const;

  const DsdStreamInfo& streamInfo() const;

 private:
  bool openDsf(std::string* error);
  bool openDff(std::string* error);
  bool openSacdIso(const std::string& source, std::string* error);

  std::ifstream file_;
  SacdIsoDemuxer sacd_;
  DsdStreamInfo info_;
  uint64_t readOffset_ = 0;
  bool eof_ = false;
  bool sacdActive_ = false;
};

}  // namespace twilight::audio
