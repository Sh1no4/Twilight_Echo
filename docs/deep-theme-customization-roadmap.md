# Twilight Echo 深度主题定制路线图

> 状态：P0–P6 已实施；P7 收口中（性能/黄金矩阵/双写收敛）
> 创建日期：2026-07-23
> 修订：2026-07-24 与 `docs/aurora-theme-customization-plan.md` 对齐（5 布局、7 预设、effectsMode）
> 目标：在不破坏桌面端可用性、性能和插件安全边界的前提下，逐步做到与 Aurora
> 这类深度皮肤相当的可定制体验。细粒度任务与验收证据以实施计划为准。

## 1. 结论与范围

Aurora 值得借鉴的是体验模型：按视觉域组织选项、即时预览、明暗分别调校、可导出和可
回退；不是 Android 实现本身。公开说明列出了日夜跟随、配色、播放器布局、封面模糊/叠层、
渐变/透明背景、图标、字体、导航、均衡器和播放器按钮等能力。Twilight Echo 应覆盖同一批
视觉域，但采用适合 Electron 桌面应用的声明式实现。

本计划的最终范围是八个可见域：

1. 个性化：明暗主题、强调色、背景、材质、透明度、模糊、渐变和全局圆角。
2. 字体与歌词：字体、层级、缩放、字重、大小写、歌词高亮与桌面歌词。
3. 图标与导航：内置图标族、颜色、尺寸、侧栏密度和导航样式。
4. 媒体库：列表/卡片密度、选中态、封面形状、标题区和底部操作区。
5. 播放页：布局、对齐、封面尺寸/圆角/过渡、封面背景、进度条和控制区。
6. 均衡器与可视化：配色、旋钮/频谱的视觉预设和面板形状，绝不改变 DSP 行为。
7. 小窗与桌面歌词：继承全局主题或独立覆盖。
8. 主题包：内置、用户配置档和第三方声明式主题的导入、导出、兼容与回退。

不在范围内：任意 DOM 注入、主题脚本、远程字体/图片 URL、把用户配置做成自由 CSS 编辑器、
从桌面壁纸读取颜色、或让主题改变播放/DSP/IPC 行为。上述限制不是功能缺失，而是维持
升级兼容、可验证性和安全性的必要条件。

## 2. 现状基线

项目已有可复用的主题基础，不需要另起一套皮肤系统：

| 已有能力                                                    | 位置                                      | 对本计划的意义                           |
| ----------------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| 158 个带类型、范围和明暗默认值的主题令牌（P0 基线为 77）    | `src/shared/theme.ts`                     | 作为唯一稳定的颜色、尺寸、字体和材质契约 |
| 用户主题档、预览、撤销/重做、导入/导出、局部图片/woff2 资源 | `ThemeStudioPage.vue`、`useThemeStore.ts` | 直接扩展为主题工作室，不重写持久化流程   |
| 单个激活主题、插件结构化 token 与包内样式表                 | `extensions/themeRuntime.ts`、插件规范    | 可做主题包，但须保持声明式边界           |
| 小窗与桌面歌词的主题默认值/继承                             | `ThemeWindowDefaults`                     | 后续单独扩展窗口，不必重新设计主题选择   |
| 主题归档路径、体积与格式校验                                | `src/main/themes/`                        | 可安全地继续支持本地主题资源             |

2026-07-23 的粗略静态审计还发现：渲染层出现约 398 个 `--te-*` 变量名，而登记令牌为 77
个；约 2,702 行 CSS/Vue 命中硬编码色值模式。P7 收口时登记令牌已升至 158，派生别名
（`--te-accent` / `--brand-*`）由 runtime 输出；存量硬编码色仍由 `themeColorAudit` 预算约束。

### 与插件规范的关系

当前权威插件规范明确：主题插件只能提供 CSS 变量包和包内样式表，不执行脚本；宿主一次仅
应用一个插件主题；结构化主题只覆盖登记的令牌和 `windowDefaults`。本设计不放宽这些边界。

