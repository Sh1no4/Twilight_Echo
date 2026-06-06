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
std::string enumerateAsioDevicesJson();

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

const char* resultToString(TAE_Result result) {
  switch (result) {
    case TAE_RESULT_OK:
      return "TAE_RESULT_OK";
    case TAE_RESULT_INVALID_ARGUMENT:
      return "TAE_RESULT_INVALID_ARGUMENT";
    case TAE_RESULT_NOT_INITIALIZED:
      return "TAE_RESULT_NOT_INITIALIZED";
    case TAE_RESULT_BACKEND_UNAVAILABLE:
      return "TAE_RESULT_BACKEND_UNAVAILABLE";
    case TAE_RESULT_INTERNAL_ERROR:
    default:
      return "TAE_RESULT_INTERNAL_ERROR";
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

void writeLatencyInfoJson(std::ostringstream& json, const OutputInfo::LatencyInfo& latency) {
  json << "{"
       << "\"bufferLatencyMs\":" << latency.bufferLatencyMs << ","
       << "\"outputLatencyMs\":" << latency.outputLatencyMs << ","
       << "\"totalLatencyMs\":" << latency.totalLatencyMs
       << "}";
}

void writeDiagnosticsJson(std::ostringstream& json, const OutputInfo::Diagnostics& diagnostics) {
  json << "{"
       << "\"sessionUnderrunCount\":" << diagnostics.sessionUnderrunCount << ","
       << "\"sessionBufferDropCount\":" << diagnostics.sessionBufferDropCount << ","
       << "\"sessionRecoveryCount\":" << diagnostics.sessionRecoveryCount << ","
       << "\"lifetimeUnderrunCount\":" << diagnostics.lifetimeUnderrunCount << ","
       << "\"lifetimeBufferDropCount\":" << diagnostics.lifetimeBufferDropCount << ","
       << "\"lifetimeRecoveryCount\":" << diagnostics.lifetimeRecoveryCount << ","
       << "\"driverRestartCount\":" << diagnostics.driverRestartCount << ","
       << "\"deviceLostCount\":" << diagnostics.deviceLostCount << ","
       << "\"lastError\":\"" << escapeJson(diagnostics.lastError) << "\""
       << "}";
}

std::string boolJson(bool value) {
  return value ? "true" : "false";
}

bool jsonArrayHasItems(const std::string& json) {
  return json.find('{') != std::string::npos;
}

void writeBackendCapabilityJson(
    std::ostringstream& json,
    const char* id,
    const char* label,
    bool compiled,
    bool runtimeAvailable,
    bool supportsExclusive,
    bool supportsOutputPerfect,
    const char* accessMode,
    const char* devicePathKind,
    const std::string& unavailableReason = {},
    bool optional = false) {
  json << "{\"id\":\"" << escapeJson(id) << "\",\"label\":\"" << escapeJson(label) << "\","
       << "\"compiled\":" << boolJson(compiled) << ","
       << "\"runtimeAvailable\":" << boolJson(runtimeAvailable) << ","
       << "\"supportsExclusive\":" << boolJson(supportsExclusive) << ","
       << "\"supportsOutputPerfect\":" << boolJson(supportsOutputPerfect) << ","
       << "\"accessMode\":\"" << escapeJson(accessMode) << "\","
       << "\"devicePathKind\":\"" << escapeJson(devicePathKind) << "\","
       << "\"unavailableReason\":\"" << escapeJson(runtimeAvailable ? std::string{} : unavailableReason) << "\"";
  if (optional) json << ",\"optional\":true";
  json << "}";
}

std::string backendCapabilitiesJson() {
  std::ostringstream json;
  json << "[";
  bool first = true;
  auto append = [&](const char* id,
                    const char* label,
                    bool compiled,
                    bool runtimeAvailable,
                    bool supportsExclusive,
                    bool supportsOutputPerfect,
                    const char* accessMode,
                    const char* devicePathKind,
                    const std::string& unavailableReason = {},
                    bool optional = false) {
    if (!first) json << ",";
    first = false;
    writeBackendCapabilityJson(
        json,
        id,
        label,
        compiled,
        runtimeAvailable,
        supportsExclusive,
        supportsOutputPerfect,
        accessMode,
        devicePathKind,
        unavailableReason,
        optional);
  };

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  append("wasapi", "共享输出", true, true, false, false, "shared", "default");
  append("wasapi-exclusive", "独占输出", true, true, true, true, "exclusive", "default");
#else
  append(
      "wasapi",
      "共享输出",
      false,
      false,
      false,
      false,
      "shared",
      "default",
      "WASAPI is only available in Windows builds with TAE_ENABLE_WASAPI");
  append(
      "wasapi-exclusive",
      "独占输出",
      false,
      false,
      true,
      false,
      "exclusive",
      "default",
      "WASAPI Exclusive is only available in Windows builds with TAE_ENABLE_WASAPI");
#endif

#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  const std::string asioDevices = enumerateAsioDevicesJson();
  append(
      "asio",
      "专业声卡输出",
      true,
      jsonArrayHasItems(asioDevices),
      true,
      true,
      "exclusive",
      "asio",
      "No ASIO drivers were enumerated",
      true);
#else
  append(
      "asio",
      "专业声卡输出",
      false,
      false,
      true,
      false,
      "exclusive",
      "asio",
      "ASIO SDK was not available when this build was configured",
      true);
#endif

#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
  append("coreaudio", "苹果系统音频", true, true, false, false, "shared", "hal");
#else
  append(
      "coreaudio",
      "苹果系统音频",
      false,
      false,
      false,
      false,
      "shared",
      "hal",
      "CoreAudio is only available in macOS builds with TAE_ENABLE_COREAUDIO");
#endif

#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  append("alsa", "Linux ALSA 输出", true, true, false, false, "plugin", "default");
#else
  append(
      "alsa",
      "Linux ALSA 输出",
      false,
      false,
      false,
      false,
      "plugin",
      "default",
      "ALSA is only available in Linux builds with TAE_ENABLE_ALSA and ALSA development libraries");
#endif

  json << "]";
  return json.str();
}

void normalizeOutputInfoMirror(PlaybackInfo& info) {
  OutputInfo& out = info.outputInfo;
  if (out.backend.empty()) out.backend = info.outputBackend;
  if (out.actualBackend.empty()) out.actualBackend = out.backend;
  if (out.accessMode.empty()) out.accessMode = out.exclusive ? "exclusive" : "shared";
  if (out.devicePathKind.empty()) out.devicePathKind = "default";
  if (out.deviceName.empty()) out.deviceName = info.outputDevice;
  if (out.actualDeviceName.empty()) out.actualDeviceName = out.deviceName;
  if (out.actualDriverName.empty()) out.actualDriverName = out.driverName;
  if (out.actualDriverVersion == 0) out.actualDriverVersion = out.driverVersion;
  if (out.outputSampleRate <= 0 && info.outputSampleRate > 0) out.outputSampleRate = info.outputSampleRate;
  if (out.outputBitDepth <= 0 && info.outputBitDepth > 0) out.outputBitDepth = info.outputBitDepth;
  if (out.actualSampleRate <= 0) out.actualSampleRate = out.outputSampleRate;
  if (out.actualBitDepth <= 0) out.actualBitDepth = out.outputBitDepth;

  info.actualBackend = out.actualBackend;
  info.driverName = out.driverName.empty() ? out.actualDriverName : out.driverName;
  info.driverVersion = out.driverVersion != 0 ? out.driverVersion : out.actualDriverVersion;
  info.actualOutputFormat = out.actualOutputFormat;
  info.actualSampleRate = out.actualSampleRate;
  info.actualBitDepth = out.actualBitDepth;
  info.actualChannels = out.actualChannels;
  info.bufferSizeFrames = out.bufferSizeFrames;
  info.latencyFrames = out.latencyFrames;
  info.latencyMs = out.latencyMs;
  info.deviceRecovered = out.deviceRecovered;
  info.recoveryCount = out.recoveryCount;
  info.outputSampleRate = out.outputSampleRate;
  info.outputBitDepth = out.outputBitDepth;
  info.supportsOutputPerfect = out.supportsOutputPerfect;
  info.sourceExact = out.sourceExact;
  info.outputPerfect = out.outputPerfect;
  info.pcmPassthrough = out.pcmPassthrough;
  info.perfectReasonCode = out.perfectReasonCode;
  info.perfectReason = out.perfectReason;
  info.isDsd = out.isDsd;
  info.dsdMode = out.dsdMode.empty() ? (out.isDsd ? dsdModeToString(DsdMode::Unsupported) : dsdModeToString(DsdMode::Pcm)) : out.dsdMode;
  info.dsdRate = out.isDsd ? out.dsdRate : 0;
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

bool codecLooksLossless(const std::string& codec) {
  return codec == "flac" || codec == "wav" || codec == "alac" || codec == "aiff" || codec == "aif" ||
         codec == "ape" || codec == "wv" || codec == "tta" || codec == "pcm";
}

AudioSampleFormat sampleFormatFromText(const std::string& format, int bitDepth) {
  if (format == "int16") return AudioSampleFormat::Int16Interleaved;
  if (format == "int24") return AudioSampleFormat::Int24Interleaved;
  if (format == "int24-in32") return AudioSampleFormat::Int24In32Interleaved;
  if (format == "int32") return AudioSampleFormat::Int32Interleaved;
  if (format == "float32") return AudioSampleFormat::Float32Interleaved;
  if (bitDepth <= 16) return AudioSampleFormat::Int16Interleaved;
  if (bitDepth <= 24) return AudioSampleFormat::Int24Interleaved;
  return AudioSampleFormat::Float32Interleaved;
}

DsdMode parseDsdMode(const std::string& mode) {
  if (mode == "dop") return DsdMode::Dop;
  if (mode == "native") return DsdMode::Native;
  if (mode == "unsupported") return DsdMode::Unsupported;
  return DsdMode::Pcm;
}

std::string playbackInfoToJson(const PlaybackInfo& info) {
  const OutputInfo& out = info.outputInfo;
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
       << "\"decodedSampleRate\":" << info.decodedSampleRate << ","
       << "\"decodedBitDepth\":" << info.decodedBitDepth << ","
       << "\"decodedChannels\":" << info.decodedChannels << ","
       << "\"decodedSampleFormat\":\"" << escapeJson(info.decodedSampleFormat) << "\","
       << "\"outputBackend\":\"" << escapeJson(info.outputBackend) << "\","
       << "\"outputDevice\":\"" << escapeJson(info.outputDevice) << "\","
       << "\"outputInfo\":{"
       << "\"exclusive\":" << (out.exclusive ? "true" : "false") << ","
       << "\"accessMode\":\"" << escapeJson(out.accessMode) << "\","
       << "\"supportsOutputPerfect\":" << (out.supportsOutputPerfect ? "true" : "false") << ","
       << "\"sourceExact\":" << (out.sourceExact ? "true" : "false") << ","
       << "\"outputPerfect\":" << (out.outputPerfect ? "true" : "false") << ","
       << "\"pcmPassthrough\":" << (out.pcmPassthrough ? "true" : "false") << ","
       << "\"resampled\":" << (out.resampled ? "true" : "false") << ","
       << "\"isDsd\":" << (out.isDsd ? "true" : "false") << ","
       << "\"dsdMode\":\"" << escapeJson(out.dsdMode) << "\","
       << "\"dsdRate\":" << out.dsdRate << ","
       << "\"outputSampleRate\":" << out.outputSampleRate << ","
       << "\"outputBitDepth\":" << out.outputBitDepth << ","
       << "\"backend\":\"" << escapeJson(out.backend) << "\","
       << "\"actualBackend\":\"" << escapeJson(out.actualBackend) << "\","
       << "\"devicePathKind\":\"" << escapeJson(out.devicePathKind) << "\","
       << "\"deviceName\":\"" << escapeJson(out.deviceName) << "\","
       << "\"actualDeviceName\":\"" << escapeJson(out.actualDeviceName) << "\","
       << "\"driverName\":\"" << escapeJson(out.driverName) << "\","
       << "\"actualDriverName\":\"" << escapeJson(out.actualDriverName) << "\","
       << "\"driverVersion\":" << out.driverVersion << ","
       << "\"actualDriverVersion\":" << out.actualDriverVersion << ","
       << "\"actualOutputFormat\":\"" << escapeJson(out.actualOutputFormat) << "\","
       << "\"actualSampleRate\":" << out.actualSampleRate << ","
       << "\"actualBitDepth\":" << out.actualBitDepth << ","
       << "\"actualChannels\":" << out.actualChannels << ","
       << "\"perfectReasonCode\":\"" << escapeJson(out.perfectReasonCode) << "\","
       << "\"capabilityReason\":\"" << escapeJson(out.capabilityReason) << "\","
       << "\"driverDopCapable\":" << (out.driverDopCapable ? "true" : "false") << ","
       << "\"driverNativeDsdCapable\":" << (out.driverNativeDsdCapable ? "true" : "false") << ","
       << "\"driverDopCarrierSampleRates\":[";
  for (size_t i = 0; i < out.driverDopCarrierSampleRates.size(); ++i) {
    if (i > 0) json << ",";
    json << out.driverDopCarrierSampleRates[i];
  }
  json << "],\"driverDopCarrierFormats\":[";
  for (size_t i = 0; i < out.driverDopCarrierFormats.size(); ++i) {
    if (i > 0) json << ",";
    json << "\"" << escapeJson(out.driverDopCarrierFormats[i]) << "\"";
  }
  json << "],\"driverNativeDsdSampleRates\":[";
  for (size_t i = 0; i < out.driverNativeDsdSampleRates.size(); ++i) {
    if (i > 0) json << ",";
    json << out.driverNativeDsdSampleRates[i];
  }
  json << "],"
       << "\"nativeDsdRuntimeState\":\"" << escapeJson(out.nativeDsdRuntimeState) << "\","
       << "\"nativeDsdRequestedRate\":" << out.nativeDsdRequestedRate << ","
       << "\"nativeDsdActualRate\":" << out.nativeDsdActualRate << ","
       << "\"nativeDsdChannels\":" << out.nativeDsdChannels << ","
       << "\"nativeDsdExplicitlyCapable\":" << (out.nativeDsdExplicitlyCapable ? "true" : "false") << ","
       << "\"nativeDsdAdvertisedSampleRates\":[";
  for (size_t i = 0; i < out.nativeDsdAdvertisedSampleRates.size(); ++i) {
    if (i > 0) json << ",";
    json << out.nativeDsdAdvertisedSampleRates[i];
  }
  json << "],"
       << "\"nativeDsdRuntimeReason\":\"" << escapeJson(out.nativeDsdRuntimeReason) << "\","
       << "\"bufferSizeFrames\":" << out.bufferSizeFrames << ","
       << "\"latencyFrames\":" << out.latencyFrames << ","
       << "\"latencyMs\":" << out.latencyMs << ","
       << "\"latencyInfo\":";
  writeLatencyInfoJson(json, out.latencyInfo);
  json << ","
       << "\"channelRoutingMode\":\"" << escapeJson(out.channelRoutingMode) << "\","
       << "\"perfectReason\":\"" << escapeJson(out.perfectReason) << "\","
       << "\"diagnostics\":";
  writeDiagnosticsJson(json, out.diagnostics);
  json << ","
       << "\"deviceRecovered\":" << (out.deviceRecovered ? "true" : "false") << ","
       << "\"recoveryCount\":" << out.recoveryCount
       << "},"
       << "\"actualBackend\":\"" << escapeJson(out.actualBackend) << "\","
       << "\"driverName\":\"" << escapeJson(out.driverName.empty() ? out.actualDriverName : out.driverName) << "\","
       << "\"driverVersion\":" << (out.driverVersion != 0 ? out.driverVersion : out.actualDriverVersion) << ","
       << "\"actualOutputFormat\":\"" << escapeJson(out.actualOutputFormat) << "\","
       << "\"actualSampleRate\":" << out.actualSampleRate << ","
       << "\"actualBitDepth\":" << out.actualBitDepth << ","
       << "\"actualChannels\":" << out.actualChannels << ","
       << "\"bufferSizeFrames\":" << out.bufferSizeFrames << ","
       << "\"latencyFrames\":" << out.latencyFrames << ","
       << "\"latencyMs\":" << out.latencyMs << ","
       << "\"latencyInfo\":";
  writeLatencyInfoJson(json, out.latencyInfo);
  json << ","
       << "\"channelRoutingMode\":\"" << escapeJson(out.channelRoutingMode) << "\","
       << "\"diagnostics\":";
  writeDiagnosticsJson(json, out.diagnostics);
  json << ","
       << "\"deviceRecovered\":" << (out.deviceRecovered ? "true" : "false") << ","
       << "\"recoveryCount\":" << out.recoveryCount << ","
       << "\"outputSampleRate\":" << out.outputSampleRate << ","
       << "\"outputBitDepth\":" << out.outputBitDepth << ","
       << "\"channelCount\":" << info.channelCount << ","
       << "\"supportsOutputPerfect\":" << (out.supportsOutputPerfect ? "true" : "false") << ","
       << "\"sourceExact\":" << (out.sourceExact ? "true" : "false") << ","
       << "\"outputPerfect\":" << (out.outputPerfect ? "true" : "false") << ","
       << "\"pcmPassthrough\":" << (out.pcmPassthrough ? "true" : "false") << ","
       << "\"dspActive\":" << (info.dspActive ? "true" : "false") << ","
       << "\"replayGainActive\":" << (info.replayGainActive ? "true" : "false") << ","
       << "\"eqActive\":" << (info.eqActive ? "true" : "false") << ","
       << "\"convolverActive\":" << (info.convolverActive ? "true" : "false") << ","
       << "\"crossfeedActive\":" << (info.crossfeedActive ? "true" : "false") << ","
       << "\"crossfadeActive\":" << (info.crossfadeActive ? "true" : "false") << ","
       << "\"fftActive\":" << (info.fftActive ? "true" : "false") << ","
       << "\"irResampled\":" << (info.irResampled ? "true" : "false") << ","
       << "\"replayGainDb\":" << info.replayGainDb << ","
       << "\"crossfeedStrength\":" << info.crossfeedStrength << ","
       << "\"crossfadeSeconds\":" << info.crossfadeSeconds << ","
       << "\"convolverLatencyFrames\":" << info.convolverLatencyFrames << ","
       << "\"partitionSize\":" << info.partitionSize << ","
       << "\"channelMappingMode\":\"" << escapeJson(info.channelMappingMode) << "\","
       << "\"perfectReasonCode\":\"" << escapeJson(info.perfectReasonCode) << "\","
       << "\"perfectReason\":\"" << escapeJson(info.perfectReason) << "\","
       << "\"isDsd\":" << (info.isDsd ? "true" : "false") << ","
       << "\"dsdMode\":\"" << escapeJson(info.dsdMode) << "\","
       << "\"dsdRate\":" << info.dsdRate << ","
       << "\"gaplessActive\":" << (info.gaplessActive ? "true" : "false") << ","
       << "\"preloadReady\":" << (info.preloadReady ? "true" : "false") << ","
       << "\"upcomingTrack\":"
       << QueueManager::itemToJson(info.hasUpcomingTrack ? std::optional<QueueItem>(info.upcomingTrack) : std::nullopt)
       << "}";
  return json.str();
}

DspStatus configuredDspStatusFromConfig(const DspConfig& config) {
  DspStatus status;
  status.crossfadeActive = config.crossfadeSeconds > 0.0001;
  status.crossfadeSeconds = status.crossfadeActive ? config.crossfadeSeconds : 0.0;
  if (config.enabled) {
    status.replayGainActive = config.replayGainMode != ReplayGainMode::Off;
    status.eqActive = config.eqEnabled;
    status.crossfeedActive = config.crossfeedEnabled && config.crossfeedStrength > 0.0001;
  }
  status.crossfeedStrength = status.crossfeedActive ? config.crossfeedStrength : 0.0;
  status.dspActive =
      status.replayGainActive || status.eqActive || status.convolverActive || status.crossfeedActive ||
      status.crossfadeActive;
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
  const DspConfig config = DspChain::parseConfigJson(dspJson);
  return config.gapless || config.crossfadeSeconds > 0.0001;
}

uint32_t parseUintField(const std::string& json, const std::string& key, uint32_t fallback) {
  const std::string marker = "\"" + key + "\":";
  const size_t pos = json.find(marker);
  if (pos == std::string::npos) return fallback;
  const size_t start = pos + marker.size();
  size_t end = start;
  while (end < json.size() && std::isdigit(static_cast<unsigned char>(json[end]))) ++end;
  if (end == start) return fallback;
  try {
    return static_cast<uint32_t>(std::stoul(json.substr(start, end - start)));
  } catch (...) {
    return fallback;
  }
}

std::string parseStringField(const std::string& json, const std::string& key, const std::string& fallback) {
  const std::string marker = "\"" + key + "\":\"";
  const size_t pos = json.find(marker);
  if (pos == std::string::npos) return fallback;
  const size_t start = pos + marker.size();
  size_t end = start;
  bool escaped = false;
  for (; end < json.size(); ++end) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (json[end] == '\\') {
      escaped = true;
      continue;
    }
    if (json[end] == '"') break;
  }
  return escapeJson(json.substr(start, end - start));
}

OutputConfig parseOutputConfigJson(const std::string& json) {
  OutputConfig config;
  config.preferredBufferSize = parseUintField(json, "preferredBufferSize", 0);
  config.routingMode = parseChannelRoutingMode(parseStringField(json, "routingMode", "auto"));
  return config;
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
  info_.outputBackend = defaultBackendId();
  if (info_.outputBackend.empty()) info_.outputBackend = "none";
  info_.outputInfo.backend = info_.outputBackend;
  info_.outputInfo.actualBackend = info_.outputBackend;
  info_.outputInfo.exclusive = false;
  info_.outputInfo.accessMode = "shared";
  info_.outputInfo.supportsOutputPerfect = false;
  info_.outputInfo.devicePathKind = "default";
  updatePerfectLocked();
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
    info_.isDsd = info_.codec == "dsd";
    info_.dsdMode = info_.isDsd ? dsdModeToString(DsdMode::Unsupported) : dsdModeToString(DsdMode::Pcm);
    info_.dsdRate = 0;
    info_.outputInfo.isDsd = info_.isDsd;
    info_.outputInfo.dsdMode = info_.dsdMode;
    info_.outputInfo.dsdRate = 0;
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
    emitError(error.empty() ? "无法启动原生音频播放" : error, result, "play");
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
    if (pipeline_->isDopPathActive()) {
      return restartCurrentPlaybackForReroute(
          std::max(0.0, positionSeconds),
          currentState,
          {},
          "seek");
    }
    const TAE_Result result = pipeline_->seek(positionSeconds, &error);
    if (result != TAE_RESULT_OK) {
      emitError(error.empty() ? "无法跳转原生音频播放位置" : error, result, "seek");
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
  std::string rerouteReason;
  double reroutePosition = 0.0;
  PlaybackState rerouteState = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    info_.volume = std::clamp(volume, 0.0, 1.0);
    if (pipeline_) pipeline_->setVolume(info_.volume);
    if (pipeline_ && info_.state != PlaybackState::Stopped) {
      applyPipelineStatusLocked(pipeline_->status());
      if (!shouldReroutePipelineLocked(&rerouteReason, &reroutePosition, &rerouteState)) {
        publishStateLocked();
      }
    } else {
      updatePerfectLocked();
      publishStateLocked();
    }
  }
  if (!rerouteReason.empty()) {
    return restartCurrentPlaybackForReroute(reroutePosition, rerouteState, rerouteReason, "volume");
  }
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
    info_.outputInfo = {};
    info_.outputInfo.backend = info_.outputBackend;
    info_.outputInfo.actualBackend = info_.outputBackend;
    info_.outputInfo.channelRoutingMode = channelRoutingModeToString(outputConfig_.routingMode);
    source = info_.source;
    position = info_.positionSeconds;
    state = info_.state;
    updatePerfectLocked();
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
    emitError(error.empty() ? "播放队列加载失败" : error, TAE_RESULT_INVALID_ARGUMENT, "queue");
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
    emitError(error.empty() ? "无法加入播放队列" : error, TAE_RESULT_INVALID_ARGUMENT, "queue");
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
  std::string rerouteReason;
  double reroutePosition = 0.0;
  PlaybackState rerouteState = PlaybackState::Stopped;
  DspConfig previousConfig;
  const DspConfig nextConfig = DspChain::parseConfigJson(dspJson.empty() ? "{}" : dspJson);
  {
    std::lock_guard lock(mutex_);
    previousConfig = DspChain::parseConfigJson(dspConfigJson_);
    dspConfigJson_ = dspJson.empty() ? "{}" : dspJson;
    if (pipeline_) pipeline_->setDspConfig(dspConfigJson_);
    if (pipeline_ && info_.state != PlaybackState::Stopped) {
      applyPipelineStatusLocked(pipeline_->status());
      if (info_.isDsd) {
        const bool previousForcedPcm =
            previousConfig.dsdOutputMode == DsdOutputMode::Pcm || previousConfig.dsdOutputMode == DsdOutputMode::Native;
        const bool previousWantedDop =
            previousConfig.dsdOutputMode == DsdOutputMode::Auto || previousConfig.dsdOutputMode == DsdOutputMode::Dop;
        const bool wantsPcm = nextConfig.dsdOutputMode == DsdOutputMode::Pcm;
        const bool wantsNative = nextConfig.dsdOutputMode == DsdOutputMode::Native;
        const bool wantsDop =
            nextConfig.dsdOutputMode == DsdOutputMode::Auto || nextConfig.dsdOutputMode == DsdOutputMode::Dop;
        const bool dopActive = pipeline_->isDopPathActive();
        if (previousWantedDop && (wantsPcm || wantsNative)) {
          rerouteReason = wantsPcm ? "DSD output mode forced PCM" : "Native DSD not yet available; falling back to PCM";
          reroutePosition = info_.positionSeconds;
          rerouteState = info_.state;
        } else if (previousForcedPcm && wantsDop) {
          reroutePosition = info_.positionSeconds;
          rerouteState = info_.state;
          rerouteReason = "Re-enter DoP output mode";
        } else if (dopActive && (wantsPcm || wantsNative)) {
          rerouteReason = wantsPcm ? "DSD output mode forced PCM" : "Native DSD not yet available; falling back to PCM";
          reroutePosition = info_.positionSeconds;
          rerouteState = info_.state;
        } else if (!dopActive && wantsDop &&
                   (info_.dsdMode == "pcm" || info_.outputInfo.dsdMode == "pcm")) {
          reroutePosition = info_.positionSeconds;
          rerouteState = info_.state;
          rerouteReason = "Re-enter DoP output mode";
        }
      }
      if (rerouteReason.empty() &&
          !shouldReroutePipelineLocked(&rerouteReason, &reroutePosition, &rerouteState)) {
        publishStateLocked();
      }
    } else {
      const DspStatus configStatus = configuredDspStatusFromConfig(nextConfig);
      info_.replayGainActive = configStatus.replayGainActive;
      info_.eqActive = configStatus.eqActive;
      info_.crossfeedActive = configStatus.crossfeedActive;
      info_.crossfeedStrength = configStatus.crossfeedStrength;
      info_.crossfadeActive = configStatus.crossfadeActive;
      info_.crossfadeSeconds = configStatus.crossfadeSeconds;
      if (!nextConfig.enabled) info_.convolverActive = false;
      updatePerfectLocked();
      publishStateLocked();
    }
  }
  if (!rerouteReason.empty()) {
    return restartCurrentPlaybackForReroute(reroutePosition, rerouteState, rerouteReason, "dsp");
  }
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::setOutputConfig(const std::string& outputConfigJson) {
  OutputConfig parsed = parseOutputConfigJson(outputConfigJson.empty() ? "{}" : outputConfigJson);
  std::string error;
  std::string rerouteReason;
  double reroutePosition = 0.0;
  PlaybackState rerouteState = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    outputConfig_ = parsed;
  }
  if (pipeline_ && !pipeline_->setOutputConfig(parsed, &error)) {
    emitError(error.empty() ? "输出配置设置失败" : error, TAE_RESULT_INVALID_ARGUMENT, "output-config");
    return TAE_RESULT_INVALID_ARGUMENT;
  }
  std::lock_guard lock(mutex_);
  info_.outputInfo.channelRoutingMode = channelRoutingModeToString(outputConfig_.routingMode);
  if (pipeline_ && info_.state != PlaybackState::Stopped) {
    applyPipelineStatusLocked(pipeline_->status());
    if (shouldReroutePipelineLocked(&rerouteReason, &reroutePosition, &rerouteState)) {
      // Defer publish until the reroute completes.
    } else {
      publishStateLocked();
    }
  } else {
    updatePerfectLocked();
    publishStateLocked();
  }
  if (!rerouteReason.empty()) {
    return restartCurrentPlaybackForReroute(reroutePosition, rerouteState, rerouteReason, "output-config");
  }
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::loadImpulseResponse(const std::string& path) {
  if (path.empty()) return TAE_RESULT_INVALID_ARGUMENT;
  std::string error;
  if (!pipeline_ || !pipeline_->loadImpulseResponse(path, &error)) {
    emitError(error.empty() ? "脉冲响应加载失败" : error, TAE_RESULT_INVALID_ARGUMENT, "dsp");
    return TAE_RESULT_INTERNAL_ERROR;
  }
  std::string rerouteReason;
  double reroutePosition = 0.0;
  PlaybackState rerouteState = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    applyPipelineStatusLocked(pipeline_->status());
    if (!shouldReroutePipelineLocked(&rerouteReason, &reroutePosition, &rerouteState)) {
      publishStateLocked();
    }
  }
  if (!rerouteReason.empty()) {
    return restartCurrentPlaybackForReroute(reroutePosition, rerouteState, rerouteReason, "dsp");
  }
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::unloadImpulseResponse() {
  if (!pipeline_) return TAE_RESULT_NOT_INITIALIZED;
  pipeline_->unloadImpulseResponse();
  std::string rerouteReason;
  double reroutePosition = 0.0;
  PlaybackState rerouteState = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    applyPipelineStatusLocked(pipeline_->status());
    if (!shouldReroutePipelineLocked(&rerouteReason, &reroutePosition, &rerouteState)) {
      publishStateLocked();
    }
  }
  if (!rerouteReason.empty()) {
    return restartCurrentPlaybackForReroute(reroutePosition, rerouteState, rerouteReason, "dsp");
  }
  return TAE_RESULT_OK;
}

std::string TwilightAudioEngine::getConvolverInfoJson() const {
  return convolverInfoToJson(pipeline_ ? pipeline_->convolverInfo() : ConvolverInfo{});
}

TAE_Result TwilightAudioEngine::setEqBands(const std::string& eqJson) {
  std::string error;
  if (!pipeline_ || !pipeline_->setEqBands(eqJson, &error)) {
    emitError(error.empty() ? "均衡器设置失败" : error, TAE_RESULT_INVALID_ARGUMENT, "dsp");
    return TAE_RESULT_INVALID_ARGUMENT;
  }
  std::string rerouteReason;
  double reroutePosition = 0.0;
  PlaybackState rerouteState = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    applyPipelineStatusLocked(pipeline_->status());
    if (!shouldReroutePipelineLocked(&rerouteReason, &reroutePosition, &rerouteState)) {
      publishStateLocked();
    }
  }
  if (!rerouteReason.empty()) {
    return restartCurrentPlaybackForReroute(reroutePosition, rerouteState, rerouteReason, "dsp");
  }
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::setEqPreset(const std::string& presetJson) {
  std::string error;
  if (!pipeline_ || !pipeline_->setEqPreset(presetJson, &error)) {
    emitError(error.empty() ? "均衡器预设应用失败" : error, TAE_RESULT_INVALID_ARGUMENT, "dsp");
    return TAE_RESULT_INVALID_ARGUMENT;
  }
  std::string rerouteReason;
  double reroutePosition = 0.0;
  PlaybackState rerouteState = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    applyPipelineStatusLocked(pipeline_->status());
    if (!shouldReroutePipelineLocked(&rerouteReason, &reroutePosition, &rerouteState)) {
      publishStateLocked();
    }
  }
  if (!rerouteReason.empty()) {
    return restartCurrentPlaybackForReroute(reroutePosition, rerouteState, rerouteReason, "dsp");
  }
  return TAE_RESULT_OK;
}

TAE_Result TwilightAudioEngine::setCrossfeedStrength(double strength) {
  if (!std::isfinite(strength)) return TAE_RESULT_INVALID_ARGUMENT;
  if (!pipeline_) return TAE_RESULT_NOT_INITIALIZED;
  pipeline_->setCrossfeedStrength(strength);
  std::string rerouteReason;
  double reroutePosition = 0.0;
  PlaybackState rerouteState = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    applyPipelineStatusLocked(pipeline_->status());
    if (!shouldReroutePipelineLocked(&rerouteReason, &reroutePosition, &rerouteState)) {
      publishStateLocked();
    }
  }
  if (!rerouteReason.empty()) {
    return restartCurrentPlaybackForReroute(reroutePosition, rerouteState, rerouteReason, "dsp");
  }
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
  std::string rerouteReason;
  double reroutePosition = 0.0;
  PlaybackState rerouteState = PlaybackState::Stopped;
  {
    std::lock_guard lock(mutex_);
    applyPipelineStatusLocked(pipeline_->status());
    if (!shouldReroutePipelineLocked(&rerouteReason, &reroutePosition, &rerouteState)) {
      publishStateLocked();
    }
  }
  if (!rerouteReason.empty()) {
    return restartCurrentPlaybackForReroute(reroutePosition, rerouteState, rerouteReason, "dsp");
  }
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
  std::ostringstream json;
  json << "[";
  bool first = true;
  auto append = [&](const char* id, const char* label, bool supportsExclusive, bool optional = false) {
    if (!first) json << ",";
    first = false;
    json << "{\"id\":\"" << id << "\",\"label\":\"" << label << "\",\"supportsExclusive\":"
         << (supportsExclusive ? "true" : "false");
    if (optional) json << ",\"optional\":true";
    json << "}";
  };
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  append("wasapi", "共享输出", false);
  append("wasapi-exclusive", "独占输出", true);
#endif
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  append("asio", "专业声卡输出", true, true);
#endif
#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
  append("coreaudio", "苹果系统音频", false);
#endif
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  append("alsa", "Linux ALSA 输出", false);
#endif
  json << "]";
  return json.str();
}

