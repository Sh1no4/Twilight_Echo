#include "dsp/WsolaResampler.h"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <vector>

using twilight::audio::WsolaResampler;

namespace {

size_t sinePull(void* ctx, float* dst, size_t maxFrames) {
  auto* state = static_cast<std::pair<double, size_t>*>(ctx);
  double& phase = state->first;
  size_t& remaining = state->second;
  const size_t n = remaining < maxFrames ? remaining : maxFrames;
  constexpr double kTwoPi = 6.28318530717958647692;
  constexpr double kFreq = 440.0;
  constexpr double kSr = 48000.0;
  for (size_t i = 0; i < n; ++i) {
    const float s = static_cast<float>(std::sin(phase));
    dst[i * 2 + 0] = s;
    dst[i * 2 + 1] = s;
    phase += kTwoPi * kFreq / kSr;
    if (phase > kTwoPi) phase -= kTwoPi;
  }
  remaining -= n;
  return n;
}

bool approxEqual(double a, double b, double tol) {
  return std::abs(a - b) <= tol;
}

// Estimate dominant period via autocorr peak (stereo average of left).
double estimatePeriodFrames(const float* interleaved, size_t frames, int channels, int sampleRate) {
  if (frames < 256) return 0;
  const size_t maxLag = static_cast<size_t>(sampleRate / 80);   // 80 Hz
  const size_t minLag = static_cast<size_t>(sampleRate / 500);  // 500 Hz
  double best = -1e300;
  size_t bestLag = 0;
  for (size_t lag = minLag; lag <= maxLag && lag + 64 < frames; ++lag) {
    double corr = 0;
    for (size_t i = 0; i + lag < frames; ++i) {
      const float a = interleaved[i * static_cast<size_t>(channels)];
      const float b = interleaved[(i + lag) * static_cast<size_t>(channels)];
      corr += static_cast<double>(a) * static_cast<double>(b);
    }
    if (corr > best) {
      best = corr;
      bestLag = lag;
    }
  }
  return static_cast<double>(bestLag);
}

}  // namespace

int main() {
  WsolaResampler resampler;
  resampler.prepare(2, 48000, 2048);

  // 1) Unity rate passes through full buffer.
  {
    resampler.reset();
    resampler.setRate(1.0);
    std::pair<double, size_t> state{0.0, 4096};
    std::vector<float> out(2048 * 2);
    const size_t got = resampler.processFn(out.data(), 2048, sinePull, &state);
    assert(got == 2048);
  }

  // 2) 1.5x should consume more source than output (duration shrinks).
  {
    resampler.reset();
    resampler.setRate(1.5);
    std::pair<double, size_t> state{0.0, 100000};
    std::vector<float> out(4800 * 2);  // 100ms out
    const size_t before = state.second;
    const size_t got = resampler.processFn(out.data(), 4800, sinePull, &state);
    assert(got == 4800);
    const size_t consumed = before - state.second;
    // Expect roughly 1.5x source consumption (±25% for WSOLA grain granularity).
    assert(consumed > static_cast<size_t>(4800 * 1.2));
    assert(consumed < static_cast<size_t>(4800 * 1.9));
  }

  // 3) Pitch heuristic: 0.75x and 1.25x should keep ~440Hz period near unity.
  {
    auto run = [](double rate) {
      WsolaResampler r;
      r.prepare(2, 48000, 8192);
      r.setRate(rate);
      std::pair<double, size_t> state{0.0, 200000};
      std::vector<float> out(48000 * 2);  // 1s
      size_t filled = 0;
      while (filled < 48000) {
        const size_t chunk = std::min<size_t>(2048, 48000 - filled);
        const size_t got = r.processFn(out.data() + filled * 2, chunk, sinePull, &state);
        if (got == 0) break;
        filled += got;
      }
      return estimatePeriodFrames(out.data(), filled, 2, 48000);
    };

    const double p1 = run(1.0);
    const double p075 = run(0.75);
    const double p125 = run(1.25);
    // 440Hz period ≈ 48000/440 ≈ 109.09 frames
    assert(p1 > 90 && p1 < 130);
    // Pitch-preserving: periods should stay within ~15% of unity (linear rate would scale 0.75/1.25).
    assert(approxEqual(p075, p1, p1 * 0.18));
    assert(approxEqual(p125, p1, p1 * 0.18));
    // Linear resampler at 0.75 would push period toward ~145; ensure we didn't.
    assert(p075 < p1 * 1.25);
  }

  // 4) Reset clears state without crash.
  {
    resampler.reset();
    resampler.setRate(2.0);
    std::pair<double, size_t> state{0.0, 1000};
    std::vector<float> out(256 * 2);
    (void)resampler.processFn(out.data(), 256, sinePull, &state);
    resampler.reset();
    state = {0.0, 1000};
    const size_t got = resampler.processFn(out.data(), 256, sinePull, &state);
    assert(got > 0);
  }

  std::puts("wsola_tests: ok");
  return 0;
}
