import assert from 'node:assert/strict'
import test from 'node:test'

;(globalThis as Record<string, unknown>).localStorage = {
  getItem: () => null,
  setItem: () => undefined
}

const {
  getRecentTracks,
  getTopArtists,
  getTopTracks,
  recordPlaybackOutcomeForTest,
  recordListeningForTest,
  recordPlaybackTransitionForTest,
  resetListeningStatsForTest
} = (await import(
  new URL('./useListeningStatsStore.ts', import.meta.url).href
)) as typeof import('./useListeningStatsStore')

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

const providerTrack = {
  id: 'ncm:123',
  title: ' moon  river ',
  artist: 'AUDREY',
  album: 'Online Album',
  filePath: 'ncm:123',
  fileName: 'Moon River',
  duration: 179,
  size: 0,
  cover: 'https://cover.example/album.jpg',
  lyrics: null,
  source: 'ncm'
}

test('listening stats aggregate same logical track across local and provider variants', () => {
  resetListeningStatsForTest()

  recordListeningForTest(localTrack, 5, 1_000)
  recordListeningForTest(providerTrack, 5, 2_000)

  const recent = getRecentTracks()
  assert.equal(recent.length, 1)
  assert.equal(recent[0].id, 'logic:moon river::audrey')
  assert.equal(recent[0].seconds, 10)
  assert.equal(recent[0].plays, 2)
  assert.equal(recent[0].lastPlayed, 2_000)
  assert.deepEqual(
    recent[0].sourceIds?.map((source) => source.trackId).sort(),
    ['local:abc', 'ncm:123']
  )
  assert.equal(recent[0].track?.id, 'ncm:123')
})

test('listening stats rank logical tracks across sources by plays then listening time', () => {
  resetListeningStatsForTest()

  recordListeningForTest(localTrack, 10, 1_000)
  recordListeningForTest(providerTrack, 10, 2_000)
  recordListeningForTest(
    {
      ...providerTrack,
      id: 'ncm:456',
      title: 'Single Play',
      artist: 'Audrey'
    },
    60,
    3_000
  )

  const top = getTopTracks()

  assert.deepEqual(
    top.map((entry) => entry.id),
    ['logic:moon river::audrey', 'logic:single play::audrey']
  )
  assert.equal(top[0].plays, 2)
  assert.equal(top[0].seconds, 20)
  assert.deepEqual(
    top[0].sourceIds?.map((source) => source.trackId).sort(),
    ['local:abc', 'ncm:123']
  )
})

test('listening stats rank artists across local and provider variants', () => {
  resetListeningStatsForTest()

  recordListeningForTest(localTrack, 10, 1_000)
  recordListeningForTest(providerTrack, 15, 2_000)
  recordListeningForTest(
    {
      ...providerTrack,
      id: 'ncm:456',
      title: 'Other Song',
      artist: 'Other Artist'
    },
    30,
    3_000
  )

  const artists = getTopArtists()

  assert.deepEqual(
    artists.map((artist) => artist.name),
    ['AUDREY', 'Other Artist']
  )
  assert.equal(artists[0].plays, 2)
  assert.equal(artists[0].seconds, 25)
  assert.equal(artists[0].trackCount, 1)
  assert.deepEqual(artists[0].sourceIds.sort(), ['local:abc', 'ncm:123'])
})

test('listening stats aggregate skip and completion outcomes across sources', () => {
  resetListeningStatsForTest()

  recordPlaybackOutcomeForTest(localTrack, {
    position: 25,
    duration: 180,
    timestamp: 1_000
  })
  recordPlaybackOutcomeForTest(providerTrack, {
    position: 175,
    duration: 180,
    timestamp: 2_000
  })

  const recent = getRecentTracks()

  assert.equal(recent.length, 1)
  assert.equal(recent[0].id, 'logic:moon river::audrey')
  assert.equal(recent[0].skips, 1)
  assert.equal(recent[0].completions, 1)
  assert.deepEqual(
    recent[0].sourceIds?.map((source) => source.trackId).sort(),
    ['local:abc', 'ncm:123']
  )
})

test('listening stats record previous track outcome when playback switches tracks', () => {
  resetListeningStatsForTest()

  recordPlaybackTransitionForTest({
    previousTrack: localTrack,
    nextTrack: providerTrack,
    position: 30,
    duration: 180,
    timestamp: 1_000
  })
  recordPlaybackTransitionForTest({
    previousTrack: providerTrack,
    nextTrack: null,
    position: 179,
    duration: 180,
    timestamp: 2_000
  })

  const recent = getRecentTracks()

  assert.equal(recent.length, 1)
  assert.equal(recent[0].skips, 1)
  assert.equal(recent[0].completions, 1)
})
