#include "DopPacker.h"

#include <algorithm>

namespace twilight::audio {
namespace {

uint8_t reverseBits(uint8_t value) {
  value = static_cast<uint8_t>(((value & 0xf0) >> 4) | ((value & 0x0f) << 4));
  value = static_cast<uint8_t>(((value & 0xcc) >> 2) | ((value & 0x33) << 2));
  value = static_cast<uint8_t>(((value & 0xaa) >> 1) | ((value & 0x55) << 1));
  return value;
}

bool isDopSampleFormat(AudioSampleFormat format) {
  return format == AudioSampleFormat::Int24Interleaved || format == AudioSampleFormat::Int24In32Interleaved;
}

}  // namespace

bool DopPacker::configure(const DopPackerConfig& config, std::string* error) {
  const auto carrier = dopCarrierFormatForDsd(config.dsdRate, config.channelCount);
  if (!carrier.has_value()) {
    if (error) *error = "Unsupported DSD rate for DoP";
    return false;
  }
  if (!isDopSampleFormat(config.outputFormat)) {
    if (error) *error = "DoP carrier requires int24 or int24-in32 output";
    return false;
  }
  config_ = config;
  carrierFormat_ = *carrier;
  carrierFormat_.sampleFormat = config.outputFormat;
  reset();
  return true;
}

size_t DopPacker::pack(const uint8_t* dsdBytes, size_t byteCount, std::vector<uint8_t>* pcmBytes) {
  if (!dsdBytes || !pcmBytes || config_.channelCount <= 0) return 0;
  const size_t channels = static_cast<size_t>(config_.channelCount);
  const size_t frames = byteCount / (channels * 2);
  if (frames == 0) return 0;

  const size_t bytesPerSample = config_.outputFormat == AudioSampleFormat::Int24In32Interleaved ? 4 : 3;
  pcmBytes->assign(frames * channels * bytesPerSample, 0);

  for (size_t frame = 0; frame < frames; ++frame) {
    const uint8_t marker = nextMarker();
    for (size_t channel = 0; channel < channels; ++channel) {
      uint8_t first = 0;
      uint8_t second = 0;
      if (!readDsdPair(dsdBytes, byteCount, frame, static_cast<int>(channel), &first, &second)) continue;
      const size_t sample = frame * channels + channel;
      if (config_.outputFormat == AudioSampleFormat::Int24In32Interleaved) {
        const size_t offset = sample * 4;
        (*pcmBytes)[offset + 0] = 0x00;
        (*pcmBytes)[offset + 1] = first;
        (*pcmBytes)[offset + 2] = second;
        (*pcmBytes)[offset + 3] = marker;
      } else {
        const size_t offset = sample * 3;
        (*pcmBytes)[offset + 0] = first;
        (*pcmBytes)[offset + 1] = second;
        (*pcmBytes)[offset + 2] = marker;
      }
    }
  }

  return frames;
}

void DopPacker::reset() {
  markerIndex_ = 0;
}

const AudioFormat& DopPacker::carrierFormat() const {
  return carrierFormat_;
}

uint8_t DopPacker::nextMarker() {
  const uint8_t marker = (markerIndex_ % 2 == 0) ? 0x05 : 0xfa;
  ++markerIndex_;
  return marker;
}

uint8_t DopPacker::normalizeDsdByte(uint8_t value) const {
  return config_.bitOrder == DsdBitOrder::MsbFirst ? reverseBits(value) : value;
}

bool DopPacker::readDsdPair(
    const uint8_t* dsdBytes,
    size_t byteCount,
    size_t frame,
    int channel,
    uint8_t* first,
    uint8_t* second) const {
  if (!first || !second || channel < 0 || config_.channelCount <= 0) return false;
  const size_t channels = static_cast<size_t>(config_.channelCount);
  size_t firstIndex = 0;
  size_t secondIndex = 0;
  if (config_.packing == DsdPacking::DsfPlanarBlocks) {
    const size_t framePair = frame * 2;
    const size_t channelBlock = byteCount / channels;
    firstIndex = static_cast<size_t>(channel) * channelBlock + framePair;
    secondIndex = firstIndex + 1;
  } else {
    const size_t framePairStart = frame * channels * 2;
    firstIndex = framePairStart + static_cast<size_t>(channel);
    secondIndex = framePairStart + channels + static_cast<size_t>(channel);
  }
  if (secondIndex >= byteCount) return false;
  *first = normalizeDsdByte(dsdBytes[firstIndex]);
  *second = normalizeDsdByte(dsdBytes[secondIndex]);
  return true;
}

}  // namespace twilight::audio
