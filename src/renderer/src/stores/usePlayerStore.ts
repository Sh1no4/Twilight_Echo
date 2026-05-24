import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import type { Track } from '../types/music'
import { extractDominantColor } from '../utils/colorExtractor'
import { useNcmStore } from './useNcmStore'
import { useSettingsStore } from './useSettingsStore'

type PlayMode = 'sequential' | 'repeat' | 'shuffle'

const currentTrack = ref<Track | null>(null)
const dominantColor = ref('#1a73e8')
const isPlaying = ref(false)
const isLoading = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(0.7)
const queue = ref<Track[]>([])
const queueIndex = ref(-1)
const playMode = ref<PlayMode>('sequential')
const originalQueue = ref<Track[]>([])
const mpvReady = ref(false)
const mpvError = ref<string | null>(null)
const exclusiveMode = ref(false)
const { settings: appSettings } = useSettingsStore()

watch(volume, (val) => {
  window.api.mpv.setVolume(val).catch(() => {})
})

watch(
  [() => currentTrack.value?.cover, () => appSettings.value.useCoverTheme],
  async ([cover, useCoverTheme]) => {
    if (!useCoverTheme) {
      dominantColor.value = '#7c4dff'
      return
    }

    if (cover) {
      dominantColor.value = await extractDominantColor(cover)
    } else {
      dominantColor.value = '#1a73e8'
    }
  }
)

watch(
  () => [currentTrack.value?.id, currentTrack.value?.translatedLyrics] as const,
  async ([id], [prevId]) => {
    const track = currentTrack.value
    if (!track || track.id !== id || track.id === prevId) return

    if (track.source === 'ncm' && track.ncmSongId && track.translatedLyrics == null) {
      const { fetchLyric } = useNcmStore()
      const lyricData = await fetchLyric(track.ncmSongId)
      if (currentTrack.value?.id === track.id && (lyricData.lyrics || lyricData.translatedLyrics)) {
        currentTrack.value = {
          ...currentTrack.value,
          lyrics: lyricData.lyrics ?? currentTrack.value?.lyrics ?? null,
          translatedLyrics: lyricData.translatedLyrics ?? currentTrack.value?.translatedLyrics ?? null
        }
      }
    }
  }
)

const cleanupFns: (() => void)[] = []
let listenersSetup = false

function getTrackSource(track: Track): 'local' | 'ncm' {
  return track.source === 'ncm' ? 'ncm' : 'local'
}

async function resolvePlayTarget(track: Track): Promise<string> {
  if (getTrackSource(track) === 'local') {
    return track.filePath
  }

  if (track.streamUrl) {
    return track.streamUrl
  }

  if (!track.ncmSongId) {
    throw new Error('缺少网易云歌曲 ID，无法播放')
  }

  const { getSongStreamUrl } = useNcmStore()
  const streamUrl = await getSongStreamUrl(track.ncmSongId)
  if (!streamUrl) {
    throw new Error('未获取到网易云音频地址')
  }

  track.streamUrl = streamUrl
  return streamUrl
}

function setupMpvListeners(): void {
  if (listenersSetup) return
  listenersSetup = true

  const api = window.api?.mpv
  if (!api) return

  cleanupFns.push(
    api.onPropertyChange(({ name, data }) => {
      switch (name) {
        case 'time-pos':
          if (typeof data === 'number' && isFinite(data)) {
            currentTime.value = data
          }
          break
        case 'duration':
          if (typeof data === 'number' && isFinite(data) && data > 0) {
            duration.value = data
          }
          break
        case 'pause':
          isPlaying.value = !data
          break
      }
    })
  )

  cleanupFns.push(
    api.onEndFile((reason) => {
      if (reason === 'eof') {
        next()
      }
    })
  )

  cleanupFns.push(
    api.onStartFile(() => {
      isLoading.value = false
    })
  )

  cleanupFns.push(
    api.onReady(async () => {
      mpvReady.value = true
      mpvError.value = null
      api.setVolume(volume.value).catch(() => {})
      try {
        exclusiveMode.value = await api.getExclusiveMode()
      } catch {
        // keep default
      }
    })
  )

  cleanupFns.push(
    api.onError((message) => {
      console.error('[mpv]', message)
      mpvError.value = message
      isPlaying.value = false
      isLoading.value = false
    })
  )

  cleanupFns.push(
    api.onDisconnected(() => {
      mpvReady.value = false
      isPlaying.value = false
    })
  )
}

setupMpvListeners()

async function loadAndPlay(track: Track): Promise<void> {
  isLoading.value = true

  try {
    const playTarget = await resolvePlayTarget(track)
    await window.api.mpv.play(playTarget)
    isPlaying.value = true
  } catch (err) {
    console.error('[mpv] 播放失败:', err)
    isLoading.value = false
    isPlaying.value = false
  }
}

