# 008 — 侧边栏让位改用 transform 位移，去掉 320ms 全树重排

- **Status**: DONE
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 性能（Performance，AUDIT 第 5 节）
- **Estimated scope**: 5 个文件（`src/renderer/src/App.vue`、`src/renderer/src/components/player-bar/PlayerBar.css`、`src/renderer/src/components/PlayerBar.vue`、`src/renderer/src/assets/theme-layouts/aurora-reference.css`、`src/renderer/src/components/SideMenu.test.ts`），中等改动量，含少量 JS

## Problem

侧边栏开合把**布局属性当成动画属性**，让整个应用内容根做 320ms 的逐帧重排。

### 问题点 1：`.main-content` 过渡 `padding-left`

`src/renderer/src/App.vue:1078-1091` —— 当前代码：

```css
/* src/renderer/src/App.vue:1078-1091 — current */
.main-content {
  display: grid;
  box-sizing: border-box;
  margin-left: 0;
  width: 100%;
  min-height: 100vh;
  padding-left: 0;
  transform: translateZ(0);
  will-change: padding-left;
  transition: padding-left 0.32s var(--te-ease-soft);
  overflow: hidden;
  position: relative;
  z-index: 1;
}
```

配对的打开态在 `src/renderer/src/App.vue:1112-1114`：

```css
/* src/renderer/src/App.vue:1112-1114 — current */
.main-content.menu-open {
  padding-left: var(--te-menu-width);
}
```

`.main-content` 是**全应用内容根**（`src/renderer/src/App.vue:784-875`，它是 `.app-shell-content` 里唯一的容器，`LocalDashboard` / `SongList` / `StreamingPage` / `PlayingMusic` / `SettingsPage` 以外的全部页面都挂在它下面，且 `src/renderer/src/App.vue:1093-1095` 用 `.main-content > * { grid-area: 1 / 1; }` 把它们全部堆在同一个 grid 单元里）。过渡 `padding-left` 意味着 320ms 内**每一帧**都要对整棵内容子树重新布局 —— 这棵树里挂着虚拟滚动歌曲列表、虚拟化卡片网格、以及大量带 `backdrop-filter` 的玻璃表面，每帧 layout 之后还要重绘全部 blur 层。320ms 在 60fps 下约 19 帧，即约 19 次全树 layout + 19 次全量 blur 重绘。

### 问题点 2：`.player-bar-shell` 过渡 `left`

`src/renderer/src/components/player-bar/PlayerBar.css:1-11` —— 当前代码：

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:1-11 — current */
/* ===== Shell ===== */
.player-bar-shell {
  position: fixed;
  bottom: 14px;
  left: 18px;
  right: 18px;
  z-index: 1002;
  pointer-events: none;
  will-change: left;
  transition: left 0.32s var(--te-ease-soft);
}
```

配对的打开态在 `src/renderer/src/components/player-bar/PlayerBar.css:19-29`：

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:19-29 — current */
.player-bar-shell.menu-open {
  left: calc(var(--te-menu-width) + 18px);
  right: 18px;
  z-index: 999;
}

.player-bar-shell.menu-open .player-bar {
  width: 100%;
  max-width: none;
  margin: 0;
}
```

`.player-bar-shell` 同时钉住 `left` 和 `right`，所以过渡 `left` 等于**过渡它的宽度**：播放栏内部的所有控件（进度条、曲目信息、按钮组、可视化）每帧跟着重排一次。

### 问题点 3：两处 `will-change` 都是无效声明

`padding-left` 与 `left` **都不是可合成属性**（compositable property）。`will-change: padding-left` 与 `will-change: left` 无法让浏览器预建合成层，只留下 `will-change` 自身的记账开销。这两行是纯粹的浪费。

### 已有的缓解只覆盖播放栏一侧

`src/renderer/src/components/PlayerBar.vue:1428-1440` —— 当前代码：

```ts
// src/renderer/src/components/PlayerBar.vue:1428-1440 — current
const geometryAnimating = ref(false)
let geometryAnimTimer: number | null = null
watch(
  () => props.menuOpen,
  () => {
    geometryAnimating.value = true
    if (geometryAnimTimer !== null) window.clearTimeout(geometryAnimTimer)
    geometryAnimTimer = window.setTimeout(() => {
      geometryAnimating.value = false
      geometryAnimTimer = null
    }, 340)
  }
)
```

