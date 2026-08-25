# 012 — 删掉歌单行的死指针追踪 rAF 与常驻流动描边

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: MEDIUM
- **Category**: 性能 + 目的与频次（AUDIT 第 5 节 Performance、第 1 节 Purpose & frequency）
- **Estimated scope**: 4 个文件（1 个 .ts、2 个 .vue、1 个 .css），删约 30 行，纯删除

## Problem

歌单每一行都挂着 `pointermove` 监听，每帧一次 `getBoundingClientRect()` 加两次 `setProperty` 写自定义属性 —— 而这两个属性驱动的视觉**在任何状态下都不可见**。鼠标横穿长列表时，这是一串纯粹的无效样式重算。

### 位置一：逐帧写自定义属性的 rAF

```ts
// src/renderer/src/components/song-list/useSongListVirtualScroll.ts:65-80 — 当前
  function flushPointerMove(): void {
    const event = lastPointerEvent
    pointerMoveRafId = null
    if (!event) return
    const row = event.currentTarget as HTMLElement
    const rect = row.getBoundingClientRect()
    row.style.setProperty('--track-pointer-x', `${event.clientX - rect.left}px`)
    row.style.setProperty('--track-pointer-y', `${event.clientY - rect.top}px`)
  }

  function onRowPointerMove(event: PointerEvent): void {
    lastPointerEvent = event
    if (pointerMoveRafId === null) {
      pointerMoveRafId = requestAnimationFrame(flushPointerMove)
    }
  }
```

配套的模块级状态在同文件 `:40-41`：

```ts
// src/renderer/src/components/song-list/useSongListVirtualScroll.ts:40-41 — 当前
  let pointerMoveRafId: number | null = null
  let lastPointerEvent: PointerEvent | null = null
```

返回类型签名 `:28`：

```ts
// src/renderer/src/components/song-list/useSongListVirtualScroll.ts:28 — 当前
  onRowPointerMove: (event: PointerEvent) => void
```

卸载清理 `:106-109`：

```ts
// src/renderer/src/components/song-list/useSongListVirtualScroll.ts:106-109 — 当前
  onUnmounted(() => {
    window.removeEventListener('resize', updateViewportHeight)
    if (pointerMoveRafId !== null) cancelAnimationFrame(pointerMoveRafId)
  })
```

返回对象 `:132`：

```ts
// src/renderer/src/components/song-list/useSongListVirtualScroll.ts:131-133 — 当前
    onScroll,
    onRowPointerMove,
    updateViewportHeight,
```

### 位置二：两个绑定点（注意有两个，不是一个）

```html
<!-- src/renderer/src/components/SongList.vue:2118-2137 — 当前（节选） -->
                <tr
                  v-for="(track, index) in visibleTracks"
                  :key="track.id"
                  class="track-row"
                  data-te-interactive
                  :class="{
                    'track-playing': currentTrack?.id === track.id,
                    'track-selected': isSelected(track.id),
                    'playlist-draggable': isPlaylistDetail
                  }"
                  :style="{ height: rowHeight - 4 + 'px', display: 'flex' }"
                  :draggable="isPlaylistDetail"
                  @click="onRowClick(track, Number(index), $event)"
                  @dblclick="onRowDblClick(track, $event)"
                  @dragstart="handlePlaylistDragStart($event, track)"
                  @dragover.prevent
                  @drop="handlePlaylistDrop($event, track)"
                  @pointermove="onRowPointerMove"
                  @contextmenu="onTrackContextMenu($event, track)"
                >
```

```html
<!-- src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.vue:474-484 — 当前 -->
            <tr
              v-for="(track, index) in visibleTracks"
              :key="track.id"
              class="aggregate-row"
              data-te-interactive
              :class="{ 'is-playing': currentTrack?.id === track.id }"
              :style="{ height: rowHeight - 4 + 'px', display: 'flex' }"
              @click="onRowClick(track)"
              @dblclick="onRowDoubleClick(track)"
              @pointermove="onRowPointerMove"
            >
```

