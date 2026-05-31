#include "../core/AudioTypes.h"

#include <cassert>

using namespace twilight::audio;

namespace {

AudioFormat pcm(int sampleRate = 48000, int bitDepth = 24, int channels = 2) {
  AudioFormat format;
  format.sampleRate = sampleRate;
  format.channelCount = channels;
  format.bitDepth = bitDepth;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;
  return format;
}

BitPerfectEvaluation baseEvaluation() {
  BitPerfectEvaluation evaluation;
  evaluation.sourceFormat = pcm();
  evaluation.outputFormat = pcm();
  evaluation.supportsBitPerfect = true;
  evaluation.volume = 1.0;
  evaluation.routingMode = ChannelRoutingMode::Auto;
  return evaluation;
}

void assertBitPerfect(BitPerfectEvaluation evaluation) {
  const BitPerfectResult result = evaluateBitPerfect(evaluation);
  assert(result.bitPerfect);
  assert(!result.resampled);
}

void assertNotBitPerfect(BitPerfectEvaluation evaluation) {
  const BitPerfectResult result = evaluateBitPerfect(evaluation);
  assert(!result.bitPerfect);
}

void testBackendSupport() {
  auto shared = baseEvaluation();
  shared.supportsBitPerfect = false;
  assertNotBitPerfect(shared);

  auto wasapiExclusive = baseEvaluation();
  assertBitPerfect(wasapiExclusive);

  auto asio = baseEvaluation();
  asio.supportsBitPerfect = true;
  assertBitPerfect(asio);
}

void testFormatMismatch() {
  auto sampleRateMismatch = baseEvaluation();
  sampleRateMismatch.outputFormat.sampleRate = 96000;
  const BitPerfectResult sampleRateResult = evaluateBitPerfect(sampleRateMismatch);
  assert(!sampleRateResult.bitPerfect);
  assert(sampleRateResult.resampled);

  auto bitDepthMismatch = baseEvaluation();
  bitDepthMismatch.outputFormat.bitDepth = 32;
  assertNotBitPerfect(bitDepthMismatch);

  auto int24In32 = baseEvaluation();
  int24In32.outputFormat.bitDepth = 32;
  int24In32.outputFormat.sampleFormat = AudioSampleFormat::Int24In32Interleaved;
  assertBitPerfect(int24In32);

  auto backendResampled = baseEvaluation();
  backendResampled.backendResampled = true;
  const BitPerfectResult backendResult = evaluateBitPerfect(backendResampled);
  assert(!backendResult.bitPerfect);
  assert(backendResult.resampled);
}

void testProcessingFlags() {
  auto volume = baseEvaluation();
  volume.volume = 0.99;
  assertNotBitPerfect(volume);

  auto replayGain = baseEvaluation();
  replayGain.replayGainActive = true;
  assertNotBitPerfect(replayGain);

  auto eq = baseEvaluation();
  eq.eqActive = true;
  assertNotBitPerfect(eq);

  auto convolver = baseEvaluation();
  convolver.convolverActive = true;
  assertNotBitPerfect(convolver);

  auto crossfeed = baseEvaluation();
  crossfeed.crossfeedActive = true;
  assertNotBitPerfect(crossfeed);
}

void testRoutingSemantics() {
  auto stereo = baseEvaluation();
  stereo.routingMode = ChannelRoutingMode::Stereo;
  assertBitPerfect(stereo);

  auto to51 = baseEvaluation();
  to51.outputFormat.channelCount = 6;
  to51.routingMode = ChannelRoutingMode::StereoTo51;
  assertNotBitPerfect(to51);

  auto to71 = baseEvaluation();
  to71.outputFormat.channelCount = 8;
  to71.routingMode = ChannelRoutingMode::StereoTo71;
  assertNotBitPerfect(to71);

  auto monoAuto = baseEvaluation();
  monoAuto.sourceFormat.channelCount = 1;
  monoAuto.outputFormat.channelCount = 1;
  assertBitPerfect(monoAuto);

  auto monoToStereo = baseEvaluation();
  monoToStereo.sourceFormat.channelCount = 1;
  monoToStereo.outputFormat.channelCount = 2;
  monoToStereo.routingMode = ChannelRoutingMode::MonoToStereo;
  assertNotBitPerfect(monoToStereo);

  auto autoChannelMismatch = baseEvaluation();
  autoChannelMismatch.outputFormat.channelCount = 6;
  assertNotBitPerfect(autoChannelMismatch);
}

}  // namespace

int main() {
  testBackendSupport();
  testFormatMismatch();
  testProcessingFlags();
  testRoutingSemantics();
  return 0;
}
