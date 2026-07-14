#pragma once

#include "IAudioProcessor.h"

#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace twilight::audio {

class ConvolverProcessor final : public IAudioProcessor {
 public:
  ConvolverProcessor();
  ~ConvolverProcessor() override;

  void configure(const DspConfig& config) override;
  void prepare(const AudioFormat& format) override;
  void setTrackContext(const DspTrackContext& context) override;
  void process(float* samples, size_t frameCount) override;
  void reset() override;
  bool isActive() const override;

  bool loadImpulseResponse(const std::string& path, std::string* error);
  void unloadImpulseResponse();
  ConvolverInfo info() const;

 private:
  struct IrData {
    int sampleRate = 0;
    int channels = 0;
    uint64_t frames = 0;
    std::vector<std::vector<float>> samples;
  };

  struct FftChannel;

  static bool readImpulse(const std::string& path, IrData* out, std::string* error);
  static bool readWaveImpulse(const std::string& path, IrData* out, std::string* error);
  static bool readFfmpegImpulse(const std::string& path, IrData* out, std::string* error);
  static IrData resampleIr(const IrData& source, int targetSampleRate);

  void rebuild();
  bool prepareRuntimeIr(std::string* error);
  void bypassRealtime();
  uint32_t choosePartitionSize(const IrData& ir) const;
  std::vector<float> impulseForOutputChannel(const IrData& ir, int outputChannel) const;
  void updateInfoFromRuntime(const IrData& ir, bool resampled);

  DspConfig config_;
  AudioFormat format_;
  std::optional<IrData> originalIr_;
  std::unordered_map<int, IrData> irCache_;
  std::vector<std::unique_ptr<FftChannel>> channels_;
  std::array<float, 8> routedInput_{};
  std::array<float, 8> wetOutput_{};
  std::vector<float> wetDelayBuffer_;
  double wetGain_ = 1.0;
  size_t wetDelayFrames_ = 0;
  size_t wetDelayWriteFrame_ = 0;
  ConvolverInfo info_;
  uint64_t consecutiveOverruns_ = 0;
  bool active_ = false;
};

}  // namespace twilight::audio
