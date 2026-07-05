#include "RealCoreAudioHost.h"

#include "CoreAudioCommon.h"

#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)

#include <AudioToolbox/AudioToolbox.h>
#include <AudioUnit/AudioUnit.h>
#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>

#include <algorithm>
#include <cstring>
#include <mutex>
#include <utility>

namespace twilight::audio {

namespace {

constexpr size_t kMaxCoreAudioCallbackBuffers = 32;

CoreAudioStreamBasicDescription toHostDescription(const AudioStreamBasicDescription& format) {
  CoreAudioStreamBasicDescription out;
  out.sampleRate = format.mSampleRate;
  out.formatID = format.mFormatID;
  out.formatFlags = format.mFormatFlags;
  out.bytesPerPacket = format.mBytesPerPacket;
  out.framesPerPacket = format.mFramesPerPacket;
  out.bytesPerFrame = format.mBytesPerFrame;
  out.channelsPerFrame = format.mChannelsPerFrame;
  out.bitsPerChannel = format.mBitsPerChannel;
  return out;
}

AudioStreamBasicDescription toNativeDescription(const CoreAudioStreamBasicDescription& format) {
  AudioStreamBasicDescription out{};
  out.mSampleRate = format.sampleRate;
  out.mFormatID = format.formatID;
  out.mFormatFlags = format.formatFlags;
  out.mBytesPerPacket = format.bytesPerPacket;
  out.mFramesPerPacket = format.framesPerPacket;
  out.mBytesPerFrame = format.bytesPerFrame;
  out.mChannelsPerFrame = format.channelsPerFrame;
  out.mBitsPerChannel = format.bitsPerChannel;
  return out;
}

bool bindHostBufferList(AudioBufferList* ioData, CoreAudioBufferList* out) {
  if (!ioData || !out || ioData->mNumberBuffers > out->buffers.size()) return false;
  out->setActiveBufferCount(ioData->mNumberBuffers);
  for (UInt32 index = 0; index < ioData->mNumberBuffers; ++index) {
    auto& buffer = out->bufferAt(static_cast<size_t>(index));
    buffer.numberChannels = ioData->mBuffers[index].mNumberChannels;
    buffer.dataByteSize = ioData->mBuffers[index].mDataByteSize;
    buffer.bindExternal(
        static_cast<uint8_t*>(ioData->mBuffers[index].mData),
        ioData->mBuffers[index].mDataByteSize);
  }
  return true;
}

void publishHostBufferSizes(AudioBufferList* ioData, const CoreAudioBufferList& hostList) {
  if (!ioData) return;
  const UInt32 buffers = std::min<UInt32>(ioData->mNumberBuffers, static_cast<UInt32>(hostList.bufferCount()));
  for (UInt32 index = 0; index < buffers; ++index) {
    const auto& buffer = hostList.bufferAt(static_cast<size_t>(index));
    ioData->mBuffers[index].mNumberChannels = buffer.numberChannels;
    ioData->mBuffers[index].mDataByteSize = buffer.dataByteSize;
  }
}

void silenceNative(AudioBufferList* ioData) {
  if (!ioData) return;
  for (UInt32 index = 0; index < ioData->mNumberBuffers; ++index) {
    if (ioData->mBuffers[index].mData && ioData->mBuffers[index].mDataByteSize > 0) {
      std::memset(ioData->mBuffers[index].mData, 0, ioData->mBuffers[index].mDataByteSize);
    }
  }
}

}  // namespace

struct RealCoreAudioHost::Impl {
  Impl() {
    callbackBufferList.buffers.resize(kMaxCoreAudioCallbackBuffers);
    callbackBufferList.setActiveBufferCount(0);
  }

