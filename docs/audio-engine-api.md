# Twilight Audio Engine API 说明

本文记录当前 `PlaybackInfo`、`OutputInfo`、Capabilities、`sourceExact` / `outputPerfect` 与 Recovery diagnostics 的对外语义。

## PlaybackInfo 与 OutputInfo

`TAE_GetPlaybackInfo()` 返回 JSON。`outputInfo` 是 canonical 字段，顶层的 `actualBackend`、`actualSampleRate`、`latencyMs`、`sourceExact`、`outputPerfect`、`perfectReason` 等字段只做镜像，值从 `outputInfo` 派生。

关键字段：

- `outputInfo.backend`：用户选择的后端，例如 `wasapi`、`wasapi-exclusive`、`asio`、`coreaudio`、`alsa`。
- `outputInfo.actualBackend`：实际运行后端，应该与后端实现和 fallback 状态一致。
- `outputInfo.deviceName` / `actualDeviceName`：请求设备名与实际设备名。`auto` 会解析为平台默认输出设备。
- `outputInfo.outputSampleRate` / `outputBitDepth`：引擎向解码与渲染管线公开的输出格式。
- `outputInfo.actualSampleRate` / `actualBitDepth` / `actualChannels`：后端协商后的实际输出参数。
- `outputInfo.actualOutputFormat`：后端样本格式，例如 `float32`、`S16_LE`、`S24_3LE`。
- `decodedSampleRate` / `decodedBitDepth` / `decodedChannels` / `decodedSampleFormat`：FFmpeg 解码后送入 AudioPipeline 的 PCM 工作格式，供 UI 展示输出链路并参与 passthrough 事实核对。
- `outputInfo.bufferSizeFrames`：后端缓冲区帧数。
- `outputInfo.latencyMs`：估算总延迟，等价于或接近 `latencyInfo.totalLatencyMs`。
- `outputInfo.latencyInfo.bufferLatencyMs`：周期/缓冲带来的渲染延迟估算。
- `outputInfo.latencyInfo.outputLatencyMs`：设备/驱动报告的额外输出延迟估算。
- `outputInfo.supportsOutputPerfect`：后端是否声明当前路径具备独占或直连输出前提能力。
- `outputInfo.sourceExact`：源文件级精确状态。只有无损/整数 PCM 源格式与输出格式可证明完全保持时才为 `true`；MP3/AAC/OGG 等有损格式默认 `false`。
- `outputInfo.outputPerfect`：解码后 PCM 到后端实际输出之间没有额外处理、重采样、音量、DSP、破坏性 routing 或 sample format 损伤时为 `true`。
- `outputInfo.pcmPassthrough`：本次播放 decoded PCM 与后端实际 PCM 格式完全一致且没有后端 resample 时为 `true`；由 `AudioPipeline` 比较 decoded PCM 与 backend actual output 后写入，不由后端自行声明。
- `outputInfo.resampled`：后端或统一评估发现采样率、位深、声道数或 sample format 发生转换。
- `outputInfo.perfectReason`：`sourceExact` 或 `outputPerfect` 未达成时的 canonical 原因。
- `outputInfo.isDsd` / `dsdMode` / `dsdRate`：DSD 状态 canonical 字段。顶层 `PlaybackInfo.isDsd`、`dsdMode`、`dsdRate` 只做镜像；Renderer 应优先读取 `outputInfo` 表示当前 runtime 传输状态。若 DoP 在运行时回退到 PCM，canonical 状态必须同步为 `isDsd=false`、`dsdMode='pcm'`、`dsdRate=0`，UI 可另外基于源文件元数据保留 `DSF/DFF DSD64 -> PCM fallback ...` 的源侧说明。
- `crossfadeActive` / `crossfadeSeconds`：播放连续性处理状态。当前 native 会对预加载下一首做 overlap mixing，并参与 bit-perfect 判定；启用 crossfade 时必须报告 `outputPerfect=false`。

## Visualization API

`TAE_GetVisualizationData(engine, options_json, buffer, buffer_size, required_size)` 是只读 tap 查询接口，使用与其他 JSON 查询相同的 buffer/required-size 模式。它监听最终送往后端前的 PCM 渲染缓冲，不改变音频输出；旧的 `TAE_GetSpectrumData()` 保留为兼容入口。

