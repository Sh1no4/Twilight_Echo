# 010 — 删掉播放确认脉冲与切歌入场 keyframes

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 目的与频次 + 可打断性（AUDIT 第 1 节 Purpose & frequency，第 4 节 Interruptibility）
- **Estimated scope**: 2 个文件（`PlayerBar.css`、`MiniPlayer.css`），删 4 条规则 + 4 个 `@keyframes`；纯 CSS 删除，不动任何 JS

## Problem

播放/暂停按钮在 `is-playing` 时跑一次 `scale: 1.1` 的脉冲 keyframes，切歌时整个左侧信息区从左侧 10px 淡入。**这两个动效都能被全局快捷键和媒体键触发**，而 keyframes 从零重启、不 retarget —— 连点或连续切歌时动画反复从头开始。

### 位置一：主播放栏的播放确认脉冲

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

`--te-motion-panel` 是 `280ms`（`src/renderer/src/assets/base.css:34`），`--te-ease-spring` 是 `cubic-bezier(0.22, 1.14, 0.36, 1)`（`:29`）。

### 位置二：迷你播放器的同形状脉冲

```css
/* src/renderer/src/mini-player/MiniPlayer.css:648-656 — 当前 */
html[data-te-motion='full'] .mini-play-button.is-playing {
  animation: mini-play-confirm var(--te-motion-press) var(--te-ease-spring) both;
}

@keyframes mini-play-confirm {
  46% {
    scale: 1.1;
  }
}
```

这里用的是 `--te-motion-press`（`90ms`，`base.css:32`），比主播放栏短，但形状完全相同。`.mini-play-button.is-playing` 的类由 `src/renderer/src/mini-player/MiniPlayerApp.vue:580` 挂上：`:class="{ 'is-playing': state.isPlaying }"`。

### 位置三：切歌时的左侧信息区入场

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:1298-1307 — 当前 */
:global(html[data-te-motion='full'] .player-left) {
  animation: player-track-arrive var(--te-motion-panel) var(--te-ease-spring) both;
}

