# 020 — 给动效维度建立门禁

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: MEDIUM
- **Category**: 一致性与 token（AUDIT 第 7 节 Cohesion & tokens）
- **Estimated scope**: 4 个文件（新增 2 个：`themeMotionAudit.test.ts` + `theme-motion-allowlist.json`；修改 2 个：`package.json`、`SideMenu.test.ts`），约 200 行新代码

## Problem

这个仓库的**颜色**维度有硬门禁，**动效**维度一条都没有。结果是曲线和时长可以任意漂移，没有任何自动化手段能发现。而唯一存在的一条反字面量动效断言只覆盖 1 个文件，另有一条门禁在**反方向固化裸曲线**。

### 正面对照：颜色门禁长什么样（本方案要照抄的形态）

```ts
// src/renderer/src/components/themeColorAudit.test.ts:8-13 — 当前
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const rendererRoot = join(repositoryRoot, 'src', 'renderer', 'src')
const allowlist = JSON.parse(
  readFileSync(new URL('./theme-color-allowlist.json', import.meta.url), 'utf8')
) as Record<string, number>
const colorLiteral = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi
```

```ts
// src/renderer/src/components/themeColorAudit.test.ts:100-106 — 当前
test('renderer business styles do not exceed the hard-coded color baseline', () => {
  const actual = collectColorCounts(rendererRoot)
  const regressions = Object.entries(actual)
    .filter(([file, count]) => count > (allowlist[file] ?? 0))
    .map(([file, count]) => `${file}: ${count} > ${allowlist[file] ?? 0}`)
  assert.deepEqual(regressions, [])
})
```

它递归遍历 `src/renderer/src` 下所有 `.css` 与 `.vue`（`.vue` 只取 `<style>` 块内容），数颜色字面量，与 `src/renderer/src/components/theme-color-allowlist.json` 里登记的**每文件配额**比对，`count > 配额` 就红。配额文件当前有 53 个条目；表里没有的文件配额是 0。

### 缺口证据：三个主题相关测试对动效的断言数都是 0

- `src/renderer/src/components/themeColorAudit.test.ts` —— 2 条 test，只扫颜色字面量与「渐变值 token 被当颜色用」。
- `src/renderer/src/components/themeTokenization.test.ts` —— 17 条 test，全部关于 token 布线、预览挂载、插件契约、归档迁移。对 `cubic-bezier|easing|duration` 命中 0；唯一一处含 `animation` 的行是 `:425` 的 `assert.match(previewScheduler, /window\.requestAnimationFrame/)`，与缓动/时长无关。
- `src/renderer/src/utils/themePerformance.test.ts` —— 3 条 test，只测 p95 采样与预算。

**三者对 easing / duration / cubic-bezier 的断言数合计为 0。**

### 唯一有效的反字面量动效门禁只覆盖 1 个文件

```ts
// src/renderer/src/components/onboarding/OnboardingWizard.test.ts:57-62 — 当前
test('scene transitions and cascades use motion tokens, not hardcoded curves', () => {
  assert.match(css, /--te-ease-out-expo/)
  assert.match(css, /--te-ease-spring/)
  assert.match(css, /--te-motion-settle/)
  assert.doesNotMatch(css, /cubic-bezier\(/)
})
```

它管住了它守的那个文件：`OnboardingWizard.css` 是全仓唯一裸 `cubic-bezier(` 计数为 0 的大型样式文件（它的裸时长仍有 74 处 —— 那一维没被守）。有门禁的地方就干净，没门禁的地方就漂移。**这就是要推广到全仓的形态。**

### 反方向的门禁：`SideMenu.test.ts` 把裸曲线钉死了

```ts
// src/renderer/src/components/SideMenu.test.ts:9-24 — 当前（整个文件只有这一个 test）
test('local sidebar opening follows the streaming navigation timing', () => {
  assert.match(sideMenu, /transform 0\.32s var\(--te-ease-soft\),\s*box-shadow 0\.32s;/)
  assert.doesNotMatch(sideMenu, /side-menu-item-in/)
  assert.match(app, /transition: padding-left 0\.32s var\(--te-ease-soft\);/)
  assert.match(
    app,
    /transform 0\.48s cubic-bezier\(0\.16, 1, 0\.3, 1\),\s*filter 0\.42s cubic-bezier\(0\.16, 1, 0\.3, 1\)/
  )
  assert.match(app, /translate3d\(0, 40px, 0\) scale\(0\.99\)/)
  assert.match(
    app,
    /transform 0\.3s cubic-bezier\(0\.4, 0, 0\.2, 1\),\s*filter 0\.28s cubic-bezier\(0\.4, 0, 0\.2, 1\)/
  )
  assert.match(app, /translate3d\(0, -40px, 0\) scale\(0\.99\)/)
  assert.match(playerBarCss, /transition: left 0\.32s var\(--te-ease-soft\);/)
})
```

`:15` 与 `:20` 两行正则逐字锁定了 `App.vue` 的裸曲线。被锁的真实代码是：

```css
/* src/renderer/src/App.vue:1156-1176 — 当前 */
.main-content > .page-down-enter-active,
.main-content > .page-up-enter-active,
.page-down-enter-active,
.page-up-enter-active {
  z-index: 1;
  transition:
    opacity 0.34s ease,
    transform 0.48s cubic-bezier(0.16, 1, 0.3, 1),
    filter 0.42s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.main-content > .page-down-leave-active,
.main-content > .page-up-leave-active,
.page-down-leave-active,
.page-up-leave-active {
  z-index: 0;
  pointer-events: none;
  transition:
    opacity 0.22s ease,
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    filter 0.28s cubic-bezier(0.4, 0, 0.2, 1) !important;
}
```

