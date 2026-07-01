# Twilight Echo 插件开发 README

> 本文面向想为 Twilight Echo 编写插件的开发者。
> 权威契约是 [`./twilight-echo-plugin-spec.md`](./twilight-echo-plugin-spec.md)，本文是它的人话版导读，不重复其逐字条款，遇到分歧以 spec 为准。
> 本 README 取代早期那份简略的英文版 [`./plugin-developer-guide.md`](./plugin-developer-guide.md)。

## 1. 简介

Twilight Echo 插件是一段随应用加载、通过统一 `twilight` API 句柄访问宿主能力的代码包。它能做很多事：新增一个音源、在侧边栏加一个页面、换一套主题、甚至往音频链路里挂一个原生 DSP 节点。插件让播放器不必把所有功能都塞进主程序。

插件系统当前是**信任式安装**：装上去的插件拥有与应用同等的权限。这不是安全沙箱，而是崩溃隔离加可观测性。这意味着开发者的责任很重，权限声明要诚实，代码要随包分发，不能偷偷拉远程脚本。

完整契约、版本承诺、安全底线全部以 [`./twilight-echo-plugin-spec.md`](./twilight-echo-plugin-spec.md) 为准。配套的实施路线图在 [`./twilight-echo-plugin-plan.md`](./twilight-echo-plugin-plan.md)。

## 2. 插件类型

`type` 字段是一个数组，可以组合多种类型。五个基础类型：

- `provider`：音源插件，实现搜索、播放、歌词、封面、歌单、登录等能力。
- `tool`：工具类插件，挂事件总线，订阅曲目切换、播放暂停、进度、队列变更等。
- `ui`：界面扩展，提供侧边栏页面、播放栏按钮、设置面板。
- `theme`：主题插件，纯 CSS 变量加样式表，不含脚本。
- `dsp`：原生音频处理插件，C ABI，挂进 Twilight Audio Engine 的 DSP 链。

一个插件可以同时是 `["ui", "tool"]` 这种组合；但 `dsp` 轨单独走原生路径，与 JS 轨并行存在。

## 3. .tep 包格式

一个插件包要么是一个目录，要么是一个扩展名为 `.tep` 的 zip 归档。无论哪种形式，根目录都必须有一个 `plugin.json`。

`.tep` 本质就是 zip，`pack` 命令会校验 manifest、确认 `main` 或 `binary` 存在、剔除 `node_modules` 和缓存目录，最后产出根目录带 `plugin.json` 的 zip。解包后宿主按目录结构加载。

JS 插件运行在 Electron 的 `utilityProcess` 里。这是一个独立进程，插件死循环、内存泄漏、崩溃都不会拖垮主进程和音频链路。UI 插件的渲染部分注入到 renderer，但业务逻辑仍在宿主进程，渲染入口只拿到一个受限桥接对象，没有任意 DOM 权限。

## 4. Manifest 字段

