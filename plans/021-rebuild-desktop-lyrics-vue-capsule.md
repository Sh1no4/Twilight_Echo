# 021 — 桌面歌词全面重构：Vue 卫星窗 + 极简胶囊卡拉OK

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: HIGH（用户主动要求：现有实现「太丑」，整体重构）
- **Category**: 功能重构 / 视觉 / 动效
- **Estimated scope**: 新建 `src/renderer/src/desktop-lyrics/`（约 10 个文件）+ `src/shared/` 3 个新模块；改 `src/renderer/src/main.ts`、`src/main/integrations/desktopLyrics.ts`、`src/preload/domains/desktopLyricsApi.ts`、`src/preload/index.d.ts`、`src/shared/appSettings.ts`、`src/renderer/src/stores/usePlayerStore.ts`、`src/renderer/src/components/settings-page/DesktopLyricsSettingsSection.vue`；删 `resources/desktop-lyrics.html`、`resources/desktop-lyrics-presentation.js`
- **吸收**：plans/016 的桌面歌词部分（本计划落地后，016 中与 `resources/desktop-lyrics.html` 相关的段落作废，016 仅剩 audio-visualizer iframe 一项）

## Problem

当前桌面歌词 = `resources/desktop-lyrics.html`（1283 行裸 HTML + 内联 IIFE JS，无构建、无组件、类型系统外）+ `resources/desktop-lyrics-presentation.js`（118 行，唯一被抽出的纯逻辑）。主进程 `src/main/integrations/desktopLyrics.ts` 负责窗口与 IPC 转发，本身是健康的，**不需要重构**。

丑与难维护的根因：

1. **换行是 `innerHTML=''` 全量重建**（html 里 `renderLines()`），只有单层 opacity/color transition（`:268-279`），无位移、无模糊、无弹簧。每次行切换硬闪。
2. **卡拉OK 是整行一条线性渐变横扫**（`.karaoke-text::after` + `clip-path: inset`），单词节奏不可见；5Hz 的 `updateTime` IPC 脉冲直接写 CSS 变量，视觉上每 200ms 跳一格。
3. **工具栏是一排微型 `<select>`/按钮堆砌**（字体/字号/字重/对齐/颜色/锁定/关闭全塞在右上角一条），无分组、无预设概念。
4. **重复造轮子**：html 内手写了一份 LRC/YRC/NetEase JSON 解析（约 300 行），而渲染进程已有 `lyricSpring.ts`（解析弹簧）、`lyricWordChunks.ts`、`lyricTimeline.ts` 全部用不上。
5. **无主题联动**：配色手填 hex；主窗口已有 `accentColor`（`src/shared/appSettings.ts:196`）与四档动效偏好（`src/shared/motion.ts`），桌面歌词都吃不到（动效偏好问题见 016）。
6. **设置双写**：窗内工具栏与设置页 `DesktopLyricsSettingsSection.vue` 两套编辑路径，均无实时预览。

## 目标与非目标

**目标**

- G1 视觉基线：极简胶囊——常态下无框无底、纯歌词悬浮；hover 才浮现毛玻璃胶囊工具条（含播放控制 ⏮ ▶ ⏭）。
- G2 动效：逐字卡拉OK（渐变扫读 + 词激活弹簧 + 可控发光）；行切换 slide-blur/spring 过渡；60fps 时间插值抹平 5Hz 脉冲。
- G3 自定义：字体 / 颜色（含跟随封面 accentColor）/ 阴影描边发光 / 布局翻译 / 动画档位与强度 / 行为（空闲自动隐藏）+ 预设系统（内置 6 套，可另存、导入导出 JSON）。
- G4 工程：迁为 Vue 卫星窗（`?window=desktop-lyrics`，照 `trayPlayer.ts:128-135` 与 `main.ts` 现有分发模式）；解析/进度逻辑收编进 `src/shared/` 并补测试；设置页重写 + 复用组件做实时预览。

**非目标**

- 不动主进程窗口骨架（位置持久化、`locked`+`setIgnoreMouseEvents` 穿透、`desktopLyrics:toggle/show/hide` 语义全部保留）。
- 不动主窗口播放页歌词（`PlayingLyricLine.vue` 等）。
- 不做竖排歌词、不做窗口边缘拖拽调整大小（列入 Stretch）。

