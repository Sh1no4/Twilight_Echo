#include "IOutputBackend.h"

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
#include "wasapi/WasapiExclusiveBackend.h"
#include "wasapi/WasapiSharedBackend.h"
#endif

#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
#include "asio/AsioBackend.h"
#endif

#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
#include "coreaudio/CoreAudioBackend.h"
#endif

#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
#include "alsa/AlsaBackend.h"
#endif

namespace twilight::audio {

std::string defaultBackendId() {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  return "wasapi";
#elif defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  return "asio";
#elif defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
  return "coreaudio";
#elif defined(__linux__) && defined(TAE_ENABLE_ALSA)
  return "alsa";
#else
  return {};
#endif
}

std::unique_ptr<IOutputBackend> createOutputBackend(const std::string& backendId) {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  if (backendId == "wasapi" || backendId == "wasapi-shared") {
    return std::make_unique<WasapiSharedBackend>();
  }
  if (backendId == "wasapi-exclusive") {
    return std::make_unique<WasapiExclusiveBackend>();
  }
#endif
#if defined(_WIN32) && defined(TAE_ENABLE_ASIO)
  if (backendId == "asio") {
    return std::make_unique<AsioBackend>();
  }
#endif
#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
  if (backendId == "coreaudio") {
    return std::make_unique<CoreAudioBackend>();
  }
#endif
#if defined(__linux__) && defined(TAE_ENABLE_ALSA)
  if (backendId == "alsa") {
    return std::make_unique<AlsaBackend>();
  }
#endif
  return nullptr;
}

}  // namespace twilight::audio
