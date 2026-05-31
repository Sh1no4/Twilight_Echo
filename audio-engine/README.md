# Twilight Audio Engine

Twilight Echo 的 C++20 原生音频引擎。

API 字段、BitPerfect 判定、Recovery diagnostics 与后端能力矩阵见 [docs/audio-engine-api.md](../docs/audio-engine-api.md)。

## 构建目标

- `twilight_audio_engine`：共享 C 接口动态库，Windows 输出名为 `twilight-audio-engine.dll`。
- `twilight_audio_node`：可选的 Node-API 桥接模块。启用方式为 `-DTAE_BUILD_NAPI=ON`，并提供 `-DTAE_NODE_INCLUDE_DIR=<Node 或 Electron 头文件路径>`。
- `twilight_audio_tests`：C 接口冒烟测试。

## 当前实现状态

仓库已经包含生产边界：C 接口、构建选项、vcpkg 清单、Node-API 桥接源码、队列和播放状态管线、DSP 状态、设备枚举以及平台输出后端入口。

Windows 原生播放链路已经接入真实音频代码：

- `decoder/FFmpegDecoder.*` 通过解码库打开本地路径和网络地址，读取流信息，支持跳转，并输出内部 Float32 交错 PCM。
- `core/AudioPipeline.*` 管理解码线程、PCM 环形缓冲、渲染回调、播放位置、BitPerfect/DSP 状态和频谱采样。
- `output/wasapi/WasapiSharedBackend.*` 提供系统共享输出，使用事件驱动渲染。
- `output/wasapi/WasapiExclusiveBackend.*` 提供独占输出，使用 `AUDCLNT_SHAREMODE_EXCLUSIVE`、事件驱动、低延迟缓冲和设备格式协商。
- `output/wasapi/WasapiFormatNegotiator.*` 通过 `IAudioClient::IsFormatSupported()` 自动选择设备支持的 16/24/32 位 PCM 与 44.1 kHz 到 384 kHz 采样率。
- `devices/DeviceManager.cpp` 在 Windows 构建中枚举活动输出设备。
- DSD Native/DoP 能力目前仍只在播放状态中保留路由字段，尚未作为本阶段实现范围。

Electron 仍保留临时播放通道，用于原生动态库未构建或原生后端不可用时兜底。目标机器验证 `twilight-audio-engine.dll` 与 `twilight_audio_node.node` 后，可以逐步移除该兜底路径。
