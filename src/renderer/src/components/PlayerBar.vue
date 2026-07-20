<script setup lang="ts">
import { ref, computed, onMounted, type ComponentPublicInstance } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useMusicStore } from '../stores/useMusicStore'
import { useExtensionRegistry } from '../extensions/registry'
import { useMediaProviders } from '../providers'
import { syncPluginProviders } from '../providers'
import { normalizeAccentColor } from '../utils/colorExtractor'
import { useCover } from '../utils/coverLoader'
import { resolveLyricsWithSources } from '../utils/lyricSourceResolution'
import { HIFI_STATUS_COPY } from '../../../shared/audioProcessingOptions.ts'
import CoverImg from './CoverImg.vue'
import HiFiSidebar from './player-bar/HiFiSidebar.vue'
import nextTrackIcon from '../assets/icons/next-track.svg'
import pauseIcon from '../assets/icons/pause.svg'
import playIcon from '../assets/icons/play.svg'
import previousTrackIcon from '../assets/icons/previous-track.svg'
import repeatIcon from '../assets/icons/single-song-repeat.svg'
import sequentialIcon from '../assets/icons/sequential-playback.svg'
import shuffleIcon from '../assets/icons/shuffle.svg'
import { useFavoriteButton } from './player-bar/useFavoriteButton'
import { useFloatingPanels } from './player-bar/useFloatingPanels'
import { usePlaybackQueueVirtualScroll } from './player-bar/usePlaybackQueueVirtualScroll'
import { usePlaybackQueueDrawerActions } from './player-bar/usePlaybackQueueDrawerActions'
import type {
  AudioOutputId,
  ChannelRoutingMode,
  DsdOutputMode,
  VolumeNormalizationMode
} from '../types/settings'

defineProps<{
  glass?: boolean
  menuOpen?: boolean
}>()

const {
  currentTrack,
  dominantColor,
  isPlaying,
  currentTime,
  duration,
  volume,
  muted,
  sleepTimerState,
  sleepTimerNotice,
  queue,
  queueIndex,
  playMode,
  exclusiveMode,
  audioOutput,
  audioOutputOptions,
  audioDevice,
  audioDeviceOptions,
  audioEngineError,
  audioEngineRecoveryNotice,
  audioProcessing,
  audioOutputConfig,
  dspOutputStage,
  dspStereoImage,
  playbackInfo,
  loudnormStatus,
  outputInfo,
  cyclePlayMode,
  togglePlay,
  next,
  prev,
  seek,
  playTrack,
  enqueueTrack,
  playNextTrack,
  removeQueueItem,
  clearQueue,
  reorderQueue,
  saveQueueAsPlaylist,
  toggleExclusiveMode,
  dismissAudioEngineRecoveryNotice,
  formatTime,
  setUnityVolume,
  toggleMute,
  configureSleepTimer,
  cancelSleepTimer,
  setAudioProcessing,
  setAudioOutputConfig,
  setAudioOutput,
  setAudioDevice,
  setOutputStage,
  setStereoImage,
  refreshAudioOutputState,
  toggleDspEnabled,
  toggleEqEnabled,
  toggleCrossfeed,
  toggleGapless,
  setReplayGainMode,
  setCrossfeedStrength,
  selectImpulseResponse,
  clearImpulseResponse
} = usePlayerStore()

const resolvedCurrentCover = useCover(computed(() => currentTrack.value?.cover ?? null))
const {
  playlists,
  addToPlaylist,
  removeFromPlaylist,
  createPlaylist,
  createPlaylistWithTracks,
  isFavoriteTrack,
  addFavoriteTrack,
  removeFavoriteTrack
} = useMusicStore()
const mediaProviders = useMediaProviders()

const coverRef = ref<HTMLElement | null>(null)
const playerBarShellRef = ref<HTMLElement | null>(null)
const playButtonColor = computed(() => normalizeAccentColor(dominantColor.value))
const { uiContributions, syncExtensions } = useExtensionRegistry()
const playerBarButtons = computed(() =>
  uiContributions.value.filter((contribution) => contribution.kind === 'playerBarButton')
)
const { settings } = useSettingsStore()
const desktopLyricsOn = ref(settings.value.desktopLyrics.enabled)
const miniPlayerOpening = ref(false)
const lyricsReloading = ref(false)

async function toggleDesktopLyrics(): Promise<void> {
  const enabled = await window.api.desktopLyrics.toggle()
  desktopLyricsOn.value = enabled
}

async function openMiniPlayer(): Promise<void> {
  if (miniPlayerOpening.value) return
  miniPlayerOpening.value = true
  try {
    await window.api.miniPlayer.open()
  } catch (error) {
    console.error('[mini-player] Failed to open mini player:', error)
  } finally {
    miniPlayerOpening.value = false
  }
}

// Keep in sync when toggled from settings
window.api.desktopLyrics.onToggle((enabled: boolean) => {
  desktopLyricsOn.value = enabled
})

const emit = defineEmits<{
  clickCover: [rect: { x: number; y: number; w: number; h: number }]
  openSettings: []
  openDsp: []
  openEqualizer: []
}>()

function onCoverClick(): void {
  const el = coverRef.value
  if (el) {
    const r = el.getBoundingClientRect()
    emit('clickCover', { x: r.left, y: r.top, w: r.width, h: r.height })
  } else {
    emit('clickCover', { x: 24, y: window.innerHeight - 60, w: 48, h: 48 })
  }
}