## 视觉设计（默认预设：极简胶囊 + 卡拉OK）

三种存在状态（由根组件 `DesktopLyricsApp.vue` 的 `data-state` 驱动，CSS 按状态降级）：

| 状态      | 形态                                                                                                                                                                                                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **常态**  | 无任何底板边框（`bgOpacity=0` 为默认值），歌词直接悬浮桌面。主行大字 + 可选翻译副行（0.62em、`-40%` 透明度）。歌名信息不显示。                                                                                                                                                                                                                |
| **hover** | 歌词背后浮出毛玻璃胶囊底（`backdrop-filter: blur(16px) saturate(1.4)`、圆角 `999px`、1px `rgba(255,255,255,.18)` 描边）；顶部居中淡入第二颗**工具条胶囊**（进场 `translateY(-6px)→0` + opacity，离场反向，260ms out-quint）。鼠标离开 300ms 后整体回收。左下角小字歌名 `artist - title · 来源` 随底囊一起出现（现有 `#song-info` 语义保留）。 |
| **锁定**  | 窗口 click-through，纯歌词悬浮；悬停原工具条位置时才显示一颗半透明「解锁」胶囊（沿用现有 `tempInteractive`/`setInteractive` 前向机制，`desktopLyrics.ts` 不动）。                                                                                                                                                                             |

**排版规则**

- `layout: 'single'`（默认）：当前行（卡拉OK逐字）+ 翻译副行。
- `layout: 'dual'`：双行交替（现 'netease' 两行位的演进版）——两行固定行位，当前行高亮、另一行预显下一句；行位水平交错 `lineOffset` px（语义保留现有设置）。
- 对齐左/中/右；翻译 `show | hide | only`（新增 only：只显示译文）。
- 超长行：`text-overflow: ellipsis` + 不换行（与现状一致）；字重/字号/行距同现有区间。

**工具条构成**（图标全用仓库已全局加载的 `@phosphor-icons/web/regular`，见 `main.ts:2`）：

`⏮ ▶/⏸ ⏭`（可整组关闭）｜ `预设▾`（内置 6 套 + 自定义，点选即切）｜ `样式`（开 StylePopover）｜ `锁定`｜ `关闭`

样式弹层 StylePopover 分 5 组手风琴：**文字 / 颜色 / 特效 / 动画 / 行为**，滑杆+色板+分段按钮，任何改动即存（走现有 `desktopLyrics:updateSettings` 上屏，主窗口设置页经 `settings:changed` 同步，现链路不变）。窗口尺寸/置顶只在设置页编辑，不进弹层。

**空闲自动隐藏**：暂停超过 `idleSeconds`（默认 8s）或（可选）纯器乐间奏无激活行超时 → 根容器 400ms `opacity→0`，恢复后 1s 内淡回。窗体位置不变，不销毁。

## 动画系统

### 4.1 时间平滑插值器（最关键，解决 5Hz 脉冲卡顿）

新建 `desktop-lyrics/composables/useInterpolatedTime.ts`：

```
收 updateTime(t) → anchor = { t, at: performance.now() }
rAF 每帧: projected = anchor.t + (now - anchor.at)/1000 × rate
  - clamp 上限 anchor.t + 0.35s，防漂
  - 新 anchor 到达：|t - projected| > 0.08s 视为校偏：300ms 指数收敛；
    |差| > 1s 视为 seek：立即跳
playbackState.playing === false → 冻结 projected；恢复时重锚
```

单一 rAF 循环由根组件持有；KaraokeLine 订阅后**只写已缓存 span 的 CSS 变量**（`el.style.setProperty('--word-p', …)`），不触发 Vue 逐帧重渲染。

### 4.2 逐字卡拉OK（KaraokeLine / LyricWord）

