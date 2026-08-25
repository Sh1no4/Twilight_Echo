# 014 — 给播放页背景封面过渡减重（去掉 transform、把过渡期 blur 压到 20px 以内）

- **Status**: DONE
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 性能（AUDIT 第 5 节 Performance）
- **Estimated scope**: 1 个文件（`PlayingMusic.vue`），4 个 CSS 规则；纯 CSS 改动，不动模板不动脚本

## Problem

播放页的背景封面在一个 `blur(58px)` 的全屏图层上跑 **700ms 的 transform + opacity 双属性过渡**，而这条过渡**每次换歌都会触发**。

### 位置一：图层本体（58px blur + will-change: transform）

```css
/* src/renderer/src/components/PlayingMusic.vue:872-884 — 当前 */
.backdrop-cover-wrap :deep(img),
.backdrop-cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transform: scale(1.06);
  transform-origin: center;
  filter: blur(58px) saturate(1.28) brightness(0.42);
  will-change: opacity, transform;
}
```

### 位置二：700ms 双属性过渡 + 位移与缩放变化

```css
/* src/renderer/src/components/PlayingMusic.vue:896-921 — 当前 */
.backdrop-cover-fade-enter-active,
.backdrop-cover-fade-leave-active {
  transition:
    opacity 0.7s ease,
    transform 0.7s ease;
}

.backdrop-cover-fade-enter-from {
  opacity: 0;
  transform: translateY(-18px) scale(1.09);
}

.backdrop-cover-fade-enter-to {
  opacity: 1;
  transform: translateY(0) scale(1.06);
}

.backdrop-cover-fade-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1.06);
}

.backdrop-cover-fade-leave-to {
  opacity: 0;
  transform: translateY(18px) scale(1.09);
}
```

### 位置三：主题 token 把 blur 推得更高

```css
/* src/renderer/src/components/PlayingMusic.vue:886-894 — 当前 */
/* Light theme: slightly brighter backdrop art so the stage does not crush blacks */
:global(html[data-theme='light'] .playing-music .backdrop-cover-wrap img),
:global(html[data-theme='pureWhite'] .playing-music .backdrop-cover-wrap img) {
  filter: var(--te-playback-backdrop-filter, blur(58px) saturate(1.22) brightness(0.52));
}

:global(html[data-theme='dark'] .playing-music .backdrop-cover-wrap img) {
  filter: var(--te-playback-backdrop-filter, blur(58px) saturate(1.32) brightness(0.36));
}
```

`--te-playback-backdrop-filter` 由主题预设注入，实际值比 58px 更高：

- `src/shared/themePresets.ts:556` —— `'playback.backdrop.filter': 'blur(72px) saturate(1.04) brightness(0.3)'`
- `src/shared/themePresets.ts:630` —— `'playback.backdrop.filter': 'blur(76px) saturate(1.02) brightness(0.24)'`
- `src/shared/themePresets.ts:1128` —— `'playback.backdrop.filter': 'blur(72px) saturate(0.55) brightness(0.4)'`

### 挂载点

```html
<!-- src/renderer/src/components/PlayingMusic.vue:634-648 — 当前 -->
<Transition name="backdrop-cover-fade" appear>
  <div
    v-if="isBlurBackground && currentTrack"
    :key="`bg:${coverIdentity}`"
    class="backdrop-cover-wrap"
  >
    <CoverImg … class="backdrop-cover" alt="" />
  </div>
</Transition>
```

`:key` 绑在 `coverIdentity`（`:193`）上，所以**换歌必然换 key，必然走一遍 enter + leave**。`isBlurBackground` 是 `nowPlayingBackground === 'blur'`（`:113`），是播放页背景的默认形态之一。

### 为什么这是问题

1. **AUDIT 第 5 节给的过渡期 `filter: blur()` 上限是 20px** —— 原文「Keep transition-time `filter: blur()` under 20px — heavy blur is expensive, especially in Safari」。这里是 **58px**，接近三倍；主题 token 生效时是 72–76px，接近四倍。

2. **`scale(1.09) → scale(1.06)` 让已模糊的全屏图层反复重新光栅化。** blur 的结果无法在缩放后复用 —— 每一个新的 scale 值都要在新尺寸上重跑一遍 58px 的高斯模糊。700ms 内这件事会发生几十次。`translateY` 那一项本身是可合成的，但它和 scale 写在同一条 `transform` 里，一起被卷进重新光栅化。