**聚合歌单这一处比 SongList 更彻底地无用**：`AggregatePlaylistPage.vue` 里 `.aggregate-row` **完全没有 `::before` / `::after` 规则**，也没有任何地方读 `--track-pointer-x` / `--track-pointer-y`。这一处 rAF 的产出从写下的第一天起就没有任何消费者。

对应的解构点分别是 `src/renderer/src/components/SongList.vue:869-882`（其中 `:878` 是 `onRowPointerMove,`）与 `src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.vue:111-126`（其中 `:120` 是 `onRowPointerMove`，注意这一处是解构列表的最后一项，**没有尾逗号**）。

### 位置三：属性默认值与那个唯一的 CSS 消费者

```css
/* src/renderer/src/components/song-list/SongList.css:1145-1161 — 当前 */
.track-row {
  --track-pointer-x: 50%;
  --track-pointer-y: 50%;
  position: relative;
  cursor: pointer;
  transition:
    background 0.22s,
    transform 0.24s var(--te-ease-soft),
    box-shadow 0.24s,
    filter 0.24s;
  width: 100%;
  border-radius: var(--te-radius-global);
  margin: 2px 0;
  isolation: isolate;
  transform-origin: center;
  z-index: 0;
}
```

```css
/* src/renderer/src/components/song-list/SongList.css:1195-1214 — 当前 */
.track-row::after {
  z-index: 2;
  inset: 0;
  padding: 1px;
  background: radial-gradient(
    circle 92px at var(--track-pointer-x) var(--track-pointer-y),
    rgba(124, 77, 255, 0.4) 0%,
    rgba(34, 211, 238, 0.3) 34%,
    rgba(255, 126, 182, 0.24) 55%,
    transparent 76%
  );
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask-composite: xor;
}
```

### 这个 radial-gradient 在任何状态下都画不出来

把 `.track-row::after` 的所有相关规则按层叠拉齐：

1. **基础态** `SongList.css:1171-1179` —— `opacity: 0`：
   ```css
   /* src/renderer/src/components/song-list/SongList.css:1171-1179 — 当前 */
   .track-row::before,
   .track-row::after {
     content: '';
     position: absolute;
     border-radius: inherit;
     pointer-events: none;
     opacity: 0;
     transition: opacity 0.24s ease;
   }
   ```

2. **hover 态** `SongList.css:1235-1240` —— 被显式改回 `0`，注释写明是刻意关掉的：
   ```css
   /* src/renderer/src/components/song-list/SongList.css:1235-1240 — 当前 */
   /* U2: 关闭 hover 的玻璃层与动画渐变描边（pointer-border-pulse / border-gradient-flow） */
   .track-row:hover::before,
   .track-row:hover::after {
     opacity: 0;
     animation: none !important;
   }
   ```

3. **选中态** `SongList.css:2029-2034` —— `opacity: 0 !important`：
   ```css
   /* src/renderer/src/components/song-list/SongList.css:2029-2034 — 当前 */
   /* Kill pointer/border glow on selected rows (hover + resting) */
   .track-row.track-selected::after,
   .track-row.track-selected:hover::after {
     opacity: 0 !important;
     animation: none !important;
   }
   ```

4. **选中 + 正在播放态** `SongList.css:2073-2075` —— 这是唯一 `opacity: 1` 的状态：
   ```css
   /* src/renderer/src/components/song-list/SongList.css:2073-2075 — 当前 */
   .track-row.track-selected.track-playing::after {
     opacity: 1 !important;
   }
   ```
   **但这一状态里显示的不是 radial-gradient。** `.track-row.track-selected.track-playing` 同时匹配 `.track-playing::after`（`:1281`），后者把 `background` 覆写成了 linear-gradient。两条规则的特异度相同（`.track-row::after` 是一个类 + 一个伪元素 = (0,1,1)；`.track-playing::after` 同样是 (0,1,1)），**同特异度下后写的赢**，而 `:1281` 在 `:1195` 之后 —— 所以这一行画出来的是流动的线性渐变描边，与指针位置无关。

