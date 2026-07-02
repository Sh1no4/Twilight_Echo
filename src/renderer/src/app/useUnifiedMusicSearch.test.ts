import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../types/music'

const { createUnifiedMusicSearch } = (await import(
  new URL('./useUnifiedMusicSearch.ts', import.meta.url).href
)) as typeof import('./useUnifiedMusicSearch')

const localTrack: Track = {
  id: 'local:1',
  title: 'Moon River',
  artist: 'Audrey',
  album: 'Album',
  filePath: 'D:\\Music\\Moon River.flac',
  fileName: 'Moon River.flac',
  duration: 181,
  size: 1,
  cover: null,
  lyrics: null,
  source: 'local',
  format: 'flac'
}

test('unified music search composable exposes unified items and provider health', async () => {
  const search = createUnifiedMusicSearch({
    getLocalTracks: () => [localTrack],
    searchAllSongs: async ({ localTracks }) => ({
      items: localTracks.map((track) => ({
        kind: 'track' as const,
        track,
        source: 'local',
        sourceName: '本地音乐',
        local: true,
        lossless: true,
        providerAvailable: true
      })),
      logicalItems: [
        {
          id: 'moon river::audrey',
          title: 'Moon River',
          artist: 'Audrey',
          album: 'Album',
          preferredTrack: localTrack,
          variants: [{ track: localTrack, source: 'local', local: true, lossless: true }]
        }
      ],
      health: {
        ncm: {
          providerId: 'ncm',
          providerName: 'NetEase',
          available: false,
          searchable: true,
          resultCount: 0,
          lastError: 'login expired'
        }
      }
    })
  })

  await search.search('moon')

  assert.equal(search.loading.value, false)
  assert.equal(search.error.value, '')
  assert.deepEqual(search.items.value.map((item) => item.track.id), ['local:1'])
  assert.equal(search.logicalItems.value[0].preferredTrack.id, 'local:1')
  assert.equal(search.providerHealth.value.ncm.available, false)
  assert.equal(search.providerHealth.value.ncm.lastError, 'login expired')
})

test('unified music search clears state for blank queries', async () => {
  let called = false
  const search = createUnifiedMusicSearch({
    getLocalTracks: () => [localTrack],
    searchAllSongs: async () => {
      called = true
      return { items: [], logicalItems: [], health: {} }
    }
  })

  await search.search('   ')

  assert.equal(called, false)
  assert.equal(search.loading.value, false)
  assert.equal(search.items.value.length, 0)
  assert.equal(search.logicalItems.value.length, 0)
  assert.deepEqual(search.providerHealth.value, {})
})
