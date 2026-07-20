# Twilight Echo 插件开发指南

Twilight Echo 的设计理念是：**软件本体除架构外，一切皆可由插件自定义。**

这意味着你不需要修改主程序代码就能：
- 新增一个音源（登录界面、流媒体首页、资料库标签页全部自动生成）
- 在本地侧栏添加自定义页面（音乐统计、最近播放等）
- 在设置页添加自定义设置区块
- 自定义播放器栏按钮
- 注册自定义主题
- 注册原生 DSP 音频处理插件

---

## 目录

1. [插件类型与权限](#1-插件类型与权限)
2. [plugin.json 清单文件](#2-pluginjson-清单文件)
3. [音源插件（Provider）](#3-音源插件provider)
4. [UI 贡献点系统](#4-ui-贡献点系统)
5. [HTML 渲染模式](#5-html-渲染模式)
6. [主题插件](#6-主题插件)
7. [DSP 插件](#7-dsp-插件)
8. [插件上下文 API](#8-插件上下文-api)
9. [构建与打包](#9-构建与打包)
10. [完整示例](#10-完整示例)

---

## 1. 插件类型与权限

### 插件类型 (`type` 字段)

| 类型 | 说明 |
|------|------|
| `provider` | 音源供应商——提供搜索、播放、登录、歌词等能力 |
| `ui` | UI 扩展——注册侧栏页面、设置面板、播放器按钮等 |
| `theme` | 主题——注册 CSS 变量和样式表 |
| `dsp` | 原生 DSP——C++ 编译的原生音频处理插件 |
| `tool` | 工具类——通用工具，可注册 UI 扩展 |

一个插件可以同时声明多个类型，如 `["provider", "ui"]`。

### 权限 (`permissions` 字段)

| 权限 | 说明 |
|------|------|
| `network` | 允许网络请求（fetch、http） |
| `filesystem:read` | 读取文件系统 |
| `filesystem:write` | 写入文件系统 |
| `player:control` | 控制播放器（播放、暂停、上一首、下一首） |
| `player:observe` | 观察播放器状态 |
| `library:read` | 读取音乐库 |
| `library:write` | 修改音乐库 |
| `settings` | 读写插件设置 |
| `clipboard` | 访问剪贴板 |
| `ui:inject` | 注册 UI 扩展点（注册 `sidebarPage`、`localSidebarItem` 等时需要） |
| `dsp:native` | 原生 DSP 处理（仅 `dsp` 类型插件） |

---

## 2. plugin.json 清单文件

```json
{
  "id": "com.example.myplugin",
  "name": "我的音乐源",
  "version": "1.0.0",
  "description": "一个示例音源插件",
  "author": "Px_asen",
  "license": "MIT",
  "type": ["provider", "ui"],
  "main": "index.mjs",
  "engines": { "twilightEcho": ">=1.0.0" },
  "apiVersion": 1,
  "permissions": ["network", "settings", "library:read", "ui:inject"]
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 反域名风格唯一 ID，如 `com.example.myplugin` |
| `name` | 是 | 显示名称 |
| `version` | 是 | 语义化版本号（semver） |
| `description` | 是 | 简短描述 |
| `author` | 是 | 作者 |
| `license` | 是 | 许可证 |
| `type` | 是 | 插件类型数组 |
| `main` | 是* | 入口文件（JS 插件；纯 theme 插件可省略） |
| `binary` | 是* | 原生二进制文件（DSP 插件） |
| `engines.twilightEcho` | 是 | 兼容的宿主版本范围 |
| `apiVersion` | 是 | 插件 API 版本（当前为 `1`） |
| `permissions` | 是 | 权限声明数组 |
| `dependencies` | 否 | 依赖的其他插件 |
| `homepage` | 否 | 主页 URL |
| `repository` | 否 | 代码仓库 URL |
| `icon` | 否 | 图标文件路径（相对路径） |

> *JS 插件声明 `main`；DSP 插件声明 `binary`；纯 theme 插件可用
> `contributes.themes` 声明 CSS 变量/样式表并省略二者。`dsp` 类型必须声明 `binary`。

---

## 3. 音源插件（Provider）

音源插件通过 `context.twilight.providers.register()` 注册。注册时可以声明 **UI 元数据**，宿主会根据这些元数据自动渲染登录卡片、流媒体首页等界面，**无需修改主程序**。

运行时网关会校验 Provider 权限和 ID：

- `providers.register()` 要求插件声明 `network` 权限。
- 声明 `library` capability 时还必须声明 `library:read`。
- `ncm` 和 `local` 是宿主保留的 Provider ID；第三方插件不能注册这些前缀。
- 同一个 Provider ID 同一时间只能由一个插件注册，避免音源前缀被抢占。

### 基本注册

```javascript
export async function activate(context) {
  await context.twilight.providers.register({
    id: 'mysource',
    name: 'My Music Source',
    capabilities: ['search', 'playbackUrl', 'lyrics', 'cover', 'playlist', 'library', 'login'],
    
    // UI 元数据——宿主根据这些信息自动渲染界面
    ui: {
      icon: 'pi pi-music',
      color: '#6366f1',
      description: '我的自定义音源',
      authType: 'qr',
      loginInstructions: '请使用 MyApp 扫码登录',
      qrStatusCodes: {
        waiting: 801,
        scanned: 802,
        expired: 800,
        success: 803
      },
      streamingSections: [
        { id: 'recommend', title: '推荐歌曲', icon: 'pi pi-star', method: 'fetchRecommendSongs' },
        { id: 'new', title: '新歌速递', icon: 'pi pi-bolt', method: 'fetchNewSongs' }
      ],
      streamingLibraryTab: true,
      streamingSearch: true
    },

    // Provider 方法实现
    async searchSongs(keywords, limit, offset) { /* ... */ },
    async getPlaybackUrl(track, options) { /* ... */ },
    async getLyrics(track) { /* ... */ },
    async checkLogin() { /* ... */ },
    async getQrLogin() { /* ... */ },
    async checkQrLogin(key) { /* ... */ },
    async logout() { /* ... */ },
    async fetchUserLibrary(force) { /* ... */ },
    async fetchPlaylistTracks(playlistId, force) { /* ... */ },
    // ... 其他方法
  })

  context.logger.info('My Music Source provider registered')
}

export function deactivate() {
  // 清理资源
}
```

### UI 元数据字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `icon` | `string` | PrimeIcons 图标类名（如 `'pi pi-cloud'`） |
| `color` | `string?` | 品牌色（CSS 颜色，如 `'#c20c0c'`） |
| `description` | `string?` | 简短描述，显示在登录卡片上 |
| `authType` | `'qr' \| 'oauth' \| 'cookie'` | 登录流程类型 |
| `loginInstructions` | `string?` | 等待扫码/授权时的提示文案 |
| `qrStatusCodes` | `object?` | QR/OAuth 状态码映射 |
| `qrStatusCodes.waiting` | `number` | 等待扫码的状态码 |
| `qrStatusCodes.scanned` | `number \| null` | 已扫码状态码（无此状态填 `null`） |
| `qrStatusCodes.expired` | `number` | 过期状态码 |
| `qrStatusCodes.denied` | `number?` | 被拒绝状态码（可选） |
| `qrStatusCodes.success` | `number` | 成功状态码 |
| `showBrowserButton` | `boolean?` | 是否显示"在浏览器中打开"按钮（OAuth 流程） |
| `loginExtraActions` | `Array?` | 额外登录按钮 |
| `loginExtraActions[].label` | `string` | 按钮文字 |
| `loginExtraActions[].icon` | `string` | 按钮图标 |
| `loginExtraActions[].method` | `string` | 点击时调用的 provider 方法名 |
| `streamingSections` | `Array?` | 流媒体首页推荐区块 |
| `streamingSections[].id` | `string` | 区块唯一 ID |
| `streamingSections[].title` | `string` | 区块标题 |
| `streamingSections[].icon` | `string` | 区块图标 |
| `streamingSections[].method` | `string` | 获取数据的 provider 方法名 |
| `streamingLibraryTab` | `boolean?` | 是否在流媒体页显示资料库标签 |
| `streamingSearch` | `boolean?` | 是否在流媒体页显示搜索功能 |

### 登录流程

#### QR 扫码登录（`authType: 'qr'`）

实现以下方法：
- `getQrLogin()` → 返回 `{ key, imageDataUrl?, qrContent? }`
- `checkQrLogin(key)` → 返回 `{ code }`（code 对应 `qrStatusCodes` 中的值）
- `checkLogin()` → 返回 `{ loggedIn, profile }`
- `logout()` → 退出登录

#### OAuth 设备码登录（`authType: 'oauth'`）

与 QR 登录使用相同的接口，但：
- `getQrLogin()` 返回的 `qrContent` 是 OAuth 验证 URL
- 设置 `showBrowserButton: true` 显示"在浏览器中打开"按钮
- `qrStatusCodes.scanned` 设为 `null`（OAuth 流程没有"已扫码"状态）

#### Cookie 登录（`authType: 'cookie'`）

通过 `loginExtraActions` 提供导入 Cookie 的按钮：
```javascript
loginExtraActions: [
  { label: '导入 Cookie', icon: 'pi pi-key', method: 'importCookie' }
]
```

### Provider 能力与方法对照表

| 能力 | 对应方法 |
|------|----------|
| `search` | `searchSongs`, `searchPlaylists`, `searchArtists` |
| `playbackUrl` | `getPlaybackUrl` |
| `lyrics` | `getLyrics` |
| `cover` | （通过 Track 对象的 cover 字段返回） |
| `playlist` | `fetchPlaylistTracks`, `searchPlaylists` |
| `library` | `fetchUserLibrary`, `fetchLikedTracks`, `fetchRecommendSongs` 等 |
| `login` | `checkLogin`, `getQrLogin`, `checkQrLogin`, `logout` 等 |

Provider 返回的 Track 对象可以包含可选 `bpm` 字段，单位为 beats per minute。
该值应为可信元数据中的有限正数；没有可靠 BPM 时请省略该字段。

---

## 4. UI 贡献点系统

插件通过 `context.twilight.ui.register()` 注册 UI 贡献点。所有贡献点自动出现在界面上，**无需修改主程序**。

### 贡献点类型

| 类型 | 说明 | 出现位置 | 需要 command |
|------|------|----------|-------------|
| `sidebarPage` | 侧栏页面 | 侧栏底部 | 是 |
| `localSidebarItem` | 本地侧栏项 | 侧栏（与首页、所有歌曲并列） | 是 |
| `settingsPanel` | 设置面板 | 设置页底部 | 否 |
| `playerBarButton` | 播放器栏按钮 | 底部播放器栏 | 是 |
| `streamingHome` | 流媒体首页内容块 | 流媒体首页 | 否 |

### 注册示例

```javascript
// 注册一个本地侧栏受控页面
await context.twilight.ui.register({
  id: 'music-stats',
  kind: 'localSidebarItem',
  title: '音乐统计',
  description: '查看你的听歌统计数据',
  icon: 'pi pi-chart-bar',
  command: 'show-stats'
})

// 注册命令处理器
context.twilight.ui.onCommand('show-stats', async () => {
  const info = await context.twilight.player.getPlaybackInfo()
  return {
    state: info.state,
    position: info.position,
    duration: info.duration
  }
})

// 注册设置面板
await context.twilight.ui.register({
  id: 'my-settings',
  kind: 'settingsPanel',
  title: '我的音源设置',
  description: '配置 My Music Source',
  icon: 'pi pi-cog',
  command: 'show-settings'
})

context.twilight.ui.onCommand('show-settings', async () => {
  const enabled = await context.settings.get('enabled')
  return { enabled: enabled === true }
})

// 注册播放器栏按钮
await context.twilight.ui.register({
  id: 'quick-action',
  kind: 'playerBarButton',
  title: '快捷操作',
  icon: 'pi pi-bolt',
  command: 'quick-action'
})

context.twilight.ui.onCommand('quick-action', async (args) => {
  // 执行操作，可以调用 player API
  const info = await context.twilight.player.getPlaybackInfo()
  context.logger.info(`Current track: ${JSON.stringify(info)}`)
})
```

### 受控命令结果

- command 可以返回字符串或 JSON 可序列化对象。
- 宿主把结果作为纯文本/结构化数据展示，不解析或执行其中的 HTML。
- 用户点击页面的执行/刷新按钮时，宿主通过短超时 request/response 调用插件命令。
- 插件不得通过 `srcdoc`、`window.parent` 或其他路径访问 renderer DOM/API。
- 旧版 `renderMode: 'html'` 仅作为 API v1 兼容输入保留，宿主会忽略并按 command 模式处理。

---

## 5. 主题插件

纯主题插件是声明式包，不执行 `activate()` 脚本。主题资源写在 `plugin.json`
的 `contributes.themes` 中：

```json
{
  "type": ["theme"],
  "permissions": [],
  "contributes": {
    "themes": [
      {
        "id": "midnight",
        "name": "午夜蓝",
        "description": "深蓝色暗色主题",
        "variables": {
          "--te-bg-base": "#0f172a",
          "--te-bg-card": "#1e1e2e",
          "--te-text-primary": "#fff",
          "--te-text-secondary": "#a0a0b0",
          "--te-primary-500": "#6366f1",
          "--te-primary-rgb": "99, 102, 241"
        },
        "stylesheet": "theme.css"
      }
    ]
  }
}
```

### 变量 vs 样式表

- **`variables`**：CSS 自定义属性，注入到 `:root`，适合简单的颜色/字号定制
- **`stylesheet`**：完整的 CSS 文件路径（相对插件目录），适合复杂的样式覆盖

两者可以同时使用。

---

## 6. DSP 插件

DSP 插件使用 C++ 编译为原生库，通过 `binary` 字段声明。

### plugin.json

```json
{
  "id": "com.example.mydsp",
  "name": "My EQ Plugin",
  "version": "1.0.0",
  "type": ["dsp"],
  "binary": { "win32-x64": "mydsp.dll" },
  "permissions": ["dsp:native"],
  "engines": { "twilightEcho": ">=1.0.0" },
  "apiVersion": 1
}
```

DSP 插件不需要 `main` 入口和 `activate`/`deactivate`。宿主会加载 `binary` 声明的原生库并通过内部的 DSP 链处理音频。

---

## 7. 插件上下文 API

`activate(context)` 接收的 `context` 对象：

```typescript
interface TwilightPluginContext {
  apiVersion: number
  storagePath: string  // 插件数据目录路径
  
  logger: {
    debug(message: string): void
    info(message: string): void
    warn(message: string): void
    error(message: string): void
  }
  
  settings: {
    get(key?: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
  }
  
  twilight: {
    events: {
      on(eventName: string, callback: (payload: unknown) => void): () => void
    }
    player: {
      getPlaybackInfo(): Promise<unknown>
      play(): Promise<void>
      pause(): Promise<void>
      togglePause(): Promise<void>
      stop(): Promise<void>
      next(): Promise<void>
      previous(): Promise<void>
    }
    providers: {
      register(provider: ProviderRegistration): Promise<void>
    }
    ui: {
      register(contribution: UiContribution): Promise<void>
      onCommand(
        command: string,
        handler: (...args: [...unknown[], TwilightUiCommandContext]) => unknown
      ): () => void
    }
  }
}

interface TwilightProviderRequestContext {
  signal: AbortSignal
  idempotencyKey?: string
}

interface TwilightUiCommandContext {
  signal: AbortSignal
}
```

主题不通过运行时 API 注册。请在 `plugin.json` 的 `contributes.themes` 中声明 CSS 变量和包内 stylesheet；主题脚本不会执行。

### RPC 取消、背压与写操作幂等

宿主会在每次 Provider method 和 UI command 的**最后一个参数**追加 request context。旧版
handler 不声明该参数仍可继续运行；新代码应把 `signal` 传给 `fetch` 或其他支持
`AbortSignal` 的异步 API，并在长循环中主动检查 `signal.aborted`。

```javascript
async function likeTrack(trackId, like, request) {
  request?.signal.throwIfAborted()
  await upstreamLike(trackId, like, {
    signal: request?.signal,
    idempotencyKey: request?.idempotencyKey
  })
}

context.twilight.ui.onCommand('refresh-library', async (request) => {
  return refreshLibrary({ signal: request.signal })
})
```

超时、插件停用/卸载、plugin host error/exit 都会触发 cancel；被取消的 handler 即使稍后返回，
结果也会被宿主隔离。默认每插件最多 4 个并发 RPC 和 32 个排队 RPC；连续 3 次失败后 circuit
进入指数退避（1 秒起步，最多 30 秒），因此插件不应在 handler 内自行制造无界重试风暴。

`likeTrack`、`followArtist`、`followUser` 属于写操作。一次逻辑写入失败或 outcome unknown 后，
renderer 会在 5 分钟有界窗口内为相同 target + payload 的显式重试复用 `idempotencyKey`；payload
改变或前一次成功后会生成新 key。插件必须把 key 传到支持幂等的上游，或在自己的持久化层去重。
内置 NCM provider 会在其私有 settings 中保留有界的成功写入记录五分钟，因此 plugin host 重启后
相同 key 不会重放上游写入；取消后的 handler 不得再更新本地 liked/follow 状态。

### 事件系统

插件可以监听宿主事件：

```javascript
context.twilight.events.on('player:track-change', (payload) => {
  context.logger.info(`Now playing: ${payload.title}`)
})

context.twilight.events.on('app:ready', () => {
  context.logger.info('App is ready')
})
```

`player:*` 和兼容的 `audioEngine:*` 事件需要 `player:observe` 权限。
未来 `library:*` 事件需要 `library:read` 权限；未知事件名会被宿主拒绝。

### 设置持久化

每个插件有独立的设置存储空间：

宿主会在写盘时自动加密敏感 key（例如 `cookie`、`token`、`password`、`secret`、`session`），
插件仍然通过同一套 settings API 读取明文值，不需要自行实现本地加密。

```javascript
// 保存设置
await context.settings.set('cookie', 'MUSIC_U=xxx')
await context.settings.set('preferences', { quality: 'lossless', autoDownload: true })

// 读取设置
const cookie = await context.settings.get('cookie')
const prefs = await context.settings.get('preferences')

// 删除设置
await context.settings.delete('cookie')

// 读取全部设置
const all = await context.settings.get()
```

---

## 8. 构建与打包

### 目录结构

```
my-plugin/
├── plugin.json       # 清单文件
├── index.mjs         # JS 插件入口文件（ESM；纯 theme 插件没有该文件）
├── README.md         # 文档（可选）
└── theme.css         # 主题样式表（可选）
```

### 约束

- **仅使用 Node.js 内置模块**——插件在 `utilityProcess.fork()` 中运行，无法使用 npm 包
- 可用内置模块：`fetch`、`crypto`、`http`、`https`、`url`、`path`、`fs`、`vm`、`os`、`querystring` 等
- **入口文件必须是 ESM**（`.mjs`），使用 `export` 导出 `activate` 和 `deactivate`

### 打包为 .tep

`.tep` 文件是 ZIP 压缩包：

`plugin.json` 中的 `main`、`icon`、`binary.*` 一律写成 POSIX `/` 相对路径（例如 `dist/index.mjs`）；宿主和 tooling 会把反斜杠输入 canonicalize 为 `/`，并拒绝 drive、UNC、rooted 或越界路径。索引签名使用 canonical 结果，禁止直接签署平台相关的 `path.normalize()` 输出。

```python
import zipfile, os, hashlib

src_dir = r'D:\path\to\my-plugin'
tep_path = r'D:\path\to\com.example.myplugin-1.0.0.tep'

with zipfile.ZipFile(tep_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for item in sorted(os.listdir(src_dir)):
        if item.endswith('.test.mjs'):
            continue  # 排除测试文件
        full = os.path.join(src_dir, item)
        if os.path.isfile(full):
            zf.write(full, item)

# 计算 SHA256 校验和
with open(tep_path, 'rb') as f:
    checksum = hashlib.sha256(f.read()).hexdigest()
print(f'Checksum: {checksum}')
```

### 更新市场索引

第三方插件条目提交到外部插件仓库 `D:\Twilight-Echo-plugins\plugins.json`；不要把第三方源码、`.tep` 或条目写进应用仓库的 `resources/plugin-index`。作者提交的条目不设置 `verified` 或 `publisherSignature`：

```json
{
  "id": "com.example.myplugin",
  "name": "我的音乐源",
  "version": "1.0.0",
  "description": "一个示例音源插件",
  "author": "Px_asen",
  "license": "MIT",
  "type": ["provider", "ui"],
  "main": "index.mjs",
  "engines": { "twilightEcho": ">=1.0.0" },
  "apiVersion": 1,
  "permissions": ["network", "settings", "ui:inject"],
  "sourceUrl": "packages/com.example.myplugin-1.0.0.tep",
  "checksumSha256": "<上面计算的 SHA256>",
  "tags": ["provider", "ui"]
}
```

人工审核完成后，外部索引发布流程才可设置 `verified: true`，并用受保护的 Ed25519 私钥生成 `publisherSignature`。`verified` 单独只表示“索引声明”；官方徽章还要求固定官方 URL 的 fresh 直连、未过期来源证据和 active trusted key 的有效签名。生产私钥不得进入应用仓库或插件源码仓库。

---

## 9. 完整示例

### 最小音源插件

```javascript
// index.mjs
let contextRef = null

export async function activate(context) {
  contextRef = context

  await context.twilight.providers.register({
    id: 'example',
    name: 'Example Music',
    capabilities: ['search', 'playbackUrl', 'login'],
    ui: {
      icon: 'pi pi-music',
      color: '#6366f1',
      description: '示例音源',
      authType: 'cookie',
      loginExtraActions: [
        { label: '导入 Cookie', icon: 'pi pi-key', method: 'importCookie' }
      ],
      streamingSearch: true,
      streamingLibraryTab: true
    },
    
    async searchSongs(keywords, limit = 30, offset = 0) {
      // 调用你的搜索 API
      const resp = await fetch(`https://api.example.com/search?q=${encodeURIComponent(keywords)}&limit=${limit}&offset=${offset}`)
      const data = await resp.json()
      return {
        items: data.songs.map(song => ({
          id: `example:${song.id}`,
          title: song.name,
          artist: song.artist,
          album: song.album,
          duration: song.duration,
          source: 'example',
          cover: song.coverUrl,
          bpm: typeof song.bpm === 'number' ? song.bpm : undefined
        })),
        total: data.total
      }
    },

    async getPlaybackUrl(track) {
      const songId = track.id.replace('example:', '')
      const resp = await fetch(`https://api.example.com/url?id=${songId}`)
      const data = await resp.json()
      return data.url
    },

    async checkLogin() {
      const cookie = await context.settings.get('cookie')
      if (!cookie) return { loggedIn: false, profile: null }
      // 验证 cookie 有效性
      const resp = await fetch('https://api.example.com/user', {
        headers: { Cookie: cookie }
      })
      const data = await resp.json()
      if (data.code !== 200) return { loggedIn: false, profile: null }
      return {
        loggedIn: true,
        profile: {
          userId: data.profile.userId,
          nickname: data.profile.nickname,
          avatarUrl: data.profile.avatarUrl
        }
      }
    },

    async logout() {
      await context.settings.delete('cookie')
    },

    async importCookie() {
      // 这个方法通过 loginExtraActions 按钮触发
      // 实际实现中可能需要通过 UI 让用户输入
      context.logger.info('Cookie import triggered')
    }
  })

  context.logger.info('Example Music provider registered')
}

export function deactivate() {
  contextRef = null
}
```

### 带自定义页面的插件

```javascript
export async function activate(context) {
  // 注册一个本地侧栏页面——听歌统计
  await context.twilight.ui.register({
    id: 'listening-stats',
    kind: 'localSidebarItem',
    title: '听歌统计',
    description: '查看你的听歌数据',
    icon: 'pi pi-chart-bar',
    command: 'render-stats'
  })

  context.twilight.ui.onCommand('render-stats', async () => {
    const info = await context.twilight.player.getPlaybackInfo()
    
    return {
      title: '听歌统计',
      state: info.state,
      positionSeconds: Math.round(info.position),
      durationSeconds: Math.round(info.duration)
    }
  })

  // 注册设置面板
  await context.twilight.ui.register({
    id: 'my-settings',
    kind: 'settingsPanel',
    title: 'Example 设置',
    description: '配置 Example Music',
    icon: 'pi pi-cog',
    command: 'render-settings'
  })

  context.twilight.ui.onCommand('render-settings', async () => {
    const cookie = await context.settings.get('cookie')
    const maskedCookie = cookie ? cookie.slice(0, 20) + '...' : '未设置'
    
    return {
      cookieStatus: maskedCookie,
      version: '1.0.0'
    }
  })
}

export function deactivate() {}
```

---

## 附录：贡献点快速对照表

| 我想... | 使用什么 | 需要的配置 |
|---------|----------|-----------|
| 新增一个音源 | `providers.register()` + `ui` 元数据 | `type: ["provider"]`, `permissions: ["network", "settings"]`；声明 `library` capability 时加 `library:read` |
| 在侧栏添加自定义页面 | `ui.register({ kind: 'localSidebarItem' })` | `type: ["ui"]`, `permissions: ["ui:inject"]` |
| 在设置页添加自定义面板 | `ui.register({ kind: 'settingsPanel' })` | `type: ["ui"]`, `permissions: ["ui:inject"]` |
| 在播放器栏添加按钮 | `ui.register({ kind: 'playerBarButton' })` | `type: ["ui"]`, `permissions: ["ui:inject"]` |
| 注册自定义主题 | `plugin.json` 的 `contributes.themes` | `type: ["theme"]`，仅声明 CSS 变量/包内 stylesheet |
| 注册原生 DSP | `binary` 声明 | `type: ["dsp"]`, `permissions: ["dsp:native"]` |
| 控制播放器 | `context.twilight.player.*` | `permissions: ["player:control"]` |
| 持久化设置 | `context.settings.*` | `permissions: ["settings"]` |
