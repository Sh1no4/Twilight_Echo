#pragma once

#include "../core/AudioTypes.h"
#include <string>
#include <vector>
#include <memory>
#include <cstdint>

namespace twilight::audio {

struct SacdIsoTrackInfo {
  int trackNumber = 0;
  std::string title;
  std::string artist;
  double durationSeconds = 0.0;
  uint64_t startSector = 0;
  uint64_t sectorCount = 0;
  int channelCount = 2;
  int sampleRate = 2822400;
  bool isDst = false;
};

class SacdIsoDemuxer {
 public:
  SacdIsoDemuxer();
  ~SacdIsoDemuxer();

  bool open(const std::string& path, std::string* error);
  void close();

  const std::vector<SacdIsoTrackInfo>& tracks() const;

  bool selectTrack(int trackNumber, std::string* error);
  size_t readFrames(PcmBlock& output, std::string* error);
  bool seek(double seconds, std::string* error);
  bool eof() const;

  const AudioStreamInfo& streamInfo() const;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

} // namespace twilight::audio
