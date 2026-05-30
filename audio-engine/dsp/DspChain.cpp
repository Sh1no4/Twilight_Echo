#include <string>

namespace twilight::audio {

bool dspConfigRequiresProcessing(const std::string& json) {
  return json.find("\"eqEnabled\":true") != std::string::npos ||
         json.find("\"volumeNormalization\":\"off\"") == std::string::npos;
}

}  // namespace twilight::audio
