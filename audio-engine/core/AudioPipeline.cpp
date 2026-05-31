#include "AudioPipeline.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <utility>
#include <vector>

namespace twilight::audio {
namespace {

constexpr size_t kDecodeChunkFrames = 2048;

QueueItem makeManualItem(const std::string& source) {
  QueueItem item;
  item.id = source;
  item.source = source;
  item.title = source;
  return item;
}

}  // namespace

struct AudioPipeline::DecodeStream {
  QueueItem item;
  AudioStreamInfo stream;
  AudioFormat decodeFormat;
  std::unique_ptr<FFmpegDecoder> decoder;
  AudioBuffer buffer;
  std::atomic<bool> running{false};
  std::atomic<bool> eof{false};
  std::thread decodeThread;

  ~DecodeStream() {
    stop();
  }

  bool openSource(const QueueItem& queueItem, std::string* error) {
    stop();
    item = queueItem;
    decoder = std::make_unique<FFmpegDecoder>();
    if (!decoder->open(item.source, error)) {
      decoder.reset();
      return false;
    }
    stream = decoder->streamInfo();
    stream.source = item.source;
    if (item.durationSeconds > 0.0) stream.durationSeconds = item.durationSeconds;
    return true;
  }

  bool configure(const AudioFormat& outputFormat, double startTimeSeconds, std::string* error) {
    if (!decoder) {
      if (error) *error = "解码器尚未打开";
      return false;
    }

    decodeFormat = outputFormat;
    decodeFormat.bitDepth = 32;
    decodeFormat.sampleFormat = AudioSampleFormat::Float32Interleaved;
    if (!decoder->setOutputFormat(decodeFormat, error)) return false;
    if (startTimeSeconds > 0.0 && !decoder->seek(startTimeSeconds, error)) return false;

    eof = false;
    buffer.reset(outputFormat.channelCount, static_cast<size_t>(std::max(outputFormat.sampleRate * 2, 8192)));
    return true;
  }

  void start() {
    if (!decoder || running.load()) return;
    running = true;
    decodeThread = std::thread([this] { decodeLoop(); });
  }

  void stop() {
    running = false;
    buffer.notifyAll();
    if (decodeThread.joinable()) decodeThread.join();
  }

  bool seek(double seconds, std::string* error) {
    if (!decoder) return false;
    stop();
    if (!decoder->seek(std::max(0.0, seconds), error)) {
      start();
      return false;
    }
    buffer.clear();
    eof = false;
    start();
    return true;
  }

  size_t read(float* output, size_t frameCount) {
    return buffer.read(output, frameCount);
  }

  bool drained() const {
    return eof.load() && buffer.availableFrames() == 0;
  }

  bool readyForRender() const {
    return buffer.availableFrames() > 0 || eof.load();
  }

