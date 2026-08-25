# 007 — 进度条与电平表改用 transform: scale 驱动

- **Status**: DONE
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 性能（AUDIT 第 5 节 Performance）
- **Estimated scope**: 7 个文件（5 个 CSS/style 块 + 2 个需要同时改绑定的模板），中等体量

## Problem

7 处进度条 / 电平表用 `width` 或 `height` 过渡来表现进度。这两个属性触发 layout + paint + composite，而其中两处是**播放期间持续在跑**的常态开销。同一个仓库里已经有正确的 `scaleX` 范式（`PlayerBar.css:1367-1375`），这些地方只是没跟上。

### 高频处一：首页 hero 进度条（播放期间每秒一次 200ms 过渡）

```css
/* src/renderer/src/components/LocalDashboard.css:650-656 — 当前 */
.hero-progress-track span {
  position: absolute;
  inset: 5px auto 5px 0;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--home-accent), var(--te-accent-cyan));
  transition: width 0.2s linear;
}
```

绑定在 `src/renderer/src/components/LocalDashboard.vue:892`：

```html
<!-- src/renderer/src/components/LocalDashboard.vue:886-893 — 当前 -->
<button
  class="hero-progress-track"
  title="点击跳转播放进度"
  aria-label="播放进度"
  @click="handleHeroSeek"
>
  <span :style="{ width: progressWidth }"></span>
</button>
```

播放进度每秒推进一次，每次都启动一条 200ms 的 `width` 过渡——也就是说首页开着、歌在放，这个元素**一直在 layout**。200ms 的过渡窗口占了 1 秒里的 20%，但每次都要重排它所在的整个 flex 容器。

上下文（轨道容器，圆角已经在它身上）：

```css
/* src/renderer/src/components/LocalDashboard.css:642-648 — 当前，仅供参考，不要改 */
.hero-progress-track::before {
  content: '';
  position: absolute;
  inset: 5px 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--home-ink) 12%, transparent);
}
```

### 高频处二：EQ 页 VU 电平表（随音频每帧更新）

```css
/* src/renderer/src/components/equalizer/ParametricEqWorkspace.vue:1326-1333 — 当前 */
.meter-channel i {
  position: absolute;
  right: 1px;
  bottom: 1px;
  left: 1px;
  display: block;
  transition: height 90ms linear;
}
```

四个实例，绑定在 `src/renderer/src/components/equalizer/ParametricEqWorkspace.vue:593-598`：

```html
<!-- src/renderer/src/components/equalizer/ParametricEqWorkspace.vue:592-599 — 当前 -->
<div class="meter-channel" aria-label="左声道">
  <i class="meter-peak" :style="{ height: peakMeterLevel + '%' }"></i>
  <i class="meter-rms" :style="{ height: rmsMeterLevel + '%' }"></i>
</div>
<div class="meter-channel" aria-label="右声道">
  <i class="meter-peak" :style="{ height: Math.max(0, peakMeterLevel - 2) + '%' }"></i>
  <i class="meter-rms" :style="{ height: Math.max(0, rmsMeterLevel - 3) + '%' }"></i>
</div>
```

值来自 `src/renderer/src/components/equalizer/ParametricEqWorkspace.vue:121-122`：

```javascript
const peakMeterLevel = computed(() => meterLevel(props.meterPeakDb))
const rmsMeterLevel = computed(() => meterLevel(props.meterRmsDb))
```

音频电平每帧变一次，90ms 的过渡**永远跑不完就被新值重定向**。EQ 页开着就是 4 个元素 × 每帧 layout，一直在跑。

注意 `.meter-rms` 用 `!important` 覆盖了左右内缩：

```css
/* src/renderer/src/components/equalizer/ParametricEqWorkspace.vue:1335-1343 — 当前 */
.meter-peak {
  background: var(--eq-meter);
}

.meter-rms {
  right: 3px !important;
  left: 3px !important;
  background: color-mix(in srgb, var(--eq-meter) 55%, transparent);
}
```

