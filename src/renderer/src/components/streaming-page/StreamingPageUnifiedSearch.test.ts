import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { LocalLibraryRemoveResult } from '../../../../shared/localLibrary.ts'
import type { Track } from '../../types/music.ts'

const source = readFileSync(new URL('../StreamingPage.vue', import.meta.url), 'utf8')
const { executeStreamingBatchRemoval, removeStreamingProviderFavorite } = (await import(
  new URL('./streamingBatchRemoval.ts', import.meta.url).href
)) as typeof import('./streamingBatchRemoval.ts')
const { MediaProviderRegistry } = (await import(
  new URL('../../providers/mediaProvider.ts', import.meta.url).href
)) as typeof import('../../providers/mediaProvider.ts')

test('streaming page exposes unified song search beyond the NetEase-only surface', () => {
  assert.match(source, /useMediaProviders\(\)/)
  assert.match(source, /mediaProviders\.searchAllSongs\(\{/)
  assert.match(source, /localTracks: musicStore\.tracks\.value/)
  assert.match(source, /searchUnifiedSongs/)
  assert.match(source, /const showUnifiedSearch = computed/)
  assert.doesNotMatch(source, /const showNcmSearch = computed/)
})

test('streaming page keeps third-party providers on the generic provider library surface', () => {
  assert.doesNotMatch(source, /import BilibiliPage/)
  assert.doesNotMatch(source, /<BilibiliPage/)
  assert.doesNotMatch(source, /showBilibiliView/)
  assert.doesNotMatch(source, /shouldShowBilibiliViewForSidebarProvider/)
  assert.doesNotMatch(source, /activeProvider\.value === 'bili'/)
  assert.doesNotMatch(source, /bilibili\.setPinnedFavoriteFolder/)
})

test('recent playback detail uses local unified listening history before provider recent APIs', () => {
  assert.match(source, /getRecentTracks\(\)/)
  assert.match(source, /resolveUnifiedRecentTracks\(\{/)
  assert.match(source, /recentStats/)
  assert.match(source, /localTracks: musicStore\.tracks\.value/)
  assert.doesNotMatch(source, /const tracks = await fetchRecentSongs\(\)/)
})

test('ranking detail uses cross-source listening stats before provider play records', () => {
  assert.match(source, /getTopTracks\(\)/)
  assert.match(source, /topStats/)
  assert.match(source, /resolveUnifiedRecentTracks\(\{/)
  assert.doesNotMatch(source, /const tracks = await fetchPlayRecords\(1\)/)
})

test('liked detail uses unified default favorites before provider liked APIs', () => {
  assert.match(source, /summarizeUnifiedFavorites\(\{/)
  assert.match(source, /resolveUnifiedFavoriteTracks\(\{/)
  assert.match(
    source,
    /const unifiedFavoriteTracks = computed\(\(\) => musicStore\.getPlaylistTracks\('我收藏的音乐'\)\)/
  )
  assert.match(source, /if \(unifiedTracks\.length > 0\)/)
})

test('streaming page supports multi-select batch favorite and delete on track lists', () => {
  const searchSource = readFileSync(new URL('../StreamingSearch.vue', import.meta.url), 'utf8')
  const detailSource = readFileSync(
    new URL('./StreamingDetailStage.vue', import.meta.url),
    'utf8'
  )

  assert.match(source, /useTrackMultiSelect/)
  assert.match(source, /handleStreamingBatchFavorite/)
  assert.match(source, /handleStreamingBatchDelete/)
  assert.match(source, /handleStreamingBatchAddToPlaylist/)
  assert.match(source, /createNcmPlaylist/)
  assert.match(source, /removeNcmTracksFromPlaylist/)
  assert.match(source, /onStreamingTrackContextMenu/)
  assert.match(source, /streaming-context-menu/)
  assert.match(source, /添加到歌单/)
  assert.match(source, /onSearchTrackClickWithSelect/)
  assert.match(searchSource, /batchFavorite/)
  assert.match(searchSource, /batchAddToPlaylist/)
  assert.match(searchSource, /trackContextMenu/)
  assert.match(searchSource, /track-selected/)
  assert.match(searchSource, /selection-toolbar/)
  assert.match(detailSource, /batchAddToPlaylist/)
  assert.match(detailSource, /trackContextMenu/)
  assert.match(detailSource, /从歌单移除/)
  assert.match(source, /executeStreamingBatchRemoval\(selected/)
  assert.doesNotMatch(source, /musicStore\.removeTrack\(track\.id\)/)
})

test('local-only streaming deletion uses one library removal transaction', async () => {
  const tracks = [createTrack('local:first', 'local'), createTrack('local:second', 'local')]
  const calls: Array<{ ids: string[]; mode: string }> = []
  const result = await executeStreamingBatchRemoval(tracks, {
    removeLocalTracks: async (selected, mode) => {
      calls.push({ ids: selected.map((track) => track.id), mode })
      return createLocalResult(selected, selected.map((track) => track.id))
    },
    removeProviderTrack: async () => {
      throw new Error('provider removal must not run for local tracks')
    }
  })

  assert.deepEqual(calls, [{ ids: ['local:first', 'local:second'], mode: 'library' }])
  assert.deepEqual(result.removedTrackIds, ['local:first', 'local:second'])
  assert.deepEqual(result.failures, [])
})

test('mixed streaming deletion batches locals and keeps provider semantics separate', async () => {
  const local = createTrack('local:first', 'local')
  const failedLocal = createTrack('local:failed', 'local')
  const provider = createTrack('ncm:42', 'ncm')
  const localCalls: string[][] = []
  const providerCalls: string[] = []

  const result = await executeStreamingBatchRemoval([local, provider, failedLocal], {
    removeLocalTracks: async (selected) => {
      localCalls.push(selected.map((track) => track.id))
      const response = createLocalResult(selected, [local.id])
      response.failures.push({ filePath: failedLocal.filePath, message: 'local failed' })
      return response
    },
    removeProviderTrack: async (track) => {
      providerCalls.push(track.id)
    }
  })

  assert.deepEqual(localCalls, [['local:first', 'local:failed']])
  assert.deepEqual(providerCalls, ['ncm:42'])
  assert.deepEqual(result.removedTrackIds, ['local:first', 'ncm:42'])
  assert.deepEqual(result.failures, [
    { filePath: failedLocal.filePath, message: 'local failed' }
  ])
})

test('external provider unfavorite still runs when the local removal phase rejects', async () => {
  const local = createTrack('local:first', 'local')
  const external = createTrack('bili:BV1xx', 'bili')
  const providerCalls: Array<{ id: string | number; like: boolean }> = []
  const registry = new MediaProviderRegistry()
  registry.register({
    id: 'bili',
    name: 'Bilibili',
    source: 'plugin',
    capabilities: ['library'],
    likeTrack: async (id, like) => {
      providerCalls.push({ id, like })
    }
  })
  const removedSnapshots: string[] = []

  const result = await executeStreamingBatchRemoval([local, external], {
    removeLocalTracks: async () => {
      throw new Error('local transaction failed')
    },
    removeProviderTrack: (track) =>
      removeStreamingProviderFavorite(track, {
        providers: registry,
        removeNcmFavorite: async () => {
          throw new Error('unexpected NCM fallback')
        },
        removeSnapshotFavorite: (removed) => removedSnapshots.push(removed.id)
      })
  })

  assert.deepEqual(providerCalls, [{ id: 'BV1xx', like: false }])
  assert.deepEqual(removedSnapshots, ['bili:BV1xx'])
  assert.deepEqual(result.removedTrackIds, ['bili:BV1xx'])
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].filePath, local.filePath)
})

test('local dashboard top tracks resolve logical stats to playable local variants', () => {
  const dashboardSource = readFileSync(new URL('../LocalDashboard.vue', import.meta.url), 'utf8')

  assert.match(
    dashboardSource,
    /import \{ createUnifiedRecentTrackResolver \} from '\.\.\/utils\/unifiedRecentTracks'/
  )
  assert.match(dashboardSource, /getMostListenedTracks\(TOP_TRACK_COUNT\)/)
  assert.match(dashboardSource, /createUnifiedRecentTrackResolver\(tracks\.value\)/)
  assert.doesNotMatch(dashboardSource, /recentStats: \[stat\]/)
  assert.doesNotMatch(dashboardSource, /Object\.entries\(listeningStats\.value\.tracks\)/)
  assert.doesNotMatch(dashboardSource, /track: byId\.get\(id\) \?\? stat\.track/)
})

function createTrack(id: string, source: string): Track {
  return {
    id,
    title: id,
    artist: 'Test Artist',
    album: 'Test Album',
    filePath: `C:\\Music\\${id.replace(':', '-')}.flac`,
    fileName: `${id}.flac`,
    duration: 120,
    size: 1,
    cover: null,
    lyrics: null,
    source
  }
}

function createLocalResult(tracks: Track[], removedTrackIds: string[]): LocalLibraryRemoveResult {
  const removed = new Set(removedTrackIds)
  const removedTracks = tracks.filter((track) => removed.has(track.id))
  return {
    mode: 'library',
    library: {
      version: 2,
      revision: 1,
      tracks: tracks.filter((track) => !removed.has(track.id)),
      folders: [],
      exclusions: removedTracks.map((track) => ({
        filePath: track.filePath,
        title: track.title,
        artist: track.artist,
        excludedAt: '2026-01-01T00:00:00.000Z'
      }))
    },
    removedTrackIds,
    removedFilePaths: removedTracks.map((track) => track.filePath),
    failures: []
  }
}
