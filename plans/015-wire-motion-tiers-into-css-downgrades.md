# 015 — 把应用内三档动效偏好接进 CSS 降级通路

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 无障碍（AUDIT 第 6 节 Accessibility）
- **Estimated scope**: 16 个文件（14 个补降级通路 + 2 个修死规则），约 40 处选择器改动，纯 CSS

## Problem

这个仓库有两条互不相交的「减弱动效」通路：

1. **OS 通路** —— `@media (prefers-reduced-motion: reduce)`，读操作系统设置。
2. **应用内通路** —— `html[data-te-motion='reduced'|'off']` 属性，由 `src/renderer/src/app/useMotionPreference.ts:25` 写在 `documentElement` 上，值来自设置页的「界面动效」四档（`src/renderer/src/components/settings-page/types.ts:77-82`：跟随系统 / 完整动效 / 减少动效 / 关闭动效）。

**应用内那一档是设置界面唯一暴露的入口**，也就是用户实际会去点的开关。但精细的降级规则大量只写在 `@media` 里，于是出现这个后果：

用户在设置里选「减少动效」、而操作系统没有开启减弱动效时，`@media` 不命中，那些降级规则一条都不生效。全局兜底（`base.css:425-433`）虽然会把时长压到 `0.01ms`，但它的选择器是 `html[data-te-motion='reduced'] *`，特异性只有 (0,1,1)，**打不过页面切换那种 (0,2,0) 且带 `!important` 的规则**：

```css
/* src/renderer/src/App.vue:1156-1165 — 当前。特异性 (0,2,0) + !important */
.main-content > .page-down-enter-active,
.main-content > .page-up-enter-active,
.page-down-enter-active,
.page-up-enter-active {
  z-index: 1;
  transition:
    opacity 0.34s ease,
    transform 0.48s cubic-bezier(0.16, 1, 0.3, 1),
    filter 0.42s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
```

```css
/* src/renderer/src/App.vue:1206-1215 — 降级只挂在 OS 通路上 */
@media (prefers-reduced-motion: reduce) {
  .main-content > .page-down-enter-active,
  /* … */ {
    transition:
      opacity 0.12s ease,
      transform 0.12s ease !important;
  }
  /* … enter-from / leave-to 里 transform: none !important; filter: none !important; */
}
```

同一个手势（点侧边栏切换分类）因此有三种结果：OS 开了减弱 → 正确降级到 0.12s、无位移；**应用内选了「减少动效」但 OS 没开 → 跑满 `translate3d(0, 40px, 0) scale(0.99)` + `blur(8px)` + 0.48s，偏好被无声忽略**；流媒体页那条 `.stream-page-down-enter-active` 特异性只有 (0,1,0)，输给兜底，两档下都塌成 0.01ms。

**14 个文件**只有 OS 通路、没有 `data-te-motion` 分支（逐个核对过引入方式与 `@media` 起始行）：

| 文件                                                                    | `@media` 起始行 | 样式是否 scoped                                               |
| ----------------------------------------------------------------------- | --------------- | ------------------------------------------------------------- |
| `src/renderer/src/App.vue`                                              | 1206            | 否（`:922` 是 `<style>`，无 scoped）                          |
| `src/renderer/src/assets/primeicons.css`                                | 39              | 否（`assets/main.css:1` 以 `@import` 引入）                   |
| `src/renderer/src/components/AnimatedInput.vue`                         | 231             | 是                                                            |
| `src/renderer/src/components/AppNoticeHost.vue`                         | 175             | 是                                                            |
| `src/renderer/src/components/LoginPage.vue`                             | 2348            | 是                                                            |
| `src/renderer/src/components/LyricsAppearanceCustomizer.vue`            | 1311            | 是                                                            |
| `src/renderer/src/components/player-bar/HiFiSidebar.css`                | 1564            | 是（`HiFiSidebar.vue:1745` 用 `<style scoped src=>`）         |
| `src/renderer/src/components/streaming-page/StreamingContentHeader.css` | 88              | 是（`StreamingContentHeader.vue:109`）                        |
| `src/renderer/src/components/streaming-page/StreamingLoadingStage.vue`  | 472             | 是                                                            |
| `src/renderer/src/components/streaming-page/StreamingPage.css`          | 455             | 是（`StreamingPage.vue:3289`）                                |
| `src/renderer/src/components/StreamingDiscovery.vue`                    | 1313            | 是                                                            |
| `src/renderer/src/components/theme-studio/ThemeStudioPage.css`          | 1899            | 否（`ThemeStudioPage.vue:1354` 用 `<style src=>`，无 scoped） |
| `src/renderer/src/mini-player/MiniPlayerCustomizer.css`                 | 315             | 否（`MiniPlayerCustomizer.vue:529` 用 `<style src=>`）        |
| `src/renderer/src/components/equalizer/ParametricEqWorkspace.vue`       | 1747            | 是                                                            |

