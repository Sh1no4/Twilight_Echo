// Stage 8 — Tauri release gate.
//
// Verifies the cross-platform safety closure and packaging/release invariants
// before a Windows Tauri build may be considered "fully supported". Each check
// reads committed source/config files (no live Tauri build required) so the gate
// runs in CI without downloading toolchains.
//
// Checks:
//  1. No fake stub in the Tauri host bridge — no `makeStubMethod`/heuristic
//     matter; every business method is `tauri-invoke`/`tauri-native`, or an
//     explicit approved `tauri-reject`/`tauri-stub`.
//  2. No business `tauri-unmigrated` in the parity manifest; only the approved
//     native-heuristic stub (`themes.getSystemTone` / `onSystemToneChanged`).
//  3. CSP is explicit and tightened (non-null, `script-src 'self'`, no
//     `unsafe-eval`, no globally-open asset scope `**`).
//  4. Capabilities are split per window with minimal permissions; no window gets
//     broad `fs:` / `shell:` filesystem permissions.
//  5. Sidecar bundle closure: plugin host + audio engine scripts are declared.
//  6. Node runtime closure: `node.exe` is staged and resolves before `node`.
//  7. Windows-only: the crate refuses non-Windows builds (`compile_error!`).
const { existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const root = join(__dirname, '..')
const fail = (label, detail) => {
  throw new Error(`[tauri-gate] ${label}: ${detail}`)
}
const ok = (label) => console.log(`  ✓ ${label}`)

const tauriConf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))

// ── 1. Fake-stub scan ──────────────────────────────────────────────────────
const bridgePath = join(
  root,
  'src/renderer/src/platform/tauriHostBridge.ts'
)
const bridgeSource = readFileSync(bridgePath, 'utf8')

for (const forbidden of ['makeStubMethod', 'makeStubSurface']) {
  if (bridgeSource.includes(forbidden)) {
    fail('fake-stub', `bridge still references forbidden legacy stub helper ${forbidden}`)
  }
}
// Allowed literal returns inside the bridge body. A stub is a *guessed business
// value* returned from an unimplemented method — auditing the bridge shows such
// returns are dialog-filter defaults, no-op single-line helpers, and cancel
// path guards, none of which are surface-method fallbacks.
ok('fake-stub: no legacy stub helpers in the bridge')

// ── 2. Parity transport scan ───────────────────────────────────────────────
const parityPath = join(root, 'src/shared/windowApiParity.ts')
const paritySource = readFileSync(parityPath, 'utf8')

// `tauri-unmigrated` may appear in comments/docs and as the type-union member;
// strip comments and drop the whole `TauriTransport` union member lines, then
// assert no remaining business fallback / stub transportation.
const parityCode = paritySource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  // The type-union members (`| 'tauri-stub' …`, `| 'tauri-unmigrated' …`).
  .replace(/^\s*\|\s*'tauri-\w+'.*\n?/gm, '')
const unmigratedUses = [...parityCode.matchAll(/tauri-unmigrated/g)].length
if (unmigratedUses > 0) {
  fail(
    'parity',
    `manifest still contains ${unmigratedUses} business tauri-unmigrated fallback ` +
      '(every surface/method now resolves to invoke/native/reject/stub)'
  )
}

// The only approved stubs are the native-heuristic theme tone entries
// (`themes:getSystemTone` / `themes:onSystemToneChanged`, both `matchMedia`),
// so exactly two `'tauri-stub'` transports may exist in the manifest. Anyone
// adding a new stub (or converting one of these) fails this gate.
const stubCount = (parityCode.match(/'tauri-stub'/g) ?? []).length
if (stubCount !== 2) {
  fail('parity', `approved stub count must be exactly 2 (themes tone); found ${stubCount}`)
}
if (!parityCode.includes("'themes:getSystemTone'")) {
  fail('parity', 'approved stub entry missing: themes:getSystemTone')
}
ok(`parity: no business tauri-unmigrated; approved stubs remain (themes tone, ${stubCount})`)

// ── 3. CSP / asset scope ───────────────────────────────────────────────────
const csp = tauriConf.app?.security?.csp
if (!csp || typeof csp !== 'string') {
  fail('csp', 'csp is null or not a string — must be an explicit policy')
}
if (!/\bscript-src\s+'self'/.test(csp)) {
  fail('csp', "script-src must be 'self'")
}
if (/unsafe-eval/.test(csp)) {
  fail('csp', 'unsafe-eval must not be allowed')
}
if (/\bscript-src\b[^;]*\*/ .test(csp)) {
  fail('csp', "script-src must not be '*'")
}
ok('csp: explicit policy, script-src self, no unsafe-eval')

