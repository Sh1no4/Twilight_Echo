#include "AudioTypes.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <string>

namespace twilight::audio {
namespace {

constexpr double kUnityVolumeEpsilon = 0.0001;

int bitDepthFromSampleFormat(AudioSampleFormat format) {
  switch (format) {
    case AudioSampleFormat::Int16Interleaved:
      return 16;
    case AudioSampleFormat::Int24Interleaved:
    case AudioSampleFormat::Int24In32Interleaved:
      return 24;
    case AudioSampleFormat::Int32Interleaved:
    case AudioSampleFormat::Float32Interleaved:
    default:
      return 32;
  }
}

bool routingPreservesSemantics(ChannelRoutingMode mode, int sourceChannels, int outputChannels) {
  if (sourceChannels <= 0 || outputChannels <= 0) return false;
  switch (mode) {
    case ChannelRoutingMode::Auto:
      return sourceChannels == outputChannels;
    case ChannelRoutingMode::Stereo:
      return sourceChannels == 2 && outputChannels == 2;
    case ChannelRoutingMode::StereoTo51:
    case ChannelRoutingMode::StereoTo71:
    case ChannelRoutingMode::MonoToStereo:
    case ChannelRoutingMode::MonoToMultichannel:
    default:
      return false;
  }
}

std::string formatSummary(const AudioFormat& format) {
  return sampleFormatToString(format.sampleFormat) + " " + std::to_string(effectivePcmBitDepth(format)) + "bit " +
         std::to_string(format.sampleRate) + "Hz " + std::to_string(format.channelCount) + "ch";
}

std::string processingReason(const PerfectEvaluation& evaluation) {
  if (std::abs(evaluation.volume - 1.0) > kUnityVolumeEpsilon) return "Volume active";
  if (evaluation.replayGainActive) return "ReplayGain active";
  if (evaluation.eqActive) return "EQ active";
  if (evaluation.convolverActive) return "Convolver active";
  if (evaluation.crossfeedActive) return "Crossfeed active";
  if (evaluation.crossfadeActive) return "Crossfade active";
  return "Audio processing active";
}

bool hasConcreteFormat(const AudioFormat& format) {
  return format.sampleRate > 0 && format.channelCount > 0 && effectivePcmBitDepth(format) > 0;
}

bool dopCarrierMatchesExpected(const PerfectEvaluation& evaluation) {
  const auto expected = dopCarrierFormatForDsd(evaluation.dsdRate, evaluation.sourceFormat.channelCount);
  if (!expected.has_value()) return false;
  if (evaluation.dopCarrierMatched) return true;
  return hasConcreteFormat(evaluation.dopCarrierFormat) && pcmFormatsExactMatch(evaluation.dopCarrierFormat, *expected) &&
         pcmFormatsExactMatch(evaluation.outputFormat, evaluation.dopCarrierFormat);
}

std::string dsdPerfectReason(const PerfectEvaluation& evaluation) {
  if (evaluation.sacdIsoSource) return "SACD ISO unsupported";
  if (evaluation.nativeDsdRequested || evaluation.dsdMode == DsdMode::Native ||
      evaluation.dsdMode == DsdMode::Unsupported) {
    return "DSD source unsupported";
  }
  if (evaluation.dsdMode == DsdMode::Pcm) {
    return evaluation.backendPerfectReason.empty() ? "DSD converted to PCM" : evaluation.backendPerfectReason;
  }
  if (evaluation.dsdMode == DsdMode::Dop) {
    if (!dopCarrierFormatForDsd(evaluation.dsdRate, evaluation.sourceFormat.channelCount).has_value()) {
      return "DSD source unsupported";
    }
    if (!dopCarrierMatchesExpected(evaluation)) return "DoP carrier mismatch";
    if (!evaluation.dopPassthroughProven || !evaluation.supportsOutputPerfect || evaluation.backendResampled) {
      return "DoP backend could not prove passthrough";
    }
  }
  return "DSD source unsupported";
}

}  // namespace

std::string channelRoutingModeToString(ChannelRoutingMode mode) {
  switch (mode) {
    case ChannelRoutingMode::Stereo:
      return "stereo";
    case ChannelRoutingMode::StereoTo51:
      return "stereo-to-5.1";
    case ChannelRoutingMode::StereoTo71:
      return "stereo-to-7.1";
    case ChannelRoutingMode::MonoToStereo:
      return "mono-to-stereo";
    case ChannelRoutingMode::MonoToMultichannel:
      return "mono-to-multichannel";
    case ChannelRoutingMode::Auto:
    default:
      return "auto";
  }
}

ChannelRoutingMode parseChannelRoutingMode(const std::string& mode) {
  std::string normalized = mode;
  std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  if (normalized == "stereo") return ChannelRoutingMode::Stereo;
  if (normalized == "stereo-to-5.1" || normalized == "stereoto51") return ChannelRoutingMode::StereoTo51;
  if (normalized == "stereo-to-7.1" || normalized == "stereoto71") return ChannelRoutingMode::StereoTo71;
  if (normalized == "mono-to-stereo" || normalized == "monotostereo") return ChannelRoutingMode::MonoToStereo;
  if (normalized == "mono-to-multichannel" || normalized == "monotomultichannel") {
    return ChannelRoutingMode::MonoToMultichannel;
  }
  return ChannelRoutingMode::Auto;
}

std::string dsdModeToString(DsdMode mode) {
  switch (mode) {
    case DsdMode::Dop:
      return "dop";
    case DsdMode::Native:
      return "native";
    case DsdMode::Unsupported:
      return "unsupported";
    case DsdMode::Pcm:
    default:
      return "pcm";
  }
}

std::string sampleFormatToString(AudioSampleFormat format) {
  switch (format) {
    case AudioSampleFormat::Int16Interleaved:
      return "int16";
    case AudioSampleFormat::Int24Interleaved:
      return "int24";
    case AudioSampleFormat::Int24In32Interleaved:
      return "int24-in32";
    case AudioSampleFormat::Int32Interleaved:
      return "int32";
    case AudioSampleFormat::Float32Interleaved:
    default:
      return "float32";
  }
}

int normalizedPcmBitDepth(int bitDepth) {
  if (bitDepth <= 0) return 0;
  if (bitDepth <= 16) return 16;
  if (bitDepth <= 24) return 24;
  return 32;
}

int effectivePcmBitDepth(const AudioFormat& format) {
  if (format.sampleFormat == AudioSampleFormat::Int24In32Interleaved) return 24;
  if (format.bitDepth > 0) return normalizedPcmBitDepth(format.bitDepth);
  return bitDepthFromSampleFormat(format.sampleFormat);
}

bool pcmFormatsExactMatch(const AudioFormat& left, const AudioFormat& right) {
  const int leftBitDepth = effectivePcmBitDepth(left);
  const int rightBitDepth = effectivePcmBitDepth(right);
  return left.sampleRate > 0 && right.sampleRate > 0 && left.sampleRate == right.sampleRate &&
         left.channelCount > 0 && right.channelCount > 0 && left.channelCount == right.channelCount &&
         leftBitDepth > 0 && rightBitDepth > 0 && leftBitDepth == rightBitDepth &&
         left.sampleFormat == right.sampleFormat;
}

std::optional<AudioFormat> dopCarrierFormatForDsd(int dsdRate, int channelCount) {
  if (channelCount <= 0) return std::nullopt;

  AudioFormat carrier;
  carrier.channelCount = channelCount;
  carrier.bitDepth = 24;
  carrier.sampleFormat = AudioSampleFormat::Int24Interleaved;

  switch (dsdRate) {
    case 64:
      carrier.sampleRate = 176400;
      return carrier;
    case 128:
      carrier.sampleRate = 352800;
      return carrier;
    default:
      return std::nullopt;
  }
}

PerfectResult evaluatePerfect(const PerfectEvaluation& evaluation) {
  PerfectResult result;
  const AudioFormat decodedFormat =
      evaluation.decodedFormat.sampleRate > 0 ? evaluation.decodedFormat : evaluation.sourceFormat;
  const bool dopCarrierMatched = evaluation.sourceDsd && evaluation.dsdMode == DsdMode::Dop &&
                                 dopCarrierMatchesExpected(evaluation);
  result.formatMatched = pcmFormatsExactMatch(decodedFormat, evaluation.outputFormat);
  result.sourceFormatMatched = pcmFormatsExactMatch(evaluation.sourceFormat, evaluation.outputFormat);
  result.resampled = evaluation.backendResampled || !result.formatMatched;
  result.processingActive =
      evaluation.replayGainActive || evaluation.eqActive || evaluation.convolverActive || evaluation.crossfeedActive ||
      evaluation.crossfadeActive || std::abs(evaluation.volume - 1.0) > kUnityVolumeEpsilon;
  result.routingPreservesSemantics = routingPreservesSemantics(
      evaluation.routingMode,
      decodedFormat.channelCount,
      evaluation.outputFormat.channelCount);
  result.pcmPassthrough = evaluation.pcmPassthrough && result.formatMatched && !evaluation.backendResampled;
  const bool pcmOutputPerfect =
      !evaluation.sourceDsd && evaluation.supportsOutputPerfect && result.pcmPassthrough &&
      !result.processingActive && result.routingPreservesSemantics;
  const bool dopOutputPerfect =
      evaluation.sourceDsd && evaluation.dsdMode == DsdMode::Dop && dopCarrierMatched &&
      evaluation.dopPassthroughProven && evaluation.supportsOutputPerfect && !evaluation.backendResampled &&
      !result.processingActive && result.routingPreservesSemantics;
  result.outputPerfect = pcmOutputPerfect || dopOutputPerfect;
  result.sourceExact =
      result.outputPerfect && evaluation.sourceLossless &&
      (evaluation.sourceDsd ? evaluation.dsdMode == DsdMode::Dop : result.sourceFormatMatched);

  if (result.sourceExact && result.outputPerfect) {
    result.perfectReason.clear();
  } else if (evaluation.sourceDsd) {
    if (result.processingActive) {
      result.perfectReason = "DSD processing active; falling back to PCM";
    } else if (evaluation.dsdMode == DsdMode::Pcm && evaluation.dsdRate >= 256) {
      result.perfectReason = "DSD" + std::to_string(evaluation.dsdRate) + " currently falls back to PCM";
    } else {
      result.perfectReason = dsdPerfectReason(evaluation);
    }
  } else if (!evaluation.supportsOutputPerfect) {
    result.perfectReason =
        evaluation.backendPerfectReason.empty() ? "共享输出经过系统混音" : evaluation.backendPerfectReason;
  } else if (!result.routingPreservesSemantics) {
    result.perfectReason = "声道映射改变声道语义";
  } else if (result.processingActive) {
    result.perfectReason = processingReason(evaluation);
  } else if (!result.pcmPassthrough) {
    result.perfectReason =
        evaluation.backendPerfectReason.empty()
            ? "Decoded PCM converted from " + formatSummary(decodedFormat) + " to " + formatSummary(evaluation.outputFormat)
            : evaluation.backendPerfectReason;
  } else if (!evaluation.sourceLossless) {
    result.perfectReason = "Source is lossy; decoded PCM path is output perfect";
  } else if (!result.sourceFormatMatched) {
    result.perfectReason =
        "Source PCM format differs from output format: " + formatSummary(evaluation.sourceFormat) + " -> " +
        formatSummary(evaluation.outputFormat);
  }
  return result;
}

}  // namespace twilight::audio
