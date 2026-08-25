# 002 — 修复全局按压反馈：消除缩放相乘、按住时保持压下、可打断

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 物理性与变换原点 + 可打断性（AUDIT 第 3 节 Physicality & origin、第 4 节 Interruptibility）
- **Estimated scope**: 6 个文件（`base.css` 1 处规则 + 1 个 keyframes 删除，`PlayerBar.css` 3 处，`MiniPlayer.css` 1 处，`TitleBar.vue` 1 处，`OnboardingWizard.css` 1 处，`useMotionPreference.test.ts` 1 处断言），约 40 行改动

## Problem

全局按压反馈同时踩了三条 AUDIT 规则，并且会与组件级 `transform` **相乘**，把幅度推到区间外。

### 全局规则：用 keyframes 做按压

```css
/* src/renderer/src/assets/base.css:385-390 — 当前 */
html[data-te-motion='full']
  :where(button, [role='button'], [role='switch'], [data-te-interactive]):not(:disabled):not(
    [aria-disabled='true']
  ):active {
  animation: te-interactive-press var(--te-motion-press) var(--te-ease-soft);
}
```

```css
/* src/renderer/src/assets/base.css:401-410 — 当前 */
@keyframes te-interactive-press {
  0%,
  100% {
    scale: 1;
  }

  48% {
    scale: var(--te-motion-press-scale);
  }
}
```

相关 token：

```css
/* src/renderer/src/assets/base.css:32 与 :39 — 当前 */
--te-motion-press: 90ms;
--te-motion-press-scale: 0.96;
```

覆盖面极大：`data-te-interactive` 在 `.vue` 里 97 处（另有 5 处在 css 里），`role="button"` 26 处，再加上全部原生 `<button>`。默认设置是 `motionPreference: 'system'`（`src/main/core/settings.ts:156`），而 `resolveMotionMode`（`src/shared/motion.ts:10-16`）在无系统减弱偏好时解析为 `'full'`，所以 `html[data-te-motion='full']` 就是绝大多数用户的默认状态。这是全应用最高频的交互路径。

### 相乘：组件自己又写了一遍 `transform: scale()`

关键机制：**keyframes 动的是 `scale`（独立变换属性），组件动的是 `transform`。两者是不同的 CSS 属性，按规范独立变换属性先于 `transform` 应用，因此二者相乘，不是互相覆盖。**

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:1270-1273 — 当前 */
.ctrl-btn:active {
  transform: scale(0.88);
  transition-duration: 0.1s;
}
```

`.ctrl-btn` 就是播放 / 暂停 / 上一首 / 下一首（`src/renderer/src/components/PlayerBar.vue:1787` 的 `class="ctrl-btn btn-play"`，`:1783` 的 `class="ctrl-btn previous-button"`，`:1794` 的 `class="ctrl-btn next-button"`）。有效缩放 = `0.96 × 0.88 = 0.845`。

同一文件还有两处同样的 `0.88`：

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:1810-1813 — 当前 */
.mode-btn-right:active {
  transform: scale(0.88);
  transition-duration: 0.1s;
}
```

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:1908-1911 — 当前 */
.icon-btn:active {
  transform: scale(0.88);
  transition-duration: 0.1s;
}
```

```css
/* src/renderer/src/mini-player/MiniPlayer.css:642-646 — 当前 */
.mini-tool-button:active,
.mini-control-button:active,
.mini-play-button:active {
  transform: scale(0.88);
}
```

```css
/* src/renderer/src/components/TitleBar.vue:340-343 — 当前 */
.control-btn:active {
  transform: scale(0.88);
  transition-duration: 0.1s;
}
```

```css
/* src/renderer/src/components/onboarding/OnboardingWizard.css:855-857 — 当前 */
.onb-swatch:active {
  transform: scale(0.94);
}
```

`.onb-swatch` 是 `<button>`（`src/renderer/src/components/onboarding/steps/StepWelcome.vue:160-164`），有效缩放 = `0.96 × 0.94 = 0.902`。

AUDIT 第 3 节要求按压幅度**保持在 0.95–0.98**。`0.845` 超出下界一倍以上，读起来是「按钮塌进去」而不是「材质受力」。

### 三重违规

**(a) 按住期间不存在压下状态。** keyframes 的 `100% { scale: 1 }` 让元素在手指还按着的时候就已经弹回原大小——90ms 后无论手指是否松开，按钮都回到 `scale: 1`。AUDIT 第 3 节要求的是 `:active` + `transition` 保持压下，松手才回弹。现在的实现是「戳一下抖一抖」，不是按压。

**(b) 连点从零重启，不 retarget。** AUDIT 第 4 节：「CSS **transitions** retarget from the current state mid-animation; **keyframes** restart from zero. Anything triggered rapidly or reversible mid-motion … must use transitions or springs.」按钮是最典型的高频重复触发目标，每次 `:active` 都让 keyframes 从 `scale: 1` 重放。这也违反本仓设计文档自己的约定：

- `docs/apple-music-inspired-hifi-player-design-system.md:81` 的 P5：「Motion is interruptible … All animations use springs; interrupting an animation must continue from the current value (no reset).」
- 同文件 `:622` 的 Interruption rule：「springs retarget from current value on new input; duration-based animations must expose `cancel()` and jump to target state instantly.」

**(c) 幅度因相乘远超区间**，见上。

### 另一个问题：对称时序

`48%` 把 90ms 对半切：约 43ms 下压 + 47ms 回弹。按下与松开一样快。AUDIT 第 4 节：「**Asymmetric timing**: deliberate phases (press, hold, destructive confirm) animate slower; the system's response snaps. **Symmetric timing on press-and-release is a finding.**」

### 与方案 010 的交叉（必须留意）

`src/renderer/src/components/player-bar/PlayerBar.css:1309-1317` 有另一个动 `scale` 的 `animation`：

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:1309-1317 — 当前 */
:global(html[data-te-motion='full'] .btn-play.is-playing) {
  animation: player-play-confirm var(--te-motion-panel) var(--te-ease-spring) both;
}

@keyframes player-play-confirm {
  46% {
    scale: 1.1;
  }
}
```

