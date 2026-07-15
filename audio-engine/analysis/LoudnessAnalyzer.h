#pragma once

#include <string>

namespace twilight::audio {

// Offline EBU R128 analysis (integrated LUFS + true peak). Returns JSON.
// Without TAE_HAS_EBUR128, returns {"error":"...","available":false}.
std::string analyzeLoudnessJson(const std::string& source, const std::string& optionsJson);

}  // namespace twilight::audio
