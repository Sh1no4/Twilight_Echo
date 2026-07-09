#include "../core/TwilightAudioEngine.h"
#include "../core/AudioPipeline.h"
#include "../core/AudioPipelineRenderUtils.h"
#include "../decoder/DsdReader.h"
#include "../decoder/FFmpegDecoder.h"
#include "../output/IOutputBackend.h"

#include <algorithm>
#include <atomic>
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <regex>
#include <string>
#include <thread>
#include <vector>

using namespace twilight::audio;

namespace {

constexpr int kDsd64Rate = 2822400;
constexpr int kDsd128Rate = 5644800;
constexpr int kDsd256Rate = 11289600;
constexpr int kDsd512Rate = 22579200;

void testFloatScratchResizeForOverwritePreservesSameSizedScratch() {
  std::vector<float> scratch = {0.25f, -0.5f, 0.75f};
  const float* before = scratch.data();

  render::resizeFloatScratchForOverwrite(scratch, scratch.size());

  assert(scratch.data() == before);
  assert(scratch[0] == 0.25f);
  assert(scratch[1] == -0.5f);
  assert(scratch[2] == 0.75f);
}

void testVisualizationFftResolutionMatchesWebAudioReference() {
  assert(visualizationFftResolutionForConfig(0) == 8192);
  assert(visualizationFftResolutionForConfig(2048) == 8192);
  assert(visualizationFftResolutionForConfig(4096) == 8192);
  assert(visualizationFftResolutionForConfig(8192) == 8192);
}

std::string readTextFile(const std::filesystem::path& path) {
  std::ifstream in(path, std::ios::binary);
  std::ostringstream buffer;
  buffer << in.rdbuf();
  std::string text = buffer.str();
  text = std::regex_replace(text, std::regex("\r\n"), "\n");
  text = std::regex_replace(text, std::regex("\r"), "\n");
  return text;
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

void testRenderCallbacksDoNotResizePipelineScratchBuffers() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string renderBody = extractFunctionBody(source, "size_t AudioPipeline::render(float* output, size_t frameCount)");
  const std::string renderTypedBody = extractFunctionBody(source, "size_t AudioPipeline::renderTyped(PcmBlock& output)");
  const std::string realtimeBodies = renderBody + renderTypedBody;

  assert(!std::regex_search(realtimeBodies, std::regex(R"((routingScratch_|preloadRoutingScratch_|preloadMixScratch_|typedVisualizationScratch_)\.resize\s*\()")));
  assert(!std::regex_search(realtimeBodies, std::regex(R"(resizeFloatScratchForOverwrite\s*\((preloadMixScratch_|routingScratch_|preloadRoutingScratch_|typedVisualizationScratch_))")));
}

void testDecodeStreamReadFloatDoesNotResizeTypedScratch() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string readFloatBody = extractFunctionBody(source, "size_t readFloat(float* output, size_t frameCount)");

  assert(readFloatBody.find("floatReadScratch") != std::string::npos);
  assert(!std::regex_search(readFloatBody, std::regex(R"(floatReadScratch\.resize\s*\()")));
}

void testRenderCallbacksDoNotReconfigureDspChains() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string renderBody = extractFunctionBody(source, "size_t AudioPipeline::render(float* output, size_t frameCount)");
  const std::string renderTypedBody = extractFunctionBody(source, "size_t AudioPipeline::renderTyped(PcmBlock& output)");
  const std::string realtimeBodies = renderBody + renderTypedBody;

  assert(!std::regex_search(realtimeBodies, std::regex(R"(\.configure\s*\()")));
  assert(!std::regex_search(realtimeBodies, std::regex(R"(\.prepare\s*\()")));
  assert(!std::regex_search(realtimeBodies, std::regex(R"(\.setTrackContext\s*\()")));
}

void testRenderCallbackDoesNotCopyDspConfig() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string renderBody = extractFunctionBody(source, "size_t AudioPipeline::render(float* output, size_t frameCount)");

  assert(renderBody.find("DspConfig dspConfig") == std::string::npos);
  assert(renderBody.find("dspConfig = dspConfig_") == std::string::npos);
}

void testRenderCallbacksDoNotBlockOnPipelineMutex() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string renderBody = extractFunctionBody(source, "size_t AudioPipeline::render(float* output, size_t frameCount)");
  const std::string renderTypedBody = extractFunctionBody(source, "size_t AudioPipeline::renderTyped(PcmBlock& output)");
  const std::string realtimeBodies = renderBody + renderTypedBody;

  assert(!std::regex_search(realtimeBodies, std::regex(R"(std::lock_guard\s+lock\s*\(\s*mutex_\s*\))")));
}

void testRenderCallbacksDoNotWaitForDecoderBuffers() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string renderBody = extractFunctionBody(source, "size_t AudioPipeline::render(float* output, size_t frameCount)");
  const std::string renderTypedBody = extractFunctionBody(source, "size_t AudioPipeline::renderTyped(PcmBlock& output)");
  const std::string realtimeBodies = renderBody + renderTypedBody;

  assert(realtimeBodies.find("waitForRenderFrames") == std::string::npos);
  assert(realtimeBodies.find("waitForAvailableFrames") == std::string::npos);
}

void testNativeDsdRenderPositionAccountsForBitsPerByte() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string renderTypedBody = extractFunctionBody(source, "size_t AudioPipeline::renderTyped(PcmBlock& output)");

  assert(renderTypedBody.find("renderedFrames_ += read;") == std::string::npos);
  assert(renderTypedBody.find("dsdRenderedFrameUnits") != std::string::npos);
}

void testChannelRouterStateIsSerializedWithoutBlockingRenderCallbacks() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::filesystem::path headerPath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.h";
  const std::string source = readTextFile(sourcePath);
  const std::string header = readTextFile(headerPath);
  const std::string renderBody = extractFunctionBody(source, "size_t AudioPipeline::render(float* output, size_t frameCount)");
  const std::string setOutputConfigBody =
      extractFunctionBody(source, "bool AudioPipeline::setOutputConfig(const OutputConfig& config, std::string* error)");

  assert(header.find("channelRouterMutex_") != std::string::npos);
  assert(setOutputConfigBody.find("channelRouterMutex_") != std::string::npos);
  assert(setOutputConfigBody.find("channelRouter_.setUpmixConfig") != std::string::npos);
  assert(renderBody.find("channelRouterMutex_") != std::string::npos);
  assert(renderBody.find("std::try_to_lock") != std::string::npos);
  assert(renderBody.find("std::lock_guard channelRouter") == std::string::npos);
  assert(renderBody.find("channelRouter_.route") != std::string::npos);
}

void testRenderCallbacksUseNonBlockingSpectrumReset() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string renderBody = extractFunctionBody(source, "size_t AudioPipeline::render(float* output, size_t frameCount)");
  const std::string renderTypedBody = extractFunctionBody(source, "size_t AudioPipeline::renderTyped(PcmBlock& output)");
  const std::string realtimeBodies = renderBody + renderTypedBody;

  assert(realtimeBodies.find("spectrum_.resetCapture()") == std::string::npos);
}


void testSetDspConfigParsesJsonOutsidePipelineMutex() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string body = extractFunctionBody(source, "void AudioPipeline::setDspConfig(const std::string& dspConfigJson)");
  const size_t parsePos = body.find("const DspConfig nextConfig = DspChain::parseConfigJson(dspConfigJson);");
  const size_t lockPos = body.find("std::lock_guard lock(mutex_);");
  assert(parsePos != std::string::npos);
  assert(lockPos != std::string::npos);
  assert(parsePos < lockPos);
}

void testSetVolumeAvoidsBlockingOnPipelineMutex() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string body = extractFunctionBody(source, "void AudioPipeline::setVolume(double volume)");
  assert(body.find("std::unique_lock lock(mutex_, std::try_to_lock)") != std::string::npos);
  assert(body.find("std::lock_guard lock(mutex_)") == std::string::npos);
}

void testDecodeStreamReaperRetiresOutsideAudioCallback() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  assert(source.find("struct AudioPipeline::DecodeStreamReaper") != std::string::npos);
  assert(source.find("decodeStreamReaper().retire") != std::string::npos);
  const std::string renderBody = extractFunctionBody(source, "size_t AudioPipeline::render(float* output, size_t frameCount)");
  assert(!std::regex_search(renderBody, std::regex(R"(->\s*stop\s*\()")));
  assert(renderBody.find("decodeThread.join") == std::string::npos);
}

void testRenderCallbackDoesNotStopDecodeStreams() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string renderBody = extractFunctionBody(source, "size_t AudioPipeline::render(float* output, size_t frameCount)");

  assert(!std::regex_search(renderBody, std::regex(R"(->\s*stop\s*\()")));
}

void testCrossfadePromotionClearsStaleLocalPreloadState() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string renderBody = extractFunctionBody(source, "size_t AudioPipeline::render(float* output, size_t frameCount)");
  const size_t promotion = renderBody.find("activeStream_ = preloadStream_");
  assert(promotion != std::string::npos);
  const size_t nextGuard = renderBody.find("if (!next) break;", promotion);
  assert(nextGuard != std::string::npos);
  const std::string promotionTail = renderBody.substr(promotion, nextGuard - promotion);

  assert(promotionTail.find("preload.reset()") != std::string::npos);
  assert(promotionTail.find("crossfadeMixActive = false") != std::string::npos);
  assert(promotionTail.find("crossfadeFramesProcessed = 0") != std::string::npos);
  assert(promotionTail.find("crossfadeTotalFrames = 0") != std::string::npos);
}

void testRenderSideDecodeStreamRetirementDoesNotGrowContainers() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string boolSignature = "bool AudioPipeline::retireDecodeStreamLocked(std::shared_ptr<DecodeStream> stream)";
  const std::string voidSignature = "void AudioPipeline::retireDecodeStreamLocked(std::shared_ptr<DecodeStream> stream)";
  const std::string retireBody = source.find(boolSignature) != std::string::npos
                                     ? extractFunctionBody(source, boolSignature)
                                     : extractFunctionBody(source, voidSignature);

  assert(!std::regex_search(retireBody, std::regex(R"(\.(push_back|emplace_back)\s*\()")));
}