`.btn-play` 同时带 `.ctrl-btn`（`PlayerBar.vue:1787`：`class="ctrl-btn btn-play"`），所以这个按钮上曾有两个 `animation` 声明同时挂 `scale`：全局的 `te-interactive-press`（来自 `base.css:389`）和这个 `player-play-confirm`。`animation` 是同一属性，特异性高的那条整体胜出，**两者互相顶掉**——播放确认动效会在按压期间被吃掉，或反之。`src/renderer/src/mini-player/MiniPlayer.css:648-656` 有同构的 `mini-play-confirm`。

**本方案把全局按压从 `animation` 改成 `transition` + `transform`，正好解开这个冲突**：改完之后 `player-play-confirm` / `mini-play-confirm` 独占 `animation` 通道，按压独占 `transform` 通道，不再互斥。`player-play-confirm` 自身的问题（keyframes 做状态反馈、`scale: 1.1` 过冲）归方案 010，本方案不动它。

## Target

单一来源的按压反馈：全局用 `transition` + `transform: scale(0.97)`，组件级不再各写一份 `scale`，`te-interactive-press` keyframes 删除。

```css
/* target — src/renderer/src/assets/base.css，替换 :385-390 的规则 */
/* Press feedback is a transition, not a keyframe: a transition retargets from
   the current scale when the button is tapped again mid-flight, and it holds the
   pressed state for as long as the pointer is down. Asymmetric on purpose —
   `:active` presses in over --te-motion-press (90ms) and the release rides the
   longer base duration (160ms) below. */
html[data-te-motion='full']
  :where(button, [role='button'], [role='switch'], [data-te-interactive]):not(:disabled):not(
    [aria-disabled='true']
  ) {
  transition:
    translate var(--te-motion-hover) var(--te-ease-soft),
    transform 160ms var(--te-ease-soft);
}

html[data-te-motion='full']
  :where(button, [role='button'], [role='switch'], [data-te-interactive]):not(:disabled):not(
    [aria-disabled='true']
  ):active {
  transform: scale(var(--te-motion-press-scale));
  transition-duration: var(--te-motion-hover), var(--te-motion-press);
}
```

```css
/* target — src/renderer/src/assets/base.css:39 */
--te-motion-press-scale: 0.97;
```

`@keyframes te-interactive-press`（现 `base.css:401-410`）**整块删除**。

组件级的六处 `:active` 缩放全部去掉 `transform` 行，只保留各自其它声明：

