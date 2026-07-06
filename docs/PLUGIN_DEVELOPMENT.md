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
  "permissions": ["network", "settings", "ui:inject"]
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
// 注册一个本地侧栏页面——自动渲染 HTML 内容
await context.twilight.ui.register({
  id: 'music-stats',
  kind: 'localSidebarItem',
  title: '音乐统计',
  description: '查看你的听歌统计数据',
  icon: 'pi pi-chart-bar',
  command: 'show-stats',
  renderMode: 'html',
  autoLoad: true
})

// 注册命令处理器
context.twilight.ui.onCommand('show-stats', (args) => {
  return generateStatsHtml()
})

// 注册设置面板
await context.twilight.ui.register({
  id: 'my-settings',
  kind: 'settingsPanel',
  title: '我的音源设置',
  description: '配置 My Music Source',
  icon: 'pi pi-cog',
  command: 'show-settings',
  renderMode: 'html',
  autoLoad: true
})

context.twilight.ui.onCommand('show-settings', (args) => {
  return generateSettingsHtml()
})

// 注册播放器栏按钮（command 模式，不渲染 HTML）
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

### 渲染模式

| 模式 | 说明 | autoLoad 默认值 |
|------|------|-----------------|
| `command`（默认） | 仅执行命令，不渲染内容 | `false` |
| `html` | 命令返回 HTML 字符串，渲染为 iframe | `true` |

---

## 5. HTML 渲染模式

当 `renderMode: 'html'` 时，宿主会：
1. 自动调用注册的 command
2. 将返回的 HTML 字符串渲染到 iframe 中
3. 提供"刷新"按钮重新加载内容

### HTML 内容规范

```javascript
function generateStatsHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 20px; color: #333; }
    .stat-card { background: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .stat-value { font-size: 32px; font-weight: 800; color: #6366f1; }
    .stat-label { font-size: 13px; color: #666; }
  </style>
</head>
<body>
  <h2>🎵 听歌统计</h2>
  <div class="stat-card">
    <div class="stat-value">1,234</div>
    <div class="stat-label">总播放次数</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">56</div>
    <div class="stat-label">独立歌曲数</div>
  </div>
</body>
</html>`
}
```

### iframe 内与宿主通信

iframe 使用 `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`，在 Electron 中 iframe 与父窗口同源，可以通过 `window.parent.api` 访问宿主 API：

```html
<script>
// 在 iframe 内访问宿主 API
async function getPlayerInfo() {
  const api = window.parent?.api
  if (!api) return
  
  // 获取播放信息
  const info = await api.audioEngine.getPlaybackInfo()
  console.log('Current state:', info.state)
  
  // 控制播放
  // api.audioEngine.togglePause()
}
</script>
```

### 刷新机制

- 用户点击"刷新"按钮会重新调用 command
- `autoLoad: true` 时页面打开自动调用
- 插件可以通过返回不同的 HTML 实现动态内容

---

## 6. 主题插件

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

## 7. DSP 插件

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

## 8. 插件上下文 API

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
      onCommand(command: string, handler: (...args) => unknown): () => void
    }
    themes: {
      register(theme: ThemeRegistration): Promise<void>
    }
  }
}
```

### 事件系统

插件可以监听宿主事件：

```javascript
context.twilight.events.on('player:track-changed', (payload) => {
  context.logger.info(`Now playing: ${payload.title}`)
})

context.twilight.events.on('library:changed', () => {
  context.logger.info('Library changed')
})
```

### 设置持久化

每个插件有独立的设置存储空间：

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

## 9. 构建与打包

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

在 `resources/plugin-index/plugins.json` 中添加条目：

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
  "verified": true,
  "tags": ["provider", "ui"]
}
```

---

## 10. 完整示例

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
    command: 'render-stats',
    renderMode: 'html',
    autoLoad: true
  })

  context.twilight.ui.onCommand('render-stats', async () => {
    const info = await context.twilight.player.getPlaybackInfo()
    
    return `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: -apple-system, sans-serif; padding: 24px; color: #1a1a1a; background: #f8fafc; }
  h2 { margin: 0 0 20px; font-size: 24px; }
  .card { background: #fff; border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .value { font-size: 36px; font-weight: 800; color: #6366f1; }
  .label { font-size: 14px; color: #666; margin-top: 4px; }
</style>
</head>
<body>
  <h2>🎵 听歌统计</h2>
  <div class="card">
    <div class="value">${info.state}</div>
    <div class="label">当前播放状态</div>
  </div>
  <div class="card">
    <div class="value">${Math.round(info.position)}s / ${Math.round(info.duration)}s</div>
    <div class="label">播放进度</div>
  </div>
</body>
</html>`
  })

  // 注册设置面板
  await context.twilight.ui.register({
    id: 'my-settings',
    kind: 'settingsPanel',
    title: 'Example 设置',
    description: '配置 Example Music',
    icon: 'pi pi-cog',
    command: 'render-settings',
    renderMode: 'html',
    autoLoad: true
  })

  context.twilight.ui.onCommand('render-settings', async () => {
    const cookie = await context.settings.get('cookie')
    const maskedCookie = cookie ? cookie.slice(0, 20) + '...' : '未设置'
    
    return `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: -apple-system, sans-serif; padding: 24px; color: #1a1a1a; background: #f8fafc; }
  .setting-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #eee; }
  .setting-label { font-weight: 600; }
  .setting-value { color: #666; font-size: 13px; }
</style>
</head>
<body>
  <h2>⚙️ Example 设置</h2>
  <div class="setting-row">
    <span class="setting-label">Cookie 状态</span>
    <span class="setting-value">${maskedCookie}</span>
  </div>
  <div class="setting-row">
    <span class="setting-label">版本</span>
    <span class="setting-value">1.0.0</span>
  </div>
</body>
</html>`
  })
}

export function deactivate() {}
```

---

## 附录：贡献点快速对照表

| 我想... | 使用什么 | 需要的配置 |
|---------|----------|-----------|
| 新增一个音源 | `providers.register()` + `ui` 元数据 | `type: ["provider"]`, `permissions: ["network", "settings"]` |
| 在侧栏添加自定义页面 | `ui.register({ kind: 'localSidebarItem' })` | `type: ["ui"]`, `permissions: ["ui:inject"]` |
| 在设置页添加自定义面板 | `ui.register({ kind: 'settingsPanel' })` | `type: ["ui"]`, `permissions: ["ui:inject"]` |
| 在播放器栏添加按钮 | `ui.register({ kind: 'playerBarButton' })` | `type: ["ui"]`, `permissions: ["ui:inject"]` |
| 注册自定义主题 | `themes.register()` | `type: ["theme"]` |
| 注册原生 DSP | `binary` 声明 | `type: ["dsp"]`, `permissions: ["dsp:native"]` |
| 渲染 HTML 内容 | `renderMode: 'html'` + command 返回 HTML | command 处理器返回 HTML 字符串 |
| 控制播放器 | `context.twilight.player.*` | `permissions: ["player:control"]` |
| 持久化设置 | `context.settings.*` | `permissions: ["settings"]` |
