# 001 — 统一 `--te-ease-soft` 的权威定义源

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 一致性与 token（AUDIT 第 2 节 Easing & duration、第 7 节 Cohesion & tokens）
- **Estimated scope**: 3 个文件（`src/shared/themeTokens.ts`、`src/renderer/src/assets/base.css`、`src/shared/themePresets.ts`），约 8 处单行编辑

## Problem

`--te-ease-soft` 是全仓最高频的缓动 token：`var(--te-ease-soft)` 共 173 处引用（全部 `--te-ease-soft` 字面出现 179 处）。它有两个互相矛盾的定义源，而**运行时胜出的不是写着设计意图的那一个**。

### 源 1：base.css 的静态声明

```css
/* src/renderer/src/assets/base.css:26-31 — 当前 */
--te-ease-enter: cubic-bezier(0.4, 0, 0.2, 1);
/* Soft = out-quint: fast start, long settling tail (osu!lazer-style motion). */
--te-ease-soft: var(--te-ease-out-quint);
--te-ease-spring: cubic-bezier(0.22, 1.14, 0.36, 1);
--te-ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
--te-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
```

按这里读，`--te-ease-soft` 应当是 `cubic-bezier(0.22, 1, 0.36, 1)`，注释还明确写了设计意图（out-quint，快起步 + 长收尾）。

### 源 2：主题 token 的默认值

```ts
// src/shared/themeTokens.ts:1697-1706 — 当前
token(
  'motion.soft',
  '--te-ease-soft',
  '柔和缓动',
  'motion',
  'global',
  'easing',
  'cubic-bezier(0.2, 0.8, 0.2, 1)',
  'cubic-bezier(0.2, 0.8, 0.2, 1)'
)
```

两个 tone（pureWhite / dark）的默认值都是 `cubic-bezier(0.2, 0.8, 0.2, 1)`。

### 注入链：源 2 胜出，且是以 `!important` 胜出

逐环都已核对：

1. `src/main/core/settings.ts:154` 默认设置 `activeTheme: { kind: 'builtin', id: 'builtin:twilight-echo-default' }`。
2. 该 preset 的 overrides 是空的：`src/shared/themePresets.ts:289-296` 中 `builtInThemePreset(TWILIGHT_DEFAULT_THEME_ID, 'Twilight Default', …, { pureWhite: {}, dark: {} }, …)`。
3. `resolveThemeProfileTokens`（`src/shared/theme.ts:1104-1115`）因此原样返回 `TWILIGHT_DEFAULT_THEME.variants[tone].tokens`，其中 `motion.soft` 就是源 2 的默认值：

```ts
// src/shared/theme.ts:1110-1114 — 当前
return {
  ...TWILIGHT_DEFAULT_THEME.variants[tone].tokens,
  ...(basePreset?.overrides[tone] ?? {}),
  ...profile.overrides[tone]
}
```

4. `themeTokensToCssVariables`（`src/shared/theme.ts:1209-1214`）把 `motion.soft` 映射成 CSS 变量名 `--te-ease-soft`。
5. `src/renderer/src/stores/useThemeStore.ts:453-455` 把每个变量以 `!important` 写进 `:root`：

```ts
// src/renderer/src/stores/useThemeStore.ts:453-455 — 当前
const root = Object.entries({ ...themeShellLayoutToCssVariables(shellLayout), ...variables })
  .map(([name, value]) => `  ${name}: ${value} !important;`)
  .join('\n')
```

**结论：开箱即用（默认主题、未做任何自定义）状态下 `--te-ease-soft` 的计算值是 `cubic-bezier(0.2, 0.8, 0.2, 1)`，不是 base.css 注释承诺的 out-quint。** base.css 的那行声明只在主题运行时注入之前（首帧、`injectCachedThemeRuntime` 之前）短暂生效。

### 为什么这件事必须先解决

