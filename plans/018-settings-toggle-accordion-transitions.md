# 018 — 设置页开关与折叠面板改用可打断的 transition

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: MEDIUM
- **Category**: 可打断性（AUDIT 第 4 节 Interruptibility）
- **Estimated scope**: 2 个文件（`src/renderer/src/components/settings-page/SettingsPage.css`、`src/renderer/src/components/settings-page/BackgroundEditorSettings.vue`），CSS 约 5 处编辑 + 模板 2 处包裹

## Problem

设置页有两处动效用了 `@keyframes`，而它们恰好是 AUDIT 第 4 节逐字点名**必须用 transition 或 spring** 的两类交互：开关（toggle）与展开/收起（expand/collapse）。

AUDIT 第 4 节原文：

> CSS **transitions** retarget from the current state mid-animation; **keyframes** restart from zero. Anything triggered rapidly or reversible mid-motion (toasts stacking, **toggles**, drags, **expand/collapse**) must use transitions or springs.

### 问题一：开关的位移用 transition、缩放用 keyframes，两者脱节

这个开关的**位移部分做对了**。`.toggle-switch::after` 是那个白色圆点，它的 `left` 与 `scale` 都在一条可 retarget 的 `transition` 里：

```css
/* src/renderer/src/components/settings-page/SettingsPage.css:1122-1136 — 当前 */
.toggle-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--te-card-bg);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition:
    left var(--te-motion-panel) var(--te-ease-soft),
    box-shadow var(--te-motion-panel) var(--te-ease-soft),
    scale var(--te-motion-panel) var(--te-ease-soft);
}
```

`left` 的两个端点：

```css
/* src/renderer/src/components/settings-page/SettingsPage.css:1143-1153 — 当前 */
.toggle-switch.active::after {
  left: 22px;
}

.toggle-switch.inactive {
  background: #d1d5db;
}

.toggle-switch.inactive::after {
  left: 2px;
}
```

偏偏又在**同一个元素的同一个属性**（`scale`）上叠了一条关键帧：

```css
/* src/renderer/src/components/settings-page/SettingsPage.css:1161-1163 — 当前 */
html[data-te-motion='full'] .toggle-switch.active::after {
  animation: te-settings-toggle-pop var(--te-motion-panel) var(--te-ease-soft);
}
```

```css
/* src/renderer/src/components/settings-page/SettingsPage.css:3312-3316 — 当前 */
@keyframes te-settings-toggle-pop {
  45% {
    scale: 1.16;
  }
}
```

**这是本方案最需要讲清的机制**：CSS 的层叠顺序里，运行中的 animation 覆盖 transition 的插值结果（animation 的 effect 优先级高于 transition）。所以 `scale` 这个属性在 280ms 内**由关键帧接管**，而 `left` 仍然由 transition 接管。后果是：

- 用户在动画进行到一半时反向点击开关（关掉又开、开了又关），`left` 会从**当前位置**平滑 retarget 到新目标（正确）；
- 但 `scale` 的关键帧会**从零重启** —— 重新走一遍 `1 → 1.16 → 1` 的完整曲线，而不管圆点当时缩放到哪一步；
- 两者节奏因此脱节：圆点一边平滑往回滑，一边突然重新鼓一次。快速连点时看起来是「抽搐」。

另外注意 `:1155-1159` 的 hover 缩放是**另一条**、走 transition 的，不受影响，也不要动：

```css
/* src/renderer/src/components/settings-page/SettingsPage.css:1155-1159 — 当前，正常 */
@media (hover: hover) {
  html[data-te-motion='full'] .toggle-switch:hover {
    scale: 1.05;
  }
}
```

`.toggle-switch` 在设置页共 54 处使用（`role="switch"` 的 `<span>`，例如 `src/renderer/src/components/settings-page/PerformanceSettingsSection.vue:42` 的「硬件加速」、`src/renderer/src/components/settings-page/AppearanceSettingsSection.vue:54` 的「封面主题色」），所以这一条影响面很宽。

### 问题二：折叠面板展开有动效、收起是硬切

两处同形状的折叠面板都靠关键帧播放入场：

```css
/* src/renderer/src/components/settings-page/SettingsPage.css:2064-2069 — 当前 */
.background-accordion-panel {
  display: grid;
  gap: 12px;
  padding: 0 12px 12px;
  animation: te-settings-expand var(--te-motion-panel) var(--te-ease-soft) both;
}
```

