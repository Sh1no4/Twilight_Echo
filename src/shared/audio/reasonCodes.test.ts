import assert from 'node:assert/strict'
import test from 'node:test'
import { APP_LOCALES } from '../i18n/locale.ts'
import { hasMessage } from '../i18n/translate.ts'
import {
  AUDIO_REASON_CODES,
  dspNodeTypeFromReasonCode,
  isDspNodeReasonCode,
  resolveReasonCode,
  sortReasonsBySeverity
} from './reasonCodes.ts'

test('every registered code has a label and an explanation in every locale', () => {
  const missing: string[] = []
  for (const code of Object.keys(AUDIO_REASON_CODES)) {
    // `.fix` is intentionally optional — a hardware limit has no user action —
    // but a code with no label or explanation is a hole in the UI.
    for (const part of ['label', 'explain']) {
      const key = `audio.reason.${code}.${part}`
      if (!hasMessage(key)) missing.push(key)
    }
  }
  assert.deepEqual(missing, [])
})

test('resolving a code yields distinct copy per locale', () => {
  const zh = resolveReasonCode('zh-CN', 'shared_mixer')
  const en = resolveReasonCode('en-US', 'shared_mixer')

  assert.equal(zh.known, true)
  assert.equal(zh.severity, 'blocking')
  assert.equal(zh.origin, 'output')
  assert.match(zh.label, /系统混音/)
  assert.match(en.label, /mixer/i)
  assert.notEqual(zh.explain, en.explain)
  // Both locales must actually answer "what do I do".
  assert.ok(zh.fix.length > 0)
  assert.ok(en.fix.length > 0)
})

test('a code with no user-actionable fix resolves to an empty fix, not a raw key', () => {
  for (const locale of APP_LOCALES) {
    const lossy = resolveReasonCode(locale, 'source_lossy')
    assert.equal(lossy.known, true)
    assert.equal(lossy.fix, '')
    // The explanation must still exist: the user deserves to know it is not
    // their fault rather than seeing a blank row.
    assert.ok(lossy.explain.length > 0)
    assert.doesNotMatch(lossy.explain, /audio\.reason/)
  }
})

test('the five codes that previously had no copy now resolve', () => {
  // These are emitted by the native engine but had no entry in the old inline
  // PlayerBar map, so they reached the user as a bare English identifier.
  const previouslyOrphaned = [
    'dop_marker_mismatch',
    'native_dsd_runtime_unproven',
    'native_dsd_typed_callback_missing',
    'topology_rollback_failed',
    'unsupported_asio_sample_type'
  ]
  for (const code of previouslyOrphaned) {
    for (const locale of APP_LOCALES) {
      const resolved = resolveReasonCode(locale, code)
      assert.equal(resolved.known, true, `${code} unknown in ${locale}`)
      assert.notEqual(resolved.label, code, `${code} still renders as its identifier`)
      assert.ok(resolved.explain.length > 0, `${code} has no explanation in ${locale}`)
    }
  }
})

test('per-node DSP codes resolve through the shared template', () => {
  assert.equal(isDspNodeReasonCode('dsp_node_convolver'), true)
  assert.equal(isDspNodeReasonCode('shared_mixer'), false)
  assert.equal(dspNodeTypeFromReasonCode('dsp_node_convolver'), 'convolver')

  const resolved = resolveReasonCode('zh-CN', 'dsp_node_convolver')
  assert.equal(resolved.known, true)
  assert.equal(resolved.origin, 'dsp-scene')
  assert.match(resolved.label, /卷积器/)
  assert.doesNotMatch(resolved.label, /\{node\}/)
  assert.doesNotMatch(resolved.explain, /\{node\}/)

  // An unmapped node type falls back to its raw type rather than a blank name.
  const unknownNode = resolveReasonCode('zh-CN', 'dsp_node_somethingNew')
  assert.match(unknownNode.label, /somethingNew/)
})

test('an unregistered code still renders something searchable', () => {
  const resolved = resolveReasonCode('zh-CN', 'brand_new_native_code')
  assert.equal(resolved.known, false)
  assert.equal(resolved.label, 'brand_new_native_code')
  assert.match(resolved.explain, /brand_new_native_code/)
  assert.equal(resolved.fix, '')
})

test('an empty code resolves to empty copy without throwing', () => {
  const resolved = resolveReasonCode('zh-CN', '   ')
  assert.equal(resolved.known, false)
  assert.equal(resolved.label, '')
  assert.equal(resolved.explain, '')
})

test('parameterized codes interpolate their value', () => {
  const resolved = resolveReasonCode('zh-CN', 'output_sample_rate_locked', { value: '48000' })
  assert.match(resolved.explain, /48000/)
  assert.doesNotMatch(resolved.explain, /\{value\}/)
})

test('sorting leads with blocking reasons', () => {
  const sorted = sortReasonsBySeverity([
    { severity: 'info' as const, code: 'a' },
    { severity: 'blocking' as const, code: 'b' },
    { severity: 'degraded' as const, code: 'c' }
  ])
  assert.deepEqual(
    sorted.map((item) => item.code),
    ['b', 'c', 'a']
  )
})

test('every severity and origin has a translated display name', () => {
  const severities = new Set(Object.values(AUDIO_REASON_CODES).map((entry) => entry.severity))
  const origins = new Set(Object.values(AUDIO_REASON_CODES).map((entry) => entry.origin))
  for (const severity of severities) {
    assert.ok(hasMessage(`diagnostics.severity.${severity}`), `severity ${severity} has no copy`)
  }
  for (const origin of origins) {
    assert.ok(hasMessage(`diagnostics.origin.${origin}`), `origin ${origin} has no copy`)
  }
})
