#pragma once

#include "DsdReader.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace twilight::audio::dop {

inline constexpr uint8_t reverseBits(uint8_t value) {
  value = static_cast<uint8_t>(((value & 0xf0) >> 4) | ((value & 0x0f) << 4));
  value = static_cast<uint8_t>(((value & 0xcc) >> 2) | ((value & 0x33) << 2));
  value = static_cast<uint8_t>(((value & 0xaa) >> 1) | ((value & 0x55) << 1));
  return value;
}

inline constexpr std::array<uint8_t, 256> makeBitReverseTable() {
  std::array<uint8_t, 256> table{};
  for (size_t i = 0; i < table.size(); ++i) {
    table[i] = reverseBits(static_cast<uint8_t>(i));
  }
  return table;
}

inline constexpr auto kBitReverseTable = makeBitReverseTable();

inline uint8_t normalizeDsdByte(uint8_t value, DsdBitOrder bitOrder) {
  return bitOrder == DsdBitOrder::MsbFirst ? kBitReverseTable[value] : value;
}

inline uint8_t dopMarkerForFrame(size_t markerIndex) {
  return (markerIndex % 2 == 0) ? 0x05 : 0xfa;
}

inline size_t dopCarrierBytesPerSample(AudioSampleFormat outputFormat) {
  if (outputFormat == AudioSampleFormat::Int24In32Interleaved) return 4;
  if (outputFormat == AudioSampleFormat::Int24Interleaved) return 3;
  return 0;
}

inline void writeDopSample(
    uint8_t* output,
    size_t sample,
    size_t bytesPerSample,
    uint8_t first,
    uint8_t second,
    uint8_t marker) {
  const size_t offset = sample * bytesPerSample;
  if (bytesPerSample == 4) {
    output[offset + 0] = 0x00;
    output[offset + 1] = first;
    output[offset + 2] = second;
    output[offset + 3] = marker;
    return;
  }

  output[offset + 0] = first;
  output[offset + 1] = second;
  output[offset + 2] = marker;
}

inline size_t packDsfPlanarDopFrames(
    const uint8_t* dsdBytes,
    size_t byteCount,
    size_t channels,
    DsdBitOrder bitOrder,
    size_t bytesPerSample,
    size_t& markerIndex,
    std::vector<uint8_t>* pcmBytes) {
  const size_t frames = byteCount / (channels * 2);
  if (frames == 0) return 0;

  pcmBytes->resize(frames * channels * bytesPerSample);
  uint8_t* output = pcmBytes->data();
  const size_t channelBlock = byteCount / channels;

  for (size_t frame = 0; frame < frames; ++frame) {
    const uint8_t marker = dopMarkerForFrame(markerIndex++);
    const size_t framePair = frame * 2;
    for (size_t channel = 0; channel < channels; ++channel) {
      const size_t firstIndex = channel * channelBlock + framePair;
      const size_t secondIndex = firstIndex + 1;
      const size_t sample = frame * channels + channel;
      if (secondIndex >= byteCount) {
        writeDopSample(output, sample, bytesPerSample, 0, 0, 0);
        continue;
      }
      writeDopSample(
          output,
          sample,
          bytesPerSample,
          normalizeDsdByte(dsdBytes[firstIndex], bitOrder),
          normalizeDsdByte(dsdBytes[secondIndex], bitOrder),
          marker);
    }
  }

  return frames;
}

inline size_t packDffInterleavedDopFrames(
    const uint8_t* dsdBytes,
    size_t byteCount,
    size_t channels,
    DsdBitOrder bitOrder,
    size_t bytesPerSample,
    size_t& markerIndex,
    std::vector<uint8_t>* pcmBytes) {
  const size_t frames = byteCount / (channels * 2);
  if (frames == 0) return 0;

  pcmBytes->resize(frames * channels * bytesPerSample);
  uint8_t* output = pcmBytes->data();
  const size_t dsdBytesPerFrame = channels * 2;

  for (size_t frame = 0; frame < frames; ++frame) {
    const uint8_t marker = dopMarkerForFrame(markerIndex++);
    const size_t framePairStart = frame * dsdBytesPerFrame;
    for (size_t channel = 0; channel < channels; ++channel) {
      const size_t firstIndex = framePairStart + channel;
      const size_t secondIndex = firstIndex + channels;
      const size_t sample = frame * channels + channel;
      writeDopSample(
          output,
          sample,
          bytesPerSample,
          normalizeDsdByte(dsdBytes[firstIndex], bitOrder),
          normalizeDsdByte(dsdBytes[secondIndex], bitOrder),
          marker);
    }
  }

  return frames;
}

inline size_t packDopFramesResizeOnly(
    const uint8_t* dsdBytes,
    size_t byteCount,
    int channelCount,
    DsdPacking packing,
    DsdBitOrder bitOrder,
    AudioSampleFormat outputFormat,
    size_t& markerIndex,
    std::vector<uint8_t>* pcmBytes) {
  if (!dsdBytes || !pcmBytes || channelCount <= 0) return 0;

  const size_t channels = static_cast<size_t>(channelCount);
  const size_t bytesPerSample = dopCarrierBytesPerSample(outputFormat);
  if (bytesPerSample == 0) return 0;

  if (packing == DsdPacking::DsfPlanarBlocks) {
    return packDsfPlanarDopFrames(dsdBytes, byteCount, channels, bitOrder, bytesPerSample, markerIndex, pcmBytes);
  }

  return packDffInterleavedDopFrames(dsdBytes, byteCount, channels, bitOrder, bytesPerSample, markerIndex, pcmBytes);
}

}  // namespace twilight::audio::dop