```css
/* src/renderer/src/components/settings-page/SettingsPage.css:2334-2339 — 当前 */
.page-background-controls {
  display: grid;
  gap: 10px;
  padding: 0 12px 12px;
  animation: te-settings-expand var(--te-motion-panel) var(--te-ease-soft) both;
}
```

```css
/* src/renderer/src/components/settings-page/SettingsPage.css:3300-3310 — 当前 */
@keyframes te-settings-expand {
  from {
    opacity: 0;
    transform: translate3d(0, -6px, 0);
  }

  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
```

它们由 `v-if` 挂载，挂载后关键帧自动播放：

```html
<!-- src/renderer/src/components/settings-page/BackgroundEditorSettings.vue:171-187 — 当前 -->
    <div class="background-accordion">
      <button
        type="button"
        class="background-accordion-trigger"
        :class="{ active: customBackgroundOpen }"
        @click="customBackgroundOpen = !customBackgroundOpen"
      >
        <span>
          {{
            settings.appBackground.global.kind === 'image' && settings.appBackground.global.image
              ? '图片背景'
              : '纯色背景'
          }}
        </span>
        <i class="pi pi-chevron-down"></i>
      </button>
      <div v-if="customBackgroundOpen" class="background-accordion-panel">
```

```html
<!-- src/renderer/src/components/settings-page/BackgroundEditorSettings.vue:293 — 当前 -->
              <div v-if="backgroundPageOpen === page.value" class="page-background-controls">
```

两个后果：

1. **无法 retarget**：快速反复开合时，每次 `v-if` 重新挂载都从 `translateY(-6px)` + `opacity: 0` 从零重启，不会从当前位置接续。
2. **卸载路径上没有任何离场过渡**：`v-if` 变 false 时元素立刻从 DOM 移除，**收起是硬切**。展开有动效、收起没有 —— 可打断性与空间一致性双失。这一条是纯粹的缺失，不是取舍。

相关的状态定义在 `src/renderer/src/components/settings-page/BackgroundEditorSettings.vue`：`:12` `const customBackgroundOpen = ref(false)`、`:13` `const backgroundPageOpen = ref<AppBackgroundPage | null>(null)`，`:154` 的 `backgroundPageOpen.value = backgroundPageOpen.value === page ? null : page` 是页面级折叠的切换逻辑。该 SFC **没有自己的 `<style>` 块**，样式全部来自全局加载的 `SettingsPage.css`（由 `src/renderer/src/components/SettingsPage.vue:1404` 的 `<style src="./settings-page/SettingsPage.css"></style>` 引入，注意**没有 `scoped`**）。

### AUDIT 依据

- 第 4 节：「Anything triggered rapidly or reversible mid-motion (toasts stacking, **toggles**, drags, **expand/collapse**) must use transitions or springs」；「CSS **transitions** retarget from the current state mid-animation; **keyframes** restart from zero」。
- 第 4 节的 spring 配置（若走 spring 路线）：`{ type: "spring", duration: 0.5, bounce: 0.2 }`，「Keep bounce subtle (0.1–0.3)」。
- 第 5 节 Performance：「Animate `transform` and `opacity` only」—— 所以折叠面板的离场也只动 `opacity` 与 `transform`，**不要**去过渡 `height` / `max-height` / `padding`。

## Target

### 目标一：开关的 `scale` 反馈改走 transition

删掉那条关键帧规则与关键帧本体，改成用 transition 驱动的两级 `scale`：静止 `1`，`:active`（按下瞬间）`1.16`。这样按下时鼓起、松开时回落，全程可 retarget，反向点击时从当前缩放值接续。

```css
/* target — src/renderer/src/components/settings-page/SettingsPage.css，替换原 :1161-1163 */
html[data-te-motion='full'] .toggle-switch:active::after {
  scale: 1.16;
}
```

`::after` 的 transition 清单要同时改两件事：**把 `left` 换成 `translate`**，并让缩放走比位移更快的一档（AUDIT 第 4 节「the system's response snaps」）。

`left` 是布局属性，过渡它会在 280ms 内每帧触发 layout + paint + composite（AUDIT 第 5 节「Animate `transform` and `opacity` only」）。这个旋钮的位移是纯粹的水平平移，用 `translate` 表达完全等价，且走合成器。本方案已经在编辑这条声明，顺手改掉比留给后续方案更省。

