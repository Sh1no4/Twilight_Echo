#include "CoreAudioBackend.h"

#include <algorithm>
#include <atomic>
#include <cstring>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
#include <AudioToolbox/AudioToolbox.h>
#include <AudioUnit/AudioUnit.h>
#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>

#ifndef kAudioObjectPropertyElementMain
#define kAudioObjectPropertyElementMain kAudioObjectPropertyElementMaster
#endif
#endif

namespace twilight::audio {
namespace {

AudioFormat dopCandidateForRequestedFormat(const AudioFormat& requestedFormat) {
  if (isDopCarrierFormat(requestedFormat)) return requestedFormat;

  AudioFormat candidate;
  candidate.channelCount = requestedFormat.channelCount;
  candidate.bitDepth = 24;
  candidate.sampleFormat = AudioSampleFormat::Int24Interleaved;
  switch (requestedFormat.sampleRate) {
    case 2822400:
      candidate.sampleRate = 176400;
      return candidate;
    case 5644800:
      candidate.sampleRate = 352800;
      return candidate;
    default:
      return {};
  }
}

DopRuntimeFacts unprovenDopRuntimeFacts(
    const AudioFormat& requestedFormat,
    const AudioFormat& actualFormat,
    const std::string& reason) {
  DopRuntimeFacts facts;
  const AudioFormat candidateFormat = dopCandidateForRequestedFormat(requestedFormat);
  const bool dopLikeRequest = requestedFormat.sampleRate >= 2500000 || isDopCarrierFormat(requestedFormat);
  if (!dopLikeRequest && !isDopCarrierFormat(actualFormat)) return facts;

  facts.state = DopRuntimeFactState::Unproven;
  facts.candidateFormat = candidateFormat;
  facts.actualFormat = isDopCarrierFormat(actualFormat) ? actualFormat : AudioFormat{};
  facts.reason = reason;
  return facts;
}

}  // namespace

struct CoreAudioBackend::Impl {
  mutable std::mutex mutex;
  RenderCallback callback;
  OutputEventCallback eventCallback;
  OutputConfig outputConfig;
  AudioFormat outputFormat;
  OutputInfo outputInfo;
  DopRuntimeFacts dopRuntimeFacts;
  std::string deviceName = "CoreAudio";
  std::atomic<bool> running{false};

#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
  AudioUnit unit = nullptr;
  AudioDeviceID deviceId = kAudioObjectUnknown;
  std::vector<float> renderScratch;

  static std::string osStatusMessage(OSStatus status, const char* context) {
    char code[8] = {};
    const UInt32 be = CFSwapInt32HostToBig(static_cast<UInt32>(status));
    std::memcpy(code, &be, sizeof(UInt32));
    for (char& ch : code) {
      if (ch < 32 || ch > 126) ch = '.';
    }
    return std::string(context) + " (OSStatus " + std::to_string(status) + ", '" + code + "')";
  }

  static bool ok(OSStatus status, std::string* error, const char* context) {
    if (status == noErr) return true;
    if (error) *error = osStatusMessage(status, context);
    return false;
  }

  static std::string cfStringToUtf8(CFStringRef value) {
    if (!value) return {};
    char stack[512] = {};
    if (CFStringGetCString(value, stack, sizeof(stack), kCFStringEncodingUTF8)) {
      return stack;
    }
    const CFIndex length = CFStringGetLength(value);
    const CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    if (maxSize <= 1) return {};
    std::string out(static_cast<size_t>(maxSize), '\0');
    if (!CFStringGetCString(value, out.data(), maxSize, kCFStringEncodingUTF8)) return {};
    out.resize(std::strlen(out.c_str()));
    return out;
  }

  static std::string deviceString(AudioDeviceID id, AudioObjectPropertySelector selector) {
    AudioObjectPropertyAddress address{selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    CFStringRef value = nullptr;
    UInt32 size = sizeof(value);
    if (AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, &value) != noErr || !value) return {};
    std::string out = cfStringToUtf8(value);
    CFRelease(value);
    return out;
  }

