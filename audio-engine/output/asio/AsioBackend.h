#pragma once

#include "IAsioHost.h"
#include "../IOutputBackend.h"

#include <atomic>
#include <chrono>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace twilight::audio {

class AsioBackend final : public IOutputBackend {
 public:
  AsioBackend();
  explicit AsioBackend(std::unique_ptr<IAsioHost> host);
  ~AsioBackend() override;

  const char* id() const override;
  bool open(const std::string& deviceId, const AudioFormat& requestedFormat, std::string* error) override;
  bool setOutputConfig(const OutputConfig& config, std::string* error) override;
  bool start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error) override;
  void stop() override;
  void close() override;

  AudioFormat outputFormat() const override;
  OutputInfo outputInfo() const override;
  std::string deviceName() const override;

 private:
  struct FormatCandidate;

  bool chooseFormat(const AsioDeviceInfo& device, const AudioFormat& requestedFormat, AudioFormat* selected) const;
  long chooseBufferSize(const AsioDeviceInfo& device) const;
  int routedOutputChannels(const AsioDeviceInfo& device, int sourceChannels) const;
  void renderBuffer(long bufferIndex);
  bool recover(AsioHostEvent event, const std::string& message);
  bool createAndStartHost(std::string* error);

  std::unique_ptr<IAsioHost> host_;
  mutable std::mutex mutex_;
  RenderCallback callback_;
  OutputEventCallback eventCallback_;
  OutputConfig outputConfig_;
  AsioOpenConfig openConfig_;
  AsioDeviceInfo deviceInfo_;
  AudioFormat outputFormat_;
  OutputInfo outputInfo_;
  std::string deviceName_ = "ASIO";
  std::string driverName_;
  long driverVersion_ = 0;
  long bufferSizeFrames_ = 0;
  long latencyFrames_ = 0;
  OutputInfo::Diagnostics diagnostics_;
  int recoveryAttempts_ = 0;
  int recoveryCount_ = 0;
  std::deque<std::chrono::steady_clock::time_point> recoveryWindow_;
  std::chrono::steady_clock::time_point recoveryCooldownUntil_{};
  bool recoveryInProgress_ = false;
  bool deviceRecovered_ = false;
  bool opened_ = false;
  std::atomic<bool> running_{false};
  std::vector<float> renderScratch_;
};

bool asioBackendAvailable();

}  // namespace twilight::audio
