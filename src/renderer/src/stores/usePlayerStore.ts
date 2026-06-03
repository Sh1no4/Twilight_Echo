import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import type { PlaybackSession, Track } from '../types/music'
import type {
  AudioDeviceOption,
  AudioOutputId,
  AudioOutputOption,
  AudioProcessingSettings,
  OutputConfig,
  PlaybackResumeMode
} from '../types/settings'
import { extractDominantColor } from '../utils/colorExtractor'
import { useNcmStore } from './useNcmStore'
import { useSettingsStore } from './useSettingsStore'

type PlayMode = 'sequential' | 'repeat' | 'shuffle'
type NativePlaybackInfo = Awaited<ReturnType<typeof window.api.audioEngine.getPlaybackInfo>>
type NativeOutputInfo = NativePlaybackInfo['outputInfo']

interface AudioOutputState {
  output: AudioOutputId
  device: string
  exclusiveMode: boolean
  exclusiveAvailable: boolean
  outputOptions: AudioOutputOption[]
  deviceOptions: AudioDeviceOption[]
}

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
const audioEngineReady = ref(false)
const audioEngineError = ref<string | null>(null)
const exclusiveMode = ref(false)
const audioOutput = ref<AudioOutputId>('wasapi')
const audioDevice = ref('auto')
const audioOutputOptions = ref<AudioOutputOption[]>([])
const audioDeviceOptions = ref<AudioDeviceOption[]>([])
const defaultAudioProcessing: AudioProcessingSettings = {
  dspEnabled: false,
  clipGuard: true,
  fftEnabled: true,
  fftResolution: 64,
  highResolution: true,
  dsdToPcm: true,
  eqEnabled: false,
  eqMode: 'graphic',
  eqPreamp: 0,
  eqBands: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((frequency) => ({
    frequency,
    gain: 0,
    q: 1,
    filterType: 'peak'
  })),
  volumeNormalization: 'off',
  replayGainPreamp: 0,
  replayGainFallback: 0,
  replayGainClip: true,
  convolverIrPath: '',
  crossfeedEnabled: false,
  crossfeedStrength: 0,
  gapless: true,
  crossfadeSeconds: 0
}
const audioProcessing = ref<AudioProcessingSettings>({ ...defaultAudioProcessing })
const defaultAudioOutputConfig: OutputConfig = {
  preferredBufferSize: 0,
  routingMode: 'auto'
}
const audioOutputConfig = ref<OutputConfig>({ ...defaultAudioOutputConfig })
const playbackInfo = ref<NativePlaybackInfo | null>(null)
const outputInfo = computed<NativeOutputInfo | null>(() => playbackInfo.value?.outputInfo ?? null)
const { settings: appSettings } = useSettingsStore()
let playbackAudio: HTMLAudioElement | null = null
let playbackObjectUrl: string | null = null
let nativePlaybackActive = false

function getPlaybackAudio(): HTMLAudioElement {
  if (playbackAudio) return playbackAudio

  const audio = new Audio()
  audio.preload = 'auto'
  audio.volume = volume.value

  audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      duration.value = audio.duration
    }
  })

  audio.addEventListener('timeupdate', () => {
    if (Number.isFinite(audio.currentTime)) {
      setCurrentTimeThrottled(audio.currentTime)
      scheduleCrossfadeIfNeeded()
    }
  })

  audio.addEventListener('play', () => {
    isPlaying.value = true
    flushLatestCurrentTime()
  })

  audio.addEventListener('pause', () => {
    if (!audio.ended) {
      isPlaying.value = false
      flushLatestCurrentTime()
    }
  })

  audio.addEventListener('ended', () => {
    isPlaying.value = false
    handlePlaybackEnded()
  })

  audio.addEventListener('error', () => {
    const code = audio.error?.code ?? 0
    audioEngineError.value = `音频播放失败（错误码 ${code}）`
    isPlaying.value = false
    isLoading.value = false
  })

  playbackAudio = audio
  return audio
}

function releasePlaybackObjectUrl(): void {
  if (playbackObjectUrl) {
    URL.revokeObjectURL(playbackObjectUrl)
    playbackObjectUrl = null
  }
}

function stopRendererAudio(clearSource = false): void {
  if (!playbackAudio) return
  playbackAudio.pause()
  if (clearSource) {
    playbackAudio.removeAttribute('src')
    playbackAudio.load()
    releasePlaybackObjectUrl()
  }
}

