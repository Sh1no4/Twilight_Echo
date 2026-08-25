# 009 — 删掉搜索类输入框的逐字符入场动效

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 目的与频次（AUDIT 第 1 节 Purpose & frequency）
- **Estimated scope**: 1 个组件（`AnimatedInput.vue`）+ 4 个调用文件加 prop，共 5 个文件；改动为「加一个 prop + 逐调用点标注」，不删组件

## Problem

`AnimatedInput.vue` 给输入框里**每一个字符**挂了一次入场动效：280ms 弹簧曲线的位移 + 从 `scale(0.4)` 放大。这个组件被用在搜索框上，也就是说**每一次键盘敲击都触发一次动效**。

### 位置一：逐字符动效的 CSS

```css
/* src/renderer/src/components/AnimatedInput.vue:204-213 — 当前 */
.ai-char-enter-active {
  transition:
    opacity 180ms ease-out,
    transform var(--te-motion-panel) var(--te-ease-spring);
}

.ai-char-enter-from {
  opacity: 0;
  transform: translateY(0.35em) scale(0.4);
}
```

`--te-motion-panel` 是 `280ms`，`--te-ease-spring` 是 `cubic-bezier(0.22, 1.14, 0.36, 1)`（两者都定义在 `src/renderer/src/assets/base.css:29` 与 `:34`）。也就是说每个字符跑一次 **280ms 的弹簧位移**，同时从 `scale(0.4)` 放大 —— `scale(0.4)` 也违反 AUDIT 第 3 节的「Never `scale(0)`… Target: `scale(0.9–0.97)`」（0.4 离 0.9 很远，视觉上就是「从近乎无到有」地弹出来）。

删除方向的动效同样存在，`src/renderer/src/components/AnimatedInput.vue:215-229`：

```css
/* src/renderer/src/components/AnimatedInput.vue:215-229 — 当前 */
.ai-char-leave-active {
  position: absolute;
  transition:
    opacity var(--te-motion-return) ease,
    transform var(--te-motion-return) var(--te-ease-out-quint);
}

.ai-char-leave-to {
  opacity: 0;
  transform: translateY(0.3em) scale(0.3);
}

.ai-char-move {
  transition: transform var(--te-motion-panel) var(--te-ease-out-quint);
}
```

### 位置二：模板 —— 每次 `modelValue` 变化都 reconcile 出新 id，`TransitionGroup` 重放

```html
<!-- src/renderer/src/components/AnimatedInput.vue:123-130 — 当前 -->
    <span class="animated-input-mirror" aria-hidden="true">
      <span class="animated-input-track" :style="{ transform: `translate3d(${-scrollX}px, 0, 0)` }">
        <TransitionGroup v-if="animated" name="ai-char">
          <span v-for="c in chars" :key="c.id" class="ai-char">{{ c.char }}</span>
        </TransitionGroup>
        <span v-else class="ai-plain">{{ modelValue }}</span>
      </span>
    </span>
```

新字符的 id 来自 `src/renderer/src/components/AnimatedInput.vue:42-58`：

```ts
// src/renderer/src/components/AnimatedInput.vue:42-58 — 当前
// Diff by common prefix/suffix so mid-string edits keep stable ids: untouched
// characters must not re-key, or every keystroke would replay all animations.
function reconcile(value: string): void {
  const prev = chars.value
  const next = Array.from(segmenter.segment(value), (part) => part.segment)
  let start = 0
  const shared = Math.min(prev.length, next.length)
  while (start < shared && prev[start].char === next[start]) start++
  let prevEnd = prev.length
  let nextEnd = next.length
  while (prevEnd > start && nextEnd > start && prev[prevEnd - 1].char === next[nextEnd - 1]) {
    prevEnd--
    nextEnd--
  }
  const inserted = next.slice(start, nextEnd).map((char) => ({ id: nextCharId++, char }))
  chars.value = [...prev.slice(0, start), ...inserted, ...prev.slice(prevEnd)]
}

watch(() => props.modelValue, reconcile, { immediate: true })
```

