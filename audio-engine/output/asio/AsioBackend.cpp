#include "AsioBackend.h"
#include "DeviceCapabilityCache.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <set>
#include <thread>
#include <tuple>

namespace twilight::audio {
namespace {

int normalizeBitDepth(int bitDepth) {
  if (bitDepth <= 1) return 1;
  if (bitDepth <= 16) return 16;
  if (bitDepth <= 24) return 24;
  return 32;
}

int bitDepthForFormat(AudioSampleFormat format) {
  switch (format) {
    case AudioSampleFormat::DsdInt8Lsb1:
    case AudioSampleFormat::DsdInt8Msb1:
    case AudioSampleFormat::DsdInt8Ner8:
      return 1;
    case AudioSampleFormat::Int16Interleaved:
      return 16;
    case AudioSampleFormat::Int24Interleaved:
    case AudioSampleFormat::Int24In32Interleaved:
      return 24;
    case AudioSampleFormat::Int32Interleaved:
    case AudioSampleFormat::Float32Interleaved:
    default:
      return 32;
  }
}

int32_t floatToSignedInt(float sample, int bits) {
  const double clamped = std::clamp(static_cast<double>(sample), -1.0, 1.0);
  if (bits == 16) {
    return static_cast<int32_t>(std::clamp(
        std::llround(clamped * 32768.0),
        static_cast<long long>(std::numeric_limits<int16_t>::min()),
        static_cast<long long>(std::numeric_limits<int16_t>::max())));
  }
  if (bits == 24) {
    return static_cast<int32_t>(std::clamp(std::llround(clamped * 8388608.0), -8388608LL, 8388607LL));
  }
  const long long value = std::clamp(
      std::llround(clamped * 2147483648.0),
      static_cast<long long>(std::numeric_limits<int32_t>::min()),
      static_cast<long long>(std::numeric_limits<int32_t>::max()));
  return static_cast<int32_t>(value);
}

void writePackedSample(float sample, AudioSampleFormat format, uint8_t* output) {
  switch (format) {
    case AudioSampleFormat::Int16Interleaved: {
      const int16_t value = static_cast<int16_t>(floatToSignedInt(sample, 16));
      std::memcpy(output, &value, sizeof(value));
      break;
    }
    case AudioSampleFormat::Int24Interleaved: {
      const auto value = static_cast<uint32_t>(floatToSignedInt(sample, 24));
      output[0] = static_cast<uint8_t>(value & 0xff);
      output[1] = static_cast<uint8_t>((value >> 8) & 0xff);
      output[2] = static_cast<uint8_t>((value >> 16) & 0xff);
      break;
    }
    case AudioSampleFormat::Int24In32Interleaved: {
      const int32_t value = static_cast<int32_t>(static_cast<uint32_t>(floatToSignedInt(sample, 24)) << 8);
      std::memcpy(output, &value, sizeof(value));
      break;
    }
    case AudioSampleFormat::Int32Interleaved: {
      const int32_t value = floatToSignedInt(sample, 32);
      std::memcpy(output, &value, sizeof(value));
      break;
    }
    case AudioSampleFormat::Float32Interleaved:
    default:
      std::memcpy(output, &sample, sizeof(sample));
      break;
  }
}

size_t bytesPerSample(AudioSampleFormat format) {
  switch (format) {
    case AudioSampleFormat::DsdInt8Lsb1:
    case AudioSampleFormat::DsdInt8Msb1:
    case AudioSampleFormat::DsdInt8Ner8:
      return 1;
    case AudioSampleFormat::Int16Interleaved:
      return 2;
    case AudioSampleFormat::Int24Interleaved:
      return 3;
    case AudioSampleFormat::Int24In32Interleaved:
    case AudioSampleFormat::Int32Interleaved:
    case AudioSampleFormat::Float32Interleaved:
    default:
      return 4;
  }
}

bool sameFormat(const AudioFormat& a, const AudioFormat& b) {
  if (isDsdSampleFormat(a.sampleFormat) || isDsdSampleFormat(b.sampleFormat)) {
    return dsdFormatsExactMatch(a, b);
  }
  return a.sampleRate == b.sampleRate && a.channelCount == b.channelCount &&
         normalizeBitDepth(a.bitDepth) == normalizeBitDepth(b.bitDepth) &&
         a.sampleFormat == b.sampleFormat;
}

bool containsFormat(const std::vector<AudioSampleFormat>& formats, AudioSampleFormat format) {
  return std::find(formats.begin(), formats.end(), format) != formats.end();
}

void appendUniqueSampleRates(std::vector<int>* sampleRates, const std::vector<int>& extraSampleRates) {
  if (!sampleRates) return;
  for (int sampleRate : extraSampleRates) {
    if (sampleRate > 0 && std::find(sampleRates->begin(), sampleRates->end(), sampleRate) == sampleRates->end()) {
      sampleRates->push_back(sampleRate);
    }
  }
}

void appendUniqueSampleFormats(std::vector<AudioSampleFormat>* formats, const std::vector<AudioSampleFormat>& extraFormats) {
  if (!formats) return;
  for (AudioSampleFormat format : extraFormats) {
    if (!containsFormat(*formats, format)) formats->push_back(format);
  }
}

bool isNativeDsdRequest(const AudioFormat& format) {
  return format.sampleRate >= 2822400 && format.channelCount > 0 && effectivePcmBitDepth(format) == 1 &&
         isDsdSampleFormat(format.sampleFormat);
}

std::vector<std::string> sampleFormatNames(const std::vector<AudioSampleFormat>& formats) {
  std::vector<std::string> names;
  names.reserve(formats.size());
  for (AudioSampleFormat format : formats) {
    names.push_back(sampleFormatToString(format));
  }
  return names;
}

double asioCallbackFrameRate(const AudioFormat& format) {
  const double sampleRate = static_cast<double>(std::max(1, format.sampleRate));
  return isDsdSampleFormat(format.sampleFormat) ? sampleRate / 8.0 : sampleRate;
}

std::string hostEventPrefix(AsioHostEvent event) {
  switch (event) {
    case AsioHostEvent::DriverReset:
      return "ASIO driver reset";
    case AsioHostEvent::DriverRestart:
      return "ASIO driver restart";
    case AsioHostEvent::DeviceLost:
      return "ASIO device lost";
    case AsioHostEvent::BufferFailure:
    default:
      return "ASIO buffer failure";
  }
}

std::string hostEventReason(AsioHostEvent event, const std::string& message) {
  const auto prefix = hostEventPrefix(event);
  return message.empty() ? prefix : prefix + ": " + message;
}

std::string nativeDsdRuntimeStateName(NativeDsdRuntimeFactState state) {
  switch (state) {
    case NativeDsdRuntimeFactState::Candidate:
      return "candidate";
    case NativeDsdRuntimeFactState::Unproven:
      return "unproven";
    case NativeDsdRuntimeFactState::Mismatch:
      return "mismatch";
    case NativeDsdRuntimeFactState::Proven:
      return "proven";
    case NativeDsdRuntimeFactState::Unsupported:
    default:
      return "unsupported";
  }
}

void applyNativeDsdFactsToOutputInfo(OutputInfo* info, const NativeDsdRuntimeFacts& facts) {
  if (!info) return;
  info->nativeDsdRuntimeState = nativeDsdRuntimeStateName(facts.state);
  info->nativeDsdRequestedRate = facts.requestedDsdRate;
  info->nativeDsdActualRate = facts.actualDsdRate;
  info->nativeDsdChannels = facts.channelCount;
  info->nativeDsdExplicitlyCapable = facts.explicitlyCapable;
  info->nativeDsdAdvertisedSampleRates = facts.advertisedSampleRates;
  info->nativeDsdRuntimeReason = facts.reason;
}

bool explicitBufferSizeAllowed(uint32_t size) {
  static constexpr uint32_t kAllowed[] = {64, 128, 256, 512, 1024, 2048};
  return std::find(std::begin(kAllowed), std::end(kAllowed), size) != std::end(kAllowed);
}

AudioFormat emptyFormat() {
  return {};
}

bool containsSampleRate(const std::vector<int>& sampleRates, int sampleRate) {
  return std::find(sampleRates.begin(), sampleRates.end(), sampleRate) != sampleRates.end();
}

bool containsSampleFormat(const std::vector<AudioSampleFormat>& sampleFormats, AudioSampleFormat sampleFormat) {
  return std::find(sampleFormats.begin(), sampleFormats.end(), sampleFormat) != sampleFormats.end();
}

DopRuntimeFacts buildAsioDopRuntimeFacts(
    const AsioDeviceInfo& device,
    const AudioFormat& candidateFormat,
    const AudioFormat& actualFormat,
    bool actualObserved,
    bool actualChannelFormatsMatch) {
  DopRuntimeFacts facts;
  if (!isDopCarrierFormat(candidateFormat)) return facts;

  facts.candidateFormat = candidateFormat;
  facts.explicitlyCapable =
      device.dopCapable && containsSampleRate(device.dopCarrierSampleRates, candidateFormat.sampleRate) &&
      containsSampleFormat(device.dopCarrierSampleFormats, candidateFormat.sampleFormat);
  if (!actualObserved) {
    facts.state = DopRuntimeFactState::Candidate;
    facts.reason = facts.explicitlyCapable ? "ASIO DoP carrier candidate selected; waiting for runtime confirmation"
                                           : "ASIO DoP carrier candidate selected without explicit driver proof";
    return facts;
  }

  if (!actualChannelFormatsMatch) {
    facts.state = DopRuntimeFactState::Mismatch;
    facts.reason = "ASIO runtime channel sample formats differ; cannot prove a single DoP carrier";
    return facts;
  }

  if (!isDopCarrierFormat(actualFormat)) {
    facts.state = DopRuntimeFactState::Mismatch;
    facts.reason = "ASIO actual runtime format is not a DoP carrier";
    return facts;
  }

  facts.actualFormat = actualFormat;
  if (!pcmFormatsExactMatch(candidateFormat, actualFormat)) {
    facts.state = DopRuntimeFactState::Mismatch;
    facts.reason = "ASIO actual DoP carrier does not exactly match the negotiated carrier";
    return facts;
  }

  if (!facts.explicitlyCapable) {
    facts.state = DopRuntimeFactState::Unproven;
    facts.reason = "ASIO carrier matched at runtime, but the driver did not explicitly prove DoP support";
    return facts;
  }

  facts.state = DopRuntimeFactState::Proven;
  facts.reason = "ASIO driver advertised this exact DoP carrier and runtime format matched exactly";
  return facts;
}

NativeDsdRuntimeFacts buildAsioNativeDsdRuntimeFacts(
    const AsioDeviceInfo& device,
    const AudioFormat& requestedFormat,
    const AudioFormat& actualFormat,
    bool actualObserved,
    bool actualChannelFormatsMatch,
    bool rawDsdPathStarted) {
  NativeDsdRuntimeFacts facts;
  facts.requestedDsdRate = requestedFormat.sampleRate >= 2822400 ? requestedFormat.sampleRate : 0;
  facts.channelCount = requestedFormat.channelCount;
  facts.explicitlyCapable = device.nativeDsdCapable;
  facts.advertisedSampleRates = device.nativeDsdSampleRates;

  if (facts.requestedDsdRate <= 0) {
    facts.state = NativeDsdRuntimeFactState::Unsupported;
    facts.reason = "No Native DSD stream was requested";
    return facts;
  }

  if (!isDsdSampleFormat(requestedFormat.sampleFormat) || effectivePcmBitDepth(requestedFormat) != 1) {
    facts.state = NativeDsdRuntimeFactState::Unsupported;
    facts.reason = "Requested ASIO format is not raw Native DSD";
    return facts;
  }

  if (!device.nativeDsdCapable) {
    facts.state = NativeDsdRuntimeFactState::Unsupported;
    facts.reason = "ASIO driver did not advertise Native DSD support";
    return facts;
  }

  if (!containsSampleRate(device.nativeDsdSampleRates, facts.requestedDsdRate)) {
    facts.state = NativeDsdRuntimeFactState::Mismatch;
    facts.reason = "ASIO driver did not advertise the requested Native DSD rate";
    return facts;
  }

  if (!device.nativeDsdSampleFormats.empty() &&
      !containsSampleFormat(device.nativeDsdSampleFormats, requestedFormat.sampleFormat)) {
    facts.state = NativeDsdRuntimeFactState::Mismatch;
    facts.reason = "ASIO driver did not advertise the requested Native DSD sample type";
    return facts;
  }

  if (!rawDsdPathStarted) {
    facts.state = NativeDsdRuntimeFactState::Candidate;
    facts.reason = "ASIO driver advertises Native DSD, but raw DSD rendering is not active";
    return facts;
  }

  if (!actualObserved) {
    facts.state = NativeDsdRuntimeFactState::Candidate;
    facts.reason = "ASIO Native DSD buffers have not reported their runtime sample type";
    return facts;
  }

  if (!actualChannelFormatsMatch) {
    facts.state = NativeDsdRuntimeFactState::Mismatch;
    facts.reason = "ASIO runtime channel sample formats differ; cannot write a single Native DSD sample type";
    return facts;
  }

  if (!isDsdSampleFormat(actualFormat.sampleFormat) || actualFormat.sampleRate < 2822400) {
    facts.state = NativeDsdRuntimeFactState::Mismatch;
    facts.actualDsdRate = actualFormat.sampleRate >= 2822400 ? actualFormat.sampleRate : 0;
    facts.reason = "ASIO runtime sample type is not Native DSD";
    return facts;
  }

  facts.actualDsdRate = actualFormat.sampleRate;
  if (!dsdFormatsExactMatch(requestedFormat, actualFormat)) {
    facts.state = NativeDsdRuntimeFactState::Mismatch;
    facts.reason = "ASIO actual Native DSD format does not exactly match the negotiated format";
    return facts;
  }

  facts.state = NativeDsdRuntimeFactState::Proven;
  facts.reason = "ASIO Native DSD stream started with a matching runtime rate";
  return facts;
}

}  // namespace

struct AsioBackend::FormatCandidate {
  AudioFormat format;
  int sampleRateError = 0;
  int bitDepthError = 0;
  bool exact = false;
  bool isDefault = false;
};

AsioBackend::AsioBackend() : AsioBackend(createRealAsioHost()) {}

AsioBackend::AsioBackend(std::unique_ptr<IAsioHost> host) : host_(std::move(host)) {}

AsioBackend::~AsioBackend() {
  close();
}

const char* AsioBackend::id() const {
  return "asio";
}

bool AsioBackend::open(const std::string& deviceId, const AudioFormat& requestedFormat, std::string* error) {
  close();
  if (!host_) {
    if (error) *error = "当前构建未启用 ASIO 输出";
    std::lock_guard lock(mutex_);
    diagnostics_.lastError = error ? *error : "当前构建未启用 ASIO 输出";
    outputInfo_ = {};
    outputInfo_.exclusive = true;
    outputInfo_.accessMode = "exclusive";
    outputInfo_.backend = "asio";
    outputInfo_.actualBackend = "asio";
    outputInfo_.devicePathKind = "asio";
    outputInfo_.perfectReasonCode = "backend_open_failure";
    outputInfo_.capabilityReason = diagnostics_.lastError;
    outputInfo_.perfectReason = diagnostics_.lastError;
    outputInfo_.diagnostics = diagnostics_;
    return false;
  }

  {
    std::lock_guard lock(mutex_);
    OutputInfo::Diagnostics lifetime = diagnostics_;
    diagnostics_ = {};
    diagnostics_.lifetimeUnderrunCount = lifetime.lifetimeUnderrunCount;
    diagnostics_.lifetimeBufferDropCount = lifetime.lifetimeBufferDropCount;
    diagnostics_.lifetimeRecoveryCount = lifetime.lifetimeRecoveryCount;
    diagnostics_.driverRestartCount = lifetime.driverRestartCount;
    diagnostics_.deviceLostCount = lifetime.deviceLostCount;
    recoveryAttempts_ = 0;
    recoveryWindow_.clear();
    recoveryCooldownUntil_ = {};
    recoveryInProgress_ = false;
    deviceRecovered_ = false;
    dopRuntimeFacts_ = {};
    nativeDsdRuntimeFacts_ = unsupportedNativeDsdRuntimeFacts("No Native DSD stream was requested");
    actualOutputFormatObserved_ = false;
    actualOutputChannelFormatsMatch_ = true;
    outputInfo_ = {};
    outputInfo_.exclusive = true;
    outputInfo_.accessMode = "exclusive";
    outputInfo_.backend = "asio";
    outputInfo_.actualBackend = "asio";
    outputInfo_.devicePathKind = "asio";
    outputInfo_.diagnostics = diagnostics_;
    outputInfo_.deviceRecovered = false;
    outputInfo_.recoveryCount = recoveryCount_;
  }

  const auto devices = host_->enumerateDevices();
  if (devices.empty()) {
    if (error) *error = "未找到可用 ASIO 驱动";
    diagnostics_.lastError = error ? *error : "未找到可用 ASIO 驱动";
    outputInfo_.backend = "asio";
    outputInfo_.actualBackend = "asio";
    outputInfo_.accessMode = "exclusive";
    outputInfo_.devicePathKind = "asio";
    outputInfo_.perfectReasonCode = "device_not_found";
    outputInfo_.capabilityReason = diagnostics_.lastError;
    outputInfo_.perfectReason = diagnostics_.lastError;
    outputInfo_.diagnostics = diagnostics_;
    return false;
  }

  const auto deviceIt = std::find_if(devices.begin(), devices.end(), [&](const AsioDeviceInfo& device) {
    return deviceId.empty() || deviceId == "auto" || device.id == deviceId || device.name == deviceId ||
           device.driverName == deviceId || ("asio:" + device.driverName) == deviceId;
  });
  if (deviceIt == devices.end()) {
    if (error) *error = "无法找到请求的 ASIO 设备：" + deviceId;
    diagnostics_.lastError = error ? *error : "无法找到请求的 ASIO 设备";
    outputInfo_.backend = "asio";
    outputInfo_.actualBackend = "asio";
    outputInfo_.accessMode = "exclusive";
    outputInfo_.devicePathKind = "asio";
    outputInfo_.perfectReasonCode = "device_not_found";
    outputInfo_.capabilityReason = diagnostics_.lastError;
    outputInfo_.perfectReason = diagnostics_.lastError;
    outputInfo_.diagnostics = diagnostics_;
    return false;
  }

  AudioFormat selected;
  if (!chooseFormat(*deviceIt, requestedFormat, &selected)) {
    if (error) *error = "ASIO 设备没有可协商的输出格式";
    diagnostics_.lastError = error ? *error : "ASIO 设备没有可协商的输出格式";
    outputInfo_.backend = "asio";
    outputInfo_.actualBackend = "asio";
    outputInfo_.accessMode = "exclusive";
    outputInfo_.devicePathKind = "asio";
    outputInfo_.deviceName = deviceIt->name.empty() ? deviceIt->driverName : deviceIt->name;
    outputInfo_.actualDeviceName = outputInfo_.deviceName;
    outputInfo_.driverName = deviceIt->driverName;
    outputInfo_.actualDriverName = deviceIt->driverName;
    outputInfo_.perfectReasonCode = "format_not_supported";
    outputInfo_.capabilityReason = diagnostics_.lastError;
    outputInfo_.perfectReason = diagnostics_.lastError;
    outputInfo_.diagnostics = diagnostics_;
    return false;
  }

  deviceInfo_ = *deviceIt;
  selected.channelCount = routedOutputChannels(deviceInfo_, requestedFormat.channelCount);
  openConfig_.deviceId = deviceIt->id;
  openConfig_.format = selected;
  openConfig_.bufferSizeFrames = chooseBufferSize(deviceInfo_);

  AsioOpenResult result;
  if (!host_->open(openConfig_, &result, error)) {
    if (error) diagnostics_.lastError = *error;
    outputInfo_.backend = "asio";
    outputInfo_.actualBackend = "asio";
    outputInfo_.accessMode = "exclusive";
    outputInfo_.devicePathKind = "asio";
    outputInfo_.deviceName = deviceIt->name.empty() ? deviceIt->driverName : deviceIt->name;
    outputInfo_.actualDeviceName = outputInfo_.deviceName;
    outputInfo_.driverName = deviceIt->driverName;
    outputInfo_.actualDriverName = deviceIt->driverName;
    outputInfo_.perfectReasonCode = "backend_open_failure";
    outputInfo_.capabilityReason = diagnostics_.lastError;
    outputInfo_.perfectReason = diagnostics_.lastError;
    outputInfo_.diagnostics = diagnostics_;
    return false;
  }

  outputFormat_ = result.actualFormat;
  if (outputFormat_.sampleRate <= 0) outputFormat_.sampleRate = selected.sampleRate;
  outputFormat_.channelCount = requestedFormat.channelCount > 0 ? requestedFormat.channelCount : selected.channelCount;
  if (outputFormat_.bitDepth <= 0) outputFormat_.bitDepth = selected.bitDepth;
  driverName_ = result.driverName.empty() ? deviceIt->driverName : result.driverName;
  driverVersion_ = result.driverVersion;
  bufferSizeFrames_ = result.bufferSizeFrames;
  latencyFrames_ = result.latencyFrames;
  deviceName_ = deviceIt->name.empty() ? driverName_ : deviceIt->name;

  outputInfo_ = {};
  outputInfo_.exclusive = true;
  outputInfo_.accessMode = "exclusive";
  outputInfo_.supportsOutputPerfect = true;
  outputInfo_.sourceExact = false;
  outputInfo_.outputPerfect = false;
  outputInfo_.pcmPassthrough = false;
  outputInfo_.resampled = !sameFormat(requestedFormat, outputFormat_);
  outputInfo_.perfectReasonCode = outputInfo_.resampled ? "pcm_converted" : "";
  outputInfo_.perfectReason = outputInfo_.resampled ? "ASIO 输出格式已协商为驱动支持格式" : "";
  outputInfo_.outputSampleRate = outputFormat_.sampleRate;
  outputInfo_.outputBitDepth = outputFormat_.bitDepth;
  outputInfo_.backend = "asio";
  outputInfo_.actualBackend = "asio";
  outputInfo_.devicePathKind = "asio";
  outputInfo_.deviceName = deviceName_;
  outputInfo_.actualDeviceName = deviceName_;
  outputInfo_.driverName = driverName_;
  outputInfo_.actualDriverName = driverName_;
  outputInfo_.driverVersion = driverVersion_;
  outputInfo_.actualDriverVersion = driverVersion_;
  outputInfo_.actualOutputFormat = sampleFormatToString(outputFormat_.sampleFormat);
  outputInfo_.actualSampleRate = outputFormat_.sampleRate;
  outputInfo_.actualBitDepth = outputFormat_.bitDepth;
  outputInfo_.actualChannels = selected.channelCount;
  outputInfo_.driverDopCapable = deviceInfo_.dopCapable;
  outputInfo_.driverNativeDsdCapable = deviceInfo_.nativeDsdCapable;
  outputInfo_.driverDopCarrierSampleRates = deviceInfo_.dopCarrierSampleRates;
  outputInfo_.driverDopCarrierFormats = sampleFormatNames(deviceInfo_.dopCarrierSampleFormats);
  outputInfo_.driverNativeDsdSampleRates = deviceInfo_.nativeDsdSampleRates;
  outputInfo_.bufferSizeFrames = static_cast<int>(bufferSizeFrames_);
  outputInfo_.latencyFrames = static_cast<int>(latencyFrames_);
  const double callbackFrameRate = asioCallbackFrameRate(outputFormat_);
  outputInfo_.latencyMs =
      callbackFrameRate > 0.0 ? static_cast<double>(latencyFrames_) * 1000.0 / callbackFrameRate : 0.0;
  outputInfo_.latencyInfo.bufferLatencyMs =
      callbackFrameRate > 0.0 ? static_cast<double>(bufferSizeFrames_) * 1000.0 / callbackFrameRate : 0.0;
  outputInfo_.latencyInfo.outputLatencyMs = outputInfo_.latencyMs;
  outputInfo_.latencyInfo.totalLatencyMs = outputInfo_.latencyInfo.bufferLatencyMs + outputInfo_.latencyInfo.outputLatencyMs;
  outputInfo_.channelRoutingMode = channelRoutingModeToString(outputConfig_.routingMode);
  outputInfo_.diagnostics = diagnostics_;
  outputInfo_.deviceRecovered = false;
  outputInfo_.recoveryCount = recoveryCount_;
  dopRuntimeFacts_ = buildAsioDopRuntimeFacts(
      deviceInfo_,
      openConfig_.format,
      emptyFormat(),
      actualOutputFormatObserved_,
      actualOutputChannelFormatsMatch_);
  nativeDsdRuntimeFacts_ = buildAsioNativeDsdRuntimeFacts(
      deviceInfo_,
      openConfig_.format,
      emptyFormat(),
      actualOutputFormatObserved_,
      actualOutputChannelFormatsMatch_,
      false);
  applyNativeDsdFactsToOutputInfo(&outputInfo_, nativeDsdRuntimeFacts_);
  opened_ = true;
  return true;
}

bool AsioBackend::setOutputConfig(const OutputConfig& config, std::string* error) {
  if (config.preferredBufferSize != 0 && !explicitBufferSizeAllowed(config.preferredBufferSize)) {
    if (error) *error = "ASIO buffer size 只支持 Auto/64/128/256/512/1024/2048";
    return false;
  }
  std::lock_guard lock(mutex_);
  outputConfig_ = config;
  outputInfo_.channelRoutingMode = channelRoutingModeToString(outputConfig_.routingMode);
  return true;
}

bool AsioBackend::start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error) {
  if (!opened_) {
    if (error) *error = "ASIO 后端尚未打开";
    return false;
  }
  {
    std::lock_guard lock(mutex_);
    callback_ = std::move(callback);
    typedCallback_ = nullptr;
    eventCallback_ = std::move(eventCallback);
    lastRenderTime_ = {};
    renderCallbacksSeen_ = 0;
  }
  return createAndStartHost(error);
}