### 其余 5 处（频率较低，但同样是 layout）

```css
/* src/renderer/src/components/NcmCloudPanel.vue:441-448 — 当前 */
.progress-track span,
.song-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--te-primary-500);
  transition: width 0.2s linear;
}
```

```css
/* src/renderer/src/components/settings-page/SettingsPage.css:2649-2654 — 当前 */
.update-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--brand-500, #2563eb), var(--brand-400, #38bdf8));
  transition: width 120ms linear;
}
```

```css
/* src/renderer/src/components/streaming-page/ProviderDownloadsPanel.vue:296-301 — 当前 */
.provider-download-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--te-primary-500);
  transition: width var(--te-motion-panel) var(--te-ease-soft);
}
```

```css
/* src/renderer/src/components/ImportDialog.vue:362-366 — 当前 */
.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--te-primary-500), var(--te-primary-300));
  transition: width 0.3s ease;
}
```

```css
/* resources/audio-visualizer/index.html:1243-1248 — 当前 */
.metric-bar-fill {
  height: 100%;
  background-color: var(--accent-red);
  width: 0;
  transition: width 0.1s ease;
}
```

### AUDIT 依据

AUDIT 第 5 节 Performance：

- 「**Animate `transform` and `opacity` only.** `width`/`height`/`margin`/`padding`/`top`/`left` trigger layout + paint + composite.」
- 「CSS (and WAAPI) beat rAF-based JS under load — use CSS for predetermined motion, JS/springs for dynamic and gesture-driven motion.」

### `scaleX` 的两个副作用，执行者必须知道

1. **`scaleX` 会连带缩放子元素。** 填充层必须是没有子内容的纯色 / 渐变条。本方案涉及的 7 处全部满足（都是空的 `<span>` / `<i>` / `<div>`），但改动时不许往里加子节点。
2. **`scaleX` 会连带缩放圆角。** 一个 `border-radius: 999px` 的条被 `scaleX(0.1)` 后，左右两端的圆角会被水平压扁成竖直的椭圆。**圆角必须放在轨道容器上，配 `overflow: hidden`**，填充层自己不留圆角。本方案的 Steps 会逐处交代这一点。
3. **渐变背景在 `scaleX` 下会跟着拉伸。** `linear-gradient(90deg, A, B)` 在 `scaleX(0.3)` 时只显示被压缩的整条渐变，而不是渐变的前 30%。视觉上颜色分布会变。若要保持「填充多少就露出渐变多少」的观感，做法是把渐变画在轨道容器上、用填充层做遮罩——**但本方案不做这个改造**，接受渐变随填充一起压缩的观感变化，因为它在细条上几乎看不出来。执行者不要自行加遮罩层。

## Target

统一范式：填充层静态写 `transform: scaleX(0)`（竖向表用 `scaleY(0)`）+ `transform-origin`，由 JS 以 `scaleX(<0..1>)` 驱动；`width` / `height` 固定为 `100%`。

### 水平进度条（6 处）

```css
/* target — 水平进度条填充层的统一形状 */
.填充层选择器 {
  width: 100%;
  height: 100%;
  transform: scaleX(0);
  transform-origin: 0 50%;
  will-change: transform;
  /* 高频驱动处（LocalDashboard hero）用 transition: none，由 JS 每帧写 transform；
     低频处（更新进度、导入进度、下载进度）保留一条 transform 过渡。 */
}
```

### 竖向电平表（1 处，4 个实例）

```css
/* target — src/renderer/src/components/equalizer/ParametricEqWorkspace.vue */
.meter-channel i {
  position: absolute;
  right: 1px;
  bottom: 1px;
  left: 1px;
  height: 100%;
  display: block;
  transform: scaleY(0);
  transform-origin: 50% 100%;
  will-change: transform;
  transition: none;
}
```

`transform-origin: 50% 100%` 让电平从底边向上长，对应原来 `bottom: 1px` + `height` 增长的方向。

