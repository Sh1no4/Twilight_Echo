# Windows-first Release Gate

This checklist is the minimum gate before publishing a Windows build of Twilight Echo.

## Reproducible Dependency Install

The app repository uses only the `pnpm@11.7.0` version pinned in `package.json`. `pnpm-lock.yaml`
is the only dependency lockfile; do not run `npm install` or commit `package-lock.json`.

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm run verify:install-policy
pnpm run verify:ncm-patch
pnpm run test:production-audit
pnpm run audit:production -- --output output/release-evidence/production-dependency-audit.json
pnpm run test:release-artifacts
pnpm run verify:packaged-dependencies
```

The NCM API fix is declared under `patchedDependencies` in `pnpm-workspace.yaml`. The behavior-level
verification above must pass after every clean install so development, CI, and release packaging
use the same patched dependency tree.

## Production Dependency Audit

The release gate runs `pnpm audit --prod --json` through `pnpm run audit:production`. It rejects
every moderate, high, or critical production advisory and can persist the unmodified registry
response as release evidence with `--output <path>`. CI uploads that JSON response even when the
gate fails.

The current explicit floors are enforced through root `pnpm-workspace.yaml` `overrides`, not a
second npm lockfile:

- `form-data@4.0.6` fixes `GHSA-hmw2-7cc7-3qxx` / `CVE-2026-12143` (multipart CRLF injection).
- `qs@6.15.2` fixes `GHSA-q8mj-m7cp-5q26` / `CVE-2026-8723` (comma-array stringify DoS).
- Root `undici@^6.27.0` fixes `GHSA-p88m-4jfj-68fv` / `GHSA-vxpw-j846-p89q` (header injection and WebSocket DoS).

Run the audit only after a clean frozen install. A stale hoisted `node_modules` directory is not
evidence that the lockfile, overrides, or NCM patch were applied.

The install-policy check also confirms that `discord-rpc`'s non-Electron
`register-scheme` fallback is absent. The app uses Electron's
`app.setAsDefaultProtocolClient`; excluding that optional native fallback prevents
`electron-builder install-app-deps` from attempting an unsupported rebuild.

All shipped fonts are preconverted `.woff2` assets. Dependency installation does not compile or
convert fonts; any future font regeneration tooling needs its own conversion smoke test before it
can enter the release dependency tree.

Packaged dependency verification parses every production `package.json` inside `app.asar` and
fails when Node's nested/root `node_modules` lookup cannot resolve a required dependency. This gate
prevents installers that build successfully but fail during main-process startup.

## Required Commands

Run the complete repository gate from the repository root:

```powershell
pnpm run lint
pnpm run typecheck
pnpm run test:production-audit
pnpm run audit:production -- --output output/release-evidence/production-dependency-audit.json
pnpm run test:plugins
pnpm run test:audio-manager
pnpm run test:tag-duplicate-management
pnpm run test:duplicate-detection-benchmark
pnpm run benchmark:duplicate-detection:ci -- --output output/release-evidence/duplicate-detection-benchmark.json --manifest output/release-evidence/duplicate-detection-benchmark.manifest.json
pnpm run test:playback-routing
pnpm run test:playlist-lifecycle
pnpm run test:lyrics-management
pnpm run test:cue
pnpm run test:local-perf
pnpm run test:dsp-graph
pnpm run test:dsp-assets
pnpm run test:plugin-tooling
pnpm run test:audio-toolchain
pnpm run test:renderer-data-tooling
pnpm run test:sleep-timer
pnpm run test:cross-cutting-regressions
pnpm run test:app
pnpm run build
```

`test:audio-manager` covers realtime playback service behavior, the isolated offline-analysis pool,
its IPC wiring, BPM/loudness manager cancellation and cache-suppression behavior, and local-library
index planning/coordinator races (root drift, exclusion recheck, watcher coalescing, and scan controls).

`test:tag-duplicate-management` covers real tag write/rollback, authorized full-file SHA-256,
inspection-only duplicate results, success-only renderer cache updates, and the Vue dialog's keyboard
and tab semantics. `test:duplicate-detection-benchmark` verifies the committed 10k fixture, p95
contract, current source/runner/lockfile hashes, and evidence-manifest digest. The live benchmark is a
separate sequential command: it performs three unmeasured warmups and twenty measured runs for both
unique and collision-heavy 10k libraries, then fails against the declared p95 budgets. Do not run it
in parallel with other performance gates. All three commands are part of `test:no-real-device`.

`test:playlist-lifecycle` drives the production SongList lifecycle composable through a real
Electron/Vue/Pinia DOM. It covers all three export downloads, pre-read import limits, visible
import/cover feedback, rename/copy/reorder/batch move/unique relocation, and authoritative CAS
conflict recovery. `test:lyrics-management` covers import and save-dialog validation, atomic LRC replacement and backup
recovery, versioned CAS persistence, source-selection races, manual three-track projection, and the
real Electron/Vue lyrics-management UI. Both scripts are part of `test:no-real-device`; the Ubuntu
required job runs their Electron UI tests under an explicitly installed `xvfb`/`xauth` virtual display.

`test:cue` covers strict supported-encoding detection, size/path and single-source constraints,
incremental CUE dependency identity, persisted range validation, logical seek/queue preparation,
and is paired with the native CTest suite for segment promotion, ReplayGain isolation, and Native
DSD bit-frame timing.

`test:renderer-data-tooling` covers persistence-benchmark evidence contracts, packaged renderer font
assets, shared TypeScript boundaries, renderer size budgets, and visibility-animation scheduling.
`test:sleep-timer` covers shared state, main/renderer coordination, IPC and native boundaries,
fade completion, and mute/volume interactions. `test:cross-cutting-regressions` covers close-time
persistence, packaged font and visibility budgets, library-view preferences, and visibility polling.
All three scripts are part of `test:no-real-device` and are required release commands.

`test:app` covers the remaining executable application contracts: settings and navigation state,
OPRA/effective audio-processing normalization, renderer component source contracts, local search,
logical-track grouping, and audio smoke-evidence CLI behavior.

Local-library remove/trash semantics, exclusion recovery, queue cleanup, and restart behavior must
also satisfy [`docs/local-library-removal-policy.md`](local-library-removal-policy.md).

## Required GitHub Check

`.github/workflows/audio-engine.yml` runs for every push and pull request without path filters, so
changes under any `src/**` path execute the full repository gate and native audio matrix. Its final
`Required Quality Gate` job fails unless every required job succeeds.

Repository administrators must configure the `main` branch ruleset in GitHub to require the
`Required Quality Gate` status check, require the branch to be up to date before merging, and block
force pushes/deletions. This branch-protection setting is external repository state and cannot be
enabled by a committed workflow file. Audit the live setting with GitHub CLI:

```powershell
gh api repos/{owner}/{repo}/branches/main/protection
```

Do not mark this release gate complete until the API response lists `Required Quality Gate` under
`required_status_checks.contexts` (or an equivalent required-check ruleset is visible in GitHub).

## Native Audio Engine

Windows release builds must also verify the MinGW audio engine path:

```powershell
$env:VCPKG_ROOT = 'C:\path\to\vcpkg'
$env:W64DEVKIT_ROOT = 'C:\path\to\w64devkit'
$env:TWILIGHT_GNU_PATCH = 'C:\Program Files\Git\usr\bin\patch.exe'
```

`TWILIGHT_GNU_PATCH` must identify as GNU patch; Git for Windows provides a compatible executable.
When the repository path contains whitespace, set `TAE_MINGW_BUILD_DIR` to a writable path without
whitespace before configuring, for example:

```powershell
$env:TAE_MINGW_BUILD_DIR = 'D:\twilight-build\mingw-static'
```

```powershell
pnpm run configure:audio-engine:mingw
pnpm run build:audio-engine:mingw
pnpm run test:audio-engine:mingw
```

The staged release must include the matching `twilight-audio-engine.dll` and
`twilight_audio_node.node` under packaged `resources/audio-engine`.

## Signed Release Artifact Gate

In-app updates on Windows download the latest GitHub Release installer (`*-setup.exe` preferred),
optionally verify SHA-256 from the release body or a companion checksum asset, then launch the
installer with `shell.openPath` and quit the app. This is not `electron-updater`, not silent asar
replacement, and not a generic electron-builder `publish` URL. Prefer publishing a checksum with
each release; without a checksum the client still downloads but marks verification as skipped.
Unsigned installers remain subject to SmartScreen.

A publishable Windows build must be created in the protected signing environment. `build:win` and
`build:unpack` are deliberately unsigned development packaging paths. They still strip only the
copied package payload when W64DevKit is configured, keeping the source runtime untouched.
Packaging delegates production dependency discovery to electron-builder and keeps only the
`zh-CN`, `zh-TW`, and `en-US` Electron locales instead of copying the full development tree.
Development packaging skips electron-builder's signing helper; `afterPack` writes the unsigned
executable metadata directly. The protected release overlay restores signing and executable editing.
Only `gate:release:win` loads `electron-builder.release-win.yml`, which enables electron-builder's
`forceCodeSigning`; no signing identity is a hard failure, not an unsigned fallback. Set
`TWILIGHT_RELEASE_SIGNING_THUMBPRINT` to the expected release certificate thumbprint there, then run:

```powershell
pnpm run gate:release:win
```

The gate checks every shipped DLL/EXE/NODE file under the packaged audio-engine directory for a
non-zero size and a size budget. It additionally checks each required self-built native runtime
binary for stripped PE debug/COFF metadata and a valid Authenticode signature from the
expected certificate. Windows development and release packaging invoke GNU/LLVM
`strip --strip-all` only on the copied package payload at
`win-unpacked/resources/audio-engine`; they never alter `resources/audio-engine` in the source tree.
Set `W64DEVKIT_ROOT` or `TWILIGHT_RELEASE_STRIP` so the packaging wrapper can locate `strip.exe`.
The protected release gate deliberately fails when the strip tool or
`TWILIGHT_RELEASE_SIGNING_THUMBPRINT` is absent. It does not create or simulate a signature.
Current budgets are 192 MiB for the audio DLL, 16 MiB for the Node addon, 32 MiB for each VST3 host
executable, 64 MiB for any other shipped native DLL/EXE/NODE, and 384 MiB for the installer.
Microsoft VC runtimes are size-checked but are not stripped or required to carry the project
certificate.

`pnpm run test:release-artifacts` validates this policy and its failure paths without needing a
certificate or a packaged installer. A passing test is not release-signing evidence.

macOS CoreAudio and Linux ALSA package targets remain unverified. Their buildability is not a
release-readiness claim; keep their real-device smoke evidence separate from the Windows gate.

## Plugin Boundary

The app repository may bundle host/runtime code, built-in plugins, plugin API tooling, and the
static plugin index client. Third-party plugin `.tep` packages must not be committed under
`resources/plugin-index`; Bilibili and future third-party plugins are installed from the remote
`TWILIGHT_PLUGIN_INDEX_URL` index.

## Manual Smoke

Before release, start the packaged app and verify:

- local library browsing and playback still work;
- startup performs an incremental library reconciliation, while Settings -> General -> Library can
  explicitly start a full rescan and visibly pause, resume, or cancel it;
- local, playing, settings, plugin, equalizer, and streaming surfaces switch cleanly;
- disabling the built-in NCM provider does not affect local playback;
- installing a remote plugin shows the trust-based permissions warning;
- a failing plugin is marked failed and does not prevent app startup or playback.

The native CTest suite includes `twilight_audio_performance_gate`. It drives decoded WAV through the
production `AudioPipeline` with a controlled callback pump and emits schema-versioned JSON for steady
playback, gapless, crossfade, convolution, diagnostics, callback-deadline load, and process working-set
measurements. It is a deterministic software gate, not a hardware or system-CPU claim.

Real-device smoke checks for WASAPI Exclusive, ASIO, native DSD, SACD ISO, CoreAudio, and ALSA
remain opt-in and are not part of the default gate.

For a Windows WASAPI Exclusive performance soak, explicitly select a physical endpoint and retain the
JSON output as release evidence:

```powershell
pnpm run smoke:audio-performance -- --device "Desk DAC" --duration-seconds 300 --json
```

This command never runs in CI and must not be represented by the controlled-pump CTest result.

Product honesty surfaces (`Loudnorm`, `Gapless Album`, `Unity Volume`) are always listed by
`pnpm run smoke:audio-evidence` and default to `not-run` until a maintainer records evidence.
They do **not** gate `coverage.complete` (still 5/5 hardware surfaces). See
`docs/audio-smoke-evidence.md`.