bool AsioBackend::startTyped(
    TypedRenderCallback callback,
    RenderCallback fallbackCallback,
    OutputEventCallback eventCallback,
    std::string* error) {
  if (!opened_) {
    if (error) *error = "ASIO 后端尚未打开";
    return false;
  }
  {
    std::lock_guard lock(mutex_);
    typedCallback_ = std::move(callback);
    callback_ = std::move(fallbackCallback);
    eventCallback_ = std::move(eventCallback);
    lastRenderTime_ = {};
    renderCallbacksSeen_ = 0;
  }
  return createAndStartHost(error);
}

void AsioBackend::stop() {
  running_ = false;
  if (host_) host_->stop();
}

void AsioBackend::close() {
  stop();
  if (host_) host_->close();
  std::lock_guard lock(mutex_);
  callback_ = nullptr;
  typedCallback_ = nullptr;
  eventCallback_ = nullptr;
  renderScratch_.clear();
  typedRenderScratch_.clear();
  lastRenderTime_ = {};
  renderCallbacksSeen_ = 0;
  recoveryInProgress_ = false;
  dopRuntimeFacts_ = {};
  nativeDsdRuntimeFacts_ = unsupportedNativeDsdRuntimeFacts("No Native DSD stream was requested");
  actualOutputFormatObserved_ = false;
  actualOutputChannelFormatsMatch_ = true;
  opened_ = false;
}

