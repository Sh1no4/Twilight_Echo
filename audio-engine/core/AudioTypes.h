#pragma once

#include <cstdint>
#include <string>

namespace twilight::audio {

enum class AudioSampleFormat {
  Float32Interleaved
};

struct AudioFormat {
  int sampleRate = 0;
  int channelCount = 0;
  int bitDepth = 0;
  AudioSampleFormat sampleFormat = AudioSampleFormat::Float32Interleaved;
};

struct AudioStreamInfo {
  std::string source;
  std::string codec = "unknown";
  int64_t bitrate = 0;
  double durationSeconds = 0.0;
  AudioFormat sourceFormat;
  bool isDsd = false;
};

}  // namespace twilight::audio