- 173 处消费者拿到的都是源 2 的值。任何人照 base.css 的注释去调 out-quint 曲线，都会得到「改了没反应」——因为改的是被 `!important` 覆盖掉的那一层。
- 对照组：`motion.enter` 两处值一致（`base.css:26` 与 `themeTokens.ts:1694-1695` 都是 `cubic-bezier(0.4, 0, 0.2, 1)`），只有 soft 分叉。所以这不是「设计如此」，是漂移。
- 方案 004 要把 23 处裸写 cubic-bezier 归并到 token 上，其中 4 处裸写的正是 `cubic-bezier(0.2, 0.8, 0.2, 1)`。不先定权威值，就会把它们归并到一个即将变更的值上，白改一遍。

### 预设覆盖里的三组分叉

除默认主题外，三个内置预设覆盖了 `motion.soft`：

```ts
// src/shared/themePresets.ts:366-367（pureWhite）与 :433-434（dark）— builtin:aurora-reference — 当前
        'motion.enter': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'motion.soft': 'cubic-bezier(0.16, 1, 0.3, 1)'
```

```ts
// src/shared/themePresets.ts:1121-1122（pureWhite）与 :1184-1185（dark）— builtin:studio-split — 当前
        'motion.enter': 'cubic-bezier(0.2, 0, 0.4, 1)',
        'motion.soft': 'linear',
```

```ts
// src/shared/themePresets.ts:1322-1323（pureWhite）与 :1385-1386（dark）— builtin:zen-minimal — 当前
        'motion.enter': 'cubic-bezier(0.32, 0, 0.16, 1)',
        'motion.soft': 'cubic-bezier(0.45, 0.05, 0.15, 1)'
```

按 AUDIT 判定：

- `builtin:aurora-reference` 的 `cubic-bezier(0.16, 1, 0.3, 1)`（= out-expo）是强 ease-out，**合规，不动**。预设保留自己的动效个性是 AUDIT 第 7 节允许的。
- `builtin:studio-split` 的 `'linear'` **是 finding**。AUDIT 第 2 节把 `linear` 限定给恒定运动（marquee / progress），而 `--te-ease-soft` 的消费者是页面滑动、侧边栏让位、封面缩放这类有始有终的位移，用 `linear` 会读成机械平移。
- `builtin:zen-minimal` 的 `cubic-bezier(0.45, 0.05, 0.15, 1)` **是 finding**。第一个控制点 `(0.45, 0.05)` 意味着走到时间轴 45% 时位移只完成 5%，即起步极慢——这是 ease-in 特征。AUDIT 第 2 节：「`ease-in` on UI is always a finding — it starts slow, delaying the exact moment the user is watching」。

## Target

**唯一权威值 = `cubic-bezier(0.22, 1, 0.36, 1)`（即现有 `--te-ease-out-quint`）。**

选定理由（不要改成别的值）：

1. base.css 的注释是唯一记录了设计意图的地方（out-quint / osu!lazer 风格），意图应当胜过漂移。
2. AUDIT 第 2 节给出的强 ease-out 是 `cubic-bezier(0.23, 1, 0.32, 1)`。现有 out-quint `cubic-bezier(0.22, 1, 0.36, 1)` 与之同族、强度相当（都是「几乎立刻冲出去、长尾收敛」），**判定为无需替换**——引入第三个近似曲线只会加重方案 004 要治的病。
3. `--te-ease-soft` 的消费者以出场/位移为主，AUDIT 第 2 节的决策顺序里「Entering or exiting → ease-out」「Default → ease-out」都指向 ease-out 家族。

**运行时权威源 = `src/shared/themeTokens.ts`**（因为它以 `!important` 注入，物理上不可能输）。base.css 那行保留为主题运行时注入之前的启动兜底，值与 themeTokens.ts 一致，并加注释说明谁是权威。

目标代码：

```ts
// target — src/shared/themeTokens.ts
token(
  'motion.soft',
  '--te-ease-soft',
  '柔和缓动',
  'motion',
  'global',
  'easing',
  'cubic-bezier(0.22, 1, 0.36, 1)',
  'cubic-bezier(0.22, 1, 0.36, 1)'
)
```

