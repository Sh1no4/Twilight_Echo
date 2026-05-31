#pragma once

#include <complex>
#include <cstddef>
#include <vector>

namespace twilight::audio {

class KissFftAdapter {
 public:
  using Complex = std::complex<float>;

  static size_t nextPowerOfTwo(size_t value);
  static void forward(const std::vector<float>& input, std::vector<Complex>* output);
  static void forwardComplex(std::vector<Complex>* data);
  static void inverse(std::vector<Complex>* data);
};

}  // namespace twilight::audio