void testSetOutputConfigReleasesEngineMutexBeforeRerouteRestart() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "TwilightAudioEngine.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string body = extractFunctionBody(
      source,
      "TAE_Result TwilightAudioEngine::setOutputConfig(const std::string& outputConfigJson)");
  const size_t rerouteCheck = body.find("if (!rerouteReason.empty())");
  assert(rerouteCheck != std::string::npos);

  const std::string beforeReroute = body.substr(0, rerouteCheck);
  const size_t lockScope = beforeReroute.find("{\n    std::lock_guard lock(mutex_);\n    info_.outputInfo.channelRoutingMode");
  assert(lockScope != std::string::npos);
  const size_t lockScopeEnd = beforeReroute.find("\n  }\n", lockScope);
  assert(lockScopeEnd != std::string::npos);
  assert(lockScopeEnd < rerouteCheck);
}

void testSetDspConfigPreparesActiveChainForPreRoutingDecodeFormat() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string body = extractFunctionBody(source, "void AudioPipeline::setDspConfig(const std::string& dspConfigJson)");

  assert(body.find("activeDspChain.prepare(decodeFormat_)") != std::string::npos);
  assert(body.find("activeDspChain.prepare(outputFormat_)") == std::string::npos);
  assert(body.find("spareDspChain.prepare(decodeFormat_)") != std::string::npos);
  assert(body.find("spareDspChain.prepare(outputFormat_)") == std::string::npos);
}

void testDsdProcessingPcmDecisionUsesSharedHelper() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "core" / "AudioPipeline.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string helperBody = extractFunctionBody(source, "bool dspConfigProcessingRequiresPcm(");
  const std::string dopBody = extractFunctionBody(source, "bool AudioPipeline::shouldAttemptDopForCurrentConfig(");
  const std::string nativeBody = extractFunctionBody(source, "bool AudioPipeline::shouldAttemptNativeDsdForCurrentConfig(");
  const std::string reasonBody = extractFunctionBody(source, "std::string AudioPipeline::determineDsdPcmFallbackReason(");

  assert(helperBody.find("dspConfig.replayGainMode") != std::string::npos);
  assert(helperBody.find("dspConfig.eqEnabled") != std::string::npos);
  assert(helperBody.find("dspConfig.convolverEnabled") != std::string::npos);
  assert(helperBody.find("dspConfig.crossfeedEnabled") != std::string::npos);
  assert(helperBody.find("dspConfig.crossfadeSeconds") != std::string::npos);
  assert(helperBody.find("outputConfig.routingMode") != std::string::npos);
  assert(helperBody.find("std::abs(volume - 1.0)") != std::string::npos);

  assert(dopBody.find("dspConfigProcessingRequiresPcm") != std::string::npos);
  assert(nativeBody.find("dspConfigProcessingRequiresPcm") != std::string::npos);
  assert(reasonBody.find("dspConfigProcessingRequiresPcm") != std::string::npos);
  assert(dopBody.find("dspConfig.replayGainMode") == std::string::npos);
  assert(nativeBody.find("dspConfig.replayGainMode") == std::string::npos);
  assert(reasonBody.find("dspConfig.replayGainMode") == std::string::npos);
}

void testTwilightAudioEngineReusesParsedDspConfigSnapshot() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath =
      testFilePath.parent_path().parent_path() / "core" / "TwilightAudioEngine.cpp";
  const std::filesystem::path headerPath =
      testFilePath.parent_path().parent_path() / "core" / "TwilightAudioEngine.h";
  const std::string source = readTextFile(sourcePath);
  const std::string header = readTextFile(headerPath);
  const std::string playBody =
      extractFunctionBody(source, "TAE_Result TwilightAudioEngine::play(const std::string& source, double startTimeSeconds)");
  const std::string playQueueBody =
      extractFunctionBody(source, "TAE_Result TwilightAudioEngine::playQueueItem(const QueueItem& item, double startTimeSeconds)");
  const std::string perfectBody = extractFunctionBody(source, "void TwilightAudioEngine::updatePerfectLocked()");
  const std::string rerouteBody = extractFunctionBody(source, "bool TwilightAudioEngine::shouldReroutePipelineLocked(");
  const std::string setDspBody = extractFunctionBody(source, "TAE_Result TwilightAudioEngine::setDspConfig(");

  assert(header.find("DspConfig dspConfig_") != std::string::npos);
  assert(source.find("bool gaplessEnabledFromConfig(const DspConfig& config)") != std::string::npos);
  assert(source.find("dspConfigRequiresProcessing") == std::string::npos);
  assert(setDspBody.find("dspConfig_ = nextConfig") != std::string::npos);
  assert(playBody.find("gaplessEnabledFromConfig(dspConfig_)") != std::string::npos);
  assert(playQueueBody.find("gaplessEnabledFromConfig(dspConfig_)") != std::string::npos);
  assert(perfectBody.find("DspChain::parseConfigJson(dspConfigJson_)") == std::string::npos);
  assert(rerouteBody.find("DspChain::parseConfigJson(dspConfigJson_)") == std::string::npos);
  assert(rerouteBody.find("const DspConfig& config = dspConfig_") != std::string::npos);
}

void writeLe16(std::ofstream& out, uint16_t value) {
  out.put(static_cast<char>(value & 0xff));
  out.put(static_cast<char>((value >> 8) & 0xff));
}

void writeLe32(std::ofstream& out, uint32_t value) {
  writeLe16(out, static_cast<uint16_t>(value & 0xffff));
  writeLe16(out, static_cast<uint16_t>((value >> 16) & 0xffff));
}

void writeLe64(std::ofstream& out, uint64_t value) {
  writeLe32(out, static_cast<uint32_t>(value & 0xffffffffULL));
  writeLe32(out, static_cast<uint32_t>((value >> 32) & 0xffffffffULL));
}

void writeLe32To(uint8_t* data, uint32_t value) {
  data[0] = static_cast<uint8_t>(value & 0xff);
  data[1] = static_cast<uint8_t>((value >> 8) & 0xff);
  data[2] = static_cast<uint8_t>((value >> 16) & 0xff);
  data[3] = static_cast<uint8_t>((value >> 24) & 0xff);
}

void writeBe32To(uint8_t* data, uint32_t value) {
  data[0] = static_cast<uint8_t>((value >> 24) & 0xff);
  data[1] = static_cast<uint8_t>((value >> 16) & 0xff);
  data[2] = static_cast<uint8_t>((value >> 8) & 0xff);
  data[3] = static_cast<uint8_t>(value & 0xff);
}

void writeDirectoryRecord(
    std::vector<uint8_t>& directory,
    size_t offset,
    uint32_t extent,
    uint32_t size,
    bool isDirectory,
    const std::string& name) {
  const size_t nameLength = name.size();
  const size_t recordLength = 33 + nameLength + ((nameLength % 2) == 0 ? 1 : 0);
  assert(offset + recordLength <= directory.size());
  directory[offset] = static_cast<uint8_t>(recordLength);
  writeLe32To(directory.data() + offset + 2, extent);
  writeBe32To(directory.data() + offset + 6, extent);
  writeLe32To(directory.data() + offset + 10, size);
  writeBe32To(directory.data() + offset + 14, size);
  directory[offset + 25] = isDirectory ? 0x02 : 0x00;
  directory[offset + 28] = 1;
  directory[offset + 31] = 1;
  directory[offset + 32] = static_cast<uint8_t>(nameLength);
  std::copy(name.begin(), name.end(), directory.begin() + static_cast<std::ptrdiff_t>(offset + 33));
}

void writeSpecialDirectoryRecord(
    std::vector<uint8_t>& directory,
    size_t offset,
    uint32_t extent,
    uint32_t size,
    uint8_t name) {
  directory[offset] = 34;
  writeLe32To(directory.data() + offset + 2, extent);
  writeBe32To(directory.data() + offset + 6, extent);
  writeLe32To(directory.data() + offset + 10, size);
  writeBe32To(directory.data() + offset + 14, size);
  directory[offset + 25] = 0x02;
  directory[offset + 28] = 1;
  directory[offset + 31] = 1;
  directory[offset + 32] = 1;
  directory[offset + 33] = name;
}

void writeTwilightTrack(
    std::vector<uint8_t>& toc,
    size_t offset,
    int trackNumber,
    uint32_t startSector,
    uint32_t sectorCount,
    uint32_t channelCount,
    uint32_t sampleRate,
    bool dst,
    const std::string& fileName) {
  std::memcpy(toc.data() + offset, "TWTE1", 5);
  writeLe32To(toc.data() + offset + 8, static_cast<uint32_t>(trackNumber));
  writeLe32To(toc.data() + offset + 12, startSector);
  writeLe32To(toc.data() + offset + 16, sectorCount);
  writeLe32To(toc.data() + offset + 20, channelCount);
  writeLe32To(toc.data() + offset + 24, sampleRate);
  writeLe32To(toc.data() + offset + 28, dst ? 1U : 0U);
  std::copy(fileName.begin(), fileName.end(), toc.begin() + static_cast<std::ptrdiff_t>(offset + 32));
}

std::filesystem::path writeSacdIsoFixture(const std::string& name) {
  const auto path = std::filesystem::temp_directory_path() / name;
  constexpr uint32_t kRootSector = 20;
  constexpr uint32_t kSacdSector = 21;
  constexpr uint32_t kSectorSize = 2048;
  std::vector<uint8_t> image(27 * kSectorSize, 0);
  uint8_t* pvd = image.data() + 16 * kSectorSize;
  pvd[0] = 1;
  std::memcpy(pvd + 1, "CD001", 5);
  pvd[6] = 1;
  writeLe32To(pvd + 156 + 2, kRootSector);
  writeBe32To(pvd + 156 + 6, kRootSector);
  writeLe32To(pvd + 156 + 10, kSectorSize);
  writeBe32To(pvd + 156 + 14, kSectorSize);
  pvd[156] = 34;
  pvd[156 + 25] = 0x02;
  pvd[156 + 28] = 1;
  pvd[156 + 31] = 1;
  pvd[156 + 32] = 1;
  uint8_t* terminator = image.data() + 17 * kSectorSize;
  terminator[0] = 255;
  std::memcpy(terminator + 1, "CD001", 5);
  terminator[6] = 1;

  std::vector<uint8_t> root(kSectorSize, 0);
  writeSpecialDirectoryRecord(root, 0, kRootSector, kSectorSize, 0);
  writeSpecialDirectoryRecord(root, 34, kRootSector, kSectorSize, 1);
  writeDirectoryRecord(root, 68, kSacdSector, kSectorSize, true, "SACD");
  std::copy(root.begin(), root.end(), image.begin() + kRootSector * kSectorSize);

  std::vector<uint8_t> sacd(kSectorSize, 0);
  writeSpecialDirectoryRecord(sacd, 0, kSacdSector, kSectorSize, 0);
  writeSpecialDirectoryRecord(sacd, 34, kRootSector, kSectorSize, 1);
  writeDirectoryRecord(sacd, 68, 22, 128, false, "MASTER.TOC");
  writeDirectoryRecord(sacd, 112, 23, 2048, false, "TWOCH_AREA.TOC");
  writeDirectoryRecord(sacd, 160, 25, 256, false, "TRACK01.DSD");
  std::copy(sacd.begin(), sacd.end(), image.begin() + kSacdSector * kSectorSize);

  std::vector<uint8_t> twoch(kSectorSize, 0);
  std::memcpy(twoch.data(), "TWTEAREA", 8);
  writeLe32To(twoch.data() + 8, 1);
  writeTwilightTrack(twoch, 16, 1, 25, 1, 2, kDsd64Rate, false, "TRACK01.DSD");
  std::copy(twoch.begin(), twoch.end(), image.begin() + 23 * kSectorSize);
  for (int i = 0; i < 256; ++i) image[25 * kSectorSize + i] = static_cast<uint8_t>(0x80 + (i & 0x3f));
  std::ofstream out(path, std::ios::binary);
  out.write(reinterpret_cast<const char*>(image.data()), static_cast<std::streamsize>(image.size()));
  return path;
}

