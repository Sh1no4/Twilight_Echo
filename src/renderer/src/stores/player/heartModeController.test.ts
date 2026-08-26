import assert from 'node:assert/strict'
import test from 'node:test'
import { ref, type Ref } from 'vue'
import type { Track } from '../../types/music'
import type { PlayMode } from '../../types/settings'
import { createHeartModeController } from './heartModeController.ts'

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'ncm:1',
    title: 'Test track',
    artist: 'Test artist',
    album: 'Test album',
    filePath: 'test.flac',
    fileName: 'test.flac',
    duration: 600,
    size: 1,
    cover: null,
    lyrics: null,
    ncmSongId: 1,
    ...overrides
  }
}

interface Harness {
  controller: ReturnType<typeof createHeartModeController>
  queue: Ref<Track[]>
  queueIndex: Ref<number>
  currentTrack: Ref<Track | null>
  playMode: Ref<PlayMode>
  isPlaying: Ref<boolean>
  isLoading: Ref<boolean>
  rendererPlayModeBoundaryPending: Ref<boolean>
  replacements: Array<{ tracks: Track[]; index: number; persist: boolean }>
  appends: Track[][]
  playedTracks: Track[]
  autoAdvanceResets: number
  advanceFallbacks: number
  recommendations: Track[]
  fetchRequests: Array<{ songId: number; playlistId: number; count?: number }>
}

function createHarness(): Harness {
  const queue = ref<Track[]>([])
  const queueIndex = ref(-1)
  const currentTrack = ref<Track | null>(null)
  const playMode = ref<PlayMode>('sequential')
  const isPlaying = ref(false)
  const isLoading = ref(false)
  const rendererPlayModeBoundaryPending = ref(false)
  const replacements: Harness['replacements'] = []
  const appends: Track[][] = []
  const playedTracks: Track[] = []
  const fetchRequests: Harness['fetchRequests'] = []
  let autoAdvanceResets = 0
  let advanceFallbacks = 0
  const recommendations: Track[] = []

  const controller = createHeartModeController({
    queue,
    queueIndex,
    currentTrack,
    playMode,
    isPlaying,
    isLoading,
    rendererPlayModeBoundaryPending,
    fetchIntelligenceList: async (request) => {
      fetchRequests.push(request)
      return recommendations
    },
    playQueueTrack: (track) => {
      playedTracks.push(track)
    },
    advanceAfterPlaybackEnded: async () => {
      advanceFallbacks += 1
    },
    setAutoAdvanceInFlight: () => {
      autoAdvanceResets += 1
    },
    replaceQueue: (tracks, index, options) => {
      replacements.push({ tracks, index, persist: options.persist })
      queue.value = [...tracks]
      queueIndex.value = index
    },
    appendQueueAdditions: (additions) => {
      appends.push(additions)
      queue.value = [...queue.value, ...additions]
    }
  })

  return {
    controller,
    queue,
    queueIndex,
    currentTrack,
    playMode,
    isPlaying,
    isLoading,
    rendererPlayModeBoundaryPending,
    replacements,
    appends,
    playedTracks,
    get autoAdvanceResets() {
      return autoAdvanceResets
    },
    get advanceFallbacks() {
      return advanceFallbacks
    },
    recommendations,
    fetchRequests
  }
}

function seedLikedNcmSession(harness: Harness): Track {
  const seed = makeTrack({ id: 'ncm:10', ncmSongId: 10 })
  harness.controller.setHeartModeContext(123)
  harness.queue.value = [seed, makeTrack({ id: 'ncm:11', ncmSongId: 11 })]
  harness.currentTrack.value = seed
  harness.queueIndex.value = 0
  return seed
}

test('heartModeAvailable requires liked playlist context, queue, and an NCM track', () => {
  const harness = createHarness()
  const seed = makeTrack({ id: 'ncm:10', ncmSongId: 10 })
  harness.queue.value = [seed]
  harness.currentTrack.value = seed
  assert.equal(harness.controller.heartModeAvailable.value, false)
  harness.controller.setHeartModeContext(123)
  assert.equal(harness.controller.heartModeAvailable.value, true)
  harness.currentTrack.value = makeTrack({ id: 'local:a', ncmSongId: undefined })
  assert.equal(harness.controller.heartModeAvailable.value, false)
})

test('setHeartModeContext normalizes invalid playlist ids to null', () => {
  const harness = createHarness()
  harness.controller.setHeartModeContext(0)
  assert.equal(harness.controller.heartModeContext.value.likedPlaylistId, null)
  harness.controller.setHeartModeContext(Number.NaN)
  assert.equal(harness.controller.heartModeContext.value.likedPlaylistId, null)
  harness.controller.setHeartModeContext(42)
  assert.equal(harness.controller.heartModeContext.value.likedPlaylistId, 42)
})