3. **enter 与 leave 同时在跑时，屏幕上有两个全屏 58px blur 图层并行。** Vue 的 `Transition` 在换 key 时旧节点 leave 与新节点 enter 是重叠的，而 `.backdrop-cover-fade-enter-active` 与 `.backdrop-cover-fade-leave-active` 共用同一条 700ms 声明。

4. **换歌是高频动作。** AUDIT 第 1 节的频次表把「tens of times/day」归为 "Remove or drastically reduce"。

5. **0.7s 越过了两条预算。** AUDIT 第 2 节的 UI 上限是 300ms；本仓设计文档 `docs/apple-music-inspired-hifi-player-design-system.md` 的 P10 也写着「One animation per interaction, ≤ 500 ms for feedback; anything longer must be scrubbable or cancelable」。

## Target

三件事，值全部写死：

**(1) 过渡期只动 `opacity`。** 把 `transform` 从 `transition` 列表里删掉，并把 enter/leave 四个状态类的 `transform` 全部固定在 `scale(1.06)`（与静止态一致），不再有位移与缩放变化。

**(2) 时长从 0.7s 降到 400ms，曲线换成强 ease-out token。**

**(3) 过渡期间把 blur 压到 20px 以内，用更强的 `brightness` 补偿观感。**

目标代码：

```css
/* target — src/renderer/src/components/PlayingMusic.vue，替换 :896-921 */
.backdrop-cover-fade-enter-active,
.backdrop-cover-fade-leave-active {
  transition: opacity 400ms var(--te-ease-out-strong);
}

/* Transition-time blur stays under the 20px budget (AUDIT §5): the heavy
   58px+ pass cannot reuse its rasterized texture while two layers overlap.
   The extra brightness drop keeps the stage as dark as the settled state. */
.backdrop-cover-fade-enter-active :deep(img),
.backdrop-cover-fade-leave-active :deep(img),
.backdrop-cover-fade-enter-active .backdrop-cover,
.backdrop-cover-fade-leave-active .backdrop-cover {
  filter: blur(18px) saturate(1.28) brightness(0.34) !important;
}

.backdrop-cover-fade-enter-from {
  opacity: 0;
  transform: scale(1.06);
}

.backdrop-cover-fade-enter-to {
  opacity: 1;
  transform: scale(1.06);
}

.backdrop-cover-fade-leave-from {
  opacity: 1;
  transform: scale(1.06);
}

.backdrop-cover-fade-leave-to {
  opacity: 0;
  transform: scale(1.06);
}
```

新 token 加进 `src/renderer/src/assets/base.css` 的 token 层，紧跟在 `:31` 的 `--te-ease-out-expo` 之后：

```css
/* target — src/renderer/src/assets/base.css，插在 --te-ease-out-expo 那一行之后 */
/* Strong ease-out for UI enter/exit (AUDIT §2). */
--te-ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);
```

值一字不差：

- 新 token 名 `--te-ease-out-strong`，值 `cubic-bezier(0.23, 1, 0.32, 1)`
- 时长 `400ms`
- 过渡期 filter：`blur(18px) saturate(1.28) brightness(0.34)`
- 四个状态类的 transform 一律 `scale(1.06)`

**若 013 号方案已经落地，`--te-ease-out-strong` 已存在，跳过 token 新增那一步（不要重复定义）。**

`.backdrop-cover` 与 `.backdrop-cover-wrap :deep(img)` 的静止态声明（`:872-884`）**完全不动** —— 静止态仍然是 `blur(58px) saturate(1.28) brightness(0.42)` 与 `transform: scale(1.06)`。改的只是过渡期间的那几百毫秒。

## 必须让执行者理解的取舍（这是本方案最重要的一段）

**58px 的重模糊正是掩蔽「两张封面同时可见」的东西。** 重叠期用户看到的是两团糊光叠在一起，而不是两张能辨认出内容的封面。把 blur 压到 18px 会改变重叠期的观感 —— 有可能出现两张**可辨认**的封面同屏，那是比性能更严重的视觉缺陷。