std::filesystem::path writeDsfFixture(const std::string& name, int sampleRate = kDsd64Rate) {
  const auto path = std::filesystem::temp_directory_path() / name;
  constexpr uint32_t kChannels = 2;
  constexpr uint32_t kBlockSizePerChannel = 8;
  constexpr uint64_t kDataBytes = static_cast<uint64_t>(kChannels) * kBlockSizePerChannel;
  constexpr uint64_t kFileSize = 28 + 52 + 12 + kDataBytes;

  std::ofstream out(path, std::ios::binary);
  out.write("DSD ", 4);
  writeLe64(out, 28);
  writeLe64(out, kFileSize);
  writeLe64(out, 0);
  out.write("fmt ", 4);
  writeLe64(out, 52);
  writeLe32(out, 1);
  writeLe32(out, 0);
  writeLe32(out, 2);
  writeLe32(out, kChannels);
  writeLe32(out, static_cast<uint32_t>(sampleRate));
  writeLe32(out, 1);
  writeLe64(out, kBlockSizePerChannel * 8);
  writeLe32(out, kBlockSizePerChannel);
  writeLe32(out, 0);
  out.write("data", 4);
  writeLe64(out, 12 + kDataBytes);
  for (uint8_t byte : {0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88}) out.put(static_cast<char>(byte));
  for (uint8_t byte : {0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xf0, 0x0f}) out.put(static_cast<char>(byte));
  return path;
}

AudioFormat makePcmFormat(
    int sampleRate = 44100,
    int channels = 2,
    int bitDepth = 24,
    AudioSampleFormat sampleFormat = AudioSampleFormat::Int24Interleaved) {
  AudioFormat format;
  format.sampleRate = sampleRate;
  format.channelCount = channels;
  format.bitDepth = bitDepth;
  format.sampleFormat = sampleFormat;
  return format;
}

struct BackendSnapshot {
  int serial = 0;
  std::string backendId;
  AudioFormat requestedFormat;
  AudioFormat openedFormat;
  OutputInfo info;
  bool started = false;
  bool typedStarted = false;
  bool stopped = false;
  bool closed = false;
  int typedRenderCalls = 0;
  int floatRenderCalls = 0;
};

struct BackendState {
  int serial = 0;
  std::string backendId;
  AudioFormat requestedFormat;
  AudioFormat openedFormat;
  OutputInfo info;
  RenderCallback render;
  TypedRenderCallback typedRender;
  OutputEventCallback event;
  bool started = false;
  bool typedStarted = false;
  bool stopped = false;
  bool closed = false;
  int typedRenderCalls = 0;
  int floatRenderCalls = 0;
};

struct BackendRegistry {
  mutable std::mutex mutex;
  int nextSerial = 1;
  std::vector<std::shared_ptr<BackendState>> states;

  void reset() {
    std::lock_guard lock(mutex);
    nextSerial = 1;
    states.clear();
  }

  int registerState(const std::shared_ptr<BackendState>& state) {
    std::lock_guard lock(mutex);
    state->serial = nextSerial++;
    states.push_back(state);
    return state->serial;
  }

  std::vector<BackendSnapshot> snapshots() const {
    std::lock_guard lock(mutex);
    std::vector<BackendSnapshot> result;
    result.reserve(states.size());
    for (const auto& state : states) {
      BackendSnapshot snapshot;
      snapshot.serial = state->serial;
      snapshot.backendId = state->backendId;
      snapshot.requestedFormat = state->requestedFormat;
      snapshot.openedFormat = state->openedFormat;
      snapshot.info = state->info;
      snapshot.started = state->started;
      snapshot.typedStarted = state->typedStarted;
      snapshot.stopped = state->stopped;
      snapshot.closed = state->closed;
      snapshot.typedRenderCalls = state->typedRenderCalls;
      snapshot.floatRenderCalls = state->floatRenderCalls;
      result.push_back(snapshot);
    }
    return result;
  }

  std::shared_ptr<BackendState> latestStarted() const {
    std::lock_guard lock(mutex);
    for (auto it = states.rbegin(); it != states.rend(); ++it) {
      if ((*it)->started && !(*it)->closed) return *it;
    }
    return nullptr;
  }
};

BackendRegistry g_backendRegistry;

enum class FakeDopBehavior {
  Proven,
  Mismatch,
  Unproven
};

enum class FakeNativeDsdBehavior {
  Proven,
  AlsaTransportRate,
  Unsupported,
  Mismatch
};

FakeDopBehavior g_fakeDopBehavior = FakeDopBehavior::Proven;
FakeNativeDsdBehavior g_fakeNativeDsdBehavior = FakeNativeDsdBehavior::Proven;
std::atomic<int> g_decodeFirstReadDelayMs{0};
std::atomic<int> g_decodeEveryReadDelayMs{0};

bool formatLooksDopCarrier(const AudioFormat& format) {
  return (format.sampleRate == 176400 || format.sampleRate == 192000 ||
          format.sampleRate == 352800 || format.sampleRate == 384000 ||
          format.sampleRate == 705600 || format.sampleRate == 768000 ||
          format.sampleRate == 1411200 || format.sampleRate == 1536000) &&
         format.channelCount == 2 &&
         format.bitDepth == 24 &&
         (format.sampleFormat == AudioSampleFormat::Int24Interleaved ||
          format.sampleFormat == AudioSampleFormat::Int24In32Interleaved);
}

bool formatLooksDsdSourceRequest(const AudioFormat& format) {
  return (format.sampleRate == kDsd64Rate || format.sampleRate == kDsd128Rate ||
          format.sampleRate == kDsd256Rate || format.sampleRate == kDsd512Rate) &&
         format.channelCount == 2 && format.bitDepth == 1 && isDsdSampleFormat(format.sampleFormat);
}

bool formatLooksPcmTrackRequest(const AudioFormat& format) {
  return format.sampleRate == 44100 && format.channelCount == 2 && format.bitDepth == 24;
}

bool formatLooksDsdPcmFallbackRequest(const AudioFormat& format, int sampleRate = 176400) {
  return format.sampleRate == sampleRate && format.channelCount == 2 && format.bitDepth == 32 &&
         format.sampleFormat == AudioSampleFormat::Float32Interleaved;
}

void assertFormatLooksDsdPcmFallbackRequest(const AudioFormat& format, int sampleRate = 176400) {
  assert(formatLooksDsdPcmFallbackRequest(format, sampleRate));
}

bool jsonContains(const std::string& json, const std::string& needle) {
  return json.find(needle) != std::string::npos;
}

int32_t floatToSignedInt(double sample, int bits) {
  const double clamped = std::clamp(sample, -1.0, 1.0);
  if (bits == 16) {
    return static_cast<int32_t>(std::clamp(std::llround(clamped * 32768.0), -32768LL, 32767LL));
  }
  if (bits == 24) {
    return static_cast<int32_t>(std::clamp(std::llround(clamped * 8388608.0), -8388608LL, 8388607LL));
  }
  return static_cast<int32_t>(std::clamp(std::llround(clamped * 2147483648.0), -2147483648LL, 2147483647LL));
}

void writeSample(double sample, AudioSampleFormat format, uint8_t* output) {
  switch (format) {
    case AudioSampleFormat::Int16Interleaved: {
      const int16_t value = static_cast<int16_t>(floatToSignedInt(sample, 16));
      std::memcpy(output, &value, sizeof(value));
      break;
    }
    case AudioSampleFormat::Int24Interleaved: {
      const auto value = static_cast<uint32_t>(floatToSignedInt(sample, 24));
      output[0] = static_cast<uint8_t>(value & 0xff);
      output[1] = static_cast<uint8_t>((value >> 8) & 0xff);
      output[2] = static_cast<uint8_t>((value >> 16) & 0xff);
      break;
    }
    case AudioSampleFormat::Int24In32Interleaved: {
      const int32_t value = static_cast<int32_t>(static_cast<uint32_t>(floatToSignedInt(sample, 24)) << 8);
      std::memcpy(output, &value, sizeof(value));
      break;
    }
    case AudioSampleFormat::Int32Interleaved: {
      const int32_t value = floatToSignedInt(sample, 32);
      std::memcpy(output, &value, sizeof(value));
      break;
    }
    case AudioSampleFormat::Float32Interleaved:
    default: {
      const float value = static_cast<float>(sample);
      std::memcpy(output, &value, sizeof(value));
      break;
    }
  }
}

int32_t signed24FromBytes(uint8_t low, uint8_t mid, uint8_t high) {
  int32_t value = static_cast<int32_t>(low) | (static_cast<int32_t>(mid) << 8) |
                  (static_cast<int32_t>(high) << 16);
  if ((value & 0x800000) != 0) value |= ~0x00ffffff;
  return value;
}

float signedSampleToFloat(int32_t value, double scale) {
  return static_cast<float>(std::clamp(static_cast<double>(value) / scale, -1.0, 1.0));
}

