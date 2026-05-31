# Twilight Echo

<img src="./assets/logo.png" style="margin-left:0; width: 35%;" alt="Twilight Echo logo" />
<img src="./assets/icon.svg" style="width: 17%; margin-left: 20px; margin-bottom: 10px;" align="right" alt="Twilight Echo icon" />

Twilight Echo 是一款基于 `Electron + Vue 3 + TypeScript` 的桌面音乐播放器。项目目标不是只做一个能播放音乐的外壳，而是逐步构建一套具备本地音乐库、网易云音乐接入、沉浸式界面和原生 HiFi 音频链路的完整桌面播放体验。

当前重点是自研 `Twilight Audio Engine`：一个独立于 mpv 的 C++20 音频引擎，通过稳定 C ABI 和 Node-API 桥接给 Electron 使用。

## 当前状态

- 桌面端：Electron 主进程、Preload 安全桥、Vue 3 Renderer 已接入。
- 播放通道：Electron 侧保留 HTMLAudio 临时兜底；原生引擎可用时优先走 `twilight_audio_node.node`。
- 原生引擎：Windows MVP 已打通 `FFmpeg -> AudioPipeline -> WASAPI Shared -> Node-API`。
- 构建产物：Windows 下已生成 `twilight-audio-engine.dll` 和 `twilight_audio_node.node`。
- 设备枚举：已支持 WASAPI 设备枚举，设置页可读取统一设备模型。
- 后续重点：WASAPI Exclusive、ASIO、DSP 实处理、gapless/crossfade、CoreAudio/ALSA、DSD Native/DoP。

## 核心功能

### 本地音乐库

- 扫描本地文件夹并递归导入音频文件。
- 基于元数据整理歌曲、艺术家、专辑和文件夹视图。
- 读取封面、歌词和音频基础信息。
- 持久化音乐库、扫描目录和播放会话。

### 网易云音乐

- 支持二维码登录和登录状态检查。
- 支持首页推荐、每日推荐、私人 FM、私人雷达。
- 支持搜索歌曲、歌单和艺人。
- 支持读取“我喜欢的音乐”、个人歌单和艺人热门歌曲。
- 支持收藏 / 取消收藏歌曲。
- 支持歌词和翻译歌词读取。

### 播放控制

- 播放、暂停、停止、上一首、下一首。
- 进度跳转和音量控制。
- 顺序播放、单曲循环、随机播放。
- 播放队列切换和会话恢复。
- 原生引擎不可用时自动回退到 Renderer 层播放。

### HiFi 音频方向

- 自研 `Twilight Audio Engine`，目标替换 mpv。
- 使用 FFmpeg 作为解码层。
- Windows 当前优先 WASAPI Shared，预留 WASAPI Exclusive 和 ASIO。
- 预留 CoreAudio、ALSA、ReplayGain、EQ、FIR Convolver、Resampler、VST3 Host、DSD Native、SACD ISO、Room Correction。
- `GetPlaybackInfo()` 会上报 codec、bit depth、sample rate、bitrate、输出后端、输出设备、输出采样率、输出位深、bit-perfect 状态和 DSP 状态。

## 技术栈

- `Electron`
- `Vue 3`
- `TypeScript`
- `Vite` / `electron-vite`
- `PrimeIcons`
- `music-metadata`
- `@neteasecloudmusicapienhanced/api`
- `C++20`
- `CMake`
- `vcpkg`
- `FFmpeg`
- `Node-API`
- `WASAPI`

## 支持格式

本地库扫描和元数据读取覆盖常见格式：

```text
.mp3 .flac .wav .wave .aac .ogg .wma .m4a .mp4 .aiff .aif
.opus .webm .alac .ape .wv .dsf .dff .mqa
```

原生引擎的实际播放能力取决于当前平台后端和 FFmpeg 构建。Windows MVP 已验证 WAV/PCM 路径，其他格式会随着 FFmpeg 解码和输出链路测试继续补齐。

## 项目结构

