import { computed, ref, type Ref } from 'vue'
import type { Track } from '../../types/music'
import type { PlayMode } from '../../types/settings'
import { getTrackSource } from '../../utils/playerTrackUtils.ts'
import {
  HEART_MODE_REFILL_COUNT,
  HEART_MODE_REFILL_THRESHOLD
} from '../../utils/playerConstants.ts'

export interface HeartRecommendationRequest {
  songId: number
  playlistId: number
  startSongId?: number
  count?: number
}

export interface HeartModeControllerOptions {
  queue: Ref<Track[]>
  queueIndex: Ref<number>
  currentTrack: Ref<Track | null>
  playMode: Ref<PlayMode>
  isPlaying: Ref<boolean>
  isLoading: Ref<boolean>
  rendererPlayModeBoundaryPending: Ref<boolean>
  fetchIntelligenceList: (options: HeartRecommendationRequest) => Promise<Track[]>
  playQueueTrack: (track: Track) => void
  advanceAfterPlaybackEnded: () => Promise<void>
  setAutoAdvanceInFlight: (value: boolean) => void
  /** Snapshot + replace queue/originalQueue, then persist and/or sync natively. */
  replaceQueue: (tracks: Track[], index: number, options: { persist: boolean }) => void
  /** Snapshot + append additions to queue/originalQueue, persist and sync natively. */
  appendQueueAdditions: (additions: Track[]) => void
}

/**
 * 心动模式（网易云“我喜欢的音乐”智能推荐播放）的会话状态机。队列替换/追加、
 * 原生同步与持久化由 store 通过回调完成，这里只维护推荐上下文、去重与推进策略。
 */
