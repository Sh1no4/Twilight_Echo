# 013 — 修掉吐司退场的 `ease-in`

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 缓动与时长（AUDIT 第 2 节 Easing & duration）
- **Estimated scope**: 1 个文件，1 条 `transition` 声明里的 1 个缓动值，纯 CSS

## Problem

`AppNoticeHost.vue` 的吐司退场对 `opacity` 和 `transform` **双双用了 `ease-in`**，而同一批里存活的吐司补位用的是 out-quint。一次退场同屏跑两种方向相反的速度感。

### 位置：退场声明

```css
/* src/renderer/src/components/AppNoticeHost.vue:150-159 — 当前 */
.app-notice-leave-active {
  /* Out of flow so the remaining toasts close the gap with the move transition
     instead of jumping. */
  position: absolute;
  right: 0;
  width: 100%;
  transition:
    opacity 160ms ease-in,
    transform 160ms ease-in;
}
```

退场的位移量在同文件 `:166-169`：

```css
/* src/renderer/src/components/AppNoticeHost.vue:161-169 — 当前 */
.app-notice-enter-from {
  opacity: 0;
  transform: translateX(16px) scale(0.97);
}

.app-notice-leave-to {
  opacity: 0;
  transform: translateX(16px) scale(0.97);
}
```

### 对照：同文件的入场与补位都用强 ease-out 曲线

```css
/* src/renderer/src/components/AppNoticeHost.vue:144-148 — 当前 */
.app-notice-enter-active {
  transition:
    opacity var(--te-toast-motion-duration, 220ms) ease-out,
    transform var(--te-toast-motion-duration, 220ms) cubic-bezier(0.22, 1, 0.36, 1);
}
```

```css
/* src/renderer/src/components/AppNoticeHost.vue:171-173 — 当前 */
.app-notice-move {
  transition: transform var(--te-toast-motion-duration, 220ms) cubic-bezier(0.22, 1, 0.36, 1);
}
```

作用对象是模板 `src/renderer/src/components/AppNoticeHost.vue:16-27` 那个 `<TransitionGroup tag="div" name="app-notice" class="app-notice-host">` 的 leave 阶段，类挂在 `.app-notice` 整条通知卡片上。

### 为什么这是问题

1. **`ease-in` 在 UI 上永远是一条 finding。** AUDIT 第 2 节原文：「`ease-in` on UI is always a finding — it starts slow, delaying the exact moment the user is watching」。这里不止 `opacity` 淡出吃了 `ease-in`，`transform`（`translateX(16px) scale(0.97)`）也吃了，所以卡片会**先原地滞留再加速甩出**，最需要即时反馈的那一刻恰好最慢。

2. **更实际的问题是并发。** 用户点掉一条吐司时，屏幕上同时发生两件事：离场卡片按 `ease-in` **加速**离开，存活卡片按 `.app-notice-move` 的 `cubic-bezier(0.22, 1, 0.36, 1)`（out-quint，**减速**）向上补位。同一个动作里两种相反的速度感，读起来是散的。

3. **这是全仓唯一的 `ease-in`（非 `ease-in-out`）用法。** 已在 `src/` 与 `resources/` 全量核对过 `ease-in` 命中点的后续字符，只有 `AppNoticeHost.vue:157` 与 `:158` 这两行是真的 `ease-in`，其余都是 `ease-in-out`。

### 需要执行者知道的既有决策（这不是推翻宪法）

本仓动效宪法 `docs/apple-music-inspired-hifi-player-design-system.md` 第 6.2 节的 motion token 表里，确实有一行：

```
| `fade-out` | 0.18 s ease-in | Component exit, auto-hide chrome |
```

**但那条 token 的语义是纯 opacity 淡出**（同表相邻的 `fade-in` 明确写着 "Component entry (opacity only, non-interactive)"），它不覆盖 `transform`。所以本方案把 `transform` 的曲线换掉，不构成推翻既定决策；`opacity` 那一项本方案也一并换成 `ease-out`（见下），因为宪法给的是 0.18s 而这里是 160ms，两者本就不是同一条 token 的实例，且 AUDIT 第 2 节的决策顺序对「exiting」明确指向 `ease-out`。

