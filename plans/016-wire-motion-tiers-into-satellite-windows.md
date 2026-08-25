# 016 — 让桌面歌词、可视化器、托盘播放器接上动效偏好

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: MEDIUM
- **Category**: 无障碍（AUDIT 第 6 节 Accessibility）
- **Estimated scope**: 6 个文件（`resources/desktop-lyrics.html`、`src/main/integrations/desktopLyrics.ts`、`src/preload/domains/desktopLyricsApi.ts`、`src/preload/index.d.ts`、`resources/audio-visualizer/index.html`、`src/renderer/src/components/AudioVisualizerPanel.vue`），另加托盘播放器 3 处小改；含主进程与 preload 改动

## Problem

主窗口的动效偏好是四档（`system` / `full` / `reduced` / `off`，见 `src/shared/motion.ts:1`），由 `src/renderer/src/app/useMotionPreference.ts:25` 写到 `document.documentElement.dataset.teMotion` 上，`base.css:412-441` 据此降级。

**但 `useMotionPreference` 全仓只有两个调用点**：

```
src/renderer/src/App.vue:363          useMotionPreference(computed(() => settings.value.motionPreference))
src/renderer/src/mini-player/MiniPlayerApp.vue:38   useMotionPreference(motionPreference)
```

也就是主窗口和迷你播放器。另外三个有动效的渲染上下文都漏了，而它们各自的成因不同，修法也不同。

### 三个上下文的实际形态（这一段决定了修法，务必读完）

| 上下文                                           | 是什么                                                                                                                                                             | 能否收到 `data-te-motion`                                                                                                          | 能否命中 OS `@media`                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `resources/desktop-lyrics.html`                  | **真正独立的 BrowserWindow**（`src/main/integrations/desktopLyrics.ts:90` 的 `new BrowserWindow`），不加载渲染进程 bundle，样式全部内联                            | 否，且 `base.css` 根本不在这个文档里                                                                                               | **否 —— 文件内零 `@media (prefers-reduced-motion)`**    |
| `resources/audio-visualizer/index.html`          | **主窗口内的 iframe**（`src/renderer/src/components/AudioVisualizerPanel.vue:67` 返回 `./audio-visualizer/index.html?v=…`，`:380` 处 `<iframe>`），有独立 document | 否（iframe 有自己的 `documentElement`，父窗口的属性不跨文档）                                                                      | **是**（同一台机器的 OS 偏好，`:699` 已有 `@media` 块） |
| `src/renderer/src/tray-player/TrayPlayerApp.vue` | 独立 BrowserWindow，但**加载同一份渲染进程 bundle**（`src/renderer/src/main.ts:56` 按 `windowKind === 'tray-player'` 挂载），所以 `base.css` 在场                  | **否 —— 没有任何代码给它写这个属性**，于是 `html[data-te-motion='reduced'] *` 与 `…='off' *` 都不匹配，`base.css` 的兜底完全不生效 | 是（`TrayPlayerApp.vue:335` 有一条 `@media`）           |

### 1. 桌面歌词：常驻置顶窗口，四档全都管不着

这是三者里最严重的一个 —— 窗口置顶常驻，每行歌词都带位移与缩放，用户把动效关到 `off` 也停不下来。

```css
/* resources/desktop-lyrics.html:286-290 */
.lyric-line {
  transition:
    color 0.3s ease,
    opacity 0.3s ease,
    transform 0.3s ease;
  will-change: transform;
}
```

```css
/* resources/desktop-lyrics.html:56-61 —— 工具栏 hover 显形 */
#toolbar {
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
  transform: translateY(-4px);
}
```

JS 每次换行直接拼 transform，与 CSS 无关，所以**只改 CSS 挡不住它**：

```js
/* resources/desktop-lyrics.html:859-860 */
if (rowOffsetX !== 0) parts.push('translateX(' + rowOffsetX + 'px)')
if (isActive && !isTranslation) parts.push('scale(1.05)')
```

主进程侧也没有对应通道。`src/main/integrations/desktopLyrics.ts` 转发的是 `desktopLyrics:initSettings`（`:60`、`:67`）、`updateTrack`（`:72`、`:226`）、`updateTime`（`:77`、`:236`）、`updateSettings`（`:242`），**没有 `motionPreference`**。

