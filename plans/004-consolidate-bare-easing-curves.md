# 004 — 把 30 处手写 cubic-bezier 归并到 token 层，收敛四档回弹

- **Status**: TODO
- **Commit**: 8e34e01
- **Severity**: MEDIUM
- **Category**: 一致性与 token（AUDIT 第 7 节 Cohesion & tokens）
- **Estimated scope**: 12 个源文件 + 1 个测试文件，约 35 处单行替换

## Problem

全仓 30 处手写 `cubic-bezier(…)`：23 处是已有 token 的**字面复制**，7 处引入 token 之外的**新曲线**。AUDIT 第 7 节：「Five hand-typed cubic-beziers that almost match is a consolidation finding」，且强曲线应「as tokens, matching repo conventions」。

现有 token（`src/renderer/src/assets/base.css:26-31`，本方案的替换目标）：

```css
/* src/renderer/src/assets/base.css:26-31 — 当前 */
--te-ease-enter: cubic-bezier(0.4, 0, 0.2, 1);
/* Soft = out-quint: fast start, long settling tail (osu!lazer-style motion). */
--te-ease-soft: var(--te-ease-out-quint);
--te-ease-spring: cubic-bezier(0.22, 1.14, 0.36, 1);
--te-ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
--te-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
```

### A 组 — 23 处纯替换（值与 token 逐字相同）

**`cubic-bezier(0.4, 0, 0.2, 1)` = `--te-ease-enter`，10 处：**

| 位置                                                               | 当前代码                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `src/renderer/src/App.vue:1174`                                    | `    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),`           |
| `src/renderer/src/App.vue:1175`                                    | `    filter 0.28s cubic-bezier(0.4, 0, 0.2, 1) !important;`  |
| `src/renderer/src/components/streaming-page/StreamingPage.css:386` | `    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),`           |
| `src/renderer/src/components/streaming-page/StreamingPage.css:387` | `    filter 0.28s cubic-bezier(0.4, 0, 0.2, 1);`             |
| `src/renderer/src/components/StreamingLibrary.vue:406`             | `  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);`       |
| `src/renderer/src/components/StreamingLibrary.vue:715`             | `  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);`       |
| `src/renderer/src/components/StreamingLibrary.vue:960`             | `  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);`       |
| `src/renderer/src/components/PluginPage.vue:996`                   | `  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);` |
| `src/renderer/src/components/PluginPage.vue:1168`                  | `  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);`       |
| `src/renderer/src/components/EqualizerPage.vue:1340`               | `  --te-ease-soft: cubic-bezier(0.4, 0, 0.2, 1);`            |

**最后一处（EqualizerPage.vue:1340）本方案不动。**它在一段死代码里：

```css
/* src/renderer/src/components/EqualizerPage.vue:1335-1342 — 当前，死代码 */
:root {
  --te-primary-500: #6366f1;
  --te-primary-rgb: 99, 102, 241;
  --te-neutral-900: #1e293b;
  --te-neutral-500: #64748b;
  --te-ease-soft: cubic-bezier(0.4, 0, 0.2, 1);
  --transition: all 0.3s var(--te-ease-soft);
}
```

这个 `:root` 块位于 `<style scoped>`（该文件唯一的 style 块，起于第 1134 行）内部，被 Vue 编译成带 data 属性的选择器，**永远不会匹配文档根**，所以这里的 `--te-ease-soft` 覆盖从来没生效过。这一块归**方案 017** 处理（连带那 4 个颜色变量与 `--transition` 一起删）。本方案只做交代，**不要重复动它**。

**`cubic-bezier(0.16, 1, 0.3, 1)` = `--te-ease-out-expo`，9 处：**