void typedPcmToFloat(const PcmBlock& block, std::vector<float>* output) {
  if (!block.data || !output || block.frames == 0 || block.format.channelCount <= 0) return;
  const size_t channels = static_cast<size_t>(std::max(1, block.format.channelCount));
  const size_t samples = block.frames * channels;
  if (output->size() < samples) output->resize(samples, 0.0f);

  switch (block.format.sampleFormat) {
    case AudioSampleFormat::Int16Interleaved: {
      const auto* input = reinterpret_cast<const int16_t*>(block.data);
      for (size_t i = 0; i < samples; ++i) (*output)[i] = signedSampleToFloat(input[i], 32768.0);
      break;
    }
    case AudioSampleFormat::Int24Interleaved: {
      for (size_t i = 0; i < samples; ++i) {
        const size_t offset = i * 3;
        (*output)[i] =
            signedSampleToFloat(signed24FromBytes(block.data[offset], block.data[offset + 1], block.data[offset + 2]), 8388608.0);
      }
      break;
    }
    case AudioSampleFormat::Int24In32Interleaved: {
      const auto* input = reinterpret_cast<const int32_t*>(block.data);
      for (size_t i = 0; i < samples; ++i) (*output)[i] = signedSampleToFloat(input[i] >> 8, 8388608.0);
      break;
    }
    case AudioSampleFormat::Int32Interleaved: {
      const auto* input = reinterpret_cast<const int32_t*>(block.data);
      for (size_t i = 0; i < samples; ++i) (*output)[i] = signedSampleToFloat(input[i], 2147483648.0);
      break;
    }
    case AudioSampleFormat::Float32Interleaved:
    default: {
      const auto* input = reinterpret_cast<const float*>(block.data);
      std::copy(input, input + samples, output->begin());
      break;
    }
  }
}

bool waitUntil(const std::function<bool()>& predicate, int timeoutMs = 1500) {
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
  while (std::chrono::steady_clock::now() < deadline) {
    if (predicate()) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  return predicate();
}

bool waitForStartedBackendCount(size_t count, int timeoutMs = 1500) {
  return waitUntil(
      [count] {
        const auto snapshots = g_backendRegistry.snapshots();
        return snapshots.size() >= count && snapshots[count - 1].started && !snapshots[count - 1].closed;
      },
      timeoutMs);
}

std::shared_ptr<BackendState> waitForLatestStartedBackendState(int timeoutMs = 1500) {
  std::shared_ptr<BackendState> started;
  const bool ready = waitUntil(
      [&started] {
        started = g_backendRegistry.latestStarted();
        return static_cast<bool>(started);
      },
      timeoutMs);
  return ready ? started : nullptr;
}

std::vector<float> renderBackendFrames(const std::shared_ptr<BackendState>& state, size_t frames = 256) {
  assert(state);
  assert(state->openedFormat.channelCount > 0);
  const size_t channels = static_cast<size_t>(std::max(1, state->openedFormat.channelCount));
  std::vector<float> buffer(frames * channels, 0.0f);
  std::vector<uint8_t> typedBuffer(frames * audioFormatBytesPerFrame(state->openedFormat));

  RenderCallback render;
  TypedRenderCallback typedRender;
  {
    std::lock_guard lock(g_backendRegistry.mutex);
    render = state->render;
    typedRender = state->typedRender;
  }

  bool renderedTyped = false;
  if (typedRender && !typedBuffer.empty()) {
    PcmBlock block;
    block.format = state->openedFormat;
    block.data = typedBuffer.data();
    block.frames = frames;
    block.byteSize = typedBuffer.size();
    renderedTyped = typedRender(block) > 0;
    if (renderedTyped) {
      typedPcmToFloat(block, &buffer);
      std::lock_guard lock(g_backendRegistry.mutex);
      ++state->typedRenderCalls;
    }
  }
  if (!renderedTyped) {
    assert(render);
    render(buffer.data(), frames);
    std::lock_guard lock(g_backendRegistry.mutex);
    ++state->floatRenderCalls;
  }

  return buffer;
}

void pumpBackend(const std::shared_ptr<BackendState>& state, size_t iterations, size_t frames = 256) {
  assert(state);
  for (size_t i = 0; i < iterations; ++i) {
    renderBackendFrames(state, frames);
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
}

class FakeOutputBackend final : public IOutputBackend {
 public:
  explicit FakeOutputBackend(std::string backendId)
      : state_(std::make_shared<BackendState>()) {
    state_->backendId = std::move(backendId);
    g_backendRegistry.registerState(state_);
  }

  const char* id() const override {
    return state_->backendId.c_str();
  }

  bool open(const std::string& deviceId, const AudioFormat& requestedFormat, std::string* error) override {
    (void)error;
    std::lock_guard lock(g_backendRegistry.mutex);
    state_->requestedFormat = requestedFormat;

    AudioFormat opened = requestedFormat;
    if (formatLooksDopCarrier(requestedFormat)) {
      opened = requestedFormat;
      if (g_fakeDopBehavior == FakeDopBehavior::Mismatch) {
        opened.sampleFormat = AudioSampleFormat::Int24In32Interleaved;
      }
    } else if (formatLooksDsdSourceRequest(requestedFormat)) {
      if (g_fakeNativeDsdBehavior == FakeNativeDsdBehavior::Proven) {
        opened = requestedFormat;
      } else if (g_fakeNativeDsdBehavior == FakeNativeDsdBehavior::AlsaTransportRate) {
        opened = requestedFormat;
        opened.sampleRate = requestedFormat.sampleRate / 8;
      } else if (g_fakeNativeDsdBehavior == FakeNativeDsdBehavior::Mismatch) {
        opened = requestedFormat;
        opened.sampleFormat = AudioSampleFormat::Float32Interleaved;
        opened.bitDepth = 32;
      } else {
        opened = makePcmFormat(requestedFormat.sampleRate / 16, 2, 32, AudioSampleFormat::Float32Interleaved);
      }
    } else {
      opened = requestedFormat;
    }
    state_->openedFormat = opened;

    OutputInfo info;
    info.exclusive = state_->backendId == "wasapi-exclusive";
    info.supportsOutputPerfect =
        state_->backendId == "wasapi-exclusive" || state_->backendId == "asio" || state_->backendId == "alsa";
    info.backend = state_->backendId;
    info.actualBackend = state_->backendId;
    info.deviceName = deviceId.empty() ? "Test Device" : deviceId;
    info.actualDeviceName = info.deviceName;
    info.driverName = "Test Driver";
    info.actualDriverName = info.driverName;
    info.outputSampleRate = opened.sampleRate;
    info.outputBitDepth = opened.bitDepth;
    info.actualSampleRate = opened.sampleRate;
    info.actualBitDepth = opened.bitDepth;
    info.actualChannels = opened.channelCount;
    info.actualOutputFormat = sampleFormatToString(opened.sampleFormat);
    info.driverDopCapable = formatLooksDopCarrier(requestedFormat);
    info.driverDopCarrierSampleRates = {176400, 192000, 352800, 384000, 705600, 768000, 1411200, 1536000};
    info.driverDopCarrierFormats = {"int24", "int24-in32"};
    info.driverNativeDsdCapable = state_->backendId == "asio" || state_->backendId == "alsa";
    info.driverNativeDsdSampleRates = {kDsd64Rate, kDsd128Rate, kDsd256Rate, kDsd512Rate};
    info.channelRoutingMode = "auto";
    state_->info = info;
    return true;
  }

  bool setOutputConfig(const OutputConfig& config, std::string* error) override {
    (void)error;
    std::lock_guard lock(g_backendRegistry.mutex);
    state_->info.channelRoutingMode = channelRoutingModeToString(config.routingMode);
    return true;
  }

  bool start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error) override {
    (void)error;
    std::lock_guard lock(g_backendRegistry.mutex);
    state_->render = std::move(callback);
    state_->typedRender = nullptr;
    state_->event = std::move(eventCallback);
    state_->started = true;
    state_->typedStarted = false;
    return true;
  }

  bool startTyped(
      TypedRenderCallback callback,
      RenderCallback fallbackCallback,
      OutputEventCallback eventCallback,
      std::string* error) override {
    (void)error;
    std::lock_guard lock(g_backendRegistry.mutex);
    state_->typedRender = std::move(callback);
    state_->render = std::move(fallbackCallback);
    state_->event = std::move(eventCallback);
    state_->started = true;
    state_->typedStarted = true;
    return true;
  }

  void stop() override {
    std::lock_guard lock(g_backendRegistry.mutex);
    state_->stopped = true;
  }

  void close() override {
    std::lock_guard lock(g_backendRegistry.mutex);
    state_->closed = true;
  }

  AudioFormat outputFormat() const override {
    std::lock_guard lock(g_backendRegistry.mutex);
    return state_->openedFormat;
  }

  OutputInfo outputInfo() const override {
    std::lock_guard lock(g_backendRegistry.mutex);
    return state_->info;
  }

  DopRuntimeFacts dopRuntimeFacts() const override {
    std::lock_guard lock(g_backendRegistry.mutex);
    DopRuntimeFacts facts;
    if (!formatLooksDopCarrier(state_->requestedFormat)) return facts;

    facts.candidateFormat = state_->requestedFormat;
    facts.explicitlyCapable = true;
    if (g_fakeDopBehavior == FakeDopBehavior::Unproven) {
      facts.actualFormat = state_->openedFormat;
      facts.state = DopRuntimeFactState::Unproven;
      facts.reason = "DoP backend could not prove passthrough";
      return facts;
    }
    if (!formatLooksDopCarrier(state_->openedFormat)) {
      facts.state = DopRuntimeFactState::Unproven;
      facts.reason = "DoP backend could not prove passthrough";
      return facts;
    }

    facts.actualFormat = state_->openedFormat;
    if (!pcmFormatsExactMatch(facts.candidateFormat, facts.actualFormat)) {
      facts.state = DopRuntimeFactState::Mismatch;
      facts.reason = "DoP carrier mismatch";
      return facts;
    }

    facts.state = DopRuntimeFactState::Proven;
    facts.reason = "Fake backend accepted an exact DoP carrier";
    return facts;
  }

  NativeDsdRuntimeFacts nativeDsdRuntimeFacts() const override {
    std::lock_guard lock(g_backendRegistry.mutex);
    NativeDsdRuntimeFacts facts;
    if (!formatLooksDsdSourceRequest(state_->requestedFormat)) {
      return unsupportedNativeDsdRuntimeFacts("No Native DSD stream was requested");
    }
    facts.requestedDsdRate = state_->requestedFormat.sampleRate;
    facts.channelCount = state_->requestedFormat.channelCount;
    facts.explicitlyCapable = state_->backendId == "asio" || state_->backendId == "alsa";
    facts.advertisedSampleRates = {kDsd64Rate, kDsd128Rate, kDsd256Rate, kDsd512Rate};
    if (!facts.explicitlyCapable || g_fakeNativeDsdBehavior == FakeNativeDsdBehavior::Unsupported) {
      facts.state = NativeDsdRuntimeFactState::Unsupported;
      facts.reason = "Fake ASIO backend does not advertise Native DSD support";
      return facts;
    }
    if (!isDsdSampleFormat(state_->openedFormat.sampleFormat)) {
      facts.state = NativeDsdRuntimeFactState::Mismatch;
      facts.actualDsdRate = state_->openedFormat.sampleRate >= kDsd64Rate ? state_->openedFormat.sampleRate : 0;
      facts.reason = "Fake ASIO runtime sample type is not Native DSD";
      return facts;
    }
    if (g_fakeNativeDsdBehavior == FakeNativeDsdBehavior::AlsaTransportRate) {
      facts.state = NativeDsdRuntimeFactState::Proven;
      facts.actualDsdRate = facts.requestedDsdRate;
      facts.reason = "Fake ALSA Native DSD stream started with a matching runtime bit-clock";
      return facts;
    }
    if (!dsdFormatsExactMatch(state_->requestedFormat, state_->openedFormat)) {
      facts.state = NativeDsdRuntimeFactState::Mismatch;
      facts.actualDsdRate = state_->openedFormat.sampleRate;
      facts.reason = "Fake ASIO actual Native DSD format does not exactly match the negotiated format";
      return facts;
    }
    facts.state = NativeDsdRuntimeFactState::Proven;
    facts.actualDsdRate = facts.requestedDsdRate;
    facts.reason = "Fake ASIO Native DSD stream started with a matching runtime rate";
    return facts;
  }

  std::string deviceName() const override {
    std::lock_guard lock(g_backendRegistry.mutex);
    return state_->info.deviceName;
  }

 private:
  std::shared_ptr<BackendState> state_;
};

struct TrackProfile {
  AudioStreamInfo stream;
  AudioFormat defaultOutput;
  size_t totalFrames = 8192;
  float sampleValue = 0.25f;
};

TrackProfile buildTrackProfile(const std::string& source) {
  TrackProfile profile;
  profile.stream.source = source;
  profile.stream.durationSeconds = 30.0;
  profile.stream.sourceLossless = true;
  if ((source.size() >= 4 && source.substr(source.size() - 4) == ".dsf") || source.find(".iso") != std::string::npos) {
    const bool isDsd512 = source.find("dsd512") != std::string::npos;
    const bool isDsd256 = source.find("dsd256") != std::string::npos;
    const bool isDsd128 = source.find("dsd128") != std::string::npos;
    const int dsdSampleRate = isDsd512 ? kDsd512Rate : (isDsd256 ? kDsd256Rate : (isDsd128 ? kDsd128Rate : kDsd64Rate));
    const int dsdRate = isDsd512 ? 512 : (isDsd256 ? 256 : (isDsd128 ? 128 : 64));
    profile.stream.codec = "dsd";
    profile.stream.sourceFormat.sampleRate = dsdSampleRate;
    profile.stream.sourceFormat.channelCount = 2;
    profile.stream.sourceFormat.bitDepth = 1;
    profile.stream.sourceFormat.sampleFormat = AudioSampleFormat::Float32Interleaved;
    profile.stream.decodedFormat = makePcmFormat(dsdSampleRate / 16, 2, 32, AudioSampleFormat::Float32Interleaved);
    profile.stream.isDsd = true;
    profile.stream.dsdMode = DsdMode::Pcm;
    profile.stream.dsdRate = dsdRate;
    profile.defaultOutput = profile.stream.decodedFormat;
    profile.sampleValue = 0.5f;
    return profile;
  }

  profile.stream.codec = "flac";
  profile.stream.sourceFormat = makePcmFormat(44100, 2, 24, AudioSampleFormat::Int24Interleaved);
  profile.stream.decodedFormat = profile.stream.sourceFormat;
  profile.defaultOutput = profile.stream.decodedFormat;
  profile.totalFrames = 65536;
  profile.sampleValue = 0.25f;
  if (source.find("empty-track") != std::string::npos) {
    profile.totalFrames = 0;
    profile.stream.durationSeconds = 0.0;
  } else if (source.find("crossfade-current") != std::string::npos) {
    profile.totalFrames = 4096;
    profile.sampleValue = 0.25f;
  } else if (source.find("crossfade-next") != std::string::npos) {
    profile.totalFrames = 8192;
    profile.sampleValue = 0.75f;
  }
  return profile;
}

class EngineHarness {
 public:
  EngineHarness(
      std::string fixtureName = "twilight-phase6d-runtime-reroute-dsd64.dsf",
      int sampleRate = kDsd64Rate)
      : dsdPath_(writeDsfFixture(fixtureName, sampleRate)) {
    dsdPathString_ = dsdPath_.string();
    g_backendRegistry.reset();
    g_fakeDopBehavior = FakeDopBehavior::Proven;
    g_fakeNativeDsdBehavior = FakeNativeDsdBehavior::Proven;
    engine_.setOutputBackend("wasapi-exclusive");
  }

  ~EngineHarness() {
    engine_.stop();
    g_fakeDopBehavior = FakeDopBehavior::Proven;
    g_fakeNativeDsdBehavior = FakeNativeDsdBehavior::Proven;
    g_decodeFirstReadDelayMs = 0;
    g_decodeEveryReadDelayMs = 0;
    std::error_code ignored;
    std::filesystem::remove(dsdPath_, ignored);
  }

  TwilightAudioEngine& engine() { return engine_; }
  const std::string& dsdPath() const { return dsdPathString_; }

 private:
  TwilightAudioEngine engine_;
  std::filesystem::path dsdPath_;
  std::string dsdPathString_;
};

void assertLatestPlaybackContains(TwilightAudioEngine& engine, const std::string& needle) {
  const std::string json = engine.getPlaybackInfoJson();
  if (!jsonContains(json, needle)) {
    std::fprintf(stderr, "Missing playback JSON fragment: %s\nPlayback JSON: %s\n", needle.c_str(), json.c_str());
  }
  assert(jsonContains(json, needle));
}

double playbackJsonNumber(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\":";
  const size_t start = json.find(marker);
  assert(start != std::string::npos);
  const size_t valueStart = start + marker.size();
  const size_t valueEnd = json.find_first_of(",}", valueStart);
  assert(valueEnd != std::string::npos);
  return std::stod(json.substr(valueStart, valueEnd - valueStart));
}

bool bufferHasSampleAbove(const std::vector<float>& samples, float threshold) {
  return std::any_of(samples.begin(), samples.end(), [threshold](float sample) { return sample > threshold; });
}

void testDsd64StartsOnDop() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(formatLooksDopCarrier(snapshots.front().requestedFormat));
  assertLatestPlaybackContains(engine, "\"isDsd\":true");
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"dop\"");
  assertLatestPlaybackContains(engine, "\"outputPerfect\":true");
}

