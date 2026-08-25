# 019 — 让右键菜单与音量抽屉从触发点长出来

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: MEDIUM
- **Category**: 物理性与变换原点（AUDIT 第 3 节 Physicality & origin、第 8 节 Missed opportunities）
- **Estimated scope**: 5 个文件（2 个 CSS、2 个 SFC 模板、1 个 composable），约 60 行新增/改动

## Problem

两个非模态气泡的空间来源没有交代清楚：一个完全没有入场动效，一个从中心缩放而不是从触发按钮。两处的触发坐标都是现成的，不需要新增任何测量。

### 第一部分：本地歌单右键菜单没有任何入场动效

样式里一条 `transition` 和一条 `animation` 都没有：

```css
/* src/renderer/src/components/song-list/SongList.css:1544-1556 — 当前 */
/* Context Menu */
.context-menu {
  position: fixed;
  z-index: 1000;
  background: var(--te-glass-bg);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(86, 70, 160, 0.18);
  padding: 6px;
  min-width: 160px;
  border: 1px solid rgba(255, 255, 255, 0.68);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
}
```

挂载点是裸 `v-if`，外面没有 `<Transition>`（这个 `<div>` 从 `:2220` 开到 `:2406`）：

```html
<!-- src/renderer/src/components/SongList.vue:2218-2225 — 当前 -->
<!-- Context Menu -->
<Teleport to="body">
  <div
    v-if="showContextMenu"
    class="context-menu"
    :style="{ top: menuY + 'px', left: menuX + 'px' }"
    @click.stop
  ></div
></Teleport>
```

于是菜单是**瞬时出现、瞬时消失**：右键之后一整块 160px 宽的毛玻璃面板直接闪现在指针旁边，没有任何东西说明它是从哪儿来的。

**触发坐标是现成的。** `src/renderer/src/components/song-list/useSongListContextMenu.ts:97-118` 已经把指针位置写进 `menuX` / `menuY`，并在 `nextTick` 里按视口边界翻转：

```ts
// src/renderer/src/components/song-list/useSongListContextMenu.ts:97-118 — 当前
function onContextMenu(event: MouseEvent, track: Track): void {
  event.preventDefault()
  selectedTrack.value = track
  menuX.value = event.clientX
  menuY.value = event.clientY
  showContextMenu.value = true
  showPlaylistSubmenu.value = false
  showAggregateSubmenu.value = false

  nextTick(() => {
    const menu = document.querySelector('.context-menu') as HTMLElement
    if (menu) {
      const rect = menu.getBoundingClientRect()
      if (rect.right > window.innerWidth) {
        menuX.value -= rect.width
      }
      if (rect.bottom > window.innerHeight) {
        menuY.value -= rect.height
      }
    }
  })
}
```

翻转发生时菜单的哪个角贴着指针就变了：默认是左上角（`left: clientX; top: clientY`），横向翻转后是右上角，纵向翻转后是左下角，两者都翻转就是右下角。**这四种情况本来就已经在代码里算出来了**，只是没人把结果喂给 `transform-origin`。

### 第二部分：流媒体右键菜单同样没有过渡

```css
/* src/renderer/src/components/streaming-page/StreamingContextMenu.vue:242-253 — 当前 */
.streaming-context-menu {
  position: fixed;
  z-index: 4500;
  min-width: 180px;
  padding: 6px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.68);
  background: var(--te-glass-bg, rgba(255, 255, 255, 0.92));
  box-shadow: 0 20px 60px rgba(86, 70, 160, 0.18);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
}
```

它的坐标同样是现成的，翻转逻辑在 `src/renderer/src/components/StreamingPage.vue:1872-1892`（`onStreamingTrackContextMenu`），写法与本地版一致，只是多了 `Math.max(8, …)` 下限。

### 第三部分：音量抽屉从中心缩放，没有锚定到音量按钮

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:233-247 — 当前 */
.volume-drawer-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.volume-drawer-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.volume-drawer-enter-from,
.volume-drawer-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}
```

抽屉本体是紧贴音量按钮**上方**弹出的：

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:103-109 — 当前（节选） */
.volume-drawer {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 10px;
  z-index: 2;
```

`<Transition name="volume-drawer">` 挂在 `.volume-anchor` 里（`src/renderer/src/components/PlayerBar.vue:1866-1867`）：