AudioFormat AsioBackend::outputFormat() const {
  return outputFormat_;
}

OutputInfo AsioBackend::outputInfo() const {
  std::lock_guard lock(mutex_);
  OutputInfo info = outputInfo_;
  info.deviceRecovered = deviceRecovered_;
  info.recoveryCount = recoveryCount_;
  info.diagnostics = diagnostics_;
  return info;
}

DopRuntimeFacts AsioBackend::dopRuntimeFacts() const {
  std::lock_guard lock(mutex_);
  return dopRuntimeFacts_;
}

NativeDsdRuntimeFacts AsioBackend::nativeDsdRuntimeFacts() const {
  std::lock_guard lock(mutex_);
  return nativeDsdRuntimeFacts_;
}

std::string AsioBackend::deviceName() const {
  return deviceName_;
}

bool AsioBackend::chooseFormat(const AsioDeviceInfo& device, const AudioFormat& requestedFormat, AudioFormat* selected) const {
  if (!selected || requestedFormat.sampleRate <= 0 || requestedFormat.channelCount <= 0) return false;

  std::vector<int> sampleRates = device.supportedSampleRates;
  if (device.dopCapable) appendUniqueSampleRates(&sampleRates, device.dopCarrierSampleRates);
  if (device.nativeDsdCapable) appendUniqueSampleRates(&sampleRates, device.nativeDsdSampleRates);
  if (sampleRates.empty() && device.defaultSampleRate > 0) sampleRates.push_back(device.defaultSampleRate);
  if (sampleRates.empty()) sampleRates = asioDefaultSampleRateProbeSet();

  std::vector<AudioSampleFormat> sampleFormats = device.sampleFormats;
  if (device.dopCapable) appendUniqueSampleFormats(&sampleFormats, device.dopCarrierSampleFormats);
  if (device.nativeDsdCapable) appendUniqueSampleFormats(&sampleFormats, device.nativeDsdSampleFormats);
  if (sampleFormats.empty()) sampleFormats.push_back(device.defaultSampleFormat);
  if (!containsFormat(sampleFormats, device.defaultSampleFormat)) sampleFormats.push_back(device.defaultSampleFormat);
  if (device.bitDepths.empty()) {
    if (!containsFormat(sampleFormats, AudioSampleFormat::Int16Interleaved)) {
      sampleFormats.push_back(AudioSampleFormat::Int16Interleaved);
    }
    if (!containsFormat(sampleFormats, AudioSampleFormat::Int24Interleaved)) {
      sampleFormats.push_back(AudioSampleFormat::Int24Interleaved);
    }
    if (!containsFormat(sampleFormats, AudioSampleFormat::Float32Interleaved)) {
      sampleFormats.push_back(AudioSampleFormat::Float32Interleaved);
    }
  }

  std::vector<FormatCandidate> candidates;
  std::set<std::tuple<int, int, AudioSampleFormat>> seen;
  for (int sampleRate : sampleRates) {
    if (sampleRate <= 0) continue;
    if (isNativeDsdRequest(requestedFormat) && sampleRate != requestedFormat.sampleRate) continue;
    for (AudioSampleFormat sampleFormat : sampleFormats) {
      const int normalized = bitDepthForFormat(sampleFormat);
      if (isNativeDsdRequest(requestedFormat) && !isDsdSampleFormat(sampleFormat)) continue;
      if (!isNativeDsdRequest(requestedFormat) && isDsdSampleFormat(sampleFormat)) continue;
      if (!device.bitDepths.empty()) {
        const bool supportedDepth = std::find_if(device.bitDepths.begin(), device.bitDepths.end(), [&](int depth) {
                                      return normalizeBitDepth(depth) == normalized;
                                    }) != device.bitDepths.end();
        if (!supportedDepth) continue;
      }
      if (!seen.insert({sampleRate, normalized, sampleFormat}).second) continue;
      FormatCandidate candidate;
      candidate.format.sampleRate = sampleRate;
      candidate.format.channelCount = requestedFormat.channelCount;
      candidate.format.bitDepth = normalized;
      candidate.format.sampleFormat = sampleFormat;
      candidate.sampleRateError = std::abs(sampleRate - requestedFormat.sampleRate);
      candidate.bitDepthError = std::abs(normalized - normalizeBitDepth(requestedFormat.bitDepth));
      candidate.exact = candidate.sampleRateError == 0 && candidate.bitDepthError == 0 &&
                        candidate.format.channelCount == requestedFormat.channelCount &&
                        candidate.format.sampleFormat == requestedFormat.sampleFormat;
      candidate.isDefault = sampleRate == device.defaultSampleRate && normalized == normalizeBitDepth(device.defaultBitDepth);
      candidates.push_back(candidate);
    }
  }

  if (candidates.empty()) return false;
  std::sort(candidates.begin(), candidates.end(), [](const FormatCandidate& left, const FormatCandidate& right) {
    if (left.exact != right.exact) return left.exact;
    if (left.sampleRateError != right.sampleRateError) return left.sampleRateError < right.sampleRateError;
    if (left.format.sampleRate != right.format.sampleRate) return left.format.sampleRate > right.format.sampleRate;
    if (left.bitDepthError != right.bitDepthError) return left.bitDepthError < right.bitDepthError;
    if (isDsdSampleFormat(left.format.sampleFormat) != isDsdSampleFormat(right.format.sampleFormat)) {
      return isDsdSampleFormat(left.format.sampleFormat);
    }
    if ((left.format.sampleFormat == AudioSampleFormat::Float32Interleaved) !=
        (right.format.sampleFormat == AudioSampleFormat::Float32Interleaved)) {
      return left.format.sampleFormat == AudioSampleFormat::Float32Interleaved;
    }
    if (left.isDefault != right.isDefault) return left.isDefault;
    return left.format.bitDepth > right.format.bitDepth;
  });

  *selected = candidates.front().format;
  return true;
}