这个 diff 已经做过一轮优化（注释说明只给新字符发新 id，未改动的字符不 re-key，避免每次击键重放**全部**动画）。但即便如此，**每次击键仍然至少有一个新字符要跑一次 280ms 动效**；连续快速输入时，几十个字符的 280ms 动效互相叠在一起。

### 位置三：`animated` 的判据是长度，与频次成反比

```ts
// src/renderer/src/components/AnimatedInput.vue:60 — 当前
const animated = computed(() => chars.value.length <= props.maxAnimatedLength)
```

```ts
// src/renderer/src/components/AnimatedInput.vue:7-14 — 当前
const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    maxAnimatedLength?: number
  }>(),
  { placeholder: '', maxAnimatedLength: 60 }
)
```

`maxAnimatedLength` 默认 `60`。**这个判据的方向是错的**：短输入（正是搜索这种高频场景，通常几个字）默认**开着**动效；长文本（低频、一次性输入）反而关掉。判据看的是「渲染成本」，而 AUDIT 要求看的是「使用频次」，两者在这里正好相反。

### 位置四：11 个调用点，其中至少 4 处是高频搜索框

按场景分类（全部逐个读过）：

**高频搜索（每天数百次击键，必须关掉动效）**

1. `src/renderer/src/components/SettingsPage.vue:1147` — 设置页搜索，`placeholder="搜索设置"`
2. `src/renderer/src/components/streaming-page/StreamingContentHeader.vue:71` — 流媒体统一搜索，`placeholder="搜索音乐、歌手、专辑"`
3. `src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.vue:414` — 聚合歌单内搜索，`placeholder="在聚合歌单内搜索"`

**中频表单（登录页，每次登录敲一遍手机号/验证码 —— 验证码 6 位、区号 2 位，都是纯数字逐字敲，动效毫无意义）**

4. `src/renderer/src/components/LoginPage.vue:954` — 国家区号，`placeholder="86"`
5. `src/renderer/src/components/LoginPage.vue:963` — 手机号，`placeholder="输入手机号"`
6. `src/renderer/src/components/LoginPage.vue:976` — 邮箱，`placeholder="name@163.com"`
7. `src/renderer/src/components/LoginPage.vue:989` — 短信验证码，`placeholder="6 位验证码"`

**低频命名（一次性输入一个名字，可以保留动效）**

8. `src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.vue:602` — 新建聚合歌单对话框，`placeholder="聚合歌单名称"`
9. `src/renderer/src/components/aggregate-playlist/CreateAggregatePlaylistDialog.vue:81` — 新建聚合歌单，`placeholder="聚合歌单名称"`
10. `src/renderer/src/components/player-bar/QueueAddToPlaylistDialog.vue:82` — 新建歌单，`placeholder="请输入歌单名称"`
11. `src/renderer/src/components/streaming-page/NcmPlaylistDialogs.vue:65` — 创建网易云歌单，`placeholder="请输入歌单名称"`

### AUDIT 依据

AUDIT 第 1 节的频次表，第一行原文：

| Frequency | Decision |
| --- | --- |
| 100+ times/day (keyboard shortcuts, command palette toggle) | No animation. Ever. |

同节的 Hunt 项原文：「Hunt for: **animations on keyboard-initiated actions**, command palettes with open/close transitions (Raycast has none — correct), decorative motion on list items or hover states hit constantly. **The strongest fix is often delete the animation.**」

搜索框打字是本应用里最高频的键盘动作之一，落在表格第一行「No animation. Ever.」。

组件顶部注释自称 osu!lazer 风格：

```ts
// src/renderer/src/components/AnimatedInput.vue:4-6 — 当前
// osu!lazer-style textbox: each committed grapheme pops in with a spring, and
// shrinks away on delete. A transparent native <input> keeps focus/IME/caret
// behavior; an overlaid mirror renders the per-character animation.
```

