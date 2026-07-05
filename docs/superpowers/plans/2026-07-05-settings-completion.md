# Settings Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the first approved round of Twilight Echo settings/plugin-management fixes while preserving unrelated audio and visualizer work.

**Architecture:** Work in an isolated feature branch/worktree so current dirty audio and visualizer files are not touched. Keep the active `PluginPage.vue` as the plugin center, tighten plugin extension contracts at manifest/manager/preload/API boundaries, and make visible Settings controls truthful without rewriting audio internals.

**Tech Stack:** Electron main/preload, Vue 3 SFCs, TypeScript, Node `--test`, `vue-tsc`, existing Twilight Echo plugin manager/runtime APIs.

---

## Execution Rules

- Run all commands from the repository root unless a task says otherwise.
- Do not edit or stage these unrelated dirty paths: `audio-engine/**`, `resources/audio-visualizer/**`, `src/main/audioEngineManager.ts`, `src/renderer/src/stores/usePlayerStore.ts`, or their current tests.
- Before implementation, create or switch to an isolated branch/worktree using `superpowers:using-git-worktrees`.
- When committing task work, stage only the files named in that task.
- If a test failure comes from the pre-existing audio/visualizer dirty work, record it and continue with focused plugin/settings verification.

## File Map

- `src/renderer/src/components/PluginPage.vue`: active plugin center UI; add details, logs, DSP status/params, safe uninstall, and remove no-op developer mode.
- `src/renderer/src/components/PluginExtensionPage.vue`: remove unsafe HTML iframe rendering and render command/text results only.
- `src/renderer/src/components/SettingsPage.vue`: clarify proxy restart semantics, bit-perfect preset label, high-resolution no-op, inherited background controls, and About URLs.
- `src/renderer/src/extensions/registry.ts`: remove `html` render-mode normalization from renderer extension types.
- `src/main/plugins/manifest.ts`: reject pure theme plugins that execute JS through `main`.
- `src/main/plugins/manager.ts`: remove runtime theme registration as a supported theme path, normalize UI render mode to command-only, and keep declarative theme registration.
- `src/main/pluginHost.ts`: make proxy bootstrap obey an explicit policy and remove `twilight.themes.register` from plugin context.
- `src/main/plugins/proxyBootstrap.ts`: expose `initProxy` with a mode parameter so `off` skips probing.
- `src/main/ipc/plugins.ts`: pass proxy policy/env to plugin host setup.
- `src/main/ipc/data.ts`: use current repository constants for release/update checks.
- `src/main/core/settings.ts`: add proxy fields to restart reasons.
- `src/preload/types.ts`, `src/preload/index.d.ts`, `packages/plugin-api/src/index.ts`: remove public `renderMode: 'html'` and runtime theme-registration API types.
- `docs/PLUGIN_README.md`, `docs/PLUGIN_DEVELOPMENT.md`, `docs/plugin-api-draft.md`, `packages/plugin-api/README.md`, template docs/tests: update docs that advertise unsafe HTML mode or runtime theme registration.
- Tests under `src/main/plugins/*.test.ts`, `src/renderer/src/extensions/*.test.ts`, and `packages/plugin-api/test/*.ts`: update or add focused coverage.

---

### Task 0: Isolate The Worktree

**Files:**
- No source files changed.

- [ ] **Step 1: Check the shared worktree**

Run:

```powershell
git status --short
```

Expected: unrelated dirty audio/visualizer paths may be listed. No plugin/settings paths should be dirty unless a previous task in this plan already changed them.

- [ ] **Step 2: Create an isolated implementation branch or worktree**

Use `superpowers:using-git-worktrees`. Use branch name:

```text
codex/settings-completion-round
```

Expected: implementation happens away from the shared dirty worktree, or on an explicitly isolated branch created by the skill.

- [ ] **Step 3: Confirm the design and plan exist in the implementation environment**

Run:

```powershell
Test-Path docs/superpowers/specs/2026-07-05-settings-completion-design.md
Test-Path docs/superpowers/plans/2026-07-05-settings-completion.md
```

Expected: both commands print `True`.

---

