<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useMusicStore } from '../stores/useMusicStore'
import { useExtensionRegistry } from '../extensions/registry'
import { useMediaProviders } from '../providers'
import { normalizeAccentColor } from '../utils/colorExtractor'
import { useCover } from '../utils/coverLoader'
import CoverImg from './CoverImg.vue'
import nextTrackIcon from '../assets/icons/next-track.svg'
import pauseIcon from '../assets/icons/pause.svg'
import playIcon from '../assets/icons/play.svg'
import previousTrackIcon from '../assets/icons/previous-track.svg'
import repeatIcon from '../assets/icons/single-song-repeat.svg'
import sequentialIcon from '../assets/icons/sequential-playback.svg'
import shuffleIcon from '../assets/icons/shuffle.svg'
import { useFavoriteButton } from './player-bar/useFavoriteButton'
import { useFloatingPanels } from './player-bar/useFloatingPanels'

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
  queue,
  queueIndex,
  playMode,
  exclusiveMode,
  audioOutput,
  audioOutputOptions,
  audioEngineError,
  playbackInfo,
  outputInfo,
  visualizationData,
  cyclePlayMode,
  togglePlay,
  next,
  prev,
  seek,
  playTrack,
  toggleExclusiveMode,
  formatTime
} = usePlayerStore()

