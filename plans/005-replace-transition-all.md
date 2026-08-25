# 005 — 把 `transition: all` 换成显式属性清单

- **Status**: DONE
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 性能（AUDIT 第 5 节 Performance）
- **Estimated scope**: 12 个文件，48 个选择器，纯 CSS 改动（不动模板、不动脚本）

## Problem

`transition: all` 的语义是「基础态与目标态之间**任何**有差异的可动画属性都参与过渡」。执行者需要理解这一点，因为它决定了成本：过渡集合不是作者写下的那一条属性，而是浏览器逐帧比对出来的全部差异属性。本仓库里这个集合反复包含三类高成本属性：

1. **paint 类** —— `box-shadow`（大半径模糊，例如 `0 20px 40px`）、`background`（含 `linear-gradient` 的整条重画）、`border-color`。
2. **layout 类** —— `left`、`width`、`height`、`padding`、`gap`。这一类会触发 layout → paint → composite 全链路。
3. **`backdrop-filter`** —— 无法交给合成器插值，过渡期间每帧都要重做一次背景模糊采样。

`grep -rn "transition: all"` 在本仓库命中 **47 行**。其中两行不是生效声明：

- `src/renderer/src/app/useMotionPreference.test.ts:67` 是门禁正则本身（`assert.doesNotMatch(playingMusic, /transition: all/)`），不是样式。
- `src/renderer/src/components/EqualizerPage.vue:1341` 是变量定义 `--transition: all 0.3s var(--te-ease-soft);`，而它**永远不生效**：该定义写在 `:1335` 的 `:root` 块里，而这个块位于 `<style scoped>`（起于 `:1134`，止于 `:1837`）内部。用仓库自带的 `@vue/compiler-sfc` 3.5.33 实测编译，输出是 `[data-v-abc123]:root { --transition: all 0.3s var(--te-ease-soft); }` —— `[data-v-x]:root` 要求 `<html>` 元素自身带作用域属性，这永不成立。

`--transition` 在全仓**只有这一处定义**（已 grep 确认，无全局 CSS 定义、无 `setProperty('--transition'`）。因此同文件 `:1382`、`:1404`、`:1611` 的 `transition: var(--transition);` 是悬空引用：自定义属性未定义时 `var()` 使整条声明 invalid at computed-value time，`transition` 回落到初始值 `all 0s` —— 即这三处元素**当前完全没有过渡**，不是「有一条 `all` 过渡」。

所以**实际生效的 `transition: all` 选择器是 45 个**。那三处悬空引用不属于本方案（它们是「动效意图丢失」而非「过渡了不该过渡的属性」），归 **017 号方案**连同整个死 `:root` 块一起处理。

### 完整位置清单（45 个生效点）

| 文件 | 行号 |
| --- | --- |
| `src/renderer/src/components/player-bar/HiFiSidebar.css` | 300, 784, 849, 860, 885, 944, 979, 1297, 1333, 1434, 1545（11 处） |
| `src/renderer/src/components/StreamingLibrary.vue` | 406, 502, 624, 698, 715, 829, 867, 891, 960, 976, 1014, 1039（12 处） |
| `src/renderer/src/components/EqualizerPage.vue` | 1148, 1198, 1277, 1306（4 处。`:1382`/`:1404`/`:1611` 的 `var(--transition)` 是悬空引用，当前无任何过渡，归 017 号方案） |
| `src/renderer/src/components/PluginPage.vue` | 939, 1034, 1074, 1168, 1374（5 处） |
| `src/renderer/src/components/song-list/SongList.css` | 440, 579, 2187（3 处） |
| `src/renderer/src/components/streaming-page/StreamingPage.css` | 607, 646, 728（3 处） |
| `src/renderer/src/components/streaming-page/StreamingSearchControls.css` | 24, 62（2 处） |
| `src/renderer/src/components/settings-page/SettingsPage.css` | 3803, 3876（2 处） |
| `src/renderer/src/components/ImportDialog.vue` | 270（1 处） |
| `src/renderer/src/components/LyricsAppearanceCustomizer.vue` | 957（1 处） |
| `resources/audio-visualizer/index.html` | 759（1 处） |

