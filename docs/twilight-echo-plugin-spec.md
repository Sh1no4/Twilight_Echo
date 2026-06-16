# Twilight Echo 插件系统 — 规范与标准

> 配套文档：《Twilight Echo 插件系统分阶段实施计划》（twilight-echo-plugin-plan.md）
> 版本：v0.1 草案（2026-06-10）
> 状态：Phase 0 定稿目标，定稿前所有字段与契约均可调整

## 1. Manifest 标准（`plugin.json`）

每个插件包根目录必须包含 `plugin.json`。

### 1.1 必填字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 反域名风格全局唯一 ID，如 `com.example.bili-source` |
| `name` | string | 显示名称 |
| `version` | string | 插件自身版本，遵循 semver |
| `description` | string | 简短描述 |
| `author` | string | 作者名或组织 |
| `license` | string | SPDX 标识符 |
| `type` | string[] | `provider` \| `tool` \| `ui` \| `theme` \| `dsp`，可组合 |
| `main` | string | JS 轨入口文件（相对包根路径）；DSP 轨改用 `binary` |
| `binary` | object | DSP 轨：按平台声明动态库路径，如 `{ "win32-x64": "...", "darwin-arm64": "...", "linux-x64": "..." }` |
| `engines.twilightEcho` | string | 兼容的宿主版本范围（semver range） |
| `apiVersion` | number | 使用的插件 API 主版本 |
| `permissions` | string[] | 权限声明（见 1.3）。**信任式安装下声明仍为必填**，安装时展示给用户 |

> `main` 与 `binary` 至少其一；`type` 含 `dsp` 时 `binary` 必填。

### 1.2 可选字段

| 字段 | 说明 |
|---|---|
| `contributes` | 声明扩展点贡献：页面、设置项、命令、主题资源 |
| `dependencies` | 可选插件依赖表，形态为 `{ "<pluginId>": "<semver range>" }`，用于启用校验与按依赖序加载 |
| `homepage` / `repository` | 主页与源码仓库 |
| `icon` | 图标路径 |
| `signature` | 预留签名字段（未来收紧安全策略时启用，不破坏格式） |

### 1.3 权限声明枚举（首批）

`network`、`filesystem:read`、`filesystem:write`、`player:control`、`player:observe`、`library:read`、`library:write`、`settings`、`clipboard`、`ui:inject`、`dsp:native`

## 2. 插件包格式

- 一个插件 = 一个目录或一个 zip 包（扩展名 **`.tep`**），根目录含 `plugin.json`。
- 安装位置：用户数据目录下 `plugins/<id>/<version>/`。
- 插件私有数据：`plugin-data/<id>/`，卸载时可选清除。
- 插件日志：`logs/plugins/<id>.log`，每插件独立通道。
- **禁止**插件写入自身目录与私有数据目录以外的应用文件。

## 3. API 版本与兼容性承诺

- 插件 API 独立于应用版本，使用 `apiVersion` 主版本号（1, 2, …）。
- **主版本内只加不改不删**；废弃 API 须先标记 deprecated 并保留至少一个主版本。
- 宿主升级时按 `engines.twilightEcho` 做兼容检查；不兼容插件标记为禁用而非崩溃。
- DSP C ABI 使用独立版本号 `tae_plugin_abi_version`；ABI 结构体只允许尾部追加字段。
- 官方发布纯类型包 `@twilight-echo/plugin-api`（npm），作为 API 的唯一权威 typings。

## 4. JS 插件运行模型

### 4.1 进程模型

- 所有 JS 插件默认运行在独立的插件宿主进程（Electron `utilityProcess`）中，通过 IPC 与主进程 API 网关通信。
- 目的是**崩溃隔离与可观测性**（信任式安装下不承诺安全沙箱）：插件死循环、内存泄漏、崩溃不得拖垮主进程与音频链路。
- UI 插件的渲染部分在 renderer 注入，业务逻辑仍在宿主进程；渲染入口只能拿到受限桥接对象。

### 4.2 生命周期

- `activate(context)`：插件被启用或应用启动时调用。
- `deactivate()`：插件被禁用、卸载或应用退出时调用，须释放全部资源。
- `context` 注入内容：版本化 `twilight` API 句柄、插件私有存储目录路径、设置读写接口、日志器。
- `dependencies` 仅声明宿主内已安装插件之间的依赖关系；宿主不会自动安装或自动启用依赖。依赖缺失、版本不满足、未启用或循环依赖时，依赖方标记为失败并写入插件日志。

### 4.3 API 网关

- 插件**不得**直接 import 宿主内部模块、Electron API 或 Node 内置模块之外的宿主实现细节。
- 宿主能力一律经由 `twilight` API 对象访问；网关层是未来收紧权限的执法点。

### 4.4 扩展点清单（首批）

| 扩展点 | 类型 | 能力 |
|---|---|---|
| `MediaProvider` | provider | 搜索、播放 URL/流、歌词、封面、歌单、登录态（可选实现） |
| 事件总线 | tool | 订阅曲目切换、播放/暂停、进度、队列变更、应用启停 |
| 侧边栏页面 | ui | 插件提供自定义页面渲染入口 |
| PlayerBar 按钮 | ui | 附加操作按钮 |
| 设置页配置区 | ui | 插件自有设置界面 |
| 主题 | theme | CSS 变量包 + 自定义样式表；**仅声明式样式，不执行脚本** |
| DSP 节点 | dsp | 挂入引擎 DSP 链（见第 5 节） |

