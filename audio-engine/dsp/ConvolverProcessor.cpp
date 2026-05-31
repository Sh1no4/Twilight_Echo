#include "ConvolverProcessor.h"

#include "KissFftAdapter.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <fstream>
#include <limits>

namespace twilight::audio {
namespace {

constexpr uint16_t kWavePcm = 0x0001;
constexpr uint16_t kWaveFloat = 0x0003;
constexpr uint16_t kWaveExtensible = 0xfffe;

uint16_t readU16(const std::array<unsigned char, 2>& bytes) {
  return static_cast<uint16_t>(bytes[0] | (bytes[1] << 8));
}

uint32_t readU32(const std::array<unsigned char, 4>& bytes) {
  return static_cast<uint32_t>(bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24));
}

float pcmToFloat(const unsigned char* data, uint16_t bitsPerSample, uint16_t formatTag) {
  if (formatTag == kWaveFloat && bitsPerSample == 32) {
    float value = 0.0f;
    std::memcpy(&value, data, sizeof(float));
    return std::isfinite(value) ? std::clamp(value, -8.0f, 8.0f) : 0.0f;
  }
  if (bitsPerSample == 16) {
    int16_t value = 0;
    std::memcpy(&value, data, sizeof(value));
    return static_cast<float>(value) / 32768.0f;
  }
  if (bitsPerSample == 24) {
    int32_t value = static_cast<int32_t>(data[0] | (data[1] << 8) | (data[2] << 16));
    if ((value & 0x00800000) != 0) value |= static_cast<int32_t>(0xff000000);
    return static_cast<float>(value) / 8388608.0f;
  }
  if (bitsPerSample == 32) {
    int32_t value = 0;
    std::memcpy(&value, data, sizeof(value));
    return static_cast<float>(static_cast<double>(value) / 2147483648.0);
  }
  return 0.0f;
}

std::string mappingModeFor(int irChannels, int outputChannels) {
  if (irChannels == 1) return "mono-to-all";
  if (irChannels == 2 && outputChannels == 2) return "stereo";
  if (irChannels == 2) return outputChannels == 1 ? "stereo-left" : "stereo-repeat";
  return "front-left-right";
}

}  // namespace

struct ConvolverProcessor::FftChannel {
  using Complex = KissFftAdapter::Complex;

  uint32_t partitionSize = 0;
  size_t fftSize = 0;
  size_t currentIndex = 0;
  std::vector<std::vector<Complex>> impulsePartitions;
  std::vector<std::vector<Complex>> inputHistory;
  std::vector<float> inputBlock;
  std::vector<float> outputBlock;
  std::vector<float> overlap;
  size_t inputPos = 0;

  void configure(const std::vector<float>& impulse, uint32_t requestedPartitionSize) {
    partitionSize = std::max<uint32_t>(1, requestedPartitionSize);
    fftSize = static_cast<size_t>(partitionSize) * 2;
    const size_t partitionCount =
        std::max<size_t>(1, (impulse.size() + static_cast<size_t>(partitionSize) - 1) / partitionSize);

    impulsePartitions.assign(partitionCount, std::vector<Complex>(fftSize));
    inputHistory.assign(partitionCount, std::vector<Complex>(fftSize));
    for (size_t partition = 0; partition < partitionCount; ++partition) {
      std::vector<float> padded(fftSize, 0.0f);
      const size_t offset = partition * static_cast<size_t>(partitionSize);
      const size_t count = std::min(static_cast<size_t>(partitionSize), impulse.size() - std::min(offset, impulse.size()));
      for (size_t i = 0; i < count; ++i) padded[i] = impulse[offset + i];
      KissFftAdapter::forward(padded, &impulsePartitions[partition]);
    }

    inputBlock.assign(partitionSize, 0.0f);
    outputBlock.assign(partitionSize, 0.0f);
    overlap.assign(partitionSize, 0.0f);
    inputPos = 0;
    currentIndex = 0;
  }

  void reset() {
    for (auto& block : inputHistory) std::fill(block.begin(), block.end(), Complex{});
    std::fill(inputBlock.begin(), inputBlock.end(), 0.0f);
    std::fill(outputBlock.begin(), outputBlock.end(), 0.0f);
    std::fill(overlap.begin(), overlap.end(), 0.0f);
    inputPos = 0;
    currentIndex = 0;
  }

