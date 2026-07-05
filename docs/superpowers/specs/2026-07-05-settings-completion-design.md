# Settings Completion Design

Date: 2026-07-05
Project: Twilight Echo
Status: approved first-round scope, pending implementation plan

## Context

The settings audit found several visible settings or plugin-management features that are
missing, only partially implemented, or inconsistent with the Twilight Echo plugin
standard. The worktree currently has unrelated audio engine and visualizer changes from
other agents. This design intentionally avoids those files unless a setting fix cannot be
made anywhere else.

Authoritative plugin-system rules remain:

- `docs/twilight-echo-plugin-spec.md`
- `docs/twilight-echo-plugin-plan.md`

The first implementation round should make the visible settings surface truthful and bring
the active plugin-management path closer to the spec without starting a large plugin API
redesign.

## Goals

1. Complete the active plugin center UI enough to satisfy the Phase 1 management
   expectations: permissions, errors, enable/disable, uninstall, local install,
   marketplace install, per-plugin logs, and DSP risk visibility.
2. Remove or constrain plugin extension behavior that conflicts with the spec:
   theme plugins must remain declarative, and UI extensions must not get arbitrary DOM
   execution through the current HTML iframe path.
3. Fix settings controls whose labels overpromise their actual behavior: proxy off,
   high-resolution processing, bit-perfect preset, inherited background controls, and
   stale project/update links.
4. Preserve all unrelated work in the shared worktree.

## Non-Goals

- Do not implement the full future `settingsPanel` DTO schema in this round.
- Do not migrate third-party plugin source into the main repository.
- Do not rewrite the audio engine or the visualizer work currently being edited by other
  agents.
- Do not implement a full strict bit-perfect mode in this round. The current control
  should be relabeled to match its actual DSP-bypass behavior.
- Do not publish packages or change remote plugin index hosting.

## Approach Options

### Option A: Conservative Completion

Keep the active `PluginPage.vue` as the entry point, port the useful management behaviors
from the unused `PluginSettingsPanel.vue`, tighten unsafe extension paths, and clarify the
smaller settings controls.

This is the recommended path because it fixes visible user-facing gaps with limited blast
radius and minimal overlap with other agents' audio work.

### Option B: Deep Plugin Settings Redesign

Add a full host-rendered settings-panel schema, replace command-only plugin panels, and
redesign the plugin center around that schema.

This would better match the long-term Phase 3 direction, but it is too large for this
first completion round and risks mixing API design with UI cleanup.

### Option C: Backend-Only Corrections

Only enforce manifest/runtime rules and proxy behavior, leaving the UI mostly unchanged.

This reduces implementation risk but leaves the visible settings experience incomplete,
which does not satisfy the user's request to traverse and complete settings items.

## Recommended Design

Use Option A.

### 1. Active Plugin Center

`src/renderer/src/components/PluginPage.vue` remains the mounted plugin center. It should
gain the management details that already exist partly in `PluginSettingsPanel.vue`:

- Installed plugin cards show permissions, license, source, engine range, API version,
  dependencies, installed/updated timestamps, built-in state, and error details.
- Index plugin cards show permissions, license, engine range, API version, source URL,
  checksum, verified state, tags, installed state, and update version.
- Built-in plugins keep uninstall disabled, but logs remain visible.
- Per-plugin logs support both "preview in UI" and "open log file".
- DSP plugins are visually separated or clearly flagged with native risk text, runtime
  status, bypass reason/error, and available native parameter controls.
- The visible developer-mode toggle is removed unless it gates a real behavior. In this
  round, remove it from the UI because local install is already exposed and no developer
  action depends on the toggle.
- Uninstall uses a real three-result flow: cancel, uninstall plugin files only, or
  uninstall and remove `plugin-data/<id>/`.

Implementation should prefer extracting small helpers inside `PluginPage.vue` only if the
file becomes difficult to follow. Avoid broad styling rewrites.

### 2. Plugin Extension Rules

Theme plugins must be declarative in this round:

- Pure `theme` plugins should use `contributes.themes` and should not execute a JS `main`.
- Runtime `twilight.themes.register()` remains rejected for pure theme-only plugins.
- Mixed plugins that include `theme` plus executable types may continue to run for their
  executable type, but theme contribution should be read from manifest/declarative
  contribution data rather than granting arbitrary theme script execution.

HTML UI extension mode is too broad for the current spec:

