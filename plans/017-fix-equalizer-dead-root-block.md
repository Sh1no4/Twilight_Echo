# 017 — 删掉 EqualizerPage 的死 `:root` 块，把 8 处 `var(--transition)` 换成显式属性清单

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: HIGH
- **Category**: 一致性与 token（AUDIT 第 7 节 Cohesion & tokens；显式属性清单部分依据第 5 节 Performance）
- **Estimated scope**: 2 个文件（`src/renderer/src/components/EqualizerPage.vue`、`src/renderer/src/components/equalizer/OpraEqPanel.vue`），1 处删除 + 8 处 `transition` 改写，纯 CSS 改动（不动模板、不动脚本）

## Problem

`EqualizerPage.vue` 在 `<style scoped>` 里写了一个 `:root` 块。Vue 的 scoped 编译会给这个选择器加上组件的作用域属性，编译产物是 `[data-v-xxxxxxx]:root`。这个选择器要求 `<html>` 元素**自己**带有该作用域属性，而 Vue 只把作用域属性写在组件的根节点上（`<html>` 永远不是任何组件的根节点），所以**整块规则永不匹配，是死代码**。

块里定义的 `--transition` 是全仓唯一的定义源，却有 8 处消费它。定义死了，8 处 `transition: var(--transition)` 全部拿不到值 —— 自定义属性未定义时 `var()` 让整条声明 **invalid at computed-value time**，`transition` 退回初始值 `all 0s ease`，也就是**完全没有过渡**。这 8 个控件的 hover / focus / active 全是瞬跳。

### 死块本体

```css
/* src/renderer/src/components/EqualizerPage.vue:1335-1342 — 当前 */
:root {
  --te-primary-500: #6366f1;
  --te-primary-rgb: 99, 102, 241;
  --te-neutral-900: #1e293b;
  --te-neutral-500: #64748b;
  --te-ease-soft: cubic-bezier(0.4, 0, 0.2, 1);
  --transition: all 0.3s var(--te-ease-soft);
}
```

这个块位于 `<style scoped>` 内 —— `<style scoped>` 的起始行是 `src/renderer/src/components/EqualizerPage.vue:1134`，文件共 1837 行，只有这一个 `<style>` 块，且带 `scoped`。

**已用仓库自带的 `@vue/compiler-sfc`（版本 3.5.33）实测编译过**，`compileStyle({ source, scoped: true, id: 'data-v-deadbee' })` 的输出是：

```css
[data-v-deadbee]:root {
  --te-primary-500: #6366f1;
  --te-ease-soft: cubic-bezier(0.4, 0, 0.2, 1);
  --transition: all 0.3s var(--te-ease-soft);
}
.nav-item[data-v-deadbee] { transition: var(--transition);
}
```

注意两件事：属性选择器被加在 `:root` **前面**（`[data-v-deadbee]:root`，即「同时是 `:root` 又带该属性的元素」），而普通类选择器的属性是加在**后面**（`.nav-item[data-v-deadbee]`）。前者永不匹配，后者正常工作 —— 所以消费方存在、定义方不存在。

### `--transition` 全仓只有这一个定义源

已确认：没有任何其他 `.css` 或 `.vue` 定义 `--transition`，没有 `setProperty('--transition'` 的运行时注入，主题 token 注册表 `src/shared/themeTokens.ts` 里也没有名为 `--transition` 的 token。唯一定义就是上面那行 `EqualizerPage.vue:1341`。

### 8 处消费点（全部已逐行读出）

`src/renderer/src/components/EqualizerPage.vue`：

```css
/* :1375-1384 — 当前（.nav-item，EQ 页左侧导航项） */
.nav-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 16px;
  cursor: pointer;
  transition: var(--transition);
  color: var(--te-neutral-500);
}
.nav-item:hover {
  background: var(--te-hover-bg);
  color: var(--te-neutral-900);
}
.nav-item.active {
  background: var(--te-active-bg);
  color: var(--te-primary-500);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
  border: 1px solid var(--te-card-border);
}
```

```css
/* :1395-1409 — 当前（.nav-item i，导航项的图标底板） */
.nav-item i {
  font-size: 1.2rem;
  background: var(--te-subtle-bg);
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  transition: var(--transition);
}
.nav-item.active i {
  background: rgba(var(--te-primary-rgb), 0.1);
  color: var(--te-primary-500);
}
```

