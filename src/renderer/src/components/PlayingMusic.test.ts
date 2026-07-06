import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

test('now playing lyrics expose original and translated lyric source labels', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(source, /const lyricSourceLabel = computed/)
  assert.match(source, /const translatedLyricSourceLabel = computed/)
  assert.match(source, /currentTrack\.value\?\.lyricsSource/)
  assert.match(source, /currentTrack\.value\?\.translatedLyricsSource/)
  assert.match(source, /class="lyric-source-chip"/)
  assert.match(source, /v-if="lyricSourceLabel"/)
})

test('visualizer mode does not keep the heavy blurred backdrop mounted', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(source, /<div v-if="viewMode !== 'visualizer'" class="backdrop"/)
})

test('visualizer mode uses a full viewport stage without changing the regular stage cap', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(
    source,
    /class="\['stage', \{ 'stage--visualizer': viewMode === 'visualizer' \}\]"/
  )
  assert.match(source, /\.stage \{[\s\S]*width: min\(100%, 1560px\)/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*width: 100vw/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*height: 100vh/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*max-width: none/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*padding: 0/)
  assert.match(source, /\.stage--visualizer \{[\s\S]*margin: 0/)
})

test('visualizer close button moves to the top-left titlebar area only in visualizer mode', () => {
  const source = readFileSync(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')

  assert.match(source, /:class="\{ 'visualizer-toggle-button--close': viewMode === 'visualizer' \}"/)
  assert.match(source, /\.visualizer-toggle-button \{[\s\S]*top: 42px[\s\S]*right: 42px/)
  assert.match(source, /\.visualizer-toggle-button--close \{[\s\S]*top: 8px[\s\S]*left: 14px/)
  assert.match(source, /\.visualizer-toggle-button--close \{[\s\S]*right: auto/)
  assert.match(source, /\.visualizer-toggle-button--close \{[\s\S]*background: transparent/)
  assert.match(source, /\.visualizer-toggle-button--close:hover \{[\s\S]*background: rgba\(255, 255, 255, 0\.85\)/)
  assert.doesNotMatch(source, /\.visualizer-toggle-button--close \{[^}]*border-radius: 0/)
  assert.doesNotMatch(source, /title-bar-left-controls/)
})

test('desktop lyrics html exposes lyric source metadata on hover', () => {
  const source = readFileSync(new URL('../../../../resources/desktop-lyrics.html', import.meta.url), 'utf8')

  assert.match(source, /function lyricSourceLabel\(source\)/)
  assert.match(source, /data\.lyricsSource/)
  assert.match(source, /data\.translatedLyricsSource/)
  assert.match(source, /sourceLabel/)
  assert.match(source, /songInfoEl\.title = sourceLabel/)
})
