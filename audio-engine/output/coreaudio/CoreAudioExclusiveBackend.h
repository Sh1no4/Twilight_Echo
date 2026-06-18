#pragma once

#include "ICoreAudioHost.h"
#include "../IOutputBackend.h"

#include <memory>
#include <string>

namespace twilight::audio {

class CoreAudioExclusiveBackend final : public IOutputBackend {
 public:
  CoreAudioExclusiveBackend();
  explicit CoreAudioExclusiveBackend(std::unique_ptr<ICoreAudioHost> host);
  ~CoreAudioExclusiveBackend() override;

  const char* id() const override;
  bool open(const std::string& deviceId, const AudioFormat& requestedFormat, std::string* error) override;
  bool setOutputConfig(const OutputConfig& config, std::string* error) override;
  bool start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error) override;
  bool startTyped(
      TypedRenderCallback callback,
      RenderCallback fallbackCallback,
      OutputEventCallback eventCallback,
      std::string* error) override;
  void stop() override;
  void close() override;

  AudioFormat outputFormat() const override;
  OutputInfo outputInfo() const override;
  DopRuntimeFacts dopRuntimeFacts() const override;
  NativeDsdRuntimeFacts nativeDsdRuntimeFacts() const override;
  std::string deviceName() const override;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;

  void releaseResources();
};

bool coreAudioExclusiveBackendAvailable();

}  // namespace twilight::audio