  CoreAudioRenderCallback renderCallback;
  CoreAudioBufferList callbackBufferList;
};

RealCoreAudioHost::RealCoreAudioHost() : impl_(std::make_unique<Impl>()) {}

RealCoreAudioHost::~RealCoreAudioHost() = default;

bool RealCoreAudioHost::findOutputDevice(const std::string& requestedDeviceId, CoreAudioDeviceID* outDeviceId, std::string* error) {
  AudioDeviceID deviceId = kAudioObjectUnknown;
  const bool ok = coreaudio::findOutputDevice(requestedDeviceId, &deviceId, error);
  if (ok && outDeviceId) *outDeviceId = deviceId;
  return ok;
}

std::string RealCoreAudioHost::deviceName(CoreAudioDeviceID deviceId) {
  return coreaudio::deviceString(deviceId, kAudioObjectPropertyName);
}

int RealCoreAudioHost::outputChannelCount(CoreAudioDeviceID deviceId) {
  return coreaudio::outputChannelCount(deviceId);
}

double RealCoreAudioHost::getNominalSampleRate(CoreAudioDeviceID deviceId) {
  return coreaudio::nominalSampleRate(deviceId);
}

bool RealCoreAudioHost::setNominalSampleRate(CoreAudioDeviceID deviceId, double rate, std::string* error) {
  return coreaudio::setNominalSampleRate(deviceId, rate, error);
}

bool RealCoreAudioHost::supportsNominalSampleRate(CoreAudioDeviceID deviceId, double rate) {
  return coreaudio::supportsNominalSampleRate(deviceId, rate);
}

std::vector<double> RealCoreAudioHost::availableNominalSampleRates(CoreAudioDeviceID deviceId) {
  return coreaudio::availableNominalSampleRates(deviceId);
}

bool RealCoreAudioHost::deviceOutputStreamFormat(
    CoreAudioDeviceID deviceId,
    CoreAudioStreamBasicDescription* out,
    std::string* error) {
  if (!out) return false;
  AudioStreamBasicDescription native{};
  if (!coreaudio::deviceOutputStreamFormat(deviceId, &native, error)) return false;
  *out = toHostDescription(native);
  return true;
}

bool RealCoreAudioHost::hogModeOwnerPid(CoreAudioDeviceID deviceId, int32_t* ownerPid, std::string* error) {
  AudioObjectPropertyAddress address{
      kAudioDevicePropertyHogMode,
      kAudioDevicePropertyScopeOutput,
      kAudioObjectPropertyElementMain};
  pid_t currentOwner = -1;
  UInt32 size = sizeof(currentOwner);
  const OSStatus status = AudioObjectGetPropertyData(deviceId, &address, 0, nullptr, &size, &currentOwner);
  if (ownerPid) *ownerPid = status == noErr ? static_cast<int32_t>(currentOwner) : -1;
  if (status != noErr && status != kAudioHardwareUnknownPropertyError) {
    return coreaudio::ok(status, error, "无法读取 CoreAudio Hog Mode 现有拥有者");
  }
  if (error) error->clear();
  return true;
}

bool RealCoreAudioHost::acquireHogMode(CoreAudioDeviceID deviceId, int32_t* existingOwnerPid, std::string* error) {
  if (existingOwnerPid) *existingOwnerPid = -1;
  AudioObjectPropertyAddress address{
      kAudioDevicePropertyHogMode,
      kAudioDevicePropertyScopeOutput,
      kAudioObjectPropertyElementMain};
  pid_t currentOwner = -1;
  UInt32 size = sizeof(currentOwner);
  OSStatus status = AudioObjectGetPropertyData(deviceId, &address, 0, nullptr, &size, &currentOwner);
  if (existingOwnerPid) *existingOwnerPid = status == noErr ? static_cast<int32_t>(currentOwner) : -1;
  if (status != noErr && status != kAudioHardwareUnknownPropertyError) {
    return coreaudio::ok(status, error, "无法读取 CoreAudio Hog Mode 现有拥有者");
  }
  pid_t pid = getpid();
  status = AudioObjectSetPropertyData(deviceId, &address, 0, nullptr, sizeof(pid), &pid);
  if (status == kAudioHardwareUnknownPropertyError) {
    if (error) *error = "设备不支持 Hog Mode";
    return false;
  }
  return coreaudio::ok(status, error, "无法获取 CoreAudio Hog Mode");
}

void RealCoreAudioHost::releaseHogMode(CoreAudioDeviceID deviceId) {
  coreaudio::releaseHogMode(deviceId);
}

bool RealCoreAudioHost::findHalOutputUnit(std::string* error) {
  AudioComponentDescription description{};
  description.componentType = kAudioUnitType_Output;
  description.componentSubType = kAudioUnitSubType_HALOutput;
  description.componentManufacturer = kAudioUnitManufacturer_Apple;
  AudioComponent component = AudioComponentFindNext(nullptr, &description);
  if (!component) {
    if (error) *error = "无法找到 CoreAudio HAL Output AudioUnit";
    return false;
  }
  return true;
}

bool RealCoreAudioHost::newAudioUnit(CoreAudioAudioUnit* outUnit, std::string* error) {
  AudioComponentDescription description{};
  description.componentType = kAudioUnitType_Output;
  description.componentSubType = kAudioUnitSubType_HALOutput;
  description.componentManufacturer = kAudioUnitManufacturer_Apple;
  AudioComponent component = AudioComponentFindNext(nullptr, &description);
  if (!component) {
    if (error) *error = "无法找到 CoreAudio HAL Output AudioUnit";
    return false;
  }
  AudioUnit unit = nullptr;
  const OSStatus status = AudioComponentInstanceNew(component, &unit);
  if (!coreaudio::ok(status, error, "无法创建 CoreAudio AudioUnit")) return false;
  if (outUnit) *outUnit = reinterpret_cast<CoreAudioAudioUnit>(unit);
  return true;
}

bool RealCoreAudioHost::enableIOBus(CoreAudioAudioUnit unit, bool input, bool enable, std::string* error) {
  UInt32 value = enable ? 1 : 0;
  const OSStatus status = AudioUnitSetProperty(
      reinterpret_cast<AudioUnit>(unit),
      kAudioOutputUnitProperty_EnableIO,
      input ? kAudioUnitScope_Input : kAudioUnitScope_Output,
      input ? 1 : 0,
      &value,
      sizeof(value));
  return coreaudio::ok(status, error, input ? "无法启用 CoreAudio 输入总线" : "无法启用 CoreAudio 输出总线");
}

bool RealCoreAudioHost::bindDevice(CoreAudioAudioUnit unit, CoreAudioDeviceID deviceId, std::string* error) {
  const OSStatus status = AudioUnitSetProperty(
      reinterpret_cast<AudioUnit>(unit),
      kAudioOutputUnitProperty_CurrentDevice,
      kAudioUnitScope_Global,
      0,
      &deviceId,
      sizeof(deviceId));
  return coreaudio::ok(status, error, "无法绑定 CoreAudio 输出设备");
}

bool RealCoreAudioHost::applyBufferSize(CoreAudioDeviceID deviceId, uint32_t preferredBufferSize, std::string* error) {
  (void)error;
  coreaudio::applyBufferSize(deviceId, preferredBufferSize);
  return true;
}

bool RealCoreAudioHost::setStreamFormat(
    CoreAudioAudioUnit unit,
    bool input,
    const CoreAudioStreamBasicDescription& format,
    std::string* error) {
  AudioStreamBasicDescription native = toNativeDescription(format);
  const OSStatus status = AudioUnitSetProperty(
      reinterpret_cast<AudioUnit>(unit),
      kAudioUnitProperty_StreamFormat,
      input ? kAudioUnitScope_Input : kAudioUnitScope_Output,
      input ? 0 : 1,
      &native,
      sizeof(native));
  return coreaudio::ok(status, error, input ? "无法设置 CoreAudio 输入流格式" : "无法设置 CoreAudio 输出流格式");
}

bool RealCoreAudioHost::setRenderCallback(CoreAudioAudioUnit unit, CoreAudioRenderCallback callback, std::string* error) {
  impl_->renderCallback = std::move(callback);
  AURenderCallbackStruct renderCallback{};
  renderCallback.inputProc = [](void* userData, AudioUnitRenderActionFlags*, const AudioTimeStamp*, UInt32, UInt32 frameCount, AudioBufferList* ioData) -> OSStatus {
    auto* self = static_cast<RealCoreAudioHost*>(userData);
    if (!self || !self->impl_->renderCallback) return noErr;
    CoreAudioBufferList& hostList = self->impl_->callbackBufferList;
    if (!bindHostBufferList(ioData, &hostList)) {
      silenceNative(ioData);
      return noErr;
    }
    const size_t rendered = self->impl_->renderCallback(frameCount, hostList);
    publishHostBufferSizes(ioData, hostList);
    return rendered <= frameCount ? noErr : noErr;
  };
  renderCallback.inputProcRefCon = this;
  const OSStatus status = AudioUnitSetProperty(
      reinterpret_cast<AudioUnit>(unit),
      kAudioUnitProperty_SetRenderCallback,
      kAudioUnitScope_Input,
      0,
      &renderCallback,
      sizeof(renderCallback));
  return coreaudio::ok(status, error, "无法设置 CoreAudio 渲染回调");
}

bool RealCoreAudioHost::audioUnitInitialize(CoreAudioAudioUnit unit, std::string* error) {
  return coreaudio::ok(AudioUnitInitialize(reinterpret_cast<AudioUnit>(unit)), error, "无法初始化 CoreAudio AudioUnit");
}

bool RealCoreAudioHost::audioUnitStart(CoreAudioAudioUnit unit, std::string* error) {
  return coreaudio::ok(AudioOutputUnitStart(reinterpret_cast<AudioUnit>(unit)), error, "无法启动 CoreAudio 输出");
}

void RealCoreAudioHost::audioUnitStop(CoreAudioAudioUnit unit) {
  AudioOutputUnitStop(reinterpret_cast<AudioUnit>(unit));
}

void RealCoreAudioHost::audioUnitUninitialize(CoreAudioAudioUnit unit) {
  AudioUnitUninitialize(reinterpret_cast<AudioUnit>(unit));
}

void RealCoreAudioHost::disposeAudioUnit(CoreAudioAudioUnit unit) {
  AudioComponentInstanceDispose(reinterpret_cast<AudioUnit>(unit));
}

CoreAudioListenerToken RealCoreAudioHost::addDeviceLostListener(
    CoreAudioDeviceID deviceId,
    CoreAudioDeviceLostCallback callback,
    std::string* error) {
  (void)callback;
  (void)error;
  return static_cast<CoreAudioListenerToken>(deviceId);
}

void RealCoreAudioHost::removeDeviceLostListener(CoreAudioDeviceID deviceId, CoreAudioListenerToken token) {
  (void)deviceId;
  (void)token;
}

std::unique_ptr<ICoreAudioHost> createRealCoreAudioHost() {
  return std::make_unique<RealCoreAudioHost>();
}

}  // namespace twilight::audio

#endif
