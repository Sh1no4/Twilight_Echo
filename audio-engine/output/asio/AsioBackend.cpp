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
  if (bitDepth <= 16) return 16;
  if (bitDepth <= 24) return 24;
  return 32;
}

int bitDepthForFormat(AudioSampleFormat format) {
  switch (format) {
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

std::vector<std::string> sampleFormatNames(const std::vector<AudioSampleFormat>& formats) {
  std::vector<std::string> names;
  names.reserve(formats.size());
  for (AudioSampleFormat format : formats) {
    names.push_back(sampleFormatToString(format));
  }
  return names;
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

bool explicitBufferSizeAllowed(uint32_t size) {
  static constexpr uint32_t kAllowed[] = {64, 128, 256, 512, 1024, 2048};
  return std::find(std::begin(kAllowed), std::end(kAllowed), size) != std::end(kAllowed);
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
  }

  const auto devices = host_->enumerateDevices();
  if (devices.empty()) {
    if (error) *error = "未找到可用 ASIO 驱动";
    diagnostics_.lastError = error ? *error : "未找到可用 ASIO 驱动";
    outputInfo_.perfectReason = diagnostics_.lastError;
    return false;
  }

  const auto deviceIt = std::find_if(devices.begin(), devices.end(), [&](const AsioDeviceInfo& device) {
    return deviceId.empty() || deviceId == "auto" || device.id == deviceId || device.name == deviceId ||
           device.driverName == deviceId || ("asio:" + device.driverName) == deviceId;
  });
  if (deviceIt == devices.end()) {
    if (error) *error = "无法找到请求的 ASIO 设备：" + deviceId;
    diagnostics_.lastError = error ? *error : "无法找到请求的 ASIO 设备";
    outputInfo_.perfectReason = diagnostics_.lastError;
    return false;
  }

  AudioFormat selected;
  if (!chooseFormat(*deviceIt, requestedFormat, &selected)) {
    if (error) *error = "ASIO 设备没有可协商的输出格式";
    diagnostics_.lastError = error ? *error : "ASIO 设备没有可协商的输出格式";
    outputInfo_.perfectReason = diagnostics_.lastError;
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
    outputInfo_.perfectReason = diagnostics_.lastError;
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
  outputInfo_.supportsOutputPerfect = true;
  outputInfo_.sourceExact = false;
  outputInfo_.outputPerfect = false;
  outputInfo_.pcmPassthrough = false;
  outputInfo_.resampled = !sameFormat(requestedFormat, outputFormat_);
  outputInfo_.perfectReason = outputInfo_.resampled ? "ASIO 输出格式已协商为驱动支持格式" : "";
  outputInfo_.outputSampleRate = outputFormat_.sampleRate;
  outputInfo_.outputBitDepth = outputFormat_.bitDepth;
  outputInfo_.backend = "asio";
  outputInfo_.actualBackend = "asio";
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
  outputInfo_.latencyMs = outputFormat_.sampleRate > 0
                              ? static_cast<double>(latencyFrames_) * 1000.0 / static_cast<double>(outputFormat_.sampleRate)
                              : 0.0;
  outputInfo_.latencyInfo.bufferLatencyMs =
      outputFormat_.sampleRate > 0
          ? static_cast<double>(bufferSizeFrames_) * 1000.0 / static_cast<double>(outputFormat_.sampleRate)
          : 0.0;
  outputInfo_.latencyInfo.outputLatencyMs = outputInfo_.latencyMs;
  outputInfo_.latencyInfo.totalLatencyMs = outputInfo_.latencyInfo.bufferLatencyMs + outputInfo_.latencyInfo.outputLatencyMs;
  outputInfo_.channelRoutingMode = channelRoutingModeToString(outputConfig_.routingMode);
  outputInfo_.diagnostics = diagnostics_;
  outputInfo_.deviceRecovered = false;
  outputInfo_.recoveryCount = recoveryCount_;
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
    eventCallback_ = std::move(eventCallback);
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
  eventCallback_ = nullptr;
  renderScratch_.clear();
  recoveryInProgress_ = false;
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

std::string AsioBackend::deviceName() const {
  return deviceName_;
}

bool AsioBackend::chooseFormat(const AsioDeviceInfo& device, const AudioFormat& requestedFormat, AudioFormat* selected) const {
  if (!selected || requestedFormat.sampleRate <= 0 || requestedFormat.channelCount <= 0) return false;

  std::vector<int> sampleRates = device.supportedSampleRates;
  if (device.dopCapable) appendUniqueSampleRates(&sampleRates, device.dopCarrierSampleRates);
  if (sampleRates.empty() && device.defaultSampleRate > 0) sampleRates.push_back(device.defaultSampleRate);
  if (sampleRates.empty()) sampleRates = asioDefaultSampleRateProbeSet();

  std::vector<AudioSampleFormat> sampleFormats = device.sampleFormats;
  if (device.dopCapable) appendUniqueSampleFormats(&sampleFormats, device.dopCarrierSampleFormats);
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
    for (AudioSampleFormat sampleFormat : sampleFormats) {
      const int normalized = bitDepthForFormat(sampleFormat);
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
    if (error) outputInfo_.perfectReason = "ASIO buffer creation failed: " + *error;
    outputInfo_.diagnostics = diagnostics_;
    return false;
  }
  {
    std::lock_guard lock(mutex_);
    const AudioSampleFormat actualSampleFormat = host_->outputSampleFormat(0);
    outputFormat_.sampleFormat = actualSampleFormat;
    outputFormat_.bitDepth = bitDepthForFormat(actualSampleFormat);
    outputInfo_.actualOutputFormat = sampleFormatToString(actualSampleFormat);
    outputInfo_.actualBitDepth = outputFormat_.bitDepth;
    outputInfo_.outputBitDepth = outputFormat_.bitDepth;
    outputInfo_.resampled = !sameFormat(openConfig_.format, outputFormat_);
    if (outputInfo_.resampled && outputInfo_.perfectReason.empty()) {
      outputInfo_.perfectReason = "ASIO actual output format differs from negotiated format";
    }
  }
  running_ = true;
  if (!host_->start(error)) {
    running_ = false;
    std::lock_guard lock(mutex_);
    if (error) diagnostics_.lastError = *error;
    if (error) outputInfo_.perfectReason = "ASIO start failed: " + *error;
    outputInfo_.diagnostics = diagnostics_;
    return false;
  }
  return true;
}

void AsioBackend::renderBuffer(long bufferIndex) {
  RenderCallback callback;
  {
    std::lock_guard lock(mutex_);
    callback = callback_;
  }
  const int sourceChannels = std::max(1, outputFormat_.channelCount);
  const int outputChannels = std::max(1, openConfig_.format.channelCount);
  const size_t frames = static_cast<size_t>(std::max<long>(1, bufferSizeFrames_));
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
      switch (outputConfig_.routingMode) {
        case ChannelRoutingMode::MonoToStereo:
        case ChannelRoutingMode::MonoToMultichannel:
          if (channel < 2) sample = renderScratch_[frame * static_cast<size_t>(sourceChannels)];
          break;
        case ChannelRoutingMode::Stereo:
        case ChannelRoutingMode::StereoTo51:
        case ChannelRoutingMode::StereoTo71:
          if (channel < 2 && sourceChannels > channel) {
            sample = renderScratch_[frame * static_cast<size_t>(sourceChannels) + static_cast<size_t>(channel)];
          }
          break;
        case ChannelRoutingMode::Auto:
        default:
          if (channel < sourceChannels) {
            sample = renderScratch_[frame * static_cast<size_t>(sourceChannels) + static_cast<size_t>(channel)];
          }
          break;
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
    if (event == AsioHostEvent::DriverRestart) ++diagnostics_.driverRestartCount;
    if (event == AsioHostEvent::DeviceLost) ++diagnostics_.deviceLostCount;
    if (event == AsioHostEvent::BufferFailure) {
      ++diagnostics_.sessionUnderrunCount;
      ++diagnostics_.lifetimeUnderrunCount;
    }
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
      outputInfo_.diagnostics = diagnostics_;
      return false;
    }
    if (now < recoveryCooldownUntil_) {
      diagnostics_.lastError = message.empty() ? "ASIO recovery cooldown active"
                                               : message + " (ASIO recovery cooldown active)";
      outputInfo_.diagnostics = diagnostics_;
      return false;
    }
    if (recoveryWindow_.size() >= static_cast<size_t>(kMaxAttempts)) {
      recoveryCooldownUntil_ = now + kRecoveryCooldown;
      diagnostics_.lastError = message.empty() ? "ASIO recovery cooldown active"
                                               : message + " (ASIO recovery cooldown active)";
      outputInfo_.diagnostics = diagnostics_;
      return false;
    }
    recoveryWindow_.push_back(now);
    recoveryInProgress_ = true;
    recoveryAttempts_ = 0;
  }

  std::string lastAttemptError;
  for (int attempt = 0; attempt < kMaxAttempts; ++attempt) {
    {
      std::lock_guard lock(mutex_);
      recoveryAttempts_ = attempt;
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