  float process(float input) {
    if (partitionSize == 0 || impulsePartitions.empty()) return input;
    const float output = outputBlock[inputPos];
    inputBlock[inputPos] = input;
    ++inputPos;
    if (inputPos >= partitionSize) {
      computeNextBlock();
      inputPos = 0;
    }
    return std::isfinite(output) ? output : 0.0f;
  }

  void computeNextBlock() {
    const size_t partitionCount = impulsePartitions.size();
    currentIndex = (currentIndex + partitionCount - 1) % partitionCount;

    std::vector<float> padded(fftSize, 0.0f);
    std::copy(inputBlock.begin(), inputBlock.end(), padded.begin());
    KissFftAdapter::forward(padded, &inputHistory[currentIndex]);
    std::fill(inputBlock.begin(), inputBlock.end(), 0.0f);

    std::vector<Complex> spectrum(fftSize, Complex{});
    for (size_t partition = 0; partition < partitionCount; ++partition) {
      const size_t historyIndex = (currentIndex + partition) % partitionCount;
      const auto& inputSpectrum = inputHistory[historyIndex];
      const auto& irSpectrum = impulsePartitions[partition];
      for (size_t bin = 0; bin < fftSize; ++bin) {
        spectrum[bin] += inputSpectrum[bin] * irSpectrum[bin];
      }
    }

    KissFftAdapter::inverse(&spectrum);
    for (size_t i = 0; i < partitionSize; ++i) {
      outputBlock[i] = static_cast<float>(std::clamp(
          static_cast<double>(spectrum[i].real()) + static_cast<double>(overlap[i]), -8.0, 8.0));
      overlap[i] = spectrum[i + partitionSize].real();
    }
  }
};

ConvolverProcessor::ConvolverProcessor() = default;

ConvolverProcessor::~ConvolverProcessor() = default;

void ConvolverProcessor::configure(const DspConfig& config) {
  config_ = config;
  rebuild();
}

void ConvolverProcessor::prepare(const AudioFormat& format) {
  const bool formatChanged = format.sampleRate != format_.sampleRate || format.channelCount != format_.channelCount;
  format_ = format;
  if (formatChanged) reset();
  rebuild();
}

void ConvolverProcessor::setTrackContext(const DspTrackContext&) {
}

void ConvolverProcessor::process(float* samples, size_t frameCount) {
  if (!active_ || !samples || frameCount == 0) return;
  const int channels = std::max(1, format_.channelCount);
  for (size_t frame = 0; frame < frameCount; ++frame) {
    for (int channel = 0; channel < channels; ++channel) {
      const size_t index = frame * static_cast<size_t>(channels) + static_cast<size_t>(channel);
      samples[index] = channels_[static_cast<size_t>(channel)]->process(samples[index]);
    }
  }
}

void ConvolverProcessor::reset() {
  for (auto& channel : channels_) {
    if (channel) channel->reset();
  }
}

bool ConvolverProcessor::isActive() const {
  return active_;
}

bool ConvolverProcessor::loadImpulseResponse(const std::string& path, std::string* error) {
  IrData ir;
  if (!readWaveImpulse(path, &ir, error)) {
    info_.lastError = error && !error->empty() ? *error : "无法读取脉冲响应文件";
    return false;
  }

  originalIr_ = std::move(ir);
  irCache_.clear();
  info_ = {};
  info_.loaded = true;
  info_.path = path;
  info_.sampleRate = originalIr_->sampleRate;
  info_.channels = originalIr_->channels;
  info_.lengthFrames = originalIr_->frames;
  info_.lengthMs =
      originalIr_->sampleRate > 0
          ? static_cast<double>(originalIr_->frames) * 1000.0 / static_cast<double>(originalIr_->sampleRate)
          : 0.0;
  config_.impulseResponsePath = path;
  config_.convolverEnabled = true;
  rebuild();
  return true;
}

void ConvolverProcessor::unloadImpulseResponse() {
  originalIr_.reset();
  irCache_.clear();
  channels_.clear();
  active_ = false;
  info_ = {};
  config_.convolverEnabled = false;
  config_.impulseResponsePath.clear();
}

ConvolverInfo ConvolverProcessor::info() const {
  ConvolverInfo copy = info_;
  copy.active = active_;
  return copy;
}