### 证据一：`all` 把 `backdrop-filter` 拖进逐帧过渡

```css
/* src/renderer/src/components/StreamingLibrary.vue:394-414 — 当前 */
.glass-card {
  background: var(--te-glass-bg-strong);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 24px;
  padding: 32px;
  box-shadow:
    0 20px 40px rgba(15, 23, 42, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  position: relative;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
}
.glass-card:hover {
  transform: translateY(-4px);
  box-shadow:
    0 24px 48px rgba(15, 23, 42, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}
```

hover 实际只改了 `transform` 与 `box-shadow` 两项，但 `all` 让 300ms 内每一帧都重新评估这张卡的全部属性，`blur(24px) saturate(180%)` 的背景采样跟着重跑。同文件 `:948-968` 的 `.playlist-item` 是同一个模式（`backdrop-filter: blur(20px)` + `transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`）。

### 证据二：`all` 把 layout 属性拖进来

```css
/* src/renderer/src/components/player-bar/HiFiSidebar.css:841-873 — 当前 */
.deck-switch {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid var(--d-line-strong);
  background: var(--d-well);
  flex-shrink: 0;
  transition: all 0.22s ease;
}

.deck-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--d-faint);
  transition: all 0.22s cubic-bezier(0.34, 1.4, 0.64, 1);
}

.deck-switch.active {
  border-color: var(--d-accent-line);
  background: var(--d-accent-soft);
  box-shadow: inset 0 0 10px color-mix(in srgb, var(--d-accent) 14%, transparent);
}

.deck-switch.active .deck-switch-knob {
  left: 20px;
  background: var(--d-accent);
  box-shadow: 0 0 8px var(--d-glow);
}
```

`left: 2px → 20px` 落在 `all` 的过渡集合里，于是这个开关的旋钮位移是 220ms 的逐帧 layout，而不是一次合成器位移。这是本批里唯一确认为**布局属性真的在 `all` 集合内**的位置。

### 证据三：`backdrop-filter` + `all` 出现在滚动列表的常驻控件上

```css
/* src/renderer/src/components/song-list/SongList.css:430-451 — 当前（.library-filter-trigger） */
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--te-neutral-700, #343d57);
  background: rgba(255, 255, 255, 0.66);
  border: 1px solid rgba(255, 255, 255, 0.78);
  box-shadow: 0 10px 26px rgba(86, 70, 160, 0.07);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  white-space: nowrap;
}

.library-filter-trigger:hover,
.library-filter-trigger.active {
  background: rgba(124, 77, 255, 0.08);
  color: var(--te-primary-500, #7c4dff);
  border-color: rgba(124, 77, 255, 0.28);
}
```

`SongList.css:579`（`.recent-source-trigger`）与 `:2187`（`.library-tools-trigger` / `.excluded-tracks-trigger`）是同一形状：都带 `backdrop-filter: blur(14px) saturate(140%)`，hover 只改颜色，但 `all` 把 blur 一起拖进 200ms 过渡。

### AUDIT 依据

AUDIT 第 5 节 Performance 两条直接命中：

- 「**`transition: all`** animates unintended properties off-GPU — always a finding」
- 「Animate `transform` and `opacity` only. `width`/`height`/`margin`/`padding`/`top`/`left` trigger layout + paint + composite」

### 审查阶段的两处更正（执行者必读）

主代理交付的证据里有两条**经复核不成立**，本方案已剔除，执行者不要去找它们：