这就是为什么目标里同时做了三件事而不只是降 blur：

- 时长从 700ms 砍到 400ms，让重叠窗口本身缩短 43%；
- `brightness` 从 0.42 压到 0.34，让过渡期整体更暗、细节更不可辨；
- 18px 仍然在 AUDIT 第 7 节允许的掩蔽范围内（原文「A jarring crossfade that shows two overlapping states can be masked with subtle `filter: blur(2px)` during the transition」—— 18px 远超那个下限，掩蔽力仍然充足）。

**Feel check 必须实拍换歌瞬间**，确认没有出现两张可辨认封面同屏。如果实拍发现能辨认，把 `blur(18px)` 提到 `blur(20px)`（仍在预算内）并把 `brightness` 再压到 `0.30`，**不要**退回 58px。

## Repo conventions to follow

- **动效 token 全住在 `src/renderer/src/assets/base.css:26-40`**：`--te-ease-enter: cubic-bezier(0.4, 0, 0.2, 1)`、`--te-ease-soft: var(--te-ease-out-quint)`、`--te-ease-spring: cubic-bezier(0.22, 1.14, 0.36, 1)`、`--te-ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1)`、`--te-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`、`--te-motion-press: 90ms`、`--te-motion-hover: 160ms`、`--te-motion-panel: 280ms`、`--te-motion-page: 400ms`、`--te-motion-settle: 500ms`、`--te-motion-return: 220ms`。**新曲线必须进这一层，不许在组件里另起一套。**
- 只过渡 `opacity` / `transform` 的样板 —— `src/renderer/src/components/player-bar/PlayerBar.css:43-48`：
  ```css
  .drawer-up-enter-active {
    transition:
      opacity var(--te-motion-panel) ease,
      transform var(--te-motion-page) var(--te-ease-soft);
    transform-origin: right bottom;
  }
  ```
- 「过渡期间临时摘掉 blur」的既有做法 —— `src/renderer/src/components/player-bar/PlayerBar.css:13-17`：
  ```css
  .player-bar-shell.is-geometry-animating .player-bar,
  .player-bar-shell.is-geometry-animating .player-bar-liquid .player-bar-warp {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  ```
  本方案是同一个思路的温和版：不是摘到 `none`，而是降到预算内。
- 该文件里 `:global()` 与 `:deep()` 的用法已成惯例（见 `:872`、`:887`、`:1477`），照抄形式。
- 多属性 `transition` 的排版：每项一行、两空格缩进；单属性写成一行。prettier 会这样格式化。

## Steps

1. 打开 `src/renderer/src/assets/base.css`，定位到 `:31`：

   ```css
   --te-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
   ```

   **先 `grep -n "te-ease-out-strong" src/renderer/src/assets/base.css`。若已命中（013 号方案先落地了），跳到第 2 步。** 否则在 `:31` 后面新增两行（缩进两个空格）：

   ```css
   /* Strong ease-out for UI enter/exit (AUDIT §2). */
   --te-ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);
   ```

   判据：紧邻上方是 `--te-ease-out-expo`，紧邻下方是 `--te-motion-press: 90ms;`。

2. 打开 `src/renderer/src/components/PlayingMusic.vue`，定位到 `:896-901`：

   ```css
   .backdrop-cover-fade-enter-active,
   .backdrop-cover-fade-leave-active {
     transition:
       opacity 0.7s ease,
       transform 0.7s ease;
   }
   ```

   改成（同时插入新的过渡期 filter 规则）：

   ```css
   .backdrop-cover-fade-enter-active,
   .backdrop-cover-fade-leave-active {
     transition: opacity 400ms var(--te-ease-out-strong);
   }

   /* Transition-time blur stays under the 20px budget (AUDIT §5): the heavy
      58px+ pass cannot reuse its rasterized texture while two layers overlap.
      The extra brightness drop keeps the stage as dark as the settled state. */
   .backdrop-cover-fade-enter-active :deep(img),
   .backdrop-cover-fade-leave-active :deep(img),
   .backdrop-cover-fade-enter-active .backdrop-cover,
   .backdrop-cover-fade-leave-active .backdrop-cover {
     filter: blur(18px) saturate(1.28) brightness(0.34) !important;
   }
   ```

   `!important` 是必需的：`:887-894` 的两条 `:global(html[data-theme='…'])` 规则特异性更高（带 `html[attr]` 前缀），不加 `!important` 会被它们的 `--te-playback-backdrop-filter` 压回 72–76px。

