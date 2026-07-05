#pragma once

#include "KissFftAdapter.h"

#include <cstddef>
#include <vector>

namespace twilight::audio::fft {

inline void resizeComplexOutputForOverwrite(std::vector<KissFftAdapter::Complex>& output, size_t size) {
  if (output.size() != size) output.resize(size);
}

}  // namespace twilight::audio::fft