### 2. 可视化器 iframe：OS 那一档已经做对了，缺的是应用内四档

先纠正一个容易误判的点：这个文件的 `@media` 降级**覆盖是完整的**。已逐个核对 `orbit-spin` 的三个宿主（`:314`、`:463`、`:630`）：

```css
/* resources/audio-visualizer/index.html:699-711 —— 现状，已覆盖全部 orbit-spin 宿主 */
@media (prefers-reduced-motion: reduce) {
  .album-orbit-node,
  .album-orbit-tick,
  .album-edge-node,
  .album-edge-tick,
  .control-orbit-node,
  .album-orbit-ring.time-ticks::before,
  .album-track-runner {
    animation: none;
  }
}
```

`:314` 的宿主是 `.album-orbit-node, .album-orbit-tick`，`:463` 的是 `.album-edge-node, .album-edge-tick`，`:630` 的是 `.control-orbit-node` —— **三处全在上面这个列表里**。所以「有两处 orbit-spin 漏了」的说法不成立，不要照那个说法去加选择器。

真正缺的是两件事。一是应用内四档到不了这个 iframe（它有自己的 document）。二是 hover 的缩放无法被按属性降级，因为过渡写成了 `all`：

```css
/* resources/audio-visualizer/index.html:759 */
transition: all 0.2s ease;
```

```css
/* resources/audio-visualizer/index.html:786-789 —— 裸 hover 缩放，无 (hover: hover) 门禁 */
.btn-circle.play-pause:hover {
  background-color: #0b0c0f;
  transform: scale(1.04);
}
```

好消息是通道已经现成：iframe 与宿主之间已有完整的 postMessage 握手 —— iframe 就绪时 `window.parent.postMessage({ kind: 'ready' }, '*')`（`:2442`），宿主在 `AudioVisualizerPanel.vue:234-236` 收 `ready`，之后用 `:56-62` 的 `post()` 下发消息；iframe 侧在 `:2265` 用 `switch (msg.kind)` 分发。**所以这里不需要新增 IPC，只需要多一种 `kind`。**

### 3. 托盘播放器：`base.css` 在场，但属性没人写

```css
/* src/renderer/src/tray-player/TrayPlayerApp.vue:335-339 */
@media (prefers-reduced-motion: reduce) {
  .tray-player {
    transition: none;
  }
}
```

它加载了 `base.css`，却从不调 `useMotionPreference`，所以 `data-te-motion` 属性缺失 —— `html[data-te-motion='reduced'] *` / `…='off' *` 的兜底不匹配，`html[data-te-motion='full']` 的正向按压/悬停反馈同样不匹配。它只有上面这一条 OS 媒体查询接住 OS 那一档。

值得一提的是这个漏接**有反向证据表明是疏忽而非有意**：`src/renderer/src/app/useMotionPreference.test.ts:101-115` 专门为迷你播放器建了「bootstrap + 运行时都收到偏好」的门禁，托盘播放器没有对应用例。

## Target

三个上下文各用最贴合其形态的通路，不强求统一实现。

### 目标一：桌面歌词 —— 新增 IPC 通道 + CSS 降级 + JS 侧跳过位移

主进程照 `src/main/integrations/miniPlayer.ts:174-177` 的既有模式加一个发送函数：

```ts
/* target — 照 miniPlayer.ts:174-177 的形状，加到 src/main/integrations/desktopLyrics.ts */
function sendDesktopLyricsMotionPreference(
  preference = runtime.appSettings.motionPreference
): void {
  const win = runtime.desktopLyricsWindow
  if (!win || win.isDestroyed()) return
  win.webContents.send('desktopLyrics:motionPreference', preference)
}
```

文档侧把解析后的档位写到自己的 `documentElement` 上（与主窗口同名属性，语义一致），CSS 用它降级：

```css
/* target — 加到 resources/desktop-lyrics.html 的 <style> 内 */
html[data-te-motion='reduced'] .lyric-line,
html[data-te-motion='off'] .lyric-line {
  transition:
    color 0.3s ease,
    opacity 0.3s ease;
}

html[data-te-motion='reduced'] #toolbar,
html[data-te-motion='off'] #toolbar {
  transition: opacity 0.25s ease;
  transform: none;
}
```

保留 `color` 与 `opacity`（承载「哪一行在唱」这个信息），去掉 `transform` —— 正是 AUDIT 第 6 节的范式「keep opacity/color, drop movement」。

