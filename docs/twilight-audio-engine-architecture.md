# Twilight Audio Engine 架构状态

## 当前阶段

当前仓库不再按旧阶段从零推进。代码已经包含 C ABI、Node-API、FFmpeg decode、AudioPipeline、DSP、Metadata、Queue、WASAPI Shared/Exclusive、ASIO 可选接入、CoreAudio/ALSA 源码后端和 Electron 集成。当前补完重点是事实层验证、公共契约稳定和 fallback 收口。

已验证基线：

```bash
npm run configure:audio-engine:mingw
npm run build:audio-engine:mingw
ctest --test-dir audio-engine/build/mingw-static -N
npm run test:audio-engine:mingw
npm run typecheck
npm run build
```

当前 `ctest -N` 注册 20 个 MinGW 测试目标，`npm run test:audio-engine:mingw` 是 native 闭环验证入口。`npm run test:no-real-device` 串联 MinGW configure/build、native CTest、Electron manager 测试、typecheck 和前端 build；真实设备 smoke 继续 opt-in，不进入默认门禁。

## 边界

- C ABI 是稳定边界；新增查询继续使用 buffer/required-size 模式。
- Node-API 是薄桥接，只转发 C ABI、抛出 native 错误、返回 JSON。
- `outputInfo` 是 canonical playback 状态；顶层 `PlaybackInfo` 字段只做兼容镜像，包括 `isDsd`、`dsdMode`、`dsdRate`。
- Native queue 负责 EOF auto-next、gapless preload 和 crossfade overlap mixing；Electron 只同步 `PlaybackInfo` 并发送用户操作。`crossfadeSeconds` 由 native 状态上报并使 `outputPerfect=false`，Renderer 不再在 native 播放时用自己的 crossfade 定时器驱动下一首。
- Electron 默认走 native engine；HTMLAudio 只允许通过 `TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK=1` 显式开启。
- Electron audio service crash 后先把 native playback 标记为 stopped；service ready 后只恢复后端、设备、输出配置、DSP 设置、原生 DSP 插件链和队列，不自动续播，避免在崩溃恢复时产生非用户触发的播放。
- ASIO SDK 不入仓库；缺失时构建通过，并通过 capabilities/后端列表报告不可用。
- 真实设备 smoke 是 opt-in：没有 ASIO SDK、目标平台工具链或真实设备时跳过，不阻塞默认 CI。

## sourceExact / outputPerfect 策略

当前公共契约使用双状态：`sourceExact` 表示源文件级精确，`outputPerfect` 表示 decoded PCM 到后端实际输出期间没有额外处理或格式损伤。后端只上报实际输出格式和能力，最终状态由统一 evaluator 计算。

`outputPerfect=true` 要求 backend capability、decoded PCM 与实际输出的采样率/位深/声道/sample format 完全匹配、无 resample、无 DSP/音量/routing 改变，并且本次播放 `pcmPassthrough=true`。`pcmPassthrough` 由 `AudioPipeline` 用 FFmpeg decoded PCM 与后端 actual output 事实比较得出；后端只上报事实。`sourceExact=true` 还要求源为无损且源格式与输出格式完全一致；MP3/AAC/OGG 等有损源可达成 `outputPerfect=true`，但不会达成 `sourceExact=true`。

当前 WASAPI Exclusive / ASIO 在严格 bypass 条件下可以走 typed PCM passthrough：FFmpeg decode 输出、`AudioBuffer`、后端 typed render 共享同一个实际 PCM 格式，Int16/Int24/Int32/Float32 均可参与 `pcmPassthrough` 判定。无损整数 PCM 源如果因源格式与设备实际格式不一致、DSP/音量/routing 处理或其它 fallback 进入 Float32 管线，再由后端重新打包为整数输出，必须报告 `outputPerfect=false`、`pcmPassthrough=false` 和具体 `perfectReasonCode`，不得误报 bit-perfect。

## 可视化 tap

