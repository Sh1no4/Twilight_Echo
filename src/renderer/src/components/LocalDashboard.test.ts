import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('dashboard prioritizes active and last-played tracks over recommendations', () => {
  const source = readFileSync(new URL('./LocalDashboard.vue', import.meta.url), 'utf8')

  assert.match(source, /getRecentTracks/)
  assert.match(source, /const lastPlayedTrack = computed<Track \| null>/)
  assert.match(
    source,
    /if \(currentTrack\.value\) return currentTrack\.value\s*if \(lastPlayedTrack\.value\) return lastPlayedTrack\.value/
  )
  assert.match(source, /heroIsCurrent\.value && isPlaying\.value \? '正在播放' : '上次播放'/)
  assert.doesNotMatch(source, /return '为你推荐'/)
})

test('dashboard primary transport keeps its icon visible on the ink surface', () => {
  const styles = readFileSync(new URL('./LocalDashboard.css', import.meta.url), 'utf8')

  assert.match(styles, /\.transport-button\.transport-play\s*\{[\s\S]*?color:\s*var\(--home-card\)/)
})

test('dashboard renders the resolved DSP graph from source through the output stage', () => {
  const source = readFileSync(new URL('./LocalDashboard.vue', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('./LocalDashboard.css', import.meta.url), 'utf8')

  assert.match(source, /getDspSceneState\(\)/)
  assert.match(source, /getDspGraphStatus\(\)/)
  assert.match(source, /dspSceneState\.value\.graph\.nodes/)
  assert.match(source, /type: 'resampler'/)
  assert.match(source, /type: 'dither'/)
  assert.match(source, /type: 'safetyClamp'/)
  assert.match(source, /v-for="stage in dspRouteStages"/)
  assert.match(source, /class="dsp-route-dialog"\s+role="dialog"/)
  assert.match(source, /dspGraphStatus\?\.meter\?\.truePeakDb/)
  assert.match(source, /averageProcessMs/)
  assert.match(source, /window\.setInterval\([\s\S]*1000\)/)
  assert.match(styles, /\.dsp-route-strip\.is-compact/)
  assert.match(styles, /\.dsp-route-dialog-backdrop/)
  assert.match(styles, /\.dialog-diagnostics/)
})
