# 003 — reduced 档改为按属性精确降级，保住交互反馈与承载信息的动效

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 无障碍（AUDIT 第 6 节 Accessibility）
- **Estimated scope**: 3 个文件（`base.css` 改 1 块 + 新增 2 块，`ScrollingText.vue` 新增 1 块，`primeicons.css` 新增 1 块），约 60 行改动

## Problem

`reduced` 档的通用 `!important` 兜底把所有过渡压到 0.01ms，等于全灭；顺带让**同一段里精心写好的降级 token 全部失效**。

### 降级 token（写了，但用不上）

```css
/* src/renderer/src/assets/base.css:412-419 — 当前 */
html[data-te-motion='reduced'] {
  --te-motion-press: 0ms;
  --te-motion-hover: 100ms;
  --te-motion-panel: 120ms;
  --te-motion-page: 120ms;
  --te-motion-press-scale: 1;
  --te-motion-hover-translate: 0px;
}
```

### 通用兜底（把上面那些覆盖掉）

```css
/* src/renderer/src/assets/base.css:421-433 — 当前 */
/* Near-zero durations (not e.g. 100ms): a non-zero universal transition-duration
   would give every element an implicit `transition-property: all` tween, adding
   motion instead of reducing it. Delays are zeroed so staggered entrances with
   `fill: both` don't leave content invisible until their delay elapses. */
html[data-te-motion='reduced'] *,
html[data-te-motion='reduced'] *::before,
html[data-te-motion='reduced'] *::after {
  animation-duration: 0.01ms !important;
  animation-delay: 0ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  transition-delay: 0ms !important;
}
```

**`!important` 胜过任何非 important 声明。**全仓的时长都走 `transition: <prop> var(--te-motion-hover) …` 这类**简写**（`var(--te-motion-hover)` 215 处引用、`var(--te-motion-panel)` 66 处、`var(--te-motion-page)` 11 处），简写展开出的 `transition-duration` 是**非 important**，所以：

> `--te-motion-hover: 100ms`、`--te-motion-panel: 120ms`、`--te-motion-page: 120ms` 这三个降级值**实际全部失效**，真实生效时长是 `0.01ms`。

`--te-motion-press-scale: 1` 和 `--te-motion-hover-translate: 0px` 不是时长，仍然生效；但消费它们的规则（`base.css:385-390` 的按压、`:392-399` 的 hover translate）本来就只挂 `html[data-te-motion='full']`，在 `reduced` 档根本不匹配——这两个是**冗余保险**，不是在起作用。

净效果：`reduced` 档用户失去的是**全部视觉确认**，而不只是位移。而通用选择器覆盖的正是每一次按钮悬停/按下反馈：

```css
/* src/renderer/src/assets/base.css:367-370 — 受影响的最高频路径 */
:where(button, [role='button'], [role='switch'], [data-te-interactive]) {
  -webkit-tap-highlight-color: transparent;
  transition: translate var(--te-motion-hover) var(--te-ease-soft);
}
```

AUDIT 第 6 节：「Reduced motion means fewer and gentler animations, **not zero** — keep transitions that aid comprehension, remove position changes.」Hunt 项明确点名「reduced-motion implementations that **nuke all feedback**」。

### 作者的顾虑是真的，不能简单把通用时长调高

`base.css:421-424` 的注释说得对：「a non-zero universal transition-duration would give every element an implicit `transition-property: all` tween, adding motion instead of reducing it」。把 `*` 上的 `transition-duration` 从 0.01ms 改成 120ms，会给**所有**元素一条隐式的 `transition-property: all` 补间——那是在加动效，不是在减。

所以正确解法是**按属性精确降级**：通用块只压 `animation-*`，另加一条**按属性白名单**的规则（只列 `opacity, color, background-color, border-color`）作用在**需要反馈的交互元素**上，而不是 `*`。

### `off` 档是正确的对照

```css
/* src/renderer/src/assets/base.css:435-441 — 当前，正确 */
html[data-te-motion='off'] *,
html[data-te-motion='off'] *::before,
html[data-te-motion='off'] *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
```