```css
/* :1602-1622 — 当前（.band-tab，频段标签） */
.band-tab {
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid var(--te-card-border);
  background: var(--te-card-bg);
  font-size: 13px;
  font-weight: 700;
  color: var(--te-neutral-500);
  cursor: pointer;
  transition: var(--transition);
}
.band-tab:hover {
  background: var(--te-hover-bg);
  color: var(--te-neutral-900);
}
.band-tab.active {
  background: var(--te-active-bg);
  color: var(--te-primary-500);
  border-color: var(--te-active-bg);
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.15);
}
```

`src/renderer/src/components/equalizer/OpraEqPanel.vue`（独立 SFC，`<style scoped>` 起始行 `:152`，文件共 396 行）：

```css
/* :189-217 — 当前（.opra-action-btn，OPRA 抽屉的展开按钮） */
.opra-action-btn {
  background: rgba(15, 23, 42, 0.04);
  border: none;
  padding: 10px 20px;
  border-radius: 10px;
  font-weight: 700;
  color: var(--te-neutral-900);
  cursor: pointer;
  transition: var(--transition);
  display: flex;
  align-items: center;
  gap: 8px;
}
.opra-action-btn i {
  font-size: 10px;
  transition: transform 0.4s var(--te-ease-soft);
}
.opra-action-btn:hover {
  background: var(--te-subtle-bg);
  transform: translateY(-2px);
}
.opra-action-btn.active {
  background: var(--te-info-soft-bg);
  color: var(--te-info-soft-fg);
  transform: translateY(0);
}
```

```css
/* :255-271 — 当前（.opra-search-input-wrap input，OPRA 搜索框） */
.opra-search-input-wrap input {
  width: 100%;
  padding: 12px 16px 12px 40px;
  border-radius: 12px;
  border: 1px solid var(--te-card-border);
  background: var(--te-card-bg);
  font-family: inherit;
  font-size: 14px;
  color: var(--te-neutral-900);
  outline: none;
  transition: var(--transition);
  font-weight: 500;
}
.opra-search-input-wrap input:focus {
  border-color: var(--te-primary-500);
  box-shadow: 0 0 0 3px rgba(var(--te-primary-rgb), 0.1);
}
```

```css
/* :272-286 — 当前（.opra-refresh，OPRA 刷新按钮） */
.opra-refresh {
  background: var(--te-card-bg);
  border: 1px solid var(--te-card-border);
  padding: 11px 20px;
  border-radius: 12px;
  font-weight: 700;
  color: var(--te-neutral-900);
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(15, 23, 42, 0.02);
  transition: var(--transition);
}
.opra-refresh:hover {
  background: var(--te-hover-bg);
  border-color: var(--te-active-bg);
}
```

```css
/* :307-322 — 当前（.opra-result-item，OPRA 搜索结果卡片） */
.opra-result-item {
  background: var(--te-card-bg);
  border: 1px solid var(--te-card-border);
  padding: 16px;
  border-radius: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: var(--transition);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.02);
}
.opra-result-item:hover {
  border-color: rgba(99, 102, 241, 0.3);
  box-shadow: 0 8px 16px rgba(99, 102, 241, 0.08);
  transform: translateY(-2px);
}
```

```css
/* :346-359 — 当前（.result-apply，结果卡片上的「应用」按钮） */
.result-apply {
  background: rgba(99, 102, 241, 0.1);
  color: var(--te-primary-500);
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  transition: var(--transition);
}
.result-apply:hover {
  background: var(--te-primary-500);
  color: #fff;
}
```

### 附带的好消息（避免误判，执行者必读）

死块里那行 `--te-ease-soft: cubic-bezier(0.4, 0, 0.2, 1);` 是对全局 token 的局部覆盖 —— **它同样是死的**。所以：

- **EQ 页的 `--te-ease-soft` 并没有被换成弱 Material 曲线**，全局值（`base.css:28` 的 `--te-ease-soft: var(--te-ease-out-quint)`，即 `cubic-bezier(0.22, 1, 0.36, 1)`）在 EQ 页照常生效。
- `EqualizerPage.vue:1437` 的 `animation: fadeIn 0.4s var(--te-ease-soft);` 拿到的是全局运行时值，**它是正常的，不要动它**。
- 同理 `OpraEqPanel.vue:204` 的 `transition: transform 0.4s var(--te-ease-soft);` 也是正常的，**不要动**。