1. **`SettingsPage.css` 的 `.toggle-switch::after { left }` 不在 `all` 集合里。** 该规则在 `SettingsPage.css:1122-1136`，它自己写了显式清单，不是 `all`：
   ```css
   /* src/renderer/src/components/settings-page/SettingsPage.css:1132-1135 — 当前，已经是显式清单 */
     transition:
       left var(--te-motion-panel) var(--te-ease-soft),
       box-shadow var(--te-motion-panel) var(--te-ease-soft),
       scale var(--te-motion-panel) var(--te-ease-soft);
   ```
   它确实在过渡 `left`（`:1143` 的 `.toggle-switch.active::after { left: 22px; }`），是一个真实的 layout 过渡问题，但**不属于本方案**——本方案只处理 `transition: all`。不要在本方案里改它。`SettingsPage.css` 在本方案里只有 `:3803`（`.signal-line`）与 `:3876`（`.preset-btn`）两处。
2. **`StreamingPage.css` 的 `.streaming-content-title { width/height }` 不存在。** `.streaming-content-title` 在该文件的 4 处定义（`:52`、`:1299`、`:1618`、`:2086`）**都没有任何 `transition` 声明**，也没有 `width`/`height`。`StreamingPage.css` 的三处 `all` 分别属于 `.search-tab-pill`（`:598`）、`.search-source-trigger`（`:634`）、`.recent-source-trigger`（`:716`），它们的状态差异只有 `background` / `color` / `box-shadow` / `border-color` / `opacity`，**没有布局属性**。

## Target

逐条把 `transition: all <duration> <easing>` 替换为显式属性清单。**只保留下面这 5 个属性**，按各选择器实际有状态差异的那几项来写：

- `transform`
- `opacity`
- `color`
- `background-color`（原值写 `background: <纯色>` 的也用 `background-color`；原值是 `linear-gradient` 的见下方规则）
- `border-color`

不许出现在新清单里的属性：`all`、`backdrop-filter`、`-webkit-backdrop-filter`、`filter`、`box-shadow`、`width`、`height`、`left`、`right`、`top`、`bottom`、`padding`、`margin`、`gap`、`background`（简写）、`font-weight`、`font-size`。

三条判定规则，执行者按顺序套用：

1. **状态差异里出现 `linear-gradient` 的**（例如 `StreamingPage.css:617` 的 `.search-tab-pill.active { background: linear-gradient(...) }`）：渐变无法与纯色互相插值，浏览器本来就是瞬时切换。清单里**不要**写 `background-color`，只写实际能动的项（通常是 `color` 和 `transform`）。
2. **状态差异里出现 `box-shadow` 的**：丢弃 `box-shadow` 过渡，让它瞬时切换。阴影是 paint 成本最高的一项，且视觉上在 hover 里几乎看不出插值差别。
3. **布局位移（只有 `HiFiSidebar.css` 的 `.deck-switch-knob` 一处）**：改成 `transform: translateX()`，见 Steps 第 3 步。

时长与曲线：**保留每条原有的时长数值**（0.15s / 0.16s / 0.18s / 0.2s / 0.22s / 0.3s 各自不变），本方案不调时长。曲线一律换成仓库 token：

- 原写 `ease` 或省略曲线的 → `var(--te-ease-soft)`
- 原写 `cubic-bezier(0.4, 0, 0.2, 1)` 的 → `var(--te-ease-enter)`（`base.css:26` 定义为完全相同的 `cubic-bezier(0.4, 0, 0.2, 1)`，是等值替换）
- 原写 `cubic-bezier(0.34, 1.4, 0.64, 1)` 的（仅 `HiFiSidebar.css:860`）→ **本方案不动这条曲线**，归 004 号方案，见 Boundaries。

## Repo conventions to follow

