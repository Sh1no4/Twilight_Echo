# Twilight Echo Project Rules

These rules are mandatory when working in `D:\Twilight_Echo-main`.

This file also guides CodeBuddy Code / AI agents. The plugin-system rules below are authoritative; the later sections provide the build, test, and architecture context needed to work productively.

## Plugin System Source Of Truth

- Follow `docs/twilight-echo-plugin-spec.md` and `docs/twilight-echo-plugin-plan.md` before designing or editing plugin-system code.
- The Twilight Echo plugin standards in this repository override generic Codex plugin conventions.
- Do not silently simplify, rename, or replace plugin-system requirements. If a requirement conflicts with the current codebase, explain the conflict before choosing an alternative.

## Plugin Repository Boundary

- Do not write third-party plugin source code into the Twilight Echo app repository.
- The app repository may contain only host/runtime code, built-in app plugins such as `com.twilightecho.provider.ncm`, plugin API typings, plugin tooling, built-in examples needed for host validation, and the bundled/static index client.
- Third-party plugin source, tests, packaged `.tep` artifacts, and plugin-specific README files belong in the external plugin repository:
  - GitHub: https://github.com/asenyarzc-cpu/Twilight-Echo-plugins/
  - Local path: `D:\Twilight-Echo-plugins`
- Future third-party plugins must be added under `D:\Twilight-Echo-plugins\plugins\<plugin-name>\`, packaged into `D:\Twilight-Echo-plugins\packages\`, and indexed by `D:\Twilight-Echo-plugins\plugins.json`.
- The app should consume third-party plugins through `TWILIGHT_PLUGIN_INDEX_URL`, pointed at the GitHub raw `plugins.json` URL or a future self-hosted HTTPS `plugins.json`.
- If a change requires app-side support for a plugin, implement only the generic host/API/UI capability in `D:\Twilight_Echo-main`; keep plugin-specific implementation in `D:\Twilight-Echo-plugins`.

## Built-In Provider Exception

- NetEase Cloud Music remains a built-in base provider plugin owned by the app repository.
- Built-in provider code may live in `resources/plugins/ncm-provider` because it ships with the application, is synced by the host, and cannot be uninstalled like third-party plugins.
- Do not use the NCM exception as precedent for third-party provider plugins.

## Build, Lint, Typecheck, Test

All commands run from the repo root. JS/TS tests use Node's built-in `node --test` runner (no Jest/Vitest); test files are co-located as `*.test.ts` next to the source they cover.

### Development & build

```bash
npm run dev                 # electron-vite dev (compiles all 3 main entries + preload + renderer, launches Electron)
npm run build               # typecheck + electron-vite build
npm run build:unpack        # build + electron-builder --dir (unpacked, for local verification)
npm run build:win           # build + electron-builder --win (NSIS)
npm run build:mac           # build + electron-builder --mac (dmg)
npm run build:linux         # build + electron-builder --linux (AppImage/snap/deb)
```

### Lint / format / typecheck

```bash
npm run lint                # eslint --cache .
npm run format              # prettier --write .
npm run typecheck           # typecheck:node + typecheck:web
npm run typecheck:node      # tsc --noEmit -p tsconfig.node.json
npm run typecheck:web       # vue-tsc --noEmit -p tsconfig.web.json
```

### App tests (Node `--test`)

```bash
npm run test:plugins          # plugin host/manager/manifest/dependencies/routing + renderer provider store
npm run test:audio-manager    # src/main/audioEngineManager + service client + IPC queue
npm run test:playback-routing # renderer playback routing/fallback + library/lyrics/metadata utils + stores
npm run test:local-perf       # local music perf + song-list context menu + favorite button
npm run test:plugin-tooling   # packages/create-twilight-plugin CLI tests (.cjs)
```

### Running a single test file

```bash
# TS test files (strip-types):
node --experimental-strip-types --test path/to/file.test.ts

