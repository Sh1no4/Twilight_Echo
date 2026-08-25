# 006 — 从液态玻璃卡片的过渡里删掉 filter / backdrop-filter

- **Status**: DONE
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 性能（AUDIT 第 5 节 Performance）
- **Estimated scope**: 1 个文件，1 条 `transition` 声明（删 3 个属性项），纯 CSS

## Problem

液态玻璃的展开态卡片把 `filter` 与 `backdrop-filter` 写进了 `transition` 列表，而**同一批属性正好是 IntersectionObserver 预算机制每次滚动都要开关的那两个**。结果预算机制想省下的滤镜 pass，被这条过渡逐帧复活。

### 位置一：过渡声明

选择器起于 `src/renderer/src/assets/base.css:3155`，覆盖 9 个卡片类：

```css
/* src/renderer/src/assets/base.css:3155-3166 — 当前（选择器头部） */
html[data-te-liquid-glass-coverage='expanded']
  :is(
    .artist-card,
    .album-card,
    .playlist-card,
    .glass-card,
    .signal-card,
    .chart-card,
    .profile-card,
    .recent-card,
    .ranking-card
  )::after {
```

同一条规则的尾部，`src/renderer/src/assets/base.css:3236-3248`：

```css
/* src/renderer/src/assets/base.css:3236-3248 — 当前 */
  backdrop-filter: blur(var(--te-lg-expanded-blur, 16px))
    saturate(var(--te-lg-expanded-saturate, 150%));
  -webkit-backdrop-filter: blur(var(--te-lg-expanded-blur, 16px))
    saturate(var(--te-lg-expanded-saturate, 150%));
  filter: url(#te-lg-expanded-card);
  opacity: 1;
  transition:
    opacity 180ms ease,
    transform 180ms ease,
    filter 180ms ease,
    backdrop-filter 180ms ease,
    -webkit-backdrop-filter 180ms ease;
}
```

### 位置二：预算类把这两个属性切成 `none`，正好命中上面的 transition

```css
/* src/renderer/src/assets/base.css:3469-3477 — 当前 */
/* The observer keeps the expensive refraction budget bounded. Budgeted and
   offscreen cards retain a translucent surface, but never create a filter pass. */
html[data-te-liquid-glass-coverage='expanded']
  :is(.te-liquid-glass-budget, .te-liquid-glass-offscreen)::after {
  background: rgba(var(--te-lg-surface-rgb, 255, 255, 255), 0.16) !important;
  filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
```

注意这条规则自己的注释就写明了意图：「never create a filter pass」。但它命中的元素继承了 `:3242-3247` 的 transition，所以 `url(#te-lg-expanded-card) → none` 和 `blur(16px) saturate(150%) → none` 都变成了 180ms 的滤镜过渡动画，而不是瞬时切换。

### 位置三：谁在开关这两个类

```javascript
// src/renderer/src/components/LiquidGlassDefs.vue:737-745 — 当前
  surfaceVisibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle(LIQUID_GLASS_OFFSCREEN_CLASS, !entry.isIntersecting)
      }
      syncExpandedSurfaceBudget()
    },
    { rootMargin: '128px 0px' }
  )
```

```javascript
// src/renderer/src/components/LiquidGlassDefs.vue:713-724 — 当前
function syncExpandedSurfaceBudget(): void {
  if (!props.expandedActive) return
  const visible = Array.from(
    document.querySelectorAll<HTMLElement>(LIQUID_GLASS_EXPANDED_SURFACE_SELECTOR)
  ).filter((surface) => !surface.classList.contains(LIQUID_GLASS_OFFSCREEN_CLASS))
  for (const [index, surface] of visible.entries()) {
    surface.classList.toggle(
      LIQUID_GLASS_BUDGET_CLASS,
      index >= LIQUID_GLASS_MAX_VISIBLE_EXPANDED_SURFACES
    )
  }
}
```

`LIQUID_GLASS_MAX_VISIBLE_EXPANDED_SURFACES = 24`，定义在 `src/shared/liquidGlass.ts:28`。

### 后果

滚动一屏卡片网格时：

1. 每张卡穿过 `rootMargin: '128px 0px'` 的边界就 toggle 一次 `te-liquid-glass-offscreen`。
2. 每次 toggle 又触发一次 `syncExpandedSurfaceBudget()`，可见卡片重新排序，第 25 张之后的 toggle `te-liquid-glass-budget`。
3. 每一次 class 变化都让该卡的 `::after` 在 `filter: url(#te-lg-expanded-card)` ↔ `filter: none` 与 `backdrop-filter: blur(16px) saturate(150%)` ↔ `none` 之间切换。
4. 这条 transition 把每次切换拉成 180ms 的动画。滚动中数十张卡同时处于过渡状态。

`backdrop-filter` 与 `filter: url()` 都**无法交给合成器插值**：过渡的 180ms 内，每一帧都要重跑一次背景模糊 + 饱和度采样，外加一次 SVG 位移滤镜 pass。这正好是预算机制存在的理由，而过渡把它抵消了。

