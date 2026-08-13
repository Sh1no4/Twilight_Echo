import assert from 'node:assert/strict'
import test from 'node:test'
import type { PlaybackInfo } from './audioEngineTypes.ts'

const {
  DEFAULT_OUTPUT_CONFIG,
  MAX_SOFT_PLAYBACK_CLOCK_GAP_SECONDS,
  advanceSoftPlaybackPosition,
  createDefaultPlaybackInfo,
  nativePlayMode,
  parseDspGraphStatusOrThrow,
  parseNativeJson,
  resolveProcessingMasterState,
  resolveQueueIndexForSource
} = (await import(
  new URL('./audioEngineHelpers.ts', import.meta.url).href
)) as typeof import('./audioEngineHelpers')

function deeplyNestedJson(depth: number): string {
  return `${'['.repeat(depth)}0${']'.repeat(depth)}`
}

function makePlaybackInfo(overrides: Partial<PlaybackInfo> = {}): PlaybackInfo {
  return {
    ...createDefaultPlaybackInfo('wasapi', 'auto', false, DEFAULT_OUTPUT_CONFIG),
    ...overrides
  }
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

test('MAX_SOFT_PLAYBACK_CLOCK_GAP_SECONDS is 1.5', () => {
  assert.equal(MAX_SOFT_PLAYBACK_CLOCK_GAP_SECONDS, 1.5)
})

test('nativePlayMode maps supported modes and falls back otherwise', () => {
  assert.equal(nativePlayMode('sequential'), 'sequential')
  assert.equal(nativePlayMode('repeat'), 'repeat')
  assert.equal(nativePlayMode('shuffle'), 'shuffle')
  assert.equal(nativePlayMode('listLoop'), 'sequential')
  assert.equal(nativePlayMode('unknown' as Parameters<typeof nativePlayMode>[0]), 'sequential')
})

test('resolveQueueIndexForSource returns info unchanged when no correction is needed', () => {
  const queue = [
    { id: 'one', source: 'one.flac' },
    { id: 'two', source: 'two.flac' }
  ]
  const noSource = makePlaybackInfo({ queueIndex: 1 })
  assert.equal(resolveQueueIndexForSource(queue, noSource), noSource)

  const matchingSource = makePlaybackInfo({ source: 'one.flac', queueIndex: 0 })
  assert.equal(resolveQueueIndexForSource(queue, matchingSource), matchingSource)

  const missingSource = makePlaybackInfo({ source: 'missing.flac', queueIndex: 0 })
  assert.equal(resolveQueueIndexForSource(queue, missingSource), missingSource)
})

test('resolveQueueIndexForSource copies with corrected queue index when source exists elsewhere', () => {
  const queue = [
    { id: 'one', source: 'one.flac' },
    { id: 'two', source: 'two.flac' },
    { id: 'three', source: 'one.flac' }
  ]
  const info = makePlaybackInfo({ source: 'two.flac', queueIndex: 0 })
  const resolved = resolveQueueIndexForSource(queue, info)

  assert.notEqual(resolved, info)
  assert.equal(resolved.queueIndex, 1)
  assert.equal(resolved.source, 'two.flac')
})

test('advanceSoftPlaybackPosition applies the soft playback clock rule', () => {
  assert.equal(advanceSoftPlaybackPosition(10, 0.25, 1, 20), 10.25)
  assert.equal(advanceSoftPlaybackPosition(10, 0.25, 1.5, 20), 10.375)
  assert.equal(advanceSoftPlaybackPosition(10, 0.25, 1.5, 10.2), 10.2)
  assert.equal(advanceSoftPlaybackPosition(10, 0.25, 1.5, 0), 10.375)
  assert.equal(advanceSoftPlaybackPosition(10, 2.5, 1, 20), 10)
  assert.equal(advanceSoftPlaybackPosition(10, -1, 1, 20), 10)
})
