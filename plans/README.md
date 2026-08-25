# 动效优化方案集

对 Twilight Echo 渲染层全部动效做了一轮审查（AUDIT.md 八类，6 个并行只读代理），产出 20 个自包含方案。每个方案假定执行者**没有本次会话的任何上下文、也不需要自己的品味判断**：文件路径、当前代码、目标值、验证步骤都写在方案里。

- **审查基线 commit**：`8e34e01`（所有方案的 `Commit` 戳与行号均以此为准）
- **来源**：`improve-animations` skill，`deep` 档
- **约束**：方案只描述改动，不含任何已执行的源码改动。本目录之外未改一行代码。

## 三条贯穿全局的更正

审查过程中推翻了三条初期判断，写进这里以免执行者重复踩：

1. **`App.vue:1248` 的 `scale(0.12)` 不是问题。** 它配了由封面实际坐标算出的 `transformOrigin`（`App.vue:710`），是从封面缩略图长出的 matched-geometry 放大，不是「从无到有」。全仓 `scale(0)` 实际 0 处。
2. **`EqualizerPage.vue:1340` 的 `--te-ease-soft` 覆盖不生效。** 整个 `:root` 块写在 `<style scoped>` 里，编译成永不匹配的 `[data-v-x]:root`（已用仓库自带 `@vue/compiler-sfc` 3.5.33 实测）。所以全局 out-quint 在 EQ 页安然无恙，真正的损失是 `--transition` 悬空——见 017。
3. **生效的 `transition: all` 是 45 处，不是 48 处。** `EqualizerPage.vue` 的 `:1382`/`:1404`/`:1611` 引用的是悬空变量，当前**完全没有过渡**（`var()` 未定义使整条声明 invalid，回落 `all 0s`），属「动效意图丢失」而非「过渡了不该过渡的属性」，归 017。

## 方案总表

| # | 方案 | 严重度 | 类别 | 体量 | 状态 |
|---|---|---|---|---|---|
| 001 | [统一 `--te-ease-soft` 的权威定义源](001-unify-motion-soft-token-authority.md) | HIGH | token | 3 文件 / 8 处单行 | TODO |
| 002 | [修复全局按压反馈：消除缩放相乘、按住保持压下、可打断](002-fix-global-press-feedback.md) | HIGH | 物理性 + 可打断 | 6 文件 / ~40 行 | TODO |
| 003 | [reduced 档改按属性精确降级，保住反馈](003-reduced-motion-preserve-feedback.md) | HIGH | 无障碍 | 3 文件 / ~60 行 | TODO |
| 004 | [30 处手写 cubic-bezier 归并到 token，收敛四档回弹](004-consolidate-bare-easing-curves.md) | MEDIUM | token | 13 文件 / ~35 处 | TODO |
| 005 | [`transition: all` 换成显式属性清单](005-replace-transition-all.md) | HIGH | 性能 | 12 文件 / 45 选择器 | DONE |
| 006 | [液态玻璃过渡里删掉 filter / backdrop-filter](006-remove-filter-from-liquid-glass-transition.md) | HIGH | 性能 | 1 文件 / 1 声明 | DONE |
| 007 | [进度条与电平表改 transform 驱动](007-progress-bars-use-transform.md) | HIGH | 性能 | 7 文件 | DONE |
| 008 | [侧边栏让位改 transform，去掉 320ms 全树重排](008-sidebar-clearance-use-transform.md) | HIGH | 性能 | 5 文件（含 JS） | DONE |
| 009 | [删掉搜索类输入框的逐字符入场动效](009-remove-per-character-input-animation.md) | HIGH | 频次 | 5 文件 | TODO |
| 010 | [删掉播放确认脉冲与切歌入场 keyframes](010-remove-playback-confirm-keyframes.md) | HIGH | 频次 + 可打断 | 2 文件 / 纯删除 | TODO |
| 011 | [删掉导航悬停旋转缩放，补指针类型门禁](011-reduce-nav-hover-motion.md) | HIGH | 频次 + 无障碍 | 8 文件 / ~82 处 | TODO |
| 012 | [删掉歌单行死指针追踪 rAF 与常驻流动描边](012-remove-dead-pointer-tracking-raf.md) | MEDIUM | 性能 + 频次 | 4 文件 / 纯删除 | TODO |
| 013 | [修掉吐司退场的 `ease-in`](013-fix-toast-leave-easing.md) | HIGH | 缓动 | 1 文件 / 1 值 | TODO |
| 014 | [播放页背景封面过渡减重](014-lighten-backdrop-cover-transition.md) | HIGH | 性能 | 1 文件 / 4 规则 | DONE |
| 015 | [三档动效偏好接入 CSS 降级通路（含 `:global()` 编译陷阱修正）](015-wire-motion-tiers-into-css-downgrades.md) | HIGH | 无障碍 | 16 文件 / ~17 处 | TODO |
| 016 | [桌面歌词与可视化 iframe 接入动效偏好](016-wire-motion-tiers-into-satellite-windows.md) | MEDIUM | 无障碍 | 5 文件（含主进程 + preload） | TODO |
| 017 | [删掉 EqualizerPage 死 `:root` 块，8 处过渡改显式清单](017-fix-equalizer-dead-root-block.md) | HIGH | token | 2 文件 / 9 处 | TODO |
| 018 | [设置页开关与折叠面板改可打断 transition](018-settings-toggle-accordion-transitions.md) | MEDIUM | 可打断 | 2 文件 / ~7 处 | TODO |
| 019 | [右键菜单与音量抽屉从触发点长出来](019-anchor-popover-transform-origin.md) | MEDIUM | 物理性 | 5 文件 / ~60 行 | TODO |
| 020 | [为动效体系建立门禁，预设主题补动效条款](020-add-motion-audit-gate.md) | MEDIUM | token / 门禁 | 4 文件 / ~300 行 | TODO |