为支持播放器或媒体库的“布局选项”，宿主将实现有限枚举的布局模式，并通过根元素的
`data-te-*` 属性选择预先编译的样式。用户主题可选择这些模式；插件 API 的后续扩展也只声明
模式 ID，不能提交 HTML、JavaScript 或任意选择器。现有 API v1 的 `variables + stylesheet` 继续
兼容，不能承诺其自定义选择器跨宿主版本的布局稳定性。这是“深度可定制”和“可长期维护”之间
必须明确的界线。

## 3. 目标架构

### 3.1 三层模型

```text
内置 Theme Contract（稳定、受校验）
  ├─ token：颜色、字体、长度、阴影、滤镜、动画
  ├─ mode：有限枚举的布局/图标/控件变体
  └─ asset：受限的本地图片和已转换 woff2 字体
             ↓
Theme Profile（用户可编辑、稀疏覆盖、可导出）
             ↓
Theme Runtime（解析明暗变体，写入 :root CSS 变量和 data-te-* 属性）
             ↓
各 Vue 组件（只消费 token 和 mode，不读取配置档内部结构）
```

`ThemeDocumentV1`、`ThemeProfileV1` 和已有插件结构化主题保留原语义。需要布局模式时新增
`ThemeProfileV2`，迁移器将 V1 读为 V2 的默认模式；不得原地改变 V1 字段含义。所有 profile
始终是稀疏覆盖，缺项回退到内置主题。解析失败、插件卸载、资源缺失或配置版本未知时，一律
保留原文件并回退到内置默认主题，而不是让应用处于半应用状态。

建议的 V2 形状如下，字段和值最终应在 Phase 0 冻结：

```ts
interface ThemeProfileV2 extends ThemeProfileV1 {
  schemaVersion: 2
  modes: {
    appearance?: {
      accentSource?: 'fixed' | 'cover'
      backgroundTreatment?: 'solid' | 'gradient' | 'cover-blur' | 'image'
      toneScheduling?: 'manual' | 'system' | 'timed'
      contrastGuard?: 'off' | 'warn' | 'enforce'
      effectsMode?: 'full' | 'reduced'
    }
    navigation?: { style?: 'expanded' | 'compact' | 'rail'; iconScale?: 'sm' | 'md' | 'lg' }
    library?: { density?: 'comfortable' | 'compact'; selection?: 'fill' | 'stroke' }
    player?: {
      layout?: 'standard' | 'full-cover' | 'lyrics-focus' | 'split' | 'minimal'
      controls?: 'standard' | 'pro'
    }
    artwork?: { transition?: 'fade' | 'slide' | 'none' }
    icons?: { family?: 'outline' | 'rounded' | 'filled' }
    visibility?: Record<string, boolean>
  }
}
```

这不是可直接提交的代码。特别是 `cover` 动态色必须复用并验证现有封面取色流程，且要对低对比
结果执行回退；它不能在播放器 tick 中重复计算。`contrastGuard` 的 `enforce` 只校正可读文字/交互
对，不能静默重写用户的整套调色板。

### 3.2 令牌和模式的规则

- 一个令牌只表达一个视觉语义，例如“列表选中边框”，不用 `blue2`、`radiusLarge` 这类视觉名称。
- 颜色、长度、数值、字体、阴影、滤镜、渐变和 easing 继续经过现有的类型和范围校验；不允许
  `url()`、表达式、外部资源或未登记 CSS 变量穿透。
- 连续值用滑块，离散选择用分段控件，开关只用于二元状态；不把颜色填进普通文本输入框。
- 可布局的组件只认识模式 ID；模式的 CSS 和所有图标资源由宿主随版本发布。主题档不保存 CSS。
- 导入字体仅接受已转换并校验的 `.woff2`。这与项目的字体构建约束一致。
- 禁用动画、`prefers-reduced-motion` 和键盘焦点样式是所有模式的硬约束，主题不能覆盖。

### 3.3 Theme Studio 的桌面交互