async function createPlayableUrl(target: string, track: Track): Promise<string> {
  if (/^https?:\/\//i.test(target) || /^blob:/i.test(target) || /^data:/i.test(target)) {
    releasePlaybackObjectUrl()
    return target
  }

  const file = await window.api.fs.readAudioFile(target)
  const blob = new Blob([file.buffer], { type: file.mimeType || 'audio/mpeg' })
  releasePlaybackObjectUrl()
  playbackObjectUrl = URL.createObjectURL(blob)
  if (!duration.value && track.duration) {
    duration.value = track.duration
  }
  return playbackObjectUrl
}

async function playWithRendererAudio(
  track: Track,
  target: string,
  startTime: number
): Promise<void> {
  const audio = getPlaybackAudio()
  audio.pause()
  audio.src = await createPlayableUrl(target, track)
  audio.volume = volume.value
  audio.currentTime = Math.max(0, startTime)
  await audio.play()
}

function applyAudioOutputState(state: AudioOutputState): void {
  exclusiveMode.value = state.exclusiveMode
  audioOutput.value = state.output
  audioDevice.value = state.device
  audioOutputOptions.value = [...state.outputOptions]
  audioDeviceOptions.value = [...state.deviceOptions]
}

function normalizeNativePlaybackInfo(info: NativePlaybackInfo): NativePlaybackInfo {
  const canonicalOutput = info.outputInfo
  const sourceExact = canonicalOutput?.sourceExact === true
  const outputPerfect = canonicalOutput?.outputPerfect === true
  const pcmPassthrough = canonicalOutput
    ? canonicalOutput.pcmPassthrough === true
    : info.pcmPassthrough === true
  const perfectReason = canonicalOutput?.perfectReason || ''
  const isDsd =
    canonicalOutput?.isDsd === true ||
    canonicalOutput?.dsdMode === 'native' ||
    canonicalOutput?.dsdMode === 'dop' ||
    canonicalOutput?.dsdMode === 'unsupported'
  const dsdMode = isDsd ? canonicalOutput?.dsdMode || 'unsupported' : 'pcm'
  const dsdRate = isDsd ? canonicalOutput?.dsdRate || 0 : 0
  return {
    ...info,
    outputInfo: {
      ...canonicalOutput,
      sourceExact,
      outputPerfect,
      pcmPassthrough,
      perfectReason,
      isDsd,
      dsdMode,
      dsdRate: isDsd ? dsdRate : 0
    },
    sourceExact,
    outputPerfect,
    pcmPassthrough,
    perfectReason,
    isDsd,
    dsdMode,
    dsdRate
  }
}

function getTrackAudioSource(track: Track): string {
  return track.streamUrl || track.filePath
}

function findTrackIndexFromPlaybackInfo(info: NativePlaybackInfo): number {
  if (
    Number.isInteger(info.queueIndex) &&
    info.queueIndex >= 0 &&
    info.queueIndex < queue.value.length
  ) {
    return info.queueIndex
  }

  if (!info.source) return -1
  return queue.value.findIndex(
    (track) => track.id === info.source || getTrackAudioSource(track) === info.source
  )
}

function applyNativePlaybackInfo(info: NativePlaybackInfo): void {
  const normalizedInfo = normalizeNativePlaybackInfo(info)
  playbackInfo.value = normalizedInfo
  const infoIndex = findTrackIndexFromPlaybackInfo(info)
  let switchedTrack = false

  if (infoIndex >= 0) {
    const track = queue.value[infoIndex]
    switchedTrack = currentTrack.value?.id !== track.id
    queueIndex.value = infoIndex
    currentTrack.value = track
    loadedTrackId = track.id
  }

  const nextDuration =
    Number.isFinite(info.duration) && info.duration > 0
      ? info.duration
      : currentTrack.value?.duration
  if (nextDuration && nextDuration > 0) {
    duration.value = nextDuration
  }

  const nextPosition = Number.isFinite(info.position)
    ? Math.max(0, info.position)
    : latestPlaybackTime
  if (switchedTrack || nextPosition + 1 < latestPlaybackTime) {
    setCurrentTimeImmediate(nextPosition)
  } else {
    setCurrentTimeThrottled(nextPosition)
  }

  isPlaying.value = normalizedInfo.state === 'playing'
  isLoading.value = false
  if (normalizedInfo.state === 'stopped') {
    nativePlaybackActive = false
  }
  autoAdvanceInFlight = false
  advancingFromEndedTrackId = ''
  restoredPlaybackPending = false
  restoredPlaybackPosition = 0
  pendingLoadStartTime = 0
  scheduleCrossfadeIfNeeded()
}