用**独立变换属性 `translate`** 而非 `transform: translateX()`，因为这个仓库已经统一用独立属性表达变换（`base.css:397` 的 `translate: 0 var(--te-motion-hover-translate)`、`base.css:404` 的 `scale: 1`）。独立属性之间按 `translate → rotate → scale` 顺序合成，所以 `translate` 与同元素上的 `scale` 不冲突、不相乘。

```css
/* target — src/renderer/src/components/settings-page/SettingsPage.css，替换原 :1132-1135 */
  transition:
    translate var(--te-motion-panel) var(--te-ease-soft),
    box-shadow var(--te-motion-panel) var(--te-ease-soft),
    scale var(--te-motion-hover) var(--te-ease-soft);
```

`--te-motion-hover` 是 `160ms`（`base.css:33`），落在 AUDIT 第 2 节「Button press feedback 100–160ms」这一档；`--te-motion-panel` 是 `280ms`（`base.css:34`），位移时长保持不变。

配套改端点。`left: 2px` 留作静态起始位置（不再过渡它），位移改由 `translate` 表达。**两个尺寸变体的行程不同，必须分别写**：

```css
/* target — 标准尺寸：原 .toggle-switch.active::after { left: 22px } */
.toggle-switch.active::after {
  translate: 20px 0;   /* 22px - 2px */
}

/* target — 原 .toggle-switch.inactive::after { left: 2px } */
.toggle-switch.inactive::after {
  translate: 0 0;
}

/* target — 大尺寸：原 .toggle-switch.large.active::after { left: 25px } */
.toggle-switch.large.active::after {
  translate: 23px 0;   /* 25px - 2px */
}
```

`.toggle-switch.large::after` 只改 `top` / `width` / `height`，不含 `left`，所以它继承基础的 `left: 2px` 起点，无需改动。

关键帧 `te-settings-toggle-pop` 删除（删掉后全仓无引用）。

### 目标二：折叠面板改用 `<Transition>` + transition，进出对称可打断

模板层把 `v-if` 的元素外包一层 `<Transition name="settings-accordion">`，CSS 层用四条 Vue transition class 实现对称的进出，`animation` 声明删除。

```css
/* target — 新增到 src/renderer/src/components/settings-page/SettingsPage.css */
.settings-accordion-enter-active,
.settings-accordion-leave-active {
  transition:
    opacity var(--te-motion-panel) var(--te-ease-soft),
    transform var(--te-motion-panel) var(--te-ease-soft);
}

.settings-accordion-enter-from,
.settings-accordion-leave-to {
  opacity: 0;
  transform: translate3d(0, -6px, 0);
}
```

两条面板规则去掉 `animation`：

```css
/* target — src/renderer/src/components/settings-page/SettingsPage.css，替换原 :2064-2069 */
.background-accordion-panel {
  display: grid;
  gap: 12px;
  padding: 0 12px 12px;
}
```

```css
/* target — src/renderer/src/components/settings-page/SettingsPage.css，替换原 :2334-2339 */
.page-background-controls {
  display: grid;
  gap: 10px;
  padding: 0 12px 12px;
}
```

关键帧 `te-settings-expand` 删除（两处引用都去掉后全仓无引用）。

`-6px` 与 `var(--te-motion-panel)` 都照抄原关键帧的值，**位移量与时长不变**，改的只是驱动方式（keyframes → transition）与新增离场路径。

**本方案不引入 spring。** 仓库的 spring 实现是 JS 侧的（`src/renderer/src/utils/lyricSpring.ts`），把 54 个开关和 2 个折叠面板改成 JS 驱动会显著扩大改动面且引入 rAF 成本（AUDIT 第 5 节：「CSS (and WAAPI) beat rAF-based JS under load — use CSS for predetermined motion」）。这两处都是**预定的**开合，不是手势驱动，所以 CSS transition 是正解。spring 只在 Boundaries 里作为「不要做」记录。

## Repo conventions to follow