也就是说这个死块造成的实际损失**只有 `--transition` 悬空这一项**。删除死块不会改变任何目前生效的视觉，只会顺带让那 4 个硬编码色值覆盖（`--te-primary-500: #6366f1` 等）彻底消失 —— 它们本来也是死的，删掉即自动修正。

### 还有一层不该有的跨组件耦合

`OpraEqPanel.vue` 是独立的 SFC（由 `EqualizerPage.vue:7` `import OpraEqPanel from './equalizer/OpraEqPanel.vue'` 引入、`:1003` 处渲染）。它那 5 处 `var(--transition)` 依赖的是 `EqualizerPage` 私有 `<style scoped>` 里定义的变量 —— **即使那个 `:root` 块改成全局也是错的设计**：一个组件的样式不该依赖另一个组件的私有变量。所以正确修法不是「把死块救活」，而是删块 + 各组件各自写显式清单。

### AUDIT 依据

- 第 5 节 Performance：「**`transition: all`** animates unintended properties off-GPU — always a finding」。`--transition` 的值就是 `all 0.3s …`，所以**即使把它救活也是一条违规**。新清单必须是显式属性列表，**禁止用 `all`**。
- 第 2 节 Easing & duration 的时长预算：hover / 颜色变化属于「Button press feedback 100–160ms」这一档的量级，原来那个 `0.3s` 对 hover 偏长。新值统一收进 `var(--te-motion-hover)`（`160ms`，`base.css:33`）。
- 第 2 节的缓动决策：「Hover / color change → `ease`」，仓库对应的 token 是 `--te-ease-soft`。

## Target

**第一部分：删掉整个 `:root` 块。**

```css
/* target — src/renderer/src/components/EqualizerPage.vue:1335-1342 整块删除，不留空壳、不留注释 */
```

删掉后，`:1333` 的 `}`（`.preset-create button:disabled` 的收尾）与原 `:1344` 的 `* {` 之间只保留一个空行。

**第二部分：8 处 `transition: var(--transition)` 换成显式属性清单。**

分两种清单，按该选择器实际有状态差异的属性来选。

清单 A（只有颜色类差异 —— `background` / `color` / `border-color`），用于 6 处：

```css
/* target */
  transition:
    background-color var(--te-motion-hover) var(--te-ease-soft),
    color var(--te-motion-hover) var(--te-ease-soft),
    border-color var(--te-motion-hover) var(--te-ease-soft);
```

清单 B（颜色类差异 + `transform` 位移），用于 2 处（`OpraEqPanel.vue` 的 `.opra-action-btn` 与 `.opra-result-item`）：

```css
/* target */
  transition:
    transform var(--te-motion-hover) var(--te-ease-soft),
    background-color var(--te-motion-hover) var(--te-ease-soft),
    color var(--te-motion-hover) var(--te-ease-soft),
    border-color var(--te-motion-hover) var(--te-ease-soft);
```

**不许出现在新清单里的属性**：`all`、`box-shadow`、`filter`、`backdrop-filter`、`width`、`height`、`left`、`right`、`top`、`bottom`、`padding`、`margin`、`gap`、`background`（简写形式）、`font-weight`、`font-size`、`outline`。

`box-shadow` 被有意丢弃（`.nav-item.active`、`.band-tab.active`、`.opra-search-input-wrap input:focus`、`.opra-result-item:hover` 都改了阴影）—— 阴影是 paint 成本最高的一项，hover 尺度上看不出插值差别，按 AUDIT 第 5 节让它瞬时切换。

**不新增任何 token。** `--te-motion-hover` 与 `--te-ease-soft` 都已存在于 `src/renderer/src/assets/base.css:26-40`。

## Repo conventions to follow

- 动效 token 全住在 `src/renderer/src/assets/base.css:26-40`。本方案要用到的两个：`--te-motion-hover: 160ms;`（`:33`）、`--te-ease-soft: var(--te-ease-out-quint);`（`:28`，解析为 `cubic-bezier(0.22, 1, 0.36, 1)`）。**本方案不新增、不修改任何 token。**
- 显式多属性清单的仓库样板 —— `src/renderer/src/components/settings-page/SettingsPage.css:1116-1119`：
  ```css
  .toggle-switch {
    transition:
      background var(--te-motion-panel) var(--te-ease-soft),
      box-shadow var(--te-motion-panel) var(--te-ease-soft),
      scale var(--te-motion-hover) var(--te-ease-soft);
  }
  ```
  排版规则照抄：`transition:` 单独一行，每个属性一行、两级缩进（相对 `transition:` 多两个空格）、除最后一项外行尾加逗号。prettier 会这样格式化。