3. 在同文件把 enter/leave 四个状态类的 `transform` 全部改成 `scale(1.06)`。改动前是 `:903-921`：

   ```css
   .backdrop-cover-fade-enter-from {
     opacity: 0;
     transform: translateY(-18px) scale(1.09);
   }

   .backdrop-cover-fade-enter-to {
     opacity: 1;
     transform: translateY(0) scale(1.06);
   }

   .backdrop-cover-fade-leave-from {
     opacity: 1;
     transform: translateY(0) scale(1.06);
   }

   .backdrop-cover-fade-leave-to {
     opacity: 0;
     transform: translateY(18px) scale(1.09);
   }
   ```

   改成：

   ```css
   .backdrop-cover-fade-enter-from {
     opacity: 0;
     transform: scale(1.06);
   }

   .backdrop-cover-fade-enter-to {
     opacity: 1;
     transform: scale(1.06);
   }

   .backdrop-cover-fade-leave-from {
     opacity: 1;
     transform: scale(1.06);
   }

   .backdrop-cover-fade-leave-to {
     opacity: 0;
     transform: scale(1.06);
   }
   ```

   四个 `transform` 值必须**完全相同**（`scale(1.06)`），这样即使有别的规则意外把 `transform` 拉进过渡列表，也不会有实际变化可动画。`opacity` 的 0/1 差异保留 —— 那是这条过渡唯一该动的东西。

4. 不做其他任何修改。本方案只有以上编辑。

## Boundaries

- **不要动 `:872-884` 的 `.backdrop-cover-wrap :deep(img), .backdrop-cover` 静止态规则。** 静止态的 `blur(58px) saturate(1.28) brightness(0.42)` 与 `transform: scale(1.06)` 必须一字不变 —— 静止态的视觉是产品既定外观，本方案只碰过渡期的那几百毫秒。特别是 `will-change: opacity, transform` 那一行也保留（`transform` 静止态仍然存在）。
- **不要动 `:886-894` 的两条 `:global(html[data-theme='…'])` filter 规则。** 也不要动 `--te-playback-backdrop-filter` 的 fallback 值。
- **不要动 `src/shared/themePresets.ts`。** 那三处 `blur(72px)` / `blur(76px)` 是主题作者的静止态选择，改它会改变每个主题的既定外观，超出本方案范围。过渡期的 `!important` 已经足够压住它们。
- **不要动模板（`:634-648`）。** 不要改 `<Transition name="backdrop-cover-fade" appear>`、不要改 `:key="` bg:${coverIdentity} `"`、不要改 `v-if="isBlurBackground && currentTrack"`、不要动 `CoverImg`。
- **不要动 `:923-940` 的 `.backdrop-scrim`、`.backdrop-fluid`、`.backdrop-solid`、`.backdrop-accent`。** 那几层的静止态外观与本方案无关。
- **不要动 `:1477-1500` 的 `html[data-te-motion='reduced'] / ['off']` 降级块。** 那些是 `.lyric-row` / `.lyric-word` 的，归 015 号方案的策略。
- **不要给这条过渡新增 `data-te-motion` 分支。** 三档接入归 **015 号方案**。本方案降完时长与 blur 之后，`base.css:425-441` 的通用兜底会把 `reduced`/`off` 两档的 `transition-duration` 压到 0.01ms / `none`，这已经足够。
- **不要动 `PlayingMusic.vue` 里的歌词物理与 MutationObserver（`:205-215`、`:591-597`）。** 那些是仓库内正确的三档 JS 门控范式。
- **不要引入 `--te-neutral-800` / `--te-primary-600`。** 这两个 token 在任何主题都没有定义。
- **不要把 400ms 换成 `var(--te-motion-page)`。** 两者数值相同（都是 400ms），但 `--te-motion-page` 在 `html[data-te-motion='reduced']` 下被重定义为 120ms（`base.css:416`），而这条过渡在 reduced 档已经被通用兜底管住了，套 token 只会让两层降级互相干扰。保留字面量 `400ms`。
- 不要新增依赖，不要改 `package.json`，不要改任何测试文件。
- **若第 2 步或第 3 步找不到匹配的代码（行号漂移、`0.7s` 已被改过、`translateY(-18px) scale(1.09)` 不在原位），停下来报告，不要自行发挥。** 尤其不要凭猜测在别的 `.backdrop-*` 规则上改一处交差。