- 动效 token 全住在 `src/renderer/src/assets/base.css:26-40`。本方案用到：`--te-motion-hover: 160ms;`（`:33`）、`--te-motion-panel: 280ms;`（`:34`）、`--te-ease-soft: var(--te-ease-out-quint);`（`:28`）。**不新增任何 token。**
- **`<Transition>` + 四条 class 的仓库样板** —— 同一个 `SettingsPage.css` 里已有一套做对的（赞助对话框），照它的形状写：
  ```css
  /* src/renderer/src/components/settings-page/SettingsPage.css:3183-3204 — 现有正确实现 */
  .sponsor-dialog-enter-active,
  .sponsor-dialog-leave-active {
    transition: opacity 0.2s ease;
  }

  .sponsor-dialog-enter-active .sponsor-dialog,
  .sponsor-dialog-leave-active .sponsor-dialog {
    transition:
      transform 0.22s var(--te-ease-soft),
      opacity 0.18s ease;
  }

  .sponsor-dialog-enter-from,
  .sponsor-dialog-leave-to {
    opacity: 0;
  }

  .sponsor-dialog-enter-from .sponsor-dialog,
  .sponsor-dialog-leave-to .sponsor-dialog {
    transform: translateY(12px) scale(0.98);
    opacity: 0;
  }
  ```
  对应模板侧的写法在 `src/renderer/src/components/settings-page/AboutSettingsSection.vue:331`：`<Transition name="sponsor-dialog">`，内部是 `v-if` 的元素。
- 显式多属性清单的排版：`transition:` 单独一行，每属性一行、缩进两格、除末项外行尾逗号。prettier 会这样格式化。
- 三档动效模式由 `html[data-te-motion='full'|'reduced'|'off']` 驱动（`src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts`）。`base.css:412-441` 已经统一处理降级：`reduced` 把 `transition-duration` 压到 `0.01ms` 并把 `--te-motion-press-scale` 设为 `1`，`off` 直接 `transition: none !important`。**所以本方案新增的 transition 不需要自己写 `prefers-reduced-motion` 媒体查询**，全局兜底已覆盖。
- **`html[data-te-motion='full']` 前缀要保留。** 目标一的 `:active` 缩放规则必须继续挂在 `html[data-te-motion='full']` 下面，与原关键帧规则一致 —— `reduced` / `off` 档不应该有这个鼓起反馈。

## Steps

一步一个具体编辑。做完一步再做下一步。第 1–3 步（含 1b）是开关，第 4–10 步是折叠面板。

1. **把开关圆点的位移改成 `translate`，并收紧 `scale` 时长。** 打开 `src/renderer/src/components/settings-page/SettingsPage.css`，定位第 1132-1135 行（在 `.toggle-switch::after` 规则块内），把
   ```css
     transition:
       left var(--te-motion-panel) var(--te-ease-soft),
       box-shadow var(--te-motion-panel) var(--te-ease-soft),
       scale var(--te-motion-panel) var(--te-ease-soft);
   ```
   改成：
   ```css
     transition:
       translate var(--te-motion-panel) var(--te-ease-soft),
       box-shadow var(--te-motion-panel) var(--te-ease-soft),
       scale var(--te-motion-hover) var(--te-ease-soft);
   ```
   `left: 2px` 那一行**保留不动**（它现在是静态起始位置，不再被过渡）。

1b. **改两个尺寸变体的位移端点。** 同一文件：
   - `.toggle-switch.active::after`（`:1146-1148`）的 `left: 22px;` → `translate: 20px 0;`
   - `.toggle-switch.inactive::after`（`:1154-1156`）的 `left: 2px;` → `translate: 0 0;`
   - `.toggle-switch.large.active::after`（`:1176-1178`）的 `left: 25px;` → `translate: 23px 0;`

   行程算法：新值 = 原 `left` 端点 − 基础 `left: 2px`。`.toggle-switch.large::after`（`:1170-1174`）只改 `top`/`width`/`height`、不含 `left`，继承基础起点，**不需要改**。

2. **把开关的关键帧反馈改成 `:active` transition。** 同一文件，定位第 1161-1163 行：
   ```css
   html[data-te-motion='full'] .toggle-switch.active::after {
     animation: te-settings-toggle-pop var(--te-motion-panel) var(--te-ease-soft);
   }
   ```
   整块替换为：
   ```css
   html[data-te-motion='full'] .toggle-switch:active::after {
     scale: 1.16;
   }
   ```
   **注意选择器从 `.toggle-switch.active::after` 变成了 `.toggle-switch:active::after`** —— 前者是「已开启状态」的类（一直存在），后者是「正在被按下」的伪类（只在指针按住期间存在）。这个改动是有意的：原来关键帧在「变成 active」时播一次，现在改成按下时鼓起、松手回落，全程可 retarget。**不要**写成 `.toggle-switch.active:active::after`（那样只有已开启的开关才有按下反馈，关闭方向就没有了）。

