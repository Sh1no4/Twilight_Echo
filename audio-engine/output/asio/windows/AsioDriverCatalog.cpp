#include "AsioDriverCatalog.h"

#include <Windows.h>
#include <objbase.h>

#include <algorithm>

namespace twilight::audio::asio_windows {
namespace {

std::string utf8(const std::wstring& value) {
  if (value.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string result(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
  return result;
}

std::wstring readString(HKEY key, const wchar_t* name) {
  DWORD type = 0;
  DWORD bytes = 0;
  if (RegQueryValueExW(key, name, nullptr, &type, nullptr, &bytes) != ERROR_SUCCESS ||
      (type != REG_SZ && type != REG_EXPAND_SZ) || bytes < sizeof(wchar_t)) {
    return {};
  }
  std::wstring value(bytes / sizeof(wchar_t), L'\0');
  if (RegQueryValueExW(
          key, name, nullptr, &type, reinterpret_cast<LPBYTE>(value.data()), &bytes) != ERROR_SUCCESS) {
    return {};
  }
  value.resize(wcsnlen(value.c_str(), value.size()));
  return value;
}

bool hasInProcessServer(const std::wstring& clsid) {
  HKEY key = nullptr;
  const std::wstring path = L"CLSID\\" + clsid + L"\\InprocServer32";
  const LSTATUS status = RegOpenKeyExW(
      HKEY_CLASSES_ROOT, path.c_str(), 0, KEY_READ | KEY_WOW64_64KEY, &key);
  if (status != ERROR_SUCCESS) return false;
  RegCloseKey(key);
  return true;
}

}  // namespace

std::vector<AsioDriverEntry> AsioDriverCatalog::enumerate() {
  std::vector<AsioDriverEntry> entries;
  HKEY catalog = nullptr;
  if (RegOpenKeyExW(
          HKEY_LOCAL_MACHINE, L"SOFTWARE\\ASIO", 0, KEY_READ | KEY_WOW64_64KEY, &catalog) != ERROR_SUCCESS) {
    return entries;
  }

  for (DWORD index = 0;; ++index) {
    wchar_t keyName[256] = {};
    DWORD keyNameSize = static_cast<DWORD>(std::size(keyName));
    const LSTATUS enumStatus = RegEnumKeyExW(catalog, index, keyName, &keyNameSize, nullptr, nullptr, nullptr, nullptr);
    if (enumStatus == ERROR_NO_MORE_ITEMS) break;
    if (enumStatus != ERROR_SUCCESS) continue;

    HKEY driverKey = nullptr;
    if (RegOpenKeyExW(catalog, keyName, 0, KEY_READ | KEY_WOW64_64KEY, &driverKey) != ERROR_SUCCESS) continue;
    const std::wstring clsidText = readString(driverKey, L"CLSID");
    const std::wstring description = readString(driverKey, L"Description");
    RegCloseKey(driverKey);

    CLSID clsid{};
    if (clsidText.empty() || FAILED(CLSIDFromString(clsidText.c_str(), &clsid)) || !hasInProcessServer(clsidText)) {
      continue;
    }
    wchar_t canonical[64] = {};
    if (StringFromGUID2(clsid, canonical, static_cast<int>(std::size(canonical))) <= 0) continue;

    AsioDriverEntry entry;
    entry.clsid = utf8(canonical);
    entry.id = "asio:" + entry.clsid;
    entry.displayName = utf8(description.empty() ? std::wstring(keyName, keyNameSize) : description);
    entries.push_back(std::move(entry));
  }

  RegCloseKey(catalog);
  std::sort(entries.begin(), entries.end(), [](const AsioDriverEntry& left, const AsioDriverEntry& right) {
    return left.id < right.id;
  });
  return entries;
}

std::optional<AsioDriverEntry> AsioDriverCatalog::resolve(const std::string& id) {
  const auto entries = enumerate();
  if (id.empty() || id == "auto") return entries.empty() ? std::nullopt : std::optional(entries.front());

  const auto exact = std::find_if(entries.begin(), entries.end(), [&](const AsioDriverEntry& entry) {
    return entry.id == id;
  });
  if (exact != entries.end()) return *exact;
  if (!id.starts_with("asio:")) return std::nullopt;

  std::optional<AsioDriverEntry> legacy;
  for (const auto& entry : entries) {
    if (entry.displayName != id.substr(5)) continue;
    if (legacy) return std::nullopt;
    legacy = entry;
  }
  return legacy;
}

}  // namespace twilight::audio::asio_windows