async function syncNativeQueueState(): Promise<void> {
  const engineQueue = queue.value.map((item) => ({
    ...item,
    audioSource: getTrackAudioSource(item)
  }))
  await window.api.audioEngine.loadQueue(engineQueue, Math.max(0, queueIndex.value))
  await window.api.audioEngine.setPlayMode(playMode.value)
}

async function refreshNativePlaybackInfo(): Promise<void> {
  applyNativePlaybackInfo(await window.api.audioEngine.getPlaybackInfo())
}

async function advanceNativePlayback(direction: 'next' | 'previous'): Promise<void> {
  try {
    isLoading.value = true
    if (direction === 'next') {
      await window.api.audioEngine.next()
    } else {
      await window.api.audioEngine.previous()
    }
    await refreshNativePlaybackInfo()
  } catch (err) {
    audioEngineError.value = err instanceof Error ? err.message : String(err)
    console.error('[音频引擎] 切换歌曲失败:', err)
    isLoading.value = false
  }
}

watch(volume, (val) => {
  if (playbackAudio) playbackAudio.volume = val
  window.api.audioEngine.setVolume(val).catch(() => {})
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
  () => appSettings.value.audioOutputConfig,
  (config) => {
    audioOutputConfig.value = {
      preferredBufferSize:
        config?.preferredBufferSize ?? defaultAudioOutputConfig.preferredBufferSize,
      routingMode: config?.routingMode ?? defaultAudioOutputConfig.routingMode
    }
  },
  { deep: true, immediate: true }
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
          translatedLyrics:
            lyricData.translatedLyrics ?? currentTrack.value?.translatedLyrics ?? null
        }
      }
    }
  }
)

const cleanupFns: (() => void)[] = []
let listenersSetup = false
let crossfadeTimer: number | null = null
let crossfadeTrackId = ''
const TIME_UPDATE_INTERVAL_MS = 250
let latestPlaybackTime = 0
let lastTimePublishAt = 0
let pendingTimePublishTimer: number | null = null
let advancingFromEndedTrackId = ''
let autoAdvanceInFlight = false
let loadedTrackId = ''
let restoredPlaybackPending = false
let restoredPlaybackPosition = 0
let pendingLoadStartTime = 0

function getNowMs(): number {
  return performance.now()
}

function clearPendingTimePublish(): void {
  if (pendingTimePublishTimer !== null) {
    window.clearTimeout(pendingTimePublishTimer)
    pendingTimePublishTimer = null
  }
}

function publishCurrentTime(time: number): void {
  latestPlaybackTime = time
  currentTime.value = time
  lastTimePublishAt = getNowMs()
}

function publishLatestCurrentTime(): void {
  pendingTimePublishTimer = null
  publishCurrentTime(latestPlaybackTime)
}

function setCurrentTimeImmediate(time: number): void {
  clearPendingTimePublish()
  publishCurrentTime(time)
}

function setCurrentTimeThrottled(time: number): void {
  latestPlaybackTime = time
  const now = getNowMs()
  const remainingMs = TIME_UPDATE_INTERVAL_MS - (now - lastTimePublishAt)

  if (remainingMs <= 0 || currentTime.value === 0) {
    clearPendingTimePublish()
    currentTime.value = time
    lastTimePublishAt = now
    return
  }

  if (pendingTimePublishTimer === null) {
    pendingTimePublishTimer = window.setTimeout(publishLatestCurrentTime, remainingMs)
  }
}

function flushLatestCurrentTime(): void {
  clearPendingTimePublish()
  publishCurrentTime(latestPlaybackTime)
}

function handlePlaybackEnded(): void {
  const trackId = currentTrack.value?.id ?? ''
  if (!trackId || autoAdvanceInFlight || advancingFromEndedTrackId === trackId) return
  advancingFromEndedTrackId = trackId
  autoAdvanceInFlight = true
  flushLatestCurrentTime()
  next()
}

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