@keyframes player-track-arrive {
  from {
    opacity: 0;
    translate: -10px 0;
  }
}
```

**这个入场动效不是设计意图，是修 bug 用的 key 的副作用。** 重挂载来源：

```ts
// src/renderer/src/components/PlayerBar.vue:180-184 — 当前
/** Destroy/recreate the whole left rail on track change (navigation remount is what fixed covers). */
const playerLeftKey = computed(
  () =>
    `pl:${currentTrack.value?.id ?? 'none'}:${currentTrack.value?.queueEntryId ?? ''}:${currentTrack.value?.cover ?? ''}`
)
```

```ts
// src/renderer/src/components/PlayerBar.vue:228-238 — 当前
const barRegions = computed(() => {
  const regions = resolvePlayerBarRegions(settings.value.playerBar.layout, props.mode)
  return PLAYER_BAR_REGION_NAMES.map((name: PlayerBarRegionName) => ({
    name,
    className: `player-${name}`,
    // The left rail still remounts on track change — that remount is what fixed
    // stale covers — so its key carries the track identity, not just the region.
    key: name === 'left' ? `left:${playerLeftKey.value}` : name,
    items: regions[name]
  }))
})
```

两处注释都写明：这个 key 存在的理由是**修封面缓存 bug**。CSS animation 在元素挂载时自动播放，所以每次切歌重挂载都顺带播一次 `player-track-arrive` —— 动效是 bug 修复的意外产物，没有人为它做过设计决策。

### 位置四：键盘链路（逐环已确认）

1. `src/main/core/settings.ts:127-132` 定义默认全局快捷键：
   ```ts
   export const DEFAULT_GLOBAL_SHORTCUT_BINDINGS: GlobalShortcutSettings = {
     previous: 'CommandOrControl+Alt+Left',
     next: 'CommandOrControl+Alt+Right',
     playPause: 'CommandOrControl+Alt+Space',
     toggleDesktopLyrics: 'CommandOrControl+Alt+D'
   }
   ```
2. `src/main/integrations/shortcutsTray.ts:50-63` 把这些注册成全局快捷键，并在 `:61` 追加 `...MEDIA_KEY_SHORTCUTS`。媒体键清单在 `src/main/core/types.ts:68-77`：`MediaPreviousTrack`、`MediaNextTrack`、`MediaPlayPause`、`MediaStop`。
3. `src/preload/domains/settingsApi.ts:13` 把事件转到渲染层。
4. `src/renderer/src/stores/usePlayerStore.ts:3165-3167` 执行：
   ```ts
   // playPause
   await togglePlayState()
   ```
5. `isPlaying` 翻转，`src/renderer/src/components/PlayerBar.vue:1786-1793` 的类跟着变：
   ```html
   <button
     class="ctrl-btn btn-play"
     :class="{ 'is-playing': isPlaying }"
     aria-label="播放/暂停"
     @click="togglePlay"
   >
   ```

也就是说：**按一次 `Ctrl+Alt+Space` 或键盘上的播放键，就跑一次 280ms 的弹簧脉冲。** 用户根本没有把视线放在播放按钮上（快捷键的用途就是不用看界面），动效在向没人看的地方汇报。

### 位置五：这是同一次交互的第二个动效

按钮本身已经有全局按压反馈：

```css
/* src/renderer/src/assets/base.css:385-390 — 当前 */
html[data-te-motion='full']
  :where(button, [role='button'], [role='switch'], [data-te-interactive]):not(:disabled):not(
    [aria-disabled='true']
  ):active {
  animation: te-interactive-press var(--te-motion-press) var(--te-ease-soft);
}
```

`te-interactive-press` 的关键帧在 `base.css:401-409`，在 48% 处把 `scale` 压到 `var(--te-motion-press-scale)`（`0.96`）。所以点一次播放按钮，用户看到：先缩到 0.96（按压反馈），再放大到 1.1（播放确认）。**同一次交互两个动效**，违反本仓设计文档 `docs/apple-music-inspired-hifi-player-design-system.md:86` 的 P10：

> | P10 | Restraint is a brand | Apple Music never celebrates its own UI | One animation per interaction, ≤ 500 ms for feedback; anything longer must be scrubbable or cancelable. |

### 位置六：keyframes 违反本仓自己的可打断性规则

`docs/apple-music-inspired-hifi-player-design-system.md:81` 的 P5：

> | P5 | Motion is interruptible | Scrubbing the progress bar retargets instantly | All animations use springs; interrupting an animation must continue from the current value (no reset). |

同文档 `:622`：

> **Interruption rule:** springs retarget from current value on new input; duration-based animations must expose `cancel()` and jump to target state instantly.

AUDIT 第 4 节原文：「CSS **transitions** retarget from the current state mid-animation; **keyframes** restart from zero. Anything triggered rapidly or reversible mid-motion (toasts stacking, toggles, drags, expand/collapse) must use transitions or springs.」同节 Hunt 项：「Hunt for: `@keyframes` on toasts/**toggles**/rapidly-triggered UI」。

播放/暂停就是教科书级别的 toggle，而且是本应用最高频的 toggle。

### AUDIT 频次表依据

AUDIT 第 1 节，第一行原文：

| Frequency | Decision |
| --- | --- |
| 100+ times/day (keyboard shortcuts, command palette toggle) | No animation. Ever. |

同节 Hunt 项原文：「Hunt for: **animations on keyboard-initiated actions**…**The strongest fix is often delete the animation.**」

`player-track-arrive` 另有一条独立问题：**它是内容替换，不是空间移动**。播放栏的位置在切歌前后完全没变，封面和标题只是换了内容。让整块从左侧 10px 淡入，**没有解释任何空间关系** —— 没有东西「从左边来」。AUDIT 第 1 节要求每个动效回答「why does this animate?」，这里的答案只能是「因为 DOM 恰好重挂载了」。

### 同族规则（本方案一并删除）

**`queue-item-confirm`** —— 队列里的当前项，随切歌变化：

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:570-578 — 当前 */
:global(html[data-te-motion='full'] .playlist-item.active) {
  animation: queue-item-confirm var(--te-motion-panel) var(--te-ease-spring) both;
}

@keyframes queue-item-confirm {
  48% {
    scale: 1.012;
  }
}
```

