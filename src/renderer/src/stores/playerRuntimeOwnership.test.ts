import assert from 'node:assert/strict'
import test from 'node:test'
import { claimRendererRuntime } from './playerRuntimeOwnership.ts'

test('a replacement renderer runtime releases stale listeners before becoming active', () => {
  const host: Record<PropertyKey, unknown> = {}
  const key = Symbol('player-runtime')
  const releases: string[] = []

  const first = claimRendererRuntime(key, () => releases.push('first'), host)
  const second = claimRendererRuntime(key, () => releases.push('second'), host)

  assert.equal(first.generation, 1)
  assert.equal(second.generation, 2)
  assert.deepEqual(releases, ['first'])

  // A stale module being disposed after its replacement must not tear down the
  // new runtime that now owns the same renderer window.
  first.release()
  assert.deepEqual(releases, ['first'])

  second.release()
  assert.deepEqual(releases, ['first', 'second'])
  assert.equal(host[key], undefined)
})