保留现有实时预览、应用、撤销/重做、复制、导入/导出和资源绑定。将工作室整理为左侧视觉域导航、
中央属性编辑区和右侧真实应用预览/对比区，而不是复刻 Android 的超长设置页。顶部固定显示当前
配置档、明/暗变体、重置、撤销/重做和“应用”操作。

每个属性必须显示当前来源：内置默认、当前配置档、主题包或自动封面取色。用户离开未保存草稿时
可恢复；应用后保留历史版本。V1 首批至少提供 48 个真正生效的用户设置，按域分配如下：

| 视觉域       | 首批设置数量 | 示例                                                         |
| ------------ | -----------: | ------------------------------------------------------------ |
| 个性化与材质 |           12 | 强调色来源、背景处理、叠层/模糊/透明度、渐变、全局圆角       |
| 字体与歌词   |            9 | 三类字体、字号/字重、大小写、歌词高亮和导航文字              |
| 图标与导航   |            8 | 图标族、颜色、尺寸、侧栏样式、导航背景/透明度                |
| 媒体库       |            7 | 列表密度、选中态、封面圆角、标题叠层、卡片表面               |
| 播放器与封面 |           12 | 三种布局、标题对齐、封面尺寸/圆角/过渡、背景、控制区、进度条 |

“设置数量”是验收下限，不是为了凑数。成熟阶段会扩展至约 80--100 个可验证设置；任何新增选项
必须能指向具体 token/mode、实际组件和自动测试。

## 4. 分阶段实施

### Phase 0：契约盘点与视觉基线（约 1 周）

**目标**：先确定可维护的定制边界，避免在各页面各自增加颜色和开关。

- 建立“组件 -> 视觉语义 -> 现有变量/硬编码值 -> 拟定 token/mode”的审计表，优先 App、设置、
  SideMenu、SongList、PlayerBar、PlayingMusic、Equalizer、Mini Player 和桌面歌词。
- 冻结 token 命名、V1 到 V2 迁移规则、模式注册表、弃用策略和配置档上限；为每个 mode 写明支持的
  组件与不变量。
- 新增主题对比样本：默认浅色/深色、长中英日韩标题、无封面、极浅/极深封面、10k 本地库和窗口缩放
  100%/125%/150%。这些是以后视觉回归的黄金样本。
- 编写颜色扫描 allowlist，防止新业务 CSS 继续引入无归属的硬编码色值；存量不强行一次清零。

**验收**：每个目标组件有明确 owner 和迁移顺序；任何候选属性都能归入 token、mode 或“拒绝开放”；
V1 profile、插件主题和无效归档均有迁移/回退用例。

### Phase 1：主题基础补齐与安全迁移（约 2 周）

**目标**：让常用表面真正遵循现有主题系统，先取得可靠的颜色、材质、形状和字体基础。

- 扩展 `THEME_TOKEN_DEFINITIONS`，优先补齐应用/设置/导航/列表的语义 token，并将对应 CSS 收敛到
  `var(--te-...)`；不要一次触及无关页面。
- 新增 `ThemeProfileV2` 正规化、持久化、V1 迁移、导入导出和冲突回退。写入仍走现有 revision/CAS 流程。
- Runtime 除 CSS 变量外写入受控 `data-te-*` 属性；只允许白名单 mode 进入 DOM。
- Theme Studio 增加“个性化与材质”页：明/暗独立令牌、背景图片绑定、表面/边界/阴影、圆角、透明度、
  UI 缩放和字体资源；保留现有实时预览。
- 在静态资产、预览、取消、保存、导入和删除失败时均确认恢复原主题。

**不做**：图标替换、播放器布局、动态封面调色或第三方 mode 声明。

**验收**：默认主题无视觉回归；浅/深主题切换不闪白；配置档中的每一项经过类型和范围校验；现有
`test:themes`、`typecheck` 通过，并添加 V2 迁移、白名单 mode、取消预览和归档拒绝测试。

### Phase 2：个性化、字体与可访问性（约 2 周）

