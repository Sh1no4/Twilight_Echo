#include "twilight_audio_engine.h"
#include "../plugins/PluginRegistry.h"

#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <cstring>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

using twilight::audio::AudioFormat;
using twilight::audio::AudioSampleFormat;
using twilight::audio::DspConfig;
using twilight::audio::NativeDspPluginConfig;
using twilight::audio::PluginRegistry;

std::string callString(TAE_EngineHandle engine, TAE_Result (*fn)(TAE_EngineHandle, char*, size_t, size_t*)) {
  size_t required = 0;
  assert(fn(engine, nullptr, 0, &required) == TAE_RESULT_OK);
  std::vector<char> buffer(required == 0 ? 1 : required);
  assert(fn(engine, buffer.data(), buffer.size(), &required) == TAE_RESULT_OK);
  return std::string(buffer.data());
}

std::string escapeJson(const std::string& value) {
  std::string out;
  for (char ch : value) {
    if (ch == '\\') out += "\\\\";
    else if (ch == '"') out += "\\\"";
    else out += ch;
  }
  return out;
}

std::string quoteCommandArg(const std::string& value) {
  std::string out = "\"";
  for (char ch : value) {
    if (ch == '"') out += "\\\"";
    else out += ch;
  }
  out += "\"";
  return out;
}

void prepareRegistry(
    PluginRegistry& registry,
    const std::string& pluginPath,
    std::unordered_map<std::string, double> parameters = {}) {
  NativeDspPluginConfig plugin;
  plugin.id = "test";
  plugin.path = pluginPath;
  plugin.enabled = true;
  plugin.parameters = std::move(parameters);
  registry.setPluginChain({plugin});
  DspConfig config;
  config.enabled = true;
  registry.configure(config);
  AudioFormat format;
  format.sampleRate = 48000;
  format.channelCount = 2;
  format.bitDepth = 32;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;
  registry.prepare(format);
}

void assertStatusContains(PluginRegistry& registry, const std::string& needle) {
  const std::string status = registry.statusJson();
  if (status.find(needle) == std::string::npos) {
    std::cerr << "Expected status to contain: " << needle << "\nActual status: " << status << "\n";
  }
  assert(status.find(needle) != std::string::npos);
}

std::string readTextFile(const std::filesystem::path& path) {
  std::ifstream in(path, std::ios::binary);
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

std::string extractFunctionBody(const std::string& source, const std::string& signature) {
  const size_t signaturePos = source.find(signature);
  assert(signaturePos != std::string::npos);
  const size_t bodyStart = source.find('{', signaturePos);
  assert(bodyStart != std::string::npos);
  int depth = 0;
  for (size_t i = bodyStart; i < source.size(); ++i) {
    if (source[i] == '{') {
      ++depth;
    } else if (source[i] == '}') {
      --depth;
      if (depth == 0) return source.substr(bodyStart, i - bodyStart + 1);
    }
  }
  assert(false);
  return {};
}

void testNativeDspProcessFailurePathUsesFixedReasons() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath =
      testFilePath.parent_path().parent_path() / "plugins" / "PluginRegistry.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string processBody = extractFunctionBody(source, "void process(float* samples, size_t frameCount)");
  const std::string realtimeBypassBody =
      extractFunctionBody(source, "void bypassRealtime(NativeDspRealtimeBypassReason reason)");

  assert(processBody.find("bypassRealtime(") != std::string::npos);
  assert(processBody.find("bypass(\"process") == std::string::npos);
  assert(realtimeBypassBody.find("status_.bypassReason") == std::string::npos);
  assert(realtimeBypassBody.find("status_.lastError") == std::string::npos);
}

void testNativeDspHostDoesNotCatchAcrossAbiBoundary() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath =
      testFilePath.parent_path().parent_path() / "plugins" / "PluginRegistry.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string loadBody = extractFunctionBody(source, "void load()");
  const std::string prepareBody = extractFunctionBody(source, "void prepare(const AudioFormat& format)");
  const std::string processBody = extractFunctionBody(source, "void process(float* samples, size_t frameCount)");
  const std::string resetBody = extractFunctionBody(source, "void reset()");
  const std::string destroyBody = extractFunctionBody(source, "void destroy()");

  assert(source.find("ProcessThrew") == std::string::npos);
  assert(loadBody.find("catch (...)") == std::string::npos);
  assert(prepareBody.find("catch (...)") == std::string::npos);
  assert(processBody.find("catch (...)") == std::string::npos);
  assert(resetBody.find("catch (...)") == std::string::npos);
  assert(destroyBody.find("catch (...)") == std::string::npos);
}

