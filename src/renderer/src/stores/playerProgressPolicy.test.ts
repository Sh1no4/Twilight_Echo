import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldApplyNativeTimePosition } from './playerProgressPolicy.ts'

test('native time-pos applies while the native engine owns playback', () => {
  assert.equal(
    shouldApplyNativeTimePosition({ nativePlaybackActive: true, nativeQueueDelegated: false }),
    true
  )
  assert.equal(
    shouldApplyNativeTimePosition({ nativePlaybackActive: false, nativeQueueDelegated: true }),
    true
  )
  assert.equal(
    shouldApplyNativeTimePosition({ nativePlaybackActive: true, nativeQueueDelegated: true }),
    true
  )
})

test('native time-pos is ignored during HTMLAudio fallback so the bar cannot freeze', () => {
  assert.equal(
    shouldApplyNativeTimePosition({ nativePlaybackActive: false, nativeQueueDelegated: false }),
    false
  )
})