void testPcmTypedPassthroughIsOutputPerfect() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.play("typed-passthrough.flac", 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto backend = waitForLatestStartedBackendState();
  assert(backend);
  pumpBackend(backend, 2, 128);

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(formatLooksPcmTrackRequest(snapshots.front().requestedFormat));
  assert(snapshots.front().typedStarted);
  assert(snapshots.front().typedRenderCalls > 0);
  assert(snapshots.front().floatRenderCalls == 0);
  assertLatestPlaybackContains(engine, "\"isDsd\":false");
  assertLatestPlaybackContains(engine, "\"decodedBitDepth\":24");
  assertLatestPlaybackContains(engine, "\"decodedSampleFormat\":\"int24\"");
  assertLatestPlaybackContains(engine, "\"pcmPassthrough\":true");
  assertLatestPlaybackContains(engine, "\"outputPerfect\":true");
  assertLatestPlaybackContains(engine, "\"perfectReasonCode\":\"\"");
}

void testPcmTypedPassthroughKeepsTypedPathDuringTransientDecoderLag() {
  EngineHarness harness;
  auto& engine = harness.engine();

  g_decodeEveryReadDelayMs = 50;
  assert(engine.play("typed-transient-decoder-lag.flac", 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto backend = waitForLatestStartedBackendState();
  assert(backend);
  renderBackendFrames(backend, 2048);
  renderBackendFrames(backend, 2048);

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(snapshots.front().typedStarted);
  assert(snapshots.front().typedRenderCalls == 2);
  assert(snapshots.front().floatRenderCalls == 0);
}

void testOutputStartWaitsForFirstDecodedFrames() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.setVolume(0.5) == TAE_RESULT_OK);
  g_decodeFirstReadDelayMs = 150;
  std::atomic<int> result{TAE_RESULT_INTERNAL_ERROR};
  std::thread playThread([&] {
    result = engine.play("typed-preroll.flac", 0.0);
  });

  std::this_thread::sleep_for(std::chrono::milliseconds(40));
  const auto earlySnapshots = g_backendRegistry.snapshots();
  assert(earlySnapshots.size() == 1);
  assert(!earlySnapshots.front().started);

  playThread.join();
  assert(result == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto backend = waitForLatestStartedBackendState();
  assert(backend);
  const auto rendered = renderBackendFrames(backend, 128);
  assert(bufferHasSampleAbove(rendered, 0.10f));
}

void testOutputStartDoesNotWaitForPrerollTimeoutAtEof() {
  EngineHarness harness;
  auto& engine = harness.engine();

  const auto start = std::chrono::steady_clock::now();
  assert(engine.play("empty-track.flac", 0.0) == TAE_RESULT_OK);
  const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - start);

  assert(elapsed < std::chrono::milliseconds(250));
  assert(waitForStartedBackendCount(1));
}

void testBackendRenderErrorIsReportedThroughLastError() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.play("backend-render-error.flac", 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto backend = waitForLatestStartedBackendState();
  assert(backend);
  {
    std::lock_guard lock(g_backendRegistry.mutex);
    assert(static_cast<bool>(backend->event));
    backend->event(OutputBackendEvent::RenderError, "fake backend render failed");
  }

  assert(waitUntil([&] {
    const std::string errorJson = engine.getLastErrorJson();
    return jsonContains(errorJson, "\"hasError\":true") &&
           jsonContains(errorJson, "fake backend render failed") &&
           jsonContains(errorJson, "\"context\":\"render\"");
  }));
}

void testStoppedSetOutputDeviceKeepsOutputInfoDeviceNamesConsistent() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.setOutputDevice("device-a") == TAE_RESULT_OK);
  assert(engine.play("device-consistency.flac", 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));
  assertLatestPlaybackContains(engine, "\"outputDevice\":\"device-a\"");
  assertLatestPlaybackContains(engine, "\"deviceName\":\"device-a\"");
  assert(engine.stop() == TAE_RESULT_OK);

  assert(engine.setOutputDevice("device-b") == TAE_RESULT_OK);
  const std::string json = engine.getPlaybackInfoJson();
  assert(jsonContains(json, "\"outputDevice\":\"device-b\""));
  assert(jsonContains(json, "\"deviceName\":\"device-b\""));
  assert(jsonContains(json, "\"actualDeviceName\":\"device-b\""));
}

