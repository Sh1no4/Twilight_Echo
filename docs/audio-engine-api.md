# Twilight Audio Engine API 说明

本文记录 Phase 6 后 `PlaybackInfo`、`OutputInfo`、BitPerfect 与 Recovery diagnostics 的对外语义。

## PlaybackInfo 与 OutputInfo

`TAE_GetPlaybackInfo()` 返回 JSON。`outputInfo` 是 canonical 字段，顶层的 `actualBackend`、`actualSampleRate`、`latencyMs`、`bitPerfect`、`resampleReason` 等字段仅用于兼容旧调用方，值从 `outputInfo` 镜像。

关键字段：

- `outputInfo.backend`：用户选择的后端，例如 `wasapi`、`wasapi-exclusive`、`asio`、`coreaudio`、`alsa`。
- `outputInfo.actualBackend`：实际运行后端。Phase 6 中应与后端实现一致。
- `outputInfo.deviceName` / `actualDeviceName`：请求设备名与实际设备名。`auto` 会解析为平台默认输出设备。
- `outputInfo.outputSampleRate` / `outputBitDepth`：引擎向解码与渲染管线公开的输出格式。
- `outputInfo.actualSampleRate` / `actualBitDepth` / `actualChannels`：后端协商后的实际输出参数。
- `outputInfo.actualOutputFormat`：后端样本格式，例如 `float32`、`S16_LE`、`S24_3LE`。
- `outputInfo.bufferSizeFrames`：后端缓冲区帧数。
- `outputInfo.latencyMs`：估算总延迟，等价于或接近 `latencyInfo.totalLatencyMs`。
- `outputInfo.latencyInfo.bufferLatencyMs`：周期/缓冲带来的渲染延迟估算。
- `outputInfo.latencyInfo.outputLatencyMs`：设备/驱动报告的额外输出延迟估算。
- `outputInfo.supportsBitPerfect`：后端是否声明当前路径具备 bit-perfect 前提能力。
- `outputInfo.resampled`：后端或统一评估发现采样率/位深/格式发生转换。
- `outputInfo.resampleReason`：无法 bit-perfect 或发生格式转换的 canonical 原因。
- `outputInfo.bitPerfect`：统一规则计算出的最终 bit-perfect 状态。

## BitPerfect 判定规则

最终 `bitPerfect=true` 必须同时满足：

- 后端当前路径声明 `supportsBitPerfect=true`。
- 源格式与实际输出格式的采样率、有效 PCM 位深匹配。
- 后端没有报告 `resampled=true`。
- 音量为 1.0。
- ReplayGain、EQ、Convolver、Crossfeed 均未启用。
- 声道 routing 不改变声道语义。

各后端只声明能力和实际格式；`TwilightAudioEngine` 与 `AudioPipeline` 不按 backend id 硬编码最终 bit-perfect。

## Recovery Diagnostics

`outputInfo.diagnostics` 记录当前 session 与 lifetime 的恢复信息：

- `sessionUnderrunCount` / `lifetimeUnderrunCount`：本次打开或进程生命周期内的 underrun/xrun 次数。
- `sessionBufferDropCount` / `lifetimeBufferDropCount`：缓冲提交失败或丢弃次数。
- `sessionRecoveryCount` / `lifetimeRecoveryCount`：恢复成功次数。
- `driverRestartCount`：驱动重启或重置事件计数。
- `deviceLostCount`：设备丢失事件计数。
- `lastError`：最近一次后端错误或恢复原因。

ASIO 保留 Phase 5B 的冷却策略。ALSA Phase 6 提供基础 xrun 恢复：`snd_pcm_prepare()` / `snd_pcm_resume()` 成功后更新 underrun 与 recovery 计数。

## 后端支持矩阵

| 后端 | 平台 | Phase 6 状态 | BitPerfect 能力 |
| --- | --- | --- | --- |
| WASAPI shared | Windows | 已有共享输出 | `supportsBitPerfect=false`，经过系统混音 |
| WASAPI exclusive | Windows | 已有独占输出 | 格式匹配且无 DSP/音量/routing 改变时可为 true |
| ASIO | Windows | Phase 5B 稳定 | 驱动直连、格式匹配且无处理时可为 true |
| CoreAudio | macOS | Phase 6 默认/指定输出 PCM Float32 | 默认 false，系统路径不能保证无混音 |
| ALSA | Linux | Phase 6 default/plughw/hw PCM | 仅显式 `hw:` 直连且格式完全匹配时可为 true |

## Phase 6 非范围

Phase 6 不包含 DSD Native、DoP、CoreAudio hog mode、高级设备独占、多设备同步或复杂热插拔监听。真实设备运行测试默认不作为 CI 必需条件。