3. **删除开关的关键帧本体。** 同一文件，定位第 3312-3316 行，删除整块：
   ```css
   @keyframes te-settings-toggle-pop {
     45% {
       scale: 1.16;
     }
   }
   ```
   删除后上下各保留一个空行（上文是 `@keyframes te-settings-expand` 的收尾 `}`，下文是 `@keyframes te-settings-swatch-select {`）。删完跑 `grep -rn "te-settings-toggle-pop" src/` 确认零命中。

4. **新增折叠面板的 `<Transition>` 样式规则。** 同一文件，在 `.background-accordion-panel` 规则（原第 2064 行）**之前**插入下面这一段（前后各留一个空行）：
   ```css
   /* 折叠面板的进出：transition 而非 keyframes，半途反向时从当前位置 retarget；
      离场路径由 <Transition> 提供，收起不再是硬切。 */
   .settings-accordion-enter-active,
   .settings-accordion-leave-active {
     transition:
       opacity var(--te-motion-panel) var(--te-ease-soft),
       transform var(--te-motion-panel) var(--te-ease-soft);
   }

   .settings-accordion-enter-from,
   .settings-accordion-leave-to {
     opacity: 0;
     transform: translate3d(0, -6px, 0);
   }
   ```

5. **去掉 `.background-accordion-panel` 的 `animation`。** 同一文件，定位 `.background-accordion-panel` 规则（原第 2064-2069 行），删除其中的
   ```css
     animation: te-settings-expand var(--te-motion-panel) var(--te-ease-soft) both;
   ```
   这一行。规则块剩下 `display: grid;`、`gap: 12px;`、`padding: 0 12px 12px;` 三条。

6. **去掉 `.page-background-controls` 的 `animation`。** 同一文件，定位 `.page-background-controls` 规则（原第 2334-2339 行），同样删除
   ```css
     animation: te-settings-expand var(--te-motion-panel) var(--te-ease-soft) both;
   ```
   这一行。规则块剩下 `display: grid;`、`gap: 10px;`、`padding: 0 12px 12px;` 三条。

7. **删除折叠面板的关键帧本体。** 同一文件，定位第 3300-3310 行，删除整块：
   ```css
   @keyframes te-settings-expand {
     from {
       opacity: 0;
       transform: translate3d(0, -6px, 0);
     }

     to {
       opacity: 1;
       transform: translate3d(0, 0, 0);
     }
   }
   ```
   删完跑 `grep -rn "te-settings-expand" src/` 确认零命中。

8. **模板：包裹第一个折叠面板。** 打开 `src/renderer/src/components/settings-page/BackgroundEditorSettings.vue`，定位第 187 行：
   ```html
         <div v-if="customBackgroundOpen" class="background-accordion-panel">
   ```
   在它外面包一层 `<Transition>`。改动前后的结构（只贴首尾，中间内容一个字都不要动）：
   ```html
   <!-- 改动后 -->
         <Transition name="settings-accordion">
           <div v-if="customBackgroundOpen" class="background-accordion-panel">
             …（原有内容整体向右缩进两格）…
           </div>
         </Transition>
   ```
   这个 `<div>` 的配对 `</div>` 在原文件里是缩进 6 格的那一个 —— 从第 187 行的 `<div>` 开始数配对标签找到它，在其后加 `</Transition>`。**内部所有子元素整体缩进两格**（prettier 会要求这个缩进，`pnpm run lint` 会报出来）。

9. **模板：包裹第二个折叠面板。** 同一文件，定位第 293 行：
   ```html
                 <div v-if="backgroundPageOpen === page.value" class="page-background-controls">
   ```
   同样在外面包 `<Transition name="settings-accordion">` … `</Transition>`，内部整体缩进两格。这个面板在一个 `v-for`（按页面遍历）里，**`<Transition>` 要放在 `v-for` 元素的内部**（即包住这个 `v-if` 的 `<div>`，而不是包住整个循环项）—— 每个页面各自一个 `<Transition>`，互不干扰。

