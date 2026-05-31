#include "AudioMetadataService.h"

#include <cassert>
#include <string>

using namespace twilight::audio;

int main() {
  const std::string empty = readMetadataJson("");
  assert(empty.find("\"error\":\"音频地址为空\"") != std::string::npos);

  const std::string missing = readMetadataJson("missing-file.flac");
  assert(missing.find("\"source\":\"missing-file.flac\"") != std::string::npos);
  assert(missing.find("\"composer\"") != std::string::npos);
  assert(missing.find("\"albumArtist\"") != std::string::npos);
  assert(missing.find("\"trackNumber\"") != std::string::npos);
  assert(missing.find("\"discNumber\"") != std::string::npos);
  assert(missing.find("\"comment\"") != std::string::npos);
  return 0;
}
