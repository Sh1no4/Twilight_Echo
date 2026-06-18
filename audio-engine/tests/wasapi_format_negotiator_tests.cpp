#include "../core/AudioTypes.h"
#include "../output/wasapi/WasapiCommon.h"
#include "../output/wasapi/WasapiFormatNegotiator.h"

#include <cassert>
#include <string>
#include <utility>
#include <vector>

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <audioclient.h>
#include <ksmedia.h>
#include <mmreg.h>
#endif

using namespace twilight::audio;

namespace {

AudioFormat dsdSource(int sampleRate) {
  AudioFormat format;
  format.sampleRate = sampleRate;
  format.channelCount = 2;
  format.bitDepth = 1;
  format.sampleFormat = AudioSampleFormat::Int16Interleaved;
  return format;
}

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)

struct SupportedFormat {
  int sampleRate = 0;
  int validBits = 0;
  int containerBits = 0;
};

struct ProbedFormat {
  int sampleRate = 0;
  int validBits = 0;
  int containerBits = 0;
};

class FakeAudioClient final : public IAudioClient {
 public:
  explicit FakeAudioClient(std::vector<SupportedFormat> supported) : supported_(std::move(supported)) {}

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, void**) override {
    return E_NOINTERFACE;
  }

  ULONG STDMETHODCALLTYPE AddRef() override {
    return 1;
  }

  ULONG STDMETHODCALLTYPE Release() override {
    return 1;
  }

  HRESULT STDMETHODCALLTYPE Initialize(
      AUDCLNT_SHAREMODE,
      DWORD,
      REFERENCE_TIME,
      REFERENCE_TIME,
      const WAVEFORMATEX*,
      LPCGUID) override {
    return E_NOTIMPL;
  }

  HRESULT STDMETHODCALLTYPE GetBufferSize(UINT32*) override {
    return E_NOTIMPL;
  }

  HRESULT STDMETHODCALLTYPE GetStreamLatency(REFERENCE_TIME*) override {
    return E_NOTIMPL;
  }

  HRESULT STDMETHODCALLTYPE GetCurrentPadding(UINT32*) override {
    return E_NOTIMPL;
  }

  HRESULT STDMETHODCALLTYPE IsFormatSupported(
      AUDCLNT_SHAREMODE shareMode,
      const WAVEFORMATEX* format,
      WAVEFORMATEX**) override {
    assert(shareMode == AUDCLNT_SHAREMODE_EXCLUSIVE);
    assert(format != nullptr);
    assert(format->wFormatTag == WAVE_FORMAT_EXTENSIBLE);

    const auto* extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
    probes.push_back({
        static_cast<int>(format->nSamplesPerSec),
        static_cast<int>(extensible->Samples.wValidBitsPerSample),
        static_cast<int>(format->wBitsPerSample),
    });

    for (const SupportedFormat& supported : supported_) {
      if (supported.sampleRate == static_cast<int>(format->nSamplesPerSec) &&
          supported.validBits == static_cast<int>(extensible->Samples.wValidBitsPerSample) &&
          supported.containerBits == static_cast<int>(format->wBitsPerSample)) {
        return S_OK;
      }
    }
    return AUDCLNT_E_UNSUPPORTED_FORMAT;
  }

  HRESULT STDMETHODCALLTYPE GetMixFormat(WAVEFORMATEX**) override {
    return E_NOTIMPL;
  }

  HRESULT STDMETHODCALLTYPE GetDevicePeriod(REFERENCE_TIME*, REFERENCE_TIME*) override {
    return E_NOTIMPL;
  }

  HRESULT STDMETHODCALLTYPE Start() override {
    return E_NOTIMPL;
  }

  HRESULT STDMETHODCALLTYPE Stop() override {
    return E_NOTIMPL;
  }

  HRESULT STDMETHODCALLTYPE Reset() override {
    return E_NOTIMPL;
  }

  HRESULT STDMETHODCALLTYPE SetEventHandle(HANDLE) override {
    return E_NOTIMPL;
  }

  HRESULT STDMETHODCALLTYPE GetService(REFIID, void**) override {
    return E_NOTIMPL;
  }

  std::vector<ProbedFormat> probes;

 private:
  std::vector<SupportedFormat> supported_;
};

void testDsd64NegotiatesDopCarrier() {
  FakeAudioClient client({{176400, 24, 32}});
  WasapiFormatNegotiator negotiator(&client);
  std::string error;

  assert(negotiator.negotiate(dsdSource(2822400), &error));
  assert(error.empty());
  assert(client.probes.size() == 2);
  assert(client.probes[0].sampleRate == 176400);
  assert(client.probes[0].validBits == 24);
  assert(client.probes[0].containerBits == 24);
  assert(client.probes[1].sampleRate == 176400);
  assert(client.probes[1].validBits == 24);
  assert(client.probes[1].containerBits == 32);

  const AudioFormat output = negotiator.outputFormat();
  assert(output.sampleRate == 176400);
  assert(output.bitDepth == 24);
  assert(output.sampleFormat == AudioSampleFormat::Int24In32Interleaved);

  const OutputInfo info = negotiator.outputInfo();
  assert(info.exclusive);
  assert(info.supportsOutputPerfect);
  assert(!info.outputPerfect);
  assert(!info.pcmPassthrough);
  assert(info.actualOutputFormat == "int24-in32");
  assert(info.perfectReason.find("DoP carrier") != std::string::npos);

  const DopRuntimeFacts facts = negotiator.dopRuntimeFacts();
  assert(facts.state == DopRuntimeFactState::Proven);
  assert(facts.explicitlyCapable);
  assert(facts.candidateFormat.sampleRate == 176400);
  assert(facts.candidateFormat.sampleFormat == AudioSampleFormat::Int24In32Interleaved);
  assert(pcmFormatsExactMatch(facts.candidateFormat, facts.actualFormat));
}

