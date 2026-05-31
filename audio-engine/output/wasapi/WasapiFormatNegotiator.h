#pragma once

#include "../../core/AudioTypes.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <audioclient.h>
#endif

namespace twilight::audio {

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)

class WasapiFormatNegotiator final {
 public:
  explicit WasapiFormatNegotiator(IAudioClient* audioClient);

  bool negotiate(const AudioFormat& sourceFormat, std::string* error);

  const AudioFormat& outputFormat() const;
  const OutputInfo& outputInfo() const;
  const WAVEFORMATEX* waveFormat() const;
  size_t waveFormatSize() const;

 private:
  struct Candidate;

  std::vector<Candidate> buildCandidates(const AudioFormat& sourceFormat) const;
  bool isSupported(const Candidate& candidate) const;
  bool sameSourceFormat(const AudioFormat& sourceFormat, const AudioFormat& outputFormat) const;

  IAudioClient* audioClient_ = nullptr;
  AudioFormat outputFormat_;
  OutputInfo outputInfo_;
  std::vector<uint8_t> waveFormatBytes_;
};

#endif

}  // namespace twilight::audio
