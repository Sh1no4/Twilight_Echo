#include "../dsp/DspChain.h"
#include "../dsp/FftSpectrumAnalyzer.h"

#include <cassert>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <vector>

using namespace twilight::audio;

namespace {

bool closeTo(double actual, double expected, double tolerance = 0.02) {
  return std::abs(actual - expected) <= tolerance;
}

AudioFormat testFormat() {
  AudioFormat format;
  format.sampleRate = 48000;
  format.channelCount = 2;
  format.bitDepth = 32;
  format.sampleFormat = AudioSampleFormat::Float32Interleaved;
  return format;
}

void writeImpulseWav(const std::filesystem::path& path, int sampleRate, int channels) {
  const int bitsPerSample = 16;
  const int frames = 8;
  const int blockAlign = channels * bitsPerSample / 8;
  const int byteRate = sampleRate * blockAlign;
  const int dataSize = frames * blockAlign;
  std::ofstream out(path, std::ios::binary);
  out.write("RIFF", 4);
  const uint32_t riffSize = static_cast<uint32_t>(36 + dataSize);
  out.write(reinterpret_cast<const char*>(&riffSize), 4);
  out.write("WAVE", 4);
  out.write("fmt ", 4);
  const uint32_t fmtSize = 16;
  const uint16_t audioFormat = 1;
  const uint16_t channelCount = static_cast<uint16_t>(channels);
  const uint32_t rate = static_cast<uint32_t>(sampleRate);
  const uint32_t bytesPerSecond = static_cast<uint32_t>(byteRate);
  const uint16_t align = static_cast<uint16_t>(blockAlign);
  const uint16_t bits = static_cast<uint16_t>(bitsPerSample);
  out.write(reinterpret_cast<const char*>(&fmtSize), 4);
  out.write(reinterpret_cast<const char*>(&audioFormat), 2);
  out.write(reinterpret_cast<const char*>(&channelCount), 2);
  out.write(reinterpret_cast<const char*>(&rate), 4);
  out.write(reinterpret_cast<const char*>(&bytesPerSecond), 4);
  out.write(reinterpret_cast<const char*>(&align), 2);
  out.write(reinterpret_cast<const char*>(&bits), 2);
  out.write("data", 4);
  const uint32_t dataBytes = static_cast<uint32_t>(dataSize);
  out.write(reinterpret_cast<const char*>(&dataBytes), 4);
  for (int frame = 0; frame < frames; ++frame) {
    for (int channel = 0; channel < channels; ++channel) {
      const int16_t sample = frame == 0 ? 32767 : 0;
      out.write(reinterpret_cast<const char*>(&sample), 2);
    }
  }
}

}  // namespace

int main() {
  {
    DspChain chain;
    DspConfig config;
    config.replayGainMode = ReplayGainMode::Track;
    config.replayGainClip = true;
    chain.configure(config);
    chain.prepare(testFormat());

    DspTrackContext context;
    context.stream.replayGain.trackGainDb = -6.0;
    chain.setTrackContext(context);

    std::vector<float> samples = {1.0f, -1.0f, 0.5f, -0.5f};
    chain.process(samples.data(), 2);

    const DspStatus status = chain.status();
    assert(status.dspActive);
    assert(status.replayGainActive);
    assert(closeTo(samples[0], 0.501));
    assert(closeTo(samples[2], 0.251));
  }

  {
    DspChain chain;
    DspConfig config;
    config.replayGainMode = ReplayGainMode::Album;
    config.replayGainFallbackDb = -3.0;
    config.replayGainPreampDb = 1.0;
    chain.configure(config);
    chain.prepare(testFormat());
    chain.setTrackContext({});

    std::vector<float> samples = {1.0f, 1.0f};
    chain.process(samples.data(), 1);

    assert(chain.status().replayGainActive);
    assert(closeTo(samples[0], std::pow(10.0, -2.0 / 20.0)));
  }

  {
    DspChain chain;
    DspConfig config;
    config.eqEnabled = true;
    config.eqMode = EqMode::Graphic;
    config.eqBands.push_back({1000.0, 3.0, 1.0, DspFilterType::AllPass});
    chain.configure(config);
    chain.prepare(testFormat());
    chain.setTrackContext({});

    std::vector<float> samples(256, 0.1f);
    chain.process(samples.data(), 128);

    assert(chain.status().eqActive);
    for (float sample : samples) {
      assert(std::isfinite(sample));
    }
  }

  {
    DspChain chain;
    DspConfig config;
    config.eqEnabled = true;
    config.eqMode = EqMode::Parametric;
    config.eqBands.push_back({1000.0, 3.0, 1.0, DspFilterType::BandPass});
    config.eqBands.push_back({2000.0, 3.0, 1.0, DspFilterType::AllPass});
    chain.configure(config);
    chain.prepare(testFormat());
    chain.setTrackContext({});

    assert(!chain.status().eqActive);
  }

  {
    DspChain chain;
    DspConfig config;
    config.enabled = true;
    chain.configure(config);
    chain.prepare(testFormat());

    const auto wavPath = std::filesystem::temp_directory_path() / "twilight-ir-48000.wav";
    writeImpulseWav(wavPath, 48000, 1);
    std::string error;
    assert(chain.loadImpulseResponse(wavPath.string(), &error));
    const DspStatus status = chain.status();
    assert(status.convolverActive);
    assert(status.partitionSize == 1024);
    assert(status.channelMappingMode == "mono-to-all");
    std::filesystem::remove(wavPath);
  }

  {
    DspChain chain;
    DspConfig config;
    chain.configure(config);
    chain.prepare(testFormat());
    chain.setCrossfeedStrength(0.75);
    assert(chain.status().crossfeedActive);
    std::vector<float> samples(512, 0.0f);
    samples[0] = 1.0f;
    chain.process(samples.data(), 256);
    for (float sample : samples) assert(std::isfinite(sample));
  }

  {
    FftSpectrumAnalyzer analyzer;
    analyzer.prepare(testFormat(), 256);
    std::vector<float> samples(512, 0.0f);
    for (size_t i = 0; i < 256; ++i) {
      samples[i * 2] = static_cast<float>(std::sin(2.0 * 3.141592653589793 * i / 32.0));
      samples[i * 2 + 1] = samples[i * 2];
    }
    analyzer.capture(samples.data(), 256, 2);
    std::vector<float> spectrum(64, 0.0f);
    assert(analyzer.read(spectrum.data(), spectrum.size()) == spectrum.size());
    assert(analyzer.isActive());
    for (float value : spectrum) assert(std::isfinite(value));
  }

  return 0;
}