`scale: 1.012` 是 1.2% 的缩放 —— 在一个 40px 高的列表项上大约 0.5px 的变化。**这个幅度基本看不见，但它每次切歌都在一整列队列项上触发布局无关的合成工作**。既然看不见，它连「装饰」都算不上，纯粹是成本。跟着一起删。

**`side-menu-indicator-in`** —— 导航指示条，随点击变化：

```css
/* src/renderer/src/components/SideMenu.vue:342-351 — 当前 */
:global(html[data-te-motion='full'] .menu-item.active::before) {
  animation: side-menu-indicator-in var(--te-motion-press) var(--te-ease-spring) both;
}

@keyframes side-menu-indicator-in {
  from {
    opacity: 0;
    scale: 1 0.45;
  }
}
```

**这一条本方案不删。** 理由：导航切换的频次是「Tens of times/day」（AUDIT 表格第二行「Remove or drastically reduce」），比播放/暂停低一档；而且指示条是**从无到有出现**的元素（切换页面时它在新位置第一次出现），90ms 的纵向展开确实在解释「指示器落到这一项上」。它归 011 号方案的导航面一起判断更合适 —— 本方案只在这里点名登记，**不做修改**。

### 与 002 号方案的冲突（执行前必读）

002 号方案正在重写 `base.css:385-399` 的全局按压/悬停反馈，把 `:active` 改成 `transform: scale(0.97)` + `transition: transform 160ms ease-out`。

冲突点在于：`te-interactive-press`（现状用 `animation` + `scale` 属性）与 `player-play-confirm`（也用 `animation` + `scale` 属性）**作用于同一个按钮的同一个属性**。谁压过谁取决于层叠顺序与 animation 列表顺序，行为不直观。

- **本方案删掉 `player-play-confirm` 后，这个冲突就消失了** —— 按钮上只剩全局按压反馈一个动效，正好满足 P10。
- **执行顺序无所谓**：本方案只做删除，不新增任何 `scale` 动画，与 002 号方案不会互相破坏。
- 但 **feel check 时必须真机确认**：删掉脉冲后，播放按钮的按压反馈（无论是当前的 `te-interactive-press` keyframes 还是 002 落地后的 `transform: scale(0.97)` 过渡）**仍然可见**。如果按压反馈也一起消失了，说明删多了或者 002 的改动还没落地 —— 停下报告。

## Target

删掉 4 条 `animation` 声明与它们对应的 4 个 `@keyframes` 块。**删除后这四处不留任何替代动效** —— 按压反馈由 `base.css:385-390` 的全局规则承担，状态指示由 `is-playing` 类切换的图标（播放/暂停图标本身就换了，见 `PlayerBar.vue:1792` 的 `:src="isPlaying ? pauseIcon : playIcon"`）承担。

### `PlayerBar.css` 的目标状态

`:1296-1318` 区间（当前含两条 `:global(…)` 规则和两个 `@keyframes`）删成：

```css
/* target — src/renderer/src/components/player-bar/PlayerBar.css，:1293-1318 区间 */
.btn-play:hover {
  background: var(--play-button-color, var(--accent-color, var(--te-primary-500)));
  box-shadow: none;
}

.btn-play i {
  font-size: 18px;
  line-height: 1;
  color: #fff;
}
```

即 `.btn-play:hover` 与 `.btn-play i` 之间的所有内容（`player-track-arrive` 规则 + keyframes + `player-play-confirm` 规则 + keyframes）整段删除。

`:568-579` 区间的队列项规则删成：

