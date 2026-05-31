#include "WasapiFormatNegotiator.h"

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
#include "WasapiCommon.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <set>
#include <tuple>

#include <ksmedia.h>
#include <mmreg.h>

namespace twilight::audio {
namespace {

constexpr std::array<int, 8> kSupportedSampleRates = {
    44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000};

const GUID kPcmSubFormat = {
    0x00000001, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};

int normalizeBitDepth(int bitDepth) {
  if (bitDepth <= 16) return 16;
  if (bitDepth <= 24) return 24;
  return 32;
}

std::array<int, 3> bitDepthPriority(int sourceBitDepth) {
  switch (normalizeBitDepth(sourceBitDepth)) {
    case 16:
      return {16, 24, 32};
    case 24:
      return {24, 32, 16};
    case 32:
    default:
      return {32, 24, 16};
  }
}

int sampleRateFamily(int sampleRate) {
  if (sampleRate > 0 && sampleRate % 44100 == 0) return 44100;
  if (sampleRate > 0 && sampleRate % 48000 == 0) return 48000;
  return 0;
}

std::vector<int> sampleRatePriority(int sourceSampleRate) {
  std::vector<int> result;
  auto append = [&](int sampleRate) {
    if (std::find(result.begin(), result.end(), sampleRate) == result.end()) result.push_back(sampleRate);
  };

  if (std::find(kSupportedSampleRates.begin(), kSupportedSampleRates.end(), sourceSampleRate) !=
      kSupportedSampleRates.end()) {
    append(sourceSampleRate);
  }

  const int family = sampleRateFamily(sourceSampleRate);
  if (family != 0) {
    for (int sampleRate : kSupportedSampleRates) {
      if (sampleRateFamily(sampleRate) == family && sampleRate > sourceSampleRate) append(sampleRate);
    }
    for (auto it = kSupportedSampleRates.rbegin(); it != kSupportedSampleRates.rend(); ++it) {
      if (sampleRateFamily(*it) == family && *it < sourceSampleRate) append(*it);
    }
  }

  std::vector<int> remaining(kSupportedSampleRates.begin(), kSupportedSampleRates.end());
  std::sort(remaining.begin(), remaining.end(), [&](int left, int right) {
    const int leftDistance = std::abs(left - sourceSampleRate);
    const int rightDistance = std::abs(right - sourceSampleRate);
    if (leftDistance != rightDistance) return leftDistance < rightDistance;
    return left > right;
  });
  for (int sampleRate : remaining) append(sampleRate);

  return result;
}

struct FormatVariant {
  int bitDepth = 0;
  int containerBits = 0;
  AudioSampleFormat sampleFormat = AudioSampleFormat::Int16Interleaved;
};

std::vector<FormatVariant> formatVariants(int bitDepth) {
  if (bitDepth == 16) {
    return {{16, 16, AudioSampleFormat::Int16Interleaved}};
  }
  if (bitDepth == 24) {
    return {
        {24, 24, AudioSampleFormat::Int24Interleaved},
        {24, 32, AudioSampleFormat::Int24In32Interleaved},
    };
  }
  return {{32, 32, AudioSampleFormat::Int32Interleaved}};
}

std::vector<uint8_t> makeWaveFormatBytes(int sampleRate, int channelCount, const FormatVariant& variant) {
  WAVEFORMATEXTENSIBLE format{};
  format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
  format.Format.nChannels = static_cast<WORD>(std::max(1, channelCount));
  format.Format.nSamplesPerSec = static_cast<DWORD>(sampleRate);
  format.Format.wBitsPerSample = static_cast<WORD>(variant.containerBits);
  format.Format.nBlockAlign = static_cast<WORD>(format.Format.nChannels * (format.Format.wBitsPerSample / 8));
  format.Format.nAvgBytesPerSec = format.Format.nSamplesPerSec * format.Format.nBlockAlign;
  format.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
  format.Samples.wValidBitsPerSample = static_cast<WORD>(variant.bitDepth);
  format.dwChannelMask = wasapi::defaultChannelMask(channelCount);
  format.SubFormat = kPcmSubFormat;

  std::vector<uint8_t> bytes(sizeof(WAVEFORMATEXTENSIBLE));
  std::memcpy(bytes.data(), &format, sizeof(format));
  return bytes;
}

}  // namespace

struct WasapiFormatNegotiator::Candidate {
  AudioFormat outputFormat;
  std::vector<uint8_t> waveFormatBytes;
};

WasapiFormatNegotiator::WasapiFormatNegotiator(IAudioClient* audioClient) : audioClient_(audioClient) {}

bool WasapiFormatNegotiator::negotiate(const AudioFormat& sourceFormat, std::string* error) {
  if (!audioClient_) {
    if (error) *error = "音频客户端尚未初始化";
    return false;
  }
  if (sourceFormat.sampleRate <= 0 || sourceFormat.channelCount <= 0) {
    if (error) *error = "源音频格式无效";
    return false;
  }

  for (const Candidate& candidate : buildCandidates(sourceFormat)) {
    if (!isSupported(candidate)) continue;

    outputFormat_ = candidate.outputFormat;
    waveFormatBytes_ = candidate.waveFormatBytes;
    outputInfo_.exclusive = true;
    outputInfo_.supportsBitPerfect = true;
    outputInfo_.bitPerfect = false;
    outputInfo_.resampled = !sameSourceFormat(sourceFormat, outputFormat_);
    outputInfo_.resampleReason = outputInfo_.resampled ? "WASAPI 独占输出格式已协商为设备支持格式" : "";
    outputInfo_.outputSampleRate = outputFormat_.sampleRate;
    outputInfo_.outputBitDepth = outputFormat_.bitDepth;
    outputInfo_.backend = "wasapi-exclusive";
    outputInfo_.actualBackend = "wasapi-exclusive";
    outputInfo_.deviceName.clear();
    outputInfo_.actualDeviceName.clear();
    outputInfo_.actualOutputFormat = "pcm";
    outputInfo_.actualSampleRate = outputFormat_.sampleRate;
    outputInfo_.actualBitDepth = outputFormat_.bitDepth;
    outputInfo_.actualChannels = outputFormat_.channelCount;
    return true;
  }

  if (error) *error = "设备不支持当前音频格式的独占输出";
  return false;
}

const AudioFormat& WasapiFormatNegotiator::outputFormat() const {
  return outputFormat_;
}

const OutputInfo& WasapiFormatNegotiator::outputInfo() const {
  return outputInfo_;
}

const WAVEFORMATEX* WasapiFormatNegotiator::waveFormat() const {
  return reinterpret_cast<const WAVEFORMATEX*>(waveFormatBytes_.data());
}

size_t WasapiFormatNegotiator::waveFormatSize() const {
  return waveFormatBytes_.size();
}

std::vector<WasapiFormatNegotiator::Candidate> WasapiFormatNegotiator::buildCandidates(
    const AudioFormat& sourceFormat) const {
  std::vector<Candidate> candidates;
  std::set<std::tuple<int, int, AudioSampleFormat>> seen;

  for (int sampleRate : sampleRatePriority(sourceFormat.sampleRate)) {
    for (int bitDepth : bitDepthPriority(sourceFormat.bitDepth)) {
      for (const FormatVariant& variant : formatVariants(bitDepth)) {
        const auto key = std::make_tuple(sampleRate, variant.containerBits, variant.sampleFormat);
        if (!seen.insert(key).second) continue;

        Candidate candidate;
        candidate.outputFormat.sampleRate = sampleRate;
        candidate.outputFormat.channelCount = sourceFormat.channelCount;
        candidate.outputFormat.bitDepth = variant.bitDepth;
        candidate.outputFormat.sampleFormat = variant.sampleFormat;
        candidate.waveFormatBytes = makeWaveFormatBytes(sampleRate, sourceFormat.channelCount, variant);
        candidates.push_back(std::move(candidate));
      }
    }
  }

  return candidates;
}

bool WasapiFormatNegotiator::isSupported(const Candidate& candidate) const {
  const auto* format = reinterpret_cast<const WAVEFORMATEX*>(candidate.waveFormatBytes.data());
  return audioClient_->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, format, nullptr) == S_OK;
}

bool WasapiFormatNegotiator::sameSourceFormat(const AudioFormat& sourceFormat, const AudioFormat& outputFormat) const {
  return sourceFormat.sampleRate == outputFormat.sampleRate &&
         sourceFormat.channelCount == outputFormat.channelCount &&
         normalizeBitDepth(sourceFormat.bitDepth) == outputFormat.bitDepth;
}

}  // namespace twilight::audio

#endif
