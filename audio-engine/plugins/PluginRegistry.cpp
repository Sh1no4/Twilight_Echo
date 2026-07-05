#include "PluginRegistry.h"
#include "../utils/JsonUtils.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <sstream>

#if defined(_WIN32)
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <windows.h>
#else
#  include <dlfcn.h>
#endif

namespace twilight::audio {
namespace {

bool extractBoolField(const std::string& json, const std::string& key, bool fallback = false) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = json.find(marker);
  if (pos == std::string::npos) return fallback;
  pos = json.find(':', pos + marker.size());
  if (pos == std::string::npos) return fallback;
  ++pos;
  while (pos < json.size() && std::isspace(static_cast<unsigned char>(json[pos]))) ++pos;
  if (json.compare(pos, 4, "true") == 0) return true;
  if (json.compare(pos, 5, "false") == 0) return false;
  return fallback;
}

std::string extractStringField(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = json.find(marker);
  if (pos == std::string::npos) return {};
  pos = json.find(':', pos + marker.size());
  if (pos == std::string::npos) return {};
  pos = json.find('"', pos + 1);
  if (pos == std::string::npos) return {};
  std::string value;
  bool escaped = false;
  for (size_t i = pos + 1; i < json.size(); ++i) {
    const char ch = json[i];
    if (escaped) {
      value += ch;
      escaped = false;
      continue;
    }
    if (ch == '\\') {
      escaped = true;
      continue;
    }
    if (ch == '"') return value;
    value += ch;
  }
  return {};
}

double extractNumberField(const std::string& json, const std::string& key, double fallback = 0.0) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = json.find(marker);
  if (pos == std::string::npos) return fallback;
  pos = json.find(':', pos + marker.size());
  if (pos == std::string::npos) return fallback;
  ++pos;
  while (pos < json.size() && std::isspace(static_cast<unsigned char>(json[pos]))) ++pos;
  char* end = nullptr;
  const double value = std::strtod(json.c_str() + pos, &end);
  return end == json.c_str() + pos ? fallback : value;
}

std::string extractObjectField(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = json.find(marker);
  if (pos == std::string::npos) return {};
  pos = json.find('{', pos + marker.size());
  if (pos == std::string::npos) return {};
  bool inString = false;
  bool escaped = false;
  int depth = 0;
  for (size_t i = pos; i < json.size(); ++i) {
    const char ch = json[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch == '\\') {
        escaped = true;
      } else if (ch == '"') {
        inString = false;
      }
      continue;
    }
    if (ch == '"') {
      inString = true;
    } else if (ch == '{') {
      ++depth;
    } else if (ch == '}') {
      --depth;
      if (depth == 0) return json.substr(pos, i - pos + 1);
    }
  }
  return {};
}

std::string extractArrayField(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = json.find(marker);
  if (pos == std::string::npos) return {};
  pos = json.find('[', pos + marker.size());
  if (pos == std::string::npos) return {};
  bool inString = false;
  bool escaped = false;
  int depth = 0;
  for (size_t i = pos; i < json.size(); ++i) {
    const char ch = json[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch == '\\') {
        escaped = true;
      } else if (ch == '"') {
        inString = false;
      }
      continue;
    }
    if (ch == '"') {
      inString = true;
    } else if (ch == '[') {
      ++depth;
    } else if (ch == ']') {
      --depth;
      if (depth == 0) return json.substr(pos, i - pos + 1);
    }
  }
  return {};
}

std::vector<std::string> splitTopLevelObjects(const std::string& json) {
  std::vector<std::string> objects;
  bool inString = false;
  bool escaped = false;
  int depth = 0;
  size_t objectStart = std::string::npos;
  for (size_t i = 0; i < json.size(); ++i) {
    const char ch = json[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch == '\\') {
        escaped = true;
      } else if (ch == '"') {
        inString = false;
      }
      continue;
    }
    if (ch == '"') {
      inString = true;
    } else if (ch == '{') {
      if (depth == 0) objectStart = i;
      ++depth;
    } else if (ch == '}') {
      --depth;
      if (depth == 0 && objectStart != std::string::npos) {
        objects.push_back(json.substr(objectStart, i - objectStart + 1));
        objectStart = std::string::npos;
      }
    }
  }
  return objects;
}

