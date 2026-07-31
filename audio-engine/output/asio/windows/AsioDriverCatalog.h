#pragma once

#include <optional>
#include <string>
#include <vector>

namespace twilight::audio::asio_windows {

struct AsioDriverEntry {
  std::string id;
  std::string displayName;
  std::string clsid;
};

class AsioDriverCatalog final {
 public:
  static std::vector<AsioDriverEntry> enumerate();
  static std::optional<AsioDriverEntry> resolve(const std::string& id);
};

}  // namespace twilight::audio::asio_windows