## 推荐执行顺序

分五批。**批内可并行，批间必须串行**。

### 第 1 批 — 先修「动效意图静默丢失」的三条

这三条不是「动效调得不好」，而是看代码完全看不出来的失效：一个 token 的运行时值不等于声明值、8 个控件的过渡悬空、一套 rAF 在驱动看不见的东西。它们也是后续方案的地基。

| 顺序 | 方案 | 为什么排在最前 |
|---|---|---|
| 1 | **001** | `--te-ease-soft` 的运行时值目前是 `cubic-bezier(0.2, 0.8, 0.2, 1)` 而非 base.css 声明的 out-quint。**在这条修完之前做 004 的 token 替换，等于把 30 处代码指向一个值不对的 token。** |
| 2 | **017** / **012** | 二者互不相干，可并行。017 修 EQ 页悬空过渡（并把 005 划过来的 3 处一并处理），012 是纯删除。 |

### 第 2 批 — 高频交互面（用户每天感知最多的）

| 方案 | 说明 |
|---|---|
| **002** | 全局按压。改完 `--te-motion-press-scale` 后，15 处已正确复用该 token 的组件自动收敛。 |
| **010** | 依赖 002 先落：删掉播放确认脉冲后，按压反馈成为该按钮唯一的动效，需要 002 已经把它改对。 |
| **009** | 独立，无依赖。 |
| **013** | 独立，1 行改动，随时可做。 |

### 第 3 批 — 性能（各自独立，可全部并行）

**005**、**006**、**007**、**014** 四条互不重叠，可同时派给四个节点。

**008 必须单独做**，且要在 005 之后：它改 `App.vue` 与 `PlayerBar.css` 的结构，还要动 `SideMenu.test.ts:12`/`:23` 钉住的布局过渡断言；实施面比表面看起来大——6 套预设布局都覆写了 `padding-left`/`left` 的让位语义，改 `translateX` 必须把这些位移量一起搬进变量层，否则预设的气隙会丢。

### 第 4 批 — 无障碍与其余打磨

| 方案 | 说明 |
|---|---|
| **003** | 依赖 002：003 的按属性白名单要保留按压反馈，而按压反馈的形态由 002 决定。 |
| **015** | 依赖 003：015 把 16 个文件的 `@media` 降级并上 `[data-te-motion]` 选择器，而 `reduced` 档的降级策略由 003 定义。**015 另含一项独立修复**：`PlayingLyricLine.vue:557/595` 与 `CompactPlayerBarVisualizer.vue:82/86` 现有的 4 条降级用了 `:global(祖先) .后代` 写法，Vue scoped 编译会丢掉后代部分、把声明落到 `<html>` 上——它们当前是死代码。这一项不依赖任何其他方案，可以单独先做。 |
| **016** | 依赖 015 的策略，但文件完全不重叠。注意两个目标形态不同：`resources/audio-visualizer/index.html` 是主窗口内的 **iframe**（`AudioVisualizerPanel.vue:380`），已有 postMessage 通道可用；`resources/desktop-lyrics.html` 才是真正的独立 `BrowserWindow`，需要照 `miniPlayer.ts:174-177` 加 IPC 通道。 |
| **011** / **018** / **019** | 三条互不相干，可并行。011 与 002 都碰 `base.css` 的 hover/press 规则族，建议 011 排在 002 之后。 |

### 第 5 批 — 最后上门禁

**020** 必须最后做，原因有两条：