但 osu!lazer 里的文本框是游戏设置里的低频输入，不是音乐播放器每天要用几十次的搜索框。**同一个动效放在不同频次的面上，结论不同** —— 这正是 AUDIT 第 1 节要求按频次而非按观感判断的原因。

### 好消息：组件已经有无动效分支

`src/renderer/src/components/AnimatedInput.vue:128` 的 `<span v-else class="ai-plain">{{ modelValue }}</span>` 就是现成的无动效渲染路径，样式在 `:197-202`：

```css
/* src/renderer/src/components/AnimatedInput.vue:197-202 — 当前 */
.ai-char,
.ai-plain {
  display: inline-block;
  white-space: pre;
  transform-origin: 50% 80%;
}
```

所以**不需要新写渲染逻辑**，只需要让高频调用点走 `v-else` 这一支。

## Target

给组件加一个显式的场景 prop `animate`，默认 `false`（不动效），让**调用方声明场景**，而不是让组件用长度去猜。

### 组件 props 的目标状态

```ts
/* target — src/renderer/src/components/AnimatedInput.vue */
const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    maxAnimatedLength?: number
    animate?: boolean
  }>(),
  { placeholder: '', maxAnimatedLength: 60, animate: false }
)
```

### `animated` 计算属性的目标状态

```ts
/* target — src/renderer/src/components/AnimatedInput.vue */
// Per-character motion is opt-in by scenario, not inferred from length: search
// boxes take hundreds of keystrokes a day and must never animate, while a
// one-off playlist-name field can afford it. maxAnimatedLength still caps the
// opted-in case so a long paste does not spawn dozens of transitions.
const animated = computed(() => props.animate && chars.value.length <= props.maxAnimatedLength)
```

`maxAnimatedLength` 的默认值 `60` 与判据 `<=` 都**保持原样**，它继续作为「已选择开动效的场景」的成本上限。

### 调用点的目标状态

- 上面第 1–7 号调用点（3 个搜索框 + 4 个登录字段）：**不加 `animate` prop**，靠 `false` 默认值走 `ai-plain` 分支。
- 上面第 8–11 号调用点（4 个歌单命名框）：**显式加 `animate`**，例如：

```html
<!-- target — src/renderer/src/components/player-bar/QueueAddToPlaylistDialog.vue -->
            <AnimatedInput
              id="queue-playlist-new-name"
              v-model="newName"
              type="text"
              class="queue-playlist-name-input"
              maxlength="80"
              placeholder="请输入歌单名称"
              :disabled="busy"
              autofocus
              animate
            />
```

### CSS 的目标状态

`.ai-char-enter-active` / `.ai-char-enter-from` / `.ai-char-leave-active` / `.ai-char-leave-to` / `.ai-char-move` 五条规则以及 `:231-237` 的 `prefers-reduced-motion` 块**全部原样保留**，只有一处数值修改：把 `.ai-char-enter-from` 的 `scale(0.4)` 改成 `scale(0.9)`，把 `.ai-char-leave-to` 的 `scale(0.3)` 改成 `scale(0.9)`：

```css
/* target — src/renderer/src/components/AnimatedInput.vue */
.ai-char-enter-from {
  opacity: 0;
  transform: translateY(0.35em) scale(0.9);
}
```

```css
/* target — src/renderer/src/components/AnimatedInput.vue */
.ai-char-leave-to {
  opacity: 0;
  transform: translateY(0.3em) scale(0.9);
}
```

依据是 AUDIT 第 3 节原文：「**Never `scale(0)`** — nothing in the real world appears from nothing. Target: `scale(0.9–0.97)` + `opacity: 0`.」`0.9` 是该区间的下界，保留了原来「弹出」的性格但不再从近乎虚无放大。

