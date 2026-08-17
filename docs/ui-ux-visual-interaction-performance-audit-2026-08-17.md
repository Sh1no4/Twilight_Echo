# Twilight Echo UI/UX、视觉与性能改进交接

> 状态：切片一已提交、切片二已完成（工作区未提交）（2026-08-18）
>
> 评估日期：2026-08-17
>
> 目标：下一个 session 直接按本文进入设计收敛与实现，不重复进行大范围 UI 探索。

## 0. 实施进度（随切片更新）

> 切片一 + 切片二已完成并提交（2026-08-18，本地 main 领先 origin 1 个提交，docs 尚未提交）

- [x] 切片一（前两阶段合并落地）：首页首屏降噪 + DSP 折叠 + DSP 轮询降频 + 首页材质预算 + 圆角/字号/图标统一
  - 提交：本批次为首次落地，提交信息含 `perf(ui): home focus + dsp collapse + blur budget` 等
  - 变更文件：LocalDashboard.vue/.css、PlayerBar.vue、SideMenu.vue、TitleBar.vue、player-bar/PlayerBar.css
- [x] 切片二：无音乐单一 onboarding 空态统一（P0.1 第 4 条 + 阶段 A 第 3 步）
  - 落地内容：空态主 CTA 保持「添加音乐库文件夹」；移除三枚装饰性 chips（批量扫描/无损格式/聆听统计，原为 aria-hidden 纯装饰）；改为一行可用的辅助路径「也可以 从文件导入单曲」，复用侧栏 `ImportDialog` 打开单曲导入，形成「一个主路径 + 一个补充路径」
  - 变更文件（工作区未提交）：LocalDashboard.vue、LocalDashboard.css
  - 验证：vue-tsc web typecheck 通过；LocalDashboard.test.ts、scopedGlobalSelectors.test.ts 全绿；未改路由、导航 key、事件名与现有分析事件
  - 说明：ImportDialog 自带 fixed 全屏 overlay + scrim，custom-shell 双层滚动布局下锁 body 无效，故不再新增滚动锁（overlay 已拦截指针交互）
- [ ] 待后续：主题稳定性（阶段 D：固定跨主题骨架、三主题验证）
- [ ] 待后续：空/加载/错误状态结构统一（阶段 C.5）
- [ ] 待后续：首页 DSP 弹窗打开时的滚动锁定复核（配合 100vh→min-height 改动；结论见切片二说明，倾向保持现状不锁）

## 1. Design read

Twilight Echo 是一个面向重视音质、收藏管理和播放控制的 Electron 本地音乐播放器。当前视觉语言在唱片房间、玻璃材质、编辑型音乐界面和专业音频控制台之间切换。

核心判断：产品已经不缺视觉效果，当前最需要的是收敛品牌身份、减少首屏竞争、降低材质与动态效果成本，并让高级 DSP 能力采用渐进式呈现。

建议方向：

- 音乐播放器优先，DSP 作为高级能力
- 内容优先，专辑封面、当前播放、歌词和队列是视觉主角
- 玻璃只用于导航、浮层和播放控制，不用于大面积正文内容
- 主题允许改变气质，但不改变核心信息架构、导航位置和播放控制语义
- 动效只服务于播放状态、状态变化、操作反馈和可理解的空间转场

已有相关基线：

- `docs/apple-music-inspired-hifi-player-design-system.md`
- `docs/ui-playback-refactor-audit.md`
- `docs/audit-security-ui-ux-2026-08-01.md`

本文是当前 UI/UX 与性能交接文档，不替代已有的播放时钟、歌词和主题重构审计。

## 2. 当前基线与证据位置

### 技术栈

- Electron + Vue 3 + TypeScript + Vite
- Pinia 状态管理
- CSS token 和主题布局覆盖
- 图标来源混合使用 `@phosphor-icons/web`、PrimeIcons、内联 SVG、本地 SVG 和自定义图标
- 项目依赖见 `package.json:86-166`

### 应用壳层

- 页面组合和路由状态：`src/renderer/src/App.vue:729-858`
- 标题栏：`src/renderer/src/components/TitleBar.vue:54-143`
- 侧栏：`src/renderer/src/components/SideMenu.vue:79-180`
- 播放栏：`src/renderer/src/components/PlayerBar.vue`

### 首页

- 首页数据与状态：`src/renderer/src/components/LocalDashboard.vue:78-235`
- DSP 状态和线路表达：`src/renderer/src/components/LocalDashboard.vue:317-690`
- 首页视觉基础：`src/renderer/src/components/LocalDashboard.css:7-129`
- 首页响应式：`src/renderer/src/components/LocalDashboard.css:2319-2418`
- reduced motion：`src/renderer/src/components/LocalDashboard.css:2478-2487`

