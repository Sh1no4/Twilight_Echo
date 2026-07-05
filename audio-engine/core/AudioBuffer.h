#pragma once

#include "AudioTypes.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <vector>

namespace twilight::audio {

class AudioBuffer {
 public:
  AudioBuffer() = default;

  void reset(int channels, size_t capacityFrames);
  void reset(const AudioFormat& format, size_t capacityFrames);
  void clear();
  void notifyAll();

  size_t writeBlocking(const float* data, size_t frames, const std::atomic<bool>& running);
  size_t writeBlocking(const PcmBlock& block, const std::atomic<bool>& running);
  size_t read(float* data, size_t frames);
  size_t read(PcmBlock& block);
  size_t waitForAvailableFrames(
      size_t targetFrames,
      std::chrono::milliseconds timeout,
      const std::atomic<bool>& running,
      const std::atomic<bool>& eof) const;

  size_t availableFrames() const;
  size_t freeFrames() const;
  int channels() const;
  AudioFormat format() const;

 private:
  size_t readLocked(PcmBlock& block, size_t targetBytesPerFrame);
  size_t contiguousWritableFramesLocked() const;
  size_t contiguousReadableFramesLocked() const;

  mutable std::mutex mutex_;
  mutable std::condition_variable notFull_;
  mutable std::condition_variable notEmpty_;
  std::vector<uint8_t> data_;
  AudioFormat format_;
  size_t bytesPerFrame_ = 0;
  size_t capacityFrames_ = 0;
  size_t readFrame_ = 0;
  size_t writeFrame_ = 0;
  size_t availableFrames_ = 0;
  int channels_ = 0;
  std::atomic<int> sampleRateSnapshot_{0};
  std::atomic<int> channelSnapshot_{1};
  std::atomic<int> bitDepthSnapshot_{32};
  std::atomic<int> sampleFormatSnapshot_{static_cast<int>(AudioSampleFormat::Float32Interleaved)};
  std::atomic<size_t> availableFramesSnapshot_{0};
};

}  // namespace twilight::audio
