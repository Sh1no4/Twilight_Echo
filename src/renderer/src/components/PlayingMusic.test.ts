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

test('desktop lyrics html exposes lyric source metadata on hover', () => {
  const source = readFileSync(new URL('../../../../resources/desktop-lyrics.html', import.meta.url), 'utf8')

  assert.match(source, /function lyricSourceLabel\(source\)/)
  assert.match(source, /data\.lyricsSource/)
  assert.match(source, /data\.translatedLyricsSource/)
  assert.match(source, /sourceLabel/)
  assert.match(source, /songInfoEl\.title = sourceLabel/)
})
