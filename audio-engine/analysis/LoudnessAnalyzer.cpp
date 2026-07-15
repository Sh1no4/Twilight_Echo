#include "LoudnessAnalyzer.h"

#include "../core/AudioTypes.h"
#include "../decoder/FFmpegDecoder.h"
#include "../utils/JsonUtils.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cctype>
#include <ctime>
#include <sstream>
#include <string>
#include <vector>

#if defined(TAE_HAS_EBUR128)
#include <ebur128.h>
#endif

namespace twilight::audio {
namespace {

constexpr int kAlgorithmVersion = 1;
constexpr double kDefaultMaxAnalysisSeconds = 0.0;  // 0 = full file
constexpr double kHardMaxAnalysisSeconds = 3600.0 * 4.0;

double clamp(double value, double min, double max) {
  return std::max(min, std::min(max, value));
}

double roundTo(double value, double scale) {
  return std::round(value * scale) / scale;
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
    if (!(std::isdigit(static_cast<unsigned char>(ch)) || ch == '-' || ch == '+' || ch == '.' || ch == 'e' ||
          ch == 'E')) {
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

std::string errorJson(const std::string& message, bool available) {
  std::ostringstream json;
  json << "{\"error\":\"" << json_utils::escape(message) << "\",\"available\":"
       << (available ? "true" : "false") << "}";
  return json.str();
}

}  // namespace

std::string analyzeLoudnessJson(const std::string& source, const std::string& optionsJson) {
#if !defined(TAE_HAS_FFMPEG)
  (void)source;
  (void)optionsJson;
  return errorJson("loudness analysis requires FFmpeg", false);
#elif !defined(TAE_HAS_EBUR128)
  (void)source;
  (void)optionsJson;
  return errorJson("libebur128 unavailable; loudnorm measurement disabled", false);
#else
  if (source.empty()) return errorJson("loudness analysis requires a source path", true);

  const double maxAnalysisSeconds = clamp(
      optionNumber(optionsJson, "maxAnalysisSeconds", kDefaultMaxAnalysisSeconds),
      0.0,
      kHardMaxAnalysisSeconds);

  std::string error;
  FFmpegDecoder decoder;
  if (!decoder.open(source, &error)) {
    return errorJson(error.empty() ? "failed to open source for loudness analysis" : error, true);
  }

  AudioFormat format = decoder.streamInfo().sourceFormat;
  if (format.sampleRate <= 0) format.sampleRate = 48000;
  if (format.channelCount <= 0) format.channelCount = 2;
  format.channelCount = std::clamp(format.channelCount, 1, 8);
  format.bitDepth = 32;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;
  if (!decoder.setOutputFormat(format, &error)) {
    decoder.close();
    return errorJson(error.empty() ? "failed to prepare loudness analysis decoder" : error, true);
  }
  format = decoder.outputFormat();
  const int sampleRate = std::max(1, format.sampleRate);
  const int channels = std::clamp(format.channelCount, 1, 8);

  ebur128_state* state = ebur128_init(
      static_cast<unsigned int>(channels),
      static_cast<unsigned long>(sampleRate),
      EBUR128_MODE_I | EBUR128_MODE_TRUE_PEAK);
  if (!state) {
    decoder.close();
    return errorJson("failed to initialize libebur128", true);
  }

  const size_t maxFrames =
      maxAnalysisSeconds > 0.0
          ? static_cast<size_t>(std::ceil(maxAnalysisSeconds * static_cast<double>(sampleRate)))
          : static_cast<size_t>(0);
  constexpr size_t kChunkFrames = 4096;
  std::vector<float> chunk(static_cast<size_t>(kChunkFrames) * static_cast<size_t>(channels));
  size_t totalFrames = 0;
  while (!decoder.eof()) {
    if (maxFrames > 0 && totalFrames >= maxFrames) break;
    const size_t want =
        maxFrames > 0 ? std::min(kChunkFrames, maxFrames - totalFrames) : kChunkFrames;
    const size_t read = decoder.readFrames(chunk.data(), want, &error);
    if (read == 0) break;
    if (ebur128_add_frames_float(state, chunk.data(), read) != 0) {
      ebur128_destroy(&state);
      decoder.close();
      return errorJson("libebur128 failed while adding frames", true);
    }
    totalFrames += read;
  }
  decoder.close();

  if (totalFrames == 0) {
    ebur128_destroy(&state);
    return errorJson("not enough decoded PCM for loudness analysis", true);
  }

  double integratedLufs = 0.0;
  if (ebur128_loudness_global(state, &integratedLufs) != 0 || !std::isfinite(integratedLufs)) {
    ebur128_destroy(&state);
    return errorJson("failed to compute integrated LUFS", true);
  }

  double truePeakLinear = 0.0;
  for (int channel = 0; channel < channels; ++channel) {
    double channelPeak = 0.0;
    if (ebur128_true_peak(state, static_cast<unsigned int>(channel), &channelPeak) == 0 &&
        std::isfinite(channelPeak)) {
      truePeakLinear = std::max(truePeakLinear, channelPeak);
    }
  }
  ebur128_destroy(&state);

  const double truePeakDb =
      truePeakLinear <= 1.0e-12 ? -120.0 : 20.0 * std::log10(truePeakLinear);

  std::ostringstream json;
  json << "{\"integratedLufs\":" << roundTo(integratedLufs, 1000.0) << ","
       << "\"truePeakDb\":" << roundTo(truePeakDb, 1000.0) << ","
       << "\"sampleRate\":" << sampleRate << ","
       << "\"channels\":" << channels << ","
       << "\"analyzedFrames\":" << totalFrames << ","
       << "\"source\":\"analyzed\","
       << "\"analyzedAt\":\"" << isoTimestampUtc() << "\","
       << "\"algorithmVersion\":" << kAlgorithmVersion << ","
       << "\"available\":true}";
  return json.str();
#endif
}

}  // namespace twilight::audio
