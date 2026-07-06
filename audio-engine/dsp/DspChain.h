#pragma once

#include "ConvolverProcessor.h"
#include "CrossfeedProcessor.h"
#include "DspTypes.h"
#include "ParametricEqProcessor.h"
#include "ReplayGainProcessor.h"
#include "../plugins/PluginRegistry.h"

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace twilight::audio {

class DspChain {
 public:
  DspChain();

  void configure(const DspConfig& config);
  void configureFromJson(const std::string& json);
  void prepare(const AudioFormat& format);
  void setTrackContext(const DspTrackContext& context);
  void process(float* samples, size_t frameCount);
  void reset();
  DspStatus status();
  bool loadImpulseResponse(const std::string& path, std::string* error);
  void unloadImpulseResponse();
  ConvolverInfo convolverInfo() const;
  void setEqBands(const std::vector<DspEqBand>& bands, EqMode mode, double preampDb, bool enabled);
  bool setEqBandsFromJson(const std::string& json, std::string* error);
  bool setEqPresetFromJson(const std::string& json, std::string* error);
  void setCrossfeedStrength(double strength);
  void setReplayGainMode(ReplayGainMode mode, double preampDb, double fallbackDb, bool clip);
  void setNativeDspPluginChain(const std::string& json);
  std::string nativeDspPluginStatusJson() const;

  static DspConfig parseConfigJson(const std::string& json);
  static std::vector<DspEqBand> parseEqBandsJson(const std::string& json, EqMode mode);

#ifdef TAE_DSP_CHAIN_TESTS
  std::unique_lock<std::mutex> holdProcessLockForTests() { return std::unique_lock<std::mutex>(mutex_); }
#endif

 private:
  void refreshStatusLocked();
  void clampOutput(float* samples, size_t frameCount);

  mutable std::mutex mutex_;
  DspConfig config_;
  AudioFormat format_;
  DspTrackContext trackContext_;
  DspStatus status_;
  std::atomic<bool> processingRequired_{false};
  ReplayGainProcessor* replayGain_ = nullptr;
  ParametricEqProcessor* eq_ = nullptr;
  ConvolverProcessor* convolver_ = nullptr;
  CrossfeedProcessor* crossfeed_ = nullptr;
  PluginRegistry* nativePlugins_ = nullptr;
  std::vector<std::unique_ptr<IAudioProcessor>> processors_;
  std::vector<IAudioProcessor*> activeProcessors_;
};

bool dspConfigRequiresProcessing(const std::string& json);

}  // namespace twilight::audio