  static UInt32 deviceUInt32(AudioDeviceID id, AudioObjectPropertySelector selector, AudioObjectPropertyScope scope) {
    AudioObjectPropertyAddress address{selector, scope, kAudioObjectPropertyElementMain};
    UInt32 value = 0;
    UInt32 size = sizeof(value);
    if (AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, &value) != noErr) return 0;
    return value;
  }

  static double nominalSampleRate(AudioDeviceID id) {
    AudioObjectPropertyAddress address{
        kAudioDevicePropertyNominalSampleRate,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain};
    Float64 value = 0.0;
    UInt32 size = sizeof(value);
    if (AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, &value) != noErr) return 0.0;
    return value;
  }

  static int outputChannelCount(AudioDeviceID id) {
    AudioObjectPropertyAddress address{
        kAudioDevicePropertyStreamConfiguration,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain};
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(id, &address, 0, nullptr, &size) != noErr || size == 0) return 0;
    std::vector<uint8_t> storage(size);
    if (AudioObjectGetPropertyData(id, &address, 0, nullptr, &size, storage.data()) != noErr) return 0;
    auto* list = reinterpret_cast<AudioBufferList*>(storage.data());
    int channels = 0;
    for (UInt32 i = 0; i < list->mNumberBuffers; ++i) {
      channels += static_cast<int>(list->mBuffers[i].mNumberChannels);
    }
    return channels;
  }

  static AudioSampleFormat sampleFormatFromStreamDescription(const AudioStreamBasicDescription& format) {
    if (format.mFormatID != kAudioFormatLinearPCM) return AudioSampleFormat::Float32Interleaved;
    if ((format.mFormatFlags & kAudioFormatFlagIsFloat) != 0 && format.mBitsPerChannel == 32) {
      return AudioSampleFormat::Float32Interleaved;
    }
    if ((format.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0) {
      if (format.mBitsPerChannel <= 16) return AudioSampleFormat::Int16Interleaved;
      if (format.mBitsPerChannel == 24 && format.mBytesPerFrame == format.mChannelsPerFrame * 3) {
        return AudioSampleFormat::Int24Interleaved;
      }
      if (format.mBitsPerChannel == 24) return AudioSampleFormat::Int24In32Interleaved;
      if (format.mBitsPerChannel >= 32) return AudioSampleFormat::Int32Interleaved;
    }
    return AudioSampleFormat::Float32Interleaved;
  }

  static std::string coreAudioReason(const AudioFormat& requested, const AudioFormat& actual) {
    std::string reason = "CoreAudio 默认输出使用系统混音路径，未启用 Hog Mode/Exclusive";
    if (requested.sampleRate != actual.sampleRate) {
      reason += "; actual sample rate " + std::to_string(actual.sampleRate) + "Hz";
    }
    if (requested.channelCount != actual.channelCount) {
      reason += "; actual channels " + std::to_string(actual.channelCount);
    }
    if (requested.sampleFormat != actual.sampleFormat ||
        effectivePcmBitDepth(requested) != effectivePcmBitDepth(actual)) {
      reason += "; actual format " + sampleFormatToString(actual.sampleFormat) + " " +
                std::to_string(effectivePcmBitDepth(actual)) + "bit";
    }
    return reason;
  }

  static bool defaultOutputDevice(AudioDeviceID* out, std::string* error) {
    AudioObjectPropertyAddress address{
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain};
    UInt32 size = sizeof(*out);
    const OSStatus status =
        AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, out);
    return ok(status, error, "无法读取 CoreAudio 默认输出设备");
  }

  static bool findOutputDevice(const std::string& requested, AudioDeviceID* out, std::string* error) {
    if (requested.empty() || requested == "auto" || requested == "default") {
      return defaultOutputDevice(out, error);
    }

    AudioObjectPropertyAddress address{
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain};
    UInt32 size = 0;
    OSStatus status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &size);
    if (!ok(status, error, "无法枚举 CoreAudio 设备")) return false;
    std::vector<AudioDeviceID> devices(size / sizeof(AudioDeviceID));
    status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, devices.data());
    if (!ok(status, error, "无法读取 CoreAudio 设备列表")) return false;

    for (AudioDeviceID candidate : devices) {
      if (outputChannelCount(candidate) <= 0) continue;
      const std::string uid = deviceString(candidate, kAudioDevicePropertyDeviceUID);
      const std::string name = deviceString(candidate, kAudioObjectPropertyName);
      if (uid == requested || name == requested) {
        *out = candidate;
        return true;
      }
    }

    if (error) *error = "无法找到请求的 CoreAudio 输出设备：" + requested;
    return false;
  }

  void applyPreferredBufferSize() const {
    if (outputConfig.preferredBufferSize == 0 || deviceId == kAudioObjectUnknown) return;
    AudioObjectPropertyAddress address{
        kAudioDevicePropertyBufferFrameSize,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain};
    Boolean writable = false;
    if (AudioObjectIsPropertySettable(deviceId, &address, &writable) != noErr || writable == 0) return;
    UInt32 frames = outputConfig.preferredBufferSize;
    AudioObjectSetPropertyData(deviceId, &address, 0, nullptr, sizeof(frames), &frames);
  }

  static OSStatus renderThunk(
      void* userData,
      AudioUnitRenderActionFlags* flags,
      const AudioTimeStamp* timestamp,
      UInt32 bus,
      UInt32 frameCount,
      AudioBufferList* ioData) {
    (void)flags;
    (void)timestamp;
    (void)bus;
    auto* self = static_cast<Impl*>(userData);
    return self ? self->render(frameCount, ioData) : noErr;
  }

  OSStatus render(UInt32 frameCount, AudioBufferList* ioData) {
    if (!ioData || frameCount == 0) return noErr;

    RenderCallback renderCallback;
    int channels = 0;
    {
      std::lock_guard lock(mutex);
      renderCallback = callback;
      channels = std::max(1, outputFormat.channelCount);
    }

    const size_t frames = static_cast<size_t>(frameCount);
    const size_t samples = frames * static_cast<size_t>(channels);
    if (ioData->mNumberBuffers == 1) {
      auto* out = static_cast<float*>(ioData->mBuffers[0].mData);
      if (!out) return noErr;
      std::fill(out, out + samples, 0.0f);
      if (renderCallback) {
        const size_t rendered = std::min(renderCallback(out, frames), frames);
        if (rendered < frames) {
          std::fill(
              out + rendered * static_cast<size_t>(channels),
              out + samples,
              0.0f);
        }
      }
      ioData->mBuffers[0].mDataByteSize = static_cast<UInt32>(samples * sizeof(float));
      return noErr;
    }

    renderScratch.assign(samples, 0.0f);
    if (renderCallback) renderCallback(renderScratch.data(), frames);
    for (UInt32 buffer = 0; buffer < ioData->mNumberBuffers; ++buffer) {
      auto* out = static_cast<float*>(ioData->mBuffers[buffer].mData);
      if (!out) continue;
      const UInt32 bufferChannels = std::max<UInt32>(1, ioData->mBuffers[buffer].mNumberChannels);
      for (size_t frame = 0; frame < frames; ++frame) {
        for (UInt32 channel = 0; channel < bufferChannels; ++channel) {
          const size_t sourceChannel = std::min<size_t>(buffer + channel, static_cast<size_t>(channels - 1));
          out[frame * bufferChannels + channel] =
              renderScratch[frame * static_cast<size_t>(channels) + sourceChannel];
        }
      }
      ioData->mBuffers[buffer].mDataByteSize =
          static_cast<UInt32>(frames * static_cast<size_t>(bufferChannels) * sizeof(float));
    }
    return noErr;
  }