export function createHeartModeController(options: HeartModeControllerOptions) {
  const { queue, queueIndex, currentTrack, playMode, isPlaying, isLoading } = options

  const heartModeContext = ref<{ likedPlaylistId: number | null }>({ likedPlaylistId: null })
  let heartModeBaseQueue: Track[] = []
  let heartModeFetchRequest: Promise<number> | null = null
  let heartModeFetchGeneration = 0
  // 心动模式只能在本应用内“我喜欢的音乐”流媒体歌单上下文中启用：必须是在点击
  // 收藏歌单后建立的队列（heartModeContext），且当前曲目必须是网易云流媒体。
  const heartModeAvailable = computed(
    () =>
      heartModeContext.value.likedPlaylistId != null &&
      queue.value.length > 0 &&
      currentTrack.value != null &&
      getTrackSource(currentTrack.value) === 'ncm'
  )

  function setHeartModeContext(playlistId: number | null): void {
    const normalized =
      playlistId != null && Number.isFinite(Number(playlistId)) && Number(playlistId) > 0
        ? Number(playlistId)
        : null
    heartModeContext.value = { likedPlaylistId: normalized }
  }

  function fetchHeartRecommendations(seedTrack: Track | null): Promise<Track[]> {
    const playlistId = heartModeContext.value.likedPlaylistId
    if (playlistId == null || !seedTrack?.ncmSongId) return Promise.resolve([])
    return options.fetchIntelligenceList({
      songId: seedTrack.ncmSongId,
      playlistId,
      startSongId: seedTrack.ncmSongId,
      count: HEART_MODE_REFILL_COUNT
    })
  }

  function commitHeartQueue(nextQueue: Track[]): void {
    options.replaceQueue(nextQueue, 0, { persist: true })
  }

  function enterHeartMode(optionsArg: { persist?: boolean } = {}): void {
    void optionsArg
    const seed = currentTrack.value
    const likedPlaylistId = heartModeContext.value.likedPlaylistId
    if (likedPlaylistId == null || !seed?.ncmSongId) return
    heartModeBaseQueue = [...queue.value]
    heartModeFetchGeneration += 1
    const generation = heartModeFetchGeneration
    playMode.value = 'heart'
    options.rendererPlayModeBoundaryPending.value = false
    commitHeartQueue([seed])
    void refillHeartQueue(seed).then((added) => {
      if (generation !== heartModeFetchGeneration || playMode.value !== 'heart') return
      if (added === 0) {
        console.error('[心动模式] 启动未返回推荐')
        exitHeartModeToSequential()
      }
    })
  }

  function exitHeartModeToSequential(): void {
    if (playMode.value !== 'heart') return
    heartModeFetchGeneration += 1
    heartModeFetchRequest = null
    playMode.value = 'sequential'
    options.rendererPlayModeBoundaryPending.value = false
    if (heartModeBaseQueue.length > 0) {
      const currentId = currentTrack.value?.id
      let restoreIndex = currentId
        ? heartModeBaseQueue.findIndex((item) => item.id === currentId)
        : 0
      if (restoreIndex < 0) restoreIndex = 0
      options.replaceQueue(heartModeBaseQueue, restoreIndex, { persist: false })
    }
    heartModeBaseQueue = []
  }

  function exitHeartModeForManualQueueReplacement(): void {
    if (playMode.value !== 'heart') return
    heartModeFetchGeneration += 1
    heartModeFetchRequest = null
    playMode.value = 'sequential'
    options.rendererPlayModeBoundaryPending.value = false
    heartModeBaseQueue = []
  }

  async function refillHeartQueue(seedTrack: Track | null): Promise<number> {
    if (playMode.value !== 'heart') return 0
    if (heartModeFetchRequest) return heartModeFetchRequest
    const playlistId = heartModeContext.value.likedPlaylistId
    if (playlistId == null || !seedTrack?.ncmSongId) return 0
    const generation = heartModeFetchGeneration
    const request = (async () => {
      try {
        const recommended = await fetchHeartRecommendations(seedTrack)
        if (generation !== heartModeFetchGeneration || playMode.value !== 'heart') return 0
        const knownIds = new Set(queue.value.map((item) => item.id))
        const additions = recommended.filter((item) => item.id && !knownIds.has(item.id))
        if (additions.length === 0) return 0
        options.appendQueueAdditions(additions)
        if (queueIndex.value < 0) {
          queueIndex.value = 0
          const track = queue.value[0]
          if (track) options.playQueueTrack(track)
        }
        return additions.length
      } catch (error) {
        if (generation === heartModeFetchGeneration) {
          console.error('[心动模式] 获取智能播放列表失败:', error)
        }
        return 0
      } finally {
        if (generation === heartModeFetchGeneration) heartModeFetchRequest = null
      }
    })()
    heartModeFetchRequest = request
    return request
  }

  function advanceHeartPlayback(): Promise<void> {
    const nextIndex = queueIndex.value + 1
    if (nextIndex >= 0 && nextIndex < queue.value.length) {
      queueIndex.value = nextIndex
      const track = queue.value[nextIndex]
      if (track) {
        options.playQueueTrack(track)
        if (queueIndex.value >= queue.value.length - HEART_MODE_REFILL_THRESHOLD) {
          void refillHeartQueue(track)
        }
      }
      return Promise.resolve()
    }
    return refillHeartQueue(currentTrack.value).then(async () => {
      if (playMode.value !== 'heart') {
        await options.advanceAfterPlaybackEnded()
        return
      }
      const afterRefillIndex = queueIndex.value + 1
      if (afterRefillIndex >= 0 && afterRefillIndex < queue.value.length) {
        queueIndex.value = afterRefillIndex
        const track = queue.value[afterRefillIndex]
        if (track) {
          options.playQueueTrack(track)
          return
        }
      }
      isPlaying.value = false
      isLoading.value = false
      options.setAutoAdvanceInFlight(false)
    })
  }

  return {
    heartModeContext,
    heartModeAvailable,
    setHeartModeContext,
    enterHeartMode,
    exitHeartModeToSequential,
    exitHeartModeForManualQueueReplacement,
    advanceHeartPlayback
  }
}
