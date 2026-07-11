#pragma once

#include "AudioBuffer.h"
#include "AudioTypes.h"
#include "FixedSpscQueue.h"
#include "../decoder/DopPacker.h"
#include "../decoder/DsdReader.h"
#include "../decoder/FFmpegDecoder.h"
#include "../dsp/DspChain.h"
#include "../dsp/FftSpectrumAnalyzer.h"
#include "../dsp/ChannelRouter.h"
#include "../output/IOutputBackend.h"

#include "twilight_audio_engine.h"

#include <array>
#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

namespace twilight::audio {

size_t visualizationFftResolutionForConfig(size_t configuredFftResolution);

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
  bool nativeDspActive = false;
  bool crossfadeActive = false;
  bool fftActive = false;
  bool irResampled = false;
  double replayGainDb = 0.0;
  double crossfeedStrength = 0.0;
  double crossfadeSeconds = 0.0;
  uint32_t convolverLatencyFrames = 0;
  uint32_t partitionSize = 0;
  std::string channelMappingMode;
  std::string nativeDspJson = "{\"plugins\":[]}";
  bool sourceExact = false;
  bool outputPerfect = false;
  bool gaplessActive = false;
  bool preloadReady = false;
  std::string perfectReason;
  uint64_t requestedConfigRevision = 0;
  uint64_t appliedConfigRevision = 0;
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
  void setNativeDspPluginChain(const std::string& json);
  std::string nativeDspPluginStatusJson() const;
  bool preloadNext(const std::optional<QueueItem>& item, std::string* error);
  bool skipToPreloaded(const QueueItem& item, std::string* error);

  PipelineStatus status();
  bool consumeEnded();
  bool consumeDeviceInvalidated(std::string* message);
  bool consumeRenderError(std::string* message);
  bool consumeTrackStarted(QueueItem* item);
  size_t getSpectrumData(float* buffer, size_t pointCount) const;
  std::string getVisualizationDataJson(
      size_t spectrumPoints,
      size_t waveformPoints,
      size_t spectrogramFrames,
      size_t oscilloscopePoints = 1024) const;
  bool isDopPathActive() const;
  bool isNativeDsdPathActive() const;
  bool needsPcmFallback(std::string* reason) const;
  void setRerouteInProgress(bool active, const std::string& reason = {});

  static void setBackendFactoryForTests(BackendFactory factory);

 private:
  enum class ControlCommandType : uint8_t {
    Volume
  };

  struct ControlCommand {
    ControlCommandType type = ControlCommandType::Volume;
    double volume = 1.0;
    uint64_t revision = 0;
  };

  struct LatestControlCommandSlot {
    void publish(const ControlCommand& command) noexcept;
    bool read(ControlCommand* command) const noexcept;

    std::atomic<uint64_t> sequence{0};
    std::atomic<uint64_t> revision{0};
    std::atomic<double> volume{1.0};
  };

  struct DecodeStream;
  struct DecodeStreamReaper;

  static std::shared_ptr<DecodeStream> makeDecodeStream();
  static DecodeStreamReaper& decodeStreamReaper();
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
  bool shouldAttemptNativeDsdForCurrentConfig(
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
      bool allowNativeDsd,
      bool allowDop,
      const std::string& forcedDsdFallbackReason,
      std::string* error);
  bool updatePerfectLocked();
  PipelineStatus buildStatusLocked();
  PipelineStatus fallbackStatus() const;
  void publishStatusLocked();
  void prepareRenderScratchLocked(size_t maxFrames);
  bool retireDecodeStreamLocked(std::shared_ptr<DecodeStream> stream);
  void cleanupRetiredDecodeStreams() const;
  void tryCleanupRetiredDecodeStreams() const;
  DspChain& activeDspChainLocked();
  const DspChain& activeDspChainLocked() const;
  DspChain& spareDspChainLocked();
  size_t render(float* output, size_t frameCount);
  size_t renderTyped(PcmBlock& output);
  void enqueueControlCommand(const ControlCommand& command) noexcept;
  void applyPendingControlCommands() noexcept;
  void applyControlCommand(const ControlCommand& command) noexcept;

  mutable std::mutex mutex_;
  std::unique_ptr<IOutputBackend> output_;
  std::shared_ptr<DecodeStream> activeStream_;
  std::shared_ptr<DecodeStream> preloadStream_;
  static constexpr size_t kRetiredStreamSlots = 16;
  mutable std::array<std::shared_ptr<DecodeStream>, kRetiredStreamSlots> retiredStreams_;
  mutable size_t retiredStreamCount_ = 0;
  FftSpectrumAnalyzer spectrum_;
  DspChain dspChain_;
  DspChain preloadDspChain_;
  DspConfig dspConfig_;
  OutputConfig outputConfig_;
  DspStatus dspStatus_;
  DspStatus preloadDspStatus_;
  AudioStreamInfo stream_;
  AudioFormat outputFormat_;
  AudioFormat decodeFormat_;
  QueueItem currentItem_;
  std::string backendId_;
  std::string deviceName_;
  std::string perfectReason_;
  OutputInfo outputInfo_;
  std::atomic<bool> ended_{false};
  std::atomic<bool> deviceInvalidated_{false};
  std::atomic<bool> renderError_{false};
  std::atomic<bool> trackStarted_{false};
  static constexpr size_t kControlCommandCapacity = 32;
  FixedSpscQueue<ControlCommand, kControlCommandCapacity> controlCommands_;
  LatestControlCommandSlot latestOverflowCommand_;
  std::atomic<double> requestedVolume_{1.0};
  std::atomic<double> appliedVolume_{1.0};
  std::atomic<uint64_t> requestedConfigRevision_{0};
  std::atomic<uint64_t> appliedConfigRevision_{0};
  std::atomic<uint64_t> renderedFrames_{0};
  std::atomic<int> renderChannelCount_{2};
  PipelineState state_ = PipelineState::Stopped;
  bool dspActive_ = false;
  bool outputPerfect_ = false;
  bool gaplessEnabled_ = true;
  bool dopPathActive_ = false;
  bool nativeDsdPathActive_ = false;
  bool typedPassthroughActive_ = false;
  bool activeUsesPreloadDspChain_ = false;
  bool crossfadeMixActive_ = false;
  uint64_t crossfadeFramesProcessed_ = 0;
  uint64_t crossfadeTotalFrames_ = 0;
  std::string dsdFallbackReason_;
  bool rerouteInProgress_ = false;
  std::string outputEventMessage_;
  std::vector<float> routingScratch_;
  std::vector<float> preloadRoutingScratch_;
  std::vector<float> preloadMixScratch_;
  std::vector<float> typedVisualizationScratch_;
  mutable std::mutex channelRouterMutex_;
  ChannelRouter channelRouter_;
  mutable std::mutex statusMutex_;
  PipelineStatus lastStatus_;
};

}  // namespace twilight::audio
