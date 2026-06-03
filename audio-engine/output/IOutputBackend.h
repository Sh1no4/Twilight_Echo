#pragma once

#include "../core/AudioTypes.h"

#include <cstddef>
#include <functional>
#include <memory>
#include <string>

namespace twilight::audio {

using RenderCallback = std::function<size_t(float* interleaved, size_t frameCount)>;

enum class OutputBackendEvent {
  DeviceInvalidated,
  RenderError
};

using OutputEventCallback = std::function<void(OutputBackendEvent event, const std::string& message)>;

enum class DopRuntimeFactState {
  Unsupported,
  Candidate,
  Unproven,
  Mismatch,
  Proven
};

struct DopRuntimeFacts {
  DopRuntimeFactState state = DopRuntimeFactState::Unsupported;
  AudioFormat candidateFormat;
  AudioFormat actualFormat;
  bool explicitlyCapable = false;
  std::string reason;
};

inline bool hasConcreteAudioFormat(const AudioFormat& format) {
  return format.sampleRate > 0 && format.channelCount > 0 && effectivePcmBitDepth(format) > 0;
}

inline bool isDopCarrierSampleFormat(AudioSampleFormat format) {
  return format == AudioSampleFormat::Int24Interleaved || format == AudioSampleFormat::Int24In32Interleaved;
}

inline bool isDopCarrierFormat(const AudioFormat& format) {
  return format.sampleRate > 0 && format.channelCount > 0 && (format.sampleRate == 176400 || format.sampleRate == 352800) &&
         effectivePcmBitDepth(format) == 24 && isDopCarrierSampleFormat(format.sampleFormat);
}

class IOutputBackend {
 public:
  virtual ~IOutputBackend() = default;

  virtual const char* id() const = 0;
  virtual bool open(const std::string& deviceId, const AudioFormat& requestedFormat, std::string* error) = 0;
  virtual bool setOutputConfig(const OutputConfig& config, std::string* error) = 0;
  virtual bool start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error) = 0;
  virtual void stop() = 0;
  virtual void close() = 0;

  virtual AudioFormat outputFormat() const = 0;
  virtual OutputInfo outputInfo() const = 0;
  virtual DopRuntimeFacts dopRuntimeFacts() const = 0;
  virtual std::string deviceName() const = 0;
};

std::string defaultBackendId();
std::unique_ptr<IOutputBackend> createOutputBackend(const std::string& backendId);

}  // namespace twilight::audio