### Task 1: Make Extension Contracts Match The Plugin Spec

**Files:**
- Modify: `src/main/plugins/manifest.ts`
- Modify: `src/main/plugins/manifest.test.ts`
- Modify: `src/main/plugins/manager.ts`
- Modify: `src/main/plugins/managerContract.test.ts`
- Modify: `src/main/pluginHost.ts`
- Modify: `src/renderer/src/extensions/registry.ts`
- Modify: `src/renderer/src/components/PluginExtensionPage.vue`
- Modify: `src/preload/types.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `packages/plugin-api/src/index.ts`
- Modify: `packages/plugin-api/test/index.typecheck.ts`

- [ ] **Step 1: Add manifest coverage for pure theme plugins with `main`**

In `src/main/plugins/manifest.test.ts`, add a test case near the existing manifest validation tests:

```ts
test('rejects pure theme plugins that declare executable main entry', () => {
  const root = makePluginRoot({
    id: 'com.example.theme-script',
    name: 'Scripted Theme',
    version: '1.0.0',
    description: 'Theme with script entry',
    author: 'Example',
    license: 'MIT',
    type: ['theme'],
    main: 'index.js',
    engines: { twilightEcho: '*' },
    apiVersion: 1,
    permissions: [],
    contributes: {
      themes: [
        {
          id: 'midnight',
          name: 'Midnight',
          variables: { '--te-primary-500': '#111827' }
        }
      ]
    }
  })

  assert.throws(
    () => readPluginManifest(root),
    /theme.*declarative|主题.*声明式|不能声明 main/i
  )
})
```

Use the local helper names already present in the file. If the file uses a different helper than `makePluginRoot`, adapt only the helper call shape and keep the assertion intent.

- [ ] **Step 2: Run the focused manifest test and verify it fails**

Run:

```powershell
node --experimental-strip-types --test src/main/plugins/manifest.test.ts
```

Expected: FAIL because pure theme plugins with `main` are still accepted.

- [ ] **Step 3: Reject pure theme `main` in manifest normalization**

In `src/main/plugins/manifest.ts`, after `type`, `main`, `binary`, and `contributes` are normalized, add:

```ts
const isPureTheme = type.length === 1 && type[0] === 'theme'
if (isPureTheme && main) {
  throw new Error('纯 theme 插件必须通过 contributes.themes 声明主题，不能声明 main')
}
```

Keep existing allowance for pure theme plugins with `contributes.themes` and no `main`.

- [ ] **Step 4: Remove runtime theme registration from plugin host API**

In `src/main/pluginHost.ts`, remove `themes.register` from the injected `twilight` API object. If the current shape requires the namespace to exist for compatibility, expose an empty object:

```ts
themes: {}
```

Do not leave a function that calls `registerTheme`.

- [ ] **Step 5: Reject `registerTheme` at the manager API boundary**

In `src/main/plugins/manager.ts`, change the `registerTheme` branch so runtime theme registration is rejected:

```ts
if (message.method === 'registerTheme') {
  throw new Error('主题插件必须通过 manifest contributes.themes 声明，运行时主题注册已禁用')
}
```

Keep declarative manifest theme contribution handling intact.

- [ ] **Step 6: Normalize UI contributions to command rendering only**

In `src/main/plugins/manager.ts`, replace the `renderMode` normalization with:

```ts
const renderMode = 'command'
const autoLoad = typeof record.autoLoad === 'boolean' ? record.autoLoad : false
```

Keep the existing `command` validation for `sidebarPage`, `playerBarButton`, and `settingsPanel`.

- [ ] **Step 7: Update manager contract test**

In `src/main/plugins/managerContract.test.ts`, replace any assertion expecting `record.renderMode === 'html' ? 'html' : 'command'` with assertions that prove command-only behavior:

```ts
assert.match(managerSource, /const renderMode = 'command'/)
assert.doesNotMatch(managerSource, /record\.renderMode === 'html'/)
assert.doesNotMatch(managerSource, /allow-same-origin/)
```

- [ ] **Step 8: Remove iframe `srcdoc` rendering**

In `src/renderer/src/components/PluginExtensionPage.vue`, remove `isHtmlMode`, `htmlContent`, and the iframe block. Render command results as text only:

```vue
<div v-else-if="textResult" class="plugin-extension-text-result">
  <pre>{{ textResult }}</pre>
