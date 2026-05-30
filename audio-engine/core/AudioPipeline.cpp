#include "AudioPipeline.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <vector>

namespace twilight::audio {
namespace {

constexpr size_t kDecodeChunkFrames = 2048;

bool samePcmFormat(const AudioFormat& a, const AudioFormat& b) {
  return a.sampleRate == b.sampleRate &&
         a.channelCount == b.channelCount &&
         a.bitDepth == b.bitDepth &&
         a.sampleFormat == b.sampleFormat;
}

}  // namespace

AudioPipeline::AudioPipeline() = default;

AudioPipeline::~AudioPipeline() {
  stop();
}

TAE_Result AudioPipeline::play(
    const std::string& source,
    double startTimeSeconds,
    const std::string& backendId,
    const std::string& deviceId,
    double volume,
    bool dspActive,
    std::string* error) {
  stop();

  auto decoder = std::make_unique<FFmpegDecoder>();
  if (!decoder->open(source, error)) {
    return TAE_RESULT_BACKEND_UNAVAILABLE;
  }

  auto output = createOutputBackend(backendId);
  if (!output) {
    if (error) *error = "Requested audio output backend is not available: " + backendId;
    return TAE_RESULT_BACKEND_UNAVAILABLE;
  }

  const AudioFormat sourceFormat = decoder->streamInfo().sourceFormat;
  if (!output->open(deviceId, sourceFormat, error)) {
    return TAE_RESULT_BACKEND_UNAVAILABLE;
  }

  const AudioFormat outputFormat = output->outputFormat();
  if (!decoder->setOutputFormat(outputFormat, error)) {
    output->close();
    return TAE_RESULT_INTERNAL_ERROR;
  }

  if (startTimeSeconds > 0.0 && !decoder->seek(startTimeSeconds, error)) {
    output->close();
    return TAE_RESULT_INTERNAL_ERROR;
  }

  {
    std::lock_guard lock(mutex_);
    decoder_ = std::move(decoder);
    output_ = std::move(output);
    stream_ = decoder_->streamInfo();
    outputFormat_ = outputFormat;
    backendId_ = backendId == "wasapi-shared" ? "wasapi" : backendId;
    deviceName_ = output_->deviceName();
    baseDspActive_ = dspActive;
    dspActive_ = baseDspActive_ || std::abs(volume - 1.0) > 0.0001;
    const bool sharedWasapi = backendId_ == "wasapi";
    bitPerfect_ = !dspActive_ && !sharedWasapi && samePcmFormat(stream_.sourceFormat, outputFormat_);
    resampleReason_ = samePcmFormat(stream_.sourceFormat, outputFormat_)
                          ? ""
                          : sharedWasapi ? "shared-output-mix-format" : "output-format-conversion";
    state_ = PipelineState::Playing;
    renderedFrames_ = static_cast<uint64_t>(std::max(0.0, startTimeSeconds) * outputFormat_.sampleRate);
    decodeEof_ = false;
    ended_ = false;
    volume_ = std::clamp(volume, 0.0, 1.0);
    buffer_.reset(outputFormat_.channelCount, static_cast<size_t>(std::max(outputFormat_.sampleRate * 2, 8192)));
  }

  startDecodeThread();

  if (!output_->start([this](float* data, size_t frames) { return render(data, frames); }, error)) {
    stop();
    return TAE_RESULT_BACKEND_UNAVAILABLE;
  }

  return TAE_RESULT_OK;
}

TAE_Result AudioPipeline::togglePause() {
  std::lock_guard lock(mutex_);
  if (state_ == PipelineState::Playing) {
    state_ = PipelineState::Paused;
  } else if (state_ == PipelineState::Paused) {
    state_ = PipelineState::Playing;
  }
  return TAE_RESULT_OK;
}

TAE_Result AudioPipeline::stop() {
  std::unique_ptr<IOutputBackend> output;
  {
    std::lock_guard lock(mutex_);
    state_ = PipelineState::Stopped;
    output = std::move(output_);
  }

  if (output) {
    output->stop();
    output->close();
  }

  stopDecodeThread();

  {
    std::lock_guard lock(mutex_);
    decoder_.reset();
    stream_ = {};
    outputFormat_ = {};
    backendId_.clear();
    deviceName_.clear();
    resampleReason_.clear();
    renderedFrames_ = 0;
    decodeEof_ = false;
    ended_ = false;
    baseDspActive_ = false;
    dspActive_ = false;
    bitPerfect_ = false;
    buffer_.clear();
  }
  return TAE_RESULT_OK;
}

TAE_Result AudioPipeline::seek(double seconds, std::string* error) {
  {
    std::lock_guard lock(mutex_);
    if (!decoder_ || outputFormat_.sampleRate <= 0) return TAE_RESULT_NOT_INITIALIZED;
  }
  stopDecodeThread();

  {
    std::lock_guard lock(mutex_);
    if (!decoder_->seek(std::max(0.0, seconds), error)) {
      startDecodeThread();
      return TAE_RESULT_INTERNAL_ERROR;
    }
    buffer_.clear();
    renderedFrames_ = static_cast<uint64_t>(std::max(0.0, seconds) * outputFormat_.sampleRate);
    decodeEof_ = false;
    ended_ = false;
  }

  startDecodeThread();
  return TAE_RESULT_OK;
}

void AudioPipeline::setVolume(double volume) {
  volume_ = std::clamp(volume, 0.0, 1.0);
  std::lock_guard lock(mutex_);
  dspActive_ = baseDspActive_ || std::abs(volume_.load() - 1.0) > 0.0001;
  const bool sharedWasapi = backendId_ == "wasapi";
  bitPerfect_ = !dspActive_ && !sharedWasapi && samePcmFormat(stream_.sourceFormat, outputFormat_);
}

PipelineStatus AudioPipeline::status() const {
  std::lock_guard lock(mutex_);
  PipelineStatus status;
  status.state = state_;
  status.positionSeconds =
      outputFormat_.sampleRate > 0
          ? static_cast<double>(renderedFrames_.load()) / static_cast<double>(outputFormat_.sampleRate)
          : 0.0;
  status.stream = stream_;
  status.outputFormat = outputFormat_;
  status.backendId = backendId_;
  status.deviceName = deviceName_;
  status.dspActive = dspActive_;
  status.bitPerfect = bitPerfect_;
  status.resampleReason = resampleReason_;
  return status;
}

bool AudioPipeline::consumeEnded() {
  return ended_.exchange(false);
}

size_t AudioPipeline::getSpectrumData(float* buffer, size_t pointCount) const {
  const double phase =
      outputFormat_.sampleRate > 0
          ? static_cast<double>(renderedFrames_.load()) / static_cast<double>(outputFormat_.sampleRate)
          : 0.0;
  return spectrum_.read(buffer, pointCount, phase);
}

void AudioPipeline::startDecodeThread() {
  decodeRunning_ = true;
  decodeThread_ = std::thread([this] { decodeLoop(); });
}

void AudioPipeline::stopDecodeThread() {
  decodeRunning_ = false;
  buffer_.notifyAll();
  if (decodeThread_.joinable()) {
    decodeThread_.join();
  }
}

void AudioPipeline::decodeLoop() {
  std::vector<float> frames;
  int channels = 0;
  {
    std::lock_guard lock(mutex_);
    channels = std::max(1, outputFormat_.channelCount);
  }
  frames.resize(kDecodeChunkFrames * static_cast<size_t>(channels));

  while (decodeRunning_.load()) {
    FFmpegDecoder* decoder = nullptr;
    {
      std::lock_guard lock(mutex_);
      decoder = decoder_.get();
    }
    if (!decoder) break;

    std::string error;
    const size_t decoded = decoder->readFrames(frames.data(), kDecodeChunkFrames, &error);
    if (decoded == 0) {
      decodeEof_ = true;
      break;
    }
    buffer_.writeBlocking(frames.data(), decoded, decodeRunning_);
  }
}

size_t AudioPipeline::render(float* output, size_t frameCount) {
  if (!output || frameCount == 0) return 0;

  PipelineState state = PipelineState::Stopped;
  int channels = 0;
  {
    std::lock_guard lock(mutex_);
    state = state_;
    channels = std::max(1, outputFormat_.channelCount);
  }

  std::fill(output, output + frameCount * static_cast<size_t>(channels), 0.0f);
  if (state != PipelineState::Playing) {
    spectrum_.capture(output, frameCount, channels);
    return frameCount;
  }

  const size_t read = buffer_.read(output, frameCount);
  const double volume = volume_.load();
  if (std::abs(volume - 1.0) > 0.0001) {
    const size_t sampleCount = frameCount * static_cast<size_t>(channels);
    for (size_t i = 0; i < sampleCount; ++i) {
      output[i] = static_cast<float>(std::clamp(static_cast<double>(output[i]) * volume, -1.0, 1.0));
    }
  }

  if (read > 0) {
    renderedFrames_ += read;
  } else if (decodeEof_.load() && buffer_.availableFrames() == 0) {
    ended_ = true;
    std::lock_guard lock(mutex_);
    if (state_ == PipelineState::Playing) state_ = PipelineState::Stopped;
  }

  spectrum_.capture(output, frameCount, channels);
  return frameCount;
}

}  // namespace twilight::audio
