#include "DspChain.h"
#include "DspChainActiveUtils.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <optional>

namespace twilight::audio {
namespace {

std::string toLower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return value;
}

std::optional<std::string> extractStringField(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = json.find(marker);
  if (pos == std::string::npos) return std::nullopt;
  pos = json.find(':', pos + marker.size());
  if (pos == std::string::npos) return std::nullopt;
  pos = json.find('"', pos + 1);
  if (pos == std::string::npos) return std::nullopt;

  std::string value;
  bool escaped = false;
  for (size_t i = pos + 1; i < json.size(); ++i) {
    const char ch = json[i];
    if (escaped) {
      value += ch;
      escaped = false;
      continue;
    }
    if (ch == '\\') {
      escaped = true;
      continue;
    }
    if (ch == '"') return value;
    value += ch;
  }
  return std::nullopt;
}

std::optional<double> extractNumberField(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = json.find(marker);
  if (pos == std::string::npos) return std::nullopt;
  pos = json.find(':', pos + marker.size());
  if (pos == std::string::npos) return std::nullopt;
  ++pos;
  while (pos < json.size() && std::isspace(static_cast<unsigned char>(json[pos]))) ++pos;

  const char* begin = json.c_str() + pos;
  char* end = nullptr;
  const double value = std::strtod(begin, &end);
  if (end == begin) return std::nullopt;
  return value;
}

std::optional<bool> extractBoolField(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = json.find(marker);
  if (pos == std::string::npos) return std::nullopt;
  pos = json.find(':', pos + marker.size());
  if (pos == std::string::npos) return std::nullopt;
  ++pos;
  while (pos < json.size() && std::isspace(static_cast<unsigned char>(json[pos]))) ++pos;
  if (json.compare(pos, 4, "true") == 0) return true;
  if (json.compare(pos, 5, "false") == 0) return false;
  return std::nullopt;
}

std::vector<std::string> splitTopLevelObjects(const std::string& json) {
  std::vector<std::string> objects;
  bool inString = false;
  bool escaped = false;
  int depth = 0;
  size_t objectStart = std::string::npos;

  for (size_t i = 0; i < json.size(); ++i) {
    const char ch = json[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch == '\\') {
        escaped = true;
      } else if (ch == '"') {
        inString = false;
      }
      continue;
    }

    if (ch == '"') {
      inString = true;
    } else if (ch == '{') {
      if (depth == 0) objectStart = i;
      ++depth;
    } else if (ch == '}') {
      --depth;
      if (depth == 0 && objectStart != std::string::npos) {
        objects.push_back(json.substr(objectStart, i - objectStart + 1));
        objectStart = std::string::npos;
      }
    }
  }

  return objects;
}

std::string extractArrayField(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = json.find(marker);
  if (pos == std::string::npos) return {};
  pos = json.find('[', pos + marker.size());
  if (pos == std::string::npos) return {};

  bool inString = false;
  bool escaped = false;
  int depth = 0;
  for (size_t i = pos; i < json.size(); ++i) {
    const char ch = json[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch == '\\') {
        escaped = true;
      } else if (ch == '"') {
        inString = false;
      }
      continue;
    }
    if (ch == '"') {
      inString = true;
    } else if (ch == '[') {
      ++depth;
    } else if (ch == ']') {
      --depth;
      if (depth == 0) return json.substr(pos, i - pos + 1);
    }
  }
  return {};
}

ReplayGainMode parseReplayGainMode(const std::string& mode) {
  const std::string normalized = toLower(mode);
  if (normalized == "track" || normalized == "loudnorm") return ReplayGainMode::Track;
  if (normalized == "album") return ReplayGainMode::Album;
  return ReplayGainMode::Off;
}

DsdOutputMode parseDsdOutputMode(const std::string& mode) {
  std::string normalized = mode;
  std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  if (normalized == "pcm") return DsdOutputMode::Pcm;
  if (normalized == "dop") return DsdOutputMode::Dop;
  if (normalized == "native") return DsdOutputMode::Native;
  return DsdOutputMode::Auto;
}

SacdProgramMode parseSacdProgramMode(const std::string& mode) {
  std::string normalized = mode;
  std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  if (normalized == "stereo") return SacdProgramMode::Stereo;
  if (normalized == "multichannel") return SacdProgramMode::Multichannel;
  return SacdProgramMode::Auto;
}

EqMode parseEqMode(const std::string& mode) {
  return toLower(mode) == "parametric" ? EqMode::Parametric : EqMode::Graphic;
}

