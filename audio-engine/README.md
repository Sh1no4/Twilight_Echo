# Twilight Audio Engine

Twilight Echo 的 C++20 原生音频引擎，通过稳定 C ABI 和 Node-API 桥接给 Electron 使用。API 字段、outputPerfect 判定和 Recovery diagnostics 见 [docs/audio-engine-api.md](../docs/audio-engine-api.md)，阶段与架构约束见 [docs/twilight-audio-engine-architecture.md](../docs/twilight-audio-engine-architecture.md)。

## 当前状态

当前仓库已经包含：

- C ABI：`TAE_Play`、队列、DSP 配置、设备/后端枚举、`TAE_GetPlaybackInfo`、`TAE_GetVisualizationData`、`TAE_GetEngineCapabilities`、`TAE_GetLastError`。
- Node-API：薄桥接到 C ABI，返回 JSON，不承载播放策略。
- 解码与管线：FFmpeg 解码、Float32 内部渲染、环形缓冲、gapless preload、只读 visualization tap。
- Queue：native 侧负责队列索引、upcoming track、EOF auto-next、gapless 预加载和 crossfade overlap mixing。
- 后端：WASAPI Shared/Exclusive、ASIO 可选 SDK 接入、CoreAudio/ALSA 源码后端。
- DSP：ReplayGain、Parametric EQ、FIR Convolver、Crossfeed、FFT Spectrum / Waveform / Peak / LUFS / Spectrogram 采样。
- Metadata：container、channel layout、channel count、DSD64/128/256/512 识别字段、ReplayGain/R128 字段。

Windows MinGW 当前验证结果：

- `npm run configure:audio-engine:mingw`
- `npm run build:audio-engine:mingw`
- `ctest --test-dir audio-engine/build/mingw-static -N` 注册 13 个测试
- `npm run test:audio-engine:mingw` 13/13 通过
- `npm run typecheck`
- `npm run build`

无真实设备默认门禁：

```bash
npm run test:no-real-device
```

该脚本会串联 MinGW configure/build、native CTest、Electron manager 测试、typecheck 和前端 build。ASIO 驱动、真实 WASAPI Exclusive DAC、Native DSD、SACD ISO 播放和真实 DoP DAC smoke 都不进入默认门禁。

## 构建目标

- `twilight_audio_engine`：共享 C 接口动态库，Windows 输出名为 `twilight-audio-engine.dll`。
- `twilight_audio_node`：Node-API 桥接模块，MinGW preset 默认启用。
- `twilight_audio_tests` 和相关单元测试：C ABI、DSP、metadata、bit-perfect evaluator、queue、backend factory、platform backend smoke、ASIO mock、output backend。

## Windows MinGW

推荐入口：

```bash
npm run configure:audio-engine:mingw
npm run build:audio-engine:mingw
npm run test:audio-engine:mingw
```

`configure:audio-engine:mingw` 由 `scripts/configure-audio-engine-mingw.cjs` 包装 CMake preset，处理两件事：

- 如果 vcpkg/FFmpeg 解压或 rename 遇到 `Access is denied` / `拒绝访问`，清理 `buildtrees/ffmpeg/src/*.tmp` 后重试 configure。
- configure 后强制检查 13 个 CTest 目标是否进入 `audio-engine/build/mingw-static`；如果目标缺失，会清理 CMake 配置缓存并重试。

生成并暂存的运行文件：

```text
audio-engine/build/mingw-static/twilight-audio-engine.dll
audio-engine/build/mingw-static/twilight_audio_node.node
resources/audio-engine/twilight-audio-engine.dll
resources/audio-engine/twilight_audio_node.node
```

## 接口语义

`outputInfo` 是播放状态的 canonical 字段。顶层 `PlaybackInfo.actualBackend`、`actualSampleRate`、`latencyMs`、`sourceExact`、`outputPerfect`、`perfectReason`、`isDsd`、`dsdMode`、`dsdRate` 等字段只做镜像。

`sourceExact=true` 表示源文件级精确；`outputPerfect=true` 表示 decoded PCM 到设备实际输出之间没有额外处理或格式损伤。有损格式可达成 `outputPerfect=true`，但 `sourceExact=false`。`pcmPassthrough` 由 decoded PCM 与后端 actual output 精确比较；整数 PCM 源如果被转换到 Float32 管线再打包为整数输出，不能标记为 `outputPerfect=true`。

WASAPI Exclusive / ASIO 已具备 typed PCM passthrough 分支：当无 DSP、音量为 1.0、routing 不改变语义，且源 PCM 格式与后端实际输出格式完全一致时，FFmpeg decode、AudioBuffer 和后端 typed render 会按 Int16/Int24/Int32/Float32 直通，允许 `pcmPassthrough=true` / `outputPerfect=true`。如果源格式和设备实际格式不一致，或处理链需要 Float32，则继续报告 `integer_passthrough_unavailable` 或 `pcm_converted`，避免误报 bit-perfect。

