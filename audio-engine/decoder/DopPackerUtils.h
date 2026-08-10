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

/**
 * Convert a source DSD byte to the MSB-first order a DoP payload requires.
 *
 * DoP carries the DSD bitstream with the earliest sample in the most
 * significant bit of the 16-bit payload field. DFF is already MSB-first, so it
 * passes through untouched; DSF is LSB-first and must be bit-reversed.
 *
 * This used to reverse exactly the wrong one of the two. Combined with the
 * payload byte pair being written in reverse order (see writeDopSample), the
 * two faults compounded into a full 16-bit time reversal of every DoP frame:
 * the local bit density survived, so a DAC still locked and the music still
 * played, which is why it went unnoticed - but the wire bits were not the
 * source bits, so the "bit-perfect" claim did not hold.
 */
inline uint8_t normalizeDsdByte(uint8_t value, DsdBitOrder bitOrder) {
  return bitOrder == DsdBitOrder::LsbFirst ? kBitReverseTable[value] : value;
}

inline uint8_t dopMarkerForFrame(size_t markerIndex) {
  return (markerIndex % 2 == 0) ? 0x05 : 0xfa;
}

inline size_t dopCarrierBytesPerSample(AudioSampleFormat outputFormat) {
  if (outputFormat == AudioSampleFormat::Int24In32Interleaved) return 4;
  if (outputFormat == AudioSampleFormat::Int24Interleaved) return 3;
  return 0;
}

/**
 * Write one DoP carrier sample.
 *
 * dCS DoP v1.1 defines the 24-bit word as
 *   bits 23..16 = marker (0x05 / 0xFA, alternating per frame)
 *   bits 15..8  = the earlier DSD byte in time
 *   bits 7..0   = the later DSD byte in time
 *
 * Little-endian containers therefore store the *later* byte at the lowest
 * address, which is the opposite of the intuitive "write first, then second"
 * order this function used to emit.
 *
 * `first` is the earlier byte in time, `second` the later one.
 */
inline void writeDopSample(
    uint8_t* output,
    size_t sample,
    size_t bytesPerSample,
    uint8_t first,
    uint8_t second,
    uint8_t marker) {
  const size_t offset = sample * bytesPerSample;
  if (bytesPerSample == 4) {
    // Int24-in-32, valid bits MSB-aligned: pad, later, earlier, marker.
    output[offset + 0] = 0x00;
    output[offset + 1] = second;
    output[offset + 2] = first;
    output[offset + 3] = marker;
    return;
  }

  // Packed int24 little-endian: later, earlier, marker.
  output[offset + 0] = second;
  output[offset + 1] = first;
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