DspFilterType parseFilterType(const std::string& type) {
  const std::string normalized = toLower(type);
  if (normalized == "lowshelf") return DspFilterType::LowShelf;
  if (normalized == "highshelf") return DspFilterType::HighShelf;
  if (normalized == "lowpass") return DspFilterType::LowPass;
  if (normalized == "highpass") return DspFilterType::HighPass;
  if (normalized == "bandpass") return DspFilterType::BandPass;
  if (normalized == "allpass") return DspFilterType::AllPass;
  return DspFilterType::Peak;
}

std::vector<DspEqBand> parseEqBands(const std::string& json, EqMode mode) {
  std::vector<DspEqBand> bands;
  const std::string arrayJson = extractArrayField(json, "eqBands");
  for (const std::string& object : splitTopLevelObjects(arrayJson)) {
    DspEqBand band;
    band.frequency = extractNumberField(object, "frequency").value_or(band.frequency);
    band.gainDb = extractNumberField(object, "gain").value_or(0.0);
    band.q = extractNumberField(object, "q").value_or(1.0);
    band.type = mode == EqMode::Graphic
                    ? DspFilterType::Peak
                    : parseFilterType(extractStringField(object, "filterType").value_or("peak"));
    bands.push_back(band);
  }
  return bands;
}

}  // namespace

DspChain::DspChain() {
  auto replayGain = std::make_unique<ReplayGainProcessor>();
  replayGain_ = replayGain.get();
  processors_.push_back(std::move(replayGain));

  auto eq = std::make_unique<ParametricEqProcessor>();
  eq_ = eq.get();
  processors_.push_back(std::move(eq));

  auto convolver = std::make_unique<ConvolverProcessor>();
  convolver_ = convolver.get();
  processors_.push_back(std::move(convolver));

  auto crossfeed = std::make_unique<CrossfeedProcessor>();
  crossfeed_ = crossfeed.get();
  processors_.push_back(std::move(crossfeed));

  auto nativePlugins = std::make_unique<PluginRegistry>();
  nativePlugins_ = nativePlugins.get();
  processors_.push_back(std::move(nativePlugins));
}

void DspChain::configure(const DspConfig& config) {
  processingRequired_.store(true, std::memory_order_relaxed);
  std::lock_guard lock(mutex_);
  DspConfig next = config;
  if (next.impulseResponsePath.empty() && !next.convolverEnabled) {
    next.impulseResponsePath = config_.impulseResponsePath;
    next.convolverEnabled = config_.convolverEnabled;
  }
  config_ = next;
  for (auto& processor : processors_) {
    processor->configure(config_);
    processor->prepare(format_);
    processor->setTrackContext(trackContext_);
  }
  refreshStatusLocked();
}

void DspChain::configureFromJson(const std::string& json) {
  configure(parseConfigJson(json));
}

void DspChain::prepare(const AudioFormat& format) {
  std::lock_guard lock(mutex_);
  format_ = format;
  for (auto& processor : processors_) {
    processor->prepare(format_);
  }
  refreshStatusLocked();
}

void DspChain::setTrackContext(const DspTrackContext& context) {
  processingRequired_.store(true, std::memory_order_relaxed);
  std::lock_guard lock(mutex_);
  trackContext_ = context;
  for (auto& processor : processors_) {
    processor->setTrackContext(context);
  }
  refreshStatusLocked();
}

void DspChain::process(float* samples, size_t frameCount) {
  if (!processingRequired_.load(std::memory_order_relaxed)) return;
  if (!samples || frameCount == 0) return;
  std::unique_lock lock(mutex_, std::try_to_lock);
  if (!lock.owns_lock()) return;
  for (IAudioProcessor* processor : activeProcessors_) {
    processor->process(samples, frameCount);
  }
  if (config_.clipGuard && status_.dspActive) {
    clampOutput(samples, frameCount);
  }
}

void DspChain::reset() {
  std::lock_guard lock(mutex_);
  for (auto& processor : processors_) {
    processor->reset();
  }
}

DspStatus DspChain::status() {
  std::lock_guard lock(mutex_);
  refreshStatusLocked();
  return status_;
}

bool DspChain::loadImpulseResponse(const std::string& path, std::string* error) {
  processingRequired_.store(true, std::memory_order_relaxed);
  std::lock_guard lock(mutex_);
  if (!convolver_) return false;
  const bool ok = convolver_->loadImpulseResponse(path, error);
  if (ok) {
    config_.convolverEnabled = true;
    config_.impulseResponsePath = path;
    convolver_->configure(config_);
    convolver_->prepare(format_);
  }
  refreshStatusLocked();
  return ok;
}

