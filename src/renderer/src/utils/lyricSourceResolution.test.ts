import assert from 'node:assert/strict'
import test from 'node:test'

const { resolveLyricsWithSources } = (await import(
  new URL('./lyricSourceResolution.ts', import.meta.url).href
)) as typeof import('./lyricSourceResolution')

const localTrack = {
  id: 'local:abc',
  title: 'Local Song',
  artist: 'Artist',
  album: 'Album',
  filePath: 'D:\\Music\\Local Song.flac',
  fileName: 'Local Song.flac',
  dir: 'D:\\Music',
  duration: 180,
  size: 10_000,
  cover: null,
  lyrics: null,
  source: 'local'
}

test('lyric resolution uses local lyrics first while provider may fill missing translation', async () => {
  let providerCalls = 0
  const result = await resolveLyricsWithSources({
    track: localTrack,
    loadLocalLyrics: async () => '[00:01.00]Local lyric',
    loadProviderLyrics: async () => {
      providerCalls++
      return {
        lyrics: '[00:01.00]Provider lyric',
        translatedLyrics: '[00:01.00]Provider translation'
      }
    }
  })

  assert.equal(providerCalls, 1)
  assert.equal(result.lyrics, '[00:01.00]Local lyric')
  assert.equal(result.lyricsSource, 'local')
  assert.equal(result.translatedLyrics, '[00:01.00]Provider translation')
  assert.equal(result.translatedLyricsSource, 'provider')
})

test('lyric resolution falls back to provider lyrics when local lyrics are missing', async () => {
  const result = await resolveLyricsWithSources({
    track: localTrack,
    loadLocalLyrics: async () => null,
    loadProviderLyrics: async () => ({
      lyrics: '[00:01.00]Provider lyric',
      translatedLyrics: '[00:01.00]Provider translation'
    })
  })

  assert.equal(result.lyrics, '[00:01.00]Provider lyric')
  assert.equal(result.lyricsSource, 'provider')
  assert.equal(result.translatedLyrics, '[00:01.00]Provider translation')
  assert.equal(result.translatedLyricsSource, 'provider')
})

test('lyric resolution preserves existing embedded lyrics and only asks provider for missing translation', async () => {
  const result = await resolveLyricsWithSources({
    track: {
      ...localTrack,
      lyrics: '[00:01.00]Embedded lyric',
      lyricsSource: 'embedded'
    },
    loadLocalLyrics: async () => {
      throw new Error('local loader should not be called when lyrics already exist')
    },
    loadProviderLyrics: async () => ({
      lyrics: '[00:01.00]Provider lyric',
      translatedLyrics: '[00:01.00]Provider translation'
    })
  })

  assert.equal(result.lyrics, '[00:01.00]Embedded lyric')
  assert.equal(result.lyricsSource, 'embedded')
  assert.equal(result.translatedLyrics, '[00:01.00]Provider translation')
  assert.equal(result.translatedLyricsSource, 'provider')
})