### 第二个问题：已有的 4 条动效降级规则是死代码

`CompactPlayerBarVisualizer.vue` 与 `PlayingLyricLine.vue` 看起来已经接了应用内通路，但写法有误，规则**编译后落不到目标元素上**：

```css
/* src/renderer/src/components/PlayingLyricLine.vue:557-561 — 当前，在 <style scoped> 内（起于 :318） */
:global(html[data-te-motion='reduced']) .lyric-voice--supporting,
:global(html[data-te-motion='off']) .lyric-voice--supporting {
  transition: none;
  transform: none;
}
```

Vue 的 scoped 转换**只重写选择器的最后一个复合项**。当 `:global()` 包住祖先、后面还跟着后代时，转换器丢掉后代部分，只留 `:global()` 里的内容。我用仓库自带的 `@vue/compiler-sfc` 3.5.33 把上面这段原文编译过，产物是：

```css
html[data-te-motion='reduced'],
html[data-te-motion='off'] {
  transition: none;
  transform: none;
}
```

`.lyric-voice--supporting` 消失了 —— `transition: none; transform: none` 落在了 `<html>` 元素上。同理 `CompactPlayerBarVisualizer.vue:82-88` 编译成两条只作用于 `<html>` 的 `animation: none`。

**这 4 条动效降级规则当前完全无效**，而它们所在的文件在审查中曾被当作「已合规」的范例。

仓库作者踩过这个坑并在三处写下了结论，可以直接引用：

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:3750-3755 */
/* These four rules must NOT wrap the ancestor in `:global()`. Vue's scoped
   transform rewrites only the last compound of a selector, so `:global(A) B C`
   compiles to bare `A` — the declarations land on <html>/<body> and never reach
   `.player-bar-warp`. */