 private:
  void decodeLoop() {
    const int channels = std::max(1, decodeFormat.channelCount);
    std::vector<float> frames(kDecodeChunkFrames * static_cast<size_t>(channels));

    while (running.load()) {
      if (!decoder) break;
      std::string error;
      const size_t decoded = decoder->readFrames(frames.data(), kDecodeChunkFrames, &error);
      if (decoded == 0) {
        eof = true;
        break;
      }
      buffer.writeBlocking(frames.data(), decoded, running);
    }
  }
};

AudioPipeline::AudioPipeline() = default;

AudioPipeline::~AudioPipeline() {
  stop();
}

TAE_Result AudioPipeline::play(
    const std::string& source,
    double startTimeSeconds,
    const std::string& backendId,
    const std::string& deviceId,
    double volume,
    const std::string& dspConfigJson,
    std::string* error) {
  return play(makeManualItem(source), std::nullopt, startTimeSeconds, backendId, deviceId, volume, dspConfigJson, false, error);
}

TAE_Result AudioPipeline::play(
    const QueueItem& item,
    const std::optional<QueueItem>& upcomingItem,
    double startTimeSeconds,
    const std::string& backendId,
    const std::string& deviceId,
    double volume,
    const std::string& dspConfigJson,
    bool gaplessEnabled,
    std::string* error) {
  stop();
  if (item.source.empty()) return TAE_RESULT_INVALID_ARGUMENT;

  auto active = std::make_shared<DecodeStream>();
  if (!active->openSource(item, error)) {
    return TAE_RESULT_BACKEND_UNAVAILABLE;
  }

  auto output = createOutputBackend(backendId);
  if (!output) {
    if (error) *error = "请求的音频输出后端不可用：" + backendId;
    return TAE_RESULT_BACKEND_UNAVAILABLE;
  }

  {
    std::lock_guard lock(mutex_);
    if (!output->setOutputConfig(outputConfig_, error)) {
      return TAE_RESULT_INVALID_ARGUMENT;
    }
  }

  if (!output->open(deviceId, active->stream.sourceFormat, error)) {
    return TAE_RESULT_BACKEND_UNAVAILABLE;
  }

  const AudioFormat outputFormat = output->outputFormat();
  if (!active->configure(outputFormat, startTimeSeconds, error)) {
    output->close();
    return TAE_RESULT_INTERNAL_ERROR;
  }

  {
    std::lock_guard lock(mutex_);
    output_ = std::move(output);
    activeStream_ = active;
    preloadStream_.reset();
    stream_ = activeStream_->stream;
    outputFormat_ = outputFormat;
    currentItem_ = item;
    backendId_ = backendId == "wasapi-shared" ? "wasapi" : backendId;
    deviceName_ = output_->deviceName();
    outputInfo_ = output_->outputInfo();
    outputInfo_.backend = backendId_;
    outputInfo_.deviceName = deviceName_;
    dspConfig_ = DspChain::parseConfigJson(dspConfigJson);
    dspChain_.configure(dspConfig_);
    dspChain_.prepare(outputFormat_);
    dspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
    dspStatus_ = dspChain_.status();
    dspActive_ = dspStatus_.dspActive || std::abs(volume - 1.0) > 0.0001;
    spectrum_.prepare(outputFormat_, dspConfig_.fftResolution);
    spectrum_.setEnabled(dspConfig_.fftEnabled);
    gaplessEnabled_ = gaplessEnabled;
    updateBitPerfectLocked();
    state_ = PipelineState::Playing;
    renderedFrames_ = static_cast<uint64_t>(std::max(0.0, startTimeSeconds) * outputFormat_.sampleRate);
    ended_ = false;
    deviceInvalidated_ = false;
    trackStarted_ = false;
    outputEventMessage_.clear();
    volume_ = std::clamp(volume, 0.0, 1.0);
  }

  active->start();
  if (gaplessEnabled_) {
    std::string preloadError;
    preloadNext(upcomingItem, &preloadError);
  }

  auto eventCallback = [this](OutputBackendEvent event, const std::string& message) {
    std::lock_guard lock(mutex_);
    outputEventMessage_ = message;
    if (event == OutputBackendEvent::DeviceInvalidated) {
      deviceInvalidated_ = true;
    }
    state_ = PipelineState::Stopped;
  };

  if (!output_->start([this](float* data, size_t frames) { return render(data, frames); }, eventCallback, error)) {
    stop();
    return TAE_RESULT_BACKEND_UNAVAILABLE;
  }

  return TAE_RESULT_OK;
}

TAE_Result AudioPipeline::togglePause() {
  std::lock_guard lock(mutex_);
  if (state_ == PipelineState::Playing) {
    state_ = PipelineState::Paused;
  } else if (state_ == PipelineState::Paused) {
    state_ = PipelineState::Playing;
  }
  return TAE_RESULT_OK;
}

TAE_Result AudioPipeline::stop() {
  std::unique_ptr<IOutputBackend> output;
  std::shared_ptr<DecodeStream> active;
  std::shared_ptr<DecodeStream> preload;
  {
    std::lock_guard lock(mutex_);
    state_ = PipelineState::Stopped;
    output = std::move(output_);
    active = std::move(activeStream_);
    preload = std::move(preloadStream_);
  }

  if (output) {
    output->stop();
    output->close();
  }
  if (active) active->stop();
  if (preload) preload->stop();

  {
    std::lock_guard lock(mutex_);
    stream_ = {};
    outputFormat_ = {};
    currentItem_ = {};
    backendId_.clear();
    deviceName_.clear();
    resampleReason_.clear();
    outputInfo_ = {};
    renderedFrames_ = 0;
    ended_ = false;
    deviceInvalidated_ = false;
    trackStarted_ = false;
    outputEventMessage_.clear();
    dspStatus_ = {};
    dspConfig_ = {};
    dspActive_ = false;
    bitPerfect_ = false;
    gaplessEnabled_ = true;
  }
  return TAE_RESULT_OK;
}

TAE_Result AudioPipeline::seek(double seconds, std::string* error) {
  std::shared_ptr<DecodeStream> active;
  {
    std::lock_guard lock(mutex_);
    if (!activeStream_ || outputFormat_.sampleRate <= 0) return TAE_RESULT_NOT_INITIALIZED;
    active = activeStream_;
  }

  if (!active->seek(seconds, error)) return TAE_RESULT_INTERNAL_ERROR;

  {
    std::lock_guard lock(mutex_);
    renderedFrames_ = static_cast<uint64_t>(std::max(0.0, seconds) * outputFormat_.sampleRate);
    ended_ = false;
    dspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
    dspStatus_ = dspChain_.status();
    dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
    updateBitPerfectLocked();
  }
  return TAE_RESULT_OK;
}

void AudioPipeline::setVolume(double volume) {
  volume_ = std::clamp(volume, 0.0, 1.0);
  std::lock_guard lock(mutex_);
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updateBitPerfectLocked();
}

void AudioPipeline::setDspConfig(const std::string& dspConfigJson) {
  std::lock_guard lock(mutex_);
  dspConfig_ = DspChain::parseConfigJson(dspConfigJson);
  dspChain_.configure(dspConfig_);
  if (outputFormat_.sampleRate > 0 && outputFormat_.channelCount > 0) {
    dspChain_.prepare(outputFormat_);
    dspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
    spectrum_.prepare(outputFormat_, dspConfig_.fftResolution);
  }
  spectrum_.setEnabled(dspConfig_.fftEnabled);
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updateBitPerfectLocked();
}

bool AudioPipeline::setOutputConfig(const OutputConfig& config, std::string* error) {
  std::lock_guard lock(mutex_);
  outputConfig_ = config;
  if (output_ && !output_->setOutputConfig(outputConfig_, error)) return false;
  if (output_) {
    outputInfo_ = output_->outputInfo();
    updateBitPerfectLocked();
  }
  return true;
}

bool AudioPipeline::loadImpulseResponse(const std::string& path, std::string* error) {
  std::lock_guard lock(mutex_);
  const bool ok = dspChain_.loadImpulseResponse(path, error);
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updateBitPerfectLocked();
  return ok;
}

void AudioPipeline::unloadImpulseResponse() {
  std::lock_guard lock(mutex_);
  dspChain_.unloadImpulseResponse();
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updateBitPerfectLocked();
}

ConvolverInfo AudioPipeline::convolverInfo() const {
  return dspChain_.convolverInfo();
}

bool AudioPipeline::setEqBands(const std::string& json, std::string* error) {
  std::lock_guard lock(mutex_);
  const bool ok = dspChain_.setEqBandsFromJson(json, error);
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updateBitPerfectLocked();
  return ok;
}

bool AudioPipeline::setEqPreset(const std::string& json, std::string* error) {
  std::lock_guard lock(mutex_);
  const bool ok = dspChain_.setEqPresetFromJson(json, error);
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updateBitPerfectLocked();
  return ok;
}

void AudioPipeline::setCrossfeedStrength(double strength) {
  std::lock_guard lock(mutex_);
  dspChain_.setCrossfeedStrength(strength);
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updateBitPerfectLocked();
}

void AudioPipeline::setReplayGainMode(ReplayGainMode mode, double preampDb, double fallbackDb, bool clip) {
  std::lock_guard lock(mutex_);
  dspChain_.setReplayGainMode(mode, preampDb, fallbackDb, clip);
  dspStatus_ = dspChain_.status();
  dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
  updateBitPerfectLocked();
}

bool AudioPipeline::preloadNext(const std::optional<QueueItem>& item, std::string* error) {
  if (!item || item->source.empty()) {
    std::shared_ptr<DecodeStream> previous;
    {
      std::lock_guard lock(mutex_);
      previous = std::move(preloadStream_);
    }
    if (previous) previous->stop();
    return true;
  }

  AudioFormat outputFormat;
  bool gapless = false;
  {
    std::lock_guard lock(mutex_);
    if (preloadStream_ && preloadStream_->item.source == item->source) return true;
    outputFormat = outputFormat_;
    gapless = gaplessEnabled_;
  }
  if (!gapless || outputFormat.sampleRate <= 0 || outputFormat.channelCount <= 0) return false;

  auto stream = std::make_shared<DecodeStream>();
  if (!stream->openSource(*item, error)) return false;
  if (!stream->configure(outputFormat, 0.0, error)) return false;
  stream->start();

  std::shared_ptr<DecodeStream> previous;
  {
    std::lock_guard lock(mutex_);
    previous = std::move(preloadStream_);
    preloadStream_ = std::move(stream);
  }
  if (previous) previous->stop();
  return true;
}

bool AudioPipeline::skipToPreloaded(const QueueItem& item, std::string* error) {
  std::shared_ptr<DecodeStream> oldActive;
  {
    std::lock_guard lock(mutex_);
    if (!preloadStream_ || preloadStream_->item.source != item.source) {
      if (error) *error = "下一首尚未完成预加载";
      return false;
    }
    oldActive = std::move(activeStream_);
    activeStream_ = std::move(preloadStream_);
    preloadStream_.reset();
    stream_ = activeStream_->stream;
    currentItem_ = activeStream_->item;
    renderedFrames_ = 0;
    ended_ = false;
    trackStarted_ = true;
    dspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
    dspStatus_ = dspChain_.status();
    dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
    updateBitPerfectLocked();
  }
  if (oldActive) oldActive->stop();
  return true;
}

PipelineStatus AudioPipeline::status() const {
  std::lock_guard lock(mutex_);
  PipelineStatus status;
  status.state = state_;
  status.positionSeconds =
      outputFormat_.sampleRate > 0
          ? static_cast<double>(renderedFrames_.load()) / static_cast<double>(outputFormat_.sampleRate)
          : 0.0;
  status.stream = stream_;
  status.outputFormat = outputFormat_;
  OutputInfo backendInfo = output_ ? output_->outputInfo() : outputInfo_;
  backendInfo.bitPerfect = outputInfo_.bitPerfect;
  backendInfo.resampled = outputInfo_.resampled;
  backendInfo.channelRoutingMode = outputInfo_.channelRoutingMode;
  status.outputInfo = backendInfo;
  status.backendId = backendId_;
  status.deviceName = deviceName_;
  status.currentItem = currentItem_;
  status.dspActive = dspActive_;
  status.replayGainActive = dspStatus_.replayGainActive;
  status.eqActive = dspStatus_.eqActive;
  status.convolverActive = dspStatus_.convolverActive;
  status.crossfeedActive = dspStatus_.crossfeedActive;
  status.fftActive = spectrum_.isActive();
  status.irResampled = dspStatus_.irResampled;
  status.replayGainDb = dspStatus_.replayGainDb;
  status.crossfeedStrength = dspStatus_.crossfeedStrength;
  status.convolverLatencyFrames = dspStatus_.convolverLatencyFrames;
  status.partitionSize = dspStatus_.partitionSize;
  status.channelMappingMode = dspStatus_.channelMappingMode;
  status.bitPerfect = bitPerfect_;
  status.gaplessActive = gaplessEnabled_ && preloadStream_ != nullptr;
  status.preloadReady = preloadStream_ && preloadStream_->readyForRender();
  status.resampleReason = resampleReason_;
  return status;
}

bool AudioPipeline::consumeEnded() {
  return ended_.exchange(false);
}

bool AudioPipeline::consumeDeviceInvalidated(std::string* message) {
  if (!deviceInvalidated_.exchange(false)) return false;
  std::lock_guard lock(mutex_);
  if (message) *message = outputEventMessage_.empty() ? "输出设备已失效" : outputEventMessage_;
  outputEventMessage_.clear();
  return true;
}

bool AudioPipeline::consumeTrackStarted(QueueItem* item) {
  if (!trackStarted_.exchange(false)) return false;
  std::lock_guard lock(mutex_);
  if (item) *item = currentItem_;
  return true;
}

size_t AudioPipeline::getSpectrumData(float* buffer, size_t pointCount) const {
  const double phase =
      outputFormat_.sampleRate > 0
          ? static_cast<double>(renderedFrames_.load()) / static_cast<double>(outputFormat_.sampleRate)
          : 0.0;
  return spectrum_.read(buffer, pointCount, phase);
}

bool AudioPipeline::configureActiveStreamLocked(
    const std::shared_ptr<DecodeStream>& stream,
    const QueueItem& item,
    double startTimeSeconds,
    std::string* error) {
  if (!stream) return false;
  if (!stream->openSource(item, error)) return false;
  if (!stream->configure(outputFormat_, startTimeSeconds, error)) return false;
  return true;
}

bool AudioPipeline::updateBitPerfectLocked() {
  AudioFormat semanticOutputFormat = outputFormat_;
  if (outputInfo_.actualChannels > 0) semanticOutputFormat.channelCount = outputInfo_.actualChannels;
  const bool backendResampled = output_ ? output_->outputInfo().resampled : outputInfo_.resampled;
  const BitPerfectResult result = evaluateBitPerfect(BitPerfectEvaluation{
      stream_.sourceFormat,
      semanticOutputFormat,
      outputInfo_.supportsBitPerfect,
      backendResampled,
      volume_.load(),
      dspStatus_.replayGainActive,
      dspStatus_.eqActive,
      dspStatus_.convolverActive,
      dspStatus_.crossfeedActive,
      outputConfig_.routingMode});
  dspActive_ = result.processingActive;
  bitPerfect_ = result.bitPerfect;
  outputInfo_.resampled = result.resampled;
  outputInfo_.bitPerfect = bitPerfect_;
  outputInfo_.channelRoutingMode = channelRoutingModeToString(outputConfig_.routingMode);
  resampleReason_ = result.resampleReason;
  return bitPerfect_;
}

size_t AudioPipeline::render(float* output, size_t frameCount) {
  if (!output || frameCount == 0) return 0;

  PipelineState state = PipelineState::Stopped;
  int channels = 0;
  std::shared_ptr<DecodeStream> active;
  {
    std::lock_guard lock(mutex_);
    state = state_;
    channels = std::max(1, outputFormat_.channelCount);
    active = activeStream_;
  }

  std::fill(output, output + frameCount * static_cast<size_t>(channels), 0.0f);
  if (state != PipelineState::Playing || !active) {
    spectrum_.capture(output, frameCount, channels);
    return frameCount;
  }

  size_t totalRead = 0;
  size_t positionRead = 0;
  while (totalRead < frameCount) {
    float* segment = output + totalRead * static_cast<size_t>(channels);
    const size_t read = active->read(segment, frameCount - totalRead);
    if (read > 0) {
      dspChain_.process(segment, read);
    }
    totalRead += read;
    positionRead += read;

    if (totalRead >= frameCount || !active->drained()) break;

    std::shared_ptr<DecodeStream> next;
    std::shared_ptr<DecodeStream> oldActive;
    {
      std::lock_guard lock(mutex_);
      if (!gaplessEnabled_ || !preloadStream_ || !preloadStream_->readyForRender()) {
        break;
      }
      oldActive = activeStream_;
      activeStream_ = preloadStream_;
      preloadStream_.reset();
      active = activeStream_;
      next = activeStream_;
      stream_ = activeStream_->stream;
      currentItem_ = activeStream_->item;
      renderedFrames_ = 0;
      positionRead = 0;
      ended_ = false;
      trackStarted_ = true;
      dspChain_.setTrackContext(DspTrackContext{stream_, currentItem_});
      dspStatus_ = dspChain_.status();
      dspActive_ = dspStatus_.dspActive || std::abs(volume_.load() - 1.0) > 0.0001;
      updateBitPerfectLocked();
    }
    if (oldActive) oldActive->stop();
    if (!next) break;
  }

  const double volume = volume_.load();
  if (std::abs(volume - 1.0) > 0.0001) {
    const size_t sampleCount = frameCount * static_cast<size_t>(channels);
    for (size_t i = 0; i < sampleCount; ++i) {
      output[i] = static_cast<float>(std::clamp(static_cast<double>(output[i]) * volume, -1.0, 1.0));
    }
  }

  if (positionRead > 0) {
    renderedFrames_ += positionRead;
  } else if (active->drained()) {
    ended_ = true;
    std::lock_guard lock(mutex_);
    if (state_ == PipelineState::Playing) state_ = PipelineState::Stopped;
  }

  spectrum_.capture(output, frameCount, channels);
  return frameCount;
}

}  // namespace twilight::audio