- 动效 token 全部住在 `src/renderer/src/assets/base.css:26-40`。可用的曲线 token：`--te-ease-enter`（`cubic-bezier(0.4, 0, 0.2, 1)`）、`--te-ease-soft`、`--te-ease-spring`（`cubic-bezier(0.22, 1.14, 0.36, 1)`）、`--te-ease-out-quint`（`cubic-bezier(0.22, 1, 0.36, 1)`）、`--te-ease-out-expo`（`cubic-bezier(0.16, 1, 0.3, 1)`）。**本方案不需要新增任何 token。**
- **关于 `--te-ease-soft` 的一个坑**：`base.css:28` 声明它等于 `--te-ease-out-quint`（`cubic-bezier(0.22, 1, 0.36, 1)`），但主题运行时会用 `!important` 把它改写成 `cubic-bezier(0.2, 0.8, 0.2, 1)`（来源 `src/shared/themeTokens.ts:1704`，注入点 `src/renderer/src/stores/useThemeStore.ts:454`），默认主题下即生效。**这个分叉由 001 号方案修复，本方案不处理。** 对本方案的影响：写 `var(--te-ease-soft)` 是正确做法（它是仓库的既有约定），但不要在方案执行过程中依据「soft 就是 out-quint」去做视觉比对 —— 若需要确定的 out-quint，直接写 `var(--te-ease-out-quint)`。
- 显式属性清单的仓库样板 —— `src/renderer/src/components/settings-page/SettingsPage.css:1116-1119`：
  ```css
  .toggle-switch {
    transition:
      background var(--te-motion-panel) var(--te-ease-soft),
      box-shadow var(--te-motion-panel) var(--te-ease-soft),
      scale var(--te-motion-hover) var(--te-ease-soft);
  }
  ```
  多属性换行、每行一项、逗号结尾，prettier 会这样格式化。照这个排版写。
- 另一个样板 —— `src/renderer/src/components/player-bar/HiFiSidebar.css:1340`：`transition: color 0.18s ease;`。单属性写一行即可。

## Steps

每一步只改一个文件。改完一个文件再进下一个。

1. **`src/renderer/src/components/player-bar/HiFiSidebar.css`，除 `:860` 外的 10 处。** 这 10 处（`:300`、`:784`、`:849`、`:885`、`:944`、`:979`、`:1297`、`:1333`、`:1434`、`:1545`）的状态差异都只有 `background` / `border-color` / `color` / `box-shadow` / `font-weight`。按 Target 规则丢弃 `box-shadow` 与 `font-weight`，各自替换为：
   - `:300`（`.deck-rail-btn`，原 `transition: all 0.2s ease;`）→
     ```css
     transition:
       background-color 0.2s var(--te-ease-soft),
       border-color 0.2s var(--te-ease-soft),
       color 0.2s var(--te-ease-soft);
     ```
   - `:784`（`.deck-toggle`，原 `transition: all 0.2s ease;`）→ 同上，三项 `0.2s var(--te-ease-soft)`。
   - `:849`（`.deck-switch`，原 `transition: all 0.22s ease;`）→
     ```css
     transition:
       background-color 0.22s var(--te-ease-soft),
       border-color 0.22s var(--te-ease-soft);
     ```
   - `:885`（`.deck-btn`）、`:944`（`.deck-segmented button`）、`:979`（`.deck-device`）、`:1297`（`.deck-inline-toggle`）、`:1333`（`.deck-action`）、`:1434`（`.deck-cast-item`）、`:1545`（`.deck-extension`），原文都是 `transition: all 0.18s ease;` →
     ```css
     transition:
       background-color 0.18s var(--te-ease-soft),
       border-color 0.18s var(--te-ease-soft),
       color 0.18s var(--te-ease-soft);
     ```
2. **`src/renderer/src/components/player-bar/HiFiSidebar.css:860`（`.deck-switch-knob`）的属性清单。** 只改属性清单，**曲线字面量 `cubic-bezier(0.34, 1.4, 0.64, 1)` 原样保留**（它归 004 号方案）。把
   ```css
   transition: all 0.22s cubic-bezier(0.34, 1.4, 0.64, 1);
   ```
   改成
   ```css
   transition:
     transform 0.22s cubic-bezier(0.34, 1.4, 0.64, 1),
     background-color 0.22s cubic-bezier(0.34, 1.4, 0.64, 1);
   ```