void testRenderWaitsForTransientDecoderLag() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.setVolume(0.5) == TAE_RESULT_OK);
  g_decodeEveryReadDelayMs = 3;
  assert(engine.play("transient-decoder-lag.flac", 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto backend = waitForLatestStartedBackendState();
  assert(backend);
  const auto first = renderBackendFrames(backend, 2048);
  assert(bufferHasSampleAbove(first, 0.10f));
  bool recovered = false;
  for (int attempt = 0; attempt < 8 && !recovered; ++attempt) {
    const auto next = renderBackendFrames(backend, 2048);
    recovered = bufferHasSampleAbove(next, 0.10f);
    if (!recovered) std::this_thread::sleep_for(std::chrono::milliseconds(4));
  }
  assert(recovered);
}

void testRoutedRenderHandlesCallbacksLargerThanPreparedScratch() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.setOutputConfig("{\"routingMode\":\"stereo-to-5.1\"}") == TAE_RESULT_OK);
  assert(engine.play("large-routed-render.flac", 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto backend = waitForLatestStartedBackendState();
  assert(backend);
  assert(backend->openedFormat.channelCount == 6);

  assert(waitUntil([&] {
    const auto rendered = renderBackendFrames(backend, 2048);
    return bufferHasSampleAbove(rendered, 0.10f);
  }));
  assertLatestPlaybackContains(engine, "\"channelRoutingMode\":\"stereo-to-5.1\"");
}

void testPcmVolumeFallsBackToFloatProcessing() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.setVolume(0.5) == TAE_RESULT_OK);
  assert(engine.play("typed-volume-fallback.flac", 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto backend = waitForLatestStartedBackendState();
  assert(backend);
  pumpBackend(backend, 2, 128);

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(formatLooksPcmTrackRequest(snapshots.front().requestedFormat));
  assert(snapshots.front().typedStarted);
  assert(snapshots.front().typedRenderCalls == 0);
  assert(snapshots.front().floatRenderCalls > 0);
  assertLatestPlaybackContains(engine, "\"decodedBitDepth\":32");
  assertLatestPlaybackContains(engine, "\"decodedSampleFormat\":\"float32\"");
  assertLatestPlaybackContains(engine, "\"pcmPassthrough\":false");
  assertLatestPlaybackContains(engine, "\"outputPerfect\":false");
  assertLatestPlaybackContains(engine, "\"perfectReasonCode\":\"volume_not_unity\"");
}

void testDsd128StartsOnDop() {
  EngineHarness harness("twilight-phase6d-runtime-reroute-dsd128.dsf", kDsd128Rate);
  auto& engine = harness.engine();

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(formatLooksDopCarrier(snapshots.front().requestedFormat));
  assert(snapshots.front().requestedFormat.sampleRate == 352800);
  assertLatestPlaybackContains(engine, "\"isDsd\":true");
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"dop\"");
  assertLatestPlaybackContains(engine, "\"dsdRate\":128");
  assertLatestPlaybackContains(engine, "\"outputPerfect\":true");
}

void testAsioAutoPrefersNativeDsd() {
  EngineHarness harness;
  auto& engine = harness.engine();
  assert(engine.setOutputBackend("asio") == TAE_RESULT_OK);

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(formatLooksDsdSourceRequest(snapshots.front().requestedFormat));
  assert(snapshots.front().requestedFormat.sampleRate == kDsd64Rate);
  assert(snapshots.front().typedStarted);
  assertLatestPlaybackContains(engine, "\"isDsd\":true");
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"native\"");
  assertLatestPlaybackContains(engine, "\"nativeDsdRuntimeState\":\"proven\"");
  assertLatestPlaybackContains(engine, "\"sourceExact\":true");
  assertLatestPlaybackContains(engine, "\"outputPerfect\":true");
}

void testAlsaNativeDsdAcceptsTransportFrameRate() {
  EngineHarness harness;
  auto& engine = harness.engine();
  assert(engine.setOutputBackend("alsa") == TAE_RESULT_OK);
  g_fakeNativeDsdBehavior = FakeNativeDsdBehavior::AlsaTransportRate;

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(formatLooksDsdSourceRequest(snapshots.front().requestedFormat));
  assert(snapshots.front().openedFormat.sampleRate == kDsd64Rate / 8);
  assert(isDsdSampleFormat(snapshots.front().openedFormat.sampleFormat));
  assert(snapshots.front().typedStarted);
  assertLatestPlaybackContains(engine, "\"isDsd\":true");
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"native\"");
  assertLatestPlaybackContains(engine, "\"nativeDsdActualRate\":2822400");
  assertLatestPlaybackContains(engine, "\"nativeDsdRuntimeState\":\"proven\"");
  assertLatestPlaybackContains(engine, "\"outputPerfect\":true");
}

void testAsioDopModeDoesNotTryNativeDsd() {
  EngineHarness harness;
  auto& engine = harness.engine();
  assert(engine.setOutputBackend("asio") == TAE_RESULT_OK);
  assert(engine.setDspConfig("{\"dsdOutputMode\":\"dop\"}") == TAE_RESULT_OK);

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(formatLooksDopCarrier(snapshots.front().requestedFormat));
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"dop\"");
}

void testAsioPcmModeDoesNotTryNativeDsd() {
  EngineHarness harness;
  auto& engine = harness.engine();
  assert(engine.setOutputBackend("asio") == TAE_RESULT_OK);
  assert(engine.setDspConfig("{\"dsdOutputMode\":\"pcm\"}") == TAE_RESULT_OK);

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assertFormatLooksDsdPcmFallbackRequest(snapshots.front().requestedFormat);
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");
  assertLatestPlaybackContains(engine, "\"perfectReason\":\"DSD output mode forced PCM\"");
}

void testAsioNativeDsdMismatchFallsBackToDop() {
  EngineHarness harness;
  auto& engine = harness.engine();
  assert(engine.setOutputBackend("asio") == TAE_RESULT_OK);
  g_fakeNativeDsdBehavior = FakeNativeDsdBehavior::Mismatch;

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(2));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 2);
  assert(formatLooksDsdSourceRequest(snapshots.front().requestedFormat));
  assert(!snapshots.front().started);
  assert(!snapshots.front().typedStarted);
  assert(formatLooksDopCarrier(snapshots.back().requestedFormat));
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"dop\"");
}

void testAsioNativeDsdAndDopFailureFallsBackToPcm() {
  EngineHarness harness;
  auto& engine = harness.engine();
  assert(engine.setOutputBackend("asio") == TAE_RESULT_OK);
  g_fakeNativeDsdBehavior = FakeNativeDsdBehavior::Mismatch;
  g_fakeDopBehavior = FakeDopBehavior::Unproven;

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(3));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 3);
  assert(formatLooksDsdSourceRequest(snapshots[0].requestedFormat));
  assert(!snapshots[0].started);
  assert(!snapshots[0].typedStarted);
  assert(formatLooksDopCarrier(snapshots[1].requestedFormat));
  assert(!snapshots[1].started);
  assert(!snapshots[1].typedStarted);
  assertFormatLooksDsdPcmFallbackRequest(snapshots[2].requestedFormat);
  assert(snapshots[2].started);
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");
  assertLatestPlaybackContains(engine, "\"perfectReasonCode\":\"dop_passthrough_unproven\"");
}

void testDsd256StartsOnWasapiExclusiveDop() {
  // After G2 (DoP DSD256/512 support), DSD256 on wasapi-exclusive now enters
  // DoP with a 705600 carrier instead of falling back to PCM. The fake
  // wasapi-exclusive backend proves DoP passthrough when the carrier is
  // accepted, so dsdMode resolves to "dop".
  EngineHarness harness("twilight-phase6d-runtime-reroute-dsd256.dsf", kDsd256Rate);
  auto& engine = harness.engine();

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(formatLooksDopCarrier(snapshots.front().requestedFormat));
  assert(snapshots.front().requestedFormat.sampleRate == 705600);
  assertLatestPlaybackContains(engine, "\"isDsd\":true");
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"dop\"");
  assertLatestPlaybackContains(engine, "\"dsdRate\":256");
}

void testDsd256StartsOnAsioNativeDsd() {
  EngineHarness harness("twilight-phase6d-runtime-reroute-dsd256.dsf", kDsd256Rate);
  auto& engine = harness.engine();
  assert(engine.setOutputBackend("asio") == TAE_RESULT_OK);

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(formatLooksDsdSourceRequest(snapshots.front().requestedFormat));
  assert(snapshots.front().requestedFormat.sampleRate == kDsd256Rate);
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"native\"");
  assertLatestPlaybackContains(engine, "\"dsdRate\":256");
  assertLatestPlaybackContains(engine, "\"nativeDsdRuntimeState\":\"proven\"");
  assertLatestPlaybackContains(engine, "\"outputPerfect\":true");
}

void testNativeDsdPositionUsesBitSampleFrames() {
  EngineHarness harness("twilight-phase6d-runtime-reroute-dsd64-position.dsf", kDsd64Rate);
  auto& engine = harness.engine();
  assert(engine.setOutputBackend("asio") == TAE_RESULT_OK);

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));
  auto state = waitForLatestStartedBackendState();
  assert(state);
  assert(waitUntil([&] {
    renderBackendFrames(state, 8);
    return playbackJsonNumber(engine.getPlaybackInfoJson(), "position") > 0.0;
  }));

  const std::string json = engine.getPlaybackInfoJson();
  const double position = playbackJsonNumber(json, "position");
  const double expected = (8.0 * 8.0) / static_cast<double>(kDsd64Rate);
  if (std::abs(position - expected) > 0.000001) {
    std::fprintf(stderr, "Native DSD position mismatch: expected %.12f got %.12f\nPlayback JSON: %s\n", expected, position, json.c_str());
    std::abort();
  }
}

void testDsd512StartsOnAsioNativeDsd() {
  EngineHarness harness("twilight-phase6d-runtime-reroute-dsd512.dsf", kDsd512Rate);
  auto& engine = harness.engine();
  assert(engine.setOutputBackend("asio") == TAE_RESULT_OK);

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(formatLooksDsdSourceRequest(snapshots.front().requestedFormat));
  assert(snapshots.front().requestedFormat.sampleRate == kDsd512Rate);
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"native\"");
  assertLatestPlaybackContains(engine, "\"dsdRate\":512");
  assertLatestPlaybackContains(engine, "\"nativeDsdRuntimeState\":\"proven\"");
  assertLatestPlaybackContains(engine, "\"outputPerfect\":true");
}