`options_json` 支持：

- `spectrumPoints`：8-256，默认 64。
- `waveformPoints`：16-512，默认 128。
- `spectrogramFrames`：1-96，默认 48；native 侧保留固定滚动窗口，不无限增长。

返回 JSON 固定包含：

- `spectrum: number[]`
- `waveform: number[]`
- `peakDb: number`
- `rmsDb: number`
- `lufsMomentary: number | null`
- `spectrogram: number[][]`
- `sampleRate: number`
- `active: boolean`

当没有播放采样或 FFT tap 禁用时，`active=false`，`spectrum` / `waveform` 返回固定长度零数组，`spectrogram=[]`，`lufsMomentary=null`。UI 必须把它展示为空闲态，不能生成假成功数据。当前 LUFS 为基于当前 PCM 块 RMS 的 momentary 估算，用于播放器可视化，不作为合规响度计量。

## Capabilities 与错误 JSON

`TAE_GetEngineCapabilities()` 使用 C ABI 的 buffer/required-size 模式返回 JSON。稳定字段包括：

- `defaultBackend`：当前平台默认 backend id。
- `pcmPassthrough`：当前构建具备 per-playback PCM passthrough 判定能力；实际状态以 `outputInfo.pcmPassthrough` 为准。
- `outputPerfectRequiresPcmPassthrough`：`outputPerfect` 是否要求 PCM passthrough；当前为 `true`。
- `htmlAudioFallbackDefault`：Electron 是否默认允许 HTMLAudio 兜底；现阶段为 `false`。
- `backends` / `backendCapabilities`：后端能力列表，两个字段保持兼容。
- `features`：FFmpeg、WASAPI、ASIO、CoreAudio、ALSA、Native DSD、DoP、SACD ISO 能力布尔值。
- `dsd`：DSD 能力模型。Phase 6D 中 DSF/DFF DSD64/128 可进入 DoP carrier path；DSD256/512、处理启用或设备/后端不满足 carrier 条件时走 PCM fallback。Native DSD 与 SACD ISO 仍保持后置。

`TAE_GetLastError()` 同样使用 buffer/required-size 模式，返回 `hasError`、`code`、`message`、`backend`、`context`、`recoverable`。

## 双状态判定规则

最终 `outputPerfect=true` 必须同时满足：

- 后端当前路径声明 `supportsOutputPerfect=true`。
- decoded PCM 与实际输出格式的采样率、有效 PCM 位深、声道数和 sample format 完全匹配。
- 当前 PCM 路径已验证样本级 passthrough，即 `outputInfo.pcmPassthrough=true`；Float32 -> Int24、Int24 -> Float32、Int24 -> Int24-in32 等 sample format 或容器变化都不算 passthrough。
- 后端没有报告 `resampled=true`。
- 音量为 1.0。
- ReplayGain、EQ、Convolver、Crossfeed、Crossfade 均未启用。
- 声道 routing 不改变声道语义。

`sourceExact=true` 额外要求源格式无损，并且源格式与实际输出格式完全一致。有损格式可以达成 `outputPerfect=true`，但 `sourceExact=false`，原因会显示为 `Source is lossy; decoded PCM path is output perfect`。

各后端只声明能力和实际格式；`TwilightAudioEngine` 与 `AudioPipeline` 不按 backend id 硬编码最终状态。WASAPI Exclusive / ASIO 当前可以在处理链完全 bypass、音量为 1.0、routing 保持语义且 decoded PCM 与后端实际格式完全一致时走 typed PCM passthrough；Int16/Int24/Int32/Float32 都由 `PcmBlock`、typed `AudioBuffer` 和后端 typed render 承载。整数 PCM 源如果因为格式不匹配或处理链要求被转换到 Float32，再由后端重新打包为整数输出，仍必须报告 `outputPerfect=false`、`pcmPassthrough=false` 和具体原因，例如 `integer_passthrough_unavailable` 或 `pcm_converted`。

## DSD / DoP / SACD 语义