`cubic-bezier(0.16, 1, 0.3, 1)` 与 `base.css:31` 的 `--te-ease-out-expo` 逐字相同；`cubic-bezier(0.4, 0, 0.2, 1)` 与 `base.css:26` 的 `--te-ease-enter` 逐字相同。这两处**本来就该写 token**，但测试把字面量钉住了：谁去 token 化谁就把测试改红。这是一条把技术债固化成契约的断言。

同一文件 `:12` 与 `:23` 还钉住了两条布局过渡 —— `assert.match(app, /transition: padding-left 0\.32s var\(--te-ease-soft\);/)` 与 `assert.match(playerBarCss, /transition: left 0\.32s var\(--te-ease-soft\);/)`。**那两行归 008 号方案，本方案一个字都不碰。**

### 量化基线（8e34e01 实测）

统计域：`src/renderer/src` 下全部 `.css` 与 `.vue`（`.vue` 只取 `<style>` 块），**先剥掉 `/* */` 注释**。共 122 个样式来源。用的就是本方案第 2 步要写进测试的那几条正则：

| 指标                                                                       | 计数                        |
| -------------------------------------------------------------------------- | --------------------------- |
| `transition`/`animation` 声明中的裸时长字面量（`0.3s` / `160ms` / `.25s`） | **743**（分布在 57 个文件） |
| 同类声明中的 `var(--te-motion-*)` 引用                                     | **373**                     |
| 裸时长占比                                                                 | **66.6%**                   |
| 裸 `cubic-bezier(` 总数                                                    | **34**                      |
| 其中 `base.css` 的 token 定义（合法）                                      | **4**                       |
| 其中产品代码里的裸写（应当归并）                                           | **30**，散在 14 个文件      |
| `transition: all` 生效声明                                                 | **45**                      |

裸时长最集中的 10 个文件：

```
78  src/renderer/src/components/player-bar/PlayerBar.css
74  src/renderer/src/components/onboarding/OnboardingWizard.css
62  src/renderer/src/components/song-list/SongList.css
62  src/renderer/src/components/streaming-page/StreamingPage.css
47  src/renderer/src/components/settings-page/SettingsPage.css
31  src/renderer/src/components/streaming-page/StreamingLoadingStage.vue
28  src/renderer/src/components/streaming-page/StreamingContentHeader.css
27  src/renderer/src/components/LocalDashboard.css
26  src/renderer/src/components/player-bar/HiFiSidebar.css
24  src/renderer/src/components/aggregate-playlist/AggregatePlaylistPage.css
```

裸 `cubic-bezier(` 的全部分布（15 个文件，含 base.css 的 4 条合法定义）：

```
7  src/renderer/src/components/streaming-page/StreamingPage.css
4  src/renderer/src/App.vue
4  src/renderer/src/assets/base.css              ← 合法的 token 定义源
3  src/renderer/src/components/StreamingLibrary.vue
2  src/renderer/src/components/AppNoticeHost.vue
2  src/renderer/src/components/PlayingLyricLine.vue
2  src/renderer/src/components/PluginPage.vue
2  src/renderer/src/components/streaming-page/StreamingContentHeader.css
2  src/renderer/src/mini-player/MiniPlayer.css
1  src/renderer/src/components/EqualizerPage.vue
1  src/renderer/src/components/LyricsAppearanceCustomizer.vue
1  src/renderer/src/components/SideMenu.vue
1  src/renderer/src/components/player-bar/HiFiSidebar.css
1  src/renderer/src/components/player-bar/PlayerBar.css
1  src/renderer/src/components/streaming-page/StreamingDetailStage.css
```

### 最有价值的一条缺口：token 双源分叉没人守

`--te-ease-soft` 有两个互相矛盾的定义源。

```css
/* src/renderer/src/assets/base.css:26-31 — 当前 */
--te-ease-enter: cubic-bezier(0.4, 0, 0.2, 1);
/* Soft = out-quint: fast start, long settling tail (osu!lazer-style motion). */
--te-ease-soft: var(--te-ease-out-quint);
--te-ease-spring: cubic-bezier(0.22, 1.14, 0.36, 1);
--te-ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
--te-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
```

```ts
// src/shared/themeTokens.ts:1697-1706 — 当前
token(
  'motion.soft',
  '--te-ease-soft',
  '柔和缓动',
  'motion',
  'global',
  'easing',
  'cubic-bezier(0.2, 0.8, 0.2, 1)',
  'cubic-bezier(0.2, 0.8, 0.2, 1)'
)
```

base.css 顺着 `--te-ease-out-quint` 解析成 `cubic-bezier(0.22, 1, 0.36, 1)`，themeTokens.ts 的默认值是 `cubic-bezier(0.2, 0.8, 0.2, 1)` —— **不是同一条曲线**。运行时以 themeTokens.ts 胜出，因为主题运行时用 `!important` 注入：

```ts
// src/renderer/src/stores/useThemeStore.ts:452-455 — 当前
const root = Object.entries({ ...themeShellLayoutToCssVariables(shellLayout), ...variables })
  .map(([name, value]) => `  ${name}: ${value} !important;`)
  .join('\n')
```

默认主题的 overrides 为空，所以开箱即用状态下 `--te-ease-soft` 的计算值是 themeTokens.ts 那条。`motion.enter` 是对照组：`base.css:26` 与 `themeTokens.ts:1687-1696` 两边都是 `cubic-bezier(0.4, 0, 0.2, 1)`，逐字一致。**说明这类分叉是可以机械检出的，只是没人检。** 001 号方案负责修这一处分叉；本方案负责让它以后不能再分叉。

### AUDIT 依据

AUDIT 第 7 节 Cohesion & tokens 两条直接命中：

- 「Curves and durations should live as shared tokens. Five hand-typed cubic-beziers that almost match is a consolidation finding.」
- 「Hunt for: duplicated near-identical easings/durations」