### 各处的过渡取舍

| 位置                                    | 驱动频率        | 目标 transition                                        |
| --------------------------------------- | --------------- | ------------------------------------------------------ |
| `LocalDashboard.css` hero 进度条        | 播放中每秒 1 次 | `transition: none`，JS 每帧写 transform                |
| `ParametricEqWorkspace.vue` VU 表       | 每帧            | `transition: none`                                     |
| `SettingsPage.css` 更新进度             | 下载中偶发      | `transform 120ms linear`                               |
| `ProviderDownloadsPanel.vue` 下载进度   | 下载中偶发      | `transform var(--te-motion-panel) var(--te-ease-soft)` |
| `ImportDialog.vue` 导入进度             | 导入中偶发      | `transform 0.3s ease`                                  |
| `NcmCloudPanel.vue` 进度条              | 偶发            | `transform 0.2s linear`                                |
| `audio-visualizer/index.html` metric 条 | 偶发            | `transform 0.1s ease`                                  |

低频处保留过渡是对的：过渡 `transform` 走合成器，成本与 `width` 完全不同一个量级。高频处按 `PlayerBar.css:1367-1375` 的样板走 `transition: none`。

## Repo conventions to follow

- **核心样板 —— `src/renderer/src/components/player-bar/PlayerBar.css:1367-1376`**，这是仓库内 transform 驱动进度的标准范式，逐字照抄它的结构：
  ```css
  .progress-fill {
    height: 100%;
    width: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--accent-color, #2563eb), #0d9488);
    transform: scaleX(0);
    transform-origin: 0 50%;
    will-change: transform;
    transition: none;
  }
  ```
  配套的轨道容器在 `PlayerBar.css:1355-1366`，圆角与 `overflow: hidden` 都在容器上。
- **平滑工具 —— `src/renderer/src/utils/useSmoothedValue.ts`**。播放栏用它把每秒一跳的播放进度变成连续运动，配置是 `{ tau: 160, snapThreshold: 2.5 }`：`tau` 是闭合 63% 差距所需的毫秒数，`snapThreshold` 让 seek / 切歌的大跳变直接 snap 不补间。rAF 循环只在收敛期间跑，静止时零开销（`:50-56`），并且自带 `prefers-reduced-motion` 分支（`:33-36`、`:65-69`）。hero 进度条应当复用它。
  ```javascript
  // src/renderer/src/utils/useSmoothedValue.ts:24-28 — 签名
  export function useSmoothedValue(
    target: Ref<number>,
    options: SmoothedValueOptions = {}
  ): Ref<number> {
    const { tau = 120, snapThreshold = Infinity, epsilon = 0.0005 } = options
  ```
- 动效 token 住在 `src/renderer/src/assets/base.css:26-40`。`ProviderDownloadsPanel.vue` 已经在用 `var(--te-motion-panel)` / `var(--te-ease-soft)`，保持。**不要新增曲线 token**——本方案不需要任何新曲线。
- **已知 token 空洞：`--te-neutral-800` 与 `--te-primary-600` 在任何主题都没定义。** 本方案不要引入对它们的引用。

## Steps

### 步骤 1：hero 进度条 CSS（`src/renderer/src/components/LocalDashboard.css`）

把 `:650-656` 的规则改成：

```css
.hero-progress-track span {
  position: absolute;
  inset: 5px auto 5px 0;
  width: 100%;
  background: linear-gradient(90deg, var(--home-accent), var(--te-accent-cyan));
  transform: scaleX(0);
  transform-origin: 0 50%;
  will-change: transform;
  transition: none;
}
```

改动点：删掉 `border-radius: 999px`（圆角移交容器，见步骤 2）、加 `width: 100%`、把 `transition: width 0.2s linear` 换成 `transform: scaleX(0)` + `transform-origin` + `will-change` + `transition: none`。`inset: 5px auto 5px 0` 保留——它给出上下 5px 内缩和左对齐。