```html
<!-- src/renderer/src/components/PlayerBar.vue:1866-1867 — 当前 -->
<Transition name="volume-drawer">
  <div v-if="volumeOpen" class="volume-drawer" :class="{ 'drawer-glass': glass }"></div
></Transition>
```

整个 `volume-drawer-*` 规则族里**没有 `transform-origin`**，默认落到 `center`；入场只有 6px 位移加淡入，**没有任何 scale**。抽屉贴着按钮上边缘，视觉上应当从下边缘（按钮那一侧）长出来，现在却是整块面板同时从中心浮现。

**同一个文件里已经有做对的先例**，所以这是漏网而不是有意设计：

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:42-59 — 当前，正确样板 */
/* ===== Upward Drawer Transition ===== */
.drawer-up-enter-active {
  transition:
    opacity var(--te-motion-panel) ease,
    transform var(--te-motion-page) var(--te-ease-soft);
  transform-origin: right bottom;
}
.drawer-up-leave-active {
  transition:
    opacity var(--te-motion-hover) ease,
    transform var(--te-motion-panel) var(--te-ease-enter);
  transform-origin: right bottom;
}
.drawer-up-enter-from,
.drawer-up-leave-to {
  opacity: 0;
  transform: translateY(22px) scaleY(0.94);
}
```

`.playlist-panel` 也写了（`src/renderer/src/components/player-bar/PlayerBar.css:269`：`transform-origin: right bottom;`）。

### AUDIT 依据

AUDIT 第 3 节 Physicality & origin 三条直接命中：

- 「**Popovers/dropdowns/tooltips scale from their trigger**, not center」，给出的形态就是 `.popover { transform-origin: var(--transform-origin); }`
- 「**Never `scale(0)`** — nothing in the real world appears from nothing. Target: `scale(0.9–0.97)` + `opacity: 0`」
- Hunt 项：「**pure-fade entrances with no initial transform**, `transform-origin: center` (or none) on trigger-anchored elements」

第 2 节的时长预算：「Dropdowns, selects → **150–250ms**」。

第 3 节的模态豁免（「**Modals are exempt** — they appear centered; `transform-origin: center` is correct there. Do not report it」）**不适用于这三个目标**：右键菜单和音量抽屉都不是模态，都没有 `role="dialog"`，都锚定在一个具体的触发位置上。

## Target

三个目标各自的最终状态。所有值都写全，不许自己换数。

### 目标一：本地右键菜单

`transform-origin` 按翻转后的实际角落解析，通过 CSS 变量传入；入场 `scale(0.96)` + `opacity: 0`，时长 `180ms`（落在 AUDIT 的 150–250ms dropdown 预算内），曲线用 `var(--te-ease-out-expo)`（`base.css:31` 定义为 `cubic-bezier(0.16, 1, 0.3, 1)`）；离场 `120ms` 快退。

```css
/* target — src/renderer/src/components/song-list/SongList.css */
.context-menu {
  transform-origin: var(--te-context-menu-origin, top left);
}

.context-menu-enter-active {
  transition:
    opacity 180ms var(--te-ease-out-expo),
    transform 180ms var(--te-ease-out-expo);
}

.context-menu-leave-active {
  transition:
    opacity 120ms var(--te-ease-enter),
    transform 120ms var(--te-ease-enter);
}

.context-menu-enter-from,
.context-menu-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
```

```html
<!-- target — src/renderer/src/components/SongList.vue -->
<Teleport to="body">
  <Transition name="context-menu">
    <div
      v-if="showContextMenu"
      class="context-menu"
      :style="{
                    top: menuY + 'px',
                    left: menuX + 'px',
                    '--te-context-menu-origin': menuTransformOrigin
                  }"
      @click.stop
    ></div></Transition
