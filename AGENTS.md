# Twilight Echo — Agent Instructions

Desktop music player: Electron + Vue 3 + TypeScript + C++20 native HiFi engine.
Deeper architecture: `docs/DEVELOPER_README.md`. Plugin contracts (authoritative): `docs/twilight-echo-plugin-spec.md`, `docs/twilight-echo-plugin-plan.md`. Windows release gate: `docs/windows-release-gate.md`.

## Non-negotiable boundaries

- **pnpm only**: `packageManager` pins `pnpm@11.7.0`. Use `pnpm-lock.yaml`; never `npm install` / `package-lock.json`.
- Install: `corepack enable` then `pnpm install --frozen-lockfile` (applies NCM `patchedDependencies` from `pnpm-workspace.yaml`).
- **Do not write third-party plugin source into this repo.** Host/runtime, plugin API, scaffolder, static index client, and built-in NCM only.
  - External plugins: https://github.com/asenyarzc-cpu/Twilight-Echo-plugins/ (local: `D:\Twilight-Echo-plugins`)
  - Layout: `plugins/<name>/` → pack to `packages/` → index in `plugins.json`
  - App index order: `TWILIGHT_PLUGIN_INDEX_URL` → cache → `resources/plugin-index/plugins.json`
- **Only built-in provider exception**: `resources/plugins/ncm-provider` (`com.twilightecho.provider.ncm`). Not a precedent for third-party plugins.
- Plugin code runs only in `pluginHost` via the versioned `twilight` API — never import Electron, Node, or host internals.
- Before designing/editing plugin-system behavior, read the plugin spec/plan. Do not silently simplify or rename requirements; if code conflicts with the spec, call it out first.

## Commands (repo root)

```bash
pnpm run dev                 # electron-vite: 5 main entries + preload + renderer
pnpm run build               # typecheck + electron-vite build + font strip + renderer budgets
pnpm run build:unpack        # build + electron-builder --dir
pnpm run build:win|mac|linux
pnpm run lint                # eslint --cache .
pnpm run format              # prettier --write .
pnpm run typecheck           # typecheck:node + typecheck:web
```

### Tests — `node --test` only (no Jest/Vitest)

Co-located `*.test.ts` / `*.test.cjs` / `*.test.mjs`.

```bash
pnpm run test:plugins
pnpm run test:audio-manager
pnpm run test:playback-routing
pnpm run test:local-perf
pnpm run test:plugin-tooling
pnpm run test:app
pnpm run test:lyrics-management
pnpm run test:playlist-lifecycle
pnpm run test:queue-virtualization
pnpm run test:cue
pnpm run test:dsp-graph
pnpm run test:dsp-assets
pnpm run test:sleep-timer
pnpm run test:tag-duplicate-management
pnpm run test:duplicate-detection
pnpm run test:no-real-device   # full no-device gate (toolchain + MinGW + suites + typecheck + build)
```

Single file:

```bash
node --experimental-strip-types --test path/to/file.test.ts
node --test path/to/file.test.cjs
```

### Native audio (Windows MinGW — verified path)

This clone path has whitespace, so **always** set an external build dir with no spaces:

```powershell
$env:TAE_MINGW_BUILD_DIR = 'C:\twilight-build\mingw-static'
# Optional if Git for Windows patch is missing:
# $env:TWILIGHT_GNU_PATCH = 'C:\Program Files\Git\usr\bin\patch.exe'
pnpm run configure:audio-engine:mingw
pnpm run build:audio-engine:mingw
pnpm run test:audio-engine:mingw
```

Configure/build/CTest/stage share `$env:TAE_MINGW_BUILD_DIR` (tmp: `...\tmp`). MinGW is the verified Windows toolchain; default CMake exists but is not the release path. VST3 host is MSVC and separate: `configure:vst3-msvc` / `build:vst3-msvc` / `test:vst3-msvc` — see `docs/vst3-host-toolchain.md`.

Real-device smoke (ASIO / WASAPI Exclusive / native DSD / SACD ISO / CoreAudio / ALSA `hw:`) is **opt-in**, not the default gate.

### Install / release checks

```bash
pnpm run verify:install-policy
pnpm run verify:ncm-patch
pnpm run audit:production
pnpm run test:release-artifacts
pnpm run gate:release:win    # requires TWILIGHT_RELEASE_SIGNING_THUMBPRINT
```

Full Windows gate list: `docs/windows-release-gate.md`.

## Architecture agents miss

Five main entries in `electron.vite.config.ts`:

| Entry | Source | Role |
|---|---|---|
| `index` | `src/main/index.ts` → `app/lifecycle.ts` | Window, IPC, settings, integrations, NCM bootstrap |
| `pluginHost` | `src/main/pluginHost.ts` | Plugin `utilityProcess`; only `twilight` API |
| `audioEngineService` | `src/main/audioEngineService.ts` | Restartable native engine child |
| `audioAnalysisService` | `src/main/audioAnalysisService.ts` | Offline BPM/loudness pool (isolated from playback RPC) |
| `libraryScanService` | `src/main/library/libraryScanService.ts` | Local enum + metadata/cover worker |