### 步骤 2：hero 进度条轨道容器加圆角与裁剪（`src/renderer/src/components/LocalDashboard.css`）

找到 `.hero-progress-track` 规则（`::before` 在 `:642`，容器规则在其上方，用 `grep -n "^\.hero-progress-track" src/renderer/src/components/LocalDashboard.css` 定位）。在容器规则里确保有：

```css
border-radius: 999px;
overflow: hidden;
```

若容器已经有这两条，不要重复添加。**若容器上已有 `overflow: visible` 或其他 overflow 值，停下来报告**——改成 hidden 可能影响 hover 时 `::before` 的 `inset: 4px 0` 效果（见 `LocalDashboard.css:658-659`）。

### 步骤 3：hero 进度条改用 transform 绑定（`src/renderer/src/components/LocalDashboard.vue`）

先查清 `progressWidth` 的定义：

```
grep -n "progressWidth" src/renderer/src/components/LocalDashboard.vue
```

它当前产出一个百分比字符串（如 `'42%'`）。需要一个 0..1 的比例值。

在 `<script setup>` 里新增一个比例 computed 和平滑 ref（放在 `progressWidth` 定义附近）：

```javascript
import { useSmoothedValue } from '../utils/useSmoothedValue'

// 0..100 的进度百分比，供 transform 用；useSmoothedValue 把每秒一跳的播放
// 进度补成连续运动，seek/切歌的大跳变（>2.5%）直接 snap 不补间。
const heroProgressPercent = computed(() =>
  duration.value > 0 ? Math.min(100, Math.max(0, (currentTime.value / duration.value) * 100)) : 0
)
const smoothedHeroProgress = useSmoothedValue(heroProgressPercent, {
  tau: 160,
  snapThreshold: 2.5
})
```

`duration` 与 `currentTime` 已经在这个组件里用过（模板 `:895-896` 的 `formatTime(currentTime)` / `formatTime(duration)`），直接复用同名 ref。**若这两个名字在本文件里不存在，停下来报告**，不要自己造数据源。`computed` 若尚未从 `vue` 导入，补进现有的 import 语句。

然后把模板 `:892` 从

```html
<span :style="{ width: progressWidth }"></span>
```

改成

```html
<span :style="{ transform: `scaleX(${smoothedHeroProgress / 100})` }"></span>
```

`progressWidth` 若在别处仍被使用就保留其定义；若改完后无人引用，删掉它以免 lint 报未使用变量。用 grep 确认。

### 步骤 4：VU 电平表 CSS（`src/renderer/src/components/equalizer/ParametricEqWorkspace.vue`）

把 `:1326-1333` 的规则改成：

```css
.meter-channel i {
  position: absolute;
  right: 1px;
  bottom: 1px;
  left: 1px;
  height: 100%;
  display: block;
  transform: scaleY(0);
  transform-origin: 50% 100%;
  will-change: transform;
  transition: none;
}
```

改动点：加 `height: 100%`、加 `transform: scaleY(0)` + `transform-origin: 50% 100%` + `will-change: transform`、把 `transition: height 90ms linear` 换成 `transition: none`。`right/bottom/left` 全部保留。

`.meter-rms` 的 `right: 3px !important` / `left: 3px !important`（`:1339-1343`）不要动——它们控制水平内缩，与竖向缩放无关。

### 步骤 5：VU 电平表改用 transform 绑定（`src/renderer/src/components/equalizer/ParametricEqWorkspace.vue`）

把模板 `:592-599` 的四个 `:style` 从 height 百分比改成 scaleY 比例：

```html
<div class="meter-channel" aria-label="左声道">
  <i class="meter-peak" :style="{ transform: `scaleY(${peakMeterLevel / 100})` }"></i>
  <i class="meter-rms" :style="{ transform: `scaleY(${rmsMeterLevel / 100})` }"></i>
</div>
<div class="meter-channel" aria-label="右声道">
  <i
    class="meter-peak"
    :style="{ transform: `scaleY(${Math.max(0, peakMeterLevel - 2) / 100})` }"
  ></i>
  <i
    class="meter-rms"
    :style="{ transform: `scaleY(${Math.max(0, rmsMeterLevel - 3) / 100})` }"
  ></i>
</div>
```