void DspChain::unloadImpulseResponse() {
  processingRequired_.store(true, std::memory_order_relaxed);
  std::lock_guard lock(mutex_);
  if (convolver_) convolver_->unloadImpulseResponse();
  config_.convolverEnabled = false;
  config_.impulseResponsePath.clear();
  refreshStatusLocked();
}

ConvolverInfo DspChain::convolverInfo() const {
  std::lock_guard lock(mutex_);
  return convolver_ ? convolver_->info() : ConvolverInfo{};
}

void DspChain::setEqBands(const std::vector<DspEqBand>& bands, EqMode mode, double preampDb, bool enabled) {
  processingRequired_.store(true, std::memory_order_relaxed);
  std::lock_guard lock(mutex_);
  config_.eqBands = bands;
  config_.eqMode = mode;
  config_.eqPreampDb = std::clamp(preampDb, -24.0, 24.0);
  config_.eqEnabled = enabled && !bands.empty();
  if (eq_) {
    eq_->configure(config_);
    eq_->prepare(format_);
    eq_->setTrackContext(trackContext_);
  }
  refreshStatusLocked();
}

bool DspChain::setEqBandsFromJson(const std::string& json, std::string*) {
  const EqMode mode = parseEqMode(extractStringField(json, "eqMode").value_or("parametric"));
  const double preamp = std::clamp(extractNumberField(json, "eqPreamp").value_or(0.0), -24.0, 24.0);
  const bool enabled = extractBoolField(json, "eqEnabled").value_or(true);
  setEqBands(parseEqBandsJson(json, mode), mode, preamp, enabled);
  return true;
}

bool DspChain::setEqPresetFromJson(const std::string& json, std::string* error) {
  return setEqBandsFromJson(json, error);
}

void DspChain::setCrossfeedStrength(double strength) {
  processingRequired_.store(true, std::memory_order_relaxed);
  std::lock_guard lock(mutex_);
  config_.crossfeedStrength = std::clamp(strength, 0.0, 1.0);
  config_.crossfeedEnabled = config_.crossfeedStrength > 0.0001;
  if (crossfeed_) {
    crossfeed_->configure(config_);
    crossfeed_->prepare(format_);
    crossfeed_->setTrackContext(trackContext_);
  }
  refreshStatusLocked();
}

void DspChain::setReplayGainMode(ReplayGainMode mode, double preampDb, double fallbackDb, bool clip) {
  processingRequired_.store(true, std::memory_order_relaxed);
  std::lock_guard lock(mutex_);
  config_.replayGainMode = mode;
  config_.replayGainPreampDb = std::clamp(preampDb, -24.0, 24.0);
  config_.replayGainFallbackDb = std::clamp(fallbackDb, -24.0, 24.0);
  config_.replayGainClip = clip;
  if (replayGain_) {
    replayGain_->configure(config_);
    replayGain_->prepare(format_);
    replayGain_->setTrackContext(trackContext_);
  }
  refreshStatusLocked();
}

void DspChain::setNativeDspPluginChain(const std::string& json) {
  processingRequired_.store(true, std::memory_order_relaxed);
  std::lock_guard lock(mutex_);
  if (!nativePlugins_) return;
  nativePlugins_->setPluginChain(PluginRegistry::parseChainJson(json));
  nativePlugins_->setTrackContext(trackContext_);
  refreshStatusLocked();
}

std::string DspChain::nativeDspPluginStatusJson() const {
  std::lock_guard lock(mutex_);
  return nativePlugins_ ? nativePlugins_->statusJson() : std::string("{\"plugins\":[]}");
}

