import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  evaluateNativePlaybackInfoIntent,
  type NativePlaybackInfoIntent
} from './nativePlaybackInfoIntent.ts'

function createIntent(): NativePlaybackInfoIntent {
  return {
    loadToken: 7,
    trackId: 'next-track',
    queueIndex: 1,
    source: 'C:\\music\\next.flac',
    expiresAt: 2500,
    confirmedAt: null
  }
}

test('keeps the expected track guard after a matching update rejects a delayed old track', () => {
  const intent = createIntent()
  const graceMs = 500

  assert.equal(
    evaluateNativePlaybackInfoIntent(
      intent,
      { trackId: 'next-track', source: 'C:\\music\\next.flac' },
      100,
      graceMs
    ),
    'match'
  )
  intent.confirmedAt = 100

  assert.equal(
    evaluateNativePlaybackInfoIntent(
      intent,
      { trackId: 'previous-track', source: 'C:\\music\\previous.flac' },
      160,
      graceMs
    ),
    'ignore'
  )
  assert.equal(
    evaluateNativePlaybackInfoIntent(
      intent,
      { trackId: 'next-track', source: 'C:\\music\\next.flac' },
      220,
      graceMs
    ),
    'match'
  )
})

test('releases the guard after its post-confirmation window ends', () => {
  const intent = createIntent()
  intent.confirmedAt = 100

  assert.equal(
    evaluateNativePlaybackInfoIntent(
      intent,
      { trackId: 'previous-track', source: 'C:\\music\\previous.flac' },
      601,
      500
    ),
    'expired'
  )
})