注意右声道的 `- 2` / `- 3` 是**百分点**的偏移，所以要先减再除 100，顺序不能颠倒。

`.meter-channel` 容器（`:1318-1324`）已有 `overflow: hidden` 和 `border-radius: 2px`，不需要改。

### 步骤 6：NCM 云盘面板（`src/renderer/src/components/NcmCloudPanel.vue`）

把 `:441-448` 改成：

```css
.progress-track span,
.song-progress span {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--te-primary-500);
  transform: scaleX(0);
  transform-origin: 0 50%;
  transition: transform 0.2s linear;
}
```

删掉 `border-radius: inherit`（圆角移交容器）。`.progress-track` 容器（`:434-440`）已有 `overflow: hidden` 与 `border-radius: 999px`，无需改。**`.song-progress` 的容器规则要单独确认**：`grep -n "\.song-progress" src/renderer/src/components/NcmCloudPanel.vue`，若它缺 `overflow: hidden` 或 `border-radius`，补上 `overflow: hidden; border-radius: 999px;`。

然后把驱动这两个 span 的 `:style` 绑定从 `width` 改成 `transform: scaleX(比例)`：用 `grep -n "progress-track\|song-progress" src/renderer/src/components/NcmCloudPanel.vue` 找到模板位置，把 `width: <expr>%` 形式改为 `transform: \`scaleX(${<expr> / 100})\``。**若绑定形式与预期不符（例如用的是 class 而非 inline style），停下来报告。**

### 步骤 7：设置页更新进度条（`src/renderer/src/components/settings-page/SettingsPage.css`）

把 `:2649-2654` 改成：

```css
.update-progress-fill {
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, var(--brand-500, #2563eb), var(--brand-400, #38bdf8));
  transform: scaleX(0);
  transform-origin: 0 50%;
  transition: transform 120ms linear;
}
```

删掉 `border-radius: 999px`——容器 `.update-progress-track`（`:2640-2647`）已有 `overflow: hidden` 与 `border-radius: 999px`。

再改绑定：`grep -rn "update-progress-fill" src/renderer/src/components/` 找到模板，把 `width` 绑定换成 `transform: scaleX(比例)`。

### 步骤 8：流媒体下载面板（`src/renderer/src/components/streaming-page/ProviderDownloadsPanel.vue`）

把 `:296-301` 改成：

```css
.provider-download-progress-fill {
  width: 100%;
  height: 100%;
  background: var(--te-primary-500);
  transform: scaleX(0);
  transform-origin: 0 50%;
  transition: transform var(--te-motion-panel) var(--te-ease-soft);
}
```

删掉 `border-radius: inherit`——容器 `.provider-download-progress`（`:287-294`）已有 `overflow: hidden` 与 `border-radius: 999px`。

再把同文件模板里该元素的 `width` 绑定换成 `transform: scaleX(比例)`。

### 步骤 9：导入对话框（`src/renderer/src/components/ImportDialog.vue`）

把 `:362-366` 改成：

```css
.progress-bar-fill {
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, var(--te-primary-500), var(--te-primary-300));
  transform: scaleX(0);
  transform-origin: 0 50%;
  transition: transform 0.3s ease;
}
```

容器 `.progress-bar-bg`（`:355-360`）已有 `overflow: hidden` 与 `border-radius: 999px`。再把模板里的 `width` 绑定换成 `transform: scaleX(比例)`。

### 步骤 10：可视化器 metric 条（`resources/audio-visualizer/index.html`）

把 `:1243-1248` 改成：

```css
.metric-bar-fill {
  width: 100%;
  height: 100%;
  background-color: var(--accent-red);
  transform: scaleX(0);
  transform-origin: 0 50%;
  transition: transform 0.1s ease;
}
```

