#pragma once

#include "../core/AudioTypes.h"

#include <cstdint>
#include <string>

namespace twilight::audio {

struct AudioMetadata {
  std::string source;
  std::string title;
  std::string artist;
  std::string album;
  std::string albumArtist;
  std::string composer;
  std::string year;
  std::string genre;
  std::string trackNumber;
  std::string discNumber;
  std::string comment;
  std::string codec;
  std::string container;
  std::string channelLayout;
  int sampleRate = 0;
  int channelCount = 0;
  int bitDepth = 0;
  int64_t bitrate = 0;
  double durationSeconds = 0.0;
  bool isDsd = false;
  std::string dsdMode = "pcm";
  int dsdRate = 0;
  std::string coverMime;
  std::string coverDataBase64;
  ReplayGainInfo replayGain;
};

}  // namespace twilight::audio