long AsioBackend::chooseBufferSize(const AsioDeviceInfo& device) const {
  const long preferred = device.preferredBufferSize > 0 ? device.preferredBufferSize : 512;
  const long minSize = device.minBufferSize > 0 ? device.minBufferSize : preferred;
  const long maxSize = device.maxBufferSize > 0 ? device.maxBufferSize : preferred;
  const long granularity = device.bufferGranularity;
  if (outputConfig_.preferredBufferSize == 0) return preferred;

  const long requested = static_cast<long>(outputConfig_.preferredBufferSize);
  auto legalize = [&](long value) {
    value = std::clamp(value, minSize, maxSize);
    if (granularity > 0) {
      const long offset = value - minSize;
      const long lower = minSize + (offset / granularity) * granularity;
      const long upper = std::min(maxSize, lower + granularity);
      const long lowerDistance = std::labs(value - lower);
      const long upperDistance = std::labs(upper - value);
      return lowerDistance <= upperDistance ? lower : upper;
    }
    if (granularity < 0) {
      long best = minSize;
      long bestDistance = std::labs(requested - best);
      for (long size = minSize; size <= maxSize; size *= 2) {
        const long distance = std::labs(requested - size);
        if (distance < bestDistance || (distance == bestDistance && size < best)) {
          best = size;
          bestDistance = distance;
        }
        if (size > maxSize / 2) break;
      }
      return best;
    }
    return value;
  };
  return legalize(requested);
}

