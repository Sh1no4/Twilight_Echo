import { watch, type Ref } from 'vue'
import type { PlaybackSession, Track } from '../types/music'
import type { PlaybackResumeMode } from '../types/settings'

interface PlaybackSessionSettings {
  playbackResumeMode: PlaybackResumeMode | Ref<PlaybackResumeMode>
}

interface PlaybackSessionDataApi {
  clearPlaybackSession: () => Promise<void>
  loadPlaybackSession: () => Promise<PlaybackSession | null>
  savePlaybackSession: (session: PlaybackSession | null) => Promise<void>
}

export interface PlaybackSessionPersistenceOptions {
  settings: Ref<PlaybackSessionSettings>
  currentTrack: Ref<Track | null>
  currentTime: Ref<number>
  isPlaying: Ref<boolean>
  restorePlaybackSession: (session: PlaybackSession) => void
  createPlaybackSession: (mode: PlaybackResumeMode) => PlaybackSession | null
  syncPluginProviders: () => Promise<void>
  dataApi: PlaybackSessionDataApi
  autosaveDelayMs?: number
  positionAutosaveMs?: number
}

const DEFAULT_PLAYBACK_SESSION_AUTOSAVE_DEBOUNCE_MS = 1200
const DEFAULT_PLAYBACK_SESSION_POSITION_AUTOSAVE_MS = 15000

export function createPlaybackSessionPersistence(options: PlaybackSessionPersistenceOptions) {
  const autosaveDelayMs =
    options.autosaveDelayMs ?? DEFAULT_PLAYBACK_SESSION_AUTOSAVE_DEBOUNCE_MS
  const positionAutosaveMs =
    options.positionAutosaveMs ?? DEFAULT_PLAYBACK_SESSION_POSITION_AUTOSAVE_MS
  let playbackSessionAutosaveTimer: ReturnType<typeof setTimeout> | null = null
  let lastPlaybackSessionPositionSaveAt = 0
  let playbackSessionWritesEnabled = false
  const stopHandles: Array<() => void> = []

  async function restoreSavedPlaybackSession(mode: PlaybackResumeMode): Promise<void> {
    playbackSessionWritesEnabled = false
    clearPlaybackSessionAutosave()

    if (mode === 'off') {
      await options.dataApi.clearPlaybackSession()
      playbackSessionWritesEnabled = true
      return
    }

    const session = await options.dataApi.loadPlaybackSession()
    if (!session?.track?.id) {
      playbackSessionWritesEnabled = true
      return
    }

    await options.syncPluginProviders()

    const restoredSession: PlaybackSession = {
      ...session,
      mode,
      position: mode === 'trackAndPosition' ? session.position : 0
    }
    options.restorePlaybackSession(restoredSession)
    playbackSessionWritesEnabled = true
  }

  async function savePlaybackSessionForQuit(): Promise<void> {
    clearPlaybackSessionAutosave()
    if (!playbackSessionWritesEnabled) return
    await savePlaybackSessionSnapshot()
  }

  async function savePlaybackSessionSnapshot(): Promise<void> {
    if (!playbackSessionWritesEnabled) return

    const mode = getPlaybackResumeMode()
    if (mode === 'off') {
      await options.dataApi.clearPlaybackSession()
      return
    }

    const session = options.createPlaybackSession(mode)
    if (!session) {
      await options.dataApi.clearPlaybackSession()
      return
    }

    await options.dataApi.savePlaybackSession(session)
  }

  function clearPlaybackSessionAutosave(): void {
    if (playbackSessionAutosaveTimer !== null) {
      clearTimeout(playbackSessionAutosaveTimer)
      playbackSessionAutosaveTimer = null
    }
  }

  function schedulePlaybackSessionAutosave(delay = autosaveDelayMs): void {
    if (!playbackSessionWritesEnabled) return

    clearPlaybackSessionAutosave()
    playbackSessionAutosaveTimer = setTimeout(() => {
      playbackSessionAutosaveTimer = null
      lastPlaybackSessionPositionSaveAt = Date.now()
      void savePlaybackSessionSnapshot().catch((err) => {
        console.warn('自动保存播放会话失败：', err)
      })
    }, delay)
  }

  function startAutosaveWatchers(): void {
    if (!playbackSessionWritesEnabled || stopHandles.length > 0) return

    stopHandles.push(
      watch(
        [() => options.currentTrack.value?.id, () => getPlaybackResumeMode()],
        ([trackId]) => {
          if (!trackId || getPlaybackResumeMode() === 'off') {
            schedulePlaybackSessionAutosave()
            return
          }

          lastPlaybackSessionPositionSaveAt = Date.now()
          schedulePlaybackSessionAutosave()
        },
        { flush: 'post' }
      )
    )

    stopHandles.push(
      watch(
        [options.currentTime, options.isPlaying],
        ([, playing]) => {
          if (!playing || !options.currentTrack.value || getPlaybackResumeMode() !== 'trackAndPosition') {
            return
          }

          const now = Date.now()
          if (now - lastPlaybackSessionPositionSaveAt < positionAutosaveMs) return
          lastPlaybackSessionPositionSaveAt = now
          schedulePlaybackSessionAutosave()
        },
        { flush: 'post' }
      )
    )
  }

  function stop(): void {
    clearPlaybackSessionAutosave()
    while (stopHandles.length > 0) {
      stopHandles.pop()?.()
    }
  }

  function getPlaybackResumeMode(): PlaybackResumeMode {
    const mode = options.settings.value.playbackResumeMode
    return typeof mode === 'object' && mode !== null && 'value' in mode ? mode.value : mode
  }

  return {
    restoreSavedPlaybackSession,
    savePlaybackSessionForQuit,
    savePlaybackSessionSnapshot,
    clearPlaybackSessionAutosave,
    schedulePlaybackSessionAutosave,
    startAutosaveWatchers,
    stop
  }
}
