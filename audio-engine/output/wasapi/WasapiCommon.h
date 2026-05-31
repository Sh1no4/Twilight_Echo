#pragma once

#include "../../core/AudioTypes.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <string>
#include <vector>

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <audioclient.h>
#include <ksmedia.h>
#include <mmreg.h>
#endif

namespace twilight::audio::wasapi {

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)

class ComApartment final {
 public:
  ComApartment() {
    hr_ = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (hr_ == RPC_E_CHANGED_MODE) {
      hr_ = S_OK;
      initialized_ = false;
    } else {
      initialized_ = SUCCEEDED(hr_);
    }
  }

  ~ComApartment() {
    if (initialized_) CoUninitialize();
  }

  ComApartment(const ComApartment&) = delete;
  ComApartment& operator=(const ComApartment&) = delete;

  HRESULT result() const { return hr_; }

 private:
  HRESULT hr_ = E_FAIL;
  bool initialized_ = false;
};

class UniqueHandle final {
 public:
  UniqueHandle() = default;
  explicit UniqueHandle(HANDLE handle) : handle_(handle) {}

  ~UniqueHandle() { reset(); }

  UniqueHandle(const UniqueHandle&) = delete;
  UniqueHandle& operator=(const UniqueHandle&) = delete;

  UniqueHandle(UniqueHandle&& other) noexcept : handle_(other.release()) {}

  UniqueHandle& operator=(UniqueHandle&& other) noexcept {
    if (this != &other) reset(other.release());
    return *this;
  }

  HANDLE get() const { return handle_; }
  explicit operator bool() const { return handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE; }

  HANDLE release() {
    HANDLE out = handle_;
    handle_ = nullptr;
    return out;
  }

  void reset(HANDLE handle = nullptr) {
    if (handle_ && handle_ != INVALID_HANDLE_VALUE) CloseHandle(handle_);
    handle_ = handle;
  }

 private:
  HANDLE handle_ = nullptr;
};

inline std::wstring utf8ToWide(const std::string& value) {
  if (value.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
  if (size <= 0) return {};
  std::wstring wide(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, wide.data(), size);
  if (!wide.empty() && wide.back() == L'\0') wide.pop_back();
  return wide;
}

inline std::string wideToUtf8(const wchar_t* value) {
  if (!value) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string out(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value, -1, out.data(), size, nullptr, nullptr);
  if (!out.empty() && out.back() == '\0') out.pop_back();
  return out;
}

inline bool succeeded(HRESULT hr, std::string* error, const char* message) {
  if (SUCCEEDED(hr)) return true;
  if (error) {
    char buffer[160] = {};
    std::snprintf(buffer, sizeof(buffer), "%s (错误码 0x%08lx)", message, static_cast<unsigned long>(hr));
    *error = buffer;
  }
  return false;
}

inline bool isDeviceInvalidated(HRESULT hr) {
  return hr == AUDCLNT_E_DEVICE_INVALIDATED || hr == AUDCLNT_E_RESOURCES_INVALIDATED ||
         hr == AUDCLNT_E_SERVICE_NOT_RUNNING;
}

inline DWORD defaultChannelMask(int channelCount) {
  switch (channelCount) {
    case 1:
      return SPEAKER_FRONT_CENTER;
    case 2:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
    case 4:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT;
    case 6:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER | SPEAKER_LOW_FREQUENCY |
             SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT;
    case 8:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER | SPEAKER_LOW_FREQUENCY |
             SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT | SPEAKER_SIDE_LEFT | SPEAKER_SIDE_RIGHT;
    default:
      return 0;
  }
}

inline REFERENCE_TIME framesToReferenceTime(UINT32 frames, int sampleRate) {
  if (frames == 0 || sampleRate <= 0) return 0;
  return static_cast<REFERENCE_TIME>(
      (static_cast<long double>(frames) * 10000000.0L / static_cast<long double>(sampleRate)) + 0.5L);
}

inline UINT32 referenceTimeToFrames(REFERENCE_TIME duration, int sampleRate) {
  if (duration <= 0 || sampleRate <= 0) return 0;
  return static_cast<UINT32>(
      (static_cast<long double>(duration) * static_cast<long double>(sampleRate) / 10000000.0L) + 0.5L);
}

inline int32_t floatToSignedInt(float sample, int bits) {
  const double clamped = std::clamp(static_cast<double>(sample), -1.0, 1.0);
  if (bits == 16) {
    return static_cast<int32_t>(std::clamp(
        std::llround(clamped * 32768.0),
        static_cast<long long>(std::numeric_limits<int16_t>::min()),
        static_cast<long long>(std::numeric_limits<int16_t>::max())));
  }
  if (bits == 24) {
    return static_cast<int32_t>(std::clamp(
        std::llround(clamped * 8388608.0),
        -8388608LL,
        8388607LL));
  }
  const long long value = std::clamp(
      std::llround(clamped * 2147483648.0),
      static_cast<long long>(std::numeric_limits<int32_t>::min()),
      static_cast<long long>(std::numeric_limits<int32_t>::max()));
  return static_cast<int32_t>(value);
}

inline void packFloatToPcm(
    const float* input,
    size_t frameCount,
    int channelCount,
    AudioSampleFormat sampleFormat,
    BYTE* output) {
  if (!input || !output || frameCount == 0 || channelCount <= 0) return;

  const size_t sampleCount = frameCount * static_cast<size_t>(channelCount);
  switch (sampleFormat) {
    case AudioSampleFormat::Int16Interleaved: {
      auto* out = reinterpret_cast<int16_t*>(output);
      for (size_t i = 0; i < sampleCount; ++i) {
        out[i] = static_cast<int16_t>(floatToSignedInt(input[i], 16));
      }
      break;
    }
    case AudioSampleFormat::Int24Interleaved: {
      for (size_t i = 0; i < sampleCount; ++i) {
        const auto value = static_cast<uint32_t>(floatToSignedInt(input[i], 24));
        output[i * 3 + 0] = static_cast<BYTE>(value & 0xff);
        output[i * 3 + 1] = static_cast<BYTE>((value >> 8) & 0xff);
        output[i * 3 + 2] = static_cast<BYTE>((value >> 16) & 0xff);
      }
      break;
    }
    case AudioSampleFormat::Int24In32Interleaved: {
      auto* out = reinterpret_cast<int32_t*>(output);
      for (size_t i = 0; i < sampleCount; ++i) {
        out[i] = static_cast<int32_t>(static_cast<uint32_t>(floatToSignedInt(input[i], 24)) << 8);
      }
      break;
    }
    case AudioSampleFormat::Int32Interleaved: {
      auto* out = reinterpret_cast<int32_t*>(output);
      for (size_t i = 0; i < sampleCount; ++i) {
        out[i] = floatToSignedInt(input[i], 32);
      }
      break;
    }
    case AudioSampleFormat::Float32Interleaved:
    default:
      std::fill(output, output + sampleCount * sizeof(float), 0);
      break;
  }
}

#endif

}  // namespace twilight::audio::wasapi