int AsioBackend::routedOutputChannels(const AsioDeviceInfo& device, int sourceChannels) const {
  const int available = std::max(1, device.outputChannels);
  switch (outputConfig_.routingMode) {
    case ChannelRoutingMode::StereoTo51:
      return std::min(available, 6);
    case ChannelRoutingMode::StereoTo71:
      return std::min(available, 8);
    case ChannelRoutingMode::MonoToStereo:
      return std::min(available, 2);
    case ChannelRoutingMode::MonoToMultichannel:
      return std::min(available, std::max(2, available));
    case ChannelRoutingMode::Stereo:
      return std::min(available, 2);
    case ChannelRoutingMode::Auto:
    default:
      return std::min(available, std::max(1, sourceChannels));
  }
}

bool AsioBackend::createAndStartHost(std::string* error) {
  if (!host_->createBuffers(
          [this](long bufferIndex) { renderBuffer(bufferIndex); },
          [this](AsioHostEvent event, const std::string& message) { recover(event, message); },
          error)) {
    std::lock_guard lock(mutex_);
    ++diagnostics_.sessionBufferDropCount;
    ++diagnostics_.lifetimeBufferDropCount;
    if (error) diagnostics_.lastError = *error;
    if (error) {
      outputInfo_.perfectReasonCode = "buffer_failure";
      outputInfo_.capabilityReason = *error;
      outputInfo_.perfectReason = "ASIO buffer creation failed: " + *error;
    }
    outputInfo_.diagnostics = diagnostics_;
    return false;
  }
  {
    std::lock_guard lock(mutex_);
    const int outputChannels = std::max(1, openConfig_.format.channelCount);
    const AudioSampleFormat firstActualSampleFormat = host_->outputSampleFormat(0);
    bool uniformActualSampleFormat = true;
    for (int channel = 1; channel < outputChannels; ++channel) {
      if (host_->outputSampleFormat(channel) != firstActualSampleFormat) {
        uniformActualSampleFormat = false;
        break;
      }
    }
    actualOutputFormatObserved_ = true;
    actualOutputChannelFormatsMatch_ = uniformActualSampleFormat;
    outputFormat_.sampleFormat = firstActualSampleFormat;
    outputFormat_.bitDepth = bitDepthForFormat(firstActualSampleFormat);
    outputInfo_.actualOutputFormat = sampleFormatToString(firstActualSampleFormat);
    outputInfo_.actualBitDepth = outputFormat_.bitDepth;
    outputInfo_.outputBitDepth = outputFormat_.bitDepth;
    outputInfo_.resampled = !sameFormat(openConfig_.format, outputFormat_);
    if (outputInfo_.resampled && outputInfo_.perfectReason.empty()) {
      outputInfo_.perfectReasonCode = isNativeDsdRequest(openConfig_.format) ? "native_dsd_format_mismatch"
                                                                             : "pcm_converted";
      outputInfo_.perfectReason = isNativeDsdRequest(openConfig_.format)
                                      ? "ASIO actual Native DSD format differs from negotiated format"
                                      : "ASIO actual output format differs from negotiated format";
    }
    dopRuntimeFacts_ = buildAsioDopRuntimeFacts(
        deviceInfo_,
        openConfig_.format,
        outputFormat_,
        actualOutputFormatObserved_,
        actualOutputChannelFormatsMatch_);
    nativeDsdRuntimeFacts_ = buildAsioNativeDsdRuntimeFacts(
        deviceInfo_,
        openConfig_.format,
        outputFormat_,
        actualOutputFormatObserved_,
        actualOutputChannelFormatsMatch_,
        false);
    applyNativeDsdFactsToOutputInfo(&outputInfo_, nativeDsdRuntimeFacts_);
  }
  running_ = true;
  if (!host_->start(error)) {
    running_ = false;
    std::lock_guard lock(mutex_);
    if (error) diagnostics_.lastError = *error;
    if (error) {
      outputInfo_.perfectReasonCode = "backend_start_failure";
      outputInfo_.capabilityReason = *error;
      outputInfo_.perfectReason = "ASIO start failed: " + *error;
    }
    outputInfo_.diagnostics = diagnostics_;
    return false;
  }
  {
    std::lock_guard lock(mutex_);
    const bool rawDsdStarted = isNativeDsdRequest(openConfig_.format);
    if (rawDsdStarted) {
      nativeDsdRuntimeFacts_ = buildAsioNativeDsdRuntimeFacts(
          deviceInfo_,
          openConfig_.format,
          outputFormat_,
          actualOutputFormatObserved_,
          actualOutputChannelFormatsMatch_,
          true);
      outputInfo_.resampled = nativeDsdRuntimeFacts_.state == NativeDsdRuntimeFactState::Proven
                                  ? false
                                  : !sameFormat(openConfig_.format, outputFormat_);
      outputInfo_.perfectReason = nativeDsdRuntimeFacts_.state == NativeDsdRuntimeFactState::Proven
                                      ? ""
                                      : nativeDsdRuntimeFacts_.reason;
      outputInfo_.perfectReasonCode = nativeDsdRuntimeFacts_.state == NativeDsdRuntimeFactState::Proven
                                          ? ""
                                          : "native_dsd_runtime_unproven";
      applyNativeDsdFactsToOutputInfo(&outputInfo_, nativeDsdRuntimeFacts_);
    }
  }
  return true;
}

