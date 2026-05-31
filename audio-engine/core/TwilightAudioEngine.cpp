#include "TwilightAudioEngine.h"

#include "../metadata/AudioMetadataService.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <memory>
#include <optional>
#include <sstream>

namespace twilight::audio {

std::string enumeratePlatformDevicesJson();

namespace {

const char* stateToString(PlaybackState state) {
  switch (state) {
    case PlaybackState::Playing:
      return "playing";
    case PlaybackState::Paused:
      return "paused";
    case PlaybackState::Stopped:
    default:
      return "stopped";
  }
}

std::string escapeJson(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (char ch : value) {
    switch (ch) {
      case '\\':
        out += "\\\\";
        break;
      case '"':
        out += "\\\"";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        out += ch;
        break;
    }
  }
  return out;
}

std::string inferCodec(const std::string& source) {
  const auto dot = source.find_last_of('.');
  if (dot == std::string::npos) return "未知";
  std::string ext = source.substr(dot + 1);
  std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  if (ext == "m4a" || ext == "mp4") return "aac/alac";
  if (ext == "aif" || ext == "aiff") return "aiff";
  if (ext == "dsf" || ext == "dff") return "dsd";
  return ext;
}

std::string playbackInfoToJson(const PlaybackInfo& info) {
  std::ostringstream json;
  json << "{"
       << "\"state\":\"" << stateToString(info.state) << "\","
       << "\"position\":" << info.positionSeconds << ","
       << "\"duration\":" << info.durationSeconds << ","
       << "\"volume\":" << info.volume << ","
       << "\"queueIndex\":" << info.queueIndex << ","
       << "\"playMode\":\"" << escapeJson(info.playMode) << "\","
       << "\"source\":\"" << escapeJson(info.source) << "\","
       << "\"codec\":\"" << escapeJson(info.codec) << "\","
       << "\"bitrate\":" << info.bitrate << ","
       << "\"sourceSampleRate\":" << info.sourceSampleRate << ","
       << "\"sourceBitDepth\":" << info.sourceBitDepth << ","
       << "\"outputBackend\":\"" << escapeJson(info.outputBackend) << "\","
       << "\"outputDevice\":\"" << escapeJson(info.outputDevice) << "\","
       << "\"outputInfo\":{"
       << "\"exclusive\":" << (info.outputInfo.exclusive ? "true" : "false") << ","
       << "\"bitPerfect\":" << (info.outputInfo.bitPerfect ? "true" : "false") << ","
       << "\"resampled\":" << (info.outputInfo.resampled ? "true" : "false") << ","
       << "\"outputSampleRate\":" << info.outputInfo.outputSampleRate << ","
       << "\"outputBitDepth\":" << info.outputInfo.outputBitDepth << ","
       << "\"backend\":\"" << escapeJson(info.outputInfo.backend) << "\","
       << "\"deviceName\":\"" << escapeJson(info.outputInfo.deviceName) << "\""
       << "},"
       << "\"outputSampleRate\":" << info.outputSampleRate << ","
       << "\"outputBitDepth\":" << info.outputBitDepth << ","
       << "\"channelCount\":" << info.channelCount << ","
       << "\"bitPerfect\":" << (info.bitPerfect ? "true" : "false") << ","
       << "\"dspActive\":" << (info.dspActive ? "true" : "false") << ","
       << "\"replayGainActive\":" << (info.replayGainActive ? "true" : "false") << ","
       << "\"eqActive\":" << (info.eqActive ? "true" : "false") << ","
       << "\"convolverActive\":" << (info.convolverActive ? "true" : "false") << ","
       << "\"crossfeedActive\":" << (info.crossfeedActive ? "true" : "false") << ","
       << "\"fftActive\":" << (info.fftActive ? "true" : "false") << ","
       << "\"irResampled\":" << (info.irResampled ? "true" : "false") << ","
       << "\"replayGainDb\":" << info.replayGainDb << ","
       << "\"crossfeedStrength\":" << info.crossfeedStrength << ","
       << "\"convolverLatencyFrames\":" << info.convolverLatencyFrames << ","
       << "\"partitionSize\":" << info.partitionSize << ","
       << "\"channelMappingMode\":\"" << escapeJson(info.channelMappingMode) << "\","
       << "\"resampleReason\":\"" << escapeJson(info.resampleReason) << "\","
       << "\"dsdMode\":\"" << escapeJson(info.dsdMode) << "\","
       << "\"gaplessActive\":" << (info.gaplessActive ? "true" : "false") << ","
       << "\"preloadReady\":" << (info.preloadReady ? "true" : "false") << ","
       << "\"upcomingTrack\":"
       << QueueManager::itemToJson(info.hasUpcomingTrack ? std::optional<QueueItem>(info.upcomingTrack) : std::nullopt)
       << "}";
  return json.str();
}

DspStatus configuredDspStatusFromConfig(const DspConfig& config) {
  DspStatus status;
  if (!config.enabled) return status;
  status.replayGainActive = config.replayGainMode != ReplayGainMode::Off;
  status.eqActive = config.eqEnabled;
  status.crossfeedActive = config.crossfeedEnabled && config.crossfeedStrength > 0.0001;
  status.crossfeedStrength = status.crossfeedActive ? config.crossfeedStrength : 0.0;
  status.dspActive = status.replayGainActive || status.eqActive || status.convolverActive || status.crossfeedActive;
  return status;
}

ReplayGainMode parseReplayGainModeId(const std::string& mode) {
  std::string normalized = mode;
  std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  if (normalized == "track" || normalized == "loudnorm") return ReplayGainMode::Track;
  if (normalized == "album") return ReplayGainMode::Album;
  return ReplayGainMode::Off;
}

std::string convolverInfoToJson(const ConvolverInfo& info) {
  std::ostringstream json;
  json << "{"
       << "\"loaded\":" << (info.loaded ? "true" : "false") << ","
       << "\"active\":" << (info.active ? "true" : "false") << ","
       << "\"irResampled\":" << (info.irResampled ? "true" : "false") << ","
       << "\"path\":\"" << escapeJson(info.path) << "\","
       << "\"sampleRate\":" << info.sampleRate << ","
       << "\"channels\":" << info.channels << ","
       << "\"lengthFrames\":" << info.lengthFrames << ","
       << "\"lengthMs\":" << info.lengthMs << ","
       << "\"partitionSize\":" << info.partitionSize << ","
       << "\"latencyFrames\":" << info.latencyFrames << ","
       << "\"channelMappingMode\":\"" << escapeJson(info.channelMappingMode) << "\","
       << "\"warning\":\"" << escapeJson(info.warning) << "\","
       << "\"lastError\":\"" << escapeJson(info.lastError) << "\""
       << "}";
  return json.str();
}

DspStatus configuredDspStatus(const std::string& dspJson) {
  const DspConfig config = DspChain::parseConfigJson(dspJson);
  return configuredDspStatusFromConfig(config);
}

bool gaplessEnabledFromConfig(const std::string& dspJson) {
  if (dspJson.find("\"gapless\":false") != std::string::npos) return false;
  const std::string key = "\"crossfadeSeconds\":";
  const size_t pos = dspJson.find(key);
  if (pos == std::string::npos) return true;
  const size_t valueStart = pos + key.size();
  return dspJson.compare(valueStart, 1, "0") == 0;
}

QueueItem makeManualQueueItem(const std::string& source) {
  QueueItem item;
  item.id = "manual";
  item.source = source;
  item.title = source;
  return item;
}

}  // namespace

TwilightAudioEngine::TwilightAudioEngine() {
  pipeline_ = std::make_unique<AudioPipeline>();
#if defined(_WIN32)
  info_.outputBackend = "wasapi";
#elif defined(__APPLE__)
  info_.outputBackend = "coreaudio";
#else
  info_.outputBackend = "alsa";
#endif
  info_.outputInfo.backend = info_.outputBackend;
  info_.outputInfo.exclusive = info_.outputBackend == "wasapi-exclusive";
  info_.resampleReason = info_.outputInfo.exclusive ? "" : "共享输出经过系统混音";
  updateBitPerfectLocked();
  lastTick_ = std::chrono::steady_clock::now();
  startClock();
}

TwilightAudioEngine::~TwilightAudioEngine() {
  if (pipeline_) pipeline_->stop();
  stopClock();
}

void TwilightAudioEngine::setEventCallback(TAE_EventCallback callback, void* userData) {
  std::lock_guard lock(mutex_);
  eventCallback_ = callback;
  eventUserData_ = userData;
}

TAE_Result TwilightAudioEngine::play(const std::string& source, double startTimeSeconds) {
  if (source.empty()) return TAE_RESULT_INVALID_ARGUMENT;

  std::string backend;
  std::string device;
  double volume = 1.0;
  std::string dspConfigJson;
  bool gaplessEnabled = true;
  QueueItem item;
  std::optional<QueueItem> upcoming;
  {
    std::lock_guard lock(mutex_);
    if (queue_.empty()) {
      item = makeManualQueueItem(source);
      info_.queueIndex = 0;
    } else {
      item = queue_.current().value_or(makeManualQueueItem(source));
      if (item.source.empty() || item.source != source) item.source = source;
      info_.queueIndex = queue_.currentIndex();
    }
    upcoming = queue_.upcoming();
    info_.source = item.source;
    info_.positionSeconds = std::max(0.0, startTimeSeconds);
    info_.durationSeconds = item.durationSeconds;
    info_.codec = inferCodec(item.source);
    info_.state = PlaybackState::Playing;
    info_.dsdMode = info_.codec == "dsd" ? "native-pending" : "pcm";
    info_.playMode = queue_.playModeId();
    info_.hasUpcomingTrack = upcoming.has_value();
    info_.upcomingTrack = upcoming.value_or(QueueItem{});
    backend = info_.outputBackend;
    device = info_.outputDevice;
    volume = info_.volume;
    dspConfigJson = dspConfigJson_;
    gaplessEnabled = gaplessEnabledFromConfig(dspConfigJson_);
  }

  std::string error;
  const TAE_Result result =
      pipeline_ ? pipeline_->play(item, upcoming, startTimeSeconds, backend, device, volume, dspConfigJson, gaplessEnabled, &error)
                : TAE_RESULT_NOT_INITIALIZED;
  if (result != TAE_RESULT_OK) {
    {
      std::lock_guard lock(mutex_);
      info_.state = PlaybackState::Stopped;
      info_.positionSeconds = 0.0;
    }
    emitError(error.empty() ? "无法启动原生音频播放" : error);
    return result;
  }

  std::lock_guard lock(mutex_);
  applyPipelineStatusLocked(pipeline_->status());
  lastTick_ = std::chrono::steady_clock::now();
  publishStateLocked();
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::pause() {
  if (pipeline_) pipeline_->togglePause();
  std::lock_guard lock(mutex_);
  if (pipeline_) {
    applyPipelineStatusLocked(pipeline_->status());
  } else {
    info_.state = info_.state == PlaybackState::Paused ? PlaybackState::Playing : PlaybackState::Paused;
  }
  lastTick_ = std::chrono::steady_clock::now();
  publishStateLocked();
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::stop() {
  if (pipeline_) pipeline_->stop();
  std::lock_guard lock(mutex_);
  info_.state = PlaybackState::Stopped;
  info_.positionSeconds = 0.0;
  publishStateLocked();
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::seek(double positionSeconds) {
  if (!std::isfinite(positionSeconds)) return TAE_RESULT_INVALID_ARGUMENT;
  std::string error;
  PlaybackState currentState = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    currentState = info_.state;
  }
  if (pipeline_ && currentState != PlaybackState::Stopped) {
    const TAE_Result result = pipeline_->seek(positionSeconds, &error);
    if (result != TAE_RESULT_OK) {
      emitError(error.empty() ? "无法跳转原生音频播放位置" : error);
      return result;
    }
  }
  std::lock_guard lock(mutex_);
  if (pipeline_) {
    applyPipelineStatusLocked(pipeline_->status());
  } else {
    info_.positionSeconds = std::max(0.0, positionSeconds);
  }
  lastTick_ = std::chrono::steady_clock::now();
  publishStateLocked();
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::setVolume(double volume) {
  if (!std::isfinite(volume)) return TAE_RESULT_INVALID_ARGUMENT;
  std::lock_guard lock(mutex_);
  info_.volume = std::clamp(volume, 0.0, 1.0);
  if (pipeline_) pipeline_->setVolume(info_.volume);
  if (pipeline_ && info_.state != PlaybackState::Stopped) {
    applyPipelineStatusLocked(pipeline_->status());
  } else {
    updateBitPerfectLocked();
  }
  publishStateLocked();
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::setOutputDevice(const std::string& deviceId) {
  std::string source;
  double position = 0.0;
  PlaybackState state = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    info_.outputDevice = deviceId.empty() ? "auto" : deviceId;
    source = info_.source;
    position = info_.positionSeconds;
    state = info_.state;
    publishStateLocked();
  }
  if (state != PlaybackState::Stopped && !source.empty()) {
    const TAE_Result result = play(source, position);
    if (result == TAE_RESULT_OK && state == PlaybackState::Paused) pause();
    return result;
  }
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::setOutputBackend(const std::string& backendId) {
  if (backendId.empty()) return TAE_RESULT_INVALID_ARGUMENT;
  std::string source;
  double position = 0.0;
  PlaybackState state = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    info_.outputBackend = backendId == "wasapi-shared" ? "wasapi" : backendId;
    source = info_.source;
    position = info_.positionSeconds;
    state = info_.state;
    updateBitPerfectLocked();
    publishStateLocked();
  }
  if (state != PlaybackState::Stopped && !source.empty()) {
    const TAE_Result result = play(source, position);
    if (result == TAE_RESULT_OK && state == PlaybackState::Paused) pause();
    return result;
  }
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::loadQueue(const std::string& queueJson, int startIndex) {
  std::string error;
  std::lock_guard lock(mutex_);
  if (!queue_.loadFromJson(queueJson, startIndex, &error)) {
    emitError(error.empty() ? "播放队列加载失败" : error);
    return TAE_RESULT_INVALID_ARGUMENT;
  }
  info_.queueIndex = queue_.currentIndex();
  info_.playMode = queue_.playModeId();
  const auto upcoming = queue_.upcoming();
  info_.hasUpcomingTrack = upcoming.has_value();
  info_.upcomingTrack = upcoming.value_or(QueueItem{});
  emit("queue-change", queue_.queueJson());
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::addToQueue(const std::string& itemJson) {
  std::string error;
  std::lock_guard lock(mutex_);
  if (!queue_.addFromJson(itemJson, &error)) {
    emitError(error.empty() ? "无法加入播放队列" : error);
    return TAE_RESULT_INVALID_ARGUMENT;
  }
  emit("queue-change", queue_.queueJson());
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::removeFromQueue(int index) {
  std::lock_guard lock(mutex_);
  if (!queue_.removeAt(index)) return TAE_RESULT_INVALID_ARGUMENT;
  info_.queueIndex = queue_.currentIndex();
  emit("queue-change", queue_.queueJson());
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::next() {
  std::optional<QueueItem> item;
  std::optional<QueueItem> upcoming;
  PlaybackState state = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    item = queue_.next();
    if (!item) return TAE_RESULT_OK;
    upcoming = queue_.upcoming();
    state = info_.state;
    info_.queueIndex = queue_.currentIndex();
    info_.positionSeconds = 0.0;
    info_.source = item->source;
    info_.durationSeconds = item->durationSeconds;
    info_.codec = inferCodec(item->source);
    info_.hasUpcomingTrack = upcoming.has_value();
    info_.upcomingTrack = upcoming.value_or(QueueItem{});
    publishStateLocked();
  }

  if (state != PlaybackState::Stopped && item) {
    std::string error;
    bool usedPreload = pipeline_ && pipeline_->skipToPreloaded(*item, &error);
    if (usedPreload) {
      if (pipeline_) pipeline_->consumeTrackStarted(nullptr);
      if (pipeline_) pipeline_->preloadNext(upcoming, &error);
      std::lock_guard lock(mutex_);
      applyPipelineStatusLocked(pipeline_->status());
      publishStateLocked();
    } else {
      const TAE_Result result = play(item->source, 0.0);
      if (result != TAE_RESULT_OK) return result;
    }
  }
  emit("next", getPlaybackInfoJson());
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::previous() {
  std::optional<QueueItem> item;
  PlaybackState state = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    item = queue_.previous();
    if (!item) return TAE_RESULT_OK;
    state = info_.state;
    info_.queueIndex = queue_.currentIndex();
    info_.positionSeconds = 0.0;
    info_.source = item->source;
    info_.durationSeconds = item->durationSeconds;
    info_.codec = inferCodec(item->source);
    const auto upcoming = queue_.upcoming();
    info_.hasUpcomingTrack = upcoming.has_value();
    info_.upcomingTrack = upcoming.value_or(QueueItem{});
    publishStateLocked();
  }

  if (state != PlaybackState::Stopped && item) {
    const TAE_Result result = play(item->source, 0.0);
    if (result != TAE_RESULT_OK) return result;
  }
  emit("previous", getPlaybackInfoJson());
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::setPlayMode(const std::string& mode) {
  std::optional<QueueItem> upcoming;
  {
    std::lock_guard lock(mutex_);
    queue_.setPlayMode(QueueManager::parsePlayMode(mode));
    info_.playMode = queue_.playModeId();
    info_.queueIndex = queue_.currentIndex();
    upcoming = queue_.upcoming();
    info_.hasUpcomingTrack = upcoming.has_value();
    info_.upcomingTrack = upcoming.value_or(QueueItem{});
    publishStateLocked();
  }
  std::string error;
  if (pipeline_) pipeline_->preloadNext(upcoming, &error);
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::setDspConfig(const std::string& dspJson) {
  std::lock_guard lock(mutex_);
  dspConfigJson_ = dspJson.empty() ? "{}" : dspJson;
  if (pipeline_) pipeline_->setDspConfig(dspConfigJson_);
  if (pipeline_ && info_.state != PlaybackState::Stopped) {
    applyPipelineStatusLocked(pipeline_->status());
  } else {
    const DspConfig config = DspChain::parseConfigJson(dspConfigJson_);
    const DspStatus configStatus = configuredDspStatusFromConfig(config);
    info_.replayGainActive = configStatus.replayGainActive;
    info_.eqActive = configStatus.eqActive;
    info_.crossfeedActive = configStatus.crossfeedActive;
    info_.crossfeedStrength = configStatus.crossfeedStrength;
    if (!config.enabled) info_.convolverActive = false;
    updateBitPerfectLocked();
  }
  publishStateLocked();
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::loadImpulseResponse(const std::string& path) {
  if (path.empty()) return TAE_RESULT_INVALID_ARGUMENT;
  std::string error;
  if (!pipeline_ || !pipeline_->loadImpulseResponse(path, &error)) {
    emitError(error.empty() ? "脉冲响应加载失败" : error);
    return TAE_RESULT_INTERNAL_ERROR;
  }
  {
    std::lock_guard lock(mutex_);
    const PipelineStatus status = pipeline_->status();
    info_.convolverActive = status.convolverActive;
    info_.irResampled = status.irResampled;
    info_.convolverLatencyFrames = status.convolverLatencyFrames;
    info_.partitionSize = status.partitionSize;
    info_.channelMappingMode = status.channelMappingMode;
    info_.dspActive = status.dspActive || std::abs(info_.volume - 1.0) > 0.0001;
    updateBitPerfectLocked();
    publishStateLocked();
  }
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::unloadImpulseResponse() {
  if (!pipeline_) return TAE_RESULT_NOT_INITIALIZED;
  pipeline_->unloadImpulseResponse();
  {
    std::lock_guard lock(mutex_);
    info_.convolverActive = false;
    info_.irResampled = false;
    info_.convolverLatencyFrames = 0;
    info_.partitionSize = 0;
    info_.channelMappingMode.clear();
    updateBitPerfectLocked();
    publishStateLocked();
  }
  return TAE_RESULT_OK;
}

std::string TwilightAudioEngine::getConvolverInfoJson() const {
  return convolverInfoToJson(pipeline_ ? pipeline_->convolverInfo() : ConvolverInfo{});
}

TAE_Result TwilightAudioEngine::setEqBands(const std::string& eqJson) {
  std::string error;
  if (!pipeline_ || !pipeline_->setEqBands(eqJson, &error)) {
    emitError(error.empty() ? "均衡器设置失败" : error);
    return TAE_RESULT_INVALID_ARGUMENT;
  }
  std::lock_guard lock(mutex_);
  const PipelineStatus status = pipeline_->status();
  info_.eqActive = status.eqActive;
  info_.dspActive = status.dspActive || std::abs(info_.volume - 1.0) > 0.0001;
  updateBitPerfectLocked();
  publishStateLocked();
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::setEqPreset(const std::string& presetJson) {
  std::string error;
  if (!pipeline_ || !pipeline_->setEqPreset(presetJson, &error)) {
    emitError(error.empty() ? "均衡器预设应用失败" : error);
    return TAE_RESULT_INVALID_ARGUMENT;
  }
  std::lock_guard lock(mutex_);
  const PipelineStatus status = pipeline_->status();
  info_.eqActive = status.eqActive;
  info_.dspActive = status.dspActive || std::abs(info_.volume - 1.0) > 0.0001;
  updateBitPerfectLocked();
  publishStateLocked();
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::setCrossfeedStrength(double strength) {
  if (!std::isfinite(strength)) return TAE_RESULT_INVALID_ARGUMENT;
  if (!pipeline_) return TAE_RESULT_NOT_INITIALIZED;
  pipeline_->setCrossfeedStrength(strength);
  std::lock_guard lock(mutex_);
  const PipelineStatus status = pipeline_->status();
  info_.crossfeedActive = status.crossfeedActive;
  info_.crossfeedStrength = status.crossfeedStrength;
  info_.dspActive = status.dspActive || std::abs(info_.volume - 1.0) > 0.0001;
  updateBitPerfectLocked();
  publishStateLocked();
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::setReplayGainMode(
    const std::string& mode,
    double preampDb,
    double fallbackDb,
    bool clip) {
  if (!std::isfinite(preampDb) || !std::isfinite(fallbackDb)) return TAE_RESULT_INVALID_ARGUMENT;
  if (!pipeline_) return TAE_RESULT_NOT_INITIALIZED;
  pipeline_->setReplayGainMode(parseReplayGainModeId(mode), preampDb, fallbackDb, clip);
  std::lock_guard lock(mutex_);
  const PipelineStatus status = pipeline_->status();
  info_.replayGainActive = status.replayGainActive;
  info_.replayGainDb = status.replayGainDb;
  info_.dspActive = status.dspActive || std::abs(info_.volume - 1.0) > 0.0001;
  updateBitPerfectLocked();
  publishStateLocked();
  return TAE_RESULT_OK;
}

std::string TwilightAudioEngine::getDspConfig() const {
  std::lock_guard lock(mutex_);
  return dspConfigJson_;
}

std::string TwilightAudioEngine::getMetadataJson(const std::string& source) const {
  return readMetadataJson(source);
}

std::string TwilightAudioEngine::getQueueJson() const {
  std::lock_guard lock(mutex_);
  return queue_.queueJson();
}

std::string TwilightAudioEngine::getUpcomingTrackJson() const {
  std::lock_guard lock(mutex_);
  return queue_.upcomingJson();
}

std::string TwilightAudioEngine::enumerateDevicesJson() const {
  return enumeratePlatformDevicesJson();
}

std::string TwilightAudioEngine::enumerateBackendsJson() const {
#if defined(_WIN32)
  return "[{\"id\":\"wasapi\",\"label\":\"共享输出\",\"supportsExclusive\":false},"
         "{\"id\":\"wasapi-exclusive\",\"label\":\"独占输出\",\"supportsExclusive\":true},"
         "{\"id\":\"asio\",\"label\":\"专业声卡输出\",\"supportsExclusive\":true,\"optional\":true}]";
#elif defined(__APPLE__)
  return "[{\"id\":\"coreaudio\",\"label\":\"苹果系统音频\",\"supportsExclusive\":true}]";
#else
  return "[{\"id\":\"alsa\",\"label\":\"系统音频\",\"supportsExclusive\":false}]";
#endif
}

std::string TwilightAudioEngine::getPlaybackInfoJson() const {
  std::lock_guard lock(mutex_);
  return playbackInfoToJson(info_);
}

size_t TwilightAudioEngine::getSpectrumData(float* buffer, size_t pointCount) const {
  if (!buffer || pointCount == 0) return 0;
  if (pipeline_) {
    const size_t written = pipeline_->getSpectrumData(buffer, pointCount);
    if (written > 0) return written;
  }
  std::lock_guard lock(mutex_);
  const double phase = info_.positionSeconds;
  for (size_t i = 0; i < pointCount; ++i) {
    const double x = static_cast<double>(i) / static_cast<double>(pointCount);
    buffer[i] = static_cast<float>((std::sin((x * 18.0 + phase) * 3.14159) + 1.0) * 0.25);
  }
  return pointCount;
}

void TwilightAudioEngine::startClock() {
  clockThread_ = std::thread([this] { clockLoop(); });
}

void TwilightAudioEngine::stopClock() {
  running_ = false;
  if (clockThread_.joinable()) clockThread_.join();
}

void TwilightAudioEngine::clockLoop() {
  while (running_) {
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    std::string payload;
    bool emitTick = false;
    bool emitEnded = false;
    PipelineStatus pipelineStatus;
    const bool hasPipelineStatus = pipeline_ != nullptr;
    bool deviceInvalidated = false;
    bool trackStarted = false;
    QueueItem startedItem;
    std::string deviceInvalidatedMessage;
    if (hasPipelineStatus) {
      pipelineStatus = pipeline_->status();
      emitEnded = pipeline_->consumeEnded();
      deviceInvalidated = pipeline_->consumeDeviceInvalidated(&deviceInvalidatedMessage);
      trackStarted = pipeline_->consumeTrackStarted(&startedItem);
    }
    if (deviceInvalidated) {
      std::string source;
      double position = 0.0;
      PlaybackState previousState = PlaybackState::Stopped;
      bool recover = false;
      {
        std::lock_guard lock(mutex_);
        previousState = info_.state;
        if (hasPipelineStatus) {
          info_.positionSeconds = pipelineStatus.positionSeconds;
          info_.durationSeconds = pipelineStatus.stream.durationSeconds;
          info_.source = pipelineStatus.stream.source.empty() ? info_.source : pipelineStatus.stream.source;
        }
        source = info_.source;
        position = info_.positionSeconds;
        recover = info_.outputDevice == "auto" && !source.empty() && previousState != PlaybackState::Stopped;
        if (!recover) {
          info_.state = PlaybackState::Stopped;
          payload = playbackInfoToJson(info_);
          emitTick = true;
        }
      }
      if (recover) {
        const TAE_Result result = play(source, position);
        if (result == TAE_RESULT_OK && previousState == PlaybackState::Paused) {
          pause();
        } else if (result != TAE_RESULT_OK) {
          emitError(deviceInvalidatedMessage.empty() ? "输出设备已失效，自动恢复失败" : deviceInvalidatedMessage);
        }
      } else {
        if (pipeline_) pipeline_->stop();
        emitError(deviceInvalidatedMessage.empty() ? "输出设备已失效" : deviceInvalidatedMessage);
        if (emitTick) emit("property-change", payload);
      }
      continue;
    }
    if (trackStarted) {
      std::optional<QueueItem> upcoming;
      {
        std::lock_guard lock(mutex_);
        queue_.advanceAfterEnd();
        applyPipelineStatusLocked(pipelineStatus);
        info_.queueIndex = queue_.currentIndex();
        info_.playMode = queue_.playModeId();
        upcoming = queue_.upcoming();
        info_.hasUpcomingTrack = upcoming.has_value();
        info_.upcomingTrack = upcoming.value_or(QueueItem{});
        payload = playbackInfoToJson(info_);
        emitTick = true;
      }
      std::string preloadError;
      if (pipeline_) pipeline_->preloadNext(upcoming, &preloadError);
      if (emitTick) emit("property-change", payload);
      emit("start-file", "{}");
      continue;
    }
    {
      std::lock_guard lock(mutex_);
      if (hasPipelineStatus && info_.state != PlaybackState::Stopped) {
        applyPipelineStatusLocked(pipelineStatus);
      }
      if (emitEnded) {
        info_.state = PlaybackState::Stopped;
        if (info_.durationSeconds > 0.0) info_.positionSeconds = info_.durationSeconds;
      }
      if (info_.state == PlaybackState::Playing || info_.state == PlaybackState::Paused || emitEnded) {
        payload = playbackInfoToJson(info_);
        emitTick = true;
      }
    }
    if (emitTick) emit("property-change", payload);
    if (emitEnded) emit("end-file", "{\"reason\":\"eof\"}");
  }
}

void TwilightAudioEngine::emit(const char* type, const std::string& payload) const {
  TAE_EventCallback callback = eventCallback_;
  void* userData = eventUserData_;
  if (callback) callback(type, payload.c_str(), userData);
}

void TwilightAudioEngine::emitError(const std::string& message) const {
  emit("error", "{\"message\":\"" + escapeJson(message) + "\"}");
}

void TwilightAudioEngine::publishStateLocked() const {
  emit("playback-info", playbackInfoToJson(info_));
}

void TwilightAudioEngine::applyPipelineStatusLocked(const PipelineStatus& status) {
  switch (status.state) {
    case PipelineState::Playing:
      info_.state = PlaybackState::Playing;
      break;
    case PipelineState::Paused:
      info_.state = PlaybackState::Paused;
      break;
    case PipelineState::Stopped:
    default:
      info_.state = PlaybackState::Stopped;
      break;
  }

  info_.positionSeconds = status.positionSeconds;
  info_.durationSeconds = status.stream.durationSeconds;
  info_.source = status.stream.source.empty() ? info_.source : status.stream.source;
  info_.codec = status.stream.codec.empty() ? info_.codec : status.stream.codec;
  info_.bitrate = static_cast<int>(std::max<int64_t>(0, status.stream.bitrate));
  info_.sourceSampleRate = status.stream.sourceFormat.sampleRate;
  info_.sourceBitDepth = status.stream.sourceFormat.bitDepth;
  info_.queueIndex = queue_.currentIndex();
  info_.playMode = queue_.playModeId();
  info_.outputBackend = status.backendId.empty() ? info_.outputBackend : status.backendId;
  (void)status.deviceName;
  info_.outputSampleRate = status.outputFormat.sampleRate;
  info_.outputBitDepth = status.outputFormat.bitDepth;
  info_.outputInfo = status.outputInfo;
  info_.outputInfo.bitPerfect = status.bitPerfect;
  if (info_.outputInfo.backend.empty()) info_.outputInfo.backend = info_.outputBackend;
  if (info_.outputInfo.deviceName.empty()) info_.outputInfo.deviceName = status.deviceName;
  info_.channelCount = status.outputFormat.channelCount;
  info_.bitPerfect = status.bitPerfect;
  info_.dspActive = status.dspActive;
  info_.replayGainActive = status.replayGainActive;
  info_.eqActive = status.eqActive;
  info_.convolverActive = status.convolverActive;
  info_.crossfeedActive = status.crossfeedActive;
  info_.fftActive = status.fftActive;
  info_.irResampled = status.irResampled;
  info_.replayGainDb = status.replayGainDb;
  info_.crossfeedStrength = status.crossfeedStrength;
  info_.convolverLatencyFrames = status.convolverLatencyFrames;
  info_.partitionSize = status.partitionSize;
  info_.channelMappingMode = status.channelMappingMode;
  info_.gaplessActive = status.gaplessActive;
  info_.preloadReady = status.preloadReady;
  const auto upcoming = queue_.upcoming();
  info_.hasUpcomingTrack = upcoming.has_value();
  info_.upcomingTrack = upcoming.value_or(QueueItem{});
  info_.resampleReason = status.resampleReason;
  info_.dsdMode = status.stream.isDsd ? "dsd-to-pcm-pending-native" : "pcm";
}

void TwilightAudioEngine::updateBitPerfectLocked() {
  const bool moduleDspActive =
      info_.replayGainActive || info_.eqActive || info_.convolverActive || info_.crossfeedActive;
  info_.dspActive = moduleDspActive || std::abs(info_.volume - 1.0) > 0.0001;
  const bool exclusive = info_.outputBackend == "wasapi-exclusive";
  info_.outputInfo.exclusive = exclusive;
  info_.outputInfo.backend = info_.outputBackend;
  info_.outputInfo.outputSampleRate = info_.outputSampleRate;
  info_.outputInfo.outputBitDepth = info_.outputBitDepth;
  info_.bitPerfect = !info_.dspActive && exclusive;
  info_.outputInfo.bitPerfect = info_.bitPerfect;
  info_.outputInfo.resampled = false;
  info_.resampleReason = exclusive ? "" : "共享输出经过系统混音";
}

QueueItem TwilightAudioEngine::currentItemLocked() const {
  return queue_.current().value_or(QueueItem{});
}

}  // namespace twilight::audio

using twilight::audio::TwilightAudioEngine;

namespace {

TwilightAudioEngine* fromHandle(TAE_EngineHandle handle) {
  return static_cast<TwilightAudioEngine*>(handle);
}

TAE_Result copyStringResult(const std::string& value, char* buffer, size_t bufferSize, size_t* requiredSize) {
  const size_t required = value.size() + 1;
  if (requiredSize) *requiredSize = required;
  if (!buffer || bufferSize == 0) return TAE_RESULT_OK;
  if (bufferSize < required) return TAE_RESULT_INVALID_ARGUMENT;
  std::memcpy(buffer, value.c_str(), required);
  return TAE_RESULT_OK;
}

}  // namespace

extern "C" {

TAE_Result TAE_CreateEngine(TAE_EngineHandle* out_engine) {
  if (!out_engine) return TAE_RESULT_INVALID_ARGUMENT;
  try {
    *out_engine = new TwilightAudioEngine();
    return TAE_RESULT_OK;
  } catch (...) {
    *out_engine = nullptr;
    return TAE_RESULT_INTERNAL_ERROR;
  }
}

void TAE_DestroyEngine(TAE_EngineHandle engine) {
  delete fromHandle(engine);
}

TAE_Result TAE_SetEventCallback(TAE_EngineHandle engine, TAE_EventCallback callback, void* user_data) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  fromHandle(engine)->setEventCallback(callback, user_data);
  return TAE_RESULT_OK;
}

TAE_Result TAE_Play(TAE_EngineHandle engine, const char* source, double start_time_seconds) {
  if (!engine || !source) return TAE_RESULT_INVALID_ARGUMENT;
  return fromHandle(engine)->play(source, start_time_seconds);
}

TAE_Result TAE_Pause(TAE_EngineHandle engine) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->pause();
}

TAE_Result TAE_Stop(TAE_EngineHandle engine) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->stop();
}

TAE_Result TAE_Seek(TAE_EngineHandle engine, double position_seconds) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->seek(position_seconds);
}

TAE_Result TAE_SetVolume(TAE_EngineHandle engine, double volume) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->setVolume(volume);
}

TAE_Result TAE_SetOutputDevice(TAE_EngineHandle engine, const char* device_id) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->setOutputDevice(device_id ? device_id : "auto");
}

TAE_Result TAE_SetOutputBackend(TAE_EngineHandle engine, const char* backend_id) {
  if (!engine || !backend_id) return TAE_RESULT_INVALID_ARGUMENT;
  return fromHandle(engine)->setOutputBackend(backend_id);
}

TAE_Result TAE_LoadQueue(TAE_EngineHandle engine, const char* queue_json, int start_index) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->loadQueue(queue_json ? queue_json : "[]", start_index);
}

TAE_Result TAE_AddToQueue(TAE_EngineHandle engine, const char* item_json) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->addToQueue(item_json ? item_json : "{}");
}

TAE_Result TAE_RemoveFromQueue(TAE_EngineHandle engine, int index) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->removeFromQueue(index);
}

TAE_Result TAE_Next(TAE_EngineHandle engine) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->next();
}

TAE_Result TAE_Previous(TAE_EngineHandle engine) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->previous();
}

TAE_Result TAE_SetPlayMode(TAE_EngineHandle engine, const char* mode) {
  if (!engine || !mode) return TAE_RESULT_INVALID_ARGUMENT;
  return fromHandle(engine)->setPlayMode(mode);
}

TAE_Result TAE_GetQueue(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return copyStringResult(fromHandle(engine)->getQueueJson(), buffer, buffer_size, required_size);
}

TAE_Result TAE_GetUpcomingTrack(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return copyStringResult(fromHandle(engine)->getUpcomingTrackJson(), buffer, buffer_size, required_size);
}

TAE_Result TAE_SetDspConfig(TAE_EngineHandle engine, const char* dsp_config_json) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->setDspConfig(dsp_config_json ? dsp_config_json : "{}");
}

TAE_Result TAE_GetDspConfig(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return copyStringResult(fromHandle(engine)->getDspConfig(), buffer, buffer_size, required_size);
}

TAE_Result TAE_LoadImpulseResponse(TAE_EngineHandle engine, const char* path) {
  if (!engine || !path) return TAE_RESULT_INVALID_ARGUMENT;
  return fromHandle(engine)->loadImpulseResponse(path);
}

TAE_Result TAE_UnloadImpulseResponse(TAE_EngineHandle engine) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->unloadImpulseResponse();
}

TAE_Result TAE_GetConvolverInfo(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return copyStringResult(fromHandle(engine)->getConvolverInfoJson(), buffer, buffer_size, required_size);
}

TAE_Result TAE_SetEqBands(TAE_EngineHandle engine, const char* eq_json) {
  if (!engine || !eq_json) return TAE_RESULT_INVALID_ARGUMENT;
  return fromHandle(engine)->setEqBands(eq_json);
}

TAE_Result TAE_SetEqPreset(TAE_EngineHandle engine, const char* preset_json) {
  if (!engine || !preset_json) return TAE_RESULT_INVALID_ARGUMENT;
  return fromHandle(engine)->setEqPreset(preset_json);
}

TAE_Result TAE_SetCrossfeedStrength(TAE_EngineHandle engine, double strength) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->setCrossfeedStrength(strength);
}

