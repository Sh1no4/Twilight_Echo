# 011 — 删掉导航悬停的旋转与缩放，并给全仓 hover 位移补上指针类型门禁

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 目的与频次（AUDIT 第 1 节 Purpose & frequency）+ 无障碍（AUDIT 第 6 节 Accessibility）
- **Estimated scope**: 前半段 2 个文件、约 4 处声明；后半段 6 个文件、约 78 处 hover 规则包 `@media` 外加 `base.css` 一处补齐。纯 CSS。

本方案有两段，**前半段（第 1-5 步）是删动效，后半段（第 6-13 步）是加门禁**。两段同属「高频面上的装饰动效」这一类别，可以分两个 commit 提交，但请按顺序做完。

## Problem

### 第一部分：侧边栏导航图标 hover 时旋转 + 放大

侧边栏是整个应用**点击频次最高的面**——切换「所有歌曲 / 歌手 / 专辑 / 流媒体 / 设置」都走它。鼠标在这一列上移动是常态动作，而每次划过一个导航项，图标都会旋转 4 度并放大 12%。

```css
/* src/renderer/src/components/SideMenu.vue:375-378 — 当前 */
.menu-item:hover .item-icon {
  transform: translateX(1px) scale(1.12) rotate(-4deg);
  color: var(--te-navigation-hover-text);
}
```

驱动这个 transform 的过渡声明，`src/renderer/src/components/SideMenu.vue:353-365`：

