import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  WINDOW_API_MANIFEST,
  getMainWindowApiMethods,
  getWindowApiMethod,
  getWindowApiSurface,
  type WindowApiWindow
} from '../../shared/windowApiParity.ts'

/**
 * Stage 0 — WindowAPI parity contract test.
 *
 * Auto-extracts the real Electron preload `window.api` surface/method inventory
 * and the real Tauri bridge transport, then asserts the parity manifest in
 * `src/shared/windowApiParity.ts` stays in sync. A future Electron API change
 * that is not mirrored in the manifest (or in the Tauri bridge) fails here.
 */

const PRELOAD_PATH = new URL('../../preload/index.ts', import.meta.url)
const PRELOAD_EVENTS_PATH = new URL('../../preload/sleepTimerEvents.ts', import.meta.url)
const PROVIDER_DOWNLOADS_PATH = new URL('../../shared/providerDownloads.ts', import.meta.url)
const NCM_CLOUD_PATH = new URL('../../shared/ncmCloud.ts', import.meta.url)
const BRIDGE_PATH = new URL('../../renderer/src/platform/tauriHostBridge.ts', import.meta.url)

const preloadSource = readFileSync(PRELOAD_PATH, 'utf8')
const preloadEventsSource = readFileSync(PRELOAD_EVENTS_PATH, 'utf8')
const providerDownloadsSource = readFileSync(PROVIDER_DOWNLOADS_PATH, 'utf8')
const ncmCloudSource = readFileSync(NCM_CLOUD_PATH, 'utf8')
const bridgeSource = readFileSync(BRIDGE_PATH, 'utf8')

// Channel constants shared between preload and main process live outside the
// preload source; each module declaring one is searched for the literal value.
const eventChannelSources = [
  preloadSource,
  preloadEventsSource,
  providerDownloadsSource,
  ncmCloudSource
]

/* ── Source-literal parsing helpers ────────────────────────────────────── */

/** Find the index of the `}` matching the `{` at openIndex, skipping strings/comments. */
function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0
  let quote: string | null = null
  let lineComment = false
  let blockComment = false
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (lineComment) {
      if (ch === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false
        i++
      }
      continue
    }
    if (quote !== null) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && next === '/') {
      lineComment = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      blockComment = true
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Absolute open/close indices of the block introduced by `marker` (e.g. `const api = {`). */
function findBlockSpan(source: string, marker: string): { open: number; close: number } {
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `marker ${marker} not found in source`)
  const openIndex = source.indexOf('{', markerIndex)
  assert.notEqual(openIndex, -1, `marker ${marker} not followed by {`)
  const closeIndex = findMatchingBrace(source, openIndex)
  assert.notEqual(closeIndex, -1, `marker ${marker} block not balanced`)
  return { open: openIndex, close: closeIndex }
}

/**
 * Absolute open/close indices of a `const NAME ... = {` object, tolerating a
 * type annotation between the name and the assignment (e.g. the preload's
 * `const duplicateDetectionApi: DuplicateDetectionReadApi = {`).
 */
function findConstObjectSpan(source: string, name: string): { open: number; close: number } {
  const declIndex = source.indexOf(`const ${name}`)
  assert.notEqual(declIndex, -1, `const ${name} not found in source`)
  const eqIndex = source.indexOf('= {', declIndex)
  assert.notEqual(eqIndex, -1, `const ${name} not followed by = {`)
  const openIndex = eqIndex + 2
  const closeIndex = findMatchingBrace(source, openIndex)
  assert.notEqual(closeIndex, -1, `const ${name} block not balanced`)
  return { open: openIndex, close: closeIndex }
}

interface SourceEntry {
  kind: 'block' | 'value' | 'spread'
  name: string
  start: number
  end: number
  blockOpen: number
  blockClose: number
  value: string
}

/**
 * Collect top-level `key: value` entries inside the [start, end) window whose
 * opening lines are indented exactly `indent` spaces. Block values record their
 * own open/close; one-line values and spreads span to the next entry.
 */