## Target

### 目标一：新增门禁测试 + allowlist，三条预算

新增两个文件：

- `src/renderer/src/components/themeMotionAudit.test.ts`
- `src/renderer/src/components/theme-motion-allowlist.json`

allowlist 的形状（比 `theme-color-allowlist.json` 多一层分组，因为要装两张表）：

```json
{
  "curves": { "仓库相对路径": 数字 },
  "durations": { "仓库相对路径": 数字 }
}
```

两张表都是**每文件配额**，键用正斜杠的仓库相对路径，**表里没有的文件配额一律是 0**（这就是「新增文件预算为 0」的实现方式，不需要额外代码）。

**预算 1 —— 裸 `cubic-bezier(` 每文件配额。** 目标状态下 `curves` 只有一个条目：

```json
  "curves": {
    "src/renderer/src/assets/base.css": 4
  }
```

即：除了 token 定义源 `base.css` 的 4 条，全仓产品代码里裸曲线预算为 0。这个目标状态**依赖 004 号方案**（把 30 处裸曲线归并到 token）**和 017 号方案**（删掉 `EqualizerPage.vue:1335-1342` 的死 `:root` 块，那里面有 1 处）先落地。第 1 步会给出「004/017 还没做完」时的替代写法。

**预算 2 —— `transition`/`animation` 声明中的裸时长字面量每文件配额。** 按执行时的实测值逐文件登记为**递减预算**：既不阻塞现状（743 处存量一处都不用改），又能防止继续稀释。8e34e01 上的完整表在第 1 步给出，但**执行时必须用脚本重新生成**（前 19 个方案会改动这些数字，见 Boundaries）。

**预算 3 —— `themeTokens.ts` 的 motion token 默认值与 `base.css` 的对应声明一致。** 遍历 `THEME_TOKEN_DEFINITIONS` 里 `group === 'motion'` 的项，取 `cssVariable`，在 `base.css` 顶部第一个 `:root { … }` 块里找同名声明，把声明值**沿 `var()` 链解析到字面量**后，与该 token 两个 tone（`pureWhite` / `dark`）的默认值比对，三者必须逐字相等。

**这里有两处必须写清的实现前提，写错了门禁就是废的：**

1. **`group === 'motion'` 的 token 只有 2 个** —— `motion.enter` → `--te-ease-enter` 和 `motion.soft` → `--te-ease-soft`。`base.css:26-40` 声明了 13 个动效自定义属性（`--te-ease-enter/soft/spring/out-quint/out-expo`、`--te-motion-press/hover/panel/page/settle/return`、`--te-motion-press-scale/hover-translate`），其中 **11 个在 `themeTokens.ts` 里没有对应 token**，也就不可主题化、不存在双源分叉风险。断言只覆盖那 2 对，**不要反向遍历 base.css 去要求 13 个都有 token**，那会红在一个不存在的问题上。

2. **必须解析 `var()` 链，不能直接比字符串。** `base.css:28` 是 `--te-ease-soft: var(--te-ease-out-quint);` —— 一层间接，不是字面量。001 号方案的目标状态**保留**这层间接（base.css 仍写 `var(--te-ease-out-quint)`，themeTokens.ts 改成字面量 `'cubic-bezier(0.22, 1, 0.36, 1)'`）。所以拿声明原文去和 token 默认值比字符串，**即使 001 做完了也永远是红的**。正确做法是把 `var(--x)` 顺着同一个 `:root` 块再解析一跳，拿到 `cubic-bezier(0.22, 1, 0.36, 1)` 再比。第 2 步的 `resolveVarChain` 就是干这个的。

### 目标二：把 `SideMenu.test.ts:15` 与 `:20` 的曲线字面量断言改成断言 token 名

```ts
// target — src/renderer/src/components/SideMenu.test.ts，只改这两条 assert.match
assert.match(
  app,
  /transform 0\.48s var\(--te-ease-out-expo\),\s*filter 0\.42s var\(--te-ease-out-expo\)/
)
assert.match(app, /transform 0\.3s var\(--te-ease-enter\),\s*filter 0\.28s var\(--te-ease-enter\)/)
```

`:12`（`padding-left`）与 `:23`（`left`）两条**保持原样**。

### 目标三：把新测试登记进 `package.json` 的 `test:themes`

不登记两个后果：一是永远不会被执行，二是 `scripts/feature-test-gates.test.cjs:231` 的 `test('every repository test file is explicitly owned by a package test script')` 会直接红（它扫全仓 `*.test.{ts,cjs,mjs}`，要求每个文件都出现在某个 `test:*` 脚本的命令串里）。**这是硬要求。**

## Repo conventions to follow

- **门禁测试的范式**：`src/renderer/src/components/themeColorAudit.test.ts`（就是上面 Problem 里摘录的那个文件）。递归遍历 + 每文件配额 JSON + `assert.deepEqual(regressions, [])` 报全部违规而不是第一条。**照抄它的 `collectStyleSources` / `readStyles` 结构**（`themeColorAudit.test.ts:109-130`）。
- **allowlist JSON 范式**：`src/renderer/src/components/theme-color-allowlist.json`，扁平 `{"路径": 数字}`，路径正斜杠，2 空格缩进。本方案多包一层 `curves` / `durations`。
- **反字面量断言的范式**：`src/renderer/src/components/onboarding/OnboardingWizard.test.ts:57-62`（上面 Problem 里摘录），`assert.doesNotMatch(css, /cubic-bezier\(/)` 是它的核心手法。
- **导入 token 注册表的写法**照抄 `themeColorAudit.test.ts:6`：
  ```ts
  import { THEME_TOKEN_DEFINITIONS } from '../../../shared/themeTokens.ts'
  ```
  **结尾的 `.ts` 扩展名是必需的**（`--experimental-strip-types` 要求，仓库全都这么写）。