3. **`src/renderer/src/components/player-bar/HiFiSidebar.css` 的旋钮位移改 `transform`。** 这是本方案唯一需要改非 `transition` 声明的地方。
   - `:852-861` 的 `.deck-switch-knob` 规则里，`left: 2px;` 保持不变（它是静止位置，不再参与动画），在 `border-radius: 50%;` 之后、`background:` 之前加一行 `transform: translateX(0);`。
   - `:869-873` 的 `.deck-switch.active .deck-switch-knob` 规则里，把 `left: 20px;` **删掉**，换成 `transform: translateX(18px);`。`18px` 是原位移量：`20px - 2px = 18px`。
   - 改完后这两条规则应当是：
     ```css
     .deck-switch-knob {
       position: absolute;
       top: 2px;
       left: 2px;
       width: 16px;
       height: 16px;
       border-radius: 50%;
       transform: translateX(0);
       background: var(--d-faint);
       transition:
         transform 0.22s cubic-bezier(0.34, 1.4, 0.64, 1),
         background-color 0.22s cubic-bezier(0.34, 1.4, 0.64, 1);
     }

     .deck-switch.active .deck-switch-knob {
       transform: translateX(18px);
       background: var(--d-accent);
       box-shadow: 0 0 8px var(--d-glow);
     }
     ```
4. **`src/renderer/src/components/StreamingLibrary.vue`，12 处。**
   - `:406`（`.glass-card`，带 `backdrop-filter: blur(24px)`；hover 改 `transform` + `box-shadow`）→ `transition: transform 0.3s var(--te-ease-enter);`
   - `:502`（`.provider-switch-btn`；状态改 `background` 纯色 + `border-color` + `color`）→
     ```css
     transition:
       background-color 0.2s var(--te-ease-soft),
       border-color 0.2s var(--te-ease-soft),
       color 0.2s var(--te-ease-soft);
     ```
   - `:624`（`.stat-badge`；hover 改 `background` 纯色 + `border-color`）→
     ```css
     transition:
       background-color 0.2s var(--te-ease-soft),
       border-color 0.2s var(--te-ease-soft);
     ```
   - `:698`（`.btn-play`；hover 改 `transform` + `box-shadow`，基础态 `background` 是 `linear-gradient`）→ `transition: transform 0.3s var(--te-ease-soft);`
   - `:715`（`.favorites-cover`；hover 只改 `transform`）→ `transition: transform 0.3s var(--te-ease-enter);`
   - `:829`（`.feature-card .enter-btn`；hover 改 `transform` + `box-shadow` + `color`）→
     ```css
     transition:
       transform 0.3s var(--te-ease-soft),
       color 0.3s var(--te-ease-soft);
     ```
   - `:867`（`.create-playlist-btn`；hover 改 `transform` + `background` 纯色 + `box-shadow`）→
     ```css
     transition:
       transform 0.2s var(--te-ease-soft),
       background-color 0.2s var(--te-ease-soft);
     ```
   - `:891`（`.playlist-delete-button`；状态只改 `opacity` 与 `background` 纯色）→
     ```css
     transition:
       opacity 0.2s var(--te-ease-soft),
       background-color 0.2s var(--te-ease-soft);
     ```
   - `:960`（`.playlist-item`，带 `backdrop-filter: blur(20px)`；hover 改 `transform` + `box-shadow` + `background`）→
     ```css
     transition:
       transform 0.3s var(--te-ease-enter),
       background-color 0.3s var(--te-ease-enter);
     ```
   - `:976`（`.playlist-item-cover`；hover 只改 `transform`）→ `transition: transform 0.3s var(--te-ease-soft);`
   - `:1014`（`.playlist-item-arrow`；hover 改 `color` + `transform`）→
     ```css
     transition:
       color 0.3s var(--te-ease-soft),
       transform 0.3s var(--te-ease-soft);
     ```
   - `:1039`（`.playlist-pin-button`；状态改 `border-color` + `background` 纯色 + `color` + `transform`）→
     ```css
     transition:
       transform 0.2s var(--te-ease-soft),
       background-color 0.2s var(--te-ease-soft),
       border-color 0.2s var(--te-ease-soft),
       color 0.2s var(--te-ease-soft);
     ```
