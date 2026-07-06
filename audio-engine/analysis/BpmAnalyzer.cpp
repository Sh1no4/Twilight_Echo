#include "BpmAnalyzer.h"

#include "../core/AudioTypes.h"
#include "../decoder/FFmpegDecoder.h"
#include "../utils/JsonUtils.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cctype>
#include <ctime>
#include <limits>
#include <numeric>
#include <optional>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

namespace twilight::audio {
namespace {

struct TempoCandidate {
  double bpm = 0.0;
  double confidence = 0.0;
};

struct TempoSegment {
  double startMs = 0.0;
  double endMs = 0.0;
  double bpm = 0.0;
  double confidence = 0.0;
};

constexpr int kAnalysisSampleRate = 22050;
constexpr int kAnalysisChannels = 1;
constexpr double kDefaultMaxAnalysisSeconds = 180.0;
constexpr double kMinBpm = 60.0;
constexpr double kMaxBpm = 240.0;
constexpr size_t kFrameSize = 1024;
constexpr size_t kHopSize = 512;
constexpr double kWindowSeconds = 16.0;
constexpr double kWindowStepSeconds = 8.0;
constexpr int kAlgorithmVersion = 1;

double roundTo(double value, double scale) {
  return std::round(value * scale) / scale;
}

double clamp(double value, double min, double max) {
  return std::max(min, std::min(max, value));
}

std::string isoTimestampUtc() {
  using namespace std::chrono;
  const auto now = system_clock::now();
  const std::time_t time = system_clock::to_time_t(now);
  std::tm tm = {};
#if defined(_WIN32)
  gmtime_s(&tm, &time);
#else
  gmtime_r(&time, &tm);
#endif
  char buffer[32] = {};
  std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &tm);
  return buffer;
}

double optionNumber(const std::string& json, const std::string& key, double fallback) {
  const std::string marker = "\"" + key + "\":";
  const size_t start = json.find(marker);
  if (start == std::string::npos) return fallback;
  const size_t valueStart = start + marker.size();
  size_t valueEnd = valueStart;
  while (valueEnd < json.size()) {
    const char ch = json[valueEnd];
    if (!(std::isdigit(static_cast<unsigned char>(ch)) || ch == '-' || ch == '+' || ch == '.' || ch == 'e' || ch == 'E')) {
      break;
    }
    valueEnd += 1;
  }
  try {
    return std::stod(json.substr(valueStart, valueEnd - valueStart));
  } catch (...) {
    return fallback;
  }
}

std::vector<double> buildOnsetEnvelope(const std::vector<float>& samples) {
  std::vector<double> values;
  if (samples.size() < kFrameSize) return values;
  values.reserve((samples.size() - kFrameSize) / kHopSize + 1);
  double previousEnergy = 0.0;
  for (size_t offset = 0; offset + kFrameSize <= samples.size(); offset += kHopSize) {
    double energy = 0.0;
    for (size_t index = 0; index < kFrameSize; index += 1) {
      const double sample = samples[offset + index];
      energy += sample * sample;
    }
    energy = std::sqrt(energy / static_cast<double>(kFrameSize));
    values.push_back(std::max(0.0, energy - previousEnergy * 0.82));
    previousEnergy = energy;
  }
  return values;
}

double scoreLag(const std::vector<double>& values, int lag) {
  double score = 0.0;
  for (size_t index = static_cast<size_t>(lag); index < values.size(); index += 1) {
    score += values[index] * values[index - static_cast<size_t>(lag)];
  }
  return score;
}

double alignBpmToReference(double bpm, double referenceBpm) {
  if (!std::isfinite(referenceBpm) || referenceBpm <= 0.0) return bpm;
  double bestDistance = std::numeric_limits<double>::infinity();
  const double candidates[] = {bpm, bpm * 0.5, bpm * 2.0};
  for (double candidate : candidates) {
    if (candidate < kMinBpm || candidate > kMaxBpm) continue;
    bestDistance = std::min(bestDistance, std::abs(candidate - referenceBpm));
  }
  return bestDistance <= std::max(5.0, referenceBpm * 0.08) ? referenceBpm : bpm;
}

std::optional<TempoCandidate> estimateTempoFromCorrelation(
    const std::vector<double>& values,
    double hopMs,
    double referenceBpm) {
  if (values.size() < 8) return std::nullopt;
  const int minLag = std::max(1, static_cast<int>(std::floor(60000.0 / kMaxBpm / hopMs)));
  const int maxLag = std::min(static_cast<int>(values.size()) - 1, static_cast<int>(std::ceil(60000.0 / kMinBpm / hopMs)));
  if (maxLag <= minLag) return std::nullopt;

  double bestScore = 0.0;
  double secondScore = 0.0;
  int bestLag = 0;
  for (int lag = minLag; lag <= maxLag; lag += 1) {
    const double bpm = 60000.0 / (static_cast<double>(lag) * hopMs);
    const double octaveBoost =
        std::isfinite(referenceBpm) && referenceBpm > 0.0
            ? 1.0 + std::max(0.0, 1.0 - std::abs(bpm - referenceBpm) / std::max(6.0, referenceBpm * 0.08)) * 0.18
            : 1.0;
    const double score = scoreLag(values, lag) * octaveBoost;
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestLag = lag;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  if (bestLag <= 0 || bestScore <= 0.0) return std::nullopt;
  const double bpm = alignBpmToReference(60000.0 / (static_cast<double>(bestLag) * hopMs), referenceBpm);
  const double confidence = clamp((bestScore - secondScore) / std::max(bestScore, 0.000001), 0.0, 1.0);
  return TempoCandidate{bpm, confidence};
}

std::optional<TempoCandidate> estimateTempoFromPeaks(
    const std::vector<double>& values,
    double hopMs,
    double referenceBpm) {
  if (values.size() < 8) return std::nullopt;
  const double maxValue = *std::max_element(values.begin(), values.end());
  if (maxValue <= 0.000001) return std::nullopt;
  const double mean = std::accumulate(values.begin(), values.end(), 0.0) / static_cast<double>(values.size());
  const double threshold = std::max(maxValue * 0.1, mean * 1.25);
  const double minSpacing = (60000.0 / kMaxBpm / hopMs) * 0.65;

  std::vector<int> peaks;
  for (size_t index = 1; index + 1 < values.size(); index += 1) {
    const double value = values[index];
    if (value < threshold || value < values[index - 1] || value < values[index + 1]) continue;
    if (!peaks.empty() && static_cast<double>(static_cast<int>(index) - peaks.back()) < minSpacing) {
      if (value > values[static_cast<size_t>(peaks.back())]) peaks.back() = static_cast<int>(index);
    } else {
      peaks.push_back(static_cast<int>(index));
    }
  }
  if (peaks.size() < 4) return std::nullopt;

  double bestScore = 0.0;
  double secondScore = 0.0;
  double bestBpm = 0.0;
  for (size_t left = 0; left < peaks.size(); left += 1) {
    for (size_t right = left + 1; right < peaks.size(); right += 1) {
      const double intervalMs = static_cast<double>(peaks[right] - peaks[left]) * hopMs;
      if (intervalMs <= 0.0) continue;
      double bpm = 60000.0 / intervalMs;
      while (bpm < kMinBpm) bpm *= 2.0;
      while (bpm > kMaxBpm) bpm /= 2.0;
      if (bpm < kMinBpm || bpm > kMaxBpm) continue;
      const double referenceBoost =
          std::isfinite(referenceBpm) && referenceBpm > 0.0
              ? 1.0 + std::max(0.0, 1.0 - std::abs(bpm - referenceBpm) / std::max(6.0, referenceBpm * 0.08)) * 0.25
              : 1.0;
      const double score = referenceBoost / (1.0 + std::abs(static_cast<double>(right - left) - 1.0) * 0.12);
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        bestBpm = bpm;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
  }
  if (bestBpm <= 0.0) return std::nullopt;
  return TempoCandidate{
      alignBpmToReference(bestBpm, referenceBpm),
      clamp((bestScore - secondScore) / std::max(bestScore, 0.000001), 0.0, 1.0)};
}

std::optional<TempoCandidate> estimateTempo(
    const std::vector<double>& values,
    double hopMs,
    double referenceBpm) {
  const auto fromPeaks = estimateTempoFromPeaks(values, hopMs, referenceBpm);
  const auto fromCorrelation = estimateTempoFromCorrelation(values, hopMs, referenceBpm);
  if (fromPeaks && fromCorrelation) {
    return fromPeaks->confidence >= fromCorrelation->confidence * 0.8 ? fromPeaks : fromCorrelation;
  }
  return fromPeaks ? fromPeaks : fromCorrelation;
}

std::vector<TempoSegment> estimateTempoMap(
    const std::vector<double>& values,
    double hopMs,
    double referenceBpm) {
  std::vector<TempoSegment> segments;
  const int windowFrames = std::max(8, static_cast<int>((kWindowSeconds * 1000.0) / hopMs));
  const int stepFrames = std::max(1, static_cast<int>((kWindowStepSeconds * 1000.0) / hopMs));
  if (values.size() < static_cast<size_t>(windowFrames)) return segments;

  for (int start = 0; start + windowFrames <= static_cast<int>(values.size()); start += stepFrames) {
    std::vector<double> window(
        values.begin() + start,
        values.begin() + start + windowFrames);
    const auto estimate = estimateTempo(window, hopMs, referenceBpm);
    if (!estimate) continue;
    segments.push_back(TempoSegment{
        static_cast<double>(start) * hopMs,
        static_cast<double>(start + windowFrames) * hopMs,
        roundTo(estimate->bpm, 10.0),
        roundTo(estimate->confidence, 1000.0)});
  }
  return segments;
}

double median(std::vector<double> values) {
  if (values.empty()) return 0.0;
  std::sort(values.begin(), values.end());
  const size_t middle = values.size() / 2;
  return values.size() % 2 == 0 ? (values[middle - 1] + values[middle]) * 0.5 : values[middle];
}

std::string errorJson(const std::string& message) {
  std::ostringstream json;
  json << "{\"error\":\"" << json_utils::escape(message) << "\"}";
  return json.str();
}

}  // namespace

std::string analyzeBpmJson(const std::string& source, const std::string& optionsJson) {
#if defined(TAE_HAS_FFMPEG)
  if (source.empty()) return errorJson("BPM analysis requires a source path");

  const double maxAnalysisSeconds = clamp(
      optionNumber(optionsJson, "maxAnalysisSeconds", kDefaultMaxAnalysisSeconds),
      5.0,
      kDefaultMaxAnalysisSeconds);
  const double referenceBpm = optionNumber(optionsJson, "referenceBpm", 0.0);

  std::string error;
  FFmpegDecoder decoder;
  if (!decoder.open(source, &error)) return errorJson(error.empty() ? "failed to open source for BPM analysis" : error);

  AudioFormat format;
  format.sampleRate = kAnalysisSampleRate;
  format.channelCount = kAnalysisChannels;
  format.bitDepth = 32;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;
  if (!decoder.setOutputFormat(format, &error)) {
    decoder.close();
    return errorJson(error.empty() ? "failed to prepare BPM analysis decoder" : error);
  }

  const size_t maxFrames = static_cast<size_t>(std::ceil(maxAnalysisSeconds * kAnalysisSampleRate));
  std::vector<float> samples;
  samples.reserve(std::min<size_t>(maxFrames, static_cast<size_t>(kAnalysisSampleRate) * 30U));

  constexpr size_t kChunkFrames = 4096;
  std::vector<float> chunk(kChunkFrames);
  while (samples.size() < maxFrames && !decoder.eof()) {
    const size_t want = std::min(kChunkFrames, maxFrames - samples.size());
    const size_t read = decoder.readFrames(chunk.data(), want, &error);
    if (read == 0) break;
    samples.insert(samples.end(), chunk.begin(), chunk.begin() + static_cast<std::ptrdiff_t>(read));
  }
  decoder.close();

  if (samples.size() < kFrameSize) return errorJson("not enough decoded PCM for BPM analysis");

  const std::vector<double> envelope = buildOnsetEnvelope(samples);
  const double hopMs = (static_cast<double>(kHopSize) / kAnalysisSampleRate) * 1000.0;
  const auto global = estimateTempo(envelope, hopMs, referenceBpm);
  if (!global) return errorJson("BPM analysis could not find a stable tempo");

  const std::vector<TempoSegment> tempoMap = estimateTempoMap(envelope, hopMs, referenceBpm);
  std::vector<double> stableBpms;
  for (const auto& segment : tempoMap) {
    if (segment.confidence >= 0.45) stableBpms.push_back(segment.bpm);
  }
  std::optional<std::pair<double, double>> bpmRange;
  if (stableBpms.size() >= 2) {
    const auto [minIt, maxIt] = std::minmax_element(stableBpms.begin(), stableBpms.end());
    bpmRange = std::make_pair(roundTo(*minIt, 10.0), roundTo(*maxIt, 10.0));
  }
  const bool variableTempo = bpmRange && bpmRange->second - bpmRange->first >= 18.0;
  const double bpm = variableTempo ? median(stableBpms) : global->bpm;

  std::ostringstream json;
  json << "{\"bpm\":" << roundTo(bpm, 10.0) << ","
       << "\"confidence\":" << roundTo(global->confidence, 1000.0) << ","
       << "\"source\":\"analyzed\","
       << "\"analyzedAt\":\"" << isoTimestampUtc() << "\","
       << "\"algorithmVersion\":" << kAlgorithmVersion << ","
       << "\"variableTempo\":" << (variableTempo ? "true" : "false");
  if (bpmRange) {
    json << ",\"bpmRange\":[" << bpmRange->first << "," << bpmRange->second << "]";
  }
  if (!tempoMap.empty()) {
    json << ",\"tempoMap\":[";
    for (size_t index = 0; index < tempoMap.size(); index += 1) {
      if (index > 0) json << ",";
      const auto& segment = tempoMap[index];
      json << "{\"startMs\":" << roundTo(segment.startMs, 1.0) << ","
           << "\"endMs\":" << roundTo(segment.endMs, 1.0) << ","
           << "\"bpm\":" << segment.bpm << ","
           << "\"confidence\":" << segment.confidence << "}";
    }
    json << "]";
  }
  json << "}";
  return json.str();
#else
  (void)source;
  (void)optionsJson;
  return errorJson("current build does not include FFmpeg BPM analysis support");
#endif
}

}  // namespace twilight::audio
