import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import type { PlaybackSession, Track } from '../types/music'
import type {
  AudioDeviceOption,
  AudioOutputId,
  AudioOutputOption,
  AudioProcessingSettings,
  OutputConfig,
  PlaybackResumeMode,
  PlayMode
} from '../types/settings'
import { extractDominantColor } from '../utils/colorExtractor'
import {
  shouldReuseResolvedStreamUrl,
  shouldUseNativePlaybackTarget
} from '../utils/playbackRouting'
import { findPlaybackFallbackTrack } from '../utils/playbackFallback.ts'
import { findProviderRematchCandidate } from '../utils/libraryRepair.ts'
import { resolveLyricsWithSources } from '../utils/lyricSourceResolution.ts'
import { syncPluginProviders, useMediaProviders } from '../providers'
import { useSettingsStore } from './useSettingsStore'
import { useMusicStore } from './useMusicStore'

type NativePlaybackInfo = Awaited<ReturnType<typeof window.api.audioEngine.getPlaybackInfo>>
type NativeOutputInfo = NativePlaybackInfo['outputInfo']
type NativeVisualizationData = Awaited<
  ReturnType<typeof window.api.audioEngine.getVisualizationData>
>
type ProviderSourceReliability = Record<string, number>

interface AudioOutputState {
  output: AudioOutputId
  device: string
  exclusiveMode: boolean
  exclusiveAvailable: boolean
  outputOptions: AudioOutputOption[]
  deviceOptions: AudioDeviceOption[]
}

export interface AudioEngineRecoveryNotice {
  kind: 'service-crash' | 'service-ready'
  message: string
  actionLabel?: string
  canResume?: boolean
}

const FALLBACK_AUDIO_OUTPUT_OPTIONS: AudioOutputOption[] = [
  {
    id: 'wasapi',
    label: 'WASAPI',
    description: 'Windows 原生音频输出',
    platform: 'win32',
    supportsExclusive: true
  },
  {
    id: 'asio',
    label: 'ASIO',
    description: '专业声卡驱动输出',
    platform: 'win32',
    supportsExclusive: true
  },
  {
    id: 'coreaudio',
    label: 'CoreAudio',
    description: 'macOS 原生音频输出',
    platform: 'darwin',
    supportsExclusive: true
  },
  {
    id: 'alsa',
    label: 'ALSA',
    description: 'Linux 原生音频输出',
    platform: 'linux',
    supportsExclusive: false
  }
]

const DEFAULT_AUDIO_DEVICE_OPTION: AudioDeviceOption = {
  id: 'auto',
  label: '系统默认',
  isDefault: true
}

function getRendererPlatform(): NodeJS.Platform {
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('mac')) return 'darwin'
  if (platform.includes('linux')) return 'linux'
  return 'win32'
}

function getFallbackAudioOutputOptions(): AudioOutputOption[] {
  return FALLBACK_AUDIO_OUTPUT_OPTIONS.filter((option) => option.platform === getRendererPlatform())
}

function getFallbackAudioOutput(): AudioOutputId {
  return getFallbackAudioOutputOptions()[0]?.id ?? 'alsa'
}

function formatAudioDeviceLabel(device: string): string {
  return device === 'auto' ? DEFAULT_AUDIO_DEVICE_OPTION.label : device
}

function normalizeAudioOutputOptions(
  options: AudioOutputOption[],
  selectedOutput: AudioOutputId
): AudioOutputOption[] {
  const fallbackOptions = getFallbackAudioOutputOptions()
  const sourceOptions = Array.isArray(options) && options.length > 0 ? options : fallbackOptions
  const fallbackById = new Map(fallbackOptions.map((option) => [option.id, option]))
  const normalized = sourceOptions
    .filter((option) => option?.id && option?.label)
    .map((option) => ({
      ...option,
      description: fallbackById.get(option.id)?.description ?? option.description
    }))

  if (!normalized.some((option) => option.id === selectedOutput)) {
    const fallback = fallbackOptions.find((option) => option.id === selectedOutput)
    if (fallback) normalized.push(fallback)
  }

  return normalized.length > 0 ? normalized : fallbackOptions
}

function normalizeAudioDeviceOptions(
  options: AudioDeviceOption[],
  selectedDevice: string
): AudioDeviceOption[] {
  const normalized: AudioDeviceOption[] = []
  const seen = new Set<string>()

  function addOption(option: unknown): void {
    if (typeof option === 'string') {
      const id = option.trim()
      if (!id || seen.has(id)) return
      seen.add(id)
      normalized.push({ id, label: formatAudioDeviceLabel(id), isDefault: id === 'auto' })
      return
    }

    if (!option || typeof option !== 'object') return
    const record = option as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id || seen.has(id)) return
    const rawLabel = typeof record.label === 'string' ? record.label.trim() : ''
    seen.add(id)
    normalized.push({
      ...(record as Partial<AudioDeviceOption>),
      id,
      label: id === 'auto' ? DEFAULT_AUDIO_DEVICE_OPTION.label : rawLabel || id,
      isDefault: record.isDefault === true
    })
  }

  const sourceOptions = Array.isArray(options) ? (options as unknown[]) : []
  for (const option of sourceOptions) {
    addOption(option)
  }

  if (!seen.has(DEFAULT_AUDIO_DEVICE_OPTION.id)) {
    normalized.unshift(DEFAULT_AUDIO_DEVICE_OPTION)
    seen.add(DEFAULT_AUDIO_DEVICE_OPTION.id)
  }

  if (selectedDevice && !seen.has(selectedDevice)) {
    normalized.push({
      id: selectedDevice,
      label: formatAudioDeviceLabel(selectedDevice),
      isDefault: selectedDevice === 'auto'
    })
  }

  return normalized
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
const audioEngineRecoveryNotice = ref<AudioEngineRecoveryNotice | null>(null)
const exclusiveMode = ref(false)
// Tracks whether the in-PlayingMusic audio visualizer surface is active.
// App.vue reads this to hide the PlayerBar while the visualizer is open.
const visualizerActive = ref(false)
const audioOutput = ref<AudioOutputId>(getFallbackAudioOutput())
const audioDevice = ref('auto')
const audioOutputOptions = ref<AudioOutputOption[]>(getFallbackAudioOutputOptions())
const audioDeviceOptions = ref<AudioDeviceOption[]>([DEFAULT_AUDIO_DEVICE_OPTION])
const defaultAudioProcessing: AudioProcessingSettings = {
  dspEnabled: false,
  clipGuard: true,
  fftEnabled: true,
  fftResolution: 8192,
  highResolution: true,
  dsdToPcm: false,
  dsdOutputMode: 'auto',
  sacdProgramMode: 'auto',
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
  convolverEnabled: false,
  convolverIrPath: '',
  crossfeedEnabled: false,
  crossfeedStrength: 0,
  crossfeedDelayMs: 0.35,
  crossfeedCutoffHz: 700,
  gapless: true,
  crossfadeSeconds: 0
}
const audioProcessing = ref<AudioProcessingSettings>({ ...defaultAudioProcessing })
const defaultAudioOutputConfig: OutputConfig = {
  preferredBufferSize: 0,
  routingMode: 'auto',
  wasapiExclusivePushMode: false
}
const audioOutputConfig = ref<OutputConfig>({ ...defaultAudioOutputConfig })
const playbackInfo = ref<NativePlaybackInfo | null>(null)
const outputInfo = computed<NativeOutputInfo | null>(() => playbackInfo.value?.outputInfo ?? null)
const visualizationOptions = {
  spectrumPoints: 64,
  waveformPoints: 48,
  spectrogramFrames: 32,
  oscilloscopePoints: 512
} as const
const createInactiveVisualizationData = (): NativeVisualizationData => ({
  spectrum: Array.from({ length: visualizationOptions.spectrumPoints }, () => 0),
  waveform: Array.from({ length: visualizationOptions.waveformPoints }, () => 0),
  oscilloscope: Array.from({ length: visualizationOptions.oscilloscopePoints }, () => 0),
  peakDb: -120,
  rmsDb: -120,
  lufsMomentary: null,
  spectrogram: [],
  sampleRate: 0,
  maxFrequency: 20000,
  active: false,
  tapStatus: 'stopped',
  reason: ''
})
const visualizationData = ref<NativeVisualizationData>(createInactiveVisualizationData())
const { settings: appSettings, updateSettings } = useSettingsStore()
let playbackAudio: HTMLAudioElement | null = null
let playbackObjectUrl: string | null = null
let nativePlaybackActive = false
let nativeQueueDelegated = false
let activeLoadToken = 0
let rendererFallbackInProgress = false
let rendererPlaybackWatchdogTimer: number | null = null
const RENDERER_PLAYBACK_WATCHDOG_MS = 220
const PLAYBACK_TOGGLE_INTENT_GRACE_MS = 300
const NATIVE_PLAYBACK_INFO_INTENT_GRACE_MS = 2500
let playbackToggleIntent: { playing: boolean; expiresAt: number } | null = null
let nativePlaybackInfoIntent: {
  loadToken: number
  trackId: string
  queueIndex: number
  source: string
  expiresAt: number
} | null = null