- 每词一 `<span>`；唱过部分用 `background: linear-gradient(120deg, highlightStart, highlightEnd)` + `-webkit-background-clip: text`，未唱部分 `color: color`，中间边界用渐变内 8% 羽化段过渡（比现状 clip-path 硬边柔和）。词进度 `p` = 词时长内插值（词时长 = 下一词 time - 本词 time，末词兜底 0.25s，逻辑源自 `presentation.js:calculateLineProgress` 迁出）。
- 词激活瞬间：`scale 1→1.06→1`（纯 transform，用 `lyricSpring.ts` 的解析弹簧参数思想，简化为 220ms cubic-bezier(.2,1,.25,1)）；`wordEffect:'glow'` 时叠加 `text-shadow: 0 0 {glow}px highlightStart`。
- 强调词（词时长 > 1s）：激活后保持 `scale(1.04)` 呼吸直到词结束（`lyricEmphasis.ts` 的判定逻辑可复用其阈值）。
- 无逐字时间的行：整行渐变扫描（现状行为）+ `fade` 激活。

### 4.3 换行过渡（LyricsViewport）

`<Transition mode="out-in">` 包当前行 key=activeIndex：

| 档位 `lineTransition` | 旧行出场 (140ms)                       | 新行入场 (330ms)                                                                     |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `slide-blur`（默认）  | `translateY(-30%) blur(6px) opacity 0` | `translateY(40%) blur(8px) → 0`                                                      |
| `spring`              | 同上加快速                             | 位移走 LYRIC_POS_Y_SPRING 参数（mass .9/damping 13/stiffness 90）由 rAF 写 transform |
| `fade`                | 纯 opacity                             | 纯 opacity                                                                           |
| `none`                | 瞬切                                   | 瞬切                                                                                 |

`dual` 模式不用 out-in：两个行位各一个 Transition，行位交叉换位（交替模式下传 row key）。微幅 overshoot 由参数表唯一来源控制。

### 4.4 动效偏好四档（吸收 plans/016 桌面歌词部分）

- 主进程把 `motionPreference`（原样字符串，不解析）加进 `initSettings` payload。
- 歌词窗 render 侧 `resolveMotionMode(pref, matchMedia('(prefers-reduced-motion: reduce)').matches)`（`src/shared/motion.ts:8`）→ 写 `document.documentElement.dataset.teMotion`。
- `full`:全开；`reduced`:位移/模糊去掉，留 opacity 与渐变扫描；`off`:全部瞬切，卡拉OK 只留整行变色。
- **注意**：016 的 audio-visualizer iframe 部分仍归 016，本计划只吸收桌面歌词 BrowserWindow 部分。

## 自定义功能矩阵与预设系统

### 5.1 可调项

| 组   | 项                                                                                                                                                        | 说明                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 文字 | fontFamily / fontSize(12-80) / fontWeight(300-900) / lineSpacing / autoFit(stretch)                                                                       | 字体源沿用现有 `follow/system/inter/lxgw/sarasa/comic` + `fonts:listInstalled` 本机字体；`resolvedFontFamily` 解析机制不动         |
| 颜色 | colorMode `accent\|custom`；color(未唱) / highlightStart / highlightEnd(渐变止) / translationColor / bgColor / bgOpacity / bgBlur(新增)                   | accent 模式：高亮两端色由主窗口 `accentColor` 派生（start=`accentColor`，end=`color-mix(in srgb, accent 55%, white)`），切歌自动换 |
| 特效 | shadow/shadowColor/shadowBlur（保留）、glow 0-20px（新增，逐词发光）、stroke+strokeColor+strokeWidth（新增，对齐渲染进程 `resolveLyricsTextStroke` 语义） |                                                                                                                                    |
| 布局 | layout `single\|dual`、align 左中右、translation `show\|hide\|only`、lineOffset                                                                           |                                                                                                                                    |
| 动画 | lineTransition 四档、wordEffect `gradient\|glow\|none`、animIntensity 0-100（位移/模糊/发光统一乘算缩放）                                                 |                                                                                                                                    |
| 行为 | autoHide `off\|pause\|pause-and-instrumental`、idleSeconds(2-30)、showMediaControls                                                                       |                                                                                                                                    |
| 窗口 | alwaysOnTop、宽高、锁定（仅设置页/工具条锁钮）                                                                                                            | 沿用现有                                                                                                                           |