test('enterHeartMode replaces the queue with the seed and appends recommendations', async () => {
  const harness = createHarness()
  const seed = seedLikedNcmSession(harness)
  harness.recommendations.push(
    makeTrack({ id: 'ncm:20', ncmSongId: 20 }),
    makeTrack({ id: 'ncm:10', ncmSongId: 10 })
  )

  harness.controller.enterHeartMode()
  // 等待 enterHeartMode 内部的 refill 完成
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(harness.playMode.value, 'heart')
  assert.equal(harness.rendererPlayModeBoundaryPending.value, false)
  assert.equal(harness.replacements.length, 1)
  assert.deepEqual(harness.replacements[0].tracks, [seed])
  assert.equal(harness.replacements[0].persist, true)
  assert.equal(harness.fetchRequests.length, 1)
  assert.equal(harness.fetchRequests[0].playlistId, 123)
  // 与队列已有曲目重复的推荐被去重
  assert.equal(harness.appends.length, 1)
  assert.deepEqual(
    harness.appends[0].map((track) => track.id),
    ['ncm:20']
  )
})

test('enterHeartMode exits to sequential when the smart list returns nothing', async () => {
  const harness = createHarness()
  seedLikedNcmSession(harness)
  const baseQueue = [...harness.queue.value]

  harness.controller.enterHeartMode()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(harness.playMode.value, 'sequential')
  const restore = harness.replacements.at(-1)
  assert.ok(restore)
  assert.equal(restore.persist, false)
  assert.deepEqual(restore.tracks, baseQueue)
  assert.equal(restore.index, 0)
})

test('exitHeartModeForManualQueueReplacement switches mode without restoring the queue', () => {
  const harness = createHarness()
  seedLikedNcmSession(harness)
  harness.controller.enterHeartMode()
  const replacementsBefore = harness.replacements.length

  harness.controller.exitHeartModeForManualQueueReplacement()

  assert.equal(harness.playMode.value, 'sequential')
  assert.equal(harness.rendererPlayModeBoundaryPending.value, false)
  assert.equal(harness.replacements.length, replacementsBefore)
})

test('advanceHeartPlayback plays the next queue entry and refills near the tail', async () => {
  const harness = createHarness()
  seedLikedNcmSession(harness)
  harness.recommendations.push(makeTrack({ id: 'ncm:20', ncmSongId: 20 }))
  harness.controller.enterHeartMode()
  await new Promise((resolve) => setTimeout(resolve, 0))
  harness.playedTracks.length = 0
  harness.fetchRequests.length = 0
  harness.recommendations.push(makeTrack({ id: 'ncm:30', ncmSongId: 30 }))
  // 队列只剩当前曲目 + 一条推荐，推进即达到补货阈值
  harness.queueIndex.value = 0

  await harness.controller.advanceHeartPlayback()

  assert.equal(harness.queueIndex.value, 1)
  assert.equal(harness.playedTracks.length, 1)
  assert.equal(harness.playedTracks[0].id, 'ncm:20')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(harness.fetchRequests.length, 1)
})

test('advanceHeartPlayback stops at the queue end when the refill adds nothing', async () => {
  const harness = createHarness()
  seedLikedNcmSession(harness)
  harness.recommendations.push(makeTrack({ id: 'ncm:20', ncmSongId: 20 }))
  harness.controller.enterHeartMode()
  await new Promise((resolve) => setTimeout(resolve, 0))
  harness.isPlaying.value = true
  harness.isLoading.value = true
  harness.queueIndex.value = harness.queue.value.length - 1

  await harness.controller.advanceHeartPlayback()

  assert.equal(harness.isPlaying.value, false)
  assert.equal(harness.isLoading.value, false)
  assert.equal(harness.autoAdvanceResets, 1)
  assert.equal(harness.advanceFallbacks, 0)
})

test('advanceHeartPlayback falls back to the generic advance when heart mode ended', async () => {
  const harness = createHarness()
  seedLikedNcmSession(harness)
  harness.recommendations.push(makeTrack({ id: 'ncm:20', ncmSongId: 20 }))
  harness.controller.enterHeartMode()
  await new Promise((resolve) => setTimeout(resolve, 0))
  harness.queueIndex.value = harness.queue.value.length - 1
  harness.playMode.value = 'listLoop'

  await harness.controller.advanceHeartPlayback()

  assert.equal(harness.advanceFallbacks, 1)
  assert.equal(harness.isPlaying.value, false)
})
