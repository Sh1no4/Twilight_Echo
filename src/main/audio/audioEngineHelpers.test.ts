import assert from 'node:assert/strict'
import test from 'node:test'

const { parseDspGraphStatusOrThrow, parseNativeJson, resolveProcessingMasterState } = (await import(
  new URL('./audioEngineHelpers.ts', import.meta.url).href
)) as typeof import('./audioEngineHelpers')

function deeplyNestedJson(depth: number): string {
  return `${'['.repeat(depth)}0${']'.repeat(depth)}`
}

test('native audio JSON parsers reject over-nested worker output without changing valid output', () => {
  const fallback = { state: 'stopped' }
  assert.equal(parseNativeJson(deeplyNestedJson(128), fallback), fallback)
  assert.deepEqual(parseNativeJson('{"state":"playing"}', fallback), { state: 'playing' })
  assert.throws(
    () => parseDspGraphStatusOrThrow(deeplyNestedJson(128)),
    /native audio engine returned invalid DSP graph status JSON/
  )
})

test('resolveProcessingMasterState reconciles modules, master switch, and direct mode', () => {
  const base = {
    dspEnabled: false,
    directMode: false,
    eqEnabled: false,
    eqPreamp: 0,
    volumeNormalization: 'off' as const,
    convolverEnabled: false,
    convolverIrPath: '',
    crossfeedEnabled: false,
    crossfeedStrength: 0
  }
  // Enabling EQ exits direct mode and turns the DSP master on.
  assert.deepEqual(resolveProcessingMasterState({ ...base, eqEnabled: true }), {
    dspEnabled: true,
    directMode: false
  })
  // A stale persisted directMode with an enabled module is healed.
  assert.deepEqual(resolveProcessingMasterState({ ...base, directMode: true, eqEnabled: true }), {
    dspEnabled: true,
    directMode: false
  })
  // An explicit master-switch off always wins.
  assert.deepEqual(resolveProcessingMasterState({ ...base, eqEnabled: true }, false), {
    dspEnabled: false,
    directMode: true
  })
  // No module and no explicit intent keeps the current state.
  assert.deepEqual(resolveProcessingMasterState({ ...base, dspEnabled: true, directMode: false }), {
    dspEnabled: true,
    directMode: false
  })
  // Explicit direct mode without modules stays direct.
  assert.deepEqual(resolveProcessingMasterState(base, undefined, true), {
    dspEnabled: false,
    directMode: true
  })
})