### 5.2 预设系统（新建 `src/shared/desktopLyricsPresets.ts`，仿 `lyricsPresets.ts:1-155`）

```ts
interface DesktopLyricsPreset { id; name; builtin: boolean;
  appearance: /* 仅外观子集：字体/颜色/特效/动画/布局翻译，不含窗口位置、锁定、enabled */ }
interface DesktopLyricsPresetConfig { activeId: string; custom: DesktopLyricsPreset[] } // activeId 为标签语义（编辑后不回写），MAX_CUSTOM=20，上限/校验照抄 lyricsPresets
```

内置 6 套（具体值写死在模块里，执行者无需品味判断）：

| id               | 名             | 关键值                                                                                        |
| ---------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `minimal-white`  | 极简白（默认） | color `rgba(255,255,255,.45)`、hi `#ffffff→#dbeafe`、bgOpacity 0、glow 0、slide-blur+gradient |
| `midnight-radio` | 午夜电台       | bg `#0a0f1e`@35% blur16、hi `#67e8f9→#60a5fa`、text `rgba(226,232,240,.55)`                   |
| `honey-pink`     | 蜜糖粉         | hi `#fbcfe8→#f472b6`、shadow `rgba(244,114,182,.35)` 8px                                      |
| `neon-violet`    | 霓虹紫夜       | hi `#e879f9→#a78bfa`、glow 14 `rgba(168,85,247,.45)`、wordEffect glow                         |
| `noir-gold`      | 黑金           | bg `#000`@45%、hi `#fde68a→#f59e0b`、text `rgba(254,243,199,.5)`                              |
| `daylight`       | 日间浅底       | bg `#ffffff`@72%、text `rgba(15,23,42,.55)`、hi `#2563eb→#7c3aed`                             |

- 工具条预设▾：单击切换（写 activePresetId + 整套 appearance 上屏）。
- 样式弹层/设置页：「另存为预设」（名称 ≤48 字符，normalize 照抄 `lyricsPresets.ts:normalizePresetName`）、导出自定义预设为 JSON / 导入 JSON（validation 走 normalize）。

## 设置 Schema v2 与迁移（改 `src/shared/appSettings.ts`）

现 `DesktopLyricsSettings`（`appSettings.ts` 内，字段含 presentation/layout/maxLines/color/highlightColor 等）升级为 v2。读入时 v1 自动迁移，写盘只写 v2。

```ts
export interface DesktopLyricsSettings {
  // 保留原样
  enabled: boolean
  windowWidth: number
  windowHeight: number
  windowX: number
  windowY: number
  alwaysOnTop: boolean
  locked: boolean
  clickThrough: boolean // 兼容读取，归一化进 locked，写盘时可省略
  fontFamily: string // 'follow' 语义不变
  resolvedFontFamily?: string // 主进程注入，不持久选择
  fontSize: number
  fontWeight: number
  lineSpacing: number
  lineOffset: number
  align: LyricAlign
  bgColor: string
  bgOpacity: number
  shadow: boolean
  shadowColor: string
  shadowBlur: number
  // v2 新增
  version: 2
  layout: 'single' | 'dual'
  translation: 'show' | 'hide' | 'only'
  colorMode: 'accent' | 'custom'
  color: string // 未唱文字
  highlightStart: string
  highlightEnd: string
  translationColor: string
  bgBlur: number // 0-32
  glow: number // 0-20
  stroke: boolean
  strokeColor: string
  strokeWidth: number // 0-3
  lineTransition: 'slide-blur' | 'fade' | 'spring' | 'none'
  wordEffect: 'gradient' | 'glow' | 'none'
  animIntensity: number // 0-100
  autoHide: 'off' | 'pause' | 'pause-and-instrumental'
  idleSeconds: number
  showMediaControls: boolean
}
// 预设配置挂到同级：desktopLyrics.presets: DesktopLyricsPresetConfig
```

**v1 → v2 迁移映射**（写进 `normalizeDesktopLyrics`/`migrateDesktopLyricsV1toV2`，主进程 `src/main/core/settings.ts` 归一化出口调用）：