# CJS test files:
node --test path/to/file.test.cjs
```

Example: `node --experimental-strip-types --test src/main/audioEngineManager.test.ts`

### Native audio engine (Windows MinGW, verified toolchain)

```bash
npm run configure:audio-engine:mingw   # node scripts/configure-audio-engine-mingw.cjs
npm run build:audio-engine:mingw       # cmake --build + npm run stage:audio-engine
npm run test:audio-engine:mingw        # ctest --test-dir audio-engine/build/mingw-static
```

Default (non-MinGW) CMake entry exists but MinGW is the verified Windows path. `npm run test:no-real-device` runs the full no-real-device gate: MinGW configure/build/test + audio-manager + playback-routing + typecheck + build.

### Release gate (Windows)

Per `docs/windows-release-gate.md`: `typecheck`, `test:plugins`, `test:audio-manager`, `test:playback-routing`, `build`, plus the MinGW native engine configure/build/test. Real-device smoke (ASIO / WASAPI Exclusive / native DSD / SACD ISO / CoreAudio / ALSA `hw:`) is opt-in and NOT part of the default gate.

## High-Level Architecture

Standard three-part Electron app (main / preload / renderer), plus an isolated plugin host process and an out-of-process optional audio engine service.

### Main process entries (`electron.vite.config.ts` declares 3)

- `index` → `src/main/index.ts` → `src/main/app/lifecycle.ts` `startApp()`: window lifecycle, single-instance lock, IPC registration, settings, library scan, integrations (tray/shortcuts, desktop lyrics, Discord RPC), NCM API bootstrap.
- `pluginHost` → `src/main/pluginHost.ts`: runs inside an Electron `utilityProcess` for crash isolation. Loads JS plugins, brokers the versioned `twilight` API gateway, provider registration, event bus, and per-plugin settings/storage. Plugins must never import host internals / Electron / Node directly — all access goes through the `twilight` API object.
- `audioEngineService` → `src/main/audioEngineService.ts`: optionally hosts the native engine in a restartable child process so a native DSP/engine crash does not kill the main process. `TWILIGHT_AUDIO_SERVICE=0` is a dev-only fallback to run the engine in-process.

### Native audio load chain

`twilight_audio_node.node` (Node-API addon) → `twilight-audio-engine.dll` (C ABI) → `FFmpeg decode → DSP chain → WASAPI / CoreAudio / ALSA / ASIO`. Orchestrated by `src/main/audioEngineManager.ts` (~85KB, the largest single module). DSP plugins are bypassed on DSD/passthrough paths and auto-bypassed on timeout/failure per the spec's real-time safety rules.

### Preload (`src/preload/index.ts`)

Exposes a safe `contextBridge` API to the renderer, including `Play`, `Pause`, `Stop`, `Seek`, `SetVolume`, `SetOutputDevice`, `SetOutputBackend`, `GetPlaybackInfo`, `GetSpectrumData`, plus plugin/provider/data IPC channels. Types live in `src/preload/index.d.ts` and `types.ts`.

### Renderer (`src/renderer/src/`)

Vue 3 + TypeScript. Path alias `@renderer` → `src/renderer/src`.

- `App.vue` + `app/useAppNavigation.ts`: top-level shell and surface routing (local / playing / settings / plugin / equalizer / streaming).
- `stores/`: composable stores — `usePlayerStore` (largest, ~76KB), `useMusicStore`, `useNcmStore`, `useProviderStore`, `useSettingsStore`, `useListeningStatsStore`.
- `providers/`: `mediaProvider.ts` unified `MediaProvider` abstraction; provider IDs carry a provider prefix (e.g. `ncm:12345`, `local:<hash>`) that flows through queue, library, and session persistence.
- `components/`: feature pages (`StreamingPage`, `LocalDashboard`, `SettingsPage`, `PluginPage`, `EqualizerPage`, `PlayerBar`, `SongList`, …) with co-located subcomposables under `player-bar/`, `settings-page/`, `song-list/`, `streaming-page/`.
- `extensions/`: declarative extension runtime (themes, sidebar pages, PlayerBar buttons). Theme plugins are CSS-variable/stylesheet only — no script execution.
- `utils/`: playback routing/fallback, logical-track model, library repair/metadata enrichment, lyrics, unified search/favorite/recent — most have co-located tests.

### IPC

Main-process IPC handlers live in `src/main/ipc/` (`data.ts`, `plugins.ts`, `opra.ts`), `src/main/audio/engineIpc.ts`, and `src/main/ncm/api.ts`. Plugin IPC bridges renderer ↔ plugin host utilityProcess.

### Bundled resources

- `resources/audio-engine/` — `twilight-audio-engine.dll` + `twilight_audio_node.node` (large binaries; `.gitkeep`'d dir, must be present for packaged builds to load the native engine).
- `resources/plugins/ncm-provider/` — built-in NCM `MediaProvider` plugin (`plugin.json` + `index.mjs`). This is the only built-in provider exception (see above).
- `resources/plugin-index/plugins.json` — static/offline plugin index; remote index via `TWILIGHT_PLUGIN_INDEX_URL` takes precedence, then cache, then this file.

### Plugin system references

- Spec (authoritative): `docs/twilight-echo-plugin-spec.md`
- Plan: `docs/twilight-echo-plugin-plan.md`
- API typings package: `packages/plugin-api/` (publishes `@twilight-echo/plugin-api`)
- Scaffolder: `packages/create-twilight-plugin/` (`init` + `pack` → `.tep`)
- Developer guides: `docs/PLUGIN_README.md`, `docs/PLUGIN_DEVELOPMENT.md`, `docs/plugin-api-draft.md`

## Code Style Conventions

- Prettier (`.prettierrc.yaml`): `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`, `endOfLine: auto`.
- ESLint flat config (`eslint.config.mjs`): ignores `node_modules`, `dist`, `out`. Vue SFCs must use `<script lang="ts">` (enforced by `vue/block-lang`).
- TypeScript strict via `@electron-toolkit/tsconfig`; `allowImportingTsExtensions` is on — imports may use `.ts` extensions.
- Tests are co-located `*.test.ts` / `*.test.mjs` / `*.test.cjs` and run via `node --test` (with `--experimental-strip-types` for TS). There is no separate test framework config to maintain.
- Renderer imports use the `@renderer/*` alias, not deep relative paths.

## Platform & Runtime Caveats

- **Windows**: native audio engine fully verified (WASAPI shared/exclusive, ASIO via SDK, DoP, SACD ISO). This is the primary target platform.
- **macOS / Linux**: native engine code is present but NOT verified — CoreAudio (macOS) and ALSA (Linux) paths may not work. Do not assume these platforms are release-ready; flag changes touching `audio-engine/output/` CoreAudio/ALSA backends accordingly.
- WASAPI and CoreAudio have no native DSD channel (platform limit); DSD goes through DoP or PCM fallback on those backends. ALSA `hw:` supports native DSD.
- NCM (NetEase Cloud Music) features depend on the bundled `@neteasecloudmusicapienhanced/api` service running locally.
- `TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK=1` enables an HTMLAudio renderer fallback for debugging when the native engine is unavailable — off by default, not for production.
- Shared Mode output goes through the system mixer (expected, not a bug).

## Key Entry Points Quick Reference

| Concern | File |
|---|---|
| Main process bootstrap | `src/main/index.ts` → `src/main/app/lifecycle.ts` |
| Window creation | `src/main/app/window.ts` |
| Settings | `src/main/core/settings.ts`, `src/renderer/src/stores/useSettingsStore.ts` |
| Audio engine orchestration | `src/main/audioEngineManager.ts` |
| Audio engine IPC | `src/main/audio/engineIpc.ts` |
| Plugin host (utilityProcess) | `src/main/pluginHost.ts` |
| Plugin manager (main side) | `src/main/plugins/manager.ts`, `manifest.ts`, `dependencies.ts`, `indexService.ts`, `providerRouting.ts` |
| Plugin IPC | `src/main/ipc/plugins.ts` |
| Preload bridge | `src/preload/index.ts` |
| Renderer root | `src/renderer/src/App.vue`, `main.ts` |
| Player state | `src/renderer/src/stores/usePlayerStore.ts` |
| Provider abstraction | `src/renderer/src/providers/mediaProvider.ts` |
| Vite/electron-vite config | `electron.vite.config.ts` |
| Package scripts | `package.json` |
| Packaging | `electron-builder.yml` |