5. **`src/renderer/src/components/EqualizerPage.vue`，4 处 `transition: all 0.2s;`（`:1148`、`:1198`、`:1277`、`:1306`）。** 先读出每条所属的选择器与其状态规则，再按判定规则写清单。**不动 `:1341` 的 `--transition` 定义**（归 017 号方案，见 Boundaries）。四条都替换为覆盖其真实差异项的清单，格式：
   ```css
   transition:
     background-color 0.2s var(--te-ease-soft),
     border-color 0.2s var(--te-ease-soft),
     color 0.2s var(--te-ease-soft);
   ```
   若某条的状态差异里含 `transform`，在清单最前面补 `transform 0.2s var(--te-ease-soft),`。若某条完全没有颜色差异只有 `transform`，就只写 `transition: transform 0.2s var(--te-ease-soft);`。
6. **`src/renderer/src/components/PluginPage.vue`，5 处。** `:939`、`:1034`、`:1074`、`:1374` 原文 `transition: all 0.2s;`，`:1168` 原文 `transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);`。同第 5 步方法逐条读选择器与状态规则，写显式清单；`:1168` 的曲线换成 `var(--te-ease-enter)`，其余用 `var(--te-ease-soft)`，时长都保持 `0.2s`。
7. **`src/renderer/src/components/song-list/SongList.css`，3 处（`:440`、`:579`、`:2187`）。** 三条原文都是 `transition: all 0.2s ease;`，状态差异都是 `background` 纯色 + `color` + `border-color`。三条统一替换为：
   ```css
   transition:
     background-color 0.2s var(--te-ease-soft),
     border-color 0.2s var(--te-ease-soft),
     color 0.2s var(--te-ease-soft);
   ```
   注意 `:2187` 附近的 hover 规则用了 `var(--te-primary-600)`——那个 token 在任何主题都没有定义，是既有问题，**本方案不要去修它也不要新增对它的引用**。
8. **`src/renderer/src/components/streaming-page/StreamingPage.css`，3 处（`:607`、`:646`、`:728`）。** 原文都是 `transition: all 0.2s ease;`。
   - `:607`（`.search-tab-pill`）：`.active` 态是 `linear-gradient`，按规则 1 不写 `background-color`，只写 `transition: color 0.2s var(--te-ease-soft);`。注意 `:611` 的 hover 改的是 `background-color`（不是 `background`），所以这条要写成：
     ```css
     transition:
       background-color 0.2s var(--te-ease-soft),
       color 0.2s var(--te-ease-soft);
     ```
   - `:646`（`.search-source-trigger`）与 `:728`（`.recent-source-trigger`）：状态只改 `background` 纯色 + `color` →
     ```css
     transition:
       background-color 0.2s var(--te-ease-soft),
       color 0.2s var(--te-ease-soft);
     ```
9. **`src/renderer/src/components/streaming-page/StreamingSearchControls.css`，2 处（`:24`、`:62`）。** 这个文件的 `.search-tab-pill` / `.search-source-trigger` 与第 8 步的 StreamingPage.css 是同形状的重复样式，原文都是 `transition: all 0.2s ease;`，替换成与第 8 步完全相同的两项清单：
   ```css
   transition:
     background-color 0.2s var(--te-ease-soft),
     color 0.2s var(--te-ease-soft);
   ```
