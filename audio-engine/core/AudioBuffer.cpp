#include "AudioBuffer.h"

#include <algorithm>
#include <cstring>

namespace twilight::audio {
namespace {

bool bufferFormatsCompatible(const AudioFormat& left, const AudioFormat& right) {
  const bool sampleRateCompatible = left.sampleRate <= 0 || right.sampleRate <= 0 || left.sampleRate == right.sampleRate;
  if (isDsdSampleFormat(left.sampleFormat) || isDsdSampleFormat(right.sampleFormat)) {
    return sampleRateCompatible && left.channelCount > 0 && right.channelCount > 0 &&
           left.channelCount == right.channelCount && dsdFormatsExactMatch(left, right);
  }
  return sampleRateCompatible && left.channelCount > 0 && right.channelCount > 0 &&
         left.channelCount == right.channelCount &&
         effectivePcmBitDepth(left) == effectivePcmBitDepth(right) &&
         left.sampleFormat == right.sampleFormat;
}

}  // namespace

void AudioBuffer::reset(int channels, size_t capacityFrames) {
  AudioFormat format;
  format.sampleRate = 0;
  format.channelCount = channels;
  format.bitDepth = 32;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;
  reset(format, capacityFrames);
}

void AudioBuffer::reset(const AudioFormat& format, size_t capacityFrames) {
  std::lock_guard lock(mutex_);
  format_ = format;
  format_.channelCount = std::max(1, format_.channelCount);
  if (format_.bitDepth <= 0) format_.bitDepth = effectivePcmBitDepth(format_);
  channels_ = format_.channelCount;
  capacityFrames_ = std::max<size_t>(1, capacityFrames);
  bytesPerFrame_ = audioFormatBytesPerFrame(format_);
  if (bytesPerFrame_ == 0) {
    format_.sampleFormat = AudioSampleFormat::Float32Interleaved;
    format_.bitDepth = 32;
    bytesPerFrame_ = sizeof(float) * static_cast<size_t>(channels_);
  }
  data_.assign(capacityFrames_ * bytesPerFrame_, 0);
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
    std::fill(data_.begin(), data_.end(), 0);
  }
  notFull_.notify_all();
}

void AudioBuffer::notifyAll() {
  notFull_.notify_all();
  notEmpty_.notify_all();
}

size_t AudioBuffer::writeBlocking(const float* data, size_t frames, const std::atomic<bool>& running) {
  if (!data || frames == 0) return 0;
  if (format_.sampleFormat != AudioSampleFormat::Float32Interleaved) return 0;
  PcmBlock block;
  block.format = format_;
  block.data = reinterpret_cast<uint8_t*>(const_cast<float*>(data));
  block.frames = frames;
  block.byteSize = frames * audioFormatBytesPerFrame(block.format);
  return writeBlocking(block, running);
}

size_t AudioBuffer::writeBlocking(const PcmBlock& block, const std::atomic<bool>& running) {
  if (!block.data || block.frames == 0) return 0;
  if (!bufferFormatsCompatible(block.format, format_)) return 0;
  const size_t sourceBytesPerFrame = audioFormatBytesPerFrame(block.format);
  if (sourceBytesPerFrame == 0) return 0;
  size_t written = 0;
  while (written < block.frames && running.load()) {
    std::unique_lock lock(mutex_);
    notFull_.wait(lock, [&] {
      return availableFrames_ < capacityFrames_ || !running.load();
    });
    if (!running.load()) break;

    const size_t writable = std::min(block.frames - written, contiguousWritableFramesLocked());
    if (writable == 0) continue;

    const size_t dstOffset = writeFrame_ * bytesPerFrame_;
    const size_t srcOffset = written * sourceBytesPerFrame;
    const size_t byteCount = writable * bytesPerFrame_;
    std::memcpy(data_.data() + dstOffset, block.data + srcOffset, byteCount);

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
  if (format_.sampleFormat != AudioSampleFormat::Float32Interleaved) return 0;
  PcmBlock block;
  block.format = format_;
  block.data = reinterpret_cast<uint8_t*>(data);
  block.frames = frames;
  block.byteSize = frames * audioFormatBytesPerFrame(block.format);
  return read(block);
}

size_t AudioBuffer::read(PcmBlock& block) {
  if (!block.data || block.frames == 0) return 0;
  if (block.byteSize > 0) std::memset(block.data, 0, block.byteSize);
  if (!bufferFormatsCompatible(block.format, format_)) return 0;
  const size_t targetBytesPerFrame = audioFormatBytesPerFrame(block.format);
  if (targetBytesPerFrame == 0) return 0;
  std::lock_guard lock(mutex_);
  if (availableFrames_ == 0 || capacityFrames_ == 0 || channels_ <= 0) return 0;

  size_t read = 0;
  while (read < block.frames && availableFrames_ > 0) {
    const size_t readable = std::min(block.frames - read, contiguousReadableFramesLocked());
    const size_t dstOffset = read * targetBytesPerFrame;
    const size_t srcOffset = readFrame_ * bytesPerFrame_;
    const size_t byteCount = readable * bytesPerFrame_;
    std::memcpy(block.data + dstOffset, data_.data() + srcOffset, byteCount);

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

AudioFormat AudioBuffer::format() const {
  std::lock_guard lock(mutex_);
  return format_;
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