### 主题布局

- 主题入口：`src/renderer/src/assets/theme-layouts/index.css:1-7`
- Obsidian 控制台主题：`src/renderer/src/assets/theme-layouts/obsidian-glass.css:3-20`
- Paper 编辑主题：`src/renderer/src/assets/theme-layouts/paper-light.css:2-20`
- 主题 token：`src/shared/themeTokens.ts`

## 3. 必须先解决的 P0 问题

### P0.1 首页信息层级过载

现状：首页同时展示当前播放、最近播放、常听排行、专辑、日历、DSP 线路、采样率、位深、声道和输出状态。

问题：首页更像音乐数据仪表盘加 DSP 状态中心，核心播放路径被稀释。新用户打开后不能快速判断最主要动作。

执行要求：

1. 首屏只突出以下内容：
   - 当前播放或继续播放
   - 播放/暂停
   - 最近播放
   - 进入音乐库或导入音乐
2. 常听、专辑、统计放到第二层。
3. DSP 线路默认折叠，或移动到独立“音频状态”入口。
4. 首次安装且无音乐时，使用单一 onboarding 空状态，不要让多个区块各自显示空状态。
5. 首页必须能用一句话描述为“当前播放 + 快速继续听”，不能再是“音乐数据总览”。

验收：

- 首屏用户能在 3 秒内找到播放动作
- 无音乐时只看到一个主要导入/配置路径
- DSP 详细状态不与当前播放争夺最高视觉权重

### P0.2 主题视觉差异过大

现状：主题不只是颜色变化，还改变布局、圆角、编号、导航语法和内容密度。主题包含 aurora、obsidian-glass、paper-light、neon-gradient、studio-split、zen-minimal 等。

问题：切换主题后像换了一个产品，用户的导航记忆和操作预期不稳定。

执行要求：

1. 固定跨主题不变的骨架：
   - 导航结构
   - 播放栏结构
   - 页面内容顺序
   - 主要操作位置
   - active、hover、selected 的语义
2. 主题只改变：
   - 色彩
   - 字体组合
   - 材质
   - 圆角和阴影强度
   - 背景氛围
3. Paper 的编号可以作为装饰，但不能替换文本、图标或当前状态语义。
4. Obsidian 可以密集，但必须保留当前播放封面和播放动作的音乐锚点。

验收：

- 在至少三个主题之间切换，用户仍能无学习成本找到同一操作
- 主题切换不改变导航结构和页面主流程
- 当前播放始终比 DSP 诊断内容更容易被识别

### P0.3 材质与动态背景成本过高

证据：

- `src/renderer/src/components/LocalDashboard.css:79-84`：大面积 `blur(84px)` 和动态 blob
- `src/renderer/src/components/LocalDashboard.css:488-496`：封面背景模糊
- `src/renderer/src/components/LocalDashboard.css:1811-1812`：大面积 backdrop blur
- `src/renderer/src/components/StreamingPage.css:159-180`
- `src/renderer/src/components/StreamingPlaceholder.css:81-82`
- `src/renderer/src/components/mini-player/MiniPlayer.css:108-109,153-154`

执行要求：

1. 设定材质预算：同一视口最多 2 个 backdrop blur 层。
2. 大面积滚动正文不使用 backdrop blur。
3. 首页动态背景改为性能可选增强效果。
4. 增加三档材质能力：
   - 高质量：动态背景、必要 blur、完整材质
   - 平衡：静态背景、少量 blur
   - 性能优先：纯色 surface、关闭 backdrop-filter 和装饰动画
5. Linux、透明窗口、低性能设备默认走平衡或性能优先。
6. `will-change` 只保留在确实正在动画的元素上，避免长期保留过多合成层。

验收：

- 首页滚动时无明显掉帧
- 透明窗口、迷你播放器、流媒体页面同时存在时 GPU 压力可接受
- 性能优先模式完全关闭大面积 blur 和非必要无限动画

## 4. P1 视觉与交互改进

### P1.1 统一圆角语义

现状：项目同时出现 22px、16px、14px、12px、8px、6px、5px、4px、3px、2px、0、50% 和 999px。

执行建议：

- `surface`: 16px
- `control`: 10px
- `compact-control`: 6px
- `pill`: 999px
- `editorial`: 0px，仅用于明确的纸张主题

主题可以改变 token 值，但组件不应继续散落硬编码半径。

重点审查：