function onProgressInput(event: Event): void {
  const target = event.target as HTMLInputElement
  seek(Number(target.value))
}

function onVolumeInput(event: Event): void {
  const target = event.target as HTMLInputElement
  volume.value = clampVolume(Number(target.value))
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return volume.value
  return Math.min(1, Math.max(0, value))
}

function onVolumeWheel(event: WheelEvent): void {
  event.preventDefault()
  if (!volumeOpen.value) {
    volumeOpen.value = true
    playlistOpen.value = false
    moreOpen.value = false
  }
  const step = event.shiftKey ? 0.01 : 0.04
  volume.value = clampVolume(volume.value + (event.deltaY < 0 ? step : -step))
}

function onSleepTimerSelect(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'off') {
    cancelSleepTimer()
    return
  }
  if (value === 'trackEnd' || value === 'queueEnd') {
    configureSleepTimer(value)
    return
  }
  configureSleepTimer('minutes', Number(value))
}

const sleepTimerStatus = computed(() => {
  if (sleepTimerNotice.value) return sleepTimerNotice.value
  const state = sleepTimerState.value
  if (!state?.active) return ''
  if (state.mode === 'trackEnd') return '当前曲结束后停止'
  if (state.mode === 'queueEnd') return '队列结束后停止'
  if (!state.endsAt) return ''
  return `${Math.max(1, Math.ceil((state.endsAt - Date.now()) / 60_000))} 分钟后停止`
})

const {
  volumeOpen,
  playlistOpen,
  moreOpen,
  floatingPanelOpen,
  dismissFloatingPanels,
  toggleVolume,
  togglePlaylist,
  toggleMore
} = useFloatingPanels(playerBarShellRef)

const {
  containerRef: playlistListRef,
  visibleItems: visibleQueueItems,
  totalHeight: queueVirtualHeight,
  translateY: queueVirtualTranslateY,
  onScroll: onQueueScroll
} = usePlaybackQueueVirtualScroll(queue, queueIndex, playlistOpen)

const queuePlaylistName = ref('Current Queue')
const queueDrawerNotice = ref('')
const {
  draggedEntryId,
  getEntryIndex,
  playNext: playQueueEntryNext,
  addToTail: addQueueEntryToTail,
  remove: removeQueueEntry,
  clear: clearPlaybackQueue,
  saveAsPlaylist,
  onDragStart: onQueueDragStart,
  onDragOver: onQueueDragOver,
  onDrop: onQueueDrop,
  onDragEnd: onQueueDragEnd
} = usePlaybackQueueDrawerActions({
  queue,
  commands: {
    enqueueTrack,
    playNextTrack,
    removeQueueItem,
    clearQueue,
    reorderQueue,
    saveQueueAsPlaylist
  },
  createPlaylistWithTracks
})

function setPlaylistListRef(element: Element | ComponentPublicInstance | null): void {
  playlistListRef.value = element instanceof HTMLElement ? element : null
}

function playQueueEntry(queueEntryId: string): void {
  const index = getEntryIndex(queueEntryId)
  if (index !== -1) playTrackAt(index)
}

function savePlaybackQueue(): void {
  const playlistId = saveAsPlaylist(queuePlaylistName.value)
  queueDrawerNotice.value = playlistId ? 'Queue saved' : 'Enter a playlist name'
}

function clearPlaybackQueueFromDrawer(): void {
  clearPlaybackQueue()
  queueDrawerNotice.value = 'Queue cleared'
}

function dismissAllFloatingPanels(): void {
  dismissFloatingPanels()
}

const {
  favoriteButtonVisible,
  favoriteButtonLiked,
  favoriteButtonLoading,
  favoriteButtonTitle,
  toggleFavorite
} = useFavoriteButton({
  currentTrack,
  playlists,
  mediaProviders,
  addToPlaylist,
  removeFromPlaylist,
  createPlaylist,
  isFavoriteTrack,
  addFavoriteTrack,
  removeFavoriteTrack
})

const modeLabels: Record<string, string> = {
  sequential: '顺序播放',
  listLoop: '列表循环',
  repeat: '单曲循环',
  shuffle: '随机播放'
}

