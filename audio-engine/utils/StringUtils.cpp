#include <string>

namespace twilight::audio {

std::string nullToEmpty(const char* value) {
  return value ? std::string(value) : std::string();
}

}  // namespace twilight::audio