JS 侧必须同步，否则 CSS 改了也白改：

```js
/* target — resources/desktop-lyrics.html:859-860 附近 */
var motionReduced =
  document.documentElement.getAttribute('data-te-motion') === 'reduced' ||
  document.documentElement.getAttribute('data-te-motion') === 'off'
if (rowOffsetX !== 0 && !motionReduced) parts.push('translateX(' + rowOffsetX + 'px)')
if (isActive && !isTranslation && !motionReduced) parts.push('scale(1.05)')
```

### 目标二：可视化器 iframe —— 复用现有 postMessage，并让 hover 缩放可降级

宿主侧多下发一种 `kind`，iframe 侧写到自己的 `documentElement`：

```js
/* target — iframe 侧，加进 resources/audio-visualizer/index.html:2265 的 switch */
        case 'motion': {
          if (typeof msg.mode === 'string') {
            document.documentElement.setAttribute('data-te-motion', msg.mode)
          }
          break;
        }
```

```css
/* target — resources/audio-visualizer/index.html，把 :759 的 all 收窄 */
transition:
  background-color 0.2s ease,
  border-color 0.2s ease,
  color 0.2s ease;
```

```css
/* target — 给 hover 缩放加指针门禁，并让四档能关掉它 */
@media (hover: hover) and (pointer: fine) {
  .btn-circle.play-pause:hover {
    background-color: #0b0c0f;
    transform: scale(1.04);
  }
}

html[data-te-motion='reduced'] .album-orbit-node,
html[data-te-motion='reduced'] .album-orbit-tick,
html[data-te-motion='reduced'] .album-edge-node,
html[data-te-motion='reduced'] .album-edge-tick,
html[data-te-motion='reduced'] .control-orbit-node,
html[data-te-motion='reduced'] .album-orbit-ring.time-ticks::before,
html[data-te-motion='reduced'] .album-track-runner,
html[data-te-motion='off'] .album-orbit-node,
html[data-te-motion='off'] .album-orbit-tick,
html[data-te-motion='off'] .album-edge-node,
html[data-te-motion='off'] .album-edge-tick,
html[data-te-motion='off'] .control-orbit-node,
html[data-te-motion='off'] .album-orbit-ring.time-ticks::before,
html[data-te-motion='off'] .album-track-runner {
  animation: none;
}
```

选择器清单与 `:699-711` 那个 `@media` 块**逐字相同**，只是换了触发通路 —— 照抄，不要自己重新列。

### 目标三：托盘播放器 —— 补上 `useMotionPreference` 调用与偏好来源

照 `MiniPlayerApp.vue:37-38` 的两行：

```ts
/* target — src/renderer/src/tray-player/TrayPlayerApp.vue */
const motionPreference = ref<MotionPreference>('system')
useMotionPreference(motionPreference)
```

偏好值从既有的 `trayPlayer:getBootstrap`（`src/main/integrations/trayPlayer.ts:193`）带过来，字段照 `miniPlayer.ts:423` 的 `motionPreference: runtime.appSettings.motionPreference` 加一个即可，不需要新开通道。

## Repo conventions to follow

- **属性名与取值** 全仓统一为 `data-te-motion`，取值只有 `'full' | 'reduced' | 'off'` 三种（`system` 是输入档位，`src/shared/motion.ts:10-16` 的 `resolveMotionMode` 会把它解析成 `full` 或 `reduced`，**永远不要把 `'system'` 直接写进属性**）。
- **偏好传递的样板是迷你播放器**，它是全仓唯一做全了的：`MiniPlayerApp.vue:37-38`（调用）、`:323`（运行时更新）、`:338`（bootstrap 初值），主进程侧 `src/main/integrations/miniPlayer.ts:174-177`（发送函数）与 `:423`（bootstrap 字段），preload 侧在 `src/preload/domains/` 下有对应 api 模块。桌面歌词的 preload 模块是 `src/preload/domains/desktopLyricsApi.ts`，它已经有 6 个 `Set<...>` 回调注册器（`:4-11`）与 `bindDesktopLyricsIpcEvents()` 里成对的 `ipcRenderer.on`，**新通道照同一形状加第 7 个**，类型声明加到 `src/preload/index.d.ts:1201` 的 `desktopLyrics: { … }` 里。
- **桌面歌词文档的设置落点是 `applySettings(s)`（`resources/desktop-lyrics.html:800`）**，由 `api.onInitSettings`（`:1198`）与 `onSettingsUpdate`（`:1222`）两处调用。动效偏好不属于 `DesktopLyricsSettings`（那是外观设置），所以**单独走新通道、单独一个 apply 函数**，不要塞进 `applySettings`。
- **这两个 `resources/*.html` 是纯 HTML + 内联 `<style>`，不是 Vue SFC**，所以普通后代选择器就是对的，**不要**写 `:global(...)`（那是 Vue scoped 语法，在纯 CSS 里不合法）。
- iframe 消息的现有形状是 `{ kind: '<name>', ...payload }`，宿主侧发送走 `AudioVisualizerPanel.vue:56-62` 的 `post()`，且**必须等 `iframeReady` 为真**（`:152` 与 `:328`、`:347`、`:367` 都是这个模式，`:209` 的注释说明了原因：早发的消息会被丢弃）。