| 位置                                                                        | 当前代码                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/renderer/src/App.vue:1163`                                             | `    transform 0.48s cubic-bezier(0.16, 1, 0.3, 1),`                      |
| `src/renderer/src/App.vue:1164`                                             | `    filter 0.42s cubic-bezier(0.16, 1, 0.3, 1) !important;`              |
| `src/renderer/src/components/streaming-page/StreamingPage.css:90`           | `  animation: stream-chrome-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;`  |
| `src/renderer/src/components/streaming-page/StreamingPage.css:375`          | `    transform 0.48s cubic-bezier(0.16, 1, 0.3, 1),`                      |
| `src/renderer/src/components/streaming-page/StreamingPage.css:376`          | `    filter 0.42s cubic-bezier(0.16, 1, 0.3, 1);`                         |
| `src/renderer/src/components/streaming-page/StreamingPage.css:2072`         | `  animation: stream-chrome-in 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;` |
| `src/renderer/src/components/streaming-page/StreamingContentHeader.css:69`  | `  animation: stream-chrome-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;`  |
| `src/renderer/src/components/streaming-page/StreamingContentHeader.css:432` | `  animation: stream-chrome-in 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;` |
| `src/renderer/src/mini-player/MiniPlayer.css:529`                           | `    transform 200ms cubic-bezier(0.16, 1, 0.3, 1);`                      |

**`cubic-bezier(0.22, 1, 0.36, 1)` = `--te-ease-out-quint`，4 处：**

| 位置                                                   | 当前代码                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `src/renderer/src/components/AppNoticeHost.vue:147`    | `    transform var(--te-toast-motion-duration, 220ms) cubic-bezier(0.22, 1, 0.36, 1);`           |
| `src/renderer/src/components/AppNoticeHost.vue:172`    | `  transition: transform var(--te-toast-motion-duration, 220ms) cubic-bezier(0.22, 1, 0.36, 1);` |
| `src/renderer/src/components/PlayingLyricLine.vue:451` | `    max-height 320ms cubic-bezier(0.22, 1, 0.36, 1),`                                           |
| `src/renderer/src/components/PlayingLyricLine.vue:453` | `    transform 320ms cubic-bezier(0.22, 1, 0.36, 1),`                                            |

### B 组 — 7 处新曲线

**`cubic-bezier(0.2, 0.8, 0.2, 1)`，4 处。这个值恰好等于 `--te-ease-soft` 的运行时实际值**（见方案 001：`src/shared/themeTokens.ts:1697-1706` 的默认值经主题注入链以 `!important` 落到 `:root`，压过 base.css 的 out-quint 别名）。也就是说这 4 处**一直在用「真实的 soft」**，只是没人知道那才是 soft。方案 001 把权威值统一为 `cubic-bezier(0.22, 1, 0.36, 1)` 之后，这 4 处应当跟着换成 `var(--te-ease-soft)`。

```css
/* src/renderer/src/components/LyricsAppearanceCustomizer.vue:1254-1259 — 当前 */
.lyrics-customizer-enter-active .lyrics-customizer,
.lyrics-customizer-leave-active .lyrics-customizer {
  transition:
    transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 220ms ease;
}
```

```css
/* src/renderer/src/mini-player/MiniPlayer.css:604-608 — 当前 */
  transition:
    color 150ms ease,
    background 150ms ease,
    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

另两处被包成**私有别名 token**，本方案要把别名一起删掉（它们绕过了 token 层）：

```css
/* src/renderer/src/components/streaming-page/StreamingDetailStage.css:29 — 当前 */
--stage-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
```

`--stage-ease` 的消费者 9 处：`StreamingDetailStage.css:208`、`:412`、`:413`、`:463`、`:591`，`src/renderer/src/components/streaming-page/StreamingSocialStage.css:42`、`:45`、`:112`、`:183`。

```css
/* src/renderer/src/components/streaming-page/StreamingPage.css:2027 — 当前 */
--bar-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
```

`--bar-ease` 的消费者 8 处：`StreamingPage.css:2122`、`:2125`、`:2248`、`:2251`，`src/renderer/src/components/streaming-page/StreamingContentHeader.css:482`、`:485`、`:608`、`:611`。

**`cubic-bezier(0.34, 1.56, 0.64, 1)`（约 +16% 过冲），2 处：**