TAE_Result TAE_SetReplayGainMode(
    TAE_EngineHandle engine,
    const char* mode,
    double preamp_db,
    double fallback_db,
    int clip) {
  if (!engine || !mode) return TAE_RESULT_INVALID_ARGUMENT;
  return fromHandle(engine)->setReplayGainMode(mode, preamp_db, fallback_db, clip != 0);
}

TAE_Result TAE_GetMetadata(
    TAE_EngineHandle engine,
    const char* source,
    char* buffer,
    size_t buffer_size,
    size_t* required_size) {
  if (!engine || !source) return TAE_RESULT_INVALID_ARGUMENT;
  return copyStringResult(fromHandle(engine)->getMetadataJson(source), buffer, buffer_size, required_size);
}

TAE_Result TAE_EnumerateDevices(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return copyStringResult(fromHandle(engine)->enumerateDevicesJson(), buffer, buffer_size, required_size);
}

TAE_Result TAE_EnumerateBackends(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return copyStringResult(fromHandle(engine)->enumerateBackendsJson(), buffer, buffer_size, required_size);
}

TAE_Result TAE_GetPlaybackInfo(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return copyStringResult(fromHandle(engine)->getPlaybackInfoJson(), buffer, buffer_size, required_size);
}

TAE_Result TAE_GetSpectrumData(TAE_EngineHandle engine, float* buffer, size_t point_count, size_t* written_count) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  const size_t written = fromHandle(engine)->getSpectrumData(buffer, point_count);
  if (written_count) *written_count = written;
  return TAE_RESULT_OK;
}

const char* TAE_GetVersion(void) {
  return "0.1.0";
}

}  // extern "C"
