#include "dsp/WsolaResampler.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace twilight::audio {
namespace {

constexpr double kMinRate = 0.5;
constexpr double kMaxRate = 2.0;
constexpr double kWindowMs = 32.0;
constexpr double kSearchMs = 12.0;

float hann(int i, int n) {
  if (n <= 1) return 1.0f;
  return 0.5f *
         (1.0f - std::cos(
                     2.0f * 3.14159265358979323846f * static_cast<float>(i) /
                     static_cast<float>(n - 1)));
}

}  // namespace

void WsolaResampler::prepare(int channelCount, int sampleRate, size_t maxOutFrames) {
  channels_ = std::max(1, channelCount);
  sampleRate_ = std::max(1, sampleRate);
  windowFrames_ = std::max(64, static_cast<int>(std::lround(sampleRate_ * kWindowMs / 1000.0)));
  if (windowFrames_ % 2 != 0) ++windowFrames_;
  analysisHop_ = std::max(1, windowFrames_ / 2);
  searchRadius_ = std::max(8, static_cast<int>(std::lround(sampleRate_ * kSearchMs / 1000.0)));

  window_.assign(static_cast<size_t>(windowFrames_), 0.0f);
  for (int i = 0; i < windowFrames_; ++i) window_[static_cast<size_t>(i)] = hann(i, windowFrames_);

  grainA_.assign(static_cast<size_t>(windowFrames_ * channels_), 0.0f);
  // Mix staging needs room for ola tail + new grain.
  grainB_.assign(static_cast<size_t>(windowFrames_ * 2 * channels_), 0.0f);
  olaTail_.assign(static_cast<size_t>(windowFrames_ * 2 * channels_), 0.0f);

  const size_t need =
      static_cast<size_t>(windowFrames_ * 4 + searchRadius_ * 2) +
      std::max<size_t>(maxOutFrames * 2, 2048);
  inputCapacity_ = need;
  input_.assign(inputCapacity_ * static_cast<size_t>(channels_), 0.0f);
  pullScratch_.assign(std::max<size_t>(512, maxOutFrames) * static_cast<size_t>(channels_), 0.0f);
  reset();
}

void WsolaResampler::setRate(double rate) noexcept {
  if (!std::isfinite(rate)) return;
  rate_ = std::clamp(rate, kMinRate, kMaxRate);
}

void WsolaResampler::reset() noexcept {
  inputRead_ = 0;
  inputWrite_ = 0;
  inputCount_ = 0;
  olaTailFrames_ = 0;
  sourceCursor_ = 0.0;
  if (!olaTail_.empty()) std::fill(olaTail_.begin(), olaTail_.end(), 0.0f);
}

const float* WsolaResampler::inputFrame(size_t index) const noexcept {
  const size_t abs = (inputRead_ + index) % inputCapacity_;
  return input_.data() + abs * static_cast<size_t>(channels_);
}

void WsolaResampler::pushInput(const float* src, size_t frames) {
  if (frames == 0 || inputCapacity_ == 0) return;
  const size_t ch = static_cast<size_t>(channels_);
  for (size_t i = 0; i < frames; ++i) {
    if (inputCount_ >= inputCapacity_) {
      inputRead_ = (inputRead_ + 1) % inputCapacity_;
      --inputCount_;
      if (sourceCursor_ >= 1.0) sourceCursor_ -= 1.0;
      else sourceCursor_ = 0.0;
    }
    const size_t writeIndex = inputWrite_ % inputCapacity_;
    std::memcpy(input_.data() + writeIndex * ch, src + i * ch, ch * sizeof(float));
    inputWrite_ = (inputWrite_ + 1) % inputCapacity_;
    ++inputCount_;
  }
}

void WsolaResampler::popInput(size_t frames) {
  if (frames == 0) return;
  const size_t consume = std::min(frames, inputCount_);
  inputRead_ = (inputRead_ + consume) % inputCapacity_;
  inputCount_ -= consume;
}

int WsolaResampler::findBestOffset(size_t searchCenter, int searchRadius, int templateLen) const noexcept {
  if (templateLen <= 4 || inputCount_ < static_cast<size_t>(templateLen + searchRadius * 2 + 1)) {
    return 0;
  }
  const int ch = channels_;
  double bestScore = -1.0e300;
  int bestOffset = 0;

  double templateEnergy = 0.0;
  for (int i = 0; i < templateLen; ++i) {
    const float* f = inputFrame(searchCenter + static_cast<size_t>(i));
    for (int c = 0; c < ch; ++c) {
      const double v = f[c];
      templateEnergy += v * v;
    }
  }
  if (templateEnergy < 1.0e-12) return 0;

  for (int offset = -searchRadius; offset <= searchRadius; ++offset) {
    const int start = static_cast<int>(searchCenter) + offset;
    if (start < 0) continue;
    if (static_cast<size_t>(start + templateLen) > inputCount_) continue;
    double corr = 0.0;
    double candEnergy = 0.0;
    for (int i = 0; i < templateLen; ++i) {
      const float* a = inputFrame(searchCenter + static_cast<size_t>(i));
      const float* b = inputFrame(static_cast<size_t>(start + i));
      for (int c = 0; c < ch; ++c) {
        const double av = a[c];
        const double bv = b[c];
        corr += av * bv;
        candEnergy += bv * bv;
      }
    }
    if (candEnergy < 1.0e-12) continue;
    const double score = corr / std::sqrt(templateEnergy * candEnergy);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  return bestOffset;
}

void WsolaResampler::synthesizeGrain(float* grain, int grainLen, size_t inputOffset) const noexcept {
  const int ch = channels_;
  for (int i = 0; i < grainLen; ++i) {
    const float w = window_[static_cast<size_t>(i)];
    const float* src = inputFrame(inputOffset + static_cast<size_t>(i));
    float* dst = grain + static_cast<size_t>(i * ch);
    for (int c = 0; c < ch; ++c) dst[c] = src[c] * w;
  }
}

void WsolaResampler::advanceRead(double sourceFrames) noexcept {
  sourceCursor_ += sourceFrames;
  const size_t whole = static_cast<size_t>(sourceCursor_);
  if (whole == 0) return;
  const size_t consume = std::min(whole, inputCount_);
  popInput(consume);
  sourceCursor_ -= static_cast<double>(consume);
}

size_t WsolaResampler::processFn(
    float* output,
    size_t outFrames,
    size_t (*pullSource)(void* ctx, float* dst, size_t maxFrames),
    void* pullCtx) {
  return process(output, outFrames, [&](float* dst, size_t maxFrames) -> size_t {
    if (!pullSource) return 0;
    return pullSource(pullCtx, dst, maxFrames);
  });
}

}  // namespace twilight::audio
