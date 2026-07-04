#include "../dsp/DspChain.h"
#include "../dsp/FftSpectrumAnalyzer.h"

#include <cassert>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <set>
#include <sstream>
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

// Extracts a flat JSON numeric array field (e.g. "oscilloscope":[0.1,-0.2,...])
// into a vector<float>. Returns empty vector if the key is absent or the array
// cannot be parsed. Non-numeric tokens (e.g. null) are skipped.
std::vector<float> extractJsonArray(const std::string& json, const std::string& key) {
  std::vector<float> result;
  const std::string needle = "\"" + key + "\":[";
  const size_t start = json.find(needle);
  if (start == std::string::npos) return result;
  const size_t arrStart = start + needle.size();
  const size_t arrEnd = json.find(']', arrStart);
  if (arrEnd == std::string::npos) return result;
  std::stringstream ss(json.substr(arrStart, arrEnd - arrStart));
  std::string token;
  while (std::getline(ss, token, ',')) {
    try {
      result.push_back(std::stof(token));
    } catch (...) {
      // skip null / invalid tokens
    }
  }
  return result;
}

}  // namespace

int main() {
  {
    DspChain chain;
    DspConfig config;
    chain.configure(config);
    chain.prepare(testFormat());
    chain.setTrackContext({});

    std::vector<float> samples = {1.0f, -1.0f, 0.25f, -0.25f};
    const std::vector<float> original = samples;
    chain.process(samples.data(), 2);

    assert(!chain.status().dspActive);
    assert(samples == original);
  }

  {
    DspChain chain;
    const DspConfig config = DspChain::parseConfigJson("{\"dspEnabled\":false,\"crossfadeSeconds\":0.5}");
    assert(config.gapless);
    chain.configure(config);
    chain.prepare(testFormat());
    chain.setTrackContext({});

    const DspStatus status = chain.status();
    assert(status.crossfadeActive);
    assert(closeTo(status.crossfadeSeconds, 0.5));

    std::vector<float> samples = {1.0f, -1.0f, 0.25f, -0.25f};
    const std::vector<float> original = samples;
    chain.process(samples.data(), 2);
    assert(samples == original);
  }

  {
    const DspConfig config = DspChain::parseConfigJson("{\"gapless\":false,\"crossfadeSeconds\":0}");
    assert(!config.gapless);
    assert(config.crossfadeSeconds == 0.0);
  }

  {
    DspChain chain;
    DspConfig config;
    config.enabled = true;
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
    config.enabled = true;
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
    config.enabled = true;
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
    config.enabled = true;
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
    config.enabled = true;
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

    const std::string json = analyzer.readVisualizationJson(24, 32, 8);
    assert(json.find("\"active\":true") != std::string::npos);
    assert(json.find("\"spectrum\"") != std::string::npos);
    assert(json.find("\"waveform\"") != std::string::npos);
    assert(json.find("\"peakDb\"") != std::string::npos);
    assert(json.find("\"rmsDb\"") != std::string::npos);
    assert(json.find("\"lufsMomentary\"") != std::string::npos);
    assert(json.find("\"spectrogram\"") != std::string::npos);
    assert(json.find("\"sampleRate\":48000") != std::string::npos);
    assert(json.find("nan") == std::string::npos);
    assert(json.find("inf") == std::string::npos);
  }

  {
    FftSpectrumAnalyzer analyzer;
    analyzer.prepare(testFormat(), 8192);
    std::vector<float> samples(8192 * 2, 0.0f);
    for (size_t i = 0; i < 8192; ++i) {
      samples[i * 2] = static_cast<float>(std::sin(2.0 * 3.141592653589793 * i / 256.0));
      samples[i * 2 + 1] = samples[i * 2];
    }
    analyzer.capture(samples.data(), 8192, 2);
    const std::string json = analyzer.readVisualizationJson(4096, 32, 8);
    const std::vector<float> spectrum = extractJsonArray(json, "spectrum");
    assert(spectrum.size() == 4096);
    bool anyNonZero = false;
    for (float value : spectrum) {
      assert(std::isfinite(value));
      if (value > 0.0f) anyNonZero = true;
    }
    assert(anyNonZero);
  }

  {
    FftSpectrumAnalyzer analyzer;
    analyzer.prepare(testFormat(), 256);
    analyzer.setEnabled(false);
    const std::string json = analyzer.readVisualizationJson(24, 32, 8, 1024);
    assert(json.find("\"active\":false") != std::string::npos);
    assert(json.find("\"lufsMomentary\":null") != std::string::npos);
    assert(json.find("\"spectrogram\":[]") != std::string::npos);
    assert(json.find("\"sampleRate\":48000") != std::string::npos);
    // Oscilloscope key must be present even when inactive: a zero-filled
    // array of the requested point count (decoupled from fftResolution).
    assert(json.find("\"oscilloscope\"") != std::string::npos);
    const std::vector<float> inactiveOscilloscope = extractJsonArray(json, "oscilloscope");
    assert(inactiveOscilloscope.size() == 1024);
    for (float value : inactiveOscilloscope) {
      assert(value == 0.0f);
    }
  }

  {
    FftSpectrumAnalyzer analyzer;
    analyzer.prepare(testFormat(), 256);
    std::vector<float> silence(512, 0.0f);
    analyzer.capture(silence.data(), 256, 2);
    std::vector<float> spectrum(64, 1.0f);
    assert(analyzer.read(spectrum.data(), spectrum.size()) == spectrum.size());
    assert(analyzer.isActive());
    for (float value : spectrum) {
      assert(std::isfinite(value));
      assert(value == 0.0f);
    }
  }

  {
    // testOscilloscopeBufferDecoupled: the oscilloscope tap must provide a
    // high-resolution time-domain ring buffer INDEPENDENT of fftResolution.
    // With fftResolution=64 the legacy waveform tap can never yield more than
    // 64 distinct samples, but the decoupled oscilloscope buffer (1024) must.
    FftSpectrumAnalyzer analyzer;
    analyzer.prepare(testFormat(), 64);          // small FFT resolution
    analyzer.prepareOscilloscope(1024);          // decoupled, larger tap
    // Feed 2048 frames of a sine (period 2048). The last 1024 frames (second
    // half-cycle) populate the oscilloscope buffer; they are nearly all
    // distinct. The legacy timeDomain_ only retains the last 64 frames.
    const size_t frames = 2048;
    std::vector<float> samples(frames * 2, 0.0f);
    for (size_t i = 0; i < frames; ++i) {
      const float v = static_cast<float>(std::sin(2.0 * 3.141592653589793 * static_cast<double>(i) / 2048.0));
      samples[i * 2] = v;
      samples[i * 2 + 1] = v;
    }
    analyzer.capture(samples.data(), frames, 2);
    const std::string json = analyzer.readVisualizationJson(24, 32, 8, 1024);
    assert(json.find("\"active\":true") != std::string::npos);
    assert(json.find("\"oscilloscope\"") != std::string::npos);

    const std::vector<float> oscilloscope = extractJsonArray(json, "oscilloscope");
    assert(oscilloscope.size() == 1024);  // decoupled from fftResolution=64

    // Non-zero signal captured.
    bool anyNonZero = false;
    for (float v : oscilloscope) {
      assert(v >= -1.0f && v <= 1.0f);  // signed mono PCM range
      if (v != 0.0f) anyNonZero = true;
    }
    assert(anyNonZero);

    // The oscilloscope must expose strictly more distinct values than the
    // 64-sample timeDomain_ could ever provide (proves decoupling).
    const std::set<float> distinct(oscilloscope.begin(), oscilloscope.end());
    assert(distinct.size() > 64);

    // Legacy waveform stays coupled to fftResolution: only 32 points requested,
    // sourced from a 64-sample timeDomain_.
    const std::vector<float> waveform = extractJsonArray(json, "waveform");
    assert(waveform.size() == 32);
  }

  return 0;
}