- 它的**预算 3**（`themeTokens.ts` 的 `motion.*` 默认值与 `base.css` 逐字相等）直接依赖 001 已修完。方案交付时这条断言**故意是红的**——门禁先落地，001 让它变绿。执行 020 的节点**不得**为了让它变绿去改 `themeTokens.ts` 或 `base.css`。
- 预算 1 / 预算 2 的每文件配额是按基线实测登记的递减配额。前四批会大幅减少裸曲线与裸时长，配额应当在它们做完之后再定，否则数字立刻过时。

020 还要改 `SideMenu.test.ts:13-21`（把两条曲线字面量断言改成断言 token 名），并同步把 `App.vue:1163-1164`/`:1174-1175` 换成等值 token。

## 文件冲突矩阵

同一文件被多个方案碰到的地方。**同一格里的方案不要并行派给不同节点。**

| 文件 | 方案 | 冲突性质 |
|---|---|---|
| `src/renderer/src/components/SideMenu.test.ts` | **008**（`:12`/`:23` 布局过渡断言）、**020**（`:15`/`:20` 曲线字面量断言）、004（同 020 那两条） | **必须串行。** 三者改同一文件的不同断言行。建议 008 → 004 → 020。 |
| `src/renderer/src/assets/base.css` | 001、002、003、004、006、011 | 区域不同（token 定义 / press 规则 / reduced 兜底 / 曲线引用 / 玻璃层 / hover 门禁），但同文件并行编辑易冲突。按批次顺序串行即可自然错开。 |
| `src/renderer/src/components/player-bar/PlayerBar.css` | 002（`:1271` 按压）、007（进度条）、008（`:2` 让位 `left`）、010（`:1299`/`:1309` 脉冲）、019（音量抽屉 origin） | 区域不重叠，但建议不同批次执行。 |
| `src/renderer/src/components/EqualizerPage.vue` | 005（`:1148`/`:1198`/`:1277`/`:1306` 四处 `all`）、017（`:1335-1342` 死块 + 8 处悬空引用） | 区域不重叠且已在两个方案的 Boundaries 里互相点名。可并行，但 017 优先。 |
| `src/renderer/src/mini-player/MiniPlayer.css` | 002（`:645` 按压）、003（reduced 分支）、010（`:648` 脉冲） | 区域不重叠。 |
| `src/renderer/src/App.vue` | 004（`:1163-1164`/`:1174-1175` 曲线）、008（`.main-content` 结构）、020（同 004 那两处） | **008 与 004/020 必须串行**——008 会改动 `.main-content` 规则块的结构。 |
| `src/shared/themeTokens.ts` | 001（改 `motion.soft` 默认值）、020（读它做断言） | 001 先行。 |

## 需要真机 feel-check 的方案

以下方案的正确性无法只靠读代码判定，方案内已写了具体观察点。验证流程见项目记忆里的「Real render capture recipe」（隔离 profile + CDP，`TE_THEME=pureWhite|dark` 各跑一次）：

- **002** — 按住不放时圆点是否真的**停在**压下态；中途反向点击是否从当前值接续。这是该方案的核心证据。
- **010** — 按压反馈与播放确认叠加后谁压过谁，取决于层叠与动画列表顺序，读代码断不了。
- **014** — 背景封面 blur 从 58px 降到 20px 后观感是否可接受（需用 `brightness` 补偿）。
- **018** — `left` → `translate` 后旋钮两个尺寸变体的落点是否与改前**像素级一致**（`.large` 行程 22px、标准 20px，端点不同）。
- **003** — reduced 档下按钮是否还有可感知的确认（否则用户会以为点击没生效）。
- **008** — 侧边栏滑动期间 `useSideMenuClearance.ts:60-72` 依赖的两个几何不变量不能破。

## 未写成方案的 LOW 项

审查确认但判为打磨级、未单独立方案的 11 条：对话框缺初始 transform（3 处）、stagger 步长 7 种规格、39 处 `leave-active` 缺 `pointer-events: none`、托盘窗口漏接动效偏好、插件页与主题工作台网格零入场、迷你歌词 `out-in` 密集段排队、`.track-row` transition 里的死声明、`neon-gradient` 播放键无限呼吸抢占反馈槽位、预设表写死时长绕过 token。需要时可按同样格式补写。

## 缺失的动效（additive，非纠错）

- `App.vue:840-841` 电台页与网络源页整块瞬移，而同层每个兄弟都包了 `<Transition>`
- `SongList.vue:2018` 勾选歌曲时工具条凭空出现 + 封面列 40→64px、表头 88px 跳宽，全表横向错位一次
- `SideMenu.vue:178` 扫描完成没有收束，等几分钟后进度文字裸消失（对比登录成功有 `.success-burst`）
- `PluginPage.vue` 与主题工作台网格零入场，而同类六个网格都有 stagger
