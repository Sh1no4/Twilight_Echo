import assert from 'node:assert/strict'
import test from 'node:test'

const { useStreamingSearch } = (await import(
  new URL('./useStreamingSearch.ts', import.meta.url).href
)) as typeof import('./useStreamingSearch')

const localTrack = {
  id: 'local:moon',
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

const providerTrack = {
  id: 'ncm:moon',
  title: 'Moon River',
  artist: 'Audrey',
  album: 'Online Album',
  filePath: 'ncm:moon',
  fileName: 'Moon River',
  duration: 180,
  size: 0,
  cover: null,
  lyrics: null,
  source: 'ncm'
}

test('song search uses unified local and provider results when available', async () => {
  let legacySearchCalls = 0
  let unifiedSearchQuery = ''
  const search = useStreamingSearch({
    searchSongs: async () => {
      legacySearchCalls++
      return { tracks: [providerTrack], total: 1 }
    },
    searchUnifiedSongs: async (keywords) => {
      unifiedSearchQuery = keywords
      return { tracks: [localTrack, providerTrack], total: 2 }
    },
    searchPlaylists: async () => ({ playlists: [], total: 0 }),
    searchArtists: async () => ({ artists: [], total: 0 }),
    playTrack: () => {}
  })
  search.searchQuery.value = 'Moon River'

  await search.performSearch('Moon River')

  assert.equal(unifiedSearchQuery, 'Moon River')
  assert.equal(legacySearchCalls, 0)
  assert.deepEqual(
    search.searchResults.value.map((track) => track.id),
    ['local:moon', 'ncm:moon']
  )
  assert.equal(search.searchTotal.value, 2)
})

test('song result click plays the visible unified result queue', async () => {
  let playedTrackId = ''
  let queueIds: string[] = []
  const search = useStreamingSearch({
    searchSongs: async () => ({ tracks: [], total: 0 }),
    searchUnifiedSongs: async () => ({ tracks: [localTrack, providerTrack], total: 2 }),
    searchPlaylists: async () => ({ playlists: [], total: 0 }),
    searchArtists: async () => ({ artists: [], total: 0 }),
    playTrack: (track, queue) => {
      playedTrackId = track.id
      queueIds = queue?.map((item) => item.id) ?? []
    }
  })
  search.searchQuery.value = 'Moon River'
  await search.performSearch('Moon River')

  search.onSearchTrackClick(providerTrack)

  assert.equal(playedTrackId, 'ncm:moon')
  assert.deepEqual(queueIds, ['local:moon', 'ncm:moon'])
})