显式 `animation: none` 的落点是可预测的（元素停在静态声明的样子）。这是本方案要向 `reduced` 档借用的手法。

### 三个必须一起处理的连带问题

**(1) `animation-iteration-count: 1` + 0.01ms 让无限动效「跑完」而不是「不跑」。**全仓 `infinite` 动效 68 处。这些装饰动效**没有** `forwards` / `both`——全仓 `animation-fill-mode` 声明数为 0，`forwards` 只出现在两处非无限动效（`src/renderer/src/components/LoginPage.vue:2293` 的 `animation: drawStroke 0.7s var(--te-ease-soft) 0.1s forwards;` 和 `:2303`）。没有 fill-mode 时，动画结束后元素回落到静态声明；落点由 fill-mode 与静态声明**共同**决定，比显式 `animation: none` 难以推理，且与 `off` 档手法不一致。

**(2) 承载信息的动效被一并冻结。**

`pi-spin` 转圈（loading 指示器），在 `.vue` / `.ts` 里 33 处使用：

```css
/* src/renderer/src/assets/primeicons.css:34-52 — 当前 */
.pi-spin {
    -webkit-animation: fa-spin 2s infinite linear;
    animation: fa-spin 2s infinite linear;
}

@media (prefers-reduced-motion: reduce) {
  .pi-spin {
    -webkit-animation-delay: -1ms;
    animation-delay: -1ms;
    -webkit-animation-duration: 1ms;
    animation-duration: 1ms;
    -webkit-animation-iteration-count: 1;
    animation-iteration-count: 1;
    -webkit-transition-delay: 0s;
    transition-delay: 0s;
    -webkit-transition-duration: 0s;
    transition-duration: 0s;
  }
}
```

转圈变静止图标，用户**失去进度反馈**——看不出来到底在加载还是卡死了。

小窗跑马灯：

```css
/* src/renderer/src/mini-player/ScrollingText.vue:96-105 — 当前 */
.te-scroll-text.is-overflowing .te-scroll-text-inner {
  /* Longhand form only: Vue's scoped-style keyframe rewriting cannot parse a
     CSS variable inside the `animation` shorthand and would drop every
     longhand, so the marquee never runs. */
  animation-name: te-scroll-text-loop;
  animation-duration: var(--te-scroll-duration, 10s);
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-delay: 1.4s;
}
```

被冻结后长歌名重新截断、不可读。**注意历史**：`docs/ui-playback-refactor-audit.md:696` 记载作者曾**主动删掉**该组件自带的 reduced-motion 禁用规则，理由是「小窗的长文本可读性依赖滚动，删除该禁用规则」。全局兜底以另一种方式把那个问题恢复了。

全仓唯一补了可读静态终态的地方，是本方案要照抄的样板：

```css
/* src/renderer/src/components/streaming-page/StreamingLoadingStage.vue:472-497 — 现有样板 */
@media (prefers-reduced-motion: reduce) {
  .tls-stage,
  .tls-emblem,
  /* …省略中间选择器… */
  .tls-orb-b {
    animation: none;
  }

  .tls-progress-beam {
    width: 100%;
    opacity: 0.5;
    transform: none;
  }
}
```

**(3) 需要真机 feel-check**：0.01ms 下按钮按下完全无反馈，是否会被用户误判为「点击没生效」。

### 为什么是 HIGH

覆盖面就是每一次按钮悬停/按下反馈（`base.css:367-370` 的选择器 = 全部原生 `button` + 26 处 `role="button"` + 97 处 `data-te-interactive`），并且 loading 指示器与跑马灯这两类**承载信息**的动效被静默冻结。这不是「动效不够精致」，是无障碍档位反而让界面更难用。

### 与方案 002 的关系

