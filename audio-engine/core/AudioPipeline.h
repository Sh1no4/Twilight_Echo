#pragma once

#include "AudioBuffer.h"
#include "AudioTypes.h"
#include "../decoder/FFmpegDecoder.h"
#include "../dsp/SpectrumAnalyzer.h"
#include "../output/IOutputBackend.h"

#include "twilight_audio_engine.h"

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace twilight::audio {

enum class PipelineState {
  Stopped,
  Playing,
  Paused
};

struct PipelineStatus {
  PipelineState state = PipelineState::Stopped;
  double positionSeconds = 0.0;
  AudioStreamInfo stream;
  AudioFormat outputFormat;
  std::string backendId;
  std::string deviceName;
  bool dspActive = false;
  bool bitPerfect = false;
  std::string resampleReason;
};

class AudioPipeline {
 public:
  AudioPipeline();
  ~AudioPipeline();

  AudioPipeline(const AudioPipeline&) = delete;
  AudioPipeline& operator=(const AudioPipeline&) = delete;

  TAE_Result play(
      const std::string& source,
      double startTimeSeconds,
      const std::string& backendId,
      const std::string& deviceId,
      double volume,
      bool dspActive,
      std::string* error);
  TAE_Result togglePause();
  TAE_Result stop();
  TAE_Result seek(double seconds, std::string* error);
  void setVolume(double volume);

  PipelineStatus status() const;
  bool consumeEnded();
  size_t getSpectrumData(float* buffer, size_t pointCount) const;

 private:
  void startDecodeThread();
  void stopDecodeThread();
  void decodeLoop();
  size_t render(float* output, size_t frameCount);

  mutable std::mutex mutex_;
  std::unique_ptr<FFmpegDecoder> decoder_;
  std::unique_ptr<IOutputBackend> output_;
  AudioBuffer buffer_;
  SpectrumAnalyzer spectrum_;
  AudioStreamInfo stream_;
  AudioFormat outputFormat_;
  std::string backendId_;
  std::string deviceName_;
  std::string resampleReason_;
  std::atomic<bool> decodeRunning_{false};
  std::atomic<bool> decodeEof_{false};
  std::atomic<bool> ended_{false};
  std::atomic<double> volume_{1.0};
  std::atomic<uint64_t> renderedFrames_{0};
  std::thread decodeThread_;
  PipelineState state_ = PipelineState::Stopped;
  bool baseDspActive_ = false;
  bool dspActive_ = false;
  bool bitPerfect_ = false;
};

}  // namespace twilight::audio