void AsioBackend::renderBuffer(long bufferIndex) {
  RenderCallback callback;
  TypedRenderCallback typedCallback;
  OutputConfig outputConfig;
  AudioFormat outputFormat;
  bool actualOutputChannelFormatsMatch = false;
  {
    std::lock_guard lock(mutex_);
    callback = callback_;
    typedCallback = typedCallback_;
    outputConfig = outputConfig_;
    outputFormat = outputFormat_;
    actualOutputChannelFormatsMatch = actualOutputChannelFormatsMatch_;
  }
  const int sourceChannels = std::max(1, outputFormat.channelCount);
  const int outputChannels = std::max(1, openConfig_.format.channelCount);
  const size_t frames = static_cast<size_t>(std::max<long>(1, bufferSizeFrames_));
  const bool nativeDsdOutput = isNativeDsdRequest(openConfig_.format) || isDsdSampleFormat(outputFormat.sampleFormat);

  const auto now = std::chrono::high_resolution_clock::now();
  const uint32_t callbacksSeen = renderCallbacksSeen_++;
  static constexpr uint32_t kUnderrunWarmupCallbacks = 2;
  if (callbacksSeen >= kUnderrunWarmupCallbacks && lastRenderTime_.time_since_epoch().count() > 0) {
    const double elapsedMs = std::chrono::duration<double, std::milli>(now - lastRenderTime_).count();
    const double expectedMs = static_cast<double>(frames) * 1000.0 / asioCallbackFrameRate(outputFormat);
    if (expectedMs > 0 && elapsedMs > expectedMs * 1.5) {
      std::lock_guard lock(mutex_);
      ++diagnostics_.sessionUnderrunCount;
      ++diagnostics_.lifetimeUnderrunCount;
    }
  }
  lastRenderTime_ = now;

  if (typedCallback && outputConfig.routingMode == ChannelRoutingMode::Auto && sourceChannels == outputChannels &&
      actualOutputChannelFormatsMatch && host_->outputSampleFormat(0) == outputFormat.sampleFormat &&
      audioFormatBytesPerFrame(outputFormat) > 0) {
    const size_t sampleStride = bytesPerSample(outputFormat.sampleFormat);
    const size_t bytesPerFrame = audioFormatBytesPerFrame(outputFormat);
    typedRenderScratch_.assign(frames * bytesPerFrame, 0);
    PcmBlock block;
    block.format = outputFormat;
    block.data = typedRenderScratch_.data();
    block.frames = frames;
    block.byteSize = typedRenderScratch_.size();
    const size_t rendered = typedCallback(block);
    if (rendered > 0) {
      for (int channel = 0; channel < outputChannels; ++channel) {
        auto* output = static_cast<uint8_t*>(host_->outputBuffer(channel, bufferIndex));
        if (!output) continue;
        if (host_->outputSampleFormat(channel) != outputFormat.sampleFormat) continue;
        for (size_t frame = 0; frame < frames; ++frame) {
          const size_t sourceOffset =
              (frame * static_cast<size_t>(sourceChannels) + static_cast<size_t>(channel)) * sampleStride;
          std::memcpy(output + frame * sampleStride, typedRenderScratch_.data() + sourceOffset, sampleStride);
        }
      }
      host_->outputReady();
      return;
    }
  }

  if (nativeDsdOutput) {
    for (int channel = 0; channel < outputChannels; ++channel) {
      auto* output = static_cast<uint8_t*>(host_->outputBuffer(channel, bufferIndex));
      if (!output) continue;
      const AudioSampleFormat sampleFormat = host_->outputSampleFormat(channel);
      if (!isDsdSampleFormat(sampleFormat)) continue;
      std::memset(output, 0x69, frames * bytesPerSample(sampleFormat));
    }
    {
      std::lock_guard lock(mutex_);
      ++diagnostics_.sessionBufferDropCount;
      ++diagnostics_.lifetimeBufferDropCount;
      diagnostics_.lastError = "ASIO Native DSD render requires a typed raw DSD callback";
      outputInfo_.perfectReasonCode = "native_dsd_typed_callback_missing";
      outputInfo_.perfectReason = diagnostics_.lastError;
      outputInfo_.capabilityReason = diagnostics_.lastError;
      outputInfo_.diagnostics = diagnostics_;
    }
    host_->outputReady();
    return;
  }

  const size_t samples = frames * static_cast<size_t>(sourceChannels);
  renderScratch_.assign(samples, 0.0f);
  if (callback) callback(renderScratch_.data(), frames);

  for (int channel = 0; channel < outputChannels; ++channel) {
    auto* output = static_cast<uint8_t*>(host_->outputBuffer(channel, bufferIndex));
    if (!output) continue;
    const AudioSampleFormat sampleFormat = host_->outputSampleFormat(channel);
    const size_t stride = bytesPerSample(sampleFormat);
    for (size_t frame = 0; frame < frames; ++frame) {
      float sample = 0.0f;
      if (sourceChannels == 1 && outputConfig.routingMode == ChannelRoutingMode::MonoToMultichannel) {
        if (channel < 2) sample = renderScratch_[frame];
      } else if (sourceChannels == 1 && outputConfig.routingMode == ChannelRoutingMode::MonoToStereo) {
        if (channel < 2) sample = renderScratch_[frame];
      } else if (channel < sourceChannels) {
        sample = renderScratch_[frame * static_cast<size_t>(sourceChannels) + static_cast<size_t>(channel)];
      }
      writePackedSample(sample, sampleFormat, output + frame * stride);
    }
  }
  host_->outputReady();
}

