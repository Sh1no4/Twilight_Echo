#pragma once

#include "../core/AudioTypes.h"

#include <cstddef>
#include <complex>
#include <mutex>
#include <string>
#include <vector>

namespace twilight::audio {

class FftSpectrumAnalyzer {
 public:
  void prepare(const AudioFormat& format, size_t resolution);
  // Configure the decoupled oscilloscope ring buffer size (clamped to
  // [64, 4096], default 1024). Independent of fftResolution so the
  // visualization tap can serve high-resolution time-domain samples.
  void prepareOscilloscope(size_t points);
  void setEnabled(bool enabled);
  void resetCapture();
  void capture(const float* interleaved, size_t frames, int channels);
  size_t read(float* output, size_t points, double idlePhase = 0.0) const;
  std::string readVisualizationJson(
      size_t spectrumPoints,
      size_t waveformPoints,
      size_t spectrogramFrames,
      size_t oscilloscopePoints = 1024) const;
  bool isActive() const;

 private:
  void updateSpectrumLocked() const;

  mutable std::mutex mutex_;
  AudioFormat format_;
  size_t resolution_ = 64;
  size_t oscilloscopeResolution_ = 1024;
  bool enabled_ = true;
  bool hasCapture_ = false;
  bool captureBuffersSilent_ = true;
  mutable bool spectrumDirty_ = false;
  double peakDb_ = -120.0;
  double rmsDb_ = -120.0;
  double lufsMomentary_ = -70.0;
  std::vector<float> window_;
  std::vector<float> timeDomain_;
  std::vector<float> oscilloscopeBuffer_;
  mutable std::vector<float> fftInputScratch_;
  mutable std::vector<std::complex<float>> spectrumScratch_;
  mutable std::vector<float> magnitudes_;
  mutable std::vector<std::vector<float>> spectrogram_;
};

void fillIdleSpectrum(float* buffer, size_t count, double phase);

}  // namespace twilight::audio