## Steps

一步一个具体编辑。三个目标彼此独立，可以分开做、分开验证。

### 目标一：桌面歌词（第 1–6 步）

1. **主进程加发送函数。** 打开 `src/main/integrations/desktopLyrics.ts`，照 `src/main/integrations/miniPlayer.ts:174-177` 的形状加一个 `sendDesktopLyricsMotionPreference()`（内容见 Target 目标一）。放在现有那些 `webContents.send` 辅助函数附近。

2. **在窗口就绪时发一次初值。** 同一文件，找到 `:60` 那行 `win.webContents.send('desktopLyrics:initSettings', getEffectiveDesktopLyricsSettings())`，在它**之后**加一行 `sendDesktopLyricsMotionPreference()`。这样窗口一开就有正确档位，不必等用户改设置。

3. **在偏好变化时广播。** 同一文件，参照 `miniPlayer.ts` 里 `sendMiniPlayerMotionPreference` 的调用点，找到应用设置更新后通知各窗口的位置，加一次 `sendDesktopLyricsMotionPreference(next)`。若该文件内没有现成的设置变更钩子，就在导出的初始化函数里注册一个，与迷你播放器同源 —— **不要新建一套设置监听机制**。

4. **preload 加回调注册器。** 打开 `src/preload/domains/desktopLyricsApi.ts`，照 `:4-11` 那 6 个的形状加第 7 个 `const desktopLyricsMotionCallbacks = new Set<(preference: string) => void>()`，并在 `bindDesktopLyricsIpcEvents()` 内照现有 `ipcRenderer.on` 的写法加 `desktopLyrics:motionPreference` 的转发，再在导出的 `desktopLyricsApi` 对象里加 `onMotionPreference(cb)`。

5. **补类型声明。** 打开 `src/preload/index.d.ts`，在 `:1201` 的 `desktopLyrics: {` 块里加 `onMotionPreference: (cb: (preference: MotionPreference) => void) => void`（与该块内其余 `on*` 的写法一致）。

6. **文档侧接收 + CSS 降级 + JS 跳过位移。** 打开 `resources/desktop-lyrics.html`：
   - 在 `<style>` 内加 Target 目标一那两块 `html[data-te-motion=…]` 规则；
   - 在 `:1198` 的 `api.onInitSettings(...)` 附近加 `api.onMotionPreference(function (mode) { document.documentElement.setAttribute('data-te-motion', mode) })`；
   - 按 Target 目标一改 `:859-860` 的 transform 拼接，加 `motionReduced` 判断。

### 目标二：可视化器 iframe（第 7–10 步）

7. **iframe 侧收消息。** 打开 `resources/audio-visualizer/index.html`，在 `:2265` 的 `switch (msg.kind)` 里加 Target 目标二那个 `case 'motion'`。

8. **iframe 侧加四档降级规则。** 同一文件，在 `:699-711` 那个 `@media` 块**之后**加 Target 目标二的 `html[data-te-motion=…]` 选择器块（清单照 `:699-711` 逐字抄）。

9. **收窄 `:759` 的 `all`，给 hover 加门禁。** 同一文件，按 Target 目标二改 `:759` 的 `transition: all 0.2s ease`，并把 `:786-789` 的 `.btn-circle.play-pause:hover` 包进 `@media (hover: hover) and (pointer: fine)`。

