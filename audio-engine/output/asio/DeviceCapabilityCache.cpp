#include "DeviceCapabilityCache.h"

namespace twilight::audio {

DeviceCapabilityCache& DeviceCapabilityCache::instance() {
  static DeviceCapabilityCache cache;
  return cache;
}

std::optional<AsioDeviceInfo> DeviceCapabilityCache::get(const std::string& deviceId) const {
  std::lock_guard lock(mutex_);
  const auto it = entries_.find(deviceId);
  if (it == entries_.end() || it->second.dirty) return std::nullopt;
  return it->second.info;
}

void DeviceCapabilityCache::put(const AsioDeviceInfo& info) {
  std::lock_guard lock(mutex_);
  auto& entry = entries_[info.id];
  entry.info = info;
  entry.dirty = false;
}

void DeviceCapabilityCache::markDirty(const std::string& deviceId) {
  std::lock_guard lock(mutex_);
  auto& entry = entries_[deviceId];
  entry.info.id = deviceId;
  entry.dirty = true;
}

void DeviceCapabilityCache::markAllDirty() {
  std::lock_guard lock(mutex_);
  for (auto& [_, entry] : entries_) {
    entry.dirty = true;
  }
}

uint64_t DeviceCapabilityCache::bumpVersion(const std::string& deviceId) {
  std::lock_guard lock(mutex_);
  auto& entry = entries_[deviceId];
  entry.info.id = deviceId;
  entry.info.capabilityVersion += 1;
  entry.dirty = true;
  return entry.info.capabilityVersion;
}

uint64_t DeviceCapabilityCache::version(const std::string& deviceId) const {
  std::lock_guard lock(mutex_);
  const auto it = entries_.find(deviceId);
  return it == entries_.end() ? 0 : it->second.info.capabilityVersion;
}

bool DeviceCapabilityCache::dirty(const std::string& deviceId) const {
  std::lock_guard lock(mutex_);
  const auto it = entries_.find(deviceId);
  return it != entries_.end() && it->second.dirty;
}

std::vector<AsioDeviceInfo> DeviceCapabilityCache::snapshot() const {
  std::lock_guard lock(mutex_);
  std::vector<AsioDeviceInfo> devices;
  devices.reserve(entries_.size());
  for (const auto& [_, entry] : entries_) {
    devices.push_back(entry.info);
  }
  return devices;
}

}  // namespace twilight::audio