function setupAudioEngineListeners(): void {
  if (listenersSetup) return
  listenersSetup = true

  const api = window.api?.audioEngine
  if (!api) return

  const settingsApi = window.api?.settings

  cleanupFns.push(
    api.onPropertyChange(({ name, data }) => {
      switch (name) {
        case 'time-pos':
          if (typeof data === 'number' && isFinite(data)) {
            setCurrentTimeThrottled(data)
          }
          break
        case 'duration':
          if (typeof data === 'number' && isFinite(data) && data > 0) {
            duration.value = data
          }
          break
        case 'pause':
          isPlaying.value = !data
          flushLatestCurrentTime()
          break
        case 'eof-reached':
          if (data === true) {
            handlePlaybackEnded()
          }
          break
      }
      if (name === 'time-pos' || name === 'duration') {
        scheduleCrossfadeIfNeeded()
      }
    })
  )

  cleanupFns.push(
    api.onEndFile((reason) => {
      if (reason === 'eof') {
        handlePlaybackEnded()
      }
    })
  )

  cleanupFns.push(
    api.onStartFile(() => {
      advancingFromEndedTrackId = ''
      autoAdvanceInFlight = false
      setCurrentTimeImmediate(pendingLoadStartTime)
      isLoading.value = false
    })
  )

  cleanupFns.push(
    api.onPlaybackInfo((info) => {
      playbackInfo.value = normalizeNativePlaybackInfo(info)
      if (!nativePlaybackActive && info.state !== 'stopped') return
      applyNativePlaybackInfo(info)
    })
  )

  cleanupFns.push(
    api.onReady(async () => {
      audioEngineReady.value = true
      audioEngineError.value = null
      api.setVolume(volume.value).catch(() => {})
      try {
        const [outputState, processingSettings, nativeInfo] = await Promise.all([
          api.getAudioOutputState(),
          api.getAudioProcessing(),
          api.getPlaybackInfo()
        ])
        applyAudioOutputState(outputState)
        audioProcessing.value = processingSettings
        audioOutputConfig.value = { ...appSettings.value.audioOutputConfig }
        playbackInfo.value = normalizeNativePlaybackInfo(nativeInfo)
      } catch {
        // keep default
      }
    })
  )

  cleanupFns.push(
    api.onError((message) => {
      console.error('[音频引擎]', message)
      audioEngineError.value = message
      isPlaying.value = false
      isLoading.value = false
    })
  )

  cleanupFns.push(
    api.onDisconnected(() => {
      audioEngineReady.value = false
      nativePlaybackActive = false
      isPlaying.value = false
    })
  )

  if (settingsApi?.onPlayerShortcut) {
    cleanupFns.push(
      settingsApi.onPlayerShortcut((action) => {
        if (action === 'previous') {
          previous()
          return
        }
        if (action === 'next') {
          next()
          return
        }
        void togglePlayState()
      })
    )
  }
}

setupAudioEngineListeners()

function clearCrossfadeTimer(): void {
  if (crossfadeTimer) {
    window.clearTimeout(crossfadeTimer)
    crossfadeTimer = null
  }
  crossfadeTrackId = ''
}

function scheduleCrossfadeIfNeeded(): void {
  const seconds = audioProcessing.value.crossfadeSeconds
  const track = currentTrack.value
  if (
    !track ||
    !isPlaying.value ||
    nativePlaybackActive ||
    playMode.value === 'repeat' ||
    seconds <= 0 ||
    duration.value <= seconds + 1
  ) {
    clearCrossfadeTimer()
    return
  }

  if (queue.value.length <= 1) return

  const remaining = duration.value - latestPlaybackTime
  if (remaining > seconds || remaining < 0) {
    if (crossfadeTrackId !== track.id) clearCrossfadeTimer()
    return
  }

  if (crossfadeTrackId === track.id) return
  crossfadeTrackId = track.id
  crossfadeTimer = window.setTimeout(
    () => {
      crossfadeTimer = null
      next()
    },
    Math.max(0, remaining * 1000)
  )
}