```css
/* target — src/renderer/src/components/player-bar/PlayerBar.css，原 .ctrl-btn:active */
/* Press scale comes from the global :active rule in base.css; a local
   transform: scale() would multiply with it (scale and transform are separate
   properties) and overshoot the 0.95–0.98 press range. */
.ctrl-btn:active {
  transition-duration: 0.1s;
}
```

`.mode-btn-right:active`、`.icon-btn:active`、`.control-btn:active` 同理（保留 `transition-duration: 0.1s;`）。`.mini-tool-button:active, .mini-control-button:active, .mini-play-button:active` 与 `.onb-swatch:active` 整条规则删除（它们除 `transform` 外没有别的声明）。

数值依据（都是照抄，不是估的）：

- `scale(0.97)` + `transition: transform 160ms` 直接来自 AUDIT 第 3 节：「**Press feedback**: `transform: scale(0.97)` on `:active` with `transition: transform 160ms ease-out`. Keep it subtle (0.95–0.98).」
- 缓动用 `var(--te-ease-soft)`，方案 001 定它为 `cubic-bezier(0.22, 1, 0.36, 1)`（强 ease-out），符合 AUDIT 第 3 节要求的 ease-out。**不要在这里写裸 cubic-bezier。**
- 非对称时序：按下 `var(--te-motion-press)` = 90ms（快，因为系统响应要 snap），松开 160ms（慢，材质回弹）。这满足 AUDIT 第 4 节的 asymmetric 要求，也落在第 2 节的 button press feedback 预算 100–160ms 内。
- 注意本仓设计文档 `docs/apple-music-inspired-hifi-player-design-system.md:81`（P4）写「Press feedback ≤60 ms」，与 AUDIT 的 160ms 冲突。**以 AUDIT 为准**：文档那句说的是「按下必须在 60ms 内**开始有反应**」，而 160ms 是回弹**走完**的时长；transition 从第一帧就开始动，两者不矛盾。不要因为看到 60ms 就把时长改小。

## Repo conventions to follow

- 动效 token 全住在 `src/renderer/src/assets/base.css:26-40`。本方案改 `--te-motion-press-scale` 的值，不新增 token，也不在组件里另起曲线。
- 全局交互规则的既有写法就在隔壁，照它的选择器格式写：

  ```css
  /* src/renderer/src/assets/base.css:367-370 — 现有样板 */
  :where(button, [role='button'], [role='switch'], [data-te-interactive]) {
    -webkit-tap-highlight-color: transparent;
    transition: translate var(--te-motion-hover) var(--te-ease-soft);
  }
  ```

- **可打断按压的正面样板：`src/renderer/src/utils/liquidGlassPress.ts`。**它用带速度继承的弹簧做按压：press `{ mass: 1, stiffness: 420, damping: 34 }`（`liquidGlassPress.ts:17`）、release `{ mass: 1, stiffness: 260, damping: 38 }`（`:19`），目标缩放 `LIQUID_GLASS_PRESS_TARGET_SCALE = 0.96`（`:14`），文件头注释写明「a press that is released mid-flight keeps its velocity instead of restarting from rest」。底层是 `src/renderer/src/utils/lyricSpring.ts` 的 `solveLyricSpring(from, velocity, to, params)`（`lyricSpring.ts:61-66`），可注入速度。
  **本方案不要改成 JS 弹簧**——那条路已经存在，只覆盖 liquid glass 表面（`base.css:3133` 的 `transform: scale(var(--te-lg-press-scale, 1))`），全局 97+ 个交互元素不该都挂 rAF。CSS transition 已经满足「retarget from current state」，这正是 AUDIT 第 4 节认可的做法。这里引用它是为了让你知道：**这个仓库对按压的正确理解已经写在代码里了，照那个语义做，别退回 keyframes。**
- 降级模式的写法参考 `src/renderer/src/mini-player/MiniPlayer.css:1036-1045`（全仓唯一真正做到「减少而非清零」的降级块）。本方案不改降级逻辑，那是方案 003 的范围。

## Steps