10. **收尾核对。** 跑 `grep -rn "te-settings-expand\|te-settings-toggle-pop" src/`，应当零命中。跑 `grep -n "settings-accordion" src/renderer/src/components/settings-page/SettingsPage.css src/renderer/src/components/settings-page/BackgroundEditorSettings.vue`，应当能看到 CSS 侧 4 个选择器 + 模板侧 2 个 `<Transition name="settings-accordion">`。

## Boundaries

- **不要动 `.settings-accordion-trigger` 与 `.settings-accordion-body`。** 它们在 `SettingsPage.css:1183-1242`，是**另一族**折叠器（`CardAppearanceSettings.vue`、`LiquidGlassSettings.vue`、`LyricsStyleSettings.vue`、`MiniPlayerSettingsSection.vue`、`PlayerBarLayoutSettings.vue`、`PlayerBarSettings.vue` 在用）。注意 `.settings-accordion-body` 是 `display: contents;`（`SettingsPage.css:1239-1241`）—— `display: contents` 的元素**不生成自己的盒子**，给它加 `transform` / `opacity` 无效，所以那一族不能照本方案的做法改，需要另开方案。**本方案新增的 class 名 `settings-accordion-enter-*` / `settings-accordion-leave-*` 与 `.settings-accordion-body` / `.settings-accordion-trigger` 只是前缀相同，不会互相选中**（Vue transition class 是完整的独立类名），但也不要顺手去改那一族。
- **不要动 `SettingsPage.css:1155-1159` 的 hover 缩放**（`html[data-te-motion='full'] .toggle-switch:hover { scale: 1.05; }`）。它已经走 transition，是正确的。
- **不要动 `.toggle-switch` 本体的 transition**（`SettingsPage.css:1116-1119`）。只改 `::after` 的那一条（第 1 步）。
- **`.toggle-switch.large` 族只改 `.large.active::after` 的位移端点一处**（第 1b 步：`left: 25px` → `translate: 23px 0`）。`.toggle-switch.large`（`SettingsPage.css:1165-1168`，只有 `width` / `height`）与 `.toggle-switch.large::after`（`:1170-1174`，只有 `top` / `width` / `height`）**不要动** —— 它们不含 `left`，继承基础的 `left: 2px` 起点。
- **两个尺寸变体的 `translate` 值必须分别算，不能共用。** 标准尺寸行程 `22px - 2px = 20px`，大尺寸 `25px - 2px = 23px`。写错会让旋钮停在轨道内侧或越出右缘。
- **不要动 `.toggle-switch.disabled`**（`SettingsPage.css:1876-1880`）。
- **不要动 `base.css` 里任何 `.toggle-switch` 的主题规则**（`:1135`、`:2161`、`:2295`、`:2300`）—— 那些只管配色。
- **不要动 `SettingsPage.css` 里其余 7 处 `animation:`**：`:359`（`te-settings-arrive`）、`:364`（`te-settings-nav-arrive`）、`:568`（`te-search-flash`）、`:1989`（`te-settings-swatch-select`）、`:3833`（`te-settings-signal-pulse`）、`:3849`（`te-settings-signal-flow`）。本方案只处理 `te-settings-toggle-pop` 与 `te-settings-expand` 两个。
- **不要引入 JS spring。** 不要 import `src/renderer/src/utils/lyricSpring.ts` 或 `src/renderer/src/utils/liquidGlassPress.ts`，不要新增 rAF 循环。这两处是预定开合、不是手势驱动，CSS transition 是正解；引入 JS 驱动会把 54 个开关都变成主线程动画。（仓库里那两个 spring 实现是给手势/惯性场景用的正面参考，不是本方案的目标。）
- **不要过渡 `height` / `max-height` / `padding` / `grid-template-rows` 来做「真正的高度折叠」。** 那是 AUDIT 第 5 节点名的 layout 属性，且会扩大改动面。本方案只把现有的 `opacity` + `translateY` 形态从 keyframes 迁到 transition，并补上离场路径。
- **不要改任何 `v-if` 的条件表达式、不要改 `customBackgroundOpen` / `backgroundPageOpen` 的类型或初值、不要动 `BackgroundEditorSettings.vue` 的 `<script setup>`。** 模板改动只是加一层 `<Transition>` 包裹 + 缩进。
- **不要引入对 `--te-neutral-800` 或 `--te-primary-600` 的引用。** 这两个 token 在任何主题里都没有定义。
- 不要新增依赖、不要新增 token、不要改 `package.json`。
- **若某一步的当前代码与本方案引用的内容不符（行号漂移到找不到、选择器不同、该处已被改过），停下来报告，不要自行发挥。** 尤其：如果 `.toggle-switch.active::after` 那条 `animation` 已经不在了，说明有人先改过，报告并停止。