结论：`--track-pointer-x` / `--track-pointer-y` **没有任何可见消费者**。每帧的 rAF 工作量 100% 是浪费。

### 留下的成本

`getBoundingClientRect()` 是强制同步布局（读操作发生在两次写之前，所以单次调用内不构成 read-after-write，但读本身仍然要刷新待处理的布局）。更贵的是那两次 `setProperty`：**在行元素上写自定义属性会让该行整棵子树的样式失效并重算** —— 封面 `img`、标题、艺术家、徽章、时长、操作按钮全部跟着重算。长列表里鼠标横穿多行，就是一串连续的无效样式重算。

### AUDIT 依据

AUDIT 第 5 节 Performance 的 Hunt 清单直接点名了这个形状：

- 「**Don't drive child transforms via a CSS variable on the parent** — it recalcs styles for all children. Set `transform` directly on the element.」
- Hunt 项：「`setProperty('--x', …)` driving child transforms, rAF loops doing what CSS could.」

AUDIT 第 1 节 Purpose & frequency 要求每个动效回答「why does this animate?」。这里的答案是：它不再画任何东西。同节结论：「The strongest fix is often **delete the animation**.」

### 连带死代码

```css
/* src/renderer/src/components/song-list/SongList.css:1620-1626 — 当前，无任何引用 */
@keyframes hover-gradient-flow {
  to {
    background-position:
      100% 0,
      260% 0;
  }
}
```

```css
/* src/renderer/src/components/song-list/SongList.css:1628-1638 — 当前，无任何引用 */
@keyframes pointer-border-pulse {
  0%,
  100% {
    opacity: 0.72;
    filter: saturate(1.05);
  }
  50% {
    opacity: 1;
    filter: saturate(1.24);
  }
}
```

这两个 keyframes 名只在 `:1235` 的注释里出现过（说明它们是被关掉的那两个效果），没有任何 `animation:` 声明引用它们。全仓检索确认：没有任何测试文件断言这两个名字。

### 第二件事（同文件，LOW）：正在播放的行常驻跑流动描边

```css
/* src/renderer/src/components/song-list/SongList.css:1281-1292 — 当前 */
.track-playing::after {
  opacity: 1;
  background: linear-gradient(
    90deg,
    rgba(124, 77, 255, 0.88),
    rgba(34, 211, 238, 0.72),
    rgba(255, 126, 182, 0.82),
    rgba(124, 77, 255, 0.88)
  );
  background-size: 260% 100%;
  animation: border-gradient-flow 3.4s linear infinite;
}
```

```css
/* src/renderer/src/components/song-list/SongList.css:1614-1618 — 当前 */
@keyframes border-gradient-flow {
  to {
    background-position: 260% 0;
  }
}
```

这是一个 `infinite` 的动画，动的是 `background-position` —— **不是 transform / opacity，必须逐帧重绘**。它常驻在正在播放的那一行上，只要列表可见就一直跑。

而「这一行正在播放」的状态指示职责**已经由静态样式完成**：

```css
/* src/renderer/src/components/song-list/SongList.css:1266-1270 — 当前 */
.track-playing {
  background: var(--te-playing-row-bg, rgba(124, 77, 255, 0.08)) !important;
  box-shadow: inset 0 0 0 1px rgba(124, 77, 255, 0.28);
  z-index: 1;
}
```

背景色变化 + 1px 内描边已经把状态说清楚了，流动渐变没有增加任何信息。AUDIT 第 1 节：「'It looks cool' on a frequently-seen element is not a purpose.」歌单是这个应用最常看的页面。

遮挡与 reduced-motion 两个门禁已经就位，说明这个动画的成本此前已被认识到，只是没有关掉常态那一档：

