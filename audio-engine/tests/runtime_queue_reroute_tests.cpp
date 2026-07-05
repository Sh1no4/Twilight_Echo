#include "../core/TwilightAudioEngine.h"
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
    info.supportsOutputPerfect = state_->backendId == "wasapi-exclusive" || state_->backendId == "asio";
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
    info.driverNativeDsdCapable = state_->backendId == "asio";
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
    facts.explicitlyCapable = state_->backendId == "asio";
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
  if (source.find("crossfade-current") != std::string::npos) {
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
  assert(formatLooksDopCarrier(snapshots[1].requestedFormat));
  assertFormatLooksDsdPcmFallbackRequest(snapshots[2].requestedFormat);
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
  assertFormatLooksDsdPcmFallbackRequest(snapshots.back().requestedFormat);
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
  assertFormatLooksDsdPcmFallbackRequest(snapshots.back().requestedFormat);
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
  testDsd64StartsOnDop();
  testPcmTypedPassthroughIsOutputPerfect();
  testOutputStartWaitsForFirstDecodedFrames();
  testRenderWaitsForTransientDecoderLag();
  testPcmVolumeFallsBackToFloatProcessing();
  testDsd128StartsOnDop();
  testAsioAutoPrefersNativeDsd();
  testAsioDopModeDoesNotTryNativeDsd();
  testAsioPcmModeDoesNotTryNativeDsd();
  testAsioNativeDsdMismatchFallsBackToDop();
  testAsioNativeDsdAndDopFailureFallsBackToPcm();
  testDsd256StartsOnWasapiExclusiveDop();
  testDsd256StartsOnAsioNativeDsd();
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
  return 0;
}
