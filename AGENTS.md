# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

# Twilight Echo — Agent Instructions

Desktop music player: Electron + Vue 3 + TypeScript + C++20 native HiFi engine.
Deeper architecture: `docs/DEVELOPER_README.md`. Plugin contracts (authoritative): `docs/twilight-echo-plugin-spec.md`, `docs/twilight-echo-plugin-plan.md`. Windows release gate: `docs/windows-release-gate.md`. Sibling Claude notes: `CLAUDE.md` (points here for boundaries).

Supported audio formats: `.mp3 .flac .wav .wave .aac .ogg .wma .m4a .mp4 .aiff .aif .opus .webm .alac .ape .wv .dsf .dff .mqa` (actual playback depends on platform/decoder; Windows most complete).

## Non-negotiable boundaries

- **pnpm only**: `packageManager` pins `pnpm@11.7.0`. Use `pnpm-lock.yaml`; never `npm install` / `package-lock.json`. Workspace `allowBuilds` permits only `electron`, `esbuild`, `electron-winstaller` native rebuilds.
- Install: `corepack enable` then `pnpm install --frozen-lockfile` (applies NCM `patchedDependencies` from `pnpm-workspace.yaml`). Workspace uses `nodeLinker: hoisted`.
- After install (or when touching deps): `pnpm run verify:install-policy` and `pnpm run verify:ncm-patch`.
  - `discord-rpc`'s optional `register-scheme` is intentionally excluded (`ignoredOptionalDependencies` + `blockExoticSubdeps`) so `electron-builder install-app-deps` does not rebuild an exotic native dep. App uses Electron `setAsDefaultProtocolClient`.
- **Do not write third-party plugin source into this repo.** Host/runtime, plugin API, scaffolder, static index client, and built-in NCM only.
  - External plugins: https://github.com/asenyarzc-cpu/Twilight-Echo-plugins/ (local: `D:\Twilight-Echo-plugins`)
  - Layout: `plugins/<name>/` → pack to `packages/` → index in `plugins.json`
  - App index order: `TWILIGHT_PLUGIN_INDEX_URL` → cache → `resources/plugin-index/plugins.json`
- **Only built-in provider exception**: `resources/plugins/ncm-provider` (`com.twilightecho.provider.ncm`). Not a precedent for third-party plugins.
- Plugin code runs only in `pluginHost` via the versioned `twilight` API — never import Electron, Node, or host internals.
- Before designing/editing plugin-system behavior, read the plugin spec/plan. Do not silently simplify or rename requirements; if code conflicts with the spec, call it out first.
- Fonts are preconverted committed `.woff2` only. Do not reintroduce install-time native font converters.
- In-app updates (Windows): download GitHub Release installer → optional SHA-256 verify → launch installer via `shell.openPath` then quit. **Not** `electron-updater` / silent asar replace / generic electron-builder `publish` URL. Prefer Release assets named `*-setup.exe` and publish `SHA256` in release body or `*.sha256` asset when possible.

## Commands (repo root)

```bash
pnpm run dev                 # electron-vite: 5 main entries + preload + renderer
pnpm run build               # typecheck + electron-vite build + font strip + renderer budgets
pnpm run build:unpack        # build + unsigned package --dir (strips package payload only)
pnpm run build:win|mac|linux # unsigned packaging paths
pnpm run lint                # eslint --cache .
pnpm run format              # prettier --write .
pnpm run typecheck           # typecheck:node (tsc) + typecheck:web (vue-tsc)
```

Node **22** is what CI uses. Prefer matching it.

### Tests — `node --test` only (no Jest/Vitest)