FFT tap 已扩展为只读 visualization tap，监听最终 PCM 渲染缓冲，不影响音频输出。C ABI / Node-API 通过 `GetVisualizationData` 返回 spectrum、waveform、peak、RMS、momentary LUFS 估算、固定滚动窗口 spectrogram、decoupled 示波器时域采样（`oscilloscopePoints` 0-4096，默认 1024，独立于 `fftResolution`）、可选预聚合 `visualizerBars`、sampleRate、active、`tapStatus` 和 `reason`。`spectrumPoints` 支持 8-4096，播放页可请求 4096 个线性 FFT bins 并在 UI 侧做 log-Hz 映射；高频全屏可视化可把 `spectrogramFrames` / `oscilloscopePoints` 设为 0 关闭未使用 payload。无播放采样或 tap 禁用时返回 inactive 空闲态；播放中 native tap 不可用时 main 可返回显式标记的 `synthetic-fallback` 兼容数据，Renderer 必须把它当诊断 fallback 或空闲态处理，不能展示为真实 native 采样成功。

Phase 6B 的后端判定边界：

- WASAPI Shared 是系统混音路径，始终以明确 reason 报告 `outputPerfect=false`。
- WASAPI Exclusive 和 ASIO 必须先真实上报 actual sample rate、bit depth、channel、sample format，再由 evaluator 判定；format negotiation 或 exclusive/driver open 失败要给具体 reason。
- CoreAudio 默认路径继续 `outputPerfect=false`；Hog/Exclusive 未实现并验证前不进入 true 判定。
- ALSA `default` / `plughw:` 默认可能经过插件转换，继续 `outputPerfect=false`；只有显式 `hw:` 且 actual format 完全匹配时才允许进入 true 判定。

## DSP 策略

DSP 默认 bypass。ReplayGain、EQ、FIR Convolver、Crossfeed、Crossfade 和软件音量只有在显式配置或用户操作后才影响状态；任一会改变样本或播放连续性的处理启用时，最终 `outputPerfect=false`。

## DSD 策略

Metadata 会识别 DSD 相关字段并报告 DSD64/128/256/512 级别。Renderer 展示优先消费 `outputInfo.isDsd` / `dsdMode` / `dsdRate` 表示当前 runtime 传输状态，顶层字段只做兼容镜像；当 DoP 运行时回退到 PCM 时，canonical mirror 必须清成 `isDsd=false`、`dsdMode='pcm'`、`dsdRate=0`，而源侧 DSD 标签可继续由文件元数据提供。

- DoP carrier：允许 DSF/DFF DSD64/128/256/512 在后端、设备、声道数和实际 PCM carrier 格式满足条件时进入 `dsdMode=dop`，遵循 dCS DoP open standard v1.1（24-bit、`0x05`/`0xFA` marker 交替）；carrier 速率 DSD64=176.4k、DSD128=352.8k、DSD256=705.6k（44.1k）/768k（48k）、DSD512=1411.2k（44.1k）/1536k（48k），上限从 DSD128 提升到 DSD512，运行时由设备 carrier-rate 能力门控（ASIO `dopCarrierSampleRates` 或 WASAPI/CoreAudio Exclusive `IsFormatSupported` 探测）。UI 展示 `DoP carrier`，不把它写成 PCM fallback。
- PCM fallback：DoP 条件不满足（含设备不支持 DSD256/512 carrier 速率），或软件音量、ReplayGain、EQ、Convolver、Crossfeed、Crossfade 等处理启用时，实际链路回到 DSD 源 -> decoded PCM -> 后端 PCM 输出；UI 需要明确展示 fallback。
- Native DSD：支持 ASIO 与 ALSA `hw:`（`SND_PCM_FORMAT_DSD_U8` / `DSD_U16_LE` / `DSD_U32_LE` 直送，rate = DSD bit-clock / phys_width，静音字节 `0x69`，格式顺序 U8→U32_LE→U16_LE，`backendCanAttemptNativeDsd("alsa")==true`，nativeDsdRuntimeFacts 开打开时 Candidate、首次成功 `writei` 后 Proven）。运行态证明为 `proven` 时可直接输出 DSD bitstream，否则回退 DoP 或 PCM。WASAPI 与 CoreAudio 没有 native DSD 通道（平台限制），走 DoP 或 PCM。
- SACD ISO：支持未压缩 DSD area 的曲目切片播放；DST 压缩曲目通过 DSD-preserving provider（vendored FFmpeg dstdec 算术核心，LGPL-2.1+，输出原始 DSD 字节）解出 DSD 后进入与未压缩 DSD 相同的 Native DSD / DoP / PCM 决策链。provider 默认可用；不可用时报告 `dst_dsd_provider_unavailable`，失败时报 `dst_dsd_provider_failed`，禁止把 FFmpeg PCM DST decode 包装成 Native DSD/DoP 成功。