```css
/* target — src/renderer/src/assets/base.css */
--te-ease-enter: cubic-bezier(0.4, 0, 0.2, 1);
/* Soft = out-quint: fast start, long settling tail (osu!lazer-style motion).
     Runtime authority is the `motion.soft` token in src/shared/themeTokens.ts:
     useThemeStore injects it into :root with !important, so this declaration
     only covers the frames before the theme runtime lands. Keep both values
     identical. */
--te-ease-soft: var(--te-ease-out-quint);
```

```ts
// target — src/shared/themePresets.ts，builtin:studio-split 两个 tone
        'motion.soft': 'cubic-bezier(0.23, 1, 0.32, 1)',
```

```ts
// target — src/shared/themePresets.ts，builtin:zen-minimal 两个 tone
        'motion.soft': 'cubic-bezier(0.22, 1, 0.36, 1)'
```

预设的两个新值也是照抄来的，不是估的：`cubic-bezier(0.23, 1, 0.32, 1)` 是 AUDIT 第 2 节的强 ease-out 原值（干脆利落、零回弹，配 studio 工具调性）；`cubic-bezier(0.22, 1, 0.36, 1)` 是 out-quint（长尾收敛，配 zen 的平静调性）。`builtin:aurora-reference` 的 `motion.soft` 一个字都不要动。

## Repo conventions to follow

- 动效 token 全住在 `src/renderer/src/assets/base.css:26-40`，可主题化的那一份住在 `src/shared/themeTokens.ts` 的 `THEME_TOKEN_DEFINITIONS` 里。**新曲线必须进 token 层，不许在组件里另起一套。**本方案不新增任何曲线。
- 正面样板：`motion.enter` 就是本方案要达成的状态——`src/renderer/src/assets/base.css:26` 写 `--te-ease-enter: cubic-bezier(0.4, 0, 0.2, 1);`，`src/shared/themeTokens.ts:1687-1696` 的 `token('motion.enter', '--te-ease-enter', …, 'cubic-bezier(0.4, 0, 0.2, 1)', 'cubic-bezier(0.4, 0, 0.2, 1)')` 两处逐字一致。照它做。
- `token(...)` 的最后两个字符串参数分别是 pureWhite 与 dark 两个 tone 的默认值，两个都要改，不要只改一个。
- 预设 overrides 在 `src/shared/themePresets.ts` 里每个预设都有 `pureWhite` 和 `dark` 两份，成对出现，改一处必须改对应的另一处。

## Steps

1. 打开 `src/shared/themeTokens.ts`，定位到第 1697-1706 行的 `token('motion.soft', …)`。把最后两个参数 `'cubic-bezier(0.2, 0.8, 0.2, 1)'` 和 `'cubic-bezier(0.2, 0.8, 0.2, 1)'` 都改成 `'cubic-bezier(0.22, 1, 0.36, 1)'`。其余参数（id、cssVariable、label、group、scope、kind）一个字都不要改。
2. 打开 `src/renderer/src/assets/base.css`，把第 27 行的单行注释

   ```css
   /* Soft = out-quint: fast start, long settling tail (osu!lazer-style motion). */
   ```

   替换成多行注释：

   ```css
   /* Soft = out-quint: fast start, long settling tail (osu!lazer-style motion).
        Runtime authority is the `motion.soft` token in src/shared/themeTokens.ts:
        useThemeStore injects it into :root with !important, so this declaration
        only covers the frames before the theme runtime lands. Keep both values
        identical. */
   ```

   第 28 行 `--te-ease-soft: var(--te-ease-out-quint);` **保持原样不动**（它现在与 themeTokens.ts 一致了）。第 30 行 `--te-ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);` 也不要动。