它在 340ms 窗口内给 shell 加上 `is-geometry-animating`，`src/renderer/src/components/player-bar/PlayerBar.css:13-17` 借此把播放栏的 blur 临时置 `none`：

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:13-17 — current */
.player-bar-shell.is-geometry-animating .player-bar,
.player-bar-shell.is-geometry-animating .player-bar-liquid .player-bar-warp {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
```

`.main-content` **没有任何对应缓解** —— 滑动全程 blur 与 layout 叠加。

### 背景（执行者需要知道，否则会判断错状态）

播放条那族 `menu-open` 规则曾经是死的（没有接上 prop）；接上之后 6 套预设布局的 `menu-open` 规则一起激活，侧边栏让位现在是靠**横向让开**达成的。

**判断侧边栏开合状态请看 `.side-menu.open`，不要看 `.player-bar-shell.menu-open`。** 后者由 `sidebarMenuOpen`（`src/renderer/src/App.vue:418-422`）驱动，在流媒体页会切换到 `streamingMenuOpen`，与本地侧边栏不是同一个布尔值。

### 侧边栏自己已经是正确范式

`src/renderer/src/components/SideMenu.vue:186-218` 已经用 transform 做位移，只有内容根和播放栏没有跟上：

```css
/* src/renderer/src/components/SideMenu.vue:207-218 — current, already correct */
  transform: translate3d(-100%, 0, 0);
  transform-origin: left center;
  will-change: transform;
  transition:
    transform 0.32s var(--te-ease-soft),
    box-shadow 0.32s;
  font-family: var(--te-font-sans);
}

.side-menu.open {
  transform: translate3d(0, 0, 0);
}
```

## Target

**核心取舍（执行者必须先理解这一点，否则会做出错误结构）**：内容需要「重排到可用宽度」和「只用 transform 动画」是**互斥**的 —— 重排本身就是 layout。所以目标不是消灭那一次 layout，而是把 **19 次 layout 压成 1 次**：

1. 类切换的那一刻，**瞬时**应用最终布局（`padding-left` / `left` 立即到位，不过渡）→ 1 次 layout。
2. 同一帧用一个**合成器位移**把内容推回视觉起点。
3. 下一帧撤掉这个位移，让 `transform` 走 320ms 过渡 → 全程 0 次 layout，纯合成器动画。

这是标准 FLIP（First-Last-Invert-Play）。已知副作用，写在这里以免执行者以为是 bug：**打开侧边栏的 320ms 内，内容右边缘会有一条宽度等于让位距离的空隙，随动画收拢到 0**。因为 `.main-content` 本来就浮在 `body` 的背景之上（`src/renderer/src/assets/base.css:681-705` 给 `body` 铺了 `background-image`），这条空隙读起来就是应用背景，不是白闪。关闭侧边栏方向没有空隙，只有被 `overflow: hidden` 裁掉的一小段。

### 新增 token：让位距离 `--te-menu-shift`

FLIP 的位移量必须**等于**该布局下 `padding-left` / `left` 的实际变化量。基础布局是 `var(--te-menu-width)`，但 `aurora-reference` 预设把菜单做成浮岛，让位距离比 `--te-menu-width` 多一段空气间隙 —— 所以让位距离要单独成 token，供预设覆盖。

`src/renderer/src/assets/base.css` 目标（加在 `--te-menu-width` 那一行之后）：

```css
/* target — src/renderer/src/assets/base.css，紧跟 --te-menu-width */
--te-menu-width: clamp(132px, 18vw, 216px);
/* 侧边栏让位的实际位移量。FLIP 用它把内容推回视觉起点，必须与该布局下
     padding-left / left 的变化量完全相等，否则动画起点会跳。预设布局如果改了
     让位距离（浮岛式菜单的空气间隙），必须同步覆盖这个 token。 */