function next(): void {
  if (queue.value.length === 0) return

  if (playMode.value === 'repeat') {
    const track = queue.value[queueIndex.value]
    if (track) {
      void loadAndPlay(track)
    }
    return
  }

  const nextIndex = queueIndex.value + 1
  if (nextIndex < queue.value.length) {
    queueIndex.value = nextIndex
    const track = queue.value[nextIndex]
    currentTrack.value = track
    void loadAndPlay(track)
  } else {
    queueIndex.value = 0
    const track = queue.value[0]
    currentTrack.value = track
    void loadAndPlay(track)
  }
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function applyPlayMode(): void {
  const current = currentTrack.value
  if (!current || originalQueue.value.length === 0) return

  if (playMode.value === 'shuffle') {
    const shuffled = shuffleArray(originalQueue.value)
    queue.value = shuffled
    queueIndex.value = shuffled.findIndex((t) => t.id === current.id)
    if (queueIndex.value === -1) queueIndex.value = 0
  } else {
    queue.value = [...originalQueue.value]
    queueIndex.value = queue.value.findIndex((t) => t.id === current.id)
    if (queueIndex.value === -1) queueIndex.value = 0
  }
}

function cyclePlayMode(): void {
  const modes: PlayMode[] = ['sequential', 'repeat', 'shuffle']
  const idx = modes.indexOf(playMode.value)
  playMode.value = modes[(idx + 1) % modes.length]
  applyPlayMode()
}

const progress = computed(() => {
  if (duration.value <= 0) return 0
  return (currentTime.value / duration.value) * 100
})

export function usePlayerStore(): {
  currentTrack: Ref<Track | null>
  dominantColor: Ref<string>
  isPlaying: Ref<boolean>
  isLoading: Ref<boolean>
  currentTime: Ref<number>
  duration: Ref<number>
  volume: Ref<number>
  progress: ComputedRef<number>
  queue: Ref<Track[]>
  queueIndex: Ref<number>
  playMode: Ref<PlayMode>
  mpvReady: Ref<boolean>
  mpvError: Ref<string | null>
  exclusiveMode: Ref<boolean>
  cyclePlayMode: () => void
  playTrack: (track: Track, trackList?: Track[]) => void
  togglePlay: () => Promise<void>
  next: () => void
  prev: () => void
  seek: (time: number) => void
  setVolume: (vol: number) => void
  toggleExclusiveMode: () => Promise<void>
  formatTime: (seconds: number) => string
} {
  function playTrack(track: Track, trackList?: Track[]): void {
    if (trackList) {
      originalQueue.value = [...trackList]
      if (playMode.value === 'shuffle') {
        queue.value = shuffleArray(trackList)
        queueIndex.value = queue.value.findIndex((t) => t.id === track.id)
      } else {
        queue.value = [...trackList]
        queueIndex.value = trackList.findIndex((t) => t.id === track.id)
      }
    }
    if (queueIndex.value === -1) queueIndex.value = 0
    currentTrack.value = track
    void loadAndPlay(track)
  }

  async function togglePlay(): Promise<void> {
    if (!currentTrack.value) return
    isPlaying.value = !isPlaying.value
    try {
      await window.api.mpv.togglePause()
    } catch (err) {
      isPlaying.value = !isPlaying.value
      console.error('[mpv] togglePlay 失败:', err)
    }
  }

  function prev(): void {
    if (queue.value.length === 0) return
    if (currentTime.value > 3) {
      window.api.mpv.seek(0).catch(() => {})
      return
    }
    const prevIndex = queueIndex.value - 1
    if (prevIndex >= 0) {
      queueIndex.value = prevIndex
      const track = queue.value[prevIndex]
      currentTrack.value = track
      void loadAndPlay(track)
    } else {
      const lastIndex = queue.value.length - 1
      queueIndex.value = lastIndex
      const track = queue.value[lastIndex]
      currentTrack.value = track
      void loadAndPlay(track)
    }
  }

  function seek(time: number): void {
    window.api.mpv.seek(time).catch(() => {})
  }

  function setVolume(vol: number): void {
    volume.value = vol
  }

  async function toggleExclusiveMode(): Promise<void> {
    const next = !exclusiveMode.value
    try {
      await window.api.mpv.setExclusiveMode(next)
      exclusiveMode.value = next
    } catch (err) {
      console.error('[mpv] 切换独占模式失败:', err)
    }
  }

  function formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return {
    currentTrack,
    dominantColor,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    volume,
    progress,
    queue,
    queueIndex,
    playMode,
    mpvReady,
    mpvError,
    exclusiveMode,
    cyclePlayMode,
    playTrack,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleExclusiveMode,
    formatTime
  }
}