std::string TwilightAudioEngine::engineCapabilitiesJson() const {
  const std::string backends = enumerateBackendsJson();
  const std::string backendCapabilities = backendCapabilitiesJson();
  std::ostringstream json;
  json << "{"
       << "\"version\":\"" << TAE_GetVersion() << "\","
       << "\"defaultBackend\":\"" << escapeJson(defaultBackendId()) << "\","
       << "\"pcmPassthrough\":true,"
       << "\"outputPerfectRequiresPcmPassthrough\":true,"
       << "\"htmlAudioFallbackDefault\":false,"
       << "\"dsdModes\":[\"pcm\",\"dop\",\"native\",\"unsupported\"],"
       << "\"sacdProgramModes\":[\"auto\",\"stereo\",\"multichannel\"],"
       << "\"devicePathKinds\":[\"default\",\"hw\",\"plughw\",\"hal\",\"asio\"],"
       << "\"dsd\":{\"native\":false,\"dop\":false,\"sacdIso\":false,\"mode\":\"unsupported\"},"
       << "\"features\":{"
       << "\"ffmpeg\":"
#if defined(TAE_HAS_FFMPEG)
       << "true"
#else
       << "false"
#endif
       << ",\"wasapi\":"
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
       << "true"
#else
       << "false"
#endif
       << ",\"asio\":"
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
       << "true"
#else
       << "false"
#endif
       << ",\"coreaudio\":"
#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
       << "true"
#else
       << "false"
#endif
       << ",\"alsa\":"
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
       << "true"
#else
       << "false"
#endif
       << ",\"nativeDsd\":false,\"dop\":false,\"sacdIso\":false"
       << "},\"backends\":" << backends
       << ",\"backendCapabilities\":" << backendCapabilities
       << ",\"output\":{\"accessModes\":[\"shared\",\"exclusive\",\"hog\",\"direct\",\"plugin\"]}"
       << "}";
  return json.str();
}