Playback path:

```text
Renderer → preload contextBridge → main IPC → audioEngineManager
  → audioEngineService (or in-process if TWILIGHT_AUDIO_SERVICE=0)
  → twilight_audio_node.node → twilight-audio-engine.dll
  → FFmpeg → DSP → WASAPI / CoreAudio / ALSA / ASIO
```

- Orchestration hub: `src/main/audioEngineManager.ts`. DSP bypassed on DSD/passthrough; auto-bypass on timeout/failure.
- **Never** enqueue full-file BPM/loudness onto the realtime playback RPC path — use `audioAnalysisService` only.
- Preload (`src/preload/index.ts`) is the only renderer bridge; renderer must not touch Electron/Node/main.
- Renderer: `src/renderer/src/`, alias `@renderer`. Shared contracts: `src/shared/`.
- Provider track IDs are prefixed (`ncm:…`, `local:…`) and flow through queue/library/session.
- Theme plugins: CSS variables/stylesheets only — no script execution.
- Packages in-repo: `packages/plugin-api` (`@twilight-echo/plugin-api`), `packages/create-twilight-plugin` (`init` + `pack` → `.tep`).
- Staged native binaries: `resources/audio-engine/` (required for packaged runs).

### Local library

- Fast index: `path + size + mtime` via `libraryIndexCoordinator`. Startup reconciles incrementally; full metadata/cover rescan is user-triggered (progress/pause/cancel).
- Commits re-check library revision, authorized roots, exclusions — discard on drift.
- Do **not** full-parse metadata or base64-encode covers on the main load path.
- `useMusicStore`: non-reactive `trackById` / `trackByPath`; coalesced `shallowRef` rebuilds for artists/albums/folders. Mutate only through store replace paths so caches invalidate.

### Renderer performance (easy to regress)

- Virtualize large lists (`SongList`); prefer `shallowRef` + array replace for big collections.
- Index with `Map`/`Set`; no hot-path full-library `find`/`map`/`filter`.
- Throttle playback tick / spectrum / desktop lyrics; lyric seek by binary search.
- Cross-source identity/search/favorites: reuse `logicalTrackModel` / unified helpers — do not reimplement merge rules.
- Streaming local search: `components/streaming-page/localStreamingSearch.ts` (page materialization only).

## Env flags

| Flag | Meaning |
|---|---|
| `TAE_MINGW_BUILD_DIR` | Required MinGW build dir when repo path has spaces |
| `TWILIGHT_GNU_PATCH` | GNU patch.exe if Git-for-Windows patch not on PATH |
| `TWILIGHT_AUDIO_SERVICE=0` | Dev: load native engine in main process |
| `TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK=1` | Dev HTMLAudio fallback (off by default; not production) |
| `TWILIGHT_PLUGIN_INDEX_URL` | Remote plugin `plugins.json` override |

## Platform caveats

- **Windows** is the verified primary target (WASAPI shared/exclusive, ASIO, DoP, SACD ISO).
- **macOS / Linux** native backends exist but are **not** release-verified — flag changes under `audio-engine/output/` CoreAudio/ALSA accordingly.
- WASAPI/CoreAudio: no native DSD (DoP or PCM). ALSA `hw:` can do native DSD.
- NCM features need the bundled `@neteasecloudmusicapienhanced/api` service.
- Shared Mode goes through the system mixer (expected).

## Style (repo-specific)

- Prettier: `singleQuote`, no semis, `printWidth: 100`, `trailingComma: none` (`.prettierrc.yaml`)
- ESLint flat config; Vue SFCs require `<script lang="ts">`
- TS strict; `.ts` import extensions allowed (`allowImportingTsExtensions`)
- Renderer imports: `@renderer/*`, not deep relatives
- Do not add comments unless the task asks for them

## Key paths

| Concern | Location |
|---|---|
| Main bootstrap | `src/main/index.ts`, `src/main/app/lifecycle.ts` |
| Window / settings | `src/main/app/window.ts`, `src/main/core/settings.ts` |
| Audio orchestration / IPC | `src/main/audioEngineManager.ts`, `src/main/audio/engineIpc.ts` |
| Plugin host / manager | `src/main/pluginHost.ts`, `src/main/plugins/` |
| Plugin IPC | `src/main/ipc/plugins.ts` |
| Security / grants | `src/main/security/` |
| Preload | `src/preload/index.ts` |
| Player / library stores | `usePlayerStore.ts`, `useMusicStore.ts` |
| Library scan | `src/main/library/libraryIndexCoordinator.ts`, `libraryScanService.ts` |
| Logical track merge | `src/renderer/src/utils/logicalTrackModel.ts` |
| Native engine | `audio-engine/` → staged under `resources/audio-engine/` |
| Packaging | `electron-builder.yml` |