Co-located `*.test.ts` / `*.test.cjs` / `*.test.mjs`. TS needs `--experimental-strip-types`.

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
pnpm run test:themes
pnpm run test:duplicate-detection
pnpm run test:duplicate-detection-benchmark   # contract only
pnpm run benchmark:duplicate-detection:ci     # live 10k; do not parallel with other perf gates
pnpm run test:renderer-data-tooling
pnpm run test:cross-cutting-regressions
pnpm run test:audio-toolchain
pnpm run test:no-real-device   # full no-device gate (toolchain + MinGW + suites + typecheck + build)
```

Single file:

```bash
node --experimental-strip-types --test path/to/file.test.ts
node --test path/to/file.test.cjs
```

Every co-located test under `scripts/`, `src/`, `packages/`, `resources/` must be owned by some `test:*` script (`scripts/feature-test-gates.test.cjs` enforces this).

### Verify by change area (minimum useful set)

| Change | Run |
|---|---|
| Search / favorites / logical tracks / mini player | `test:playback-routing` |
| Local library list/perf/playlists UI | `test:local-perf` |
| Plugins / security / provider routing | `test:plugins` |
| Audio IPC, BPM/loudness, library scan coordinator | `test:audio-manager` |
| Lyrics import/save/UI | `test:lyrics-management` |
| Playlist import/export/CAS | `test:playlist-lifecycle` |
| CUE ranges / scan planner | `test:cue` |
| DSP graph / processing options | `test:dsp-graph` (+ `test:dsp-assets` if assets/VST catalog) |
| Themes / Theme Studio / theme archives | `test:themes` |
| Cross main↔preload↔renderer types | `typecheck` |
| Release packaging / asar / strip policy | `test:release-artifacts`, `audit:production` |
| Pre-release Windows | `docs/windows-release-gate.md` / `test:no-real-device` |

Linux CI runs Electron DOM suites (`playlist-lifecycle`, `lyrics-management`, `tag-duplicate-management`) under `xvfb-run`.

### Native audio (Windows MinGW — verified path)

MinGW is the verified Windows toolchain. Default CMake (`configure:audio-engine` → `audio-engine/build/default`) exists for multi-OS CI only — not the Windows release path.

Required env (configure script validates before CMake):

```powershell
$env:VCPKG_ROOT = 'C:\path\to\vcpkg'
$env:W64DEVKIT_ROOT = 'C:\path\to\w64devkit'
# This clone path has whitespace → external build dir with NO spaces is mandatory:
$env:TAE_MINGW_BUILD_DIR = 'C:\twilight-build\mingw-static'
# If Git for Windows patch is missing / BusyBox patch wins PATH:
# $env:TWILIGHT_GNU_PATCH = 'C:\Program Files\Git\usr\bin\patch.exe'
pnpm run configure:audio-engine:mingw
pnpm run build:audio-engine:mingw
pnpm run test:audio-engine:mingw
pnpm run stage:audio-engine   # → resources/audio-engine/ (required for packaged runs)
```

Configure/build/CTest/stage share `$env:TAE_MINGW_BUILD_DIR` (tmp: `...\tmp`). Prefer Git-for-Windows GNU `patch.exe` over w64devkit BusyBox. Do not commit machine-local toolchain paths into CMake presets.

VST3 host is **MSVC and separate**: `configure:vst3-msvc` / `build:vst3-msvc` / `test:vst3-msvc` / `smoke:vst3-msvc` — see `docs/vst3-host-toolchain.md`.

Real-device smoke (ASIO / WASAPI Exclusive / native DSD / SACD ISO / CoreAudio / ALSA `hw:`) is **opt-in**, not the default gate.

### Install / release checks

```bash
pnpm run verify:install-policy
pnpm run verify:ncm-patch
pnpm run test:production-audit
pnpm run audit:production
pnpm run test:release-artifacts
pnpm run gate:release:win    # requires TWILIGHT_RELEASE_SIGNING_THUMBPRINT; signed path only
```

`build:win` / `build:unpack` are deliberately **unsigned** dev packaging. Full gate list: `docs/windows-release-gate.md`.

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
- **Never** enqueue full-file BPM/loudness onto the realtime playback RPC path — use `audioAnalysisService` only. Its bounded priority queue uses aging (no starvation), per-task deadlines, and higher-priority eviction when full. Cancel during cache commit → precise rollback, no `completed` broadcast.
- Preload (`src/preload/index.ts`) is the only renderer bridge; renderer must not touch Electron/Node/main.
- Renderer: `src/renderer/src/`, alias `@renderer`. Shared contracts: `src/shared/` (included in both node and web tsconfigs).
- Renderer public assets come from `resources/` (`publicDir` in electron-vite).
- Provider track IDs are prefixed (`ncm:…`, `local:…`) and flow through queue/library/session.
- Theme plugins: CSS variables/stylesheets only — no script execution. Structured theme runtime lives in `src/shared/theme.ts`; archive validation / library repository in `src/main/themes/`.
- Packages in-repo: `packages/plugin-api` (`@twilight-echo/plugin-api`), `packages/create-twilight-plugin` (`init` + `pack` → `.tep`).
- Staged native binaries: `resources/audio-engine/` (required for packaged runs).
- Audio service crash recovery does **not** auto-resume; UI must wait for structured ready + manual resume. Output route restore order: `output-backend → output-device → output-config` (ACK each). DSP restore: `SetDspPluginChain → ApplyDspState → LoadQueue`. Details: `docs/audio-engine-api.md`.

### Local library

- Fast index: `path + size + mtime` via `libraryIndexCoordinator`. Startup reconciles incrementally; full metadata/cover rescan is user-triggered (progress/pause/cancel).
- Commits re-check library revision, authorized roots, exclusions — discard on drift.
- Do **not** full-parse metadata or base64-encode covers on the main load path.
- `useMusicStore`: non-reactive `trackById` / `trackByPath`; coalesced `shallowRef` rebuilds for artists/albums/folders. Mutate only through store replace paths so caches invalidate.
- Removal/trash/exclusions: `docs/local-library-removal-policy.md`.

### Renderer performance (easy to regress)

- Virtualize large lists (`SongList`); prefer `shallowRef` + array replace for big collections.
- Index with `Map`/`Set`; no hot-path full-library `find`/`map`/`filter`.
- Throttle playback tick / spectrum / desktop lyrics; lyric seek by binary search.
- Cross-source identity/search/favorites: reuse `logicalTrackModel` / unified helpers — do not reimplement merge rules.
- Recent tracks / Dashboard / top-N selectors: use `createUnifiedRecentTrackResolver(localTracks)` for one-pass index reuse; never rebuild the full library index per stat entry.
- Streaming local search: `components/streaming-page/localStreamingSearch.ts` (page materialization only).
- Do not dynamic-import hot stores already statically imported by the shell (false chunk split + reverse deps).
- Vendor chunk splitting (`electron.vite.config.ts`): `vendor-vue`, `vendor-music-metadata`, `vendor-qrcode`. Do not add manual chunks that duplicate these.

## Env flags

| Flag | Meaning |
|---|---|
| `VCPKG_ROOT` | Required for MinGW configure (vcpkg checkout) |
| `W64DEVKIT_ROOT` | Required for MinGW configure (w64devkit) |
| `TAE_MINGW_BUILD_DIR` | Required MinGW build dir when repo path has spaces (no whitespace in path) |
| `TWILIGHT_GNU_PATCH` | GNU patch.exe if Git-for-Windows patch not on PATH |
| `TWILIGHT_AUDIO_SERVICE=0` | Dev: load native engine in main process |
| `TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK=1` | Dev HTMLAudio fallback (off by default; not production) |
| `TWILIGHT_PLUGIN_INDEX_URL` | Remote plugin `plugins.json` override |
| `TWILIGHT_RELEASE_SIGNING_THUMBPRINT` | Required for `gate:release:win` |

## Platform caveats

- **Windows** is the verified primary target (WASAPI shared/exclusive, ASIO, DoP, SACD ISO).
- **macOS / Linux** native backends exist but are **not** release-verified — flag changes under `audio-engine/output/` CoreAudio/ALSA accordingly.
- WASAPI/CoreAudio: no native DSD (DoP or PCM). ALSA `hw:` can do native DSD.
- NCM features need the bundled `@neteasecloudmusicapienhanced/api` service (patched via workspace).
- Shared Mode goes through the system mixer (expected).

## Style (repo-specific)

- Prettier: `singleQuote`, no semis, `printWidth: 100`, `trailingComma: none`, `endOfLine: auto` (`.prettierrc.yaml`)
- ESLint flat config; Vue SFCs require `<script lang="ts">` (`vue/block-lang`)
- Unused vars/args: prefix with `_` (e.g. `_event`, `_index`) — enforced by `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'`
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
| Packaging | `electron-builder.yml`, `electron-builder.release-win.yml` |
| CI | `.github/workflows/audio-engine.yml` |