```css
/* src/renderer/src/components/song-list/SongList.css:1294-1307 — 当前 */
/* The animated border is decorative. Pause it whenever the row is not the
   visible surface or motion has been reduced, so playback-page transitions and
   hidden documents do not keep a paint-driven animation alive. */
:global(.main-content.playing-open .track-playing::after),
:global(html[data-te-motion='reduced'] .track-playing::after),
:global(html[data-te-motion='off'] .track-playing::after) {
  animation-play-state: paused;
}

@media (prefers-reduced-motion: reduce) {
  .track-playing::after {
    animation-play-state: paused;
  }
}
```

注释自己写着「The animated border is decorative」。

## Target

### 前半段：删掉死指针追踪

`src/renderer/src/components/song-list/useSongListVirtualScroll.ts` 不再有 `flushPointerMove`、`onRowPointerMove`、`pointerMoveRafId`、`lastPointerEvent`；返回类型与返回对象都不再有 `onRowPointerMove`；`onUnmounted` 只保留 resize 摘除：

```ts
/* target — src/renderer/src/components/song-list/useSongListVirtualScroll.ts */
  onUnmounted(() => {
    window.removeEventListener('resize', updateViewportHeight)
  })
```

两个模板不再有 `@pointermove="onRowPointerMove"`，两个解构不再有 `onRowPointerMove`。

`src/renderer/src/components/song-list/SongList.css` 里：

- `.track-row` 不再声明 `--track-pointer-x` / `--track-pointer-y` 两个默认值。
- `.track-row::after`（`:1195`）整条规则删除 —— 它的全部内容（radial-gradient + mask 组合）都只为那个指针光晕服务。
- `@keyframes hover-gradient-flow` 与 `@keyframes pointer-border-pulse` 两条删除。

`::after` 这个伪元素**本身要保留**（`:1171-1179` 的 `.track-row::before, .track-row::after` 共享块不动，`:1281` 的 `.track-playing::after` 仍然用它画正在播放的描边）。

### 后半段：正在播放的行改为静态描边

```css
/* target — src/renderer/src/components/song-list/SongList.css，替换 :1281-1292 */
.track-playing::after {
  opacity: 1;
  background: linear-gradient(
    90deg,
    rgba(124, 77, 255, 0.88),
    rgba(34, 211, 238, 0.72),
    rgba(255, 126, 182, 0.82),
    rgba(124, 77, 255, 0.88)
  );
}
```

即：删掉 `background-size: 260% 100%;` 与 `animation: border-gradient-flow 3.4s linear infinite;` 两行，渐变**颜色保持完全不变**，描边从流动变成静止。删掉这两行后 `@keyframes border-gradient-flow`（`:1614-1618`）也成为死代码，一并删除。

配套地，`:1294-1307` 那两组 `animation-play-state: paused` 门禁与 `:1262` 的 `.song-left.is-switching .track-playing::after { animation: none !important; }` 都随之失去作用对象 —— **但本方案不删它们**（见 Boundaries：留着无害，删了会撞 `.track-row::before` 那一侧的其他 animation 声明判断，交给后续方案）。

本方案**不改** `.track-playing` 的背景色、`box-shadow`、`z-index`，不改 `.track-playing::before` 的玻璃层。

## Repo conventions to follow

- 动效 token 住在 `src/renderer/src/assets/base.css:26-40`（`--te-ease-enter/soft/spring/out-quint/out-expo`、`--te-motion-press: 90ms` / `hover: 160ms` / `panel: 280ms` / `page: 400ms` / `settle: 500ms` / `return: 220ms`）。**本方案是纯删除，不引入任何新 token、新时长、新曲线。**
- 三档动效模式由 `html[data-te-motion='full'|'reduced'|'off']` 驱动（`src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts`）。本方案删掉的是常态动效，不触碰这套机制。
- 「删掉装饰动效，只留静态指示」的仓库样板 —— 就在同一个文件里，`src/renderer/src/components/song-list/SongList.css:1227-1233`，`U2` 这一轮对 hover 做过完全相同的处置：
  ```css
  .track-row:hover {
    background: transparent;
    /* U2: 无位移、无大阴影、无动画描边，仅保留静态细描边 */
    box-shadow: inset 0 0 0 1px var(--te-library-row-hover-border, rgba(124, 77, 255, 0.22));
    filter: none;
    z-index: 3;
  }
  ```
  本方案对「正在播放」这一态做同样的事，与那一轮的判断保持一致。