function isActiveLoad(loadToken: number, track: Track): boolean {
  return loadToken === activeLoadToken && currentTrack.value?.id === track.id
}

function clearRendererPlaybackWatchdog(): void {
  if (rendererPlaybackWatchdogTimer !== null) {
    window.clearTimeout(rendererPlaybackWatchdogTimer)
    rendererPlaybackWatchdogTimer = null
  }
}

function setNativePlaybackInfoIntent(loadToken: number, track: Track, source = ''): void {
  nativePlaybackInfoIntent = {
    loadToken,
    trackId: track.id,
    queueIndex: queueIndex.value,
    source,
    expiresAt: getNowMs() + NATIVE_PLAYBACK_INFO_INTENT_GRACE_MS
  }
}

function clearNativePlaybackInfoIntent(): void {
  nativePlaybackInfoIntent = null
}

function clearNativePlaybackInfoIntentForLoad(loadToken: number): void {
  if (nativePlaybackInfoIntent?.loadToken === loadToken) {
    clearNativePlaybackInfoIntent()
  }
}

function nativePlaybackInfoMatchesIntent(info: NativePlaybackInfo, infoIndex: number): boolean {
  const intent = nativePlaybackInfoIntent
  if (!intent) return true
  const indexedTrack = infoIndex >= 0 ? queue.value[infoIndex] : null
  if (indexedTrack?.id === intent.trackId) return true

  const source = typeof info.source === 'string' ? info.source.trim() : ''
  return source.length > 0 && (source === intent.source || source === intent.trackId)
}

function shouldIgnoreNativePlaybackInfo(info: NativePlaybackInfo, infoIndex: number): boolean {
  if (!nativePlaybackInfoIntent) return false
  if (getNowMs() > nativePlaybackInfoIntent.expiresAt) {
    clearNativePlaybackInfoIntent()
    return false
  }
  return !nativePlaybackInfoMatchesIntent(info, infoIndex)
}

function setPlaybackToggleIntent(playing: boolean): void {
  playbackToggleIntent = {
    playing,
    expiresAt: getNowMs() + PLAYBACK_TOGGLE_INTENT_GRACE_MS
  }
}

function clearPlaybackToggleIntent(): void {
  playbackToggleIntent = null
}

function applyNativePlayingState(playing: boolean): void {
  if (playbackToggleIntent) {
    if (getNowMs() > playbackToggleIntent.expiresAt) {
      clearPlaybackToggleIntent()
    } else if (playing !== playbackToggleIntent.playing) {
      return
    }
  }

  isPlaying.value = playing
}

function scheduleRendererPlaybackWatchdog(track: Track, loadToken: number): void {
  clearRendererPlaybackWatchdog()
  rendererPlaybackWatchdogTimer = window.setTimeout(async () => {
    rendererPlaybackWatchdogTimer = null
    if (!isActiveLoad(loadToken, track) || nativePlaybackActive) return

    const audio = playbackAudio
    if (!audio || !audio.src || !audio.paused || audio.ended) return

    try {
      await audio.play()
    } catch (err) {
      if (!isActiveLoad(loadToken, track)) return
      console.warn('[audio-engine] Renderer playback watchdog retry failed:', err)
    }
  }, RENDERER_PLAYBACK_WATCHDOG_MS)
}

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
    const message = `Audio playback failed (code ${code})`
    console.error('[audio-engine] Renderer audio error:', {
      code,
      message: audio.error?.message ?? '',
      src: audio.src ? audio.src.slice(0, 120) : ''
    })
    // Renderer (non-native) playback failed — attempt cross-source fallback
    // before surfacing the error. loadAndPlay's catch block already handles
    // failures during initial load; this covers mid-stream CDN drops / 403 /
    // decode errors that occur after playback has started.
    const track = currentTrack.value
    if (track && !nativePlaybackActive && !rendererFallbackInProgress) {
      rendererFallbackInProgress = true
      void handlePlaybackFallback(track, new Error(message), activeLoadToken).then((handled) => {
        rendererFallbackInProgress = false
        if (!handled) {
          audioEngineError.value = message
          isPlaying.value = false
          isLoading.value = false
        }
      })
      return
    }
    audioEngineError.value = message
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
  clearRendererPlaybackWatchdog()
  if (!playbackAudio) return
  playbackAudio.pause()
  if (clearSource) {
    playbackAudio.removeAttribute('src')
    playbackAudio.load()
    releasePlaybackObjectUrl()
  }
}

function resetPlaybackRuntimeStateForRestore(): void {
  activeLoadToken += 1
  nativePlaybackActive = false
  nativeQueueDelegated = false
  loadedTrackId = ''
  playbackInfo.value = null
  clearNativePlaybackInfoIntent()
  clearPlaybackToggleIntent()
  stopVisualizationPolling(true)
  stopRendererAudio(true)
  void stopNativeAudio()
}

function seekRendererAudioWhenReady(
  audio: HTMLAudioElement,
  startTime: number,
  track: Track,
  loadToken: number
): void {
  const targetTime = Math.max(0, Number.isFinite(startTime) ? startTime : 0)
  if (targetTime <= 0) return

  const applySeek = (): void => {
    if (!isActiveLoad(loadToken, track)) return
    try {
      audio.currentTime = targetTime
    } catch (err) {
      console.warn('[audio-engine] Failed to restore renderer playback position:', err)
    }
  }

  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    applySeek()
    return
  }

  audio.addEventListener('loadedmetadata', applySeek, { once: true })
}

async function stopNativeAudio(): Promise<void> {
  nativeQueueDelegated = false
  try {
    await window.api.audioEngine.stop()
  } catch {
    // The renderer audio fallback can still continue if the native bridge is unavailable.
  }
}

function shouldUseNativePlayback(track: Track, target: string): boolean {
  return shouldUseNativePlaybackTarget(getTrackSource(track), target)
}

function canUseNativeQueuePlayback(): boolean {
  return (
    queue.value.length > 0 &&
    queue.value.every((track) => shouldUseNativePlayback(track, getTrackAudioSource(track)))
  )
}

function isNativeQueueDelegated(): boolean {
  return nativeQueueDelegated && canUseNativeQueuePlayback()
}

async function createPlayableUrl(
  target: string,
  track: Track,
  loadToken: number
): Promise<string | null> {
  if (/^https?:\/\//i.test(target) || /^blob:/i.test(target) || /^data:/i.test(target)) {
    if (!isActiveLoad(loadToken, track)) return null
    releasePlaybackObjectUrl()
    return target
  }

  const fileUrl = await window.api.fs.getAudioFileUrl(target)
  if (!isActiveLoad(loadToken, track)) return null
  releasePlaybackObjectUrl()
  if (!duration.value && track.duration) {
    duration.value = track.duration
  }
  return fileUrl
}

async function playWithRendererAudio(
  track: Track,
  target: string,
  startTime: number,
  loadToken: number
): Promise<boolean> {
  const audio = getPlaybackAudio()
  audio.pause()
  if (!isActiveLoad(loadToken, track)) return false

  const playableUrl = await createPlayableUrl(target, track, loadToken)
  if (!playableUrl || !isActiveLoad(loadToken, track)) return false

  audio.src = playableUrl
  audio.volume = volume.value
  if (!isActiveLoad(loadToken, track)) return false

  seekRendererAudioWhenReady(audio, startTime, track, loadToken)
  if (!isActiveLoad(loadToken, track)) return false

  try {
    await audio.play()
  } catch (err) {
    if (!isActiveLoad(loadToken, track)) return false

    await new Promise((resolve) => window.setTimeout(resolve, 140))
    if (!isActiveLoad(loadToken, track)) return false

    try {
      await audio.play()
    } catch {
      console.error('[audio-engine] Renderer audio play failed:', {
        message: err instanceof Error ? err.message : String(err),
        src: audio.src ? audio.src.slice(0, 120) : ''
      })
      throw err
    }
  }

  return isActiveLoad(loadToken, track)
}