1. 打开 `src/renderer/src/assets/base.css`，把第 39 行 `  --te-motion-press-scale: 0.96;` 改成 `  --te-motion-press-scale: 0.97;`。同一段的 `--te-motion-hover-translate: -1px;`（第 40 行）不要动。
2. 同一文件，把第 385-390 行整条规则

   ```css
   html[data-te-motion='full']
     :where(button, [role='button'], [role='switch'], [data-te-interactive]):not(:disabled):not(
       [aria-disabled='true']
     ):active {
     animation: te-interactive-press var(--te-motion-press) var(--te-ease-soft);
   }
   ```

   替换成 Target 段给出的两条规则（带注释的基础 transition 规则 + `:active` 规则）。注意 `:active` 规则里的 `transition-duration: var(--te-motion-hover), var(--te-motion-press);` 是两个值，按 `transition` 简写里 `translate, transform` 的顺序对应，逗号和顺序都不要动。

3. 同一文件，删除第 401-410 行整个 `@keyframes te-interactive-press { … }` 块（含 `0%, 100% { scale: 1; }` 和 `48% { scale: var(--te-motion-press-scale); }`）。删完检查上下不要留下连续两个空行。已核查全仓没有任何测试断言 `te-interactive-press`，可以安全删除。
4. 打开 `src/renderer/src/components/player-bar/PlayerBar.css`，第 1270-1273 行 `.ctrl-btn:active { transform: scale(0.88); transition-duration: 0.1s; }`：删掉 `transform: scale(0.88);` 这一行，保留 `transition-duration: 0.1s;`，并在规则上方加 Target 段给出的三行注释。
5. 同一文件第 1810-1813 行 `.mode-btn-right:active`：同样只删 `transform: scale(0.88);`，保留 `transition-duration: 0.1s;`。不需要重复加注释。
6. 同一文件第 1908-1911 行 `.icon-btn:active`：同样只删 `transform: scale(0.88);`，保留 `transition-duration: 0.1s;`。
7. 打开 `src/renderer/src/mini-player/MiniPlayer.css`，删除第 642-646 行整条规则：

   ```css
   .mini-tool-button:active,
   .mini-control-button:active,
   .mini-play-button:active {
     transform: scale(0.88);
   }
   ```

   这三个选择器都是 `<button>`（`src/renderer/src/mini-player/MiniPlayerApp.vue:398/408/418/428/437` 是 `.mini-tool-button`，`:556/569` 是 `.mini-control-button`，`:579` 是 `.mini-play-button`），会被 base.css 的全局 `:where(button, …)` 规则覆盖到。**注意**：小窗走的是同一个 `src/renderer/index.html` + `src/main.ts`（`src/main.ts:1` 就 `import './assets/main.css'`，而 `src/renderer/src/assets/main.css:3` `@import './base.css'`），所以 base.css 在小窗里同样生效。

8. 打开 `src/renderer/src/components/TitleBar.vue`，第 340-343 行 `.control-btn:active`：只删 `transform: scale(0.88);`，保留 `transition-duration: 0.1s;`。**不要动第 432-435 行的 `.title-bar-liquid :is(.menu-btn, .settings-btn, .plugins-btn, .login-btn, .control-btn):active { transform: scale(0.94); transition-duration: 90ms; }`**——它是 liquid glass 皮肤下的独立表现，`0.94` 也在别处成对出现，属于后续方案。
9. 打开 `src/renderer/src/components/onboarding/OnboardingWizard.css`，删除第 855-857 行整条规则 `.onb-swatch:active { transform: scale(0.94); }`。
10. 打开 `src/renderer/src/app/useMotionPreference.test.ts`，找到第 61 行 `assert.match(baseCss, /transition: translate var\(--te-motion-hover\)/)`。Target 的基础规则里 `transition:` 后换行了，这条正则要求 `transition: translate var(--te-motion-hover)` 在同一行——而 `base.css:367-370` 那条既有规则**仍然是单行写法且没被本方案改动**，所以这条断言仍然通过，**不需要改**。但要**新增**一条断言按压走 transition 而非 keyframes，插在第 63 行 `assert.match(baseCss, /\[aria-disabled='true'\]/)` 之后：

    ```ts
    // Press feedback must retarget mid-flight: a transition, never a keyframe.
    assert.match(baseCss, /transform: scale\(var\(--te-motion-press-scale\)\)/)
    assert.doesNotMatch(baseCss, /te-interactive-press/)
    ```

    该文件已登记在 `package.json` 的 `test:app` 脚本里（无需新增登记）。同文件第 62 行 `assert.match(baseCss, /--te-ease-spring/)` 仍然通过（`base.css:29` 还在定义它）；第 68 行 `assert.match(miniPlayerCss, /html\[data-te-motion='reduced'\] .mini-player-root/)` 也仍然通过（第 7 步只删了 `:active` 规则，没碰 `MiniPlayer.css:1036`）。

