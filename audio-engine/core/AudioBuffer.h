#pragma once

#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <mutex>
#include <vector>

namespace twilight::audio {

class AudioBuffer {
 public:
  AudioBuffer() = default;

  void reset(int channels, size_t capacityFrames);
  void clear();
  void notifyAll();

  size_t writeBlocking(const float* data, size_t frames, const std::atomic<bool>& running);
  size_t read(float* data, size_t frames);

  size_t availableFrames() const;
  size_t freeFrames() const;
  int channels() const;

 private:
  size_t contiguousWritableFramesLocked() const;
  size_t contiguousReadableFramesLocked() const;

  mutable std::mutex mutex_;
  std::condition_variable notFull_;
  std::condition_variable notEmpty_;
  std::vector<float> data_;
  size_t capacityFrames_ = 0;
  size_t readFrame_ = 0;
  size_t writeFrame_ = 0;
  size_t availableFrames_ = 0;
  int channels_ = 0;
};

}  // namespace twilight::audio
