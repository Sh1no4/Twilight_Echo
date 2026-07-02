import assert from 'node:assert/strict'
import test from 'node:test'

const {
  buildMetadataMatchCandidates,
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

test('buildMetadataMatchCandidates ranks provider candidates and exposes enrichment hints', () => {
  const candidates = buildMetadataMatchCandidates(localTrack, [
    {
      id: 'local:duplicate',
      title: 'Moon River',
      artist: 'Audrey',
      album: 'Local Duplicate',
      filePath: 'D:\\Music\\Duplicate.flac',
      fileName: 'Duplicate.flac',
      duration: 181,
      size: 10_000,
      cover: 'local-cover',
      lyrics: null,
      source: 'local'
    },
    {
      id: 'ncm:medium',
      title: 'Moon River',
      artist: 'Audrey',
      album: 'Provider Medium',
      filePath: 'ncm:medium',
      fileName: 'Moon River',
      duration: 197,
      size: 0,
      cover: null,
      lyrics: '[00:00.00]Medium lyric',
      source: 'ncm'
    },
    {
      id: 'bili:high',
      title: 'Moon River',
      artist: 'Audrey',
      album: 'Provider High',
      filePath: 'bili:high',
      fileName: 'Moon River',
      duration: 180,
      size: 0,
      cover: 'https://cover.example/high.jpg',
      lyrics: '[00:00.00]High lyric',
      translatedLyrics: '[00:00.00]高分歌词',
      source: 'bili'
    },
    {
      id: 'ncm:wrong',
      title: 'Different Song',
      artist: 'Audrey',
      album: 'Wrong',
      filePath: 'ncm:wrong',
      fileName: 'Different Song',
      duration: 180,
      size: 0,
      cover: null,
      lyrics: null,
      source: 'ncm'
    }
  ])

  assert.deepEqual(candidates.map((candidate) => candidate.track.id), ['bili:high', 'ncm:medium'])
  assert.equal(candidates[0].providerId, 'bili')
  assert.equal(candidates[0].sourceLabel, 'bili')
  assert.equal(candidates[0].confidence, 'high')
  assert.equal(candidates[0].fills.cover, true)
  assert.equal(candidates[0].fills.lyrics, true)
  assert.equal(candidates[0].fills.translatedLyrics, true)
  assert.equal(candidates[0].fills.metadata, false)
  assert.equal(candidates[1].confidence, 'medium')
})

test('buildMetadataMatchCandidates keeps provider search ranking when scores tie', () => {
  const first = {
    id: 'ncm:first',
    title: 'Moon River',
    artist: 'Audrey',
    album: 'First Album',
    filePath: 'ncm:first',
    fileName: 'Moon River',
    duration: 180,
    size: 0,
    cover: null,
    lyrics: null,
    source: 'ncm'
  }
  const second = {
    ...first,
    id: 'bili:second',
    filePath: 'bili:second',
    source: 'bili'
  }

  const candidates = buildMetadataMatchCandidates(localTrack, [first, second])

  assert.deepEqual(candidates.map((candidate) => candidate.track.id), ['ncm:first', 'bili:second'])
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
  assert.equal(enriched.lyricsSource, 'provider')
  assert.equal(enriched.translatedLyricsSource, 'provider')
  assert.deepEqual(enriched.metadataMatch, {
    providerId: 'ncm',
    trackId: 'ncm:123',
    confidence: 'high',
    score: 95
  })
  assert.equal(enriched.streamUrl, undefined)
})

test('enrichLocalTrackMetadata can fill missing artist and album from a close provider match', () => {
  const localMissingArtist = {
    ...localTrack,
    artist: '',
    album: ''
  }
  const match = findBestMetadataMatch(localMissingArtist, [
    {
      id: 'ncm:123',
      title: 'Moon River',
      artist: 'Audrey',
      album: 'Online Album',
      filePath: 'ncm:123',
      fileName: 'Moon River',
      duration: 180,
      size: 0,
      cover: null,
      lyrics: null,
      source: 'ncm'
    }
  ])

  const candidates = buildMetadataMatchCandidates(localMissingArtist, [match!.track])
  const enriched = enrichLocalTrackMetadata(localMissingArtist, match)

  assert.equal(match?.confidence, 'medium')
  assert.equal(candidates[0].fills.metadata, true)
  assert.equal(enriched.artist, 'Audrey')
  assert.equal(enriched.album, 'Online Album')
  assert.equal(enriched.id, 'local:abc')
  assert.equal(enriched.source, 'local')
})

test('enrichLocalTrackMetadata preserves existing lyric source labels', () => {
  const enriched = enrichLocalTrackMetadata(
    {
      ...localTrack,
      lyrics: '[00:00.00]Local lyric',
      lyricsSource: 'local'
    },
    {
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
        lyrics: '[00:00.00]Provider lyric',
        translatedLyrics: '[00:00.00]Provider translation',
        source: 'ncm'
      },
      confidence: 'high',
      score: 95
    }
  )

  assert.equal(enriched.lyrics, '[00:00.00]Local lyric')
  assert.equal(enriched.lyricsSource, 'local')
  assert.equal(enriched.translatedLyrics, '[00:00.00]Provider translation')
  assert.equal(enriched.translatedLyricsSource, 'provider')
})
