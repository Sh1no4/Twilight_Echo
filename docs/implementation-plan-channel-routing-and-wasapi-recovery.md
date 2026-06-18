# Twilight Echo 功能补全实现方案

针对代码审计发现的两个主要差距，给出可直接落地的实现方案。

---

## 方案一：Channel Routing 真实上混矩阵

### 1.1 问题现状

`audio-engine/dsp/ChannelRouter.cpp` 的 `StereoTo51` / `StereoTo71` 分支只做 L/R 直通，中置/环绕/LFE 全静音：

```cpp
// 当前实现（第 40-44 行）——只有 L/R 被写入，其余通道 = 0
case ChannelRoutingMode::StereoTo51:
case ChannelRoutingMode::StereoTo71:
  if (dst < 2 && sourceChannels > dst) {
    sample = srcFrame[dst];  // 只有 dst=0(L) 和 dst=1(R) 有值
  }
  break;
```

### 1.2 设计目标

- **5.1 布局**（ITU-R BS.775）：`[L, R, C, LFE, RL, RR]`
- **7.1 布局**：`[L, R, C, LFE, RL, RR, SL, SR]`
- 中置提取：`C = (L+R) × centerGain`
- LFE 通道：`(L+R) × lfeGain`，经一阶低通滤波（截止 ~120Hz）
- 环绕：`RL = L × surroundGain`，`RR = R × surroundGain`（可选延迟）
- BitPerfect 影响：上混本身就会破坏 BitPerfect（`routingPreservesSemantics` 已返回 `false`），所以加入 DSP 处理不会引入新的 BitPerfect 退化

### 1.3 架构改造：无状态函数 → 有状态类

当前 `routeChannels` 是无状态自由函数。要支持 LFE 低通和环绕延迟，需要持久状态（滤波器状态、延迟线）。方案是引入 `ChannelRouter` 类：

#### 新文件：`audio-engine/dsp/ChannelRouter.h`

```cpp
#pragma once

#include "../core/AudioTypes.h"
#include <cstddef>
#include <vector>
#include <deque>

namespace twilight::audio {

// 上混参数配置
struct UpmixConfig {
  // 5.1 / 7.1 增益系数（线性，1.0 = 原始电平）
  float centerGain = 0.7071f;     // -3dB，标准中置提取增益
  float lfeGain = 0.5f;           // -6dB
  float lfeLowpassHz = 120.0f;    // LFE 低通截止频率
  float surroundGain = 0.5f;      // -6dB，后环绕
  float sideGain = 0.3f;          // -10dB，侧环绕（仅 7.1）
  // 环绕延迟（毫秒），0 = 无延迟，典型值 15~20ms
  float surroundDelayMs = 0.0f;
};

class ChannelRouter {
 public:
  /// 配置上混参数（线程安全，可在播放中实时调整）
  void setUpmixConfig(const UpmixConfig& config);
  UpmixConfig upmixConfig() const;

  /// 路由/上混（替代原来的自由函数 routeChannels）
  void route(const float* source, float* destination,
             size_t frameCount,
             int sourceChannels, int destinationChannels,
             ChannelRoutingMode mode);

  /// 采样率变更时通知（重算滤波器系数和延迟线大小）
  void setSampleRate(int sampleRate);

  /// 重置所有状态（切歌/切设备时调用）
  void reset();

 private:
  UpmixConfig config_;
  int sampleRate_ = 48000;

  // LFE 一阶低通滤波器状态
  float lfePrev_ = 0.0f;
  float lfeAlpha_ = 0.0f;  // 低通系数，由 sampleRate 和 cutoff 计算

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
```

#### 新文件：`audio-engine/dsp/ChannelRouter.cpp`（核心实现）

```cpp
#include "ChannelRouter.h"
#include <algorithm>
#include <cstring>
#include <cmath>

namespace twilight::audio {

void ChannelRouter::setUpmixConfig(const UpmixConfig& config) {
  config_ = config;
  recomputeCoefficients();
}

UpmixConfig ChannelRouter::upmixConfig() const {
  return config_;
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
  const float rc = 1.0f / (2.0f * 3.14159265f * config_.lfeLowpassHz);
  lfeAlpha_ = dt / (rc + dt);

  // 环绕延迟线大小
  surroundDelaySamples_ = static_cast<size_t>(
      config_.surroundDelayMs * 0.001f * static_cast<float>(sampleRate_));
  if (surroundLeftDelay_.size() != surroundDelaySamples_) {
    surroundLeftDelay_.resize(surroundDelaySamples_, 0.0f);
    surroundRightDelay_.resize(surroundDelaySamples_, 0.0f);
  }
}

void ChannelRouter::route(const float* source, float* destination,
                          size_t frameCount,
                          int sourceChannels, int destinationChannels,
                          ChannelRoutingMode mode) {
  if (frameCount == 0 || sourceChannels <= 0 || destinationChannels <= 0) return;

  // 无需上混的路径：直接走原逻辑
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
// ITU 布局: [L, R, C, LFE, RL, RR]
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
    // LFE 低通（复用同一个滤波器状态）
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

// ─── 退化路径：原有无状态逻辑 ───
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
```