</div>
```

In the command-result handler, stringify non-string results:

```ts
textResult.value =
  result == null ? '' : typeof result === 'string' ? result : JSON.stringify(result, null, 2)
```

- [ ] **Step 9: Remove `html` from public renderer/preload/API types**

In these files, change render-mode types from `'command' | 'html'` to only `'command'` or remove the optional property when local code no longer reads it:

```text
src/renderer/src/extensions/registry.ts
src/preload/types.ts
src/preload/index.d.ts
packages/plugin-api/src/index.ts
packages/plugin-api/test/index.typecheck.ts
```

The typecheck fixture should use:

```ts
renderMode: 'command'
```

or omit `renderMode`.

- [ ] **Step 10: Run focused extension tests**

Run:

```powershell
node --experimental-strip-types --test src/main/plugins/manifest.test.ts src/main/plugins/managerContract.test.ts
npm run build:plugin-api
```

Expected: both commands pass.

- [ ] **Step 11: Commit extension contract changes**

Run:

```powershell
git add src/main/plugins/manifest.ts src/main/plugins/manifest.test.ts src/main/plugins/manager.ts src/main/plugins/managerContract.test.ts src/main/pluginHost.ts src/renderer/src/extensions/registry.ts src/renderer/src/components/PluginExtensionPage.vue src/preload/types.ts src/preload/index.d.ts packages/plugin-api/src/index.ts packages/plugin-api/test/index.typecheck.ts
git commit -m "fix: constrain plugin extension contracts"
```

Expected: commit contains only the listed files.

---

### Task 2: Make Plugin Proxy Settings Truthful

**Files:**
- Modify: `src/main/plugins/proxyBootstrap.ts`
- Modify: `src/main/pluginHost.ts`
- Modify: `src/main/ipc/plugins.ts`
- Modify: `src/main/core/settings.ts`
- Create: `src/main/core/settings.test.ts`

- [ ] **Step 1: Add focused settings tests**

Create `src/main/core/settings.test.ts` with:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS,
  getRestartReasons,
  normalizeAppSettings
} from './settings.ts'

test('proxy changes require restart for plugin host processes', () => {
  const launch = normalizeAppSettings({
    ...DEFAULT_SETTINGS,
    proxyMode: 'auto',
    proxyHost: '',
    proxyPort: 0
  })
  const settings = normalizeAppSettings({
    ...launch,
    proxyMode: 'off'
  })

  assert.deepEqual(getRestartReasons(settings, launch), ['插件代理'])
})
```

- [ ] **Step 2: Run the settings test and verify it fails**

Run:

```powershell
node --experimental-strip-types --test src/main/core/settings.test.ts
```

Expected: FAIL because proxy changes are not yet included in restart reasons.

- [ ] **Step 3: Make proxy restart reasons explicit**

In `src/main/core/settings.ts`, extend `getRestartReasons`:

```ts
if (
  settings.proxyMode !== launch.proxyMode ||
  settings.proxyHost !== launch.proxyHost ||
  settings.proxyPort !== launch.proxyPort
) {
  reasons.push('插件代理')
}
```

- [ ] **Step 4: Change proxy bootstrap to accept policy**

In `src/main/plugins/proxyBootstrap.ts`, change `initProxy` signature:

```ts
export type PluginProxyMode = 'auto' | 'custom' | 'off'

export async function initProxy(mode: PluginProxyMode = 'auto'): Promise<void> {
  if (mode === 'off') return
  if (mode === 'custom') return
  // existing auto-detection logic remains here
}
```

Keep the existing auto-detection code inside the `auto` path.

- [ ] **Step 5: Pass proxy mode into plugin host startup**

In `src/main/pluginHost.ts`, read the proxy mode from the utility-process environment:

```ts
const proxyMode = process.env.TWILIGHT_PLUGIN_PROXY_MODE
await initProxy(proxyMode === 'off' || proxyMode === 'custom' ? proxyMode : 'auto')
```