```css
/* target — src/renderer/src/components/player-bar/PlayerBar.css，:568-579 区间 */
  border-color: color-mix(in srgb, var(--te-primary-500) 16%, transparent);
}

.panel-glass .playlist-item.active {
```

即 `:global(html[data-te-motion='full'] .playlist-item.active)` 规则与 `@keyframes queue-item-confirm` 整段删除，前后两条规则直接相邻。

### `MiniPlayer.css` 的目标状态

`:646-657` 区间删成：

```css
/* target — src/renderer/src/mini-player/MiniPlayer.css，:642-658 区间 */
.mini-tool-button:active,
.mini-control-button:active,
.mini-play-button:active {
  transform: scale(0.88);
}

.mini-progress-block {
```

即 `html[data-te-motion='full'] .mini-play-button.is-playing` 规则与 `@keyframes mini-play-confirm` 整段删除。**`:642-646` 的 `:active { transform: scale(0.88); }` 保留不动** —— 那是迷你播放器自己的按压反馈，是本次交互唯一该留的动效。

### 不改动的部分

- `src/renderer/src/components/PlayerBar.vue:180-184` 的 `playerLeftKey`、`:228-238` 的 `barRegions` **一个字都不改**。那是封面 bug 的修复，动它会让 bug 回归。删掉 CSS animation 后重挂载仍然发生，只是不再播动画 —— 这正是要的结果。
- `src/renderer/src/components/PlayerBar.vue:1786-1793` 的 `:class="{ 'is-playing': isPlaying }"` **保留**。这个类还在被别的样式用（也是未来状态样式的挂载点），删类会牵连别处。
- `src/renderer/src/mini-player/MiniPlayerApp.vue:86` 与 `:580` 的 `is-playing` 类同样**保留**。

## Repo conventions to follow

- 动效 token 住在 `src/renderer/src/assets/base.css:26-40`。本方案**不新增 token，不改任何 token 的值**。
- 三档动效模式由 `html[data-te-motion='full'|'reduced'|'off']` 驱动（`src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts`）。被删的 4 条规则全部挂在 `[data-te-motion='full']` 上，删掉后 reduced/off 两档的行为不变（那两档在 `base.css:425-441` 已经被全局压平）。
- 「一次交互只给一个动效」的仓库样板 —— `src/renderer/src/mini-player/MiniPlayer.css:642-646`：
  ```css
  .mini-tool-button:active,
  .mini-control-button:active,
  .mini-play-button:active {
    transform: scale(0.88);
  }
  ```
  一条 `:active` 变换，没有第二层脉冲。
- `PlayerBar.css` 是 scoped 样式，跨组件选择器要写 `:global(…)`；`MiniPlayer.css` 是普通样式表，直接写选择器。删除时注意两者格式不同，不要把一个文件的写法带到另一个。

## Steps

1. 打开 `src/renderer/src/components/player-bar/PlayerBar.css`，定位 `:1298-1307`，删掉整段：
   ```css
   :global(html[data-te-motion='full'] .player-left) {
     animation: player-track-arrive var(--te-motion-panel) var(--te-ease-spring) both;
   }

   @keyframes player-track-arrive {
     from {
       opacity: 0;
       translate: -10px 0;
     }
   }
   ```
2. 同一文件，定位 `:1309-1317`，删掉整段：
   ```css
   :global(html[data-te-motion='full'] .btn-play.is-playing) {
     animation: player-play-confirm var(--te-motion-panel) var(--te-ease-spring) both;
   }

   @keyframes player-play-confirm {
     46% {
       scale: 1.1;
     }
   }
   ```
   删完后 `.btn-play:hover { … }` 的闭合花括号与 `.btn-play i {` 之间应当只隔一个空行。