--te-menu-shift: var(--te-menu-width);
```

### `.main-content` 目标

```css
/* target — src/renderer/src/App.vue:1078-1091 */
.main-content {
  display: grid;
  box-sizing: border-box;
  margin-left: 0;
  width: 100%;
  min-height: 100vh;
  padding-left: 0;
  transform: translateZ(0);
  will-change: transform;
  transition: transform 0.32s var(--te-ease-soft);
  overflow: hidden;
  position: relative;
  z-index: 1;
}
```

```css
/* target — src/renderer/src/App.vue:1112-1114，padding-left 不再过渡，瞬时到位 */
.main-content.menu-open {
  padding-left: var(--te-menu-width);
}

/* FLIP 的第一帧：最终布局已经生效，用位移把内容拉回视觉起点。
   下一帧移除本类，transform 从这个偏移过渡回 translateZ(0)。 */
.main-content.is-menu-shifting {
  transition: none;
}

.main-content.is-menu-shifting.menu-open {
  transform: translate3d(calc(-1 * var(--te-menu-shift)), 0, 0);
}

.main-content.is-menu-shifting:not(.menu-open) {
  transform: translate3d(var(--te-menu-shift), 0, 0);
}
```

### `.player-bar-shell` 目标

```css
/* target — src/renderer/src/components/player-bar/PlayerBar.css:1-11 */
/* ===== Shell ===== */
.player-bar-shell {
  position: fixed;
  bottom: 14px;
  left: 18px;
  right: 18px;
  z-index: 1002;
  pointer-events: none;
  will-change: transform;
  transition: transform 0.32s var(--te-ease-soft);
}
```

```css
/* target — 新增，紧跟 .player-bar-shell.is-geometry-animating 那一族之后 */
.player-bar-shell.is-menu-shifting {
  transition: none;
}

.player-bar-shell.is-menu-shifting.menu-open {
  transform: translate3d(calc(-1 * var(--te-menu-shift)), 0, 0);
}