```css
/* src/renderer/src/components/SideMenu.vue:362-364 — 当前 */
transition:
  color 0.2s,
  transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
```

```css
/* src/renderer/src/components/player-bar/PlayerBar.css:682 — 当前 */
transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
```

**`cubic-bezier(0.34, 1.4, 0.64, 1)`（约 +12%），1 处：**

```css
/* src/renderer/src/components/player-bar/HiFiSidebar.css:860 — 当前 */
transition: all 0.22s cubic-bezier(0.34, 1.4, 0.64, 1);
```

### 四档回弹并存

| 值                                  | 过冲    | 出处                                                                                                                                                            |
| ----------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cubic-bezier(0.22, 1.14, 0.36, 1)` | 约 +7%  | token `--te-ease-spring`（`base.css:29`），36 处消费                                                                                                            |
| `cubic-bezier(0.34, 1.2, 0.64, 1)`  | 约 +11% | 设计文档给 Web 的映射值（`docs/apple-music-inspired-hifi-player-design-system.md:670`，「`cubic-bezier(0.34, 1.2, 0.64, 1)` — spring-like, duration-bounded」） |
| `cubic-bezier(0.34, 1.4, 0.64, 1)`  | 约 +12% | `HiFiSidebar.css:860`                                                                                                                                           |
| `cubic-bezier(0.34, 1.56, 0.64, 1)` | 约 +16% | `SideMenu.vue:364`、`PlayerBar.css:682`                                                                                                                         |

即**连 token 本身都没对齐设计文档**。同一个「弹一下」在侧边菜单图标、播放列表封面、HiFi 开关上幅度各不相同。

调性依据：设计文档 P10（`docs/apple-music-inspired-hifi-player-design-system.md:86`）「One animation per interaction, ≤ 500 ms for feedback」，`:1241` 明确禁止「No looping, no idle bounce」。`cubic-bezier(0.34, 1.56, 0.64, 1)` 挂在 `.item-icon` 的 `transform` 上，而侧边栏图标每天被划过几十次 —— AUDIT 第 1 节对「Tens of times/day (hover effects, list navigation)」这一档的处置是「Remove or drastically reduce」。**该 hover 本身归方案 011，本方案只统一曲线。**

### 依赖方案 001

`--te-ease-soft` 现在有两个互相矛盾的定义源（base.css 注释说 out-quint，运行时实际是 `cubic-bezier(0.2, 0.8, 0.2, 1)`）。**必须先做方案 001 定下权威值**，否则本方案会把 B 组那 4 处归并到一个即将变更的值上。

## Target

30 处裸曲线收敛为 0 处（EqualizerPage.vue:1340 一处除外，归方案 017），四档回弹收敛为 1 档 token。

**A 组 — 逐字替换（22 处，不含 EqualizerPage.vue:1340）：**

```css
/* target — App.vue:1161-1164 */
transition:
  opacity 0.34s ease,
  transform 0.48s var(--te-ease-out-expo),
  filter 0.42s var(--te-ease-out-expo) !important;
```

```css
/* target — App.vue:1172-1175 */
transition:
  opacity 0.22s ease,
  transform 0.3s var(--te-ease-enter),
  filter 0.28s var(--te-ease-enter) !important;
```

替换规则（机械照做，不要动时长、不要动属性、不要动 `!important` / `both`）：

- `cubic-bezier(0.4, 0, 0.2, 1)` → `var(--te-ease-enter)`
- `cubic-bezier(0.16, 1, 0.3, 1)` → `var(--te-ease-out-expo)`
- `cubic-bezier(0.22, 1, 0.36, 1)` → `var(--te-ease-out-quint)`

**B 组 — `cubic-bezier(0.2, 0.8, 0.2, 1)` 的 4 处 → `var(--te-ease-soft)`，并删掉两个私有别名：**

```css
/* target — StreamingDetailStage.css:29 整行删除；9 处 var(--stage-ease) 改成 var(--te-ease-soft) */
/* target — StreamingPage.css:2027 整行删除；8 处 var(--bar-ease) 改成 var(--te-ease-soft) */
```

```css
/* target — LyricsAppearanceCustomizer.vue:1256-1258 */
transition:
  transform 260ms var(--te-ease-soft),
  opacity 220ms ease;