- 单属性时写一行即可 —— 样板 `src/renderer/src/components/equalizer/OpraEqPanel.vue:204`：`transition: transform 0.4s var(--te-ease-soft);`。本方案的 8 处都是多属性，不会用到单行形式。
- **绝不要为了「救活」这个块而改成 `:global(:root)` 或把变量搬进 base.css。** `--transition` 的值是 `all …`，本身违反 AUDIT 第 5 节；而且跨组件共享私有变量是设计问题。正确做法就是删除定义 + 各处写显式清单。

## Steps

一步一个具体编辑。做完一步再做下一步。

1. **删除死块。** 打开 `src/renderer/src/components/EqualizerPage.vue`，定位第 1335-1342 行，删除这 8 行（含 `:root {` 与其配对的 `}`）：
   ```css
   :root {
     --te-primary-500: #6366f1;
     --te-primary-rgb: 99, 102, 241;
     --te-neutral-900: #1e293b;
     --te-neutral-500: #64748b;
     --te-ease-soft: cubic-bezier(0.4, 0, 0.2, 1);
     --transition: all 0.3s var(--te-ease-soft);
   }
   ```
   删除后紧邻的上文是 `.preset-create button:disabled { … }` 的收尾 `}`，紧邻的下文是 `* {`。两者之间保留一个空行。**不要**在原位留注释、不要留空的 `:root {}`。

2. **`EqualizerPage.vue` 的 `.nav-item`（原第 1382 行）。** 把
   ```css
     transition: var(--transition);
   ```
   替换为清单 A：
   ```css
     transition:
       background-color var(--te-motion-hover) var(--te-ease-soft),
       color var(--te-motion-hover) var(--te-ease-soft),
       border-color var(--te-motion-hover) var(--te-ease-soft);
   ```
   （注意：删除第 1 步的 8 行后，这一行的行号会从 1382 变成 1374。按选择器 `.nav-item` 定位，不要死盯行号。这一条是 `.nav-item` 规则块里、`cursor: pointer;` 之后、`color: var(--te-neutral-500);` 之前的那一行。）

3. **`EqualizerPage.vue` 的 `.nav-item i`（原第 1404 行）。** 同样替换为清单 A。这一条在 `.nav-item i` 规则块里、`border-radius: 10px;` 之后、块收尾 `}` 之前。

4. **`EqualizerPage.vue` 的 `.band-tab`（原第 1611 行）。** 同样替换为清单 A。这一条在 `.band-tab` 规则块里、`cursor: pointer;` 之后、块收尾 `}` 之前。

5. **`OpraEqPanel.vue` 的 `.opra-action-btn`（第 197 行）。** 这一条 hover 会改 `transform: translateY(-2px)`，用清单 B：
   ```css
     transition:
       transform var(--te-motion-hover) var(--te-ease-soft),
       background-color var(--te-motion-hover) var(--te-ease-soft),
       color var(--te-motion-hover) var(--te-ease-soft),
       border-color var(--te-motion-hover) var(--te-ease-soft);
   ```
   **不要动同规则块下方 `:204` 的 `.opra-action-btn i { transition: transform 0.4s var(--te-ease-soft); }`** —— 那条是箭头旋转，值有效且不在本方案范围。

6. **`OpraEqPanel.vue` 的 `.opra-search-input-wrap input`（第 265 行）。** focus 只改 `border-color` 与 `box-shadow`，用清单 A。

7. **`OpraEqPanel.vue` 的 `.opra-refresh`（第 281 行）。** hover 改 `background` 与 `border-color`，用清单 A。

8. **`OpraEqPanel.vue` 的 `.opra-result-item`（第 315 行）。** hover 会改 `transform: translateY(-2px)`，用清单 B。

9. **`OpraEqPanel.vue` 的 `.result-apply`（第 354 行）。** hover 改 `background` 与 `color`，用清单 A。

10. **收尾核对。** 在仓库根跑 `grep -rn "var(--transition)" src/ resources/` 与 `grep -rn -- "--transition:" src/ resources/`，两条命令都应当**零命中**。

## Boundaries