方案 002 把全局按压从 `animation` 改成 `transition` + `transform`。两个方案都改 `base.css`，但改的是**不同的规则块**（002 改 `:385-410`，003 改 `:412-433` 并新增块），互不冲突。**建议先做 002 再做 003**，这样 003 的白名单能顺带把 `transform` 的处置一次写清。若 002 尚未落地也可以先做 003 —— 白名单里刻意**不含** `transform`，`reduced` 档的按压位移本就该去掉。

## Target

通用块只管 `animation-*`；装饰性无限动效显式 `animation: none`；交互反馈按属性白名单保留 120ms 的 `opacity` / 颜色过渡；两类承载信息的动效补可读静态终态。

```css
/* target — src/renderer/src/assets/base.css，替换现 :412-419 的 token 块 */
/* Duration tokens still drop so any rule that reads them directly gets the
   gentler value; the press-scale / hover-translate resets stay as belt-and-braces
   for future rules that are not gated on [data-te-motion='full']. */
html[data-te-motion='reduced'] {
  --te-motion-press: 0ms;
  --te-motion-hover: 100ms;
  --te-motion-panel: 120ms;
  --te-motion-page: 120ms;
  --te-motion-press-scale: 1;
  --te-motion-hover-translate: 0px;
}
```

```css
/* target — src/renderer/src/assets/base.css，替换现 :421-433 的通用兜底 */
/* Reduced motion means fewer and gentler animations, not zero. Two rules do the
   work:
   1. This block kills keyframe motion outright (`animation: none`, like the
      'off' tier) so a frozen decorative loop lands on its static declaration
      instead of "finishing" a 0.01ms run with no fill-mode.
   2. The next block hands interactive elements a short, property-scoped
      transition back. It must stay property-scoped: a non-zero universal
      transition-duration would give every element an implicit
      `transition-property: all` tween, adding motion instead of reducing it. */
html[data-te-motion='reduced'] *,
html[data-te-motion='reduced'] *::before,
html[data-te-motion='reduced'] *::after {
  animation: none !important;
  transition-duration: 0.01ms !important;
  transition-delay: 0ms !important;
}

/* Feedback survives: opacity and colour confirm the press/hover without moving
   anything. transform/translate are deliberately absent — position changes are
   exactly what this tier removes. */
html[data-te-motion='reduced']
  :where(
    button,
    [role='button'],
    [role='switch'],
    [role='radio'],
    [role='tab'],
    [data-te-interactive],
    a,
    input,
    select,
    textarea,
    label
  ) {
  transition-property: opacity, color, background-color, border-color !important;
  transition-duration: 120ms !important;
  transition-timing-function: var(--te-ease-soft) !important;
}
```

```css
/* target — src/renderer/src/assets/base.css，紧接在上面两块之后新增 */
/* Motion that carries information keeps running in the reduced tier; freezing it
   removes meaning rather than movement. The loading spinner would become a
   static icon (no way to tell "loading" from "hung"), so it keeps turning at
   half speed. */
html[data-te-motion='reduced'] .pi-spin {
  animation: fa-spin 4s infinite linear !important;
}
```

```css
/* target — src/renderer/src/mini-player/ScrollingText.vue 的 <style scoped>，
   在 @keyframes te-scroll-text-loop 之后新增 */
/* The marquee carries information: a long title is unreadable when truncated,
   so the mini window's text keeps scrolling in the reduced tier — just slower.
   See docs/ui-playback-refactor-audit.md:696 for why the component's own
   prefers-reduced-motion disable rule was removed. */
:global(html[data-te-motion='reduced']) .te-scroll-text.is-overflowing .te-scroll-text-inner {
  animation-name: te-scroll-text-loop !important;
  animation-duration: calc(var(--te-scroll-duration, 10s) * 2) !important;
  animation-timing-function: linear !important;
  animation-iteration-count: infinite !important;
  animation-delay: 2.4s !important;
}
```

数值依据（全部照抄 AUDIT，不是估的）：

