#pragma once

#include <cstdint>
#include <string>

namespace twilight::audio {

enum class AudioSampleFormat {
  Float32Interleaved,
  Int16Interleaved,
  Int24Interleaved,
  Int24In32Interleaved,
  Int32Interleaved
};

struct AudioFormat {
  int sampleRate = 0;
  int channelCount = 0;
  int bitDepth = 0;
  AudioSampleFormat sampleFormat = AudioSampleFormat::Float32Interleaved;
};

struct AudioStreamInfo {
  std::string source;
  std::string codec = "未知";
  int64_t bitrate = 0;
  double durationSeconds = 0.0;
  AudioFormat sourceFormat;
  bool isDsd = false;
};

struct OutputInfo {
  bool exclusive = false;
  bool bitPerfect = false;
  bool resampled = false;
  int outputSampleRate = 0;
  int outputBitDepth = 0;
  std::string backend;
  std::string deviceName;
};

}  // namespace twilight::audio
