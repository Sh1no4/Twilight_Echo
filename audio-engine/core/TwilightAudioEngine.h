#pragma once

#include "AudioPipeline.h"
#include "twilight_audio_engine.h"

#include <atomic>
#include <chrono>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace twilight::audio {

enum class PlaybackState {
  Stopped,
  Playing,
  Paused
};

struct QueueItem {
  std::string id;
  std::string source;
  std::string title;
  double durationSeconds = 0.0;
};

struct PlaybackInfo {
  PlaybackState state = PlaybackState::Stopped;
  double positionSeconds = 0.0;
  double durationSeconds = 0.0;
  double volume = 1.0;
  int queueIndex = -1;
  std::string source;
  std::string codec = "未知";
  int bitrate = 0;
  int sourceSampleRate = 0;
  int sourceBitDepth = 0;
  std::string outputBackend = "wasapi";
  std::string outputDevice = "auto";
  OutputInfo outputInfo;
  int outputSampleRate = 0;
  int outputBitDepth = 0;
  int channelCount = 0;
  bool bitPerfect = true;
  bool dspActive = false;
  std::string resampleReason;
  std::string dsdMode = "unsupported";
};

class TwilightAudioEngine {
 public:
  TwilightAudioEngine();
  ~TwilightAudioEngine();

  TwilightAudioEngine(const TwilightAudioEngine&) = delete;
  TwilightAudioEngine& operator=(const TwilightAudioEngine&) = delete;

  void setEventCallback(TAE_EventCallback callback, void* userData);

  TAE_Result play(const std::string& source, double startTimeSeconds);
  TAE_Result pause();
  TAE_Result stop();
  TAE_Result seek(double positionSeconds);
  TAE_Result setVolume(double volume);
  TAE_Result setOutputDevice(const std::string& deviceId);
  TAE_Result setOutputBackend(const std::string& backendId);

  TAE_Result loadQueue(const std::string& queueJson, int startIndex);
  TAE_Result addToQueue(const std::string& itemJson);
  TAE_Result removeFromQueue(int index);
  TAE_Result next();
  TAE_Result previous();

  TAE_Result setDspConfig(const std::string& dspJson);
  std::string getDspConfig() const;
  std::string getQueueJson() const;
  std::string enumerateDevicesJson() const;
  std::string enumerateBackendsJson() const;
  std::string getPlaybackInfoJson() const;
  size_t getSpectrumData(float* buffer, size_t pointCount) const;

 private:
  void startClock();
  void stopClock();
  void clockLoop();
  void emit(const char* type, const std::string& payload) const;
  void emitError(const std::string& message) const;
  void publishStateLocked() const;
  void applyPipelineStatusLocked(const PipelineStatus& status);
  void updateBitPerfectLocked();
  QueueItem currentItemLocked() const;

  mutable std::mutex mutex_;
  PlaybackInfo info_;
  std::vector<QueueItem> queue_;
  std::string rawQueueJson_ = "[]";
  std::string dspConfigJson_ = "{}";
  std::unique_ptr<AudioPipeline> pipeline_;
  TAE_EventCallback eventCallback_ = nullptr;
  void* eventUserData_ = nullptr;
  std::atomic<bool> running_{true};
  std::thread clockThread_;
  std::chrono::steady_clock::time_point lastTick_;
};

}  // namespace twilight::audio