3. 同一文件，定位 `:570-578`，删掉整段：
   ```css
   :global(html[data-te-motion='full'] .playlist-item.active) {
     animation: queue-item-confirm var(--te-motion-panel) var(--te-ease-spring) both;
   }

   @keyframes queue-item-confirm {
     48% {
       scale: 1.012;
     }
   }
   ```
   删完后 `border-color: color-mix(in srgb, var(--te-primary-500) 16%, transparent);` 所在规则的闭合花括号与 `.panel-glass .playlist-item.active {` 之间应当只隔一个空行。
4. 打开 `src/renderer/src/mini-player/MiniPlayer.css`，定位 `:648-656`，删掉整段：
   ```css
   html[data-te-motion='full'] .mini-play-button.is-playing {
     animation: mini-play-confirm var(--te-motion-press) var(--te-ease-spring) both;
   }

   @keyframes mini-play-confirm {
     46% {
       scale: 1.1;
     }
   }
   ```
   删完后 `.mini-play-button:active { transform: scale(0.88); }` 的闭合花括号与 `.mini-progress-block {` 之间应当只隔一个空行。**不要删 `:642-646` 的 `:active` 规则。**
5. 不做其他任何修改。本方案共 4 处删除，全部在这两个 CSS 文件里。

## Boundaries

- **不要动 `src/renderer/src/components/PlayerBar.vue`。** 特别是 `:180-184` 的 `playerLeftKey` 与 `:228-238` 的 `barRegions` —— 两处注释都写明这个 key 是封面缓存 bug 的修复，改它 bug 就回来了。也不要删 `:1788` 的 `:class="{ 'is-playing': isPlaying }"`。
- **不要动 `src/renderer/src/mini-player/MiniPlayerApp.vue`。** `:86` 与 `:580` 的 `is-playing` 类保留。
- **不要动 `src/renderer/src/mini-player/MiniPlayer.css:642-646` 的 `:active { transform: scale(0.88); }`。** 那是迷你播放器的按压反馈，删了按钮就没有任何点击反馈了。
- **不要动 `src/renderer/src/assets/base.css:385-399` 的全局按压/悬停反馈，也不要动 `:401-409` 的 `te-interactive-press` keyframes。** 那一族正在被 **002 号方案**重写（改成 `:active` + `transform: scale(0.97)` + `transition: transform 160ms ease-out`），本方案不许碰它，避免两个方案打架。
- **不要动 `src/renderer/src/components/SideMenu.vue:342-351` 的 `side-menu-indicator-in`。** 本方案只登记它，不修改；它归 011 号方案的导航面判断。
- **不要动主进程的任何文件**：`src/main/core/settings.ts`、`src/main/integrations/shortcutsTray.ts`、`src/main/core/types.ts` 都只是证据链，不是改动目标。快捷键绑定与媒体键清单保持原样。
- **不要动 `src/renderer/src/stores/usePlayerStore.ts`。**
- **不要给删掉的位置补别的动效。** AUDIT 第 1 节原文：「The strongest fix is often **delete the animation**」。本方案的正确产出是**四段代码消失**，不是把 280ms 调成 120ms、不是把 `scale: 1.1` 调成 `1.03`、不是把 keyframes 换成 transition。**把删除改成调参就是执行错误。**
- **不要引入对 `--te-neutral-800` 或 `--te-primary-600` 的引用** —— 这两个 token 在任何主题里都没有定义。
- 不要新增依赖，不要改 `package.json`，不要改任何测试文件。
- **若某一步找不到对应代码（行号漂移、规则已被改过、keyframes 名字不符），停下来报告，不要自行发挥** —— 尤其不要在别的形状相似的 `animation:` 声明上凑一个删除交差。`PlayerBar.css` 里还有多条 `var(--te-ease-spring) both` 形状的规则，删错位置会破坏别的动效。

## Verification

