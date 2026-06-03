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

当前 `ctest -N` 注册 MinGW 测试目标，`npm run test:audio-engine:mingw` 是 native 闭环验证入口。

## 边界

- C ABI 是稳定边界；新增查询继续使用 buffer/required-size 模式。
- Node-API 是薄桥接，只转发 C ABI、抛出 native 错误、返回 JSON。
- `outputInfo` 是 canonical playback 状态；顶层 `PlaybackInfo` 字段只做兼容镜像，包括 `isDsd`、`dsdMode`、`dsdRate`。
- Native queue 负责 EOF auto-next 和 gapless preload；Electron 只同步 `PlaybackInfo` 并发送用户操作。`crossfadeSeconds` 现在由 native 状态上报并使 `outputPerfect=false`，Renderer 不再在 native 播放时用自己的 crossfade 定时器驱动下一首；真正的 overlap mixing 仍在后续顺序中。
- Electron 默认走 native engine；HTMLAudio 只允许通过 `TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK=1` 显式开启。
- ASIO SDK 不入仓库；缺失时构建通过，并通过 capabilities/后端列表报告不可用。
- 真实设备 smoke 是 opt-in：没有 ASIO SDK、目标平台工具链或真实设备时跳过，不阻塞默认 CI。

## sourceExact / outputPerfect 策略

当前公共契约使用双状态：`sourceExact` 表示源文件级精确，`outputPerfect` 表示 decoded PCM 到后端实际输出期间没有额外处理或格式损伤。后端只上报实际输出格式和能力，最终状态由统一 evaluator 计算。

`outputPerfect=true` 要求 backend capability、decoded PCM 与实际输出的采样率/位深/声道/sample format 完全匹配、无 resample、无 DSP/音量/routing 改变，并且本次播放 `pcmPassthrough=true`。`pcmPassthrough` 由 `AudioPipeline` 用 FFmpeg decoded PCM 与后端 actual output 事实比较得出；后端只上报事实。`sourceExact=true` 还要求源为无损且源格式与输出格式完全一致；MP3/AAC/OGG 等有损源可达成 `outputPerfect=true`，但不会达成 `sourceExact=true`。

Phase 6B 的后端判定边界：

- WASAPI Shared 是系统混音路径，始终以明确 reason 报告 `outputPerfect=false`。
- WASAPI Exclusive 和 ASIO 必须先真实上报 actual sample rate、bit depth、channel、sample format，再由 evaluator 判定；format negotiation 或 exclusive/driver open 失败要给具体 reason。
- CoreAudio 默认路径继续 `outputPerfect=false`；Hog/Exclusive 未实现并验证前不进入 true 判定。
- ALSA `default` / `plughw:` 默认可能经过插件转换，继续 `outputPerfect=false`；只有显式 `hw:` 且 actual format 完全匹配时才允许进入 true 判定。

## DSP 策略

DSP 默认 bypass。ReplayGain、EQ、FIR Convolver、Crossfeed、Crossfade 和软件音量只有在显式配置或用户操作后才影响状态；任一会改变样本或播放连续性的处理启用时，最终 `outputPerfect=false`。

## DSD 策略

Metadata 会识别 DSD 相关字段并报告 DSD64/128/256/512 级别。Renderer 展示优先消费 `outputInfo.isDsd` / `dsdMode` / `dsdRate` 表示当前 runtime 传输状态，顶层字段只做兼容镜像；当 DoP 运行时回退到 PCM 时，canonical mirror 必须清成 `isDsd=false`、`dsdMode='pcm'`、`dsdRate=0`，而源侧 DSD 标签可继续由文件元数据提供。

- DoP carrier：Phase 6D 允许 DSF/DFF DSD64/128 在后端、设备、声道数和实际 PCM carrier 格式满足条件时进入 `dsdMode=dop`；UI 展示 `DoP carrier`，不把它写成 PCM fallback。
- PCM fallback：DSF/DFF DSD256/512、DoP 条件不满足，或软件音量、ReplayGain、EQ、Convolver、Crossfeed、Crossfade 等处理启用时，实际链路回到 DSD 源 -> decoded PCM -> 后端 PCM 输出；UI 需要明确展示 fallback。
- Native DSD：后端直接输出 DSD bitstream；Phase 6D 不实现 Native DSD。
- SACD ISO：Phase 6D 不支持作为可播放容器，只允许识别并报告 `unsupported`，后续再补。

## 后续顺序

1. 收口 WASAPI Exclusive、ASIO、CoreAudio、ALSA 的 actual format、failure reason 与 opt-in smoke。
2. 为更多真实音频 fixture 覆盖 lossy/lossless 的 `sourceExact` 与 `outputPerfect` 组合。
3. 将 Native DSD 与 SACD ISO 放到 DoP carrier path 稳定后继续补齐。
4. 将 crossfade overlap mixing 继续收敛到 native queue，并为真实音频文件补可选 smoke。
5. 在 macOS/Linux 工具链与真实设备 smoke 通过后补平台产物路径和打包检查。