- 帧合并工具 `createFrameCoalescer` 在 `src/renderer/src/utils/liquidGlassPointer.ts:136` 已存在。**本方案不需要用它** —— 正确的修复是删掉这个 rAF，不是把它改得更省。不要把 `flushPointerMove` 改写成 `createFrameCoalescer` 的调用。

## Steps

1. 打开 `src/renderer/src/components/song-list/useSongListVirtualScroll.ts`，删掉 `:40-41` 两行局部状态声明：
   ```ts
   let pointerMoveRafId: number | null = null
   let lastPointerEvent: PointerEvent | null = null
   ```
   （`:39` 的 `const rowHeight = ROW_HEIGHT` 保留。）

2. 同文件，删掉 `:65-80` 的 `flushPointerMove` 与 `onRowPointerMove` 两个函数整体（从 `function flushPointerMove(): void {` 到 `onRowPointerMove` 的收尾 `}`，含中间空行）。删完之后 `:60-63` 的 `onScroll` 与原 `:82` 的 `updateViewportHeight` 直接相邻，中间留一个空行。

3. 同文件，从返回类型签名里删掉 `:28` 这一行：
   ```ts
   onRowPointerMove: (event: PointerEvent) => void
   ```

4. 同文件，把 `onUnmounted` 改成只摘 resize 监听：
   ```ts
   onUnmounted(() => {
     window.removeEventListener('resize', updateViewportHeight)
   })
   ```
   即删掉 `if (pointerMoveRafId !== null) cancelAnimationFrame(pointerMoveRafId)` 这一行。

5. 同文件，从返回对象里删掉 `onRowPointerMove,` 这一行（原 `:132`，在 `onScroll,` 与 `updateViewportHeight,` 之间）。

6. 打开 `src/renderer/src/components/SongList.vue`，删掉 `:2135` 的 `@pointermove="onRowPointerMove"` 这一整行。`@drop` 与 `@contextmenu` 两行保留。**`class="track-row"` 与 `data-te-interactive` 必须原样保留**（见 Boundaries）。

7. 同文件，从 `:869-882` 的解构里删掉 `:878` 的 `onRowPointerMove,` 这一行。删完后 `onScroll,` 紧接 `updateViewportHeight,`。

8. 打开 `src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.vue`，删掉 `:483` 的 `@pointermove="onRowPointerMove"` 这一整行。**`data-te-interactive` 必须原样保留。**

9. 同文件，从 `:111-126` 的解构里删掉 `onRowPointerMove` —— 注意它是列表最后一项、**没有尾逗号**，所以要把上一行 `onScroll,` 的逗号一起去掉：
   ```ts
   const {
     containerRef,
     tbodyRef,
     rowHeight,
     visibleRange,
     visibleTracks,
     totalHeight,
     paddingTop,
     onScroll
   } = useSongListVirtualScroll({
   ```

10. 打开 `src/renderer/src/components/song-list/SongList.css`，从 `.track-row`（`:1145`）里删掉 `:1146-1147` 两行：
    ```css
    --track-pointer-x: 50%;
    --track-pointer-y: 50%;
    ```
    该规则的其余声明（`position` / `cursor` / `transition` / `width` / `border-radius` / `margin` / `isolation` / `transform-origin` / `z-index`）全部保留不动。

