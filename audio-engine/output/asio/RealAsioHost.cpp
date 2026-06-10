#include "RealAsioHost.h"
#include "DeviceCapabilityCache.h"

#include <algorithm>
#include <array>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <sstream>

#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
#include <asiosys.h>
#include <asiodrivers.h>

bool loadAsioDriver(char* name);
#endif

namespace twilight::audio {
namespace {

constexpr std::array<int, 8> kProbeRates = {44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000};
constexpr std::array<int, 4> kDsdProbeRates = {2822400, 5644800, 11289600, 22579200};

#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
RealAsioHost* g_activeHost = nullptr;

std::string asioErrorText(long error, const char* fallback) {
  if (error == ASE_OK) return {};
  char buffer[160] = {};
  std::snprintf(buffer, sizeof(buffer), "%s (ASIO 错误码 %ld)", fallback, error);
  return buffer;
}

std::string asioErrorText(long error, const char* fallback, const AsioOpenConfig& config) {
  if (error == ASE_OK) return {};
  std::ostringstream message;
  message << asioErrorText(error, fallback)
          << " [rate=" << config.format.sampleRate
          << "Hz, channels=" << config.format.channelCount
          << ", buffer=" << config.bufferSizeFrames
          << ", format=" << sampleFormatToString(config.format.sampleFormat)
          << "]";
  return message.str();
}

long legalizeAsioBufferSize(long requested, long minSize, long maxSize, long preferred, long granularity) {
  if (preferred <= 0) preferred = requested > 0 ? requested : 512;
  if (minSize <= 0) minSize = preferred;
  if (maxSize <= 0) maxSize = std::max(minSize, preferred);
  if (maxSize < minSize) maxSize = minSize;

  long value = requested > 0 ? requested : preferred;
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
    long bestDistance = std::labs(value - best);
    for (long size = minSize; size <= maxSize; size *= 2) {
      const long distance = std::labs(value - size);
      if (distance < bestDistance || (distance == bestDistance && size < best)) {
        best = size;
        bestDistance = distance;
      }
      if (size > maxSize / 2) break;
    }
    return best;
  }
  return value;
}

AudioSampleFormat fromAsioSampleType(ASIOSampleType type) {
  switch (type) {
    case ASIOSTDSDInt8LSB1:
      return AudioSampleFormat::DsdInt8Lsb1;
    case ASIOSTDSDInt8MSB1:
      return AudioSampleFormat::DsdInt8Msb1;
    case ASIOSTDSDInt8NER8:
      return AudioSampleFormat::DsdInt8Ner8;
    case ASIOSTInt16LSB:
    case ASIOSTInt16MSB:
      return AudioSampleFormat::Int16Interleaved;
    case ASIOSTInt24LSB:
    case ASIOSTInt24MSB:
      return AudioSampleFormat::Int24Interleaved;
    case ASIOSTInt32LSB:
    case ASIOSTInt32MSB:
      return AudioSampleFormat::Int32Interleaved;
    case ASIOSTFloat32LSB:
    case ASIOSTFloat32MSB:
    default:
      return AudioSampleFormat::Float32Interleaved;
  }
}

int bitDepthForSampleFormat(AudioSampleFormat format) {
  if (isDsdSampleFormat(format)) return 1;
  if (format == AudioSampleFormat::Int16Interleaved) return 16;
  if (format == AudioSampleFormat::Int24Interleaved || format == AudioSampleFormat::Int24In32Interleaved) return 24;
  return 32;
}

bool isNativeDsdRequest(const AudioFormat& format) {
  return format.sampleRate >= 2822400 && format.channelCount > 0 && isDsdSampleFormat(format.sampleFormat);
}

ASIOSampleRate makeAsioSampleRate(int sampleRate) {
#if IEEE754_64FLOAT
  return static_cast<ASIOSampleRate>(sampleRate);
#else
  ASIOSampleRate rate{};
  const double value = static_cast<double>(sampleRate);
  std::memcpy(rate.ieee, &value, sizeof(value));
  return rate;
#endif
}

int asioSampleRateToInt(const ASIOSampleRate& sampleRate) {
#if IEEE754_64FLOAT
  return static_cast<int>(sampleRate);
#else
  double value = 0.0;
  std::memcpy(&value, sampleRate.ieee, sizeof(value));
  return static_cast<int>(value);
#endif
}

bool setAsioIoFormat(ASIOIoFormatType type) {
  ASIOIoFormat format{};
  format.FormatType = type;
  return ASIOFuture(kAsioSetIoFormat, &format) == ASE_SUCCESS;
}

bool canAsioIoFormat(ASIOIoFormatType type) {
  ASIOIoFormat format{};
  format.FormatType = type;
  return ASIOFuture(kAsioCanDoIoFormat, &format) == ASE_SUCCESS;
}

bool getAsioIoFormat(ASIOIoFormatType* type) {
  if (!type) return false;
  ASIOIoFormat format{};
  const bool ok = ASIOFuture(kAsioGetIoFormat, &format) == ASE_SUCCESS;
  if (ok) *type = format.FormatType;
  return ok;
}

void appendUniqueFormat(std::vector<AudioSampleFormat>* formats, AudioSampleFormat format) {
  if (!formats) return;
  if (std::find(formats->begin(), formats->end(), format) == formats->end()) formats->push_back(format);
}

void appendUniqueRate(std::vector<int>* rates, int rate) {
  if (!rates || rate <= 0) return;
  if (std::find(rates->begin(), rates->end(), rate) == rates->end()) rates->push_back(rate);
}

void probeNativeDsdSupport(AsioDeviceInfo* device) {
  if (!device || device->outputChannels <= 0) return;
  ASIOIoFormatType previousFormat = kASIOPCMFormat;
  getAsioIoFormat(&previousFormat);
  ASIOSampleRate previousRate{};
  const bool hasPreviousRate = ASIOGetSampleRate(&previousRate) == ASE_OK;
  const auto restorePreviousState = [&]() {
    setAsioIoFormat(previousFormat == kASIODSDFormat ? kASIODSDFormat : kASIOPCMFormat);
    if (hasPreviousRate) ASIOSetSampleRate(previousRate);
  };

  if (!canAsioIoFormat(kASIODSDFormat)) {
    restorePreviousState();
    return;
  }
  if (!setAsioIoFormat(kASIODSDFormat)) {
    restorePreviousState();
    return;
  }

  const auto probeDsdChannelFormats = [&]() {
    for (long channelIndex = 0; channelIndex < std::max(1, device->outputChannels); ++channelIndex) {
      ASIOChannelInfo channel{};
      channel.channel = channelIndex;
      channel.isInput = ASIOFalse;
      if (ASIOGetChannelInfo(&channel) == ASE_OK) {
        const AudioSampleFormat format = fromAsioSampleType(channel.type);
        if (isDsdSampleFormat(format)) {
          appendUniqueFormat(&device->nativeDsdSampleFormats, format);
        }
      }
    }
  };

  for (int rate : kDsdProbeRates) {
    const ASIOSampleRate asioRate = makeAsioSampleRate(rate);
    if (ASIOCanSampleRate(asioRate) == ASE_OK && ASIOSetSampleRate(asioRate) == ASE_OK) {
      appendUniqueRate(&device->nativeDsdSampleRates, rate);
      probeDsdChannelFormats();
    }
  }

  device->nativeDsdCapable = !device->nativeDsdSampleRates.empty() && !device->nativeDsdSampleFormats.empty();
  if (device->nativeDsdCapable) {
    for (AudioSampleFormat format : device->nativeDsdSampleFormats) {
      appendUniqueFormat(&device->sampleFormats, format);
    }
  }
  restorePreviousState();
}

long asioMessage(long selector, long value, void*, double*) {
  if (!g_activeHost) return 0;
  switch (selector) {
    case kAsioSelectorSupported:
      return value == kAsioResetRequest || value == kAsioResyncRequest || value == kAsioLatenciesChanged ||
                     value == kAsioOverload || value == kAsioEngineVersion
                 ? 1
                 : 0;
    case kAsioEngineVersion:
      return 2;
    case kAsioResetRequest:
      g_activeHost->handleHostEvent(AsioHostEvent::DriverReset, "ASIO driver reset requested");
      return 1;
    case kAsioResyncRequest:
      g_activeHost->handleHostEvent(AsioHostEvent::DriverRestart, "ASIO driver resync requested");
      return 1;
    case kAsioOverload:
      g_activeHost->handleHostEvent(AsioHostEvent::BufferFailure, "ASIO overload");
      return 1;
    default:
      return 0;
  }
}

void bufferSwitch(long doubleBufferIndex, ASIOBool) {
  if (g_activeHost) g_activeHost->handleBufferSwitch(doubleBufferIndex);
}

void sampleRateDidChange(ASIOSampleRate) {}

ASIOTime* bufferSwitchTimeInfo(ASIOTime* params, long doubleBufferIndex, ASIOBool directProcess) {
  bufferSwitch(doubleBufferIndex, directProcess);
  return params;
}
#endif

}  // namespace