function collectEntries(source: string, start: number, end: number, indent: number): SourceEntry[] {
  const raw: SourceEntry[] = []
  let cursor = start
  while (cursor < end && source[cursor] !== '\n') cursor++
  const lineStarts: number[] = []
  if (cursor < end) {
    cursor++
    lineStarts.push(cursor)
    for (let i = cursor; i < end; i++) {
      if (source[i] === '\n') lineStarts.push(i + 1)
    }
  }
  for (const ls of lineStarts) {
    let j = ls
    while (j < end && (source[j] === ' ' || source[j] === '\t')) j++
    if (j - ls !== indent) continue
    if (j >= end || source[j] === '}') continue
    const rest = source.slice(j)
    const spread = rest.match(/^\.\.\.([A-Za-z_$][\w$]*)\s*,/)
    if (spread) {
      raw.push({
        kind: 'spread',
        name: spread[1],
        start: ls,
        end: 0,
        blockOpen: 0,
        blockClose: 0,
        value: ''
      })
      continue
    }
    const keyMatch = rest.match(/^([A-Za-z_$][\w$]*)\s*:/)
    if (!keyMatch) continue
    const keyName = keyMatch[1]
    const colonIndex = j + keyMatch[0].indexOf(':')
    let k = colonIndex + 1
    while (k < end && /\s/.test(source[k])) k++
    if (k < end && source[k] === '{') {
      const closeIndex = findMatchingBrace(source, k)
      raw.push({
        kind: 'block',
        name: keyName,
        start: ls,
        end: closeIndex,
        blockOpen: k,
        blockClose: closeIndex,
        value: ''
      })
    } else {
      const lineEnd = source.indexOf('\n', ls) === -1 ? end : source.indexOf('\n', ls)
      const valueText = source.slice(colonIndex + 1, lineEnd).trim().replace(/,\s*$/, '')
      raw.push({
        kind: 'value',
        name: keyName,
        start: ls,
        end: 0,
        blockOpen: 0,
        blockClose: 0,
        value: valueText
      })
    }
  }
  raw.sort((a, b) => a.start - b.start)
  const entries: SourceEntry[] = []
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i]
    entries.push(
      entry.kind === 'block'
        ? entry
        : { ...entry, end: i + 1 < raw.length ? raw[i + 1].start : end }
    )
  }
  return entries
}

interface ExtractedMethod {
  name: string
  start: number
  end: number
  kind?: SourceEntry['kind']
  value?: string
}

/**
 * Collect method keys inside a block window, resolving `...alias` spreads by
 * recursing into the referenced const body (methods there live at indent 2).
 */
function collectMethods(
  source: string,
  start: number,
  end: number,
  indent: number,
  resolveAlias: (name: string) => { start: number; end: number } | null
): ExtractedMethod[] {
  const methods: ExtractedMethod[] = []
  for (const entry of collectEntries(source, start, end, indent)) {
    if (entry.kind === 'spread') {
      const alias = resolveAlias(entry.name)
      if (alias) methods.push(...collectMethods(source, alias.start, alias.end, 2, resolveAlias))
      continue
    }
    methods.push({ name: entry.name, start: entry.start, end: entry.end, kind: entry.kind, value: entry.value })
  }
  return methods
}

/**
 * The text a method's parameter list actually lives in. A one-line value entry
 * may delegate to an imported helper (`onState: sleepTimerEvents.onState`) or a
 * preload alias const; in both cases the signature is declared elsewhere.
 */
function methodSignatureSource(entry: ExtractedMethod): string {
  if (entry.kind === 'value') {
    const ref = (entry.value ?? '').trim()
    if (ref.startsWith('sleepTimerEvents.')) return preloadEventsSource
    const alias = resolvePreloadAlias(ref)
    if (alias) return preloadSource.slice(alias.start, alias.end)
  }
  return preloadSource.slice(entry.start, entry.end)
}

/* ── Preload / bridge structural extraction ────────────────────────────── */

const PRELOAD_ALIASES = [
  'miniPlayerWindowApi',
  'miniPlayerHostApi',
  'trayPlayerWindowApi',
  'duplicateDetectionApi',
  'miniPlayerCoverDataApi'
]

const aliasSpans = new Map<string, { start: number; end: number }>()
for (const name of PRELOAD_ALIASES) {
  const span = findConstObjectSpan(preloadSource, name)
  aliasSpans.set(name, { start: span.open + 1, end: span.close })
}

const resolvePreloadAlias = (name: string): { start: number; end: number } | null =>
  aliasSpans.get(name) ?? null