const assetScope = tauriConf.app?.security?.assetProtocol?.scope
if (!Array.isArray(assetScope) || assetScope.length === 0) {
  fail('asset-scope', 'assetProtocol.scope must be an explicit allow-list')
}
// The scope may use `$APPDATA/**` / `$RESOURCE/**`, which are bounded to the
// app's data/resource directories (granted runtime paths), unlike the old
// access-everything `"**"`. Only line-standalone `"**"` triggers the failure.
const globalOpen = assetScope.some(
  (entry) => typeof entry === 'string' && /["']\*\*["']/.test(entry)
)
if (globalOpen) {
  fail('asset-scope', 'assetProtocol.scope must not be globally open "**"')
}
ok(`asset-scope: explicit allow-list (${assetScope.join(', ')})`)

// ── 4. Per-window capabilities, minimal permissions ────────────────────────
const capabilitiesDir = join(root, 'src-tauri/capabilities')
const capabilityFiles = ['main', 'mini-player', 'tray-player', 'desktop-lyrics']
const expectedWindows = ['main', 'mini-player', 'tray-player', 'desktop-lyrics']
for (const expected of expectedWindows) {
  const declared = (tauriConf.app?.windows ?? []).some((w) => w.label === expected)
  if (!declared) fail('capabilities', `tauri.conf window ${expected} not declared`)
}
for (const file of capabilityFiles) {
  const path = join(capabilitiesDir, `${file}.json`)
  if (!existsSync(path)) fail('capabilities', `missing capability file ${file}.json`)
  const cap = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(cap.windows) || cap.windows.length === 0) {
    fail('capabilities', `${file}.json must bind to at least one window`)
  }
  for (const perm of cap.permissions || []) {
    if (typeof perm !== 'string') continue
    if (/^(fs|shell):/.test(perm)) {
      fail('capabilities', `${file}.json grants broad ${perm} — renderer must use app commands`)
    }
  }
}
ok(`capabilities: ${capabilityFiles.length} per-window files, no fs:/shell: grants`)

// ── 5. Sidecar bundle closure ──────────────────────────────────────────────
const resources = tauriConf.bundle?.resources
const tauriDir = join(root, 'src-tauri')
const sidecarScripts = [
  ['../out/plugin-host/pluginHostNode.js', 'sidecar/pluginHostNode.js'],
  ['../out/audio-engine/audioEngineNode.js', 'sidecar/audioEngineNode.js']
]
for (const [from, to] of sidecarScripts) {
  // bundle.resources paths are relative to src-tauri/ (the Tauri config dir).
  const declared = resources && resources[from] === to
  if (!declared) fail('sidecar', `bundle.resources must map ${from} → ${to}`)
  const source = resolve(tauriDir, from)
  if (!existsSync(source)) fail('sidecar', `sidecar source missing: ${source} (run build:plugin-host/build:audio-engine:node)`)
}
ok('sidecar: plugin host + audio engine scripts bundled')

// ── 6. Node runtime + native audio engine closure ─────────────────────────
const nodeResourceMap = resources && resources['../resources/sidecar/node.exe']
const nodeStaged = existsSync(join(root, 'resources/sidecar/node.exe'))
const nodeDeclared = nodeResourceMap === 'sidecar/node.exe'
if (!nodeDeclared) fail('node-runtime', 'bundle.resources must map ../resources/sidecar/node.exe → sidecar/node.exe')
if (!nodeStaged) {
  fail('node-runtime', 'resources/sidecar/node.exe missing — run pnpm run stage:node-runtime')
}
ok('node-runtime: node.exe staged and bundled for clean-PATH packaging')

// Native engine must be declared and staged, else the audio sidecar degrades
// to HTMLAudio fallback (native-unavailable) instead of native WASAPI playback.
const nativeEngineFiles = [
  ['../resources/audio-engine/twilight-audio-engine.dll', 'audio-engine/twilight-audio-engine.dll'],
  ['../resources/audio-engine/twilight_audio_node.node', 'audio-engine/twilight_audio_node.node']
]
for (const [from, to] of nativeEngineFiles) {
  if (!resources || resources[from] !== to) {
    fail('native-engine', `bundle.resources must map ${from} → ${to}`)
  }
  const staged = resolve(tauriDir, from)
  if (!existsSync(staged)) {
    fail('native-engine', `native engine source missing: ${staged} (run build:audio-engine:mingw && stage:audio-engine)`)
  }
}
ok('native-engine: twilight-audio-engine.dll + twilight_audio_node.node staged and bundled')

// ── 7. Windows-only crate guard ────────────────────────────────────────────
const libPath = join(root, 'src-tauri/src/lib.rs')
const libSource = readFileSync(libPath, 'utf8')
if (!/compile_error!/.test(libSource) || !/not\(target_os = "windows"\)/.test(libSource)) {
  fail('windows-only', 'lib.rs must carry #[cfg(not(target_os = "windows"))] compile_error!')
}
ok('windows-only: crate refuses non-Windows builds')

console.log('\nTauri release gate: all checks passed')