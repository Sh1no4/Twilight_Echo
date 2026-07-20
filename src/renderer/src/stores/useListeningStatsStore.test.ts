import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
const persistedValues = new Map<string, string>()
let localStorageWriteCount = 0
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => persistedValues.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageWriteCount += 1
    persistedValues.set(key, value)
  }
}

const {
  getRecentTracks,
  getMostListenedTracks,
  getTopArtists,
  getTopTracks,
  compactListeningStatsForPersistence,
  flushListeningStatsForTest,
  LISTENING_STATS_MAX_TRACKS,
  recordPlaybackOutcomeForTest,
  recordListeningForTest,
  recordPlaybackTransitionForTest,
  resetListeningStatsForTest
} = (await import(
  new URL('./useListeningStatsStore.ts', import.meta.url).href
)) as typeof import('./useListeningStatsStore')

const source = readFileSync(new URL('./useListeningStatsStore.ts', import.meta.url), 'utf8')

test('listening stats tracking receives player refs without dynamically importing player store', () => {
  assert.match(
    source,
    /export function setupListeningStatsTracking\(player: ListeningPlayerState\)/
  )
  assert.match(source, /const listeningStats = shallowRef<ListeningStats>/)
  assert.match(
    source,
    /function commitListeningStats\(mutator: \(stats: ListeningStats\) => void\)/
  )
  assert.match(source, /triggerRef\(listeningStats\)/)
  assert.match(source, /const \{ currentTrack, isPlaying, currentTime, duration \} = player/)
  assert.match(source, /function collectTopItems<T>\(/)
  assert.match(source, /getRecentTracks[\s\S]*collectTopItems\(/)
  assert.match(source, /getTopTracks[\s\S]*collectTopItems\(/)
  assert.match(source, /getMostListenedTracks[\s\S]*collectTopItems\(/)
  assert.doesNotMatch(source, /import\('\.\/usePlayerStore\.ts'\)/)
  assert.doesNotMatch(source, /days: \{ \.\.\.listeningStats\.value\.days \}/)
  assert.doesNotMatch(source, /tracks: \{ \.\.\.listeningStats\.value\.tracks \}/)
  assert.doesNotMatch(source, /Object\.entries\(listeningStats\.value\.tracks\)[\s\S]*?\.sort/)
})

test('5-second listening ticks mutate memory first and batch one persisted snapshot', () => {
  resetListeningStatsForTest()
  persistedValues.clear()
  localStorageWriteCount = 0

  for (let index = 0; index < 12; index++) {
    recordListeningForTest(localTrack, 5, 1_000 + index)
  }

  assert.equal(localStorageWriteCount, 0)
  assert.equal(flushListeningStatsForTest(), true)
  assert.equal(localStorageWriteCount, 1)
  const persisted = JSON.parse(persistedValues.get('twilight-echo:listening-stats:v1') ?? '{}')
  assert.equal(persisted.tracks['logic:moon river::audrey'].seconds, 60)
  assert.equal(persisted.tracks['logic:moon river::audrey'].plays, 1)
})

test('listening stats compaction retains the bounded recent history deterministically', () => {
  const stats = {
    days: {
      '2020-01-01': 5,
      '2026-07-16': 10
    },
    tracks: {} as Record<
      string,
      {
        seconds: number
        plays: number
        lastPlayed: number
        skips: number
        completions: number
        title: string
        artist: string
        cover: string | null
      }
    >
  }
  for (let index = 0; index <= LISTENING_STATS_MAX_TRACKS; index++) {
    stats.tracks[`track:${index}`] = {
      seconds: 0,
      plays: 0,
      lastPlayed: index,
      skips: 0,
      completions: 0,
      title: `Track ${index}`,
      artist: 'Artist',
      cover: null
    }
  }

  const changed = compactListeningStatsForPersistence(stats, Date.UTC(2026, 6, 17))

  assert.equal(changed, true)
  assert.deepEqual(stats.days, { '2026-07-16': 10 })
  assert.equal(Object.keys(stats.tracks).length, LISTENING_STATS_MAX_TRACKS)
  assert.equal(stats.tracks['track:0'], undefined)
  assert.equal(
    stats.tracks[`track:${LISTENING_STATS_MAX_TRACKS}`]?.lastPlayed,
    LISTENING_STATS_MAX_TRACKS
  )
})

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
  assert.deepEqual(recent[0].sourceIds?.map((source) => source.trackId).sort(), [
    'local:abc',
    'ncm:123'
  ])
  assert.equal(recent[0].track?.id, 'ncm:123')
})

test('listening stats include third-party provider tracks in cross-source history', () => {
  resetListeningStatsForTest()

  recordListeningForTest(
    {
      ...providerTrack,
      id: 'bili:BV1xx',
      filePath: 'bili:BV1xx',
      source: 'bili'
    },
    15,
    3_000
  )

  const recent = getRecentTracks()

  assert.equal(recent.length, 1)
  assert.equal(recent[0].id, 'logic:moon river::audrey')
  assert.equal(recent[0].seconds, 15)
  assert.deepEqual(recent[0].sourceIds, [{ source: 'bili', trackId: 'bili:BV1xx' }])
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
  assert.deepEqual(top[0].sourceIds?.map((source) => source.trackId).sort(), [
    'local:abc',
    'ncm:123'
  ])
})

test('listening stats selectors keep only the requested top results', () => {
  resetListeningStatsForTest()

  for (let index = 0; index < 250; index++) {
    recordListeningForTest(
      {
        ...localTrack,
        id: `local:${index}`,
        title: `Song ${index}`,
        filePath: `D:\\Music\\Song ${index}.flac`,
        fileName: `Song ${index}.flac`
      },
      index + 1,
      1_000 + index
    )
  }

  assert.deepEqual(
    getRecentTracks(3).map((entry) => entry.id),
    ['logic:song 249::audrey', 'logic:song 248::audrey', 'logic:song 247::audrey']
  )
  assert.deepEqual(
    getTopTracks(3).map((entry) => entry.id),
    ['logic:song 249::audrey', 'logic:song 248::audrey', 'logic:song 247::audrey']
  )
  assert.deepEqual(
    getMostListenedTracks(3).map((entry) => entry.id),
    ['logic:song 249::audrey', 'logic:song 248::audrey', 'logic:song 247::audrey']
  )
  assert.deepEqual(getRecentTracks(0), [])
  assert.deepEqual(getTopTracks(0), [])
  assert.deepEqual(getMostListenedTracks(0), [])
})

test('listening stats most-listened selector ranks by seconds before plays', () => {
  resetListeningStatsForTest()

  recordListeningForTest(
    {
      ...localTrack,
      id: 'local:many-plays',
      title: 'Many Plays'
    },
    10,
    1_000
  )
  recordListeningForTest(
    {
      ...localTrack,
      id: 'local:many-plays-live',
      title: 'Many Plays'
    },
    10,
    2_000
  )
  recordListeningForTest(
    {
      ...localTrack,
      id: 'local:long-listen',
      title: 'Long Listen'
    },
    60,
    3_000
  )

  assert.deepEqual(
    getTopTracks(2).map((entry) => entry.id),
    ['logic:many plays::audrey', 'logic:long listen::audrey']
  )
  assert.deepEqual(
    getMostListenedTracks(2).map((entry) => entry.id),
    ['logic:long listen::audrey', 'logic:many plays::audrey']
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
  assert.deepEqual(recent[0].sourceIds?.map((source) => source.trackId).sort(), [
    'local:abc',
    'ncm:123'
  ])
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