const modeTitle = computed(() => modeLabels[playMode.value] ?? '')
const selectedAudioOutput = computed(() =>
  audioOutputOptions.value.find((option) => option.id === audioOutput.value)
)
const exclusiveAvailable = computed(() => selectedAudioOutput.value?.supportsExclusive ?? false)
const backendLabels: Record<string, string> = {
  wasapi: 'WASAPI Shared',
  'wasapi-exclusive': 'WASAPI Exclusive',
  asio: 'ASIO',
  coreaudio: 'CoreAudio',
  'coreaudio-exclusive': 'CoreAudio Hog',
  alsa: 'ALSA'
}
const reasonCodeLabels: Record<string, string> = {
  shared_mixer: '共享输出经过系统混音器',
  processing_active: '当前处理链正在改变样本',
  replaygain_active: 'ReplayGain 正在改变样本',
  loudnorm_active: HIFI_STATUS_COPY.loudnormActive,
  eq_active: 'EQ 正在改变样本',
  convolver_active: 'Convolver 正在改变样本',
  crossfeed_active: 'Crossfeed 正在改变声道内容',
  crossfade_active: 'Crossfade 正在改变播放连续性',
  volume_not_unity: HIFI_STATUS_COPY.volumeNotUnity,
  routing_changes_semantics: '声道路由或通道语义发生变化',
  hog_mode_failed: '无法获取 CoreAudio Hog Mode 独占访问',
  sample_rate_unsupported: '设备不支持请求的采样率',
  pcm_converted: 'PCM 格式或采样率发生转换',
  integer_passthrough_unavailable: '源格式与设备实际输出格式不一致，无法 PCM 直通',
  source_lossy: '源文件是有损格式，不能 Source Exact',
  source_format_differs: '源格式与输出链不一致',
  backend_not_output_perfect: '当前输出路径未声明 bit-perfect 能力',
  output_not_perfect: '当前输出链尚未验证为直通',
  visualization_inactive: '当前没有可视化采样数据',
  dsd_processing_pcm_fallback: 'DSD 因处理链启用而回退到 PCM',
  dsd_high_rate_pcm_fallback: 'DSD 因采样率或驱动限制回退到 PCM',
  dsd_converted_to_pcm: 'DSD 当前已转换为 PCM 输出',
  dsd_source_unsupported: '当前 DSD 源或模式不受支持',
  sacd_iso_unsupported: 'SACD ISO 不含可播放的未压缩 DSD 区域',
  dst_dsd_provider_unavailable: 'SACD DST 需要保留 DSD 的 provider，当前不可用',
  dst_dsd_provider_failed: 'SACD DST 保 DSD provider 解码失败',
  dsd_dop: '当前 DSD 正在通过 DoP 载波传输',
  dop_carrier_mismatch: 'DoP 载波格式与目标 DSD 速率不匹配',
  dop_passthrough_unproven: 'DoP 输出路径未能证明直通',
  plugin_path: '当前设备路径包含插件或混音层',
  device_not_found: '当前后端没有找到请求设备',
  format_not_supported: '当前设备不支持请求的输出格式',
  backend_open_failure: '输出后端打开失败',
  backend_start_failure: '输出后端启动失败',
  buffer_failure: '输出缓冲失败或发生 underrun',
  device_lost: '输出设备已断开，需要恢复',
  driver_restart: '驱动发生重启或重置'
}
const accessModeLabels: Record<string, string> = {
  shared: 'Shared',
  exclusive: 'Exclusive',
  hog: 'Hog',
  direct: 'Direct',
  plugin: 'Plugin'
}
const nativeDsdStateLabels: Record<string, string> = {
  unsupported: 'Native DSD Unsupported',
  candidate: 'Native DSD Candidate',
  unproven: 'Native DSD Unproven',
  mismatch: 'Native DSD Mismatch',
  proven: 'Native DSD Proven'
}

function canonicalSourceExact(): boolean {
  return outputInfo.value?.sourceExact === true
}

function canonicalOutputPerfect(): boolean {
  return outputInfo.value?.outputPerfect === true
}

function formatBackendLabel(backend: string): string {
  return backendLabels[backend] ?? backend
}

function formatPerfectReason(reason: string): string {
  const trimmed = reason.trim()
  if (!trimmed) return ''
  return trimmed
}

function resolvePerfectReasonText(): string {
  const code = outputInfo.value?.perfectReasonCode || playbackInfo.value?.perfectReasonCode || ''
  if (code && reasonCodeLabels[code]) return reasonCodeLabels[code]
  const capabilityReason = outputInfo.value?.capabilityReason?.trim() || ''
  if (capabilityReason) return capabilityReason
  return formatPerfectReason(
    outputInfo.value?.perfectReason || playbackInfo.value?.perfectReason || ''
  )
}

function nativeDsdRuntimeTone(state: string): 'success' | 'warning' | 'muted' {
  if (state === 'proven') return 'success'
  if (state === 'candidate' || state === 'unproven' || state === 'mismatch') return 'warning'
  return 'muted'
}

const nativeDsdRuntimeText = computed(() => {
  const info = outputInfo.value
  if (!info) return ''
  const state = info.nativeDsdRuntimeState || 'unsupported'
  const hasRuntimeInterest =
    state !== 'unsupported' ||
    info.driverNativeDsdCapable ||
    info.nativeDsdRequestedRate > 0 ||
    info.nativeDsdExplicitlyCapable
  if (!hasRuntimeInterest) return ''
  const label = nativeDsdStateLabels[state] ?? `Native DSD ${state}`
  const rate =
    info.nativeDsdActualRate ||
    info.nativeDsdRequestedRate ||
    info.driverNativeDsdSampleRates?.[0] ||
    0
  return rate > 0 ? `${label} ${compactRate(rate)}` : label
})