.player-bar-shell.is-menu-shifting:not(.menu-open) {
  transform: translate3d(var(--te-menu-shift), 0, 0);
}
```

`.player-bar-shell.menu-open` 的 `left` / `right` / `z-index` 三行**保持原样不动**，它们现在是瞬时生效的布局，不再是动画。

### `aurora-reference` 预设的让位距离覆盖

该预设的让位距离是 `calc(var(--te-menu-width) + clamp(26px, 3vw, 48px))`（`src/renderer/src/assets/theme-layouts/aurora-reference.css:35-37`），窄窗媒体查询里是 `calc(var(--te-menu-width) + 18px)`（`:604-606`）。必须同步覆盖 `--te-menu-shift`，否则该预设下 FLIP 起点会差最多 48px，动画开头会有一次可见跳变。

### 三档动效模式

无需额外处理。`src/renderer/src/assets/base.css:425-441` 已有全局兜底：`html[data-te-motion='reduced'] *` 把 `transition-duration` 压到 `0.01ms !important`，`html[data-te-motion='off'] *` 直接 `transition: none !important`。改成 `transform` 过渡后这两条继续生效，让位变成瞬时。**不要**为此新增 media query 或 `data-te-motion` 分支。

## Repo conventions to follow

- 动效 token 全住在 `src/renderer/src/assets/base.css:26-42`：`--te-ease-enter/soft/spring/out-quint/out-expo`、`--te-motion-press/hover/panel/page/settle/return`、`--te-motion-press-scale/hover-translate`、`--te-menu-width`。新 token `--te-menu-shift` 必须加在这里，**不许**在组件里另起一套。
- 三档动效模式由 `html[data-te-motion='full'|'reduced'|'off']` 驱动（`src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts`）。
- **transform 驱动几何的正面样板**：`src/renderer/src/components/player-bar/PlayerBar.css:1367-1375`

  ```css
  /* src/renderer/src/components/player-bar/PlayerBar.css:1367-1375 — 仓库标准范式 */
  .progress-fill {
    height: 100%;
    width: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--accent-color, #2563eb), #0d9488);
    transform: scaleX(0);
    transform-origin: 0 50%;
    will-change: transform;
    transition: none;
  }
  ```

- **「瞬时改布局 + 定时类」的样板**：`src/renderer/src/components/PlayerBar.vue:1428-1440` 的 `geometryAnimating` watcher（见上文 verbatim）。本方案的 `is-menu-shifting` 走同一个 watcher。
- 侧边栏自身的 transform 位移样板：`src/renderer/src/components/SideMenu.vue:207-218`。
- `will-change` 只写可合成属性（`transform` / `opacity`），`SideMenu.vue:209` 就是这么写的。

## Steps

按 Phase A → B → C 顺序执行。每个 Phase 结束都跑一次 Verification 的 Mechanical 部分。

### Phase A —— 删掉两处无效 `will-change` 并新增 token（最安全，先做）

1. 打开 `src/renderer/src/assets/base.css`，找到第 42 行 `  --te-menu-width: clamp(132px, 18vw, 216px);`。在它**下面**插入：

   ```css
   /* 侧边栏让位的实际位移量。FLIP 用它把内容推回视觉起点，必须与该布局下
      padding-left / left 的变化量完全相等，否则动画起点会跳。预设布局如果改了
      让位距离（浮岛式菜单的空气间隙），必须同步覆盖这个 token。 */
   --te-menu-shift: var(--te-menu-width);
   ```

   注意缩进与相邻行一致（两个空格）。

2. 打开 `src/renderer/src/App.vue`，在 `.main-content` 规则（第 1078 行起）里，把
   `  will-change: padding-left;`
   改成
   `  will-change: transform;`

3. 同一规则里，把
   `  transition: padding-left 0.32s var(--te-ease-soft);`
   改成
   `  transition: transform 0.32s var(--te-ease-soft);`

4. 打开 `src/renderer/src/components/player-bar/PlayerBar.css`，在 `.player-bar-shell` 规则（第 2 行起）里，把
   `  will-change: left;`
   改成
   `  will-change: transform;`

5. 同一规则里，把
   `  transition: left 0.32s var(--te-ease-soft);`
   改成
   `  transition: transform 0.32s var(--te-ease-soft);`

6. 打开 `src/renderer/src/components/SideMenu.test.ts`。把第 12 行

   ```js
   assert.match(app, /transition: padding-left 0\.32s var\(--te-ease-soft\);/)
   ```

   替换成下面三行（断言 transform 语义 + 明确禁止布局属性回归）：

   ```js
   assert.match(app, /transition: transform 0\.32s var\(--te-ease-soft\);/)
   assert.doesNotMatch(app, /transition: padding-left/)
   assert.doesNotMatch(app, /will-change: padding-left/)
   ```

7. 同一文件，把第 23 行

   ```js
   assert.match(playerBarCss, /transition: left 0\.32s var\(--te-ease-soft\);/)
   ```

   替换成：

   ```js
   assert.match(playerBarCss, /transition: transform 0\.32s var\(--te-ease-soft\);/)
   assert.doesNotMatch(playerBarCss, /transition: left 0\.32s/)
   assert.doesNotMatch(playerBarCss, /will-change: left;/)
   ```

   **此时 Phase A 已经完成，但让位是瞬时的（没有动画）** —— 这是预期中间状态，Phase B/C 把动画加回来。

### Phase B —— 给 `.main-content` 装上 FLIP

8. 打开 `src/renderer/src/App.vue`，找到第 1112-1114 行的 `.main-content.menu-open` 规则。在它**下面**插入三条新规则：

   ```css
   /* FLIP 的第一帧：最终布局（padding-left）已经瞬时生效，用一个合成器位移把内容
      拉回视觉起点。下一帧 JS 移除 is-menu-shifting，transform 从这个偏移过渡回
      translateZ(0) —— 320ms 内 0 次 layout。 */
   .main-content.is-menu-shifting {
     transition: none;
   }

   .main-content.is-menu-shifting.menu-open {
     transform: translate3d(calc(-1 * var(--te-menu-shift)), 0, 0);
   }

   .main-content.is-menu-shifting:not(.menu-open) {
     transform: translate3d(var(--te-menu-shift), 0, 0);
   }
   ```

9. 同一文件，在 `<script setup>` 里加驱动逻辑。先确认顶部的 vue import 已经包含 `ref`、`watch`、`nextTick`（`nextTick` 在第 632 行已被使用，所以一定已导入；如果 `ref` / `watch` 缺失就补进同一条 import）。

   在 `const sidebarMenuOpen = computed(...)`（第 418 行起）那一段**之后**插入：

   ```ts
   /**
    * 侧边栏让位的 FLIP。`padding-left` / `left` 瞬时到位（1 次 layout），同一帧用
    * translate 把内容推回视觉起点，下一帧撤掉位移让 transform 走 320ms 过渡 ——
    * 全程 0 次 layout。参照 PlayerBar.vue 的 geometryAnimating 定时类模式。
    */
   const menuShifting = ref(false)
   let menuShiftFrame: number | null = null
   watch(
     () => menuOpen.value && showLocalSidebar.value,
     () => {
       if (menuShiftFrame !== null) cancelAnimationFrame(menuShiftFrame)
       menuShifting.value = true
       // 两帧：第一帧让带 is-menu-shifting 的偏移样式生效并被浏览器采纳为过渡起点，
       // 第二帧撤类触发过渡。只等一帧的话偏移会与撤类合并进同一次样式计算，动画不播。
       menuShiftFrame = requestAnimationFrame(() => {
         menuShiftFrame = requestAnimationFrame(() => {
           menuShiftFrame = null
           menuShifting.value = false
         })
       })
     }
   )
   ```

10. 同一文件，在 `onBeforeUnmount` 的回调里（第 704-705 行附近，`stopSideMenuMonitor()` / `disposeSideMenuClearance()` 旁边）加一行清理：

    ```ts
    if (menuShiftFrame !== null) cancelAnimationFrame(menuShiftFrame)
    ```

11. 同一文件，把 `.main-content` 的 class 绑定（第 785-793 行）里加上新类。当前是：

    ```
    class="main-content"
    :class="{
      'menu-open': menuOpen && showLocalSidebar,
      'playing-open': showPlayingPage,
      'plugin-open': showPluginPage,
      'dsp-rack-open': showDspRackPage,
      'radio-podcast-open': showRadioPodcastPage
    }"
    ```

    改成在 `'menu-open'` 那一行**之后**插入一行 `'is-menu-shifting': menuShifting,`，其余保持不变。

### Phase C —— 给 `.player-bar-shell` 装上 FLIP 与预设覆盖

12. 打开 `src/renderer/src/components/PlayerBar.vue`，找到第 1428-1440 行的 `geometryAnimating` watcher。在这段**之后**插入并列的 shifting 逻辑：

    ```ts
    // 让位的 FLIP：left/right 瞬时到位，靠 transform 播动画。geometryAnimating 负责
    // 期间抑制 blur，两者互不替代。
    const menuShifting = ref(false)
    let menuShiftFrame: number | null = null
    watch(
      () => props.menuOpen,
      () => {
        if (menuShiftFrame !== null) cancelAnimationFrame(menuShiftFrame)
        menuShifting.value = true
        menuShiftFrame = requestAnimationFrame(() => {
          menuShiftFrame = requestAnimationFrame(() => {
            menuShiftFrame = null
            menuShifting.value = false
          })
        })
      }
    )
    ```

13. 同一文件，在 `onBeforeUnmount`（第 1447 行起）里加一行清理：

    ```ts
    if (menuShiftFrame !== null) cancelAnimationFrame(menuShiftFrame)
    ```

14. 同一文件，找到 `.player-bar-shell` 根元素的 class 绑定。它现在已经在绑 `is-geometry-animating`（由 `geometryAnimating` 驱动）和 `menu-open`。在同一个 class 对象里加上 `'is-menu-shifting': menuShifting`。**如果找不到这个绑定对象，或它的写法与预期不符，停下报告，不要改 template 结构。**

15. 打开 `src/renderer/src/components/player-bar/PlayerBar.css`，在 `.player-bar-shell.is-geometry-animating` 那一族（第 13-17 行）**之后**、`.player-bar-shell.menu-open`（第 19 行）**之前**，插入：

    ```css
    /* FLIP：left/right 已瞬时到位，用位移把 shell 推回视觉起点，下一帧撤类走过渡。 */
    .player-bar-shell.is-menu-shifting {
      transition: none;
    }

    .player-bar-shell.is-menu-shifting.menu-open {
      transform: translate3d(calc(-1 * var(--te-menu-shift)), 0, 0);
    }

    .player-bar-shell.is-menu-shifting:not(.menu-open) {
      transform: translate3d(var(--te-menu-shift), 0, 0);
    }
    ```

16. 打开 `src/renderer/src/assets/theme-layouts/aurora-reference.css`，找到第 35-37 行：

    ```css
    html[data-te-preset-layout='aurora-reference'] body .main-content.menu-open {
      padding-left: calc(var(--te-menu-width) + clamp(26px, 3vw, 48px));
    }
    ```

    在这条规则**之前**插入让位距离的覆盖（写在 `html` 上，让 `.main-content` 和 `.player-bar-shell` 都读到同一个值）：

    ```css
    /* 浮岛菜单的让位距离比菜单宽度多一段空气间隙，FLIP 的位移量必须跟上。 */
    html[data-te-preset-layout='aurora-reference'] {
      --te-menu-shift: calc(var(--te-menu-width) + clamp(26px, 3vw, 48px));
    }
    ```

17. 同一文件，找到第 604-606 行窄窗媒体查询里的：

    ```css
    html[data-te-preset-layout='aurora-reference'] body .main-content.menu-open {
      padding-left: calc(var(--te-menu-width) + 18px);
    }
    ```

    在这条规则**之前**（仍在同一个 `@media` 块内）插入：

    ```css
    html[data-te-preset-layout='aurora-reference'] {
      --te-menu-shift: calc(var(--te-menu-width) + 18px);
    }
    ```

18. 处理自定义外壳布局。`src/renderer/src/App.vue:1038-1043` 把 `.main-content` 的 `padding-left` 强制成 `0`，`:1045-1052` 把 `.player-bar-shell` 变成 `position: relative !important; inset: auto !important`。这两种情况下让位距离是 0，FLIP 不该产生位移。在 `src/renderer/src/App.vue` 第 1038 行那条规则**之前**插入：

    ```css
    /* 自定义外壳把让位交给 grid 模板，padding-left / inset 都被强制归零，
       FLIP 的位移量必须同步归零，否则内容会凭空平移一次。 */
    html[data-te-shell-layout='custom'] {
      --te-menu-shift: 0px;
    }
    ```

## Boundaries

- **不要**动 `src/renderer/src/components/SideMenu.vue` 的任何动效声明 —— 它第 207-218 行已经是正确的 transform 范式，是本方案要对齐的样板，不是要改的对象。
- **不要**动 `src/renderer/src/App.vue:1146-1176` 的页面切换过渡（`page-down-*` / `page-up-*` 那一族），也不要动 `:1160-1161` / `:1171-1172` 附近的裸曲线 —— 那些归 **004 号方案**。本方案在同一个文件里只碰 `.main-content` 规则块（第 1078-1114 行）、新插入的 `is-menu-shifting` 规则、`html[data-te-shell-layout='custom']` 的 token 覆盖，以及 `<script setup>` 里新增的 watcher。
- **不要**动 `src/renderer/src/components/player-bar/PlayerBar.css:1367-1375` 的 `.progress-fill` —— 它是正面样板。`.progress-fill` 相关的其他改动归 **007 号方案**。
- **不要**改 `.player-bar-shell.menu-open` 里 `left` / `right` / `z-index` 的取值，也不要改 `obsidian-glass.css:834-837`、`paper-light.css:925-928`、`studio-split.css:1072-1075`、`zen-minimal.css:1071-1074`、`aurora-reference.css:416-419` 这 5 处预设的 `.player-bar-shell.menu-open` 规则。它们的让位距离恰好等于 `var(--te-menu-width)`（`left: var(--te-menu-width)` 对应 `left: 0` 的收起态；aurora 那条另有覆盖，已在 Step 16 处理），基础 token 已经对上。
- **不要**动 `src/renderer/src/app/useSideMenuClearance.ts`。它的注释（第 59-71 行、第 81-89 行）明确说明为什么从**未变换的**盒模型（`offsetLeft + offsetWidth`）读菜单右边缘、以及为什么 `.player-bar-shell.menu-open` 这个类必须胜过瞬时 rect —— 本方案让 `left` 瞬时到位，正好让那段逻辑更稳，不需要任何配合改动。
- **不要**动 `src/renderer/src/utils/liquidGlassPointer.ts`。
- **不要**为动效模式新增 media query 或 `data-te-motion` 分支：`src/renderer/src/assets/base.css:425-441` 的全局兜底已覆盖。
- **不要**引入 `--te-neutral-800` / `--te-primary-600` —— 这两个 token 在任何主题里都没有定义，用了会得到发灰的文字。
- **不要**新增依赖。
- **不要**改动 markup 结构：除 Step 11 与 Step 14 明确要求的 class 绑定新增之外，不动任何 DOM 层级。
- **如果某一步找到的代码与本方案写的不一致**（行号漂移、声明已被改过、class 绑定写法不同），**停下报告，不要自行发挥**。尤其是 Step 14：如果 `.player-bar-shell` 的 class 绑定不是一个可直接添加键的对象字面量，停下。

## Verification

### Mechanical

- `pnpm run typecheck` —— 通过。Phase B/C 新增了 `ref` / `watch` / `requestAnimationFrame` 用法，这里能抓到漏掉的 import。
- `pnpm run lint` —— 通过，无新增告警。
- `pnpm run test:app` —— 覆盖 `SideMenu.test.ts`。Step 6/7 改过断言后必须通过。
- `pnpm run test:themes` —— 覆盖主题与预设布局，Step 16/17 改了 `aurora-reference.css` 后必须通过。
- `pnpm run test:cross-cutting-regressions` —— 覆盖跨切面回归。
- `pnpm run build` —— 通过。
- **跑测试前先在未改动的 HEAD（`9312f3e`）上记基线：仓库在 HEAD 上本来就有 3 条测试是红的。** 只对比「新增的红」，不要把既有的红算进本方案。
- 断言检查（`SideMenu.test.ts:12`、`:23` 原本逐字钉住了这两条布局过渡，是本方案唯一必须同步修改的门禁）：
  - `src/renderer/src/App.vue` 中 `grep -c "transition: padding-left"` 结果为 0。
  - `src/renderer/src/App.vue` 中 `grep -c "will-change: padding-left"` 结果为 0。
  - `src/renderer/src/components/player-bar/PlayerBar.css` 中 `grep -c "will-change: left;"` 结果为 0。
  - `grep -n "transition: left 0.32s" src/renderer/src/components/player-bar/PlayerBar.css` 无输出。
- 其他门禁不会被本方案触发，但别把它们改坏：`src/renderer/src/app/useMotionPreference.test.ts:67` 只覆盖 `PlayingMusic.vue`；`src/renderer/src/components/liquidGlassSurfaces.test.ts` 只查 `te-liquid-glass-budget` 字样与固定 blur 数值；`src/renderer/src/components/visibilityBudget.test.ts` 只覆盖 `resources/audio-visualizer/index.html` 与 `LoginPage.vue`；`scripts/verify-renderer-budgets.cjs:8-12` 只管产物体积。
- **如果新增了测试文件，必须登记进 `package.json` 的某条 `test:*` 脚本，否则永远不会被执行。**

### Feel check（真实渲染 + 性能取证）

先 `npx electron-vite build` 让 `out/` 带上改动，再用隔离 profile 启动 + CDP。

- 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --` —— `--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出。
- seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`。
- **播放栏只在有当前曲目时挂载**，本方案必须看到播放栏：seed `<profile>/playback-session.json`（`{version:1, savedAt, mode:'trackAndPosition', track, position, queue, queueIndex}`，塞一个真 `duration`），并在 settings 里设 `playbackResumeMode: 'trackAndPosition'`。
- 已有可复用 harness（gitignored，在 `output/`）：`verify-scroll-top.cjs`（滚动/浮层，seed 60 个真 WAV 并点「所有歌曲」侧边栏项 —— 本方案要的就是这个入口）、`verify-playbar-shapes.cjs`（`TE_THEME=` / `TE_PRESET=` / `TE_PORT=`，用来覆盖 6 套预设）。**优先复制改造这些，不要从零写。**
- 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
- 窗口 `deviceScaleFactor` 是 1.5，截图 clip 是 CSS px 但 PNG 带缩放，用 `png.width / clipWidth` 反推。
- **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
- **判断侧边栏开合状态看 `.side-menu.open`，不要看 `.player-bar-shell.menu-open`。**
- 在离屏测试窗口（`show: false`）里每个跟在 `scrollTop` 写入后的帧要花约 600ms（隐藏合成器懒确认滚动提交）。用 `{ show: false, opacity: 0, focusable: false, skipTaskbar: true }` 构造再 `window.showInactive()`，能拿到真 60fps 帧。