3. 打开 `src/shared/themePresets.ts`，定位第 1122 行 `'motion.soft': 'linear',`（在 `builtin:studio-split` 的 `pureWhite` 块内），改成 `'motion.soft': 'cubic-bezier(0.23, 1, 0.32, 1)',`。同一行上方的 `'motion.enter': 'cubic-bezier(0.2, 0, 0.4, 1)',` 不要动。
4. 同一文件，定位第 1185 行 `'motion.soft': 'linear',`（`builtin:studio-split` 的 `dark` 块内），同样改成 `'motion.soft': 'cubic-bezier(0.23, 1, 0.32, 1)',`。
5. 同一文件，定位第 1323 行 `'motion.soft': 'cubic-bezier(0.45, 0.05, 0.15, 1)'`（`builtin:zen-minimal` 的 `pureWhite` 块内），改成 `'motion.soft': 'cubic-bezier(0.22, 1, 0.36, 1)'`。注意这一行是块内最后一项，行尾没有逗号，改完也不要加逗号。
6. 同一文件，定位第 1386 行 `'motion.soft': 'cubic-bezier(0.45, 0.05, 0.15, 1)'`（`builtin:zen-minimal` 的 `dark` 块内），同样改成 `'motion.soft': 'cubic-bezier(0.22, 1, 0.36, 1)'`，行尾同样不加逗号。
7. 全仓搜索 `cubic-bezier(0.2, 0.8, 0.2, 1)`，确认剩下的命中只在这 4 个文件里：`src/renderer/src/components/LyricsAppearanceCustomizer.vue`、`src/renderer/src/components/streaming-page/StreamingDetailStage.css`、`src/renderer/src/components/streaming-page/StreamingPage.css`、`src/renderer/src/mini-player/MiniPlayer.css`。**这 4 处属于方案 004，本方案不要动它们。**如果搜出 `src/shared/` 下还有命中，说明第 1-6 步漏了，回去补。

## Boundaries

- 不要动 `src/shared/themePresets.ts:366-367` 与 `:433-434`（`builtin:aurora-reference` 的 `motion.soft`）。那个值是合规的强 ease-out。
- 不要动任何 `'motion.enter'` 覆盖（`themePresets.ts:366`、`:433`、`:950`、`:1014`、`:1121`、`:1184`、`:1322`、`:1385`）。本方案只管 soft。
- 不要动 `base.css:29-31` 三个曲线 token 的值（`--te-ease-spring`、`--te-ease-out-quint`、`--te-ease-out-expo`）。
- 不要动 `base.css:32-40` 的时长与幅度 token。
- 不要新增任何 cubic-bezier token。不要引入对 `--te-neutral-800` / `--te-primary-600` 的引用（这两个变量在任何主题里都没有定义）。
- 不要改任何 `.vue` / `.css` 组件文件里的裸写 cubic-bezier——那是方案 004 的范围。
- 不要动 `src/renderer/src/components/EqualizerPage.vue:1340` 的 `--te-ease-soft: cubic-bezier(0.4, 0, 0.2, 1);`。它在 `<style scoped>`（`EqualizerPage.vue:1134` 起）内的一个 `:root` 块里，scoped 编译后选择器带上 `[data-v-*]`，`:root` 永不匹配，是死代码，归方案 017。
- 不要新增依赖，不要动 markup / 结构，只改上面点名的值与注释。
- **如果某一步描述的代码与你实际看到的不一致（行号漂移、值已被改过），停下来报告，不要自行发挥。**

## Verification

- **Mechanical**：
  - `pnpm run typecheck`（= `typecheck:node` + `typecheck:web`）应当通过。
  - `pnpm run lint` 应当通过。
  - `pnpm run test:themes` —— 这一套覆盖 `src/shared/theme.test.ts`、`themeColorAudit.test.ts`、`themeTokenization.test.ts`。**先在改动前跑一遍记基线**：HEAD 上本来就有 3 条测试是红的，不要把既有失败算进自己账上。改动后新增的失败才是你的责任。已核查：`theme.test.ts` 只断言 `THEME_TOKEN_DEFINITIONS.length`，`themeColorAudit.test.ts` / `themeTokenization.test.ts` 只管颜色与 token 布线，都不钉缓动值，所以这一步预期是「与基线一致」。
  - `pnpm run test:playback-routing` —— 内含 `src/renderer/src/components/SideMenu.test.ts`，它钉了 App.vue / SideMenu.vue / PlayerBar.css 里 `var(--te-ease-soft)` 的**写法**（不是值），本方案没改这些写法，预期与基线一致。
  - 全仓搜索确认最终状态：`cubic-bezier(0.2, 0.8, 0.2, 1)` 在 `src/shared/` 下 0 命中；`grep -n "motion.soft" src/shared/themePresets.ts` 应当只剩 6 行命中（aurora 2 行 + studio-split 2 行 + zen-minimal 2 行），且 studio-split 两行是 `cubic-bezier(0.23, 1, 0.32, 1)`、zen-minimal 两行是 `cubic-bezier(0.22, 1, 0.36, 1)`。
