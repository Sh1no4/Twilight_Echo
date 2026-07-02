# Twilight Echo 开发者文档

本文档面向 Twilight Echo 的贡献者与二次开发者，汇总技术栈、项目结构、架构、构建与测试命令，帮助你快速进入开发状态。插件系统的完整说明见 [PLUGIN_README.md](./PLUGIN_README.md)，权威契约见 [twilight-echo-plugin-spec.md](./twilight-echo-plugin-spec.md)。

## 1. 技术栈

应用层依赖：

- Electron `^39.2.6`
- Vue `^3.5.25`
- TypeScript `^5.9.3`
- electron-vite `^5.0.0`
- PrimeIcons
- music-metadata
- `@neteasecloudmusicapienhanced/api`

原生音频引擎依赖：

- C++20
- CMake
- vcpkg
- FFmpeg
- Node-API
- WASAPI

前端与主进程由 electron-vite 驱动构建，跨平台打包交给 electron-builder。代码风格由 ESLint 与 Prettier 统一约束。`package.json` 中 `name` 为 `TwilightEcho`，`version` 为 `1.0.0`，许可证为 Apache-2.0。

## 2. 项目结构

仓库主要目录如下，按职责划分：

```text
.
├── src/
│   ├── main/                 Electron 主进程：窗口、IPC、扫描、设置、缓存、NCM、音频引擎管理
│   ├── preload/              暴露给 Renderer 的安全 API
│   └── renderer/             Vue 3 前端界面
├── audio-engine/             C++20 原生音频引擎
│   ├── include/              稳定 C ABI 头文件
│   ├── core/                 引擎生命周期、状态机、AudioPipeline、缓冲区
│   ├── decoder/              FFmpeg 解码层
│   ├── dsp/                  DSP 链、ReplayGain、EQ、卷积、Crossfeed、频谱
│   ├── output/               WASAPI / CoreAudio / ALSA / ASIO 后端
│   ├── devices/              设备枚举与能力模型
│   ├── playlist/             Queue / Playlist、gapless preload
│   ├── metadata/             音频信息、ReplayGain、DSD 状态读取
│   ├── napi/                 Node-API 桥接层
│   └── tests/                原生测试
├── resources/                应用资源与打包资源（audio-engine / plugins / plugin-index）
├── build/                    electron-builder 构建资源与图标
├── patches/                  第三方依赖补丁
├── scripts/                  辅助脚本（MinGW 配置、staging、smoke 等）
├── packages/                 plugin-api typings + create-twilight-plugin 脚手架
└── docs/                     项目文档
```

`packages/` 下有两个可发布工件：`plugin-api`（插件 API v1 的 TypeScript typings）和 `create-twilight-plugin`（插件模板脚手架）。

## 3. 架构

Twilight Echo 是标准的三段式 Electron 应用，分为主进程、preload、renderer。

主进程位于 `src/main/`，负责窗口生命周期、IPC、本地库扫描、设置持久化、缓存、网易云音乐逻辑以及原生音频引擎管理。preload 位于 `src/preload/index.ts`，通过 `contextBridge` 把一组安全 API 暴露给 Renderer。主进程与 Renderer 之间通过 IPC 通信。

插件宿主运行在 Electron `utilityProcess` 中，入口为 `src/main/pluginHost.ts`，与主进程隔离，避免插件崩溃影响核心播放。

原生音频引擎经 `src/main/audioEngineManager.ts` 加载。加载链路为 `twilight_audio_node.node` 调用 `twilight-audio-engine.dll` 的 C ABI，再驱动完整音频管线：

```text
FFmpeg -> DSP Chain -> WASAPI/CoreAudio/ALSA/ASIO
```

`electron.vite.config.ts` 为 main 进程配置了三个构建入口：

- `index`，主进程入口 `src/main/index.ts`
- `pluginHost`，插件宿主入口 `src/main/pluginHost.ts`
- `audioEngineService`，音频引擎服务入口 `src/main/audioEngineService.ts`

三个入口在 dev 与 build 阶段都会被 electron-vite 编译。

通过 `contextBridge` 暴露给 Renderer 的核心方法包括：`Play`、`Pause`、`Stop`、`Seek`、`SetVolume`、`SetOutputDevice`、`SetOutputBackend`、`GetPlaybackInfo`、`GetSpectrumData`。

平台与音频后端的对应关系：Windows 走 WASAPI，macOS 走 CoreAudio，Linux 走 ALSA。需要注意，macOS 与 Linux 的原生引擎验证仍在进行中，目前尚未完成，请勿假设这两条路径已可用。

## 4. 环境准备与开发

安装依赖：

```bash
npm install
```

或使用 pnpm：

```bash
pnpm install
```

`package.json` 没有声明 `engines` 字段，运行时依赖 Electron 自带的 Node 版本，无需单独管理本机 Node。

启动开发环境：

```bash
npm run dev
```

该命令执行 `electron-vite dev`，会同时编译三个 main 入口、preload 与 renderer，并拉起 Electron 窗口。

