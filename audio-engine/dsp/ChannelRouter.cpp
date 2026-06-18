#include "ChannelRouter.h"

#include <algorithm>
#include <cstring>
#include <cmath>

namespace twilight::audio {

void ChannelRouter::setUpmixConfig(const UpmixConfig& config) {
  config_ = config;
  recomputeCoefficients();
}

void ChannelRouter::setSampleRate(int sampleRate) {
  if (sampleRate_ == sampleRate || sampleRate <= 0) return;
  sampleRate_ = sampleRate;
  recomputeCoefficients();
}

void ChannelRouter::reset() {
  lfePrev_ = 0.0f;
  surroundLeftDelay_.clear();
  surroundRightDelay_.clear();
}

void ChannelRouter::recomputeCoefficients() {
  // 一阶低通：alpha = dt / (RC + dt), RC = 1 / (2π × fc)
  const float dt = 1.0f / static_cast<float>(sampleRate_);
  const float fc = std::max(1.0f, config_.lfeLowpassHz);
  const float rc = 1.0f / (2.0f * 3.14159265f * fc);
  lfeAlpha_ = dt / (rc + dt);

  // 环绕延迟线大小
  const size_t newDelay = static_cast<size_t>(
      std::max(0.0f, config_.surroundDelayMs) * 0.001f * static_cast<float>(sampleRate_));
  if (surroundDelaySamples_ != newDelay) {
    surroundDelaySamples_ = newDelay;
    surroundLeftDelay_.assign(surroundDelaySamples_, 0.0f);
    surroundRightDelay_.assign(surroundDelaySamples_, 0.0f);
  }
}

void ChannelRouter::route(const float* source, float* destination,
                          size_t frameCount,
                          int sourceChannels, int destinationChannels,
                          ChannelRoutingMode mode) {
  if (frameCount == 0 || sourceChannels <= 0 || destinationChannels <= 0) return;

  // 无需上混的路径：直接拷贝
  if (sourceChannels == destinationChannels && mode == ChannelRoutingMode::Auto) {
    if (source != destination) {
      std::memcpy(destination, source,
                  frameCount * static_cast<size_t>(sourceChannels) * sizeof(float));
    }
    return;
  }

  switch (mode) {
    case ChannelRoutingMode::StereoTo51:
      if (sourceChannels >= 2 && destinationChannels >= 6) {
        processUpmix51(source, destination, frameCount);
      } else {
        processPassthrough(source, destination, frameCount,
                           sourceChannels, destinationChannels, mode);
      }
      break;
    case ChannelRoutingMode::StereoTo71:
      if (sourceChannels >= 2 && destinationChannels >= 8) {
        processUpmix71(source, destination, frameCount);
      } else {
        processPassthrough(source, destination, frameCount,
                           sourceChannels, destinationChannels, mode);
      }
      break;
    default:
      processPassthrough(source, destination, frameCount,
                         sourceChannels, destinationChannels, mode);
      break;
  }
}

// ─── 5.1 上混 ───
// ITU-R BS.775 布局: [L, R, C, LFE, RL, RR]
void ChannelRouter::processUpmix51(const float* src, float* dst, size_t frames) {
  const float cg = config_.centerGain;
  const float lg = config_.lfeGain;
  const float sg = config_.surroundGain;

  for (size_t i = 0; i < frames; ++i) {
    const float l = src[i * 2 + 0];
    const float r = src[i * 2 + 1];
    float* out = dst + i * 6;

    out[0] = l;                          // L 直通
    out[1] = r;                          // R 直通
    out[2] = (l + r) * cg;               // Center = (L+R) × centerGain

    // LFE = (L+R) × lfeGain，经一阶低通
    const float lfeInput = (l + r) * lg;
    lfePrev_ = lfePrev_ + lfeAlpha_ * (lfeInput - lfePrev_);
    out[3] = lfePrev_;

    // 环绕（可选延迟）
    const float rl = l * sg;
    const float rr = r * sg;
    if (surroundDelaySamples_ > 0) {
      surroundLeftDelay_.push_back(rl);
      surroundRightDelay_.push_back(rr);
      out[4] = surroundLeftDelay_.front();
      out[5] = surroundRightDelay_.front();
      surroundLeftDelay_.pop_front();
      surroundRightDelay_.pop_front();
    } else {
      out[4] = rl;                       // RL = L × surroundGain
      out[5] = rr;                       // RR = R × surroundGain
    }
  }
}

// ─── 7.1 上混 ───
// 布局: [L, R, C, LFE, RL, RR, SL, SR]
void ChannelRouter::processUpmix71(const float* src, float* dst, size_t frames) {
  const float cg = config_.centerGain;
  const float lg = config_.lfeGain;
  const float sg = config_.surroundGain;
  const float sideG = config_.sideGain;

  for (size_t i = 0; i < frames; ++i) {
    const float l = src[i * 2 + 0];
    const float r = src[i * 2 + 1];
    float* out = dst + i * 8;

    out[0] = l;                          // L 直通
    out[1] = r;                          // R 直通
    out[2] = (l + r) * cg;               // Center

    // LFE 低通
    const float lfeInput = (l + r) * lg;
    lfePrev_ = lfePrev_ + lfeAlpha_ * (lfeInput - lfePrev_);
    out[3] = lfePrev_;

    // 后环绕
    out[4] = l * sg;                     // RL
    out[5] = r * sg;                     // RR
    // 侧环绕（更低增益，营造空间感）
    out[6] = l * sideG;                  // SL
    out[7] = r * sideG;                  // SR
  }
}

// ─── 退化路径：原有无状态逻辑（Mono/Stereo/Auto 等）───
void ChannelRouter::processPassthrough(const float* src, float* dst,
                                       size_t frames, int srcCh, int dstCh,
                                       ChannelRoutingMode mode) {
  for (size_t frame = 0; frame < frames; ++frame) {
    const float* srcFrame = src + frame * static_cast<size_t>(srcCh);
    float* dstFrame = dst + frame * static_cast<size_t>(dstCh);
    for (int dst = 0; dst < dstCh; ++dst) {
      float sample = 0.0f;
      switch (mode) {
        case ChannelRoutingMode::MonoToStereo:
        case ChannelRoutingMode::MonoToMultichannel:
          if (dst < 2 || mode == ChannelRoutingMode::MonoToMultichannel)
            sample = srcFrame[0];
          break;
        case ChannelRoutingMode::Stereo:
          if (dst < 2 && dst < srcCh) sample = srcFrame[dst];
          break;
        default:
          if (dst < srcCh) sample = srcFrame[dst];
          break;
      }
      dstFrame[dst] = sample;
    }
  }
}

}  // namespace twilight::audio
