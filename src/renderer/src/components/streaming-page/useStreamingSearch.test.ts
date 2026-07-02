import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'

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

const defaultSources = ref([
  { id: 'all' as const, label: '全部', available: true, supportedTypes: ['songs', 'playlists', 'artists'] as const },
  { id: 'local' as const, label: '本地音乐', available: true, supportedTypes: ['songs'] as const },
  { id: 'ncm', label: '网易云', available: true, supportedTypes: ['songs', 'playlists', 'artists'] as const }
])

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
    searchSources: defaultSources,
    playTrack: () => {}
  })
  search.searchSource.value = 'all'
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
    searchSources: defaultSources,
    playTrack: (track, queue) => {
      playedTrackId = track.id
      queueIds = queue?.map((item) => item.id) ?? []
    }
  })
  search.searchSource.value = 'all'
  search.searchQuery.value = 'Moon River'
  await search.performSearch('Moon River')

  search.onSearchTrackClick(providerTrack)

  assert.equal(playedTrackId, 'ncm:moon')
  assert.deepEqual(queueIds, ['local:moon', 'ncm:moon'])
})

test('switching source routes to per-provider search', async () => {
  let providerSearchCalls = 0
  let providerSearchId = ''
  const search = useStreamingSearch({
    searchSongs: async () => ({ tracks: [providerTrack], total: 1 }),
    searchPlaylists: async () => ({ playlists: [], total: 0 }),
    searchArtists: async () => ({ artists: [], total: 0 }),
    searchProviderSongs: async (providerId, keywords) => {
      providerSearchCalls++
      providerSearchId = providerId
      assert.equal(keywords, 'Moon River')
      return { tracks: [providerTrack], total: 1 }
    },
    searchSources: defaultSources,
    playTrack: () => {}
  })
  search.searchSource.value = 'ncm'
  search.searchQuery.value = 'Moon River'

  await search.performSearch('Moon River')

  assert.equal(providerSearchCalls, 1)
  assert.equal(providerSearchId, 'ncm')
  assert.deepEqual(
    search.searchResults.value.map((track) => track.id),
    ['ncm:moon']
  )
})

test('availableSearchTypes reflects the selected source capabilities', async () => {
  const search = useStreamingSearch({
    searchSongs: async () => ({ tracks: [], total: 0 }),
    searchPlaylists: async () => ({ playlists: [], total: 0 }),
    searchArtists: async () => ({ artists: [], total: 0 }),
    searchSources: defaultSources,
    playTrack: () => {}
  })

  assert.deepEqual(search.availableSearchTypes.value, ['songs', 'playlists', 'artists'])

  search.searchSource.value = 'local'
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(search.availableSearchTypes.value, ['songs'])
  assert.equal(search.searchType.value, 'songs', 'searchType should auto-switch to songs for local')
})