| v1                                              | v2                                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presentation:'netease'`                        | `layout:'single'` + `wordEffect:'gradient'`                                                                                                                                                         |
| `presentation:'classic'` + `layout:'bilingual'` | `layout:'single'` + `wordEffect:'none'`（classic 的逐词只是透明度跳变，语义最接近 none）                                                                                                            |
| `presentation:'classic'` + `layout:'multi'`     | `layout:'dual'`，`lineOffset` 保留                                                                                                                                                                  |
| `showTranslation:false`                         | `translation:'hide'`；true→`'show'`                                                                                                                                                                 |
| `highlightColor`                                | `highlightStart=highlightEnd=highlightColor`（单色=两端同值）                                                                                                                                       |
| `color`                                         | 直接保留；`translationColor := color`（渲染靠 CSS 降透明度区分）                                                                                                                                    |
| `maxLines`                                      | 废弃（dual 固定 2 行位）                                                                                                                                                                            |
| 新增字段                                        | 走默认值：colorMode `'custom'`、bgBlur 16、glow 0、stroke off、lineTransition `'slide-blur'`、wordEffect `'gradient'`、animIntensity 100、autoHide `'pause'`、idleSeconds 8、showMediaControls true |

**发送侧 payload 扩展**（`desktopLyrics.ts:getEffectiveDesktopLyricsSettings` 出口合成，不动持久层）：`{ ...settings, resolvedFontFamily, motionPreference, accentColor }`。后两个字段类型加进 shared 类型为可选，不回写。

## IPC 变更（增量小，主干保留）

保留不动：`initSettings` / `updateTrack` / `updateTime` / `updateSettings` / `toggleChanged` / `loadFailed` / `setInteractive` / `getPosition` / `move` / `requestClose` / `toggle|show|hide` handle。源端发送点（`usePlayerStore.ts:3481/3497`）与 `usePlayerStore.test.ts:163/166/195/199` 的源码正则断言保持兼容。

新增 2 条：

| channel                        | 方向                     | payload                           | 说明                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktopLyrics:updatePlayback` | 主窗口渲染→主进程→歌词窗 | `{ playing: boolean }`            | 发送点与 `updateTrack` 同一处（usePlayerStore 内现有 push 逻辑旁）；主进程照 `updateTime` 的转发模式加 handler，缓存 `runtime.latestDesktopLyricsPlaying` 供 `sendDesktopLyricsSnapshot()` 补发。驱动：插值冻结 + 空闲隐藏 + 工具条 ▶/⏸ 图标切换。 |
| `desktopLyrics:playerShortcut` | 歌词窗→主进程            | `'previous'\|'playPause'\|'next'` | 主进程校验 `event.sender === runtime.desktopLyricsWindow.webContents`（照 `desktopLyrics.ts:190` 现有校验模式）后 `runtime.mainWindow?.webContents.send('player:shortcut', action)`——与 `smtc.ts:33-49` 同一目标通道，主窗口零改动。               |

扩展 1 处 payload：`initSettings` 对象附加 `motionPreference`、`accentColor`（见 §Schema），桌面歌词窗首启即用；主窗口主题/动效偏好变化走既有 `settings:changed` → `syncDesktopLyricsSettings()` 链路重推，无需新通道。

preload（`src/preload/domains/desktopLyricsApi.ts` + `index.d.ts`）新增：`updatePlayback(playing)`（供主窗口调用）、`onPlayback(cb)`、`sendPlayerShortcut(action)`；`initSettings` 回调类型同步扩展。

## 技术架构与文件清单

**窗口加载**：照 `trayPlayer.ts:128-135` 模式替换 `desktopLyrics.ts` 末尾的 loadFile 段：

```ts
// dev
const url = new URL(process.env['ELECTRON_RENDERER_URL'])
url.searchParams.set('window', 'desktop-lyrics')
win.loadURL(url.toString())
// prod
win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'desktop-lyrics' } })
```

