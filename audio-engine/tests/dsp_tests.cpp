#include "../dsp/DspChain.h"

#include <cassert>
#include <cmath>
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

  return 0;
}