```css
/* src/renderer/src/components/SideMenu.vue:353-365 — 当前 */
.item-icon {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--te-navigation-icon);
  font-size: 17px;
  transition:
    color 0.2s,
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

`cubic-bezier(0.34, 1.56, 0.64, 1)` 的第二控制点 y 值是 `1.56`，即约 **+16% 过冲**——超过 token `--te-ease-spring`（`cubic-bezier(0.22, 1.14, 0.36, 1)`，约 +7% 过冲，见 `src/renderer/src/assets/base.css:29`）的两倍多。所以图标不只是放大，还会弹一下再回落。

**曲线的统一归 004 号方案管，本方案只管「这个动效该不该存在」和它的幅度。** 本方案会把 transform 从这条 transition 里整个删掉，届时那条裸 cubic-bezier 也随之消失。

同一个导航项上还叠着行级位移：

```css
/* src/renderer/src/components/SideMenu.vue:317-321 — 当前 */
.menu-item:hover {
  background: var(--te-navigation-hover);
  color: var(--te-navigation-hover-text);
  transform: translateX(3px);
}
```

而全局交互反馈又给同一个元素加了一层纵向位移（`.menu-item` 是 `<button>`，命中 `:where(button, …)`）：

```css
/* src/renderer/src/assets/base.css:392-399 — 当前 */
@media (hover: hover) {
  html[data-te-motion='full']
    :where(button, [role='button'], [role='switch'], [data-te-interactive]):not(:disabled):not(
      [aria-disabled='true']
    ):hover {
    translate: 0 var(--te-motion-hover-translate);
  }
}
```

`--te-motion-hover-translate` 是 `-1px`（`src/renderer/src/assets/base.css:40`）。`transform: translateX(3px)` 与 `translate: 0 -1px` 是两个独立属性，**会叠加**：整行实际是向右 3px、向上 1px 的**斜向漂移**，图标在此之上再转 4 度、放大 12%。一次 hover 上演三层动效。

#### 仓库自己已经判定过这类位移是多余的

```css
/* src/renderer/src/components/SideMenu.vue:429-431 — 当前 */
:global(html[data-te-navigation-style='rail'] .menu-item:hover) {
  transform: none;
}
```

`rail` 导航样式下，`.menu-item` 的 hover 位移被显式关掉了。这说明这个位移本身就被认定过是多余的——但**图标的旋转缩放没跟着关**：`.menu-item:hover .item-icon` 没有任何 `rail` 覆盖，所以在 rail 模式下行不动、图标照转。这个不一致本身就是证据。

#### 同族问题：设置页预览导航

```css
/* src/renderer/src/components/settings-page/SettingsPage.css:452-461 — 当前 */
@media (hover: hover) {
  html[data-te-motion='full'] .preview-nav-item:hover {
    translate: 2px 0;
  }

  html[data-te-motion='full'] .preview-nav-item:hover i {
    scale: 1.08;
    rotate: -5deg;
  }
}
```

同样的形状：行位移 + 图标旋转缩放。这一处已经被 `@media (hover: hover)` 与 `html[data-te-motion='full']` 双重包好，写法比 SideMenu 规范，但 `rotate: -5deg` 一样是纯装饰。

#### AUDIT 依据

AUDIT 第 1 节频次表：

| Frequency | Decision |
| --- | --- |
| 100+ times/day (keyboard shortcuts, command palette toggle) | No animation. Ever. |
| **Tens of times/day (hover effects, list navigation)** | **Remove or drastically reduce** |
| Occasional (modals, drawers, toasts) | Standard animation |
| Rare / first-time (onboarding, feedback, celebrations) | Can add delight |

侧边栏导航正是表里那行「**hover effects, list navigation**」的字面例子，判定是「**Remove or drastically reduce**」。同节的 Hunt 项也直接点名：「decorative motion on list items or hover states hit constantly」，并给出结论「The strongest fix is often **delete the animation**」。

AUDIT 第 1 节的核心要求是每个动效必须回答「why does this animate?」，合法答案只有 spatial consistency / state indication / feedback / explanation / preventing a jarring change 五种，且「'It looks cool' on a frequently-seen element is not a purpose」。

- `rotate(-4deg)` **不指示任何状态**——导航项没有「倾斜」这一状态，旋转不表达任何信息。
- `scale(1.12)` 也不指示状态：hover 指示的职责已经由 `background: var(--te-navigation-hover)` 与 `color: var(--te-navigation-hover-text)` 完成了，那是颜色变化，AUDIT 第 6 节明确把「keep opacity/color, drop movement」列为正确取向。

本仓设计文档也明文禁止这类动效，`docs/apple-music-inspired-hifi-player-design-system.md:1241`：

> - ✗ **Unnecessary animation.** No looping, no idle bounce, no 500 ms welcome choreography; avoid animating anything the user does repeatedly (HIG Motion 🟢).

「avoid animating anything the user does repeatedly」——侧边栏 hover 就是最典型的 repeatedly。

### 第二部分：全仓 hover 位移缺少指针类型门禁

全仓 **159 处** hover 规则块内含 `transform` / `translate` / `scale` / `rotate`（已排除 `transform: none` 这类复位声明），其中**只有 9 处**被 `@media (hover: hover)` 包住，其余 **150 处裸奔**。

那 9 处全在这两个文件（可作样板）：

```
src/renderer/src/assets/base.css:392
src/renderer/src/components/settings-page/SettingsPage.css:452
src/renderer/src/components/settings-page/SettingsPage.css:846
src/renderer/src/components/settings-page/SettingsPage.css:1155
src/renderer/src/components/settings-page/SettingsPage.css:1992
src/renderer/src/components/settings-page/SettingsPage.css:2455
src/renderer/src/components/settings-page/SettingsPage.css:3812
```

而且**连唯一那处全局规则也只写了一半**：`src/renderer/src/assets/base.css:392` 是 `@media (hover: hover) {`，**缺 `and (pointer: fine)`**。

AUDIT 第 6 节给的范式是两个条件都要：

```css
@media (hover: hover) and (pointer: fine) {
  .element:hover { transform: scale(1.05); } /* touch fires false hovers on tap */
}
```

理由写在注释里：**touch fires false hovers on tap**。触屏上点一下会合成一次 hover，且这个 hover 状态**在手指离开后仍然粘在元素上**，直到点击别处才清除。所以在触屏设备上点一张卡片，卡片会带着 hover 位移停在那里——看起来像卡住了。

`hover: hover` 单独用不够：部分触屏设备（尤其带触控笔或走 hybrid 输入的 Windows 二合一）在 `hover` 媒体特性上会报 `hover`，需要 `pointer: fine` 才能把粗指针排除掉。

**严重度按桌面场景下调的理由**：这是以 Windows 桌面为主的 Electron 应用，绝大多数用户是鼠标，`pointer: coarse` 路径不是主路径。但仓库支持触屏二合一设备（Surface 这类），在那些机器上点击列表卡片就会留下粘滞的 hover 位移。所以这不是「理论问题」，只是「影响面小于第一部分」。

需要处理的高频卡片面（每个文件的裸 hover-transform 处数，已核对）：

| 文件 | 处数 |
| --- | --- |
| `src/renderer/src/components/LocalDashboard.css` | 17 |
| `src/renderer/src/components/onboarding/OnboardingWizard.css` | 17 |
| `src/renderer/src/components/StreamingHome.vue` | 14 |
| `src/renderer/src/components/StreamingDiscovery.vue` | 11 |
| `src/renderer/src/components/StreamingLibrary.vue` | 9 |
| `src/renderer/src/components/streaming-page/StreamingPage.css` | 9 |

## Target

### 第一部分目标

`src/renderer/src/components/SideMenu.vue` 的 `.menu-item:hover .item-icon` 只保留颜色变化，`transform` 整条删掉：

```css
/* target — src/renderer/src/components/SideMenu.vue */
.menu-item:hover .item-icon {
  color: var(--te-navigation-hover-text);
}
```

`.item-icon` 的 transition 里删掉 transform 项，只留颜色（那条裸 cubic-bezier 随之消失）：

```css
/* target — src/renderer/src/components/SideMenu.vue */
.item-icon {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--te-navigation-icon);
  font-size: 17px;
  transition: color 0.2s;
}
```

`.menu-item:hover` 的行位移也删掉，只留背景与文字色（这与仓库自己在 rail 模式下的判定一致，删掉后 `:429-431` 的 `transform: none` 覆盖也不再需要，但**那条覆盖保留不动**——它无害，且删它会牵动 `html[data-te-navigation-style='rail']` 这一族的其他规则）：

```css
/* target — src/renderer/src/components/SideMenu.vue */
.menu-item:hover {
  background: var(--te-navigation-hover);
  color: var(--te-navigation-hover-text);
}
```

`.menu-item` 自己的 transition 里也删掉 transform 项：

```css
/* target — src/renderer/src/components/SideMenu.vue */
.menu-item {
  position: relative;
  display: flex;
  align-items: center;
  height: 40px;
  width: calc(100% - 8px);
  padding: 0 12px 0 16px;
  margin-left: 8px;
  border: 0;
  cursor: pointer;
  border-radius: var(--te-radius-global);
  gap: 14px;
  white-space: nowrap;
  color: var(--te-chrome-text, var(--te-navigation-text));
  background: transparent;
  font: inherit;
  text-align: left;
  transition:
    background var(--te-motion-hover) var(--te-ease-enter),
    color var(--te-motion-hover) var(--te-ease-enter);
}
```

设置页预览导航删掉 `rotate`，保留 `scale: 1.08`（它与 `:447-450` 的 `.preview-nav-item.active i { scale: 1.08; }` 是同一个值，hover 与 active 用同一个视觉量级是有意的状态指示，不是装饰）：

```css
/* target — src/renderer/src/components/settings-page/SettingsPage.css */
@media (hover: hover) and (pointer: fine) {
  html[data-te-motion='full'] .preview-nav-item:hover {
    translate: 2px 0;
  }

  html[data-te-motion='full'] .preview-nav-item:hover i {
    scale: 1.08;
  }
}
```

**保留的部分说明清楚**：hover 之后仍然有背景色变化（`--te-navigation-hover`）、文字与图标颜色变化（`--te-navigation-hover-text`）、以及 `base.css:392-399` 的全局 `translate: 0 -1px`。所以 hover 依然有明确反馈，只是不再旋转、不再放大、不再横向漂移。

### 第二部分目标

`src/renderer/src/assets/base.css:392` 补齐条件：

```css
/* target — src/renderer/src/assets/base.css */
@media (hover: hover) and (pointer: fine) {
  html[data-te-motion='full']
    :where(button, [role='button'], [role='switch'], [data-te-interactive]):not(:disabled):not(
      [aria-disabled='true']
    ):hover {
    translate: 0 var(--te-motion-hover-translate);
  }
}
```

六个卡片面文件里，每一处 hover 规则块含 `transform` / `translate` / `scale` / `rotate` 的，都包进 `@media (hover: hover) and (pointer: fine) { … }`。

`SettingsPage.css` 里已有的 6 处 `@media (hover: hover) {` 也补上 `and (pointer: fine)`。

## Repo conventions to follow

- 动效 token 全住在 `src/renderer/src/assets/base.css:26-40`：
  ```css
  --te-ease-enter: cubic-bezier(0.4, 0, 0.2, 1);
  --te-ease-soft: var(--te-ease-out-quint);
  --te-ease-spring: cubic-bezier(0.22, 1.14, 0.36, 1);
  --te-ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
  --te-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --te-motion-press: 90ms;
  --te-motion-hover: 160ms;
  --te-motion-panel: 280ms;
  --te-motion-page: 400ms;
  --te-motion-settle: 500ms;
  --te-motion-return: 220ms;
  --te-motion-press-scale: 0.96;
  --te-motion-hover-translate: -1px;
  ```
  **本方案不新增 token。**
- `@media (hover: hover)` + `html[data-te-motion='full']` 双重包裹的样板 —— `src/renderer/src/components/settings-page/SettingsPage.css:452-461`（就是本方案要改的那处，其 `@media` 与 `data-te-motion` 的组合写法是对的，照抄这个嵌套形状）。
- 「hover 只给颜色，不给位移」的样板 —— `src/renderer/src/components/SideMenu.vue:514-516`：
  ```css
  .side-menu-liquid .menu-item:hover {
    background: color-mix(in srgb, var(--te-lg-context-rim) 28%, transparent);
  }
  ```
  液态玻璃侧边栏的 hover 只改背景，一个位移都没有。这就是目标形态。
- 三档动效模式由 `html[data-te-motion='full'|'reduced'|'off']` 驱动，实现在 `src/shared/motion.ts` 与 `src/renderer/src/app/useMotionPreference.ts`。`reduced` 与 `off` 两档已经在 `base.css:412-441` 全局压制了 transition/animation 时长，**所以第二部分包 `@media` 时不需要额外加 `data-te-motion` 条件**——除非那处原本就有。
- 多属性 `transition` 排版：每项一行、两空格缩进、逗号结尾、末项分号。只剩一项时压成一行（`transition: color 0.2s;`）。prettier 会这样格式化。

## Steps

### 第一部分：删掉导航 hover 的旋转与缩放

1. 打开 `src/renderer/src/components/SideMenu.vue`，定位 `:375-378`：
   ```css
   .menu-item:hover .item-icon {
     transform: translateX(1px) scale(1.12) rotate(-4deg);
     color: var(--te-navigation-hover-text);
   }
   ```
   删掉 `transform` 那一整行，只留：
   ```css
   .menu-item:hover .item-icon {
     color: var(--te-navigation-hover-text);
   }
   ```

2. 同一文件定位 `:353-365` 的 `.item-icon` 规则，把
   ```css
     transition:
       color 0.2s,
       transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
   ```
   改成
   ```css
     transition: color 0.2s;
   ```
   注意这一步同时消掉了那条裸 `cubic-bezier(0.34, 1.56, 0.64, 1)`。规则里其他声明（`width` / `height` / `display` / `align-items` / `justify-content` / `flex-shrink` / `color` / `font-size`）全部保持原样。

3. 同一文件定位 `:317-321`：
   ```css
   .menu-item:hover {
     background: var(--te-navigation-hover);
     color: var(--te-navigation-hover-text);
     transform: translateX(3px);
   }
   ```
   删掉 `transform: translateX(3px);` 那一行，只留 `background` 与 `color` 两行。

4. 同一文件定位 `:306-309` 的 `.menu-item` transition（在 `:289` 起的规则末尾），把
   ```css
     transition:
       background var(--te-motion-hover) var(--te-ease-enter),
       color var(--te-motion-hover) var(--te-ease-enter),
       transform var(--te-motion-hover) var(--te-ease-enter);
   ```
   改成
   ```css
     transition:
       background var(--te-motion-hover) var(--te-ease-enter),
       color var(--te-motion-hover) var(--te-ease-enter);
   ```
   即删掉 `transform` 那一项，并把 `color …` 行末的逗号改成分号。

5. 打开 `src/renderer/src/components/settings-page/SettingsPage.css`，定位 `:452-461` 的 `@media (hover: hover)` 块。做两件事：
   - 把 `@media (hover: hover) {` 改成 `@media (hover: hover) and (pointer: fine) {`。
   - 在 `html[data-te-motion='full'] .preview-nav-item:hover i` 规则里删掉 `rotate: -5deg;` 那一行，保留 `scale: 1.08;`。
   结果：
   ```css
   @media (hover: hover) and (pointer: fine) {
     html[data-te-motion='full'] .preview-nav-item:hover {
       translate: 2px 0;
     }

     html[data-te-motion='full'] .preview-nav-item:hover i {
       scale: 1.08;
     }
   }
   ```

### 第二部分：补上指针类型门禁

6. 打开 `src/renderer/src/assets/base.css`，定位 `:392` 的 `@media (hover: hover) {`，改成 `@media (hover: hover) and (pointer: fine) {`。**这一行是本方案最重要的单点改动**——它管着全仓所有 `<button>` / `[role='button']` / `[role='switch']` / `[data-te-interactive]` 的 hover 位移。规则体（`html[data-te-motion='full'] :where(…):hover { translate: 0 var(--te-motion-hover-translate); }`）一个字不动。

7. 同一文件（`src/renderer/src/components/settings-page/SettingsPage.css`）把剩下 5 处 `@media (hover: hover) {` 也补成 `@media (hover: hover) and (pointer: fine) {`。位置：`:846`、`:1155`、`:1992`、`:2455`、`:3812`（`:452` 已在第 5 步处理）。只改 `@media` 行，块内内容不动。

8. 打开 `src/renderer/src/components/LocalDashboard.css`，把下列 17 处 hover 规则各自包进 `@media (hover: hover) and (pointer: fine) { … }`。每处的选择器与它含的 transform 声明（用来核对你找对了地方）：

   | 行号 | 选择器 | transform 声明 |
   | --- | --- | --- |
   | :229 | `.masthead-shuffle:hover` | `transform: translateY(-2px);` |
   | :253 | `.masthead-shuffle:hover .masthead-shuffle-icon` | （见文件，含 transform/scale/rotate） |
   | :282 | `.masthead-shuffle:hover .masthead-shuffle-arrow` | `transform: translate(2px, -2px);` |
   | :432 | `.empty-cta:hover` | `transform: translateY(-2px);` |
   | :658 | `.hero-progress-track:hover::before` | （见文件） |
   | :694 | `.transport-button:hover` | `transform: translateY(-2px);` |
   | :717 | `.transport-play:hover` | （见文件） |
   | :740 | `.hero-ghost-action:hover` | （见文件） |
   | :796 | `.feature-card:hover .hero-art-echo` | `transform: rotate(8deg) translate(13px, 8px);` |
   | :842 | `.figure:not(.is-static):hover` | （见文件） |
   | :876 | `.figure:not(.is-static):hover i` | `transform: translate(2px, -2px);` |
   | :904 | `.signal-card:hover` | `transform: translateY(-2px);` |
   | :1025 | `.signal-card:hover .signal-caret` | `transform: translateX(3px);` |
   | :1224 | `.block-more:hover` | `transform: translateX(2px);` |
   | :1274 | `.fresh-tile:hover .fresh-cover` | `transform: translateY(-4px);` |
   | :1279 | `.fresh-tile:hover .fresh-cover img` | `transform: scale(1.06);` |
   | :1318 | `.fresh-tile:hover .fresh-play` | `transform: translateY(0) scale(1);` |
   | :1407 | `.chart-row:hover` | （见文件） |
   | :1425 | `.chart-row:hover .chart-rank` | （见文件） |
   | :1429 | `.chart-row:hover .chart-rank.is-podium` | （见文件） |
   | :1532 | `.cal-nav-btn:hover:not(:disabled)` | （见文件） |
   | :1576 | `.cal-cell:not(.is-blank):hover` | `transform: scale(1.08);` |
   | :1704 | `.gallery-tile:hover .gallery-cover` | `transform: translateY(-4px);` |
   | :1709 | `.gallery-tile:hover .gallery-cover img` | `transform: scale(1.06);` |
   | :1748 | `.gallery-tile:hover .gallery-count` | `transform: translateY(0);` |
   | :1773 | `.gallery-tile:hover .gallery-play` | `transform: translateY(0) scale(1);` |
   | :1920 | `.dialog-icon-button:hover:not(:disabled)` | （见文件） |

   **判据（对本步骤及第 9-13 步一律适用）**：只把「规则块内出现 `transform:` / `translate:` / `scale:` / `rotate:`，且值不是 `none` 的 hover 规则」包起来。若某条 hover 规则只改颜色、背景、阴影、opacity，**不要动它**——包进 `@media` 会让触屏上连颜色反馈都没了，那是退化。若某条规则同时有位移和颜色，两种做法都可接受：（a）整条包进 `@media`，或（b）拆成两条，颜色留在外面、位移进 `@media`。**优先选 (a)**，因为它改动小、不易出错；只有当这条 hover 的颜色变化是唯一的状态指示（例如禁用态提示）时才用 (b)。

   相邻的多条 hover 规则可以共用一个 `@media` 块，不必一条一个。例如：
   ```css
   @media (hover: hover) and (pointer: fine) {
     .fresh-tile:hover .fresh-cover {
       transform: translateY(-4px);
     }

     .fresh-tile:hover .fresh-cover img {
       transform: scale(1.06);
     }
   }
   ```

9. 打开 `src/renderer/src/components/onboarding/OnboardingWizard.css`，按第 8 步同样的判据处理这 17 处：`:366` `.onb-dot.is-done:hover`（`transform: scale(1.45);`）、`:645` `.onb-card:hover::before`（`transform: translateX(120%);`）、`:649` `.onb-card:hover`（`transform: translateY(-6px) scale(1.015);`）、`:655` `.onb-card:hover .onb-card-icon`（`transform: scale(1.12) rotate(-3deg);`）、`:678` `.onb-cards.has-selection .onb-card:not(.is-selected):hover`（`transform: translateY(-4px) scale(1);`）、`:761` `.onb-theme-chip:hover`（`transform: translateY(-3px);`）、`:781` `.onb-theme-chip:hover i`（`transform: scale(1.15) rotate(-6deg);`）、`:849` `.onb-swatch:hover`（`transform: scale(1.16);`）、`:915` `.onb-bg-swatch:hover`（`transform: translateY(-3px);`）、`:1061` `.onb-device-row:hover`（`transform: translateX(3px);`）、`:1246` `.onb-feature.is-action:hover`（`transform: translateY(-2px);`）、`:1304` `.onb-folder-add:hover`（`transform: translateY(-2px);`）、`:1384` `.onb-toggle-row:hover`（`transform: translateX(3px);`）、`:1621` `.onb-feature:hover`（`transform: translateY(-3px);`）、`:1773` `.onb-btn-primary:hover:not(:disabled)::before`（`transform: translateX(130%);`）、`:1777` `.onb-btn-primary:hover:not(:disabled)`（`transform: translateY(-2px);`）、`:1800` `.onb-btn-primary:hover:not(:disabled) i`（`transform: translateX(3px);`）。

   **注意 `:1134` 的 `.onb-card:disabled:hover`**：先读一眼它的内容，若它是用来**复位**位移的（`transform: none` 之类），**不要包**——包进 `@media` 会让触屏上的禁用卡片反而带上位移。

10. 打开 `src/renderer/src/components/StreamingHome.vue`（改 `<style>` 段），按同样判据处理这 14 处：`:655` `.hero-play:hover`、`:696` `.hero-open:hover i`、`:800` `.hero-stage:hover .hero-collage-card-0`、`:881` `.duo-card:hover`、`:935` `.duo-card:hover .duo-stack-cover-0`、`:939` `.duo-card:hover .duo-stack-cover-1`、`:943` `.duo-card:hover .duo-stack-cover-2`、`:1008` `.duo-card:hover .duo-arrow`、`:1063` `.section-more:hover`、`:1276` `.shelf-tile:hover .shelf-cover`、`:1282` `.shelf-tile:hover .shelf-cover :deep(img)`、`:1332` `.shelf-tile:hover .shelf-count`、`:1358` `.shelf-tile:hover .shelf-open`、`:1526` `.invite-cta:hover`。

    `:935` / `:939` / `:943` 三条是同一个 hover 触发的三张叠放封面，务必包进**同一个** `@media` 块，别拆开。

11. 打开 `src/renderer/src/components/StreamingDiscovery.vue`，处理这 11 处：`:535` `.disc-hq:hover`、`:576` `.disc-chip:hover`、`:762` `.disc-ink-btn:hover`、`:872` `.disc-feature:hover`、`:895` `.disc-feature:hover .disc-feature-img`、`:1012` `.disc-feature:hover .disc-feature-go`、`:1052` `.disc-card:hover .disc-card-media`、`:1064` `.disc-card:hover .disc-card-img`、`:1123` `.disc-card:hover .disc-card-go`、`:1230` `.disc-pager-btn:hover:not(:disabled)`、`:1277` `.disc-more-btn:hover:not(:disabled)`。

    其中 4 条用的是 `transform: translateY(var(--te-motion-hover-translate));`（`:535`、`:576`、`:762`、`:1230`、`:1277`）——它们在**重复** `base.css:392-399` 已经用 `translate` 属性做过的事。包进 `@media` 即可，**不要**顺手删掉它们（那属于另一类去重整理，不在本方案范围）。

12. 打开 `src/renderer/src/components/StreamingLibrary.vue`，处理这 9 处：`:408` `.glass-card:hover`、`:700` `.btn-play:hover`、`:716` `.favorites-card:hover .favorites-cover`、`:832` `.feature-card:hover .enter-btn`、`:868` `.create-playlist-btn:hover`、`:962` `.playlist-item:hover`、`:985` `.playlist-item:hover .playlist-item-cover`、`:1018` `.playlist-item:hover .playlist-item-arrow`、`:1048` `.playlist-pin-button:hover`。

13. 打开 `src/renderer/src/components/streaming-page/StreamingPage.css`，处理这 9 处：`:91` `.btn-back:hover`、`:253` `.track-row:hover`、`:540` `.streaming-round-btn:hover, .streaming-avatar-btn:hover`、`:955` `.stream-action-btn:hover:not(:disabled)`、`:1011` `.artist-detail-tab:hover`、`:1071` `.playlist-grid-card:hover`、`:1147` `.btn-like:hover`、`:1532` `.playlist-grid-card:hover`、`:2126` `.btn-back:hover`。

    注意 `:1071` 与 `:1532` 是两条同名选择器 `.playlist-grid-card:hover`（分属文件里不同的区段），两处都要包。`:91` 与 `:2126` 的 `.btn-back:hover` 同理。

## Boundaries

- **不要动 `src/renderer/src/components/SideMenu.vue:429-431` 的 rail 覆盖**：
  ```css
  :global(html[data-te-navigation-style='rail'] .menu-item:hover) {
    transform: none;
  }
  ```
  第 3 步删掉了 `.menu-item:hover` 的 `transform` 之后，这条覆盖在逻辑上变成冗余，但它无害，且它属于 `html[data-te-navigation-style='rail']` 这一族规则（`:412`、`:422`、`:433`、`:437`），动它会牵连导航样式切换。**留着。**
- **不要动 `src/renderer/src/components/SideMenu.vue:342-351`**：
  ```css
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
  这个导航指示条的入场 keyframes 属于 **010 号方案**的同族清单（那里作为「一并点名、判断是否单独跟进」的一项）。本方案不碰它，免得两个方案在同一文件同一区段冲突。
- **不要动 `src/renderer/src/components/SideMenu.vue:204-212` 的抽屉滑入过渡**：
  ```css
    transform: translate3d(-100%, 0, 0);
    transform-origin: left center;
    will-change: transform;
    transition:
      transform 0.32s var(--te-ease-soft),
      box-shadow 0.32s;
  ```
  **`src/renderer/src/components/SideMenu.test.ts:10` 用正则 `/transform 0\.32s var\(--te-ease-soft\),\s*box-shadow 0\.32s;/` 钉死了这条声明的字面量。** 这是抽屉本体的滑入，不是 `.menu-item`，本方案的四处编辑都不在这条规则内——但务必确认你改的是 `.menu-item` / `.item-icon` 的 transition，不是这一条。
- **不要动 `src/renderer/src/components/SideMenu.vue:510-549` 的 `.side-menu-liquid` 一族**。那里的 hover 已经只改背景（`:514-516`），`:542-545` 的 `:active { transform: scale(0.97); transition-duration: 90ms; }` 是按压反馈，与 **002 号方案**的目标形态一致。
- **不要碰 `src/renderer/src/assets/base.css:385-390` 的 `:active` 按压反馈**：
  ```css
  html[data-te-motion='full']
    :where(button, [role='button'], [role='switch'], [data-te-interactive]):not(:disabled):not(
      [aria-disabled='true']
    ):active {
    animation: te-interactive-press var(--te-motion-press) var(--te-ease-soft);
  }
  ```
  **这条规则正在被 002 号方案重写**（改成 `:active` + `transform: scale(0.97)` + `transition: transform 160ms ease-out`）。本方案第 6 步只改它下面那个 `@media` 行（`:392`），两个方案在同一文件的相邻区段落地——**若 002 已先落地，`:385-390` 的形状会不一样，那是正常的，照旧只改 `:392` 的 `@media` 行即可**。若 `:392` 的 `@media (hover: hover)` 已经变成 `and (pointer: fine)`（说明 002 顺手改了），跳过第 6 步并在报告里说明。
- **不要动 `src/renderer/src/assets/base.css:367-370` 的 `transition: translate var(--te-motion-hover) var(--te-ease-soft);`**。`src/renderer/src/app/useMotionPreference.test.ts:61` 用正则 `/transition: translate var\(--te-motion-hover\)/` 钉住了它。
- **不要动 `src/renderer/src/assets/base.css:412-441` 的 reduced / off 两档全局压制规则**。`useMotionPreference.test.ts:64` 钉住 `/html\[data-te-motion='off'\]/`。
- **不要改任何 `.vue` 文件的模板（`<template>`）部分。** 本方案是纯 CSS 改动。第 10-12 步动的是 `.vue` 文件的 `<style>` 段。**特别注意不要删掉任何 `data-te-interactive` 标记**——`src/renderer/src/app/useMotionPreference.test.ts:74-99` 有一条全量 `.vue` 扫描，用正则 `/<(?<tag>[a-z][\w-]*)\b(?<attributes>[^>]*\s@click(?:[.=]|\s)[^>]*)>/gs` 找出所有带 `@click` 的非原生标签，要求它们带 `data-te-interactive`（或 `role="button"` / `role="switch"` / `@click.self` / 白名单里的 `@click.stop` 类名）。删掉标记会让这条测试变红。
- **不要给不含位移的 hover 规则包 `@media`。** 只改颜色/背景/阴影/opacity 的 hover 包进去会让触屏用户失去全部反馈，那是退化不是改进。
- **不要顺手删掉 `StreamingDiscovery.vue` 里那 5 处 `transform: translateY(var(--te-motion-hover-translate));`**，也不要顺手把裸 cubic-bezier 换成 token（那是 004 号方案的事），也不要顺手调任何位移的数值大小。第二部分**只加 `@media` 包裹**，不改任何声明的值。
- **不要引入对 `--te-neutral-800` / `--te-primary-600` 的引用。** 这两个 token 在任何主题下都没有定义。
- 不要新增依赖，不要改 `package.json`，不要改任何测试文件。
- **若某一步找不到匹配的代码（行号漂移、声明已被改过、选择器对不上），停下来报告，不要自行发挥。** 尤其不要在相似的别的规则上凑一个改动交差。第二部分处数多，若某个文件的实际处数与上表不符（比如只找到 15 处而表里写 17 处），把差异记下来继续做能确认的部分，并在报告里列出对不上的行号——不要为了凑数去包不含位移的规则。

## Verification

- **Mechanical**：
  - `pnpm run lint` —— 应当通过。若 prettier 对新增的 `@media` 缩进有意见，按它的意见调整。
  - `pnpm run typecheck` —— 纯 CSS/样式改动，不应有类型错误。
  - `pnpm run test:playback-routing` —— 这一档包含 `src/renderer/src/components/SideMenu.test.ts`。该测试钉住的是**抽屉本体**的 `transform 0.32s var(--te-ease-soft), box-shadow 0.32s;`（`SideMenu.vue:210-212`）、`App.vue` 的几条声明、以及 `PlayerBar.css` 的 `transition: left 0.32s var(--te-ease-soft);`——**本方案的四处 SideMenu 编辑都不在这些规则内，所以它不应该变红**。若它红了，说明第 2 步或第 4 步改错了 transition 声明，立刻回滚并报告。
  - `pnpm run test:app` —— 这一档包含 `src/renderer/src/app/useMotionPreference.test.ts` 与 `src/renderer/src/components/onboarding/OnboardingWizard.test.ts` 与 `src/renderer/src/components/LocalDashboard.test.ts`。前者的全量 `.vue` 点击目标扫描是本方案最容易撞的门禁（若误删了 `data-te-interactive`）；后两者要确认第 8/9 步的 CSS 改动没破坏组件结构假设。
  - `pnpm run test:themes` —— 这一档包含 `src/renderer/src/components/themeColorAudit.test.ts` 与 `themeTokenization.test.ts`。第二部分改了 6 个组件文件的样式，跑一遍确认没引入新的裸色值（本方案不该引入任何颜色，但包 `@media` 时手抖复制错内容是可能的）。
  - `pnpm run build` —— 应当构建成功。新增的 `@media` 包裹会让 CSS 略微变大（每个块约 40 字节 × 约 78 处 ≈ 3KB），远不触及 `scripts/verify-renderer-budgets.cjs` 的 cssChunk 400KB 上限。
  - **注意：HEAD 上本来就有 3 条测试是红的。** 跑套件前先在未改动的工作树上把上述每一档各跑一次记下基线，只对比新增的失败。
  - 本方案**不新增测试**，所以不需要动 `package.json` 的 `test:*` 脚本。
- **Feel check**（真实渲染，不许用简化替身当证据）：先 `npx electron-vite build` 让 `out/` 带上改动，再用隔离 profile 启动 + CDP：
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`。
  - **优先复制改造 `output/` 下已有的 harness（gitignored）**：`verify-scroll-top.cjs` 最贴近本方案——它已经会点侧边栏项，取法是
    ```js
    [...document.querySelectorAll('.menu-item')].find(i => i.textContent.includes('所有歌曲'))
    ```
    正好是本方案要检查的元素。`verify-global-font.cjs` 的做法（**读计算样式而非截图**）也适合本方案，见下。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
  - 要确认的观察点：
    - **鼠标划过侧边栏各导航项，图标不再旋转、不再放大。** 用 CDP 派发 `Input.dispatchMouseEvent`（`type: 'mouseMoved'`）把指针移到某个 `.menu-item` 的中心，然后读计算样式：
      ```js
      (() => {
        const icon = document.querySelector('.menu-item:hover .item-icon')
        return icon ? getComputedStyle(icon).transform : 'no hovered icon'
      })()
      ```
      期望 `none`（或 `matrix(1, 0, 0, 1, 0, 0)`）。改前会是含旋转分量的 matrix。
    - **hover 仍然有明确反馈。** 同一状态下读 `.menu-item` 的 `background-color` 与 `color`，确认它们与非 hover 态不同（背景应当是 `--te-navigation-hover` 解析出的颜色）。**这一条是防退化检查**——如果 hover 变得毫无反馈，说明第 1/3 步删多了。
    - **整行不再横向漂移。** 读 hover 中的 `.menu-item` 的 `transform`，期望 `none`；同时 `translate` 应当仍是 `0px -1px`（来自 `base.css:392-399` 的全局规则，这一层保留）。
    - 在 DevTools Animations 面板把播放速度设为 10%，鼠标缓慢划过 5 个导航项，确认动画列表里**只有颜色/背景的过渡**，没有任何 transform 条目。
    - 切换导航样式到 `rail` 与 `compact`（设置里的导航样式项，对应 `html[data-te-navigation-style='rail'|'compact']`），确认三种样式下 hover 表现一致：只有颜色变化。改前 rail 模式是「行不动但图标转」的不一致状态。
    - 设置页预览导航（`.preview-nav-item`）hover，确认图标仍然放大到 `scale: 1.08` 但**不再倾斜**。
    - 切到 `html[data-te-motion='reduced']` 与 `'off'` 两档（三档由 `src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts` 驱动），确认导航 hover 的颜色反馈仍在。AUDIT 第 6 节：reduced motion 意味着「fewer and gentler animations, **not zero**」。
  - **第二部分的触屏门禁验证**（这一段是本方案后半段的核心证据）：
    - 在 DevTools 里打开设备模拟（Device Toolbar），选一个触屏设备预设，或用 CDP 的 `Emulation.setEmulatedMedia` 直接覆写媒体特性：
      ```
      Emulation.setEmulatedMedia({ features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] })
      ```
    - 在这个模拟态下移到某张卡片上（例如 `LocalDashboard` 的 `.signal-card`、`StreamingHome` 的 `.shelf-tile`），读计算样式确认 `transform` 是 `none`——即位移规则**没有生效**。
    - 再用 `Emulation.setEmulatedMedia({ features: [{ name: 'hover', value: 'hover' }, { name: 'pointer', value: 'fine' }] })` 切回鼠标态，确认位移**恢复生效**。这两次读数一起构成「门禁真的接上了」的证据。
    - 用 `Emulation.setEmulatedMedia({ features: [] })` 清除覆写，避免影响后续检查。
    - **真实二合一设备上的补充核对（若手边有）**：用手指点一张卡片然后抬起，卡片不应带着位移停在抬起后的状态。这是 AUDIT 第 6 节「touch fires false hovers on tap」的直接现象。
- **Done when**：
  - `grep -n "rotate(-4deg)" src/renderer/src/components/SideMenu.vue` 无命中。
  - `grep -n "scale(1.12)" src/renderer/src/components/SideMenu.vue` 无命中。
  - `grep -n "translateX(3px)" src/renderer/src/components/SideMenu.vue` 无命中。
  - `grep -n "cubic-bezier(0.34, 1.56, 0.64, 1)" src/renderer/src/components/SideMenu.vue` 无命中。
  - `grep -n "rotate: -5deg" src/renderer/src/components/settings-page/SettingsPage.css` 无命中。
  - `grep -c "scale: 1.08" src/renderer/src/components/settings-page/SettingsPage.css` 的计数与改动前一致（`.preview-nav-item.active i` 与 hover 两处都还在）。
  - `grep -rn "@media (hover: hover) {" src/renderer/src` 无命中——**所有** `@media (hover: hover)` 都带上了 `and (pointer: fine)`。
  - `grep -c "@media (hover: hover) and (pointer: fine)" src/renderer/src/assets/base.css` 至少为 1。
  - 六个卡片面文件里每个都至少新增了一个 `@media (hover: hover) and (pointer: fine)` 块：
    ```
    grep -c "hover: hover) and (pointer: fine" src/renderer/src/components/LocalDashboard.css
    grep -c "hover: hover) and (pointer: fine" src/renderer/src/components/onboarding/OnboardingWizard.css
    grep -c "hover: hover) and (pointer: fine" src/renderer/src/components/StreamingHome.vue
    grep -c "hover: hover) and (pointer: fine" src/renderer/src/components/StreamingDiscovery.vue
    grep -c "hover: hover) and (pointer: fine" src/renderer/src/components/StreamingLibrary.vue
    grep -c "hover: hover) and (pointer: fine" src/renderer/src/components/streaming-page/StreamingPage.css
    ```
    每条都应 ≥ 1。
  - `pnpm run lint`、`pnpm run typecheck`、`pnpm run build` 通过；`test:app`、`test:playback-routing`、`test:themes` 的失败数不超过 HEAD 基线的 3 条。
  - 侧边栏 hover 在 full / reduced / off 三档、standard / rail / compact 三种导航样式下都只有颜色变化，且颜色反馈始终存在。
  - 模拟 `pointer: coarse` 时六个卡片面的 hover 位移全部不生效；切回 `pointer: fine` 后恢复。