**入口分发**（`src/renderer/src/main.ts`）：加 `isDesktopLyrics` 分支——`document.documentElement.classList.add('desktop-lyrics-document')`、html/body 背景 transparent + padding 0（对齐现有 mini/tray 分支写法）、跳过 `injectCachedThemeRuntime` 与 `installScrollToTopButton`、不跑 `bootstrapThemeRuntime`（本窗不看主题 token，颜色全走 settings）、动态 `import('./desktop-lyrics/DesktopLyricsApp.vue')`。`vendor-vue` chunk 已被 MiniPlayer 共享，打包零新增配置。

**新建**

```
src/renderer/src/desktop-lyrics/
  DesktopLyricsApp.vue        # 根：data-state 状态机/底板/锁定/空闲隐藏/-webkit-app-region:drag
  desktop-lyrics.css          # 本窗全部样式，token 自洽，不 import main.css 页面级规则
  components/
    LyricsViewport.vue        # layout single|dual、行位 Transition、排列
    KaraokeLine.vue           # 单行文本→词 spans、渐变扫描；也被设置页预览复用
    ToolbarPill.vue           # 悬浮胶囊工具条
    StylePopover.vue          # 五组手风琴样式面板 + 预设管理入口
  composables/
    useInterpolatedTime.ts    # 4.1
    useIdleHide.ts            # autoHide 三种模式
    useMotionMode.ts          # resolveMotionMode + data-te-motion
  stores/desktopLyrics.ts     # reactive 单例 store：settings/track/time/playing/activeIndex
src/shared/
  desktopLyricsParsing.ts     # 从 html 搬 LRC/YRC/NetEase JSON/plain 解析 + voice tag（行为 1:1）
  desktopLyricsPlayback.ts    # 收编 presentation.js 三函数（calculateLineProgress/hasWordTiming/resolveNetEaseRows）+ 逐词进度
  desktopLyricsPresets.ts     # 5.2
```

**改**：`shared/appSettings.ts`（v2 字段+默认）、`main/core/settings.ts`（迁移归一）、`main/integrations/desktopLyrics.ts`（加载方式+2 个 IPC+payload 扩展）、`preload/domains/desktopLyricsApi.ts`、`preload/index.d.ts`、`main/core/runtime.ts`（`latestDesktopLyricsPlaying`）、`usePlayerStore.ts`（加 `updatePlayback` push 点）、`DesktopLyricsSettingsSection.vue`（重写：分区控件 + 右侧嵌 `KaraokeLine` 喂 mock 数据实时预览，同 bundle 可直接 import）。

**删**：`resources/desktop-lyrics.html`、`resources/desktop-lyrics-presentation.js`（P1 末验证替代后删除）。

**依赖纪律**：desktop-lyrics 模块不得 import 主窗口 `App.vue`/路由/全局 store；只依赖 vue、shared 模块、`lyricSpring.ts`/纯函数工具。这保证 satellite 窗 bundle 与 MiniPlayer 同量级。

## 实施阶段（按序执行，P0-P2 为一刀切重构主体）

### P0 血管接通

1. `main.ts` 加 `desktop-lyrics` 分支 + `DesktopLyricsApp.vue` 占位（渲染一行固定文本「桌面歌词已联通」）。
2. `desktopLyrics.ts` 加载改 `?window=desktop-lyrics`（两个分支；其他逻辑一行不动）。
3. 更新 `desktopLyrics.test.ts` 中加载路径的断言。

- 验收：开关桌面歌词正常出窗/关窗，锁定穿透、位置持久化行为与现状一致。

### P1 渲染核（功能追平现状）

1. 解析搬移：`desktopLyricsParsing.ts`，从 html 逐函数搬运（`parseYrc/parseLrc/parseEnhancedWords/parseNeteaseJsonLyricLine/stripValidVoiceTag/parsePlainLyrics/mergeLyrics/buildMergedLyrics`），按现状行为补单测（voice tag 合法化、NetEase JSON、t<0 credits、repeat 时间错、plain 纯文本）。
2. `desktopLyricsPlayback.ts` 收编 presentation.js 三函数 + 测试随迁。
3. store + `useInterpolatedTime` + LyricsViewport(single) + KaraokeLine（gradient 扫描）。
4. settings v2 落盘 + 迁移 + `applySettings` 全字段生效。
5. 删 `resources/desktop-lyrics.html`、`.js`。