**目标**：完成截图中“个性化”和“字体”这两类高频体验，并让深度配色仍可读可用。

- 实现强调色来源 `fixed` 与 `cover`；封面取色结果缓存到曲目/封面身份，不在播放进度更新时计算。
- 实现实色、渐变、封面模糊和本地图片四种背景处理；叠层强度、透明度与滤镜走有界 token。
- 提供正文/标题/歌词字体、字号、字重、标题大小写、歌词高亮和导航/底栏文字色。用户字体仍限 woff2。
- 增加对话框、搜索框、Toast、波形等表面圆角 token，统一而非为每页创建孤立滑块。
- Theme Studio 显示对比度预警。普通文本与背景低于 4.5:1、较大文本低于 3:1 时给出警告；
  `enforce` 模式只对宿主可推导的文本色使用安全回退。

**验收**：全部 21 个 Phase 1--2 设置在真实页面即时生效；键盘焦点、禁用态、选中态和 reduced-motion
在浅/深色均可辨；用长标题和 CJK 字体截图验证不溢出。动态背景失败时退回静态背景，不影响播放。

### Phase 3：图标、导航与媒体库（约 2--3 周）

**目标**：完成截图中“图标、媒体库、导航栏”范围，同时守住大库性能。

- 建立 `ThemeIconSlot` 和稳定的语义 icon ID，只为宿主内置的 `outline`、`rounded`、`filled` 三套图标
  映射资源。迁移导航、媒体库、均衡器和播放器公共图标，保留 aria label/tooltip 和固定点击区域。
- 增加导航 expanded/compact/rail 三种模式，图标尺寸和颜色 token，导航背景/透明度，及可选内置 logo
  可见性。不要把业务菜单结构交给主题。
- 为 SongList、专辑/艺术家卡片和 Local Dashboard 增加 compact/comfortable 密度、填充/描边选中态、
  封面圆角、标题区叠层与底部操作区视觉模式。
- 每个模式使用静态 class/attribute CSS；不得改变虚拟列表的数据流、行 key、滚动算法或在滚动热路径
  创建样式对象。

**验收**：三种图标族和三种导航模式在所有迁移 slot 中回退正确；10k 本地库仍通过 `test:local-perf`；
SongList 虚拟化和多选没有布局跳动；高对比和键盘导航没有退化。

### Phase 4：播放页、封面与均衡器视觉（约 3 周）

**目标**：完成最有辨识度的播放体验，覆盖 Aurora 的播放器、封面、控制和均衡器参考项。

- 将播放器五种布局定义为 `standard`、`full-cover`、`lyrics-focus`、`split`、`minimal`；标题 left/center
  对齐是独立 mode。布局只重排现有已加载组件，不能复制播放器业务状态或重启音频服务。
- 补齐封面尺寸、圆角、阴影、占位符、fade/slide/none 过渡、封面模糊背景、遮罩和渐变 token。
- 为 standard/pro 两种内置控制区、进度条/波形的形状和颜色增加 token；保留播放、无障碍标签和快捷键。
- 为 EqualizerPage、DspRackPage 和可视化面板增加视觉预设（面板、旋钮、频谱、强调色），但不改变 EQ
  参数、DSP chain、DSD/passthrough 旁路或音频 IPC。
- 在无封面、加载中、播放页窄宽度、歌词很长、DSD/passthrough 等状态下验证表现。

**验收**：三个播放器布局都不重置队列/播放位置；封面/背景特效关闭时没有持续动画或多余滤镜；
`test:playback-routing`、`test:dsp-graph` 和相关 PlayingMusic/Equalizer 测试通过。

### Phase 5：小窗、桌面歌词、预设与恢复（约 2 周）

**目标**：将主题体验延伸到独立窗口，并让用户可以放心试验复杂配置。

- 扩展已有 `ThemeWindowDefaults`：小窗表面、边框、阴影、圆角、字体和桌面歌词的文字/高亮/背景/阴影；
  继续支持“继承主主题”和单独关闭继承。
