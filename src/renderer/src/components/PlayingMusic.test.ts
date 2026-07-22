import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

test('now playing lyrics do not surface original/translated source path chips', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /const lyricSourceLabel = computed/)
  assert.doesNotMatch(source, /const translatedLyricSourceLabel = computed/)
  assert.doesNotMatch(source, /class="lyric-source-chip"/)
  assert.doesNotMatch(source, /lyric-source-chips/)
  assert.match(source, /currentTrack\.value\?\.lyricsSource/)
  assert.match(source, /currentTrack\.value\?\.translatedLyricsSource/)
})

test('visualizer mode does not keep the heavy blurred backdrop mounted', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(source, /<div v-if="viewMode !== 'visualizer'" class="backdrop"/)
})

test('clicking a timed lyric releases manual scroll lock before seeking', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const jumpToLyric = source.match(
    /function jumpToLyric\(time: number \| null\): void \{[\s\S]*?\n\}/
  )?.[0]

  assert.ok(jumpToLyric)
  assert.match(jumpToLyric, /clearLyricManualScrollTimer\(\)/)
  assert.match(jumpToLyric, /lyricManualScrollLocked = false/)
  assert.match(jumpToLyric, /cancelLyricScrollAnimation\(\)/)
  assert.match(jumpToLyric, /seek\(Math\.max\(0, time - currentLyricOffsetSeconds\.value\)\)/)
  assert.match(source, /class="lyric-row"[\s\S]*@pointerdown\.stop[\s\S]*@click="jumpToLyric/)
})

test('now playing and player bar share the same playback singleton', () => {
  const nowPlaying = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
  const playerBar = readFileSync(new URL('./PlayerBar.vue', import.meta.url), 'utf8')

  assert.match(nowPlaying, /import \{ usePlayerStore \} from '\.\.\/stores\/usePlayerStore'/)
  assert.doesNotMatch(nowPlaying, /usePlaybackQueueStore/)
  assert.match(playerBar, /import \{ usePlayerStore \} from '\.\.\/stores\/usePlayerStore'/)
})

test('renderer playback consumers cannot retain a second playback state after hot reload', () => {
  const playbackConsumers = [
    './AudioVisualizerPanel.vue',
    './LocalDashboard.vue',
    './PlayingMusic.vue',
    './PlayerBar.vue',
    './SettingsPage.vue',
    './SongList.vue',
    './StreamingPage.vue',
    './player-bar/LyricsManagerPanel.vue'
  ]

  for (const component of playbackConsumers) {
    const source = readFileSync(new URL(component, import.meta.url), 'utf8')
    assert.match(source, /import \{ usePlayerStore \} from /, component)
    assert.doesNotMatch(source, /usePlaybackQueueStore/, component)
  }

  const compatibilityExport = readFileSync(
    new URL('../stores/usePlaybackQueueStore.ts', import.meta.url),
    'utf8'
  )
  assert.match(
    compatibilityExport,
    /export \{ usePlayerStore as usePlaybackQueueStore \} from '\.\/usePlayerStore'/
  )
  assert.doesNotMatch(compatibilityExport, /defineStore/)
})

test('player bar remounts the progress control for every queue entry', () => {
  const source = readFileSync(new URL('./PlayerBar.vue', import.meta.url), 'utf8')

  assert.match(
    source,
    /:key="`progress:\$\{currentTrack\.id\}:\$\{currentTrack\.queueEntryId \|\| ''\}`"/
  )
})

test('visualizer mode uses a full viewport stage without changing the regular stage cap', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(source, /class="\['stage', \{ 'stage--visualizer': viewMode === 'visualizer' \}\]"/)
  assert.match(source, /\.stage \{[\s\S]*width: min\(100%, 1560px\)/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*width: 100vw/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*height: 100vh/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*max-width: none/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*padding: 0/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*margin: 0/)
})

test('visualizer toggle sits top-left with the frosted time-chip style', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(
    source,
    /:class="\{ 'visualizer-toggle-button--close': viewMode === 'visualizer' \}"/
  )
  assert.match(source, /\.visualizer-toggle-button \{[\s\S]*top: 42px[\s\S]*left: 42px/)
  assert.match(source, /\.visualizer-toggle-button \{[\s\S]*border-radius: 999px/)
  assert.match(
    source,
    /\.visualizer-toggle-button \{[\s\S]*background: rgba\(255, 255, 255, 0\.08\)/
  )
  assert.match(
    source,
    /\.visualizer-toggle-button \{[\s\S]*border: 1px solid rgba\(255, 255, 255, 0\.1\)/
  )
  assert.match(source, /\.visualizer-toggle-button--close \{[\s\S]*top: 8px[\s\S]*left: 14px/)
  assert.match(source, /\.visualizer-toggle-button--close \{[\s\S]*right: auto/)
  assert.match(
    source,
    /\.visualizer-toggle-button--close:hover \{[\s\S]*background: rgba\(255, 255, 255, 0\.14\)/
  )
  assert.doesNotMatch(source, /\.visualizer-toggle-button--close \{[^}]*border-radius: 0/)
  assert.doesNotMatch(source, /title-bar-left-controls/)
  assert.doesNotMatch(source, /lyric-manage-button/)
  assert.doesNotMatch(source, /lyric-manager-backdrop/)
})

test('playbar lyrics section hosts the lyrics manager panel', () => {
  const sidebar = readFileSync(new URL('./player-bar/HiFiSidebar.vue', import.meta.url), 'utf8')
  const panel = readFileSync(
    new URL('./player-bar/LyricsManagerPanel.vue', import.meta.url),
    'utf8'
  )

  assert.match(sidebar, /import LyricsManagerPanel from '\.\/LyricsManagerPanel\.vue'/)
  assert.match(sidebar, /<LyricsManagerPanel \/>/)
  assert.match(panel, /class="lyric-manager lyric-manager--panel"/)
  assert.match(panel, /Save lyrics/)
  assert.match(panel, /Import LRC/)
})

test('desktop lyrics html exposes lyric source metadata on hover', () => {
  const source = readFileSync(
    new URL('../../../../resources/desktop-lyrics.html', import.meta.url),
    'utf8'
  )

  assert.match(source, /function lyricSourceLabel\(source\)/)
  assert.match(source, /data\.lyricsSource/)
  assert.match(source, /data\.translatedLyricsSource/)
  assert.match(source, /sourceLabel/)
  assert.match(source, /songInfoEl\.title = sourceLabel/)
})
