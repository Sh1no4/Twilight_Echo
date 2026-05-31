#include "DspChain.h"

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
}

void DspChain::configure(const DspConfig& config) {
  std::lock_guard lock(mutex_);
  config_ = config;
  for (auto& processor : processors_) {
    processor->configure(config_);
    processor->prepare(format_);
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
  std::lock_guard lock(mutex_);
  for (auto& processor : processors_) {
    processor->setTrackContext(context);
  }
  refreshStatusLocked();
}

void DspChain::process(float* samples, size_t frameCount) {
  std::lock_guard lock(mutex_);
  if (!samples || frameCount == 0) return;
  for (auto& processor : processors_) {
    processor->process(samples, frameCount);
  }
  if (config_.replayGainClip && status_.dspActive) {
    clampOutput(samples, frameCount);
  }
}

DspStatus DspChain::status() const {
  std::lock_guard lock(mutex_);
  return status_;
}

DspConfig DspChain::parseConfigJson(const std::string& json) {
  DspConfig config;
  config.replayGainMode = parseReplayGainMode(extractStringField(json, "volumeNormalization").value_or("off"));
  config.replayGainPreampDb = std::clamp(extractNumberField(json, "replayGainPreamp").value_or(0.0), -24.0, 24.0);
  config.replayGainFallbackDb = std::clamp(extractNumberField(json, "replayGainFallback").value_or(0.0), -24.0, 24.0);
  config.replayGainClip = extractBoolField(json, "replayGainClip").value_or(true);
  config.eqEnabled = extractBoolField(json, "eqEnabled").value_or(false);
  config.eqMode = parseEqMode(extractStringField(json, "eqMode").value_or("graphic"));
  config.eqPreampDb = std::clamp(extractNumberField(json, "eqPreamp").value_or(0.0), -24.0, 24.0);
  config.eqBands = parseEqBands(json, config.eqMode);
  return config;
}

void DspChain::refreshStatusLocked() {
  status_.replayGainActive = replayGain_ && replayGain_->isActive();
  status_.eqActive = eq_ && eq_->isActive();
  status_.dspActive = status_.replayGainActive || status_.eqActive;
}

void DspChain::clampOutput(float* samples, size_t frameCount) {
  const size_t sampleCount = frameCount * static_cast<size_t>(std::max(1, format_.channelCount));
  for (size_t i = 0; i < sampleCount; ++i) {
    samples[i] = static_cast<float>(std::clamp(static_cast<double>(samples[i]), -1.0, 1.0));
  }
}

bool dspConfigRequiresProcessing(const std::string& json) {
  const DspConfig config = DspChain::parseConfigJson(json);
  return config.replayGainMode != ReplayGainMode::Off || config.eqEnabled;
}

}  // namespace twilight::audio