- 发布七个内置只读预设（含 Aurora 参考、Obsidian Glass、Paper Light、Neon Gradient、Studio Split、
  Zen Minimal 等），只使用原创 token/mode 配置，不复制 Aurora 的资源、名称、图标或源码。
- 为 profile 建立可恢复版本历史（限定数量和磁盘预算），支持“恢复本分类默认值”和“恢复完整默认值”。
- 设置备份/还原必须包含 V2 profile，但不能覆盖失效插件主题的安全回退判断。

**验收**：主窗口、小窗和桌面歌词在主题切换后状态一致且不闪烁；关闭窗口继承只影响该窗口；备份、
恢复、旧 V1 profile 和插件卸载的组合均可预测。

### Phase 6：第三方主题契约与发布（约 2 周）

**目标**：在既有插件规范内开放可移植的主题包，而不把用户配置和第三方代码混为一谈。

- 仅在插件 API 的下一个主版本中**追加** `modes` 的声明式 schema；V1 `variables + stylesheet` 和
  `structured` 行为保持兼容。先发布类型、模板、校验器和示例，再宣布市场支持。
- 每个 plugin mode 都必须来自宿主注册表；未知 mode 忽略并记录兼容提示。第三方 stylesheet 仍仅能
  来自包目录，且不允许远程资源、脚本或宿主内部 API。
- 用户主题档继续使用主题归档；第三方主题仍用 `.tep` 和现有信任/哈希/版本流程。主仓库不保存第三方
  插件源码，示例和发布包放在规定的外部插件仓库。
- 为主题作者提供 token 目录、组件预览、兼容矩阵、弃用记录及“不要依赖内部选择器”的迁移指南。

**验收**：示例主题只靠公开 token/mode 通过打包、安装、启用、禁用和卸载；无效 mode、非法 asset、
插件停用与旧主题都安全回退；`test:plugins` 和 `test:themes` 通过。

### Phase 7：性能、视觉回归与发布门槛（贯穿开发，正式发布前完成）

- 令牌滑块预览合并到动画帧，磁盘只在明确“应用”时写入；记录主题应用和资源解码耗时（已实现）。
- 黄金样本 Electron 截图矩阵：浅/深 × 三缩放 × 五播放器布局 × 三导航 × 无封面，另加 7 个预设；
  由 `pnpm run evidence:themes` 对接 CDP（脚本已就绪，实机证据包人工入库）。
- Settings 与 Theme Studio 双写收敛：皮肤 token/mode 仅由主题 runtime 输出（已实现）。
- Theme Studio 可搜索设置与 `effectsMode=reduced` 关闭特效（已实现）。
- 把新增 token/mode 的 schema、迁移、回退、导入归档、插件主题和窗口继承写入 `node --test` 契约测试。
- 以 10k 本地库执行滚动和主题切换；主题切换不得使 `SongList` 失去虚拟化或触发全库搜索/重建。
- 发布候选至少运行 `pnpm run test:themes`、`pnpm run test:local-perf`、`pnpm run test:playback-routing`、
  `pnpm run test:dsp-graph`、`pnpm run test:plugins` 和 `pnpm run typecheck`。涉及打包时再按发布门禁执行。

建议性能门槛：常规配置档的单项预览 P95 小于 32 ms，完整应用 P95 小于 100 ms；不满足时先减少
样式重算和图片滤镜，而不是降低虚拟列表或播放链路的可靠性。

## 5. 实施顺序、依赖与风险

| 先后                          | 原因                                            | 不满足时的处理                 |
| ----------------------------- | ----------------------------------------------- | ------------------------------ |
| 先 Phase 0--1，再开放更多设置 | 没有语义 token，设置只会变成无法升级的 CSS 补丁 | 延后该设置，不新增页面私有颜色 |
| 先字体/材质，再图标           | 图标风格必须建立在稳定的颜色、尺寸和焦点约束上  | 图标继续使用当前资源           |
| 先媒体库模式，再播放器布局    | 两者都需要 mode runtime；媒体库更易做性能验证   | 播放页只接受 token，不换布局   |
| 最后才开放插件 mode           | 宿主 mode 未稳定时，第三方主题会锁死 API        | 仅支持现有 V1 token/stylesheet |

