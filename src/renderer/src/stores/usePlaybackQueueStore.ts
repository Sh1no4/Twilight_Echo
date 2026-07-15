import { defineStore } from 'pinia'
import { usePlayerStore } from './usePlayerStore'

// Transitional domain store. Playback ownership remains in the compatibility
// facade until all consumers have moved to Pinia in a subsequent release.
export const usePlaybackQueueStore = defineStore('playback-queue', () => {
  const player = usePlayerStore()

  return {
    currentTrack: player.currentTrack,
    dominantColor: player.dominantColor,
    isPlaying: player.isPlaying,
    isLoading: player.isLoading,
    currentTime: player.currentTime,
    duration: player.duration,
    volume: player.volume,
    progress: player.progress,
    queue: player.queue,
    queueIndex: player.queueIndex,
    playMode: player.playMode,
    cyclePlayMode: player.cyclePlayMode,
    setPlayMode: player.setPlayMode,
    playTrack: player.playTrack,
    togglePlay: player.togglePlay,
    next: player.next,
    prev: player.prev,
    seek: player.seek,
    setVolume: player.setVolume,
    setUnityVolume: player.setUnityVolume,
    restorePlaybackSession: player.restorePlaybackSession,
    createPlaybackSession: player.createPlaybackSession,
    formatTime: player.formatTime
  }
})