const audioStatusChips = computed(() => {
  const chips: { label: string; tone?: 'success' | 'warning' | 'muted' }[] = []
  const sourceExact = canonicalSourceExact()
  const outputPerfect = canonicalOutputPerfect()
  chips.push({ label: 'Source Exact', tone: sourceExact ? 'success' : 'muted' })
  chips.push({
    label: 'Output Perfect',
    tone: outputPerfect ? 'success' : outputInfo.value?.supportsOutputPerfect ? 'warning' : 'muted'
  })
  if (outputInfo.value?.resampled) chips.push({ label: 'Resampled', tone: 'warning' })
  if (playbackInfo.value?.dspActive) chips.push({ label: 'DSP', tone: 'warning' })
  if (exclusiveMode.value) chips.push({ label: 'Exclusive', tone: 'success' })
  if (outputInfo.value?.accessMode) {
    chips.push({
      label: accessModeLabels[outputInfo.value.accessMode] ?? outputInfo.value.accessMode,
      tone: outputInfo.value.accessMode === 'shared' ? 'muted' : 'success'
    })
  }
  if (nativeDsdRuntimeText.value) {
    chips.push({
      label: nativeDsdRuntimeText.value,
      tone: nativeDsdRuntimeTone(outputInfo.value?.nativeDsdRuntimeState || 'unsupported')
    })
  }
  return chips
})
const nonPerfectReason = computed(() => {
  const sourceExact = canonicalSourceExact()
  const outputPerfect = canonicalOutputPerfect()
  if (sourceExact && outputPerfect) return ''
  const reason = resolvePerfectReasonText()
  return reason ? `未达成：${reason}` : ''
})
const perfectReasonCode = computed(
  () => outputInfo.value?.perfectReasonCode || playbackInfo.value?.perfectReasonCode || ''
)
const showVolumeNotUnityCta = computed(() => perfectReasonCode.value === 'volume_not_unity')
function compactRate(rate: number): string {
  return rate > 0 ? `${Math.round(rate / 100) / 10}kHz` : ''
}

function compactSampleFormat(format: string, bitDepth: number): string {
  const normalized = format.trim().toLowerCase()
  if (/^(f32|float|float32|flt|fltp)$/.test(normalized)) return 'float32'
  if (/^(s24|s24_3le|int24|int24in32|s32p24)/.test(normalized)) return 'int24'
  if (/^(s16|s16le|int16)/.test(normalized)) return 'int16'
  if (/^(s32|s32le|int32)/.test(normalized)) return 'int32'
  return format || (bitDepth > 0 ? `${bitDepth}bit` : '')
}

