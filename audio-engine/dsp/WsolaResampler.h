#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace twilight::audio {

/**
 * RT-oriented WSOLA (Waveform Similarity Overlap-Add) rate changer.
 * Preserves pitch while stretching/compressing time for rates in [0.5, 2.0].
 * Not an IAudioProcessor (variable input/output frame counts).
 *
 * Render-thread only: no locks, no allocations after prepare().
 * `process` is a template so the puller can be an inlined lambda (no type erasure).
 */
class WsolaResampler {
 public:
  void prepare(int channelCount, int sampleRate, size_t maxOutFrames);
  void setRate(double rate) noexcept;
  void reset() noexcept;

  /**
   * Emit `outFrames` interleaved samples into `output`.
   * `pull(dst, maxFrames)` writes up to maxFrames interleaved frames and returns
   * the number written (0 = underrun/EOS).
   */
  template <typename PullFn>
  size_t process(float* output, size_t outFrames, PullFn&& pull);

  /** C-style wrapper for tests / FFI. */
  size_t processFn(
      float* output,
      size_t outFrames,
      size_t (*pullSource)(void* ctx, float* dst, size_t maxFrames),
      void* pullCtx);

  double rate() const noexcept { return rate_; }
  bool prepared() const noexcept { return channels_ > 0 && sampleRate_ > 0; }

 private:
  template <typename PullFn>
  void ensureInput(size_t neededFrames, PullFn&& pull);
  void pushInput(const float* src, size_t frames);
  void popInput(size_t frames);
  const float* inputFrame(size_t index) const noexcept;
  int findBestOffset(size_t searchCenter, int searchRadius, int templateLen) const noexcept;
  void synthesizeGrain(float* grain, int grainLen, size_t inputOffset) const noexcept;
  void advanceRead(double sourceFrames) noexcept;

  template <typename PullFn>
  size_t processImpl(float* output, size_t outFrames, PullFn&& pull);

  int channels_ = 0;
  int sampleRate_ = 0;
  double rate_ = 1.0;

  std::vector<float> input_;
  size_t inputCapacity_ = 0;
  size_t inputRead_ = 0;
  size_t inputWrite_ = 0;
  size_t inputCount_ = 0;

  int windowFrames_ = 0;
  int analysisHop_ = 0;
  int searchRadius_ = 0;
  std::vector<float> window_;
  std::vector<float> grainA_;
  std::vector<float> grainB_;  // OLA mix staging (length >= 2 * window)
  std::vector<float> olaTail_;
  int olaTailFrames_ = 0;
  double sourceCursor_ = 0.0;
  std::vector<float> pullScratch_;
};

template <typename PullFn>
size_t WsolaResampler::process(float* output, size_t outFrames, PullFn&& pull) {
  return processImpl(output, outFrames, static_cast<PullFn&&>(pull));
}

template <typename PullFn>
void WsolaResampler::ensureInput(size_t neededFrames, PullFn&& pull) {
  while (inputCount_ < neededFrames) {
    if (pullScratch_.empty()) break;
    const size_t freeFrames = inputCapacity_ > inputCount_ ? inputCapacity_ - inputCount_ : 0;
    if (freeFrames == 0) break;
    const size_t pullCap = pullScratch_.size() / static_cast<size_t>(channels_);
    const size_t want = freeFrames < pullCap ? (freeFrames < 512 ? freeFrames : 512) : (pullCap < 512 ? pullCap : 512);
    const size_t got = pull(pullScratch_.data(), want);
    if (got == 0) break;
    pushInput(pullScratch_.data(), got);
  }
}