function applyAudioOutputState(state: AudioOutputState): void {
  exclusiveMode.value = state.exclusiveMode
  audioOutput.value = state.output
  audioDevice.value = state.device
  audioOutputOptions.value = normalizeAudioOutputOptions(state.outputOptions, state.output)
  audioDeviceOptions.value = normalizeAudioDeviceOptions(state.deviceOptions, state.device)
}

let audioEngineStateRequest: Promise<void> | null = null

async function refreshAudioOutputState(): Promise<void> {
  if (audioEngineStateRequest) return audioEngineStateRequest
  const api = window.api?.audioEngine
  if (!api) return

  audioEngineStateRequest = (async () => {
    try {
      const [outputState, processingSettings] = await Promise.all([
        api.getAudioOutputState(),
        api.getAudioProcessing()
      ])
      applyAudioOutputState(outputState)
      audioProcessing.value = processingSettings
      audioEngineReady.value = true
      audioEngineError.value = null
    } catch (err) {
      audioEngineReady.value = false
      console.warn('[audio-engine] Failed to refresh audio output state:', err)
    } finally {
      audioEngineStateRequest = null
    }
  })()

  return audioEngineStateRequest
}

function cloneAudioProcessingSettings(settings: AudioProcessingSettings): AudioProcessingSettings {
  return {
    ...settings,
    eqBands: settings.eqBands.map((band) => ({ ...band }))
  }
}

function mergeAudioProcessingPatch(
  patch: Partial<AudioProcessingSettings>
): AudioProcessingSettings {
  return cloneAudioProcessingSettings({
    ...audioProcessing.value,
    ...patch,
    eqBands: patch.eqBands ?? audioProcessing.value.eqBands
  })
}

async function persistAudioProcessingFallback(
  nextSettings: AudioProcessingSettings,
  reason: unknown
): Promise<void> {
  audioEngineError.value = reason instanceof Error ? reason.message : String(reason)
  try {
    const savedSettings = await updateSettings({ audioProcessing: nextSettings })
    audioProcessing.value = cloneAudioProcessingSettings(savedSettings.audioProcessing)
  } catch (err) {
    audioEngineError.value = err instanceof Error ? err.message : String(err)
    console.error('[audio-engine] Failed to persist audio processing fallback:', err)
  }
}

function normalizeDsdState(
  canonicalOutput?: Partial<NativeOutputInfo> | null,
  mirror?: Partial<NativePlaybackInfo> | null
): { isDsd: boolean; dsdMode: string; dsdRate: number } {
  const canonicalMode =
    typeof canonicalOutput?.dsdMode === 'string' ? canonicalOutput.dsdMode.trim() : ''
  const mirrorMode = typeof mirror?.dsdMode === 'string' ? mirror.dsdMode.trim() : ''
  const canonicalHasMode = canonicalMode.length > 0
  const modeIndicatesDsd = (mode: string): boolean =>
    mode === 'native' || mode === 'dop' || mode === 'unsupported'
  const canonicalIsDsd =
    typeof canonicalOutput?.isDsd === 'boolean'
      ? canonicalOutput.isDsd
      : canonicalHasMode
        ? modeIndicatesDsd(canonicalMode)
        : undefined
  const isDsd = canonicalIsDsd ?? (mirror?.isDsd === true || modeIndicatesDsd(mirrorMode))
  const rawMode = canonicalHasMode ? canonicalMode : mirrorMode
  const dsdMode = isDsd ? rawMode || 'unsupported' : 'pcm'
  const dsdRate = isDsd ? (canonicalOutput?.dsdRate ?? mirror?.dsdRate ?? 0) : 0
  return { isDsd, dsdMode, dsdRate }
}

function normalizeNativePlaybackInfo(info: NativePlaybackInfo): NativePlaybackInfo {
  const canonicalOutput = info.outputInfo
  const sourceExact = canonicalOutput?.sourceExact === true
  const outputPerfect = canonicalOutput?.outputPerfect === true
  const pcmPassthrough = canonicalOutput
    ? canonicalOutput.pcmPassthrough === true
    : info.pcmPassthrough === true
  const perfectReason = canonicalOutput?.perfectReason || ''
  const perfectReasonCode = canonicalOutput?.perfectReasonCode || ''
  const capabilityReason = canonicalOutput?.capabilityReason || ''
  const { isDsd, dsdMode, dsdRate } = normalizeDsdState(canonicalOutput, info)
  return {
    ...info,
    outputInfo: {
      ...canonicalOutput,
      actualBackend: canonicalOutput?.actualBackend || info.actualBackend || '',
      accessMode: canonicalOutput?.accessMode || info.accessMode || '',
      devicePathKind: canonicalOutput?.devicePathKind || info.devicePathKind || '',
      actualOutputFormat: canonicalOutput?.actualOutputFormat || info.actualOutputFormat || '',
      actualSampleRate: canonicalOutput?.actualSampleRate ?? info.actualSampleRate ?? 0,
      actualBitDepth: canonicalOutput?.actualBitDepth ?? info.actualBitDepth ?? 0,
      actualChannels: canonicalOutput?.actualChannels ?? info.actualChannels ?? 0,
      bufferSizeFrames: canonicalOutput?.bufferSizeFrames ?? info.bufferSizeFrames ?? 0,
      latencyFrames: canonicalOutput?.latencyFrames ?? info.latencyFrames ?? 0,
      latencyMs: canonicalOutput?.latencyMs ?? info.latencyMs ?? 0,
      latencyInfo: canonicalOutput?.latencyInfo ?? info.latencyInfo,
      channelRoutingMode: canonicalOutput?.channelRoutingMode || info.channelRoutingMode || 'auto',
      supportsOutputPerfect: canonicalOutput?.supportsOutputPerfect === true,
      sourceExact,
      diagnostics: canonicalOutput?.diagnostics ?? info.diagnostics,
      deviceRecovered: canonicalOutput?.deviceRecovered === true || info.deviceRecovered === true,
      recoveryCount: canonicalOutput?.recoveryCount ?? info.recoveryCount ?? 0,
      outputSampleRate: canonicalOutput?.outputSampleRate ?? info.outputSampleRate ?? 0,
      outputBitDepth: canonicalOutput?.outputBitDepth ?? info.outputBitDepth ?? 0,
      outputPerfect,
      pcmPassthrough,
      perfectReason,
      perfectReasonCode,
      capabilityReason,
      isDsd,
      dsdMode,
      dsdRate: isDsd ? dsdRate : 0
    },
    actualBackend: canonicalOutput?.actualBackend || info.actualBackend || '',
    accessMode: canonicalOutput?.accessMode || info.accessMode || '',
    devicePathKind: canonicalOutput?.devicePathKind || info.devicePathKind || '',
    actualOutputFormat: canonicalOutput?.actualOutputFormat || info.actualOutputFormat || '',
    actualSampleRate: canonicalOutput?.actualSampleRate ?? info.actualSampleRate ?? 0,
    actualBitDepth: canonicalOutput?.actualBitDepth ?? info.actualBitDepth ?? 0,
    actualChannels: canonicalOutput?.actualChannels ?? info.actualChannels ?? 0,
    bufferSizeFrames: canonicalOutput?.bufferSizeFrames ?? info.bufferSizeFrames ?? 0,
    latencyFrames: canonicalOutput?.latencyFrames ?? info.latencyFrames ?? 0,
    latencyMs: canonicalOutput?.latencyMs ?? info.latencyMs ?? 0,
    latencyInfo: canonicalOutput?.latencyInfo ?? info.latencyInfo,
    channelRoutingMode: canonicalOutput?.channelRoutingMode || info.channelRoutingMode || 'auto',
    supportsOutputPerfect: canonicalOutput?.supportsOutputPerfect === true,
    sourceExact,
    diagnostics: canonicalOutput?.diagnostics ?? info.diagnostics,
    deviceRecovered: canonicalOutput?.deviceRecovered === true || info.deviceRecovered === true,
    recoveryCount: canonicalOutput?.recoveryCount ?? info.recoveryCount ?? 0,
    outputSampleRate: canonicalOutput?.outputSampleRate ?? info.outputSampleRate ?? 0,
    outputBitDepth: canonicalOutput?.outputBitDepth ?? info.outputBitDepth ?? 0,
    outputPerfect,
    pcmPassthrough,
    perfectReason,
    perfectReasonCode,
    capabilityReason,
    isDsd,
    dsdMode,
    dsdRate
  }
}