## 5. 构建 / 测试 / 检查命令

下表按用途分组列出全部相关脚本，均来自 `package.json`。

类型检查：

```bash
npm run typecheck
```

Lint 与格式化：

```bash
npm run lint
npm run format
```

Electron 构建：

```bash
npm run build
```

`build` 会先跑 `npm run typecheck`，再执行 `electron-vite build`。

打包：

```bash
npm run build:unpack
npm run build:win
npm run build:mac
npm run build:linux
```

插件工具链：

```bash
npm run build:plugin-api
npm run test:plugin-tooling
```

应用测试：

```bash
npm run test:plugins
npm run test:audio-manager
npm run test:playback-routing
```

代码风格配置如下。Prettier 位于 `.prettierrc.yaml`，关键项为 `singleQuote: true`、`semi: false`、`printWidth: 100`、`trailingComma: none`。ESLint 采用 flat config，定义在 `eslint.config.mjs`，忽略 `node_modules`、`dist`、`out` 三个目录。

## 6. 原生音频引擎构建（Windows MinGW）

Windows 下原生引擎已验证的工具链矩阵：

- CMake 4.3+
- w64devkit / MinGW GCC
- Ninja
- vcpkg
- FFmpeg `x64-mingw-static`
- Node-API headers

推荐设置以下环境变量：

```powershell
$env:W64DEVKIT_ROOT = "D:\tools\w64devkit"
$env:VCPKG_ROOT = "D:\tools\vcpkg"
$env:VCPKG_DEFAULT_TRIPLET = "x64-mingw-static"
```

MinGW 路径的配置、构建、测试命令：

```bash
npm run configure:audio-engine:mingw
npm run build:audio-engine:mingw
npm run test:audio-engine:mingw
```

默认 CMake 入口（不指定 MinGW preset）：

```bash
npm run configure:audio-engine
npm run build:audio-engine
npm run test:audio-engine
```

构建产物路径：

```text
audio-engine/build/mingw-static/twilight-audio-engine.dll
audio-engine/build/mingw-static/twilight_audio_node.node
```

再次说明，macOS 与 Linux 的原生引擎验证属于后续工作，目前尚未完成。在这两个平台上构建原生引擎属于实验性操作，结果不作保证。

## 7. 测试

JavaScript 测试统一使用 `node --test` 运行，对应脚本包括 `test:plugins`、`test:audio-manager`、`test:playback-routing` 等。例如：

```bash
npm run test:plugins
npm run test:audio-manager
npm run test:playback-routing
```

原生测试使用 CTest，针对 MinGW 构建目录执行：

```bash
ctest --test-dir audio-engine/build/mingw-static
```

等价的 npm 脚本是 `npm run test:audio-engine:mingw`。

开发阶段如果原生引擎不可用，可以开启 HTMLAudio 兜底。该回退默认关闭，需要显式启用：

```powershell
$env:TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK = "1"
```

启用后 Renderer 会用 HTMLAudio 作为播放兜底，仅建议在调试或应急场景使用。

## 8. 打包发布

打包配置在 `electron-builder.yml`。关键设置：

- `asar: true`
- Windows 使用 NSIS 安装器
- macOS 输出 dmg
- Linux 输出 AppImage、snap、deb
- `extraResources` 把 `resources/audio-engine`、`resources/plugins`、`resources/plugin-index` 三个目录复制进应用资源目录

发布前必须确保目标平台的 `twilight-audio-engine` 与 `twilight_audio_node.node` 已经构建完成，并放入对应资源目录，否则打包产物无法加载原生引擎。

打包命令：

```bash
npm run build:unpack
npm run build:win
npm run build:mac
npm run build:linux
```

`build:unpack` 生成未打包的目录形态，便于本地验证；`build:win` / `build:mac` / `build:linux` 分别产出对应平台的安装包。

## 9. 贡献流程

仓库当前没有 `CONTRIBUTING.md`，也没有 PR 模板。在此之前请按以下流程参与贡献：

1. fork 仓库并基于 `main` 创建特性分支。
2. 本地完成开发后依次执行检查：

   ```bash
   npm run typecheck
   npm run lint
   npm run format
   ```

3. 运行与改动相关的测试，至少包含：

   ```bash
   npm run test:plugins
   npm run test:audio-manager
   npm run test:playback-routing
   ```

   涉及原生引擎的改动还需执行 `npm run test:audio-engine:mingw`。

4. 全部通过后提交并发起 PR，在描述中说明改动范围与验证结果。

更多背景请参阅 [`../README.md`](../README.md)。插件相关开发指南见 [PLUGIN_README.md](./PLUGIN_README.md)，插件规范见 [`./twilight-echo-plugin-spec.md`](./twilight-echo-plugin-spec.md)。项目采用 Apache License 2.0 开源，详见 [`../LICENSE`](../LICENSE)。

Windows 发布前的最小门禁见 [windows-release-gate.md](./windows-release-gate.md)。