```text
.
├── src/
│   ├── main/                 Electron 主进程：窗口、IPC、扫描、设置、缓存、NCM、音频引擎管理
│   ├── preload/              暴露给 Renderer 的安全 API
│   └── renderer/             Vue 3 前端界面
│       └── src/
│           ├── components/   页面和核心 UI 组件
│           ├── stores/       播放、本地库、设置、网易云状态管理
│           ├── types/        类型定义
│           ├── utils/        工具函数
│           └── assets/       前端样式资源
├── audio-engine/             Twilight Audio Engine，C++20 原生音频引擎
│   ├── include/              稳定 C ABI
│   ├── core/                 引擎生命周期、状态机、AudioPipeline、缓冲区
│   ├── decoder/              FFmpeg 解码
│   ├── dsp/                  DSP 链、频谱分析、未来 EQ/卷积/重采样
│   ├── output/               WASAPI/ASIO/CoreAudio/ALSA 后端
│   ├── devices/              设备枚举和能力模型
│   ├── playlist/             Queue/Playlist 预留
│   ├── metadata/             音频信息读取预留
│   ├── napi/                 Node-API 桥接层
│   └── tests/                Native 测试
├── resources/                应用资源和打包资源
├── build/                    electron-builder 资源
├── patches/                  第三方依赖补丁
└── scripts/                  辅助脚本
```

## 快速开始

### 安装依赖

```bash
npm install
```

或使用 pnpm：

```bash
pnpm install
```

### 启动开发环境

```bash
npm run dev
```

### 构建 Electron 应用

```bash
npm run build
```

## Twilight Audio Engine 构建

### Windows 已验证工具链

当前 Windows 原生 MVP 使用以下工具链验证：

- CMake 4.3+
- w64devkit / MinGW GCC
- Ninja
- vcpkg
- FFmpeg `x64-mingw-static`
- Node-API headers

本机推荐环境变量：

```powershell
$env:W64DEVKIT_ROOT="D:\tools\w64devkit"
$env:VCPKG_ROOT="D:\tools\vcpkg"
$env:VCPKG_DEFAULT_TRIPLET="x64-mingw-static"
```

### 配置、构建、测试

```bash
npm run configure:audio-engine:mingw
npm run build:audio-engine:mingw
npm run test:audio-engine:mingw
```

生成的主要产物位于：

```text
audio-engine/build/mingw-static/twilight-audio-engine.dll
audio-engine/build/mingw-static/twilight_audio_node.node
```

### 默认 CMake 入口

```bash
npm run configure:audio-engine
npm run build:audio-engine
npm run test:audio-engine
```

## Electron 集成方式

Electron 主进程通过 `src/main/audioEngineManager.ts` 加载原生桥接模块：

```text
twilight_audio_node.node
        ↓
twilight-audio-engine.dll C ABI
        ↓
TwilightAudioEngine
        ↓
FFmpeg -> DSP Chain -> WASAPI/CoreAudio/ALSA/ASIO
```

对 Renderer 暴露的核心能力包括：

- `Play()`
- `Pause()`
- `Stop()`
- `Seek()`
- `SetVolume()`
- `SetOutputDevice()`
- `SetOutputBackend()`
- `GetPlaybackInfo()`
- `GetSpectrumData()`

当前 dev 模式会优先从 `audio-engine/build/mingw-static`、`audio-engine/build/default`、`resources/audio-engine` 等位置查找 `.node` 文件。

## 常用命令

```bash
# 类型检查
npm run typecheck

# Lint
npm run lint

# 格式化
npm run format

# Electron 构建
npm run build

# Windows native engine
npm run configure:audio-engine:mingw
npm run build:audio-engine:mingw
npm run test:audio-engine:mingw
```

## 打包发布

```bash
# 生成 unpacked 目录
npm run build:unpack

# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

打包配置位于 `electron-builder.yml`。`resources/audio-engine` 会作为额外资源复制到应用资源目录；正式发布前需要确保目标平台的 `twilight-audio-engine` 和 `twilight_audio_node.node` 已经构建并放置到对应资源目录。

## 已知事项

- Windows 当前已验证 WASAPI Shared；Exclusive/ASIO 仍在后续阶段。
- Shared Mode 会经过系统混音格式，`bitPerfect=false` 是符合预期的。
- 启用软件音量、ReplayGain、EQ、卷积或重采样时会标记 `bitPerfect=false`。
- DSD64/128/256 当前优先做识别和状态上报，Native DSD/DoP 将在 Exclusive/ASIO 成熟后实现。
- 网易云相关能力依赖本地启动的 `@neteasecloudmusicapienhanced/api` 服务。
- npm 可能会提示 `.npmrc` 中镜像配置为 unknown project config，这是 npm 新版本的警告，不影响当前构建。

## License

本项目采用 [Apache License 2.0](./LICENSE) 开源。

第三方依赖、字体、图标、在线服务接口和相关内容素材分别受各自许可证或服务条款约束。若计划二次分发，请额外确认相关资源是否允许对应分发方式。