- **不要动 `src/renderer/src/components/EqualizerPage.vue` 的第 1148、1198、1277、1306 行。** 这 4 行是 `transition: all 0.2s;` / `transition: all 0.3s var(--te-ease-soft);` 形式的裸 `all`，归 **005 号方案**（`transition: all` 专项）。两个方案会碰同一个文件但不碰同一行 —— 本方案只处理 `:root` 死块与 8 处 `var(--transition)`，005 号方案只处理那 4 行裸 `all`。**如果发现那 4 行已经被 005 号方案改成显式清单了，正常，跳过、不要回改。**
- **第 1340 行那行裸曲线 `--te-ease-soft: cubic-bezier(0.4, 0, 0.2, 1);` 随死块一起删除即可。** 004 号方案（裸 `cubic-bezier` token 化专项）已知悉这一行由本方案删除，不会重复处理它。
- **不要动 `EqualizerPage.vue:1437` 的 `animation: fadeIn 0.4s var(--te-ease-soft);`**，也不要动 `:1442-1451` 的 `@keyframes fadeIn`。
- **不要动 `OpraEqPanel.vue:204` 的 `transition: transform 0.4s var(--te-ease-soft);`**，不要动 `:222` 的 `transition: grid-template-rows 0.4s var(--te-ease-soft);`。
- **不要把 `:root` 块搬到 `src/renderer/src/assets/base.css`、不要改成 `:global(:root)`、不要新增 `--transition` 的任何替代定义。** 那些硬编码色值（`#6366f1` / `99, 102, 241` / `#1e293b` / `#64748b`）本来就该让位给主题 token，删掉是目的，不是副作用。
- **不要引入对 `--te-neutral-800` 或 `--te-primary-600` 的引用。** 这两个 token 在任何主题里都没有定义，用了在暗色模式下文字会发灰。
- 不要改模板（`<template>`）或脚本（`<script setup>`），只动 `<style scoped>` 内的 `transition` 声明与那个 `:root` 块。
- 不要新增依赖，不要新增 token，不要改 `package.json`。
- **若某一步的当前代码与本方案引用的内容不符（行号漂移到找不到、选择器不同、该行已被改过），停下来报告，不要自行发挥。** 尤其：如果 `:root` 块已经不在了，说明有人先改过，直接报告并停止，不要凭猜测继续改那 8 处。

## Verification

- **Mechanical**：
  - `pnpm run lint` —— 应当通过。prettier 会检查多行 `transition` 的排版；若报格式差异，按它的意见调整（每项一行、两空格缩进、逗号结尾）。
  - `pnpm run typecheck` —— 纯 CSS 改动不应引入类型错误。
  - `pnpm run test:app` —— 这一档包含 `src/renderer/src/components/EqualizerPage.test.ts` 与 `src/renderer/src/components/equalizer/ParametricEqWorkspace.test.ts`，两者都不断言过渡属性清单，本方案不应让它们变红。
  - `pnpm run test:dsp-graph` —— EQ 相关逻辑套件，纯 CSS 改动不应影响。
  - `pnpm run test:themes` —— 这一档包含 `src/renderer/src/components/themeColorAudit.test.ts`，它按文件统计颜色字面量并与 `src/renderer/src/components/theme-color-allowlist.json` 的预算比对。删除死块会让 `EqualizerPage.vue` 的颜色字面量**减少 4 个**（`#6366f1`、`99, 102, 241`、`#1e293b`、`#64748b`）。该测试是 `count > 预算` 才失败，**减少不会失败**，所以不需要改 allowlist（当前预算 `"src/renderer/src/components/EqualizerPage.vue": 50`）。**不要顺手去把预算改成 46** —— 收紧预算不属于本方案。
  - `pnpm run build` —— 产物应当构建成功。
  - **注意：HEAD（8e34e01）上本来就有 3 条测试是红的。** 跑任何套件前先在未改动的工作树上记一次基线，只对比新增的失败。
  - `pnpm run format` 有既有基线，可能顺带重排无关文件。**只提交本方案涉及的那 2 个文件的改动。**