std::unordered_map<std::string, double> parseNumberMap(const std::string& json) {
  std::unordered_map<std::string, double> values;
  bool inString = false;
  bool escaped = false;
  std::string currentKey;
  for (size_t i = 0; i < json.size(); ++i) {
    if (json[i] != '"' || inString) {
      if (json[i] == '"' && !escaped) inString = false;
      escaped = json[i] == '\\' && !escaped;
      continue;
    }
    inString = true;
    size_t end = i + 1;
    bool keyEscaped = false;
    std::string key;
    for (; end < json.size(); ++end) {
      const char ch = json[end];
      if (keyEscaped) {
        key += ch;
        keyEscaped = false;
      } else if (ch == '\\') {
        keyEscaped = true;
      } else if (ch == '"') {
        break;
      } else {
        key += ch;
      }
    }
    size_t colon = json.find(':', end + 1);
    if (colon == std::string::npos) break;
    size_t valuePos = colon + 1;
    while (valuePos < json.size() && std::isspace(static_cast<unsigned char>(json[valuePos]))) ++valuePos;
    if (valuePos < json.size() && (std::isdigit(static_cast<unsigned char>(json[valuePos])) || json[valuePos] == '-')) {
      char* valueEnd = nullptr;
      const double value = std::strtod(json.c_str() + valuePos, &valueEnd);
      if (valueEnd != json.c_str() + valuePos) values[key] = value;
    } else if (json.compare(valuePos, 4, "true") == 0) {
      values[key] = 1.0;
    } else if (json.compare(valuePos, 5, "false") == 0) {
      values[key] = 0.0;
    }
    i = end;
    inString = false;
    currentKey = key;
    (void)currentKey;
  }
  return values;
}

std::string parameterTypeToString(tae_dsp_parameter_type type) {
  switch (type) {
    case TAE_DSP_PARAMETER_BOOL:
      return "bool";
    case TAE_DSP_PARAMETER_INT:
      return "int";
    case TAE_DSP_PARAMETER_FLOAT:
      return "float";
    case TAE_DSP_PARAMETER_ENUM:
      return "enum";
    default:
      return "unknown";
  }
}

bool validateParameterInfo(const tae_dsp_parameter_info& parameter, std::string* error) {
  if (!parameter.id || std::string(parameter.id).empty()) {
    if (error) *error = "parameter id is required";
    return false;
  }
  if (!parameter.name || std::string(parameter.name).empty()) {
    if (error) *error = "parameter name is required: " + std::string(parameter.id);
    return false;
  }
  if (parameter.type != TAE_DSP_PARAMETER_BOOL && parameter.type != TAE_DSP_PARAMETER_INT &&
      parameter.type != TAE_DSP_PARAMETER_FLOAT && parameter.type != TAE_DSP_PARAMETER_ENUM) {
    if (error) *error = "unsupported parameter type: " + std::string(parameter.id);
    return false;
  }
  if (parameter.type != TAE_DSP_PARAMETER_BOOL && parameter.min_value > parameter.max_value) {
    if (error) *error = "parameter range is invalid: " + std::string(parameter.id);
    return false;
  }
  if (parameter.type == TAE_DSP_PARAMETER_ENUM &&
      (!parameter.enum_values_json || std::string(parameter.enum_values_json).empty())) {
    if (error) *error = "enum parameter values are required: " + std::string(parameter.id);
    return false;
  }
  return true;
}

class DynamicLibrary {
 public:
  ~DynamicLibrary() { close(); }