const apiSpan = findBlockSpan(preloadSource, 'const api = {')
const preloadSurfaces = collectEntries(preloadSource, apiSpan.open + 1, apiSpan.close, 2)

const bridgeSpan = findBlockSpan(bridgeSource, 'window.api = createBridgeApi({')
const bridgeSurfaces = collectEntries(bridgeSource, bridgeSpan.open + 1, bridgeSpan.close, 4)

function preloadSurfaceMethods(surface: SourceEntry): ExtractedMethod[] {
  if (surface.kind === 'block') {
    return collectMethods(preloadSource, surface.blockOpen + 1, surface.blockClose, 4, resolvePreloadAlias)
  }
  if (surface.kind === 'value') {
    const alias = surface.value.trim()
    const span = resolvePreloadAlias(alias)
    assert.ok(span, `surface ${surface.name} alias ${alias} must resolve`)
    return collectMethods(preloadSource, span.start, span.end, 2, resolvePreloadAlias)
  }
  return []
}

function bridgeSurfaceMethods(surface: SourceEntry): ExtractedMethod[] {
  if (surface.kind !== 'block') return []
  // Spreads in the bridge (`...existing`, `...existing?.app`, `...existing?.data`)
  // are no-ops under Tauri (window.api is undefined), so they resolve to nothing.
  return collectMethods(bridgeSource, surface.blockOpen + 1, surface.blockClose, 6, () => null)
}

function manifestWindowMethods(window: WindowApiWindow): string[] {
  const out: string[] = []
  for (const surface of WINDOW_API_MANIFEST) {
    for (const method of surface.methods) {
      const windows = method.windows ?? surface.windows
      if (windows.includes(window)) out.push(`${surface.surface}.${method.method}`)
    }
  }
  return out
}

/* ── Surface / method inventory parity ─────────────────────────────────── */

test('preload api surface set matches the manifest exactly', () => {
  const manifestSurfaces = WINDOW_API_MANIFEST.map((s) => s.surface).sort()
  const preloadNames = preloadSurfaces.map((s) => s.name).sort()
  assert.deepEqual(preloadNames, manifestSurfaces)
})

test('every preload surface.method matches the manifest main-window inventory', () => {
  for (const surface of WINDOW_API_MANIFEST) {
    const preloadSurface = preloadSurfaces.find((s) => s.name === surface.surface)
    assert.ok(preloadSurface, `preload missing surface ${surface.surface}`)
    const preloadKeys = preloadSurfaceMethods(preloadSurface!).map(
      (m) => `${surface.surface}.${m.name}`
    )
    const manifestKeys = getMainWindowApiMethods().filter((k) =>
      k.startsWith(`${surface.surface}.`)
    )
    const preloadSet = new Set(preloadKeys)
    const manifestSet = new Set(manifestKeys)
    assert.deepEqual(
      manifestKeys.filter((k) => !preloadSet.has(k)),
      [],
      `${surface.surface}: manifest methods missing from preload`
    )
    assert.deepEqual(
      preloadKeys.filter((k) => !manifestSet.has(k)),
      [],
      `${surface.surface}: preload methods not declared for the main window in the manifest`
    )
  }
})

test('combined main-window inventory is complete, unique, and resolvable', () => {
  const all: string[] = []
  for (const surface of preloadSurfaces) {
    for (const method of preloadSurfaceMethods(surface)) {
      all.push(`${surface.name}.${method.name}`)
    }
  }
  assert.ok(all.length > 0)
  assert.equal(new Set(all).size, all.length, 'preload surface methods must be unique')
  const preloadSet = new Set(all)
  const manifestKeys = getMainWindowApiMethods()
  assert.deepEqual(
    manifestKeys.filter((k) => !preloadSet.has(k)),
    [],
    'manifest main-window methods missing from preload'
  )
  assert.deepEqual(
    all.filter((k) => !new Set(manifestKeys).has(k)),
    [],
    'preload methods not in the manifest main-window inventory'
  )
  for (const key of manifestKeys) {
    const dot = key.indexOf('.')
    assert.ok(
      getWindowApiMethod(key.slice(0, dot), key.slice(dot + 1)),
      `manifest key ${key} does not resolve via getWindowApiMethod`
    )
  }
})

/* ── Auxiliary window surfaces ─────────────────────────────────────────── */

