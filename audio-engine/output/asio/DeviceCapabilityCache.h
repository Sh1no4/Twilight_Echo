#pragma once

#include "IAsioHost.h"

#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace twilight::audio {

class DeviceCapabilityCache final {
 public:
  static DeviceCapabilityCache& instance();

  std::optional<AsioDeviceInfo> get(const std::string& deviceId) const;
  void put(const AsioDeviceInfo& info);
  void markDirty(const std::string& deviceId);
  void markAllDirty();
  uint64_t bumpVersion(const std::string& deviceId);
  uint64_t version(const std::string& deviceId) const;
  bool dirty(const std::string& deviceId) const;
  std::vector<AsioDeviceInfo> snapshot() const;

 private:
  struct Entry {
    AsioDeviceInfo info;
    bool dirty = false;
  };

  mutable std::mutex mutex_;
  std::unordered_map<std::string, Entry> entries_;
};

}  // namespace twilight::audio