void testSacdIsoTrackUsesAsioNativeDsd() {
  EngineHarness harness;
  auto& engine = harness.engine();
  assert(engine.setOutputBackend("asio") == TAE_RESULT_OK);
  const auto iso = writeSacdIsoFixture("twilight-sacd-runtime-native.iso");
  const std::string source = iso.string() + "?area=stereo&track=1";

  assert(engine.play(source, 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assert(formatLooksDsdSourceRequest(snapshots.front().requestedFormat));
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"native\"");
  assertLatestPlaybackContains(engine, "\"nativeDsdRuntimeState\":\"proven\"");
  assertLatestPlaybackContains(engine, "\"outputPerfect\":true");
  std::error_code ignored;
  std::filesystem::remove(iso, ignored);
}

void testSacdIsoTrackFallsBackToPcmWhenProcessingActive() {
  EngineHarness harness;
  auto& engine = harness.engine();
  assert(engine.setOutputBackend("asio") == TAE_RESULT_OK);
  assert(engine.setVolume(0.5) == TAE_RESULT_OK);
  const auto iso = writeSacdIsoFixture("twilight-sacd-runtime-pcm.iso");
  const std::string source = iso.string() + "?area=stereo&track=1";

  assert(engine.play(source, 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assertFormatLooksDsdPcmFallbackRequest(snapshots.front().requestedFormat);
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");
  assertLatestPlaybackContains(engine, "\"perfectReasonCode\":\"dsd_processing_pcm_fallback\"");
  std::error_code ignored;
  std::filesystem::remove(iso, ignored);
}

void testDopMismatchFallsBackWithStableCode() {
  EngineHarness harness;
  auto& engine = harness.engine();
  g_fakeDopBehavior = FakeDopBehavior::Mismatch;

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(2));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 2);
  assert(formatLooksDopCarrier(snapshots.front().requestedFormat));
  assert(!snapshots.front().started);
  assert(!snapshots.front().typedStarted);
  assertFormatLooksDsdPcmFallbackRequest(snapshots.back().requestedFormat);
  assert(snapshots.back().started);
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");
  assertLatestPlaybackContains(engine, "\"perfectReasonCode\":\"dop_carrier_mismatch\"");
}

void testDopUnprovenFallsBackWithStableCode() {
  EngineHarness harness;
  auto& engine = harness.engine();
  g_fakeDopBehavior = FakeDopBehavior::Unproven;

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(2));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 2);
  assert(formatLooksDopCarrier(snapshots.front().requestedFormat));
  assert(!snapshots.front().started);
  assert(!snapshots.front().typedStarted);
  assertFormatLooksDsdPcmFallbackRequest(snapshots.back().requestedFormat);
  assert(snapshots.back().started);
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");
  assertLatestPlaybackContains(engine, "\"perfectReasonCode\":\"dop_passthrough_unproven\"");
}

void testInitialNonUnityVolumeUsesPcmFallback() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.setVolume(0.5) == TAE_RESULT_OK);
  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() == 1);
  assertFormatLooksDsdPcmFallbackRequest(snapshots.front().requestedFormat);
  assertLatestPlaybackContains(engine, "\"volume\":0.5");
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");
  assertLatestPlaybackContains(engine, "\"perfectReasonCode\":\"dsd_processing_pcm_fallback\"");
}

void testEqEnableRequestsPcmReroute() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const char* eqJson =
      "{\"dspEnabled\":true,\"eqEnabled\":true,\"eqMode\":\"parametric\","
      "\"eqBands\":[{\"frequency\":1000,\"gain\":3,\"q\":1,\"filterType\":\"peak\"}]}";
  assert(engine.setDspConfig(eqJson) == TAE_RESULT_OK);

  assert(waitForStartedBackendCount(2));
  const auto snapshots = g_backendRegistry.snapshots();
  assertFormatLooksDsdPcmFallbackRequest(snapshots.back().requestedFormat);
  assertLatestPlaybackContains(engine, "\"eqActive\":true");
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");
  assertLatestPlaybackContains(engine, "\"perfectReason\":\"DSD processing active; falling back to PCM\"");
}

void testVolumeChangeRequestsPcmReroute() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  assert(engine.setVolume(0.5) == TAE_RESULT_OK);

  assert(waitForStartedBackendCount(2));
  const auto snapshots = g_backendRegistry.snapshots();
  assertFormatLooksDsdPcmFallbackRequest(snapshots.back().requestedFormat);
  assertLatestPlaybackContains(engine, "\"volume\":0.5");
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");
}

void testDsdOutputModePcmRequestsPcmReroute() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  assert(engine.setDspConfig("{\"dsdOutputMode\":\"pcm\"}") == TAE_RESULT_OK);

  assert(waitForStartedBackendCount(2));
  const auto snapshots = g_backendRegistry.snapshots();
  assertFormatLooksDsdPcmFallbackRequest(snapshots.back().requestedFormat);
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");
  assertLatestPlaybackContains(engine, "\"perfectReason\":\"DSD output mode forced PCM\"");
}

void testDsdOutputModeDopReentersDopPath() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.setDspConfig("{\"dsdOutputMode\":\"pcm\"}") == TAE_RESULT_OK);
  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));
  assertFormatLooksDsdPcmFallbackRequest(g_backendRegistry.snapshots().back().requestedFormat);
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");

  assert(engine.setDspConfig("{\"dsdOutputMode\":\"dop\"}") == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(2));
  const auto snapshots = g_backendRegistry.snapshots();
  assert(formatLooksDopCarrier(snapshots.back().requestedFormat));
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"dop\"");
}

void testSeekReevaluatesDsdPath() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  assert(engine.seek(5.0) == TAE_RESULT_OK);

  assert(waitForStartedBackendCount(2));
  const auto snapshots = g_backendRegistry.snapshots();
  assert(formatLooksDopCarrier(snapshots.back().requestedFormat));
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"dop\"");
}

void testPausedSettingsFallbackBeforeResume() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  assert(engine.pause() == TAE_RESULT_OK);
  assertLatestPlaybackContains(engine, "\"state\":\"paused\"");

  const char* eqJson =
      "{\"dspEnabled\":true,\"eqEnabled\":true,\"eqMode\":\"parametric\","
      "\"eqBands\":[{\"frequency\":1000,\"gain\":3,\"q\":1,\"filterType\":\"peak\"}]}";
  assert(engine.setDspConfig(eqJson) == TAE_RESULT_OK);

  assert(waitForStartedBackendCount(2));
  assertLatestPlaybackContains(engine, "\"state\":\"paused\"");
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");

  assert(engine.pause() == TAE_RESULT_OK);
  assertLatestPlaybackContains(engine, "\"state\":\"playing\"");
  assertLatestPlaybackContains(engine, "\"dsdMode\":\"pcm\"");
  assert(g_backendRegistry.snapshots().size() == 2);
}

void testManualNextDoesNotInheritDsdPath() {
  EngineHarness harness;
  auto& engine = harness.engine();

  const std::string queueJson = "[{\"id\":\"dsd\",\"source\":\"" + harness.dsdPath() +
                                "\",\"duration\":30},{\"id\":\"pcm\",\"source\":\"next.flac\",\"duration\":30}]";
  assert(engine.loadQueue(queueJson, 0) == TAE_RESULT_OK);
  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  assert(engine.next() == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(2));
  const auto snapshots = g_backendRegistry.snapshots();
  assert(formatLooksPcmTrackRequest(snapshots.back().requestedFormat));
  assertLatestPlaybackContains(engine, "\"source\":\"next.flac\"");
  assertLatestPlaybackContains(engine, "\"isDsd\":false");
}

void testAutoNextDoesNotInheritDsdPath() {
  EngineHarness harness;
  auto& engine = harness.engine();

  const std::string queueJson = "[{\"id\":\"dsd\",\"source\":\"" + harness.dsdPath() +
                                "\",\"duration\":30},{\"id\":\"pcm\",\"source\":\"auto-next.flac\",\"duration\":30}]";
  assert(engine.loadQueue(queueJson, 0) == TAE_RESULT_OK);
  assert(engine.play(harness.dsdPath(), 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));
  const auto backend = waitForLatestStartedBackendState();
  assert(backend);

  pumpBackend(backend, 96);
  assert(waitUntil([&engine] {
    return jsonContains(engine.getPlaybackInfoJson(), "\"source\":\"auto-next.flac\"");
  }));

  const auto snapshots = g_backendRegistry.snapshots();
  assert(snapshots.size() >= 2);
  assert(formatLooksPcmTrackRequest(snapshots.back().requestedFormat));
  assertLatestPlaybackContains(engine, "\"isDsd\":false");
  assertLatestPlaybackContains(engine, "\"source\":\"auto-next.flac\"");
}

