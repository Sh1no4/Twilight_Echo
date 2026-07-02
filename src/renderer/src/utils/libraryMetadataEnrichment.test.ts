import assert from 'node:assert/strict'
import test from 'node:test'

const {
  enrichLocalTracksFromProviders
} = (await import(
  new URL('./libraryMetadataEnrichment.ts', import.meta.url).href
)) as typeof import('./libraryMetadataEnrichment')

const localTrack = {
  id: 'local:moon',
  title: 'Moon River',
  artist: 'Audrey',
  album: '',
  filePath: 'D:\\Music\\Moon River.flac',
  fileName: 'Moon River.flac',
  duration: 181,
  size: 10_000,
  cover: null,
  lyrics: null,
  source: 'local' as const,
  format: 'flac'
}

test('enrichLocalTracksFromProviders fills missing local metadata from provider search results', async () => {
  const enriched = await enrichLocalTracksFromProviders([localTrack], {
    searchSongs: async (query) => {
      assert.equal(query, 'Moon River Audrey')
      return {
        items: [{
          id: 'ncm:123',
          title: 'Moon River',
          artist: 'Audrey',
          album: 'Online Album',
          filePath: 'ncm:123',
          fileName: 'Moon River',
          duration: 179,
          size: 0,
          cover: 'https://cover.example/album.jpg',
          lyrics: '[00:00.00]Moon River',
          translatedLyrics: '[00:00.00]月亮河',
          source: 'ncm' as const,
          streamUrl: 'https://temporary.example/song.mp3'
        }],
        total: 1
      }
    }
  })

  assert.equal(enriched[0].id, 'local:moon')
  assert.equal(enriched[0].filePath, 'D:\\Music\\Moon River.flac')
  assert.equal(enriched[0].album, 'Online Album')
  assert.equal(enriched[0].cover, 'https://cover.example/album.jpg')
  assert.equal(enriched[0].lyrics, '[00:00.00]Moon River')
  assert.equal(enriched[0].translatedLyrics, '[00:00.00]月亮河')
  assert.deepEqual(enriched[0].metadataMatch, {
    providerId: 'ncm',
    trackId: 'ncm:123',
    confidence: 'high',
    score: 96
  })
  assert.equal(enriched[0].streamUrl, undefined)
})

test('enrichLocalTracksFromProviders keeps local playback working when provider search fails', async () => {
  const enriched = await enrichLocalTracksFromProviders([localTrack], {
    searchSongs: async () => {
      throw new Error('provider unavailable')
    }
  })

  assert.deepEqual(enriched, [localTrack])
})

test('enrichLocalTracksFromProviders respects disabled provider metadata cache policy', async () => {
  const enriched = await enrichLocalTracksFromProviders(
    [localTrack],
    {
      searchSongs: async () => ({
        items: [{
          id: 'ncm:123',
          title: 'Moon River',
          artist: 'Audrey',
          album: 'Online Album',
          filePath: 'ncm:123',
          fileName: 'Moon River',
          duration: 179,
          size: 0,
          cover: 'https://cover.example/album.jpg',
          lyrics: '[00:00.00]Moon River',
          translatedLyrics: '[00:00.00]月亮河',
          source: 'ncm' as const
        }],
        total: 1
      })
    },
    {
      cachePolicy: {
        cover: false,
        lyrics: false,
        metadata: false
      }
    }
  )

  assert.deepEqual(enriched, [localTrack])
})

test('enrichLocalTracksFromProviders can cache cover without lyrics or album metadata', async () => {
  const enriched = await enrichLocalTracksFromProviders(
    [localTrack],
    {
      searchSongs: async () => ({
        items: [{
          id: 'ncm:123',
          title: 'Moon River',
          artist: 'Audrey',
          album: 'Online Album',
          filePath: 'ncm:123',
          fileName: 'Moon River',
          duration: 179,
          size: 0,
          cover: 'https://cover.example/album.jpg',
          lyrics: '[00:00.00]Moon River',
          translatedLyrics: '[00:00.00]月亮河',
          source: 'ncm' as const
        }],
        total: 1
      })
    },
    {
      cachePolicy: {
        cover: true,
        lyrics: false,
        metadata: false
      }
    }
  )

  assert.equal(enriched[0].album, '')
  assert.equal(enriched[0].cover, 'https://cover.example/album.jpg')
  assert.equal(enriched[0].lyrics, null)
  assert.equal(enriched[0].translatedLyrics, undefined)
})

test('enrichLocalTracksFromProviders skips local tracks that already have enrichment metadata', async () => {
  let calls = 0
  const enrichedTrack = {
    ...localTrack,
    album: 'Local Album',
    cover: 'cover://embedded',
    lyrics: '[00:00.00]local',
    translatedLyrics: '[00:00.00]local translated'
  }

  const enriched = await enrichLocalTracksFromProviders([enrichedTrack], {
    searchSongs: async () => {
      calls++
      return { items: [], total: 0 }
    }
  })

  assert.equal(calls, 0)
  assert.deepEqual(enriched, [enrichedTrack])
})