11. 全仓搜索 `scale(0.88)`，确认只剩你没动的地方；再搜 `te-interactive-press`，应当 0 命中。

## Boundaries

- 不要动 `src/renderer/src/components/player-bar/PlayerBar.css:1309-1317` 的 `player-play-confirm`（含 `scale: 1.1`）与 `src/renderer/src/mini-player/MiniPlayer.css:648-656` 的 `mini-play-confirm`。它们归方案 010。本方案只是解开与它们的 `animation` 通道冲突。
- 不要动 `src/renderer/src/components/TitleBar.vue:432-435`（liquid glass 皮肤的 `scale(0.94)`）。
- 不要动这些已经在用 `var(--te-motion-press-scale)` 的 `:active` 规则——它们会自动跟着 token 从 0.96 变 0.97，**但它们与全局规则同样构成相乘**，属于后续方案，本方案不碰：`src/renderer/src/components/LocalDashboard.css:238`、`:440`、`:703`；`src/renderer/src/components/onboarding/OnboardingWizard.css:662`、`:768`、`:922`、`:1016`、`:1313`、`:1787`；`src/renderer/src/components/StreamingDiscovery.vue:771`；`src/renderer/src/components/StreamingHome.vue:665`、`:1536`；`src/renderer/src/components/LoginPage.vue:1984`；`src/renderer/src/assets/base.css:3296-3302`；`src/renderer/src/components/settings-page/SettingsPage.css:261`；`src/renderer/src/components/SideMenu.vue:543`；`src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.css:124`。
  （相乘之所以在本方案可以先不管这批：`0.97 × 0.96 = 0.931` 与 `0.97 × 0.97 = 0.941`，虽仍略低于 0.95，但已从 `0.845` 大幅收敛；先把最刺眼的 `0.88` 族清掉。）
- 不要动 `src/renderer/src/utils/liquidGlassPress.ts` 及其常量（`liquidGlassPress.test.ts:100` 逐字断言 `variables['--te-lg-press-scale'] === '0.9781'`，改弹簧参数会直接弄红它）。
- 不要动 `src/renderer/src/assets/base.css:392-399` 的 hover translate 规则、`:412-419` 的 `reduced` token 块、`:425-441` 的 `reduced` / `off` 兜底块。降级归方案 003。
- 不要动 `src/renderer/src/components/player-bar/CompactPlayerBarVisualizer.vue:70` 的 `transition: transform 55ms linear;`——`src/renderer/src/components/player-bar/compactPlayerBarStructure.test.ts:103` 逐字钉住它（`/transition:\s*transform 55ms linear/`）。
- 不要动 markup / 结构，只改动效属性。不要新增依赖。不要引入对 `--te-neutral-800` / `--te-primary-600` 的引用。
- 不要在任何组件里写裸 cubic-bezier（`src/renderer/src/components/onboarding/OnboardingWizard.test.ts:61` 的 `assert.doesNotMatch(css, /cubic-bezier\(/)` 会直接抓到 OnboardingWizard.css 里的任何一处）。
- **如果某一步描述的代码与你实际看到的不一致（行号漂移、值已被改过），停下来报告，不要自行发挥。**

## Verification