#endif

  void resetState() {
    outputFormat = {};
    outputInfo = {};
    dopRuntimeFacts = {};
    deviceName = "CoreAudio";
  }
};

CoreAudioBackend::CoreAudioBackend() : impl_(std::make_unique<Impl>()) {}

CoreAudioBackend::~CoreAudioBackend() {
  close();
}

const char* CoreAudioBackend::id() const {
  return "coreaudio";
}

bool CoreAudioBackend::open(const std::string& deviceId, const AudioFormat& requestedFormat, std::string* error) {
#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
  close();
  if (requestedFormat.sampleRate <= 0 || requestedFormat.channelCount <= 0) {
    if (error) *error = "请求的 CoreAudio 输出格式无效";
    return false;
  }

  AudioDeviceID selectedDevice = kAudioObjectUnknown;
  if (!Impl::findOutputDevice(deviceId, &selectedDevice, error)) return false;
  if (selectedDevice == kAudioObjectUnknown) {
    if (error) *error = "CoreAudio 默认输出设备不可用";
    return false;
  }

  const double deviceRate = Impl::nominalSampleRate(selectedDevice);
  const int deviceChannels = Impl::outputChannelCount(selectedDevice);
  const int channels = deviceChannels > 0 ? std::min(requestedFormat.channelCount, deviceChannels)
                                          : requestedFormat.channelCount;
  const int sampleRate = deviceRate > 0.0 ? static_cast<int>(deviceRate + 0.5) : requestedFormat.sampleRate;

  AudioComponentDescription description{};
  description.componentType = kAudioUnitType_Output;
  description.componentSubType = kAudioUnitSubType_HALOutput;
  description.componentManufacturer = kAudioUnitManufacturer_Apple;
  AudioComponent component = AudioComponentFindNext(nullptr, &description);
  if (!component) {
    if (error) *error = "无法找到 CoreAudio HAL Output AudioUnit";
    return false;
  }

  OSStatus status = AudioComponentInstanceNew(component, &impl_->unit);
  if (!Impl::ok(status, error, "无法创建 CoreAudio AudioUnit")) {
    close();
    return false;
  }

  UInt32 enable = 1;
  status = AudioUnitSetProperty(
      impl_->unit,
      kAudioOutputUnitProperty_EnableIO,
      kAudioUnitScope_Output,
      0,
      &enable,
      sizeof(enable));
  if (!Impl::ok(status, error, "无法启用 CoreAudio 输出总线")) {
    close();
    return false;
  }

  UInt32 disable = 0;
  AudioUnitSetProperty(
      impl_->unit,
      kAudioOutputUnitProperty_EnableIO,
      kAudioUnitScope_Input,
      1,
      &disable,
      sizeof(disable));

  status = AudioUnitSetProperty(
      impl_->unit,
      kAudioOutputUnitProperty_CurrentDevice,
      kAudioUnitScope_Global,
      0,
      &selectedDevice,
      sizeof(selectedDevice));
  if (!Impl::ok(status, error, "无法绑定 CoreAudio 输出设备")) {
    close();
    return false;
  }

  impl_->deviceId = selectedDevice;
  impl_->applyPreferredBufferSize();

  AudioStreamBasicDescription format{};
  format.mSampleRate = static_cast<Float64>(sampleRate);
  format.mFormatID = kAudioFormatLinearPCM;
  format.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked | kAudioFormatFlagsNativeEndian;
  format.mBytesPerPacket = static_cast<UInt32>(channels * sizeof(Float32));
  format.mFramesPerPacket = 1;
  format.mBytesPerFrame = static_cast<UInt32>(channels * sizeof(Float32));
  format.mChannelsPerFrame = static_cast<UInt32>(channels);
  format.mBitsPerChannel = 32;

  status = AudioUnitSetProperty(
      impl_->unit,
      kAudioUnitProperty_StreamFormat,
      kAudioUnitScope_Input,
      0,
      &format,
      sizeof(format));
  if (!Impl::ok(status, error, "无法设置 CoreAudio 渲染格式")) {
    close();
    return false;
  }

  AURenderCallbackStruct callback{};
  callback.inputProc = &Impl::renderThunk;
  callback.inputProcRefCon = impl_.get();
  status = AudioUnitSetProperty(
      impl_->unit,
      kAudioUnitProperty_SetRenderCallback,
      kAudioUnitScope_Input,
      0,
      &callback,
      sizeof(callback));
  if (!Impl::ok(status, error, "无法设置 CoreAudio 渲染回调")) {
    close();
    return false;
  }

  status = AudioUnitInitialize(impl_->unit);
  if (!Impl::ok(status, error, "无法初始化 CoreAudio AudioUnit")) {
    close();
    return false;
  }

  UInt32 actualSize = sizeof(format);
  if (AudioUnitGetProperty(
          impl_->unit,
          kAudioUnitProperty_StreamFormat,
          kAudioUnitScope_Input,
          0,
          &format,
          &actualSize) != noErr) {
    format.mSampleRate = static_cast<Float64>(sampleRate);
    format.mChannelsPerFrame = static_cast<UInt32>(channels);
  }

  const UInt32 bufferFrames = std::max<UInt32>(
      1,
      Impl::deviceUInt32(selectedDevice, kAudioDevicePropertyBufferFrameSize, kAudioDevicePropertyScopeOutput));
  const UInt32 deviceLatency =
      Impl::deviceUInt32(selectedDevice, kAudioDevicePropertyLatency, kAudioDevicePropertyScopeOutput);
  const UInt32 safetyOffset =
      Impl::deviceUInt32(selectedDevice, kAudioDevicePropertySafetyOffset, kAudioDevicePropertyScopeOutput);
  const double actualRate = format.mSampleRate > 0.0 ? format.mSampleRate : static_cast<double>(sampleRate);

  impl_->outputFormat.sampleRate = static_cast<int>(actualRate + 0.5);
  impl_->outputFormat.channelCount = static_cast<int>(std::max<UInt32>(1, format.mChannelsPerFrame));
  impl_->outputFormat.sampleFormat = Impl::sampleFormatFromStreamDescription(format);
  impl_->outputFormat.bitDepth = effectivePcmBitDepth(impl_->outputFormat);
  if (impl_->outputFormat.bitDepth <= 0) {
    impl_->outputFormat.bitDepth = static_cast<int>(format.mBitsPerChannel > 0 ? format.mBitsPerChannel : 32);
  }
  impl_->deviceName = Impl::deviceString(selectedDevice, kAudioObjectPropertyName);
  if (impl_->deviceName.empty()) impl_->deviceName = "CoreAudio Default Output";

  impl_->outputInfo = {};
  impl_->outputInfo.exclusive = false;
  impl_->outputInfo.accessMode = "shared";
  impl_->outputInfo.supportsOutputPerfect = false;
  impl_->outputInfo.sourceExact = false;
  impl_->outputInfo.outputPerfect = false;
  impl_->outputInfo.pcmPassthrough = false;
  impl_->outputInfo.resampled = requestedFormat.sampleRate != impl_->outputFormat.sampleRate ||
                                requestedFormat.channelCount != impl_->outputFormat.channelCount ||
                                effectivePcmBitDepth(requestedFormat) != effectivePcmBitDepth(impl_->outputFormat) ||
                                requestedFormat.sampleFormat != impl_->outputFormat.sampleFormat;
  impl_->outputInfo.outputSampleRate = impl_->outputFormat.sampleRate;
  impl_->outputInfo.outputBitDepth = impl_->outputFormat.bitDepth;
  impl_->outputInfo.backend = "coreaudio";
  impl_->outputInfo.actualBackend = "coreaudio";
  impl_->outputInfo.devicePathKind = "hal";
  impl_->outputInfo.deviceName = impl_->deviceName;
  impl_->outputInfo.actualDeviceName = impl_->deviceName;
  impl_->outputInfo.actualOutputFormat = sampleFormatToString(impl_->outputFormat.sampleFormat);
  impl_->outputInfo.actualSampleRate = impl_->outputFormat.sampleRate;
  impl_->outputInfo.actualBitDepth = impl_->outputFormat.bitDepth;
  impl_->outputInfo.actualChannels = impl_->outputFormat.channelCount;
  impl_->outputInfo.bufferSizeFrames = static_cast<int>(bufferFrames);
  impl_->outputInfo.latencyFrames = static_cast<int>(bufferFrames + deviceLatency + safetyOffset);
  impl_->outputInfo.latencyInfo.bufferLatencyMs =
      actualRate > 0.0 ? static_cast<double>(bufferFrames) * 1000.0 / actualRate : 0.0;
  impl_->outputInfo.latencyInfo.outputLatencyMs =
      actualRate > 0.0 ? static_cast<double>(deviceLatency + safetyOffset) * 1000.0 / actualRate : 0.0;
  impl_->outputInfo.latencyInfo.totalLatencyMs =
      impl_->outputInfo.latencyInfo.bufferLatencyMs + impl_->outputInfo.latencyInfo.outputLatencyMs;
  impl_->outputInfo.latencyMs = impl_->outputInfo.latencyInfo.totalLatencyMs;
  impl_->outputInfo.channelRoutingMode = channelRoutingModeToString(impl_->outputConfig.routingMode);
  impl_->outputInfo.perfectReasonCode = "shared_mixer";
  impl_->outputInfo.perfectReason = Impl::coreAudioReason(requestedFormat, impl_->outputFormat);
  impl_->outputInfo.capabilityReason = impl_->outputInfo.perfectReason;
  impl_->dopRuntimeFacts = unprovenDopRuntimeFacts(
      requestedFormat,
      impl_->outputFormat,
      "CoreAudio shared system path cannot prove DoP passthrough");
  return true;
#else
  (void)deviceId;
  (void)requestedFormat;
  if (error) *error = "当前构建未启用 CoreAudio 输出";
  return false;
#endif
}

