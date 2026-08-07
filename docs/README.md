# Twilight Echo 文档索引

本目录只保留当前项目仍在使用的规范、架构说明、功能契约、操作指南、法律依据，以及被测试或发布流程引用的机器可读证据。

## 开发与架构

- [开发者文档](./DEVELOPER_README.md)
- [音频引擎架构](./twilight-audio-engine-architecture.md)
- [音频引擎 API](./audio-engine-api.md)
- [安全加固边界](./security-hardening.md)

## 音频、设备与发布

- [Windows 发布门禁](./windows-release-gate.md)
- [真实设备音频证据规则](./audio-smoke-evidence.md)
- [VST3 宿主工具链](./vst3-host-toolchain.md)

## 插件与主题

- [插件开发导读](./PLUGIN_README.md)
- [插件系统权威规范](./twilight-echo-plugin-spec.md)
- [主题插件开发](./theme-plugin-authoring.md)

## 本地库与播放功能

- [本地库元数据补全](./local-library-metadata-enrichment.md)
- [本地库移除策略](./local-library-removal-policy.md)
- [本地库排序与筛选](./local-library-sorting-and-filters.md)
- [搜索与跨来源歌曲身份](./search-and-library-identity.md)
- [播放模式](./playback-modes.md)
- [播放队列虚拟化](./playback-queue-virtualization.md)
- [播放列表生命周期](./playlist-lifecycle.md)
- [歌词管理](./lyrics-management.md)
- [CUE 支持](./cue-support.md)
- [标签与重复歌曲检测](./duplicate-detection.md)
- [睡眠定时器与静音](./sleep-timer-and-mute.md)

## 法律与验证证据

- `legal/`：ASIO clean-room 兼容层的来源、决策与互操作规范。
- `audit-evidence/`：测试脚本或发布审查仍引用的机器可读基准证据。

## 文档维护规则

- 不在仓库中保存自动化工作会话的计划、任务拆分、聊天转录、临时检查点或协调状态表。
- 临时实施计划应放在 Issue 或 Pull Request 中，完成后由代码、测试和当前规范承担事实来源。
- 同一主题只保留一个权威规范和必要的使用导读；被替代的草案、路线图和重复指南应删除。
- 真实设备或性能证据只有在脚本、发布门禁或当前说明仍引用时才保留。