- `renderMode: 'html'` should no longer execute plugin-returned HTML with
  `allow-scripts allow-same-origin`.
- Existing sidebar UI extension pages should fall back to command/text rendering.
- Types and docs should be updated so new plugins do not learn the unsafe HTML mode as a
  supported path.
- A future host-rendered DTO schema can be designed separately.

### 3. Settings Semantics

Proxy settings:

- `proxyMode: 'off'` must disable plugin-host proxy auto-detection.
- `proxyMode: 'auto'` may keep current local proxy probing.
- `proxyMode: 'custom'` passes explicit `HTTP_PROXY`/`HTTPS_PROXY` style environment.
- Existing plugin host processes do not dynamically update their process environment.
  Therefore proxy changes should either restart affected plugin hosts or mark proxy as a
  restart-required setting. This round should at minimum show restart-required feedback.

Bit-perfect preset:

- Relabel "纯净直通 (Bit-perfect)" to a truthful DSP-bypass preset, because it only
  disables DSP and does not enforce output device, exclusive mode, renderer fallback,
  or volume unity.

High-resolution processing:

- Hide the inactive High-Res toggle or make it a static "reserved/not connected" note.
  Do not keep a clickable-looking no-op switch.

Background inheritance:

- Controls that appear disabled while a page inherits the global background should either
  be actually disabled or explicitly say that editing will cancel inheritance.
- The first round should make the UI behavior match the disabled visual state.

About/update links:

- Settings links and update checking should use the current project repository source,
  not the stale `nousresearch/twilight-echo` URL.
- The renderer About links and main-process `app:checkForUpdates` endpoint should read
  from one shared constant or equivalent single source.

Sponsor card:

- The card explicitly says the sponsor entrance is not connected. It is low priority and
  can remain as static pending copy unless the implementation round has spare capacity.

### 4. Error Handling

- Plugin list/index/log actions should surface errors in the existing banner area and
  not leave `busyIds` stuck.
- Log preview failures should not block opening external logs.
- Plugin uninstall cancel should be silent, not shown as an error.
- Incompatible or built-in-blocked index entries must remain non-installable.
- Theme/runtime extension rejection errors should be written to plugin logs and reflected
  through failed/invalid plugin state where appropriate.

### 5. Testing

Use focused tests aligned to the touched surfaces:

- `npm run test:plugins` for manifest/runtime/plugin contract changes.
- Single plugin test files when available:
  - `node --experimental-strip-types --test src/main/plugins/manifest.test.ts`
  - `node --experimental-strip-types --test src/main/plugins/managerContract.test.ts`
  - `node --experimental-strip-types --test src/main/plugins/indexService.test.ts`
- Type checks for changed preload/plugin API types:
  - `npm run typecheck:node`
  - `npm run typecheck:web`
- If renderer-only UI changes cannot be unit tested directly, verify by typecheck and
  targeted source inspection. Do not start broad audio tests unless audio files are
  touched.

## Implementation Boundaries

Likely touched files:

- `src/renderer/src/components/PluginPage.vue`
- `src/renderer/src/components/PluginExtensionPage.vue`
- `src/renderer/src/components/SettingsPage.vue`
- `src/renderer/src/extensions/registry.ts`
- `src/main/plugins/manifest.ts`
- `src/main/plugins/manager.ts`
- `src/main/pluginHost.ts`
- `src/main/plugins/proxyBootstrap.ts`
- `src/main/ipc/plugins.ts`
- `src/main/ipc/data.ts`
- `src/preload/types.ts`
- `src/preload/index.d.ts`
- `packages/plugin-api/src/index.ts`
- plugin docs and tests that mention removed HTML mode or runtime theme registration

Files to avoid unless required by a specific compile error:

- `audio-engine/**`
- `resources/audio-visualizer/**`
- `src/main/audioEngineManager.ts`
- `src/renderer/src/stores/usePlayerStore.ts`

## Fixed Decisions For Implementation

Mixed plugins that include `theme` plus executable types may still execute for their
non-theme capabilities, but all theme contributions must come from declarative manifest
data. The host should not expose runtime theme registration as a supported theme-extension
path in this round.

Proxy changes should be treated as restart-required in this round. Newly started plugin
hosts must honor `proxyMode: 'off'` by skipping proxy auto-detection, but this round does
not need to hot-restart already-running plugin hosts.