bool AsioBackend::recover(AsioHostEvent event, const std::string& message) {
  static constexpr int kMaxAttempts = 3;
  static constexpr int kBackoffMs[] = {500, 1000, 2000};
  static constexpr auto kRecoveryWindow = std::chrono::seconds(10);
  static constexpr auto kRecoveryCooldown = std::chrono::seconds(10);
  OutputEventCallback eventCallback;
  {
    std::lock_guard lock(mutex_);
    eventCallback = eventCallback_;
  }

  const auto now = std::chrono::steady_clock::now();
  {
    std::lock_guard lock(mutex_);
    diagnostics_.lastError = hostEventReason(event, message);
    if (event == AsioHostEvent::DriverReset || event == AsioHostEvent::DriverRestart) ++diagnostics_.driverRestartCount;
    if (event == AsioHostEvent::DeviceLost) ++diagnostics_.deviceLostCount;
    if (event == AsioHostEvent::BufferFailure) {
      ++diagnostics_.sessionUnderrunCount;
      ++diagnostics_.lifetimeUnderrunCount;
    }
    outputInfo_.perfectReasonCode =
        event == AsioHostEvent::BufferFailure
            ? "buffer_failure"
            : (event == AsioHostEvent::DeviceLost ? "device_lost" : "driver_restart");
    outputInfo_.capabilityReason = diagnostics_.lastError;
    outputInfo_.perfectReason = diagnostics_.lastError;
    outputInfo_.diagnostics = diagnostics_;
  }
  if (event == AsioHostEvent::DriverReset || event == AsioHostEvent::DriverRestart || event == AsioHostEvent::DeviceLost) {
    const uint64_t version = DeviceCapabilityCache::instance().bumpVersion(openConfig_.deviceId);
    std::lock_guard lock(mutex_);
    deviceInfo_.capabilityVersion = version;
  }

  {
    std::lock_guard lock(mutex_);
    while (!recoveryWindow_.empty() && now - recoveryWindow_.front() > kRecoveryWindow) {
      recoveryWindow_.pop_front();
    }
    if (recoveryInProgress_) {
      diagnostics_.lastError = message.empty() ? "ASIO recovery already in progress"
                                               : message + " (ASIO recovery already in progress)";
      outputInfo_.capabilityReason = diagnostics_.lastError;
      outputInfo_.perfectReason = diagnostics_.lastError;
      outputInfo_.diagnostics = diagnostics_;
      return false;
    }
    if (now < recoveryCooldownUntil_) {
      diagnostics_.lastError = message.empty() ? "ASIO recovery cooldown active"
                                               : message + " (ASIO recovery cooldown active)";
      outputInfo_.capabilityReason = diagnostics_.lastError;
      outputInfo_.perfectReason = diagnostics_.lastError;
      outputInfo_.diagnostics = diagnostics_;
      return false;
    }
    if (recoveryWindow_.size() >= static_cast<size_t>(kMaxAttempts)) {
      recoveryCooldownUntil_ = now + kRecoveryCooldown;
      diagnostics_.lastError = message.empty() ? "ASIO recovery cooldown active"
                                               : message + " (ASIO recovery cooldown active)";
      outputInfo_.capabilityReason = diagnostics_.lastError;
      outputInfo_.perfectReason = diagnostics_.lastError;
      outputInfo_.diagnostics = diagnostics_;
      return false;
    }
    recoveryWindow_.push_back(now);
    recoveryInProgress_ = true;
    recoveryAttempts_ = 0;
    outputInfo_.deviceRecovered = false;
    outputInfo_.recoveryCount = recoveryCount_;
    outputInfo_.diagnostics = diagnostics_;
  }

  std::string lastAttemptError;
  for (int attempt = 0; attempt < kMaxAttempts; ++attempt) {
    {
      std::lock_guard lock(mutex_);
      recoveryAttempts_ = attempt;
      outputInfo_.recoveryCount = recoveryCount_;
      outputInfo_.diagnostics = diagnostics_;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(kBackoffMs[attempt]));
    std::string error;
    host_->stop();
    host_->close();
    AsioOpenResult result;
    if (!host_->open(openConfig_, &result, &error)) {
      lastAttemptError = error;
      continue;
    }
    if (!createAndStartHost(&error)) {
      lastAttemptError = error;
      continue;
    }

    std::lock_guard lock(mutex_);
    recoveryAttempts_ = 0;
    recoveryInProgress_ = false;
    ++recoveryCount_;
    deviceRecovered_ = true;
    ++diagnostics_.sessionRecoveryCount;
    ++diagnostics_.lifetimeRecoveryCount;
    outputInfo_.deviceRecovered = true;
    outputInfo_.recoveryCount = recoveryCount_;
    outputInfo_.diagnostics = diagnostics_;
    return true;
  }

  running_ = false;
  {
    std::lock_guard lock(mutex_);
    recoveryInProgress_ = false;
    recoveryAttempts_ = kMaxAttempts;
    diagnostics_.lastError =
        lastAttemptError.empty() ? (message.empty() ? "ASIO 设备恢复失败" : message) : lastAttemptError;
    outputInfo_.capabilityReason = diagnostics_.lastError;
    outputInfo_.perfectReason = diagnostics_.lastError;
    outputInfo_.diagnostics = diagnostics_;
  }
  if (eventCallback) {
    eventCallback(OutputBackendEvent::DeviceInvalidated, message.empty() ? "ASIO 设备恢复失败" : message);
  }
  return false;
}

bool asioBackendAvailable() {
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  return true;
#else
  return false;
#endif
}

}  // namespace twilight::audio