- `120ms` 的 `opacity` / 颜色过渡：AUDIT 第 6 节的样板就是 `animation: fade 0.2s ease;` 级别的「keep opacity/color, drop movement」；120ms 同时与现有的 `--te-motion-panel: 120ms` / `--te-motion-page: 120ms` 降级值一致，是这个仓库自己选定的降级时长。
- 白名单只含 `opacity, color, background-color, border-color`：AUDIT 第 6 节「keep transitions that aid comprehension, **remove position changes**」。`transform` / `translate` 刻意不在列。
- `linear` 用于跑马灯：AUDIT 第 2 节「Constant motion (marquee, progress) → **`linear`**」。跑马灯与 spinner 都是恒定运动，`linear` 正确，不要换成 ease。
- 缓动用 `var(--te-ease-soft)`（方案 001 定为 `cubic-bezier(0.22, 1, 0.36, 1)`）。**不要写裸 cubic-bezier。**
- spinner 与跑马灯的减速倍数（2s→4s、10s→20s）：这是「gentler，不是 zero」的落地——保留信息、降低刺激。

## Repo conventions to follow

- 动效 token 全住在 `src/renderer/src/assets/base.css:26-40`。本方案不新增 token。
- 三档动效模式由 `html[data-te-motion='full'|'reduced'|'off']` 驱动，写在 `src/shared/motion.ts`（`MOTION_PREFERENCES`、`resolveMotionMode`）+ `src/renderer/src/app/useMotionPreference.ts`（`document.documentElement.dataset.teMotion = …`）。这是设置页唯一暴露的开关，**比 `@media (prefers-reduced-motion)` 更权威**——新写的降级规则一律挂 `html[data-te-motion='reduced']`，不要新增 `@media (prefers-reduced-motion: reduce)` 块。
- **「减少而非清零」的正面样板，全仓唯一：**

  ```css
  /* src/renderer/src/mini-player/MiniPlayer.css:1036-1045 — 现有样板 */
  html[data-te-motion='reduced'] .mini-player-root,
  html[data-te-motion='reduced'] .mini-tool-button,
  html[data-te-motion='reduced'] .mini-control-button,
  html[data-te-motion='reduced'] .mini-play-button,
  html[data-te-motion='reduced'] .mini-drag-hint,
  html[data-te-motion='reduced'] .mini-equalizer,
  html[data-te-motion='reduced'] .mini-lyric-switch-enter-active,
  html[data-te-motion='reduced'] .mini-lyric-switch-leave-active {
    transition-duration: 100ms !important;
  }
  ```

  它之所以有效：特异性 (0,2,1) 打得过通用兜底的 (0,1,1)。**本方案的白名单规则用同样的手法**——`html[data-te-motion='reduced'] :where(button, …)` 里 `:where()` 特异性为 0，所以整体是 (0,1,1)，与通用兜底**相同**；靠**后出现**取胜。因此白名单块**必须写在通用兜底块之后**。这一点不能搞错。
- 可读静态终态的样板：`src/renderer/src/components/streaming-page/StreamingLoadingStage.vue:472-497`（`animation: none` + `.tls-progress-beam { width: 100%; opacity: 0.5; transform: none; }`）。
- `off` 档的显式手法样板：`src/renderer/src/assets/base.css:435-441`。

## Steps

1. 打开 `src/renderer/src/assets/base.css`，找到第 412-419 行的 `html[data-te-motion='reduced'] { … }` token 块。**块内的 6 个声明一个字都不改**，只在块上方加 Target 段给出的三行注释（说明为什么这些 token 仍然保留）。
2. 同一文件，把第 421-433 行（4 行注释 + 通用兜底规则）整段替换成 Target 段的第二块代码，即：**新的 12 行注释** + `html[data-te-motion='reduced'] *, …::before, …::after { animation: none !important; transition-duration: 0.01ms !important; transition-delay: 0ms !important; }` + 空行 + **3 行注释** + 白名单规则 `html[data-te-motion='reduced'] :where(button, [role='button'], [role='switch'], [role='radio'], [role='tab'], [data-te-interactive], a, input, select, textarea, label) { transition-property: …; transition-duration: 120ms !important; transition-timing-function: var(--te-ease-soft) !important; }`。
   注意三点：
   - 通用块里 `animation-duration` / `animation-delay` / `animation-iteration-count` 三行被**一行 `animation: none !important;` 取代**（与 `off` 档手法一致，落点可预测）。
   - `transition-duration: 0.01ms !important` 与 `transition-delay: 0ms !important` **保留**在通用块里——它们负责压掉不在白名单里的一切过渡（尤其是位移）。
   - **白名单块必须排在通用块之后**（同特异性靠后者胜），顺序写反等于没写。
