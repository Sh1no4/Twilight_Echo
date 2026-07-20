import { shallowRef, ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import type { PlaybackSession, Track } from '../types/music'
import type {
  AudioCapabilitySupportState,
  AudioDeviceOption,
  AudioOutputId,
  AudioOutputOption,
  AudioProcessingSettings,
  OutputConfig,
  OutputConfigApplyStatus,
  PlaybackResumeMode,
  PlayMode
} from '../types/settings'
import {
  DEFAULT_DSP_OUTPUT_STAGE,
  DEFAULT_DSP_STEREO_IMAGE,
  extractStereoImageFromGraph,
  mergeDspOutputStage,
  mergeDspStereoImage,
  type DspOutputStageConfig,
  type DspStereoImageConfig
} from '../../../shared/dspGraph.ts'
import { extractDominantColor } from '../utils/colorExtractor'
import {
  shouldReuseResolvedStreamUrl,
  shouldUseNativePlaybackTarget
} from '../utils/playbackRouting'
import { preparePlayerNativeQueue } from '../utils/nativeQueuePreparation.ts'
import {
  NativeQueueRevisionFence,
  synchronizeLatestNativeQueue
} from '../utils/nativeQueueRevision.ts'
import {
  toPlaybackQueueSnapshot,
  toPlaybackQueueSnapshots
} from '../utils/playbackQueueVirtualization.ts'
import { findPlaybackFallbackTrack } from '../utils/playbackFallback.ts'
import { findProviderRematchCandidate } from '../utils/libraryRepair.ts'
import { resolveLyricsWithSources } from '../utils/lyricSourceResolution.ts'
import { resolverLyricsInput } from '../utils/managedLyricsSource.ts'
import { useLyricsManagement } from './lyricsManagement.ts'
import { toggleVolumeMute } from '../utils/volumeMute.ts'
import {
  clampCuePlaybackPosition,
  cueDuration,
  rendererAudioAbsolutePositionForTrack,
  rendererAudioPositionForTrack
} from '../utils/cuePlayback.ts'
import {
  evaluateNativePlaybackInfoIntent,
  type NativePlaybackInfoIntent
} from '../utils/nativePlaybackInfoIntent.ts'
import { syncPluginProviders, useMediaProviders } from '../providers'
import { useSettingsStore } from './useSettingsStore'
import { useMusicStore } from './useMusicStore'
import { playbackSessionWriter } from '../app/playbackSessionWriter.ts'
import {
  onLocalTracksUnavailable,
  pruneUnavailableLocalTracks
} from '../utils/localTrackRemovalPolicy.ts'
import { type SleepTimerMode, type SleepTimerState } from '../../../shared/sleepTimer.ts'
import { createSleepTimerController, getRestorableSleepTimerState } from './sleepTimerController.ts'
import { createSleepTimerFadeController } from './sleepTimerFade.ts'

type NativePlaybackInfo = Awaited<ReturnType<typeof window.api.audioEngine.getPlaybackInfo>>
type NativeOutputInfo = NativePlaybackInfo['outputInfo']
type NativeVisualizationData = Awaited<
  ReturnType<typeof window.api.audioEngine.getVisualizationData>
>
type ProviderSourceReliability = Record<string, number>
const automaticLyricsBaselines = new Map<string, Track>()

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
  isDefault: true,
  dopSupportState: 'runtime-probed',
  nativeDsdSupportState: 'unsupported'
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

function normalizeAudioCapabilitySupportState(value: unknown): AudioCapabilitySupportState | null {
  return value === 'verified' ||
    value === 'runtime-probed' ||
    value === 'unsupported' ||
    value === 'unknown'
    ? value
    : null
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function getDeviceBackend(option: Partial<AudioDeviceOption>): string {
  const id = String(option.id || '').toLowerCase()
  const raw =
    option.backend ||
    (id.startsWith('asio:')
      ? 'asio'
      : id.startsWith('wasapi:')
        ? 'wasapi'
        : id.startsWith('coreaudio:')
          ? 'coreaudio'
          : id.startsWith('alsa:') || id.startsWith('hw:') || id.startsWith('plughw:')
            ? 'alsa'
            : '')
  return String(raw || '').toLowerCase()
}

function getDevicePathKind(option: Partial<AudioDeviceOption>): string {
  const explicit = String(option.pathKind || '').toLowerCase()
  if (explicit) return explicit
  const id = String(option.id || '').toLowerCase()
  if (id === 'auto' || id === 'default') return 'default'
  if (id.startsWith('hw:') || id.startsWith('alsa:hw:')) return 'hw'
  if (id.startsWith('plughw:') || id.startsWith('alsa:plughw:')) return 'plughw'
  if (id.startsWith('wasapi:')) return 'endpoint'
  if (id.startsWith('coreaudio:')) return 'hal'
  if (id.startsWith('asio:')) return 'asio'
  return ''
}

function deriveDopSupportState(option: Partial<AudioDeviceOption>): AudioCapabilitySupportState {
  const explicit = normalizeAudioCapabilitySupportState(option.dopSupportState)
  if (explicit) return explicit
  if (
    option.supportsDop === true ||
    hasNonEmptyArray(option.dopCarrierSampleRates) ||
    hasNonEmptyArray(option.dopCarrierFormats)
  ) {
    return 'verified'
  }
  if (option.supportsDop === false) return 'unsupported'

  const backend = getDeviceBackend(option)
  const pathKind = getDevicePathKind(option)
  if (
    option.isDefault === true ||
    backend === 'wasapi' ||
    backend === 'coreaudio' ||
    pathKind === 'default' ||
    pathKind === 'endpoint' ||
    pathKind === 'hal'
  ) {
    return 'runtime-probed'
  }
  if (backend === 'asio' || pathKind === 'asio') return 'unknown'
  return 'unknown'
}

function deriveNativeDsdSupportState(
  option: Partial<AudioDeviceOption>
): AudioCapabilitySupportState {
  const explicit = normalizeAudioCapabilitySupportState(option.nativeDsdSupportState)
  if (explicit) return explicit
  if (
    option.supportsNativeDsd === true ||
    hasNonEmptyArray(option.nativeDsdSampleRates) ||
    hasNonEmptyArray(option.nativeDsdSampleFormats) ||
    hasNonEmptyArray(option.supportedDsdRates)
  ) {
    return 'verified'
  }
  if (option.supportsNativeDsd === false) return 'unsupported'

  const backend = getDeviceBackend(option)
  const pathKind = getDevicePathKind(option)
  if (
    backend === 'wasapi' ||
    backend === 'coreaudio' ||
    pathKind === 'endpoint' ||
    pathKind === 'hal'
  ) {
    return 'unsupported'
  }
  if (backend === 'alsa' && pathKind === 'hw') return 'runtime-probed'
  if (backend === 'asio' || pathKind === 'asio') return 'unknown'
  if (option.isDefault === true || pathKind === 'default') return 'unsupported'
  return 'unknown'
}

function withAudioCapabilitySupportStates(
  option: AudioDeviceOption,
  fallbackBackend: AudioOutputId | '' = ''
): AudioDeviceOption {
  const contextualOption =
    fallbackBackend && !option.backend ? { ...option, backend: fallbackBackend } : option
  return {
    ...option,
    dopSupportState: deriveDopSupportState(contextualOption),
    nativeDsdSupportState: deriveNativeDsdSupportState(contextualOption)
  }
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
  selectedDevice: string,
  selectedOutput: AudioOutputId | '' = ''
): AudioDeviceOption[] {
  const normalized: AudioDeviceOption[] = []
  const seen = new Set<string>()

  function addOption(option: unknown): void {
    if (typeof option === 'string') {
      const id = option.trim()
      if (!id || seen.has(id)) return
      seen.add(id)
      normalized.push(
        withAudioCapabilitySupportStates(
          {
            id,
            label: formatAudioDeviceLabel(id),
            isDefault: id === 'auto'
          },
          selectedOutput
        )
      )
      return
    }

    if (!option || typeof option !== 'object') return
    const record = option as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id || seen.has(id)) return
    const rawLabel = typeof record.label === 'string' ? record.label.trim() : ''
    seen.add(id)
    normalized.push(
      withAudioCapabilitySupportStates(
        {
          ...(record as Partial<AudioDeviceOption>),
          id,
          label: id === 'auto' ? DEFAULT_AUDIO_DEVICE_OPTION.label : rawLabel || id,
          isDefault: record.isDefault === true
        },
        selectedOutput
      )
    )
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
    normalized.push(
      withAudioCapabilitySupportStates(
        {
          id: selectedDevice,
          label: formatAudioDeviceLabel(selectedDevice),
          isDefault: selectedDevice === 'auto'
        },
        selectedOutput
      )
    )
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
const muted = ref(false)
const lastAudibleVolume = ref(0.7)
const sleepTimerState = ref<SleepTimerState | null>(null)
const sleepTimerNotice = ref<string | null>(null)
let sleepTimerFadeController: ReturnType<typeof createSleepTimerFadeController> | null = null
let sleepTimerController: ReturnType<typeof createSleepTimerController> | null = null
// Queue entries are immutable playback snapshots. Keeping this as a shallow
// array avoids proxying every nested field for a 5k/20k queue.
const queue = shallowRef<Track[]>([])
const queueIndex = ref(-1)
const playMode = ref<PlayMode>('sequential')
const originalQueue = shallowRef<Track[]>([])
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
const audioOutputConfigApplyStatus = ref<OutputConfigApplyStatus>({
  requestedRevision: 0,
  appliedRevision: 0,
  failedRevision: 0,
  state: 'idle',
  error: '',
  generation: 0
})
/** Default-scene graph.outputStage (sample-rate lock / SRC / dither). Not OutputConfig. */
const dspOutputStage = ref<DspOutputStageConfig>({ ...DEFAULT_DSP_OUTPUT_STAGE })
/** Default-scene stereoField + channelStrip polarity (HiFi balance/phase). */
const dspStereoImage = ref<DspStereoImageConfig>({ ...DEFAULT_DSP_STEREO_IMAGE })
const playbackInfo = ref<NativePlaybackInfo | null>(null)
const loudnormStatus = ref<'idle' | 'measuring' | 'cached' | 'fallback' | 'unavailable'>('idle')
const loudnormStatusSource = ref<string | null>(null)
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
const nativeQueueRevisionFence = new NativeQueueRevisionFence()
let activeLoadToken = 0
let rendererFallbackInProgress = false
let rendererPlaybackWatchdogTimer: number | null = null
const RENDERER_PLAYBACK_WATCHDOG_MS = 220
const PLAYBACK_TOGGLE_INTENT_GRACE_MS = 300
const NATIVE_PLAYBACK_INFO_INTENT_GRACE_MS = 2500
const NATIVE_PLAYBACK_INFO_POST_CONFIRMATION_GRACE_MS = 500
const NATIVE_PLAYBACK_INFO_REFRESH_DELAY_MS = 80
let playbackToggleIntent: { playing: boolean; expiresAt: number } | null = null
let nativePlaybackInfoIntent: NativePlaybackInfoIntent | null = null
const bpmAnalysisRequests = new Set<string>()

function isActiveLoad(loadToken: number, track: Track): boolean {
  return loadToken === activeLoadToken && currentTrack.value?.id === track.id
}

function clearRendererPlaybackWatchdog(): void {
  if (rendererPlaybackWatchdogTimer !== null) {
    window.clearTimeout(rendererPlaybackWatchdogTimer)
    rendererPlaybackWatchdogTimer = null
  }
}

function setNativePlaybackInfoIntent(
  loadToken: number,
  track: Track,
  source = '',
  targetQueueIndex = queueIndex.value
): void {
  nativePlaybackInfoIntent = {
    loadToken,
    trackId: track.id,
    queueIndex: targetQueueIndex,
    source,
    expiresAt: getNowMs() + NATIVE_PLAYBACK_INFO_INTENT_GRACE_MS,
    confirmedAt: null
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

function shouldIgnoreNativePlaybackInfo(info: NativePlaybackInfo, infoIndex: number): boolean {
  const intent = nativePlaybackInfoIntent
  if (!intent) return false
  const indexedTrack = infoIndex >= 0 ? queue.value[infoIndex] : null
  const now = getNowMs()
  const source = typeof info.source === 'string' ? info.source.trim() : ''
  const decision = evaluateNativePlaybackInfoIntent(
    intent,
    { trackId: indexedTrack?.id ?? '', source },
    now,
    NATIVE_PLAYBACK_INFO_POST_CONFIRMATION_GRACE_MS
  )
  if (decision === 'expired') {
    clearNativePlaybackInfoIntent()
    return false
  }
  if (decision === 'match') {
    if (intent.confirmedAt === null) intent.confirmedAt = now
    return false
  }
  return true
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
    if (currentTrack.value?.cueRange) {
      duration.value = cueDuration(currentTrack.value)
    } else if (Number.isFinite(audio.duration) && audio.duration > 0) {
      duration.value = audio.duration
    }
  })

  audio.addEventListener('timeupdate', () => {
    if (Number.isFinite(audio.currentTime)) {
      const track = currentTrack.value
      const position = rendererAudioPositionForTrack(audio.currentTime, track)
      setCurrentTimeThrottled(position)
      if (track?.cueRange && audio.currentTime >= track.cueRange.endSeconds) {
        audio.pause()
        audio.currentTime = track.cueRange.endSeconds
        setCurrentTimeImmediate(cueDuration(track))
        void handlePlaybackEnded()
        return
      }
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
    void handlePlaybackEnded()
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
  const targetTime = clampCuePlaybackPosition(track, startTime)

  const applySeek = (): void => {
    if (!isActiveLoad(loadToken, track)) return
    try {
      audio.currentTime = rendererAudioAbsolutePositionForTrack(targetTime, track)
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

function clearSleepTimerIntervals(): void {
  sleepTimerFadeController?.clear()
}

function stopForSleepTimer(): void {
  clearCrossfadeTimer()
  stopVisualizationPolling(true)
  stopRendererAudio(false)
  void stopNativeAudio()
  isPlaying.value = false
  isLoading.value = false
  sleepTimerNotice.value = '睡眠定时器已停止播放'
}

function beginSleepShutdown(state: SleepTimerState): void {
  getSleepTimerFadeController().begin(state)
}

function getSleepTimerFadeController(): ReturnType<typeof createSleepTimerFadeController> {
  if (!sleepTimerFadeController) {
    sleepTimerFadeController = createSleepTimerFadeController({
      getVolume: () => volume.value,
      setVolume: (nextVolume) => {
        volume.value = nextVolume
      },
      stop: stopForSleepTimer
    })
  }
  return sleepTimerFadeController
}

function getSleepTimerController(): ReturnType<typeof createSleepTimerController> {
  if (!sleepTimerController) {
    sleepTimerController = createSleepTimerController({
      bridge: window.api.sleepTimer,
      getSettings: () => useSettingsStore().settings.value.sleepTimer,
      getState: () => sleepTimerState.value,
      setState: (state) => {
        sleepTimerState.value = state
      },
      persistSession: persistSelectedTrackSession,
      setNotice: (notice) => {
        sleepTimerNotice.value = notice
      },
      onTriggered: beginSleepShutdown
    })
  }
  return sleepTimerController
}

function configureSleepTimer(mode: SleepTimerMode, minutes?: number): void {
  clearSleepTimerIntervals()
  getSleepTimerController().configure(mode, minutes)
}

function cancelSleepTimer(): void {
  clearSleepTimerIntervals()
  getSleepTimerController().cancel()
}

function toggleMute(): void {
  const next = toggleVolumeMute({
    volume: volume.value,
    muted: muted.value,
    lastAudibleVolume: lastAudibleVolume.value
  })
  volume.value = next.volume
  muted.value = next.muted
  lastAudibleVolume.value = next.lastAudibleVolume
}

function shouldUseNativePlayback(track: Track, target: string): boolean {
  return shouldUseNativePlaybackTarget(getTrackSource(track), target)
}

function isNativeQueueDelegated(): boolean {
  return nativeQueueDelegated
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
  audioDeviceOptions.value = normalizeAudioDeviceOptions(
    state.deviceOptions,
    state.device,
    state.output
  )
}

let audioEngineStateRequest: Promise<void> | null = null
let audioEngineStateRefreshQueued = false

async function refreshAudioOutputState(): Promise<void> {
  if (audioEngineStateRequest) {
    audioEngineStateRefreshQueued = true
    return audioEngineStateRequest
  }
  const api = window.api?.audioEngine
  if (!api) return

  audioEngineStateRequest = (async () => {
    audioEngineStateRefreshQueued = false
    try {
      const [outputState, processingSettings, sceneState] = await Promise.all([
        api.getAudioOutputState(),
        api.getAudioProcessing(),
        api.getDspSceneState?.() ?? Promise.resolve(null)
      ])
      applyAudioOutputState(outputState)
      audioProcessing.value = processingSettings
      if (sceneState) {
        const defaultScene = sceneState.scenes?.find((scene) => scene.id === 'default')
        const graph = defaultScene?.graph ?? sceneState.graph
        if (graph?.outputStage) {
          dspOutputStage.value = mergeDspOutputStage(graph.outputStage, {})
        }
        if (graph) {
          dspStereoImage.value = extractStereoImageFromGraph(graph)
        }
      }
      audioEngineReady.value = true
      audioEngineError.value = null
    } catch (err) {
      audioEngineReady.value = false
      console.warn('[audio-engine] Failed to refresh audio output state:', err)
    } finally {
      audioEngineStateRequest = null
    }
  })()

  await audioEngineStateRequest
  if (audioEngineStateRefreshQueued) {
    await refreshAudioOutputState()
  }
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
  return track.cueRange ? track.filePath : track.subTrack || track.streamUrl || track.filePath
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
  const snapshot = toPlaybackQueueSnapshot(updatedTrack)
  queue.value = queue.value.map((track) =>
    track.id === updatedTrack.id ? { ...snapshot, queueEntryId: track.queueEntryId } : track
  )
  originalQueue.value = originalQueue.value.map((track) =>
    track.id === updatedTrack.id ? { ...snapshot, queueEntryId: track.queueEntryId } : track
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

function applyNativePlaybackInfo(
  info: NativePlaybackInfo,
  options: { applyTrackWhenInactive?: boolean } = {}
): boolean {
  const infoIndex = findTrackIndexFromPlaybackInfo(info)
  if (shouldIgnoreNativePlaybackInfo(info, infoIndex)) return false

  const normalizedInfo = normalizeNativePlaybackInfo(info)
  playbackInfo.value = normalizedInfo
  if (info.nativePlaybackActive !== undefined) {
    nativePlaybackActive = info.nativePlaybackActive === true
  }
  if (!nativePlaybackActive && !options.applyTrackWhenInactive) return true

  let switchedTrack = false

  if (infoIndex >= 0) {
    const track = queue.value[infoIndex]
    switchedTrack = currentTrack.value?.id !== track.id
    const mergedTrack = mergeTrackTransientData(track, currentTrack.value)
    queueIndex.value = infoIndex
    if (mergedTrack !== track) {
      const snapshot = { ...toPlaybackQueueSnapshot(mergedTrack), queueEntryId: track.queueEntryId }
      queue.value = queue.value.map((item, index) => (index === infoIndex ? snapshot : item))
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
  autoAdvanceInFlight = false
  advancingFromEndedTrackId = ''
  restoredPlaybackPending = false
  restoredPlaybackPosition = 0
  pendingLoadStartTime = 0
  scheduleCrossfadeIfNeeded()
  return true
}

interface NativeQueueStateSnapshot {
  revision: number
  queue: Track[]
  current: Track | null
  currentIndex: number
  playMode: PlayMode
}

function captureNativeQueueState(revision: number): NativeQueueStateSnapshot {
  return {
    revision,
    queue: queue.value,
    current: currentTrack.value ? toPlaybackQueueSnapshot(currentTrack.value) : null,
    currentIndex: queueIndex.value,
    playMode: playMode.value
  }
}

async function syncNativeQueueState(snapshot: NativeQueueStateSnapshot): Promise<void> {
  if (!nativeQueueRevisionFence.isCurrent(snapshot.revision)) return
  const current = snapshot.current
  if (!current) {
    if (!nativeQueueRevisionFence.isCurrent(snapshot.revision)) return
    await stopNativeAudio()
    return
  }

  const nativePlayMode = snapshot.playMode === 'repeat' ? 'repeat' : 'sequential'
  const synchronized = await synchronizeLatestNativeQueue(
    nativeQueueRevisionFence,
    snapshot.revision,
    {
      prepare: () =>
        preparePlayerNativeQueue(
          {
            queue: snapshot.queue,
            currentTrack: current,
            currentTarget: getTrackAudioSource(current),
            currentIndex: snapshot.currentIndex
          },
          {
            isAudioFileAuthorized: window.api.fs.isAudioFileAuthorized,
            getOfflinePlayablePaths: window.api.offline.getPlayablePaths
          }
        ),
      loadQueue: (preparedQueue) =>
        window.api.audioEngine.loadQueue(preparedQueue.items, preparedQueue.startIndex),
      setPlayMode: () => window.api.audioEngine.setPlayMode(nativePlayMode)
    }
  )
  if (!synchronized.applied) return
  const preparedQueue = synchronized.prepared
  if (!preparedQueue) {
    await nativeQueueRevisionFence.runLatest(snapshot.revision, () => stopNativeAudio())
    return
  }
  nativeQueueDelegated = preparedQueue.delegated
}

function queueNativeQueueStateSync(): Promise<void> {
  const revision = nativeQueueRevisionFence.next()
  const snapshot = captureNativeQueueState(revision)
  const previousRequest = nativeQueueSyncRequest
  const request = (previousRequest ?? Promise.resolve())
    .catch(() => {})
    .then(() => syncNativeQueueState(snapshot))

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

function getNativeQueueAdvanceTarget(
  direction: 'next' | 'previous'
): { track: Track; queueIndex: number } | null {
  if (queue.value.length === 0) return null

  const currentQueueIndex =
    queueIndex.value >= 0 && queueIndex.value < queue.value.length
      ? queueIndex.value
      : Math.max(
          0,
          queue.value.findIndex((track) => track.id === currentTrack.value?.id)
        )
  const targetQueueIndex =
    direction === 'next'
      ? (currentQueueIndex + 1) % queue.value.length
      : (currentQueueIndex - 1 + queue.value.length) % queue.value.length
  const track = queue.value[targetQueueIndex]
  return track ? { track, queueIndex: targetQueueIndex } : null
}

async function advanceNativePlayback(direction: 'next' | 'previous'): Promise<void> {
  const target = getNativeQueueAdvanceTarget(direction)
  if (target) {
    setNativePlaybackInfoIntent(
      activeLoadToken,
      target.track,
      getTrackAudioSource(target.track),
      target.queueIndex
    )
  } else {
    clearNativePlaybackInfoIntent()
  }
  stopVisualizationPolling(false)
  try {
    isLoading.value = true
    await waitForNativeQueueStateSync()
    if (direction === 'next') {
      await window.api.audioEngine.next()
    } else {
      await window.api.audioEngine.previous()
    }
    await new Promise((resolve) =>
      window.setTimeout(resolve, NATIVE_PLAYBACK_INFO_REFRESH_DELAY_MS)
    )
    let info = await window.api.audioEngine.getPlaybackInfo()
    let applied = applyNativePlaybackInfo(info, { applyTrackWhenInactive: true })
    if (!applied) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, NATIVE_PLAYBACK_INFO_REFRESH_DELAY_MS)
      )
      info = await window.api.audioEngine.getPlaybackInfo()
      applied = applyNativePlaybackInfo(info, { applyTrackWhenInactive: true })
    }
    if (!applied) return

    const track = currentTrack.value
    if (track && info.state !== 'playing') {
      nativePlaybackActive = false
      await loadAndPlay(track)
    }
  } catch (err) {
    clearNativePlaybackInfoIntent()
    audioEngineError.value = err instanceof Error ? err.message : String(err)
    console.error('[音频引擎] 切换歌曲失败:', err)
    isLoading.value = false
  } finally {
    if (isPlaying.value && currentTrack.value) startVisualizationPolling()
  }
}

watch(volume, (val) => {
  if (val > 0) {
    lastAudibleVolume.value = val
    muted.value = false
  }
  if (playbackAudio) playbackAudio.volume = val
  window.api.audioEngine.setVolume(val).catch(() => {})
})

watch(
  [() => currentTrack.value?.cover, () => appSettings.value?.useCoverTheme],
  async ([cover, useCoverTheme]) => {
    const requestId = ++dominantColorRequestId
    if (!useCoverTheme) {
      dominantColor.value = '#7c4dff'
      return
    }

    if (cover) {
      // cover:// and http(s): URLs can be loaded directly by Image
      const color = await extractDominantColor(cover)
      if (
        requestId === dominantColorRequestId &&
        currentTrack.value?.cover === cover &&
        appSettings.value?.useCoverTheme
      ) {
        dominantColor.value = color
      }
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
let dominantColorRequestId = 0

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
  const prefix = message.startsWith('音频服务已重启')
    ? message
    : `音频服务已重启：${message || '未知原因'}`
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

async function handlePlaybackEnded(): Promise<void> {
  if (await getSleepTimerController().reportBoundary('trackEnd')) return
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
  await advanceAfterPlaybackEnded()
}

async function advanceAfterPlaybackEnded(): Promise<void> {
  clearCrossfadeTimer()
  const nextIndex = queueIndex.value + 1
  if (nextIndex >= 0 && nextIndex < queue.value.length) {
    queueIndex.value = nextIndex
    const track = queue.value[nextIndex]
    currentTrack.value = track
    void loadAndPlay(track)
    return
  }

  if (await getSleepTimerController().reportBoundary('queueEnd')) return

  if ((playMode.value === 'listLoop' || playMode.value === 'shuffle') && queue.value.length > 0) {
    queueIndex.value = 0
    const track = queue.value[0]
    if (track) {
      currentTrack.value = track
      void loadAndPlay(track)
      return
    }
  }

  isPlaying.value = false
  isLoading.value = false
  autoAdvanceInFlight = false
  stopVisualizationPolling(true)
}

function handleNativePlaybackEnded(): void {
  if (!nativePlaybackActive) return
  if (isNativeQueueDelegated()) return
  void handlePlaybackEnded()
}

function getTrackSource(track: Track): string {
  if (track.source) return track.source
  if (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)) return 'local'
  const separatorIndex = track.id.indexOf(':')
  return separatorIndex > 0 ? track.id.slice(0, separatorIndex) : 'local'
}

function hasAnalyzedBpm(track: Track): boolean {
  const bpm = track.bpmAnalysis?.bpm
  return typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0
}

function isAutoBpmAnalysisEnabled(): boolean {
  return useSettingsStore().settings.value.autoAnalyzeBpm !== false
}

function isAnalyzableAudioPath(filePath: string | undefined): filePath is string {
  if (!filePath) return false
  return !/^[a-z][a-z\d+.-]*:\/\//i.test(filePath)
}

function applyBpmAnalysisToTrack(
  trackId: string,
  filePath: string,
  analysis: Track['bpmAnalysis']
): void {
  if (!analysis) return
  const target = currentTrack.value
  if (target && (target.id === trackId || target.filePath === filePath)) {
    const updatedTrack = {
      ...target,
      bpmAnalysis: analysis
    }
    currentTrack.value = updatedTrack
    patchTrackInQueues(updatedTrack)
  } else {
    queue.value = queue.value.map((track) =>
      track.id === trackId || track.filePath === filePath
        ? { ...track, bpmAnalysis: analysis }
        : track
    )
    originalQueue.value = originalQueue.value.map((track) =>
      track.id === trackId || track.filePath === filePath
        ? { ...track, bpmAnalysis: analysis }
        : track
    )
  }
  useMusicStore().applyBpmAnalysis(trackId, filePath, analysis)
}

function clearBpmAnalysisFromPlaybackState(): void {
  if (currentTrack.value?.bpmAnalysis) {
    const { bpmAnalysis: _bpmAnalysis, ...nextTrack } = currentTrack.value
    currentTrack.value = nextTrack
  }
  queue.value = queue.value.map((track) => {
    if (!track.bpmAnalysis) return track
    const { bpmAnalysis: _bpmAnalysis, ...nextTrack } = track
    return nextTrack
  })
  originalQueue.value = originalQueue.value.map((track) => {
    if (!track.bpmAnalysis) return track
    const { bpmAnalysis: _bpmAnalysis, ...nextTrack } = track
    return nextTrack
  })
  useMusicStore().clearBpmAnalysis()
}

async function requestBpmAnalysisForTrack(track: Track): Promise<void> {
  if (
    !isAutoBpmAnalysisEnabled() ||
    hasAnalyzedBpm(track) ||
    !isAnalyzableAudioPath(track.filePath)
  )
    return
  const key = `${track.id}\u0000${track.filePath}`
  if (bpmAnalysisRequests.has(key)) return
  bpmAnalysisRequests.add(key)
  try {
    const result = await window.api?.bpmAnalysis?.request({
      trackId: track.id,
      filePath: track.filePath,
      referenceBpm: track.bpm
    })
    if (result?.status === 'cached' || result?.status === 'completed') {
      applyBpmAnalysisToTrack(track.id, track.filePath, result.analysis)
    }
  } catch {
    // BPM analysis is best-effort; playback and live visualization continue.
  } finally {
    bpmAnalysisRequests.delete(key)
  }
}

async function ensureCurrentTrackLyricsLoaded(
  triggerTrack: Track | null = currentTrack.value,
  allowProviderLookup = true
): Promise<void> {
  if (!triggerTrack) return

  const lyricsManagement = useLyricsManagement()
  try {
    await lyricsManagement.ensureLoaded()
  } catch {
    // Automatic resolution remains available when the optional management
    // document cannot be read. The persistent store preserves the bad file.
  }
  const override = lyricsManagement.entryFor(triggerTrack.id)
  const requestedSource = override?.source ?? 'auto'
  // Manual content is applied by the presentation layer. Keeping it out of
  // the queue record means choosing Auto later can always recover
  // the resolver result instead of treating a previous edit as embedded data.
  if (requestedSource === 'manual') return

  if (requestedSource !== 'auto' && !automaticLyricsBaselines.has(triggerTrack.id)) {
    automaticLyricsBaselines.set(triggerTrack.id, { ...triggerTrack })
  }
  const resolverTrack = resolverLyricsInput(
    triggerTrack,
    automaticLyricsBaselines.get(triggerTrack.id),
    requestedSource
  )

  const source = getTrackSource(resolverTrack)
  const canLoadLocalLyrics =
    requestedSource !== 'provider' &&
    source === 'local' &&
    (requestedSource === 'local' || resolverTrack.lyrics == null) &&
    !!resolverTrack.dir &&
    !!resolverTrack.fileName
  const canLoadProviderLyrics =
    requestedSource !== 'local' &&
    allowProviderLookup &&
    (requestedSource === 'provider' ||
      resolverTrack.lyrics == null ||
      resolverTrack.translatedLyrics == null)
  if (!canLoadLocalLyrics && !canLoadProviderLyrics) {
    if (currentTrack.value?.id === triggerTrack.id && resolverTrack !== triggerTrack) {
      const updatedTrack = { ...resolverTrack }
      currentTrack.value = updatedTrack
      patchTrackInQueues(updatedTrack)
    }
    return
  }

  const resolved = await resolveLyricsWithSources({
    track: resolverTrack,
    loadLocalLyrics: canLoadLocalLyrics
      ? () =>
          window.api.data
            .getLyrics(resolverTrack.dir!, resolverTrack.fileName, resolverTrack.filePath)
            .catch(() => null)
      : undefined,
    loadProviderLyrics: canLoadProviderLyrics
      ? async () => {
          await syncPluginProviders()
          return useMediaProviders().resolveLyrics(resolverTrack)
        }
      : undefined
  })

  if (currentTrack.value?.id !== triggerTrack.id) return
  // Source selection can change while an async local/provider resolver is
  // pending. Do not let a stale forced lookup overwrite the newer Auto (or
  // manual) choice when it finally completes.
  if ((lyricsManagement.entryFor(triggerTrack.id)?.source ?? 'auto') !== requestedSource) return
  const updatedTrack = {
    ...resolverTrack,
    lyrics: resolved.lyrics ?? '',
    translatedLyrics: resolved.translatedLyrics ?? resolverTrack.translatedLyrics ?? null,
    lyricsSource: resolved.lyricsSource,
    translatedLyricsSource: resolved.translatedLyricsSource,
    romanizedLyrics: resolverTrack.romanizedLyrics ?? null,
    romanizedLyricsSource: resolverTrack.romanizedLyricsSource ?? null
  }
  currentTrack.value = updatedTrack
  patchTrackInQueues(updatedTrack)
}

async function resolvePlayTarget(track: Track): Promise<string> {
  const source = getTrackSource(track)
  if (source === 'local') {
    const authorized = await window.api.fs.isAudioFileAuthorized(track.filePath)
    if (!authorized) {
      throw new Error('Local audio file is outside the authorized library folders')
    }
    return track.filePath
  }

  // A completed user pin is integrity-checked by the main process on every
  // lookup.  It wins over a transient remote URL, then normal provider
  // resolution remains the explicit online fallback.
  const offlinePath = await window.api.offline.getPlayablePath(source, track.id)
  if (offlinePath) {
    track.offlinePath = offlinePath
    return offlinePath
  }

  const ncmPlaybackQuality = appSettings.value.ncmPlaybackQuality
  const canReuseNcmStream = source !== 'ncm' || track.streamQuality === ncmPlaybackQuality
  if (track.streamUrl && shouldReuseResolvedStreamUrl(source) && canReuseNcmStream) {
    return track.streamUrl
  }

  await syncPluginProviders()
  const streamUrl = await useMediaProviders().resolvePlaybackUrl(
    track,
    source === 'ncm' ? { quality: ncmPlaybackQuality } : undefined
  )
  if (!streamUrl) {
    if (source === 'ncm') {
      throw new Error('当前网易云账号没有可播放的音质，请检查登录状态、歌曲版权和会员权益')
    }
    throw new Error(`Unable to resolve ${source} stream URL`)
  }

  track.streamUrl = streamUrl
  if (source === 'ncm') track.streamQuality = ncmPlaybackQuality
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

  const fallbackSnapshot = toPlaybackQueueSnapshot(fallback)
  queue.value = queue.value.map((track) =>
    track.id === failedTrack.id ? { ...fallbackSnapshot, queueEntryId: track.queueEntryId } : track
  )
  originalQueue.value = originalQueue.value.map((track) =>
    track.id === failedTrack.id ? { ...fallbackSnapshot, queueEntryId: track.queueEntryId } : track
  )
  queueIndex.value = queue.value.findIndex((track) => track.id === fallback.id)
  if (queueIndex.value < 0) queueIndex.value = 0
  currentTrack.value = fallback
  await loadAndPlay(fallback)
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

  const rematchedSnapshot = toPlaybackQueueSnapshot(rematched)
  queue.value = queue.value.map((track) =>
    track.id === failedTrack.id ? { ...rematchedSnapshot, queueEntryId: track.queueEntryId } : track
  )
  originalQueue.value = originalQueue.value.map((track) =>
    track.id === failedTrack.id ? { ...rematchedSnapshot, queueEntryId: track.queueEntryId } : track
  )
  queueIndex.value = queue.value.findIndex((track) => track.id === rematched.id)
  if (queueIndex.value < 0) queueIndex.value = 0
  currentTrack.value = rematched
  // Persist the rematch so playlists/library references to the expired
  // provider track are replaced — not just the transient playback queue.
  if (failedSource !== 'local') {
    useMusicStore().replaceTrackReference(failedTrack.id, rematched)
  }
  await loadAndPlay(rematched)
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
          handleNativePlaybackEnded()
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
        handleNativePlaybackEnded()
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
      applyNativePlaybackInfo(info)
    })
  )

  if (typeof api.onLoudnormStatus === 'function') {
    cleanupFns.push(
      api.onLoudnormStatus((event) => {
        loudnormStatus.value = event.status
        loudnormStatusSource.value = event.source
      })
    )
  }

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
      const recoveredFromServiceCrash = audioEngineRecoveryNotice.value?.kind === 'service-crash'
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
        const defaultScene = snapshot.settings.dspScenes?.find((scene) => scene.id === 'default')
        if (defaultScene?.graph?.outputStage) {
          dspOutputStage.value = mergeDspOutputStage(defaultScene.graph.outputStage, {})
        }
        if (defaultScene?.graph) {
          dspStereoImage.value = extractStereoImageFromGraph(defaultScene.graph)
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
  if (queueIndex.value + 1 >= queue.value.length) return

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
  const normalizedStartTime = clampCuePlaybackPosition(track, startTime)
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
  duration.value = cueDuration(track)
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
      try {
        const preparedQueue = await preparePlayerNativeQueue(
          {
            queue: queue.value,
            currentTrack: track,
            currentTarget: playTarget,
            currentIndex: queueIndex.value
          },
          {
            isAudioFileAuthorized: window.api.fs.isAudioFileAuthorized,
            getOfflinePlayablePaths: window.api.offline.getPlayablePaths
          }
        )
        if (!preparedQueue) {
          throw new Error('Native playback target is unavailable')
        }

        await window.api.audioEngine.loadQueue(preparedQueue.items, preparedQueue.startIndex)
        if (!isActiveLoad(loadToken, track)) return
        nativeQueueDelegated = preparedQueue.delegated

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
    const track = currentTrack.value
    setCurrentTimeImmediate(0)
    if (track && loadedTrackId !== track.id) {
      restoredPlaybackPending = true
      restoredPlaybackPosition = 0
    } else {
      if (nativePlaybackActive) {
        window.api.audioEngine.seek(0).catch(() => {})
      } else if (playbackAudio && track) {
        playbackAudio.currentTime = rendererAudioAbsolutePositionForTrack(0, track)
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
  const track = currentTrack.value
  const position = track ? clampCuePlaybackPosition(track, time) : Math.max(0, time)
  if (currentTrack.value && loadedTrackId !== currentTrack.value.id) {
    restoredPlaybackPending = true
    restoredPlaybackPosition = position
    setCurrentTimeImmediate(restoredPlaybackPosition)
    return
  }
  setCurrentTimeImmediate(position)
  if (nativePlaybackActive) {
    window.api.audioEngine.seek(position).catch(() => {})
  } else if (playbackAudio && track) {
    playbackAudio.currentTime = rendererAudioAbsolutePositionForTrack(position, track)
  }
}

let playerIntegrationSideEffectsSetup = false
let mediaSessionHandlersBound = false
let mediaSessionMetadataKey = ''
let discordPlayStartTimestamp: number | null = null
let desktopLyricsTimeThrottle = 0
function persistSelectedTrackSession(): void {
  const mode = appSettings.value.playbackResumeMode
  if (mode === 'off') return

  const session = createPlaybackSession(mode)
  if (!session) return

  const dataApi = window.api?.data
  if (!dataApi) return

  const write = playbackSessionWriter.save(dataApi, session)
  void write.completion.catch((err) => {
    console.warn('保存已选曲目播放会话失败:', err)
  })
}

function clearPersistedSelectedTrackSession(): void {
  const dataApi = window.api?.data
  if (!dataApi) return
  const write = playbackSessionWriter.clear(dataApi)
  void write.completion.catch((error) => {
    console.warn('清理不可用队列的播放会话失败:', error)
  })
}

function persistPlaybackSessionAfterQueueMutation(): void {
  if (!currentTrack.value || appSettings.value.playbackResumeMode === 'off') {
    clearPersistedSelectedTrackSession()
    return
  }
  persistSelectedTrackSession()
}

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
  if (window.api.sleepTimer) {
    void window.api.sleepTimer.getState().then((state) => {
      if (state?.active) getSleepTimerController().applyAuthoritativeState(state)
    })
    window.api.sleepTimer.onState((state) => {
      getSleepTimerController().applyAuthoritativeState(state)
    })
    window.api.sleepTimer.onTrigger((state) => {
      getSleepTimerController().applyTrigger(state)
    })
  }

  // This is deliberately owned by the player state machine rather than the
  // application shell. A user can select a track before asynchronous startup
  // work completes, and that selection must still survive a later restart.
  watch(
    () => currentTrack.value?.id,
    (trackId, previousTrackId) => {
      if (!trackId || trackId === previousTrackId) return
      persistSelectedTrackSession()
    },
    { flush: 'sync' }
  )

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

  watch(
    [() => currentTrack.value?.id, isPlaying],
    () => {
      const track = currentTrack.value
      if (track && isPlaying.value) void requestBpmAnalysisForTrack(track)
    },
    { immediate: true }
  )

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

  window.api?.bpmAnalysis?.onCompleted((event) => {
    applyBpmAnalysisToTrack(event.trackId, event.filePath, event.analysis)
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

function commitQueueEdit(nextQueue: readonly Track[], nextIndex: number): void {
  const snapshots = toPlaybackQueueSnapshots(nextQueue)
  queue.value = snapshots
  originalQueue.value = [...snapshots]
  queueIndex.value =
    snapshots.length === 0 ? -1 : Math.max(0, Math.min(nextIndex, snapshots.length - 1))
  persistPlaybackSessionAfterQueueMutation()
  void queueNativeQueueStateSync().catch((error) => {
    audioEngineError.value = error instanceof Error ? error.message : String(error)
  })
}

function enqueueTrack(track: Track): void {
  const next = [...queue.value, track]
  commitQueueEdit(next, queueIndex.value)
}

function playNextTrack(track: Track): void {
  const insertAt = queueIndex.value >= 0 ? queueIndex.value + 1 : 0
  const next = [...queue.value]
  next.splice(insertAt, 0, track)
  commitQueueEdit(next, queueIndex.value)
}

function removeQueueItem(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= queue.value.length) return
  const next = [...queue.value]
  next.splice(index, 1)
  const nextIndex = index < queueIndex.value ? queueIndex.value - 1 : queueIndex.value
  commitQueueEdit(next, nextIndex)
}

function clearQueue(): void {
  commitQueueEdit([], -1)
  currentTrack.value = null
  isPlaying.value = false
  automaticLyricsBaselines.clear()
}

function reorderQueue(fromIndex: number, toIndex: number): void {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= queue.value.length ||
    toIndex >= queue.value.length ||
    fromIndex === toIndex
  )
    return
  const next = [...queue.value]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  let nextIndex = queueIndex.value
  if (queueIndex.value === fromIndex) nextIndex = toIndex
  else if (fromIndex < queueIndex.value && toIndex >= queueIndex.value) nextIndex--
  else if (fromIndex > queueIndex.value && toIndex <= queueIndex.value) nextIndex++
  commitQueueEdit(next, nextIndex)
}

function saveQueueAsPlaylist(
  name: string,
  createPlaylistWithTracks: (name: string, tracks: Track[]) => string
): string {
  return createPlaylistWithTracks(name, [...queue.value])
}

function cyclePlayMode(): void {
  const modes: PlayMode[] = ['sequential', 'listLoop', 'repeat', 'shuffle']
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
    queueEntryId: track.queueEntryId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    filePath: track.filePath,
    fileName: track.fileName,
    dir: track.dir,
    subTrack: track.subTrack,
    cueRange: track.cueRange ? { ...track.cueRange } : undefined,
    cueSheetPath: track.cueSheetPath,
    cueEncoding: track.cueEncoding,
    duration: track.duration,
    size: track.size,
    cover: track.cover,
    lyrics: null,
    source: track.source,
    ncmSongId: track.ncmSongId,
    streamUrl: source === 'local' ? track.streamUrl : null,
    offlinePath: track.offlinePath ?? null,
    format: track.format,
    sampleRate: track.sampleRate,
    bitrate: track.bitrate,
    bitDepth: track.bitDepth,
    bpm: track.bpm,
    bpmAnalysis: track.bpmAnalysis,
    replayGainTrackGainDb: track.replayGainTrackGainDb,
    replayGainAlbumGainDb: track.replayGainAlbumGainDb,
    replayGainTrackPeak: track.replayGainTrackPeak,
    replayGainAlbumPeak: track.replayGainAlbumPeak,
    r128TrackGainDb: track.r128TrackGainDb,
    r128AlbumGainDb: track.r128AlbumGainDb
  }
  return cloned
}

function restorePlaybackSession(session: PlaybackSession): void {
  const track = cloneTrackForPlaybackSession(session.track)
  const position =
    session.mode === 'trackAndPosition' ? clampCuePlaybackPosition(track, session.position) : 0

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
  queue.value = toPlaybackQueueSnapshots(savedQueue)
  originalQueue.value = [...queue.value]
  queueIndex.value = savedIndex

  duration.value = cueDuration(track)
  isPlaying.value = false
  isLoading.value = false
  restoredPlaybackPending = true
  restoredPlaybackPosition = position
  pendingLoadStartTime = 0
  autoAdvanceInFlight = false
  advancingFromEndedTrackId = ''
  setCurrentTimeImmediate(position)
  clearSleepTimerIntervals()
  const sleepTimer = getRestorableSleepTimerState(session.sleepTimer)
  if (sleepTimer) {
    getSleepTimerController().applyAuthoritativeState(sleepTimer)
    void window.api.sleepTimer?.configure(sleepTimer).catch(() => {})
  }
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
    queueIndex: queueIndex.value,
    ...(sleepTimerState.value?.active ? { sleepTimer: sleepTimerState.value } : {})
  }
}

function removeUnavailableTracks(trackIds: string[], filePaths: string[]): void {
  for (const trackId of trackIds) automaticLyricsBaselines.delete(trackId)
  const nextState = pruneUnavailableLocalTracks(
    {
      currentTrack: currentTrack.value,
      queue: queue.value,
      originalQueue: originalQueue.value,
      queueIndex: queueIndex.value
    },
    trackIds,
    filePaths
  )
  const queueChanged =
    nextState.queue.length !== queue.value.length ||
    nextState.originalQueue.length !== originalQueue.value.length ||
    nextState.queueIndex !== queueIndex.value

  queue.value = nextState.queue
  originalQueue.value = nextState.originalQueue
  queueIndex.value = nextState.queueIndex
  if (nextState.activeTrackRemoved) {
    clearCrossfadeTimer()
    resetPlaybackRuntimeStateForRestore()
    currentTrack.value = null
    isPlaying.value = false
    isLoading.value = false
    duration.value = 0
    setCurrentTimeImmediate(0)
    clearPersistedSelectedTrackSession()
    return
  }

  currentTrack.value = nextState.currentTrack
  if (queueChanged) persistPlaybackSessionAfterQueueMutation()
  if (nativePlaybackActive) {
    void queueNativeQueueStateSync().catch((error) => {
      console.warn('[audio-engine] Failed to synchronize queue after library removal:', error)
    })
  }
}

onLocalTracksUnavailable(removeUnavailableTracks)

export function usePlayerStore(): {
  currentTrack: Ref<Track | null>
  dominantColor: Ref<string>
  isPlaying: Ref<boolean>
  isLoading: Ref<boolean>
  currentTime: Ref<number>
  duration: Ref<number>
  volume: Ref<number>
  muted: Ref<boolean>
  sleepTimerState: Ref<SleepTimerState | null>
  sleepTimerNotice: Ref<string | null>
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
  audioOutputConfigApplyStatus: Ref<OutputConfigApplyStatus>
  dspOutputStage: Ref<DspOutputStageConfig>
  dspStereoImage: Ref<DspStereoImageConfig>
  playbackInfo: Ref<NativePlaybackInfo | null>
  loudnormStatus: Ref<'idle' | 'measuring' | 'cached' | 'fallback' | 'unavailable'>
  loudnormStatusSource: Ref<string | null>
  outputInfo: ComputedRef<NativeOutputInfo | null>
  visualizationData: Ref<NativeVisualizationData>
  cyclePlayMode: () => void
  setPlayMode: (mode: PlayMode) => void
  enqueueTrack: (track: Track) => void
  playNextTrack: (track: Track) => void
  removeQueueItem: (index: number) => void
  clearQueue: () => void
  reorderQueue: (fromIndex: number, toIndex: number) => void
  saveQueueAsPlaylist: (
    name: string,
    createPlaylistWithTracks: (name: string, tracks: Track[]) => string
  ) => string
  playTrack: (track: Track, trackList?: Track[]) => void
  togglePlay: () => Promise<void>
  next: () => void
  prev: () => void
  seek: (time: number) => void
  setVolume: (vol: number) => void
  toggleMute: () => void
  configureSleepTimer: (mode: SleepTimerMode, minutes?: number) => void
  cancelSleepTimer: () => void
  setUnityVolume: () => void
  toggleExclusiveMode: () => Promise<void>
  setAudioOutput: (output: AudioOutputId, device?: string) => Promise<void>
  setAudioDevice: (device: string) => Promise<void>
  setAudioOutputConfig: (config: Partial<OutputConfig>) => Promise<void>
  refreshAudioOutputState: () => Promise<void>
  dismissAudioEngineRecoveryNotice: () => void
  setAudioProcessing: (settings: Partial<AudioProcessingSettings>) => Promise<void>
  setOutputStage: (partial: Partial<DspOutputStageConfig>) => Promise<void>
  setStereoImage: (partial: Partial<DspStereoImageConfig>) => Promise<void>
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
  removeUnavailableTracks: (trackIds: string[], filePaths: string[]) => void
  clearBpmAnalysisFromPlaybackState: () => void
  refreshCurrentLyrics: () => Promise<void>
  formatTime: (seconds: number) => string
} {
  setupPlayerIntegrationSideEffects()

  function playTrack(track: Track, trackList?: Track[]): void {
    if (trackList) {
      const snapshots = toPlaybackQueueSnapshots(trackList)
      originalQueue.value = snapshots
      if (playMode.value === 'shuffle') {
        queue.value = shuffleArray(snapshots)
        queueIndex.value = queue.value.findIndex((t) => t.id === track.id)
      } else {
        queue.value = [...snapshots]
        queueIndex.value = snapshots.findIndex((t) => t.id === track.id)
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

  /** Explicit user action for bit-perfect: software gain must be unity (1.0). Does not change default 0.7. */
  function setUnityVolume(): void {
    setVolume(1)
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
    if (audioOutputConfigApplyStatus.value.state === 'pending') return
    audioOutputConfigApplyStatus.value = {
      ...audioOutputConfigApplyStatus.value,
      requestedRevision: audioOutputConfigApplyStatus.value.requestedRevision + 1,
      state: 'pending',
      error: ''
    }
    try {
      audioOutputConfig.value = await window.api.audioEngine.setOutputConfig({
        ...audioOutputConfig.value,
        ...config
      })
      audioOutputConfigApplyStatus.value = await window.api.audioEngine.getOutputConfigApplyStatus()
      playbackInfo.value = normalizeNativePlaybackInfo(
        await window.api.audioEngine.getPlaybackInfo()
      )
    } catch (err) {
      audioEngineError.value = err instanceof Error ? err.message : String(err)
      audioOutputConfigApplyStatus.value = {
        ...audioOutputConfigApplyStatus.value,
        failedRevision: audioOutputConfigApplyStatus.value.requestedRevision,
        state: 'failed',
        error: audioEngineError.value
      }
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
      // Classic processing rewrites the default graph but must keep sample-rate lock;
      // re-sync output stage from scene state after apply.
      try {
        const sceneState = await window.api.audioEngine.getDspSceneState()
        const defaultScene = sceneState?.scenes?.find((scene) => scene.id === 'default')
        const graph = defaultScene?.graph ?? sceneState?.graph
        if (graph?.outputStage) {
          dspOutputStage.value = mergeDspOutputStage(graph.outputStage, {})
        }
        if (graph) {
          dspStereoImage.value = extractStereoImageFromGraph(graph)
        }
      } catch {
        // Scene state is optional for older bridges; processing still applied.
      }
      playbackInfo.value = normalizeNativePlaybackInfo(
        await window.api.audioEngine.getPlaybackInfo()
      )
      scheduleCrossfadeIfNeeded()
    } catch (err) {
      console.error('[audio-engine] Failed to update audio processing settings:', err)
      await persistAudioProcessingFallback(nextSettings, err)
    }
  }

  /**
   * Patch default-scene graph.outputStage (sample-rate lock / resampler / dither).
   * Does not invent OutputConfig fields — rate lock lives only on the DSP graph.
   */
  async function setOutputStage(partial: Partial<DspOutputStageConfig>): Promise<void> {
    const next = mergeDspOutputStage(dspOutputStage.value, partial)
    dspOutputStage.value = next
    try {
      const state = await window.api.audioEngine.setOutputStage(partial)
      const defaultScene = state?.scenes?.find((scene) => scene.id === 'default')
      if (defaultScene?.graph?.outputStage) {
        dspOutputStage.value = mergeDspOutputStage(defaultScene.graph.outputStage, {})
      } else if (state?.graph?.outputStage) {
        dspOutputStage.value = mergeDspOutputStage(state.graph.outputStage, {})
      }
      playbackInfo.value = normalizeNativePlaybackInfo(
        await window.api.audioEngine.getPlaybackInfo()
      )
    } catch (err) {
      audioEngineError.value = err instanceof Error ? err.message : String(err)
      console.error('[音频引擎] 更新输出采样率锁失败:', err)
      try {
        const sceneState = await window.api.audioEngine.getDspSceneState()
        const defaultScene = sceneState?.scenes?.find((scene) => scene.id === 'default')
        const graph = defaultScene?.graph ?? sceneState?.graph
        if (graph?.outputStage) {
          dspOutputStage.value = mergeDspOutputStage(graph.outputStage, {})
        }
        if (graph) {
          dspStereoImage.value = extractStereoImageFromGraph(graph)
        }
      } catch {
        // keep optimistic value if scene state is unavailable
      }
    }
  }

  /**
   * Patch default-scene stereoField balance/width + channelStrip polarity.
   * Graph-only; not classic audioProcessing fields.
   */
  async function setStereoImage(partial: Partial<DspStereoImageConfig>): Promise<void> {
    dspStereoImage.value = mergeDspStereoImage(dspStereoImage.value, partial)
    try {
      const state = await window.api.audioEngine.setStereoImage(partial)
      const defaultScene = state?.scenes?.find((scene) => scene.id === 'default')
      const graph = defaultScene?.graph ?? state?.graph
      if (graph) {
        dspStereoImage.value = extractStereoImageFromGraph(graph)
      }
      playbackInfo.value = normalizeNativePlaybackInfo(
        await window.api.audioEngine.getPlaybackInfo()
      )
    } catch (err) {
      audioEngineError.value = err instanceof Error ? err.message : String(err)
      console.error('[音频引擎] 更新平衡/相位失败:', err)
      try {
        const sceneState = await window.api.audioEngine.getDspSceneState()
        const defaultScene = sceneState?.scenes?.find((scene) => scene.id === 'default')
        const graph = defaultScene?.graph ?? sceneState?.graph
        if (graph) {
          dspStereoImage.value = extractStereoImageFromGraph(graph)
        }
      } catch {
        // keep optimistic value
      }
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

  async function refreshCurrentLyrics(): Promise<void> {
    await ensureCurrentTrackLyricsLoaded(currentTrack.value)
  }

  return {
    currentTrack,
    dominantColor,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    volume,
    muted,
    sleepTimerState,
    sleepTimerNotice,
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
    audioOutputConfigApplyStatus,
    dspOutputStage,
    dspStereoImage,
    playbackInfo,
    loudnormStatus,
    loudnormStatusSource,
    outputInfo,
    visualizationData,
    cyclePlayMode,
    setPlayMode,
    enqueueTrack,
    playNextTrack,
    removeQueueItem,
    clearQueue,
    reorderQueue,
    saveQueueAsPlaylist,
    playTrack,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    configureSleepTimer,
    cancelSleepTimer,
    setUnityVolume,
    toggleExclusiveMode,
    setAudioOutput,
    setAudioDevice,
    setAudioOutputConfig,
    refreshAudioOutputState,
    dismissAudioEngineRecoveryNotice,
    setAudioProcessing,
    setOutputStage,
    setStereoImage,
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
    removeUnavailableTracks,
    clearBpmAnalysisFromPlaybackState,
    refreshCurrentLyrics,
    formatTime
  }
}