时长 `var(--te-motion-panel)`（280ms）与曲线 `var(--te-ease-spring)` 在保留下来的低频场景里**不改**——AUDIT 第 1 节表格第四行「Rare / first-time … Can add delight」允许低频场景保留这个性格。

## Repo conventions to follow

- 动效 token 住在 `src/renderer/src/assets/base.css:26-40`。本方案**不新增 token**，也不改任何 token 的值。
- Vue props 用 `withDefaults(defineProps<{…}>(), {…})` 的写法 —— 样板就在本文件 `src/renderer/src/components/AnimatedInput.vue:7-14`，照它的格式加字段即可。
- 布尔 prop 在模板里用裸属性名传 `true`（`animate` 而不是 `:animate="true"`）—— 仓库现有样板 `src/renderer/src/components/player-bar/QueueAddToPlaylistDialog.vue:90` 的 `autofocus`、`src/renderer/src/components/streaming-page/NcmPlaylistDialogs.vue:72` 的 `autofocus`。
- 组件里解释「为什么这样」的注释用英文（本文件现有注释全是英文），方案里给出的注释文本已按此写好。
- `prefers-reduced-motion` 兜底块保持在 `<style scoped>` 末尾 —— 样板 `src/renderer/src/components/AnimatedInput.vue:231-237`。

## Steps

1. 打开 `src/renderer/src/components/AnimatedInput.vue`，在 `:7-14` 的 props 定义里加 `animate?: boolean` 字段与 `animate: false` 默认值，改成 Target 段「组件 props 的目标状态」那段代码。**不要删 `maxAnimatedLength`**。
2. 同一文件 `:60`，把
   ```ts
   const animated = computed(() => chars.value.length <= props.maxAnimatedLength)
   ```
   改成 Target 段「`animated` 计算属性的目标状态」那段代码（含上方 4 行英文注释）。
3. 同一文件 `:210-213`，把 `.ai-char-enter-from` 的 `transform: translateY(0.35em) scale(0.4);` 改成 `transform: translateY(0.35em) scale(0.9);`。
4. 同一文件 `:222-225`，把 `.ai-char-leave-to` 的 `transform: translateY(0.3em) scale(0.3);` 改成 `transform: translateY(0.3em) scale(0.9);`。
5. 打开 `src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.vue`，在 `:602` 起的那个 `<AnimatedInput>`（`placeholder="聚合歌单名称"`、带 `@keydown.enter="confirmCreate()"`）的属性列表末尾加一行 `animate`。**`:414` 起的那个（`placeholder="在聚合歌单内搜索"`）不要加。**
6. 打开 `src/renderer/src/components/aggregate-playlist/CreateAggregatePlaylistDialog.vue`，在 `:81` 起的 `<AnimatedInput>`（`placeholder="聚合歌单名称"`）属性列表末尾加一行 `animate`。
7. 打开 `src/renderer/src/components/player-bar/QueueAddToPlaylistDialog.vue`，在 `:82` 起的 `<AnimatedInput>`（`placeholder="请输入歌单名称"`）属性列表末尾、`autofocus` 之后加一行 `animate`。
8. 打开 `src/renderer/src/components/streaming-page/NcmPlaylistDialogs.vue`，在 `:65` 起的 `<AnimatedInput>`（`placeholder="请输入歌单名称"`）属性列表里、`autofocus` 之后加一行 `animate`（注意该元素最后一个属性是 `@keyup.enter="emit('confirmCreate')"`，`animate` 加在 `autofocus` 之后、`@keyup.enter` 之前，保持「普通属性在事件之前」的顺序）。
9. **不要改** `src/renderer/src/components/SettingsPage.vue:1147`、`src/renderer/src/components/streaming-page/StreamingContentHeader.vue:71`、`src/renderer/src/components/LoginPage.vue:954`/`:963`/`:976`/`:989`、`src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.vue:414` —— 这 7 处靠新的默认值 `false` 自动获得无动效行为，一个字都不用动。

## Boundaries