  bool open(const std::string& path, std::string* error) {
    close();
#if defined(_WIN32)
    handle_ = LoadLibraryW(std::filesystem::path(path).wstring().c_str());
    if (!handle_) {
      if (error) *error = "LoadLibrary failed";
      return false;
    }
#else
    handle_ = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle_) {
      if (error) *error = dlerror() ? dlerror() : "dlopen failed";
      return false;
    }
#endif
    return true;
  }

  void* symbol(const char* name) const {
#if defined(_WIN32)
    return handle_ ? reinterpret_cast<void*>(GetProcAddress(static_cast<HMODULE>(handle_), name)) : nullptr;
#else
    return handle_ ? dlsym(handle_, name) : nullptr;
#endif
  }

  void close() {
    if (!handle_) return;
#if defined(_WIN32)
    FreeLibrary(static_cast<HMODULE>(handle_));
#else
    dlclose(handle_);
#endif
    handle_ = nullptr;
  }

 private:
  void* handle_ = nullptr;
};

enum class NativeDspRealtimeBypassReason {
  None,
  ProcessThrew,
  ProcessExceededBudget,
  ProcessRequestedBypass,
  ProcessReturnedError
};

const char* realtimeBypassReasonText(NativeDspRealtimeBypassReason reason) {
  switch (reason) {
    case NativeDspRealtimeBypassReason::ProcessThrew:
      return "process threw across host boundary";
    case NativeDspRealtimeBypassReason::ProcessExceededBudget:
      return "process exceeded realtime budget";
    case NativeDspRealtimeBypassReason::ProcessRequestedBypass:
      return "process requested bypass";
    case NativeDspRealtimeBypassReason::ProcessReturnedError:
      return "process returned an error";
    case NativeDspRealtimeBypassReason::None:
    default:
      return "";
  }
}

}  // namespace

class PluginRegistry::NativePlugin {
 public:
  explicit NativePlugin(NativeDspPluginConfig config) : config_(std::move(config)) {
    status_.id = config_.id;
    status_.path = config_.path;
    status_.enabled = config_.enabled;
    load();
  }

  ~NativePlugin() {
    destroy();
  }

  void configure(const DspConfig& config) {
    configEnabled_ = config.enabled;
    refreshActive();
  }

  void prepare(const AudioFormat& format) {
    format_ = format;
    if (!status_.loaded || !config_.enabled) {
      refreshActive();
      return;
    }
    if (format.sampleFormat != AudioSampleFormat::Float32Interleaved) {
      bypass("Native DSP v1 only supports float32 interleaved PCM");
      return;
    }
    if (format.sampleRate <= 0 || format.channelCount <= 0) {
      prepared_ = false;
      refreshActive();
      return;
    }
    tae_dsp_audio_format nativeFormat{
        static_cast<uint32_t>(format.sampleRate),
        static_cast<uint32_t>(format.channelCount),
        TAE_DSP_SAMPLE_FLOAT32_INTERLEAVED};
    try {
      const tae_dsp_result result = info_->prepare(handle_, &nativeFormat);
      if (result != TAE_DSP_RESULT_OK) {
        bypass("prepare returned an error");
        return;
      }
    } catch (...) {
      bypass("prepare threw across host boundary");
      return;
    }
    prepared_ = true;
    realtimeBypassReason_ = NativeDspRealtimeBypassReason::None;
    status_.bypassed = false;
    status_.bypassReason.clear();
    refreshActive();
  }