Phase 3 的受控 UI 注入只渲染宿主批准的 DTO：`sidebarPage`、`playerBarButton`
和 `settingsPanel` 均通过 command 回到插件宿主进程执行业务逻辑，不向插件开放
任意 DOM 权限。主题插件由用户在外观设置中显式选择后生效；宿主一次只应用一个
插件主题，且 stylesheet 必须位于插件包目录内。

### 4.5 多音源数据模型

- 曲目 ID 必须带 provider 前缀（如 `ncm:12345`、`local:<hash>`）。
- 来源标识贯穿播放队列、音乐库与会话持久化。
- 网易云音乐是 Twilight Echo 自带基础 `MediaProvider` 插件：插件 ID 为
  `com.twilightecho.provider.ncm`，provider 前缀固定为 `ncm`，随软件分发并默认启用；
  用户可停用以隔离故障或隐藏在线音源，但不可像第三方插件一样卸载。

## 5. DSP 原生插件 C ABI 标准

### 5.1 接口形态

纯 C 接口，最小集合：

- `tae_plugin_get_info()` — 返回自描述信息（名称、版本、`tae_plugin_abi_version`、参数表）
- `create` / `destroy` — 实例生命周期
- `prepare(sampleRate, channels, format)` — 格式协商与资源准备
- `process(buffers, frames)` — 音频处理回调
- `set_param` / `reset` — 参数与状态控制

### 5.2 实时安全铁律（审核硬性项）

`process()` 内**禁止**：

1. 内存分配/释放
2. 加锁或任何可能阻塞的同步原语
3. 文件 / 网络 IO
4. 异常跨 ABI 边界传播（C++ 实现必须在边界内 catch 全部异常）

### 5.3 宿主侧防护

- 引擎对 `process()` 做耗时监控，连续超出预算自动 bypass 并经 `GetPlaybackInfo()` 诊断字段上报。
- 加载失败 / prepare 失败 / 运行异常一律自动 bypass，不中断播放。
- DSD / passthrough 路径下 DSP 插件自动 bypass（与 `outputPerfect` 语义一致）。
- Phase 4 的 ABI v1 仅支持 float32 interleaved PCM；宿主通过
  `TAE_SetDspPluginChain` 配置链路，通过 `TAE_GetDspPluginStatus` 和
  `PlaybackInfo.outputInfo.nativeDsp` 上报诊断。诊断字段包含加载状态、旁路原因、
  最近错误、处理耗时、超时次数与参数当前值。

### 5.4 参数体系

- 参数以 ID + 类型 + 范围 + 默认值在 `get_info` 中自描述；宿主据此自动生成设置 UI。

### 5.5 风险标注

- DSP 插件与 Twilight Audio Engine 同进程运行；生产宿主由可重启 Audio Engine
  Service 默认承载该引擎，避免原生 DSP 硬崩溃退出 Electron 主进程。`TWILIGHT_AUDIO_SERVICE=0`
  仅作为开发回退开关。管理 UI 必须单独分区并标注崩溃风险与服务重启行为。
- 纯 DSP 插件不启动 JS `utilityProcess`；混合插件的 JS 轨和 DSP 轨分别按各自规则运行。

## 6. 安全底线（信任式安装下的最低要求）

> 当前策略为信任式安装：插件即任意代码执行。以下为不可省略的底线。

1. 安装时强制确认页：展示权限声明、作者、来源，并明确警示"插件拥有与应用相同的权限"。
2. **禁止插件运行时从远程加载并执行代码**——全部可执行代码必须随包分发。此条写入生态规范，并作为官方索引收录条件。
3. 官方索引收录需人工审核 + 开源仓库可溯源；非索引来源安装时给出额外警告。
4. manifest 预留 `signature` 字段，未来可平滑切换到签名校验而不破坏包格式。
5. 架构预留收紧路径：utilityProcess 宿主 + API 网关 + 强制权限声明已就位，未来启用强制权限只需在网关层加闸。

## 7. 质量与生态标准

### 7.1 官方维护义务

- API typings 包（`@twilight-echo/plugin-api`）
- 插件模板仓库（`create-twilight-plugin`，含 lint / test / 打包脚本）
- 每类插件至少一个官方示例

### 7.2 文档标准

- 每个扩展点须具备三件套：**概念说明 + 完整示例 + API 参考**。

### 7.3 宿主 CI 标准

- 插件 API 网关有契约测试，保证版本承诺（第 3 节）不被无意破坏。
- 网易云内置插件作为 Provider API 的回归基准。

### 7.4 官方索引收录标准

1. 开源且仓库可溯源
2. 有 README
3. 权限声明与实际行为一致
4. 通过基本冒烟测试
5. 不含运行时远程代码加载
6. 音源类插件自行承担合规责任；明显侵权源不予收录

### 7.5 Phase 5 本地可发布生态形态

- `@twilight-echo/plugin-api` 是开发者侧权威 typings 包，API v1 类型从这里导出；宿主内部实现可复用自身类型，但不得改变 v1 语义。
- `create-twilight-plugin` 提供 `init` 与 `pack`：模板覆盖 `tool`、`provider`、`ui-tool`、`theme`；`pack` 产物为 `.tep` zip，根目录必须包含 `plugin.json`。
- 官方静态索引为 `plugins.json`，当前 schemaVersion 固定为 `1`。索引 entry 复用 manifest 字段，并增加 `sourceUrl`、`checksumSha256`、`tags`、`verified`。
- 应用内市场默认读取随应用分发的本地索引；开发环境可用 `TWILIGHT_PLUGIN_INDEX_URL` 指向远程 GitHub raw JSON。安装前必须校验 sourceUrl、包大小、sha256 与包内 manifest。
- Phase 5 仍是信任式安装：索引只提高可发现性和完整性校验，不代表运行时权限 enforcement 或恶意代码沙箱。