10. **`src/renderer/src/components/settings-page/SettingsPage.css`，2 处。**
    - `:3803`（`.signal-line`；`.active` 态改 `border-bottom` + 加 `background` 渐变）→ 渐变不可插值，按规则 1 只留 `transition: border-color 0.3s var(--te-ease-soft);`
    - `:3876`（`.preset-btn`；hover 改 `border-color` + `color` + `background`）→
      ```css
      transition:
        background-color 0.16s var(--te-ease-soft),
        border-color 0.16s var(--te-ease-soft),
        color 0.16s var(--te-ease-soft);
      ```
11. **`src/renderer/src/components/ImportDialog.vue:270`。** 原文 `transition: all 0.15s;`。读出选择器与状态差异，替换为覆盖真实差异项的清单，时长保持 `0.15s`，曲线用 `var(--te-ease-soft)`。**不要动同文件 `:365` 的 `.progress-bar-fill { transition: width 0.3s ease; }`**——那条归 007 号方案。
12. **`src/renderer/src/components/LyricsAppearanceCustomizer.vue:957`。** 原文 `transition: all 160ms ease;`。读出选择器与状态差异，替换为显式清单，时长保持 `160ms`，曲线用 `var(--te-ease-soft)`。
13. **`resources/audio-visualizer/index.html:759`。** 原文 `transition: all 0.2s ease;`。**这个文件是独立的 webview 页面，不加载 `base.css`，没有 `--te-*` token。**曲线不要写 token，保留字面量 `ease`，只把 `all` 换成显式属性清单，例如 `transition: background-color 0.2s ease, color 0.2s ease;`——具体属性按该选择器的实际状态差异确定。**不要动同文件 `:1247` 的 `.metric-bar-fill { transition: width 0.1s ease; }`**（归 007 号方案）。

## Boundaries

- **不要改 `src/renderer/src/components/player-bar/HiFiSidebar.css:860` 的曲线字面量 `cubic-bezier(0.34, 1.4, 0.64, 1)`。** 那条裸弹性曲线的 token 化归 **004 号方案**。本方案只改这一行的属性清单（`all` → `transform, background-color`），曲线原样抄两遍。两个方案会碰同一行，但改的是不同片段。
- **不要改 `src/renderer/src/components/EqualizerPage.vue:1335-1342` 的 `:root` 块**，包括 `:1340` 的 `--te-ease-soft` 局部覆盖和 `:1341` 的 `--transition` 定义。那一块归 **017 号方案**。本方案在 EqualizerPage.vue 里只碰 `:1148`、`:1198`、`:1277`、`:1306` 四行。
- **不要改任何 `transition: width` / `transition: height`。** 那些归 **007 号方案**，包括 `ImportDialog.vue:365`、`resources/audio-visualizer/index.html:1247`、`settings-page/SettingsPage.css:2653`。
- **不要改 `src/renderer/src/App.vue` 或 `src/renderer/src/components/player-bar/PlayerBar.css` 的布局过渡。** 那些归 **008 号方案**。
- **不要改 `src/renderer/src/components/settings-page/SettingsPage.css:1107-1178` 的 `.toggle-switch` 族。** 它已经是显式清单（不是 `all`），其 `left` 过渡是另一个问题，不在本方案范围。
- **不要碰门禁本身。** `src/renderer/src/app/useMotionPreference.test.ts:67` 的 `assert.doesNotMatch(playingMusic, /transition: all/)` 只覆盖 `PlayingMusic.vue`，本方案不改那个文件，所以这条断言不受影响，**也不要顺手去加宽它**——把门禁扩到全部渲染进程文件归 **020 号方案**。
- 不要改模板/结构，除第 3 步明确要求的 `.deck-switch-knob` 位移属性外，只动 `transition` 声明。
- 不要新增依赖，不要新增 token，不要改 `package.json`。
- **若某一步的当前代码与本方案引用的内容不符（行号漂移、已被改过、选择器不同），停下来报告，不要自行发挥。** 尤其是第 5、6、11、12 步要求执行者自己读出选择器的状态差异——如果读不到明确的状态规则（找不到对应的 `:hover` / `.active` 声明），不要猜，报告该位置并跳过它。

## Verification

