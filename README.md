# Twilight Echo

<img src="./assets/logo.png" style="margin-left:0; width: 35%;" alt="Twilight Echo logo" />
<img src="./assets/icon.svg" style="width: 17%; margin-left: 20px; margin-bottom: 10px;" align="right" alt="Twilight Echo icon" />

Twilight Echo 是一个基于 `Electron + Vue 3 + TypeScript` 构建的桌面音乐播放器，面向同时重视界面体验、流媒体能力与音频输出质量的使用场景。

它当前已经具备本地音乐库管理、网易云音乐流媒体模式、自研原生音频引擎 `Twilight Audio Engine`、播放记忆恢复、均衡器与缓存管理等能力，目标不是做一个“只能放歌的壳”，而是逐步打磨成一套完整的桌面 Hi-Fi 播放体验。

## 项目定位

- 本地音乐与在线流媒体双模式共存
- 面向桌面端的沉浸式播放体验与视觉设计
- 以 `Twilight Audio Engine` 为核心逐步强化原生音频播放链路
- 保留 Electron 开发效率，同时向更强的音频控制能力扩展

## 核心功能

### 1. 本地音乐库

- 扫描本地文件夹并递归导入音频文件
- 基于元数据自动整理歌曲、艺术家、专辑、文件夹视图
- 自动读取封面、歌词与音频基础信息
- 持久化保存已扫描音乐库与扫描目录记录

### 2. 网易云音乐流媒体模式

- 支持二维码登录与登录状态检查
- 支持首页推荐、每日推荐、私人 FM、私人雷达
- 支持在线搜索歌曲、歌单、艺人
- 支持读取“我喜欢的音乐”、个人歌单、艺人热门歌曲
- 支持收藏 / 取消收藏歌曲
- 支持歌词与翻译歌词获取

### 3. 播放与队列控制

- 播放 / 暂停、上一首 / 下一首、进度拖动、音量控制
- 顺序播放、单曲循环、随机播放
- 支持播放列表队列切换
- 支持播放结束自动续播
- 支持退出前保存播放会话，并在下次启动时恢复曲目或恢复到上次播放位置

### 4. 音频能力

- 使用自研 `Twilight Audio Engine` 作为原生音频播放核心
- 支持本地文件与 HTTP 音频流统一进入播放链路
- 支持音频输出设备切换
- 支持 `WASAPI`、`ASIO`、`CoreAudio`、`ALSA` 输出类型配置入口
- Windows 下支持独占模式能力接入
- 支持 Graphic / Parametric EQ、Preamp、Gapless、Crossfade、ReplayGain 相关设置
- 在原生引擎不可用时保留 renderer `HTMLAudioElement` 兜底播放路径

### 5. 桌面应用体验

- 自定义无边框标题栏
- 托盘最小化 / 关闭到托盘
- 全局快捷键控制播放
- 可配置缓存目录
- 支持主题、模糊效果、封面取色、歌词字号等外观设置

## 技术栈

- `Electron`
- `Vue 3`
- `TypeScript`
- `Vite` / `electron-vite`
- `PrimeIcons`
- `music-metadata`
- `@neteasecloudmusicapienhanced/api`
- `CMake`
- `FFmpeg`
- `Twilight Audio Engine`（C++20）

## 当前支持的音频格式

项目当前在扫描与读取阶段支持以下主流格式：

```text
.mp3 .flac .wav .wave .aac .ogg .wma .m4a .mp4 .aiff .aif
.opus .webm .alac .ape .wv .dsf .dff .mqa
```

说明：

- 本地库扫描是否识别，取决于主进程扫描规则
- 实际播放效果还会受到 `Twilight Audio Engine` 当前后端实现与目标平台能力影响

## 快速开始

### 环境要求

- `Node.js` 18 及以上
- `npm` 或 `pnpm`
- 如需构建原生音频引擎，需额外准备 `CMake` 与对应平台的本地编译环境

### 安装依赖

使用 `npm`：

```bash
npm install
```

或使用 `pnpm`：

```bash
pnpm install
```

### 启动开发环境

```bash
npm run dev
```

启动后会打开 Electron 桌面窗口。

## 常用开发命令

### 前端 / Electron

