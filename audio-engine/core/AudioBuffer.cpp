#include "AudioBuffer.h"

#include <algorithm>
#include <cstring>

namespace twilight::audio {

void AudioBuffer::reset(int channels, size_t capacityFrames) {
  std::lock_guard lock(mutex_);
  channels_ = std::max(1, channels);
  capacityFrames_ = std::max<size_t>(1, capacityFrames);
  data_.assign(capacityFrames_ * static_cast<size_t>(channels_), 0.0f);
  readFrame_ = 0;
  writeFrame_ = 0;
  availableFrames_ = 0;
  notFull_.notify_all();
  notEmpty_.notify_all();
}

void AudioBuffer::clear() {
  std::lock_guard lock(mutex_);
  readFrame_ = 0;
  writeFrame_ = 0;
  availableFrames_ = 0;
  if (!data_.empty()) {
    std::fill(data_.begin(), data_.end(), 0.0f);
  }
  notFull_.notify_all();
}

void AudioBuffer::notifyAll() {
  notFull_.notify_all();
  notEmpty_.notify_all();
}

size_t AudioBuffer::writeBlocking(const float* data, size_t frames, const std::atomic<bool>& running) {
  if (!data || frames == 0) return 0;

  size_t written = 0;
  while (written < frames && running.load()) {
    std::unique_lock lock(mutex_);
    notFull_.wait(lock, [&] {
      return availableFrames_ < capacityFrames_ || !running.load();
    });
    if (!running.load()) break;

    const size_t writable = std::min(frames - written, contiguousWritableFramesLocked());
    if (writable == 0) continue;

    const size_t dstOffset = writeFrame_ * static_cast<size_t>(channels_);
    const size_t srcOffset = written * static_cast<size_t>(channels_);
    const size_t sampleCount = writable * static_cast<size_t>(channels_);
    std::memcpy(data_.data() + dstOffset, data + srcOffset, sampleCount * sizeof(float));

    writeFrame_ = (writeFrame_ + writable) % capacityFrames_;
    availableFrames_ += writable;
    written += writable;
    lock.unlock();
    notEmpty_.notify_one();
  }
  return written;
}

size_t AudioBuffer::read(float* data, size_t frames) {
  if (!data || frames == 0) return 0;
  std::fill(data, data + frames * static_cast<size_t>(std::max(1, channels_)), 0.0f);

  std::lock_guard lock(mutex_);
  if (availableFrames_ == 0 || capacityFrames_ == 0 || channels_ <= 0) return 0;

  size_t read = 0;
  while (read < frames && availableFrames_ > 0) {
    const size_t readable = std::min(frames - read, contiguousReadableFramesLocked());
    const size_t dstOffset = read * static_cast<size_t>(channels_);
    const size_t srcOffset = readFrame_ * static_cast<size_t>(channels_);
    const size_t sampleCount = readable * static_cast<size_t>(channels_);
    std::memcpy(data + dstOffset, data_.data() + srcOffset, sampleCount * sizeof(float));

    readFrame_ = (readFrame_ + readable) % capacityFrames_;
    availableFrames_ -= readable;
    read += readable;
  }
  notFull_.notify_one();
  return read;
}

size_t AudioBuffer::availableFrames() const {
  std::lock_guard lock(mutex_);
  return availableFrames_;
}

size_t AudioBuffer::freeFrames() const {
  std::lock_guard lock(mutex_);
  return capacityFrames_ - availableFrames_;
}

int AudioBuffer::channels() const {
  std::lock_guard lock(mutex_);
  return channels_;
}

size_t AudioBuffer::contiguousWritableFramesLocked() const {
  if (availableFrames_ >= capacityFrames_) return 0;
  const size_t free = capacityFrames_ - availableFrames_;
  const size_t untilEnd = capacityFrames_ - writeFrame_;
  return std::min(free, untilEnd);
}

size_t AudioBuffer::contiguousReadableFramesLocked() const {
  if (availableFrames_ == 0) return 0;
  const size_t untilEnd = capacityFrames_ - readFrame_;
  return std::min(availableFrames_, untilEnd);
}

}  // namespace twilight::audio