- **Mechanical**：
  - `pnpm run lint` —— 应当通过。prettier 会检查多行 `transition` 的排版，若报格式差异，按它的意见调整缩进（每项一行、两空格缩进、逗号结尾）。
  - `pnpm run typecheck` —— 纯 CSS 改动不应引入类型错误。
  - `pnpm run test:themes` —— `src/renderer/src/components/liquidGlassSurfaces.test.ts` 属于这一档，它断言 `te-liquid-glass-budget` 字样与固定 blur 数值（约 `:68`、`:108-123` 行），**不检查过渡属性清单**，所以本方案不应让它变红。
  - `pnpm run test:app` —— 覆盖 `SideMenu.test.ts` 与 `useMotionPreference.test.ts`。本方案不碰这两个测试锁定的文件，应当保持基线状态。
  - `pnpm run build` —— 产物应当构建成功；`scripts/verify-renderer-budgets.cjs` 只管体积（jsChunk 900KB / cssChunk 400KB / fonts 32MB），显式清单比 `all` 略长几十字节，不会触及 400KB 的 CSS 上限。
  - **注意：HEAD（9312f3e）上本来就有 3 条测试是红的。** 跑任何套件前先在未改动的工作树上记一次基线，只对比新增的失败。
- **Feel check**（真实渲染，不用简化替身）：先 `npx electron-vite build` 让 `out/` 带上改动，再用隔离 profile 启动 + CDP：
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`。
  - 优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-scroll-top.cjs`（滚动/浮层，seed 60 个真 WAV 并点「所有歌曲」侧边栏项）最贴近本方案要看的场景。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
  - 要确认的观察点：
    - 在「所有歌曲」页把指针横扫过顶部的筛选/工具触发器（`.library-filter-trigger`、`.library-tools-trigger`），颜色渐变仍然平滑，**但玻璃模糊不再随 hover 呼吸**——改前 blur 会在 200ms 里重算，改后应当完全静止。
    - HiFi 侧栏（播放栏里的 deck 面板）的开关：点 `.deck-switch`，旋钮仍然从左滑到右并带轻微过冲，落点与改前一致（右端距容器右缘 2px）。旋钮不再有任何抖动或亚像素跳动。
    - 流媒体资料库的卡片 hover：`.glass-card` / `.playlist-item` 仍然抬起 4px / 3px，阴影瞬时切换（不再插值）——这是本方案有意的取舍，确认它不显得突兀。
  - DevTools Performance 面板录制「列表 hover 扫掠」这一个动作，改动前后各录一段 trace 比对 **Recalculate Style / Paint** 的帧占用。改后 Paint 应当明显下降。也可以用 CDP 的 `Performance.enable` + `Tracing`，或在 `Runtime.evaluate` 里用 `performance.now()` 采样。
  - 在 DevTools Animations 面板把播放速度设为 10%，确认没有任何 hover 过渡里还能看到模糊半径或阴影在变化。
  - 切到 `html[data-te-motion='reduced']` 与 `'off'`（三档由 `src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts` 驱动），确认颜色反馈还在、位移被去掉。
- **Done when**：
  - `grep -rn "transition: all" src/ resources/` 只剩 2 行命中：`src/renderer/src/app/useMotionPreference.test.ts:67`（门禁正则）和 `src/renderer/src/components/EqualizerPage.vue:1341`（`--transition` 变量定义，归 017 号方案）。
  - `grep -rn "transition:" src/renderer/src/components/player-bar/HiFiSidebar.css src/renderer/src/components/StreamingLibrary.vue` 的输出里没有 `backdrop-filter`、`filter`、`box-shadow`、`width`、`height`、`left`。
  - `grep -n "left: 20px" src/renderer/src/components/player-bar/HiFiSidebar.css` 无命中（旋钮已改 `translateX`）。
  - `pnpm run lint` 与 `pnpm run build` 通过，测试失败数不超过 HEAD 基线的 3 条。