`TAE_GetVisualizationData` / Node-API `GetVisualizationData` 返回只读可视化数据：`spectrum`、`waveform`、`peakDb`、`rmsDb`、`lufsMomentary`、`spectrogram`、`sampleRate`、`active`。无播放采样时返回 inactive 空闲态；旧的 `TAE_GetSpectrumData` 保留兼容。

Phase 6B 中，后端只上报事实：WASAPI Shared 始终按系统混音路径报告 false；WASAPI Exclusive/ASIO 只有实际格式完整上报并与 decoded PCM 完全匹配时才进入 evaluator；CoreAudio 默认路径在 Hog/Exclusive 未验证前继续 false；ALSA `default` / `plughw:` 默认 false，只有显式 `hw:` 且格式匹配才可能 true。

`TAE_GetEngineCapabilities` 暴露 `backends` / `backendCapabilities`、`pcmPassthrough`、`outputPerfectRequiresPcmPassthrough`、`htmlAudioFallbackDefault` 和 DSD 能力模型。`TAE_GetLastError` 使用 buffer/required-size 模式返回稳定 JSON。

## Electron 集成

Electron 默认走 native engine。`src/main/audioEngineManager.ts` 会从开发构建目录、`resources/audio-engine` 和 packaged resources 查找 `twilight_audio_node.node`。

HTMLAudio 不再静默兜底；只有设置环境变量时才允许临时 Renderer 播放通道：

```powershell
$env:TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK="1"
```

未启用该变量时，native 播放失败会向 Renderer 返回明确错误原因。

## 当前非闭环范围

- ASIO SDK 不入仓库；没有 SDK 时构建必须成功，并通过 capabilities/后端枚举报告不可用。
- 真实设备 smoke 是 opt-in；没有 SDK、目标平台工具链或对应设备时跳过，不阻塞默认 CI。
- Crossfade 已进入 native float 渲染路径，能对预加载下一首做 overlap mixing，并在启用时稳定报告 `outputPerfect=false` / `perfectReasonCode=crossfade_active`。
- DSF/DFF DSD64/128 可进入 DoP carrier path，并在 UI 中展示 DSD 源到 `DoP carrier` 再到后端实际输出；DoP 是用 PCM carrier 承载 DSD bitstream，不等同于把 DSD 转成 PCM。
- DSF/DFF DSD256/512、DoP 条件不满足，或软件音量、ReplayGain、EQ、Convolver、Crossfeed、Crossfade 等处理启用时走 PCM fallback，并在 UI 中展示 DSD 源到 PCM 输出链路。运行时若从 DoP 回退到 PCM，canonical `outputInfo.isDsd/dsdMode/dsdRate` 会清成当前 PCM 状态，顶层 `PlaybackInfo` 只做同值镜像。
- Native DSD 首版只承诺 ASIO；只有运行态 facts 证明为 `proven` 时才声明 `dsdMode=native`、`sourceExact=true` 和 `outputPerfect=true`，否则按 DoP、PCM 顺序回退。
- SACD ISO 首版支持未压缩 DSD area 的曲目切片播放，并进入与 DSF/DFF 相同的 Native DSD -> DoP -> PCM 决策链；DST 压缩曲目只接受 DSD-preserving provider。当前 provider 不可用时返回 `dst_dsd_provider_unavailable`，不把 FFmpeg PCM DST decode 伪装成 Native DSD/DoP。
- Metadata 默认测试覆盖空 source、缺失文件 shape、generated DSF DSD64/128/256 和 SACD ISO `isoTracks`。FFmpeg decoder 默认测试通过生成 WAV/DSF fixture 覆盖 PCM/DSD shape；如设置 `TAE_AUDIO_FIXTURE_MANIFEST`，会读取外部 JSON 矩阵；如设置 `TAE_AUDIO_FIXTURES_DIR`，会额外扫描 MP3/FLAC/M4A/OGG/AAC 等真实小样本做 opt-in 解码 smoke，真实样本不作为默认门禁依赖。
- 外部格式矩阵 runner：`npm run smoke:audio-format-matrix -- --manifest "<matrix.json>" --json` 默认执行 metadata/assertion；加 `--playback --backend wasapi-exclusive --device "<device>"` 或 `--backend asio` 可生成真实硬件 playback evidence。
- WASAPI 真实设备 smoke 可用 `npm run smoke:wasapi -- --device "M30" --buffer 256 --expect-bit-perfect --format-matrix` 跑多格式矩阵；矩阵只要求实际匹配格式 bit-perfect，不支持或被协商到其它格式的样本必须给出明确 non-perfect reason。
- macOS/Linux 后端需要对应平台工具链和真实设备 smoke 后才能声明发布级能力。