注意原来是 `width: 0`（不是 100%），所以初始态由 `scaleX(0)` 承担。容器 `.metric-bar-bg`（`:1235-1241`）**没有 `overflow: hidden`**，但它也没有 `border-radius`，所以 scaleX 不会造成圆角变形，不需要补。

再在同文件的 JS 里找到写 `metric-bar-fill` 宽度的地方：`grep -n "metric-bar-fill\|metricBar" resources/audio-visualizer/index.html`，把 `style.width = pct + '%'` 形式改成 `style.transform = 'scaleX(' + (pct / 100) + ')'`。

### 步骤 11：全量核对

```
grep -rn "transition: width\|transition: height\|transition:width\|transition:height" src/ resources/
```

应当只剩下本方案未覆盖的位置（若有，不要顺手改，记录下来报告）。

## Boundaries

- **不要动 `src/renderer/src/components/player-bar/PlayerBar.css:1367-1376` 与 `src/renderer/src/utils/useSmoothedValue.ts`。** 它们是样板，已经是对的。`useSmoothedValue` 只许调用，不许修改它的默认值或内部逻辑。
- **不要动 `PlayerBar.vue` 里驱动 `.progress-fill` 的 JS。**
- **不要给填充层加子元素**，也不要在填充层上留 `border-radius`（除容器无圆角的步骤 10 那种情况）——`scaleX` 会把两者一起压扁。
- **不要自行加遮罩层来「修正」渐变随缩放拉伸的观感。** 本方案接受这个变化。
- **不要改任何轨道容器的尺寸、内边距、颜色。** 只在容器缺 `overflow: hidden` / `border-radius` 时补这两条。
- **不要改 `.meter-rms` 的 `right: 3px !important` / `left: 3px !important`。**
- **不要把低频处也改成 `transition: none`。** 只有 hero 进度条和 VU 表是高频，其余 5 处保留 transform 过渡。
- **不要新增动效 token，不要引用 `--te-neutral-800` / `--te-primary-600`**（这两个在任何主题都没定义）。
- **不要改 `src/renderer/src/components/visibilityBudget.test.ts` 覆盖的 rAF 循环。** 该测试只管 `resources/audio-visualizer/index.html` 的 rAF 循环与 `LoginPage.vue` 的二维码轮询——步骤 10 改的是 metric 条的样式与写法，不要顺手动 rAF 结构。
- 不要新增依赖，不要改 `package.json`。
- **若任一步骤找不到匹配代码（行号漂移、绑定形式与描述不符、`progressWidth` / `duration` / `currentTime` 名字不存在），停下来报告，不要自行发挥。** 尤其不要凭猜测改动 `:style` 绑定的表达式——算错除数会让进度条静默失效。

## Verification

- **Mechanical**：
  - `pnpm run typecheck` —— 步骤 3、5、6、7、8、9 都动了模板表达式，这里会抓出算术类型错误和未使用变量。必须零错误。
  - `pnpm run lint` —— 应当通过。`progressWidth` 若已无人引用而未删，会在这里报未使用。
  - `pnpm run test:themes` —— CSS 改动面较大，先跑这一档。
  - `pnpm run test:local-perf` —— 覆盖本地库与首页性能相关断言，hero 进度条改动应当跑一遍。
  - `pnpm run test:dsp-graph` —— 覆盖 EQ / DSP，VU 表改动应当跑一遍。
  - `pnpm run test:app` —— 全应用层面的断言。
  - `pnpm run build` —— 必须构建成功。
  - **注意：HEAD（9312f3e）上本来就有 3 条测试是红的。** 跑套件前先在未改动的工作树上记一次基线，只对比新增的失败。
  - **本方案不新增测试文件。若执行者要加，必须登记进 `package.json` 的某个 `test:*` 脚本，否则不会被执行。**