### 1.4 集成点改造

#### `audio-engine/core/AudioPipeline.h` — 添加成员

```cpp
// 在 AudioPipeline 类的 private 区域添加
#include "../dsp/ChannelRouter.h"

class AudioPipeline {
  // ...
private:
  ChannelRouter channelRouter_;  // 替代原来的自由函数调用
  // ...
};
```

#### `audio-engine/core/AudioPipeline.cpp` — 替换调用

```cpp
// 第 1743 行，原来的：
routeChannels(readBuffer, segment, read, decodeChannels, channels, outputConfig.routingMode);

// 改为：
channelRouter_.route(readBuffer, segment, read, decodeChannels, channels, outputConfig.routingMode);

// 同理第 1789 行 preload 路径的调用也改
```

#### 在 `AudioPipeline` 初始化 / 设备打开时通知采样率

```cpp
// 在 outputFormat_ 确定后（open 成功后）调用：
channelRouter_.setSampleRate(outputFormat_.sampleRate);

// 在切歌 / stop 时调用：
channelRouter_.reset();
```

#### `audio-engine/core/AudioTypes.h` — 扩展 OutputConfig

```cpp
struct OutputConfig {
  uint32_t preferredBufferSize = 0;
  ChannelRoutingMode routingMode = ChannelRoutingMode::Auto;
  bool wasapiExclusivePushMode = false;
  // 新增：上混参数（可选，JSON 里有就用，没有走默认值）
  float upmixCenterGain = 0.7071f;
  float upmixLfeGain = 0.5f;
  float upmixSurroundGain = 0.5f;
  float upmixSideGain = 0.3f;
  float upmixLfeLowpassHz = 120.0f;
  float upmixSurroundDelayMs = 0.0f;
};
```

#### `audio-engine/core/AudioPipeline.cpp` — 解析配置时同步到 ChannelRouter

```cpp
// 在 setOutputConfig / parseConfigJson 解析 routingMode 的附近添加：
UpmixConfig upmix;
upmix.centerGain = outputConfig.upmixCenterGain;
upmix.lfeGain = outputConfig.upmixLfeGain;
upmix.surroundGain = outputConfig.upmixSurroundGain;
upmix.sideGain = outputConfig.upmixSideGain;
upmix.lfeLowpassHz = outputConfig.upmixLfeLowpassHz;
upmix.surroundDelayMs = outputConfig.upmixSurroundDelayMs;
channelRouter_.setUpmixConfig(upmix);
```

### 1.5 UI 层（可选，后续增强）

在 `SettingsPage.vue` 的 channel routing 选项下方，当选中 5.1/7.1 时展开上混参数调节滑块：

```
Stereo → 5.1
  ├── Center Gain:    [────●────] -3dB (0.707)
  ├── LFE Gain:       [──●──────] -6dB (0.5)
  ├── LFE Lowpass:    [───●─────] 120Hz
  ├── Surround Gain:  [──●──────] -6dB (0.5)
  └── Surround Delay: [●────────] 0ms
```

对应在 `settings.ts` 和 `audioEngineManager.ts` 的 `OutputConfig` 接口添加这些字段。

### 1.6 测试

在 `audio-engine/tests/` 新增 `channel_router_tests.cpp`：

```cpp
// 关键测试用例：
// 1. StereoTo51: L/R 直通无衰减，C = (L+R)*0.707，LFE 经低通
// 2. StereoTo71: 8 通道全部有值，SL/SR 增益正确
// 3. 环绕延迟：delayMs > 0 时 RL/RR 滞后 N 个样本
// 4. LFE 低通：高频成分被衰减，低频保留
// 5. reset() 后滤波器状态归零
// 6. 退化路径：sourceChannels < 2 时走 passthrough 不崩溃
```

### 1.7 改动文件清单

