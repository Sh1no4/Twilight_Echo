import { onBeforeUnmount, watch, type Ref } from 'vue'
import type { MiniPlayerCommand, MiniPlayerStateSnapshot } from '../../../shared/miniPlayer'
import type { Track } from '../types/music'
import type { PlayMode } from '../types/settings'

interface MiniPlayerStateSource {
  track: Track | null
  isPlaying: boolean
  isLoading: boolean
  currentTime: number
  duration: number
  volume: number
  playMode: PlayMode
  favoriteAvailable: boolean
  favoriteLiked: boolean
  favoriteLoading: boolean
  dominantColor: string
  queueIndex: number
  queueLength: number
}

interface MiniPlayerSyncOptions {
  currentTrack: Ref<Track | null>
  isPlaying: Ref<boolean>
  isLoading: Ref<boolean>
  currentTime: Ref<number>
  duration: Ref<number>
  volume: Ref<number>
  playMode: Ref<PlayMode>
  favoriteAvailable: Ref<boolean>
  favoriteLiked: Ref<boolean>
  favoriteLoading: Ref<boolean>
  dominantColor: Ref<string>
  queueIndex: Ref<number>
  queue: Ref<Track[]>
  togglePlay: () => Promise<void>
  next: () => void
  prev: () => void
  seek: (time: number) => void
  setVolume: (volume: number) => void
  cyclePlayMode: () => void
  setPlayMode: (mode: PlayMode) => void
  toggleFavorite: () => Promise<void>
}

export function buildMiniPlayerStateSnapshot(
  source: MiniPlayerStateSource
): MiniPlayerStateSnapshot {
  const track = source.track
  return {
    track: track
      ? {
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          cover: track.cover,
          coverSource: track.coverSource ?? null
        }
      : null,
    isPlaying: source.isPlaying,
    isLoading: source.isLoading,
    currentTime: source.currentTime,
    duration: source.duration,
    volume: source.volume,
    playMode: source.playMode,
    favoriteAvailable: source.favoriteAvailable,
    favoriteLiked: source.favoriteLiked,
    favoriteLoading: source.favoriteLoading,
    dominantColor: source.dominantColor,
    queueIndex: source.queueIndex,
    queueLength: source.queueLength
  }
}

export function useMiniPlayerSync(options: MiniPlayerSyncOptions): void {
  function publishState(): void {
    window.api.miniPlayer.publishState(
      buildMiniPlayerStateSnapshot({
        track: options.currentTrack.value,
        isPlaying: options.isPlaying.value,
        isLoading: options.isLoading.value,
        currentTime: options.currentTime.value,
        duration: options.duration.value,
        volume: options.volume.value,
        playMode: options.playMode.value,
        favoriteAvailable: options.favoriteAvailable.value,
        favoriteLiked: options.favoriteLiked.value,
        favoriteLoading: options.favoriteLoading.value,
        dominantColor: options.dominantColor.value,
        queueIndex: options.queueIndex.value,
        queueLength: options.queue.value.length
      })
    )
  }

  function runCommand(command: MiniPlayerCommand): void {
    switch (command.type) {
      case 'toggle-play':
        void options.togglePlay().catch((error) => {
          console.error('[mini-player] Failed to toggle playback:', error)
        })
        break
      case 'previous':
        options.prev()
        break
      case 'next':
        options.next()
        break
      case 'seek':
        options.seek(command.value)
        break
      case 'set-volume':
        options.setVolume(command.value)
        break
      case 'cycle-play-mode':
        options.cyclePlayMode()
        break
      case 'set-play-mode':
        options.setPlayMode(command.value)
        break
      case 'toggle-favorite':
        void options.toggleFavorite().catch((error) => {
          console.error('[tray] Failed to toggle favorite:', error)
        })
        break
    }
  }

  const stopStateWatch = watch(
    [
      () => options.currentTrack.value?.id,
      () => options.currentTrack.value?.title,
      () => options.currentTrack.value?.artist,
      () => options.currentTrack.value?.album,
      () => options.currentTrack.value?.cover,
      () => options.currentTrack.value?.coverSource,
      options.isPlaying,
      options.isLoading,
      options.currentTime,
      options.duration,
      options.volume,
      options.playMode,
      options.favoriteAvailable,
      options.favoriteLiked,
      options.favoriteLoading,
      options.dominantColor,
      options.queueIndex,
      () => options.queue.value.length
    ],
    publishState,
    { immediate: true }
  )
  const removeCommandListener = window.api.miniPlayer.onCommand(runCommand)

  onBeforeUnmount(() => {
    stopStateWatch()
    removeCommandListener()
  })
}
