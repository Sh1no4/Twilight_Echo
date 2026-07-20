import assert from 'node:assert/strict'
import test from 'node:test'
import { toggleVolumeMute } from './volumeMute.ts'

test('mute saves the current audible volume and a second action restores it', () => {
  const muted = toggleVolumeMute({ volume: 0.68, muted: false, lastAudibleVolume: 1 })
  assert.deepEqual(muted, { volume: 0, muted: true, lastAudibleVolume: 0.68 })
  assert.deepEqual(toggleVolumeMute(muted), {
    volume: 0.68,
    muted: false,
    lastAudibleVolume: 0.68
  })
})

test('an externally zeroed volume restores the most recently audible level', () => {
  assert.deepEqual(toggleVolumeMute({ volume: 0, muted: false, lastAudibleVolume: 0.42 }), {
    volume: 0.42,
    muted: false,
    lastAudibleVolume: 0.42
  })
})