function compareWindowMethods(
  label: string,
  preloadKeys: string[],
  window: WindowApiWindow,
  surfaceFilter: string
): void {
  const manifestKeys = manifestWindowMethods(window).filter((k) =>
    k.startsWith(`${surfaceFilter}.`)
  )
  const preloadSet = new Set(preloadKeys)
  const manifestSet = new Set(manifestKeys)
  assert.deepEqual(
    manifestKeys.filter((k) => !preloadSet.has(k)),
    [],
    `${label}: manifest ${window} methods missing from preload`
  )
  assert.deepEqual(
    preloadKeys.filter((k) => !manifestSet.has(k)),
    [],
    `${label}: preload methods not declared for the ${window} window`
  )
}

test('desktop lyrics window exposes exactly the manifest desktopLyrics surface', () => {
  const surface = preloadSurfaces.find((s) => s.name === 'desktopLyrics')
  assert.ok(surface)
  const methods = preloadSurfaceMethods(surface!)
  compareWindowMethods(
    'desktopLyrics',
    methods.map((m) => `desktopLyrics.${m.name}`),
    'desktopLyrics',
    'desktopLyrics'
  )
})

test('mini player window exposes miniPlayer window methods plus cover data', () => {
  const windowSpan = aliasSpans.get('miniPlayerWindowApi')!
  const windowMethods = collectMethods(
    preloadSource,
    windowSpan.start,
    windowSpan.end,
    2,
    resolvePreloadAlias
  )
  compareWindowMethods(
    'miniPlayer',
    windowMethods.map((m) => `miniPlayer.${m.name}`),
    'miniPlayer',
    'miniPlayer'
  )

  const coverSpan = aliasSpans.get('miniPlayerCoverDataApi')!
  const coverMethods = collectMethods(preloadSource, coverSpan.start, coverSpan.end, 2, resolvePreloadAlias)
  compareWindowMethods(
    'miniPlayer cover data',
    coverMethods.map((m) => `data.${m.name}`),
    'miniPlayer',
    'data'
  )
})

test('tray player window exposes exactly the manifest trayPlayer surface', () => {
  const span = aliasSpans.get('trayPlayerWindowApi')!
  const methods = collectMethods(preloadSource, span.start, span.end, 2, resolvePreloadAlias)
  compareWindowMethods(
    'trayPlayer',
    methods.map((m) => `trayPlayer.${m.name}`),
    'trayPlayer',
    'trayPlayer'
  )
})

test('preload exposes the document-detection helpers for auxiliary windows', () => {
  assert.match(preloadSource, /function isDesktopLyricsDocument\(\)/)
  assert.match(preloadSource, /function isMiniPlayerDocument\(\)/)
  assert.match(preloadSource, /function isTrayPlayerDocument\(\)/)
  assert.match(preloadSource, /exposeInMainWorld\('api', exposedApiForDocument\(\)\)/)
})

/* ── Behavioral contract: revision/CAS writes ──────────────────────────── */

test('revisionCas methods write through the versioned envelope helper', () => {
  for (const surface of WINDOW_API_MANIFEST) {
    for (const method of surface.methods) {
      if (!method.revisionCas) continue
      const preloadSurface = preloadSurfaces.find((s) => s.name === surface.surface)
      assert.ok(preloadSurface, `surface ${surface.surface} missing for revisionCas method`)
      assert.equal(preloadSurface!.kind, 'block', `surface ${surface.surface} must be a block`)
      const span = preloadSource.slice(preloadSurface!.blockOpen, preloadSurface!.blockClose + 1)
      const escaped = method.channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(`invoke(?:Optional)?VersionedDataWrite\\(\\s*'${escaped}'`)
      assert.match(
        span,
        pattern,
        `${surface.surface}.${method.method} must write through invokeVersionedDataWrite('${method.channel}', ...)`
      )
    }
  }
})

/* ── Behavioral contract: parameters and events ────────────────────────── */

