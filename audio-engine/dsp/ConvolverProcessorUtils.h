#pragma once

#include <algorithm>
#include <cstddef>
#include <vector>

namespace twilight::audio::convolver {

inline void writeInputBlockToPaddedScratch(
    const std::vector<float>& inputBlock,
    std::vector<float>& paddedScratch,
    size_t partitionSize,
    size_t fftSize) {
  if (paddedScratch.size() != fftSize) paddedScratch.resize(fftSize);
  const size_t copied = std::min({partitionSize, inputBlock.size(), paddedScratch.size()});
  std::copy_n(inputBlock.begin(), copied, paddedScratch.begin());
  if (copied < paddedScratch.size()) {
    std::fill(paddedScratch.begin() + static_cast<std::ptrdiff_t>(copied), paddedScratch.end(), 0.0f);
  }
}

inline void writeImpulsePartitionToPaddedScratch(
    const std::vector<float>& impulse,
    size_t offset,
    std::vector<float>& paddedScratch,
    size_t partitionSize,
    size_t fftSize) {
  if (paddedScratch.size() != fftSize) paddedScratch.resize(fftSize);
  const size_t available = offset < impulse.size() ? impulse.size() - offset : 0;
  const size_t copied = std::min({partitionSize, available, paddedScratch.size()});
  if (copied > 0) {
    std::copy_n(impulse.begin() + static_cast<std::ptrdiff_t>(offset), copied, paddedScratch.begin());
  }
  if (copied < paddedScratch.size()) {
    std::fill(paddedScratch.begin() + static_cast<std::ptrdiff_t>(copied), paddedScratch.end(), 0.0f);
  }
}

template <typename Complex>
inline void writePartitionedSpectrumProduct(
    const std::vector<std::vector<Complex>>& inputHistory,
    const std::vector<std::vector<Complex>>& impulsePartitions,
    size_t currentIndex,
    size_t fftSize,
    std::vector<Complex>& spectrumScratch) {
  const size_t partitionCount = std::min(inputHistory.size(), impulsePartitions.size());
  if (partitionCount == 0 || fftSize == 0) {
    spectrumScratch.clear();
    return;
  }

  if (spectrumScratch.size() != fftSize) spectrumScratch.resize(fftSize);
  for (size_t partition = 0; partition < partitionCount; ++partition) {
    const size_t historyIndex = (currentIndex + partition) % partitionCount;
    const auto& inputSpectrum = inputHistory[historyIndex];
    const auto& irSpectrum = impulsePartitions[partition];
    if (partition == 0) {
      for (size_t bin = 0; bin < fftSize; ++bin) {
        spectrumScratch[bin] = inputSpectrum[bin] * irSpectrum[bin];
      }
    } else {
      for (size_t bin = 0; bin < fftSize; ++bin) {
        spectrumScratch[bin] += inputSpectrum[bin] * irSpectrum[bin];
      }
    }
  }
}

}  // namespace twilight::audio::convolver