### AUDIT 依据

AUDIT 第 5 节 Performance：

- 「Animate `transform` and `opacity` only.」
- 「Keep transition-time `filter: blur()` under 20px — heavy blur is expensive, especially in Safari.」——这里的 blur 默认值是 `16px`，但 `--te-lg-expanded-blur` 是运行时可配的主题变量，可以超过 20px；更根本的问题是这两个属性从一开始就不该参与过渡。

预算类的切换在语义上**本就应当瞬时生效**：它是一个「这张卡现在不许有滤镜 pass」的硬开关，不是一个视觉动画。

## Target

从 `src/renderer/src/assets/base.css:3242-3247` 的 transition 列表里删掉 `filter`、`backdrop-filter`、`-webkit-backdrop-filter` 三项，只保留 `opacity` 与 `transform`：

```css
/* target — src/renderer/src/assets/base.css */
  backdrop-filter: blur(var(--te-lg-expanded-blur, 16px))
    saturate(var(--te-lg-expanded-saturate, 150%));
  -webkit-backdrop-filter: blur(var(--te-lg-expanded-blur, 16px))
    saturate(var(--te-lg-expanded-saturate, 150%));
  filter: url(#te-lg-expanded-card);
  opacity: 1;
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
```

`backdrop-filter` / `-webkit-backdrop-filter` / `filter` 三条**声明本身保持原样不动**——只从 `transition` 列表里移除，不从规则里移除。它们仍然是卡片的静态外观。

时长 `180ms` 与曲线 `ease` 都保持不变。本方案不调时长、不引入新 token。

## Repo conventions to follow

- 动效 token 住在 `src/renderer/src/assets/base.css:26-40`（`--te-ease-enter/soft/spring/out-quint/out-expo`、`--te-motion-press/hover/panel/page/settle/return`）。**本方案不新增 token，也不把 `180ms ease` 改成 token**——那属于另一类整理，不在本方案范围。
- 只过渡 `transform` / `opacity` 的仓库样板 —— `src/renderer/src/components/player-bar/PlayerBar.css:43-48`：
  ```css
  .drawer-up-enter-active {
    transition:
      opacity var(--te-motion-panel) ease,
      transform var(--te-motion-page) var(--te-ease-soft);
    transform-origin: right bottom;
  }
  ```
- 「过渡期间临时摘掉 blur」的既有做法，可参考但本方案不需要照做 —— `src/renderer/src/components/player-bar/PlayerBar.css:13-17`：
  ```css
  .player-bar-shell.is-geometry-animating .player-bar,
  .player-bar-shell.is-geometry-animating .player-bar-liquid .player-bar-warp {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  ```
- 多属性 `transition` 的排版：每项一行、两空格缩进、逗号结尾。prettier 会这样格式化。

## Steps

1. 打开 `src/renderer/src/assets/base.css`，定位到 `:3242-3247` 的 `transition` 声明。确认它属于起于 `:3155` 的那条 `html[data-te-liquid-glass-coverage='expanded'] :is(.artist-card, …)::after` 规则（该文件里有多条形状相似的 liquid-glass 规则，务必确认改的是这一条——判据是紧邻上方有 `filter: url(#te-lg-expanded-card);` 和 `opacity: 1;` 两行）。
2. 把
   ```css
   transition:
     opacity 180ms ease,
     transform 180ms ease,
     filter 180ms ease,
     backdrop-filter 180ms ease,
     -webkit-backdrop-filter 180ms ease;
   ```
   改成
   ```css
   transition:
     opacity 180ms ease,
     transform 180ms ease;
   ```
   注意 `transform 180ms ease` 后面的逗号要改成分号。
3. 不做其他任何修改。本方案只有这一处编辑。

## Boundaries

- **不要动 `src/renderer/src/utils/liquidGlassPointer.ts`。** 这个文件已经按性能优化过，改它只会退化：
  - `LIQUID_GLASS_POINTER_FRAME_INTERVAL_MS = 32` 刻意低于刷新率，并有注释说明理由；
  - hover 期间缓存 rect，不每帧读布局；
  - `writePointerVariables` 逐属性比对旧值才写；
  - 用 `event.target` 而不是 `elementFromPoint`；
  - 离开表面时 `detachPointerMove` 摘除监听。
  `:136` 的 `createFrameCoalescer` 也不要改。