- **Mechanical**：
  - `pnpm run lint` —— 应当通过（纯 CSS 删除）。
  - `pnpm run typecheck` —— 不应有类型错误。
  - `pnpm run test:playback-routing` —— 这一档包含三个相关门禁：
    - `src/renderer/src/components/SideMenu.test.ts` —— 它钉住 `App.vue` 与 `PlayerBar.css` 的多条声明字面量（`transition: padding-left 0.32s var(--te-ease-soft);`、`transition: left 0.32s var(--te-ease-soft);` 与 4 条裸 cubic-bezier，见该测试 `:9-24`）。**本方案删的 4 条都不在它的断言里**，不应触发；但它读的正是 `PlayerBar.css`，删错位置会立刻变红。
    - `src/renderer/src/components/player-bar/compactPlayerBarStructure.test.ts` —— 该文件 `:103` 钉的是 `assert.match(compactVisualizer, /transition:\s*transform 55ms linear/)`（作用于 `CompactPlayerBarVisualizer`，不是 `PlayerBar.css`）。本方案不碰可视化器，不应触发。
    - `src/renderer/src/mini-player/styles.test.ts` —— 断言 `mini-lyric-switch` 名与类名存在（该测试 `:79`、`:89-90`）。本方案不碰 `mini-lyric-switch`，不应触发；但它读的正是 `MiniPlayer.css`，删错位置会变红。
  - `pnpm run test:app` —— 包含 `src/renderer/src/app/useMotionPreference.test.ts`。该测试用正则钉住 `base.css` 多条动效规则（`:59-71`），本方案不碰 `base.css`；它另有一条**全量 `.vue` 扫描**要求带 `@click` 的非原生标签必须有 `data-te-interactive` 之类的标记（`:74-99`）—— 本方案不删任何 `.vue` 里的标记，不应触发。它还断言 `miniPlayerCss` 匹配 `/html\[data-te-motion='reduced'\] .mini-player-root/`（`:68`），本方案删的是 `[data-te-motion='full']` 那条，reduced 那条保持原样。
  - `pnpm run build` —— 应当构建成功。
  - **验证 keyframes 名字确实没被别处引用**（删之前先跑一遍确认，删之后再跑一遍确认归零）：
    ```
    grep -rn "player-play-confirm\|mini-play-confirm\|player-track-arrive\|queue-item-confirm" src/ resources/ scripts/ docs/
    ```
    删除前应当只在这两个 CSS 文件里各命中「声明 + keyframes」两处；**没有任何测试文件引用这四个名字**（已确认），所以删除是机械安全的。
  - **注意：HEAD（9312f3e）上本来就有 3 条测试是红的。** 跑套件前先在未改动的工作树上记一次基线，只对比新增的失败。**若新增测试，必须登记进 `package.json` 的某个 `test:*` 脚本**，否则不会被执行（本方案不要求新增测试）。