- **Mechanical**：
  - `pnpm run typecheck` 应当通过。
  - `pnpm run lint` 应当通过。
  - **先在改动前把下面几套各跑一遍记基线**——HEAD 上本来就有 3 条测试是红的，别把既有失败算到自己账上。
  - `pnpm run test:app` —— 内含 `src/renderer/src/app/useMotionPreference.test.ts`（第 10 步改的那个）和 `src/renderer/src/components/onboarding/OnboardingWizard.test.ts`（第 61 行禁裸曲线）。预期全绿（除基线红项）。
  - `pnpm run test:playback-routing` —— 内含 `src/renderer/src/components/SideMenu.test.ts`（钉 App.vue / SideMenu.vue / PlayerBar.css 的 `var(--te-ease-soft)` 写法与 4 条裸曲线，本方案没碰这些）、`src/renderer/src/components/player-bar/compactPlayerBarStructure.test.ts:103`（钉 `transform 55ms linear`）、`src/renderer/src/mini-player/styles.test.ts`。预期与基线一致。
  - `pnpm run test:themes` —— 内含 `src/renderer/src/utils/liquidGlassPress.test.ts`（钉 `'0.9781'`）与 `src/renderer/src/components/liquidGlassSurfaces.test.ts`。预期与基线一致。
  - 搜索确认：`grep -rn "te-interactive-press" src/` 应当 0 命中；`grep -rn "scale(0.88)" src/renderer` 应当只剩你有意保留的（本方案改完应为 0 命中）。
  - `pnpm run build`（含 typecheck + electron-vite build + strip 字体 + verify:renderer-budgets）应当通过。
- **Feel check**（必须走真实渲染，不许用简化替身当证据）：
  1. `npx electron-vite build`，让 `out/` 带上改动。
  2. 隔离 profile 启动：`node_modules/electron/dist/electron.exe . --user-data-dir=<临时目录，正斜杠>`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  3. seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，把 `<profile>/music-library.json` 覆盖成 `{"version":2,"revision":1,"tracks":[],"folders":[],"exclusions":[]}`，并预写 `<profile>/plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`。
  4. **播放栏只在有当前曲目时挂载**，而本方案要测的 `.ctrl-btn` 就在播放栏上：seed `<profile>/playback-session.json`（`{version:1, savedAt, mode:'trackAndPosition', track, position, queue, queueIndex}`，`track` 从扫描出的库里取并塞一个真的 `duration`），并在 settings 里设 `playbackResumeMode: 'trackAndPosition'`。
  5. 优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-playbar-shapes.cjs`（播放条三形态，支持 `TE_THEME=` / `TE_PRESET=` / `TE_PORT=`）最贴近本方案。别从零写夹具。
  6. 每个 CDP 调用给约 45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。窗口 `deviceScaleFactor` 是 1.5，截图 clip 是 CSS px 但 PNG 带缩放，用 `png.width / clipWidth` 反推。
  7. **读计算样式比截图更有力**：对播放按钮派发 `pointerdown` 后读 `getComputedStyle(btn).transform`，应当解析为 `matrix(0.97, 0, 0, 0.97, 0, 0)` 一类（**不是** `0.845`，也不是 `0.88`）；同时读 `getComputedStyle(btn).scale`，应当是 `'none'` 或 `'1'`（证明 keyframes 那条通道已经空出来了）。
  8. 眼看确认（DevTools Animations 面板调到 10% 速度做慢放核对）：
     - **按住播放按钮不放**，按钮应当**保持**在压下状态（缩小 3%），而不是压一下就自己弹回原大小。
     - **松手**才回弹，且回弹比压下慢（90ms 压下 / 160ms 回弹）。
     - **连点播放按钮 5 次**，每次都从当前缩放继续，绝不出现「跳回 scale 1 再重放」的顿挫。
     - 幅度是「材质受力」的微沉，不是「按钮塌进去」。
     - 播放按钮的播放确认动效（`player-play-confirm`）与按压不再互相顶掉。
  9. Rendering 面板切 `prefers-reduced-motion` 核对降级：`html[data-te-motion]` 应当变成 `reduced`，全局按压规则（只挂 `full`）随之不生效。**注意 `reduced` 档目前是全灭的（0.01ms），那是方案 003 要修的问题，不是本方案的回归。**
  10. 操作时**别点任何文案含「关闭」的按钮**——会命中标题栏关闭键，应用直接退出。
- **Done when**：
  - `@keyframes te-interactive-press` 已从 `base.css` 删除，全仓 0 命中。
  - 播放 / 暂停 / 上一首 / 下一首、小窗控制键、标题栏控制键、onboarding 色板的按压有效缩放都是 `0.97`（单一来源，不再相乘）。
  - 按住不放时按钮保持压下；松手才回弹；连点从当前值 retarget。
  - 按下 90ms / 回弹 160ms，非对称。
  - typecheck / lint / build 通过，`test:app`、`test:playback-routing`、`test:themes` 与改动前基线一致。
  - prettier 有基线，`pnpm run format` 可能顺带重排无关文件；**只提交你自己改的那 6 个文件。**