性能取证（这是本方案的主要证据，必须做）：

- 用 CDP 的 `Performance.enable` + `Tracing`，在**改动前**和**改动后**各录一段侧边栏开合的 trace，比对 **Layout / Recalculate Style / Paint** 的帧占用。预期：改动后 Layout 事件从「每帧一次、持续约 19 帧」降到「整个开合过程 1-2 次」。
- 在 DevTools Performance 面板录制三个动作各一遍：**侧边栏开合**、列表 hover 扫掠、切歌。侧边栏开合那段是本方案的靶子。
- 也可以用 `Runtime.evaluate` 里的 `performance.now()` 采样，配 `PerformanceObserver` 收 `layout-shift` / long task。

眼睛能看到的检查项：

- 侧边栏打开时，内容整体向右滑开，**滑动过程中文字不再逐帧重新折行**（改动前每帧重排会让长标题在滑动中反复换行位置）。
- 侧边栏打开的 320ms 内，内容右边缘会有一条空隙收拢到 0，**背后是应用背景，不是白色或黑色色块**。这是预期行为，不是 bug。关闭方向不应出现空隙。
- 播放栏左边缘与内容左边缘**同步**移动，不错拍（两者都是 320ms `var(--te-ease-soft)`）。
- 连续快速开合侧边栏 5-6 次，动画不会累积错位，最终位置正确（要么完全让开，要么完全归位，不停在中间）。
- 在 DevTools Animations 面板把播放速度设为 10%，确认滑动是**匀质的合成器位移**，内容内部没有二次抖动。
- 逐一切到 6 套预设布局（`aurora-reference` / `obsidian-glass` / `paper-light` / `studio-split` / `zen-minimal`，加默认布局），每套都开合一次侧边栏：动画起点不能有跳变。**`aurora-reference` 是重点** —— 它的让位距离多了一段空气间隙，如果 Step 16/17 漏了，开合瞬间会看到最多 48px 的跳。
- 切到自定义外壳布局（`html[data-te-shell-layout='custom']`），开合侧边栏：内容**不应该**有任何平移（Step 18 的 `--te-menu-shift: 0px` 生效）。
- 把动效模式切到 `reduced` 和 `off`：让位变成瞬时，没有滑动，也没有内容错位残留。

### Done when

- `grep -c "transition: padding-left" src/renderer/src/App.vue` 为 0；`grep -c "will-change: padding-left" src/renderer/src/App.vue` 为 0。
- `grep -c "will-change: left;" src/renderer/src/components/player-bar/PlayerBar.css` 为 0；`grep -n "transition: left 0.32s" src/renderer/src/components/player-bar/PlayerBar.css` 无输出。
- `--te-menu-shift` 在 `src/renderer/src/assets/base.css` 定义，且在 `aurora-reference.css`（两处）与 `html[data-te-shell-layout='custom']` 有覆盖。
- `SideMenu.test.ts` 的两处断言改成 transform 语义并通过；`pnpm run test:app`、`pnpm run test:themes`、`pnpm run test:cross-cutting-regressions` 相对 HEAD 基线无新增失败。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run build` 全通过。
- 改动前后两段 trace 对比表明：侧边栏开合期间的 Layout 事件由「约 19 次」降到「1-2 次」，且 Paint 帧占用下降。
- 6 套预设布局 + 自定义外壳 + 三档动效模式全部人工过一遍，无跳变、无错位、无残留平移。