></Teleport>
```

```ts
// target — src/renderer/src/components/song-list/useSongListContextMenu.ts
const menuFlippedX = ref(false)
const menuFlippedY = ref(false)
const menuTransformOrigin = computed(
  () => `${menuFlippedY.value ? 'bottom' : 'top'} ${menuFlippedX.value ? 'right' : 'left'}`
)
```

### 目标二：流媒体右键菜单

与目标一同形状，同数值，变量名换成 `--te-streaming-context-menu-origin`，过渡类名前缀 `streaming-context-menu`。

### 目标三：音量抽屉

`transform-origin: bottom center`（抽屉贴在按钮上方，按钮在它的下边缘），入场加 `scale(0.96)`，时长按 dropdown 预算收进 `180ms` / 离场 `120ms`，曲线换成仓库 token。**`translateX(-50%)` 必须保留在每一条 transform 里**——它是 `.volume-drawer` 的居中定位手段（`PlayerBar.css:106-107` 的 `left: 50%` + `transform: translateX(-50%)`），一旦从过渡状态里丢掉，抽屉会在入场那一瞬间横向跳半个自身宽度。

```css
/* target — src/renderer/src/components/player-bar/PlayerBar.css */
.volume-drawer-enter-active,
.volume-drawer-leave-active {
  transform-origin: bottom center;
}
.volume-drawer-enter-active {
  transition:
    opacity 180ms var(--te-ease-out-expo),
    transform 180ms var(--te-ease-out-expo);
}
.volume-drawer-leave-active {
  transition:
    opacity 120ms var(--te-ease-enter),
    transform 120ms var(--te-ease-enter);
}
.volume-drawer-enter-from,
.volume-drawer-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px) scale(0.96);
}
```

**不新增任何 token。**`--te-ease-out-expo` 与 `--te-ease-enter` 都已在 `base.css:26` / `:31` 定义。

## Repo conventions to follow

- 动效 token 全住在 `src/renderer/src/assets/base.css:26-40`。本方案要用到的两个：`--te-ease-out-expo`（`cubic-bezier(0.16, 1, 0.3, 1)`，入场）、`--te-ease-enter`（`cubic-bezier(0.4, 0, 0.2, 1)`，离场快退）。**两个都已存在，不要新增，也不要改它们的值。**
- **`transform-origin` 的正确样板** —— `src/renderer/src/components/player-bar/PlayerBar.css:43-54`（上面 Problem 段已贴全）。它把 `transform-origin` 写在 `-enter-active` / `-leave-active` 两个类上，本方案的音量抽屉照这个位置写。另一个样板是 `src/renderer/src/components/player-bar/PlayerBar.css:269` 的 `.playlist-panel { transform-origin: right bottom; }`（写在元素本身上）。
- **`<Transition>` 包 `v-if` 的样板** —— `src/renderer/src/components/SongList.vue:2436-2438`：
  ```html
      <Teleport to="body">
        <Transition name="dialog-fade">
          <div
            v-if="showCreatePlaylistDialog"
            class="dialog-overlay"
  ```
  `<Transition>` 放在 `<Teleport>` 里面、`v-if` 元素外面。本方案的两个右键菜单照这个嵌套顺序写。
- **过渡类的命名** —— Vue 的 `<Transition name="x">` 会生成 `.x-enter-from` / `.x-enter-active` / `.x-leave-to` / `.x-leave-active`。仓库里现有的前缀有 `dialog-fade`、`drawer-up`、`volume-drawer`、`hifi-overlay`、`sponsor-dialog`。本方案新增 `context-menu` 与 `streaming-context-menu` 两个前缀。
- `SongList.css` 由 `src/renderer/src/components/SongList.vue:2549` 的 `<style scoped src="./song-list/SongList.css"></style>` 加载，是 scoped 样式。**Vue 的 scoped 属性只加在组件根节点上**，但 `.context-menu` 通过 `<Teleport to="body">` 搬到了 `<body>` 下——`<Teleport>` 的内容仍然由该组件渲染，因此仍然带 `data-v-*` 属性，scoped 选择器照常匹配（现有的 `.context-menu` 规则本来就在这个文件里并且生效，可以直接确认这一点）。
- 三档动效降级由 `base.css:412-441` 统一兜底：`html[data-te-motion='reduced']` 把所有 `transition-duration` 压到 `0.01ms`，`html[data-te-motion='off']` 直接 `transition: none !important`。**本方案不需要写任何 `@media (prefers-reduced-motion)` 或 motion-tier 规则**，全局兜底已经覆盖。

## Steps

一步一个编辑。做完一步再进下一步。

1. **`src/renderer/src/components/song-list/useSongListContextMenu.ts` —— 加两个翻转标记和一个 origin 计算属性。**

   a. 文件顶部第 1-10 行的 import 已经含有 `computed`、`nextTick`、`ref`，**不需要改 import**。确认这三个名字都在（当前是 `computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref`）。

   b. 在 `:68-69` 的

   ```ts
   const menuX = ref(0)
   const menuY = ref(0)
   ```

   之后紧跟着插入两行：

   ```ts
   const menuFlippedX = ref(false)
   const menuFlippedY = ref(false)
   ```

   c. 在 `:95` 的 `const canPlayNextSelectedTrack = computed(() => !!selectedTrack.value && !!playNext)` 之后、`:97` 的 `function onContextMenu` 之前，插入 origin 计算属性（连注释一起）：

   ```ts
   /**
    * The corner that sits under the pointer. `onContextMenu` places the menu's
    * top-left at the click and flips it when it would overflow the viewport, so
    * after the flip the pointer is at the right and/or bottom corner instead.
    * Feeding that back as `transform-origin` makes the menu grow out of the
    * click rather than out of its own centre.
    */
   const menuTransformOrigin = computed(
     () => `${menuFlippedY.value ? 'bottom' : 'top'} ${menuFlippedX.value ? 'right' : 'left'}`
   )
   ```

   d. 改 `onContextMenu`（`:97-118`）：进入时把两个标记复位，翻转时置位。改完的完整函数体应当是：

   ```ts
   function onContextMenu(event: MouseEvent, track: Track): void {
     event.preventDefault()
     selectedTrack.value = track
     menuX.value = event.clientX
     menuY.value = event.clientY
     menuFlippedX.value = false
     menuFlippedY.value = false
     showContextMenu.value = true
     showPlaylistSubmenu.value = false
     showAggregateSubmenu.value = false

     nextTick(() => {
       const menu = document.querySelector('.context-menu') as HTMLElement
       if (menu) {
         const rect = menu.getBoundingClientRect()
         if (rect.right > window.innerWidth) {
           menuX.value -= rect.width
           menuFlippedX.value = true
         }
         if (rect.bottom > window.innerHeight) {
           menuY.value -= rect.height
           menuFlippedY.value = true
         }
       }
     })
   }
   ```

   e. 在返回类型注解里登记新成员。函数签名的返回类型对象在 `:33-66`，其中 `:35-36` 是

   ```ts
   menuX: Ref<number>
   menuY: Ref<number>
   ```

   在 `menuY: Ref<number>` 之后插入一行：

   ```ts
   menuTransformOrigin: ComputedRef<string>
   ```

   `ComputedRef` 已经在 `:8` 的 import 里（`type ComputedRef`），不需要改 import。

   f. 在 `:249-282` 的 `return { … }` 对象里，`menuY,`（`:252`）之后插入一行：

   ```ts
       menuTransformOrigin,
   ```

2. **`src/renderer/src/components/SongList.vue` —— 解构出新成员。** `:807-857` 是 `useSongListContextMenu` 的解构。其中有

   ```ts
     showContextMenu,
     menuX,
     menuY,
     selectedTrack,
   ```

   在 `menuY,` 之后插入一行 `menuTransformOrigin,`。

3. **`src/renderer/src/components/SongList.vue` —— 包 `<Transition>` 并传 origin。** 把 `:2218-2225` 的

   ```html
   <!-- Context Menu -->
   <Teleport to="body">
     <div
       v-if="showContextMenu"
       class="context-menu"
       :style="{ top: menuY + 'px', left: menuX + 'px' }"
       @click.stop
     ></div
   ></Teleport>
   ```

   改成

   ```html
   <!-- Context Menu -->
   <Teleport to="body">
     <Transition name="context-menu">
       <div
         v-if="showContextMenu"
         class="context-menu"
         :style="{
                       top: menuY + 'px',
                       left: menuX + 'px',
                       '--te-context-menu-origin': menuTransformOrigin
                     }"
         @click.stop
       ></div></Transition
   ></Teleport>
   ```

   **然后必须补上闭合标签并整体缩进。**这个 `<div>` 从 `:2220` 开始、在 `:2406` 结束（`:2407` 是 `</Teleport>`）。改完后 `:2406` 附近应当是：

   ```html
                     </div>
                   </Transition>
                 </Teleport>
   ```

   `<div>` 到 `</div>` 之间的全部内容（约 186 行）要整体右移 2 个空格。这是本方案唯一的大段缩进改动，**不要改这段里的任何属性、事件、文案或条件表达式**，只加缩进。改完跑 `pnpm run lint` 确认 prettier 没意见。

4. **`src/renderer/src/components/song-list/SongList.css` —— 加 origin 与过渡类。** 在 `:1545-1556` 的 `.context-menu { … }` 规则里，在最后一行 `-webkit-backdrop-filter: blur(20px) saturate(150%);` 之后、闭合花括号之前，插入一行：

   ```css
   transform-origin: var(--te-context-menu-origin, top left);
   ```

   然后在这条规则的闭合花括号之后、`:1557` 的 `.menu-item {` 之前，插入过渡类（连注释）：

   ```css
   /* The menu grows out of the corner that sits under the pointer. `--te-context-menu-origin`
      is written inline by SongList.vue from useSongListContextMenu's menuTransformOrigin,
      which tracks the viewport flip. */
   .context-menu-enter-active {
     transition:
       opacity 180ms var(--te-ease-out-expo),
       transform 180ms var(--te-ease-out-expo);
   }

   .context-menu-leave-active {
     transition:
       opacity 120ms var(--te-ease-enter),
       transform 120ms var(--te-ease-enter);
   }

   .context-menu-enter-from,
   .context-menu-leave-to {
     opacity: 0;
     transform: scale(0.96);
   }
   ```

5. **`src/renderer/src/components/StreamingPage.vue` —— 加翻转标记。** `:1805` 附近已有

   ```ts
   const showStreamingContextMenu = ref(false)
   const streamingContextMenuX = ref(0)
   const streamingContextMenuY = ref(0)
   ```

   在 `const streamingContextMenuY = ref(0)` 之后插入三段：

   ```ts
   const streamingContextMenuFlippedX = ref(false)
   const streamingContextMenuFlippedY = ref(false)
   const streamingContextMenuOrigin = computed(
     () =>
       `${streamingContextMenuFlippedY.value ? 'bottom' : 'top'} ${
         streamingContextMenuFlippedX.value ? 'right' : 'left'
       }`
   )
   ```

   `computed` 与 `ref` 在这个文件里已经用了几十处，import 不需要改；若 lint 报 `computed` 未导入，把它加进文件顶部的 `vue` import。

6. **`src/renderer/src/components/StreamingPage.vue` —— 在翻转处置位。** 改 `:1872-1892` 的 `onStreamingTrackContextMenu`。改完应当是：

   ```ts
   function onStreamingTrackContextMenu(track: Track, _index: number, event: MouseEvent): void {
     event.preventDefault()
     event.stopPropagation()
     streamingContextMenuTrack.value = track
     streamingContextMenuX.value = event.clientX
     streamingContextMenuY.value = event.clientY
     streamingContextMenuFlippedX.value = false
     streamingContextMenuFlippedY.value = false
     showStreamingPlaylistSubmenu.value = false
     showStreamingAggregateSubmenu.value = false
     showStreamingContextMenu.value = true
     void nextTick(() => {
       const menu = document.querySelector('.streaming-context-menu') as HTMLElement | null
       if (!menu) return
       const rect = menu.getBoundingClientRect()
       if (rect.right > window.innerWidth) {
         streamingContextMenuX.value = Math.max(8, event.clientX - rect.width)
         streamingContextMenuFlippedX.value = true
       }
       if (rect.bottom > window.innerHeight) {
         streamingContextMenuY.value = Math.max(8, event.clientY - rect.height)
         streamingContextMenuFlippedY.value = true
       }
     })
   }
   ```

   **`Math.max(8, …)` 两处原样保留**，不要改成本地版的写法。

7. **`src/renderer/src/components/StreamingPage.vue` —— 把 origin 作为 prop 传下去。** `:3222-3237` 是 `<StreamingContextMenu>` 的调用。在 `:3225` 的 `:y="streamingContextMenuY"` 之后插入一行：

   ```html
   :transform-origin="streamingContextMenuOrigin"
   ```

8. **`src/renderer/src/components/streaming-page/StreamingContextMenu.vue` —— 收下 prop。** 该文件 `<script setup lang="ts">` 里的 `defineProps<{ … }>()` 有

   ```ts
   show: boolean
   x: number
   y: number
   ```

   在 `y: number` 之后插入一行：

   ```ts
   transformOrigin: string
   ```

9. **`src/renderer/src/components/streaming-page/StreamingContextMenu.vue` —— 包 `<Transition>` 并传 origin。** 模板当前是

   ```html
   <template>
     <Teleport to="body">
       <div
         v-if="show"
         class="streaming-context-menu"
         :style="{ top: `${y}px`, left: `${x}px` }"
         @click.stop
       ></div></Teleport
   ></template>
   ```

   改成

   ```html
   <template>
     <Teleport to="body">
       <Transition name="streaming-context-menu">
         <div
           v-if="show"
           class="streaming-context-menu"
           :style="{
             top: `${y}px`,
             left: `${x}px`,
             '--te-streaming-context-menu-origin': transformOrigin
           }"
           @click.stop
         ></div></Transition></Teleport
   ></template>
   ```

   同样要补 `</Transition>` 闭合标签（在这个 `<div>` 的 `</div>` 之后、`</Teleport>` 之前），并把 `<div>` 内的全部内容右移 2 个空格。

10. **`src/renderer/src/components/streaming-page/StreamingContextMenu.vue` —— 加 origin 与过渡类。** 在 `:242-253` 的 `.streaming-context-menu { … }` 规则里，最后一行 `-webkit-backdrop-filter: blur(20px) saturate(150%);` 之后插入：

    ```css
    transform-origin: var(--te-streaming-context-menu-origin, top left);
    ```

    然后在这条规则之后、`:255` 的 `.streaming-context-menu .menu-item {` 之前插入：

    ```css
    .streaming-context-menu-enter-active {
      transition:
        opacity 180ms var(--te-ease-out-expo),
        transform 180ms var(--te-ease-out-expo);
    }

    .streaming-context-menu-leave-active {
      transition:
        opacity 120ms var(--te-ease-enter),
        transform 120ms var(--te-ease-enter);
    }

    .streaming-context-menu-enter-from,
    .streaming-context-menu-leave-to {
      opacity: 0;
      transform: scale(0.96);
    }
    ```

11. **`src/renderer/src/components/player-bar/PlayerBar.css` —— 音量抽屉锚定到按钮那一侧。** 把 `:233-247` 的整段

    ```css
    .volume-drawer-enter-active {
      transition:
        opacity 0.2s ease,
        transform 0.2s ease;
    }
    .volume-drawer-leave-active {
      transition:
        opacity 0.15s ease,
        transform 0.15s ease;
    }
    .volume-drawer-enter-from,
    .volume-drawer-leave-to {
      opacity: 0;
      transform: translateX(-50%) translateY(6px);
    }
    ```

    替换为

    ```css
    /* The drawer sits directly above the volume button (`bottom: 100%` on
       .volume-drawer), so it grows out of its own bottom edge — the side the
       trigger is on. `translateX(-50%)` is .volume-drawer's centring transform and
       has to be repeated in every transition state or the panel jumps sideways by
       half its width on the first frame. */
    .volume-drawer-enter-active,
    .volume-drawer-leave-active {
      transform-origin: bottom center;
    }
    .volume-drawer-enter-active {
      transition:
        opacity 180ms var(--te-ease-out-expo),
        transform 180ms var(--te-ease-out-expo);
    }
    .volume-drawer-leave-active {
      transition:
        opacity 120ms var(--te-ease-enter),
        transform 120ms var(--te-ease-enter);
    }
    .volume-drawer-enter-from,
    .volume-drawer-leave-to {
      opacity: 0;
      transform: translateX(-50%) translateY(6px) scale(0.96);
    }
    ```

    **不要动 `:103-121` 的 `.volume-drawer` 本体规则**，它的 `transform: translateX(-50%)` 是静止态定位，保持原样。

## Boundaries

- **居中模态对话框的 `transform-origin: center` 是 AUDIT 第 3 节明文豁免的正确做法，一个都不要改。** 涉及：`src/renderer/src/components/ImportDialog.vue`、`src/renderer/src/components/streaming-page/NcmPlaylistDialogs.vue`、`src/renderer/src/components/player-bar/QueueAddToPlaylistDialog.vue`、`src/renderer/src/components/streaming-page/ProviderDownloadsPanel.vue`，以及 `src/renderer/src/components/song-list/SongList.css` 里的 `.create-playlist-dialog`（`:1869`）与 `.excluded-tracks-dialog`（`:2200`）及其 `.dialog-fade-*` 过渡族（`:1961-1980`、`:2316-2327`）。它们都是 flex 居中的覆盖层对话框，出现位置与任何触发器无关。
- **不要动 `src/renderer/src/components/player-bar/PlayerBar.css:1956-2027` 的 `.hifi-overlay` 与 `.hifi-overlay-*` 过渡族。** 它是贴右边缘的全高抽屉（`:1957-1962` 的 `position: fixed; top: 32px; right: 0; bottom: 0; width: min(440px, 100vw)`），从自己所在的那条边滑入（`:2025-2028` 的 `transform: translateX(28px)`）。空间来源已由位移交代清楚，不属于「应从触发按钮缩放出来」的气泡类。
- **不要动 `src/renderer/src/components/player-bar/PlayerBar.css:42-69` 的 `.drawer-up-*` 与 `:269` 的 `.playlist-panel`。** 它们已经写了 `transform-origin: right bottom`，是本方案要照抄的样板，不是要修的目标。
- **不要动 `src/renderer/src/components/song-list/SongList.css:1599-1612` 的 `.submenu`。** 二级子菜单从父项右侧展开是另一个问题，本方案不涉及。
- **不要动 `src/renderer/src/components/song-list/SongList.css:1557-1572` 的 `.menu-item`**（它的 `transition: background 0.15s, color 0.15s, transform 0.15s;` 是裸时长，归 **020 号方案**的预算统计，不在本方案范围），也**不要动 `:1150-1160` 的 `.track-row`**（它的 `transform-origin: center` 是行内缩放的正确原点）。
- **不要动 `src/renderer/src/components/song-list/SongList.css:70-77` 的 `.grid-view` / `.table-view` 的 `transform-origin: top center`。** 那是视图切换的原点，与气泡无关。
- **不要改任何 `transition: all`。** 那些归 **005 号方案**。
- **不要改 `src/renderer/src/assets/base.css` 的任何 token 值，也不要新增 token。** 本方案用到的两条曲线（`--te-ease-out-expo`、`--te-ease-enter`）都已存在。
- **不要新增 `@media (prefers-reduced-motion)` 或 `html[data-te-motion=…]` 规则。** `base.css:412-441` 的全局兜底已经覆盖这两档。
- 不要新增依赖，不要改 `package.json`。
- 除第 3、9、11 步明确要求的结构改动（包 `<Transition>`、加 prop、改过渡类）外，不要改任何模板结构、事件绑定或业务逻辑。菜单项的条件表达式、`data-te-interactive` 属性、`@click` 处理器一个都不要碰。
- **若某一步的当前代码与本方案引用的内容不符（行号漂移、已被改过、选择器/函数签名不同），停下来报告，不要自行发挥。** 尤其第 3 步与第 9 步涉及大段缩进：如果 `<div>` 的起止行与方案写的不一致，先确认清楚再动，不要凭猜测插入闭合标签。

## Verification

- **Mechanical**：
  - `pnpm run typecheck` —— 第 1e 步给 `useSongListContextMenu` 的返回类型加了 `menuTransformOrigin: ComputedRef<string>`，第 8 步给 `StreamingContextMenu` 加了 `transformOrigin: string` prop。若漏了任何一处，`vue-tsc` 会报错。**必须通过。**
  - `pnpm run lint` —— prettier 会检查第 3、9 步的缩进和多行 `:style` 对象的排版。若报格式差异，按它的意见调整。
  - `pnpm run test:local-perf` —— 包含 `src/renderer/src/components/song-list/useSongListContextMenu.test.ts`（207 行，30 条断言）和 `src/renderer/src/components/SongList.test.ts`。那个 composable 测试只断言行为（`canRematchSelectedTrack`、`handlePlayNext`、`showContextMenu` 的开关等），**不断言 `menuX` / `menuY` / origin**，所以新增的 ref 与 computed 不应让它变红。
  - `pnpm run test:playback-routing` —— 包含 `src/renderer/src/components/SideMenu.test.ts` 与播放栏结构测试。第 11 步只改 `volume-drawer-*` 过渡类，`SideMenu.test.ts:23` 断言的是 `transition: left 0.32s var(--te-ease-soft);`（`PlayerBar.css:10`），不受影响。
  - `pnpm run test:themes` —— 包含 `src/renderer/src/components/scopedGlobalSelectors.test.ts`（它把 `./streaming-page/StreamingContextMenu.vue` 列在 `scopedStyleFiles` 里，断言不出现 `:global(祖先) 后代` 形态）。本方案不引入 `:global(...)`，应当保持基线。
  - `pnpm run build` —— 应当构建成功。
  - **注意：HEAD（8e34e01）上本来就有 3 条测试是红的。** 跑任何套件前先在未改动的工作树上记一次基线，只对比新增的失败。
- **Feel check**（真实渲染，不用简化替身）：先 `npx electron-vite build` 让 `out/` 带上改动，再用隔离 profile 启动 + CDP。
  - **首选做法：复制改造 `output/verify-scroll-top.cjs`**（gitignored 的既有 harness，363 行）。它已经做好：seed 60 个真 WAV、把 `music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`、写 `playback-session.json` 让播放栏挂载、点「所有歌曲」侧边栏项、滚动真实 `.song-list`。**不要从零写夹具。**
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - 预写 `plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`，否则 provider RPC 要 30s 超时才放行启动。
  - 侧边栏项的选择器：`[...document.querySelectorAll('.menu-item')].find(i => i.textContent.includes('所有歌曲'))`。
  - 用 CDP `Input.dispatchMouseEvent` 派发 `button: 'right'` 的 `mousePressed` / `mouseReleased` 到某一行歌曲上触发右键菜单（`verify-settings-align.cjs` 里有 `Input.dispatchKeyEvent` 的用法可以照着改）。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - 窗口 `deviceScaleFactor` 是 1.5，截图 clip 是 CSS px 但 PNG 带缩放，用 `png.width / clipWidth` 反推。
  - `settings.theme` 只接受 `'dark' | 'pureWhite' | 'system'`（**没有 `'light'`**）。两个 tone 各跑一次，断言 `document.documentElement.dataset.theme`。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
  - **读计算样式比截图更有力**，本方案要读这几项：
    - 菜单出现后 `getComputedStyle(document.querySelector('.context-menu')).transformOrigin` —— 在视口中部右键时应当解析成靠左上的像素对（约 `"0px 0px"`）；在**视口右下角**右键（触发两次翻转）时应当变成靠右下的像素对（约 `"<菜单宽度>px <菜单高度>px"`）。这一对读数就是本方案的核心证据。
    - 音量抽屉打开后 `getComputedStyle(document.querySelector('.volume-drawer')).transformOrigin` —— 改前是中心（约 `"<宽/2>px <高/2>px"`），改后过渡进行中应当是底边中点（约 `"<宽/2>px <高>px"`）。注意 `transform-origin` 写在 `-enter-active` 类上，**要在过渡进行中的那一帧读**，或者临时把它也写到 `.volume-drawer` 本体上验证后再撤回。
  - 要确认的观察点：
    - 在「所有歌曲」列表中部某一行右键：菜单从**指针落点那个角**长出来，不是从中心浮现。
    - 在贴近窗口**右下角**的一行右键：菜单翻转到指针左上方，并且是从**右下角**长出来（原点跟着翻转走）。这是最容易做错的一种情况——如果原点没跟着翻，菜单会从远离指针的那个角长出来，看着像从别处飞过来。
    - 点播放栏音量按钮：抽屉从**按钮那一侧（下边缘）**长出来，不是整块从中心浮现；关掉时也从下边缘收回去。
    - 抽屉入场那一帧**没有横向跳动**（这是 `translateX(-50%)` 保留正确的验证点）。
    - 流媒体页某一行右键：与本地版同样的从指针落点长出。
  - 在 DevTools Animations 面板把播放速度设为 **10%** 慢放核对上面三条原点观察点。这是唯一能肉眼分辨「从角落长出」与「从中心缩放」的手段。
  - 在 DevTools Rendering 面板切 `prefers-reduced-motion: reduce`，确认菜单与抽屉的位移/缩放基本消失但淡入还在（`base.css:425-433` 把时长压到 `0.01ms`），并且**菜单仍然出现在正确位置、内容可点**。
- **Done when**：
  - `grep -n "transform-origin" src/renderer/src/components/song-list/SongList.css` 命中 `.context-menu` 那一条（除已有的 `:75` 与 `:1159` 外多出一条）。
  - `grep -n "transform-origin" src/renderer/src/components/player-bar/PlayerBar.css` 的命中里出现 `bottom center`。
  - `grep -n "context-menu-enter-from" src/renderer/src/components/song-list/SongList.css` 与 `grep -n "streaming-context-menu-enter-from" src/renderer/src/components/streaming-page/StreamingContextMenu.vue` 各有 1 处命中。
  - `grep -n "menuTransformOrigin" src/renderer/src/components/song-list/useSongListContextMenu.ts src/renderer/src/components/SongList.vue` 在两个文件里都有命中。
  - `grep -n "translateX(-50%)" src/renderer/src/components/player-bar/PlayerBar.css` 仍然在 `.volume-drawer-enter-from` / `-leave-to` 那条里出现（没有被丢掉）。
  - CDP 读到的两组 `transformOrigin`（视口中部右键 vs 右下角右键）**互不相同**，且分别对应左上与右下。
  - `pnpm run typecheck`、`pnpm run lint`、`pnpm run build` 通过，测试失败数不超过 HEAD 基线的 3 条。
