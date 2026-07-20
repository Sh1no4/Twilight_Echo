import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampCuePlaybackPosition,
  cueDuration,
  rendererAudioAbsolutePositionForTrack,
  rendererAudioPositionForTrack
} from './cuePlayback.ts'

const cueTrack = {
  duration: 999,
  cueRange: {
    startSeconds: 60,
    endSeconds: 120,
    pregapSeconds: 2,
    virtualPregapSeconds: 2,
    sourcePregapSeconds: 0
  }
}

test('CUE renderer positions are logical and clamped while media positions stay absolute', () => {
  assert.equal(cueDuration(cueTrack), 62)
  assert.equal(clampCuePlaybackPosition(cueTrack, -1), 0)
  assert.equal(clampCuePlaybackPosition(cueTrack, 20), 20)
  assert.equal(clampCuePlaybackPosition(cueTrack, 999), 62)
  assert.equal(rendererAudioAbsolutePositionForTrack(0, cueTrack), 60)
  assert.equal(rendererAudioAbsolutePositionForTrack(1, cueTrack), 60)
  assert.equal(rendererAudioAbsolutePositionForTrack(2, cueTrack), 60)
  assert.equal(rendererAudioAbsolutePositionForTrack(22, cueTrack), 80)
  assert.equal(rendererAudioAbsolutePositionForTrack(999, cueTrack), 120)
  assert.equal(rendererAudioPositionForTrack(60, cueTrack), 2)
  assert.equal(rendererAudioPositionForTrack(80, cueTrack), 22)
  assert.equal(rendererAudioPositionForTrack(10, cueTrack), 0)
  assert.equal(rendererAudioPositionForTrack(500, cueTrack), 62)
})

test('invalid persisted CUE ranges cannot create negative or unbounded segment positions', () => {
  const invalid = {
    duration: 30,
    cueRange: { startSeconds: 70, endSeconds: 60, pregapSeconds: 0 }
  }
  assert.equal(cueDuration(invalid), 30)
  assert.equal(clampCuePlaybackPosition(invalid, -10), 0)
  assert.equal(rendererAudioAbsolutePositionForTrack(10, invalid), 10)
  assert.equal(rendererAudioPositionForTrack(Number.NaN, invalid), 0)
})
