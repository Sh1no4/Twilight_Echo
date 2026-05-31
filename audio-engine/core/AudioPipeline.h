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
#include <optional>
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
  OutputInfo outputInfo;
  std::string backendId;
  std::string deviceName;
  QueueItem currentItem;
  bool dspActive = false;
  bool bitPerfect = false;
  bool gaplessActive = false;
  bool preloadReady = false;
  std::string resampleReason;
};

class AudioPipeline {
 public:
  AudioPipeline();
  ~AudioPipeline();

  AudioPipeline(const AudioPipeline&) = delete;
  AudioPipeline& operator=(const AudioPipeline&) = delete;

  TAE_Result play(
      const QueueItem& item,
      const std::optional<QueueItem>& upcomingItem,
      double startTimeSeconds,
      const std::string& backendId,
      const std::string& deviceId,
      double volume,
      bool dspActive,
      bool gaplessEnabled,
      std::string* error);
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
  bool preloadNext(const std::optional<QueueItem>& item, std::string* error);
  bool skipToPreloaded(const QueueItem& item, std::string* error);

  PipelineStatus status() const;
  bool consumeEnded();
  bool consumeDeviceInvalidated(std::string* message);
  bool consumeTrackStarted(QueueItem* item);
  size_t getSpectrumData(float* buffer, size_t pointCount) const;

 private:
  struct DecodeStream;

  bool configureActiveStreamLocked(
      const std::shared_ptr<DecodeStream>& stream,
      const QueueItem& item,
      double startTimeSeconds,
      std::string* error);
  bool updateBitPerfectLocked();
  size_t render(float* output, size_t frameCount);

  mutable std::mutex mutex_;
  std::unique_ptr<IOutputBackend> output_;
  std::shared_ptr<DecodeStream> activeStream_;
  std::shared_ptr<DecodeStream> preloadStream_;
  SpectrumAnalyzer spectrum_;
  AudioStreamInfo stream_;
  AudioFormat outputFormat_;
  QueueItem currentItem_;
  std::string backendId_;
  std::string deviceName_;
  std::string resampleReason_;
  OutputInfo outputInfo_;
  std::atomic<bool> ended_{false};
  std::atomic<bool> deviceInvalidated_{false};
  std::atomic<bool> trackStarted_{false};
  std::atomic<double> volume_{1.0};
  std::atomic<uint64_t> renderedFrames_{0};
  PipelineState state_ = PipelineState::Stopped;
  bool baseDspActive_ = false;
  bool dspActive_ = false;
  bool bitPerfect_ = false;
  bool gaplessEnabled_ = true;
  std::string outputEventMessage_;
};

}  // namespace twilight::audio