template <typename PullFn>
size_t WsolaResampler::processImpl(float* output, size_t outFrames, PullFn&& pull) {
  if (!output || outFrames == 0 || !prepared()) return 0;

  if (rate_ > 0.999999 && rate_ < 1.000001) {
    size_t filled = 0;
    while (filled < outFrames) {
      ensureInput(outFrames - filled, pull);
      if (inputCount_ == 0) break;
      const size_t take = outFrames - filled < inputCount_ ? outFrames - filled : inputCount_;
      const size_t ch = static_cast<size_t>(channels_);
      for (size_t i = 0; i < take; ++i) {
        const float* src = inputFrame(i);
        float* dst = output + (filled + i) * ch;
        for (size_t c = 0; c < ch; ++c) dst[c] = src[c];
      }
      popInput(take);
      filled += take;
    }
    if (filled < outFrames) {
      const size_t ch = static_cast<size_t>(channels_);
      for (size_t i = filled * ch; i < outFrames * ch; ++i) output[i] = 0.0f;
    }
    return filled;
  }

  const int ch = channels_;
  const int grainLen = windowFrames_;
  const int hopOut = analysisHop_;
  const double hopIn = static_cast<double>(hopOut) * rate_;

  size_t filled = 0;
  while (filled < outFrames) {
    if (olaTailFrames_ > 0) {
      const size_t take = static_cast<size_t>(olaTailFrames_) < (outFrames - filled)
                              ? static_cast<size_t>(olaTailFrames_)
                              : (outFrames - filled);
      for (size_t i = 0; i < take; ++i) {
        float* dst = output + (filled + i) * static_cast<size_t>(ch);
        const float* src = olaTail_.data() + i * static_cast<size_t>(ch);
        for (int c = 0; c < ch; ++c) dst[c] = src[c];
      }
      const int remain = olaTailFrames_ - static_cast<int>(take);
      if (remain > 0) {
        for (int i = 0; i < remain * ch; ++i) {
          olaTail_[static_cast<size_t>(i)] = olaTail_[take * static_cast<size_t>(ch) + static_cast<size_t>(i)];
        }
      }
      olaTailFrames_ = remain;
      filled += take;
      continue;
    }

    const size_t need = static_cast<size_t>(grainLen + searchRadius_ * 2 + 64);
    ensureInput(need, pull);
    if (inputCount_ < static_cast<size_t>(grainLen + 2)) {
      const size_t chs = static_cast<size_t>(ch);
      for (size_t i = filled * chs; i < outFrames * chs; ++i) output[i] = 0.0f;
      break;
    }

    const size_t natural = sourceCursor_ > 0.0 ? static_cast<size_t>(sourceCursor_) : 0;
    const size_t maxCenter =
        inputCount_ > static_cast<size_t>(grainLen) ? inputCount_ - static_cast<size_t>(grainLen) : 0;
    const size_t searchCenter = natural < maxCenter ? natural : maxCenter;
    const int templateLen = grainLen / 2 > 16 ? grainLen / 2 : 16;
    const int bestOffset = findBestOffset(searchCenter, searchRadius_, templateLen);
    int grainStart = static_cast<int>(searchCenter) + bestOffset;
    if (grainStart < 0) grainStart = 0;
    if (grainStart + grainLen > static_cast<int>(inputCount_)) {
      grainStart = static_cast<int>(inputCount_) - grainLen;
    }
    if (grainStart < 0) grainStart = 0;

    synthesizeGrain(grainA_.data(), grainLen, static_cast<size_t>(grainStart));

    const int mixLen = olaTailFrames_ > grainLen ? olaTailFrames_ : grainLen;
    // grainB_ sized for 2*window in prepare
    for (int i = 0; i < mixLen * ch; ++i) grainB_[static_cast<size_t>(i)] = 0.0f;
    for (int i = 0; i < olaTailFrames_; ++i) {
      for (int c = 0; c < ch; ++c) {
        grainB_[static_cast<size_t>(i * ch + c)] = olaTail_[static_cast<size_t>(i * ch + c)];
      }
    }
    for (int i = 0; i < grainLen; ++i) {
      for (int c = 0; c < ch; ++c) {
        grainB_[static_cast<size_t>(i * ch + c)] += grainA_[static_cast<size_t>(i * ch + c)];
      }
    }

    const int writeFrames =
        hopOut < static_cast<int>(outFrames - filled) ? hopOut : static_cast<int>(outFrames - filled);
    for (int i = 0; i < writeFrames; ++i) {
      float* dst = output + (filled + static_cast<size_t>(i)) * static_cast<size_t>(ch);
      for (int c = 0; c < ch; ++c) dst[c] = grainB_[static_cast<size_t>(i * ch + c)];
    }

    const int newTailStart = writeFrames;
    const int newTailLen = mixLen - newTailStart;
    if (newTailLen > 0) {
      for (int i = 0; i < newTailLen * ch; ++i) {
        olaTail_[static_cast<size_t>(i)] =
            grainB_[static_cast<size_t>(newTailStart * ch + i)];
      }
      olaTailFrames_ = newTailLen;
    } else {
      olaTailFrames_ = 0;
    }
    filled += static_cast<size_t>(writeFrames);
    advanceRead(hopIn);
  }
  return filled;
}

}  // namespace twilight::audio