- **不要删掉 `AnimatedInput.vue` 组件**，也不要把它替换成裸 `<input>`。它承担了 IME/输入法合成、caret 同步、横向滚动镜像等一堆已修过 bug 的逻辑（`:75-101` 的 composition 处理有大段注释解释 X11/XIM 的坑），删组件会把这些一起弄坏。
- **不要动 `:42-58` 的 `reconcile()` 函数**。那个 prefix/suffix diff 是已有优化，注释说明了它在防什么。
- **不要动 `:62-101` 的 `syncScroll` / `onInput` / `commitCompositionValue` / `onCompositionUpdate` / `onCompositionEnd` / `onCompositionCancel`**。这些是输入法正确性代码，跟动效无关。
- **不要动 `:104-132` 模板的结构**：`<input>` 元素、`animated-input-mirror`、`animated-input-track`、`is-composing` 类、`aria-hidden="true"` 全部保持原样。唯一允许的模板改动是第 5–8 步在调用方加 `animate` 属性。
- **不要动 `:134-195` 的布局样式**（`.animated-input`、`.animated-input-field`、`::placeholder`、`::selection`、`.is-composing`、`.animated-input-mirror`、`.animated-input-track`）。
- **不要删 `.ai-char-*` 那五条 CSS 规则**，也不要删 `:231-237` 的 `prefers-reduced-motion` 块。低频场景仍然在用它们。
- **不要改 `--te-motion-panel`、`--te-ease-spring`、`--te-motion-return`、`--te-ease-out-quint` 这些 token 的值**（它们在 `src/renderer/src/assets/base.css:26-40`，全仓共用）。
- **不要引入对 `--te-neutral-800` 或 `--te-primary-600` 的引用** —— 这两个 token 在任何主题里都没有定义。
- **不要动 `src/renderer/src/components/theme-color-allowlist.json`。** 该文件 `:3` 给 `AnimatedInput.vue` 记了 `1` 条裸色值配额（对应 `:159` 的 `--ai-placeholder, #bbb`）；本方案不新增也不删除裸色值，配额不需要变。
- 不要新增依赖，不要改 `package.json`，不要改任何测试文件。
- **不要顺手把 `maxAnimatedLength` 从 `60` 改成别的数**，也不要给它加新的调用方。
- **若某一步找不到对应代码（行号漂移、prop 已存在、某个调用点的 placeholder 文案不符），停下来报告，不要自行发挥** —— 尤其不要在没列出的第 12 个调用点上自作主张加 `animate`。

## Verification

- **Mechanical**：
  - `pnpm run typecheck` —— 新增的可选 boolean prop 应当通过。若报「`animate` 不存在于 props 类型」，说明第 1 步没落地。
  - `pnpm run lint` —— 应当通过。prettier 可能会调整模板属性的换行，按它的意见走。
  - `pnpm run test:app` —— 这一档包含 `src/renderer/src/app/useMotionPreference.test.ts`。该测试有一条**全量 `.vue` 扫描**：正则 `/<(?<tag>[a-z][\w-]*)\b(?<attributes>[^>]*\s@click(?:[.=]|\s)[^>]*)>/gs`，非原生交互标签带 `@click` 时必须有 `data-te-interactive` 之类的标记（见该测试 `:74-99`）。本方案不碰任何 `@click` 元素，也不删任何 `data-te-interactive`，所以不应触发它。
  - `pnpm run test:themes` —— 包含 `src/renderer/src/components/themeColorAudit.test.ts`，它按 `theme-color-allowlist.json` 的配额比对每个文件的裸色值数量（该测试 `:103-104`）。本方案不动色值，不应触发。
  - `pnpm run test:playlist-lifecycle` —— 包含 `src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.behavior.test.ts`，第 5 步改了这个文件，跑一遍确认没撞到。
  - `pnpm run build` —— 应当构建成功。
  - **注意：HEAD（9312f3e）上本来就有 3 条测试是红的。** 跑套件前先在未改动的工作树上记一次基线，只对比新增的失败。**若新增测试，必须登记进 `package.json` 的某个 `test:*` 脚本**，否则不会被执行（本方案不要求新增测试）。
