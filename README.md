# Twilight Echo

<img src="./assets/logo.png" style="margin-left:0; width: 35%;" alt="Twilight Echo logo" />
<img src="./assets/icon.svg" style="width: 17%; margin-left: 20px; margin-bottom: 10px;" align="right" alt="Twilight Echo icon" />

## 简介

Twilight Echo 是一款基于 Electron + Vue 3 + TypeScript 的桌面音乐播放器，整合本地音乐库、网易云音乐、沉浸式界面与原生 HiFi 音频输出。无论整理本地收藏，还是聆听在线歌单，都希望带来一段专注、连贯的听歌时光。

## 主要功能

### 本地音乐库

- 扫描本地文件夹并递归导入音频文件。
- 按歌曲、艺术家、专辑、文件夹多种方式整理浏览。
- 自动读取封面、歌词和音频基础信息。
- 音乐库、扫描目录与播放会话会持久保存，下次打开继续上次的进度。
- 启动时按文件路径、大小和修改时间增量核对；需要重建 metadata/封面时，可在设置页显式完整重扫并随时暂停或取消。

### 网易云音乐

- 二维码登录，并自动检查登录状态。
- 首页推荐、每日推荐、私人 FM、私人雷达。
- 搜索歌曲、歌单和艺人。
- 查看“我喜欢的音乐”、个人歌单和艺人热门歌曲。
- 一键收藏或取消收藏歌曲。
- 读取歌词与翻译歌词。

### 播放控制

- 播放、暂停、停止、上一首、下一首。
- 进度跳转与音量调节。
- 顺序播放、单曲循环、随机播放。
- 播放队列切换，会话可恢复。

### HiFi 原生音频

内置自研原生音频引擎，Windows 支持 WASAPI 独占/共享模式，追求高保真输出，用户无需自行配置 mpv。引擎还支持 SACD ISO（含 DST 压缩曲目，通过 DSD-preserving provider 还原原始 DSD 字节）、DoP（DSD64/128/256/512，遵循 dCS DoP open standard v1.1）、Linux ALSA `hw:` 设备的 native DSD 直送，以及独立的示波器可视化视图。WASAPI 与 CoreAudio 没有 native DSD 通道，属平台限制，这两个后端走 DoP 或 PCM。

## 支持的音频格式

```text
.mp3 .flac .wav .wave .aac .ogg .wma .m4a .mp4 .aiff .aif
.opus .webm .alac .ape .wv .dsf .dff .mqa
```

实际播放能力取决于平台与解码器；Windows 平台验证最完整，其他格式随平台测试逐步补齐。  
`.mqa` 按 FLAC 兼容容器扫描与解码，**不宣称** MQA 认证 unfold。

## 平台支持

- Windows：原生音频引擎最完善，支持 WASAPI。
- macOS：走 CoreAudio，原生引擎仍在验证中。
- Linux：走 ALSA，原生引擎仍在验证中。

macOS 与 Linux 用户暂时可能遇到部分输出能力受限，后续会随平台测试逐步开放。

## 安装与运行

### 发布渠道

- Windows：正式发布 NSIS 安装包。
- macOS：仅在完成平台工具链和真实设备验证后发布 .dmg。
- Linux：仅在完成平台工具链和真实设备验证后发布 AppImage / snap / .deb。

### 从源码运行（开发者）

```bash
# 使用 package.json 固定的 pnpm 版本安装依赖和 NCM patch
corepack enable
pnpm install --frozen-lockfile

# 启动开发环境
pnpm run dev
```

完整开发环境说明见 [开发者文档](docs/DEVELOPER_README.md)。

## 已知限制

- macOS 与 Linux 的原生音频引擎仍在验证阶段；即使能打包，也不能宣称为 release-ready。真实设备 smoke 保持 opt-in。
- 网易云音乐相关功能依赖本地启动的 `@neteasecloudmusicapienhanced/api` 服务。
- 共享模式（Shared Mode）会经过系统混音，属正常现象。
- WASAPI 与 CoreAudio 没有 native DSD 通道（平台限制）；DSD 在这两个后端走 DoP 或 PCM fallback。
- 真实硬件 smoke（ASIO / WASAPI Exclusive / CoreAudio Hog / ALSA `hw:` / Native DSD / SACD ISO）为 opt-in，不进入默认门禁。

## 更多文档

- 开发者文档：[docs/DEVELOPER_README.md](docs/DEVELOPER_README.md)
- 插件开发：[docs/PLUGIN_README.md](docs/PLUGIN_README.md)

## License

本项目采用 [Apache License 2.0](./LICENSE) 开源。

第三方依赖、字体、图标、在线服务接口和相关内容素材分别受各自许可证或服务条款约束。若计划二次分发，请额外确认相关资源是否允许对应分发方式。