11. 同文件，删掉 `:1195-1214` 的 `.track-row::after { … }` 整条规则（从 `.track-row::after {` 到它的收尾 `}`）。判据：这条规则里含 `circle 92px at var(--track-pointer-x)`。**不要删 `:1171-1179` 那条 `.track-row::before, .track-row::after` 共享块**，也不要删 `:1181-1193` 的 `.track-row::before` 规则。

12. 同文件，删掉 `:1620-1626` 的 `@keyframes hover-gradient-flow { … }` 整条。

13. 同文件，删掉 `:1628-1638` 的 `@keyframes pointer-border-pulse { … }` 整条。

14. 同文件，从 `.track-playing::after`（`:1281`）里删掉最后两行声明：
    ```css
    background-size: 260% 100%;
    animation: border-gradient-flow 3.4s linear infinite;
    ```
    保留 `opacity: 1;` 与整个 `background: linear-gradient(…)`（四个色标一字不改）。

15. 同文件，删掉 `:1614-1618` 的 `@keyframes border-gradient-flow { … }` 整条（第 14 步之后它已无引用；执行前先 `grep -n "border-gradient-flow" src/renderer/src/components/song-list/SongList.css` 确认只剩 `:1235` 注释里那一处提及和这条定义本身）。

16. 不做其他修改。特别是：不要「顺手」给列表加入场 stagger、不要改虚拟滚动、不要动 `.song-list.is-switching` 那几条规则。

## Boundaries

- **不要动虚拟滚动本身。** `getSongListVirtualRange`（`src/renderer/src/components/song-list/songListVirtualWindow.ts`）、`ROW_HEIGHT = 68`、`visibleRange` / `visibleTracks` / `totalHeight` / `paddingTop` 的计算、`onScroll`、`updateViewportHeight`、`resetScrollAndMeasure`、两个 `watch`，全部保持原样。本方案只删指针追踪。
- **不要给歌单列表加行入场 stagger。** 目前没有 stagger 是**正确的** —— 虚拟滚动每次滚动都会复用 DOM 节点，入场 stagger 会让行在滚动中反复重播动画。AUDIT 第 7 节提到的「30–80ms stagger」不适用于虚拟化长列表。
- **不要动 `SongList.css:1244-1249` 的 `.song-list.is-switching` 规则**：
  ```css
  .song-list.is-switching .track-row,
  .song-list.is-switching .track-row::before,
  .song-list.is-switching .track-row::after {
    transition: none !important;
    animation: none !important;
  }
  ```
  视图切换时全量关闭过渡是**有意设计**（主题/视图切换时避免几十行同时跑过渡）。`:1251-1260` 与 `:1262-1264` 的 `is-switching` 规则同样不要动。
- **不要动 `:1294-1307` 的 `animation-play-state: paused` 门禁**。第 14 步之后它们没有作用对象了，但留着完全无害，删除会牵动 `.track-playing::before` 一侧的判断。清理它们不在本方案范围。
- **不要删任何 `data-te-interactive` 标记。** `src/renderer/src/app/useMotionPreference.test.ts:74-99` 有一条全量 `.vue` 扫描：正则 `/<(?<tag>[a-z][\w-]*)\b(?<attributes>[^>]*\s@click(?:[.=]|\s)[^>]*)>/gs` 匹配所有带 `@click` 的模板元素，非原生交互标签（`button` / `a` / `input` / `select` / `textarea` / `label` 之外）必须带 `data-te-interactive`、`role="button"` 或 `role="switch"`。第 6 步与第 8 步动的两个 `<tr>` **都带 `@click` 且都是 `tr` 标签**，如果连 `data-te-interactive` 一起删掉，这条测试立刻变红。只删 `@pointermove` 那一行。
- **不要动 `.track-row:hover`（`:1227-1233`）、`.track-playing`（`:1266-1270`）、`.track-playing::before`（`:1275-1279` 与 `:1309-1315`）、以及 `:2022-2081` 的选中态规则。** 状态指示的视觉必须完全不变。
- **不要把 `flushPointerMove` 改写成 `createFrameCoalescer`（`src/renderer/src/utils/liquidGlassPointer.ts:136`）的调用。** 正确的修复是删掉，不是优化。同理不要动 `liquidGlassPointer.ts` 本身。
- **不要保留「只在 `.track-selected.track-playing` 行上挂监听」的折中方案。** 上面的层叠分析已经证明那一态显示的是 `:1281` 的 linear-gradient，radial 光晕在那里也画不出来 —— 保留监听没有任何视觉收益。
- 不要改 `src/renderer/src/components/song-list/SongList.css` 里的任何颜色值。第 14 步保留全部四个色标。
- 不要新增依赖，不要改 `package.json`，不要改任何测试文件。
- **若某一步找不到匹配的代码（行号漂移、声明已被改过、`@pointermove` 已不在模板里），停下来报告，不要自行发挥** —— 尤其不要在别的相似规则上凑一个改动交差，也不要「顺便」重构虚拟滚动。

