#include "IOutputBackend.h"

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
#include "wasapi/WasapiSharedBackend.h"
#endif

namespace twilight::audio {

std::string defaultBackendId() {
#if defined(_WIN32)
  return "wasapi";
#elif defined(__APPLE__)
  return "coreaudio";
#else
  return "alsa";
#endif
}

std::unique_ptr<IOutputBackend> createOutputBackend(const std::string& backendId) {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  if (backendId == "wasapi" || backendId == "wasapi-shared") {
    return std::make_unique<WasapiSharedBackend>();
  }
#else
  (void)backendId;
#endif
  return nullptr;
}

}  // namespace twilight::audio