bool ConvolverProcessor::readWaveImpulse(const std::string& path, IrData* out, std::string* error) {
  if (!out) return false;
  std::ifstream file(path, std::ios::binary);
  if (!file) {
    if (error) *error = "无法打开脉冲响应文件";
    return false;
  }

  char riff[4] = {};
  std::array<unsigned char, 4> chunkSize{};
  char wave[4] = {};
  file.read(riff, 4);
  file.read(reinterpret_cast<char*>(chunkSize.data()), 4);
  file.read(wave, 4);
  if (std::strncmp(riff, "RIFF", 4) != 0 || std::strncmp(wave, "WAVE", 4) != 0) {
    if (error) *error = "脉冲响应文件不是有效的 WAV";
    return false;
  }

  uint16_t formatTag = 0;
  uint16_t channels = 0;
  uint32_t sampleRate = 0;
  uint16_t blockAlign = 0;
  uint16_t bitsPerSample = 0;
  std::vector<unsigned char> audioData;

  while (file) {
    char id[4] = {};
    std::array<unsigned char, 4> sizeBytes{};
    file.read(id, 4);
    file.read(reinterpret_cast<char*>(sizeBytes.data()), 4);
    if (!file) break;
    const uint32_t size = readU32(sizeBytes);

    if (std::strncmp(id, "fmt ", 4) == 0) {
      std::vector<unsigned char> fmt(size);
      file.read(reinterpret_cast<char*>(fmt.data()), static_cast<std::streamsize>(fmt.size()));
      if (fmt.size() < 16) {
        if (error) *error = "WAV 格式块不完整";
        return false;
      }
      formatTag = static_cast<uint16_t>(fmt[0] | (fmt[1] << 8));
      channels = static_cast<uint16_t>(fmt[2] | (fmt[3] << 8));
      sampleRate = static_cast<uint32_t>(fmt[4] | (fmt[5] << 8) | (fmt[6] << 16) | (fmt[7] << 24));
      blockAlign = static_cast<uint16_t>(fmt[12] | (fmt[13] << 8));
      bitsPerSample = static_cast<uint16_t>(fmt[14] | (fmt[15] << 8));
      if (formatTag == kWaveExtensible && fmt.size() >= 26) {
        formatTag = bitsPerSample == 32 ? kWaveFloat : kWavePcm;
      }
    } else if (std::strncmp(id, "data", 4) == 0) {
      audioData.resize(size);
      file.read(reinterpret_cast<char*>(audioData.data()), static_cast<std::streamsize>(audioData.size()));
    } else {
      file.seekg(size, std::ios::cur);
    }
    if ((size & 1U) != 0U) file.seekg(1, std::ios::cur);
  }

  if (channels == 0 || sampleRate == 0 || blockAlign == 0 || audioData.empty()) {
    if (error) *error = "WAV 脉冲响应缺少音频数据";
    return false;
  }
  if (formatTag != kWavePcm && formatTag != kWaveFloat) {
    if (error) *error = "当前仅支持 PCM 或 Float WAV 脉冲响应";
    return false;
  }

  const size_t frameCount = audioData.size() / blockAlign;
  const size_t bytesPerSample = std::max<size_t>(1, bitsPerSample / 8);
  IrData ir;
  ir.sampleRate = static_cast<int>(sampleRate);
  ir.channels = static_cast<int>(channels);
  ir.frames = static_cast<uint64_t>(frameCount);
  ir.samples.assign(channels, std::vector<float>(frameCount, 0.0f));
  for (size_t frame = 0; frame < frameCount; ++frame) {
    const size_t frameOffset = frame * blockAlign;
    for (uint16_t channel = 0; channel < channels; ++channel) {
      const size_t offset = frameOffset + static_cast<size_t>(channel) * bytesPerSample;
      if (offset + bytesPerSample <= audioData.size()) {
        ir.samples[channel][frame] = pcmToFloat(audioData.data() + offset, bitsPerSample, formatTag);
      }
    }
  }

  *out = std::move(ir);
  return true;
}