3. 同一文件，紧接第 2 步新增的白名单块之后，加 Target 段第三块：4 行注释 + `html[data-te-motion='reduced'] .pi-spin { animation: fa-spin 4s infinite linear !important; }`。**这条必须排在通用 `animation: none !important` 之后**才能覆盖它（同为 important，靠特异性：`html[data-te-motion='reduced'] .pi-spin` 是 (0,2,1)，胜过通用块的 (0,1,1)；顺序在后更保险）。keyframes 名 `fa-spin` 照抄 `src/renderer/src/assets/primeicons.css:36`，不要改名，也不要在 base.css 里重复定义 `@keyframes fa-spin`。
4. 确认第 435-441 行的 `html[data-te-motion='off']` 块仍在你新增的所有块之后、且**未被改动**。`off` 档必须继续赢过 `reduced` 档的所有规则。若顺序错了会让 `off` 档漏出 spinner 转圈。
5. 打开 `src/renderer/src/mini-player/ScrollingText.vue`，在 `<style scoped>`（第 72 行开始）里、`@keyframes te-scroll-text-loop { … }`（第 107-114 行）**之后**，加 Target 段第四块（4 行注释 + `:global(html[data-te-motion='reduced']) .te-scroll-text.is-overflowing .te-scroll-text-inner { … }`）。
   **必须用长属性写法**，不能用 `animation` 简写——第 97-99 行的现有注释解释了原因：「Vue's scoped-style keyframe rewriting cannot parse a CSS variable inside the `animation` shorthand and would drop every longhand, so the marquee never runs」。本方案的 `animation-duration` 里同样含 CSS 变量（`calc(var(--te-scroll-duration, 10s) * 2)`），踩同一个坑。
   `:global(…)` 包住 `html[data-te-motion='reduced']` 是因为 `<style scoped>` 会给选择器加 data 属性，而 `html` 元素不在组件作用域内。
6. **不要**改 `src/renderer/src/assets/primeicons.css`。它是第三方图标库的样式表，第 39-52 行的 `@media (prefers-reduced-motion: reduce)` 块留着无害——第 3 步的 `html[data-te-motion='reduced'] .pi-spin` 特异性 (0,2,1) + `!important` 会胜过它里面那些非 important 的长属性声明。
7. 打开 `src/renderer/src/app/useMotionPreference.test.ts`，在第 64 行 `assert.match(baseCss, /html\[data-te-motion='off'\]/)` 之后新增三条断言：

   ```ts
     // Reduced motion keeps property-scoped feedback instead of nuking everything.
     assert.match(baseCss, /html\[data-te-motion='reduced'\][\s\S]{0,400}transition-property: opacity, color, background-color, border-color/)
     assert.match(baseCss, /html\[data-te-motion='reduced'\] \.pi-spin/)
     assert.doesNotMatch(baseCss, /animation-iteration-count: 1 !important/)
   ```

   该文件已登记在 `package.json` 的 `test:app` 脚本里（无需新增登记）。同文件第 68 行 `assert.match(miniPlayerCss, /html\[data-te-motion='reduced'\] .mini-player-root/)` 仍然通过（本方案没碰 `MiniPlayer.css`）。
8. 全仓搜索 `animation-iteration-count: 1 !important`，应当 0 命中。

## Boundaries