`plugin.json` 是插件的身份证。必填字段和可选字段如下，详细说明见 [spec §1](./twilight-echo-plugin-spec.md#1-manifest-标准pluginjson)。

### 4.1 必填字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 反域名风格全局唯一 ID，如 `com.example.bili-source` |
| `name` | string | 显示名称 |
| `version` | string | 插件版本，遵循 semver |
| `description` | string | 简短描述 |
| `author` | string | 作者名或组织 |
| `license` | string | SPDX 标识符 |
| `type` | string[] | 插件类型数组，可组合 |
| `main` | string | JS 轨入口文件，相对包根路径 |
| `binary` | object | DSP 轨按平台声明动态库路径，如 `{ "win32-x64": "...", "darwin-arm64": "...", "linux-x64": "..." }` |
| `engines.twilightEcho` | string | 兼容的宿主版本范围，semver range |
| `apiVersion` | number | 使用的插件 API 主版本号 |
| `permissions` | string[] | 权限声明，安装时展示给用户 |

`main` 与 `binary` 至少填一个。`type` 包含 `dsp` 时 `binary` 必填。

### 4.2 可选字段

| 字段 | 说明 |
|---|---|
| `contributes` | 声明扩展点贡献：页面、设置项、命令、主题资源 |
| `dependencies` | 插件依赖表，形态 `{ "<pluginId>": "<semver range>" }`，仅校验宿主内已安装插件，不自动安装 |
| `homepage` / `repository` | 主页与源码仓库 |
| `icon` | 图标路径 |
| `signature` | 预留签名字段，未来启用签名校验时不破坏包格式 |

### 4.3 具体示例：内置 NCM provider manifest

下面是随应用分发的网易云音乐 provider 的 `plugin.json`，位于 [`../resources/plugins/ncm-provider/plugin.json`](../resources/plugins/ncm-provider/plugin.json)：

```json
{
  "id": "com.twilightecho.provider.ncm",
  "name": "NetEase Cloud Music",
  "version": "1.0.0",
  "description": "Built-in Twilight Echo provider for NetEase Cloud Music.",
  "author": "Twilight Echo",
  "license": "Apache-2.0",
  "type": ["provider"],
  "main": "index.mjs",
  "engines": {
    "twilightEcho": ">=0.20.0"
  },
  "apiVersion": 1,
  "permissions": ["network", "settings", "library:read", "library:write"]
}
```

它声明了 4 个权限：联网、读写设置、读写音乐库。`main` 指向 `index.mjs`，没有 `binary`，因为它是纯 JS provider。`apiVersion` 是 1，对应 `@twilight-echo/plugin-api` 的 v1 typings。

## 5. 权限枚举

声明在 manifest 的 `permissions` 数组里，安装确认页会逐条展示。全部 11 个 token：

| 权限 token | 含义 |
|---|---|
| `network` | 允许发起网络请求 |
| `filesystem:read` | 读文件系统 |
| `filesystem:write` | 写文件系统 |
| `player:control` | 控制播放器（播放、暂停、跳转、队列等） |
| `player:observe` | 观察播放器状态（事件订阅、读取状态） |
| `library:read` | 读音乐库 |
| `library:write` | 写音乐库 |
| `settings` | 读写应用设置 |
| `clipboard` | 访问剪贴板 |
| `ui:inject` | 向 UI 注入扩展点（侧边栏页面、按钮、设置面板） |
| `dsp:native` | 加载并运行原生 DSP 插件 |

权限声明在信任式安装下仍是必填项。当前阶段网关层不做强制 enforcement，但声明必须与实际行为一致，官方索引收录会人工核对。未来收紧策略时，网关层会按这些 token 加闸。

完整权限语义见 [spec §1.3](./twilight-echo-plugin-spec.md#13-权限声明枚举首批)。

## 6. 生命周期

JS 插件实现两个函数：

- `activate(context)`：插件被启用或应用启动时调用。在这里初始化资源、注册事件监听、贡献 UI 扩展点。
- `deactivate()`：插件被禁用、卸载或应用退出时调用。必须释放全部资源，关掉定时器、网络连接、文件句柄、事件订阅。

`context` 注入四样东西：

1. 版本化的 `twilight` API 句柄，这是访问宿主能力的唯一入口。
2. 插件私有存储目录路径。
3. 设置读写接口。
4. 日志器，写到该插件独立的日志通道。

插件**不得**直接 import 宿主内部模块、Electron API 或 Node 内置模块之外的宿主实现细节。所有能力一律走 `twilight` 对象。网关层是未来收紧权限的执法点。

`dependencies` 只声明宿主内已安装插件之间的依赖关系，宿主不会自动安装或自动启用依赖。依赖缺失、版本不满足、未启用或循环依赖时，依赖方标记为失败并写入插件日志。

详细生命周期语义见 [spec §4.2](./twilight-echo-plugin-spec.md#42-生命周期)。

## 7. 宿主 API

`context.twilight` 是 API 网关，按命名空间分组。概览如下，完整签名以 [spec §4](./twilight-echo-plugin-spec.md#4-js-插件运行模型) 和 `@twilight-echo/plugin-api` typings 为准。

| 命名空间 | 能力 |
|---|---|
| `twilight.events` | 事件总线，订阅曲目切换、播放暂停、进度、队列变更、应用启停 |
| `twilight.player` | 播放器控制与状态查询 |
| `twilight.providers` | 注册 provider 能力、查询已注册 provider |
| `twilight.ui` | 注册 UI 扩展点（侧边栏页面、播放栏按钮、设置面板、流媒体/本地侧栏入口） |
| `twilight.themes` | 主题资源声明 |

不要试图绕过网关直接拿宿主内部对象。API 主版本内只加不改不删（见 [spec §3](./twilight-echo-plugin-spec.md#3-api-版本与兼容性承诺)），所以绑在 `twilight` 上的调用是稳的。

## 8. Provider 能力

`provider` 类型插件实现 `MediaProvider` 扩展点。可声明的能力：

- `search`：搜索曲目
- `playbackUrl`：获取播放地址或流
- `lyrics`：歌词与翻译
- `cover`：封面图
- `playlist`：歌单读取
- `library`：用户音乐库（如"我喜欢的音乐"）
- `login`：登录态（可选，如二维码登录）

能力是 **capability-gated** 的：插件声明哪些能力，宿主就只调哪些。不必全实现，按需声明。

曲目 ID 必须带 provider 前缀，如 `ncm:12345`、`local:<hash>`、`bili:<id>`。前缀贯穿播放队列、音乐库与会话持久化，避免不同 provider 之间撞 ID。

内置 NCM provider 的前缀固定是 `ncm`。第三方 provider 用各自 manifest 里约定的前缀。多音源数据模型见 [spec §4.5](./twilight-echo-plugin-spec.md#45-多音源数据模型)。

## 9. UI 扩展点

`ui` 类型插件贡献受控扩展点，均需 `ui:inject` 权限：

- `sidebarPage`：侧边栏自定义页面
- `playerBarButton`：播放栏附加按钮
- `settingsPanel`：设置页配置区
- `localSidebarItem`：本地音乐侧栏入口
- `streamingHome`：流媒体首页入口

这三类都通过 **command 回到插件宿主进程**执行业务逻辑。宿主只渲染它批准的 DTO，不向插件开放任意 DOM 权限。这是 Phase 3 受控 UI 注入的核心设计：渲染在 renderer，逻辑在 utilityProcess，中间是受限桥接。

UI contribution 可声明 `renderMode`：默认 `command` 只执行命令；`html` 表示命令返回 HTML 字符串，由宿主放入受控 iframe 渲染。`autoLoad` 可控制页面打开时是否自动执行 command；`html` 模式默认自动加载。

不要试图在 UI 入口里直接操纵 DOM 或调 Electron renderer API。所有交互走 command 协议回宿主进程，再由宿主决定渲染什么。

扩展点清单见 [spec §4.4](./twilight-echo-plugin-spec.md#44-扩展点清单首批)。

## 10. 主题规则

`theme` 类型插件提供一套 CSS 变量加自定义样式表。规则：

- 样式表必须位于插件包目录内。
- **仅声明式样式，不执行任何脚本**。
- 用户在外观设置中显式选择主题后生效。
- 宿主一次只应用一个插件主题。

主题插件不启动 JS 轨（纯 `theme` 类型时）。它就是个 CSS 资源包，宿主负责把变量和样式表注入到 renderer。

## 11. 脚手架与打包 CLI

`create-twilight-plugin` 是官方脚手架，提供两个子命令：

- `init`：生成插件模板。模板有四种：`tool` / `provider` / `ui-tool` / `theme`。
- `pack`：校验 manifest、检查 `main` 或 `binary`、排除 `node_modules` 和缓存、产出根目录带 `plugin.json` 的 `.tep` zip。

TypeScript typings 来自 `@twilight-echo/plugin-api` 包，这是 API v1 的权威类型来源：

```ts
import type { TwilightPluginContext } from '@twilight-echo/plugin-api'
```

从零到一个可安装运行的插件，完整快速路径：

```bash
npx create-twilight-plugin init my-provider --type provider --id com.example.provider
cd my-provider
npm install
npm run build
npm test
npm run pack
```

跑完这几步，当前目录下会得到一个 `.tep` 文件，可以直接装进应用测试。目标是模板到可安装运行不超过 30 分钟。

## 12. 安装与运行时路径

插件装好后落在哪里，私有数据写到哪里，日志在哪，这三条路径要记牢：

| 用途 | 路径 |
|---|---|
| 插件安装目录 | `userData/plugins/<id>/<version>/` |
| 插件私有数据 | `userData/plugin-data/<id>/` |
| 插件日志 | `userData/logs/plugins/<id>.log` |

`userData` 是 Electron 的用户数据目录。每个插件有独立的日志通道，方便排查。

**禁止**插件写入自身安装目录与私有数据目录以外的应用文件。这是硬性边界。需要持久化就写 `plugin-data/<id>/`，需要缓存就写到自己的目录下，别碰应用其他部分。

包格式与路径规则见 [spec §2](./twilight-echo-plugin-spec.md#2-插件包格式)。

## 13. 动态索引与分发

官方插件市场消费一个远程 `plugins.json` 文件，当前 `schemaVersion` 固定为 `1`。每个 entry 复用 manifest 字段，并额外增加：

| 字段 | 说明 |
|---|---|
| `sourceUrl` | `.tep` 的下载 URL，或相对索引文件的路径 |
| `checksumSha256` | `.tep` 文件的 sha256 校验和 |
| `repository` / `homepage` | 源码仓库与主页 |
| `tags` | 标签，用于搜索和分类 |
| `verified` | 是否经过人工审核，只有审核通过才为 `true` |

默认远程索引是 `https://raw.githubusercontent.com/asenyarzc-cpu/Twilight-Echo-plugins/main/plugins.json`。第三方插件源码和发布 `.tep` 包不放在主仓库；开发和发布时应写入外部插件仓库，由外部仓库生成 `plugins.json`。

`TWILIGHT_PLUGIN_INDEX_URL` 环境变量优先级最高，可指向自托管 HTTPS `plugins.json` 或本机 HTTP 测试索引。远程读取成功后宿主会缓存索引；远程失败时先使用缓存并标记 stale，缓存也不可用时才回退到随应用分发的离线索引 [`../resources/plugin-index/plugins.json`](../resources/plugin-index/plugins.json)。

安装前宿主必须校验：`sourceUrl` 可达、包大小合理、sha256 匹配、包内 `plugin.json` 与索引 entry 字段一致。校验不过就拒绝安装。

索引规则见 [spec §7.5](./twilight-echo-plugin-spec.md#75-phase-5-本地可发布生态形态)。注意 Phase 5 仍是信任式安装，索引只提高可发现性和完整性校验，不代表运行时权限 enforcement 或恶意代码沙箱。

## 14. 外部插件仓库

第三方插件源码、测试、`.tep` 发布包**不进应用主仓库**。它们统一放在独立的外部插件仓库：

- GitHub：`https://github.com/asenyarzc-cpu/Twilight-Echo-plugins/`
- 本地路径：`D:\Twilight-Echo-plugins`

外部仓库的布局：

```text
plugins/<plugin-name>/    # 插件源码
packages/                 # .tep 打包产物
plugins.json              # 索引文件
```

新增第三方插件时，源码放 `plugins/<plugin-name>/`，打包产物放 `packages/`。运行 `npm run index` 会扫描 `packages/*.tep`、读取包根 `plugin.json`、计算 sha256 并写入 `plugins.json`；`npm run validate:index` 用于发布前确认索引未过期。

应用主仓库（`D:\Twilight_Echo-main`）只存：宿主与运行时代码、插件 API typings（`@twilight-echo/plugin-api`）、插件工具链（`create-twilight-plugin`）、内置 NCM provider、随应用分发的静态索引客户端。这是 `AGENTS.md` 明确规定的插件仓库边界，本文严格遵守。

主项目默认通过 GitHub raw `plugins.json` 消费外部仓库，也可通过 `TWILIGHT_PLUGIN_INDEX_URL` 覆盖。边界规则见 [spec §2.1](./twilight-echo-plugin-spec.md#21-插件源码仓库边界)。

## 15. 内置 NCM provider 参考

`com.twilightecho.provider.ncm` 是 Twilight Echo 自带的基础 `MediaProvider` 插件，也是 Provider API 的回归基准。它的关键属性：

- 位置：`resources/plugins/ncm-provider/`
- manifest 字段见 [§4.3](#43-具体示例内置-ncm-provider-manifest)
- provider 前缀：`ncm`
- 随应用分发，默认启用
- 用户可以停用（隔离故障或隐藏在线音源），但**不可像第三方插件一样卸载**

它是应用仓库里唯一的内置 provider 例外。第三方音源插件（如 Bilibili 收藏夹音频）走外部仓库分发，使用同一 Provider API，但不享受内置待遇。详见 `AGENTS.md` 的 Built-In Provider Exception 一节，以及 [spec §4.5](./twilight-echo-plugin-spec.md#45-多音源数据模型)。

## 16. 安全底线

当前是信任式安装，插件即任意代码执行。最低安全要求：

1. **安装确认页强制展示**：权限声明、作者、来源，并明确警示"插件拥有与应用相同的权限"。
2. **禁止运行时远程代码加载**：全部可执行代码必须随包分发。这条写入生态规范，也是官方索引收录的硬性条件。
3. **官方索引收录需人工审核**：开源仓库可溯源、有 README、权限声明与实际行为一致、通过冒烟测试、不含运行时远程代码加载。音源类插件自行承担合规责任，明显侵权源不予收录。
4. **`signature` 字段预留**：未来可平滑切换到签名校验，不破坏包格式。
5. **架构预留收紧路径**：utilityProcess 宿主加 API 网关加强制权限声明已就位，未来启用强制权限只需在网关层加闸。

非官方索引来源安装时会给出额外警告。完整安全底线见 [spec §6](./twilight-echo-plugin-spec.md#6-安全底线信任式安装下的最低要求) 和收录标准 [spec §7.4](./twilight-echo-plugin-spec.md#74-官方索引收录标准)。

## 17. DSP 原生插件（简述）

`dsp` 类型插件不是 JS，是 C ABI 原生动态库。要点：

- 纯 C 接口，最小集合包括 `tae_plugin_get_info()`、`create` / `destroy`、`prepare(sampleRate, channels, format)`、`process(buffers, frames)`、`set_param` / `reset`。
- `tae_plugin_get_info()` 返回的 `tae_plugin_abi_version` 是 DSP ABI 的版本号，独立于 JS `apiVersion`。ABI 结构体只允许尾部追加字段。
- **实时安全铁律**：`process()` 内禁止内存分配/释放、禁止加锁或阻塞同步原语、禁止文件/网络 IO、禁止异常跨 ABI 边界传播。C++ 实现必须在边界内 catch 全部异常。
- 宿主对 `process()` 做耗时监控，连续超预算自动 bypass。加载失败、prepare 失败、运行异常一律自动 bypass，不中断播放。DSD / passthrough 路径下 DSP 插件也自动 bypass。
- 纯 DSP 插件不启动 JS `utilityProcess`。混合插件的 JS 轨和 DSP 轨分别按各自规则运行。
- DSP 插件与 Twilight Audio Engine 同进程运行，生产环境由可重启的 Audio Engine Service 承载，避免原生硬崩溃退出 Electron 主进程。

DSP 是审核最严的插件类型，因为实时音频路径对延迟和稳定性零容忍。完整 C ABI 标准、参数体系、风险标注见 [spec §5](./twilight-echo-plugin-spec.md#5-dsp-原生插件-c-abi-标准)。

## 18. 延伸阅读

- [`./twilight-echo-plugin-spec.md`](./twilight-echo-plugin-spec.md)，插件系统规范与标准（权威契约）
- [`./twilight-echo-plugin-plan.md`](./twilight-echo-plugin-plan.md)，插件系统分阶段实施计划
- [`./DEVELOPER_README.md`](./DEVELOPER_README.md)，应用开发者文档
- [`../README.md`](../README.md)，Twilight Echo 项目主页

写插件前先把 spec 通读一遍，再把内置 NCM provider 的源码翻一遍，基本就能上手。遇到契约层面的疑问，以 spec 为准，不要猜。