### 时长本身不用改

160ms 落在 AUDIT 第 2 节的预算内（按下反馈 100–160ms、tooltip / small popovers 125–200ms），**不要改这个数字**。入场 220ms、离场 160ms 的非对称也是对的（AUDIT 第 4 节的 asymmetric timing），保持。

## Target

`src/renderer/src/components/AppNoticeHost.vue:150-159` 改成：

```css
/* target — src/renderer/src/components/AppNoticeHost.vue */
.app-notice-leave-active {
  /* Out of flow so the remaining toasts close the gap with the move transition
     instead of jumping. */
  position: absolute;
  right: 0;
  width: 100%;
  transition:
    opacity 160ms var(--te-ease-out-strong),
    transform 160ms var(--te-ease-out-strong);
}
```

新 token 加进 `src/renderer/src/assets/base.css` 的 token 层，紧跟在 `:31` 的 `--te-ease-out-expo` 之后：

```css
/* target — src/renderer/src/assets/base.css，插在 --te-ease-out-expo 那一行之后 */
/* Strong ease-out for UI enter/exit (AUDIT §2). */
--te-ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);
```

三个值一字不差：

- 新 token 名：`--te-ease-out-strong`
- 新 token 值：`cubic-bezier(0.23, 1, 0.32, 1)`
- 时长：`160ms`（不变）

不要改 `position: absolute` / `right: 0` / `width: 100%` 三行，不要改上方那条注释，不要改 `.app-notice-leave-to` 的位移量。

## Repo conventions to follow

- **动效 token 全住在 `src/renderer/src/assets/base.css:26-40`**：`--te-ease-enter: cubic-bezier(0.4, 0, 0.2, 1)`、`--te-ease-soft: var(--te-ease-out-quint)`、`--te-ease-spring: cubic-bezier(0.22, 1.14, 0.36, 1)`、`--te-ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1)`、`--te-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`、`--te-motion-press: 90ms`、`--te-motion-hover: 160ms`、`--te-motion-panel: 280ms`、`--te-motion-page: 400ms`、`--te-motion-settle: 500ms`、`--te-motion-return: 220ms`。**新曲线必须进这一层，不许在组件里另起一套。**
- 新 token 加在 `:31`（`--te-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);`）之后、`:32`（`--te-motion-press: 90ms;`）之前，保持「先曲线、后时长」的既有分组。
- 组件里用 token 而不是字面量的样板 —— `src/renderer/src/App.vue:1234-1239`：
  ```css
  .playing-page-enter-active {
    transition:
      transform var(--te-motion-page) var(--te-ease-out-expo),
      opacity var(--te-motion-panel) ease,
      border-radius var(--te-motion-page) var(--te-ease-out-expo);
  }
  ```
- 多属性 `transition` 的排版：每项一行、两空格缩进、逗号结尾，最后一项分号。prettier 会这样格式化。

## Steps

1. 打开 `src/renderer/src/assets/base.css`，定位到 `:31` 那一行：

   ```css
   --te-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
   ```

   在它**后面**新增两行（缩进两个空格，与相邻 token 一致）：

   ```css
   /* Strong ease-out for UI enter/exit (AUDIT §2). */
   --te-ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);
   ```

   注意：这是 `:root { … }` 块内（该块从 `:1` 开始）。不要放到文件里其他的 `:root` 或 `[data-theme]` 块里 —— 判据是紧邻上方就是 `--te-ease-out-expo`、紧邻下方就是 `--te-motion-press: 90ms;`。

2. 打开 `src/renderer/src/components/AppNoticeHost.vue`，定位到 `:156-158` 的两行 `ease-in`：

   ```css
   transition:
     opacity 160ms ease-in,
     transform 160ms ease-in;
   ```

   改成：

   ```css
   transition:
     opacity 160ms var(--te-ease-out-strong),
     transform 160ms var(--te-ease-out-strong);
   ```

   判据：这条声明属于 `.app-notice-leave-active` 规则，紧邻上方三行是 `position: absolute;` / `right: 0;` / `width: 100%;`。