- **不要动 `src/renderer/src/components/LiquidGlassDefs.vue`。** IntersectionObserver 的 `rootMargin: '128px 0px'`、`syncExpandedSurfaceBudget()`、`LIQUID_GLASS_MAX_VISIBLE_EXPANDED_SURFACES` 都保持原样。本方案的立场是「预算机制是对的，过渡是错的」。
- **不要动 `src/shared/liquidGlass.ts`。**
- **不要动 `src/renderer/src/assets/base.css:3469-3477` 的预算类规则。** 那三个 `!important` 的 `none` 是有意的。
- **不要动 `base.css:3440-3467` 的嵌套卡片 `content: none !important` 规则**，也不要动 `:3479-3509` 的 `body.te-no-blur` 规则。
- **不要动 `base.css:3236-3240` 的 `backdrop-filter` / `-webkit-backdrop-filter` / `filter` 声明本身。** 只从 `transition` 列表里移除，卡片的静态外观必须完全不变。
- **不要把 `180ms ease` 换成 token**，不要顺手整理这个文件里其他的 liquid-glass 规则。
- 不要新增依赖，不要改 `package.json`，不要改测试。
- **若第 1 步找不到匹配的代码（行号漂移、声明已被改过、`filter: url(#te-lg-expanded-card)` 不在紧邻上方），停下来报告，不要自行发挥**，尤其不要在别的相似规则上凑一个改动交差。

## Verification

- **Mechanical**：
  - `pnpm run lint` —— 应当通过。若 prettier 对 `transition` 的换行有意见，按它的意见调整（两项也可能被压成一行，随它）。
  - `pnpm run typecheck` —— 纯 CSS 改动，不应有类型错误。
  - `pnpm run test:themes` —— 这一档覆盖 `src/renderer/src/components/liquidGlassSurfaces.test.ts`。该测试断言 `te-liquid-glass-budget` 字样与固定 blur 数值（约 `:68`、`:108-123` 行），**不检查过渡属性清单**，所以本方案不应让它变红。若它变红了，说明改错了位置（可能误删了 `backdrop-filter` 声明本身而不只是 transition 项）——立刻回滚并报告。
  - `pnpm run build` —— 产物应当构建成功；CSS 变小几十字节，不影响 `scripts/verify-renderer-budgets.cjs` 的 cssChunk 400KB 上限。
  - **注意：HEAD（9312f3e）上本来就有 3 条测试是红的。** 跑套件前先在未改动的工作树上记一次基线，只对比新增的失败。
- **Feel check**（真实渲染 + 性能取证）：先 `npx electron-vite build` 让 `out/` 带上改动，再用隔离 profile 启动 + CDP：
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`。
  - **必须把液态玻璃切到展开态**才能命中这条规则：设置里把液态玻璃覆盖范围设为「展开」（对应 `html[data-te-liquid-glass-coverage='expanded']`），并确认 `document.documentElement.dataset.teLiquidGlassCoverage === 'expanded'`。
  - 优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-scroll-top.cjs` 最贴近——它 seed 60 个真 WAV 并点「所有歌曲」侧边栏项，能拿到一屏可滚动的卡片。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
  - **在离屏测试窗口（`show: false`）里每个跟在 `scrollTop` 写入后的帧要花约 600ms** —— 隐藏合成器懒确认滚动提交。用 `{ show: false, opacity: 0, focusable: false, skipTaskbar: true }` 构造再 `window.showInactive()`，才能拿到真 60fps 帧。
  - 要确认的观察点：
    - **静止状态下卡片外观完全不变。** 截一张滚动到顶的卡片网格图，与改动前逐像素比对——`backdrop-filter` 与 `filter: url()` 声明没动，静态渲染应当完全一致。这是本方案最重要的回归检查。
    - 慢速滚动网格（每次 `scrollTop += 40`，等 ~600ms），**卡片进出 128px 边界时不再有 180ms 的模糊淡入淡出**。改前能看到卡片的玻璃质感在边界附近渐变，改后应当是瞬时切换（第 25 张之后的卡片直接变成半透明纯色）。
    - 快速滚动整个网格，滚动流畅度应当明显改善。
  - **性能取证**：DevTools Performance 面板录制「列表滚动扫掠」这一个动作，改动前后各录一段 trace 比对 **Paint** 与 **Composite Layers** 的帧占用。改后 Paint 应当明显下降（过渡期间反复重跑的 blur pass 消失了）。也可以用 CDP 的 `Performance.enable` + `Tracing`，或在 `Runtime.evaluate` 里用 `performance.now()` 采样连续 60 帧的间隔。
  - 在 DevTools Animations 面板把播放速度设为 10%，滚动一张卡穿过边界，确认没有任何滤镜属性还在动画列表里。
  - 切到 `html[data-te-motion='reduced']` 与 `'off'`（三档由 `src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts` 驱动），确认卡片外观与预算切换都正常。
- **Done when**：
  - `grep -n "backdrop-filter 180ms" src/renderer/src/assets/base.css` 无命中。
  - `grep -n "filter 180ms" src/renderer/src/assets/base.css` 无命中。
  - `grep -n "filter: url(#te-lg-expanded-card)" src/renderer/src/assets/base.css` 仍然命中（声明本身没被误删）。
  - `grep -c "backdrop-filter: blur(var(--te-lg-expanded-blur" src/renderer/src/assets/base.css` 的计数与改动前一致。
  - `pnpm run test:themes` 与 `pnpm run build` 通过，测试失败数不超过 HEAD 基线的 3 条。
  - 静止态卡片截图与改动前逐像素一致。