  void process(float* samples, size_t frameCount) {
    refreshActive();
    if (!status_.active || !samples || frameCount == 0) return;
    const auto start = std::chrono::steady_clock::now();
    tae_dsp_result result = TAE_DSP_RESULT_ERROR;
    try {
      result = info_->process(handle_, samples, static_cast<uint32_t>(std::min<size_t>(frameCount, UINT32_MAX)));
    } catch (...) {
      bypassRealtime(NativeDspRealtimeBypassReason::ProcessThrew);
      return;
    }
    const auto end = std::chrono::steady_clock::now();
    const double elapsedMs = std::chrono::duration<double, std::milli>(end - start).count();
    const double blockMs =
        format_.sampleRate > 0 ? (static_cast<double>(frameCount) * 1000.0 / static_cast<double>(format_.sampleRate)) : 4.0;
    const double budgetMs = std::max(2.0, blockMs * 0.5);
    status_.lastProcessMs = elapsedMs;
    status_.maxProcessMs = std::max(status_.maxProcessMs, elapsedMs);
    status_.processCalls += 1;
    if (elapsedMs > budgetMs) {
      status_.overrunCount += 1;
      bypassRealtime(NativeDspRealtimeBypassReason::ProcessExceededBudget);
      return;
    }
    if (result == TAE_DSP_RESULT_BYPASS) {
      bypassRealtime(NativeDspRealtimeBypassReason::ProcessRequestedBypass);
    } else if (result != TAE_DSP_RESULT_OK) {
      bypassRealtime(NativeDspRealtimeBypassReason::ProcessReturnedError);
    }
  }

  void reset() {
    if (!status_.loaded || !info_->reset) return;
    try {
      const tae_dsp_result result = info_->reset(handle_);
      if (result != TAE_DSP_RESULT_OK) bypass("reset returned an error");
    } catch (...) {
      bypass("reset threw across host boundary");
    }
  }

  bool isActive() const {
    return status_.active;
  }

  NativeDspPluginStatus status() const {
    NativeDspPluginStatus status = status_;
    if (status.bypassed && realtimeBypassReason_ != NativeDspRealtimeBypassReason::None) {
      const char* reason = realtimeBypassReasonText(realtimeBypassReason_);
      status.bypassReason = reason;
      status.lastError = reason;
    }
    return status;
  }

 private:
  void load() {
    if (!config_.enabled) {
      status_.bypassed = true;
      status_.bypassReason = "disabled";
      return;
    }
    std::string error;
    if (!library_.open(config_.path, &error)) {
      fail(error.empty() ? "Failed to load native DSP library" : error);
      return;
    }
    auto* symbol = library_.symbol("tae_plugin_get_info");
    if (!symbol) {
      fail("Missing tae_plugin_get_info symbol");
      return;
    }
    auto getInfo = reinterpret_cast<tae_plugin_get_info_fn>(symbol);
    try {
      info_ = getInfo();
    } catch (...) {
      fail("tae_plugin_get_info threw across host boundary");
      return;
    }
    if (!info_) {
      fail("tae_plugin_get_info returned null");
      return;
    }
    if (info_->struct_size < sizeof(tae_dsp_plugin_info) || info_->tae_plugin_abi_version != TAE_DSP_PLUGIN_ABI_VERSION) {
      fail("Unsupported native DSP ABI version");
      return;
    }
    if (!info_->create || !info_->destroy || !info_->prepare || !info_->process || !info_->set_param || !info_->reset) {
      fail("Native DSP plugin function table is incomplete");
      return;
    }
    if (!collectParameters()) {
      return;
    }
    tae_dsp_plugin_handle handle = nullptr;
    const tae_dsp_result created = info_->create(&handle);
    if (created != TAE_DSP_RESULT_OK || !handle) {
      fail("create returned an error");
      return;
    }
    handle_ = handle;
    status_.name = info_->name ? info_->name : config_.id;
    status_.version = info_->version ? info_->version : "";
    for (const auto& [id, value] : config_.parameters) {
      if (!id.empty()) {
        const tae_dsp_result result = info_->set_param(handle_, id.c_str(), value);
        if (result != TAE_DSP_RESULT_OK) {
          bypass("parameter rejected: " + id);
          return;
        }
        parameterValues_[id] = value;
      }
    }
    refreshParameterValues();
    status_.loaded = true;
    status_.bypassed = false;
    refreshActive();
  }