- `src/renderer/src/components/LocalDashboard.css`
- `src/renderer/src/components/theme-studio/ThemeStudioPage.css`
- `src/renderer/src/components/mini-player/MiniPlayer.css`
- `src/renderer/src/components/player-bar/PlayerBar.css`

### P1.2 统一图标族

现状：

- `ph ph-*`
- `pi pi-*`
- 内联 SVG
- 本地 SVG 图片
- 自定义 `PuzzleIcon`

重点位置：

- `src/renderer/src/components/TitleBar.vue:68-117`
- `src/renderer/src/components/SideMenu.vue:101-175`
- `src/renderer/src/components/PlayerBar.vue:30-38`

执行建议：

1. 主导航和播放控制统一采用 Phosphor 图标族。
2. 系统窗口控制可以保留内联 SVG。
3. PrimeIcons 仅在 Phosphor 没有合适图形时使用。
4. 统一图标尺寸、stroke weight、baseline 和 active 状态。
5. 不新增图标库，先整理现有依赖和封装方式。

### P1.3 提高关键元数据可读性

现状：存在 9px、10px、0.62rem、0.64rem、0.66rem，以及大量大写和宽字距。

重点位置：

- `src/renderer/src/assets/theme-layouts/obsidian-glass.css:122-128,190-207,313-331`
- `src/renderer/src/components/LocalDashboard.css:2224`
- `src/renderer/src/components/mini-player/MiniPlayerCustomizer.css:183-221`

执行建议：

- 交互性信息尽量不低于 12px
- 11px 只用于辅助元数据
- 9px / 10px 限制为非关键装饰标签
- 中文不使用英文式过度 tracking
- 关键状态不要同时使用小字号、大写和低对比度

### P1.4 DSP 信息渐进式呈现

现状：默认可见 ReplayGain、动态均衡器、卷积、R128、True Peak、TPDF、LR4、SRC 等术语。

执行建议：

默认节点只显示：

```text
均衡器
已启用
5 段参数正在运行
```

详细参数进入：

- 点击展开
- tooltip
- DSP 独立页面
- inspector 面板

必须区分：

- 当前实时运行
- 已配置但未应用
- 旁路
- 已关闭
- 编译失败
- 应用失败

### P1.5 导航分组

`src/renderer/src/components/SideMenu.vue:31-39,105-177` 当前混合了我的音乐、插件、流媒体、电台、网络源、导入和扫描状态。

建议分为：

- 我的音乐
- 在线内容
- 工具与来源

“导入歌曲”应作为独立全局动作，优先出现在首页空状态、音乐库操作区或侧栏底部，而不是完全等同于一个导航页面。

### P1.6 标题栏与侧栏可发现性

`src/renderer/src/components/TitleBar.vue:123-143` 的标题栏高度为 32px，左侧操作主要依赖图标。

建议：

- 保留平台窗口控制兼容性
- 增强左侧按钮 hover 和 focus 反馈
- 菜单打开时必须有清晰 active surface
- 设置、扩展、账号增加更明确 tooltip
- 检查 Windows 125% 和 150% DPI 下的点击区域、裁切和拖拽区域

## 5. P1 性能改进

### P1.1 避免首页固定 `100vh`

证据：

- `src/renderer/src/components/LocalDashboard.css:28`
- `src/renderer/src/components/LocalDashboard.css:51-54`

建议：

- 外层 app shell 负责窗口高度
- 首页使用 `min-height: 100%`
- 标题栏和播放栏由 shell 预留空间
- 内容区只负责自己的滚动

重点验证：

- 最小窗口尺寸
- Windows 125% / 150% DPI
- 标准和 mini 播放栏
- 透明窗口
- DSP 弹窗打开时的滚动锁定

### P1.2 降低 DSP 固定轮询

证据：`src/renderer/src/components/LocalDashboard.vue:47-61`

当前每秒刷新 DSP 图状态，每 5 秒刷新场景状态。

建议优先级：

1. 使用已有音频引擎事件推送
2. 仅在 DSP 面板展开或页面可见时更新
3. 页面失去焦点时暂停轮询
4. 必须轮询时使用退避策略
5. 实时 meter 与低频配置状态分开

配置状态不应每秒读取。

### P1.3 收敛持续动画

证据：

- `src/renderer/src/components/LocalDashboard.css:93-111,556,785,1008,1895,1931`
- `src/renderer/src/components/mini-player/MiniPlayer.css:230,281`

保留：

- 播放进度
- 真正实时的 DSP / buffer 状态
- 页面进入和状态变化
- 用户操作反馈

默认关闭或改为一次性动画：

