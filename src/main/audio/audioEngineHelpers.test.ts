import assert from 'node:assert/strict'
import test from 'node:test'

const { parseDspGraphStatusOrThrow, parseNativeJson } = (await import(
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