void testNativeCrossfadeOverlapMixesPreloadAndPromotes() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.setDspConfig("{\"gapless\":true,\"crossfadeSeconds\":0.04}") == TAE_RESULT_OK);
  const std::string queueJson =
      "[{\"id\":\"current\",\"source\":\"crossfade-current.flac\",\"duration\":0.08},"
      "{\"id\":\"next\",\"source\":\"crossfade-next.flac\",\"duration\":0.20}]";
  assert(engine.loadQueue(queueJson, 0) == TAE_RESULT_OK);
  assert(engine.play("crossfade-current.flac", 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));

  const auto backend = waitForLatestStartedBackendState();
  assert(backend);
  assertLatestPlaybackContains(engine, "\"crossfadeActive\":true");
  assert(waitUntil([&engine] { return jsonContains(engine.getPlaybackInfoJson(), "\"preloadReady\":true"); }));
  assertLatestPlaybackContains(engine, "\"outputPerfect\":false");
  assertLatestPlaybackContains(engine, "\"perfectReasonCode\":\"crossfade_active\"");

  bool sawOverlapMix = false;
  for (int i = 0; i < 24; ++i) {
    const auto rendered = renderBackendFrames(backend, 256);
    if (bufferHasSampleAbove(rendered, 0.30f)) {
      sawOverlapMix = true;
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
  assert(sawOverlapMix);

  const auto afterMixSnapshots = g_backendRegistry.snapshots();
  assert(afterMixSnapshots.size() == 1);
  assert(afterMixSnapshots.front().typedStarted);
  assert(afterMixSnapshots.front().typedRenderCalls == 0);
  assert(afterMixSnapshots.front().floatRenderCalls > 0);

  bool promoted = false;
  for (int i = 0; i < 80; ++i) {
    renderBackendFrames(backend, 256);
    if (jsonContains(engine.getPlaybackInfoJson(), "\"source\":\"crossfade-next.flac\",\"codec\"")) {
      promoted = true;
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  assert(promoted);
  assertLatestPlaybackContains(engine, "\"source\":\"crossfade-next.flac\",\"codec\"");
  assertLatestPlaybackContains(engine, "\"queueIndex\":1");
}

void testPreloadedPromotionKeepsRuntimeReplayGainSettings() {
  EngineHarness harness;
  auto& engine = harness.engine();

  assert(engine.setVolume(0.5) == TAE_RESULT_OK);
  assert(engine.setDspConfig("{\"enabled\":true,\"gapless\":true}") == TAE_RESULT_OK);
  const std::string queueJson =
      "[{\"id\":\"current\",\"source\":\"runtime-replaygain-current.flac\",\"duration\":30},"
      "{\"id\":\"next\",\"source\":\"runtime-replaygain-next.flac\",\"duration\":30}]";
  assert(engine.loadQueue(queueJson, 0) == TAE_RESULT_OK);
  assert(engine.play("runtime-replaygain-current.flac", 0.0) == TAE_RESULT_OK);
  assert(waitForStartedBackendCount(1));
  assert(waitUntil([&engine] { return jsonContains(engine.getPlaybackInfoJson(), "\"preloadReady\":true"); }));

  assert(engine.setReplayGainMode("track", 0.0, -6.0, true) == TAE_RESULT_OK);
  assertLatestPlaybackContains(engine, "\"replayGainActive\":true");

  assert(engine.next() == TAE_RESULT_OK);
  assertLatestPlaybackContains(engine, "\"source\":\"runtime-replaygain-next.flac\"");
  assertLatestPlaybackContains(engine, "\"replayGainActive\":true");
  assertLatestPlaybackContains(engine, "\"replayGainDb\":-6");
}

}  // namespace

namespace twilight::audio {

std::string defaultBackendId() {
  return "wasapi-exclusive";
}

std::unique_ptr<IOutputBackend> createOutputBackend(const std::string& backendId) {
  return std::make_unique<FakeOutputBackend>(backendId);
}

std::string enumeratePlatformDevicesJson() {
  return "[]";
}

std::string readMetadataJson(const std::string& source) {
  return "{\"source\":\"" + source + "\"}";
}

struct FFmpegDecoder::Impl {
  TrackProfile profile;
  AudioFormat outputFormat;
  size_t positionFrames = 0;
};

FFmpegDecoder::FFmpegDecoder()
    : impl_(std::make_unique<Impl>()) {}

FFmpegDecoder::~FFmpegDecoder() = default;

bool FFmpegDecoder::open(const std::string& source, std::string* error) {
  (void)error;
  impl_->profile = buildTrackProfile(source);
  impl_->outputFormat = impl_->profile.defaultOutput;
  impl_->positionFrames = 0;
  impl_->profile.stream.decodedFormat = impl_->outputFormat;
  return true;
}

void FFmpegDecoder::close() {
  impl_->positionFrames = impl_->profile.totalFrames;
}

bool FFmpegDecoder::setOutputFormat(const AudioFormat& format, std::string* error) {
  (void)error;
  impl_->outputFormat = format;
  impl_->profile.stream.decodedFormat = format;
  return true;
}

size_t FFmpegDecoder::readFrames(float* output, size_t frameCount, std::string* error) {
  (void)error;
  if (impl_->outputFormat.sampleFormat != AudioSampleFormat::Float32Interleaved) return 0;
  const int delayMs = g_decodeFirstReadDelayMs.exchange(0);
  if (delayMs > 0 && impl_->positionFrames == 0) {
    std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
  }
  const int everyReadDelayMs = g_decodeEveryReadDelayMs.load();
  if (everyReadDelayMs > 0) {
    std::this_thread::sleep_for(std::chrono::milliseconds(everyReadDelayMs));
  }
  const size_t channels = static_cast<size_t>(std::max(1, impl_->outputFormat.channelCount));
  const size_t remaining = impl_->profile.totalFrames > impl_->positionFrames
                               ? impl_->profile.totalFrames - impl_->positionFrames
                               : 0;
  const size_t read = std::min(frameCount, remaining);
  for (size_t frame = 0; frame < read; ++frame) {
    for (size_t channel = 0; channel < channels; ++channel) {
      output[frame * channels + channel] = impl_->profile.sampleValue;
    }
  }
  impl_->positionFrames += read;
  return read;
}

size_t FFmpegDecoder::readFrames(PcmBlock& output, std::string* error) {
  (void)error;
  if (!output.data || output.frames == 0) return 0;
  if (output.byteSize > 0) std::memset(output.data, 0, output.byteSize);
  if (!pcmFormatsExactMatch(output.format, impl_->outputFormat)) return 0;
  const int delayMs = g_decodeFirstReadDelayMs.exchange(0);
  if (delayMs > 0 && impl_->positionFrames == 0) {
    std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
  }
  const int everyReadDelayMs = g_decodeEveryReadDelayMs.load();
  if (everyReadDelayMs > 0) {
    std::this_thread::sleep_for(std::chrono::milliseconds(everyReadDelayMs));
  }

  const size_t channels = static_cast<size_t>(std::max(1, impl_->outputFormat.channelCount));
  const size_t bytesPerSample = audioSampleFormatBytes(impl_->outputFormat.sampleFormat);
  const size_t remaining = impl_->profile.totalFrames > impl_->positionFrames
                               ? impl_->profile.totalFrames - impl_->positionFrames
                               : 0;
  const size_t read = std::min(output.frames, remaining);
  for (size_t frame = 0; frame < read; ++frame) {
    for (size_t channel = 0; channel < channels; ++channel) {
      const size_t offset = (frame * channels + channel) * bytesPerSample;
      writeSample(impl_->profile.sampleValue, impl_->outputFormat.sampleFormat, output.data + offset);
    }
  }
  impl_->positionFrames += read;
  return read;
}

bool FFmpegDecoder::seek(double seconds, std::string* error) {
  (void)error;
  const double clamped = std::max(0.0, seconds);
  const double sampleRate = static_cast<double>(std::max(1, impl_->outputFormat.sampleRate));
  const size_t nextFrame = static_cast<size_t>(clamped * sampleRate);
  impl_->positionFrames = std::min(nextFrame, impl_->profile.totalFrames);
  return true;
}

bool FFmpegDecoder::eof() const {
  return impl_->positionFrames >= impl_->profile.totalFrames;
}

const AudioStreamInfo& FFmpegDecoder::streamInfo() const {
  return impl_->profile.stream;
}

const AudioFormat& FFmpegDecoder::outputFormat() const {
  return impl_->outputFormat;
}

}  // namespace twilight::audio

int main() {
  testFloatScratchResizeForOverwritePreservesSameSizedScratch();
  testVisualizationFftResolutionMatchesWebAudioReference();
  testRenderCallbacksDoNotResizePipelineScratchBuffers();
  testDecodeStreamReadFloatDoesNotResizeTypedScratch();
  testRenderCallbacksDoNotReconfigureDspChains();
  testRenderCallbackDoesNotCopyDspConfig();
  testRenderCallbacksDoNotBlockOnPipelineMutex();
  testRenderCallbacksDoNotWaitForDecoderBuffers();
  testNativeDsdRenderPositionAccountsForBitsPerByte();
  testChannelRouterStateIsSerializedWithoutBlockingRenderCallbacks();
  testRenderCallbacksUseNonBlockingSpectrumReset();
  testRenderCallbackDoesNotStopDecodeStreams();
  testSetDspConfigParsesJsonOutsidePipelineMutex();
  testSetVolumeAvoidsBlockingOnPipelineMutex();
  testDecodeStreamReaperRetiresOutsideAudioCallback();
  testCrossfadePromotionClearsStaleLocalPreloadState();
  testRenderSideDecodeStreamRetirementDoesNotGrowContainers();
  testSetOutputConfigReleasesEngineMutexBeforeRerouteRestart();
  testSetDspConfigPreparesActiveChainForPreRoutingDecodeFormat();
  testDsdProcessingPcmDecisionUsesSharedHelper();
  testTwilightAudioEngineReusesParsedDspConfigSnapshot();
  testDsd64StartsOnDop();
  testPcmTypedPassthroughKeepsTypedPathDuringTransientDecoderLag();
  testPcmTypedPassthroughIsOutputPerfect();
  testOutputStartWaitsForFirstDecodedFrames();
  testOutputStartDoesNotWaitForPrerollTimeoutAtEof();
  testBackendRenderErrorIsReportedThroughLastError();
  testStoppedSetOutputDeviceKeepsOutputInfoDeviceNamesConsistent();
  testRenderWaitsForTransientDecoderLag();
  testRoutedRenderHandlesCallbacksLargerThanPreparedScratch();
  testPcmVolumeFallsBackToFloatProcessing();
  testDsd128StartsOnDop();
  testAsioAutoPrefersNativeDsd();
  testAlsaNativeDsdAcceptsTransportFrameRate();
  testAsioDopModeDoesNotTryNativeDsd();
  testAsioPcmModeDoesNotTryNativeDsd();
  testAsioNativeDsdMismatchFallsBackToDop();
  testAsioNativeDsdAndDopFailureFallsBackToPcm();
  testDsd256StartsOnWasapiExclusiveDop();
  testDsd256StartsOnAsioNativeDsd();
  testNativeDsdPositionUsesBitSampleFrames();
  testDsd512StartsOnAsioNativeDsd();
  testSacdIsoTrackUsesAsioNativeDsd();
  testSacdIsoTrackFallsBackToPcmWhenProcessingActive();
  testDopMismatchFallsBackWithStableCode();
  testDopUnprovenFallsBackWithStableCode();
  testInitialNonUnityVolumeUsesPcmFallback();
  testEqEnableRequestsPcmReroute();
  testVolumeChangeRequestsPcmReroute();
  testDsdOutputModePcmRequestsPcmReroute();
  testDsdOutputModeDopReentersDopPath();
  testSeekReevaluatesDsdPath();
  testPausedSettingsFallbackBeforeResume();
  testManualNextDoesNotInheritDsdPath();
  testAutoNextDoesNotInheritDsdPath();
  testNativeCrossfadeOverlapMixesPreloadAndPromotes();
  testPreloadedPromotionKeepsRuntimeReplayGainSettings();
  return 0;
}