- **Feel check**（必须走真实渲染，不许用简化替身当证据；对这种「CSS 变量到底解析成什么」的改动，**读 `getComputedStyle` 比截图更有力**）：
  1. `npx electron-vite build`，让 `out/` 带上改动。
  2. 用**隔离 profile** 启动：`node_modules/electron/dist/electron.exe . --user-data-dir=<临时目录，路径用正斜杠>`。**不要**走 `pnpm run dev --`——`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出。
  3. seed profile：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `<profile>/music-library.json` 覆盖成 `{"version":2,"revision":1,"tracks":[],"folders":[],"exclusions":[]}`（seed 出来的一万条会阻塞渲染进程约 3 分钟），并预写 `<profile>/plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`（否则 provider RPC 要 30s 超时才放行启动）。**用全新的隔离 profile，不要复用旧的**——旧 profile 里 `themeRuntimeCache` 可能缓存了改动前的 CSS。
  4. 优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-global-font.cjs` 就是「读计算样式而非截图」的现成夹具，把它读的属性换成 `getComputedStyle(document.documentElement).getPropertyValue('--te-ease-soft')` 最省事。别从零写夹具。
  5. 每个 CDP 调用给约 45s 超时；`Runtime.evaluate` 没有顶层 await，要把代码包成 `(async () => …)()`。
  6. 断言：默认主题下 `getComputedStyle(document.documentElement).getPropertyValue('--te-ease-soft').trim()` === `'cubic-bezier(0.22, 1, 0.36, 1)'`。`settings.theme` 只接受 `'dark' | 'pureWhite' | 'system'`（没有 `'light'`），两个 tone 各跑一次，并顺带断言 `document.documentElement.dataset.theme`。
  7. 切到 `builtin:studio-split` 预设，断言 `--te-ease-soft` 解析为 `'cubic-bezier(0.23, 1, 0.32, 1)'`（不再是 `linear`）；切到 `builtin:zen-minimal`，断言解析为 `'cubic-bezier(0.22, 1, 0.36, 1)'`。
  8. 眼看：在侧边栏切换页面，页面滑动应当「几乎立刻冲出去、末段慢慢收住」，不再有 studio-split 那种匀速平移感，也不再有 zen-minimal 那种起步拖沓感。DevTools Animations 面板调到 10% 速度做慢放核对。
  9. 操作时**别点任何文案含「关闭」的按钮**——会命中标题栏关闭键，应用直接退出。
- **Done when**：
  - 默认主题下 `--te-ease-soft` 的计算值是 `cubic-bezier(0.22, 1, 0.36, 1)`，与 `base.css:28` 注释承诺的 out-quint 一致。
  - `src/shared/themeTokens.ts` 与 `src/renderer/src/assets/base.css` 对 soft 的表述不再冲突，且 base.css 的注释指明了运行时权威源。
  - `src/shared/` 下不再有 `cubic-bezier(0.2, 0.8, 0.2, 1)`，也不再有 `'motion.soft': 'linear'`。
  - typecheck / lint 通过，`test:themes` 与 `test:playback-routing` 与改动前基线一致。
  - prettier 有基线，`pnpm run format` 可能顺带重排无关文件；**只提交你自己改的那 3 个文件。**