ConvolverProcessor::IrData ConvolverProcessor::resampleIr(const IrData& source, int targetSampleRate) {
  if (source.sampleRate <= 0 || targetSampleRate <= 0 || source.sampleRate == targetSampleRate) return source;

  IrData out;
  out.sampleRate = targetSampleRate;
  out.channels = source.channels;
  out.frames = static_cast<uint64_t>(
      std::max<double>(1.0, std::round(static_cast<double>(source.frames) * targetSampleRate / source.sampleRate)));
  out.samples.assign(static_cast<size_t>(out.channels), std::vector<float>(static_cast<size_t>(out.frames), 0.0f));

  for (int channel = 0; channel < out.channels; ++channel) {
    const auto& input = source.samples[static_cast<size_t>(channel)];
    auto& output = out.samples[static_cast<size_t>(channel)];
    for (size_t i = 0; i < output.size(); ++i) {
      const double position = static_cast<double>(i) * source.sampleRate / targetSampleRate;
      const size_t left = std::min(input.size() - 1, static_cast<size_t>(std::floor(position)));
      const size_t right = std::min(input.size() - 1, left + 1);
      const double t = position - static_cast<double>(left);
      output[i] = static_cast<float>((1.0 - t) * input[left] + t * input[right]);
    }
  }
  return out;
}

void ConvolverProcessor::rebuild() {
  active_ = false;
  channels_.clear();
  if (!config_.enabled || !config_.convolverEnabled || !originalIr_ || format_.sampleRate <= 0 ||
      format_.channelCount <= 0) {
    info_.active = false;
    return;
  }

  std::string error;
  if (!prepareRuntimeIr(&error)) {
    info_.lastError = error;
    info_.active = false;
    return;
  }
  info_.active = active_;
}

bool ConvolverProcessor::prepareRuntimeIr(std::string* error) {
  if (!originalIr_) {
    if (error) *error = "尚未加载脉冲响应";
    return false;
  }

  const bool needsResample = originalIr_->sampleRate != format_.sampleRate;
  auto cached = irCache_.find(format_.sampleRate);
  if (cached == irCache_.end()) {
    cached = irCache_.emplace(format_.sampleRate, needsResample ? resampleIr(*originalIr_, format_.sampleRate) : *originalIr_).first;
  }

  const IrData& ir = cached->second;
  if (ir.samples.empty() || ir.frames == 0) {
    if (error) *error = "脉冲响应没有可用采样";
    return false;
  }

  updateInfoFromRuntime(ir, needsResample);
  const uint32_t partitionSize = choosePartitionSize(ir);
  channels_.clear();
  channels_.reserve(static_cast<size_t>(format_.channelCount));
  for (int channel = 0; channel < format_.channelCount; ++channel) {
    auto fftChannel = std::make_unique<FftChannel>();
    fftChannel->configure(impulseForOutputChannel(ir, channel), partitionSize);
    channels_.push_back(std::move(fftChannel));
  }
  info_.partitionSize = partitionSize;
  info_.latencyFrames = partitionSize;
  active_ = true;
  return true;
}

uint32_t ConvolverProcessor::choosePartitionSize(const IrData& ir) const {
  if (ir.sampleRate <= 48000 && ir.frames <= static_cast<uint64_t>(ir.sampleRate / 2)) return 1024;
  if (ir.sampleRate >= 176400 || ir.frames >= static_cast<uint64_t>(ir.sampleRate * 2)) return 4096;
  return 2048;
}

std::vector<float> ConvolverProcessor::impulseForOutputChannel(const IrData& ir, int outputChannel) const {
  if (ir.channels <= 1) return ir.samples.empty() ? std::vector<float>{1.0f} : ir.samples[0];
  const size_t sourceChannel = outputChannel <= 0 ? 0U : 1U;
  return ir.samples[std::min(sourceChannel, ir.samples.size() - 1)];
}

void ConvolverProcessor::updateInfoFromRuntime(const IrData& ir, bool resampled) {
  info_.loaded = originalIr_.has_value();
  info_.active = active_;
  info_.irResampled = resampled;
  info_.sampleRate = ir.sampleRate;
  info_.channels = ir.channels;
  info_.lengthFrames = ir.frames;
  info_.lengthMs =
      ir.sampleRate > 0 ? static_cast<double>(ir.frames) * 1000.0 / static_cast<double>(ir.sampleRate) : 0.0;
  info_.channelMappingMode = mappingModeFor(ir.channels, format_.channelCount);
  info_.warning.clear();
  info_.lastError.clear();
  if (ir.channels > 2) {
    info_.warning = "多声道脉冲响应已使用前左和前右声道";
  }
}

}  // namespace twilight::audio
