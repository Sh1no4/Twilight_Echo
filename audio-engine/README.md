# Twilight Audio Engine

Twilight Echo 的 C++20 原生音频引擎，通过稳定 C ABI 和 Node-API 桥接给 Electron 使用。API 字段、outputPerfect 判定和 Recovery diagnostics 见 [docs/audio-engine-api.md](../docs/audio-engine-api.md)，阶段与架构约束见 [docs/twilight-audio-engine-architecture.md](../docs/twilight-audio-engine-architecture.md)。

## 当前状态

当前仓库已经包含：

- C ABI：`TAE_Play`、队列、DSP 配置、设备/后端枚举、`TAE_GetPlaybackInfo`、`TAE_GetEngineCapabilities`、`TAE_GetLastError`。
- Node-API：薄桥接到 C ABI，返回 JSON，不承载播放策略。
- 解码与管线：FFmpeg 解码、Float32 内部渲染、环形缓冲、gapless preload、频谱采样。
- Queue：native 侧负责队列索引、upcoming track、EOF auto-next、gapless 预加载和 crossfade 状态判定。
- 后端：WASAPI Shared/Exclusive、ASIO 可选 SDK 接入、CoreAudio/ALSA 源码后端。
- DSP：ReplayGain、Parametric EQ、FIR Convolver、Crossfeed、FFT Spectrum。
- Metadata：container、channel layout、channel count、DSD64/128/256 识别字段、ReplayGain/R128 字段。

Windows MinGW 当前验证结果：

- `npm run configure:audio-engine:mingw`
- `npm run build:audio-engine:mingw`
- `ctest --test-dir audio-engine/build/mingw-static -N` 注册 9 个测试
- `npm run test:audio-engine:mingw` 9/9 通过
- `npm run typecheck`
- `npm run build`

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
- configure 后强制检查 9 个 CTest 目标是否进入 `audio-engine/build/mingw-static`；如果目标缺失，会清理 CMake 配置缓存并重试。

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
- Crossfade 已进入 native 状态和 bit-perfect 判定，但真实 overlap mixing 仍需继续补齐。
- DSF/DFF 当前可识别 DSD64/128/256，并在 UI 中展示 DSD 源到 PCM fallback 或后端 PCM 输出链路；这不是 Native DSD。
- Native DSD、DoP、SACD ISO 尚未实现真实播放闭环。Native DSD 是直接输出 DSD bitstream，DoP 是用 PCM carrier 承载 DSD bitstream，SACD ISO 当前只允许识别并报告 `unsupported`。
- macOS/Linux 后端需要对应平台工具链和真实设备 smoke 后才能声明发布级能力。