## Verification

- **Mechanical**：
  - `grep -n "0.7s" src/renderer/src/components/PlayingMusic.vue` —— 应当无命中。
  - `grep -n "translateY(-18px)\|translateY(18px)" src/renderer/src/components/PlayingMusic.vue` —— 应当无命中。
  - `grep -n "scale(1.09)" src/renderer/src/components/PlayingMusic.vue` —— 应当无命中。
  - `grep -c "blur(58px)" src/renderer/src/components/PlayingMusic.vue` —— 计数应当与改动前一致（静止态的 3 处没被误改：`:882`、`:889` fallback、`:893` fallback）。
  - `pnpm run lint` —— 应当通过。
  - `pnpm run typecheck` —— 纯 CSS 改动，不应有类型错误。
  - `pnpm run test:app` —— 包含 `src/renderer/src/app/useMotionPreference.test.ts`，其 `:65-67` 断言 `PlayingMusic.vue` 含 `te-playing-artwork-arrive`、含 `lyrics-column--depth`、且 **`assert.doesNotMatch(playingMusic, /transition: all/)`**。本方案不引入 `transition: all`，也不删那两个类名，不应变红。同档还有 `src/renderer/src/components/PlayingMusic.test.ts`。
  - `pnpm run test:lyrics-management` —— 包含 `PlayingMusic.test.ts` 与 `PlayingMusic.lyrics.behavior.test.ts`，都不应变红。
  - `pnpm run test:themes` —— 包含 `themeColorAudit.test.ts`、`themeTokenization.test.ts`、`scripts/theme-visual-regression.test.cjs`。本方案不改 `themePresets.ts`、不引入渐变 token 进颜色槽，不应变红。
  - `pnpm run build` —— 应当构建成功。
  - **注意：HEAD（9312f3e）上本来就有 3 条测试是红的。** 跑套件前先在未改动的工作树上记一次基线，只对比新增的失败。