async function loadAndPlay(track: Track, startTime = 0): Promise<void> {
  const normalizedStartTime = Math.max(0, Number.isFinite(startTime) ? startTime : 0)
  isLoading.value = true
  pendingLoadStartTime = normalizedStartTime
  setCurrentTimeImmediate(normalizedStartTime)
  clearCrossfadeTimer()

  try {
    const playTarget = await resolvePlayTarget(track)
    const engineQueue = queue.value.map((item) => ({
      ...item,
      audioSource: item.id === track.id ? playTarget : getTrackAudioSource(item)
    }))
    await window.api.audioEngine.loadQueue(engineQueue, Math.max(0, queueIndex.value))
    await window.api.audioEngine.setPlayMode(playMode.value)
    const playResult = await window.api.audioEngine.play(playTarget, normalizedStartTime)
    nativePlaybackActive = playResult?.nativeStarted === true
    if (nativePlaybackActive) {
      audioEngineError.value = ''
      stopRendererAudio(true)
    } else {
      audioEngineError.value = playResult?.fallbackReason
        ? `原生音频引擎不可用，已启用临时播放通道：${playResult.fallbackReason}`
        : ''
      await playWithRendererAudio(track, playTarget, normalizedStartTime)
    }
    loadedTrackId = track.id
    restoredPlaybackPending = false
    restoredPlaybackPosition = 0
    setCurrentTimeImmediate(normalizedStartTime)
    isPlaying.value = true
  } catch (err) {
    console.error('[音频引擎] 播放失败:', err)
    audioEngineError.value = err instanceof Error ? err.message : String(err)
    autoAdvanceInFlight = false
    isLoading.value = false
    isPlaying.value = false
    nativePlaybackActive = false
  }
}