- 不要动 `src/renderer/src/assets/base.css:435-441` 的 `html[data-te-motion='off']` 块。它已经是正确的，且必须保持在最后。
- 不要动 `src/renderer/src/assets/base.css:385-410`（全局按压规则 + `te-interactive-press` keyframes）。那是方案 002 的范围。
- 不要动 `src/renderer/src/assets/base.css:367-370` 与 `:392-399`（基础交互 transition 与 hover translate）。
- 不要动 `src/renderer/src/assets/primeicons.css`（第三方图标库样式表）。
- 不要动 `src/renderer/src/mini-player/MiniPlayer.css:1036-1054` 的降级块——它是样板，且 `useMotionPreference.test.ts:68` 断言它存在。
- 不要动 `src/renderer/src/components/streaming-page/StreamingLoadingStage.vue:472-497`——它是样板，已经正确。
- 不要把白名单里加进 `transform` 或 `translate`。`reduced` 档要去掉的就是位移。
- 不要新增 `@media (prefers-reduced-motion: reduce)` 块。本仓的权威开关是 `html[data-te-motion]`。
- 不要处理其余 66 处装饰性 infinite 动效的**逐个**静态终态——那是方案 015 的范围（16 个文件的降级通路接到本方案定下的策略上）。本方案只定策略 + 处理两类承载信息的动效（`pi-spin`、跑马灯）。
- 不要动 markup / 结构，只改动效属性。不要新增依赖。不要引入对 `--te-neutral-800` / `--te-primary-600` 的引用。
- **如果某一步描述的代码与你实际看到的不一致（行号漂移、值已被改过），停下来报告，不要自行发挥。**

## Verification

- **Mechanical**：
  - `pnpm run typecheck` 应当通过。
  - `pnpm run lint` 应当通过。
  - **先在改动前把下面几套各跑一遍记基线**——HEAD 上本来就有 3 条测试是红的，别把既有失败算到自己账上。
  - `pnpm run test:app` —— 内含 `src/renderer/src/app/useMotionPreference.test.ts`（第 7 步改的那个，用正则钉住 base.css 多条动效规则：`[role='switch']`、`[data-te-interactive]`、`transition: translate var(--te-motion-hover)`、`--te-ease-spring`、`[aria-disabled='true']`、`html[data-te-motion='off']`，另有一条「每个自定义点击目标都要声明动效覆盖」的全量 `.vue` 扫描）。预期全绿（除基线红项）。
  - `pnpm run test:playback-routing` —— 内含 `src/renderer/src/mini-player/styles.test.ts`（读 `MiniPlayer.css` 与 `main.css`）和 `src/renderer/src/components/SideMenu.test.ts`。预期与基线一致。
  - `pnpm run test:themes` —— 内含 `themeColorAudit.test.ts` / `themeTokenization.test.ts`（只管颜色与 token 布线，不管缓动，但都会读 `base.css`）。预期与基线一致。
  - `pnpm run test:cross-cutting-regressions` —— 内含 `visibilityBudget.test.ts` / `visibilityPolling.test.ts`。预期与基线一致。
  - `grep -rn "animation-iteration-count: 1 !important" src/` 应当 0 命中。
  - `pnpm run build` 应当通过。