void testNativeDspOverrunBypassesAfterRepeatedBudgetMisses() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath =
      testFilePath.parent_path().parent_path() / "plugins" / "PluginRegistry.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string processBody = extractFunctionBody(source, "void process(float* samples, size_t frameCount)");
  const size_t overrunCheck = processBody.find("elapsedMs > budgetMs");

  assert(overrunCheck != std::string::npos);
  assert(processBody.find("consecutiveOverruns_ +=", overrunCheck) != std::string::npos);
  assert(processBody.find("consecutiveOverruns_ >= kNativeDspRealtimeBypassOverrunThreshold", overrunCheck) !=
         std::string::npos);
}

void testDspChainProcessDoesNotRefreshNativeDspStatusOnRealtimeThread() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "dsp" / "DspChain.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string processBody = extractFunctionBody(source, "void DspChain::process(float* samples, size_t frameCount)");

  assert(processBody.find("refreshStatusLocked()") == std::string::npos);
  assert(processBody.find("statusJson()") == std::string::npos);
}

void testGainPluginProcessesAudio(const std::string& path) {
  PluginRegistry registry;
  prepareRegistry(registry, path, {{"gain", 0.25}});
  std::vector<float> samples = {1.0f, -1.0f, 0.5f, -0.5f};
  registry.process(samples.data(), 2);
  assert(std::fabs(samples[0] - 0.25f) < 0.0001f);
  assert(std::fabs(samples[1] + 0.25f) < 0.0001f);
  assert(registry.isActive());
  const std::string status = registry.statusJson();
  assert(status.find("\"parameters\"") != std::string::npos);
  assert(status.find("\"currentValue\":0.25") != std::string::npos);
  assert(status.find("\"processCalls\":1") != std::string::npos);
}

void testBadAbiBypasses(const std::string& path) {
  PluginRegistry registry;
  prepareRegistry(registry, path);
  assert(!registry.isActive());
  assertStatusContains(registry, "Unsupported native DSP ABI version");
  assertStatusContains(registry, "\"bypassed\":true");
}

void testInvalidParameterMetadataBypasses(const std::string& path) {
  PluginRegistry registry;
  prepareRegistry(registry, path);
  assert(!registry.isActive());
  assertStatusContains(registry, "parameter id is required");
}

void testPrepareErrorBypasses(const std::string& path) {
  PluginRegistry registry;
  prepareRegistry(registry, path, {{"mode", 3.0}});
  assert(!registry.isActive());
  assertStatusContains(registry, "prepare returned an error");
}

void testProcessErrorBypasses(const std::string& path) {
  PluginRegistry registry;
  prepareRegistry(registry, path, {{"mode", 1.0}});
  std::vector<float> samples = {0.25f, 0.25f};
  registry.process(samples.data(), 1);
  assert(!registry.isActive());
  assertStatusContains(registry, "process returned an error");
}

void testProcessOverrunBypassesAfterRepeatedMisses(const std::string& path) {
  PluginRegistry registry;
  prepareRegistry(registry, path, {{"mode", 2.0}});
  std::vector<float> samples(128, 0.1f);

  registry.process(samples.data(), 64);
  assert(registry.isActive());
  assertStatusContains(registry, "\"bypassed\":false");
  assertStatusContains(registry, "\"overrunCount\":1");

  registry.process(samples.data(), 64);
  assert(registry.isActive());
  assertStatusContains(registry, "\"bypassed\":false");
  assertStatusContains(registry, "\"overrunCount\":2");

  registry.process(samples.data(), 64);
  assert(!registry.isActive());
  assertStatusContains(registry, "process exceeded realtime budget");
  assertStatusContains(registry, "\"overrunCount\":3");
}

void testNonFloatFormatBypasses(const std::string& path) {
  NativeDspPluginConfig plugin;
  plugin.id = "test";
  plugin.path = path;
  PluginRegistry registry;
  registry.setPluginChain({plugin});
  DspConfig config;
  config.enabled = true;
  registry.configure(config);
  AudioFormat format;
  format.sampleRate = 48000;
  format.channelCount = 2;
  format.bitDepth = 24;
  format.sampleFormat = AudioSampleFormat::Int24In32Interleaved;
  registry.prepare(format);
  assert(!registry.isActive());
  assertStatusContains(registry, "Native DSP only supports float32 interleaved PCM");
}

void testCrossfeedPluginProcessesAudio(const std::string& path) {
  PluginRegistry registry;
  prepareRegistry(registry, path, {{"strength", 0.9}, {"delayMs", 0.05}, {"cutoffHz", 2000.0}});
  std::vector<float> samples(32, 0.0f);
  samples[0] = 1.0f;
  samples[1] = 0.0f;
  for (size_t index = 2; index < samples.size(); index += 2) {
    samples[index] = 0.5f;
    samples[index + 1] = 0.0f;
  }
  registry.process(samples.data(), static_cast<uint32_t>(samples.size() / 2));
  bool rightChannelChanged = false;
  for (size_t index = 1; index < samples.size(); index += 2) {
    rightChannelChanged = rightChannelChanged || std::fabs(samples[index]) > 0.00001f;
  }
  assert(rightChannelChanged);
  assert(registry.isActive());
  assertStatusContains(registry, "Twilight Crossfeed");
}