```

```css
/* target — MiniPlayer.css:604-607 */
transition:
  color 150ms ease,
  background 150ms ease,
  transform 180ms var(--te-ease-soft);
```

**B 组 — 三处回弹全部收敛到 `--te-ease-spring`：**

```css
/* target — SideMenu.vue:362-364 */
transition:
  color 0.2s,
  transform 0.2s var(--te-ease-spring);
```

```css
/* target — PlayerBar.css:682 */
transition: transform 0.2s var(--te-ease-spring);
```

```css
/* target — HiFiSidebar.css:860 */
transition: all 0.22s var(--te-ease-spring);
```

**`--te-ease-spring` 的值本身不改**，保持 `cubic-bezier(0.22, 1.14, 0.36, 1)`（`base.css:29`）。理由写清楚，执行者不要自行改成设计文档的 `cubic-bezier(0.34, 1.2, 0.64, 1)`：

- 它是四档里**过冲最小**的（约 +7%），符合 AUDIT 第 4 节「Keep bounce subtle (0.1–0.3); reserve visible bounce for drag-to-dismiss and playful moments」——侧边栏图标 hover、播放列表封面 hover、HiFi 开关都不是 drag-to-dismiss 或 playful moment。
- 它已有 36 处消费者，改值会波及全部；本方案是**归并**，不是重新调参。token 值与设计文档 `:670` 映射值的差异（+7% vs +11%）单独记为后续待办，不在本方案范围。

## Repo conventions to follow

- 动效 token 全住在 `src/renderer/src/assets/base.css:26-40`：`--te-ease-enter/soft/spring/out-quint/out-expo`、`--te-motion-press/hover/panel/page/settle/return`、`--te-motion-press-scale/hover-translate`。**新曲线必须进 base.css 的 token 层，不许在组件里另起一套。**本方案不新增 token，只消费已有的 5 条缓动 token。
- 私有别名 token（`--stage-ease`、`--bar-ease`）是反面例子：它们把裸曲线藏进组件局部变量，绕过了 token 层。本方案删掉它们。
- **正面样板**：`src/renderer/src/components/onboarding/OnboardingWizard.css` 是全仓唯一 0 裸曲线的大文件，因为有测试钉住：

  ```ts
  /* src/renderer/src/components/onboarding/OnboardingWizard.test.ts:57-62 — 现有样板 */
  test('scene transitions and cascades use motion tokens, not hardcoded curves', () => {
    assert.match(css, /--te-ease-out-expo/)
    assert.match(css, /--te-ease-spring/)
    assert.match(css, /--te-motion-settle/)
    assert.doesNotMatch(css, /cubic-bezier\(/)
  })
  ```

  这条 `assert.doesNotMatch(css, /cubic-bezier\(/)` 只覆盖 `OnboardingWizard.css`。本方案要按同样思路给 `SideMenu.test.ts` 换断言。

- Vue `<style scoped>` 里引用 `var(--te-…)` 无需 `:global()`——CSS 自定义属性沿 DOM 继承，`:root` 上的值在 scoped 样式里照样能取到。现有 `SideMenu.vue:362` 的 `transform 0.32s var(--te-ease-soft)` 就是这么写的。

## Steps

> 前置：**方案 001 必须已经落地**（`--te-ease-soft` 的权威值已统一为 `cubic-bezier(0.22, 1, 0.36, 1)`）。若 001 未做，停下来先做 001。

1. `src/renderer/src/App.vue` 第 1163、1164 行：把两处 `cubic-bezier(0.16, 1, 0.3, 1)` 改成 `var(--te-ease-out-expo)`。改完这两行应为 `    transform 0.48s var(--te-ease-out-expo),` 和 `    filter 0.42s var(--te-ease-out-expo) !important;`。
2. 同文件第 1174、1175 行：把两处 `cubic-bezier(0.4, 0, 0.2, 1)` 改成 `var(--te-ease-enter)`。改完应为 `    transform 0.3s var(--te-ease-enter),` 和 `    filter 0.28s var(--te-ease-enter) !important;`。
3. `src/renderer/src/components/SideMenu.test.ts`：第 13-16 行与第 18-21 行两条 `assert.match` 逐字钉住了上面那 4 行的裸曲线字面量，替换后会**变红**。把它们改成断言 token 名：

   ```ts
   assert.match(
     app,
     /transform 0\.48s var\(--te-ease-out-expo\),\s*filter 0\.42s var\(--te-ease-out-expo\)/
   )
   assert.match(
     app,
     /transform 0\.3s var\(--te-ease-enter\),\s*filter 0\.28s var\(--te-ease-enter\)/
   )
   ```

   同文件第 10、12、23 行的三条 `var(--te-ease-soft)` 断言和第 17、22 行的 `translate3d` 断言**不要动**（本方案没改那些位置）。该文件已登记在 `package.json` 的 `test:playback-routing` 脚本里，无需新增登记。

4. `src/renderer/src/components/streaming-page/StreamingPage.css`：第 90 行、第 375、376 行、第 2072 行的 4 处 `cubic-bezier(0.16, 1, 0.3, 1)` → `var(--te-ease-out-expo)`；第 386、387 行的 2 处 `cubic-bezier(0.4, 0, 0.2, 1)` → `var(--te-ease-enter)`。
5. `src/renderer/src/components/streaming-page/StreamingContentHeader.css`：第 69、432 行的 2 处 `cubic-bezier(0.16, 1, 0.3, 1)` → `var(--te-ease-out-expo)`。
6. `src/renderer/src/mini-player/MiniPlayer.css` 第 529 行：`cubic-bezier(0.16, 1, 0.3, 1)` → `var(--te-ease-out-expo)`。
7. `src/renderer/src/components/StreamingLibrary.vue`：第 406、715、960 行的 3 处 `cubic-bezier(0.4, 0, 0.2, 1)` → `var(--te-ease-enter)`。**只换曲线，保留 `transition: all`**（`all` 本身是 AUDIT 第 5 节的独立发现，不在本方案范围）。
8. `src/renderer/src/components/PluginPage.vue`：第 996、1168 行的 2 处 `cubic-bezier(0.4, 0, 0.2, 1)` → `var(--te-ease-enter)`。同样保留 `transition: all`。
9. `src/renderer/src/components/AppNoticeHost.vue`：第 147、172 行的 2 处 `cubic-bezier(0.22, 1, 0.36, 1)` → `var(--te-ease-out-quint)`。
10. `src/renderer/src/components/PlayingLyricLine.vue`：第 451、453 行的 2 处 `cubic-bezier(0.22, 1, 0.36, 1)` → `var(--te-ease-out-quint)`。**第 454 行的 `visibility 0s linear 320ms` 不要动**（`linear` 在这里是零时长开关，不是曲线）。
11. `src/renderer/src/components/LyricsAppearanceCustomizer.vue` 第 1257 行：`cubic-bezier(0.2, 0.8, 0.2, 1)` → `var(--te-ease-soft)`。
12. `src/renderer/src/mini-player/MiniPlayer.css` 第 607 行：`cubic-bezier(0.2, 0.8, 0.2, 1)` → `var(--te-ease-soft)`。
13. `src/renderer/src/components/streaming-page/StreamingDetailStage.css`：删掉第 29 行整行（`  --stage-ease: cubic-bezier(0.2, 0.8, 0.2, 1);`）。然后把该文件第 208、412、413、463、591 行的 `var(--stage-ease)` 全部改成 `var(--te-ease-soft)`。
14. `src/renderer/src/components/streaming-page/StreamingSocialStage.css`：把第 42、45、112、183 行的 `var(--stage-ease)` 改成 `var(--te-ease-soft)`（这个文件消费了上一步删掉的别名，漏改会让缓动回落到浏览器默认的 `ease`）。
15. `src/renderer/src/components/streaming-page/StreamingPage.css`：删掉第 2027 行整行（`  --bar-ease: cubic-bezier(0.2, 0.8, 0.2, 1);`）。然后把该文件第 2122、2125、2248、2251 行的 `var(--bar-ease)` 改成 `var(--te-ease-soft)`。
16. `src/renderer/src/components/streaming-page/StreamingContentHeader.css`：把第 482、485、608、611 行的 `var(--bar-ease)` 改成 `var(--te-ease-soft)`（同上，跨文件消费者，漏改会回落到 `ease`）。
17. `src/renderer/src/components/SideMenu.vue` 第 364 行：`cubic-bezier(0.34, 1.56, 0.64, 1)` → `var(--te-ease-spring)`。
18. `src/renderer/src/components/player-bar/PlayerBar.css` 第 682 行：`cubic-bezier(0.34, 1.56, 0.64, 1)` → `var(--te-ease-spring)`。
19. `src/renderer/src/components/player-bar/HiFiSidebar.css` 第 860 行：`cubic-bezier(0.34, 1.4, 0.64, 1)` → `var(--te-ease-spring)`。保留 `all`（不在本方案范围）。
20. 全仓核对：`grep -rn "cubic-bezier(" src/renderer/src/ --include=*.vue --include=*.css` 应当只剩下 —— `base.css:26/29/30/31`（token 定义本身，4 处）、`EqualizerPage.vue:1340`（死代码，归方案 017）、以及 `SideMenu.test.ts` / `OnboardingWizard.test.ts` 里的测试正则。**共 5 处产品代码 + 测试文件里的字面量。**
21. 另外核对别名已清空：`grep -rn "stage-ease\|bar-ease" src/renderer/src/` 应当 0 命中。

## Boundaries

- 不要改任何**时长**、任何**属性名**、任何 `!important` / `both` / `forwards`。本方案只换缓动函数。
- 不要改 `--te-ease-spring` 的值（保持 `cubic-bezier(0.22, 1.14, 0.36, 1)`）。它有 36 处消费者，改值会波及全部。设计文档 `:670` 的 `cubic-bezier(0.34, 1.2, 0.64, 1)` 与之的差异是**单独的后续待办**，不在本方案范围。
- 不要改 `--te-ease-soft` / `--te-ease-enter` / `--te-ease-out-quint` / `--te-ease-out-expo` 的值。方案 001 负责 soft 的权威值。
- 不要动 `src/renderer/src/components/EqualizerPage.vue:1335-1342` 的死 `:root` 块（含第 1340 行的裸曲线）。方案 017 处理。
- 不要顺手修 `transition: all`（`StreamingLibrary.vue:406/715/960`、`PluginPage.vue:1168`、`HiFiSidebar.css:860`）。那是 AUDIT 第 5 节的独立发现。
- 不要顺手删 `.item-icon` 的 hover 位移（`SideMenu.vue:362-364`）。那是方案 011 的范围；本方案只把它的曲线换成 token。
- 不要动 `src/renderer/src/components/onboarding/OnboardingWizard.css` 与 `OnboardingWizard.test.ts`——它们已经是 0 裸曲线的样板。注意 `OnboardingWizard.test.ts:61` 的 `assert.doesNotMatch(css, /cubic-bezier\(/)` **只**读 `OnboardingWizard.css`，本方案不会影响它。
- 不要动 `src/renderer/src/assets/primeicons.css`（第三方图标库，且已确认 0 处裸 cubic-bezier）。
- 不要动 `src/shared/themePresets.ts` 与 `src/shared/themeTokens.ts` 里的 `cubic-bezier` 字面量——那些是主题预设的 token 值，属于方案 001 的范围。
- 不要动 markup / 结构。不要新增依赖。不要引入对 `--te-neutral-800` / `--te-primary-600` 的引用。
- 除第 3 步指定的 `SideMenu.test.ts` 两条断言外，不要改任何测试。
- **如果某一步描述的代码与你实际看到的不一致（行号漂移、值已被改过），停下来报告，不要自行发挥。**

## Verification

- **Mechanical**：
  - `grep -rn "cubic-bezier(" src/renderer/src/ --include=*.vue --include=*.css` 只剩 `base.css:26/29/30/31` 与 `EqualizerPage.vue:1340`（共 5 处产品代码）。
  - `grep -rn "stage-ease\|bar-ease" src/renderer/src/` 0 命中。
  - `pnpm run typecheck` 应当通过。
  - `pnpm run lint` 应当通过。
  - **先在改动前把下面几套各跑一遍记基线**——HEAD 上本来就有 3 条测试是红的，别把既有失败算到自己账上。
  - `pnpm run test:playback-routing` —— 内含第 3 步改的 `src/renderer/src/components/SideMenu.test.ts`，以及 `src/renderer/src/mini-player/styles.test.ts`（读 `MiniPlayer.css`）。预期全绿（除基线红项）。
  - `pnpm run test:app` —— 内含 `src/renderer/src/app/useMotionPreference.test.ts`（用正则钉住 base.css 多条动效规则，含 `--te-ease-spring`；本方案没改 base.css，应当照常通过）和 `src/renderer/src/components/onboarding/OnboardingWizard.test.ts`（`assert.doesNotMatch(css, /cubic-bezier\(/)`，只覆盖 `OnboardingWizard.css`）。预期与基线一致。
  - `pnpm run test:themes` —— 内含 `themeColorAudit.test.ts` / `themeTokenization.test.ts`（只管颜色与 token 布线，不管缓动；后者会读 `App.vue`、`SideMenu.vue`、`PlayerBar.css`、`EqualizerPage.vue`）。预期与基线一致。
  - `pnpm run test:lyrics-management` —— 内含 `PlayingMusic.test.ts` 等，覆盖 `PlayingLyricLine.vue` 附近。预期与基线一致。
  - `pnpm run build` 应当通过（含 typecheck + electron-vite build + strip 字体 + verify:renderer-budgets）。
- **Feel check**（必须走真实渲染，不许用简化替身当证据）：
  1. `npx electron-vite build`，让 `out/` 带上改动。
  2. 隔离 profile 启动：`node_modules/electron/dist/electron.exe . --user-data-dir=<临时目录，正斜杠>`。**不要**走 `pnpm run dev --`（`--user-data-dir` 传不进去，会抢真实 profile 的单实例锁然后静默退出）。
  3. seed：`node scripts/theme-visual-regression.cjs --seed-user-data <dir> --seed-real-files 48`，把 `<profile>/music-library.json` 覆盖成 `{"version":2,"revision":1,"tracks":[],"folders":[],"exclusions":[]}`（seed 出来的 1 万条会阻塞渲染进程约 3 分钟），并预写 `<profile>/plugin-state.json` 把 `com.twilightecho.provider.ncm` 设为 `enabled:false`（否则 provider RPC 要 30s 超时才放行启动）。
  4. 播放栏只在有当前曲目时挂载（第 18 步改的 `PlayerBar.css:682` 在播放列表抽屉里）：seed `<profile>/playback-session.json`（`{version:1, savedAt, mode:'trackAndPosition', track, position, queue, queueIndex}`，`track` 从扫描出的库里取并塞一个真 `duration`），settings 里设 `playbackResumeMode: 'trackAndPosition'`。
  5. 优先复制改造 `output/` 下已有的 harness（gitignored）：`verify-global-font.cjs`（**读计算样式而非截图**，最贴近本方案）、`verify-playbar-shapes.cjs`（播放条三形态，支持 `TE_THEME=` / `TE_PRESET=` / `TE_PORT=`）。别从零写夹具。
  6. **对 CSS 变量/缓动这类改动，读 `getComputedStyle` 比截图更有力**（能证明 token 真的解析成了目标值）。逐条读：
     - `getComputedStyle(document.documentElement).getPropertyValue('--te-ease-soft').trim()` 应当是 `cubic-bezier(0.22, 1, 0.36, 1)`（方案 001 定下的权威值）。
     - `.item-icon`（侧边栏菜单图标）：`getComputedStyle(el).transitionTimingFunction` 应当包含 `cubic-bezier(0.22, 1.14, 0.36, 1)`，**不再**是 `cubic-bezier(0.34, 1.56, 0.64, 1)`。
     - `.playlist-cover`（播放列表抽屉封面）：同上，`cubic-bezier(0.22, 1.14, 0.36, 1)`。
     - `.deck-switch::after`（HiFi 侧栏开关滑块，`HiFiSidebar.css:860`）：同上。
     - 任一 `--stage-ease` 旧消费者（如 StreamingDetailStage 的行 hover）：`transitionTimingFunction` 应当是 `cubic-bezier(0.22, 1, 0.36, 1)`，**不是** `ease`（若读到 `ease`，说明第 14 / 16 步的跨文件消费者漏改了）。
     - 任一 `--bar-ease` 旧消费者（StreamingContentHeader 的按钮）：同上。
     - 每个 CDP 调用给约 45s 超时；`Runtime.evaluate` 没有顶层 await，要包 `(async () => …)()`。
  7. 眼看确认（DevTools Animations 面板调到 10% 速度做慢放核对）：
     - 页面上下切换（`App.vue` 的 `page-down` / `page-up`）的进出节奏**与改动前完全一致**——本方案是等值替换，任何可感知的变化都说明替换错了值。
     - 侧边栏图标 hover、播放列表封面 hover、HiFi 开关切换的回弹幅度现在**一致**（都是约 +7% 过冲，比原先的 +16% 收敛），不再一个比一个夸张。
     - StreamingDetailStage / StreamingSocialStage / StreamingContentHeader 的行 hover 与按钮 hover 仍有缓动，**没有变成生硬的浏览器默认 `ease`**（这是第 14 / 16 步漏改的典型症状）。
     - Toast 进出（`AppNoticeHost.vue`）与歌词行展开（`PlayingLyricLine.vue`）节奏不变。
  8. 两个 tone 各跑一次：`settings.theme` 只接受 `'dark' | 'pureWhite' | 'system'`（**没有 `'light'`**），并断言 `document.documentElement.dataset.theme`。
  9. 窗口 `deviceScaleFactor` 是 1.5，截图 clip 是 CSS px 但 PNG 带缩放，用 `png.width / clipWidth` 反推。
  10. 操作时**别点任何文案含「关闭」的按钮**——会命中标题栏关闭键，应用直接退出。
- **Done when**：
  - `src/renderer/src/` 下产品代码里的裸 `cubic-bezier(` 只剩 5 处：`base.css` 的 4 条 token 定义 + `EqualizerPage.vue:1340`（死代码，归方案 017）。
  - `--stage-ease` / `--bar-ease` 两个私有别名及其 17 处消费者全部改为 `var(--te-ease-soft)`，`grep` 0 命中。
  - 三处回弹（`SideMenu.vue:364`、`PlayerBar.css:682`、`HiFiSidebar.css:860`）统一为 `var(--te-ease-spring)`，计算样式实测为 `cubic-bezier(0.22, 1.14, 0.36, 1)`。
  - `SideMenu.test.ts` 的两条断言改为 token 形式且通过。
  - 页面切换/toast/歌词的观感与改动前一致（等值替换）。
  - typecheck / lint / build 通过，`test:playback-routing`、`test:app`、`test:themes`、`test:lyrics-management` 与改动前基线一致。
  - prettier 有基线，`pnpm run format` 可能顺带重排无关文件；**只提交你自己改的那 13 个文件。**