- **Feel check**（真实渲染，不许用简化替身当证据）：先 `npx electron-vite build` 让 `out/` 带上改动，再用隔离 profile 启动 + CDP：
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`。
  - 优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-settings-align.cjs` 最贴近 —— 它已经会打开设置页，而设置页搜索框正是第 1 号调用点。
  - **键盘输入必须用 CDP `Input.dispatchKeyEvent` 驱动**（`keyDown` 与 `keyUp` 都发，带 `windowsVirtualKeyCode`；modifiers 位掩码 Alt=1 Ctrl=2 Meta=4 Shift=8）。**合成 `dispatchEvent` 或直接给 `input.value` 赋值证明不了真实链路** —— 前者不走浏览器的输入事件，后者根本不触发 `input` 事件。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
  - 要确认的观察点：
    - 在设置页搜索框里用 `Input.dispatchKeyEvent` 连续敲「均衡器」或 `equal`，**每个字符立即出现在最终位置，没有任何位移或缩放**。改动前能看到每个字从下方 0.35em 处弹上来。
    - 输入的文字与原生 caret **依然对齐**（`ai-plain` 与 `ai-char` 共用 `:197-202` 的样式，理论上应该对齐；这是本方案最需要用真实渲染确认的一点）。用 `Runtime.evaluate` 读 `.animated-input-field` 与 `.animated-input-mirror` 的 `getBoundingClientRect()` 比对，别只看截图。
    - 用中文输入法敲一段拼音，**IME 候选与合成过程仍然正常**（`is-composing` 时镜像层 `opacity: 0`，显示原生文本）。这条链路本方案没动，但它与 `animated` 分支共存，值得回归一次。
    - 打开「新建歌单」对话框（第 10 号调用点，播放栏队列里的「添加到歌单」→ 新建），敲几个字，**逐字弹入动效仍然在**，且起始缩放明显比改动前温和（`0.9` 而非 `0.4`）。
    - 在 DevTools Animations 面板把播放速度设为 10%，在**搜索框**里敲一个字，确认动画列表里**没有任何新条目**；再在**歌单命名框**里敲一个字，确认只有一条 280ms 的 transform/opacity 过渡。
    - 切到 `html[data-te-motion='reduced']` 与 `'off'`（三档由 `src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts` 驱动），确认两种输入框都能正常显示文字。注意 `base.css:425-433` 会把 reduced 档的所有 `transition-duration` 压到 `0.01ms`，`:435-441` 把 off 档的 transition 全 `none`，所以低频场景的动效在这两档本来就已经消失。
- **Done when**：
  - `grep -n "props.animate" src/renderer/src/components/AnimatedInput.vue` 命中 1 处（在 `animated` 计算属性里）。
  - `grep -n "scale(0.4)\|scale(0.3)" src/renderer/src/components/AnimatedInput.vue` 无命中。
  - `grep -rn "AnimatedInput" src/renderer/src --include=*.vue` 仍然是 11 个使用点（没有多也没有少）。
  - 加了 `animate` 的调用点正好 4 个：`AggregatePlaylistPage.vue:602` 区域、`CreateAggregatePlaylistDialog.vue:81` 区域、`QueueAddToPlaylistDialog.vue:82` 区域、`NcmPlaylistDialogs.vue:65` 区域。
  - `pnpm run typecheck`、`pnpm run lint`、`pnpm run build` 通过；`pnpm run test:app`、`pnpm run test:themes`、`pnpm run test:playlist-lifecycle` 的失败数不超过 HEAD 基线的 3 条。
  - 真机确认：搜索框打字零动效，歌单命名框仍有动效，镜像文字与 caret 对齐。