## 已闭环

- SACD DST：通过 DSD-preserving provider（vendored FFmpeg dstdec，LGPL-2.1+，输出原始 DSD 字节）解出 DSD，进入与未压缩 DSD 相同的 Native DSD / DoP / PCM 决策链；provider 默认可用，`sacdIsoDst=true`、`sacdIsoDstMode="native"`、`sacdIsoDstDsdProvider=true`，DST 曲目 `playable=true`、`outputModes=["native","dop","pcm"]`。
- DoP DSD256/512：carrier 上限从 DSD128 提升到 DSD512，遵循 dCS DoP open standard v1.1，运行时由设备 carrier-rate 能力门控。
- ALSA native DSD：`hw:` 设备通过 `DSD_U8` / `DSD_U16_LE` / `DSD_U32_LE` 直送 DSD，`backendCanAttemptNativeDsd("alsa")==true`，nativeDsdRuntimeFacts 开打开时 Candidate、首次成功 `writei` 后 Proven。
- 示波器视图：`GetVisualizationData` 新增 decoupled `oscilloscope` 时域采样（`oscilloscopePoints` 0-4096，默认 1024；0 表示关闭该 payload），独立于 `fftResolution`；PlayerBar 提供独立示波器子面板（canvas polyline、零交叉触发、`transition:none`）。`tapStatus/reason` 区分 stopped、disabled、no samples、native unavailable 与 synthetic fallback。
- CoreAudio Hog Mode 加固：预检现有 hog owner、安装 device-lost listener、跟踪 IOProc underrun 诊断；ICoreAudioHost / MockCoreAudioHost seam 使 CoreAudio 后端逻辑可在 Windows 单元测试。
- ALSA 后端 seam：IAlsaHost / MockAlsaHost 使 ALSA 后端逻辑可在 Windows 单元测试（此前只能靠真实 Linux 硬件验证）。

## 平台限制（非代码缺口）

- WASAPI native DSD：Windows WASAPI 没有 UAC2 native DSD 通道；DoP 可在 WASAPI Exclusive 工作，native DSD 不行。
- CoreAudio native DSD：macOS CoreAudio 没有 DSD 通道；DoP 可在 CoreAudio Exclusive（Hog）工作，native DSD 不行。
- 真实设备 smoke（ASIO / WASAPI Exclusive / CoreAudio Hog / ALSA `hw:` / Native DSD / SACD ISO）通过 `TAE_RUN_REAL_AUDIO_BACKEND_TESTS=1` 开启，opt-in，不进入默认 CI 门禁，不伪造结果；`npm run smoke:audio-evidence -- --input <summary-a.json> --input <summary-b.json>` 或 `--input-dir <dir>` 将多台机器/多设备结果沉淀为可读 Markdown/JSON，并把缺失 surfaces 显示为 `not-run`。报告 JSON 带 `coverage.complete`，发布前可手动加 `--require-complete` 做 opt-in 证据完整性检查。

## 后续顺序

1. 继续收口 ASIO、CoreAudio、ALSA 的 actual format、failure reason 与 opt-in smoke；WASAPI Exclusive 已增加真实设备多格式矩阵 smoke，并有 audio smoke evidence 报告工具沉淀结果。
2. 扩充真实音频 fixture 样本集；当前默认门禁覆盖 generated WAV/DSF，`TAE_AUDIO_FIXTURE_MANIFEST` 可指向外部 JSON 矩阵，`TAE_AUDIO_FIXTURES_DIR` 继续作为 MP3/FLAC/M4A/OGG/AAC/DSF/DFF 等外部小样本目录扫描 fallback。
3. 在 macOS/Linux 工具链与真实设备 smoke 通过后补平台产物路径和打包检查；WASAPI / CoreAudio 的 native DSD 属平台限制，不作为待补代码项。