function compactPcm(
  format: string,
  bitDepth: number,
  sampleRate: number,
  channels: number,
  includeRate = true
): string {
  const parts = [
    compactSampleFormat(format, bitDepth),
    includeRate && sampleRate > 0 ? compactRate(sampleRate) : '',
    channels > 0 ? `${channels}ch` : ''
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'PCM'
}

function isSacdIsoSource(info: NonNullable<typeof playbackInfo.value>): boolean {
  return info.source.split('.').pop()?.toUpperCase() === 'ISO'
}

function inferDsdRate(sampleRate: number): number {
  if (sampleRate >= 20000000) return 512
  if (sampleRate >= 10000000) return 256
  if (sampleRate >= 5000000) return 128
  if (sampleRate >= 2500000) return 64
  return 0
}

function isDsdSource(info: NonNullable<typeof playbackInfo.value>): boolean {
  return /\.(dsf|dff)$/i.test(info.source) || info.codec.trim().toLowerCase() === 'dsd'
}

function isDsdPlayback(): boolean {
  const out = outputInfo.value
  return (
    out?.isDsd === true ||
    out?.dsdMode === 'native' ||
    out?.dsdMode === 'dop' ||
    out?.dsdMode === 'unsupported'
  )
}

function formatDsdSource(info: NonNullable<typeof playbackInfo.value>): string {
  const ext = info.source.split('.').pop()?.toUpperCase()
  const container = ext === 'DSF' || ext === 'DFF' ? ext : ext === 'ISO' ? 'SACD ISO' : 'DSD'
  const dsdRate = outputInfo.value?.dsdRate || inferDsdRate(info.sourceSampleRate)
  return [container, dsdRate > 0 ? `DSD${dsdRate}` : 'DSD'].filter(Boolean).join(' ')
}

function formatDecodedStage(info: NonNullable<typeof playbackInfo.value>): string {
  const pcm = compactPcm(
    info.decodedSampleFormat,
    info.decodedBitDepth,
    info.decodedSampleRate,
    info.decodedChannels,
    false
  )
  if (!isDsdSource(info) && !isDsdPlayback()) return pcm
  const mode = outputInfo.value?.dsdMode || 'pcm'
  if (mode === 'native') return 'Native DSD path'
  if (mode === 'dop') return `DoP carrier ${pcm}`
  if (mode === 'unsupported' && isSacdIsoSource(info)) return 'SACD unsupported'
  return `PCM fallback ${pcm}`
}

const outputChainText = computed(() => {
  const info = playbackInfo.value
  if (!info) return ''
  const source =
    isDsdSource(info) || isSacdIsoSource(info)
      ? formatDsdSource(info)
      : [
          info.codec || 'Source',
          info.sourceBitDepth > 0 ? `${info.sourceBitDepth}bit` : '',
          compactRate(info.sourceSampleRate)
        ]
          .filter(Boolean)
          .join(' ')
  const decoded = formatDecodedStage(info)
  const out = outputInfo.value
  const backend = out?.actualBackend || info.actualBackend || ''
  const actual = compactPcm(
    out?.actualOutputFormat || info.actualOutputFormat,
    out?.actualBitDepth || info.actualBitDepth,
    out?.actualSampleRate || info.actualSampleRate,
    out?.actualChannels || info.actualChannels,
    false
  )
  const perfect =
    canonicalSourceExact() && canonicalOutputPerfect()
      ? 'Bit Perfect'
      : resolvePerfectReasonText()
        ? `Not Bit Perfect (${resolvePerfectReasonText()})`
        : 'Not Bit Perfect'
  return `${source || 'Source'} -> ${decoded} -> ${backend ? formatBackendLabel(backend) : 'Backend pending'} -> ${actual} -> ${perfect}`
})
const outputLatencyText = computed(() => {
  const info = outputInfo.value
  if (!info) return 'Latency 0.0 ms'
  const buffer = info.latencyInfo?.bufferLatencyMs ?? 0
  const driver = info.latencyInfo?.outputLatencyMs ?? 0
  const total = info.latencyInfo?.totalLatencyMs ?? info.latencyMs ?? 0
  const frames = info.bufferSizeFrames || playbackInfo.value?.bufferSizeFrames || 0
  return `Latency Buffer ${buffer.toFixed(1)} ms · Driver ${driver.toFixed(1)} ms · Total ${total.toFixed(total >= 10 ? 0 : 1)} ms${frames > 0 ? ` · ${frames} frames` : ''}`
})
const outputDiagnosticsText = computed(() => {
  const diagnostics = outputInfo.value?.diagnostics ?? playbackInfo.value?.diagnostics
  if (!diagnostics) return 'Underrun 0 · Drop 0 · Restart 0 · Lost 0 · Recovery 0'
  return `Underrun ${diagnostics.sessionUnderrunCount} · Drop ${diagnostics.sessionBufferDropCount} · Restart ${diagnostics.driverRestartCount} · Lost ${diagnostics.deviceLostCount} · Recovery ${diagnostics.sessionRecoveryCount}`
})
const nativeDsdRuntimeReasonText = computed(() => {
  const reason = outputInfo.value?.nativeDsdRuntimeReason?.trim()
  return reason ? `Native DSD: ${reason}` : ''
})

function playTrackAt(index: number): void {
  const track = queue.value[index]
  if (track) {
    queueIndex.value = index
    playTrack(track)
  }
}

function openPlaybackSettings(): void {
  moreOpen.value = false
  emit('openSettings')
}

function openDspSettings(): void {
  moreOpen.value = false
  emit('openDsp')
}

function openEqualizerPage(): void {
  moreOpen.value = false
  emit('openEqualizer')
}

async function runPlayerBarExtension(command?: string): Promise<void> {
  if (!command) return
  moreOpen.value = false
  await window.api.extensions.executeCommand(command, [currentTrack.value])
}

function onToggleClipGuard(): void {
  void setAudioProcessing({ clipGuard: !audioProcessing.value.clipGuard })
}

function onToggleConvolver(): void {
  void setAudioProcessing({
    dspEnabled: true,
    convolverEnabled: !audioProcessing.value.convolverEnabled
  })
}

function onSetReplayGainMode(mode: VolumeNormalizationMode): void {
  void setReplayGainMode(mode)
}

function onSetCrossfeedStrength(strength: number): void {
  void setCrossfeedStrength(strength)
}

function onSetCrossfadeSeconds(seconds: number): void {
  void setAudioProcessing({ crossfadeSeconds: seconds })
}

function onSetReplayGainPreamp(db: number): void {
  void setAudioProcessing({ dspEnabled: true, replayGainPreamp: db })
}

function onSetPreferredBufferSize(frames: number): void {
  void setAudioOutputConfig({ preferredBufferSize: frames })
}

function onSetRoutingMode(mode: ChannelRoutingMode): void {
  void setAudioOutputConfig({ routingMode: mode })
}

function onSetDsdOutputMode(mode: DsdOutputMode): void {
  void setAudioProcessing({ dsdOutputMode: mode })
}

function onSetAudioOutput(output: AudioOutputId): void {
  void setAudioOutput(output)
}

function onSetAudioDevice(device: string): void {
  void setAudioDevice(device)
}

function onRefreshDevices(): void {
  void refreshAudioOutputState()
}

async function onReloadLyrics(prefer: 'auto' | 'local' | 'provider'): Promise<void> {
  const track = currentTrack.value
  if (!track || lyricsReloading.value) return
  lyricsReloading.value = true
  try {
    const source =
      track.source ||
      (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)
        ? 'local'
        : track.id.includes(':')
          ? track.id.slice(0, track.id.indexOf(':'))
          : 'local')
    const canLoadLocal =
      (prefer === 'auto' || prefer === 'local') &&
      source === 'local' &&
      !!track.dir &&
      !!track.fileName
    const canLoadProvider = prefer === 'auto' || prefer === 'provider'

    const resolved = await resolveLyricsWithSources({
      track:
        prefer === 'provider' || prefer === 'local'
          ? {
              ...track,
              lyrics: null,
              translatedLyrics: null,
              lyricsSource: null,
              translatedLyricsSource: null
            }
          : track,
      loadLocalLyrics: canLoadLocal
        ? () =>
            window.api.data.getLyrics(track.dir!, track.fileName, track.filePath).catch(() => null)
        : undefined,
      loadProviderLyrics: canLoadProvider
        ? async () => {
            await syncPluginProviders()
            return mediaProviders.resolveLyrics(track)
          }
        : undefined
    })

    if (currentTrack.value?.id !== track.id) return
    currentTrack.value = {
      ...currentTrack.value,
      lyrics: resolved.lyrics ?? '',
      translatedLyrics: resolved.translatedLyrics ?? currentTrack.value.translatedLyrics ?? null,
      lyricsSource: resolved.lyricsSource,
      translatedLyricsSource: resolved.translatedLyricsSource
    }
  } catch (error) {
    console.error('[hifi] Failed to reload lyrics:', error)
  } finally {
    lyricsReloading.value = false
  }
}