主要风险及应对：

| 风险                         | 应对                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------- |
| 选项数量膨胀导致不可用       | 每个域提供“基础/高级”层级和可搜索设置；设置必须有真实预览和一键恢复              |
| 第三方样式与宿主升级冲突     | 优先 structured token/mode；现有 stylesheet 保持兼容但标注为高级、非布局稳定接口 |
| 模糊、渐变和大背景拖慢渲染   | 有界滤镜、关闭效果模式、资源尺寸/总量限制和实际 P95 监测                         |
| 封面取色造成低对比或频闪     | 基于封面身份缓存、去饱和/对比度回退、切歌过渡限时且遵守 reduced-motion           |
| 图标包导致点击区和无障碍退化 | icon slot 固定语义、尺寸和 aria label；主题只选族与颜色                          |
| 主题影响大库滚动             | 仅 root 变量和静态 mode CSS；不将 profile 变成每行响应式对象                     |
| 主题导入成为资源攻击面       | 延用归档预检、路径/类型/大小限制和本地资源协议，继续拒绝远程 URL                 |

## 6. 任务落点

| 责任                           | 主要位置                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| 主题 schema、token、V1/V2 迁移 | `src/shared/theme.ts`、对应测试                                                            |
| 主题库、归档、资源限制、IPC    | `src/main/themes/`、`src/main/ipc/themes.ts`、`src/preload/`                               |
| Runtime、配置档预览和应用      | `src/renderer/src/stores/useThemeStore.ts`、`extensions/themeRuntime.ts`                   |
| 编辑器交互                     | `src/renderer/src/components/ThemeStudioPage.vue`、`theme-studio/ThemeStudioPage.css`      |
| 基础和各视觉域 CSS             | `assets/*.css`、SideMenu、SongList、PlayingMusic、PlayerBar、Equalizer、Mini Player 等组件 |
| 第三方主题 API/脚手架          | `packages/plugin-api`、`packages/create-twilight-plugin`；第三方主题源码不写入本仓库       |

每个实现 PR 只跨一个视觉域，包含：schema 或 CSS 变更、迁移/回退测试、至少两张真实页面截图、
需要运行的门禁命令，以及对当前主题/插件兼容性的说明。不要将 Phase 3--6 合并成一个“大主题重构”。

## 7. 资料与设计依据

- [Aurora - Poweramp Skin（Google Play）](https://play.google.com/store/apps/details?id=com.poweramp.v3.aurora&hl=en-US)，2026-07-23 查阅：公开功能清单验证了本计划参考的视觉域，包括日夜模式、配色、播放器布局、封面背景、图标、字体、导航、均衡器和控制区。它是产品参考，不是可复制的实现或资产来源。
- [MDN: Using CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascading_variables/Using_CSS_custom_properties)，2026-07-23 查阅：支持以继承的 CSS 自定义属性作为运行时 token 输出层；类型、范围和安全校验仍必须在 TypeScript schema 层完成。
- [WCAG 2.2: Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)，2026-07-23 查阅：本计划以普通文本 4.5:1、较大文本 3:1 作为主题工作室的最小对比度预警阈值。
- [Twilight Echo 插件规范](twilight-echo-plugin-spec.md)：主题插件的 CSS-only、单主题和结构化 token 边界为本设计的强制约束。

## 8. 首个可交付切片

开始编码时，建议只交付 **Phase 0 加 Phase 1 的“主题基础补齐”**：完成 token 审计、V2
迁移器、白名单 mode runtime，以及个性化/材质中 12 个已生效设置。它能让用户马上看到更深的
颜色、材质、背景和形状定制，也为后续图标、媒体库和播放器布局提供不返工的基础。其余阶段在
前一阶段的截图、性能和回退验收通过后再开始。
