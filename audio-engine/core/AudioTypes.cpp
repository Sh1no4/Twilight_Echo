#include "AudioTypes.h"

#include <algorithm>
#include <cctype>
#include <cmath>

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

BitPerfectResult evaluateBitPerfect(const BitPerfectEvaluation& evaluation) {
  BitPerfectResult result;
  const int sourceBitDepth = effectivePcmBitDepth(evaluation.sourceFormat);
  const int outputBitDepth = effectivePcmBitDepth(evaluation.outputFormat);
  const bool sampleRateMatched = evaluation.sourceFormat.sampleRate > 0 && evaluation.outputFormat.sampleRate > 0 &&
                                 evaluation.sourceFormat.sampleRate == evaluation.outputFormat.sampleRate;
  const bool bitDepthMatched = sourceBitDepth > 0 && outputBitDepth > 0 && sourceBitDepth == outputBitDepth;
  result.formatMatched = sampleRateMatched && bitDepthMatched;
  result.resampled = evaluation.backendResampled || (evaluation.sourceFormat.sampleRate > 0 &&
                                                     evaluation.outputFormat.sampleRate > 0 && !sampleRateMatched) ||
                     (sourceBitDepth > 0 && outputBitDepth > 0 && !bitDepthMatched);
  result.processingActive = evaluation.replayGainActive || evaluation.eqActive || evaluation.convolverActive ||
                            evaluation.crossfeedActive || std::abs(evaluation.volume - 1.0) > kUnityVolumeEpsilon;
  result.routingPreservesSemantics = routingPreservesSemantics(
      evaluation.routingMode,
      evaluation.sourceFormat.channelCount,
      evaluation.outputFormat.channelCount);
  result.bitPerfect = evaluation.supportsBitPerfect && result.formatMatched && !result.resampled &&
                      !result.processingActive && result.routingPreservesSemantics;

  if (result.bitPerfect) {
    result.resampleReason.clear();
  } else if (!evaluation.supportsBitPerfect) {
    result.resampleReason = "共享输出经过系统混音";
  } else if (!result.formatMatched || result.resampled) {
    result.resampleReason = "输出格式已转换";
  } else if (!result.routingPreservesSemantics) {
    result.resampleReason = "声道映射改变声道语义";
  } else if (result.processingActive) {
    result.resampleReason = "音量或 DSP 处理已启用";
  }
  return result;
}

}  // namespace twilight::audio