int runCrashFixtureChild(const std::string& path) {
  PluginRegistry registry;
  prepareRegistry(registry, path);
  if (!registry.isActive()) return 2;
  std::vector<float> samples = {0.25f, -0.25f};
  registry.process(samples.data(), 1);
  return 3;
}

int expectCrashFixtureProcess(const char* executablePath, const std::string& pluginPath) {
  const std::string command =
      quoteCommandArg(executablePath) + " --run-crash-fixture " + quoteCommandArg(pluginPath);
  const int result = std::system(command.c_str());
  if (result == 0) {
    std::cerr << "Crash fixture returned normally; expected abnormal process termination\n";
    return 1;
  }
  return 0;
}

int main(int argc, char** argv) {
  if (argc == 3 && std::string(argv[1]) == "--run-crash-fixture") {
    return runCrashFixtureChild(argv[2]);
  }
  if (argc == 3 && std::string(argv[1]) == "--expect-crash-fixture") {
    return expectCrashFixtureProcess(argv[0], argv[2]);
  }

  TAE_EngineHandle engine = nullptr;
  assert(TAE_CreateEngine(&engine) == TAE_RESULT_OK);
  assert(engine != nullptr);

  const std::string capabilities = callString(engine, TAE_GetEngineCapabilities);
  assert(capabilities.find("\"audioPluginSystem\":true") != std::string::npos);
  assert(capabilities.find("\"nativeDspAbiVersion\":2") != std::string::npos);
  assert(capabilities.find("\"roomCorrection\":true") != std::string::npos);
#ifdef _WIN32
  assert(capabilities.find("\"vst3Host\":true") != std::string::npos);
#else
  assert(capabilities.find("\"vst3Host\":false") != std::string::npos);
#endif

  assert(argc >= 8);
  const std::string pluginPath = argv[1];
  const std::string faultPath = argv[2];
  const std::string badAbiPath = argv[3];
  const std::string invalidParamPath = argv[4];
  const std::string crossfeedPath = argv[5];
  const std::string crashPath = argv[6];
  const std::string v2Path = argv[7];
  const std::string chain =
      "{\"plugins\":[{\"id\":\"com.twilightecho.test.gain\",\"path\":\"" + escapeJson(pluginPath) +
      "\",\"enabled\":true,\"parameters\":{\"gain\":0.25}}]}";
  assert(TAE_SetDspPluginChain(engine, chain.c_str()) == TAE_RESULT_OK);
  assert(TAE_SetDspConfig(engine, "{\"dspEnabled\":true}") == TAE_RESULT_OK);

  const std::string status = callString(engine, TAE_GetDspPluginStatus);
  assert(status.find("com.twilightecho.test.gain") != std::string::npos);
  assert(status.find("\"loaded\":true") != std::string::npos);

  const std::string playbackInfo = callString(engine, TAE_GetPlaybackInfo);
  assert(playbackInfo.find("\"nativeDsp\"") != std::string::npos);

  TAE_DestroyEngine(engine);
  testNativeDspProcessFailurePathUsesFixedReasons();
  testNativeDspHostDoesNotCatchAcrossAbiBoundary();
  testNativeDspOverrunBypassesAfterRepeatedBudgetMisses();
  testDspChainProcessDoesNotRefreshNativeDspStatusOnRealtimeThread();
  testGainPluginProcessesAudio(pluginPath);
  testBadAbiBypasses(badAbiPath);
  testInvalidParameterMetadataBypasses(invalidParamPath);
  testPrepareErrorBypasses(faultPath);
  testProcessErrorBypasses(faultPath);
  testProcessOverrunBypassesAfterRepeatedMisses(faultPath);
  testNonFloatFormatBypasses(pluginPath);
  testCrossfeedPluginProcessesAudio(crossfeedPath);
  {
    PluginRegistry registry;
    prepareRegistry(registry, v2Path);
    const std::string v2Status = registry.statusJson();
    assert(v2Status.find("\"abiVersion\":2") != std::string::npos);
    assert(v2Status.find("\"graphPosition\":\"v2-sortable\"") != std::string::npos);
    assert(v2Status.find("\"latencyFrames\":32") != std::string::npos);
    assert(registry.isActive());
  }
  assert(!crashPath.empty());
  return 0;
}