- **Feel check（真实渲染，不许用简化替身当证据）**：这一条是本方案的关键证据 —— 读 `getComputedStyle` 比截图更有力，因为它能直接证明过渡值从「悬空」变成了「解析出来」。
  - 先 `npx electron-vite build` 让 `out/` 带上改动。
  - 用 `--user-data-dir=<临时目录，正斜杠>` 隔离 profile，直接跑 `node_modules/electron/dist/electron.exe .`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  - seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，然后把 `<profile>/music-library.json` 覆盖成 `{version:2,revision:1,tracks:[],folders:[],exclusions:[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `<profile>/plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`（否则 provider RPC 要 30s 超时才放行启动）。
  - **优先复制改造 `output/` 下已有的 harness（gitignored）**，不要从零写夹具。本方案最合适的起点是 `output/verify-global-font.cjs`（它就是「读计算样式而非截图」的范式），需要点击导航进 EQ 页的部分可以照 `output/verify-settings-align.cjs` 的 CDP 点击写法（`Runtime.evaluate` 里按文案匹配元素再 `.click()`）。
  - 每个 CDP 调用给 ~45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  - **别点任何文案含「关闭」的按钮**（会命中标题栏关闭键，应用直接退出）。
  - `settings.theme` 只接受 `'dark' | 'pureWhite' | 'system'`（没有 `'light'`）。两个 tone 各跑一次，并断言 `document.documentElement.dataset.theme` 是预期值。
  - **要读的计算样式（改动前后各读一次做对比）**：
    ```js
    ;(async () => {
      const pick = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return { sel, missing: true }
        const s = getComputedStyle(el)
        return {
          sel,
          transitionProperty: s.transitionProperty,
          transitionDuration: s.transitionDuration,
          transitionTimingFunction: s.transitionTimingFunction
        }
      }
      return [
        pick('.nav-item'),
        pick('.nav-item i'),
        pick('.band-tab'),
        pick('.opra-action-btn'),
        pick('.opra-search-input-wrap input'),
        pick('.opra-refresh'),
        pick('.opra-result-item'),
        pick('.result-apply')
      ]
    })()
    ```
  - **预期对比**：
    - 改动**前**：这 8 个选择器的 `transitionProperty` 是 `all`、`transitionDuration` 是 `0s`（`var()` 悬空导致声明失效，退回初始值）。
    - 改动**后**：`transitionProperty` 变成 `background-color, color, border-color`（清单 A）或 `transform, background-color, color, border-color`（清单 B，即 `.opra-action-btn` 与 `.opra-result-item`）；`transitionDuration` 变成 `0.16s`（每个属性一份，所以字符串会是 `0.16s, 0.16s, 0.16s`）；`transitionTimingFunction` 变成 `cubic-bezier(0.22, 1, 0.36, 1)`。
    - `transitionDuration` 里**不应**出现 `0.3s`（原 `--transition` 的时长），也不应出现 `0s`。
  - **要看的观察点**：
    - EQ 页左侧 4 个导航项（`.nav-item`）：指针扫过时底色与文字色**平滑渐变**（改前是瞬跳）；图标底板（`.nav-item i`）在切换 active 时底色也平滑。
    - 频段标签（`.band-tab`）：hover 与切换 active 时底色/文字色平滑，阴影瞬时切换（这是有意取舍，确认不显得突兀）。
    - 展开 OPRA 面板（点 `.opra-action-btn`）：按钮自身 hover 时的 `translateY(-2px)` 抬起变成平滑位移；搜索框 focus 时边框色平滑；结果卡片 hover 抬起平滑。
  - 在 DevTools Animations 面板把播放速度设为 10%，逐个慢放确认上述过渡真的在插值，而不是仍然一帧到位。
  - 在 DevTools Rendering 面板切 `prefers-reduced-motion: reduce`，以及把 `<html>` 的 `data-te-motion` 依次设为 `'reduced'` 与 `'off'`（三档由 `src/shared/motion.ts` + `src/renderer/src/app/useMotionPreference.ts` 驱动）。`base.css:425-441` 会把 `transition-duration` 压到 `0.01ms`（reduced）或 `transition: none`（off）—— 确认颜色反馈仍然到位、只是不再插值，没有任何元素变得不可见或不可点。
- **Done when**：
  - `grep -rn "var(--transition)" src/ resources/` 零命中。
  - `grep -rn -- "--transition:" src/ resources/` 零命中。
  - `grep -n ":root" src/renderer/src/components/EqualizerPage.vue` 零命中。
  - `grep -n "cubic-bezier" src/renderer/src/components/EqualizerPage.vue` 的命中数从 1 降到 0。
  - `grep -rn "transition: all" src/renderer/src/components/equalizer/OpraEqPanel.vue` 零命中（本来就该是 0，确认没有引入新的）。
  - CDP 读到的 8 个选择器的 `transitionDuration` 全部是 `0.16s`（重复次数等于清单里的属性数），`transitionProperty` 全部不含 `all`。
  - `pnpm run lint`、`pnpm run typecheck`、`pnpm run build` 通过，测试失败数不超过 HEAD 基线的 3 条。