| 文件 | 操作 |
|------|------|
| `audio-engine/dsp/ChannelRouter.h` | **重写**：自由函数 → 类 |
| `audio-engine/dsp/ChannelRouter.cpp` | **重写**：加上混矩阵+LFE低通+延迟 |
| `audio-engine/core/AudioTypes.h` | **修改**：OutputConfig 加 upmix 字段 |
| `audio-engine/core/AudioPipeline.h` | **修改**：加 `ChannelRouter channelRouter_` 成员 |
| `audio-engine/core/AudioPipeline.cpp` | **修改**：替换 `routeChannels()` 调用 + setSampleRate/reset |
| `audio-engine/CMakeLists.txt` | 确认 ChannelRouter.cpp 已在源文件列表 |
| `audio-engine/tests/channel_router_tests.cpp` | **新增** |
| `src/renderer/src/types/settings.ts` | **修改**：OutputConfig 加 upmix 字段 |
| `src/main/audioEngineManager.ts` | **修改**：OutputConfig 接口加 upmix 字段 + 透传 |
| `src/renderer/src/components/SettingsPage.vue` | **修改**：加 upmix 参数 UI（可选） |

---

## 方案二：WASAPI Exclusive 后端自动恢复

### 2.1 问题现状

`WasapiExclusiveBackend.cpp` 的渲染循环在设备失效时：

```cpp
// renderLoop() 第 406-414 行
HRESULT hr = audioClient->GetCurrentPadding(&padding);
if (FAILED(hr)) {
  notifyFailure(hr, "无法读取独占输出缓冲状态");
  break;  // ← 直接退出渲染循环，不尝试恢复
}
```

`notifyFailure` 只做通知：
```cpp
if (wasapi::isDeviceInvalidated(hr)) {
  ++diagnostics.deviceLostCount;
  if (eventCallback) eventCallback(OutputBackendEvent::DeviceInvalidated, "输出设备已失效");
  return;  // ← 通知完就结束，后端内部不自愈
}
```

**上层已有部分恢复**：`TwilightAudioEngine` 时钟线程检测到 `DeviceInvalidated` 后，如果 `outputDevice == "auto"`，会调 `play()` 重放。但：
1. 只在 `outputDevice == "auto"` 时生效，用户选了具体设备不恢复
2. 重新 `play()` 会重建整个 pipeline，有 audible gap（数百毫秒到数秒）
3. 不像 ASIO 那样在后端内部退避重试、无感恢复

### 2.2 设计目标

参照 ASIO 的 `recover()` 模式，给 WASAPI Exclusive 加后端内部自动恢复：
- 设备失效后自动重试打开（最多 3 次，退避 500/1000/2000ms）
- 10 秒窗口内最多 3 次恢复，超限进入 10 秒冷却
- 恢复成功后继续渲染（无 audible gap 或极短 gap）
- 恢复失败才通知上层 `DeviceInvalidated`
- 所有恢复计入 `Diagnostics`

### 2.3 实现

在 `WasapiExclusiveBackend::Impl` 中添加恢复逻辑：

#### `WasapiExclusiveBackend.cpp` — Impl 结构体新增字段

```cpp
struct WasapiExclusiveBackend::Impl {
  // ... 现有字段 ...

  // ── 新增：自动恢复状态 ──
  std::atomic<bool> recoveryInProgress{false};
  int recoveryAttempts = 0;
  uint64_t recoveryCount = 0;
  std::chrono::steady_clock::time_point recoveryCooldownUntil{};
  std::deque<std::chrono::steady_clock::time_point> recoveryWindow;

  // 恢复所需的上下文快照（open 时保存）
  std::string openDeviceId;
  AudioFormat openRequestedFormat;

  // ── 新增：恢复方法 ──
  bool attemptRecovery(const std::string& reason);
  bool reopenDevice();
};
```

#### 核心恢复方法