## Verification

- **Mechanical**：
  - `pnpm run typecheck` —— 这是本方案最关键的机械验证。删掉返回类型里的 `onRowPointerMove` 与两个解构点必须严格对齐：漏删任一解构点会报「Property 'onRowPointerMove' does not exist」，漏删返回类型里那一行会报返回对象缺属性。两处 `.vue` 模板里若还留着 `@pointermove="onRowPointerMove"` 而变量已删，`vue-tsc` 会报未定义。
  - `pnpm run lint` —— 应当通过。若 prettier 对第 9 步改动后的解构换行有意见，按它的意见调整。
  - `pnpm run test:local-perf` —— 覆盖 `src/renderer/src/components/SongList.test.ts`、`src/renderer/src/components/song-list/songListVirtualWindow.test.ts`、`src/renderer/src/components/song-list/themeSwitchVirtualizationStress.test.ts`、`src/renderer/src/components/song-list/useSongListContextMenu.test.ts`。这几条是歌单行为与虚拟化门禁，本方案不改行为，不应变红。
  - `pnpm run test:app` —— 覆盖 `src/renderer/src/app/useMotionPreference.test.ts`（含上述 `data-te-interactive` 全量扫描）与 `src/renderer/src/components/song-list/useTrackMultiSelect.test.ts`。
  - `pnpm run test:playlist-lifecycle` —— 覆盖 `src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.behavior.test.ts`，验证第 8、9 步没有破坏聚合歌单页。
  - `pnpm run test:themes` —— 覆盖 `src/renderer/src/components/song-list/themeSwitchVirtualizationStress.test.ts` 与 `src/renderer/src/components/themeColorAudit.test.ts`。themeColorAudit 用的是「实际计数不得超过 allowlist 配额」（`src/renderer/src/components/themeColorAudit.test.ts:103` 的 `count > (allowlist[file] ?? 0)`），本方案只减少裸色值，方向安全。
  - `pnpm run build` —— 产物应当构建成功。
  - **注意：HEAD（9312f3e）上本来就有 3 条测试是红的。** 跑套件前先在未改动的工作树上记一次基线，只对比新增的失败。**新增测试必须登记进 `package.json` 的 `test:*` 脚本，否则不会被执行** —— 但本方案是纯删除，不需要新增测试。
