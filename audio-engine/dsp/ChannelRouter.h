#pragma once

#include "../core/AudioTypes.h"
#include <cstddef>
#include <deque>
#include <vector>

namespace twilight::audio {

/// 上混参数配置（5.1 / 7.1 声道扩展）
struct UpmixConfig {
  /// 中置增益（线性，1.0 = 原始电平）。默认 -3dB
  float centerGain = 0.7071f;
  /// LFE 增益。默认 -6dB
  float lfeGain = 0.5f;
  /// LFE 低通截止频率 (Hz)
  float lfeLowpassHz = 120.0f;
  /// 后环绕增益。默认 -6dB
  float surroundGain = 0.5f;
  /// 侧环绕增益（仅 7.1）。默认 -10dB
  float sideGain = 0.3f;
  /// 环绕延迟（毫秒），0 = 无延迟
  float surroundDelayMs = 0.0f;
};

/// 有状态的声道路由/上混处理器
///
/// 替代原来的无状态自由函数 routeChannels()。
/// 支持 LFE 低通滤波和环绕延迟线，实现真正的 5.1/7.1 上混。
class ChannelRouter {
 public:
  /// 配置上混参数（可在播放中实时调整）
  void setUpmixConfig(const UpmixConfig& config);
  UpmixConfig upmixConfig() const { return config_; }

  /// 采样率变更时通知（重算滤波器系数和延迟线大小）
  void setSampleRate(int sampleRate);

  /// 重置所有状态（切歌/切设备时调用）
  void reset();

  /// 路由/上混
  void route(const float* source, float* destination,
             size_t frameCount,
             int sourceChannels, int destinationChannels,
             ChannelRoutingMode mode);

 private:
  UpmixConfig config_;
  int sampleRate_ = 48000;

  // LFE 一阶低通滤波器状态
  float lfePrev_ = 0.0f;
  float lfeAlpha_ = 0.0f;

  // 环绕延迟线
  std::deque<float> surroundLeftDelay_;
  std::deque<float> surroundRightDelay_;
  size_t surroundDelaySamples_ = 0;

  void recomputeCoefficients();
  void processUpmix51(const float* src, float* dst, size_t frames);
  void processUpmix71(const float* src, float* dst, size_t frames);
  void processPassthrough(const float* src, float* dst, size_t frames,
                          int srcCh, int dstCh, ChannelRoutingMode mode);
};

}  // namespace twilight::audio