```cpp
#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)

bool WasapiExclusiveBackend::Impl::reopenDevice() {
  // 停止当前残留状态
  if (audioClient) {
    audioClient->Stop();
    audioClient->Reset();
  }
  renderClient.Reset();
  audioClient.Reset();
  samplesReadyEvent.reset();

  // 重新激活 AudioClient
  if (!activateAudioClient(nullptr)) return false;

  // 重新协商格式 + 初始化
  if (!configureStream(openRequestedFormat, nullptr)) return false;

  // 重新绑定事件 + 获取 RenderClient
  if (!attachEventAndRenderClient(nullptr)) return false;

  return true;
}

bool WasapiExclusiveBackend::Impl::attemptRecovery(const std::string& reason) {
  static constexpr int kMaxAttempts = 3;
  static constexpr int kBackoffMs[] = {500, 1000, 2000};
  static constexpr auto kRecoveryWindow = std::chrono::seconds(10);
  static constexpr auto kRecoveryCooldown = std::chrono::seconds(10);

  const auto now = std::chrono::steady_clock::now();

  // 清理过期的窗口记录
  while (!recoveryWindow.empty() && now - recoveryWindow.front() > kRecoveryWindow) {
    recoveryWindow.pop_front();
  }

  // 已有恢复在进行中
  if (recoveryInProgress.load()) {
    return false;
  }

  // 冷却期内不恢复
  if (now < recoveryCooldownUntil) {
    return false;
  }

  // 窗口内恢复次数超限 → 进入冷却
  if (recoveryWindow.size() >= static_cast<size_t>(kMaxAttempts)) {
    recoveryCooldownUntil = now + kRecoveryCooldown;
    return false;
  }

  recoveryWindow.push_back(now);
  recoveryInProgress = true;

  std::string lastError;
  for (int attempt = 0; attempt < kMaxAttempts; ++attempt) {
    recoveryAttempts = attempt;
    std::this_thread::sleep_for(std::chrono::milliseconds(kBackoffMs[attempt]));

    if (!reopenDevice()) {
      continue;
    }

    // 恢复成功
    recoveryInProgress = false;
    recoveryAttempts = 0;
    ++recoveryCount;
    ++diagnostics.sessionRecoveryCount;
    ++diagnostics.lifetimeRecoveryCount;
    outputInfo.deviceRecovered = true;
    outputInfo.recoveryCount = static_cast<int>(recoveryCount);
    outputInfo.diagnostics = diagnostics;
    return true;
  }

  // 全部失败
  recoveryInProgress = false;
  recoveryAttempts = kMaxAttempts;
  return false;
}

#endif
```

#### 修改渲染循环：失败时尝试恢复而非直接 break

```cpp
void renderLoop() {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  DWORD taskIndex = 0;
  HANDLE mmcssHandle = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);
  auto lastWakeTime = std::chrono::high_resolution_clock::now();
  auto lastLatencyQueryTime = lastWakeTime;
  const double sleepMsDouble = outputInfo.latencyInfo.bufferLatencyMs > 0
      ? outputInfo.latencyInfo.bufferLatencyMs * 0.5 : 5.0;
  const DWORD sleepMs = std::max<DWORD>(1, static_cast<DWORD>(sleepMsDouble));

  while (running.load()) {
    // ── 事件等待 / Push 轮询（原逻辑不变）──
    if (outputConfig.wasapiExclusivePushMode) {
      std::this_thread::sleep_for(std::chrono::milliseconds(sleepMs));
      if (!running.load()) break;
    } else {
      const DWORD waitResult = WaitForSingleObject(samplesReadyEvent.get(), 2000);
      if (!running.load()) break;
      if (waitResult != WAIT_OBJECT_0) {
        if (waitResult == WAIT_TIMEOUT) {
          ++diagnostics.sessionUnderrunCount;
          ++diagnostics.lifetimeUnderrunCount;
        }
        continue;
      }
    }

    // ── underrun 检测（原逻辑不变）──
    // ... (省略，保持原样) ...

    // ── 渲染 ──
    UINT32 padding = 0;
    HRESULT hr = audioClient->GetCurrentPadding(&padding);
    if (FAILED(hr)) {
      // ★ 关键改动：设备失效时尝试恢复，而非直接 break
      if (wasapi::isDeviceInvalidated(hr) && attemptRecovery("设备缓冲读取失败")) {
        continue;  // 恢复成功，继续渲染循环
      }
      notifyFailure(hr, "无法读取独占输出缓冲状态");
      break;  // 恢复失败或非设备失效，退出
    }

    const UINT32 framesAvailable =
        wasapi::exclusiveRenderFrames(bufferFrameCount, padding, outputConfig.wasapiExclusivePushMode);
    if (framesAvailable == 0) continue;

    if (!renderPacket(framesAvailable)) {
      // renderPacket 内部 notifyFailure 后返回 false
      // 检查是否设备失效，尝试恢复
      if (diagnostics.lastError.find("device") != std::string::npos ||
          wasapi::isDeviceInvalidated(hr)) {
        if (attemptRecovery("渲染提交失败")) {
          continue;  // 恢复成功
        }
      }
      break;
    }
  }

  if (mmcssHandle) AvRevertMmThreadCharacteristics(mmcssHandle);
  CoUninitialize();
}
```

#### 在 `open()` 中保存恢复上下文