- **`THEME_TOKEN_DEFINITIONS` 每项的结构**（由 `src/shared/themeTokens.ts:14-38` 的 `token()` 辅助函数决定）：`{ id, cssVariable, label, group, surface, kind, defaults: { pureWhite, dark } }`。`group` 的类型 `ThemeTokenGroup` 定义在 `src/shared/theme.ts:74-81`，`'motion'` 是其中一个字面量。
- **测试运行方式**：`node --experimental-strip-types --test <文件列表>`，见 `package.json` 第 23 行的 `test:themes`。
- **动效 token 全住在 `src/renderer/src/assets/base.css:26-40`。本方案不新增任何 token，也不改任何 token 值。**
- **prettier**：`.prettierrc.yaml` 是 `singleQuote: true` / `semi: false` / `printWidth: 100` / `trailingComma: none`。新文件按这个写（单引号、不带分号、行宽 100 内）。

## Steps

一步一个文件，做完一步再进下一步。

### 第 1 步：生成 allowlist JSON

**不要手抄数字。** 把下面这段脚本原样写到 `output/__gen-motion-allowlist.mjs`（`output/` 在 `.gitignore:40` 里，不会进版本库），然后运行它，它会把 allowlist 直接写到位。它用的正则与第 2 步的测试**完全相同** —— 这是保证生成值与门禁读数自洽的唯一办法。

```js
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const rendererRoot = join(repositoryRoot, 'src', 'renderer', 'src')

const BARE_CURVE = /cubic-bezier\(/gi
const MOTION_DECLARATION = /(?:^|[;{])\s*(?:transition|animation)(?:-[a-z-]+)?\s*:\s*([^;}]*)/gi
const DURATION_LITERAL = /(?<![\w.-])\d*\.?\d+m?s(?![\w-])/gi
const MOTION_TOKEN_REF = /var\(\s*--te-motion-[\w-]*/gi

function stripComments(styles) {
  return styles.replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
}
function readStyles(path) {
  const source = readFileSync(path, 'utf8')
  const styles = path.endsWith('.vue')
    ? Array.from(source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), (m) => m[1]).join('\n')
    : source
  return stripComments(styles)
}
function collectStyleSources(directory) {
  const sources = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      sources.push(...collectStyleSources(path))
      continue
    }
    if (extname(entry.name) !== '.css' && extname(entry.name) !== '.vue') continue
    sources.push([relative(repositoryRoot, path).split(/[\\/]/).join('/'), readStyles(path)])
  }
  return sources
}
function countMatches(text, pattern) {
  return Array.from(text.matchAll(new RegExp(pattern.source, pattern.flags))).length
}
function countInMotionDeclarations(styles, pattern) {
  let count = 0
  for (const match of styles.matchAll(new RegExp(MOTION_DECLARATION.source, 'gi'))) {
    count += countMatches(match[1] ?? '', pattern)
  }
  return count
}

const curves = {}
const durations = {}
let totalDurations = 0
let totalTokenRefs = 0
for (const [file, styles] of collectStyleSources(rendererRoot)) {
  const curveCount = countMatches(styles, BARE_CURVE)
  if (curveCount > 0) curves[file] = curveCount
  const durationCount = countInMotionDeclarations(styles, DURATION_LITERAL)
  if (durationCount > 0) durations[file] = durationCount
  totalDurations += durationCount
  totalTokenRefs += countInMotionDeclarations(styles, MOTION_TOKEN_REF)
}
const byKey = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(
  join(repositoryRoot, 'src/renderer/src/components/theme-motion-allowlist.json'),
  JSON.stringify({ curves: byKey(curves), durations: byKey(durations) }, null, 2) + '\n'
)
console.log('durations total', totalDurations, 'files', Object.keys(durations).length)
console.log('var(--te-motion-*) refs', totalTokenRefs)
console.log('bare share', ((totalDurations / (totalDurations + totalTokenRefs)) * 100).toFixed(1))
console.log(
  'curves total',
  Object.values(curves).reduce((a, b) => a + b, 0)
)
console.log('curve files:', Object.keys(curves).length)
```

跑它（Git Bash）：

```bash
node output/__gen-motion-allowlist.mjs
```

**8e34e01 上的参考输出**，用来判断你现在这棵树处于什么状态：

```
durations total 743 files 57
var(--te-motion-*) refs 373
bare share 66.6
curves total 34
curve files: 15
```

**拿到输出后按下面判定，不要跳过：**

- `durations total` **≤ 743** → 正常，前序方案净减少了裸时长。继续。
- `durations total` **> 743** → 前序方案净增加了裸时长。**先停下来报告这个数字和差值**，让人确认是有意的（例如 018 号方案要给设置页开合加过渡，确实会新增几处）再继续。不要自己判断。
- `curves total` **== 4 且 `curve files` == 1**（只剩 `base.css`）→ 004 与 017 已落地，这是目标状态。**手工把生成出来的 `curves` 段改成下面这样**（脚本生成的就是它，核对一下即可）：
  ```json
    "curves": {
      "src/renderer/src/assets/base.css": 4
    }
  ```
- `curves total` **> 4** → 004 和/或 017 还没做完。**这时不要把预算强行写成 0**（那会让新门禁一落地就红）。保留脚本生成的逐文件实测值作为递减预算，并在最终报告里写明：「裸曲线预算目前是 N 个文件的实测值，不是目标状态的 0；004/017 落地后应当收紧成只剩 base.css: 4」。

生成完删掉脚本：

```bash
rm output/__gen-motion-allowlist.mjs
```

作为对照，8e34e01 上生成出来的 `curves` 段是这样的（**仅供核对，不要在 004/017 已落地的情况下抄它**）：

