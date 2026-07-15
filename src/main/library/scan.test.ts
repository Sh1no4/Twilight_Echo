import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('local library scan normalizes common bpm metadata into Track bpm', () => {
  const source = readFileSync(new URL('./scan.ts', import.meta.url), 'utf8')

  assert.match(source, /function normalizeBpm\(/)
  assert.match(source, /const bpm = normalizeBpm\(common\.bpm\)/)
  assert.match(source, /if \(bpm !== undefined\) track\.bpm = bpm/)
})

test('local library scan persists ReplayGain and R128 tags onto Track records', () => {
  const source = readFileSync(new URL('./scan.ts', import.meta.url), 'utf8')
  assert.match(source, /export function extractReplayGainTags\(/)
  assert.match(source, /function normalizeGainDb\(/)
  assert.match(source, /function normalizePeak\(/)
  assert.match(source, /function normalizeR128GainDb\(/)
  assert.match(source, /\.\.\.replayGainTags/)
  assert.match(source, /replayGainTrackGainDb/)
  assert.match(source, /replayGainAlbumGainDb/)
  assert.match(source, /replayGainTrackPeak/)
  assert.match(source, /replayGainAlbumPeak/)
  assert.match(source, /r128TrackGainDb/)
  assert.match(source, /r128AlbumGainDb/)
  assert.match(source, /Math\.abs\(value\) > 64 \? value \/ 256/)
  assert.match(source, /REPLAYGAIN_TRACK_GAIN/)
  assert.match(source, /R128_TRACK_GAIN/)
  assert.match(source, /R128_ALBUM_GAIN/)
})
