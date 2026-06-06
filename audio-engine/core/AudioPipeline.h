#pragma once

#include "AudioBuffer.h"
#include "AudioTypes.h"
#include "../decoder/DopPacker.h"
#include "../decoder/DsdReader.h"
#include "../decoder/FFmpegDecoder.h"
#include "../dsp/DspChain.h"
#include "../dsp/FftSpectrumAnalyzer.h"
#include "../output/IOutputBackend.h"

#include "twilight_audio_engine.h"

#include <atomic>
#include <functional>
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
  bool replayGainActive = false;
  bool eqActive = false;
  bool convolverActive = false;
  bool crossfeedActive = false;
  bool crossfadeActive = false;
  bool fftActive = false;
  bool irResampled = false;
  double replayGainDb = 0.0;
  double crossfeedStrength = 0.0;
  double crossfadeSeconds = 0.0;
  uint32_t convolverLatencyFrames = 0;
  uint32_t partitionSize = 0;
  std::string channelMappingMode;
  bool sourceExact = false;
  bool outputPerfect = false;
  bool gaplessActive = false;
  bool preloadReady = false;
  std::string perfectReason;
};

class AudioPipeline {
 public:
  using BackendFactory = std::function<std::unique_ptr<IOutputBackend>(const std::string&)>;

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
      const std::string& dspConfigJson,
      bool gaplessEnabled,
      std::string* error);
  TAE_Result play(
      const std::string& source,
      double startTimeSeconds,
      const std::string& backendId,
      const std::string& deviceId,
      double volume,
      const std::string& dspConfigJson,
      std::string* error);
  TAE_Result togglePause();
  TAE_Result stop();
  TAE_Result seek(double seconds, std::string* error);
  void setVolume(double volume);
  void setDspConfig(const std::string& dspConfigJson);
  bool setOutputConfig(const OutputConfig& config, std::string* error);
  bool loadImpulseResponse(const std::string& path, std::string* error);
  void unloadImpulseResponse();
  ConvolverInfo convolverInfo() const;
  bool setEqBands(const std::string& json, std::string* error);
  bool setEqPreset(const std::string& json, std::string* error);
  void setCrossfeedStrength(double strength);
  void setReplayGainMode(ReplayGainMode mode, double preampDb, double fallbackDb, bool clip);
  bool preloadNext(const std::optional<QueueItem>& item, std::string* error);
  bool skipToPreloaded(const QueueItem& item, std::string* error);

  PipelineStatus status() const;
  bool consumeEnded();
  bool consumeDeviceInvalidated(std::string* message);
  bool consumeTrackStarted(QueueItem* item);
  size_t getSpectrumData(float* buffer, size_t pointCount) const;
  std::string getVisualizationDataJson(
      size_t spectrumPoints,
      size_t waveformPoints,
      size_t spectrogramFrames) const;
  bool isDopPathActive() const;
  bool needsPcmFallback(std::string* reason) const;
  void setRerouteInProgress(bool active, const std::string& reason = {});

  static void setBackendFactoryForTests(BackendFactory factory);

 private:
  struct DecodeStream;

  bool configureActiveStreamLocked(
      const std::shared_ptr<DecodeStream>& stream,
      const QueueItem& item,
      double startTimeSeconds,
      std::string* error);
  bool shouldAttemptDopForCurrentConfig(
      const DspConfig& dspConfig,
      const OutputConfig& outputConfig,
      const std::optional<DsdStreamInfo>& dsdProbe,
      double volume,
      const std::string& backendId) const;
  std::string determineDsdPcmFallbackReason(
      const DspConfig& dspConfig,
      const OutputConfig& outputConfig,
      const AudioStreamInfo& stream,
      double volume,
      const std::string& attemptedDopReason,
      bool dopModeRequested) const;
  TAE_Result playInternal(
      const QueueItem& item,
      const std::optional<QueueItem>& upcomingItem,
      double startTimeSeconds,
      const std::string& backendId,
      const std::string& deviceId,
      double volume,
      const std::string& dspConfigJson,
      bool gaplessEnabled,
      bool allowDop,
      const std::string& forcedDsdFallbackReason,
      std::string* error);
  bool updatePerfectLocked();
  size_t render(float* output, size_t frameCount);

  mutable std::mutex mutex_;
  std::unique_ptr<IOutputBackend> output_;
  std::shared_ptr<DecodeStream> activeStream_;
  std::shared_ptr<DecodeStream> preloadStream_;
  FftSpectrumAnalyzer spectrum_;
  DspChain dspChain_;
  DspChain preloadDspChain_;
  DspConfig dspConfig_;
  OutputConfig outputConfig_;
  DspStatus dspStatus_;
  AudioStreamInfo stream_;
  AudioFormat outputFormat_;
  QueueItem currentItem_;
  std::string backendId_;
  std::string deviceName_;
  std::string perfectReason_;
  OutputInfo outputInfo_;
  std::atomic<bool> ended_{false};
  std::atomic<bool> deviceInvalidated_{false};
  std::atomic<bool> trackStarted_{false};
  std::atomic<double> volume_{1.0};
  std::atomic<uint64_t> renderedFrames_{0};
  PipelineState state_ = PipelineState::Stopped;
  bool dspActive_ = false;
  bool outputPerfect_ = false;
  bool gaplessEnabled_ = true;
  bool dopPathActive_ = false;
  bool crossfadeMixActive_ = false;
  uint64_t crossfadeFramesProcessed_ = 0;
  uint64_t crossfadeTotalFrames_ = 0;
  std::string dsdFallbackReason_;
  bool rerouteInProgress_ = false;
  std::string outputEventMessage_;
};

}  // namespace twilight::audio
