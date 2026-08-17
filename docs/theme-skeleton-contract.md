# Cross-Theme Skeleton Contract（跨主题骨架契约）

> Status: 阶段 D（主题稳定性）落地文档 · 2026-08-18
> Scope: 固定跨主题不变的应用壳与导航骨架；主题只改变色彩、字体、材质、圆角、阴影与背景氛围。
> 对应审计 P0.2「主题视觉差异过大」与第 9 节「主题」验收清单。

## 为什么需要这份契约

每个内置预设都拥有一份 `src/renderer/src/assets/theme-layouts/*.css` 全局样式表，会把五个核心表面
（应用壳、首页、流媒体首页、播放页、播放栏）重构成各自的产品气质。这是特性而非缺陷——但切换主题后
用户必须零学习成本地找到同一操作。因此骨架（导航结构、播放栏结构、页面内容顺序、主要操作位置、
active/hover/selected 语义）是跨主题常量的，主题只允许改动装饰层。

## 固定的骨架构件

### 1. 应用壳（App.vue 内 `custom` grid）

- `html[data-te-shell-layout='custom'] .app-shell` 使用固定四区网格：`titleBar` / `navigation` /
  `content` / `playerBar`（`App.vue:941-1044`）。
- 标题栏高度 32px、导航宽度由 `--te-menu-width` 统一（`SideMenu.vue`）。
- 主题样式不得改变 `grid-template-areas`、四区顺序或导航/播放栏的存在与否。

### 2. 导航条目（`SideMenu.vue .menu-item`）

每个导航条目必须同时携带 **图标 + 标签**，二者皆不可 `display: none`：

- 图标是条目识别的第一信号（对应 P1.2 统一图标族精神）。
- 标签是文字识别与可达性兜底（辅助技术读到的也是 `item-label`）。
- 编号/序号可以作为装饰（如 paper-light），但不得替换图标或标签。

主动画 `hover`、`active`、`selected` 语义统一为：

- `hover`：悬浮时给出表面变化（背景/描边/位移之一）。
- `active`（当前页）：必须同时有「背景或描边」+「指示器」（`::before` 形状可随主题不同，
  但必须存在）。
- 不得用「仅文字颜色/字重变化」作为唯一选中态（在纯文字主题下这会让选中不可辨）。

### 3. 播放栏（`PlayerBar.vue .player-bar`）

- 三列 grid 是常量：左列（封面 + 标题/艺术家）、中列（传输控制）、右列（进度/音量/工具）。
- 主题可改变高度、圆角、材质、边框，但不得移除这三个区块或改变它们的次序。
- 当前播放封面与播放/暂停动作必须始终可见（对应 P0.2 验收「当前播放始终比 DSP 诊断更容易识别」）。

### 4. 首页（`LocalDashboard.vue`）

- 首页是最小同构路径：masthead → 当前播放 Hero → 图鉴 → 播放链路 → 最近添加 → 聆听足迹 → 专辑精选。
- 主题可以折叠 DSP 细节（zen 隐藏路径条）、改变卡片材质，但不得删除「当前播放 Hero」这个首屏主焦点，
  也不得把 DSP 状态提升到与 Hero 相同的视觉权重。

## 允许改动的装饰层

- 色彩、字体组合、材质（glass/paper/flat）、圆角与阴影强度、背景氛围、装饰性动画。
- 首页 DSP 折叠、播放页布局、迷你播放器形态、导航 rail 等渐进式呈现。
- 具体 token 值（`themePresets.ts` 的 `overrides`）。

## 禁止改动

- 出现 `.item-icon { display: none }` 或 `.item-label { display: none }`。
- 移除 `menu-item` 的 hover/active 表面或指示器。
- 改变 `.player-bar` 三列次序或移除任一列。
- 在跨主题作用域外写硬编码颜色（由 `themeColorAudit.test.ts` 兜底）。
- 修改 URL、导航 key、表单字段名与现有分析事件（审计第 7 节）。

## 回归守护

`src/renderer/src/components/themeSkeletonContract.test.ts` 静态断言：

1. 六份内置 layout 样式各含 `.menu-item` 的 hover 与 active 规则。
2. 六份样式均不含 `display: none` 的 `.item-icon` / `.item-label`。
3. 六份样式均声明 `.player-bar` 的 `grid-template-columns`（三列存在）。