- [ ] **Step 6: Set proxy policy and env in plugin manager setup**

In `src/main/ipc/plugins.ts`, update the plugin manager options:

```ts
getProxyEnv: (): Record<string, string> => {
  const mode = runtime.appSettings.proxyMode
  if (mode === 'off') return { TWILIGHT_PLUGIN_PROXY_MODE: 'off' }
  if (mode === 'custom' && runtime.appSettings.proxyHost && runtime.appSettings.proxyPort > 0) {
    const proxyUrl = `http://${runtime.appSettings.proxyHost}:${runtime.appSettings.proxyPort}`
    return {
      TWILIGHT_PLUGIN_PROXY_MODE: 'custom',
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl
    }
  }
  return { TWILIGHT_PLUGIN_PROXY_MODE: 'auto' }
}
```

- [ ] **Step 7: Run proxy/settings tests**

Run:

```powershell
node --experimental-strip-types --test src/main/core/settings.test.ts
node --experimental-strip-types --test src/main/plugins/managerContract.test.ts
npm run typecheck:node
```

Expected: all three commands pass, or typecheck reports only unrelated dirty audio work. Any plugin/settings type error must be fixed in this task.

- [ ] **Step 8: Commit proxy settings changes**

Run:

```powershell
git add src/main/plugins/proxyBootstrap.ts src/main/pluginHost.ts src/main/ipc/plugins.ts src/main/core/settings.ts
git add src/main/core/settings.test.ts
git commit -m "fix: make plugin proxy mode explicit"
```

---

### Task 3: Complete The Active Plugin Center UI

**Files:**
- Modify: `src/renderer/src/components/PluginPage.vue`

- [ ] **Step 1: Remove no-op developer mode**

In `src/renderer/src/components/PluginPage.vue`, remove:

```ts
const devMode = ref(false)
```

Remove the sidebar footer block that renders `开发者模式`. Keep local `.tep` install button visible in the installed tab.

- [ ] **Step 2: Add log preview state and helpers**

Add near the existing state refs:

```ts
const selectedLog = ref('')
const selectedLogPlugin = ref('')
const detailPluginId = ref('')
const detailIndexId = ref('')
```

Add:

```ts
async function previewLog(plugin: TwilightPluginDescriptor) {
  try {
    selectedLogPlugin.value = plugin.name
    selectedLog.value = await window.api.plugins.getLog(plugin.id)
  } catch (e) {
    errorMsg.value = `读取日志失败：${e instanceof Error ? e.message : String(e)}`
  }
}