std::string TwilightAudioEngine::getLastErrorJson() const {
  std::lock_guard lock(errorMutex_);
  const bool hasError = !lastError_.empty();
  std::ostringstream json;
  json << "{\"hasError\":" << (hasError ? "true" : "false") << ",\"code\":\""
       << resultToString(hasError ? lastErrorCode_ : TAE_RESULT_OK) << "\",\"message\":\""
       << escapeJson(lastError_) << "\",\"backend\":\"\",\"context\":\""
       << escapeJson(lastErrorContext_.empty() ? "native" : lastErrorContext_) << "\",\"recoverable\":"
       << (hasError && lastErrorCode_ != TAE_RESULT_INVALID_ARGUMENT ? "true" : "false") << "}";
  return json.str();
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
          emitError(
              deviceInvalidatedMessage.empty() ? "输出设备已失效，自动恢复失败" : deviceInvalidatedMessage,
              TAE_RESULT_BACKEND_UNAVAILABLE,
              "device-recovery");
        }
      } else {
        if (pipeline_) pipeline_->stop();
        emitError(
            deviceInvalidatedMessage.empty() ? "输出设备已失效" : deviceInvalidatedMessage,
            TAE_RESULT_BACKEND_UNAVAILABLE,
            "device");
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
    std::optional<QueueItem> autoNextItem;
    {
      std::lock_guard lock(mutex_);
      if (hasPipelineStatus && info_.state != PlaybackState::Stopped) {
        applyPipelineStatusLocked(pipelineStatus);
      }
      if (emitEnded) {
        autoNextItem = queue_.advanceAfterEnd();
        if (autoNextItem && !autoNextItem->source.empty()) {
          info_.queueIndex = queue_.currentIndex();
          info_.playMode = queue_.playModeId();
          info_.source = autoNextItem->source;
          info_.durationSeconds = autoNextItem->durationSeconds;
          info_.positionSeconds = 0.0;
          info_.codec = inferCodec(autoNextItem->source);
          info_.hasUpcomingTrack = queue_.upcoming().has_value();
          info_.upcomingTrack = queue_.upcoming().value_or(QueueItem{});
        } else {
          info_.state = PlaybackState::Stopped;
          if (info_.durationSeconds > 0.0) info_.positionSeconds = info_.durationSeconds;
        }
      }
      if (!autoNextItem &&
          (info_.state == PlaybackState::Playing || info_.state == PlaybackState::Paused || emitEnded)) {
        payload = playbackInfoToJson(info_);
        emitTick = true;
      }
    }
    if (autoNextItem && !autoNextItem->source.empty()) {
      const TAE_Result result = play(autoNextItem->source, 0.0);
      if (result == TAE_RESULT_OK) {
        emit("start-file", "{}");
      } else {
        emit("end-file", "{\"reason\":\"error\"}");
      }
      continue;
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

void TwilightAudioEngine::emitError(const std::string& message, TAE_Result code, const std::string& context) const {
  {
    std::lock_guard lock(errorMutex_);
    lastError_ = message;
    lastErrorCode_ = code;
    lastErrorContext_ = context.empty() ? "native" : context;
  }
  emit("error", "{\"code\":\"" + std::string(resultToString(code)) + "\",\"message\":\"" + escapeJson(message) +
                    "\",\"context\":\"" + escapeJson(lastErrorContext_) + "\"}");
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
  info_.decodedSampleRate = status.stream.decodedFormat.sampleRate;
  info_.decodedBitDepth = status.stream.decodedFormat.bitDepth;
  info_.decodedChannels = status.stream.decodedFormat.channelCount;
  info_.decodedSampleFormat = sampleFormatToString(status.stream.decodedFormat.sampleFormat);
  info_.queueIndex = queue_.currentIndex();
  info_.playMode = queue_.playModeId();
  info_.outputBackend = status.backendId.empty() ? info_.outputBackend : status.backendId;
  (void)status.deviceName;
  info_.outputSampleRate = status.outputFormat.sampleRate;
  info_.outputBitDepth = status.outputFormat.bitDepth;
  info_.outputInfo = status.outputInfo;
  if (info_.outputInfo.backend.empty()) info_.outputInfo.backend = info_.outputBackend;
  if (info_.outputInfo.actualBackend.empty()) info_.outputInfo.actualBackend = info_.outputInfo.backend;
  if (info_.outputInfo.deviceName.empty()) info_.outputInfo.deviceName = status.deviceName;
  if (info_.outputInfo.actualDeviceName.empty()) info_.outputInfo.actualDeviceName = info_.outputInfo.deviceName;
  if (info_.outputInfo.actualDriverName.empty()) info_.outputInfo.actualDriverName = info_.outputInfo.driverName;
  if (info_.outputInfo.actualDriverVersion == 0) info_.outputInfo.actualDriverVersion = info_.outputInfo.driverVersion;
  if (info_.outputInfo.outputSampleRate <= 0) info_.outputInfo.outputSampleRate = status.outputFormat.sampleRate;
  if (info_.outputInfo.outputBitDepth <= 0) info_.outputInfo.outputBitDepth = status.outputFormat.bitDepth;
  info_.outputInfo.sourceExact = status.sourceExact;
  info_.outputInfo.outputPerfect = status.outputPerfect;
  info_.outputInfo.pcmPassthrough = status.outputInfo.pcmPassthrough;
  info_.outputInfo.isDsd = status.stream.isDsd;
  info_.outputInfo.dsdMode = status.stream.isDsd ? dsdModeToString(status.stream.dsdMode) : dsdModeToString(DsdMode::Pcm);
  info_.outputInfo.dsdRate = status.stream.isDsd ? status.stream.dsdRate : 0;
  if (info_.outputInfo.perfectReason.empty()) info_.outputInfo.perfectReason = status.perfectReason;
  info_.channelCount = status.outputFormat.channelCount;
  info_.dspActive = status.dspActive;
  info_.replayGainActive = status.replayGainActive;
  info_.eqActive = status.eqActive;
  info_.convolverActive = status.convolverActive;
  info_.crossfeedActive = status.crossfeedActive;
  info_.crossfadeActive = status.crossfadeActive;
  info_.fftActive = status.fftActive;
  info_.irResampled = status.irResampled;
  info_.replayGainDb = status.replayGainDb;
  info_.crossfeedStrength = status.crossfeedStrength;
  info_.crossfadeSeconds = status.crossfadeSeconds;
  info_.convolverLatencyFrames = status.convolverLatencyFrames;
  info_.partitionSize = status.partitionSize;
  info_.channelMappingMode = status.channelMappingMode;
  info_.gaplessActive = status.gaplessActive;
  info_.preloadReady = status.preloadReady;
  const auto upcoming = queue_.upcoming();
  info_.hasUpcomingTrack = upcoming.has_value();
  info_.upcomingTrack = upcoming.value_or(QueueItem{});
  info_.perfectReason = status.perfectReason;
  info_.isDsd = status.stream.isDsd;
  info_.dsdMode = status.stream.isDsd ? dsdModeToString(status.stream.dsdMode) : dsdModeToString(DsdMode::Pcm);
  info_.dsdRate = status.stream.isDsd ? status.stream.dsdRate : 0;
  normalizeOutputInfoMirror(info_);
}

void TwilightAudioEngine::updatePerfectLocked() {
  if (info_.outputInfo.backend.empty()) info_.outputInfo.backend = info_.outputBackend;
  if (info_.outputInfo.actualBackend.empty()) info_.outputInfo.actualBackend = info_.outputInfo.backend;
  info_.outputInfo.channelRoutingMode = channelRoutingModeToString(outputConfig_.routingMode);
  if (info_.outputInfo.outputSampleRate <= 0) info_.outputInfo.outputSampleRate = info_.outputSampleRate;
  if (info_.outputInfo.outputBitDepth <= 0) info_.outputInfo.outputBitDepth = info_.outputBitDepth;

  AudioFormat sourceFormat;
  sourceFormat.sampleRate = info_.sourceSampleRate;
  sourceFormat.channelCount = info_.channelCount > 0 ? info_.channelCount : info_.outputInfo.actualChannels;
  sourceFormat.bitDepth = info_.sourceBitDepth;
  sourceFormat.sampleFormat = sampleFormatFromText("", sourceFormat.bitDepth);

  AudioFormat decodedFormat;
  decodedFormat.sampleRate = info_.decodedSampleRate > 0 ? info_.decodedSampleRate : info_.outputSampleRate;
  decodedFormat.channelCount =
      info_.decodedChannels > 0 ? info_.decodedChannels : (info_.channelCount > 0 ? info_.channelCount : info_.outputInfo.actualChannels);
  decodedFormat.bitDepth = info_.decodedBitDepth > 0 ? info_.decodedBitDepth : info_.outputBitDepth;
  decodedFormat.sampleFormat = sampleFormatFromText(info_.decodedSampleFormat, decodedFormat.bitDepth);

  AudioFormat outputFormat;
  outputFormat.sampleRate = info_.outputInfo.outputSampleRate;
  outputFormat.channelCount = info_.outputInfo.actualChannels > 0 ? info_.outputInfo.actualChannels : info_.channelCount;
  outputFormat.bitDepth =
      info_.outputInfo.actualBitDepth > 0 ? info_.outputInfo.actualBitDepth : info_.outputInfo.outputBitDepth;
  outputFormat.sampleFormat = sampleFormatFromText(info_.outputInfo.actualOutputFormat, outputFormat.bitDepth);

  const bool backendResampled = info_.outputInfo.resampled;
  const std::string backendPerfectReason =
      (!info_.outputInfo.supportsOutputPerfect || backendResampled) ? info_.outputInfo.perfectReason : "";
  PerfectEvaluation evaluation;
  evaluation.sourceFormat = sourceFormat;
  evaluation.decodedFormat = decodedFormat;
  evaluation.outputFormat = outputFormat;
  evaluation.sourceLossless = codecLooksLossless(info_.codec);
  evaluation.sourceDsd = info_.isDsd || info_.codec == "dsd";
  if (evaluation.sourceDsd) {
    evaluation.dsdMode = parseDsdMode(info_.dsdMode);
    evaluation.dsdRate = info_.dsdRate;
  }
  evaluation.supportsOutputPerfect = info_.outputInfo.supportsOutputPerfect;
  evaluation.backendResampled = backendResampled;
  evaluation.backendPerfectReason = backendPerfectReason;
  evaluation.volume = info_.volume;
  evaluation.replayGainActive = info_.replayGainActive;
  evaluation.eqActive = info_.eqActive;
  evaluation.convolverActive = info_.convolverActive;
  evaluation.crossfeedActive = info_.crossfeedActive;
  evaluation.crossfadeActive = info_.crossfadeActive || DspChain::parseConfigJson(dspConfigJson_).crossfadeSeconds > 0.0001;
  evaluation.routingMode = outputConfig_.routingMode;
  evaluation.pcmPassthrough = pcmFormatsExactMatch(decodedFormat, outputFormat) && !backendResampled;
  const PerfectResult result = evaluatePerfect(evaluation);
  info_.dspActive = result.processingActive;
  info_.outputInfo.sourceExact = result.sourceExact;
  info_.outputInfo.resampled = result.resampled;
  info_.outputInfo.outputPerfect = result.outputPerfect;
  info_.outputInfo.pcmPassthrough = result.pcmPassthrough;
  info_.outputInfo.isDsd = evaluation.sourceDsd;
  info_.outputInfo.dsdMode = evaluation.sourceDsd ? dsdModeToString(evaluation.dsdMode) : dsdModeToString(DsdMode::Pcm);
  info_.outputInfo.dsdRate = evaluation.sourceDsd ? evaluation.dsdRate : 0;
  info_.outputInfo.perfectReason = result.perfectReason;
  info_.outputInfo.perfectReasonCode = result.perfectReasonCode;
  info_.perfectReasonCode = result.perfectReasonCode;
  info_.perfectReason = result.perfectReason;
  normalizeOutputInfoMirror(info_);
}

bool TwilightAudioEngine::shouldReroutePipelineLocked(
    std::string* reason,
    double* position,
    PlaybackState* state) const {
  if (!pipeline_ || info_.state == PlaybackState::Stopped) return false;
  const DspConfig config = DspChain::parseConfigJson(dspConfigJson_);
  if (info_.isDsd) {
    const bool wantsPcm = config.dsdOutputMode == DsdOutputMode::Pcm;
    const bool wantsNative = config.dsdOutputMode == DsdOutputMode::Native;
    const bool wantsDop = config.dsdOutputMode == DsdOutputMode::Auto || config.dsdOutputMode == DsdOutputMode::Dop;
    if (pipeline_->isDopPathActive() && (wantsPcm || wantsNative)) {
      if (reason) {
        *reason = wantsPcm ? "DSD output mode forced PCM" : "Native DSD not yet available; falling back to PCM";
      }
      if (position) *position = info_.positionSeconds;
      if (state) *state = info_.state;
      return true;
    }
    if (!pipeline_->isDopPathActive() && info_.dsdMode == "pcm" && wantsDop) {
      if (position) *position = info_.positionSeconds;
      if (state) *state = info_.state;
      return true;
    }
  }
  std::string fallbackReason;
  if (!pipeline_->needsPcmFallback(&fallbackReason)) return false;
  if (reason) *reason = std::move(fallbackReason);
  if (position) *position = info_.positionSeconds;
  if (state) *state = info_.state;
  return true;
}

TAE_Result TwilightAudioEngine::restartCurrentPlaybackForReroute(
    double positionSeconds,
    PlaybackState previousState,
    const std::string& reason,
    const std::string& context) {
  (void)context;
  std::string source;
  {
    std::lock_guard lock(mutex_);
    source = info_.source;
    if (pipeline_) pipeline_->setRerouteInProgress(true, reason);
  }
  if (source.empty()) return TAE_RESULT_OK;

  const TAE_Result result = play(source, std::max(0.0, positionSeconds));
  {
    std::lock_guard lock(mutex_);
    if (pipeline_) pipeline_->setRerouteInProgress(false);
  }
  if (result != TAE_RESULT_OK) return result;
  if (previousState == PlaybackState::Paused) {
    return pause();
  }
  return TAE_RESULT_OK;
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

TAE_Result TAE_SetOutputConfig(TAE_EngineHandle engine, const char* output_config_json) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return fromHandle(engine)->setOutputConfig(output_config_json ? output_config_json : "{}");
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

TAE_Result TAE_GetEngineCapabilities(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return copyStringResult(fromHandle(engine)->engineCapabilitiesJson(), buffer, buffer_size, required_size);
}

TAE_Result TAE_GetLastError(TAE_EngineHandle engine, char* buffer, size_t buffer_size, size_t* required_size) {
  if (!engine) return TAE_RESULT_NOT_INITIALIZED;
  return copyStringResult(fromHandle(engine)->getLastErrorJson(), buffer, buffer_size, required_size);
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