10. **宿主侧下发。** 打开 `src/renderer/src/components/AudioVisualizerPanel.vue`，照 `:328` / `:347` / `:367` 的模式加一个 watcher：读主窗口 `document.documentElement.dataset.teMotion`，在 `iframeReady` 为真时 `post({ kind: 'motion', mode })`。同时在 `:234-236` 收到 `ready` 之后补发一次当前值（否则 iframe 重载后会丢档位）。**主窗口的这个属性由 `App.vue:363` 维护，直接读即可，不要再调一次 `useMotionPreference`。**

### 目标三：托盘播放器（第 11–13 步）

11. **bootstrap 加字段。** 打开 `src/main/integrations/trayPlayer.ts`，在 `:193` 的 `trayPlayer:getBootstrap` 返回对象里加 `motionPreference: runtime.appSettings.motionPreference`（照 `miniPlayer.ts:423`）。类型定义在 `TrayPlayerBootstrap`，同步加字段。

12. **组件接上。** 打开 `src/renderer/src/tray-player/TrayPlayerApp.vue`，import `useMotionPreference` 与 `MotionPreference` 类型，加 Target 目标三那两行，并在 `:74-76` 读 bootstrap 的地方把 `motionPreference.value = bootstrap.motionPreference` 补上（照 `MiniPlayerApp.vue:338`）。

13. **收尾核对。** 跑 `grep -rn "data-te-motion" resources/` 应当在两个 HTML 里都有命中；`grep -n "useMotionPreference" src/renderer/src/tray-player/TrayPlayerApp.vue` 应当有命中。

## Boundaries

- **不要动 `resources/audio-visualizer/index.html:699-711` 那个已有的 `@media` 块。** 它是对的、覆盖是完整的（三个 `orbit-spin` 宿主全在内），新增的四档规则是**并行**通路，不是替换。
- **不要给 `resources/remote/index.html` 加任何东西。** 已确认它没有任何动效声明（`transition` / `animation` 零命中），没有可降级的东西。
- **不要动 `resources/desktop-lyrics.html` 的 `applySettings`（`:800`）与 `DesktopLyricsSettings` 类型。** 动效偏好走独立通道与独立 apply，混进外观设置会让主进程那边的 `getEffectiveDesktopLyricsSettings()` 也要跟着改，扩大改动面。
- **不要把 `'system'` 写进 `data-te-motion`。** 主进程发的是原始四档偏好，**解析必须在写属性之前做** —— 桌面歌词是纯 JS 文档、拿不到 `src/shared/motion.ts`，所以要么在主进程侧发送前就解析好（推荐，主进程有 `runtime.appSettings` 也能读 OS 偏好），要么在文档内用 `window.matchMedia('(prefers-reduced-motion: reduce)')` 自行解析。**二选一，在方案执行时明确写进代码注释**。iframe 侧同理，但宿主可以直接读已解析好的 `dataset.teMotion`，最简单。
- **不要改这两个 HTML 的 `<script src=...>` 引用结构。** `desktop-lyrics.html:457` 的 `desktop-lyrics-presentation.js` 与 `audio-visualizer/index.html` 的 `visibility-animation-controller.js` 都有测试钉着（后者被 `src/renderer/src/components/visibilityBudget.test.ts:12-21` 与 `scripts/visibility-animation-controller.test.cjs` 覆盖）。
- **不要碰 `AudioVisualizerPanel.vue:67` 的 URL 拼接**（`?v=${Date.now()}`）与 `:380` 的 iframe 属性。
- **不要在这两个 `resources/*.html` 里写 `:global(...)`**。它们是纯 CSS，`:global()` 是 Vue scoped 专有语法，写进去整条规则失效。
- 若某一步对不上你看到的代码（自 `8e34e01` 起有漂移），**停下来报告，不要即兴发挥** —— 尤其是 preload 的 api 形状与主进程的设置变更钩子。

## Verification