function closeLogPreview() {
  selectedLogPlugin.value = ''
  selectedLog.value = ''
}
```

- [ ] **Step 3: Add uninstall confirmation with data choice**

Replace `uninstallPlugin` with:

```ts
async function uninstallPlugin(plugin: TwilightPluginDescriptor) {
  if (busyIds.value.has(plugin.id) || plugin.builtIn) return
  const choice = window.prompt(
    `卸载 ${plugin.name}\n\n输入 1 仅卸载插件文件。\n输入 2 卸载并删除插件私有数据。\n留空或取消则不卸载。`
  )
  if (choice == null || choice.trim() === '') return
  const normalized = choice.trim()
  if (normalized !== '1' && normalized !== '2') {
    errorMsg.value = '卸载已取消：请输入 1 或 2。'
    return
  }
  busyIds.value.add(plugin.id)
  try {
    await window.api.plugins.uninstall(plugin.id, { removeData: normalized === '2' })
    await loadAll()
  } catch (e) {
    errorMsg.value = `卸载失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    busyIds.value.delete(plugin.id)
  }
}
```

This uses the existing preload API and avoids adding new native dialog IPC in this round.

- [ ] **Step 4: Add display helpers for metadata**

Add:

```ts
function formatDate(value: string | null | undefined): string {
  if (!value) return '未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function dependencyEntries(plugin: TwilightPluginDescriptor): [string, string][] {
  return Object.entries(plugin.dependencies ?? {})
}

function permissionsText(permissions: string[]): string {
  return permissions.length > 0 ? permissions.join(', ') : '无'
}
```

- [ ] **Step 5: Show installed plugin details**

Inside each installed plugin card, add a compact metadata block:

```vue
<div class="plugin-meta-grid">
  <span>ID: {{ plugin.id }}</span>
  <span>License: {{ plugin.license }}</span>
  <span>Source: {{ plugin.source }}</span>
  <span>Updated: {{ formatDate(plugin.updatedAt) }}</span>
</div>
<div class="plugin-permissions">
  <strong>权限</strong>
  <code v-for="permission in plugin.permissions" :key="permission">{{ permission }}</code>
  <span v-if="plugin.permissions.length === 0">无</span>
</div>
<div v-if="dependencyEntries(plugin).length > 0" class="plugin-permissions">
  <strong>依赖</strong>
  <code v-for="[dependencyId, range] in dependencyEntries(plugin)" :key="dependencyId">
    {{ dependencyId }} {{ range }}
  </code>
</div>
<div v-if="plugin.isDsp" class="plugin-native-note">
  原生 DSP 插件运行在音频引擎进程内，处理失败会自动 bypass，硬崩溃可能触发引擎恢复。
</div>
```

- [ ] **Step 6: Make logs available for built-ins**

Change the log action button condition from:

```vue
v-if="!plugin.builtIn"
```

to always render log actions:

```vue
<button class="icon-btn" title="预览日志" @click="previewLog(plugin)">
  <i class="pi pi-align-left"></i>
</button>
<button class="icon-btn" title="打开日志文件" @click="openLog(plugin)">
  <i class="pi pi-external-link"></i>
</button>
```

Keep uninstall hidden or disabled for built-ins.

- [ ] **Step 7: Show index entry details before install**

Inside each index plugin card, add:

```vue
<div class="plugin-meta-grid">
  <span>ID: {{ entry.id }}</span>
  <span>License: {{ entry.license }}</span>
  <span>API v{{ entry.apiVersion }}</span>
  <span>Engine {{ entry.engines.twilightEcho }}</span>
</div>
<div class="plugin-permissions">
  <strong>权限</strong>
  <code v-for="permission in entry.permissions" :key="permission">{{ permission }}</code>
  <span v-if="entry.permissions.length === 0">无</span>
</div>
<div class="plugin-index-source" :title="entry.sourceUrl">
  {{ entry.verified ? '已审核索引' : '非审核索引' }} · {{ entry.checksumSha256.slice(0, 12) }}
</div>
```

- [ ] **Step 8: Add log preview panel**

Near the bottom of the template, add:

```vue
<div v-if="selectedLogPlugin" class="plugin-log-panel">
  <div class="plugin-log-head">
    <strong>{{ selectedLogPlugin }} 日志</strong>
    <button class="icon-btn" @click="closeLogPreview">
      <i class="pi pi-times"></i>
    </button>
  </div>
  <pre>{{ selectedLog || '暂无日志' }}</pre>
</div>
```

- [ ] **Step 9: Add minimal styles**

In the same SFC style block, add:

```css
.plugin-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 10px;
  margin: 10px 0;
  color: var(--te-neutral-500, #6b7280);
  font-size: 12px;
}

.plugin-permissions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  color: var(--te-neutral-500, #6b7280);
  font-size: 12px;
}

.plugin-permissions strong {
  color: var(--te-neutral-700, #374151);
}

.plugin-permissions code,
.plugin-permissions span {
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.04);
  padding: 3px 7px;
  font-size: 11px;
  font-weight: 700;
}

.plugin-native-note,
.plugin-index-source {
  margin-top: 10px;
  border-radius: 10px;
  background: var(--te-warning-soft-bg, #fff7ed);
  color: #9a3412;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 700;
}

.plugin-log-panel {
  margin: 0 32px 32px;
  border: 1px solid var(--te-border-color, #e5e7eb);
  border-radius: 14px;
  background: var(--te-bg-card, #fff);
  overflow: hidden;
}

.plugin-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--te-border-color, #e5e7eb);
}

.plugin-log-panel pre {
  max-height: 260px;
  margin: 0;
  overflow: auto;
  padding: 14px;
  background: #0f172a;
  color: #dbeafe;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}
```

- [ ] **Step 10: Typecheck renderer changes**

Run:

```powershell
npm run typecheck:web
```

Expected: pass, or fail only on unrelated dirty files outside this task. Any `PluginPage.vue` error must be fixed here.

- [ ] **Step 11: Commit PluginPage changes**

Run:

```powershell
git add src/renderer/src/components/PluginPage.vue
git commit -m "fix: complete active plugin center details"
```

Expected: commit contains only `PluginPage.vue`.

---

### Task 4: Make Settings Labels And Links Truthful

**Files:**
- Modify: `src/renderer/src/components/SettingsPage.vue`
- Modify: `src/main/ipc/data.ts`

- [ ] **Step 1: Add shared project URL constants in renderer**

In `src/renderer/src/components/SettingsPage.vue`, replace old URL constants with:

```ts
const PROJECT_REPOSITORY_URL = 'https://github.com/asenyarzc-cpu/Twilight_Echo'
const PROJECT_RELEASES_URL = `${PROJECT_REPOSITORY_URL}/releases`
const HOMEPAGE_URL = 'https://TwilightEcho.com'
```

Update `openGithub` and `openReleases` to use the new constants.

- [ ] **Step 2: Update release check URL**

In `src/main/ipc/data.ts`, replace:

```ts
'https://api.github.com/repos/nousresearch/twilight-echo/releases/latest'
```

with:

```ts
'https://api.github.com/repos/asenyarzc-cpu/Twilight_Echo/releases/latest'
```

- [ ] **Step 3: Relabel the bit-perfect preset**

In `SettingsPage.vue`, replace the visible label:

```vue
纯净直通 (Bit-perfect)
```

with:

```vue
DSP 旁路 (DSP Bypass)
```

Replace helper/copy near that control so it says:

```text
关闭 DSP 处理链，不代表严格 bit-perfect。真正直通仍取决于输出模式、音量、设备和系统混音路径。
```

- [ ] **Step 4: Replace High-Res no-op switch with static status**

Find the High-Res setting block. Remove the clickable/inactive switch and render:

```vue
<span class="compute-badge">预留</span>
```

Keep explanatory text:

```text
高解析度处理入口已预留，当前原生 DSP 链尚未消费该开关。
```

- [ ] **Step 5: Make inherited page background controls actually disabled**

For page background color inputs and image buttons inside inherited page rows, bind `disabled`:

```vue
:disabled="settings.appBackground.pages[page.value].inherit"
```

For button groups that cannot use native `disabled`, add the same guard to handlers:

```vue
@click="!settings.appBackground.pages[page.value].inherit && setPageBackgroundKind(page.value, 'color')"
```

Do this for color/image kind buttons, color inputs, choose image, and clear image controls.

- [ ] **Step 6: Clarify proxy restart copy**

In the proxy section, replace the description with:

```text
为流媒体插件配置 HTTP 代理。更改后需要重启应用或重启插件宿主后生效。
```

Keep the `off` option label as `关闭`.

- [ ] **Step 7: Typecheck touched settings files**

Run:

```powershell
npm run typecheck:node
npm run typecheck:web
```

Expected: pass, or fail only on unrelated dirty files outside this task. Any `SettingsPage.vue` or `data.ts` error must be fixed here.

- [ ] **Step 8: Commit settings semantics changes**

Run:

```powershell
git add src/renderer/src/components/SettingsPage.vue src/main/ipc/data.ts
git commit -m "fix: clarify settings semantics"
```

Expected: commit contains only the listed files.

---

### Task 5: Update Documentation For Supported Plugin Paths

**Files:**
- Modify: `docs/PLUGIN_README.md`
- Modify: `docs/PLUGIN_DEVELOPMENT.md`
- Modify: `docs/plugin-api-draft.md`
- Modify: `packages/plugin-api/README.md`
- Modify: `packages/create-twilight-plugin/templates/ui-tool/README.md.tmpl`

- [ ] **Step 1: Remove supported HTML render-mode docs**

Search:

```powershell
rg -n "renderMode|html|allow-scripts|allow-same-origin|iframe|themes\\.register" docs packages
```

For each documentation section that says `renderMode: 'html'` is supported, replace it with:

```md
UI contributions currently use command rendering. A plugin command may return a string
or JSON-serializable object, and the host renders that result in a controlled surface.
Arbitrary plugin-provided HTML is not a supported extension path.
```

- [ ] **Step 2: Remove runtime theme registration docs**

For docs that mention `themes.register()`, replace with:

```md
Theme plugins declare CSS variables and stylesheets in `plugin.json` under
`contributes.themes`. Theme scripts are not executed.
```

- [ ] **Step 3: Update UI tool template README**

In `packages/create-twilight-plugin/templates/ui-tool/README.md.tmpl`, replace any suggestion to use HTML render mode with:

```md
The template uses command-rendered UI contributions. Return plain text or structured
data from commands; host-rendered settings DTOs will be introduced separately.
```

- [ ] **Step 4: Verify docs no longer advertise unsafe paths**

Run:

```powershell
rg -n "renderMode: 'html'|allow-scripts|allow-same-origin|themes\\.register\\(" docs packages src
```

Expected: no matches in docs, packages, or source except historical test assertions that were deliberately updated in Task 1. If source still mentions removed APIs, fix the source or type file in Task 1's touched set.

- [ ] **Step 5: Commit docs updates**

Run:

```powershell
git add docs/PLUGIN_README.md docs/PLUGIN_DEVELOPMENT.md docs/plugin-api-draft.md packages/plugin-api/README.md packages/create-twilight-plugin/templates/ui-tool/README.md.tmpl
git commit -m "docs: document safe plugin extension paths"
```

Expected: commit contains only documentation/template text files.

---

### Task 6: Run Focused Verification

**Files:**
- No source edits unless a verification failure points to a bug introduced by Tasks 1-5.

- [ ] **Step 1: Check that unrelated dirty files are not staged**

Run:

```powershell
git diff --cached --name-only
git status --short
```

Expected: no staged files before verification. Dirty audio/visualizer files may exist only if using the original shared worktree; in an isolated worktree they should not exist.

- [ ] **Step 2: Run plugin tests**

Run:

```powershell
npm run test:plugins
```

Expected: pass. If a failure is in manifest, manager contract, index service, provider routing, theme selection, or plugin API behavior touched by this plan, fix it before continuing.

- [ ] **Step 3: Run typechecks**

Run:

```powershell
npm run typecheck:node
npm run typecheck:web
```

Expected: both pass. If failures are in untouched audio/visualizer files from another agent, record exact file paths and do not edit them.

- [ ] **Step 4: Run source-level safety scans**

Run:

```powershell
rg -n "renderMode: 'html'|allow-scripts|allow-same-origin|themes\\.register\\(" src packages docs
rg -n "nousresearch/twilight-echo" src docs packages
```

Expected: no matches. If docs intentionally mention removed behavior as historical context, rewrite the section to avoid teaching it as supported behavior.

- [ ] **Step 5: Final status check**

Run:

```powershell
git status --short
git log --oneline -n 6
```

Expected: only planned commits are present on the implementation branch. No unrelated dirty files are staged.

---

## Coverage Matrix

- Active plugin center details: Task 3.
- Per-plugin logs for built-ins: Task 3.
- Safe uninstall with private data choice: Task 3.
- DSP risk visibility in active plugin page: Task 3.
- Remove no-op developer mode: Task 3.
- Pure theme declarative-only rule: Task 1.
- Remove runtime theme registration path: Task 1 and Task 5.
- Remove unsafe HTML UI extension mode: Task 1 and Task 5.
- Proxy off and restart-required truthfulness: Task 2 and Task 4.
- Bit-perfect overpromise: Task 4.
- High-Res no-op control: Task 4.
- Background inheritance disabled behavior: Task 4.
- Current repository update/About links: Task 4.
- Verification without touching unrelated audio/visualizer WIP: Task 0 and Task 6.