- DoP carrier：DSF/DFF DSD64/128 在后端、设备、声道数和实际 PCM carrier 格式满足条件时可进入 `dsdMode=dop`。UI 展示为 DSD 源到 `DoP carrier` 再到后端实际输出；它不同于 PCM fallback，因为 carrier 保留 DSD bitstream。
- PCM fallback：DSF/DFF DSD256/512、DoP carrier 条件不满足，或软件音量、ReplayGain、EQ、Convolver、Crossfeed、Crossfade 等处理启用时，必须走 PCM fallback。UI 展示为 DSD 源到 PCM 工作格式再到后端实际 PCM 格式，不把它标为 Native DSD 或 DoP。
- Native DSD：指后端和设备直接接收 DSD bitstream。Phase 6D 不实现 Native DSD，capabilities 与播放状态不得声明 native 已完成。
- SACD ISO：Phase 6D 不作为可播放容器支持；只能识别/报告 unsupported，不能静默当作 DSF/DFF、DoP 或普通 PCM 播放完成。

Phase 6B 的后端规则：

- WASAPI Shared 永远不进入 `outputPerfect=true`，原因应说明系统 shared mixer。
- WASAPI Exclusive 只有独占打开成功、实际 PCM 格式完整上报且与 decoded PCM 完全匹配时，才允许进入 evaluator 判定；协商失败要区分 sample rate、bit depth、channel、sample format 或 exclusive open。
- ASIO 只有驱动成功加载、buffer 创建成功、实际 sample format/采样率/声道/位深完整上报且与 decoded PCM 匹配时，才允许进入 evaluator 判定。
- CoreAudio 默认输出路径继续 `outputPerfect=false`，除非后续实现并验证 Hog/Exclusive 语义。
- ALSA `default` / `plughw:` 默认可能经过插件转换，继续 `outputPerfect=false`；只有显式 `hw:` 且实际格式完全匹配时才允许进入 evaluator 判定。

## Recovery Diagnostics

`outputInfo.diagnostics` 记录当前 session 与 lifetime 的恢复信息：

- `sessionUnderrunCount` / `lifetimeUnderrunCount`：本次打开或进程生命周期内的 underrun/xrun 次数。
- `sessionBufferDropCount` / `lifetimeBufferDropCount`：缓冲提交失败或丢弃次数。
- `sessionRecoveryCount` / `lifetimeRecoveryCount`：恢复成功次数。
- `driverRestartCount`：驱动重启或重置事件计数。
- `deviceLostCount`：设备丢失事件计数。
- `lastError`：最近一次后端错误或恢复原因。

ASIO 保留冷却与恢复诊断策略。ALSA 提供基础 xrun 恢复：`snd_pcm_prepare()` / `snd_pcm_resume()` 成功后更新 underrun 与 recovery 计数。

## 后端支持矩阵

| 后端 | 平台 | 当前状态 | outputPerfect 能力 |
| --- | --- | --- | --- |
| WASAPI shared | Windows | 已接入并通过 MinGW 测试矩阵 | `supportsOutputPerfect=false`，经过系统混音 |
| WASAPI exclusive | Windows | 已接入格式协商和 smoke 覆盖 | 独占成功且 actual PCM format 与 decoded PCM 完全匹配后进入 evaluator |
| ASIO | Windows | SDK 可选；无 SDK 时构建通过并报告不可用 | mock 覆盖 Int16/Int24/Int24-in32/Int32/Float32；真实设备 smoke opt-in |
| CoreAudio | macOS | 源码后端存在，需 macOS 工具链验证 | 默认 false；Hog/Exclusive 未验证前不能声明 perfect |
| ALSA | Linux | 源码后端存在，需 Linux 工具链/设备验证 | `default`/`plughw:` 默认 false；仅显式 `hw:` 且格式完全匹配时可为 true |

## 当前非闭环范围

当前不包含真实 Native DSD、SACD ISO 播放、CoreAudio hog mode、高级设备独占、多设备同步或复杂热插拔监听。DoP 的 Phase 6D 范围限定为 DSF/DFF DSD64/128 的 carrier path；DSD256/512 与处理启用场景必须回到 PCM fallback。真实设备 smoke 是 opt-in，不作为当前 CI 必需条件；没有 ASIO SDK、macOS/Linux 工具链或对应设备时必须跳过并保持默认验证通过。