function getTrackAudioSource(track: Track): string {
  return track.subTrack || track.streamUrl || track.filePath
}

function mergeTrackTransientData(nextTrack: Track, previousTrack: Track | null): Track {
  if (!previousTrack || previousTrack.id !== nextTrack.id) return nextTrack
  const lyrics = nextTrack.lyrics ?? previousTrack.lyrics
  const translatedLyrics = nextTrack.translatedLyrics ?? previousTrack.translatedLyrics
  if (lyrics === nextTrack.lyrics && translatedLyrics === nextTrack.translatedLyrics)
    return nextTrack
  return {
    ...nextTrack,
    lyrics,
    translatedLyrics
  }
}

function patchTrackInQueues(updatedTrack: Track): void {
  queue.value = queue.value.map((track) => (track.id === updatedTrack.id ? updatedTrack : track))
  originalQueue.value = originalQueue.value.map((track) =>
    track.id === updatedTrack.id ? updatedTrack : track
  )
}

function findTrackIndexFromPlaybackInfo(info: NativePlaybackInfo): number {
  if (
    Number.isInteger(info.queueIndex) &&
    info.queueIndex >= 0 &&
    info.queueIndex < queue.value.length
  ) {
    // 验证 queueIndex 指向的曲目与原生引擎实际播放的 source 一致。
    // 队列重排（如切换 shuffle 模式）后，原生引擎可能仍报告旧 index，
    // 旧 index 在新队列中可能指向不同曲目。
    const trackAt = queue.value[info.queueIndex]
    const source = typeof info.source === 'string' ? info.source.trim() : ''
    if (trackAt && source.length > 0) {
      if (getTrackAudioSource(trackAt) === source || trackAt.id === source) {
        return info.queueIndex
      }
      // queueIndex 与 source 不匹配，队列可能已被重排，回退到 source 查找
    } else if (trackAt && !source) {
      return info.queueIndex
    }
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
  if (shouldIgnoreNativePlaybackInfo(info, infoIndex)) return
  if (nativePlaybackInfoIntent && nativePlaybackInfoMatchesIntent(info, infoIndex)) {
    clearNativePlaybackInfoIntent()
  }
  let switchedTrack = false

  if (infoIndex >= 0) {
    const track = queue.value[infoIndex]
    switchedTrack = currentTrack.value?.id !== track.id
    const mergedTrack = mergeTrackTransientData(track, currentTrack.value)
    queueIndex.value = infoIndex
    if (mergedTrack !== track) {
      queue.value = queue.value.map((item, index) => (index === infoIndex ? mergedTrack : item))
    }
    currentTrack.value = mergedTrack
    loadedTrackId = mergedTrack.id
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

  applyNativePlayingState(normalizedInfo.state === 'playing')
  isLoading.value = false
  if (normalizedInfo.state === 'stopped') {
    if (info.nativePlaybackActive === false) {
      nativePlaybackActive = false
    }
  }
  autoAdvanceInFlight = false
  advancingFromEndedTrackId = ''
  restoredPlaybackPending = false
  restoredPlaybackPosition = 0
  pendingLoadStartTime = 0
  scheduleCrossfadeIfNeeded()
}

async function syncNativeQueueState(): Promise<void> {
  if (!canUseNativeQueuePlayback()) {
    await stopNativeAudio()
    return
  }

  const engineQueue = queue.value.map((item) => ({
    id: item.id,
    duration: item.duration,
    source: getTrackAudioSource(item),
    format: item.format,
    sampleRate: item.sampleRate,
    bitrate: item.bitrate,
    bitDepth: item.bitDepth
  }))
  await window.api.audioEngine.loadQueue(engineQueue, Math.max(0, queueIndex.value))
  const nativePlayMode = playMode.value === 'repeat' ? 'repeat' : 'sequential'
  await window.api.audioEngine.setPlayMode(nativePlayMode)
}

function queueNativeQueueStateSync(): Promise<void> {
  const previousRequest = nativeQueueSyncRequest
  const request = (previousRequest ?? Promise.resolve())
    .catch(() => {})
    .then(() => syncNativeQueueState())

  nativeQueueSyncRequest = request
  void request.finally(() => {
    if (nativeQueueSyncRequest === request) {
      nativeQueueSyncRequest = null
    }
  })

  return request
}

async function waitForNativeQueueStateSync(): Promise<void> {
  const request = nativeQueueSyncRequest
  if (request) {
    await request
  }
}

async function advanceNativePlayback(direction: 'next' | 'previous'): Promise<void> {
  clearNativePlaybackInfoIntent()
  stopVisualizationPolling(false)
  try {
    isLoading.value = true
    await waitForNativeQueueStateSync()
    if (direction === 'next') {
      await window.api.audioEngine.next()
    } else {
      await window.api.audioEngine.previous()
    }
    await new Promise((resolve) => window.setTimeout(resolve, 80))
    const info = await window.api.audioEngine.getPlaybackInfo()
    applyNativePlaybackInfo(info)
    const track = currentTrack.value
    if (track && info.state !== 'playing') {
      nativePlaybackActive = false
      await loadAndPlay(track)
    }
  } catch (err) {
    audioEngineError.value = err instanceof Error ? err.message : String(err)
    console.error('[音频引擎] 切换歌曲失败:', err)
    isLoading.value = false
  } finally {
    if (isPlaying.value && currentTrack.value) startVisualizationPolling()
  }
}

watch(volume, (val) => {
  if (playbackAudio) playbackAudio.volume = val
  window.api.audioEngine.setVolume(val).catch(() => {})
})

watch(
  [() => currentTrack.value?.cover, () => appSettings.value?.useCoverTheme],
  async ([cover, useCoverTheme]) => {
    if (!useCoverTheme) {
      dominantColor.value = '#7c4dff'
      return
    }

    if (cover) {
      // cover:// and http(s): URLs can be loaded directly by Image
      dominantColor.value = await extractDominantColor(cover)
    } else {
      dominantColor.value = '#1a73e8'
    }
  }
)

watch(
  () => appSettings.value?.audioOutputConfig,
  (config) => {
    audioOutputConfig.value = {
      preferredBufferSize:
        config?.preferredBufferSize ?? defaultAudioOutputConfig.preferredBufferSize,
      routingMode: config?.routingMode ?? defaultAudioOutputConfig.routingMode,
      wasapiExclusivePushMode:
        config?.wasapiExclusivePushMode ?? defaultAudioOutputConfig.wasapiExclusivePushMode,
      upmixCenterGain: config?.upmixCenterGain ?? defaultAudioOutputConfig.upmixCenterGain,
      upmixLfeGain: config?.upmixLfeGain ?? defaultAudioOutputConfig.upmixLfeGain,
      upmixLfeLowpassHz: config?.upmixLfeLowpassHz ?? defaultAudioOutputConfig.upmixLfeLowpassHz,
      upmixSurroundGain: config?.upmixSurroundGain ?? defaultAudioOutputConfig.upmixSurroundGain,
      upmixSideGain: config?.upmixSideGain ?? defaultAudioOutputConfig.upmixSideGain,
      upmixSurroundDelayMs:
        config?.upmixSurroundDelayMs ?? defaultAudioOutputConfig.upmixSurroundDelayMs
    }
  },
  { deep: true, immediate: true }
)

watch(
  () =>
    [
      currentTrack.value?.id,
      currentTrack.value?.lyrics,
      currentTrack.value?.translatedLyrics
    ] as const,
  async ([id], [prevId]) => {
    const track = currentTrack.value
    if (!track || track.id !== id) return

    await ensureCurrentTrackLyricsLoaded(track, track.id !== prevId)
  }
)

const cleanupFns: (() => void)[] = []
let listenersSetup = false
let crossfadeTimer: number | null = null
let visualizationTimer: number | null = null
let visualizationRequestInFlight = false
let visualizationPollingGeneration = 0
let crossfadeTrackId = ''
const TIME_UPDATE_INTERVAL_MS = 250
const VISUALIZATION_UPDATE_INTERVAL_MS = 200
let latestPlaybackTime = 0
let lastTimePublishAt = 0
let pendingTimePublishTimer: number | null = null
let advancingFromEndedTrackId = ''
let autoAdvanceInFlight = false
let loadedTrackId = ''
let restoredPlaybackPending = false
let restoredPlaybackPosition = 0
let pendingLoadStartTime = 0
let nativeQueueSyncRequest: Promise<void> | null = null

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

function setAudioServiceCrashNotice(reason: string): void {
  const message = reason.trim()
  const prefix = message.startsWith('音频服务已重启') ? message : `音频服务已重启：${message || '未知原因'}`
  audioEngineRecoveryNotice.value = {
    kind: 'service-crash',
    message: `${prefix}。正在恢复音频服务，恢复后不会自动续播。`,
    actionLabel: '稍后手动继续'
  }
}

function setAudioServiceReadyNotice(event?: {
  outputRouteSynced?: boolean
  restoreErrors?: string[]
}): void {
  const outputRouteSynced = event?.outputRouteSynced !== false
  const restoreErrors = Array.isArray(event?.restoreErrors)
    ? event.restoreErrors.filter((item) => item.trim())
    : []
  const detail = restoreErrors.length > 0 ? `（${restoreErrors.join('；')}）` : ''
  audioEngineRecoveryNotice.value = {
    kind: 'service-ready',
    message: outputRouteSynced
      ? '音频服务已恢复，播放已停止，可手动继续。'
      : `音频服务已恢复，但输出设备/后端未完全恢复${detail}。请重新选择输出设备后继续。`,
    actionLabel: outputRouteSynced ? '继续播放' : undefined,
    canResume: outputRouteSynced
  }
}

async function refreshVisualizationData(): Promise<void> {
  if (visualizationRequestInFlight) return
  const requestGeneration = visualizationPollingGeneration
  visualizationRequestInFlight = true
  try {
    const nextVisualizationData =
      await window.api.audioEngine.getVisualizationData(visualizationOptions)
    if (requestGeneration !== visualizationPollingGeneration) return
    visualizationData.value = nextVisualizationData
  } catch {
    if (requestGeneration !== visualizationPollingGeneration) return
    visualizationData.value = createInactiveVisualizationData()
  } finally {
    visualizationRequestInFlight = false
  }
}

function stopVisualizationPolling(clearData = false): void {
  visualizationPollingGeneration += 1
  if (visualizationTimer !== null) {
    window.clearInterval(visualizationTimer)
    visualizationTimer = null
  }
  if (clearData) {
    visualizationData.value = createInactiveVisualizationData()
  }
}

function startVisualizationPolling(): void {
  if (visualizerActive.value) return
  if (visualizationTimer !== null) return
  void refreshVisualizationData()
  visualizationTimer = window.setInterval(
    () => void refreshVisualizationData(),
    VISUALIZATION_UPDATE_INTERVAL_MS
  )
}

function handlePlaybackEnded(): void {
  const trackId = currentTrack.value?.id ?? ''
  if (!trackId || autoAdvanceInFlight || advancingFromEndedTrackId === trackId) return
  advancingFromEndedTrackId = trackId
  autoAdvanceInFlight = true
  flushLatestCurrentTime()
  if (playMode.value === 'repeat') {
    const track = currentTrack.value
    if (track) void loadAndPlay(track)
    return
  }
  next()
}

function getTrackSource(track: Track): string {
  if (track.source) return track.source
  if (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)) return 'local'
  const separatorIndex = track.id.indexOf(':')
  return separatorIndex > 0 ? track.id.slice(0, separatorIndex) : 'local'
}

async function ensureCurrentTrackLyricsLoaded(
  triggerTrack: Track | null = currentTrack.value,
  allowProviderLookup = true
): Promise<void> {
  if (!triggerTrack) return

  const source = getTrackSource(triggerTrack)
  const canLoadLocalLyrics =
    source === 'local' &&
    triggerTrack.lyrics == null &&
    !!triggerTrack.dir &&
    !!triggerTrack.fileName
  const canLoadProviderLyrics =
    allowProviderLookup && (triggerTrack.lyrics == null || triggerTrack.translatedLyrics == null)
  if (!canLoadLocalLyrics && !canLoadProviderLyrics) return

  const resolved = await resolveLyricsWithSources({
    track: triggerTrack,
    loadLocalLyrics: canLoadLocalLyrics
      ? () =>
          window.api.data
            .getLyrics(triggerTrack.dir!, triggerTrack.fileName, triggerTrack.filePath)
            .catch(() => null)
      : undefined,
    loadProviderLyrics: canLoadProviderLyrics
      ? async () => {
          await syncPluginProviders()
          return useMediaProviders().resolveLyrics(triggerTrack)
        }
      : undefined
  })

  if (currentTrack.value?.id !== triggerTrack.id) return
  const updatedTrack = {
    ...currentTrack.value,
    lyrics: resolved.lyrics ?? '',
    translatedLyrics: resolved.translatedLyrics ?? currentTrack.value.translatedLyrics ?? null,
    lyricsSource: resolved.lyricsSource,
    translatedLyricsSource: resolved.translatedLyricsSource
  }
  currentTrack.value = updatedTrack
  patchTrackInQueues(updatedTrack)
}

async function resolvePlayTarget(track: Track): Promise<string> {
  const source = getTrackSource(track)
  if (source === 'local') {
    return track.filePath
  }

  if (track.streamUrl && shouldReuseResolvedStreamUrl(source)) {
    return track.streamUrl
  }

  await syncPluginProviders()
  const streamUrl = await useMediaProviders().resolvePlaybackUrl(track)
  if (!streamUrl) {
    throw new Error(`Unable to resolve ${source} stream URL`)
  }

  track.streamUrl = streamUrl
  return streamUrl
}

async function handlePlaybackFallback(
  failedTrack: Track,
  reason: unknown,
  loadToken: number
): Promise<boolean> {
  if (!isActiveLoad(loadToken, failedTrack)) return false
  const failedSource = getTrackSource(failedTrack)
  const fallback = findPlaybackFallbackTrack({
    failedTrack,
    candidates: queue.value,
    unavailableSources: [failedSource],
    sourceReliability: getProviderSourceReliability()
  })
  if (!fallback) return await handleProviderRematchFallback(failedTrack, loadToken)

  audioEngineError.value = `播放 ${failedTrack.title || '当前曲目'} 失败，已尝试切换到 ${fallback.source ?? getTrackSource(fallback)} 来源：${reason instanceof Error ? reason.message : String(reason)}`
  nativePlaybackActive = false
  loadedTrackId = ''
  stopVisualizationPolling(true)
  stopRendererAudio(true)

  queue.value = queue.value.map((track) => (track.id === failedTrack.id ? fallback : track))
  originalQueue.value = originalQueue.value.map((track) =>
    track.id === failedTrack.id ? fallback : track
  )
  queueIndex.value = queue.value.findIndex((track) => track.id === fallback.id)
  if (queueIndex.value < 0) queueIndex.value = 0
  currentTrack.value = fallback
  void loadAndPlay(fallback)
  return true
}

function getProviderSourceReliability(): ProviderSourceReliability {
  const reliability: ProviderSourceReliability = {}
  for (const provider of useMediaProviders().list()) {
    const playbackUrlRate = provider.health?.methodStats?.getPlaybackUrl?.successRate
    const successRate =
      typeof playbackUrlRate === 'number' ? playbackUrlRate : provider.health?.successRate
    reliability[provider.id] = clampProviderReliability(successRate)
  }
  return reliability
}

function clampProviderReliability(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

async function handleProviderRematchFallback(
  failedTrack: Track,
  loadToken: number
): Promise<boolean> {
  if (!isActiveLoad(loadToken, failedTrack)) return false
  const failedSource = getTrackSource(failedTrack)

  await syncPluginProviders()
  const searchResult = await useMediaProviders().searchAllSongs({
    query: [failedTrack.title, failedTrack.artist].filter(Boolean).join(' '),
    localTracks: queue.value
  })
  const candidates = searchResult.items
    .map((item) => item.track)
    .filter((track) =>
      failedSource === 'local'
        ? getTrackSource(track) !== 'local'
        : getTrackSource(track) !== failedSource || track.id !== failedTrack.id
    )
  const rematched = findProviderRematchCandidate(failedTrack, candidates)
  if (!rematched || !isActiveLoad(loadToken, failedTrack)) return false

  audioEngineError.value = `播放 ${failedTrack.title || '当前曲目'} 失败，已重新匹配到 ${rematched.source ?? getTrackSource(rematched)} 来源`
  nativePlaybackActive = false
  loadedTrackId = ''
  stopVisualizationPolling(true)
  stopRendererAudio(true)

  queue.value = queue.value.map((track) => (track.id === failedTrack.id ? rematched : track))
  originalQueue.value = originalQueue.value.map((track) =>
    track.id === failedTrack.id ? rematched : track
  )
  queueIndex.value = queue.value.findIndex((track) => track.id === rematched.id)
  if (queueIndex.value < 0) queueIndex.value = 0
  currentTrack.value = rematched
  // Persist the rematch so playlists/library references to the expired
  // provider track are replaced — not just the transient playback queue.
  useMusicStore().replaceTrackReference(failedTrack.id, rematched)
  void loadAndPlay(rematched)
  return true
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
          if (!nativePlaybackActive) break
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
          if (!nativePlaybackActive) break
          applyNativePlayingState(!data)
          flushLatestCurrentTime()
          break
        case 'eof-reached':
          // Native handles auto-advance internally, so we don't trigger it here to avoid double-transition.
          break
      }
      if (name === 'time-pos' || name === 'duration') {
        scheduleCrossfadeIfNeeded()
      }
    })
  )

  cleanupFns.push(
    api.onEndFile((reason) => {
      if (nativePlaybackActive && reason === 'eof') {
        // Native handles auto-advance internally, so we don't trigger it here to avoid double-transition.
      }
    })
  )

  cleanupFns.push(
    api.onStartFile(() => {
      if (!nativePlaybackActive) return
      advancingFromEndedTrackId = ''
      autoAdvanceInFlight = false
      setCurrentTimeImmediate(pendingLoadStartTime)
      isLoading.value = false
    })
  )

  cleanupFns.push(
    api.onPlaybackInfo((info) => {
      playbackInfo.value = normalizeNativePlaybackInfo(info)
      if (info.nativePlaybackActive !== undefined) {
        nativePlaybackActive = info.nativePlaybackActive === true
      }
      if (!nativePlaybackActive) return
      applyNativePlaybackInfo(info)
    })
  )

  if (api.onDeviceOptionsChanged) {
    cleanupFns.push(
      api.onDeviceOptionsChanged(() => {
        void refreshAudioOutputState()
      })
    )
  }

  if (api.onServiceCrash) {
    cleanupFns.push(
      api.onServiceCrash(({ reason }) => {
        setAudioServiceCrashNotice(reason)
      })
    )
  }

  if (api.onServiceReady) {
    cleanupFns.push(
      api.onServiceReady((event) => {
        audioEngineReady.value = true
        audioEngineError.value = event.outputRouteSynced
          ? null
          : event.restoreErrors?.join('；') || '音频输出设备/后端未完全恢复'
        setAudioServiceReadyNotice(event)
        void refreshAudioOutputState()
      })
    )
  }

  cleanupFns.push(
    api.onReady(async () => {
      const recoveredFromServiceCrash =
        audioEngineRecoveryNotice.value?.kind === 'service-crash'
      audioEngineReady.value = true
      audioEngineError.value = null
      if (recoveredFromServiceCrash) {
        setAudioServiceReadyNotice()
      }
      api.setVolume(volume.value).catch(() => {})
      await refreshAudioOutputState()
      try {
        const nativeInfo = await api.getPlaybackInfo()
        audioOutputConfig.value = {
          ...(appSettings.value?.audioOutputConfig ?? defaultAudioOutputConfig)
        }
        playbackInfo.value = normalizeNativePlaybackInfo(nativeInfo)
      } catch {
        // keep default
      }
    })
  )

  cleanupFns.push(
    api.onError((message) => {
      console.error('[audio-engine] Playback error:', message)
      audioEngineError.value = message
      if (message.includes('音频服务已重启')) {
        setAudioServiceCrashNotice(message)
      }
      clearPlaybackToggleIntent()
      clearNativePlaybackInfoIntent()
      isPlaying.value = false
      isLoading.value = false
    })
  )

  cleanupFns.push(
    api.onDisconnected(() => {
      audioEngineReady.value = false
      nativePlaybackActive = false
      clearPlaybackToggleIntent()
      clearNativePlaybackInfoIntent()
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

  if (settingsApi?.onChanged) {
    cleanupFns.push(
      settingsApi.onChanged((snapshot) => {
        audioOutputConfig.value = {
          ...defaultAudioOutputConfig,
          ...snapshot.settings.audioOutputConfig
        }
        audioProcessing.value = {
          ...defaultAudioProcessing,
          ...snapshot.settings.audioProcessing,
          eqBands: snapshot.settings.audioProcessing.eqBands.map((band) => ({ ...band }))
        }
      })
    )
  }

  void refreshAudioOutputState()
}

function dismissAudioEngineRecoveryNotice(): void {
  audioEngineRecoveryNotice.value = null
}

setupAudioEngineListeners()

watch(
  [isPlaying, audioEngineReady, () => currentTrack.value?.id, visualizerActive],
  ([playing, ready, trackId, activeVisualizer]) => {
    if (playing && ready && trackId && !activeVisualizer) {
      startVisualizationPolling()
      return
    }
    stopVisualizationPolling(activeVisualizer ? false : true)
  },
  { immediate: true }
)

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
  const loadToken = ++activeLoadToken
  clearPlaybackToggleIntent()
  setNativePlaybackInfoIntent(loadToken, track)
  stopVisualizationPolling(false)
  isLoading.value = true
  nativePlaybackActive = false
  nativeQueueDelegated = false
  stopRendererAudio(true)
  if (playbackAudio) playbackAudio.muted = false
  pendingLoadStartTime = normalizedStartTime
  duration.value = Math.max(0, track.duration || 0)
  setCurrentTimeImmediate(normalizedStartTime)
  clearCrossfadeTimer()

  try {
    await stopNativeAudio()
    if (!isActiveLoad(loadToken, track)) return

    const playTarget = await resolvePlayTarget(track)
    if (!isActiveLoad(loadToken, track)) return
    patchTrackInQueues(track)
    setNativePlaybackInfoIntent(loadToken, track, playTarget)
    const useNativePlayback = shouldUseNativePlayback(track, playTarget)

    let nativeStarted = false
    let nativeFallbackReason = ''

    if (useNativePlayback) {
      const canDelegateNativeQueue = canUseNativeQueuePlayback()
      const engineQueueSource = canDelegateNativeQueue ? queue.value : [track]
      const engineQueue = engineQueueSource.map((item) => ({
        id: item.id,
        duration: item.duration,
        source: item.id === track.id ? playTarget : getTrackAudioSource(item),
        format: item.format,
        sampleRate: item.sampleRate,
        bitrate: item.bitrate,
        bitDepth: item.bitDepth
      }))

      try {
        await window.api.audioEngine.loadQueue(
          engineQueue,
          canDelegateNativeQueue ? Math.max(0, queueIndex.value) : 0
        )
        if (!isActiveLoad(loadToken, track)) return
        nativeQueueDelegated = canDelegateNativeQueue

        const nativePlayMode = playMode.value === 'repeat' ? 'repeat' : 'sequential'
        await window.api.audioEngine.setPlayMode(nativePlayMode)
        if (!isActiveLoad(loadToken, track)) return

        const playResult = await window.api.audioEngine.play(playTarget, normalizedStartTime)
        if (!isActiveLoad(loadToken, track)) return
        nativeStarted = playResult?.nativeStarted === true
        nativeFallbackReason = playResult?.fallbackReason ?? ''
      } catch (engineErr) {
        if (!isActiveLoad(loadToken, track)) return
        nativeQueueDelegated = false
        nativeFallbackReason = engineErr instanceof Error ? engineErr.message : String(engineErr)
        console.warn(
          '[audio-engine] Native output unavailable, falling back to Electron playback:',
          engineErr
        )
      }
    }

    if (!isActiveLoad(loadToken, track)) return
    nativePlaybackActive = nativeStarted

    if (nativePlaybackActive) {
      audioEngineError.value = ''
      stopRendererAudio(true)
    } else {
      nativeQueueDelegated = false
      clearNativePlaybackInfoIntentForLoad(loadToken)
      audioEngineError.value = nativeFallbackReason
        ? `原生音频引擎不可用，已启用临时播放通道：${nativeFallbackReason}`
        : ''
      const rendererStarted = await playWithRendererAudio(
        track,
        playTarget,
        normalizedStartTime,
        loadToken
      )
      if (!rendererStarted || !isActiveLoad(loadToken, track)) return
      scheduleRendererPlaybackWatchdog(track, loadToken)
    }

    if (!isActiveLoad(loadToken, track)) return
    advancingFromEndedTrackId = ''
    autoAdvanceInFlight = false
    loadedTrackId = track.id
    restoredPlaybackPending = false
    restoredPlaybackPosition = 0
    setCurrentTimeImmediate(normalizedStartTime)
    isLoading.value = false
    isPlaying.value = true
    startVisualizationPolling()
  } catch (err) {
    if (!isActiveLoad(loadToken, track)) return
    clearNativePlaybackInfoIntentForLoad(loadToken)
    if (await handlePlaybackFallback(track, err, loadToken)) return
    console.error('[audio-engine] Playback failed:', err)
    audioEngineError.value = err instanceof Error ? err.message : String(err)
    autoAdvanceInFlight = false
    isLoading.value = false
    isPlaying.value = false
    nativePlaybackActive = false
    nativeQueueDelegated = false
    stopVisualizationPolling(true)
  }
}

function next(): void {
  if (queue.value.length === 0) return
  clearCrossfadeTimer()

  if (nativePlaybackActive && isNativeQueueDelegated()) {
    void advanceNativePlayback('next')
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
  try {
    if (nativePlaybackActive) {
      const nextPlaying = !isPlaying.value
      isPlaying.value = nextPlaying
      setPlaybackToggleIntent(nextPlaying)
      await window.api.audioEngine.togglePause()
      // togglePause 已等待原生引擎确认真实状态并发布。
      // 清除意图，让后续原生状态回传（tick 轮询/property-change）能立即生效。
      clearPlaybackToggleIntent()
    } else {
      const audio = getPlaybackAudio()
      if (audio.paused) {
        await audio.play()
      } else {
        audio.pause()
      }
    }
  } catch (err) {
    if (nativePlaybackActive) {
      isPlaying.value = !isPlaying.value
      clearPlaybackToggleIntent()
    }
    console.error('[audio-engine] togglePlay failed:', err)
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
      if (nativePlaybackActive) {
        window.api.audioEngine.seek(0).catch(() => {})
      } else if (playbackAudio) {
        playbackAudio.currentTime = 0
      }
    }
    return
  }
  const prevIndex = queueIndex.value - 1
  if (nativePlaybackActive && isNativeQueueDelegated()) {
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

function seekPlayback(time: number): void {
  if (currentTrack.value && loadedTrackId !== currentTrack.value.id) {
    restoredPlaybackPending = true
    restoredPlaybackPosition = Math.max(0, Number.isFinite(time) ? time : 0)
    setCurrentTimeImmediate(restoredPlaybackPosition)
    return
  }
  setCurrentTimeImmediate(time)
  if (nativePlaybackActive) {
    window.api.audioEngine.seek(time).catch(() => {})
  } else if (playbackAudio) {
    playbackAudio.currentTime = Math.max(0, time)
  }
}

let playerIntegrationSideEffectsSetup = false
let mediaSessionHandlersBound = false
let mediaSessionMetadataKey = ''
let discordPlayStartTimestamp: number | null = null
let desktopLyricsTimeThrottle = 0

function syncDesktopLyricsSnapshot(): void {
  const desktopLyricsApi = window.api?.desktopLyrics
  if (!desktopLyricsApi) return

  const track = currentTrack.value
  if (track) {
    desktopLyricsApi.updateTrack({
      lyrics: track.lyrics ?? null,
      translatedLyrics: track.translatedLyrics ?? null,
      lyricsSource: track.lyricsSource ?? null,
      translatedLyricsSource: track.translatedLyricsSource ?? null,
      title: track.title || '',
      artist: track.artist || ''
    })
  } else {
    desktopLyricsApi.updateTrack({
      lyrics: null,
      translatedLyrics: null,
      lyricsSource: null,
      translatedLyricsSource: null,
      title: '',
      artist: ''
    })
  }
  desktopLyricsApi.updateTime(currentTime.value)
}

function updateMediaSessionPlaybackState(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  navigator.mediaSession.playbackState =
    appSettings.value?.smtcEnabled && currentTrack.value
      ? isPlaying.value
        ? 'playing'
        : 'paused'
      : 'none'
}

function updateMediaSessionPositionState(): void {
  if (
    typeof navigator === 'undefined' ||
    !('mediaSession' in navigator) ||
    !appSettings.value?.smtcEnabled ||
    !currentTrack.value ||
    duration.value <= 0 ||
    !Number.isFinite(currentTime.value)
  ) {
    return
  }

  try {
    navigator.mediaSession.setPositionState({
      duration: duration.value,
      position: Math.min(currentTime.value, duration.value),
      playbackRate: 1
    })
  } catch {
    // setPositionState can throw if values are invalid; ignore
  }
}

function updateMediaSessionMetadata(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  if (!appSettings.value?.smtcEnabled) {
    mediaSessionMetadataKey = ''
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
    return
  }

  const track = currentTrack.value
  if (!track) {
    mediaSessionMetadataKey = ''
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
    return
  }

  const nextMetadataKey = [
    track.id,
    track.title || '',
    track.artist || '',
    track.album || '',
    track.cover || ''
  ].join('\u0000')

  if (mediaSessionMetadataKey !== nextMetadataKey) {
    mediaSessionMetadataKey = nextMetadataKey
    navigator.mediaSession.metadata =
      typeof MediaMetadata !== 'undefined'
        ? new MediaMetadata({
            title: track.title || '',
            artist: track.artist || '',
            album: track.album || '',
            artwork: track.cover ? [{ src: track.cover, sizes: '512x512', type: 'image/jpeg' }] : []
          })
        : null
  }

  updateMediaSessionPlaybackState()
  updateMediaSessionPositionState()
}

function setupMediaSessionHandlers(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  if (mediaSessionHandlersBound) return
  mediaSessionHandlersBound = true
  const ms = navigator.mediaSession
  ms.setActionHandler('play', () => {
    if (!isPlaying.value) void togglePlayState()
  })
  ms.setActionHandler('pause', () => {
    if (isPlaying.value) void togglePlayState()
  })
  ms.setActionHandler('previoustrack', () => {
    previous()
  })
  ms.setActionHandler('nexttrack', () => {
    next()
  })
  ms.setActionHandler('seekto', (details) => {
    if (details.seekTime != null) seekPlayback(details.seekTime)
  })
  ms.setActionHandler('seekbackward', () => {
    seekPlayback(Math.max(0, currentTime.value - 10))
  })
  ms.setActionHandler('seekforward', () => {
    seekPlayback(Math.min(duration.value, currentTime.value + 10))
  })
}

function updateDiscordActivity(): void {
  const discordApi = window.api?.discord
  if (!discordApi) return

  if (appSettings.value?.discordRpcEnabled !== true) {
    discordApi.clearActivity().catch(() => {})
    return
  }
  const track = currentTrack.value
  if (!track || !isPlaying.value) {
    discordPlayStartTimestamp = null
    discordApi.clearActivity().catch(() => {})
    return
  }
  if (discordPlayStartTimestamp === null) {
    discordPlayStartTimestamp = Date.now()
  }
  discordApi
    .updateActivity({
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      playing: true,
      startTime: discordPlayStartTimestamp
    })
    .catch(() => {})
}

function setupPlayerIntegrationSideEffects(): void {
  if (playerIntegrationSideEffectsSetup) return
  playerIntegrationSideEffectsSetup = true

  watch(
    () => appSettings.value?.smtcEnabled,
    () => {
      if (appSettings.value?.smtcEnabled) setupMediaSessionHandlers()
      updateMediaSessionMetadata()
    },
    { immediate: true }
  )

  watch(
    [
      () => currentTrack.value?.id,
      () => currentTrack.value?.title,
      () => currentTrack.value?.artist,
      () => currentTrack.value?.album,
      () => currentTrack.value?.cover
    ],
    () => updateMediaSessionMetadata(),
    { immediate: true }
  )

  watch(
    isPlaying,
    () => {
      updateMediaSessionPlaybackState()
      if (!isPlaying.value) discordPlayStartTimestamp = null
      updateDiscordActivity()
    },
    { immediate: true }
  )

  watch([currentTime, duration], () => {
    if (appSettings.value?.smtcEnabled && isPlaying.value) updateMediaSessionPositionState()
  })

  watch(
    () => appSettings.value?.discordRpcEnabled,
    () => updateDiscordActivity(),
    { immediate: true }
  )

  watch(
    () => appSettings.value.playMode,
    (savedPlayMode) => {
      if (savedPlayMode && savedPlayMode !== playMode.value) {
        setPlayModeInternal(savedPlayMode, { persist: false })
      }
    },
    { immediate: true }
  )

  watch(currentTrack, () => syncDesktopLyricsSnapshot(), { immediate: true })

  watch(currentTime, (time) => {
    const now = Date.now()
    if (now - desktopLyricsTimeThrottle < 200) return
    desktopLyricsTimeThrottle = now
    window.api?.desktopLyrics?.updateTime(time)
  })

  watch(
    () => appSettings.value?.desktopLyrics,
    (dl) => {
      if (!dl) return
      window.api?.desktopLyrics?.updateSettings(dl)
    },
    { deep: true }
  )

  window.api?.desktopLyrics?.onToggle((enabled: boolean) => {
    if (enabled) syncDesktopLyricsSnapshot()
  })
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
  setPlayModeInternal(modes[(idx + 1) % modes.length])
}

function setPlayModeInternal(mode: PlayMode, options: { persist?: boolean } = {}): void {
  playMode.value = mode
  applyPlayMode()
  if (options.persist !== false) {
    void updateSettings({ playMode: mode }).catch((err) => {
      console.error('[音频引擎] 保存播放模式失败:', err)
    })
  }
  void queueNativeQueueStateSync().catch((err) => {
    audioEngineError.value = err instanceof Error ? err.message : String(err)
    console.error('[音频引擎] 同步播放模式失败:', err)
  })
}

const progress = computed(() => {
  if (duration.value <= 0) return 0
  return (currentTime.value / duration.value) * 100
})

function cloneTrackForPlaybackSession(track: Track): Track {
  // Shallow copy — strip lyrics/translatedLyrics to avoid massive memory usage
  // when the entire queue is cloned for session persistence
  const source = getTrackSource(track)
  const cloned: Track = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    filePath: track.filePath,
    fileName: track.fileName,
    dir: track.dir,
    duration: track.duration,
    size: track.size,
    cover: track.cover,
    lyrics: null,
    source: track.source,
    ncmSongId: track.ncmSongId,
    streamUrl: source === 'local' ? track.streamUrl : null,
    format: track.format,
    sampleRate: track.sampleRate,
    bitrate: track.bitrate,
    bitDepth: track.bitDepth
  }
  return cloned
}

function restorePlaybackSession(session: PlaybackSession): void {
  const track = cloneTrackForPlaybackSession(session.track)
  const position =
    session.mode === 'trackAndPosition'
      ? Math.max(0, Number.isFinite(session.position) ? session.position : 0)
      : 0

  resetPlaybackRuntimeStateForRestore()
  clearCrossfadeTimer()
  if (session.playMode) {
    setPlayModeInternal(session.playMode, { persist: false })
  }
  currentTrack.value = track

  // 恢复完整播放队列，而非只恢复当前一首歌
  const savedQueue =
    Array.isArray(session.queue) && session.queue.length > 0
      ? session.queue.map(cloneTrackForPlaybackSession)
      : [track]
  const rawIndex = session.queueIndex
  const savedIndex =
    typeof rawIndex === 'number' &&
    Number.isFinite(rawIndex) &&
    rawIndex >= 0 &&
    rawIndex < savedQueue.length
      ? rawIndex
      : 0
  queue.value = savedQueue
  originalQueue.value = [...savedQueue]
  queueIndex.value = savedIndex

  duration.value = Math.max(0, track.duration || 0)
  isPlaying.value = false
  isLoading.value = false
  restoredPlaybackPending = true
  restoredPlaybackPosition = position
  pendingLoadStartTime = 0
  autoAdvanceInFlight = false
  advancingFromEndedTrackId = ''
  setCurrentTimeImmediate(position)
  void ensureCurrentTrackLyricsLoaded(track)
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
    playMode: playMode.value,
    track: cloneTrackForPlaybackSession(track),
    position,
    queue: queue.value.map(cloneTrackForPlaybackSession),
    queueIndex: queueIndex.value
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
  audioEngineRecoveryNotice: Ref<AudioEngineRecoveryNotice | null>
  exclusiveMode: Ref<boolean>
  visualizerActive: Ref<boolean>
  audioOutput: Ref<AudioOutputId>
  audioDevice: Ref<string>
  audioOutputOptions: Ref<AudioOutputOption[]>
  audioDeviceOptions: Ref<AudioDeviceOption[]>
  audioProcessing: Ref<AudioProcessingSettings>
  audioOutputConfig: Ref<OutputConfig>
  playbackInfo: Ref<NativePlaybackInfo | null>
  outputInfo: ComputedRef<NativeOutputInfo | null>
  visualizationData: Ref<NativeVisualizationData>
  cyclePlayMode: () => void
  setPlayMode: (mode: PlayMode) => void
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
  refreshAudioOutputState: () => Promise<void>
  dismissAudioEngineRecoveryNotice: () => void
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
  setupPlayerIntegrationSideEffects()

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

  function setPlayMode(mode: PlayMode): void {
    setPlayModeInternal(mode)
  }

  async function togglePlay(): Promise<void> {
    await togglePlayState()
  }

  function prev(): void {
    previous()
  }

  function seek(time: number): void {
    seekPlayback(time)
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
      console.error('[audio-engine] Failed to toggle exclusive mode:', err)
    }
  }

  async function setAudioOutput(output: AudioOutputId, device?: string): Promise<void> {
    try {
      applyAudioOutputState(await window.api.audioEngine.setAudioOutput(output, device))
    } catch (err) {
      audioEngineError.value = err instanceof Error ? err.message : String(err)
      console.error('[audio-engine] Failed to switch audio output:', err)
    }
  }

  async function setAudioDevice(device: string): Promise<void> {
    try {
      applyAudioOutputState(await window.api.audioEngine.setAudioDevice(device))
    } catch (err) {
      audioEngineError.value = err instanceof Error ? err.message : String(err)
      console.error('[audio-engine] Failed to switch audio device:', err)
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
    const nextSettings = mergeAudioProcessingPatch(settings)
    audioProcessing.value = nextSettings
    try {
      audioProcessing.value = cloneAudioProcessingSettings(
        await window.api.audioEngine.setAudioProcessing(nextSettings)
      )
      playbackInfo.value = normalizeNativePlaybackInfo(
        await window.api.audioEngine.getPlaybackInfo()
      )
      scheduleCrossfadeIfNeeded()
    } catch (err) {
      console.error('[audio-engine] Failed to update audio processing settings:', err)
      await persistAudioProcessingFallback(nextSettings, err)
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
      const nextSettings = mergeAudioProcessingPatch({
        convolverEnabled: true,
        convolverIrPath: path
      })
      audioProcessing.value = nextSettings
      await window.api.audioEngine.loadImpulseResponse(path)
      audioProcessing.value = cloneAudioProcessingSettings(
        await window.api.audioEngine.getAudioProcessing()
      )
      playbackInfo.value = normalizeNativePlaybackInfo(
        await window.api.audioEngine.getPlaybackInfo()
      )
    } catch (err) {
      console.error('[音频引擎] 加载卷积脉冲响应失败:', err)
      await persistAudioProcessingFallback(audioProcessing.value, err)
    }
  }

  async function clearImpulseResponse(): Promise<void> {
    const nextSettings = mergeAudioProcessingPatch({
      convolverEnabled: false,
      convolverIrPath: ''
    })
    audioProcessing.value = nextSettings
    try {
      await window.api.audioEngine.unloadImpulseResponse()
      audioProcessing.value = cloneAudioProcessingSettings(
        await window.api.audioEngine.getAudioProcessing()
      )
      playbackInfo.value = normalizeNativePlaybackInfo(
        await window.api.audioEngine.getPlaybackInfo()
      )
    } catch (err) {
      console.error('[音频引擎] 卸载卷积脉冲响应失败:', err)
      await persistAudioProcessingFallback(nextSettings, err)
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
    audioEngineRecoveryNotice,
    exclusiveMode,
    visualizerActive,
    audioOutput,
    audioDevice,
    audioOutputOptions,
    audioDeviceOptions,
    audioProcessing,
    audioOutputConfig,
    playbackInfo,
    outputInfo,
    visualizationData,
    cyclePlayMode,
    setPlayMode,
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
    refreshAudioOutputState,
    dismissAudioEngineRecoveryNotice,
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