```json
  "curves": {
    "src/renderer/src/App.vue": 4,
    "src/renderer/src/assets/base.css": 4,
    "src/renderer/src/components/AppNoticeHost.vue": 2,
    "src/renderer/src/components/EqualizerPage.vue": 1,
    "src/renderer/src/components/LyricsAppearanceCustomizer.vue": 1,
    "src/renderer/src/components/PlayingLyricLine.vue": 2,
    "src/renderer/src/components/PluginPage.vue": 2,
    "src/renderer/src/components/SideMenu.vue": 1,
    "src/renderer/src/components/StreamingLibrary.vue": 3,
    "src/renderer/src/components/player-bar/HiFiSidebar.css": 1,
    "src/renderer/src/components/player-bar/PlayerBar.css": 1,
    "src/renderer/src/components/streaming-page/StreamingContentHeader.css": 2,
    "src/renderer/src/components/streaming-page/StreamingDetailStage.css": 1,
    "src/renderer/src/components/streaming-page/StreamingPage.css": 7,
    "src/renderer/src/mini-player/MiniPlayer.css": 2
  }
```

`durations` 段在 8e34e01 上有 57 个条目，最大的几个是 `player-bar/PlayerBar.css: 78`、`onboarding/OnboardingWizard.css: 74`、`song-list/SongList.css: 62`、`streaming-page/StreamingPage.css: 62`、`settings-page/SettingsPage.css: 47`。**用脚本生成的，不要手抄。**

### 第 2 步：新建门禁测试

新建 `src/renderer/src/components/themeMotionAudit.test.ts`，内容照抄下面全文。三条 test 互相独立。