- **Feel check**（真实渲染，必须实拍换歌瞬间）：先 `npx electron-vite build` 让 `out/` 带上改动，再用隔离 profile 启动 + CDP：
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`。
  - **播放栏与播放页只在有当前曲目时挂载**：seed `<profile>/playback-session.json`（`{version:1, savedAt, mode:'trackAndPosition', track, position, queue, queueIndex}`，塞一个真 `duration`）+ settings 里 `playbackResumeMode: 'trackAndPosition'`。**queue 里至少放两首带不同封面的曲目**，否则换不了歌、这条过渡永远不触发。
  - **必须确认背景形态是 blur**：`isBlurBackground` 要求 `nowPlayingBackground === 'blur'`。在 CDP 里读回确认 `.backdrop-cover-wrap` 存在于 DOM，否则先在设置里把播放页背景切到「模糊封面」。
  - 优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-playbar-shapes.cjs`（支持 `TE_THEME=` / `TE_PRESET=` / `TE_PORT=`）最贴近，它已经有 seed 播放会话 + 打开播放页的流程。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。窗口 `deviceScaleFactor` 是 1.5，截图 clip 是 CSS px 但 PNG 带缩放，用 `png.width / clipWidth` 反推。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
  - **读 `getComputedStyle` 比截图更有力**。要断言的：
    - 静止态：对 `.backdrop-cover-wrap img` 读 `getComputedStyle(el).filter`，应当仍然包含 `blur(58px)`（或主题 token 的 72/76px）—— **证明静止态没被改坏，这是本方案最重要的回归断言**。
    - 静止态：`getComputedStyle(el).transform` 应当仍然是 `scale(1.06)` 的矩阵形式（`matrix(1.06, 0, 0, 1.06, 0, 0)`）。
    - 过渡中：在触发换歌后立刻（同一帧内，用 `requestAnimationFrame` 里读）对 `.backdrop-cover-fade-enter-active` 下的 img 读 `getComputedStyle(el).filter`，应当包含 `blur(18px)`，**不含 `blur(58px)` / `blur(72px)` / `blur(76px)`**。
    - 过渡中：读 `getComputedStyle(el).transitionProperty`，应当**只有 `opacity`**，不含 `transform`。
    - 过渡中：读 `getComputedStyle(el).transitionDuration` 应当是 `0.4s`；`transitionTimingFunction` 应当是 `cubic-bezier(0.23, 1, 0.32, 1)`。
  - **必须实拍的那一项（取舍验证）**：连续截图换歌瞬间。做法：在 `Runtime.evaluate` 里触发下一曲，然后以约 60ms 间隔连拍 8 张 `Page.captureScreenshot`（clip 到全窗口）。逐张检查：
    - **重叠期不能出现两张可辨认的封面同屏。** 判据是「看不出是两张不同的图」—— 如果能看出上一首的封面轮廓、文字、人脸，就是失败。
    - 失败时的处置：把 `blur(18px)` 提到 `blur(20px)`（仍在 AUDIT 的 20px 预算内）并把 `brightness(0.34)` 压到 `brightness(0.30)`，再拍一次。**不要退回 58px** —— 那等于放弃本方案。
    - 若 20px + 0.30 仍然可辨认，停下来报告实拍结果，让人来定：这说明这条过渡需要改成「先淡出旧图到底、再淡入新图」的两段式（不重叠），那是超出本方案范围的结构改动。
  - 要用眼睛确认的其他项：
    - 换歌时背景**不再有可见的上下位移与推近感** —— 只是一张糊光换成另一张。
    - 换歌反馈**明显更快** —— 400ms 对比原来的 700ms。
    - 快速连点「下一曲」5 次，背景不应出现堆叠卡顿；`transition` 会 retarget，不会从零重启。
  - **性能取证**：DevTools Performance 面板录制「连点下一曲 5 次」这一个动作，改动前后各录一段 trace，比对 **Paint** 与 **Composite Layers** 的帧占用。改后 Paint 应当明显下降（58px blur 在 700ms 内反复以新 scale 重跑的那部分消失了）。也可以在 `Runtime.evaluate` 里用 `performance.now()` 采样连续 60 帧的间隔，改后掉帧应当减少。
  - 两个 tone 各跑一次：`settings.theme` 只接受 `'dark' | 'pureWhite' | 'system'`（没有 `'light'`，会落到 system 进而在本机解析成 dark），并断言 `document.documentElement.dataset.theme`。**这一点对本方案特别重要** —— `:887-894` 的两条主题规则走不同分支，暗色的 `brightness(0.36)` 与浅色的 `brightness(0.52)` 观感差异大，两档都要确认掩蔽力够。若装有那三个 `blur(72px)/blur(76px)` 的主题预设，再单独跑一次确认 `!important` 真的压住了 token。
  - 在 DevTools Rendering 面板打开 `prefers-reduced-motion`，确认 `base.css:425-441` 的通用兜底把这条过渡压到 0.01ms / `none`，换歌变成瞬时切换但不闪黑。
- **Done when**：
  - `grep -n "0.7s\|translateY(-18px)\|translateY(18px)\|scale(1.09)" src/renderer/src/components/PlayingMusic.vue` 无命中。
  - `grep -n "blur(18px)" src/renderer/src/components/PlayingMusic.vue` 命中 1 次（过渡期规则）。
  - `grep -c "blur(58px)" src/renderer/src/components/PlayingMusic.vue` 与改动前计数一致。
  - `grep -c "scale(1.06)" src/renderer/src/components/PlayingMusic.vue` 应当比改动前多 2（原本 3 处 → 现在 5 处：静止态 1 + 四个状态类 4）。
  - `pnpm run lint`、`pnpm run typecheck`、`pnpm run build` 通过；`test:app`、`test:lyrics-management`、`test:themes` 的失败数不超过 HEAD 基线的 3 条。
  - 真实渲染断言全部通过：静止态 filter 仍含 58px、过渡期 filter 含 18px、`transitionProperty` 只有 `opacity`。
  - **换歌连拍的 8 张截图里，没有一张能辨认出两张不同封面。**