## Verification

- **Mechanical**：
  - `pnpm run lint` —— 应当通过。模板包裹会改变缩进，prettier 对此严格；若报格式差异，按它的意见调整。
  - `pnpm run typecheck` —— `<Transition>` 是 Vue 内置组件，不需要 import，`vue-tsc` 应当直接认。若报「找不到 Transition」，说明写成了自定义组件名，检查大小写。
  - `pnpm run test:themes` —— 这一档包含 `src/renderer/src/components/SettingsPage.theme.test.ts`。已核对：该测试对 `.toggle-switch` 只有一条断言，在 `:68`，匹配 `html[data-theme='dark'] .settings-preview-layout .toggle-switch.inactive { … background: var(--te-subtle-bg) … }`（`base.css:2295-2298`）。本方案不碰 `base.css`，**这条断言不受影响**。该档还包含 `themeColorAudit.test.ts`（只扫颜色字面量，本方案不增删颜色）与 `themeTokenization.test.ts`（会读 `SettingsPage.css`，但断言的是 token 布线，不涉及 `animation` / `transition`）。
  - `pnpm run test:app` —— 覆盖 `src/renderer/src/app/useMotionPreference.test.ts`。已核对：它对 `SettingsPage.css` 无断言，对 `transition: all` 的检查只针对 `PlayingMusic.vue`（`:67`）。不受影响。
  - `pnpm run build` —— 产物应当构建成功。
  - **注意：HEAD（8e34e01）上本来就有 3 条测试是红的。** 跑任何套件前先在未改动的工作树上记一次基线，只对比新增的失败。
  - `pnpm run format` 有既有基线，可能顺带重排无关文件。**只提交本方案涉及的那 2 个文件的改动。**