function next(): void {
  if (queue.value.length === 0) return
  clearCrossfadeTimer()

  if (nativePlaybackActive) {
    void advanceNativePlayback('next')
    return
  }

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

async function togglePlayState(): Promise<void> {
  const track = currentTrack.value
  if (!track) return
  if (loadedTrackId !== track.id) {
    await loadAndPlay(track, restoredPlaybackPending ? restoredPlaybackPosition : 0)
    return
  }
  isPlaying.value = !isPlaying.value
  try {
    if (nativePlaybackActive) {
      await window.api.audioEngine.togglePause()
    } else {
      const audio = getPlaybackAudio()
      if (audio.paused) {
        await audio.play()
      } else {
        audio.pause()
      }
      await window.api.audioEngine.togglePause()
    }
  } catch (err) {
    isPlaying.value = !isPlaying.value
    console.error('[音频引擎] 暂停或继续播放失败:', err)
  }
}

function previous(): void {
  if (queue.value.length === 0) return
  clearCrossfadeTimer()
  if (latestPlaybackTime > 3) {
    setCurrentTimeImmediate(0)
    if (currentTrack.value && loadedTrackId !== currentTrack.value.id) {
      restoredPlaybackPending = true
      restoredPlaybackPosition = 0
    } else {
      if (!nativePlaybackActive && playbackAudio) playbackAudio.currentTime = 0
      window.api.audioEngine.seek(0).catch(() => {})
    }
    return
  }
  const prevIndex = queueIndex.value - 1
  if (nativePlaybackActive) {
    void advanceNativePlayback('previous')
    return
  }

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
  void syncNativeQueueState().catch((err) => {
    audioEngineError.value = err instanceof Error ? err.message : String(err)
    console.error('[音频引擎] 同步播放模式失败:', err)
  })
}

const progress = computed(() => {
  if (duration.value <= 0) return 0
  return (currentTime.value / duration.value) * 100
})

function cloneTrackForPlaybackSession(track: Track): Track {
  const cloned = JSON.parse(JSON.stringify(track)) as Track
  if (cloned.source === 'ncm') {
    cloned.streamUrl = null
  }
  return cloned
}

function restorePlaybackSession(session: PlaybackSession): void {
  const track = cloneTrackForPlaybackSession(session.track)
  const position =
    session.mode === 'trackAndPosition'
      ? Math.max(0, Number.isFinite(session.position) ? session.position : 0)
      : 0

  clearCrossfadeTimer()
  currentTrack.value = track
  queue.value = [track]
  originalQueue.value = [track]
  queueIndex.value = 0
  duration.value = Math.max(0, track.duration || 0)
  isPlaying.value = false
  isLoading.value = false
  loadedTrackId = ''
  restoredPlaybackPending = true
  restoredPlaybackPosition = position
  pendingLoadStartTime = 0
  autoAdvanceInFlight = false
  advancingFromEndedTrackId = ''
  setCurrentTimeImmediate(position)
}

function createPlaybackSession(mode: PlaybackResumeMode): PlaybackSession | null {
  const track = currentTrack.value
  if (!track || mode === 'off') return null

  flushLatestCurrentTime()
  const rawPosition =
    mode === 'trackAndPosition'
      ? Math.max(0, Number.isFinite(currentTime.value) ? currentTime.value : 0)
      : 0
  const position =
    duration.value > 0 ? Math.min(rawPosition, Math.max(0, duration.value - 1)) : rawPosition

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    mode,
    track: cloneTrackForPlaybackSession(track),
    position
  }
}

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
  audioEngineReady: Ref<boolean>
  audioEngineError: Ref<string | null>
  exclusiveMode: Ref<boolean>
  audioOutput: Ref<AudioOutputId>
  audioDevice: Ref<string>
  audioOutputOptions: Ref<AudioOutputOption[]>
  audioDeviceOptions: Ref<AudioDeviceOption[]>
  audioProcessing: Ref<AudioProcessingSettings>
  audioOutputConfig: Ref<OutputConfig>
  playbackInfo: Ref<NativePlaybackInfo | null>
  outputInfo: ComputedRef<NativeOutputInfo | null>
  cyclePlayMode: () => void
  playTrack: (track: Track, trackList?: Track[]) => void
  togglePlay: () => Promise<void>
  next: () => void
  prev: () => void
  seek: (time: number) => void
  setVolume: (vol: number) => void
  toggleExclusiveMode: () => Promise<void>
  setAudioOutput: (output: AudioOutputId, device?: string) => Promise<void>
  setAudioDevice: (device: string) => Promise<void>
  setAudioOutputConfig: (config: Partial<OutputConfig>) => Promise<void>
  setAudioProcessing: (settings: Partial<AudioProcessingSettings>) => Promise<void>
  toggleDspEnabled: () => Promise<void>
  toggleEqEnabled: () => Promise<void>
  toggleCrossfeed: () => Promise<void>
  toggleGapless: () => Promise<void>
  setReplayGainMode: (mode: AudioProcessingSettings['volumeNormalization']) => Promise<void>
  setCrossfeedStrength: (strength: number) => Promise<void>
  selectImpulseResponse: () => Promise<void>
  clearImpulseResponse: () => Promise<void>
  restorePlaybackSession: (session: PlaybackSession) => void
  createPlaybackSession: (mode: PlaybackResumeMode) => PlaybackSession | null
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
    await togglePlayState()
  }

  function prev(): void {
    previous()
  }

  function seek(time: number): void {
    if (currentTrack.value && loadedTrackId !== currentTrack.value.id) {
      restoredPlaybackPending = true
      restoredPlaybackPosition = Math.max(0, Number.isFinite(time) ? time : 0)
      setCurrentTimeImmediate(restoredPlaybackPosition)
      return
    }
    setCurrentTimeImmediate(time)
    if (!nativePlaybackActive && playbackAudio) playbackAudio.currentTime = Math.max(0, time)
    window.api.audioEngine.seek(time).catch(() => {})
  }

  function setVolume(vol: number): void {
    volume.value = vol
  }

  async function toggleExclusiveMode(): Promise<void> {
    const next = !exclusiveMode.value
    try {
      applyAudioOutputState(await window.api.audioEngine.setExclusiveMode(next))
    } catch (err) {
      audioEngineError.value = err instanceof Error ? err.message : String(err)
      console.error('[音频引擎] 切换独占模式失败:', err)
    }
  }

  async function setAudioOutput(output: AudioOutputId, device?: string): Promise<void> {
    try {
      applyAudioOutputState(await window.api.audioEngine.setAudioOutput(output, device))
    } catch (err) {
      audioEngineError.value = err instanceof Error ? err.message : String(err)
      console.error('[音频引擎] 切换音频输出失败:', err)
    }
  }

  async function setAudioDevice(device: string): Promise<void> {
    try {
      applyAudioOutputState(await window.api.audioEngine.setAudioDevice(device))
    } catch (err) {
      audioEngineError.value = err instanceof Error ? err.message : String(err)
      console.error('[音频引擎] 切换音频设备失败:', err)
    }
  }

  async function setAudioOutputConfig(config: Partial<OutputConfig>): Promise<void> {
    try {
      audioOutputConfig.value = await window.api.audioEngine.setOutputConfig({
        ...audioOutputConfig.value,
        ...config
      })
      playbackInfo.value = normalizeNativePlaybackInfo(
        await window.api.audioEngine.getPlaybackInfo()
      )
    } catch (err) {
      audioEngineError.value = err instanceof Error ? err.message : String(err)
      console.error('[音频引擎] 更新输出配置失败:', err)
    }
  }

  async function setAudioProcessing(settings: Partial<AudioProcessingSettings>): Promise<void> {
    try {
      audioProcessing.value = await window.api.audioEngine.setAudioProcessing({
        ...audioProcessing.value,
        ...settings
      })
      playbackInfo.value = normalizeNativePlaybackInfo(
        await window.api.audioEngine.getPlaybackInfo()
      )
      scheduleCrossfadeIfNeeded()
    } catch (err) {
      console.error('[音频引擎] 更新音频处理设置失败:', err)
    }
  }

  async function toggleDspEnabled(): Promise<void> {
    await setAudioProcessing({ dspEnabled: !audioProcessing.value.dspEnabled })
  }

  async function toggleEqEnabled(): Promise<void> {
    await setAudioProcessing({ eqEnabled: !audioProcessing.value.eqEnabled })
  }

  async function toggleCrossfeed(): Promise<void> {
    await setAudioProcessing({
      crossfeedEnabled: !audioProcessing.value.crossfeedEnabled,
      crossfeedStrength:
        !audioProcessing.value.crossfeedEnabled && audioProcessing.value.crossfeedStrength <= 0
          ? 0.35
          : audioProcessing.value.crossfeedStrength
    })
  }

  async function toggleGapless(): Promise<void> {
    await setAudioProcessing({ gapless: !audioProcessing.value.gapless })
  }

  async function setReplayGainMode(
    mode: AudioProcessingSettings['volumeNormalization']
  ): Promise<void> {
    await setAudioProcessing({ volumeNormalization: mode })
  }

  async function setCrossfeedStrength(strength: number): Promise<void> {
    await setAudioProcessing({
      crossfeedEnabled: strength > 0,
      crossfeedStrength: Math.min(1, Math.max(0, strength))
    })
  }

  async function selectImpulseResponse(): Promise<void> {
    try {
      const path = await window.api.audioEngine.selectImpulseResponse()
      if (!path) return
      await window.api.audioEngine.loadImpulseResponse(path)
      audioProcessing.value = await window.api.audioEngine.getAudioProcessing()
      playbackInfo.value = normalizeNativePlaybackInfo(
        await window.api.audioEngine.getPlaybackInfo()
      )
    } catch (err) {
      audioEngineError.value = err instanceof Error ? err.message : String(err)
      console.error('[音频引擎] 加载卷积脉冲响应失败:', err)
    }
  }

  async function clearImpulseResponse(): Promise<void> {
    try {
      await window.api.audioEngine.unloadImpulseResponse()
      audioProcessing.value = await window.api.audioEngine.getAudioProcessing()
      playbackInfo.value = normalizeNativePlaybackInfo(
        await window.api.audioEngine.getPlaybackInfo()
      )
    } catch (err) {
      audioEngineError.value = err instanceof Error ? err.message : String(err)
      console.error('[音频引擎] 卸载卷积脉冲响应失败:', err)
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
    audioEngineReady,
    audioEngineError,
    exclusiveMode,
    audioOutput,
    audioDevice,
    audioOutputOptions,
    audioDeviceOptions,
    audioProcessing,
    audioOutputConfig,
    playbackInfo,
    outputInfo,
    cyclePlayMode,
    playTrack,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleExclusiveMode,
    setAudioOutput,
    setAudioDevice,
    setAudioOutputConfig,
    setAudioProcessing,
    toggleDspEnabled,
    toggleEqEnabled,
    toggleCrossfeed,
    toggleGapless,
    setReplayGainMode,
    setCrossfeedStrength,
    selectImpulseResponse,
    clearImpulseResponse,
    restorePlaybackSession,
    createPlaybackSession,
    formatTime
  }
}