- 首页背景 blob
- 非播放状态下的封面呼吸
- 非实时 EQ 装饰动画
- 长时间 pulse

已有 reduced motion 逻辑必须继续保留并覆盖新增动效。

## 6. 建议实施顺序

### 阶段 A：先收敛首页

1. 确认首页首屏信息层级
2. 将 DSP 默认细节折叠
3. 设计无音乐单一 onboarding 空状态
4. 让当前播放和最近播放成为主内容
5. 不改变现有路由和导航 key

### 阶段 B：材质和性能预算

1. 统计主要页面实际 blur、filter、动画数量
2. 建立材质等级 token
3. 关闭非必要无限动画
4. 调整首页 `100vh` 布局
5. 将 DSP 轮询改为事件优先、按需刷新

### 阶段 C：组件统一

1. 统一圆角语义
2. 统一图标族和尺寸
3. 统一按钮 hover、active、focus
4. 提高元数据字号
5. 统一空、加载、错误状态结构

### 阶段 D：主题稳定性

1. 固定跨主题的应用壳和播放栏骨架
2. 验证 obsidian、paper、zen 至少三个主题
3. 确认主题切换不改变操作位置
4. 保留每个主题的独特气质，但避免完整换产品

## 7. 不应做的事情

- 不要继续添加更多渐变、玻璃层或背景 blob 来“提升高级感”
- 不要把首页继续扩展成更大的数据仪表盘
- 不要默认给所有卡片增加 hover 位移和无限动画
- 不要重写 Electron、Vue 或 CSS 技术栈
- 不要修改 URL、导航 key、表单字段名和现有分析事件
- 不要把 DSP 专业术语全部隐藏，应该采用渐进式呈现
- 不要为了统一而删除主题特色
- 不要在未检查 `package.json` 的情况下新增第三方依赖
- 不要修改本文档中的评估结论，除非新 session 通过实际代码或视觉验证证明其已过时

## 8. 下一 session 的启动指令

下一 session 直接从以下顺序开始：

1. 阅读本文和 `docs/apple-music-inspired-hifi-player-design-system.md` 第 1、2、3、8、10 章。
2. 检查当前 git 状态，确认工作区是否仍然干净。
3. 先读取并梳理：
   - `src/renderer/src/components/LocalDashboard.vue`
   - `src/renderer/src/components/LocalDashboard.css`
   - `src/renderer/src/App.vue`
   - `src/renderer/src/components/PlayerBar.vue`
   - `src/renderer/src/components/SideMenu.vue`
   - `src/renderer/src/assets/theme-layouts/index.css`
4. 不要先改主题系统。先画出首页首屏的当前信息层级和目标信息层级。
5. 只选一个最小可验证切片开始，推荐：
   - 首页首屏降噪 + DSP 折叠
   - 或材质预算和动态背景降级
6. 每个切片完成后运行相关测试、typecheck，并做 light/dark、透明窗口和低 DPI 视觉验收。
7. 修改前后记录：首屏内容数量、blur 层数量、持续动画数量、交互路径和性能观察结果。

## 9. 验收清单

### 信息层级

- [ ] 首页首屏只有一个主视觉焦点
- [ ] 当前播放动作在 3 秒内可发现
- [ ] 无音乐时只有一个主要引导路径
- [ ] DSP 详细信息不压过音乐内容

### 主题

- [ ] 至少三个主题共享同一导航和播放骨架
- [ ] active、hover、selected 语义一致
- [ ] Paper 编号不会替换必要语义
- [ ] Obsidian 仍然像音乐播放器，而不是纯监控终端

### 性能

- [ ] 首屏 backdrop blur 不超过预算
- [ ] 大面积滚动区域没有高成本 blur
- [ ] 非必要无限动画已关闭或按需启用
- [ ] reduced motion 继续有效
- [ ] DSP 配置不是固定每秒轮询
- [ ] 透明窗口、Linux 和低性能模式有降级

### 可访问性与细节

- [ ] 关键元数据具备可读字号和对比度
- [ ] 所有主要按钮有 hover、active、focus 状态
- [ ] 图标尺寸和视觉重量一致
- [ ] Windows 125% / 150% DPI 下无裁切
- [ ] loading、empty、error 状态不会形成多个互相竞争的空块

## 10. 最终原则

1. 不要继续堆叠效果，先收敛产品身份。
2. 首页应从仪表盘回到播放器。
3. 玻璃是功能层，不是内容层的默认背景。
4. 动效必须表达播放、状态变化或操作反馈。
5. 高级感来自单一焦点、留白、响应速度和稳定的视觉规则。