- **Feel check（真实渲染，不许用简化替身当证据）**：
  - 先 `npx electron-vite build` 让 `out/` 带上改动。
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `<profile>/music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `<profile>/plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`（否则 provider RPC 要 30s 超时才放行启动）。
  - **首选夹具：复制改造 `output/verify-settings-align.cjs`**（gitignored，363/322 行那两个 harness 之一）。它已经具备本方案需要的全部能力：seed → 启动 → 点 `button.settings-btn` 进设置页 → 按文案匹配点 `.preview-nav-item` 切分区 → `Emulation.setDeviceMetricsOverride` 设 1500×2400 高视口 → 量取与 clip 截图；还含 CDP `Input.dispatchKeyEvent` 键盘驱动范例，以及读回 `<profile>/settings.json` 验持久化的做法。**不要从零写夹具。**
  - **设置页是固定覆盖层且有自己的平滑滚动容器**：page 坐标系的 `captureBeyondViewport` clip 会渲成纯黑。要截图就用 `Emulation.setDeviceMetricsOverride` 设高视口，先把 `.settings-preview-page` 的 `style.scrollBehavior='auto'` 再赋 `scrollTop`，然后按**视口坐标** clip。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - 窗口 `deviceScaleFactor` 是 1.5，截图 clip 是 CSS px 但 PNG 带缩放，用 `png.width / clipWidth` 反推。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
  - `settings.theme` 只接受 `'dark' | 'pureWhite' | 'system'`（没有 `'light'`，会落到 system 进而在本机解析成 dark）。两个 tone 各跑一次并断言 `document.documentElement.dataset.theme`。
  - **开关要确认的观察点**：
    - 进「性能」分区，反复快速点同一个开关（例如「硬件加速」那个 `.toggle-switch`）—— 圆点位移与缩放**节奏一致**，不再出现「一边往回滑一边重新鼓一次」。
    - 在 DevTools Animations 面板把播放速度设为 **10%**，按住开关不放：圆点应当鼓到 1.16 并**停在那里**（`:active` 期间保持）；松手后平滑回到 1。改动前的表现是按下瞬间自动走完 `1 → 1.16 → 1` 一遍、与按住状态无关。
    - 10% 速度下在缩放中途反向点击：缩放从**当前值**接续，不从 1 重启。这是本方案的核心证据。
    - 用 CDP 读计算样式佐证 —— 对一个 `.toggle-switch` 元素读 `getComputedStyle(el, '::after')` 的 `animationName` 应当是 `none`（改动前是 `te-settings-toggle-pop`），`transitionDuration` 应当含 `0.16s`（scale 那一项）。
    - **`left` → `translate` 的落点核对（这一步最容易出错，必须用眼睛确认）**：`translate` 是相对 `left: 2px` 起点的位移，所以行程 = 原终点 − 起点。标准尺寸 `22px − 2px = 20px`，大尺寸 `25px − 2px = 23px`。开启状态下圆点的右缘与轨道右缘的间距，应当与改动前**完全一致**（标准尺寸轨道宽 40px、圆点 16px，开启时右缘距轨道右缘 2px；大尺寸轨道 48px、圆点 20px，同样 2px）。两种尺寸都要看：**设置页里 `.toggle-switch.large` 与标准尺寸混用**，只对一个尺寸目测会漏掉另一个的偏移。最稳的做法是改动前后各截一张开启态的图叠着比，或用 CDP 读 `getBoundingClientRect()` 比对圆点的 `left`/`right`。
    - 10% 慢放下确认圆点是**平移**而不是伸缩：改动前过渡 `left` 时圆点在动画期间可能出现亚像素宽度抖动，改成 `translate` 后应当是干净的刚体平移。
  - **折叠面板要确认的观察点**：
    - 进「外观」分区，点「自定义背景」的折叠触发器（`.background-accordion-trigger`）—— 展开与**收起都有动效**（改前收起是硬切）。
    - 连续快速开合：面板不会每次都从 `-6px` 跳回去重播；半途反向时从当前位置与当前透明度接续。
    - 展开「按页面覆盖」里某一页的 `.page-background-controls`，同样确认收起有动效。
    - 10% 速度下确认进出是**对称**的（同样 280ms、同样 6px 位移，方向相反）。
  - 在 DevTools Rendering 面板切 `prefers-reduced-motion: reduce`，以及把 `<html>` 的 `data-te-motion` 依次设为 `'reduced'` 与 `'off'`：`base.css:412-441` 会把时长压到 `0.01ms`（reduced）或 `transition: none`（off）。确认两档下**折叠面板仍然能正常出现与消失**（不会因为离场过渡被压成 0 而卡住不卸载 —— Vue 的 `<Transition>` 靠 `transitionend` 或时长推断来移除元素，`0.01ms` 与 `none` 都应当立即完成），开关也仍然能切换，只是没有缩放反馈。**这一条要实际点一遍确认，不要只看 CSS。**
- **Done when**：
  - `grep -rn "te-settings-toggle-pop" src/` 零命中。
  - `grep -rn "te-settings-expand" src/` 零命中。
  - `grep -n "left var(--te-motion-panel)" src/renderer/src/components/settings-page/SettingsPage.css` 零命中（`left` 已不在过渡清单里）。
  - `grep -n "left: 22px\|left: 25px" src/renderer/src/components/settings-page/SettingsPage.css` 零命中（两个位移端点都已改成 `translate`）。
  - CDP 读 `.toggle-switch` 的 `getComputedStyle(el, '::after').transitionProperty` 不含 `left`，含 `translate`。
  - `grep -n "settings-accordion-enter-active\|settings-accordion-leave-active\|settings-accordion-enter-from\|settings-accordion-leave-to" src/renderer/src/components/settings-page/SettingsPage.css` 命中 4 个选择器。
  - `grep -c 'Transition name="settings-accordion"' src/renderer/src/components/settings-page/BackgroundEditorSettings.vue` 输出 `2`。
  - `grep -n "animation:" src/renderer/src/components/settings-page/SettingsPage.css` 的命中数从 9 降到 7。
  - CDP 读到的 `.toggle-switch::after` 的 `animationName` 是 `none`。
  - 折叠面板收起时能观察到 280ms 的离场过渡（10% 慢放下清晰可见）。
  - `pnpm run lint`、`pnpm run typecheck`、`pnpm run build` 通过，测试失败数不超过 HEAD 基线的 3 条。