DspConfig DspChain::parseConfigJson(const std::string& json) {
  DspConfig config;
  config.enabled = extractBoolField(json, "dspEnabled").value_or(extractBoolField(json, "enabled").value_or(false));
  config.clipGuard = extractBoolField(json, "clipGuard").value_or(true);
  config.fftEnabled = extractBoolField(json, "fftEnabled").value_or(true);
  config.fftResolution =
      static_cast<size_t>(std::clamp(extractNumberField(json, "fftResolution").value_or(8192.0), 64.0, 8192.0));
  config.gapless = extractBoolField(json, "gapless").value_or(true);
  config.dsdOutputMode = parseDsdOutputMode(extractStringField(json, "dsdOutputMode").value_or(
      extractBoolField(json, "dsdToPcm").value_or(false) ? "pcm" : "auto"));
  config.sacdProgramMode =
      parseSacdProgramMode(extractStringField(json, "sacdProgramMode").value_or("auto"));
  config.replayGainMode = parseReplayGainMode(extractStringField(json, "volumeNormalization").value_or("off"));
  config.replayGainPreampDb = std::clamp(extractNumberField(json, "replayGainPreamp").value_or(0.0), -24.0, 24.0);
  config.replayGainFallbackDb = std::clamp(extractNumberField(json, "replayGainFallback").value_or(0.0), -24.0, 24.0);
  config.replayGainClip = extractBoolField(json, "replayGainClip").value_or(true);
  config.eqEnabled = extractBoolField(json, "eqEnabled").value_or(false);
  config.eqMode = parseEqMode(extractStringField(json, "eqMode").value_or("graphic"));
  config.eqPreampDb = std::clamp(extractNumberField(json, "eqPreamp").value_or(0.0), -24.0, 24.0);
  config.eqBands = parseEqBands(json, config.eqMode);
  config.convolverEnabled = extractBoolField(json, "convolverEnabled").value_or(false);
  config.impulseResponsePath = extractStringField(json, "convolverIrPath").value_or("");
  config.crossfeedStrength = std::clamp(extractNumberField(json, "crossfeedStrength").value_or(0.0), 0.0, 1.0);
  config.crossfeedEnabled = extractBoolField(json, "crossfeedEnabled").value_or(config.crossfeedStrength > 0.0001);
  config.crossfeedDelayMs = std::clamp(extractNumberField(json, "crossfeedDelayMs").value_or(0.35), 0.05, 2.0);
  config.crossfeedCutoffHz = std::clamp(extractNumberField(json, "crossfeedCutoffHz").value_or(700.0), 80.0, 4000.0);
  config.crossfadeSeconds = std::clamp(extractNumberField(json, "crossfadeSeconds").value_or(0.0), 0.0, 12.0);
  return config;
}

std::vector<DspEqBand> DspChain::parseEqBandsJson(const std::string& json, EqMode mode) {
  return parseEqBands(json, mode);
}

void DspChain::refreshStatusLocked() {
  status_.replayGainActive = replayGain_ && replayGain_->isActive();
  status_.eqActive = eq_ && eq_->isActive();
  status_.convolverActive = convolver_ && convolver_->isActive();
  status_.crossfeedActive = crossfeed_ && crossfeed_->isActive();
  status_.nativeDspActive = nativePlugins_ && nativePlugins_->isActive();
  status_.crossfadeActive = config_.crossfadeSeconds > 0.0001;
  status_.replayGainDb = replayGain_ ? replayGain_->currentGainDb() : 0.0;
  status_.crossfeedStrength = crossfeed_ ? crossfeed_->strength() : 0.0;
  status_.crossfadeSeconds = status_.crossfadeActive ? config_.crossfadeSeconds : 0.0;
  const ConvolverInfo info = convolver_ ? convolver_->info() : ConvolverInfo{};
  status_.irResampled = info.irResampled;
  status_.convolverLatencyFrames = info.latencyFrames;
  status_.partitionSize = info.partitionSize;
  status_.channelMappingMode = info.channelMappingMode;
  status_.nativeDspJson = nativePlugins_ ? nativePlugins_->statusJson() : std::string("{\"plugins\":[]}");
  status_.dspActive = status_.replayGainActive || status_.eqActive || status_.convolverActive ||
                      status_.crossfeedActive || status_.nativeDspActive;
  activeProcessors_ = dsp::collectActiveProcessors(processors_);
  processingRequired_.store(!activeProcessors_.empty(), std::memory_order_relaxed);
}

void DspChain::clampOutput(float* samples, size_t frameCount) {
  const size_t sampleCount = frameCount * static_cast<size_t>(std::max(1, format_.channelCount));
  for (size_t i = 0; i < sampleCount; ++i) {
    samples[i] = static_cast<float>(std::clamp(static_cast<double>(samples[i]), -1.0, 1.0));
  }
}

bool dspConfigRequiresProcessing(const std::string& json) {
  const DspConfig config = DspChain::parseConfigJson(json);
  const bool dspProcessing =
      config.enabled &&
      (config.replayGainMode != ReplayGainMode::Off || config.eqEnabled || config.convolverEnabled ||
       config.crossfeedEnabled);
  return dspProcessing || config.crossfadeSeconds > 0.0001;
}

}  // namespace twilight::audio