- **Mechanical**：
  - `pnpm run typecheck` —— 本方案改了 preload 类型（`index.d.ts`）、主进程 bootstrap 类型与一个 Vue 组件，类型必须过。
  - `pnpm run lint`
  - `pnpm run test:app` —— 覆盖 `src/renderer/src/app/useMotionPreference.test.ts`（迷你播放器的四环节门禁）与 `src/main/integrations/desktopLyrics.test.ts`。**已核对：`desktopLyrics.test.ts` 目前不涉及动效偏好，新通道不会撞它**；`useMotionPreference.test.ts:101-115` 只断言迷你播放器，托盘的新接线不会让它变红。
  - `pnpm run test:cross-cutting-regressions` —— 含 `src/renderer/src/components/visibilityBudget.test.ts`，它钉住可视化器 iframe 的 `<script src>` 与 `document.hidden` 门禁。确认没碰坏。
  - `pnpm run test:themes` —— 含 `src/renderer/src/components/AudioVisualizerPanel.test.ts`，其 `:488` 断言 `@media (prefers-reduced-motion: reduce)` 存在。**新增四档规则时不要删那个 `@media`**，否则这条会红。
  - `pnpm run build`
- **Feel check（真实渲染，不许用简化替身当证据）**：桌面歌词与托盘播放器都是独立窗口，截图与计算样式都要在真实窗口里取。按 `MEMORY.md` 的「Real render capture recipe」起隔离 profile：
  - `node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `music-library.json` 覆盖成空库（否则 10000 条 stress 库会阻塞渲染约 3 分钟），并预写 `plugin-state.json` 禁用 NCM provider（它的 RPC 要 30s 才超时）。
  - `--user-data-dir=C:/temp/...`（**正斜杠**，反斜杠会被吃掉分隔符导致开一个空 profile），直接跑 `node_modules/electron/dist/electron.exe`，不要走 `pnpm run dev --`。
  - 每个 CDP 调用套 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - **要确认的观察点**：
    - 打开桌面歌词窗口，在主窗口设置里把「界面动效」切到「减少动效」：歌词行的**横向位移与 1.05 缩放消失**，但颜色与透明度变化仍在（能看出哪一行在唱）。切到「关闭动效」同样。切回「完整动效」位移恢复。**这一条是本方案的核心证据 —— 改前无论怎么切都停不下来。**
    - 在桌面歌词窗口上悬停出工具栏：`reduced` / `off` 档下工具栏仍然淡入（不再有 4px 下移）。
    - 用 CDP 对桌面歌词窗口读 `document.documentElement.getAttribute('data-te-motion')`，四档切换时应当分别得到 `full` / `reduced` / `off`，**且永远不是 `system`**。
    - 打开可视化面板，切到「减少动效」：轨道旋转停止。**同时用 OS 偏好（DevTools Rendering 面板的 `prefers-reduced-motion`）单独验一次**，确认原有那条 `@media` 通路没被破坏 —— 两条通路都要能停。
    - 可视化面板的播放按钮 hover：颜色仍变，`reduced` / `off` 档下不再放大。
    - 打开托盘播放器（点托盘图标），在 `full` 档下按控件应当**有**按压反馈（改前没有，因为 `html[data-te-motion='full']` 不匹配），`reduced` / `off` 档下没有。用 CDP 读该窗口的 `data-te-motion` 确认属性已写上。
  - 重载可视化面板（切走再切回），确认 iframe 重新 ready 后档位没丢 —— 这是第 10 步补发那一次的意义。
- **Done when**：
  - `grep -c "data-te-motion" resources/desktop-lyrics.html` ≥ 4（CSS 两块 + JS 读取 + 属性写入）。
  - `grep -c "data-te-motion" resources/audio-visualizer/index.html` ≥ 15（14 个选择器 + 1 处属性写入）。
  - `grep -n "useMotionPreference" src/renderer/src/tray-player/TrayPlayerApp.vue` 有命中。
  - `grep -rn "desktopLyrics:motionPreference" src/main src/preload` 至少 3 处命中（主进程发送、preload 转发、类型声明）。
  - `grep -n "prefers-reduced-motion" resources/audio-visualizer/index.html` **仍有命中**（原 `@media` 通路保留，未被替换）。
  - 桌面歌词在 `reduced` 档下歌词行 transform 为 `none`（CDP 读 `getComputedStyle` 佐证）。
  - 四档切换在三个上下文里都生效，且 `data-te-motion` 从不取值 `system`。
  - `pnpm run lint`、`pnpm run typecheck`、`pnpm run build` 通过，测试失败数不超过 HEAD 基线的 3 条。