3. 不做其他任何修改。本方案只有这两处编辑。

## Boundaries

- **不要重写 `AppNoticeHost.vue` 的其他部分。** 这个文件是全仓动效做得最对的之一，逐条列出来是为了让执行者别顺手「优化」：
  - 走 `transition` 而不是 `@keyframes`（AUDIT 第 4 节：吐司这类可快速连续触发的 UI 必须能中途 retarget）；
  - `scale(0.97)` 落在 AUDIT 第 3 节的 0.9–0.97 区间内，没有 `scale(0)`；
  - 离场 `position: absolute` 让剩余吐司靠 `.app-notice-move` 过渡收拢而不是跳变；
  - 入场 220ms / 离场 160ms 的非对称时长。
    这些**全部保持原样**。
- **不要动 `:144-148` 的 `.app-notice-enter-active`，也不要动 `:171-173` 的 `.app-notice-move`。** 那两处的裸 `cubic-bezier(0.22, 1, 0.36, 1)` 该换成 `var(--te-ease-out-quint)`，但那归 **004 号方案**（token 整合），不在本方案范围。本方案只碰 `.app-notice-leave-active`。
- **不要动 `:175-186` 的 `@media (prefers-reduced-motion: reduce)` 块。** 本文件缺 `data-te-motion` 三档分支，那归 **015 号方案**。
- **不要改 `--te-toast-motion-duration`，也不要给它补定义。** 这个变量全仓从未定义过（只在 `AppNoticeHost.vue:146`、`:147`、`:172` 作为 `var(..., 220ms)` 的第一参数出现），fallback 220ms 一直生效，这是有意的可覆盖点。
- **不要动模板（`:15-62`）、不要动 `<script setup>`（`:1-13`）、不要动 `src/renderer/src/stores/useAppNoticeStore.ts`。** 本方案是纯样式改动。
- **不要引入 `--te-neutral-800` / `--te-primary-600`。** 这两个 token 在任何主题都没有定义，用了会得到无效值。
- **不要把 160ms 换成 `var(--te-motion-hover)`。** 两者数值相同（都是 160ms），但 `--te-motion-hover` 在 `html[data-te-motion='reduced']` 下被重定义为 100ms（`base.css:414`），语义是 hover 而不是退场。保留字面量 `160ms`。
- 不要新增依赖，不要改 `package.json`，不要改任何测试文件。
- **若第 1 步或第 2 步找不到匹配的代码（行号漂移、`ease-in` 已被改过、`--te-ease-out-expo` 不在 `:31`），停下来报告，不要自行发挥** —— 尤其不要在别的规则上凑一个改动交差，也不要自己另发明一条曲线值。

## Verification

- **Mechanical**：
  - `grep -rn "ease-in," src/renderer src/main resources | grep -v "ease-in-out"` —— 应当无命中（改动前有 `AppNoticeHost.vue:157` 一条）。
  - `grep -rn "ease-in;" src/renderer src/main resources | grep -v "ease-in-out"` —— 应当无命中（改动前有 `AppNoticeHost.vue:158` 一条）。
  - `pnpm run lint` —— 应当通过。若 prettier 对 `transition` 的换行有意见，按它的意见调整。
  - `pnpm run typecheck` —— 纯 CSS 改动，不应有类型错误。
  - `pnpm run test:app` —— 这一档包含 `src/renderer/src/app/useMotionPreference.test.ts`，该测试用正则钉住 `base.css` 的多条动效规则（`:59-64` 断言 `[role='switch']`、`[data-te-interactive]`、`transition: translate var(--te-motion-hover)`、`--te-ease-spring`、`[aria-disabled='true']`、`html[data-te-motion='off']` 都存在）。**新增一个 token 是纯增量，不应让它变红。** 若变红，说明误删了 token 层的某一行 —— 回滚并报告。
  - `pnpm run test:playback-routing` —— 这一档包含 `src/renderer/src/stores/useAppNoticeStore.test.ts`（store 逻辑，不涉及样式）与 `src/renderer/src/components/SideMenu.test.ts`（钉 `App.vue` 的字面量，不涉及本文件），都不应变红。
  - `pnpm run build` —— 应当构建成功。
  - **注意：HEAD（9312f3e）上本来就有 3 条测试是红的。** 跑套件前先在未改动的工作树上记一次基线，只对比新增的失败。