- **Feel check**（真实渲染 + 性能取证）：先 `npx electron-vite build` 让 `out/` 带上改动，再用隔离 profile 启动 + CDP：
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`。
  - **hero 进度条与 VU 表都需要有当前曲目**：seed `<profile>/playback-session.json`（`{version:1, savedAt, mode:'trackAndPosition', track, position, queue, queueIndex}`，塞一个真 `duration`）+ settings 里 `playbackResumeMode: 'trackAndPosition'`。
  - 优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-playbar-shapes.cjs`（支持 `TE_THEME=` / `TE_PRESET=` / `TE_PORT=`）最接近，它已经处理了播放会话 seed。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - 窗口 `deviceScaleFactor` 是 1.5，截图 clip 是 CSS px 但 PNG 带缩放，用 `png.width / clipWidth` 反推。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
  - 要确认的观察点：
    - **首页 hero 进度条**：填充从左边缘长出来，不是从中间张开（`transform-origin: 0 50%` 生效）。播放中推进平滑连续，不再是每秒一跳。轨道两端的圆角保持圆形，没有被压成竖椭圆。
    - **hero 进度条 seek**：点击轨道跳转时，填充**直接跳到新位置不补间**（`snapThreshold: 2.5` 生效）。切歌同理。若看到 seek 后填充缓慢爬过去，说明 `snapThreshold` 没起作用。
    - **EQ 页 VU 表**：电平从底边向上长（`transform-origin: 50% 100%`），不是从中间或顶部。左右两声道有 2/3 个百分点的差异（原绑定语义保留）。`.meter-rms` 仍然比 `.meter-peak` 窄一点（左右各内缩 3px）。
    - 进度为 0 时填充完全不可见；进度为 100% 时填满轨道不溢出。
    - 逐一确认另外 5 处：设置页检查更新的下载进度、导入对话框的导入进度、流媒体下载面板的下载进度、NCM 云盘的进度条、可视化器的 metric 条。每处都要看到填充从左侧长出且不溢出。
  - **性能取证**：DevTools Performance 面板分别录制「首页播放 10 秒」与「EQ 页开着播放 10 秒」两段 trace，改动前后比对 **Layout** 与 **Recalculate Style** 的帧占用。改后这两项应当明显下降——原来每秒（hero）和每帧（VU 表）的强制重排消失了。也可以在 `Runtime.evaluate` 里用 `performance.now()` 采样连续 120 帧的间隔分布。
  - 在 DevTools Animations 面板把播放速度设为 10%，触发一次导入进度更新，确认动画列表里是 `transform` 而不是 `width`。
  - 切到 `html[data-te-motion='reduced']` 与 `'off'`（三档由 `src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts` 驱动）。`useSmoothedValue` 自带 `prefers-reduced-motion` 分支（`:33-36`），确认 reduced 下 hero 进度条直接跳到目标值而不补间，但**进度信息本身仍然可读**——AUDIT 第 6 节：「Reduced motion means fewer and gentler animations, **not zero**」。
- **Done when**：
  - `grep -rn "transition: width\|transition: height" src/renderer/src/components/LocalDashboard.css src/renderer/src/components/equalizer/ParametricEqWorkspace.vue src/renderer/src/components/NcmCloudPanel.vue src/renderer/src/components/settings-page/SettingsPage.css src/renderer/src/components/streaming-page/ProviderDownloadsPanel.vue src/renderer/src/components/ImportDialog.vue resources/audio-visualizer/index.html` 无命中。
  - 7 处填充层都有 `transform-origin` 声明（水平的是 `0 50%`，竖向的是 `50% 100%`）。
  - `grep -rn "width: progressWidth\|height: peakMeterLevel\|height: rmsMeterLevel" src/renderer/src/` 无命中。
  - `pnpm run typecheck`、`pnpm run lint`、`pnpm run build` 全部通过，测试失败数不超过 HEAD 基线的 3 条。
  - 7 处进度条在真实渲染下都从左（或底）边缘长出，圆角未变形，0% 不可见、100% 不溢出。