```ts
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { THEME_TOKEN_DEFINITIONS } from '../../../shared/themeTokens.ts'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const rendererRoot = join(repositoryRoot, 'src', 'renderer', 'src')
const allowlist = JSON.parse(
  readFileSync(new URL('./theme-motion-allowlist.json', import.meta.url), 'utf8')
) as { curves: Record<string, number>; durations: Record<string, number> }

/** Any `cubic-bezier(` written out by hand. Only base.css may define curves. */
const BARE_CURVE = /cubic-bezier\(/gi

/**
 * A `transition`/`animation` declaration and its value (capture group 1). The
 * optional `-[a-z-]+` tail also picks up the longhands, so moving a duration
 * from `transition:` to `transition-duration:` cannot dodge the budget. Anchored
 * on `;` or `{` so `-webkit-transition` and custom properties whose name merely
 * ends in `transition` do not match.
 */
const MOTION_DECLARATION = /(?:^|[;{])\s*(?:transition|animation)(?:-[a-z-]+)?\s*:\s*([^;}]*)/gi

/** `0.3s`, `160ms`, `.25s`. The lookbehind keeps `--te-motion-0s`-style names out. */
const DURATION_LITERAL = /(?<![\w.-])\d*\.?\d+m?s(?![\w-])/gi

/** The tokenised form of the same thing, counted only to report the ratio. */
const MOTION_TOKEN_REF = /var\(\s*--te-motion-[\w-]*/gi

/**
 * Colour has `themeColorAudit.test.ts`; motion had nothing, and it showed. The
 * one file under a no-bare-curve gate (`OnboardingWizard.css`, guarded by
 * `OnboardingWizard.test.ts:61`) was the only large stylesheet with zero bare
 * curves, while the rest of the renderer had accumulated 30 hand-typed ones —
 * 23 of which were literal copies of a curve that already had a token. Curves
 * belong in the token layer at base.css:26-31.
 */
test('renderer styles do not exceed the bare cubic-bezier baseline', () => {
  const regressions: string[] = []
  for (const [file, styles] of collectStyleSources(rendererRoot)) {
    const budget = allowlist.curves[file] ?? 0
    const count = countMatches(styles, BARE_CURVE)
    if (count > budget) regressions.push(`${file}: ${count} > ${budget}`)
  }
  assert.deepEqual(regressions, [])
})

/**
 * Bare duration literals get a per-file decreasing budget rather than a hard
 * zero: two thirds of the repo's timings bypass the token layer, so a zero
 * budget would be unpayable. A file not listed in the allowlist has a budget of
 * 0, which is what keeps new stylesheets tokenised from the start.
 */
test('renderer styles do not exceed the bare motion duration baseline', () => {
  const regressions: string[] = []
  for (const [file, styles] of collectStyleSources(rendererRoot)) {
    const budget = allowlist.durations[file] ?? 0
    const count = countInMotionDeclarations(styles, DURATION_LITERAL)
    if (count > budget) {
      const tokenised = countInMotionDeclarations(styles, MOTION_TOKEN_REF)
      regressions.push(
        `${file}: ${count} > ${budget} (var(--te-motion-*) refs here: ${tokenised}). ` +
          'Route new timings through the tokens in base.css:32-38, or lower the ' +
          'baseline in theme-motion-allowlist.json if you removed some.'
      )
    }
  }
  assert.deepEqual(regressions, [])
})

/**
 * A token must not have two disagreeing definition sources. `motion.soft`
 * shipped as `cubic-bezier(0.2, 0.8, 0.2, 1)` in themeTokens.ts while base.css
 * resolved it to `cubic-bezier(0.22, 1, 0.36, 1)` — and themeTokens.ts silently
 * won, because useThemeStore injects every token into `:root` with `!important`
 * (useThemeStore.ts:452-455) and the default theme overrides nothing. Nobody can
 * spot that by eye: both files read plausibly on their own. `motion.enter` was
 * the control group, identical on both sides.
 */
test('motion token defaults match their base.css declarations', () => {
  const baseCss = readFileSync(join(rendererRoot, 'assets', 'base.css'), 'utf8')
  const declarations = rootDeclarations(baseCss)
  const motionTokens = THEME_TOKEN_DEFINITIONS.filter((definition) => definition.group === 'motion')
  // Guards against the filter silently matching nothing after a rename.
  assert.ok(motionTokens.length > 0, 'no motion-group tokens found in THEME_TOKEN_DEFINITIONS')

  const mismatches: string[] = []
  for (const definition of motionTokens) {
    const declared = declarations.get(definition.cssVariable)
    if (declared === undefined) {
      mismatches.push(`${definition.cssVariable} (${definition.id}) is not declared in base.css`)
      continue
    }
    const resolved = resolveVarChain(declared, declarations)
    for (const tone of ['pureWhite', 'dark'] as const) {
      const expected = definition.defaults[tone]
      if (resolved !== expected) {
        mismatches.push(
          `${definition.cssVariable} (${definition.id}, ${tone}): base.css resolves to ` +
            `"${resolved}", themeTokens.ts default is "${expected}"`
        )
      }
    }
  }
  assert.deepEqual(mismatches, [])
})

/** Every renderer stylesheet as `[repo-relative path, comment-free style text]`. */
function collectStyleSources(directory: string): Array<[string, string]> {
  const sources: Array<[string, string]> = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      sources.push(...collectStyleSources(path))
      continue
    }
    if (extname(entry.name) !== '.css' && extname(entry.name) !== '.vue') continue
    sources.push([relative(repositoryRoot, path).split(/[\\/]/).join('/'), readStyles(path)])
  }
  return sources
}

function readStyles(path: string): string {
  const source = readFileSync(path, 'utf8')
  const styles = path.endsWith('.vue')
    ? Array.from(source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), (m) => m[1]).join('\n')
    : source
  return stripComments(styles)
}

/** Comments hold prose and example values; counting them would be noise. */
function stripComments(styles: string): string {
  return styles.replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
}

/** Fresh RegExp per call: a shared `g` regex would carry `lastIndex` over. */
function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(new RegExp(pattern.source, pattern.flags))).length
}

function countInMotionDeclarations(styles: string, pattern: RegExp): number {
  let count = 0
  for (const match of styles.matchAll(new RegExp(MOTION_DECLARATION.source, 'gi'))) {
    count += countMatches(match[1] ?? '', pattern)
  }
  return count
}

/**
 * Custom properties from base.css's first `:root { … }` block — the
 * unconditional one at the top. Tone-specific blocks further down are out of
 * scope on purpose: the motion tokens are declared once, tone-independently.
 */
function rootDeclarations(css: string): Map<string, string> {
  const start = css.indexOf(':root {')
  assert.ok(start >= 0, 'base.css has no top-level :root block')
  const end = css.indexOf('\n}', start)
  assert.ok(end > start, 'base.css :root block is not terminated')
  const declarations = new Map<string, string>()
  for (const match of stripComments(css.slice(start, end)).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1], match[2].trim())
  }
  return declarations
}

/**
 * `--te-ease-soft: var(--te-ease-out-quint)` must be followed one hop further
 * before it can be compared with a literal token default. Bounded so a cyclic
 * definition cannot hang the test.
 */
function resolveVarChain(value: string, declarations: Map<string, string>): string {
  let current = value.trim()
  for (let hop = 0; hop < 8; hop += 1) {
    const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(current)
    if (!alias) return current
    const next = declarations.get(alias[1])
    if (next === undefined) return current
    current = next.trim()
  }
  return current
}
```

### 第 3 步：登记进 `package.json`

打开 `package.json`，找到第 23 行的 `"test:themes"`。在它命令串里的

```
src/renderer/src/components/themeColorAudit.test.ts src/renderer/src/components/themeTokenization.test.ts
```

这两个路径之间插入新测试，改成：

```
src/renderer/src/components/themeColorAudit.test.ts src/renderer/src/components/themeMotionAudit.test.ts src/renderer/src/components/themeTokenization.test.ts
```

**只加这一个路径，不要改这一行的其他任何部分**（`scripts/feature-test-gates.test.cjs:172-178` 的 `test('theme gate owns contracts, archive preflight, and navigation integration')` 会逐个断言原有文件仍在，也断言这一行以 `node --experimental-strip-types --test ` 开头）。

### 第 4 步：先跑新门禁，确认预算 1、2 是绿的

```bash
node --experimental-strip-types --test src/renderer/src/components/themeMotionAudit.test.ts
```

预期：

- `renderer styles do not exceed the bare cubic-bezier baseline` —— **通过**。
- `renderer styles do not exceed the bare motion duration baseline` —— **通过**。
- `motion token defaults match their base.css declarations` —— **取决于 001 号方案是否已完成**：
  - 001 已完成 → **通过**。
  - 001 未完成 → **失败**，报两条 mismatch（`--te-ease-soft` 的 pureWhite 与 dark），内容形如：
    ```
    --te-ease-soft (motion.soft, pureWhite): base.css resolves to
    "cubic-bezier(0.22, 1, 0.36, 1)", themeTokens.ts default is "cubic-bezier(0.2, 0.8, 0.2, 1)"
    ```
    **这是预期的，不是你写错了。** 见 Boundaries 第一条：先去执行 001。

如果预算 1 或 2 红了，说明第 1 步的 allowlist 与第 2 步的测试读数不一致（两边正则必须逐字相同）。**不要靠调大配额去糊过去** —— 回到第 1 步重新生成。

### 第 5 步：改 `SideMenu.test.ts` 的两条曲线断言

打开 `src/renderer/src/components/SideMenu.test.ts`。

先确认 `App.vue` 现在写的是什么：

```bash
grep -n "cubic-bezier\|var(--te-ease-out-expo)\|var(--te-ease-enter)" src/renderer/src/App.vue
```

- **如果输出里已经是 `var(--te-ease-out-expo)` / `var(--te-ease-enter)`**（004 号方案已落地，它的 Step 3 也会顺手改这两条断言）→ 打开 `SideMenu.test.ts` 核对 `:13-21` 是否已经是 token 形式。**如果已经是，本步骤是空操作，跳过，并在报告里写明「第 5 步无需改动，004 已完成」。**
- **如果还是 `cubic-bezier(0.16, 1, 0.3, 1)` 字面量** → 按下面改。

把这一段（原 `:13-16`）

```ts
assert.match(
  app,
  /transform 0\.48s cubic-bezier\(0\.16, 1, 0\.3, 1\),\s*filter 0\.42s cubic-bezier\(0\.16, 1, 0\.3, 1\)/
)
```

改成

```ts
assert.match(
  app,
  /transform 0\.48s var\(--te-ease-out-expo\),\s*filter 0\.42s var\(--te-ease-out-expo\)/
)
```

把这一段（原 `:18-21`）

```ts
assert.match(
  app,
  /transform 0\.3s cubic-bezier\(0\.4, 0, 0\.2, 1\),\s*filter 0\.28s cubic-bezier\(0\.4, 0, 0\.2, 1\)/
)
```

改成

```ts
assert.match(app, /transform 0\.3s var\(--te-ease-enter\),\s*filter 0\.28s var\(--te-ease-enter\)/)
```

**同一文件里这三行一个字都不要动**：`:10`（`sideMenu` 的 `transform 0.32s var(--te-ease-soft)`）、`:12`（`transition: padding-left 0.32s var(--te-ease-soft);`）、`:23`（`transition: left 0.32s var(--te-ease-soft);`）。后两条归 008 号方案。

**改完这一步，如果 `App.vue` 还是字面量，`SideMenu.test.ts` 会立刻变红** —— 断言要 token，代码给字面量。这时说明 004 号方案还没做，**回退这一步的改动**（`git checkout -- src/renderer/src/components/SideMenu.test.ts`），在报告里写明「第 5 步已回退，等 004 落地后再做」。**不要为了让它变绿而自行去改 `App.vue`** —— `App.vue` 的曲线 token 化归 004 号方案。

### 第 6 步：跑完整验证

见下面 Verification 段。

## Boundaries

- **预算 3 依赖 001 号方案先修完 `motion.soft` 的分叉。** 001 会把 `src/shared/themeTokens.ts:1704-1705` 的两个默认值改成 `'cubic-bezier(0.22, 1, 0.36, 1)'`。**若 001 未完成，第 3 条断言会失败 —— 这是预期的，先去执行 001。** 不要为了让它变绿而自己改 `themeTokens.ts` 或 `base.css`：那是 001 的范围，值选哪一条也是 001 论证过的（选 out-quint，因为 base.css 的注释是唯一记录了设计意图的地方）。如果你在 001 之前交付本方案，必须在报告里写明「预算 3 当前为红，等 001 落地转绿」。
- **`SideMenu.test.ts` 是三个方案的交汇点，本方案只碰 `:15` 与 `:20` 两行正则里的曲线字面量。**
  - `:12` 的 `transition: padding-left …` 与 `:23` 的 `transition: left …` 归 **008 号方案**（它要把布局过渡改成 transform）。本方案不碰。
  - `:15` / `:20` 的曲线字面量 **004 号方案的 Step 3 也会改**（它把 `App.vue` 的裸曲线换成 token，不同步改断言就会红）。004 在本方案之前执行，所以到你这里很可能已经是 token 形式了 —— 第 5 步给了空操作分支，按那里判断。**两个方案改的是同一处、目标写法相同，不冲突，但不要重复改。**
- **本方案是全部 20 个方案里最后执行的一个。** 预算数字必须反映前 19 个方案落地后的状态，所以第 1 步用脚本重新测定，不要手抄本文档里 8e34e01 的数字。文档里的 743 / 373 / 34 只是参照点，用来判断你这棵树相对基线是变好还是变差了。
- **不要改任何样式文件。** 本方案是纯门禁：新增 1 个测试 + 1 个 JSON，修改 `package.json` 1 行 + `SideMenu.test.ts` 2 处。裸曲线归并归 004，`transition: all` 归 005，死块删除归 017。
- **不要改 `themeColorAudit.test.ts` 或 `theme-color-allowlist.json`。** 颜色门禁与本方案无关。
- **不要改 `OnboardingWizard.test.ts:57-62`。** 那条断言继续留着，它比全仓预算更严（那个文件是 0 裸曲线），是好事。
- **不要为了让预算变绿而调大配额。** 配额只能由「实际删掉了裸写」来降低。
- **不要新增依赖**，不要引入 stylelint / postcss 之类的工具。门禁用 `node --test` + 正则，与仓库既有形态一致。
- **不要跑 `pnpm run format`。** prettier 在 HEAD 上有基线漂移（多个无关文件会被顺带重排）。要检查自己的文件用 `npx prettier --check <file>`；要看它想改哪儿用 `npx prettier <file> | diff -u <file> -`，只采纳落在自己新增行上的改动。
- 如果某一步与你看到的代码不符（行号漂移、断言内容不是文档描述的样子），**停下来报告，不要即兴发挥**。

## Verification

### Mechanical

按顺序跑，每条都给了判定标准。

1. **新门禁本身**

   ```bash
   node --experimental-strip-types --test src/renderer/src/components/themeMotionAudit.test.ts
   ```

   判定：输出里有且仅有 3 条 test。预算 1、2 必须 `pass`。预算 3 —— 001 已完成则 `pass`；未完成则 `fail` 且失败信息里**只有 `--te-ease-soft` 的两条**（pureWhite + dark）。**若出现第三条 mismatch，说明有新的 motion token 分叉，报告它，不要自己改值。**

2. **登记生效**

   ```bash
   grep -c "themeMotionAudit.test.ts" package.json
   pnpm run test:themes 2>&1 | grep -c "bare cubic-bezier baseline"
   ```

   判定：第一条输出 `1`；第二条输出 `≥ 1`。**如果 `test:themes` 的输出里找不到新测试的 test 名，说明第 3 步没生效，回去检查。** 这是验证登记的唯一手段。

3. **测试文件所有权门禁**

   ```bash
   node --test scripts/feature-test-gates.test.cjs
   ```

   判定：`every repository test file is explicitly owned by a package test script` 与 `theme gate owns contracts, archive preflight, and navigation integration` 两条都 `pass`。前者证明新文件已被某个 `test:*` 拥有，后者证明你没在改 `test:themes` 时弄掉别的路径。

4. **`SideMenu.test.ts` 所属套件**（注意：它归 `test:playback-routing`，**不是** `test:app`）

   ```bash
   node --experimental-strip-types --test src/renderer/src/components/SideMenu.test.ts
   ```

   判定：`pass`。若红在两条 `assert.match` 上，说明 `App.vue` 还是字面量（004 未落地）—— 按第 5 步的指示回退本方案对该文件的改动。

5. **类型与格式**

   ```bash
   pnpm run typecheck
   npx prettier --check src/renderer/src/components/themeMotionAudit.test.ts src/renderer/src/components/theme-motion-allowlist.json
   npx eslint src/renderer/src/components/themeMotionAudit.test.ts
   ```

   判定：三条都通过。新测试只用了 `ThemeTokenDefinition` 的 `group` / `cssVariable` / `defaults` 三个既有字段（`src/shared/theme.ts:85-92`），不应有类型错误。`src/renderer/src/**/*` 已被 `tsconfig.web.json` 覆盖，与 `themeColorAudit.test.ts` 同目录同待遇。

6. **相邻套件不受影响**

   ```bash
   pnpm run test:themes
   pnpm run test:app
   pnpm run test:playback-routing
   ```

   判定：**不要求全绿，要求「不新增失败」。** 跑之前先在干净工作树上记一次基线（`git stash` 前后各跑一次，或用 `git show HEAD:<file>` 取 HEAD 版测试到同目录跑），只对比新增的失败项。本方案**有意**可能新增 1 条失败（预算 3，在 001 未完成时），其余套件的红灯数必须与基线一致。`test:app` 里的 `useMotionPreference.test.ts` 会读 `base.css` 并断言 `--te-ease-spring` 等内容（`:43`、`:61-62`），本方案不碰 base.css，应保持基线。

7. **不需要跑的**：`pnpm run build`。本方案不改任何进产物的代码（只有测试、JSON、`package.json` 的脚本串），构建产物零变化。

### Feel check

本方案没有渲染影响 —— 它不改任何一条 CSS 声明。所以没有可看的动效变化。**要检查的是门禁本身有效**，用两个人为回归试它，试完必须还原：

1. **试预算 1**：往 `src/renderer/src/components/song-list/SongList.css` 末尾临时加一行

   ```css
   .te-gate-probe {
     transition: transform 0.3s cubic-bezier(0.1, 0.2, 0.3, 0.4);
   }
   ```

   跑第 1 条命令。判定：`bare cubic-bezier baseline` 变红，失败信息含 `song-list/SongList.css: 1 > 0`（或 `N+1 > N`）。**删掉这行**，确认转绿。

2. **试预算 2**：往同一个文件末尾临时加一行

   ```css
   .te-gate-probe-2 {
     transition: opacity 0.42s ease;
   }
   ```

   跑第 1 条命令。判定：`bare motion duration baseline` 变红，失败信息含该文件的 `count > budget` 与括号里的 `var(--te-motion-*) refs here: N`。**删掉这行**，确认转绿。

3. **试预算 3**（若 001 已完成）：把 `src/shared/themeTokens.ts` 里 `motion.enter` 的 `pureWhite` 默认值临时改成 `'cubic-bezier(0.4, 0, 0.2, 0.9)'`。跑第 1 条命令。判定：报 `--te-ease-enter (motion.enter, pureWhite): base.css resolves to "cubic-bezier(0.4, 0, 0.2, 1)", themeTokens.ts default is "cubic-bezier(0.4, 0, 0.2, 0.9)"`。**改回去**，确认转绿。

试完务必 `git diff` 确认这三处临时改动都已还原，工作树只剩本方案的 4 个文件。

### Done when

- `src/renderer/src/components/themeMotionAudit.test.ts` 与 `src/renderer/src/components/theme-motion-allowlist.json` 存在，后者是 `{ "curves": {...}, "durations": {...} }` 两张每文件配额表。
- `grep -c "themeMotionAudit.test.ts" package.json` 输出 `1`。
- `pnpm run test:themes` 的输出里出现这三条 test 名：`renderer styles do not exceed the bare cubic-bezier baseline`、`renderer styles do not exceed the bare motion duration baseline`、`motion token defaults match their base.css declarations`。
- `node --test scripts/feature-test-gates.test.cjs` 全绿。
- `grep -n "cubic-bezier" src/renderer/src/components/SideMenu.test.ts` **无输出**。
- `grep -n "transition: padding-left 0" src/renderer/src/components/SideMenu.test.ts` **仍有 1 处命中**（证明 008 的地盘没被误改）。
- 上面 Feel check 的三个人为回归都能被对应预算抓住，且改动已还原。
- `pnpm run typecheck` 通过；`npx prettier --check` 对两个新文件通过。
- 相对基线**没有新增失败**，唯一允许的例外是「001 未完成时预算 3 为红」，且这一条必须写进最终报告。
