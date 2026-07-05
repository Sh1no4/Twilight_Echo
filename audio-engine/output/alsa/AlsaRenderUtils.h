#pragma once

#include "../IOutputBackend.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <cstring>
#include <vector>

namespace twilight::audio::alsa {

inline constexpr uint8_t kDsdSilenceByte = 0x69;

struct DsdPeriodRenderResult {
  const uint8_t* writeData = nullptr;
  size_t writeByteSize = 0;
  size_t renderedDsdByteFrames = 0;
};

inline float clampSample(float sample) {
  return std::clamp(sample, -1.0f, 1.0f);
}

inline int32_t floatToInt24(float sample) {
  const float clamped = clampSample(sample);
  if (clamped <= -1.0f) return -8388608;
  return static_cast<int32_t>(std::lrint(static_cast<double>(clamped) * 8388607.0));
}

inline int16_t floatToInt16(float sample) {
  const float clamped = clampSample(sample);
  if (clamped <= -1.0f) return -32768;
  return static_cast<int16_t>(std::lrint(static_cast<double>(clamped) * 32767.0));
}

inline int32_t floatToInt32(float sample) {
  const float clamped = clampSample(sample);
  if (clamped <= -1.0f) return -2147483647 - 1;
  return static_cast<int32_t>(std::lrint(static_cast<double>(clamped) * 2147483647.0));
}

inline void writeLe16(uint8_t* out, int16_t value) {
  const auto raw = static_cast<uint16_t>(value);
  out[0] = static_cast<uint8_t>(raw & 0xffu);
  out[1] = static_cast<uint8_t>((raw >> 8) & 0xffu);
}

inline void writeLe24(uint8_t* out, int32_t value) {
  const auto raw = static_cast<uint32_t>(value);
  out[0] = static_cast<uint8_t>(raw & 0xffu);
  out[1] = static_cast<uint8_t>((raw >> 8) & 0xffu);
  out[2] = static_cast<uint8_t>((raw >> 16) & 0xffu);
}

inline void writeLe32(uint8_t* out, int32_t value) {
  const auto raw = static_cast<uint32_t>(value);
  out[0] = static_cast<uint8_t>(raw & 0xffu);
  out[1] = static_cast<uint8_t>((raw >> 8) & 0xffu);
  out[2] = static_cast<uint8_t>((raw >> 16) & 0xffu);
  out[3] = static_cast<uint8_t>((raw >> 24) & 0xffu);
}

inline size_t pcmBytesPerSample(AudioSampleFormat format) {
  switch (format) {
    case AudioSampleFormat::Int16Interleaved:
      return 2;
    case AudioSampleFormat::Int24Interleaved:
      return 3;
    case AudioSampleFormat::DsdInt8Lsb1:
    case AudioSampleFormat::DsdInt8Msb1:
    case AudioSampleFormat::DsdInt8Ner8:
      return 1;
    case AudioSampleFormat::Int24In32Interleaved:
    case AudioSampleFormat::Int32Interleaved:
    case AudioSampleFormat::Float32Interleaved:
    default:
      return 4;
  }
}

inline size_t packFloatScratchToPcmScratch(
    const float* input,
    size_t frames,
    int channels,
    AudioSampleFormat sampleFormat,
    std::vector<uint8_t>& scratch) {
  if (!input || frames == 0 || channels <= 0) {
    scratch.clear();
    return 0;
  }

  const size_t bytesPerSample = pcmBytesPerSample(sampleFormat);
  const size_t bytesPerFrame = bytesPerSample * static_cast<size_t>(channels);
  const size_t sampleCount = frames * static_cast<size_t>(channels);
  scratch.resize(frames * bytesPerFrame);
  uint8_t* output = scratch.data();

  switch (sampleFormat) {
    case AudioSampleFormat::Float32Interleaved: {
      auto* out = reinterpret_cast<float*>(output);
      for (size_t i = 0; i < sampleCount; ++i) out[i] = clampSample(input[i]);
      break;
    }
    case AudioSampleFormat::Int16Interleaved: {
      for (size_t i = 0; i < sampleCount; ++i) {
        writeLe16(output + i * bytesPerSample, floatToInt16(input[i]));
      }
      break;
    }
    case AudioSampleFormat::Int24Interleaved: {
      for (size_t i = 0; i < sampleCount; ++i) {
        writeLe24(output + i * bytesPerSample, floatToInt24(input[i]));
      }
      break;
    }
    case AudioSampleFormat::Int24In32Interleaved: {
      for (size_t i = 0; i < sampleCount; ++i) {
        writeLe32(output + i * bytesPerSample, floatToInt24(input[i]) << 8);
      }
      break;
    }
    case AudioSampleFormat::Int32Interleaved:
    default: {
      for (size_t i = 0; i < sampleCount; ++i) {
        writeLe32(output + i * bytesPerSample, floatToInt32(input[i]));
      }
      break;
    }
  }

  return bytesPerFrame;
}

inline size_t renderFloatPeriodWithTailSilence(
    std::vector<float>& scratch,
    size_t frames,
    int channels,
    const RenderCallback& callback) {
  if (frames == 0 || channels <= 0) {
    scratch.clear();
    return 0;
  }

  const size_t sampleCount = frames * static_cast<size_t>(channels);
  scratch.resize(sampleCount);

  size_t renderedFrames = 0;
  if (callback) {
    renderedFrames = std::min(callback(scratch.data(), frames), frames);
  }

  if (renderedFrames < frames) {
    const size_t renderedSamples = renderedFrames * static_cast<size_t>(channels);
    std::fill(scratch.begin() + static_cast<std::ptrdiff_t>(renderedSamples), scratch.end(), 0.0f);
  }
  return renderedFrames;
}

inline size_t prepareDsdSilenceScratch(
    std::vector<uint8_t>& scratch,
    size_t byteSize,
    bool& knownSilence) {
  const size_t oldSize = scratch.size();
  scratch.resize(byteSize);
  if (byteSize == 0) {
    knownSilence = true;
    return 0;
  }

  if (!knownSilence) {
    std::fill(scratch.begin(), scratch.end(), kDsdSilenceByte);
    knownSilence = true;
    return byteSize;
  }

  if (oldSize < byteSize) {
    std::fill(
        scratch.begin() + static_cast<std::ptrdiff_t>(oldSize),
        scratch.end(),
        kDsdSilenceByte);
    return byteSize - oldSize;
  }

  return 0;
}

inline void prepareDsdRepackScratchWithSilencePadding(
    std::vector<uint8_t>& repackScratch,
    size_t frames,
    size_t frameBytes,
    int channels,
    int physWidthBytes) {
  if (frames == 0 || frameBytes == 0 || channels <= 0 || physWidthBytes <= 0) {
    repackScratch.clear();
    return;
  }

  const size_t writeByteSize = frames * frameBytes;
  const size_t oldSize = repackScratch.size();
  repackScratch.resize(writeByteSize);
  if (oldSize < writeByteSize) {
    std::fill(
        repackScratch.begin() + static_cast<std::ptrdiff_t>(oldSize),
        repackScratch.end(),
        kDsdSilenceByte);
  }

  const size_t usedFrameBytes = static_cast<size_t>(channels) * static_cast<size_t>(physWidthBytes);
  if (usedFrameBytes >= frameBytes) return;

  for (size_t frame = 0; frame < frames; ++frame) {
    const size_t frameOffset = frame * frameBytes;
    std::fill(
        repackScratch.begin() + static_cast<std::ptrdiff_t>(frameOffset + usedFrameBytes),
        repackScratch.begin() + static_cast<std::ptrdiff_t>(frameOffset + frameBytes),
        kDsdSilenceByte);
  }
}

inline DsdPeriodRenderResult renderDsdPeriodWithTailSilenceAndRepack(
    std::vector<uint8_t>& typedScratch,
    std::vector<uint8_t>& repackScratch,
    const AudioFormat& blockFormat,
    size_t frames,
    int channels,
    size_t frameBytes,
    int physWidthBytes,
    const TypedRenderCallback& callback) {
  if (frames == 0 || channels <= 0 || frameBytes == 0 || physWidthBytes <= 0) {
    typedScratch.clear();
    repackScratch.clear();
    return {};
  }

  const size_t channelCount = static_cast<size_t>(channels);
  const size_t physicalBytes = static_cast<size_t>(physWidthBytes);
  const size_t dsdByteFrames = frames * physicalBytes;
  const size_t dsdByteSize = dsdByteFrames * channelCount;
  typedScratch.resize(dsdByteSize);

  size_t rendered = 0;
  if (callback) {
    PcmBlock block;
    block.format = blockFormat;
    block.data = typedScratch.data();
    block.frames = dsdByteFrames;
    block.byteSize = dsdByteSize;
    rendered = std::min(callback(block), dsdByteFrames);
  }

  if (rendered < dsdByteFrames) {
    std::fill(
        typedScratch.begin() + static_cast<std::ptrdiff_t>(rendered * channelCount),
        typedScratch.end(),
        kDsdSilenceByte);
  }

  if (physWidthBytes <= 1) {
    return DsdPeriodRenderResult{typedScratch.data(), dsdByteSize, rendered};
  }

  const size_t writeByteSize = frames * frameBytes;
  if (channels == 1 && frameBytes == physicalBytes) {
    return DsdPeriodRenderResult{typedScratch.data(), writeByteSize, rendered};
  }

  const bool repackFullyOverwritesOutput = frameBytes == channelCount * physicalBytes;
  if (repackFullyOverwritesOutput) {
    repackScratch.resize(writeByteSize);
  } else {
    prepareDsdRepackScratchWithSilencePadding(
        repackScratch,
        frames,
        frameBytes,
        channels,
        physWidthBytes);
  }

  for (size_t frame = 0; frame < frames; ++frame) {
    for (int channel = 0; channel < channels; ++channel) {
      for (int byte = 0; byte < physWidthBytes; ++byte) {
        const size_t srcIdx =
            (frame * physicalBytes + static_cast<size_t>(byte)) * channelCount + static_cast<size_t>(channel);
        const size_t dstIdx =
            frame * frameBytes + static_cast<size_t>(channel) * physicalBytes + static_cast<size_t>(byte);
        if (srcIdx < dsdByteSize && dstIdx < repackScratch.size()) {
          repackScratch[dstIdx] = typedScratch[srcIdx];
        }
      }
    }
  }

  return DsdPeriodRenderResult{repackScratch.data(), writeByteSize, rendered};
}

}  // namespace twilight::audio::alsa