test('manifest parameter names appear in the preload method signature', () => {
  for (const surface of WINDOW_API_MANIFEST) {
    const preloadSurface = preloadSurfaces.find((s) => s.name === surface.surface)
    if (!preloadSurface) continue
    const methods = preloadSurfaceMethods(preloadSurface!)
    for (const method of surface.methods) {
      if (!method.params?.length) continue
      const entry = methods.find((m) => m.name === method.method)
      assert.ok(entry, `${surface.surface}.${method.method} missing from preload`)
      const signature = methodSignatureSource(entry!)
      for (const param of method.params) {
        assert.match(
          signature,
          new RegExp(`\\b${param}\\b`),
          `${surface.surface}.${method.method} should declare parameter ${param}`
        )
      }
    }
  }
})

test('every event channel recorded in the manifest has a real preload subscription', () => {
  for (const surface of WINDOW_API_MANIFEST) {
    for (const method of surface.methods) {
      for (const channel of method.events ?? []) {
        const found = eventChannelSources.some((source) => source.includes(`'${channel}'`))
        assert.ok(
          found,
          `${surface.surface}.${method.method} event channel ${channel} has no preload subscription`
        )
      }
    }
  }
})

/* ── Contract: Tauri bridge transport consistency ──────────────────────── */

const BRIDGE_SURFACES_BY_NAME = new Map(bridgeSurfaces.map((s) => [s.name, s]))

test('every wired method (invoke/native/stub/reject) has a real bridge implementation', () => {
  for (const key of getMainWindowApiMethods()) {
    const dot = key.indexOf('.')
    const surfaceName = key.slice(0, dot)
    const methodName = key.slice(dot + 1)
    const record = getWindowApiMethod(surfaceName, methodName)
    assert.ok(record, `no manifest record for ${key}`)
    const transport = record!.tauriTransport
    if (transport === 'tauri-unmigrated') continue
    const bridgeSurface = BRIDGE_SURFACES_BY_NAME.get(surfaceName)
    assert.ok(bridgeSurface, `${key} is ${transport} but surface ${surfaceName} is absent from the bridge`)
    assert.equal(bridgeSurface!.kind, 'block', `bridge surface ${surfaceName} must be a block`)
    const method = bridgeSurfaceMethods(bridgeSurface!).find((m) => m.name === methodName)
    assert.ok(method, `${key} is ${transport} but ${methodName} is not defined in the bridge ${surfaceName} block`)
    const span = bridgeSource.slice(method!.start, method!.end)
    if (transport === 'tauri-invoke') {
      assert.match(
        span,
        /invoke(?:<[^>]*>)?\(/,
        `${key} is tauri-invoke but the bridge body does not call invoke()`
      )
    } else if (transport === 'tauri-reject') {
      assert.match(
        span,
        /(?:capabilityError|rejectMethod)\(/,
        `${key} is tauri-reject but the bridge body does not reject with a capability error`
      )
    } else if (transport === 'tauri-native') {
      assert.match(
        span,
        /(currentWindow|convertFileSrc|revealItemInDir|openPath|openUrl|open\(|listen\(|subscribeToTauriEvent<|invoke\()/,
        `${key} is tauri-native but the bridge body uses no real Tauri API`
      )
    }
  }
})

test('unmigrated methods are not wired in the bridge', () => {
  for (const key of getMainWindowApiMethods()) {
    const dot = key.indexOf('.')
    const surfaceName = key.slice(0, dot)
    const methodName = key.slice(dot + 1)
    const record = getWindowApiMethod(surfaceName, methodName)
    assert.ok(record)
    if (record!.tauriTransport !== 'tauri-unmigrated') continue
    const bridgeSurface = BRIDGE_SURFACES_BY_NAME.get(surfaceName)
    if (!bridgeSurface || bridgeSurface.kind !== 'block') continue
    const present = bridgeSurfaceMethods(bridgeSurface).some((m) => m.name === methodName)
    assert.ok(
      !present,
      `${key} is tauri-unmigrated but ${methodName} is wired in the bridge ${surfaceName} block`
    )
  }
})

test('bridge surfaces never expose a method the manifest does not declare', () => {
  for (const surface of bridgeSurfaces) {
    if (surface.kind !== 'block') continue
    const manifestSurface = getWindowApiSurface(surface.name)
    assert.ok(manifestSurface, `bridge surface ${surface.name} is not in the manifest`)
    for (const method of bridgeSurfaceMethods(surface)) {
      assert.ok(
        getWindowApiMethod(surface.name, method.name),
        `bridge ${surface.name}.${method.name} has no manifest record`
      )
    }
  }
})