  bool collectParameters() {
    status_.parameters.clear();
    parameterValues_.clear();
    if (info_->parameter_count == 0) return true;
    if (!info_->parameters) {
      fail("parameter table is missing");
      return false;
    }
    for (uint32_t index = 0; index < info_->parameter_count; ++index) {
      const auto& parameter = info_->parameters[index];
      std::string error;
      if (!validateParameterInfo(parameter, &error)) {
        fail(error);
        return false;
      }
      NativeDspPluginParameterStatus status;
      status.id = parameter.id;
      status.name = parameter.name;
      status.type = parameterTypeToString(parameter.type);
      status.defaultValue = parameter.default_value;
      status.minValue = parameter.min_value;
      status.maxValue = parameter.max_value;
      status.step = parameter.step;
      status.unit = parameter.unit ? parameter.unit : "";
      status.enumValuesJson = parameter.enum_values_json ? parameter.enum_values_json : "";
      status.currentValue = parameter.default_value;
      status_.parameters.push_back(status);
      parameterValues_[status.id] = status.currentValue;
    }
    return true;
  }

  void refreshParameterValues() {
    for (auto& parameter : status_.parameters) {
      const auto configured = parameterValues_.find(parameter.id);
      parameter.currentValue = configured == parameterValues_.end() ? parameter.defaultValue : configured->second;
    }
  }

  void destroy() {
    if (handle_ && info_ && info_->destroy) {
      try {
        info_->destroy(handle_);
      } catch (...) {
      }
    }
    handle_ = nullptr;
    info_ = nullptr;
    library_.close();
  }

  void fail(const std::string& message) {
    realtimeBypassReason_ = NativeDspRealtimeBypassReason::None;
    status_.loaded = false;
    status_.active = false;
    status_.bypassed = true;
    status_.lastError = message;
    status_.bypassReason = message;
    destroy();
  }

  void bypass(const std::string& reason) {
    realtimeBypassReason_ = NativeDspRealtimeBypassReason::None;
    status_.active = false;
    status_.bypassed = true;
    status_.bypassReason = reason;
    status_.lastError = reason;
  }

  void bypassRealtime(NativeDspRealtimeBypassReason reason) {
    status_.active = false;
    status_.bypassed = true;
    realtimeBypassReason_ = reason;
  }

  void refreshActive() {
    status_.enabled = config_.enabled;
    status_.active = configEnabled_ && config_.enabled && status_.loaded && prepared_ && !status_.bypassed;
  }

  NativeDspPluginConfig config_;
  NativeDspPluginStatus status_;
  DynamicLibrary library_;
  const tae_dsp_plugin_info* info_ = nullptr;
  tae_dsp_plugin_handle handle_ = nullptr;
  AudioFormat format_;
  std::unordered_map<std::string, double> parameterValues_;
  bool configEnabled_ = false;
  bool prepared_ = false;
  NativeDspRealtimeBypassReason realtimeBypassReason_ = NativeDspRealtimeBypassReason::None;
};

PluginRegistry::PluginRegistry() = default;
PluginRegistry::~PluginRegistry() = default;

void PluginRegistry::setPluginChain(std::vector<NativeDspPluginConfig> chain) {
  plugins_.clear();
  plugins_.reserve(chain.size());
  for (auto& config : chain) {
    plugins_.push_back(std::make_unique<NativePlugin>(std::move(config)));
  }
  configure(config_);
  prepare(format_);
}

std::vector<NativeDspPluginStatus> PluginRegistry::statuses() const {
  std::vector<NativeDspPluginStatus> out;
  out.reserve(plugins_.size());
  for (const auto& plugin : plugins_) out.push_back(plugin->status());
  return out;
}

