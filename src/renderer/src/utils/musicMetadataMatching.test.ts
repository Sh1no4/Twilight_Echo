import assert from 'node:assert/strict'
import test from 'node:test'

const {
  findBestMetadataMatch,
  enrichLocalTrackMetadata
} = (await import(
  new URL('./musicMetadataMatching.ts', import.meta.url).href
)) as typeof import('./musicMetadataMatching')

const localTrack = {
  id: 'local:abc',
  title: 'Moon River',
  artist: 'Audrey',
  album: 'Local Album',
  filePath: 'D:\\Music\\Moon River.flac',
  fileName: 'Moon River.flac',
  duration: 181,
  size: 10_000,
  cover: null,
  lyrics: null,
  source: 'local',
  format: 'flac'
}

test('findBestMetadataMatch matches provider metadata by normalized title, artist, and close duration', () => {
  const match = findBestMetadataMatch(localTrack, [
    {
      id: 'ncm:wrong',
      title: 'Moon River Live',
      artist: 'Audrey',
      album: 'Concert',
      filePath: 'ncm:wrong',
      fileName: 'Moon River Live',
      duration: 260,
      size: 0,
      cover: 'https://cover.example/live.jpg',
      lyrics: null,
      source: 'ncm'
    },
    {
      id: 'ncm:123',
      title: ' moon  river ',
      artist: 'AUDREY',
      album: 'Online Album',
      filePath: 'ncm:123',
      fileName: 'Moon River',
      duration: 179,
      size: 0,
      cover: 'https://cover.example/album.jpg',
      lyrics: '[00:00.00]Moon River',
      translatedLyrics: '[00:00.00]月亮河',
      source: 'ncm'
    }
  ])

  assert.equal(match?.track.id, 'ncm:123')
  assert.equal(match?.confidence, 'high')
})

test('findBestMetadataMatch rejects far-duration candidates even when title and artist match', () => {
  const match = findBestMetadataMatch(localTrack, [
    {
      id: 'ncm:live',
      title: 'Moon River',
      artist: 'Audrey',
      album: 'Live Album',
      filePath: 'ncm:live',
      fileName: 'Moon River',
      duration: 420,
      size: 0,
      cover: 'https://cover.example/live.jpg',
      lyrics: null,
      source: 'ncm'
    }
  ])

  assert.equal(match, null)
})

test('enrichLocalTrackMetadata fills missing cover and lyrics without replacing local playback identity', () => {
  const enriched = enrichLocalTrackMetadata(localTrack, {
    track: {
      id: 'ncm:123',
      title: 'Moon River',
      artist: 'Audrey',
      album: 'Online Album',
      filePath: 'ncm:123',
      fileName: 'Moon River',
      duration: 180,
      size: 0,
      cover: 'https://cover.example/album.jpg',
      lyrics: '[00:00.00]Moon River',
      translatedLyrics: '[00:00.00]月亮河',
      source: 'ncm',
      streamUrl: 'https://temporary.example/song.mp3'
    },
    confidence: 'high',
    score: 95
  })

  assert.equal(enriched.id, 'local:abc')
  assert.equal(enriched.filePath, 'D:\\Music\\Moon River.flac')
  assert.equal(enriched.source, 'local')
  assert.equal(enriched.cover, 'https://cover.example/album.jpg')
  assert.equal(enriched.lyrics, '[00:00.00]Moon River')
  assert.equal(enriched.translatedLyrics, '[00:00.00]月亮河')
  assert.equal(enriched.streamUrl, undefined)
})

