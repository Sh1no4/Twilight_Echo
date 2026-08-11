#pragma once

// Canonical DSD sample-rate -> DSD multiple mapping.
//
// A "DSD rate" is the familiar DSD64/128/256/512 multiple; the sample rate is the raw
// bit rate (DSD64 = 64 * 44100 = 2822400, or 64 * 48000 = 3072000 for the 48k family).
// Thresholds sit below each target with enough slack to cover both families.
//
// This lived in four separate copies (DsdReader, SacdIsoDemuxer, FFmpegDecoder,
// AudioMetadataService) and they had already drifted: the two FFmpeg-side copies never
// handled 512, so a DSD512 file opened through FFmpeg reported rate 0 even though
// AudioPipeline treats 512 as a supported native rate. Keep one copy.

namespace twilight::audio {

inline int dsdRateFromSampleRate(int dsdSampleRate) {
  if (dsdSampleRate >= 22000000) return 512;
  if (dsdSampleRate >= 10000000) return 256;
  if (dsdSampleRate >= 5000000) return 128;
  if (dsdSampleRate >= 2500000) return 64;
  return 0;
}

// DoP hides the DSD stream inside a PCM carrier, so the rate we observe is the carrier
// rate (DSD64 -> 176400/192000) rather than the DSD bit rate.
inline int dsdRateFromDopCarrierRate(int carrierSampleRate) {
  if (carrierSampleRate >= 1300000) return 512;
  if (carrierSampleRate >= 650000) return 256;
  if (carrierSampleRate >= 320000) return 128;
  if (carrierSampleRate >= 160000) return 64;
  return 0;
}

// Accepts either flavour: DoP carriers are resolved against the carrier thresholds and
// fall back to the raw-rate table when they do not match.
inline int inferDsdRate(int sampleRate, bool dopCarrier = false) {
  if (dopCarrier) {
    const int carrierRate = dsdRateFromDopCarrierRate(sampleRate);
    if (carrierRate > 0) return carrierRate;
  }
  return dsdRateFromSampleRate(sampleRate);
}

}  // namespace twilight::audio