const resolvedCurrentCover = useCover(computed(() => currentTrack.value?.cover ?? null))
const {
  playlists,
  addToPlaylist,
  removeFromPlaylist,
  createPlaylist,
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

async function toggleDesktopLyrics(): Promise<void> {
  const enabled = await window.api.desktopLyrics.toggle()
  desktopLyricsOn.value = enabled
}

// Keep in sync when toggled from settings
window.api.desktopLyrics.onToggle((enabled: boolean) => {
  desktopLyricsOn.value = enabled
})

const emit = defineEmits<{
  clickCover: [rect: { x: number; y: number; w: number; h: number }]
  openSettings: []
  openDsp: []
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
  eq_active: 'EQ 正在改变样本',
  convolver_active: 'Convolver 正在改变样本',
  crossfeed_active: 'Crossfeed 正在改变声道内容',
  crossfade_active: 'Crossfade 正在改变播放连续性',
  volume_not_unity: '软件音量不是 100%',
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
  return formatPerfectReason(outputInfo.value?.perfectReason || playbackInfo.value?.perfectReason || '')
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
    info.nativeDsdActualRate || info.nativeDsdRequestedRate || info.driverNativeDsdSampleRates?.[0] || 0
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
  const source = isDsdSource(info) || isSacdIsoSource(info)
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

function finiteNumber(value: number | null | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function formatDb(value: number | null | undefined): string {
  const safe = finiteNumber(value, -120)
  if (safe <= -119) return '-inf dB'
  return `${safe.toFixed(safe > -10 ? 1 : 0)} dB`
}

const visualizationActive = computed(() => visualizationData.value.active === true)
const peakText = computed(() => formatDb(visualizationData.value.peakDb))
const rmsText = computed(() => formatDb(visualizationData.value.rmsDb))
const lufsText = computed(() => {
  const value = visualizationData.value.lufsMomentary
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} LUFS` : 'Inactive'
})
const visualizationStateText = computed(() => {
  if (!visualizationActive.value) return 'Inactive'
  return visualizationData.value.sampleRate > 0 ? compactRate(visualizationData.value.sampleRate) : 'Active'
})
const waveformBars = computed(() => {
  const source = visualizationData.value.waveform
  const targetPoints = 48
  return Array.from({ length: targetPoints }, (_, index) => {
    const bucket = Math.min(source.length - 1, Math.floor((index * source.length) / targetPoints))
    const amplitude = visualizationActive.value && bucket >= 0 ? Math.abs(finiteNumber(source[bucket])) : 0
    const normalized = clamp01(amplitude)
    return {
      height: Math.max(5, Math.round(normalized * 92)),
      opacity: visualizationActive.value ? 0.34 + normalized * 0.62 : 0.18
    }
  })
})
const spectrogramFrameCount = 32
const spectrogramBinCount = 24

const oscilloscopeCanvasRef = ref<HTMLCanvasElement | null>(null)
const spectrogramCanvasRef = ref<HTMLCanvasElement | null>(null)

function prepareVisualizationCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight
  if (cssWidth <= 0 || cssHeight <= 0) return null

  const bufferWidth = Math.round(cssWidth * dpr)
  const bufferHeight = Math.round(cssHeight * dpr)
  if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
    canvas.width = bufferWidth
    canvas.height = bufferHeight
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  return ctx
}

function drawOscilloscope(): void {
  const canvas = oscilloscopeCanvasRef.value
  if (!canvas) return
  const ctx = prepareVisualizationCanvas(canvas)
  if (!ctx) return

  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight
  const midY = cssHeight / 2
  const samples = visualizationData.value.oscilloscope
  const active = visualizationActive.value

  if (!active || !samples || samples.length === 0) {
    // Idle: flat center line (matches how waveform-strip/spectrogram-grid
    // show inactive state).
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(cssWidth, midY)
    ctx.stroke()
    return
  }

  // Client-side zero-crossing trigger: find the first rising zero-crossing
  // (sample[i-1] < 0 && sample[i] >= 0) and start the trace there. Without
  // this, periodic waveforms wander because the 120ms poll is not
  // phase-locked to the audio callback. If no crossing is found, render
  // from index 0.
  let triggerIndex = 0
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] < 0 && samples[i] >= 0) {
      triggerIndex = i
      break
    }
  }

  // Map the triggered trace onto the canvas. sample +1 → top (y=0),
  // -1 → bottom (y=height), center = height/2.
  const traceLength = samples.length - triggerIndex
  const stepX = cssWidth / Math.max(1, traceLength - 1)

  const gradient = ctx.createLinearGradient(0, 0, cssWidth, 0)
  gradient.addColorStop(0, '#2563eb')
  gradient.addColorStop(1, '#14b8a6')

  // transition: none — do NOT smear time-domain samples (contrast with
  // LocalDashboard's 55ms spectrum transition which is wrong for a trace).
  ctx.strokeStyle = gradient
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let i = 0; i < traceLength; i++) {
    const sample = samples[triggerIndex + i]
    const x = i * stepX
    const y = midY - sample * midY
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

function drawSpectrogram(): void {
  const canvas = spectrogramCanvasRef.value
  if (!canvas) return
  const ctx = prepareVisualizationCanvas(canvas)
  if (!ctx) return

  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight
  const gap = 1
  const cellWidth = Math.max(1, (cssWidth - gap * (spectrogramFrameCount - 1)) / spectrogramFrameCount)
  const cellHeight = Math.max(1, (cssHeight - gap * (spectrogramBinCount - 1)) / spectrogramBinCount)

  if (!visualizationActive.value) {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.12)'
    for (let bin = 0; bin < spectrogramBinCount; bin += 1) {
      for (let frame = 0; frame < spectrogramFrameCount; frame += 1) {
        ctx.fillRect(frame * (cellWidth + gap), bin * (cellHeight + gap), cellWidth, cellHeight)
      }
    }
    return
  }

  const frames = visualizationData.value.spectrogram.slice(-spectrogramFrameCount)
  for (let bin = spectrogramBinCount - 1; bin >= 0; bin -= 1) {
    const y = (spectrogramBinCount - 1 - bin) * (cellHeight + gap)
    for (let frame = 0; frame < spectrogramFrameCount; frame += 1) {
      const row = frames[frames.length - spectrogramFrameCount + frame]
      const valueIndex = row ? Math.min(row.length - 1, Math.floor((bin * row.length) / spectrogramBinCount)) : -1
      const energy = valueIndex >= 0 ? clamp01(finiteNumber(row?.[valueIndex])) : 0
      const alpha = 0.08 + energy * 0.82
      const red = Math.round(38 + energy * 186)
      const green = Math.round(92 + energy * 116)
      const blue = Math.round(132 - energy * 68)
      ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`
      ctx.fillRect(frame * (cellWidth + gap), y, cellWidth, cellHeight)
    }
  }
}

function drawVisualizationCanvases(): void {
  drawOscilloscope()
  drawSpectrogram()
}

// Redraw on every visualization data update (120ms poll). flush:'post'
// ensures the DOM is patched before drawing (canvas may have just mounted).
watch(visualizationData, drawVisualizationCanvases, { flush: 'post' })
// Draw immediately when the drawer opens so the trace appears before the
// next poll. requestAnimationFrame lets Vue mount the canvas first.
watch(moreOpen, (open) => {
  if (open) requestAnimationFrame(drawVisualizationCanvases)
})

function playTrackAt(index: number): void {
  const track = queue.value[index]
  if (track) {
    playTrack(track, queue.value)
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

async function runPlayerBarExtension(command?: string): Promise<void> {
  if (!command) return
  moreOpen.value = false
  await window.api.extensions.executeCommand(command, [currentTrack.value])
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
      @pointerdown.prevent.stop="dismissFloatingPanels"
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
          <span class="playlist-count">{{ queue.length }} 首</span>
        </div>
        <div class="playlist-list">
          <div
            v-for="(track, i) in queue"
            :key="track.id"
            class="playlist-item"
            :class="{ active: i === queueIndex }"
            @click="playTrackAt(i)"
          >
            <span class="playlist-index">
              <i v-if="i === queueIndex" class="pi pi-volume-up playing-dot"></i>
              <span v-else>{{ i + 1 }}</span>
            </span>
            <CoverImg v-if="track.cover" :cover="track.cover" class="playlist-cover" alt="" />
            <div v-else class="playlist-cover-placeholder">
              <i class="pi pi-wave-pulse" style="font-size: 12px; color: #bbb"></i>
            </div>
            <div class="playlist-info">
              <div class="playlist-title">{{ track.title }}</div>
              <div class="playlist-artist">{{ track.artist }}</div>
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
          <div
            v-if="audioEngineError"
            class="player-playback-diagnostic"
            :title="audioEngineError"
          >
            {{ audioEngineError }}
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
            </div>
          </Transition>
          <button
            class="icon-btn"
            :class="{ active: volumeOpen }"
            title="音量"
            @click="toggleVolume"
          >
            <i class="pi pi-volume-up"></i>
          </button>
        </div>

        <button
          class="icon-btn"
          :class="{ active: playlistOpen }"
          title="播放列表"
          @click="togglePlaylist"
        >
          <i class="pi pi-list"></i>
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

        <!-- 更多按钮 + 向上弹出抽屉 -->
        <div class="more-anchor">
          <Transition name="volume-drawer">
            <div v-if="moreOpen" class="more-drawer" :class="{ 'drawer-glass': glass }">
              <div class="more-action-grid">
                <button type="button" class="more-action" @click="openPlaybackSettings">
                  <span>
                    <span class="more-action-title">播放设置</span>
                    <span class="more-action-desc">输出、缓存与无缝播放</span>
                  </span>
                </button>
                <button type="button" class="more-action" @click="openDspSettings">
                  <span>
                    <span class="more-action-title">DSP 菜单</span>
                    <span class="more-action-desc">EQ、校正与空间处理</span>
                  </span>
                </button>
                <button
                  v-for="button in playerBarButtons"
                  :key="button.id"
                  type="button"
                  class="more-action"
                  @click="runPlayerBarExtension(button.command)"
                >
                  <span>
                    <span class="more-action-title">{{ button.title }}</span>
                    <span class="more-action-desc">{{ button.description || '插件操作' }}</span>
                  </span>
                </button>
              </div>
              <div class="more-status">
                <span
                  v-for="chip in audioStatusChips"
                  :key="chip.label"
                  class="more-status-chip"
                  :class="chip.tone"
                >
                  {{ chip.label }}
                </span>
              </div>
              <p v-if="nonPerfectReason" class="more-item-desc compact-reason">
                {{ nonPerfectReason }}
              </p>
              <p v-if="outputChainText" class="more-output-chain">
                {{ outputChainText }}
              </p>
              <p class="more-item-desc compact-reason">
                {{ outputLatencyText }}
              </p>
              <p class="more-item-desc compact-reason">
                {{ outputDiagnosticsText }}
              </p>
              <p v-if="nativeDsdRuntimeReasonText" class="more-item-desc compact-reason">
                {{ nativeDsdRuntimeReasonText }}
              </p>
              <div class="visualization-panel" :class="{ inactive: !visualizationActive }">
                <div class="visualization-header">
                  <span>Visualization</span>
                  <span>{{ visualizationStateText }}</span>
                </div>
                <div class="waveform-strip" aria-hidden="true">
                  <span
                    v-for="(bar, index) in waveformBars"
                    :key="index"
                    class="waveform-bar"
                    :style="{ height: `${bar.height}%`, opacity: bar.opacity }"
                  ></span>
                </div>
                <div class="oscilloscope-panel" aria-hidden="true">
                  <canvas ref="oscilloscopeCanvasRef" class="oscilloscope-canvas"></canvas>
                </div>
                <div class="meter-row">
                  <span><strong>Peak</strong>{{ peakText }}</span>
                  <span><strong>RMS</strong>{{ rmsText }}</span>
                  <span><strong>LUFS</strong>{{ lufsText }}</span>
                </div>
                <div class="spectrogram-grid" :class="{ inactive: !visualizationActive }">
                  <canvas
                    ref="spectrogramCanvasRef"
                    class="spectrogram-canvas"
                    aria-hidden="true"
                  ></canvas>
                </div>
              </div>
              <div class="more-item">
                <div class="more-item-header">
                  <span class="more-item-label">独占模式</span>
                  <button
                    class="toggle-switch"
                    :class="{ active: exclusiveMode }"
                    role="switch"
                    :aria-checked="exclusiveMode"
                    :disabled="!exclusiveAvailable"
                    @click="toggleExclusiveMode"
                  >
                    <span class="toggle-knob"></span>
                  </button>
                </div>
                <p class="more-item-desc">当前输出支持时可绕过系统混音器</p>
              </div>
            </div>
          </Transition>
          <button
            class="icon-btn"
            :class="{ active: moreOpen }"
            title="更多设置"
            @click="toggleMore"
          >
            <i class="pi pi-ellipsis-h"></i>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./player-bar/PlayerBar.css"></style>
