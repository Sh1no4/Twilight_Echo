#include <sstream>
#include <string>

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <functiondiscoverykeys_devpkey.h>
#include <mmdeviceapi.h>
#include <propidl.h>
#include <wrl/client.h>
#include <windows.h>
#endif

namespace twilight::audio {
namespace {

std::string escapeJson(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (char ch : value) {
    switch (ch) {
      case '\\':
        out += "\\\\";
        break;
      case '"':
        out += "\\\"";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        out += ch;
        break;
    }
  }
  return out;
}

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
std::string wideToUtf8(const wchar_t* value) {
  if (!value) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string out(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value, -1, out.data(), size, nullptr, nullptr);
  if (!out.empty() && out.back() == '\0') out.pop_back();
  return out;
}

std::string readDeviceName(IMMDevice* device) {
  Microsoft::WRL::ComPtr<IPropertyStore> properties;
  if (!device || FAILED(device->OpenPropertyStore(STGM_READ, &properties))) return {};
  PROPVARIANT value;
  PropVariantInit(&value);
  std::string name;
  if (SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &value)) && value.vt == VT_LPWSTR) {
    name = wideToUtf8(value.pwszVal);
  }
  PropVariantClear(&value);
  return name;
}
#endif

}  // namespace

std::string enumeratePlatformDevicesJson() {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool shouldUninitialize = SUCCEEDED(hr);
  if (hr == RPC_E_CHANGED_MODE) hr = S_OK;
  if (FAILED(hr)) {
    return "[{\"id\":\"auto\",\"label\":\"\\u7cfb\\u7edf\\u9ed8\\u8ba4\",\"isDefault\":true}]";
  }

  Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator;
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (FAILED(hr)) {
    if (shouldUninitialize) CoUninitialize();
    return "[{\"id\":\"auto\",\"label\":\"\\u7cfb\\u7edf\\u9ed8\\u8ba4\",\"isDefault\":true}]";
  }

  std::string defaultId;
  Microsoft::WRL::ComPtr<IMMDevice> defaultDevice;
  if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &defaultDevice))) {
    LPWSTR rawId = nullptr;
    if (SUCCEEDED(defaultDevice->GetId(&rawId))) {
      defaultId = wideToUtf8(rawId);
      CoTaskMemFree(rawId);
    }
  }

  std::ostringstream json;
  json << "[{\"id\":\"auto\",\"label\":\"\\u7cfb\\u7edf\\u9ed8\\u8ba4\",\"isDefault\":true}";

  Microsoft::WRL::ComPtr<IMMDeviceCollection> collection;
  if (SUCCEEDED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection))) {
    UINT count = 0;
    collection->GetCount(&count);
    for (UINT i = 0; i < count; ++i) {
      Microsoft::WRL::ComPtr<IMMDevice> device;
      if (FAILED(collection->Item(i, &device))) continue;
      LPWSTR rawId = nullptr;
      if (FAILED(device->GetId(&rawId))) continue;
      const std::string id = wideToUtf8(rawId);
      CoTaskMemFree(rawId);
      const std::string label = readDeviceName(device.Get());
      json << ",{\"id\":\"" << escapeJson(id) << "\",\"label\":\""
           << escapeJson(label.empty() ? id : label) << "\",\"isDefault\":"
           << (id == defaultId ? "true" : "false") << "}";
    }
  }

  json << "]";
  if (shouldUninitialize) CoUninitialize();
  return json.str();
#else
  return "[{\"id\":\"auto\",\"label\":\"\\u7cfb\\u7edf\\u9ed8\\u8ba4\",\"isDefault\":true}]";
#endif
}

}  // namespace twilight::audio
