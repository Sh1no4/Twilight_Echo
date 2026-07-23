# Twilight Echo — Aurora 式深度主题定制实施计划

> 创建日期：2026-07-23（同日修订：布局 mode 扩展、预设体系与结构项增补）
> 参考：Poweramp Aurora 皮肤设置截图（皮肤设置 / 个性化 / 图标 / 字体 / 媒体库 / 导航栏 / 均衡器 / 专辑封面 / 播放器控制 / 其他 / 可见性），以及 [Aurora Google Play 官方功能清单](https://play.google.com/store/apps/details?id=com.poweramp.v3.aurora)（2026-07-23 查阅）：日夜跟随、35/34 强调色与 19/16 背景色预设、Material You、3 种播放器布局、标题对齐、封面模糊背景与叠层、渐变/透明背景、图标集与尺寸、字体风格库、Header 叠层、选中曲目颜色、导航样式、旋钮/EQ 样式与频谱、封面尺寸与过渡、Pro 按钮样式
> 项目内配套文档：`docs/deep-theme-customization-roadmap.md`（架构级路线图，本计划与其对齐并给出更细的落地任务）

---

## 当前实施状态（2026-07-23）

| 阶段 | 状态 | 已完成范围 | 验收证据 |
|---|---|---|---|
| P0 | ✅ 已完成 | 契约审计、token/mode 边界、颜色 allowlist、明暗视觉基线 | `docs/theme-contract-audit.md`、`themeColorAudit.test.ts`、P1 明暗截图 |
| P1 | ✅ 已完成 | V2 profile/迁移/归档、白名单 `data-te-*`、Theme Studio 三栏与 12 项个性化/材质设置 | `test:themes`、`typecheck`、`docs/audit-evidence/theme-p1-*.png` |
| P2 | ✅ 已完成 | 封面强调色、四类背景、明暗调度、16+16 色板、9 项字体域、内置字体、统一表面、对比度保护 | `test:themes` 33/33、`test:cross-cutting-regressions` 13/13、ESLint、typecheck、`docs/audit-evidence/theme-p2-*.png` |
| P3 | ✅ 已完成 | 25 个宿主图标槽、三图标族/三导航布局、导航标识与媒体库密度/选中/叠层 | `test:themes` 35/35、`test:local-perf` 99 通过/2 跳过、`docs/audit-evidence/theme-p3-*.png` |

P2 额外通过 CDP 验证：1495×883、1200×800、1080×720 三种视口无横向溢出或三栏/顶栏碰撞；reduced-motion 下不添加 tone 过渡；无封面时动态背景保留实色回退；Lora、JetBrains Mono、Space Grotesk 实际加载；长中英日韩标题无越界。本轮遵循要求未使用 Computer Use。

P3 额外通过原始 CDP 验证：三图标族 × 三导航布局的全部组合均只显示一个正确字族图标，真实侧栏宽度为 216/164/72px 且菜单点击区保持 40px；品牌标识显示时底部菜单仍完整可达。媒体库舒适/紧凑、填充/描边、标题叠层及 6 个新增数值令牌均在真实预览中即时生效。1495×883、1200×800、1080×720 无横向溢出或面板碰撞，forced-colors 下图标和 2px 焦点轮廓保持可见。验证全程未使用 Computer Use。

已知非主题门禁：`test:playback-routing` 仍有 HiFi 抽屉旧文案断言和 metadata enrichment 请求次数断言两项失败，均位于本阶段未改动的播放/元数据行为，不通过修改主题代码掩盖。

---

## 一、结论先行

Aurora 的价值在于**体验模型**，不是 Android 实现：按视觉域组织选项、滑块/分段控件/开关三种输入形态、即时预览、每个分类可"恢复默认值"、明暗分别调校。Twilight Echo 已具备把这套模型落到 Electron 桌面端的全部基础设施，**不需要新建皮肤系统**，只需要按阶段扩展现有主题契约。

### 现有可复用基础（已验证存在于代码库）

| 能力 | 位置 | 状态 |
|---|---|---|
| 77 个类型化主题令牌（color/length/number/font/shadow/filter/gradient/easing/enum），带明暗默认值、min/max/step 范围校验 | `src/shared/theme.ts`（`THEME_TOKEN_DEFINITIONS`） | ✅ 已有 |
| Theme Studio：用户主题档、实时预览、撤销/重做、导入/导出、本地图片/woff2 资源绑定 | `src/renderer/src/components/ThemeStudioPage.vue` + `useThemeStore.ts` | ✅ 已有 |
| 主题运行时（CSS 变量写入 `:root`） | `src/renderer/src/extensions/themeRuntime.ts` | ✅ 已有 |
| 小窗 / 桌面歌词主题默认值与继承 | `ThemeWindowDefaults`（`src/shared/theme.ts`） | ✅ 已有 |
| 主题归档路径/体积/格式安全校验 | `src/main/themes/`（archive validation、library repository） | ✅ 已有 |
| 背景图/字体资源绑定槽位（app/local/settings/streaming/player 背景 + 三类字体） | `ThemeAssetBindings` | ✅ 已有 |
| 测试门禁 | `pnpm run test:themes` | ✅ 已有 |

### 缺口（Aurora 有、本项目暂无）

1. **布局/样式模式（mode）**：Aurora 的"界面布局：纯色/备选/Full Cover"、"导航栏风格：填充底部/浮动"、"图标族"等是离散枚举变体，当前运行时只输出 CSS 变量，没有 `data-te-*` 模式属性通道。
2. **封面动态取色作为强调色来源**（Aurora 的 Material You 对应桌面端的"封面取色"）。
3. **可见性开关**（隐藏播放页元素/按钮）。
4. **按视觉域组织的设置页信息架构**（当前 Theme Studio 是单页令牌编辑，不是 Aurora 式分域导航）。
5. **令牌覆盖面**：渲染层实际出现约 398 个 `--te-*` 变量名，登记令牌仅 77 个，且约 2700 行 CSS/Vue 存在硬编码色值 —— 大量表面尚未接入主题系统。

### 硬约束（不可妥协，来自项目规范）

- 主题只能是**声明式**：CSS 变量 + 有限枚举 mode + 本地受限资源。禁止主题脚本、任意 DOM 注入、远程 URL、自由 CSS 编辑器。
- 主题**绝不改变** 播放 / DSP / IPC / 队列行为；均衡器主题只改视觉，不碰 DSP chain。
- 字体仅接受预转换 `.woff2`（项目字体构建约束）。
- 大列表性能红线：主题只写 root 变量和静态 mode CSS，不得让 `SongList` 虚拟化失效、不得在滚动/播放 tick 热路径创建样式对象。
- 禁用动画（`prefers-reduced-motion`）与键盘焦点样式是所有主题不可覆盖的底线。

---

## 二、Aurora 截图功能 → 本项目实现映射

| Aurora 设置域（截图） | 桌面端对应 | 实现机制 | 阶段 |
|---|---|---|---|
| 个性化（强调色/背景色/Material You/界面布局/封面模糊/渐变背景/透明背景/各类圆角） | 全局外观 | token（颜色/滤镜/渐变/圆角）+ mode（背景处理、布局）+ 封面取色 | P1–P2 |
| 日夜跟随模式（Follow Day/Night） | 明暗自动切换 | tone 调度 mode（手动/跟随系统/定时） | P2 |
| 强调色/背景色预设色板（35/34 强调色、19/16 背景色） | 快速配色 | 宿主内置精选色板 + 自定义取色器，色板项即 token 预填 | P2 |
| 字体（风格/颜色/大写/大小/歌词字体/歌词强调高亮/自适应标题色） | 字体与歌词 | token（三类字体槽 + 字号/字重）+ woff2 资源绑定 | P2 |
| 图标（媒体库/导航/均衡器/杂项/标题图标族、颜色、大小、形状圆角） | 图标系统 | `ThemeIconSlot` 语义 ID + 内置 outline/rounded/filled 三族 | P3 |
| 媒体库（Header 按钮圆角/透明度/叠加层/选中曲目颜色圆角边距/底部按钮） | SongList / LocalDashboard / 专辑艺术家卡片 | token + density/selection mode | P3 |
| 导航栏（风格填充/浮动、背景色、圆角、偏移、指示器颜色） | SideMenu / 导航 | navigation mode（expanded/compact/rail）+ token | P3 |
| 专辑封面（切换过渡风格/封面大小/边框半径/阴影/播放器-网格-列表分别设置） | PlayingMusic / SongList 封面 | token（尺寸/圆角/阴影按表面分组）+ transition mode | P4 |
| 播放器控制（Pro 按钮形状/颜色/大小/描边/圆角/间距、进度条样式、频谱样式、时长背景） | PlayerBar / PlayingMusic 控制区 | controls mode（standard/pro）+ 形状颜色 token | P4 |
| 均衡器（着色/圆角/滑块形状/旋钮指示器/屏幕频谱/Eq 按钮/音量面板） | EqualizerPage / DspRackPage / 可视化面板 | 视觉预设 token（不碰 DSP 参数） | P4 |
| 其他（界面扁平化/曲目标题背景圆角透明度/各元素圆角透明度） | 全局表面 | 统一表面 token（对话框/搜索框/Toast/标题背景） | P2 |
| 可见性（隐藏播放页元素/均衡器辅助线/播放列表按钮等） | 播放页/均衡器元素显隐 | 白名单可见性开关（boolean mode，保留无障碍与快捷键） | P4 |
| 皮肤设置首页（分域导航 + 每域恢复默认值） | Theme Studio 信息架构改版 | 左侧视觉域导航 + 中央属性区 + 右侧实时预览 | P1 起逐步 |

---

## 三、目标架构（三层模型）

```text
内置 Theme Contract（稳定、受校验）
  ├─ token：颜色、字体、长度、阴影、滤镜、渐变、easing（现有 77 → 目标约 200+）
  ├─ mode：有限枚举布局/图标/控件变体（新增，白名单进 DOM）
  └─ asset：本地图片 + 预转换 woff2（现有 ThemeAssetBindings 扩展）
         ↓
Theme Profile V2（用户稀疏覆盖，缺项回退内置；V1 自动迁移）
         ↓
Theme Runtime（解析明暗变体 → :root CSS 变量 + data-te-* 属性）
         ↓
Vue 组件（只消费 token 和 mode，不读取 profile 内部结构）
```

关键 schema 决策（Phase 0 冻结）：

```ts
interface ThemeProfileV2 extends ThemeProfileV1 {
  schemaVersion: 2
  modes: {
    appearance?: { accentSource?: 'fixed' | 'cover'
                   backgroundTreatment?: 'solid' | 'gradient' | 'cover-blur' | 'image'
                   toneScheduling?: 'manual' | 'system' | 'timed'
                   contrastGuard?: 'off' | 'warn' | 'enforce' }
    navigation?: { style?: 'expanded' | 'compact' | 'rail'; iconScale?: 'sm' | 'md' | 'lg' }
    library?:    { density?: 'comfortable' | 'compact'; selection?: 'fill' | 'stroke' }
    player?:     { layout?: 'standard' | 'full-cover' | 'lyrics-focus' | 'split' | 'minimal'
                   controls?: 'standard' | 'pro' }
    artwork?:    { transition?: 'fade' | 'slide' | 'none' }
    icons?:      { family?: 'outline' | 'rounded' | 'filled' }
    visibility?: Record<VisibilitySlotId, boolean>   // 白名单显隐槽位
  }
}
```

规则：
- 一个 token 一个视觉语义（如"列表选中边框"），禁止 `blue2`/`radiusLarge` 这类视觉名。
- 连续值→滑块；离散选择→分段控件；二元→开关（与 Aurora 交互形态一致）。
- mode 的 CSS 与图标资源由宿主随版本发布，主题档不保存 CSS。
- 任何解析失败/资源缺失/版本未知 → 保留原文件并回退内置默认主题，不允许半应用状态。

---

## 四、分阶段实施

### Phase 0：契约盘点与视觉基线（约 1 周）

**目标**：确定可维护的定制边界，避免各页面各自加颜色和开关。

任务：
1. 建立审计表：`组件 → 视觉语义 → 现有变量/硬编码值 → 拟定 token/mode`。优先级顺序：App 壳、设置页、SideMenu、SongList、PlayerBar、PlayingMusic、EqualizerPage、Mini Player、桌面歌词。
2. 冻结：token 命名规范、V1→V2 迁移规则、mode 注册表、弃用策略、profile 数量上限（现有 `MAX_USER_THEME_PROFILES = 32`）。
3. 制作视觉回归黄金样本：默认浅/深、长中英日韩标题、无封面、极浅/极深封面、10k 本地库、窗口缩放 100%/125%/150%。
4. 编写颜色扫描 allowlist（防止新增业务 CSS 继续引入硬编码色值；存量不强行一次清零）。

**验收**：每个目标组件有 owner 和迁移顺序；每个候选属性可归入 token / mode / "拒绝开放"三类之一；V1 profile、插件主题、无效归档均有迁移/回退用例。

---

### Phase 1：主题基础补齐与 V2 迁移（约 2 周）

**目标**：常用表面真正遵循主题系统，取得可靠的颜色/材质/形状/字体基础。对应 Aurora"个性化"域的静态部分。

任务：
1. 扩展 `THEME_TOKEN_DEFINITIONS`：补齐应用壳/设置/导航/列表的语义 token，对应 CSS 收敛到 `var(--te-...)`。不一次触及无关页面。
2. 实现 `ThemeProfileV2`：正规化、持久化、V1 自动迁移、导入导出、冲突回退。写入沿用现有 revision/CAS 流程。
3. Runtime 增加受控 `data-te-*` 属性输出，只允许白名单 mode 进 DOM。
4. Theme Studio 信息架构改版启动：左侧视觉域导航 + 中央属性编辑 + 右侧真实预览；顶部固定当前配置档、明/暗变体切换、重置、撤销/重做、应用。每个属性显示来源（内置默认/当前配置档/主题包/封面取色）。
5. 首个可见域"个性化与材质"（12 项设置）：明/暗独立令牌、背景图绑定、表面/边界/阴影、全局圆角、透明度、UI 缩放、字体资源。
6. 失败恢复验证：静态资产缺失、预览取消、保存/导入/删除失败时均恢复原主题。

**不做**：图标替换、播放器布局、封面动态取色、第三方 mode。

**验收**：默认主题零视觉回归；浅/深切换不闪白；profile 每项过类型+范围校验；`test:themes`、`typecheck` 通过；新增 V2 迁移、白名单 mode、取消预览、归档拒绝测试。

---

### Phase 2：个性化、字体与可访问性（约 2 周）

**目标**：完成 Aurora"个性化 + 字体 + 其他"三个高频域。

任务：
1. **强调色来源** `fixed | cover`：封面取色复用现有取色流程（LRU + promise 缓存），结果缓存到曲目/封面身份；**绝不在播放 tick 中重复计算**；低对比结果自动去饱和/回退。
2. **四种背景处理**：实色 / 渐变（双色 + 角度，对应截图"渐变颜色1/2 + 渐变角度"）/ 封面模糊（含叠加层强度滑块）/ 本地图片。滤镜、叠层、透明度全部走有界 token。
3. **日夜跟随（tone 调度）**（对应 Aurora "Follow Day/Night Mode"）：`manual / system / timed` 三种调度。`system` 经主进程 `nativeTheme` 事件下发，`timed` 支持自定义时刻；切换只重解析当前 profile 的明/暗变体，不重建 profile、不打断播放；切换过渡限时并遵守 reduced-motion。
4. **精选色板**（对应 Aurora 35/34 强调色 + 19/16 背景色）：宿主内置明暗各一组精选强调色/背景色色板（首批各 ≥16 项），点选即预填对应 token，仍可用自定义取色器覆盖。色板是 UI 快捷层，**不新增 schema 概念**，profile 里只落 token 值。
5. **字体域**（9 项）：正文/标题/歌词三类字体槽、字号、字重、标题大写开关、歌词强调高亮（对应"Accent Lyrics Highlight"）、自适应标题颜色风格（禁用/曲目/艺术家专辑）、导航/底栏文字色。用户字体仍限 woff2。
6. **内置字体风格库**（对应 Aurora 10.6.1 内置 5 款字体）：随宿主发布数款预转换 woff2 开源字体（衬线/无衬线/等宽/展示体各至少一款，许可证允许再分发），在字体槽下拉中直接可选；用户导入字体流程不变。
7. **统一表面圆角 token**（对应截图"对话框/搜索框/Toast/波纹圆角半径"）：对话框、搜索框、Toast、曲目标题背景（圆角 + 透明度）——统一 token 组，不为每页创建孤立滑块。
8. **对比度预警**：普通文本 <4.5:1、大文本 <3:1 时 Theme Studio 显示警告；`enforce` 模式只对宿主可推导的文本色做安全回退，不重写用户整套调色板。

**验收**：Phase 1–2 全部 24 项设置在真实页面即时生效；`system` 日夜跟随在 OS 切换明暗后 1s 内完成且不闪白、不打断播放；色板任一项点选后所有关联表面同步更新；键盘焦点/禁用态/选中态/reduced-motion 在浅深色均可辨；长标题 + CJK 字体截图验证无溢出；动态背景失败退回静态背景且不影响播放。

---

### Phase 3：图标、导航与媒体库（约 2–3 周，✅ 2026-07-23 完成）

**目标**：完成 Aurora"图标 + 导航栏 + 媒体库"三域，守住大库性能。

任务：
1. **图标系统**：建立 `ThemeIconSlot` 语义 ID 注册表，宿主内置 `outline / rounded / filled` 三套图标族（对应截图 Outline 描边 / Material Rounded / Material 质感）。按域提供图标颜色（跟随强调色或自定义）与大小 token（媒体库/导航/均衡器/杂项/标题分组，与 Aurora 一致）。迁移时保留 aria label、tooltip 和固定点击区域。
2. **导航模式**：`expanded / compact / rail` 三种（对应"填充底部/浮动"的桌面化转译），加导航背景色/透明度、圆角、指示器颜色 token，内置 logo 可见性开关。业务菜单结构不交给主题。
3. **媒体库域**（7 项）：SongList / 专辑艺术家卡片 / LocalDashboard 的 `comfortable/compact` 密度、`fill/stroke` 选中态、选中曲目颜色/圆角/左右边距（对应截图"选定曲目"组）、封面圆角、标题区叠层（开关 + 强度滑块）、底部操作区背景/圆角。
4. **性能红线**：每个模式用静态 class/attribute CSS；不改虚拟列表数据流、行 key、滚动算法；不在滚动热路径创建样式对象。

**验收**：三图标族 × 三导航模式在所有迁移 slot 回退正确；10k 库通过 `test:local-perf`；SongList 虚拟化与多选无布局跳动；高对比与键盘导航无退化。

---

### Phase 4：播放页、封面、控制区与均衡器视觉（约 3 周）

**目标**：完成辨识度最高的域——Aurora"专辑封面 + 播放器控制 + 均衡器 + 可见性"。

任务：
1. **播放器布局 mode（5 种）**：在 Aurora 的 3 种之上增加两种桌面原生布局，共五种——
   - `standard`：当前默认布局（对应 Aurora "纯色/标题位置默认"）；
   - `full-cover`：封面铺满播放页，控件悬浮于遮罩之上（对应 "Full Cover"）；
   - `lyrics-focus`：歌词占主视区，封面缩为侧栏缩略（对应 "备选" 的歌词向变体）；
   - `split`：**桌面新增**——左封面右歌词/队列的双栏布局，利用桌面横向宽度，宽度低于阈值时自动降级为 `standard`；
   - `minimal`：**桌面新增**——极简布局，仅保留封面、标题和核心控制，默认联动一组可见性槽位预设（用户仍可逐项覆盖）。
   标题 left/center 对齐是独立 mode，对五种布局正交。所有布局只重排已加载组件，**不复制播放器业务状态、不重启音频服务、不重置队列/播放位置**；`split` 的歌词/队列面板复用现有组件实例，不得二次订阅播放状态。
   Theme Studio 中布局以**缩略图画廊**选择（非纯文字分段控件），缩略图由宿主随版本发布。
   实施顺序：先交付 `standard / full-cover / lyrics-focus` 三种并通过验收，`split / minimal` 作为 P4 第二切片跟进，避免五布局同时联调。
2. **封面域**（对应"专辑封面"截图）：封面尺寸滑块（播放页百分比）、圆角半径按表面分组（播放器/网格视图/列表视图各自 token，与 Aurora 分组一致）、阴影开关、占位符、`fade/slide/none` 切换过渡、封面模糊背景/遮罩/渐变 token。
3. **控制区**（对应"播放器控制"截图）：standard/pro 两种控制区 mode；按钮形状风格/颜色/大小/描边宽度/圆角/间距 token；进度条样式（直线空心圆/实心圆/无圆/频谱风格的桌面化子集）、进度条颜色/圆角/大小；已播放和总时长背景圆角+透明度。保留播放行为、无障碍标签和快捷键。
4. **均衡器视觉预设**（对应"均衡器"截图）：EqualizerPage / DspRackPage / 可视化面板的面板着色、圆角、滑块形状（空心环/实心圆）、旋钮指示器风格、屏幕频谱样式、Eq 按钮风格/圆角、音量面板旋钮/圆角/大小。**绝不改变 EQ 参数、DSP chain、DSD/passthrough 旁路或音频 IPC**。
5. **可见性域**（对应"可见性"截图）：白名单显隐槽位——播放页专辑艺术家/封面/曲目菜单按钮/杂项图标/时长显示/波形进度条/曲目信息；均衡器辅助线/频率准线/频谱曲线；上一首下一首按钮；小窗封面。每个槽位是 boolean mode，隐藏交互元素时同步处理焦点顺序，快捷键行为不变。
6. 边界状态验证：无封面、加载中、窄宽度、超长歌词、DSD/passthrough。

**验收**：五种布局任意切换均不重置队列/播放位置；`split` 在窗口收窄时降级且恢复宽度后回到原布局；`minimal` 联动的可见性预设可被用户逐项覆盖且焦点顺序正确；特效关闭时无持续动画或多余滤镜；`test:playback-routing`、`test:dsp-graph` 及 PlayingMusic/Equalizer 相关测试通过。

---

### Phase 5：小窗、桌面歌词、预设与恢复（约 2 周）

**目标**：主题体验延伸到独立窗口；用户可放心试验复杂配置。

任务：
1. 扩展现有 `ThemeWindowDefaults`：小窗表面/边框/阴影/圆角/字体；桌面歌词文字/高亮/背景/阴影。继续支持"继承主主题"与单窗口关闭继承。
2. **内置预设扩充为 7 个，刻意拉开反差**，每个预设跨 token + mode + 可见性三层配置，两两对比即"判若两个播放器"：
   - `Twilight Default`：当前默认外观（基准）；
   - `Aurora 参考`：分域深度定制的参考示范（封面模糊背景 + cover 取色 + rounded 图标）；
   - `Obsidian Glass`：纯黑玻璃拟态——深色 + 封面模糊 + full-cover 布局 + rail 导航 + filled 图标 + 隐藏时长/波形；
   - `Paper Light`：亮色扁平印刷风——实色浅背景 + 衬线标题字体 + standard 布局 + expanded 导航 + outline 图标 + 零阴影零模糊；
   - `Neon Gradient`：高饱和渐变背景 + minimal 布局 + 大圆角 + compact 密度；
   - `Studio Split`：split 布局 + 等宽字体 + stroke 选中态 + compact 导航，面向桌面大屏歌词/队列工作流；
   - `Zen Minimal`：minimal 布局 + 最大化可见性隐藏 + 单色低对比材质（仍满足文本对比度底线）。
   全部只用原创 token/mode 配置与自有资源，**不复制 Aurora 的资源、名称、图标或源码**。每个预设进入 P7 截图矩阵。
3. **预设画廊与派生**：Theme Studio 首页以缩略图画廊展示内置预设与用户 profile；预设一键应用（先预览后确认），并支持"从预设派生新配置档"——预设本身只读，派生档记录来源以便对比重置。
4. Profile 可恢复版本历史（限定数量与磁盘预算）；"恢复本分类默认值"（对应 Aurora 每页底部的"恢复默认值"）与"恢复完整默认值"。
5. **主题设置快捷入口**（对应 Aurora "长按菜单键直达皮肤设置"）：播放页/媒体库右键菜单与命令入口提供"定制此区域外观"，直接跳转 Theme Studio 对应视觉域并高亮相关属性组。
6. 设置备份/还原包含 V2 profile，但不覆盖失效插件主题的安全回退判断。

**验收**：主窗口/小窗/桌面歌词主题切换后状态一致不闪烁；关闭继承只影响该窗口；7 个预设两两切换均即时生效且不打断播放；预设派生档删除后原预设不受影响；备份恢复 × 旧 V1 profile × 插件卸载组合行为可预测。

---

### Phase 6：第三方主题契约与发布（约 2 周）

**目标**：在既有插件规范内开放可移植主题包。

任务：
1. 仅在插件 API 下一主版本**追加** `modes` 声明式 schema；V1 `variables + stylesheet` 与 `structured` 保持兼容。先发类型/模板/校验器/示例，再宣布市场支持。
2. 每个 plugin mode 必须来自宿主注册表；未知 mode 忽略并记录兼容提示。stylesheet 仍仅限包目录内，禁远程资源/脚本/宿主内部 API。
3. 用户主题档走主题归档；第三方主题走 `.tep` + 现有信任/哈希/版本流程。第三方主题源码放外部插件仓库（`Twilight-Echo-plugins`），不入主仓库。
4. 为主题作者提供 token 目录、组件预览、兼容矩阵、弃用记录和"不要依赖内部选择器"迁移指南。

**验收**：示例主题只靠公开 token/mode 通过打包/安装/启用/禁用/卸载全流程；无效 mode、非法 asset、插件停用、旧主题均安全回退；`test:plugins` + `test:themes` 通过。

---

### Phase 7：性能、视觉回归与发布门槛（贯穿全程，发布前收口）

1. 滑块预览合并到动画帧（rAF 批量），磁盘只在"应用"时写入；记录主题应用与资源解码耗时。
2. 黄金样本 Electron 截图矩阵：浅/深 × 三缩放 × 五播放器布局 × 三导航 × 无封面，另加 7 个内置预设各一组。像素差人工复核。
3. 新增 token/mode 的 schema/迁移/回退/导入归档/插件主题/窗口继承全部写入 `node --test` 契约测试。
4. 10k 本地库执行滚动 + 主题切换压测；切换不得使 SongList 失去虚拟化或触发全库重建。
5. 发布候选门禁：`test:themes`、`test:local-perf`、`test:playback-routing`、`test:dsp-graph`、`test:plugins`、`typecheck`；涉及打包再按 `docs/windows-release-gate.md` 执行。
6. 性能门槛建议：单项预览 P95 < 32ms，完整应用 P95 < 100ms。不达标先减样式重算和图片滤镜，不动虚拟列表和播放链路。

---

## 五、依赖顺序与风险

| 顺序约束 | 原因 |
|---|---|
| 先 P0–P1 再开放更多设置 | 没有语义 token，设置会变成无法升级的 CSS 补丁 |
| 先字体/材质，再图标 | 图标风格须建立在稳定的颜色/尺寸/焦点约束上 |
| 先媒体库模式，再播放器布局 | 共用 mode runtime，媒体库更易做性能验证 |
| 播放器布局先三后五（`split`/`minimal` 为 P4 第二切片） | 三种基础布局验收通过后再引入双栏与可见性联动，控制联调面 |
| 内置预设放在 P5（所有 mode 就绪后） | 预设跨 token+mode+可见性三层，任一层未冻结都会导致预设返工 |
| 最后才开放插件 mode | 宿主 mode 未稳定时第三方主题会锁死 API |

| 风险 | 应对 |
|---|---|
| 选项膨胀导致不可用 | 每域"基础/高级"分层 + 可搜索设置 + 每域一键恢复默认 |
| 模糊/渐变/大背景拖慢渲染 | 有界滤镜、"关闭特效"模式、资源尺寸/总量限制、P95 监测 |
| 封面取色低对比或频闪 | 按封面身份缓存、去饱和回退、切歌过渡限时且遵守 reduced-motion |
| 图标包破坏点击区/无障碍 | icon slot 固定语义/尺寸/aria；主题只选族与颜色 |
| 主题影响大库滚动 | 仅 root 变量 + 静态 mode CSS；profile 不进每行响应式对象 |
| 主题导入攻击面 | 沿用归档预检、路径/类型/大小限制、本地资源协议，拒绝远程 URL |

---

## 六、任务落点（文件级）

| 责任 | 位置 |
|---|---|
| schema、token、V1/V2 迁移 | `src/shared/theme.ts` + 测试 |
| 主题库、归档、资源限制、IPC | `src/main/themes/`、`src/main/ipc/`、`src/preload/` |
| Runtime、预览与应用 | `src/renderer/src/stores/useThemeStore.ts`、`extensions/themeRuntime.ts` |
| 编辑器交互 | `components/ThemeStudioPage.vue`、`theme-studio/ThemeStudioPage.css` |
| 各视觉域 CSS | SideMenu、SongList、PlayingMusic、PlayerBar、Equalizer、Mini Player 等组件 |
| 第三方主题 API/脚手架 | `packages/plugin-api`、`packages/create-twilight-plugin`（源码不入主仓库） |

PR 纪律：每个实现 PR 只跨一个视觉域，须含 schema/CSS 变更 + 迁移/回退测试 + 至少两张真实页面截图 + 需运行的门禁命令 + 主题/插件兼容性说明。禁止把 P3–P6 合并成一次"大主题重构"。

---

## 七、首个可交付切片（建议立即启动）

**Phase 0 + Phase 1 的"主题基础补齐"**：token 审计、V2 迁移器、白名单 mode runtime、个性化/材质 12 项生效设置。用户能立即获得更深的颜色/材质/背景/形状定制，同时为图标、媒体库、播放器布局打下不返工的基础。后续每阶段以前一阶段的截图、性能、回退验收通过为启动条件。

**总工期估算**：约 13–16 周（P0:1 + P1:2 + P2:2.5 + P3:2.5 + P4:3.5 + P5:2.5 + P6:2，P7 贯穿）。相比初版增加约 1–1.5 周，来自：P2 的日夜跟随与色板/字体库、P4 的 `split`/`minimal` 两种新布局与缩略图画廊、P5 的 7 预设与快捷入口。