- **Feel check**（真实渲染，不许用简化替身当证据）：先 `npx electron-vite build` 让 `out/` 带上改动，再用隔离 profile 启动 + CDP：
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`。
  - **优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-scroll-top.cjs` 正是为这个场景写的** —— 它 seed 60 个真 WAV，点侧边栏「所有歌曲」项（`[...document.querySelectorAll('.menu-item')].find(i => i.textContent.includes('所有歌曲'))`），并滚动真实的 `.song-list`。
  - 要让「正在播放」的行出现，需要 seed `<profile>/playback-session.json`（`{version:1, savedAt, mode:'trackAndPosition', track, position, queue, queueIndex}`，塞一个真 `duration`）+ settings 里 `playbackResumeMode: 'trackAndPosition'`。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
  - 要确认的观察点：
    - **鼠标横穿列表时，行的外观与改动前完全一致。** 这是本方案最重要的回归检查：hover 应当仍然只有背景 + 1px 内描边（`:1227-1233`），没有任何视觉丢失。分别在普通行、选中行、正在播放行、选中且正在播放的行上各扫一遍。
    - **正在播放的行仍然有彩色渐变描边，但它不再流动。** 盯住那一行看 5 秒以上（动画周期是 3.4s），确认渐变完全静止。颜色应当与改动前的某一帧一致。
    - 用 CDP 读计算样式确认属性已消失，而不是靠截图判断：
      ```js
      (async () => {
        const row = document.querySelector('.track-row')
        const cs = getComputedStyle(row)
        return {
          px: cs.getPropertyValue('--track-pointer-x'),
          py: cs.getPropertyValue('--track-pointer-y'),
          afterAnim: getComputedStyle(document.querySelector('.track-playing'), '::after').animationName
        }
      })()
      ```
      期望：`px` 与 `py` 都是空字符串，`afterAnim` 是 `none`。
    - **性能取证**：DevTools Performance 面板录制「鼠标从列表顶部匀速划到底部」这一个动作，改动前后各录一段 trace 比对 **Recalculate Style** 的次数与总耗时。改后应当明显下降（每行子树的无效重算消失了）。再录一段「列表静置、有一行正在播放」的 5 秒 trace，比对 **Paint** —— 改后应当接近零（`infinite` 的 background-position 动画不再逐帧重绘）。
    - 在 DevTools Animations 面板把播放速度设为 10%，把鼠标停在列表上，确认**动画列表里空无一物**（改前 `.track-playing::after` 会常驻列出 `border-gradient-flow`）。
    - 切到 `html[data-te-motion='reduced']` 与 `'off'`（三档由 `src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts` 驱动），确认行的静态外观正常、状态指示仍然清晰。
    - 在 Rendering 面板打开 `prefers-reduced-motion: reduce`，确认正在播放的行仍然有可见的渐变描边（静态描边不受 reduced-motion 影响，这是对的 —— 状态指示不该在 reduced 下消失）。
    - 快速切换视图（在「所有歌曲」与某个歌单之间来回点几次），确认 `.song-list.is-switching` 的行为没变、没有出现闪烁或残留。
    - 滚动一屏后停下，确认没有行被卡在异常样式上（验证第 10 步删默认值没有留下 `invalid at computed-value time` 之类的副作用 —— 删掉 `.track-row::after` 之后已经没有任何地方引用这两个变量，所以不该有）。
- **Done when**：
  - `grep -rn "track-pointer" src/renderer/` 无命中。
  - `grep -rn "onRowPointerMove" src/renderer/` 无命中。
  - `grep -rn "flushPointerMove\|pointerMoveRafId\|lastPointerEvent" src/renderer/` 无命中。
  - `grep -rn "pointermove" src/renderer/src/components/SongList.vue src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.vue` 无命中。
  - `grep -n "hover-gradient-flow\|pointer-border-pulse" src/renderer/src/components/song-list/SongList.css` 只剩 `:1235` 附近那一处注释（或注释也可一并更新，但不强制）。
  - `grep -n "border-gradient-flow" src/renderer/src/components/song-list/SongList.css` 不再有 `@keyframes` 定义与 `animation:` 引用。
  - `grep -n "data-te-interactive" src/renderer/src/components/SongList.vue src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.vue` 仍然命中（标记没被误删）。
  - `pnpm run typecheck`、`pnpm run lint`、`pnpm run test:local-perf`、`pnpm run test:app`、`pnpm run test:playlist-lifecycle`、`pnpm run test:themes`、`pnpm run build` 全部通过，测试失败数不超过 HEAD 基线的 3 条。
  - 真机 feel check 确认：hover 外观零变化、正在播放的行渐变描边静止、Performance trace 里静置时 Paint 接近零。