- 验收：与旧版并排截屏对比，single 布局信息等价（同色同字同翻译），仅动效更顺。

### P2 动效

1. 换行 Transition 四档 + spring（复用/裁剪 `lyricSpring.ts`；复用粒度不够就内联简版，不强求共享）。
2. 词激活 scale/glow、强调词、`animIntensity` 乘算。
3. dual 双行交替。
4. 动效偏好四档接线（IPC payload + `data-te-motion` + CSS 降级）——016 桌面歌词半段关闭。

- 验收：四档动效偏好下行为符合 4.4；强度 0/50/100 三档截图对比。

### P3 自定义 UI

1. ToolbarPill + StylePopover 构建，所有控件接通 updateSettings。
2. `desktopLyrics:playerShortcut` + `updatePlayback` 双向接通。
3. 预设模块 + 工具条预设▾ + 另存/导入导出。
4. 设置页重写 + 嵌入 KaraokeLine 实时预览。
5. accentColor 跟随。

- 验收：窗内改→设置页同步；设置页改→窗秒变；预设切换 6 套全部正常。

### P4 打磨

1. `useIdleHide` 三模式 + 边界（暂停中禁用 hover 弹层、seek 取消隐藏计时）。
2. 性能：全动画仅 transform/opacity/背景 clip；rAF 单循环；`content-visibility` 不上（窗口太小无意义）。
3. 多显示器拖位边界、系统休眠恢复后时间重锚。
4. 视觉走查：agent-browser 隔离 profile 截图，3 预设 × 2 动效档 × single/dual。

## 测试与验收

**新增/迁移单测**

- `desktopLyricsParsing.test.ts`：从 html 解析行为反写（voice tag 剥离/保留、YRC `[t,d]`+`(t,d,o)`词、NetEase JSON 行、credits t<0、多时间戳重复行、plain fallback）。
- `desktopLyricsPlayback.test.ts`：presentation.js 现有测试平移 + 逐词进度边界（空词、末词 0.25s 兜底、非时间错词）。
- `useInterpolatedTime.test.ts`：假时钟驱动 rAF，验证上限钳制、0.08s 收敛带、>1s 跳变、暂停冻结。
- `appSettings` 迁移测试：v1 三种 presentation/layout 组合 → v2 期望值表驱动。
- `desktopLyricsPresets.test.ts`：normalize/clone/上限 20/名称截断（照 `lyricsPresets` 测试模式）。
- KaraokeLine 组件测试：jsdom 渲染词 span 数、`--word-p` 写入、无 timing 时整行渐变。

**更新已有**：`desktopLyrics.test.ts`（加载 URL/query 断言、新 IPC handler）、`usePlayerStore.test.ts` 现有 4 条源码正则必须保持绿（不许改调用形）。

**人工验收清单**：默认预设开箱观感；hover 胶囊浮现/回收时序；锁定穿透与解锁条；播放控制三键；预设切换；封面取色开关对比；四档动效偏好；暂停 8s 自动隐藏与恢复。

## 风险与边界

- **P1 并行窗口**：迁移期两实现短暂共存（resources 文件 P1 末才删），勿把 bug 修到旧文件里。
- **背景透明的字可读性**：bgOpacity=0 时纯文字悬浮，复杂桌面背景下颜色可能看不清 → 默认预设保留 shadow `0 1px 8px rgba(0,0,0,.35)`；文档提示用户必要时开胶囊底。
- **渐变 `background-clip:text` + 位移叠加**：位移放在父容器，词 span 只动 transform/clip，避免重扫渐变。
- **html/body 全局样式污染**：`main.css` 被 main.ts 无条件 import，satellite 窗需确认无全局背景/最小宽污染（现有 mini/tray 已验证该路径安全，照抄即可）。
- **字体 follow 链路**：`fontFamily:'follow'` 依赖主进程 `resolveDesktopLyricsFontFamily` 注入，重构后保留 `getEffectiveDesktopLyricsSettings` 出口合并，勿绕开。
- **回退策略**：P0-P2 任一阶段出阻塞，可直接回退到 resources 旧文件 + `loadFile` 旧路径（git revert 小范围提交），主进程骨架始终未变。
