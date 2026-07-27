#include "PcmToDsdModulator.h"

#include <cmath>
#include <cstring>

namespace twilight::audio {
namespace {

// Polyphase halfband interpolation stages (x2 each), ordered from the lowest
// rate (sharpest transition band) to the highest. Only the odd (non-trivial)
// polyphase branch is stored; the even branch is a pure delay of L/2 samples.
// Kaiser-windowed halfband prototypes, gain 1.0 per stage after the x2 factor
// applied in the odd branch.
constexpr double kStage0Taps[32] = {
    -0.000017280278879405677, 0.000071733966682320372, -0.00020010061550812086,
    0.00045804706923640616,   -0.00092407343378629169, 0.0017030720800332284,
    -0.0029302840773261858,   0.0047777397837853886,   -0.0074679848191883304,
    0.011305818660740147,     -0.016753654520878306,   0.024619933464822868,
    -0.036585857266917245,    0.057012359784754614,    -0.10198702254071014,
    0.31691610968090245,      0.31691610968090245,     -0.10198702254071014,
    0.057012359784754614,     -0.036585857266917245,   0.024619933464822868,
    -0.016753654520878306,    0.011305818660740147,    -0.0074679848191883304,
    0.0047777397837853886,    -0.0029302840773261858,  0.0017030720800332284,
    -0.00092407343378629169,  0.00045804706923640616,  -0.00020010061550812086,
    0.000071733966682320372,  -0.000017280278879405677};

constexpr double kStage1Taps[16] = {
    -0.00010545156748877497, 0.00076076737495495985, -0.0029063710917855879,
    0.0082106929675413321,   -0.019394331200854247,  0.041652989921742066,
    -0.091288727244801429,   0.31307396723287667,    0.31307396723287667,
    -0.091288727244801429,   0.041652989921742066,   -0.019394331200854247,
    0.0082106929675413321,   -0.0029063710917855879, 0.00076076737495495985,
    -0.00010545156748877497};

constexpr double kStage2Taps[8] = {
    -0.0010774745369430225, 0.012524010870251569, -0.061555277131918031, 0.30017322686906628,
    0.30017322686906628,    -0.061555277131918031, 0.012524010870251569, -0.0010774745369430225};

constexpr double kStage3Taps[6] = {
    0.0038137914567547629, -0.044784569577449439, 0.29074990464155565,
    0.29074990464155565,   -0.044784569577449439, 0.0038137914567547629};

struct HalfbandStageSpec {
  const double* taps;
  int tapCount;
  int historyOffset;
};

constexpr HalfbandStageSpec kStages[PcmToDsdModulator::kMaxHalfbandStages] = {
    {kStage0Taps, 32, 0},
    {kStage1Taps, 16, 32},
    {kStage2Taps, 8, 48},
    {kStage3Taps, 6, 56}};

// 5th-order CIFB feedback coefficients derived from a Butterworth NTF with
// out-of-band gain Hinf = 1.5 (Lee criterion). Stable for inputs up to
// +/-0.5 FS; the input is clamped to that range ahead of the loop.
constexpr double kFeedback[5] = {
    0.000665376009929, 0.0102388145120, 0.0740739567827, 0.316662811154, 0.807717848861};

// Integrator magnitude guard. Normal operation at +/-0.5 FS input keeps the
// largest state below ~2; anything past this bound means the loop has gone
// unstable and must be re-centered instead of emitting garbage.
constexpr double kStateGuardLimit = 20.0;

constexpr int kBaseRate441 = 44100;
constexpr int kBaseRate48 = 48000;

bool isPowerOfTwo(int value) {
  return value > 0 && (value & (value - 1)) == 0;
}

int log2OfPowerOfTwo(int value) {
  int result = 0;
  while (value > 1) {
    value >>= 1;
    ++result;
  }
  return result;
}

}  // namespace

AudioSampleFormat PcmToDsdModulator::outputSampleFormat() const {
  return config_.bitOrder == DsdBitOrder::MsbFirst ? AudioSampleFormat::DsdInt8Msb1
                                                   : AudioSampleFormat::DsdInt8Lsb1;
}

bool PcmToDsdModulator::configure(const PcmToDsdModulatorConfig& config, std::string* error) {
  configured_ = false;
  if (config.channelCount <= 0 || config.channelCount > kMaxChannels) {
    if (error) *error = "PCM to DSD modulator supports 1 to 8 channels";
    return false;
  }
  if (config.inputSampleRate <= 0) {
    if (error) *error = "PCM to DSD modulator requires a positive input sample rate";
    return false;
  }
  if (config.targetDsdRate != 64 && config.targetDsdRate != 128 && config.targetDsdRate != 256) {
    if (error) *error = "PCM to DSD modulator supports DSD64, DSD128 and DSD256";
    return false;
  }

  int baseRate = 0;
  if (config.inputSampleRate % kBaseRate441 == 0) {
    baseRate = kBaseRate441;
  } else if (config.inputSampleRate % kBaseRate48 == 0) {
    baseRate = kBaseRate48;
  } else {
    if (error) *error = "PCM to DSD modulator requires a 44.1 kHz or 48 kHz family sample rate";
    return false;
  }

  const int dsdSampleRate = baseRate * config.targetDsdRate;
  if (dsdSampleRate % config.inputSampleRate != 0) {
    if (error) *error = "Input sample rate exceeds the requested DSD rate";
    return false;
  }
  const int ratio = dsdSampleRate / config.inputSampleRate;
  if (!isPowerOfTwo(ratio) || ratio < 8) {
    if (error) *error = "Unsupported PCM to DSD oversampling ratio";
    return false;
  }

  const int ratioLog2 = log2OfPowerOfTwo(ratio);
  const int stageCount = ratioLog2 < kMaxHalfbandStages ? ratioLog2 : kMaxHalfbandStages;

  config_ = config;
  dsdSampleRate_ = dsdSampleRate;
  upsampleRatio_ = ratio;
  halfbandStageCount_ = stageCount;
  holdFactor_ = ratio >> stageCount;
  channels_.assign(static_cast<size_t>(config.channelCount), ChannelState{});
  instabilityResets_ = 0;
  configured_ = true;
  return true;
}

void PcmToDsdModulator::injectInstabilityForTest() {
  for (auto& channel : channels_) {
    for (auto& state : channel.integrators) state = kStateGuardLimit * 16.0;
  }
}

void PcmToDsdModulator::reset() {
  for (auto& channel : channels_) {
    channel.filterHistory.fill(0.0);
    channel.integrators.fill(0.0);
    channel.pendingByte = 0;
    channel.pendingBits = 0;
  }
  instabilityResets_ = 0;
}

size_t PcmToDsdModulator::process(
    const float* interleavedInput,
    size_t frames,
    uint8_t* const* channelOutputs,
    size_t channelCapacityBytes) {
  if (!configured_ || !interleavedInput || !channelOutputs) return 0;
  const size_t channelCount = static_cast<size_t>(config_.channelCount);
  const size_t outputBytes = outputBytesPerChannel(frames);
  if (outputBytes > channelCapacityBytes) return 0;
  for (size_t channel = 0; channel < channelCount; ++channel) {
    if (!channelOutputs[channel]) return 0;
  }
  if (frames == 0) return 0;

  // Ping-pong expansion buffers sized for the maximum halfband output
  // (1 << kMaxHalfbandStages samples per input frame).
  double bufferA[1 << kMaxHalfbandStages];
  double bufferB[1 << kMaxHalfbandStages];
  size_t written[kMaxChannels] = {};

  const bool msbFirst = config_.bitOrder == DsdBitOrder::MsbFirst;

  for (size_t frame = 0; frame < frames; ++frame) {
    for (size_t channel = 0; channel < channelCount; ++channel) {
      ChannelState& state = channels_[channel];
      double sample =
          static_cast<double>(interleavedInput[frame * channelCount + channel]);
      if (!std::isfinite(sample)) sample = 0.0;
      sample *= kInputHeadroomScale;
      if (sample > kInputHeadroomScale) sample = kInputHeadroomScale;
      if (sample < -kInputHeadroomScale) sample = -kInputHeadroomScale;

      // Halfband cascade: expand one input sample into (1 << stageCount).
      double* current = bufferA;
      double* next = bufferB;
      current[0] = sample;
      int sampleCount = 1;
      for (int stage = 0; stage < halfbandStageCount_; ++stage) {
        const HalfbandStageSpec& spec = kStages[stage];
        double* history = state.filterHistory.data() + spec.historyOffset;
        const int tapCount = spec.tapCount;
        const int evenDelay = tapCount / 2;
        for (int i = 0; i < sampleCount; ++i) {
          std::memmove(history + 1, history, sizeof(double) * static_cast<size_t>(tapCount - 1));
          history[0] = current[i];
          next[2 * i] = history[evenDelay];
          double acc = 0.0;
          for (int k = 0; k < tapCount; ++k) acc += spec.taps[k] * history[k];
          next[2 * i + 1] = 2.0 * acc;
        }
        double* swap = current;
        current = next;
        next = swap;
        sampleCount *= 2;
      }

      // Sigma-delta at full DSD rate; zero-order hold for the residual ratio.
      double* integrators = state.integrators.data();
      uint8_t pendingByte = state.pendingByte;
      int pendingBits = state.pendingBits;
      uint8_t* output = channelOutputs[channel];
      size_t outIndex = written[channel];
      for (int i = 0; i < sampleCount; ++i) {
        double u = current[i];
        if (u > kInputHeadroomScale) u = kInputHeadroomScale;
        if (u < -kInputHeadroomScale) u = -kInputHeadroomScale;
        for (int hold = 0; hold < holdFactor_; ++hold) {
          const double feedback = integrators[4] >= 0.0 ? 1.0 : -1.0;
          const double s0 = integrators[0] + kFeedback[0] * u - kFeedback[0] * feedback;
          const double s1 = integrators[1] + integrators[0] - kFeedback[1] * feedback;
          const double s2 = integrators[2] + integrators[1] - kFeedback[2] * feedback;
          const double s3 = integrators[3] + integrators[2] - kFeedback[3] * feedback;
          const double s4 = integrators[4] + integrators[3] - kFeedback[4] * feedback;
          integrators[0] = s0;
          integrators[1] = s1;
          integrators[2] = s2;
          integrators[3] = s3;
          integrators[4] = s4;

          bool unstable = false;
          for (int stateIndex = 0; stateIndex < 5; ++stateIndex) {
            const double magnitude = integrators[stateIndex];
            if (!std::isfinite(magnitude) || magnitude > kStateGuardLimit ||
                magnitude < -kStateGuardLimit) {
              unstable = true;
              break;
            }
          }
          if (unstable) {
            for (int stateIndex = 0; stateIndex < 5; ++stateIndex) integrators[stateIndex] = 0.0;
            ++instabilityResets_;
          }

          const uint8_t bit = feedback > 0.0 ? 1 : 0;
          if (msbFirst) {
            pendingByte = static_cast<uint8_t>((pendingByte << 1) | bit);
          } else {
            pendingByte = static_cast<uint8_t>(pendingByte | (bit << pendingBits));
          }
          if (++pendingBits == 8) {
            output[outIndex++] = pendingByte;
            pendingByte = 0;
            pendingBits = 0;
          }
        }
      }
      state.pendingByte = pendingByte;
      state.pendingBits = pendingBits;
      written[channel] = outIndex;
    }
  }

  return written[0];
}

}  // namespace twilight::audio
