#include "../core/AudioTypes.h"
#include "../output/alsa/AlsaBackend.h"
#include "../output/coreaudio/CoreAudioBackend.h"

#include <cassert>
#include <chrono>
#include <cstdlib>
#include <string>
#include <thread>

using namespace twilight::audio;

namespace {

AudioFormat pcm() {
  AudioFormat format;
  format.sampleRate = 48000;
  format.channelCount = 2;
  format.bitDepth = 32;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;
  return format;
}

bool runRealBackendTests() {
  const char* value = std::getenv("TAE_RUN_REAL_AUDIO_BACKEND_TESTS");
  return value && std::string(value) == "1";
}

}  // namespace

int main() {
#if defined(__APPLE__)
  {
    CoreAudioBackend backend;
    assert(std::string(backend.id()) == "coreaudio");
    if (runRealBackendTests()) {
      std::string error;
      assert(backend.open("auto", pcm(), &error));
      const OutputInfo info = backend.outputInfo();
      assert(info.actualBackend == "coreaudio");
      assert(!info.actualDeviceName.empty());
      assert(info.actualSampleRate > 0);
      assert(info.actualBitDepth == 32);
      assert(info.actualChannels > 0);
      assert(info.bufferSizeFrames > 0);
      assert(!info.supportsBitPerfect);
      assert(!info.resampleReason.empty());
      assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
      std::this_thread::sleep_for(std::chrono::milliseconds(30));
      backend.stop();
      backend.close();
    }
  }
#endif

#if defined(__linux__)
  {
    AlsaBackend backend;
    assert(std::string(backend.id()) == "alsa");
    std::string error;
    if (backend.open("null", pcm(), &error)) {
      const OutputInfo info = backend.outputInfo();
      assert(info.actualBackend == "alsa");
      assert(!info.actualDeviceName.empty());
      assert(info.actualSampleRate > 0);
      assert(info.actualBitDepth > 0);
      assert(info.actualChannels > 0);
      assert(info.bufferSizeFrames > 0);
      assert(!info.supportsBitPerfect);
      assert(!info.resampleReason.empty());
      assert(backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
      std::this_thread::sleep_for(std::chrono::milliseconds(30));
      backend.stop();
      backend.close();
    }
  }
#endif

  return 0;
}