- **Feel check**（真实渲染，不许用简化替身当证据）：先 `npx electron-vite build` 让 `out/` 带上改动，再用隔离 profile 启动 + CDP：
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`。
  - 优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-settings-align.cjs` 最贴近，它有 CDP `Input.dispatchKeyEvent` 键盘驱动范例。
  - **怎么造出多条吐司**：吐司来自 `useAppNoticeStore`。最省事的取证方式是在 CDP 里直连 store 之外的入口 —— 用 `Runtime.evaluate` 触发三次会产生通知的真实操作（例如对不存在的路径发起扫描、或重复触发一个会 warn 的设置写入）。若拿不到稳定的三连通知，退一步：用 `Runtime.evaluate` 读回 `.app-notice-host` 的子元素数，确认至少同时存在 2 条，再点掉最上面那条。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。注意吐司自己的关闭键 `aria-label="关闭通知"` 是安全的（`:55`），但要用 `.app-notice-dismiss` 选择器精确命中，不要按文案搜。
  - **读 `getComputedStyle` 比截图更有力**。要断言的：
    - 触发退场的那一帧，对 `.app-notice-leave-active` 元素读 `getComputedStyle(el).transitionTimingFunction`，应当是 `cubic-bezier(0.23, 1, 0.32, 1)` 出现两次（对应 opacity 与 transform），**不含任何 `cubic-bezier(0.42, 0, 1, 1)`**（那是 `ease-in` 的展开值）。
    - `getComputedStyle(document.documentElement).getPropertyValue('--te-ease-out-strong').trim()` 应当是 `cubic-bezier(0.23, 1, 0.32, 1)`。
  - 要用眼睛确认的：
    - 屏幕上有 **2 条以上**吐司时点掉最上面那条 —— 离场卡片**一开始就在动**，不再有「先原地滞留、末尾突然甩出」的顿感。
    - 离场卡片向右滑出的减速感与下方卡片向上补位的减速感**方向一致**，读起来是一个动作而不是两个。
    - 连点两次关闭（快速连续退场）不应出现跳变 —— `transition` 会 retarget，这是改前就对的行为，改后必须保持。
  - 在 DevTools Animations 面板把播放速度设为 10%，再点一次关闭，确认离场曲线的形状是「起步快、尾部长」而不是「起步慢、尾部急」。
  - 用 DevTools Rendering 面板打开 `prefers-reduced-motion`，确认 `:175-186` 的降级仍然生效（`transition-duration` 变成 1ms、`transform: none`），运动被去掉但 opacity 反馈还在。
  - 两个 tone 各跑一次：`settings.theme` 只接受 `'dark' | 'pureWhite' | 'system'`（没有 `'light'`，会落到 system 进而在本机解析成 dark），并断言 `document.documentElement.dataset.theme`。吐司在暗色下有独立样式（`:188-193`），确认两档下退场观感一致。
- **Done when**：
  - `grep -rn "ease-in[,;]" src resources | grep -v "ease-in-out"` 无命中。
  - `grep -n "te-ease-out-strong" src/renderer/src/assets/base.css` 命中 1 次（定义）。
  - `grep -n "te-ease-out-strong" src/renderer/src/components/AppNoticeHost.vue` 命中 2 次（opacity 与 transform）。
  - `grep -n "160ms" src/renderer/src/components/AppNoticeHost.vue` 仍然命中 2 次（时长没被改动）。
  - `pnpm run lint`、`pnpm run typecheck`、`pnpm run build` 通过；`test:app` 与 `test:playback-routing` 的失败数不超过 HEAD 基线的 3 条。
  - 真实渲染里 `getComputedStyle` 读到的离场 `transitionTimingFunction` 是 `cubic-bezier(0.23, 1, 0.32, 1)`。