std::string PluginRegistry::statusJson() const {
  std::ostringstream json;
  json << "{\"plugins\":[";
  const auto statusList = statuses();
  for (size_t i = 0; i < statusList.size(); ++i) {
    const auto& status = statusList[i];
    if (i > 0) json << ",";
    json << "{"
         << "\"id\":\"" << json_utils::escape(status.id) << "\","
         << "\"name\":\"" << json_utils::escape(status.name) << "\","
         << "\"version\":\"" << json_utils::escape(status.version) << "\","
         << "\"path\":\"" << json_utils::escape(status.path) << "\","
         << "\"enabled\":" << (status.enabled ? "true" : "false") << ","
         << "\"loaded\":" << (status.loaded ? "true" : "false") << ","
         << "\"active\":" << (status.active ? "true" : "false") << ","
         << "\"bypassed\":" << (status.bypassed ? "true" : "false") << ","
         << "\"bypassReason\":\"" << json_utils::escape(status.bypassReason) << "\","
         << "\"lastError\":\"" << json_utils::escape(status.lastError) << "\","
         << "\"processCalls\":" << status.processCalls << ","
         << "\"overrunCount\":" << status.overrunCount << ","
         << "\"lastProcessMs\":" << status.lastProcessMs << ","
         << "\"maxProcessMs\":" << status.maxProcessMs << ","
         << "\"parameters\":[";
    for (size_t parameterIndex = 0; parameterIndex < status.parameters.size(); ++parameterIndex) {
      const auto& parameter = status.parameters[parameterIndex];
      if (parameterIndex > 0) json << ",";
      json << "{"
           << "\"id\":\"" << json_utils::escape(parameter.id) << "\","
           << "\"name\":\"" << json_utils::escape(parameter.name) << "\","
           << "\"type\":\"" << json_utils::escape(parameter.type) << "\","
           << "\"defaultValue\":" << parameter.defaultValue << ","
           << "\"minValue\":" << parameter.minValue << ","
           << "\"maxValue\":" << parameter.maxValue << ","
           << "\"step\":" << parameter.step << ","
           << "\"unit\":\"" << json_utils::escape(parameter.unit) << "\","
           << "\"enumValues\":" << (parameter.enumValuesJson.empty() ? "null" : parameter.enumValuesJson) << ","
           << "\"currentValue\":" << parameter.currentValue
           << "}";
    }
    json << "]"
         << "}";
  }
  json << "]}";
  return json.str();
}

void PluginRegistry::configure(const DspConfig& config) {
  config_ = config;
  for (auto& plugin : plugins_) plugin->configure(config_);
}

void PluginRegistry::prepare(const AudioFormat& format) {
  format_ = format;
  for (auto& plugin : plugins_) plugin->prepare(format_);
}

void PluginRegistry::setTrackContext(const DspTrackContext&) {}

void PluginRegistry::process(float* samples, size_t frameCount) {
  for (auto& plugin : plugins_) plugin->process(samples, frameCount);
}

void PluginRegistry::reset() {
  for (auto& plugin : plugins_) plugin->reset();
}

bool PluginRegistry::isActive() const {
  return std::any_of(plugins_.begin(), plugins_.end(), [](const auto& plugin) { return plugin->isActive(); });
}

std::vector<NativeDspPluginConfig> PluginRegistry::parseChainJson(const std::string& json) {
  std::vector<NativeDspPluginConfig> chain;
  const std::string arrayJson = extractArrayField(json, "plugins");
  for (const std::string& object : splitTopLevelObjects(arrayJson)) {
    NativeDspPluginConfig config;
    config.id = extractStringField(object, "id");
    config.path = extractStringField(object, "path");
    config.enabled = extractBoolField(object, "enabled", true);
    config.parameters = parseNumberMap(extractObjectField(object, "parameters"));
    if (!config.id.empty() && !config.path.empty()) chain.push_back(std::move(config));
  }
  return chain;
}

std::string PluginRegistry::capabilitiesJson() {
  return "{\"vst3Host\":false,\"roomCorrection\":false,\"audioPluginSystem\":true,"
         "\"nativeDspAbiVersion\":1,\"nativeDspFormats\":[\"float32-interleaved\"]}";
}

std::string pluginCapabilitiesJson() {
  return PluginRegistry::capabilitiesJson();
}

}  // namespace twilight::audio