- **Feel check**（必须走真实渲染，不许用简化替身当证据）：
  1. `npx electron-vite build`，让 `out/` 带上改动。
  2. 隔离 profile 启动：`node_modules/electron/dist/electron.exe . --user-data-dir=<临时目录，正斜杠>`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  3. seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，把 `<profile>/music-library.json` 覆盖成 `{"version":2,"revision":1,"tracks":[],"folders":[],"exclusions":[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `<profile>/plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`（否则 provider RPC 要 30s 超时才放行启动）。
  4. 要测跑马灯就得让小窗有当前曲目：seed `<profile>/playback-session.json`（`{version:1, savedAt, mode:'trackAndPosition', track, position, queue, queueIndex}`，`track` 取一首**标题足够长**的歌并塞真 `duration`），settings 里设 `playbackResumeMode: 'trackAndPosition'`。
  5. **在 settings 里把 `motionPreference` 设为 `'reduced'`**（这是本方案的主战场；也可以用 DevTools Rendering 面板切 `prefers-reduced-motion`，因为默认 `motionPreference: 'system'` 会把它解析成 `reduced`，见 `src/shared/motion.ts:14`）。断言 `document.documentElement.dataset.teMotion === 'reduced'`。
  6. 优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-global-font.cjs` 最贴近本方案，**因为它读计算样式而非截图**。别从零写夹具。
  7. **对 CSS 变量/缓动这类改动，读 `getComputedStyle` 比截图更有力**（能证明 token 真的解析成了目标值）。逐条读：
     - 任一 `<button>`：`getComputedStyle(btn).transitionProperty` 应当是 `opacity, color, background-color, border-color`，`transitionDuration` 应当是 `0.12s`（四个值或单值，取决于浏览器序列化）。**不是** `0.01ms`。
     - 同一按钮：`transitionProperty` 里**不应**出现 `transform` 或 `translate`。
     - 任一非交互元素（比如一个普通 `div`）：`transitionDuration` 仍应是 `0.0001s`（即 0.01ms）—— 证明白名单没有泄漏成通用 `all` 补间。
     - 一个 `.pi-spin` 元素：`animationName` 应当是 `fa-spin`、`animationDuration` `4s`、`animationIterationCount` `infinite`。**不是** `none`。
     - 小窗长歌名的 `.te-scroll-text-inner`（需 `.te-scroll-text` 带 `is-overflowing`）：`animationIterationCount` 应当是 `infinite`，`animationName` 是被 Vue scoped 重写后的 `te-scroll-text-loop`（名字可能带后缀，用 `includes('te-scroll-text-loop')` 判断）。
     - 任一装饰性 infinite 动效元素：`animationName` 应当是 `none`。
     - 每个 CDP 调用给约 45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  8. 眼看确认（DevTools Animations 面板调到 10% 速度做慢放核对）：
     - **`reduced` 档下按下任意按钮，仍有可见的视觉确认**（背景色/透明度变化），不再是「完全没反应」。这是本方案最核心的验收点，也是必须真机确认的那条：0.01ms 下按钮按下完全无反馈是否会被误判为「点击没生效」。
     - 按钮**不再位移**（没有 hover 上浮、没有按压缩放）。
     - loading 转圈仍在转（半速），不是静止图标。
     - 小窗长歌名仍在滚动（半速），不再被截断成不可读。
     - 装饰性光晕/呼吸类动效**停在静态样子**，没有「跑完一帧再定住」的怪异落点。
  9. 再把 `motionPreference` 切到 `'off'`，确认**一切**动效都停（包括 spinner 与跑马灯）——`off` 档必须仍然赢过 `reduced` 档的新规则。
  10. 两个 tone 各跑一次：`settings.theme` 只接受 `'dark' | 'pureWhite' | 'system'`（**没有 `'light'`**），并断言 `document.documentElement.dataset.theme`。
  11. 操作时**别点任何文案含「关闭」的按钮**——会命中标题栏关闭键，应用直接退出。
- **Done when**：
  - `reduced` 档下按钮按下/悬停有 120ms 的 `opacity` + 颜色反馈，且**没有**任何位移。
  - `reduced` 档下非交互元素的 `transition-duration` 仍是 0.01ms（白名单未泄漏成通用补间）。
  - `pi-spin` 与小窗跑马灯在 `reduced` 档继续运行（半速）。
  - 装饰性 infinite 动效在 `reduced` 档是 `animation: none`，落点与 `off` 档一致、可预测。
  - `off` 档仍然全停。
  - `animation-iteration-count: 1 !important` 全仓 0 命中。
  - typecheck / lint / build 通过，`test:app`、`test:playback-routing`、`test:themes`、`test:cross-cutting-regressions` 与改动前基线一致。
  - prettier 有基线，`pnpm run format` 可能顺带重排无关文件；**只提交你自己改的那 3 个文件。**