onMounted(() => {
  void syncExtensions()
})
</script>

<template>
  <div
    v-if="currentTrack"
    ref="playerBarShellRef"
    class="player-bar-shell"
    :class="{ 'menu-open': menuOpen }"
  >
    <!-- 播放列表面板（向上抽屉） -->
    <button
      v-if="floatingPanelOpen"
      class="player-panel-dismiss"
      type="button"
      aria-label="关闭浮层"
      @pointerdown.prevent.stop="dismissAllFloatingPanels"
      @click.prevent.stop
    ></button>

    <Transition name="drawer-up">
      <div v-if="playlistOpen" class="playlist-panel" :class="{ 'panel-glass': glass }">
        <div class="playlist-header">
          <div class="playlist-heading">
            <span class="playlist-heading-icon">
              <i class="pi pi-list"></i>
            </span>
            <div>
              <span class="playlist-heading-title">播放列表</span>
              <span class="playlist-heading-subtitle">当前队列</span>
            </div>
          </div>
          <span class="playlist-count">{{ queue.length }} tracks</span>
        </div>
        <div class="playlist-actions" aria-label="Queue actions">
          <label class="playlist-save-label">
            <span class="sr-only">Playlist name</span>
            <input
              v-model="queuePlaylistName"
              type="text"
              maxlength="120"
              placeholder="Playlist name"
            />
          </label>
          <button class="playlist-action-btn" type="button" @click="savePlaybackQueue">
            <i class="pi pi-save" aria-hidden="true"></i>
            <span>Save queue</span>
          </button>
          <button
            class="playlist-action-btn playlist-clear-btn"
            type="button"
            :disabled="queue.length === 0"
            @click="clearPlaybackQueueFromDrawer"
          >
            <i class="pi pi-trash" aria-hidden="true"></i>
            <span>Clear</span>
          </button>
          <span class="playlist-action-notice" role="status">{{ queueDrawerNotice }}</span>
        </div>
        <div :ref="setPlaylistListRef" class="playlist-list" @scroll.passive="onQueueScroll">
          <div class="playlist-virtual-spacer" :style="{ height: `${queueVirtualHeight}px` }">
            <div
              class="playlist-virtual-window"
              :style="{ transform: `translateY(${queueVirtualTranslateY}px)` }"
            >
              <div
                v-for="item in visibleQueueItems"
                :key="item.queueEntryId"
                class="playlist-item"
                :class="{
                  active: item.index === queueIndex,
                  dragging: draggedEntryId === item.queueEntryId
                }"
                role="button"
                tabindex="0"
                draggable="true"
                :aria-current="item.index === queueIndex ? 'true' : undefined"
                :aria-label="`${item.title} by ${item.artist}`"
                @click="playQueueEntry(item.queueEntryId)"
                @keydown.enter.prevent="playQueueEntry(item.queueEntryId)"
                @keydown.space.prevent="playQueueEntry(item.queueEntryId)"
                @dragstart="onQueueDragStart($event, item.queueEntryId)"
                @dragover="onQueueDragOver($event, item.queueEntryId)"
                @drop="onQueueDrop($event, item.queueEntryId)"
                @dragend="onQueueDragEnd"
              >
                <button
                  class="playlist-drag-handle"
                  type="button"
                  tabindex="-1"
                  aria-label="Drag to reorder"
                  title="Drag to reorder"
                  @click.stop
                >
                  <i class="pi pi-bars" aria-hidden="true"></i>
                </button>
                <span class="playlist-index">
                  <i v-if="item.index === queueIndex" class="pi pi-volume-up playing-dot"></i>
                  <span v-else>{{ item.index + 1 }}</span>
                </span>
                <CoverImg v-if="item.cover" :cover="item.cover" class="playlist-cover" alt="" />
                <div v-else class="playlist-cover-placeholder">
                  <i class="pi pi-wave-pulse" style="font-size: 12px; color: #bbb"></i>
                </div>
                <div class="playlist-info">
                  <div class="playlist-title">{{ item.title }}</div>
                  <div class="playlist-artist">{{ item.artist }}</div>
                </div>
                <div class="playlist-row-actions" @click.stop>
                  <button
                    type="button"
                    title="Play next"
                    :aria-label="`Play ${item.title} next`"
                    @click="playQueueEntryNext(item.queueEntryId)"
                  >
                    <i class="pi pi-step-forward" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    title="Add to queue tail"
                    :aria-label="`Add ${item.title} to queue tail`"
                    @click="addQueueEntryToTail(item.queueEntryId)"
                  >
                    <i class="pi pi-plus" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    title="Remove from queue"
                    :aria-label="`Remove ${item.title} from queue`"
                    @click="removeQueueEntry(item.queueEntryId)"
                  >
                    <i class="pi pi-times" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- PlayerBar 主体 -->
    <div
      class="player-bar"
      :class="{ 'player-bar-glass': glass }"
      :style="{
        '--accent-color': dominantColor,
        '--play-button-color': playButtonColor
      }"
    >
      <!-- 左侧 -->
      <div class="player-left">
        <img
          v-if="resolvedCurrentCover"
          ref="coverRef"
          :src="resolvedCurrentCover"
          class="player-cover"
          alt="cover"
          title="打开播放页面"
          @click="onCoverClick"
        />
        <div v-else ref="coverRef" class="player-cover-placeholder" @click="onCoverClick">
          <i class="pi pi-wave-pulse" style="font-size: 18px; color: #bbb"></i>
        </div>
        <div class="player-track-info">
          <div class="player-title">{{ currentTrack.title }}</div>
          <div class="player-artist">{{ currentTrack.artist }}</div>
          <div v-if="audioEngineError" class="player-playback-diagnostic" :title="audioEngineError">
            {{ audioEngineError }}
          </div>
          <div
            v-if="audioEngineRecoveryNotice"
            class="player-playback-diagnostic recovery"
            :title="audioEngineRecoveryNotice.message"
          >
            <span>{{ audioEngineRecoveryNotice.message }}</span>
            <button
              v-if="
                audioEngineRecoveryNotice.kind === 'service-ready' &&
                audioEngineRecoveryNotice.canResume !== false
              "
              type="button"
              @click.stop="togglePlay"
            >
              {{ audioEngineRecoveryNotice.actionLabel || '继续播放' }}
            </button>
            <button
              type="button"
              aria-label="关闭恢复提示"
              @click.stop="dismissAudioEngineRecoveryNotice"
            >
              ×
            </button>
          </div>
        </div>
      </div>

      <!-- 中间 -->
      <div class="player-center">
        <div class="player-controls">
          <button class="ctrl-btn" aria-label="上一首" @click="prev">
            <img :src="previousTrackIcon" alt="上一首" />
          </button>
          <button class="ctrl-btn btn-play" aria-label="播放/暂停" @click="togglePlay">
            <img :src="isPlaying ? pauseIcon : playIcon" :alt="isPlaying ? '暂停' : '播放'" />
          </button>
          <button class="ctrl-btn" aria-label="下一首" @click="next">
            <img :src="nextTrackIcon" alt="下一首" />
          </button>
        </div>
        <div class="progress-area">
          <span class="time-label">{{ formatTime(currentTime) }}</span>
          <input
            type="range"
            :value="currentTime"
            min="0"
            :max="duration || 1"
            step="0.1"
            class="progress-slider"
            :style="{ '--range-value': `${duration ? (currentTime / duration) * 100 : 0}%` }"
            @input="onProgressInput"
          />
          <span class="time-label">{{ formatTime(duration) }}</span>
        </div>
      </div>

      <!-- 右侧 -->
      <div class="player-right">
        <button
          v-if="favoriteButtonVisible"
          class="icon-btn favorite-btn"
          :class="{ active: favoriteButtonLiked }"
          :title="favoriteButtonTitle"
          :aria-label="favoriteButtonTitle"
          :aria-pressed="favoriteButtonLiked"
          :disabled="favoriteButtonLoading"
          @click="toggleFavorite"
        >
          <i
            :class="
              favoriteButtonLoading
                ? 'pi pi-spin pi-spinner'
                : favoriteButtonLiked
                  ? 'pi pi-heart-fill'
                  : 'pi pi-heart'
            "
          ></i>
        </button>

        <button class="ctrl-btn mode-btn-right" :title="modeTitle" @click="cyclePlayMode">
          <img v-if="playMode === 'sequential'" :src="sequentialIcon" alt="顺序" />
          <img v-else-if="playMode === 'listLoop'" :src="repeatIcon" alt="列表循环" />
          <img v-else-if="playMode === 'repeat'" :src="repeatIcon" alt="单曲循环" />
          <img v-else :src="shuffleIcon" alt="随机" />
        </button>

        <!-- 音量按钮 + 向上弹出抽屉 -->
        <div class="volume-anchor" @wheel="onVolumeWheel">
          <Transition name="volume-drawer">
            <div v-if="volumeOpen" class="volume-drawer" :class="{ 'drawer-glass': glass }">
              <div class="volume-drawer-slider-wrap">
                <input
                  type="range"
                  :value="volume"
                  min="0"
                  max="1"
                  step="0.01"
                  class="volume-drawer-slider"
                  :style="{ '--range-value': `${volume * 100}%` }"
                  @input="onVolumeInput"
                />
              </div>
              <span class="volume-drawer-val">{{ Math.round(volume * 100) }}</span>
              <button
                v-if="volume < 0.999 || showVolumeNotUnityCta"
                type="button"
                class="volume-unity-btn"
                :class="{ accent: showVolumeNotUnityCta }"
                :disabled="volume >= 0.999"
                title="Unity：固定软件音量 100%（bit-perfect 需要）"
                @click="setUnityVolume"
              >
                {{ HIFI_STATUS_COPY.unityButtonShort }}
              </button>
            </div>
          </Transition>
          <button
            class="icon-btn"
            :class="{ active: muted }"
            :title="muted ? '恢复音量' : '静音'"
            @click="toggleMute"
          >
            <i :class="muted ? 'pi pi-volume-off' : 'pi pi-volume-up'"></i>
          </button>
          <button
            class="icon-btn"
            :class="{ active: volumeOpen }"
            title="音量"
            @click="toggleVolume"
          >
            <i class="pi pi-volume-up"></i>
          </button>
        </div>
        <select
          class="sleep-timer-select"
          :value="
            sleepTimerState?.active
              ? sleepTimerState.mode === 'minutes'
                ? String(settings.sleepTimer.defaultMinutes)
                : sleepTimerState.mode
              : 'off'
          "
          title="睡眠定时器"
          @change="onSleepTimerSelect"
        >
          <option value="off">睡眠关闭</option>
          <option
            v-if="![15, 30, 60].includes(settings.sleepTimer.defaultMinutes)"
            :value="String(settings.sleepTimer.defaultMinutes)"
          >
            {{ settings.sleepTimer.defaultMinutes }} 分钟后停止
          </option>
          <option value="15">15 分钟后停止</option>
          <option value="30">30 分钟后停止</option>
          <option value="60">60 分钟后停止</option>
          <option value="trackEnd">当前曲结束</option>
          <option value="queueEnd">队列结束</option>
        </select>
        <span v-if="sleepTimerStatus" class="sleep-timer-status" :title="sleepTimerStatus">
          {{ sleepTimerStatus }}
        </span>

        <button
          class="icon-btn"
          :class="{ active: playlistOpen }"
          title="播放列表"
          @click="togglePlaylist"
        >
          <i class="pi pi-list"></i>
        </button>

        <button
          class="icon-btn mini-player-btn"
          title="切换到迷你播放器"
          aria-label="切换到迷你播放器"
          :disabled="miniPlayerOpening"
          @click="openMiniPlayer"
        >
          <i :class="miniPlayerOpening ? 'pi pi-spin pi-spinner' : 'ph ph-picture-in-picture'"></i>
        </button>

        <button
          class="icon-btn desktop-lyrics-btn"
          :class="{ active: desktopLyricsOn }"
          title="桌面歌词"
          aria-label="桌面歌词"
          :aria-pressed="desktopLyricsOn"
          @click="toggleDesktopLyrics"
        >
          <span class="desktop-lyrics-icon" aria-hidden="true">词</span>
        </button>

        <!-- HiFi 控制台入口 -->
        <button
          class="icon-btn"
          :class="{ active: moreOpen }"
          title="HiFi 控制台"
          aria-label="HiFi 控制台"
          @click="toggleMore"
        >
          <i class="ph ph-faders"></i>
        </button>
      </div>
    </div>

    <!-- HiFi 右侧覆盖面板 -->
    <Transition name="hifi-overlay">
      <div v-if="moreOpen" class="hifi-overlay" :class="{ glass }">
        <HiFiSidebar
          :glass="glass"
          :exclusive-mode="exclusiveMode"
          :exclusive-available="exclusiveAvailable"
          :audio-output="audioOutput"
          :audio-output-options="audioOutputOptions"
          :audio-device="audioDevice"
          :audio-device-options="audioDeviceOptions"
          :audio-processing="audioProcessing"
          :audio-output-config="audioOutputConfig"
          :dsp-output-stage="dspOutputStage"
          :dsp-stereo-image="dspStereoImage"
          :actual-sample-rate="outputInfo?.actualSampleRate || playbackInfo?.actualSampleRate || 0"
          :status-chips="audioStatusChips"
          :non-perfect-reason="nonPerfectReason"
          :perfect-reason-code="perfectReasonCode"
          :volume="volume"
          :gapless-active="playbackInfo?.gaplessActive === true"
          :preload-ready="playbackInfo?.preloadReady === true"
          :gapless-blocked-reason="playbackInfo?.gaplessBlockedReason || ''"
          :loudnorm-status="loudnormStatus"
          :output-chain-text="outputChainText"
          :output-latency-text="outputLatencyText"
          :output-diagnostics-text="outputDiagnosticsText"
          :native-dsd-runtime-reason-text="nativeDsdRuntimeReasonText"
          :current-track="currentTrack"
          :desktop-lyrics-on="desktopLyricsOn"
          :lyrics-reloading="lyricsReloading"
          :player-bar-buttons="playerBarButtons"
          @open-settings="openPlaybackSettings"
          @open-dsp="openDspSettings"
          @open-equalizer="openEqualizerPage"
          @set-unity-volume="setUnityVolume"
          @toggle-exclusive="toggleExclusiveMode"
          @toggle-dsp="toggleDspEnabled"
          @toggle-eq="toggleEqEnabled"
          @toggle-gapless="toggleGapless"
          @toggle-crossfeed="toggleCrossfeed"
          @toggle-clip-guard="onToggleClipGuard"
          @toggle-convolver="onToggleConvolver"
          @toggle-desktop-lyrics="toggleDesktopLyrics"
          @set-replay-gain-mode="onSetReplayGainMode"
          @set-crossfeed-strength="onSetCrossfeedStrength"
          @set-crossfade-seconds="onSetCrossfadeSeconds"
          @set-replay-gain-preamp="onSetReplayGainPreamp"
          @set-preferred-buffer-size="onSetPreferredBufferSize"
          @set-routing-mode="onSetRoutingMode"
          @set-dsd-output-mode="onSetDsdOutputMode"
          @set-output-stage="setOutputStage"
          @set-stereo-image="setStereoImage"
          @set-audio-output="onSetAudioOutput"
          @set-audio-device="onSetAudioDevice"
          @refresh-devices="onRefreshDevices"
          @select-impulse-response="selectImpulseResponse"
          @clear-impulse-response="clearImpulseResponse"
          @reload-lyrics="onReloadLyrics"
          @run-extension="runPlayerBarExtension"
        />
      </div>
    </Transition>
  </div>
</template>

<style scoped src="./player-bar/PlayerBar.css"></style>