void testDsd128FailureReasonNamesDopCarrierFacts() {
  FakeAudioClient client({});
  WasapiFormatNegotiator negotiator(&client);
  std::string error;

  assert(!negotiator.negotiate(dsdSource(5644800), &error));
  assert(error.find("DoP carrier sample rate 352800Hz") != std::string::npos);
  assert(error.find("DoP carrier bit depth 24bit") != std::string::npos);
  assert(error.find("DoP carrier sample format int24/int24-in32") != std::string::npos);
  assert(error.find("未尝试 Native DSD") != std::string::npos);

  const OutputInfo info = negotiator.outputInfo();
  assert(info.exclusive);
  assert(!info.supportsOutputPerfect);
  assert(!info.outputPerfect);
  assert(info.perfectReason == error);

  const DopRuntimeFacts facts = negotiator.dopRuntimeFacts();
  assert(facts.state == DopRuntimeFactState::Unproven);
  assert(!facts.explicitlyCapable);
  assert(facts.candidateFormat.sampleRate == 352800);
  assert(facts.reason == error);
}

void testDsd256FailureReasonNamesDopCarrierFacts() {
  FakeAudioClient client({});
  WasapiFormatNegotiator negotiator(&client);
  std::string error;

  assert(!negotiator.negotiate(dsdSource(11289600), &error));
  assert(!client.probes.empty());
  assert(error.find("DoP carrier sample rate 705600Hz") != std::string::npos);
  assert(error.find("未启用 Native DSD") != std::string::npos);

  const DopRuntimeFacts facts = negotiator.dopRuntimeFacts();
  assert(facts.state == DopRuntimeFactState::Unproven);
  assert(!facts.explicitlyCapable);
  assert(facts.candidateFormat.sampleRate == 705600);
}

void testExclusiveBufferPolicyAvoidsMinimumPeriodForAuto() {
  const REFERENCE_TIME minimumPeriod = wasapi::framesToReferenceTime(64, 48000);
  const REFERENCE_TIME defaultPeriod = wasapi::framesToReferenceTime(480, 48000);

  assert(wasapi::chooseExclusiveBufferDuration(0, 48000, defaultPeriod, minimumPeriod) == defaultPeriod);
  assert(wasapi::chooseExclusiveBufferDuration(128, 48000, defaultPeriod, minimumPeriod) ==
         wasapi::framesToReferenceTime(128, 48000));
  assert(wasapi::chooseExclusiveBufferDuration(0, 48000, 0, minimumPeriod) == minimumPeriod);
}

void testExclusiveInitialRenderLeavesWakeupHeadroom() {
  assert(wasapi::exclusiveInitialRenderFrames(0, true) == 0);
  assert(wasapi::exclusiveInitialRenderFrames(1, true) == 1);
  assert(wasapi::exclusiveInitialRenderFrames(64, true) == 32);
  assert(wasapi::exclusiveInitialRenderFrames(481, true) == 240);
  assert(wasapi::exclusiveInitialRenderFrames(64, false) == 64);
}

void testExclusiveRenderFramePolicySeparatesEventAndPushMode() {
  assert(wasapi::exclusiveRenderFrames(0, 0, false) == 0);
  assert(wasapi::exclusiveRenderFrames(512, 128, false) == 512);
  assert(wasapi::exclusiveRenderFrames(512, 128, true) == 384);
  assert(wasapi::exclusiveRenderFrames(512, 512, true) == 0);
}

void testExclusiveDeviceInUseIsRetryableStartupFailure() {
  assert(wasapi::isDeviceInUse(AUDCLNT_E_DEVICE_IN_USE));
  assert(!wasapi::isDeviceInUse(AUDCLNT_E_UNSUPPORTED_FORMAT));
}

#endif

}  // namespace

int main() {
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
  testDsd64NegotiatesDopCarrier();
  testDsd128FailureReasonNamesDopCarrierFacts();
  testDsd256FailureReasonNamesDopCarrierFacts();
  testExclusiveBufferPolicyAvoidsMinimumPeriodForAuto();
  testExclusiveInitialRenderLeavesWakeupHeadroom();
  testExclusiveRenderFramePolicySeparatesEventAndPushMode();
  testExclusiveDeviceInUseIsRetryableStartupFailure();
#endif
  return 0;
}