```bash
# 开发模式
npm run dev

# 类型检查
npm run typecheck

# Lint
npm run lint

# 格式化
npm run format

# 构建应用
npm run build
```

### Twilight Audio Engine

```bash
# 配置默认构建目录
npm run configure:audio-engine

# 使用 vcpkg preset 配置
npm run configure:audio-engine:vcpkg

# 构建原生音频引擎
npm run build:audio-engine

# 运行原生引擎测试
npm run test:audio-engine
```

## 项目结构

```text
.
├─ src/
│  ├─ main/                Electron 主进程，负责窗口、IPC、扫描、设置、缓存与 NCM API 接入
│  ├─ preload/             暴露给 renderer 的安全桥接层
│  └─ renderer/            Vue 3 前端界面
│     └─ src/
│        ├─ components/    页面与核心 UI 组件
│        ├─ stores/        播放、本地库、设置、网易云状态管理
│        ├─ types/         类型定义
│        ├─ utils/         工具函数
│        └─ assets/        样式资源
├─ audio-engine/           Twilight Audio Engine（C++20 原生音频引擎）
├─ resources/              应用图标、SVG、字体等资源
├─ assets/                 README 与品牌资源
├─ build/                  打包相关资源
├─ patches/                第三方依赖补丁
└─ scripts/                辅助脚本
```

## Twilight Audio Engine 说明

`Twilight Audio Engine` 是本项目的原生音频引擎，位于 [audio-engine/README.md](/D:/Twilight_Echo-main/audio-engine/README.md)。

当前仓库中已经包含：

- C ABI 边界定义
- `Node-API` 桥接代码
- `FFmpeg` 解码路径
- 音频队列 / 状态 / DSP / 元数据相关基础设施
- 多平台输出后端接口槽位

当前较完整的原生播放路径集中在 Windows：

- `FFmpegDecoder` 负责本地文件与 HTTP URL 解码
- `AudioPipeline` 负责 PCM 缓冲、播放位置、渲染回调等
- `WasapiSharedBackend` 负责 `WASAPI shared mode` 输出
- `DeviceManager` 负责 Windows 音频设备枚举

需要注意：

- `WASAPI Exclusive`、`ASIO`、`CoreAudio`、`ALSA` 目前在仓库中已有后端入口或类型支持，但不同平台的成熟度并不完全一致
- 在未成功构建或加载原生引擎时，应用会退回到 renderer 层音频播放兜底逻辑
- 如果你准备继续完善原生播放链路，建议优先从 `audio-engine/` 目录与 `src/main/audioEngineManager.ts` 入手

## 缓存与数据存储

应用会在 Electron 用户目录下持久化保存若干数据，例如：

- 本地音乐库数据
- 网易云登录 Cookie
- 播放会话恢复信息
- NCM 音频缓存
- 应用设置与缓存目录

其中缓存目录支持在设置页中调整，主进程会自动维护：

- `renderer-cache`
- `audio-engine-cache`
- `ncm-cache`

## 打包发布

```bash
# 仅构建产物
npm run build

# 生成 unpacked 目录
npm run build:unpack

# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

补充说明：

- 打包配置位于 `electron-builder.yml`
- `postinstall` 会执行 `electron-builder install-app-deps`
- 如果你的发布流程依赖原生音频引擎，请先确认对应平台的引擎产物已经正确构建并可被应用加载

## 已知事项

- 网易云相关能力依赖本地启动的 `@neteasecloudmusicapienhanced/api` 服务
- 某些在线能力需要用户先完成登录后才能正常使用
- 原生音频引擎的不同输出后端在不同平台上的完成度并不完全一致
- Windows 独占模式启用后，其他应用可能无法同时占用相同输出设备
- 部分高质量音频能力是否真正生效，除了界面设置外，还取决于底层后端实现状态

## License

本项目采用 [Apache License 2.0](./LICENSE) 开源。

请注意：

- 本许可证适用于本仓库中由项目作者拥有版权的源码与文档内容
- 第三方依赖、字体、图标、在线服务接口及相关内容素材仍分别受其各自许可证或服务条款约束
- 如你计划二次分发应用，请额外确认所使用第三方资源与在线内容是否允许对应分发方式