```

同样的注释在 `src/renderer/src/components/streaming-page/StreamingPage.css:2522` 与 `src/renderer/src/components/LocalDashboard.css:2683`。

## Target

**每一条现存的 `@media (prefers-reduced-motion: reduce)` 降级块，其选择器同时匹配应用内两档。** `useMotionPreference` 已经把 OS 偏好解析进了 `data-te-motion`（`src/shared/motion.ts:14`：`system` + OS 减弱 → `reduced`），所以属性通路是两者的并集，属性选择器可以**完全取代**媒体查询。

写法按样式是否 scoped 分两种，这是本方案唯一容易写错的地方：

**样式不是 scoped 时**（`App.vue`、`primeicons.css`、`ThemeStudioPage.css`、`MiniPlayerCustomizer.css`）—— 直接写裸的祖先前缀：

```css
/* target */
html[data-te-motion='reduced'] .page-down-enter-active,
html[data-te-motion='off'] .page-down-enter-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease !important;
}
```

**样式是 scoped 时**（其余 10 个）—— **整条选择器放进一个 `:global()`**，不要只包祖先：

```css
/* target — 正确 */
:global(html[data-te-motion='reduced'] .tls-progress-beam),
:global(html[data-te-motion='off'] .tls-progress-beam) {
  animation: none;
}
```

```css
/* 反例 — 不要这样写，后代会被编译器丢掉 */
:global(html[data-te-motion='reduced']) .tls-progress-beam {
  animation: none;
}
```

已验证：整条包进 `:global()` 的形式编译产物是 `html[data-te-motion='reduced'] .tls-progress-beam`，正确。仓库里已有 **278 处**用的是这个正确形式，是既有约定。

**特异性要求**：新写的选择器必须打得过全局兜底（`base.css:425-433` 的 `html[data-te-motion='reduced'] *`，(0,1,1) 带 `!important`）。`html[属性] .类` 是 (0,2,0)，类数 2 > 1 即胜出；原 `@media` 块里带 `!important` 的声明**要保留 `!important`**（`App.vue` 那族页面切换规则本身带 `!important`，降级不带就压不住）。

**保留 `@media` 块还是替换掉**：替换。属性通路是 OS 通路的超集，两条并存等于同样的声明写两遍。唯一例外是 `resources/` 下的独立文档（那里拿不到 `data-te-motion`），但那些文件归 016 号方案。

## Repo conventions to follow

- 正确写法的仓内范例（scoped 场景，整条进 `:global()`）—— `src/renderer/src/components/song-list/SongList.css:1297-1301`：
  ```css
  :global(.main-content.playing-open .track-playing::after),
  :global(html[data-te-motion='reduced'] .track-playing::after),
  :global(html[data-te-motion='off'] .track-playing::after) {
    animation-play-state: paused;
  }
  ```
  （该文件由 `SongList.vue:2549` 以 `<style scoped src=>` 引入，所以是 scoped 场景。）
- 正确写法的仓内范例（非 scoped 场景，裸前缀）—— `src/renderer/src/mini-player/MiniPlayer.css:1036-1043`（由 `MiniPlayerApp.vue:652` 以无 scoped 的 `<style src=>` 引入）：
  ```css
  html[data-te-motion='reduced'] .mini-player-root,
  html[data-te-motion='reduced'] .mini-tool-button,
  /* … */ {
    transition-duration: 100ms !important;
  }
  ```
  这一块还是**全仓唯一真正做到「减少而非清零」**的降级（保留 100ms 而非压到 0.01ms），值得作为降级力度的参照。注意 `useMotionPreference.test.ts:68` 用 `assert.match(miniPlayerCss, /html\[data-te-motion='reduced'\] .mini-player-root/)` 钉住了它，**不要改这一块**。
- 两档要一起列。仓库里凡是接了应用内通路的地方都同时写 `'reduced'` 与 `'off'`（`PlayingMusic.vue:1477-1497`、`SongList.css:1298-1299`、`CompactPlayerBarVisualizer.vue:82-88` 的意图），不要只写一档。
- 多选择器排版：每个选择器单独一行、逗号结尾，prettier 会这样格式化。

## Steps

一个文件一步。每步做完先 `grep` 自查再进入下一步。

1. **`src/renderer/src/components/PlayingLyricLine.vue` —— 修两处死规则。** 这是本方案优先级最高的一步（改的是已存在但无效的规则，不是新增覆盖面）。把 `:557-558`：

   ```css
   :global(html[data-te-motion='reduced']) .lyric-voice--supporting,
   :global(html[data-te-motion='off']) .lyric-voice--supporting {
   ```

   改成：

   ```css
   :global(html[data-te-motion='reduced'] .lyric-voice--supporting),
   :global(html[data-te-motion='off'] .lyric-voice--supporting) {
   ```

   再把 `:595-596`：

   ```css
   :global(html[data-te-motion='reduced']) .lyric-row-content,
   :global(html[data-te-motion='off']) .lyric-row-content {
   ```

   改成：

   ```css
   :global(html[data-te-motion='reduced'] .lyric-row-content),
   :global(html[data-te-motion='off'] .lyric-row-content) {
   ```

   **只移动括号位置，声明块内容一个字不动。**

2. **`src/renderer/src/components/player-bar/CompactPlayerBarVisualizer.vue` —— 修两处死规则。** 同样只移括号，把 `:82` 与 `:86` 的 `:global(html[data-te-motion='reduced']) .compact-visualizer__band` 改成 `:global(html[data-te-motion='reduced'] .compact-visualizer__band)`，`'off'` 那条同理。
   **注意 `:77-78` 的 `:global(html[data-theme='dark']) .compact-visualizer` 与 `:global(.player-bar-glass) .compact-visualizer` 也是同一个坏形式**，但那是主题着色、不是动效，**本方案不碰**（见 Boundaries）。

3. **`src/renderer/src/App.vue`（非 scoped）。** 定位 `:1206` 的 `@media (prefers-reduced-motion: reduce) {`，把整块的 `@media` 包裹去掉，块内每条选择器改写成两档属性前缀形式。原块内有两组选择器（`*-enter-active` / `*-leave-active` 那组，以及 `*-enter-from` / `*-leave-to` 那组），每组 8 个选择器 → 改写后每组 16 个（8 × 2 档）。声明照原样保留，包括 `!important`。去掉 `@media` 后块内每行少一级缩进。

4. **`src/renderer/src/assets/primeicons.css`（非 scoped）。** 定位 `:39` 的 `@media`，同样脱掉媒体查询、给块内选择器加两档裸前缀。**这一块是 `pi-spin` 的降级（33 处使用），它把加载转圈停成静止图标 —— 承载信息的动效不该清零**。按 003 号方案定的策略处理：003 会把转圈改为放缓而非停止，所以**这一步只做通路接入、不改降级力度**，力度由 003 负责。若 003 已先落地，本步跳过该文件（003 会把它一并处理）。

5. **`src/renderer/src/components/theme-studio/ThemeStudioPage.css`（非 scoped）。** 定位 `:1899` 的 `@media`，脱掉媒体查询、加两档裸前缀。

6. **`src/renderer/src/mini-player/MiniPlayerCustomizer.css`（非 scoped）。** 定位 `:315` 的 `@media`，同上。**注意这个组件在两个文档里都渲染**（主窗设置页 `MiniPlayerSettingsSection.vue:77`，迷你窗 `MiniPlayerApp.vue:635`），两个文档都调了 `useMotionPreference`（`App.vue:363`、`MiniPlayerApp.vue:38`），所以属性通路在两处都有效。

7. **以下 8 个 scoped 文件，逐个把 `@media` 块脱成整条 `:global()` 两档形式**（做法完全一致，逐文件确认 `@media` 起始行后改写）：
   - `src/renderer/src/components/AnimatedInput.vue`（`:231`）
   - `src/renderer/src/components/AppNoticeHost.vue`（`:175`）—— 注意**不要动 `:157-158` 的 `ease-in`**，那归 013 号方案
   - `src/renderer/src/components/LoginPage.vue`（`:2348`）
   - `src/renderer/src/components/LyricsAppearanceCustomizer.vue`（`:1311`）
   - `src/renderer/src/components/streaming-page/StreamingLoadingStage.vue`（`:472`）—— 这个文件的降级块是全仓唯一「冻结后补静态终态」的实现（`.tls-progress-beam { width: 100%; opacity: 0.5; transform: none; }`），**内容照抄、只改选择器**
   - `src/renderer/src/components/StreamingDiscovery.vue`（`:1313`）—— 注意 `:1302`/`:1307` 有两处 `data-theme` 的坏形式，本方案不碰
   - `src/renderer/src/components/equalizer/ParametricEqWorkspace.vue`（`:1747`）—— `ParametricEqWorkspace.test.ts:34` 断言 `@media (prefers-reduced-motion: reduce)` 存在，**改完这条测试会红**，见第 10 步
   - `src/renderer/src/components/player-bar/HiFiSidebar.css`（`:1564`，由 `<style scoped src=>` 引入所以算 scoped）

8. **`src/renderer/src/components/streaming-page/StreamingPage.css`（scoped，`:455`）。** 同上。这个文件里 `.stream-page-*-enter-active` 那族的特异性只有 (0,1,0)，改写后变成 `html[属性] .类` = (0,2,0)，会从「被兜底压成 0.01ms」变成「按本文件降级块的值执行」—— 这是修复，不是回归。

9. **`src/renderer/src/components/streaming-page/StreamingContentHeader.css`（scoped，`:88`）。** 同上。

10. **改 `ParametricEqWorkspace.test.ts:34` 的断言。** 第 7 步去掉了那个文件的 `@media`，断言要跟着改。打开 `src/renderer/src/components/equalizer/ParametricEqWorkspace.test.ts`，把断言 `@media (prefers-reduced-motion: reduce)` 存在的那一行，改成断言两档属性选择器存在：

    ```ts
    assert.match(workspace, /html\[data-te-motion='reduced'\]/)
    assert.match(workspace, /html\[data-te-motion='off'\]/)
    ```

    先读出该文件第 34 行的原文再替换（正则的变量名按文件里实际的来）。

11. **收尾核对。** 跑：
    ```
    grep -rn "prefers-reduced-motion" src/renderer/ --include=*.vue --include=*.css
    ```
    预期只剩 `src/renderer/src/app/useMotionPreference.ts:10`（JS 侧读 OS 偏好，正确保留）、`src/renderer/src/components/onboarding/steps/StepWelcome.vue`（`:74` 是脚本里的 `window.matchMedia`，用来决定是否显示动效开关行，该文件没有 `<style>` 块，正确保留），以及若第 4 步跳过则 `primeicons.css`。
    再跑：
    ```
    grep -rn ":global(html\[data-te-motion" src/renderer/ | grep -v ":global(html\[data-te-motion='\(reduced\|off\)'\] "
    ```
    应当零命中 —— 确认没有残留「`:global()` 只包祖先」的坏形式。

## Boundaries

- **不要动 `src/renderer/src/mini-player/MiniPlayer.css:1036-1043`。** 它已经是正确形式，且被 `useMotionPreference.test.ts:68` 钉住。
- **不要动 `src/renderer/src/assets/base.css:412-441` 的全局兜底。** 那一块归 **003 号方案**（按属性精确降级）。本方案只改各文件自己的降级块，不改兜底策略。
- **不要改任何降级块的声明内容**（时长值、`animation: none`、`transform: none` 等），只改选择器。降级力度的调整归 003。唯一例外是缩进（脱掉 `@media` 后少一级）。
- **不要碰 `data-theme` / `data-te-effects-mode` 的坏形式 `:global()` 规则**：`CompactPlayerBarVisualizer.vue:77-78`、`StreamingDiscovery.vue:1302`、`StreamingDiscovery.vue:1307`。它们同样是死代码，但属于主题着色维度，改动会引起视觉变化，需要单独评估。**在最终报告里提一句它们的存在。**
- **不要给 `resources/` 下的任何文件加 `data-te-motion` 选择器。** `resources/desktop-lyrics.html`、`resources/audio-visualizer/index.html` 是独立 BrowserWindow，不在主 `documentElement` 的作用域内、也没有偏好通道，归 **016 号方案**。
- **不要动 `src/renderer/src/tray-player/TrayPlayerApp.vue:335`。** 托盘窗口从未调用 `useMotionPreference`，`data-te-motion` 属性根本不存在，光加选择器是死的 —— 它需要配套的 JS 接线，归 **016 号方案**。
- **不要动 `StepWelcome.vue:74`。** 那是脚本里的 `window.matchMedia('(prefers-reduced-motion: reduce)')`，用途是「仅当 OS 要求减弱动效时才显示这个快捷开关行」，读 OS 偏好在这里是正确的。
- 不要新增依赖，不要改模板或脚本（第 10 步的测试文件除外）。
- 如果某个文件的 `@media` 起始行与上表不符（HEAD 漂移），**停下报告，不要凭猜测改**。

## Verification

- **机械验证**：
  - `pnpm run lint` 通过。
  - `pnpm run typecheck` 通过。
  - `npx prettier --check` 对改动过的文件通过（或先跑 `npx prettier --write` 再确认 diff 只含预期改动）。
  - `pnpm run test:themes` —— 覆盖 `ParametricEqWorkspace.test.ts`（第 10 步改过）与 `useMotionPreference.test.ts`。
  - `pnpm run test:playback-routing` —— 覆盖 `mini-player/styles.test.ts`、`compactPlayerBarStructure.test.ts`。
  - `pnpm run build` 通过。
  - 失败数不超过 HEAD 基线的 3 条（基线见 `MEMORY.md` 的「Pre-existing test failures」）。
- **编译验证（本方案的核心证据，必做）**：改完第 1、2 步后，用仓库自带的 `@vue/compiler-sfc` 把那两个文件的降级块编译一遍，确认产物里**保留了后代选择器**。在仓库根目录建一个临时 `.cjs`（跑完删掉）：
  ```js
  const { compileStyle } = require('@vue/compiler-sfc')
  const { readFileSync } = require('node:fs')
  const src = readFileSync('src/renderer/src/components/PlayingLyricLine.vue', 'utf8')
  const css = src.slice(src.indexOf('<style scoped>') + 14, src.lastIndexOf('</style>'))
  const out = compileStyle({ source: css, filename: 'x.vue', id: 'data-v-test', scoped: true })
  console.log(
    out.code
      .split('\n')
      .filter((l) => l.includes('data-te-motion'))
      .join('\n')
  )
  ```
  预期看到 `html[data-te-motion='reduced'] .lyric-voice--supporting` 这样**带后代**的选择器；如果只看到 `html[data-te-motion='reduced']` 光秃秃一条，说明括号位置还是错的。
- **Feel check（真实渲染，不许用简化替身当证据）**：按 `MEMORY.md` 里「Real render capture recipe」的隔离 profile + CDP 流程起应用。关键是**在操作系统减弱动效关闭的前提下**测应用内开关 —— 这正是当前失效的那个组合。
  - 先确认 OS 侧没开：在 CDP 里 `window.matchMedia('(prefers-reduced-motion: reduce)').matches` 应为 `false`。若这台机器系统级关掉了动画（`MEMORY.md` 记载过本机命中该媒体查询），用 DevTools Rendering 面板强制 `prefers-reduced-motion: no-preference` 再测。
  - 通过 `window.api.settings.update({ motionPreference: 'reduced' })` 切档（这个调用可能要 12 秒以上才 resolve，属正常），然后读 `document.documentElement.dataset.teMotion` 确认是 `'reduced'`。
  - 要确认的观察点：
    - 点侧边栏在「所有歌曲」与「艺人」之间切换：**改前**能看到 40px 上浮 + 8px 模糊 + 近半秒的过渡；**改后**应当是 0.12s、无位移、无模糊。这是本方案最直接的证据。
    - 别点任何文案含「关闭」的按钮（会命中标题栏关闭键，应用直接退出）。
    - 打开播放页看歌词：`.lyric-row-content` 不再有 transform 位移（第 1 步修的死规则），而歌词的 opacity 层次仍在。
    - 紧凑播放栏的可视化柱（`.compact-visualizer__band`）停止动画（第 2 步修的死规则）。
    - 切到 `motionPreference: 'off'`，同样几处应当更彻底地静止。
    - 切回 `'full'`，所有动效恢复原样 —— 确认没有把 `full` 档一起改坏。
  - 用 CDP 读计算样式佐证：对一个 `.lyric-row-content` 元素读 `getComputedStyle(el).transform`，`reduced` 档下应为 `none`；改动前会是一个 matrix 值。
- **Done when**：
  - `grep -rn "prefers-reduced-motion" src/renderer/ --include=*.vue --include=*.css` 只剩第 11 步列出的合法命中。
  - `grep -rn ":global(html\[data-te-motion='[a-z]*'\]) " src/renderer/` 零命中（坏形式已清除）。
  - 编译验证里两个文件的降级选择器都带后代。
  - 在 OS 未开减弱动效、应用内选「减少动效」的组合下，侧边栏分类切换实测为 0.12s 且无位移无模糊。
  - lint / typecheck / build 通过，测试失败数不超过基线。
