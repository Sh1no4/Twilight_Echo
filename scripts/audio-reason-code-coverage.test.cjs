'use strict'

/**
 * Repository gate: every reason code the native engine can emit must have copy
 * in the shared registry.
 *
 * Before this gate, five codes reached the UI with no label at all
 * (`dop_marker_mismatch`, `native_dsd_runtime_unproven`,
 * `native_dsd_typed_callback_missing`, `topology_rollback_failed`,
 * `unsupported_asio_sample_type`). The renderer's lookup missed, fell through to
 * `capabilityReason`, and the user was shown a bare English identifier inside a
 * Chinese UI. Nothing failed loudly, so it went unnoticed.
 *
 * The C++ sources are the authority on what can be emitted, so this greps them
 * rather than trusting a hand-maintained list. Adding a `perfectReasonCode` in
 * C++ without adding copy now fails here instead of surfacing to a user.
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.join(__dirname, '..')
const ENGINE_DIR = path.join(ROOT, 'audio-engine')
const REGISTRY = path.join(ROOT, 'src', 'shared', 'audio', 'reasonCodes.ts')
const ZH_CATALOG = path.join(ROOT, 'src', 'shared', 'i18n', 'messages', 'zh-CN.ts')
const EN_CATALOG = path.join(ROOT, 'src', 'shared', 'i18n', 'messages', 'en-US.ts')

/** Assignments the engine makes to either reason field, in C++ source. */
const CODE_ASSIGNMENT = /\b(?:perfectReasonCode|capabilityReasonCode)\s*=\s*"([a-z0-9_]+)"/g

/** Test fixtures assert on codes but do not define what production emits. */
function isEngineTestFile(file) {
  const relative = path.relative(ENGINE_DIR, file).replace(/\\/g, '/')
  return relative.startsWith('tests/') || /_tests?\.cpp$/.test(relative)
}

function walkCpp(dir) {
  const out = []
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // third_party is vendored; build outputs are generated.
      if (entry.name === 'third_party' || entry.name === 'build' || entry.name.startsWith('.')) {
        continue
      }
      out.push(...walkCpp(full))
    } else if (/\.(?:cpp|h|hpp|mm)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function nativeReasonCodes() {
  const codes = new Map()
  for (const file of walkCpp(ENGINE_DIR)) {
    if (isEngineTestFile(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(CODE_ASSIGNMENT)) {
      const relative = path.relative(ROOT, file).replace(/\\/g, '/')
      if (!codes.has(match[1])) codes.set(match[1], relative)
    }
  }
  return codes
}

function registeredCodes() {
  const source = fs.readFileSync(REGISTRY, 'utf8')
  const body = source.slice(source.indexOf('AUDIO_REASON_CODES'))
  const codes = new Set()
  // Registry keys are bare identifiers at the start of an entry line.
  for (const match of body.matchAll(/^\s{2}([a-z0-9_]+):\s*\{/gm)) codes.add(match[1])
  return codes
}

function catalogKeys(file) {
  const source = fs.readFileSync(file, 'utf8')
  const keys = new Set()
  for (const match of source.matchAll(/^\s*'([^']+)':/gm)) keys.add(match[1])
  return keys
}

test('the audio engine still exists and emits reason codes we can read', () => {
  // Guard against the grep silently matching nothing (a moved directory or a
  // renamed field would otherwise make every assertion below vacuously pass).
  assert.ok(fs.existsSync(ENGINE_DIR), 'audio-engine/ must exist for this gate to mean anything')
  const native = nativeReasonCodes()
  assert.ok(
    native.size >= 20,
    `expected the engine to emit at least 20 reason codes, found ${native.size} — has the field been renamed?`
  )
})

test('every native reason code has an entry in the shared registry', () => {
  const native = nativeReasonCodes()
  const registered = registeredCodes()
  const missing = [...native.entries()]
    .filter(([code]) => !registered.has(code))
    .map(([code, file]) => `${code} (emitted in ${file})`)
    .sort()

  assert.deepEqual(
    missing,
    [],
    'these native reason codes would reach the UI as bare identifiers; add them to src/shared/audio/reasonCodes.ts'
  )
})

test('every registered code has label and explain copy in both catalogs', () => {
  const registered = [...registeredCodes()].sort()
  assert.ok(registered.length > 0, 'registry parse found no codes')

  for (const [name, file] of [
    ['zh-CN', ZH_CATALOG],
    ['en-US', EN_CATALOG]
  ]) {
    const keys = catalogKeys(file)
    const missing = []
    for (const code of registered) {
      for (const field of ['label', 'explain']) {
        const key = `audio.reason.${code}.${field}`
        if (!keys.has(key)) missing.push(key)
      }
    }
    assert.deepEqual(missing, [], `${name} is missing copy for these reason codes`)
  }
})

test('no registry entry is dead weight left behind by the engine', () => {
  // A code that no longer exists anywhere is a maintenance trap: it looks
  // covered but can never fire. Blockers are computed in TypeScript, so a code
  // counts as live if either layer references it.
  const registered = [...registeredCodes()]
  const native = nativeReasonCodes()
  const tsSources = [
    path.join(ROOT, 'src', 'main', 'audio', 'audioDiagnostics.ts'),
    path.join(ROOT, 'src', 'shared', 'audio', 'reasonCodes.ts')
  ]
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')

  const orphans = registered.filter((code) => !native.has(code) && !tsSources.includes(code))
  assert.deepEqual(orphans, [], 'these registry codes are emitted by nobody; remove them')
})