- **Feel check**（真实渲染，不许用简化替身当证据）：先 `npx electron-vite build` 让 `out/` 带上改动，再用隔离 profile 启动 + CDP：
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`。
  - **播放栏只在有当前曲目时挂载**：seed `<profile>/playback-session.json`（`{version:1, savedAt, mode:'trackAndPosition', track, position, queue, queueIndex}`，塞一个真 `duration`，否则进度填充恒为 `scaleX(0)`）+ settings 里 `playbackResumeMode: 'trackAndPosition'`。**队列里至少放 3 首**，否则测不了切歌。
  - 优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-playbar-shapes.cjs` 最贴近 —— 它已经能拿到播放条的三种形态（`TE_THEME=` / `TE_PRESET=` / `TE_PORT=`），迷你形态的验证直接复用。
  - **全局快捷键必须用 CDP `Input.dispatchKeyEvent` 驱动**（modifiers 位掩码 Alt=1 Ctrl=2 Meta=4 Shift=8，`keyDown` 与 `keyUp` 都发，带 `windowsVirtualKeyCode`）。播放/暂停是 `CommandOrControl+Alt+Space`，即 modifiers `2|1 = 3`、`windowsVirtualKeyCode: 32`。**合成 `dispatchEvent` 证明不了真实链路** —— 这一条对本方案尤其关键，因为整个 finding 的核心就是「快捷键路径同样触发动效」。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - 窗口 `deviceScaleFactor` 是 1.5，截图 clip 是 CSS px 但 PNG 带缩放，用 `png.width / clipWidth` 反推。
  - 进出播放页的坑：`.player-cover-slot` 的点击是**切换**不是打开（`App.handleCoverClick` 在播放页已开时会关掉它），所以每一步先读 `!!document.querySelector('.playing-music')` 再动手；`PlayingMusic` 不 emit `back`，播放页没有自带关闭按钮，出口只有迷你/紧凑栏的 `.playing-page-exit-button` 或再点封面槽；迷你和紧凑形态都没有封面槽，要进播放页得先切标准形态。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
  - 要确认的观察点：
    - 用 `Input.dispatchKeyEvent` 发 `Ctrl+Alt+Space`，**播放按钮完全静止**（只有图标从播放换成暂停）。改动前能看到按钮弹到 1.1 倍再回落。
    - **连发 5 次 `Ctrl+Alt+Space`（间隔 100ms）**，按钮不该有任何抖动叠加。这是「keyframes 从零重启」问题的直接复现路径。
    - 鼠标**点击**播放按钮，**按压反馈仍然在**（当前是 `te-interactive-press` 缩到 0.96；若 002 号方案已落地则是 `transform: scale(0.97)` 的 160ms 过渡）。**如果按压反馈也消失了，说明删多了或 002 还没落地 —— 停下报告。**
    - 用 `Input.dispatchKeyEvent` 发 `Ctrl+Alt+Right`（下一首，modifiers `3`、`windowsVirtualKeyCode: 39`），**封面与标题直接换成新曲目，没有从左侧 10px 淡入**。快速连发 3 次，左侧信息区不该有位移叠加。
    - 打开播放栏的队列抽屉，切歌时**当前项不再有 1.012 倍的脉冲**（这个改动前也几乎看不见，主要看 DevTools Animations 面板里动画条目消失）。
    - 切到迷你播放器形态，同样用快捷键播放/暂停，**迷你播放按钮不再脉冲**，但鼠标点击时 `transform: scale(0.88)` 的按压反馈仍然在。
    - **在 DevTools Animations 面板把播放速度设为 10%**，然后：发一次 `Ctrl+Alt+Space` —— 动画列表里应当**没有任何条目**（`player-play-confirm` / `mini-play-confirm` 都消失了）；发一次 `Ctrl+Alt+Right` —— 动画列表里应当**没有 `player-track-arrive`**。这是本方案最直接的取证方式，比截图可靠。
    - 切到 `html[data-te-motion='reduced']` 与 `'off'`（三档由 `src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts` 驱动），确认播放按钮与切歌行为都正常（这两档本来就被 `base.css:425-441` 压平，删除后行为不变）。
    - 在 DevTools Rendering 面板打开 `prefers-reduced-motion: reduce`，确认播放/切歌功能正常。
- **Done when**：
  - `grep -rn "player-play-confirm\|mini-play-confirm\|player-track-arrive\|queue-item-confirm" src/ resources/ scripts/ docs/` **零命中**。
  - `grep -n "te-interactive-press" src/renderer/src/assets/base.css` 仍然命中（全局按压反馈没被误删）。
  - `grep -n "transform: scale(0.88)" src/renderer/src/mini-player/MiniPlayer.css` 仍然命中（迷你按压反馈没被误删）。
  - `grep -n "playerLeftKey" src/renderer/src/components/PlayerBar.vue` 仍然命中 2 处（`:181` 定义、`:235` 使用），封面 bug 修复完好。
  - `grep -n "side-menu-indicator-in" src/renderer/src/components/SideMenu.vue` 仍然命中（本方案没越界删它）。
  - `pnpm run lint`、`pnpm run typecheck`、`pnpm run build` 通过；`pnpm run test:playback-routing`、`pnpm run test:app` 的失败数不超过 HEAD 基线的 3 条。
  - 真机确认：快捷键播放/暂停零动效、连点无叠加、切歌无淡入，且鼠标点击的按压反馈完好。