std::vector<int> asioDefaultSampleRateProbeSet() {
  return std::vector<int>(kProbeRates.begin(), kProbeRates.end());
}

std::string asioSampleFormatName(AudioSampleFormat format) {
  switch (format) {
    case AudioSampleFormat::Int16Interleaved:
      return "int16";
    case AudioSampleFormat::Int24Interleaved:
      return "int24";
    case AudioSampleFormat::Int24In32Interleaved:
      return "int24-in32";
    case AudioSampleFormat::Int32Interleaved:
      return "int32";
    case AudioSampleFormat::DsdInt8Lsb1:
      return "dsd-int8-lsb1";
    case AudioSampleFormat::DsdInt8Msb1:
      return "dsd-int8-msb1";
    case AudioSampleFormat::DsdInt8Ner8:
      return "dsd-int8-ner8";
    case AudioSampleFormat::Float32Interleaved:
    default:
      return "float32";
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

struct RealAsioHost::Impl {
  AsioBufferSwitchCallback bufferSwitch;
  AsioEventCallback eventCallback;
  AsioOpenConfig config;
  AsioOpenResult result;

#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  std::unique_ptr<AsioDrivers> drivers;
  std::vector<ASIOBufferInfo> bufferInfos;
  std::vector<AudioSampleFormat> outputFormats;
  ASIOCallbacks callbacks{};
  bool initialized = false;

  bool ensureDrivers() {
    if (!drivers) drivers = std::make_unique<AsioDrivers>();
    return drivers != nullptr;
  }
#endif
};

RealAsioHost::RealAsioHost() : impl_(std::make_unique<Impl>()) {}

RealAsioHost::~RealAsioHost() {
  close();
}

#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
void RealAsioHost::handleHostEvent(AsioHostEvent event, const std::string& message) {
  if (impl_->eventCallback) impl_->eventCallback(event, message);
}

void RealAsioHost::handleBufferSwitch(long bufferIndex) {
  if (impl_->bufferSwitch) impl_->bufferSwitch(bufferIndex);
}
#endif

std::vector<AsioDeviceInfo> RealAsioHost::enumerateDevices() {
  std::vector<AsioDeviceInfo> devices;
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  if (!impl_->ensureDrivers()) return devices;
  const long count = impl_->drivers->asioGetNumDev();
  for (long i = 0; i < count; ++i) {
    char name[128] = {};
    if (impl_->drivers->asioGetDriverName(static_cast<int>(i), name, sizeof(name)) != 0) continue;

    AsioDeviceInfo device;
    device.id = std::string("asio:") + name;
    if (auto cached = DeviceCapabilityCache::instance().get(device.id)) {
      cached->isDefault = devices.empty();
      devices.push_back(*cached);
      continue;
    }
    device.name = name;
    device.driverName = name;
    device.isDefault = devices.empty();
    device.capabilityVersion = DeviceCapabilityCache::instance().version(device.id);
    device.dopCapable = false;
    device.nativeDsdCapable = false;
    device.dopCarrierSampleRates.clear();
    device.dopCarrierSampleFormats.clear();
    device.nativeDsdSampleRates.clear();
    device.nativeDsdSampleFormats.clear();

    bool probedCapabilities = false;
    if (loadAsioDriver(name)) {
      ASIODriverInfo info{};
      info.asioVersion = 2;
      if (ASIOInit(&info) == ASE_OK) {
        probedCapabilities = true;
        device.driverVersion = info.driverVersion;
        long inputs = 0;
        long outputs = 0;
        if (ASIOGetChannels(&inputs, &outputs) == ASE_OK) device.outputChannels = static_cast<int>(outputs);
        for (int rate : asioDefaultSampleRateProbeSet()) {
          if (ASIOCanSampleRate(makeAsioSampleRate(rate)) == ASE_OK) device.supportedSampleRates.push_back(rate);
        }
        ASIOSampleRate currentRate{};
        if (ASIOGetSampleRate(&currentRate) == ASE_OK) device.defaultSampleRate = asioSampleRateToInt(currentRate);
        long minSize = 0;
        long maxSize = 0;
        long preferred = 0;
        long granularity = 0;
        if (ASIOGetBufferSize(&minSize, &maxSize, &preferred, &granularity) == ASE_OK) {
          device.minBufferSize = minSize;
          device.maxBufferSize = maxSize;
          device.preferredBufferSize = preferred;
          device.bufferGranularity = granularity;
        }
        long inputLatency = 0;
        long outputLatency = 0;
        if (ASIOGetLatencies(&inputLatency, &outputLatency) == ASE_OK) device.outputLatencyFrames = outputLatency;
        if (device.outputChannels > 0) {
          ASIOChannelInfo channel{};
          channel.channel = 0;
          channel.isInput = ASIOFalse;
          if (ASIOGetChannelInfo(&channel) == ASE_OK) {
            device.defaultSampleFormat = fromAsioSampleType(channel.type);
            device.defaultBitDepth = device.defaultSampleFormat == AudioSampleFormat::Int16Interleaved
                                         ? 16
                                         : device.defaultSampleFormat == AudioSampleFormat::Int24Interleaved ? 24 : 32;
            device.sampleFormats = {device.defaultSampleFormat};
          }
        }
        if (device.sampleFormats.empty()) device.sampleFormats = {device.defaultSampleFormat};
        probeNativeDsdSupport(&device);
        device.bitDepths.clear();
        for (const auto format : device.sampleFormats) {
          const int depth = bitDepthForSampleFormat(format);
          if (std::find(device.bitDepths.begin(), device.bitDepths.end(), depth) == device.bitDepths.end()) {
            device.bitDepths.push_back(depth);
          }
        }
      }
      ASIOExit();
    }
    if (probedCapabilities) DeviceCapabilityCache::instance().put(device);
    devices.push_back(device);
  }
#endif
  return devices;
}

bool RealAsioHost::open(const AsioOpenConfig& config, AsioOpenResult* result, std::string* error) {
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  close();
  if (!impl_->ensureDrivers()) {
    if (error) *error = "无法创建 ASIO 驱动管理器";
    return false;
  }
  std::string driverName = config.deviceId;
  constexpr const char* kPrefix = "asio:";
  if (driverName.rfind(kPrefix, 0) == 0) driverName = driverName.substr(std::strlen(kPrefix));
  std::vector<char> mutableName(driverName.begin(), driverName.end());
  mutableName.push_back('\0');
  if (!loadAsioDriver(mutableName.data())) {
    if (error) *error = "无法加载 ASIO 驱动：" + driverName;
    return false;
  }

  ASIODriverInfo info{};
  info.asioVersion = 2;
  const ASIOError initResult = ASIOInit(&info);
  if (initResult != ASE_OK) {
    if (error) *error = asioErrorText(initResult, "无法初始化 ASIO 驱动");
    ASIOExit();
    return false;
  }
  impl_->initialized = true;
  impl_->config = config;
  impl_->result.actualFormat = config.format;
  impl_->result.driverName = info.name[0] ? info.name : driverName;
  impl_->result.driverVersion = info.driverVersion;

  const bool nativeDsd = isNativeDsdRequest(config.format);
  if (nativeDsd) {
    if (!canAsioIoFormat(kASIODSDFormat) || !setAsioIoFormat(kASIODSDFormat)) {
      if (error) *error = "ASIO 驱动无法切换到 Native DSD I/O format";
      close();
      return false;
    }
  } else {
    setAsioIoFormat(kASIOPCMFormat);
  }

  if (ASIOCanSampleRate(makeAsioSampleRate(config.format.sampleRate)) != ASE_OK ||
      ASIOSetSampleRate(makeAsioSampleRate(config.format.sampleRate)) != ASE_OK) {
    if (error) *error = "ASIO 驱动不支持协商后的采样率";
    close();
    return false;
  }

  long minSize = 0;
  long maxSize = 0;
  long preferred = 0;
  long granularity = 0;
  if (ASIOGetBufferSize(&minSize, &maxSize, &preferred, &granularity) != ASE_OK) {
    if (error) *error = "无法读取 ASIO buffer size";
    close();
    return false;
  }
  impl_->result.bufferSizeFrames =
      legalizeAsioBufferSize(config.bufferSizeFrames, minSize, maxSize, preferred, granularity);
  impl_->config.bufferSizeFrames = impl_->result.bufferSizeFrames;
  long inputLatency = 0;
  long outputLatency = 0;
  if (ASIOGetLatencies(&inputLatency, &outputLatency) == ASE_OK) impl_->result.latencyFrames = outputLatency;
  if (result) *result = impl_->result;
  return true;
#else
  (void)config;
  (void)result;
  if (error) *error = "当前构建未启用 ASIO 输出";
  return false;
#endif
}

bool RealAsioHost::createBuffers(
    AsioBufferSwitchCallback bufferSwitchCallback,
    AsioEventCallback eventCallback,
    std::string* error) {
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  if (!impl_->initialized) {
    if (error) *error = "ASIO 驱动尚未初始化";
    return false;
  }
  impl_->bufferSwitch = std::move(bufferSwitchCallback);
  impl_->eventCallback = std::move(eventCallback);
  impl_->bufferInfos.assign(static_cast<size_t>(impl_->config.format.channelCount), ASIOBufferInfo{});
  impl_->outputFormats.assign(static_cast<size_t>(impl_->config.format.channelCount), impl_->config.format.sampleFormat);
  for (long channel = 0; channel < impl_->config.format.channelCount; ++channel) {
    impl_->bufferInfos[static_cast<size_t>(channel)].isInput = ASIOFalse;
    impl_->bufferInfos[static_cast<size_t>(channel)].channelNum = channel;
    ASIOChannelInfo info{};
    info.channel = channel;
    info.isInput = ASIOFalse;
    if (ASIOGetChannelInfo(&info) == ASE_OK) {
      impl_->outputFormats[static_cast<size_t>(channel)] = fromAsioSampleType(info.type);
    }
  }
  impl_->callbacks.bufferSwitch = bufferSwitch;
  impl_->callbacks.sampleRateDidChange = sampleRateDidChange;
  impl_->callbacks.asioMessage = asioMessage;
  impl_->callbacks.bufferSwitchTimeInfo = bufferSwitchTimeInfo;
  g_activeHost = this;

  const ASIOError result = ASIOCreateBuffers(
      impl_->bufferInfos.data(),
      static_cast<long>(impl_->bufferInfos.size()),
      impl_->result.bufferSizeFrames,
      &impl_->callbacks);
  if (result != ASE_OK) {
    if (error) *error = asioErrorText(result, "无法创建 ASIO buffers", impl_->config);
    return false;
  }
  return true;
#else
  (void)bufferSwitchCallback;
  (void)eventCallback;
  if (error) *error = "当前构建未启用 ASIO 输出";
  return false;
#endif
}

bool RealAsioHost::start(std::string* error) {
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  const ASIOError result = ASIOStart();
  if (result == ASE_OK) return true;
  if (error) *error = asioErrorText(result, "无法启动 ASIO 输出");
  return false;
#else
  if (error) *error = "当前构建未启用 ASIO 输出";
  return false;
#endif
}

void RealAsioHost::stop() {
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  if (impl_->initialized) ASIOStop();
#endif
}

void RealAsioHost::close() {
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  if (impl_->initialized) {
    ASIODisposeBuffers();
    setAsioIoFormat(kASIOPCMFormat);
    ASIOExit();
    impl_->initialized = false;
  }
  if (g_activeHost == this) g_activeHost = nullptr;
  impl_->bufferInfos.clear();
  impl_->outputFormats.clear();
#endif
}

void* RealAsioHost::outputBuffer(long channel, long bufferIndex) {
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  if (channel < 0 || bufferIndex < 0 || bufferIndex > 1) return nullptr;
  const auto index = static_cast<size_t>(channel);
  if (index >= impl_->bufferInfos.size()) return nullptr;
  return impl_->bufferInfos[index].buffers[bufferIndex];
#else
  (void)channel;
  (void)bufferIndex;
  return nullptr;
#endif
}

AudioSampleFormat RealAsioHost::outputSampleFormat(long channel) const {
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  if (channel < 0 || static_cast<size_t>(channel) >= impl_->outputFormats.size()) {
    return AudioSampleFormat::Float32Interleaved;
  }
  return impl_->outputFormats[static_cast<size_t>(channel)];
#else
  (void)channel;
  return AudioSampleFormat::Float32Interleaved;
#endif
}

bool RealAsioHost::outputReady() {
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  return ASIOOutputReady() == ASE_OK;
#else
  return false;
#endif
}

std::unique_ptr<IAsioHost> createRealAsioHost() {
  return std::make_unique<RealAsioHost>();
}

#if !defined(_WIN32) || !defined(TAE_ENABLE_ASIO)
std::string enumerateAsioDevicesJson() {
  return "[]";
}
#else
std::string enumerateAsioDevicesJson() {
  RealAsioHost host;
  const auto devices = host.enumerateDevices();
  std::ostringstream json;
  json << "[";
  bool first = true;
  for (const auto& device : devices) {
    if (!first) json << ",";
    first = false;
    json << "{\"id\":\"" << escapeJson(device.id) << "\",\"label\":\"" << escapeJson(device.name) << "\",\"isDefault\":"
         << (device.isDefault ? "true" : "false") << ",\"backend\":\"asio\",\"name\":\"" << escapeJson(device.name)
         << "\",\"channels\":" << device.outputChannels << ",\"sampleRates\":[";
    for (size_t i = 0; i < device.supportedSampleRates.size(); ++i) {
      if (i > 0) json << ",";
      json << device.supportedSampleRates[i];
    }
    json << "],\"driverName\":\"" << escapeJson(device.driverName) << "\",\"driverVersion\":" << device.driverVersion
         << ",\"bitDepths\":[";
    for (size_t i = 0; i < device.bitDepths.size(); ++i) {
      if (i > 0) json << ",";
      json << device.bitDepths[i];
    }
    json << "],\"latencyFrames\":" << device.outputLatencyFrames
         << ",\"supportsExclusive\":true"
         << ",\"supportsHogMode\":false"
         << ",\"supportsDirectHw\":false"
         << ",\"supportsDop\":" << (device.dopCapable ? "true" : "false")
         << ",\"supportsNativeDsd\":" << (device.nativeDsdCapable ? "true" : "false")
         << ",\"dopCapable\":" << (device.dopCapable ? "true" : "false")
         << ",\"nativeDsdCapable\":" << (device.nativeDsdCapable ? "true" : "false")
         << ",\"dopCarrierSampleRates\":[";
    for (size_t i = 0; i < device.dopCarrierSampleRates.size(); ++i) {
      if (i > 0) json << ",";
      json << device.dopCarrierSampleRates[i];
    }
    json << "],\"dopCarrierFormats\":[";
    for (size_t i = 0; i < device.dopCarrierSampleFormats.size(); ++i) {
      if (i > 0) json << ",";
      json << "\"" << escapeJson(sampleFormatToString(device.dopCarrierSampleFormats[i])) << "\"";
    }
    json << "],\"nativeDsdSampleRates\":[";
    for (size_t i = 0; i < device.nativeDsdSampleRates.size(); ++i) {
      if (i > 0) json << ",";
      json << device.nativeDsdSampleRates[i];
    }
    json << "],\"nativeDsdSampleFormats\":[";
    for (size_t i = 0; i < device.nativeDsdSampleFormats.size(); ++i) {
      if (i > 0) json << ",";
      json << "\"" << escapeJson(sampleFormatToString(device.nativeDsdSampleFormats[i])) << "\"";
    }
    json << "]"
         << ",\"supportedDsdRates\":[";
    for (size_t i = 0; i < device.nativeDsdSampleRates.size(); ++i) {
      if (i > 0) json << ",";
      json << device.nativeDsdSampleRates[i];
    }
    json << "]"
         << ",\"pathKind\":\"asio\""
         << ",\"capabilityReason\":\"\""
         << ",\"minBufferSize\":" << device.minBufferSize
         << ",\"maxBufferSize\":" << device.maxBufferSize
         << ",\"granularity\":" << device.bufferGranularity
         << ",\"preferredBufferSize\":" << device.preferredBufferSize
         << ",\"capabilityVersion\":" << device.capabilityVersion << "}";
  }
  json << "]";
  return json.str();
}
#endif

}  // namespace twilight::audio