bool CoreAudioBackend::setOutputConfig(const OutputConfig& config, std::string* error) {
  (void)error;
  std::lock_guard lock(impl_->mutex);
  impl_->outputConfig = config;
  impl_->outputInfo.channelRoutingMode = channelRoutingModeToString(impl_->outputConfig.routingMode);
  return true;
}

bool CoreAudioBackend::start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error) {
#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
  if (!impl_->unit) {
    if (error) *error = "CoreAudio 后端尚未打开";
    return false;
  }
  {
    std::lock_guard lock(impl_->mutex);
    impl_->callback = std::move(callback);
    impl_->eventCallback = std::move(eventCallback);
  }
  const OSStatus status = AudioOutputUnitStart(impl_->unit);
  if (!Impl::ok(status, error, "无法启动 CoreAudio 输出")) return false;
  impl_->running = true;
  return true;
#else
  (void)callback;
  (void)eventCallback;
  if (error) *error = "当前构建未启用 CoreAudio 输出";
  return false;
#endif
}

void CoreAudioBackend::stop() {
#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
  impl_->running = false;
  if (impl_->unit) AudioOutputUnitStop(impl_->unit);
#endif
}

void CoreAudioBackend::close() {
#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
  stop();
  if (impl_->unit) {
    AudioUnitUninitialize(impl_->unit);
    AudioComponentInstanceDispose(impl_->unit);
    impl_->unit = nullptr;
  }
  impl_->deviceId = kAudioObjectUnknown;
  std::lock_guard lock(impl_->mutex);
  impl_->callback = nullptr;
  impl_->eventCallback = nullptr;
  impl_->renderScratch.clear();
#endif
  impl_->resetState();
}

AudioFormat CoreAudioBackend::outputFormat() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->outputFormat;
}

OutputInfo CoreAudioBackend::outputInfo() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->outputInfo;
}

DopRuntimeFacts CoreAudioBackend::dopRuntimeFacts() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->dopRuntimeFacts;
}

NativeDsdRuntimeFacts CoreAudioBackend::nativeDsdRuntimeFacts() const {
  return unsupportedNativeDsdRuntimeFacts("CoreAudio Native DSD/Hog Mode is not implemented in this build");
}

std::string CoreAudioBackend::deviceName() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->deviceName;
}

bool coreAudioBackendAvailable() {
#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
  return true;
#else
  return false;
#endif
}

}  // namespace twilight::audio