```cpp
bool WasapiExclusiveBackend::open(const std::string& deviceId,
                                  const AudioFormat& requestedFormat,
                                  std::string* error) {
  // ... 现有逻辑 ...

  // ★ 新增：保存恢复所需的上下文
  impl_->openDeviceId = deviceId;
  impl_->openRequestedFormat = requestedFormat;
  impl_->recoveryInProgress = false;
  impl_->recoveryAttempts = 0;
  impl_->recoveryWindow.clear();
  impl_->recoveryCooldownUntil = {};

  return true;
}
```

#### 修改 `notifyFailure`：设备失效时先尝试恢复再通知

```cpp
void notifyFailure(HRESULT hr, const char* fallbackMessage) {
  if (wasapi::isDeviceInvalidated(hr)) {
    // ★ 先尝试后端内部恢复
    if (attemptRecovery("WASAPI 独占设备失效")) {
      return;  // 恢复成功，不通知上层
    }
    // 恢复失败，才通知上层
    ++diagnostics.deviceLostCount;
    recordFailure("device_lost",
                  fallbackMessage + std::string(" (错误码 ") + hresultSuffix(hr) + ")");
    if (eventCallback) eventCallback(OutputBackendEvent::DeviceInvalidated, "输出设备已失效");
    return;
  }
  // 非设备失效的错误（原逻辑不变）
  char buffer[160] = {};
  std::snprintf(buffer, sizeof(buffer), "%s (错误码 0x%08lx)",
                fallbackMessage, static_cast<unsigned long>(hr));
  ++diagnostics.sessionBufferDropCount;
  ++diagnostics.lifetimeBufferDropCount;
  recordFailure("render_failure", buffer);
  if (eventCallback) eventCallback(OutputBackendEvent::RenderError, buffer);
}
```

### 2.4 恢复成功后的回调处理

恢复成功后，需要让回调（callback/typedCallback）继续填充数据。由于 `reopenDevice()` 后 `audioClient` 和 `renderClient` 是全新对象，但 `callback` 仍然指向 `AudioPipeline` 的 render 函数，所以**数据流不需要重建**——pipeline 还在，只是后端换了底层句柄。这正是后端内部恢复优于上层 `play()` 重放的原因：**pipeline 不销毁，播放位置不丢，gap 最小**。

需要注意：恢复后要重新预填充一个 buffer：

```cpp
// 在 attemptRecovery 成功后、return true 之前添加：
if (!renderPacket(wasapi::exclusiveInitialRenderFrames(
        bufferFrameCount, outputConfig.wasapiExclusivePushMode))) {
  // 预填充失败
  return false;
}
HRESULT startHr = audioClient->Start();
if (FAILED(startHr)) {
  return false;
}
```

### 2.5 改动文件清单

| 文件 | 操作 |
|------|------|
| `audio-engine/output/wasapi/WasapiExclusiveBackend.cpp` | **修改**：加恢复逻辑+改 renderLoop+改 notifyFailure |
| `audio-engine/output/wasapi/WasapiExclusiveBackend.h` | 无需改（Impl 是 PIMPL，内部改） |
| `audio-engine/output/wasapi/WasapiCommon.h` | 无需改（`isDeviceInvalidated` 已存在） |
| `audio-engine/tests/output_backend_tests.cpp` | **修改**：加 WASAPI 恢复测试用例 |

### 2.6 测试策略

```cpp
// 在 output_backend_tests.cpp 或新增 wasapi_recovery_tests.cpp：
// 1. Mock WASAPI 设备在第 N 帧后返回 AUDCLNT_E_DEVICE_INVALIDATED
//    → 验证后端自动恢复，recoveryCount 递增
// 2. 连续 3 次恢复失败 → 验证进入冷却，不再尝试
// 3. 冷却期过后 → 验证恢复尝试恢复
// 4. 恢复成功后 callback 继续被调用（pipeline 不中断）
// 5. 非设备失效错误（如 E_INVALIDARG）→ 不触发恢复，直接通知
```

---

## 实施优先级

| 优先级 | 方案 | 工作量 | 影响 |
|--------|------|--------|------|
| **P0** | WASAPI Exclusive 自动恢复 | ~1-2 天 | 健壮性：独占模式拔插/驱动重装后无感续播 |
| **P1** | Channel Routing 上混矩阵 | ~2-3 天 | 功能性：5.1/7.1 设备上真正多声道输出 |
| **P2** | 上混参数 UI | ~0.5 天 | 可选增强：让用户调节增益/延迟 |

建议先做 P0（WASAPI 恢复），因为它是现有功能的健壮性补全，改动集中在一个文件，风险低。P1 涉及数据结构变更和跨层接口修改，需要更充分的测试。
