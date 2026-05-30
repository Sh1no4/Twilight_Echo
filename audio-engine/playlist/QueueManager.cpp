#include <string>

namespace twilight::audio {

bool queueJsonLooksValid(const std::string& json) {
  return json.empty() || json.front() == '[';
}

}  // namespace twilight::audio
