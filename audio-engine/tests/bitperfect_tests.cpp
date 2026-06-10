#include "../core/AudioTypes.h"

#include <cassert>
#include <string>

using namespace twilight::audio;

namespace {

AudioFormat pcm(
    int sampleRate = 48000,
    int bitDepth = 24,
    int channels = 2,
    AudioSampleFormat sampleFormat = AudioSampleFormat::Int24Interleaved) {
  AudioFormat format;
  format.sampleRate = sampleRate;
  format.channelCount = channels;
  format.bitDepth = bitDepth;
  format.sampleFormat = sampleFormat;
  return format;
}

PerfectEvaluation baseEvaluation() {
  PerfectEvaluation evaluation;
  evaluation.sourceFormat = pcm();
  evaluation.decodedFormat = pcm();
  evaluation.outputFormat = pcm();
  evaluation.sourceLossless = true;
  evaluation.supportsOutputPerfect = true;
  evaluation.volume = 1.0;
  evaluation.routingMode = ChannelRoutingMode::Auto;
  evaluation.pcmPassthrough = true;
  return evaluation;
}

void assertOutputPerfect(PerfectEvaluation evaluation) {
  const PerfectResult result = evaluatePerfect(evaluation);
  assert(result.outputPerfect);
  assert(result.pcmPassthrough);
  assert(!result.resampled);
}

void assertNotOutputPerfect(PerfectEvaluation evaluation) {
  const PerfectResult result = evaluatePerfect(evaluation);
  assert(!result.outputPerfect);
}

void testLosslessSourceExact() {
  const PerfectResult result = evaluatePerfect(baseEvaluation());
  assert(result.sourceExact);
  assert(result.outputPerfect);
  assert(result.perfectReason.empty());
}

void testLossyOutputPerfect() {
  auto evaluation = baseEvaluation();
  evaluation.sourceFormat = pcm(48000, 32, 2, AudioSampleFormat::Float32Interleaved);
  evaluation.decodedFormat = evaluation.sourceFormat;
  evaluation.outputFormat = evaluation.sourceFormat;
  evaluation.sourceLossless = false;

  const PerfectResult result = evaluatePerfect(evaluation);
  assert(!result.sourceExact);
  assert(result.outputPerfect);
  assert(result.perfectReason.find("lossy") != std::string::npos);
}

void testLosslessIntegerDecodedConversionBlocksOutputPerfect() {
  auto evaluation = baseEvaluation();
  evaluation.sourceFormat = pcm(48000, 24, 2, AudioSampleFormat::Int24Interleaved);
  evaluation.decodedFormat = pcm(48000, 32, 2, AudioSampleFormat::Float32Interleaved);
  evaluation.outputFormat = evaluation.decodedFormat;

  const PerfectResult result = evaluatePerfect(evaluation);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(!result.pcmPassthrough);
  assert(result.perfectReasonCode == "integer_passthrough_unavailable");
  assert(result.perfectReason.find("Lossless PCM decoded through non-identical PCM format") != std::string::npos);
}

void testBackendSupport() {
  auto shared = baseEvaluation();
  shared.supportsOutputPerfect = false;
  shared.backendPerfectReasonCode = "shared_mixer";
  shared.backendPerfectReason = "backend shared path";
  const PerfectResult sharedResult = evaluatePerfect(shared);
  assert(!sharedResult.outputPerfect);
  assert(sharedResult.perfectReasonCode == "shared_mixer");
  assert(sharedResult.perfectReason == "backend shared path");

  auto wasapiExclusive = baseEvaluation();
  assertOutputPerfect(wasapiExclusive);

  auto asio = baseEvaluation();
  asio.supportsOutputPerfect = true;
  assertOutputPerfect(asio);
}

void testBackendReasonFallback() {
  auto shared = baseEvaluation();
  shared.supportsOutputPerfect = false;
  const PerfectResult result = evaluatePerfect(shared);
  assert(!result.outputPerfect);
  assert(!result.perfectReason.empty());
}

void testPassthroughRequired() {
  auto evaluation = baseEvaluation();
  evaluation.pcmPassthrough = false;
  const PerfectResult result = evaluatePerfect(evaluation);
  assert(!result.outputPerfect);
  assert(result.perfectReason.find("PCM") != std::string::npos);
}

void testPcmPassthroughRequiresExactFormat() {
  const AudioFormat float32 = pcm(48000, 32, 2, AudioSampleFormat::Float32Interleaved);
  const AudioFormat int24 = pcm(48000, 24, 2, AudioSampleFormat::Int24Interleaved);
  const AudioFormat int24In32 = pcm(48000, 24, 2, AudioSampleFormat::Int24In32Interleaved);

  assert(pcmFormatsExactMatch(float32, float32));
  assert(!pcmFormatsExactMatch(float32, int24));
  assert(!pcmFormatsExactMatch(int24, int24In32));

  auto floatToInt = baseEvaluation();
  floatToInt.decodedFormat = float32;
  floatToInt.outputFormat = int24;
  floatToInt.pcmPassthrough = pcmFormatsExactMatch(floatToInt.decodedFormat, floatToInt.outputFormat);
  const PerfectResult floatToIntResult = evaluatePerfect(floatToInt);
  assert(!floatToIntResult.outputPerfect);
  assert(!floatToIntResult.pcmPassthrough);
  assert(floatToIntResult.perfectReasonCode == "integer_passthrough_unavailable");

  auto outputConversion = baseEvaluation();
  outputConversion.sourceFormat = float32;
  outputConversion.decodedFormat = float32;
  outputConversion.outputFormat = int24;
  outputConversion.pcmPassthrough =
      pcmFormatsExactMatch(outputConversion.decodedFormat, outputConversion.outputFormat);
  const PerfectResult outputConversionResult = evaluatePerfect(outputConversion);
  assert(!outputConversionResult.outputPerfect);
  assert(!outputConversionResult.pcmPassthrough);
  assert(outputConversionResult.perfectReasonCode == "pcm_converted");
  assert(outputConversionResult.perfectReason.find("Decoded PCM converted") != std::string::npos);
}

void testFormatMismatch() {
  auto sampleRateMismatch = baseEvaluation();
  sampleRateMismatch.outputFormat.sampleRate = 96000;
  const PerfectResult sampleRateResult = evaluatePerfect(sampleRateMismatch);
  assert(!sampleRateResult.outputPerfect);
  assert(sampleRateResult.resampled);

  auto bitDepthMismatch = baseEvaluation();
  bitDepthMismatch.outputFormat.bitDepth = 32;
  assertNotOutputPerfect(bitDepthMismatch);

  auto sampleFormatMismatch = baseEvaluation();
  sampleFormatMismatch.outputFormat.sampleFormat = AudioSampleFormat::Int24In32Interleaved;
  const PerfectResult sampleFormatResult = evaluatePerfect(sampleFormatMismatch);
  assert(!sampleFormatResult.outputPerfect);
  assert(sampleFormatResult.perfectReason.find("Decoded PCM converted") != std::string::npos);

  auto backendResampled = baseEvaluation();
  backendResampled.backendResampled = true;
  const PerfectResult backendResult = evaluatePerfect(backendResampled);
  assert(!backendResult.outputPerfect);
  assert(backendResult.resampled);
}

void testSampleFormatEffectiveBitDepth() {
  AudioFormat int16 = pcm(44100, 0, 2, AudioSampleFormat::Int16Interleaved);
  assert(effectivePcmBitDepth(int16) == 16);

  AudioFormat int24Packed = pcm(44100, 0, 2, AudioSampleFormat::Int24Interleaved);
  assert(effectivePcmBitDepth(int24Packed) == 24);

  AudioFormat int24In32 = pcm(44100, 32, 2, AudioSampleFormat::Int24In32Interleaved);
  assert(effectivePcmBitDepth(int24In32) == 24);

  AudioFormat float32 = pcm(44100, 0, 2, AudioSampleFormat::Float32Interleaved);
  assert(effectivePcmBitDepth(float32) == 32);
}

void testDopCarrierHelper() {
  const auto dsd64 = dopCarrierFormatForDsd(64, 2);
  assert(dsd64.has_value());
  assert(dsd64->sampleRate == 176400);
  assert(dsd64->bitDepth == 24);
  assert(dsd64->channelCount == 2);
  assert(dsd64->sampleFormat == AudioSampleFormat::Int24Interleaved);

  const auto dsd128 = dopCarrierFormatForDsd(128, 6);
  assert(dsd128.has_value());
  assert(dsd128->sampleRate == 352800);
  assert(dsd128->bitDepth == 24);
  assert(dsd128->channelCount == 6);

  assert(!dopCarrierFormatForDsd(256, 2).has_value());
  assert(!dopCarrierFormatForDsd(512, 2).has_value());
  assert(!dopCarrierFormatForDsd(64, 0).has_value());
}

void testProcessingFlags() {
  auto volume = baseEvaluation();
  volume.volume = 0.99;
  assertNotOutputPerfect(volume);

  auto replayGain = baseEvaluation();
  replayGain.replayGainActive = true;
  assertNotOutputPerfect(replayGain);

  auto eq = baseEvaluation();
  eq.eqActive = true;
  assertNotOutputPerfect(eq);

  auto convolver = baseEvaluation();
  convolver.convolverActive = true;
  assertNotOutputPerfect(convolver);

  auto crossfeed = baseEvaluation();
  crossfeed.crossfeedActive = true;
  assertNotOutputPerfect(crossfeed);

  auto crossfade = baseEvaluation();
  crossfade.crossfadeActive = true;
  assertNotOutputPerfect(crossfade);
}

void testRoutingSemantics() {
  auto stereo = baseEvaluation();
  stereo.routingMode = ChannelRoutingMode::Stereo;
  assertOutputPerfect(stereo);

  auto to51 = baseEvaluation();
  to51.outputFormat.channelCount = 6;
  to51.routingMode = ChannelRoutingMode::StereoTo51;
  assertNotOutputPerfect(to51);

  auto to71 = baseEvaluation();
  to71.outputFormat.channelCount = 8;
  to71.routingMode = ChannelRoutingMode::StereoTo71;
  assertNotOutputPerfect(to71);

  auto monoAuto = baseEvaluation();
  monoAuto.sourceFormat.channelCount = 1;
  monoAuto.decodedFormat.channelCount = 1;
  monoAuto.outputFormat.channelCount = 1;
  assertOutputPerfect(monoAuto);

  auto monoToStereo = baseEvaluation();
  monoToStereo.sourceFormat.channelCount = 1;
  monoToStereo.decodedFormat.channelCount = 1;
  monoToStereo.outputFormat.channelCount = 2;
  monoToStereo.routingMode = ChannelRoutingMode::MonoToStereo;
  assertNotOutputPerfect(monoToStereo);

  auto autoChannelMismatch = baseEvaluation();
  autoChannelMismatch.outputFormat.channelCount = 6;
  assertNotOutputPerfect(autoChannelMismatch);
}

void testDsdUnsupported() {
  auto dsd = baseEvaluation();
  dsd.sourceDsd = true;
  dsd.dsdMode = DsdMode::Unsupported;
  const PerfectResult result = evaluatePerfect(dsd);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(result.perfectReason == "DSD source unsupported");
}

void testSACDIsoUnsupportedReason() {
  auto sacd = baseEvaluation();
  sacd.sourceDsd = true;
  sacd.sacdIsoSource = true;
  const PerfectResult result = evaluatePerfect(sacd);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(result.perfectReason == "SACD ISO unsupported");
}

void testDsdConvertedToPcmReason() {
  auto dsd = baseEvaluation();
  dsd.sourceDsd = true;
  dsd.dsdMode = DsdMode::Pcm;
  const PerfectResult result = evaluatePerfect(dsd);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(result.perfectReasonCode == "dsd_converted_to_pcm");
  assert(result.perfectReason == "DSD converted to PCM");
}

void testDopCarrierMismatchReason() {
  auto dop = baseEvaluation();
  dop.sourceDsd = true;
  dop.dsdMode = DsdMode::Dop;
  dop.dsdRate = 64;
  dop.dopCarrierFormat = pcm(96000, 24, 2, AudioSampleFormat::Int24Interleaved);
  dop.outputFormat = dop.dopCarrierFormat;
  dop.decodedFormat = dop.dopCarrierFormat;
  dop.pcmPassthrough = true;

  const PerfectResult result = evaluatePerfect(dop);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(result.perfectReasonCode == "dop_carrier_mismatch");
  assert(result.perfectReason == "DoP carrier mismatch");
}

void testDopCandidateRequiresBackendPassthroughProof() {
  auto dop = baseEvaluation();
  dop.sourceDsd = true;
  dop.dsdMode = DsdMode::Dop;
  dop.dsdRate = 64;
  dop.dopCarrierFormat = dopCarrierFormatForDsd(64, 2).value();
  dop.outputFormat = dop.dopCarrierFormat;
  dop.decodedFormat = dop.dopCarrierFormat;
  dop.dopCarrierMatched = true;
  dop.pcmPassthrough = true;

  const PerfectResult result = evaluatePerfect(dop);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(result.perfectReasonCode == "dop_passthrough_unproven");
  assert(result.perfectReason == "DoP backend could not prove passthrough");
}

void testDopPerfectWhenBackendProvesPassthrough() {
  auto dop = baseEvaluation();
  dop.sourceFormat = pcm(2822400, 1, 2, AudioSampleFormat::Float32Interleaved);
  dop.sourceDsd = true;
  dop.sourceLossless = true;
  dop.dsdMode = DsdMode::Dop;
  dop.dsdRate = 64;
  dop.dopCarrierFormat = dopCarrierFormatForDsd(64, 2).value();
  dop.decodedFormat = dop.dopCarrierFormat;
  dop.outputFormat = dop.dopCarrierFormat;
  dop.dopCarrierMatched = true;
  dop.dopPassthroughProven = true;
  dop.pcmPassthrough = true;

  const PerfectResult result = evaluatePerfect(dop);
  assert(result.sourceExact);
  assert(result.outputPerfect);
  assert(result.pcmPassthrough);
  assert(result.perfectReasonCode.empty());
  assert(result.perfectReason.empty());
}

void testNativeDsdRequiresBackendProof() {
  auto native = baseEvaluation();
  native.sourceFormat = pcm(2822400, 1, 2, AudioSampleFormat::DsdInt8Lsb1);
  native.decodedFormat = native.sourceFormat;
  native.outputFormat = native.sourceFormat;
  native.sourceDsd = true;
  native.sourceLossless = true;
  native.dsdMode = DsdMode::Native;
  native.dsdRate = 64;
  native.nativeDsdRequested = true;
  native.backendPerfectReasonCode = "native_dsd_runtime_unproven";
  native.backendPerfectReason = "ASIO runtime sample type is not Native DSD";

  const PerfectResult result = evaluatePerfect(native);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(result.perfectReasonCode == "native_dsd_runtime_unproven");
  assert(result.perfectReason == "ASIO runtime sample type is not Native DSD");
}

void testNativeDsdPerfectWhenBackendProvesPassthrough() {
  auto native = baseEvaluation();
  native.sourceFormat = pcm(2822400, 1, 2, AudioSampleFormat::DsdInt8Lsb1);
  native.decodedFormat = native.sourceFormat;
  native.outputFormat = native.sourceFormat;
  native.sourceDsd = true;
  native.sourceLossless = true;
  native.dsdMode = DsdMode::Native;
  native.dsdRate = 64;
  native.nativeDsdRequested = true;
  native.nativeDsdPassthroughProven = true;
  native.pcmPassthrough = false;

  const PerfectResult result = evaluatePerfect(native);
  assert(result.sourceExact);
  assert(result.outputPerfect);
  assert(!result.pcmPassthrough);
  assert(result.perfectReasonCode.empty());
  assert(result.perfectReason.empty());
}

void testNativeDsdProcessingBlocksPerfect() {
  auto native = baseEvaluation();
  native.sourceFormat = pcm(2822400, 1, 2, AudioSampleFormat::DsdInt8Lsb1);
  native.decodedFormat = native.sourceFormat;
  native.outputFormat = native.sourceFormat;
  native.sourceDsd = true;
  native.sourceLossless = true;
  native.dsdMode = DsdMode::Native;
  native.dsdRate = 64;
  native.nativeDsdRequested = true;
  native.nativeDsdPassthroughProven = true;
  native.eqActive = true;

  const PerfectResult result = evaluatePerfect(native);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(result.perfectReasonCode == "dsd_processing_pcm_fallback");
}

void testDsdProcessingFallbackReason() {
  auto dsd = baseEvaluation();
  dsd.sourceDsd = true;
  dsd.dsdMode = DsdMode::Pcm;
  dsd.dsdRate = 64;
  dsd.eqActive = true;
  const PerfectResult result = evaluatePerfect(dsd);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(result.perfectReasonCode == "dsd_processing_pcm_fallback");
  assert(result.perfectReason == "DSD processing active; falling back to PCM");
}

void testDsdDopRoutingSemanticChangeUsesProcessingFallbackCode() {
  auto dop = baseEvaluation();
  dop.sourceDsd = true;
  dop.dsdMode = DsdMode::Dop;
  dop.dsdRate = 64;
  dop.dopCarrierFormat = dopCarrierFormatForDsd(64, 2).value();
  dop.decodedFormat = dop.dopCarrierFormat;
  dop.outputFormat = dop.dopCarrierFormat;
  dop.outputFormat.channelCount = 6;
  dop.routingMode = ChannelRoutingMode::StereoTo51;
  dop.dopCarrierMatched = true;
  dop.dopPassthroughProven = true;
  dop.pcmPassthrough = true;

  const PerfectResult result = evaluatePerfect(dop);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(!result.routingPreservesSemantics);
  assert(result.perfectReasonCode == "dsd_processing_pcm_fallback");
  assert(result.perfectReason == "DSD processing active; falling back to PCM");
}

void testDsdHighRateFallbackReason() {
  auto dsd = baseEvaluation();
  dsd.sourceDsd = true;
  dsd.dsdMode = DsdMode::Pcm;
  dsd.dsdRate = 256;
  const PerfectResult result = evaluatePerfect(dsd);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(result.perfectReasonCode == "dsd_high_rate_pcm_fallback");
  assert(result.perfectReason == "DSD256 currently falls back to PCM");
}

void testUnsupportedDsdRateRejectsDopPerfect() {
  auto dop = baseEvaluation();
  dop.sourceDsd = true;
  dop.dsdMode = DsdMode::Dop;
  dop.dsdRate = 256;
  dop.dopCarrierMatched = true;

  const PerfectResult result = evaluatePerfect(dop);
  assert(!result.sourceExact);
  assert(!result.outputPerfect);
  assert(result.perfectReason == "DSD source unsupported");
}

}  // namespace

int main() {
  testLosslessSourceExact();
  testLossyOutputPerfect();
  testLosslessIntegerDecodedConversionBlocksOutputPerfect();
  testBackendSupport();
  testBackendReasonFallback();
  testPassthroughRequired();
  testPcmPassthroughRequiresExactFormat();
  testFormatMismatch();
  testSampleFormatEffectiveBitDepth();
  testDopCarrierHelper();
  testProcessingFlags();
  testRoutingSemantics();
  testDsdUnsupported();
  testSACDIsoUnsupportedReason();
  testDsdConvertedToPcmReason();
  testDopCarrierMismatchReason();
  testDopCandidateRequiresBackendPassthroughProof();
  testDopPerfectWhenBackendProvesPassthrough();
  testNativeDsdRequiresBackendProof();
  testNativeDsdPerfectWhenBackendProvesPassthrough();
  testNativeDsdProcessingBlocksPerfect();
  testDsdProcessingFallbackReason();
  testDsdDopRoutingSemanticChangeUsesProcessingFallbackCode();
  testDsdHighRateFallbackReason();
  testUnsupportedDsdRateRejectsDopPerfect();
  return 0;
}
