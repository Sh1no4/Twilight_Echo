#include "KissFftAdapter.h"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace twilight::audio {

size_t KissFftAdapter::nextPowerOfTwo(size_t value) {
  if (value <= 1) return 1;
  --value;
  for (size_t shift = 1; shift < sizeof(size_t) * 8; shift <<= 1) {
    value |= value >> shift;
  }
  return value + 1;
}

void KissFftAdapter::forward(const std::vector<float>& input, std::vector<Complex>* output) {
  if (!output) return;
  output->assign(input.size(), {});
  for (size_t i = 0; i < input.size(); ++i) {
    (*output)[i] = Complex(input[i], 0.0f);
  }
  forwardComplex(output);
}

void KissFftAdapter::forwardComplex(std::vector<Complex>* data) {
  if (!data || data->empty()) return;
  const size_t n = data->size();
  if ((n & (n - 1)) != 0) return;

  for (size_t i = 1, j = 0; i < n; ++i) {
    size_t bit = n >> 1;
    for (; (j & bit) != 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) std::swap((*data)[i], (*data)[j]);
  }

  for (size_t len = 2; len <= n; len <<= 1) {
    const float angle = static_cast<float>(-2.0 * std::numbers::pi / static_cast<double>(len));
    const Complex root(std::cos(angle), std::sin(angle));
    for (size_t i = 0; i < n; i += len) {
      Complex w(1.0f, 0.0f);
      for (size_t j = 0; j < len / 2; ++j) {
        const Complex u = (*data)[i + j];
        const Complex v = (*data)[i + j + len / 2] * w;
        (*data)[i + j] = u + v;
        (*data)[i + j + len / 2] = u - v;
        w *= root;
      }
    }
  }
}

void KissFftAdapter::inverse(std::vector<Complex>* data) {
  if (!data || data->empty()) return;
  for (auto& value : *data) value = std::conj(value);
  forwardComplex(data);
  const float scale = 1.0f / static_cast<float>(data->size());
  for (auto& value : *data) value = std::conj(value) * scale;
}

}  // namespace twilight::audio
