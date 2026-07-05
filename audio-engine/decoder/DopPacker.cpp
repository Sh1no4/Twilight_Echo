#include "DopPacker.h"
#include "DopPackerUtils.h"

namespace twilight::audio {
namespace {

bool isDopSampleFormat(AudioSampleFormat format) {
  return format == AudioSampleFormat::Int24Interleaved || format == AudioSampleFormat::Int24In32Interleaved;
}

}  // namespace

bool DopPacker::configure(const DopPackerConfig& config, std::string* error) {
  const auto carrier = dopCarrierFormatForDsd(config.dsdRate, config.sourceSampleRate, config.channelCount);
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
  return dop::packDopFramesResizeOnly(
      dsdBytes,
      byteCount,
      config_.channelCount,
      config_.packing,
      config_.bitOrder,
      config_.outputFormat,
      markerIndex_,
      pcmBytes);
}

void DopPacker::reset() {
  markerIndex_ = 0;
}

const AudioFormat& DopPacker::carrierFormat() const {
  return carrierFormat_;
}

}  // namespace twilight::audio
