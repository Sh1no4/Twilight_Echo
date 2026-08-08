<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  DSD_OUTPUT_MODE_OPTIONS,
  gaplessRuntimeStatusCopy,
  HIFI_STATUS_COPY,
  loudnormStatusCopy,
  VOLUME_NORMALIZATION_OPTIONS,
  type LoudnormStatus
} from '../../../../shared/audioProcessingOptions.ts'
import {
  DSP_DITHER_MODE_OPTIONS,
  DSP_OUTPUT_SAMPLE_RATE_OPTIONS,
  DSP_RESAMPLER_QUALITY_OPTIONS,
  outputStageIsActive,
  stereoImageIsActive,
  type DspDitherMode,
  type DspOutputStageConfig,
  type DspResamplerQuality,
  type DspStereoImageConfig
} from '../../../../shared/dspGraph.ts'
import type {
  AudioDeviceOption,
  AudioOutputId,
  AudioOutputOption,
  AudioProcessingSettings,
  ChannelRoutingMode,
  DsdOutputMode,
  OutputConfig,
  VolumeNormalizationMode
} from '../../types/settings'
import type { LyricSource, Track } from '../../types/music'
import type { DlnaDeviceInfo } from '../../../../shared/remoteControl.ts'
import type { PlaybackBookmark } from '../../../../shared/playbackBookmarks.ts'
import type { LyricLayerSourceSelection } from '../../../../shared/lyricsManagement.ts'
import LyricsManagerPanel from './LyricsManagerPanel.vue'

export type StatusTone = 'success' | 'warning' | 'muted'

export interface HiFiStatusChip {
  label: string
  tone?: StatusTone
  title?: string
}

const props = defineProps<{
  glass?: boolean
  accentColor?: string
  exclusiveMode: boolean
  exclusiveAvailable: boolean
  audioOutput: AudioOutputId
  audioOutputOptions: AudioOutputOption[]
  audioDevice: string
  audioDeviceOptions: AudioDeviceOption[]
  audioProcessing: AudioProcessingSettings
  audioOutputConfig: OutputConfig
  dspOutputStage: DspOutputStageConfig
  dspStereoImage: DspStereoImageConfig
  actualSampleRate?: number
  statusChips: HiFiStatusChip[]
  nonPerfectReason: string
  perfectReasonCode?: string
  volume: number
  gaplessActive?: boolean
  preloadReady?: boolean
  gaplessBlockedReason?: string
  loudnormStatus?: LoudnormStatus
  outputChainText: string
  outputLatencyText: string
  outputDiagnosticsText: string
  nativeDsdRuntimeReasonText: string
  currentTrack: Track | null
  desktopLyricsOn: boolean
  lyricsReloading?: boolean
  originalLayerSelection: LyricLayerSourceSelection
  translationLayerSelection: LyricLayerSourceSelection
  showTranslation: boolean
  lyricHighlightOn: boolean
  lyricControlsPending?: boolean
  playerBarButtons: Array<{
    id: string
    title: string
    description?: string
    command?: string
  }>
  isLiveStream?: boolean
  playbackRate?: number
  playbackRateLabel?: string
  playbackRateTitle?: string
  abLoopA?: number | null
  abLoopB?: number | null
  abLoopTitle?: string
  sleepTimerSelectValue?: string
  sleepTimerStatus?: string
  sleepTimerDefaultMinutes?: number
  castTargetName?: string | null
  castDevices?: DlnaDeviceInfo[]
  castBusy?: boolean
  castError?: string
  canCastCurrentTrack?: boolean
  bookmarks?: PlaybackBookmark[]
  renamingBookmarkId?: string | null
  renameDraft?: string
  formatTime?: (seconds: number) => string
}>()

const emit = defineEmits<{
  openSettings: []
  openDsp: []
  openEqualizer: []
  toggleExclusive: []
  toggleDsp: []
  toggleEq: []
  toggleGapless: []
  toggleCrossfeed: []
  toggleClipGuard: []
  toggleConvolver: []
  toggleDesktopLyrics: []
  setUnityVolume: []
  setReplayGainMode: [mode: VolumeNormalizationMode]
  setCrossfeedStrength: [strength: number]
  setCrossfadeSeconds: [seconds: number]
  setReplayGainPreamp: [db: number]
  setPreferredBufferSize: [frames: number]
  setRoutingMode: [mode: ChannelRoutingMode]
  setPcmToDsdMode: [mode: import('../../types/settings').PcmToDsdMode]
  setDsdOutputMode: [mode: DsdOutputMode]
  setOutputStage: [partial: Partial<DspOutputStageConfig>]
  setStereoImage: [partial: Partial<DspStereoImageConfig>]
  setAudioOutput: [output: AudioOutputId]
  setAudioDevice: [device: string]
  refreshDevices: []
  selectImpulseResponse: []
  clearImpulseResponse: []
  reloadLyrics: [prefer: 'auto' | 'local' | 'provider']
  setLyricLayerSelection: [
    key: 'originalSelection' | 'translationSelection',
    selection: LyricLayerSourceSelection
  ]
  toggleTranslationVisibility: []
  toggleLyricHighlight: []
  runExtension: [command?: string]
  cyclePlaybackRate: []
  toggleAbLoop: []
  clearAbLoop: []
  sleepTimerSelect: [value: string]
  refreshCastDevices: []
  castToDevice: [usn: string]
  stopCast: []
  addBookmark: []
  jumpBookmark: [bookmark: PlaybackBookmark]
  startRenameBookmark: [bookmark: PlaybackBookmark]
  commitRenameBookmark: []
  updateRenameDraft: [value: string]
  cancelRenameBookmark: []
  deleteBookmark: [id: string]
}>()

const isVolumeUnity = computed(() => props.volume >= 0.999)
const showUnityVolumeCta = computed(
  () => props.perfectReasonCode === 'volume_not_unity' || !isVolumeUnity.value
)

const gaplessStatusText = computed(() =>
  gaplessRuntimeStatusCopy({
    intentEnabled: props.audioProcessing.gapless,
    gaplessActive: props.gaplessActive === true,
    preloadReady: props.preloadReady === true,
    gaplessBlockedReason: props.gaplessBlockedReason
  })
)

const gaplessStatusTone = computed(() => {
  if (!props.audioProcessing.gapless) return 'muted'
  if (props.gaplessBlockedReason) return 'warning'
  if (props.gaplessActive || props.preloadReady) return 'success'
  return 'muted'
})

const loudnormStatusText = computed(() => {
  if (props.audioProcessing.volumeNormalization !== 'loudnorm') return ''
  return loudnormStatusCopy(props.loudnormStatus ?? 'idle')
})

const loudnormStatusTone = computed(() => {
  if (props.audioProcessing.volumeNormalization !== 'loudnorm') return 'muted'
  switch (props.loudnormStatus) {
    case 'cached':
      return 'success'
    case 'measuring':
      return 'warning'
    case 'fallback':
    case 'unavailable':
      return 'warning'
    default:
      return 'muted'
  }
})

const activeSection = ref<'console' | 'output' | 'dsp' | 'tools' | 'lyrics'>('console')

const bufferSizeOptions = [
  { value: 0, label: 'Auto' },
  { value: 64, label: '64' },
  { value: 128, label: '128' },
  { value: 256, label: '256' },
  { value: 512, label: '512' },
  { value: 1024, label: '1024' },
  { value: 2048, label: '2048' },
  { value: 4096, label: '4096' }
] as const

const routingModeOptions: { value: ChannelRoutingMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'stereo', label: 'Stereo' },
  { value: 'stereo-to-5.1', label: '2.0 → 5.1' },
  { value: 'stereo-to-7.1', label: '2.0 → 7.1' },
  { value: 'mono-to-stereo', label: 'Mono → Stereo' },
  { value: 'mono-to-multichannel', label: 'Mono → Multi' }
]

const pcmToDsdModeOptions: { value: import('../../types/settings').PcmToDsdMode; label: string }[] =
  [
    { value: 'off', label: '关闭' },
    { value: 'dsd64', label: 'DSD64' },
    { value: 'dsd128', label: 'DSD128' },
    { value: 'dsd256', label: 'DSD256' }
  ]

const dsdOutputModeOptions = DSD_OUTPUT_MODE_OPTIONS
const replayGainOptions = VOLUME_NORMALIZATION_OPTIONS
const sampleRateOptions = DSP_OUTPUT_SAMPLE_RATE_OPTIONS
const resamplerOptions = DSP_RESAMPLER_QUALITY_OPTIONS
const ditherOptions = DSP_DITHER_MODE_OPTIONS

const sectionTabs = [
  { id: 'console' as const, label: '链路', icon: 'ph-waveform' },
  { id: 'output' as const, label: '输出', icon: 'ph-speaker-hifi' },
  { id: 'dsp' as const, label: 'DSP', icon: 'ph-sliders-horizontal' },
  { id: 'tools' as const, label: '工具', icon: 'ph-toolbox' },
  { id: 'lyrics' as const, label: '歌词', icon: 'ph-text-aa' }
]

const rateActive = computed(() => Math.abs((props.playbackRate ?? 1) - 1) > 0.001)
const abLoopPartial = computed(
  () => !props.isLiveStream && props.abLoopA != null && props.abLoopB == null
)
const abLoopActive = computed(
  () => !props.isLiveStream && props.abLoopA != null && props.abLoopB != null
)
const sleepDefaultMinutes = computed(() => props.sleepTimerDefaultMinutes ?? 30)
const castDeviceList = computed(() => props.castDevices ?? [])
const bookmarkList = computed(() => props.bookmarks ?? [])
const renameDraftValue = computed({
  get: () => props.renameDraft ?? '',
  set: (value: string) => emit('updateRenameDraft', value)
})

function onSleepTimerChange(event: Event): void {
  emit('sleepTimerSelect', (event.target as HTMLSelectElement).value)
}

function onLyricLayerSelectionChange(
  key: 'originalSelection' | 'translationSelection',
  event: Event
): void {
  const selection = (event.target as HTMLSelectElement).value
  if (
    selection !== 'automatic' &&
    selection !== 'local' &&
    selection !== 'provider' &&
    selection !== 'manual'
  ) {
    return
  }
  emit('setLyricLayerSelection', key, selection)
}

function formatBookmarkTime(seconds: number): string {
  if (typeof props.formatTime === 'function') return props.formatTime(seconds)
  const total = Math.max(0, Math.floor(seconds || 0))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const selectedDevice = computed(
  () =>
    props.audioDeviceOptions.find((device) => device.id === props.audioDevice) ??
    props.audioDeviceOptions[0]
)

const crossfeedPercent = computed(() => Math.round(props.audioProcessing.crossfeedStrength * 100))
const crossfadeSeconds = computed(() => props.audioProcessing.crossfadeSeconds)
const replayGainPreamp = computed(() => props.audioProcessing.replayGainPreamp)
const dspMasterOn = computed(() => props.audioProcessing.dspEnabled)
const eqOn = computed(() => props.audioProcessing.dspEnabled && props.audioProcessing.eqEnabled)
const crossfeedOn = computed(
  () => props.audioProcessing.dspEnabled && props.audioProcessing.crossfeedEnabled
)
const convolverOn = computed(
  () => props.audioProcessing.dspEnabled && props.audioProcessing.convolverEnabled
)

const convolverPathLabel = computed(() => {
  const path = props.audioProcessing.convolverIrPath?.trim()
  if (!path) return '未载入 IR'
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
})

const outputStageActive = computed(() => outputStageIsActive(props.dspOutputStage))

const targetSampleRateLabel = computed(() => {
  const target = props.dspOutputStage.targetSampleRate
  if (target === 'device') return 'Device'
  const option = sampleRateOptions.find((item) => item.value === target)
  return option?.label ?? `${Math.round(target / 100) / 10} kHz`
})

const actualSampleRateLabel = computed(() => {
  const rate = props.actualSampleRate
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return '—'
  return `${Math.round(rate / 100) / 10} kHz`
})

const outputStageHint = computed(() => {
  if (!outputStageActive.value) {
    return `目标 Device · 实际 ${actualSampleRateLabel.value} · 无强制重采样`
  }
  return `目标 ${targetSampleRateLabel.value} · 实际 ${actualSampleRateLabel.value} · SRC ${props.dspOutputStage.resamplerQuality} · dither ${props.dspOutputStage.dither}（采样率锁会关闭 bit-perfect）`
})

const stereoImageActive = computed(() => stereoImageIsActive(props.dspStereoImage))
const balancePercent = computed(() => Math.round(props.dspStereoImage.balance * 100))
const widthPercent = computed(() => Math.round(props.dspStereoImage.width * 100))
const stereoImageHint = computed(() => {
  if (!stereoImageActive.value) return '平衡 0 · 宽度 100% · 相位正常'
  const parts = [
    `平衡 ${balancePercent.value > 0 ? `R${balancePercent.value}` : balancePercent.value < 0 ? `L${Math.abs(balancePercent.value)}` : '0'}`,
    `宽度 ${widthPercent.value}%`
  ]
  if (props.dspStereoImage.invertLeft) parts.push('L 反相')
  if (props.dspStereoImage.invertRight) parts.push('R 反相')
  if (props.dspStereoImage.swap) parts.push('L/R 交换')
  if (props.dspStereoImage.mono) parts.push('单声道')
  return `${parts.join(' · ')}（会关闭 bit-perfect）`
})

const eqSummary = computed(() => {
  if (!props.audioProcessing.eqEnabled) return '旁路'
  const mode = props.audioProcessing.eqMode === 'parametric' ? '参数' : '图形'
  return `${mode} · Preamp ${props.audioProcessing.eqPreamp.toFixed(1)} dB`
})

const sourceQuality = computed(() => {
  const track = props.currentTrack
  if (!track) {
    return {
      badge: 'Idle',
      tone: 'muted' as StatusTone,
      format: '—',
      rate: '—',
      depth: '—',
      bitrate: '—',
      source: '—'
    }
  }

  const format = (track.format || track.fileName?.split('.').pop() || 'PCM').toUpperCase()
  const rate = track.sampleRate ? `${Math.round(track.sampleRate / 100) / 10} kHz` : '—'
  const depth = track.bitDepth ? `${track.bitDepth} bit` : '—'
  const bitrate = track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : '—'
  const source = track.source === 'local' || !track.source ? '本地库' : String(track.source)

  let badge = 'Standard'
  let tone: StatusTone = 'muted'
  if (/\b(dsf|dff|dsd|sacd)\b/i.test(`${format} ${track.fileName || ''}`)) {
    badge = 'DSD'
    tone = 'success'
  } else if ((track.sampleRate || 0) >= 88200 || (track.bitDepth || 0) >= 24) {
    badge = 'Hi-Res'
    tone = 'success'
  } else if ((track.sampleRate || 0) >= 44100 && (track.bitDepth || 0) >= 16 && !track.bitrate) {
    badge = 'Lossless'
    tone = 'success'
  } else if ((track.bitrate || 0) >= 320000) {
    badge = 'High'
    tone = 'warning'
  } else if (track.bitrate) {
    badge = 'Lossy'
    tone = 'muted'
  }

  return { badge, tone, format, rate, depth, bitrate, source }
})

const lyricsSourceLabel = computed(() => lyricSourceText(props.currentTrack?.lyricsSource))
const translatedLyricsSourceLabel = computed(() =>
  lyricSourceText(props.currentTrack?.translatedLyricsSource)
)
const hasLyrics = computed(() => Boolean(props.currentTrack?.lyrics?.trim()))
const hasTranslatedLyrics = computed(() => Boolean(props.currentTrack?.translatedLyrics?.trim()))

function lyricSourceText(source: LyricSource | null | undefined): string {
  if (source === 'embedded') return '内嵌'
  if (source === 'local') return '本地 LRC'
  if (source === 'provider') return '在线 Provider'
  return '未加载'
}

function deviceSpecText(device: AudioDeviceOption): string {
  const rates = device.sampleRates?.filter((rate) => rate > 0) ?? []
  const depths = device.bitDepths?.filter((depth) => depth > 0) ?? []
  const rateText =
    rates.length > 0
      ? `${Math.round(Math.min(...rates) / 100) / 10}-${Math.round(Math.max(...rates) / 100) / 10} kHz`
      : ''
  const depthText = depths.length > 0 ? `${Math.min(...depths)}-${Math.max(...depths)} bit` : ''
  const channels = device.channels && device.channels > 0 ? `${device.channels} ch` : ''
  return [device.backend?.toUpperCase(), rateText, depthText, channels].filter(Boolean).join(' · ')
}

function deviceIcon(device: AudioDeviceOption): string {
  const text = `${device.label} ${device.name || ''} ${device.driverName || ''}`.toLowerCase()
  if (/usb|dac|asio|hifi|exclusive/.test(text)) return 'ph ph-cpu'
  if (/headphone|headset|ear/.test(text)) return 'ph ph-headphones'
  if (/hdmi|display|tv|monitor/.test(text)) return 'ph ph-monitor'
  return 'ph ph-speaker-high'
}

function onCrossfeedInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  emit('setCrossfeedStrength', Math.min(1, Math.max(0, value / 100)))
}

function onCrossfadeInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  emit('setCrossfadeSeconds', Math.min(12, Math.max(0, value)))
}

function onPreampInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  emit('setReplayGainPreamp', Math.min(12, Math.max(-12, value)))
}

function onBufferChange(event: Event): void {
  emit('setPreferredBufferSize', Number((event.target as HTMLSelectElement).value))
}

function onRoutingChange(event: Event): void {
  emit('setRoutingMode', (event.target as HTMLSelectElement).value as ChannelRoutingMode)
}

function onPcmToDsdModeChange(event: Event): void {
  emit(
    'setPcmToDsdMode',
    (event.target as HTMLSelectElement).value as import('../../types/settings').PcmToDsdMode
  )
}

function onDsdModeChange(event: Event): void {
  emit('setDsdOutputMode', (event.target as HTMLSelectElement).value as DsdOutputMode)
}

function onReplayGainChange(event: Event): void {
  emit('setReplayGainMode', (event.target as HTMLSelectElement).value as VolumeNormalizationMode)
}

function onTargetSampleRateChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  const targetSampleRate = raw === 'device' ? 'device' : Number(raw)
  emit('setOutputStage', { targetSampleRate })
}

function onResamplerChange(event: Event): void {
  emit('setOutputStage', {
    resamplerQuality: (event.target as HTMLSelectElement).value as DspResamplerQuality
  })
}

function onDitherChange(event: Event): void {
  emit('setOutputStage', {
    dither: (event.target as HTMLSelectElement).value as DspDitherMode
  })
}

function onBalanceInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  emit('setStereoImage', { balance: Math.min(1, Math.max(-1, value / 100)) })
}

function onWidthInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  emit('setStereoImage', { width: Math.min(2, Math.max(0, value / 100)) })
}

function toggleInvertLeft(): void {
  emit('setStereoImage', { invertLeft: !props.dspStereoImage.invertLeft })
}

function toggleInvertRight(): void {
  emit('setStereoImage', { invertRight: !props.dspStereoImage.invertRight })
}

function resetStereoImage(): void {
  emit('setStereoImage', {
    balance: 0,
    width: 1,
    midGainDb: 0,
    sideGainDb: 0,
    invertLeft: false,
    invertRight: false,
    swap: false,
    mono: false
  })
}

/* ===== Signal Deck 展示层 ===== */

const deckRateValue = computed(() => {
  const rate = props.currentTrack?.sampleRate
  if (!rate || !Number.isFinite(rate) || rate <= 0) return '--.-'
  return (Math.round(rate / 100) / 10).toFixed(1)
})

const deckTrackLine = computed(() => {
  const track = props.currentTrack
  if (!track) return 'NO SIGNAL'
  const title = track.title?.trim() || track.fileName || 'Unknown'
  const artist = track.artist?.trim()
  return artist ? `${title} — ${artist}` : title
})

const deckLiveTone = computed<StatusTone>(() => {
  if (!props.currentTrack) return 'muted'
  return props.nonPerfectReason ? 'warning' : 'success'
})

const deckOutNodeSub = computed(() => {
  const backend = selectedDevice.value?.backend?.toUpperCase() || 'OUTPUT'
  return `${backend} · ${props.exclusiveMode ? 'EXCLUSIVE' : 'SHARED'}`
})

const deckAccentVars = computed(() => {
  const color = props.accentColor?.trim()
  return color ? { '--d-accent-src': color } : undefined
})
</script>

<template>
  <div class="deck" :class="{ 'deck-dark': glass }" :style="deckAccentVars">
    <section class="deck-display">
      <div class="deck-display-head">
        <span class="deck-display-now">NOW DECODING</span>
        <span class="deck-display-track" :title="deckTrackLine">{{ deckTrackLine }}</span>
      </div>
      <div class="deck-display-body">
        <div class="deck-display-rate">
          <span class="deck-rate-num">{{ deckRateValue }}</span>
          <span class="deck-rate-unit">kHz</span>
        </div>
        <div class="deck-display-meta">
          <span class="deck-format-plate">{{ sourceQuality.format }}</span>
          <span class="deck-tier" :data-tone="sourceQuality.tone">{{ sourceQuality.badge }}</span>
          <span class="deck-display-sub"
            >{{ sourceQuality.depth }} · {{ sourceQuality.bitrate }}</span
          >
          <span class="deck-display-sub dim">{{ sourceQuality.source }}</span>
        </div>
      </div>
    </section>

    <div class="deck-main">
      <nav class="deck-rail" aria-label="HiFi 分区">
        <button
          v-for="tab in sectionTabs"
          :key="tab.id"
          type="button"
          class="deck-rail-btn"
          :class="{ active: activeSection === tab.id }"
          :aria-pressed="activeSection === tab.id"
          @click="activeSection = tab.id"
        >
          <i class="ph" :class="tab.icon"></i>
          <span>{{ tab.label }}</span>
        </button>
        <div class="deck-rail-spacer"></div>
        <button
          type="button"
          class="deck-rail-btn utility"
          title="播放设置"
          @click="emit('openSettings')"
        >
          <i class="ph ph-gear-six"></i>
          <span>设置</span>
        </button>
      </nav>

      <div class="deck-content">
        <Transition name="deck-fade" mode="out-in">
          <!-- 链路 -->
          <section v-if="activeSection === 'console'" key="console" class="deck-stack">
            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>01</em>SIGNAL PATH</span>
                <span class="deck-card-hint">实时链路</span>
              </div>

              <div class="deck-flow">
                <div class="deck-node" data-tone="success">
                  <span class="deck-node-led"></span>
                  <strong>SRC</strong>
                  <em>{{ sourceQuality.format }} · {{ sourceQuality.depth }}</em>
                </div>
                <div class="deck-flow-link" :class="{ active: Boolean(currentTrack) }"></div>
                <div class="deck-node" :data-tone="dspMasterOn ? 'warning' : 'muted'">
                  <span class="deck-node-led"></span>
                  <strong>DSP</strong>
                  <em>{{ dspMasterOn ? 'ENGAGED' : 'BYPASS' }}</em>
                </div>
                <div class="deck-flow-link" :class="{ active: Boolean(currentTrack) }"></div>
                <div class="deck-node" :data-tone="deckLiveTone">
                  <span class="deck-node-led"></span>
                  <strong>OUT</strong>
                  <em>{{ deckOutNodeSub }}</em>
                </div>
              </div>

              <div class="deck-chip-row">
                <span
                  v-for="chip in statusChips"
                  :key="chip.label"
                  class="deck-chip"
                  :data-tone="chip.tone || 'muted'"
                  :title="chip.title || chip.label"
                >
                  {{ chip.label }}
                </span>
              </div>

              <p v-if="outputChainText" class="deck-readout" :title="outputChainText">
                {{ outputChainText }}
              </p>
              <p v-if="nonPerfectReason" class="deck-note warn">{{ nonPerfectReason }}</p>

              <div v-if="showUnityVolumeCta" class="deck-unity">
                <div class="deck-unity-copy">
                  <strong>UNITY 音量</strong>
                  <em>
                    {{
                      perfectReasonCode === 'volume_not_unity'
                        ? `${HIFI_STATUS_COPY.volumeNotUnity}，bit-perfect 需要 Unity`
                        : `当前 ${Math.round(volume * 100)}%；${HIFI_STATUS_COPY.volumeNotUnityHint}`
                    }}
                  </em>
                </div>
                <button
                  type="button"
                  class="deck-btn"
                  :class="{ accent: perfectReasonCode === 'volume_not_unity' }"
                  :disabled="isVolumeUnity"
                  @click="emit('setUnityVolume')"
                >
                  {{ HIFI_STATUS_COPY.unityButton }}
                </button>
              </div>
            </section>

            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>02</em>TELEMETRY</span>
                <span class="deck-card-hint">延迟 · 诊断</span>
              </div>
              <div class="deck-meter-grid">
                <div class="deck-meter">
                  <span>LATENCY</span>
                  <strong>{{ outputLatencyText.replace(/^Latency\s*/, '') }}</strong>
                </div>
                <div class="deck-meter">
                  <span>DIAGNOSTICS</span>
                  <strong>{{ outputDiagnosticsText }}</strong>
                </div>
              </div>
              <p v-if="nativeDsdRuntimeReasonText" class="deck-note">
                {{ nativeDsdRuntimeReasonText }}
              </p>
            </section>

            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>03</em>SOURCE</span>
                <span class="deck-chip" :data-tone="sourceQuality.tone">{{
                  sourceQuality.badge
                }}</span>
              </div>
              <div class="deck-spec-grid">
                <div class="deck-spec">
                  <span>格式</span>
                  <strong>{{ sourceQuality.format }}</strong>
                </div>
                <div class="deck-spec">
                  <span>采样率</span>
                  <strong>{{ sourceQuality.rate }}</strong>
                </div>
                <div class="deck-spec">
                  <span>位深</span>
                  <strong>{{ sourceQuality.depth }}</strong>
                </div>
                <div class="deck-spec">
                  <span>码率</span>
                  <strong>{{ sourceQuality.bitrate }}</strong>
                </div>
              </div>
              <p class="deck-note">来源 · {{ sourceQuality.source }}</p>
            </section>

            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>04</em>ENGINE</span>
                <span class="deck-card-hint">快捷开关</span>
              </div>
              <div class="deck-toggles">
                <button
                  type="button"
                  class="deck-toggle"
                  :class="{ on: exclusiveMode }"
                  :disabled="!exclusiveAvailable"
                  @click="emit('toggleExclusive')"
                >
                  <span class="deck-led"></span>
                  <i class="ph ph-lock-key"></i>
                  <span class="deck-toggle-name">Exclusive</span>
                  <em>{{ exclusiveMode ? 'ON' : 'OFF' }}</em>
                </button>
                <button
                  type="button"
                  class="deck-toggle"
                  :class="{ on: audioProcessing.gapless }"
                  @click="emit('toggleGapless')"
                >
                  <span class="deck-led"></span>
                  <i class="ph ph-arrows-merge"></i>
                  <span class="deck-toggle-name">Gapless</span>
                  <em>{{ audioProcessing.gapless ? 'ON' : 'OFF' }}</em>
                </button>
                <button
                  type="button"
                  class="deck-toggle"
                  :class="{ on: audioProcessing.clipGuard }"
                  @click="emit('toggleClipGuard')"
                >
                  <span class="deck-led"></span>
                  <i class="ph ph-shield-check"></i>
                  <span class="deck-toggle-name">Clip Guard</span>
                  <em>{{ audioProcessing.clipGuard ? 'ON' : 'OFF' }}</em>
                </button>
                <button
                  type="button"
                  class="deck-toggle"
                  :class="{ on: dspMasterOn }"
                  @click="emit('toggleDsp')"
                >
                  <span class="deck-led"></span>
                  <i class="ph ph-circuitry"></i>
                  <span class="deck-toggle-name">Master DSP</span>
                  <em>{{ dspMasterOn ? 'ON' : 'OFF' }}</em>
                </button>
              </div>
              <div class="deck-gapless" :data-tone="gaplessStatusTone">
                <span
                  v-if="audioProcessing.gapless && gaplessActive"
                  class="deck-chip"
                  data-tone="success"
                  >Active</span
                >
                <span
                  v-if="audioProcessing.gapless && preloadReady"
                  class="deck-chip"
                  data-tone="success"
                  >Preload</span
                >
                <span
                  v-if="audioProcessing.gapless && gaplessBlockedReason"
                  class="deck-chip"
                  data-tone="warning"
                  >Blocked</span
                >
                <p class="deck-note">{{ gaplessStatusText }}</p>
              </div>
              <p class="deck-note">{{ HIFI_STATUS_COPY.gaplessNote }}</p>
            </section>

            <section class="deck-card deck-actions">
              <button type="button" class="deck-action" @click="emit('openSettings')">
                <i class="ph ph-gear-six"></i>
                <span>
                  <strong>播放设置</strong>
                  <em>输出 · 缓存</em>
                </span>
              </button>
              <button type="button" class="deck-action accent" @click="emit('openEqualizer')">
                <i class="ph ph-faders"></i>
                <span>
                  <strong>均衡器</strong>
                  <em>完整 EQ 页</em>
                </span>
              </button>
              <button type="button" class="deck-action" @click="emit('openDsp')">
                <i class="ph ph-sliders-horizontal"></i>
                <span>
                  <strong>DSP 工作台</strong>
                  <em>空间 · 解码</em>
                </span>
              </button>
            </section>
          </section>

          <!-- 输出 -->
          <section v-else-if="activeSection === 'output'" key="output" class="deck-stack">
            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>01</em>BACKEND</span>
                <span class="deck-card-hint">输出后端</span>
              </div>
              <div class="deck-segmented">
                <button
                  v-for="option in audioOutputOptions"
                  :key="option.id"
                  type="button"
                  :class="{ active: audioOutput === option.id }"
                  @click="emit('setAudioOutput', option.id)"
                >
                  {{ option.label }}
                </button>
              </div>
            </section>

            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>02</em>DEVICES</span>
                <button type="button" class="deck-link" @click="emit('refreshDevices')">
                  <i class="ph ph-arrows-clockwise"></i>刷新
                </button>
              </div>
              <div class="deck-devices">
                <button
                  v-for="device in audioDeviceOptions"
                  :key="device.id"
                  type="button"
                  class="deck-device"
                  :class="{ active: audioDevice === device.id }"
                  @click="emit('setAudioDevice', device.id)"
                >
                  <i :class="deviceIcon(device)"></i>
                  <div class="deck-device-copy">
                    <strong>{{ device.label }}</strong>
                    <span>{{ deviceSpecText(device) || '系统默认路径' }}</span>
                  </div>
                  <em v-if="audioDevice === device.id">当前</em>
                </button>
              </div>
              <p v-if="selectedDevice" class="deck-note">当前设备 · {{ selectedDevice.label }}</p>
            </section>

            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>03</em>ENGINE PARAMS</span>
                <span class="deck-card-hint">缓冲 / 路由 / 交叉淡入</span>
              </div>
              <div class="deck-toggles">
                <button
                  type="button"
                  class="deck-toggle"
                  :class="{ on: exclusiveMode }"
                  :disabled="!exclusiveAvailable"
                  @click="emit('toggleExclusive')"
                >
                  <span class="deck-led"></span>
                  <i class="ph ph-lock-key"></i>
                  <span class="deck-toggle-name">Exclusive</span>
                  <em>{{ exclusiveMode ? 'ON' : 'OFF' }}</em>
                </button>
                <button
                  type="button"
                  class="deck-toggle"
                  :class="{ on: audioProcessing.gapless }"
                  @click="emit('toggleGapless')"
                >
                  <span class="deck-led"></span>
                  <i class="ph ph-arrows-merge"></i>
                  <span class="deck-toggle-name">Gapless</span>
                  <em>{{ audioProcessing.gapless ? 'ON' : 'OFF' }}</em>
                </button>
              </div>
              <div class="deck-control">
                <div class="deck-control-head">
                  <span>Crossfade</span>
                  <strong>{{ crossfadeSeconds.toFixed(1) }} s</strong>
                </div>
                <input
                  class="deck-range"
                  type="range"
                  min="0"
                  max="12"
                  step="0.5"
                  :value="crossfadeSeconds"
                  :style="{ '--range-value': `${(crossfadeSeconds / 12) * 100}%` }"
                  @input="onCrossfadeInput"
                />
              </div>
              <div class="deck-field-row">
                <label class="deck-field">
                  <span>Buffer</span>
                  <select
                    class="deck-select"
                    :value="audioOutputConfig.preferredBufferSize"
                    @change="onBufferChange"
                  >
                    <option
                      v-for="option in bufferSizeOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <label class="deck-field">
                  <span>Routing</span>
                  <select
                    class="deck-select"
                    :value="audioOutputConfig.routingMode"
                    @change="onRoutingChange"
                  >
                    <option
                      v-for="option in routingModeOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </label>
              </div>
              <label class="deck-field">
                <span>PCM → DSD</span>
                <select
                  class="deck-select"
                  :value="audioOutputConfig.pcmToDsdMode ?? 'off'"
                  @change="onPcmToDsdModeChange"
                >
                  <option
                    v-for="option in pcmToDsdModeOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label class="deck-field">
                <span>DSD Mode</span>
                <select
                  class="deck-select"
                  :value="audioProcessing.dsdOutputMode"
                  @change="onDsdModeChange"
                >
                  <option
                    v-for="option in dsdOutputModeOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </section>

            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>04</em>OUTPUT STAGE</span>
                <span class="deck-card-hint">采样率锁 · SRC · dither</span>
              </div>
              <p class="deck-readout" :title="outputStageHint">{{ outputStageHint }}</p>
              <div class="deck-field-row">
                <label class="deck-field">
                  <span>Target Rate</span>
                  <select
                    class="deck-select"
                    :value="String(dspOutputStage.targetSampleRate)"
                    @change="onTargetSampleRateChange"
                  >
                    <option
                      v-for="option in sampleRateOptions"
                      :key="String(option.value)"
                      :value="String(option.value)"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <label class="deck-field">
                  <span>Resampler</span>
                  <select
                    class="deck-select"
                    :value="dspOutputStage.resamplerQuality"
                    @change="onResamplerChange"
                  >
                    <option
                      v-for="option in resamplerOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </label>
              </div>
              <label class="deck-field">
                <span>Dither</span>
                <select class="deck-select" :value="dspOutputStage.dither" @change="onDitherChange">
                  <option v-for="option in ditherOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <p v-if="outputStageActive" class="deck-note warn">
                采样率锁 / SRC / dither 启用时 outputPerfect=false（graph.outputStage，非
                OutputConfig）。
              </p>
            </section>
          </section>

          <!-- DSP -->
          <section v-else-if="activeSection === 'dsp'" key="dsp" class="deck-stack">
            <section class="deck-card">
              <div class="deck-master">
                <div class="deck-master-copy">
                  <span class="deck-led" :class="{ on: dspMasterOn }"></span>
                  <div>
                    <strong>Master DSP</strong>
                    <span>{{ dspMasterOn ? '处理链已启用' : '旁路 · 样本直通优先' }}</span>
                  </div>
                </div>
                <button
                  type="button"
                  class="deck-switch"
                  :class="{ active: dspMasterOn }"
                  role="switch"
                  :aria-checked="dspMasterOn"
                  @click="emit('toggleDsp')"
                >
                  <span class="deck-switch-knob"></span>
                </button>
              </div>

              <div class="deck-modules" :class="{ dim: !dspMasterOn }">
                <div class="deck-module-row">
                  <div class="deck-module-copy">
                    <strong>Equalizer</strong>
                    <span>{{ eqSummary }}</span>
                  </div>
                  <div class="deck-module-actions">
                    <button type="button" class="deck-btn" @click="emit('openEqualizer')">
                      打开 EQ
                    </button>
                    <button
                      type="button"
                      class="deck-switch"
                      :class="{ active: eqOn }"
                      role="switch"
                      :aria-checked="eqOn"
                      @click="emit('toggleEq')"
                    >
                      <span class="deck-switch-knob"></span>
                    </button>
                  </div>
                </div>

                <div class="deck-module-row">
                  <div class="deck-module-copy">
                    <strong>Crossfeed</strong>
                    <span>耳机串音 · {{ crossfeedPercent }}%</span>
                  </div>
                  <button
                    type="button"
                    class="deck-switch"
                    :class="{ active: crossfeedOn }"
                    role="switch"
                    :aria-checked="crossfeedOn"
                    @click="emit('toggleCrossfeed')"
                  >
                    <span class="deck-switch-knob"></span>
                  </button>
                </div>
                <div class="deck-control compact">
                  <input
                    class="deck-range"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    :value="crossfeedPercent"
                    :style="{ '--range-value': `${crossfeedPercent}%` }"
                    @input="onCrossfeedInput"
                  />
                </div>

                <div class="deck-module-row">
                  <div class="deck-module-copy">
                    <strong>Convolver</strong>
                    <span>{{ convolverPathLabel }}</span>
                  </div>
                  <div class="deck-module-actions">
                    <button type="button" class="deck-btn" @click="emit('selectImpulseResponse')">
                      IR
                    </button>
                    <button
                      v-if="audioProcessing.convolverIrPath"
                      type="button"
                      class="deck-btn ghost"
                      @click="emit('clearImpulseResponse')"
                    >
                      清除
                    </button>
                    <button
                      type="button"
                      class="deck-switch"
                      :class="{ active: convolverOn }"
                      role="switch"
                      :aria-checked="convolverOn"
                      @click="emit('toggleConvolver')"
                    >
                      <span class="deck-switch-knob"></span>
                    </button>
                  </div>
                </div>

                <div class="deck-field-row">
                  <label class="deck-field">
                    <span>ReplayGain</span>
                    <select
                      class="deck-select"
                      :value="audioProcessing.volumeNormalization"
                      @change="onReplayGainChange"
                    >
                      <option
                        v-for="option in replayGainOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <label class="deck-field">
                    <span>Clip Guard</span>
                    <button
                      type="button"
                      class="deck-inline-toggle"
                      :class="{ on: audioProcessing.clipGuard }"
                      @click="emit('toggleClipGuard')"
                    >
                      <span class="deck-led"></span>
                      {{ audioProcessing.clipGuard ? '已开启' : '已关闭' }}
                    </button>
                  </label>
                </div>

                <p v-if="loudnormStatusText" class="deck-note" :data-tone="loudnormStatusTone">
                  {{ loudnormStatusText }}
                </p>

                <div class="deck-control">
                  <div class="deck-control-head">
                    <span>RG Preamp</span>
                    <strong>{{ replayGainPreamp.toFixed(1) }} dB</strong>
                  </div>
                  <input
                    class="deck-range"
                    type="range"
                    min="-12"
                    max="12"
                    step="0.1"
                    :value="replayGainPreamp"
                    :style="{ '--range-value': `${((replayGainPreamp + 12) / 24) * 100}%` }"
                    @input="onPreampInput"
                  />
                </div>

                <div class="deck-module-row">
                  <div class="deck-module-copy">
                    <strong>Balance / Phase</strong>
                    <span>{{ stereoImageHint }}</span>
                  </div>
                  <button
                    v-if="stereoImageActive"
                    type="button"
                    class="deck-btn ghost"
                    @click="resetStereoImage"
                  >
                    复位
                  </button>
                </div>
                <div class="deck-control compact">
                  <div class="deck-control-head">
                    <span>Balance</span>
                    <strong>{{
                      balancePercent === 0
                        ? 'C'
                        : balancePercent > 0
                          ? `R${balancePercent}`
                          : `L${Math.abs(balancePercent)}`
                    }}</strong>
                  </div>
                  <input
                    class="deck-range"
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    :value="balancePercent"
                    :style="{ '--range-value': `${((balancePercent + 100) / 200) * 100}%` }"
                    @input="onBalanceInput"
                  />
                </div>
                <div class="deck-control compact">
                  <div class="deck-control-head">
                    <span>Width</span>
                    <strong>{{ widthPercent }}%</strong>
                  </div>
                  <input
                    class="deck-range"
                    type="range"
                    min="0"
                    max="200"
                    step="1"
                    :value="widthPercent"
                    :style="{ '--range-value': `${(widthPercent / 200) * 100}%` }"
                    @input="onWidthInput"
                  />
                </div>
                <div class="deck-toggles">
                  <button
                    type="button"
                    class="deck-toggle"
                    :class="{ on: dspStereoImage.invertLeft }"
                    @click="toggleInvertLeft"
                  >
                    <span class="deck-led"></span>
                    <i class="ph ph-arrows-left-right"></i>
                    <span class="deck-toggle-name">L Phase</span>
                    <em>{{ dspStereoImage.invertLeft ? 'INV' : 'OK' }}</em>
                  </button>
                  <button
                    type="button"
                    class="deck-toggle"
                    :class="{ on: dspStereoImage.invertRight }"
                    @click="toggleInvertRight"
                  >
                    <span class="deck-led"></span>
                    <i class="ph ph-arrows-left-right"></i>
                    <span class="deck-toggle-name">R Phase</span>
                    <em>{{ dspStereoImage.invertRight ? 'INV' : 'OK' }}</em>
                  </button>
                </div>
                <p v-if="stereoImageActive" class="deck-note warn">
                  平衡 / 宽度 / 相位写入 graph stereoField + channelStrip，会关闭 outputPerfect。
                </p>
              </div>
            </section>

            <section class="deck-card deck-actions">
              <button type="button" class="deck-action accent" @click="emit('openEqualizer')">
                <i class="ph ph-faders"></i>
                <span>
                  <strong>进入 EQ 页面</strong>
                  <em>图形 / 参数均衡</em>
                </span>
              </button>
              <button type="button" class="deck-action" @click="emit('openDsp')">
                <i class="ph ph-sliders-horizontal"></i>
                <span>
                  <strong>完整 DSP 设置</strong>
                  <em>高级参数</em>
                </span>
              </button>
            </section>
          </section>

          <!-- 工具 -->
          <section v-else-if="activeSection === 'tools'" key="tools" class="deck-stack">
            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>01</em>SLEEP TIMER</span>
                <span class="deck-card-hint">定时停止</span>
              </div>
              <label class="deck-field">
                <span>模式</span>
                <select
                  class="deck-select"
                  :value="sleepTimerSelectValue || 'off'"
                  title="睡眠定时器"
                  @change="onSleepTimerChange"
                >
                  <option value="off">睡眠关闭</option>
                  <option
                    v-if="![15, 30, 60].includes(sleepDefaultMinutes)"
                    :value="String(sleepDefaultMinutes)"
                  >
                    {{ sleepDefaultMinutes }} 分钟后停止
                  </option>
                  <option value="15">15 分钟后停止</option>
                  <option value="30">30 分钟后停止</option>
                  <option value="60">60 分钟后停止</option>
                  <option value="trackEnd">当前曲结束</option>
                  <option value="queueEnd">队列结束</option>
                </select>
              </label>
              <p v-if="sleepTimerStatus" class="deck-note" :title="sleepTimerStatus">
                {{ sleepTimerStatus }}
              </p>
              <p v-else class="deck-note">关闭后保持播放；可选分钟数或曲末 / 队列末停止。</p>
            </section>

            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>02</em>PLAYBACK RATE</span>
                <span class="deck-card-hint">倍速</span>
              </div>
              <div class="deck-module-row">
                <div class="deck-module-copy">
                  <strong class="deck-mono">{{ playbackRateLabel || '1.0x' }}</strong>
                  <span>{{ playbackRateTitle || '播放倍速' }}</span>
                </div>
                <button
                  type="button"
                  class="deck-btn"
                  :class="{ accent: rateActive }"
                  :title="playbackRateTitle || '播放倍速'"
                  :aria-label="playbackRateTitle || '播放倍速'"
                  @click="emit('cyclePlaybackRate')"
                >
                  切换
                </button>
              </div>
              <p class="deck-note">
                循环切换 0.75x → 1x → 1.25x → 1.5x → 2x。非 1x 会关闭 bit-perfect。
              </p>
            </section>

            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>03</em>A-B LOOP</span>
                <span class="deck-card-hint">区间循环</span>
              </div>
              <div class="deck-module-row">
                <div class="deck-module-copy">
                  <strong>
                    {{
                      abLoopActive
                        ? '循环中'
                        : abLoopPartial
                          ? '已设起点 A'
                          : isLiveStream
                            ? '不可用'
                            : '未设置'
                    }}
                  </strong>
                  <span>{{ abLoopTitle || 'A-B 循环' }}</span>
                </div>
                <div class="deck-module-actions">
                  <button
                    type="button"
                    class="deck-btn"
                    :class="{ accent: abLoopActive, ghost: abLoopPartial }"
                    :disabled="isLiveStream"
                    :title="abLoopTitle || 'A-B 循环'"
                    :aria-label="abLoopTitle || 'A-B 循环'"
                    @click="emit('toggleAbLoop')"
                  >
                    A-B
                  </button>
                  <button
                    type="button"
                    class="deck-btn ghost"
                    :disabled="isLiveStream || (abLoopA == null && abLoopB == null)"
                    title="清除 A-B 循环"
                    @click="emit('clearAbLoop')"
                  >
                    清除
                  </button>
                </div>
              </div>
              <p class="deck-note">
                第一次点击设起点，第二次设终点并进入循环；可随时清除。直播流不支持。
              </p>
            </section>

            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>04</em>CAST / DLNA</span>
                <span class="deck-card-hint">投送到设备</span>
              </div>
              <div class="deck-module-row">
                <div class="deck-module-copy">
                  <strong>{{ castTargetName || '未投送' }}</strong>
                  <span>{{ canCastCurrentTrack ? '当前曲目可投送' : '当前曲目不可投送' }}</span>
                </div>
                <div class="deck-module-actions">
                  <button
                    type="button"
                    class="deck-btn"
                    :disabled="castBusy"
                    title="刷新设备列表"
                    @click="emit('refreshCastDevices')"
                  >
                    {{ castBusy ? '搜索中…' : '刷新' }}
                  </button>
                  <button
                    v-if="castTargetName"
                    type="button"
                    class="deck-btn ghost"
                    :disabled="castBusy"
                    title="停止投送"
                    @click="emit('stopCast')"
                  >
                    停止
                  </button>
                </div>
              </div>
              <p v-if="castBusy" class="deck-note">正在搜索设备…</p>
              <p v-else-if="castDeviceList.length === 0" class="deck-note">
                未发现投送设备（DLNA / Chromecast）。请确认设备在线且本机已开启远程控制服务。
              </p>
              <ul v-else class="deck-cast-list">
                <li v-for="device in castDeviceList" :key="device.usn">
                  <button
                    type="button"
                    class="deck-cast-item"
                    :disabled="
                      castBusy ||
                      !canCastCurrentTrack ||
                      (device.protocol !== 'chromecast' && !device.avTransportUrl)
                    "
                    @click="emit('castToDevice', device.usn)"
                  >
                    <i class="ph ph-broadcast"></i>
                    <span class="deck-cast-name">{{ device.friendlyName }}</span>
                    <span class="deck-cast-meta">
                      {{
                        device.protocol === 'chromecast'
                          ? 'Chromecast'
                          : device.manufacturer || device.modelName || 'DLNA'
                      }}
                    </span>
                  </button>
                </li>
              </ul>
              <p v-if="castError" class="deck-note warn">{{ castError }}</p>
            </section>

            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>05</em>BOOKMARKS</span>
                <span class="deck-card-hint">书签</span>
              </div>
              <div class="deck-module-row">
                <div class="deck-module-copy">
                  <strong>{{ bookmarkList.length }} 个书签</strong>
                  <span>{{ isLiveStream ? '直播流不支持书签' : '当前曲目' }}</span>
                </div>
                <button
                  type="button"
                  class="deck-btn"
                  :disabled="isLiveStream"
                  title="在当前时间添加书签"
                  @click="emit('addBookmark')"
                >
                  添加
                </button>
              </div>
              <p v-if="bookmarkList.length === 0" class="deck-note">
                {{ isLiveStream ? '直播流不支持书签' : '暂无书签，点击右侧「添加」标记当前位置' }}
              </p>
              <ul v-else class="deck-bookmark-list">
                <li v-for="bm in bookmarkList" :key="bm.id" class="deck-bookmark-item">
                  <button
                    type="button"
                    class="deck-bookmark-jump"
                    @click="emit('jumpBookmark', bm)"
                  >
                    <span class="deck-bookmark-time">{{
                      formatBookmarkTime(bm.positionSeconds)
                    }}</span>
                    <template v-if="renamingBookmarkId === bm.id">
                      <input
                        v-model="renameDraftValue"
                        class="deck-bookmark-rename"
                        type="text"
                        maxlength="120"
                        @click.stop
                        @keydown.enter.prevent="emit('commitRenameBookmark')"
                        @keydown.esc.prevent="emit('cancelRenameBookmark')"
                      />
                    </template>
                    <span v-else class="deck-bookmark-label">{{ bm.label }}</span>
                    <span v-if="bm.kind === 'resume'" class="deck-bookmark-kind">续播</span>
                  </button>
                  <div class="deck-module-actions">
                    <button
                      v-if="renamingBookmarkId === bm.id"
                      type="button"
                      class="deck-btn"
                      @click="emit('commitRenameBookmark')"
                    >
                      保存
                    </button>
                    <button
                      v-else
                      type="button"
                      class="deck-btn ghost"
                      @click="emit('startRenameBookmark', bm)"
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      class="deck-btn ghost"
                      @click="emit('deleteBookmark', bm.id)"
                    >
                      删除
                    </button>
                  </div>
                </li>
              </ul>
            </section>
          </section>

          <!-- 歌词 -->
          <section v-else-if="activeSection === 'lyrics'" key="lyrics" class="deck-stack">
            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>01</em>LYRICS SOURCE</span>
                <span class="deck-card-hint">当前曲目</span>
              </div>
              <div class="deck-spec-grid duo">
                <div class="deck-spec">
                  <span>原文</span>
                  <strong>{{ hasLyrics ? lyricsSourceLabel : '无' }}</strong>
                </div>
                <div class="deck-spec">
                  <span>翻译</span>
                  <strong>{{ hasTranslatedLyrics ? translatedLyricsSourceLabel : '无' }}</strong>
                </div>
              </div>
              <div class="deck-lyric-source-controls" aria-label="歌词来源">
                <label>
                  <span>原文</span>
                  <select
                    :value="originalLayerSelection"
                    :disabled="!currentTrack || lyricControlsPending"
                    aria-label="原文歌词来源"
                    @change="onLyricLayerSelectionChange('originalSelection', $event)"
                  >
                    <option value="automatic">自动</option>
                    <option value="local">本地</option>
                    <option value="provider">Provider</option>
                    <option value="manual">手写</option>
                  </select>
                </label>
                <label>
                  <span>翻译</span>
                  <select
                    :value="translationLayerSelection"
                    :disabled="!currentTrack || lyricControlsPending"
                    aria-label="翻译歌词来源"
                    @change="onLyricLayerSelectionChange('translationSelection', $event)"
                  >
                    <option value="automatic">自动</option>
                    <option value="local">本地</option>
                    <option value="provider">Provider</option>
                    <option value="manual">手写</option>
                  </select>
                </label>
                <button
                  type="button"
                  class="deck-btn ghost deck-translation-toggle"
                  :aria-pressed="showTranslation"
                  :disabled="!currentTrack || lyricControlsPending"
                  @click="emit('toggleTranslationVisibility')"
                >
                  {{ showTranslation ? '隐藏翻译' : '显示翻译' }}
                </button>
              </div>
              <div class="deck-actions trio">
                <button
                  type="button"
                  class="deck-action"
                  :disabled="!currentTrack || lyricsReloading"
                  @click="emit('reloadLyrics', 'auto')"
                >
                  <i
                    :class="lyricsReloading ? 'pi pi-spin pi-spinner' : 'ph ph-arrows-clockwise'"
                  ></i>
                  <span>
                    <strong>自动匹配</strong>
                    <em>本地优先</em>
                  </span>
                </button>
                <button
                  type="button"
                  class="deck-action"
                  :disabled="!currentTrack || lyricsReloading"
                  @click="emit('reloadLyrics', 'local')"
                >
                  <i class="ph ph-folder-open"></i>
                  <span>
                    <strong>本地 LRC</strong>
                    <em>同目录文件</em>
                  </span>
                </button>
                <button
                  type="button"
                  class="deck-action"
                  :disabled="!currentTrack || lyricsReloading"
                  @click="emit('reloadLyrics', 'provider')"
                >
                  <i class="ph ph-cloud-arrow-down"></i>
                  <span>
                    <strong>在线 Provider</strong>
                    <em>插件源</em>
                  </span>
                </button>
              </div>
            </section>

            <section class="deck-card">
              <div class="deck-module-row">
                <div class="deck-module-copy">
                  <strong>当前歌词高光</strong>
                  <span>{{ lyricHighlightOn ? '紧贴字形的柔和高光' : '当前关闭' }}</span>
                </div>
                <button
                  type="button"
                  class="deck-switch"
                  :class="{ active: lyricHighlightOn }"
                  role="switch"
                  :aria-checked="lyricHighlightOn"
                  aria-label="当前歌词高光"
                  :disabled="lyricControlsPending"
                  @click="emit('toggleLyricHighlight')"
                >
                  <span class="deck-switch-knob"></span>
                </button>
              </div>
              <div class="deck-module-row">
                <div class="deck-module-copy">
                  <strong>桌面歌词</strong>
                  <span>{{ desktopLyricsOn ? '独立窗口已开启' : '当前关闭' }}</span>
                </div>
                <button
                  type="button"
                  class="deck-switch"
                  :class="{ active: desktopLyricsOn }"
                  role="switch"
                  :aria-checked="desktopLyricsOn"
                  @click="emit('toggleDesktopLyrics')"
                >
                  <span class="deck-switch-knob"></span>
                </button>
              </div>
              <p class="deck-note">
                歌词来源会优先使用内嵌 / 本地 LRC，缺失时再回落 Provider。重新匹配不会改动音频本身。
              </p>
            </section>

            <section class="deck-card">
              <div class="deck-card-label">
                <span><em>02</em>LYRICS MANAGER</span>
                <span class="deck-card-hint">偏移 · 导入 · 编辑</span>
              </div>
              <LyricsManagerPanel />
            </section>

            <section class="deck-card">
              <button type="button" class="deck-action full" @click="emit('openSettings')">
                <i class="ph ph-text-aa"></i>
                <span>
                  <strong>歌词显示样式</strong>
                  <em>字号 · 对齐 · 暗度 · 桌面歌词外观</em>
                </span>
              </button>
            </section>
          </section>
        </Transition>

        <section v-if="playerBarButtons.length" class="deck-card">
          <div class="deck-card-label">
            <span><em>EX</em>EXTENSIONS</span>
            <span class="deck-card-hint">插件</span>
          </div>
          <div class="deck-extensions">
            <button
              v-for="button in playerBarButtons"
              :key="button.id"
              type="button"
              class="deck-extension"
              @click="emit('runExtension', button.command)"
            >
              <strong>{{ button.title }}</strong>
              <span>{{ button.description || '插件操作' }}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== Signal Deck v2 — 应用原生设计体系（紫罗兰主色 / 白卡 / 石板灰） ===== */
.deck {
  --d-ink: #111827;
  --d-muted: #6b7280;
  --d-faint: #9ca3af;
  --d-line: rgba(15, 23, 42, 0.08);
  --d-line-strong: rgba(15, 23, 42, 0.14);
  --d-card: #ffffff;
  --d-card-hover: #ffffff;
  --d-well: #f8fafc;
  --d-accent: var(--d-accent-src, #7c4dff);
  --d-accent-strong: color-mix(in srgb, var(--d-accent) 68%, #312e81);
  --d-accent-soft: color-mix(in srgb, var(--d-accent) 9%, transparent);
  --d-accent-line: color-mix(in srgb, var(--d-accent) 28%, transparent);
  --d-success: #0ea968;
  --d-success-soft: rgba(32, 198, 94, 0.1);
  --d-warn: #d97706;
  --d-warn-soft: rgba(245, 158, 11, 0.1);
  --d-warn-line: rgba(245, 158, 11, 0.3);
  --d-glow: color-mix(in srgb, var(--d-accent) 45%, transparent);
  --d-mono: 'JetBrains Mono', 'SFMono-Regular', ui-monospace, 'Cascadia Mono', Consolas, monospace;

  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--d-ink);
  font-family: var(--te-font-sans);
}

.deck *,
.deck *::before,
.deck *::after {
  box-sizing: border-box;
}

.deck-dark,
html[data-theme='dark'] .deck {
  --d-ink: #eef2f7;
  --d-muted: #9aa3b2;
  --d-faint: #64748b;
  --d-line: rgba(226, 232, 240, 0.1);
  --d-line-strong: rgba(226, 232, 240, 0.18);
  --d-card: rgba(255, 255, 255, 0.05);
  --d-card-hover: rgba(255, 255, 255, 0.09);
  --d-well: rgba(255, 255, 255, 0.03);
  --d-accent: color-mix(in srgb, var(--d-accent-src, #a885f7) 82%, #ffffff);
  --d-accent-strong: color-mix(in srgb, var(--d-accent) 62%, #ffffff);
  --d-accent-soft: color-mix(in srgb, var(--d-accent) 16%, transparent);
  --d-accent-line: color-mix(in srgb, var(--d-accent) 38%, transparent);
  --d-success: #34d399;
  --d-success-soft: rgba(52, 211, 153, 0.14);
  --d-warn: #fbbf24;
  --d-warn-soft: rgba(251, 191, 36, 0.12);
  --d-warn-line: rgba(251, 191, 36, 0.32);
  --d-glow: color-mix(in srgb, var(--d-accent) 50%, transparent);
}

button {
  font-family: inherit;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

/* LED */
.deck-led {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--d-faint);
  transition:
    background 0.25s ease,
    box-shadow 0.25s ease;
}

.deck-led.on {
  background: var(--d-accent);
  box-shadow: 0 0 8px var(--d-glow);
  animation: deck-led-pulse 2.2s ease-in-out infinite;
}

@keyframes deck-led-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

/* ===== 解码显示屏（磨砂玻璃 + 紫蓝渐变读数） ===== */
.deck-display {
  position: relative;
  margin: 12px 14px 6px;
  padding: 14px 16px 16px;
  border-radius: 18px;
  overflow: hidden;
  flex-shrink: 0;
  background:
    radial-gradient(
      120% 160% at 10% -20%,
      color-mix(in srgb, var(--d-accent) 13%, transparent),
      transparent 55%
    ),
    radial-gradient(
      110% 150% at 108% 120%,
      color-mix(in srgb, var(--d-accent) 8%, transparent),
      transparent 52%
    ),
    linear-gradient(160deg, #ffffff 0%, color-mix(in srgb, var(--d-accent) 4%, #ffffff) 100%);
  border: 1px solid color-mix(in srgb, var(--d-accent) 16%, transparent);
  box-shadow: 0 14px 34px color-mix(in srgb, var(--d-accent) 14%, transparent);
  color: var(--d-ink);
}

.deck-dark .deck-display,
html[data-theme='dark'] .deck .deck-display {
  background:
    radial-gradient(
      120% 160% at 10% -20%,
      color-mix(in srgb, var(--d-accent) 16%, transparent),
      transparent 55%
    ),
    radial-gradient(
      110% 150% at 108% 120%,
      color-mix(in srgb, var(--d-accent) 9%, transparent),
      transparent 52%
    ),
    linear-gradient(
      160deg,
      color-mix(in srgb, var(--d-accent) 10%, transparent) 0%,
      rgba(255, 255, 255, 0.03) 100%
    );
  border-color: var(--d-accent-line);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.3);
}

.deck-display-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.deck-display-now {
  font-family: var(--d-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.3em;
  color: var(--d-accent);
  opacity: 0.65;
  flex-shrink: 0;
}

.deck-display-track {
  font-family: var(--d-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--d-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.deck-display-body {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
}

.deck-display-rate {
  display: flex;
  align-items: baseline;
  gap: 7px;
  line-height: 1;
}

.deck-rate-num {
  font-family: var(--d-mono);
  font-size: 52px;
  font-weight: 600;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  background: linear-gradient(115deg, var(--d-accent-strong) 15%, var(--d-accent) 90%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}

.deck-dark .deck-rate-num,
html[data-theme='dark'] .deck .deck-rate-num {
  background: linear-gradient(115deg, var(--d-accent) 15%, var(--d-accent-strong) 90%);
  -webkit-background-clip: text;
  background-clip: text;
}

.deck-rate-unit {
  font-family: var(--d-mono);
  font-size: 12px;
  letter-spacing: 0.18em;
  color: var(--d-muted);
}

.deck-display-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  min-width: 0;
}

.deck-format-plate {
  font-family: var(--d-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.22em;
  padding: 4px 10px 3px;
  border-radius: 8px;
  color: var(--d-accent-strong);
  border: 1px solid var(--d-accent-line);
  background: var(--d-accent-soft);
}

.deck-tier {
  font-family: var(--d-mono);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--d-faint);
}

.deck-tier[data-tone='success'] {
  color: var(--d-success);
}

.deck-tier[data-tone='warning'] {
  color: var(--d-warn);
}

.deck-display-sub {
  font-family: var(--d-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--d-muted);
  font-variant-numeric: tabular-nums;
}

.deck-display-sub.dim {
  color: var(--d-faint);
}

/* ===== 主体：导轨 + 内容 ===== */
.deck-main {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
}

.deck-rail {
  width: 62px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 7px;
  border-right: 1px solid var(--d-line);
}

.deck-rail-spacer {
  flex: 1;
}

.deck-rail-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 0 8px;
  border: 1px solid transparent;
  border-radius: 13px;
  background: transparent;
  color: var(--d-muted);
  transition: all 0.2s ease;
}

.deck-rail-btn i {
  font-size: 17px;
}

.deck-rail-btn span {
  font-size: 10px;
  letter-spacing: 0.06em;
}

.deck-rail-btn:hover {
  background: var(--d-well);
  color: var(--d-ink);
}

.deck-rail-btn.active {
  background: var(--d-accent-soft);
  border-color: var(--d-accent-line);
  color: var(--d-accent);
}

.deck-rail-btn.active::before {
  content: '';
  position: absolute;
  left: -7px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 22px;
  border-radius: 0 3px 3px 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--d-accent) 45%, #ffffff),
    var(--d-accent)
  );
  box-shadow: 0 0 8px var(--d-glow);
}

.deck-rail-btn.utility {
  color: var(--d-faint);
}

/* ===== 内容区 ===== */
.deck-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 14px 18px;
  scrollbar-width: thin;
  scrollbar-color: var(--d-line-strong) transparent;
}

.deck-content::-webkit-scrollbar {
  width: 5px;
}

.deck-content::-webkit-scrollbar-thumb {
  background: var(--d-line-strong);
  border-radius: 4px;
}

.deck-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.deck-fade-enter-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.deck-fade-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}

.deck-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.deck-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ===== 卡片 ===== */
.deck-card {
  border: 1px solid var(--d-line);
  border-radius: 16px;
  background: var(--d-card);
  padding: 13px 13px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 4px 18px rgba(86, 70, 160, 0.05);
}

.deck-dark .deck-card,
html[data-theme='dark'] .deck .deck-card {
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
}

.deck-card-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.deck-card-label > span:first-child {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: var(--d-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--d-ink);
}

.deck-card-label em {
  font-style: normal;
  font-size: 9.5px;
  font-weight: 500;
  color: var(--d-accent);
  letter-spacing: 0.1em;
}

.deck-card-hint {
  font-size: 10.5px;
  color: var(--d-muted);
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* ===== 信号流 ===== */
.deck-flow {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.deck-node {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 6px 8px;
  border-radius: 12px;
  border: 1px solid var(--d-line);
  background: var(--d-well);
  text-align: center;
}

.deck-node strong {
  font-family: var(--d-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.deck-node em {
  font-style: normal;
  font-family: var(--d-mono);
  font-size: 8.5px;
  letter-spacing: 0.04em;
  color: var(--d-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.deck-node-led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--d-faint);
  margin-bottom: 2px;
}

.deck-node[data-tone='success'] .deck-node-led {
  background: var(--d-success);
  box-shadow: 0 0 7px rgba(32, 198, 94, 0.6);
}

.deck-node[data-tone='warning'] .deck-node-led {
  background: #f59e0b;
  box-shadow: 0 0 7px rgba(245, 158, 11, 0.6);
  animation: deck-led-pulse 2s ease-in-out infinite;
}

.deck-flow-link {
  align-self: center;
  width: 18px;
  height: 2px;
  flex-shrink: 0;
  border-radius: 2px;
  background: var(--d-line-strong);
  position: relative;
  overflow: hidden;
}

.deck-flow-link.active::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, var(--d-accent), transparent);
  background-size: 200% 100%;
  animation: deck-flow-dash 1.6s linear infinite;
}

@keyframes deck-flow-dash {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

/* ===== 芯片 ===== */
.deck-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.deck-chip {
  font-family: var(--d-mono);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 4px 9px 3px;
  border-radius: 999px;
  border: 1px solid var(--d-line);
  color: var(--d-muted);
  background: var(--d-well);
}

.deck-chip[data-tone='success'] {
  color: var(--d-success);
  border-color: rgba(32, 198, 94, 0.28);
  background: var(--d-success-soft);
}

.deck-chip[data-tone='warning'] {
  color: var(--d-warn);
  border-color: var(--d-warn-line);
  background: var(--d-warn-soft);
}

/* ===== 读数 / 注释 ===== */
.deck-readout {
  margin: 0;
  font-family: var(--d-mono);
  font-size: 10.5px;
  line-height: 1.55;
  letter-spacing: 0.02em;
  color: var(--d-muted);
  background: var(--d-well);
  border: 1px solid var(--d-line);
  border-radius: 10px;
  padding: 8px 10px;
  word-break: break-all;
}

.deck-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--d-muted);
}

.deck-note.warn,
.deck-note[data-tone='warning'] {
  color: var(--d-warn);
}

.deck-note[data-tone='success'] {
  color: var(--d-success);
}

/* ===== Unity ===== */
.deck-unity {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--d-warn-line);
  background: var(--d-warn-soft);
}

.deck-unity-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.deck-unity-copy strong {
  font-family: var(--d-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--d-warn);
}

.deck-unity-copy em {
  font-style: normal;
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--d-muted);
}

/* ===== 遥测仪表 ===== */
.deck-meter-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.deck-meter {
  border: 1px solid var(--d-line);
  border-radius: 12px;
  background: var(--d-well);
  padding: 10px 11px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.deck-meter span {
  font-family: var(--d-mono);
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.24em;
  color: var(--d-faint);
}

.deck-meter strong {
  font-family: var(--d-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--d-ink);
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
}

/* ===== 规格瓷砖 ===== */
.deck-spec-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.deck-spec {
  border: 1px solid var(--d-line);
  border-radius: 12px;
  background: var(--d-well);
  padding: 10px 12px 9px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition:
    border-color 0.2s ease,
    background 0.2s ease;
}

.deck-spec:hover {
  border-color: var(--d-accent-line);
  background: var(--d-accent-soft);
}

.deck-spec span {
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--d-muted);
}

.deck-spec strong {
  font-family: var(--d-mono);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}

/* ===== LED 拨杆 ===== */
.deck-lyric-source-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.deck-lyric-source-controls label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--d-muted);
  font-size: 11px;
  white-space: nowrap;
}

.deck-lyric-source-controls select {
  min-width: 76px;
  height: 30px;
  border: 1px solid var(--d-line-strong);
  border-radius: 8px;
  background: var(--d-well) !important;
  color: var(--d-ink) !important;
  font: inherit;
  padding: 0 7px;
}

.deck-lyric-source-controls select option {
  background: var(--d-card) !important;
  color: var(--d-ink) !important;
}

.deck-lyric-source-controls select:focus-visible,
.deck-translation-toggle:focus-visible {
  outline: 2px solid var(--d-accent);
  outline-offset: 2px;
}

.deck-translation-toggle[aria-pressed='true'] {
  border-color: var(--d-accent-line);
  color: var(--d-accent);
}

.deck-lyric-source-controls select:disabled,
.deck-translation-toggle:disabled {
  cursor: wait;
  opacity: 0.55;
}

.deck-toggles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.deck-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 11px;
  border-radius: 12px;
  border: 1px solid var(--d-line);
  background: var(--d-well);
  color: var(--d-muted);
  transition: all 0.2s ease;
  min-width: 0;
}

.deck-toggle i {
  font-size: 14px;
  flex-shrink: 0;
}

.deck-toggle-name {
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deck-toggle em {
  font-style: normal;
  font-family: var(--d-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  margin-left: auto;
  flex-shrink: 0;
  color: var(--d-faint);
}

.deck-toggle:hover {
  border-color: var(--d-line-strong);
  background: var(--d-card-hover);
  color: var(--d-ink);
}

.deck-toggle.on {
  border-color: var(--d-accent-line);
  background: var(--d-accent-soft);
  color: var(--d-ink);
}

.deck-toggle.on .deck-led {
  background: var(--d-accent);
  box-shadow: 0 0 8px var(--d-glow);
}

.deck-toggle.on em {
  color: var(--d-accent);
}

.deck-gapless {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

/* ===== 开关 ===== */
.deck-switch {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid var(--d-line-strong);
  background: var(--d-well);
  flex-shrink: 0;
  transition: all 0.22s ease;
}

.deck-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--d-faint);
  transition: all 0.22s cubic-bezier(0.34, 1.4, 0.64, 1);
}

.deck-switch.active {
  border-color: var(--d-accent-line);
  background: var(--d-accent-soft);
  box-shadow: inset 0 0 10px color-mix(in srgb, var(--d-accent) 14%, transparent);
}

.deck-switch.active .deck-switch-knob {
  left: 20px;
  background: var(--d-accent);
  box-shadow: 0 0 8px var(--d-glow);
}

/* ===== 按钮 ===== */
.deck-btn {
  padding: 7px 13px;
  border-radius: 10px;
  border: 1px solid var(--d-line-strong);
  background: var(--d-card);
  color: var(--d-ink);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.03em;
  transition: all 0.18s ease;
  white-space: nowrap;
}

.deck-btn:hover {
  background: var(--d-card-hover);
  border-color: var(--d-accent-line);
}

.deck-btn.accent {
  border-color: var(--d-accent-line);
  background: var(--d-accent-soft);
  color: var(--d-accent);
  font-weight: 600;
}

.deck-btn.ghost {
  background: transparent;
  color: var(--d-muted);
}

.deck-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  color: var(--d-accent);
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 2px 4px;
  border-radius: 6px;
}

.deck-link:hover {
  background: var(--d-accent-soft);
}

/* ===== 分段选择 ===== */
.deck-segmented {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 13px;
  border: 1px solid var(--d-line);
  background: var(--d-well);
}

.deck-segmented button {
  flex: 1;
  min-width: 0;
  padding: 8px 4px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--d-muted);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  transition: all 0.18s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deck-segmented button:hover {
  color: var(--d-ink);
}

.deck-segmented button.active {
  background: var(--d-card-hover);
  border-color: var(--d-accent-line);
  color: var(--d-accent);
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(86, 70, 160, 0.1);
}

/* ===== 设备列表 ===== */
.deck-devices {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.deck-device {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  border-radius: 13px;
  border: 1px solid var(--d-line);
  background: var(--d-well);
  text-align: left;
  color: var(--d-ink);
  transition: all 0.18s ease;
}

.deck-device > i {
  font-size: 18px;
  color: var(--d-muted);
  flex-shrink: 0;
}

.deck-device-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.deck-device-copy strong {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deck-device-copy span {
  font-family: var(--d-mono);
  font-size: 9.5px;
  letter-spacing: 0.03em;
  color: var(--d-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deck-device em {
  font-style: normal;
  font-family: var(--d-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--d-accent);
  border: 1px solid var(--d-accent-line);
  background: var(--d-accent-soft);
  padding: 3px 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

.deck-device:hover {
  border-color: var(--d-line-strong);
  background: var(--d-card-hover);
}

.deck-device.active {
  border-color: var(--d-accent-line);
  background: var(--d-accent-soft);
}

.deck-device.active > i {
  color: var(--d-accent);
}

/* ===== 表单 ===== */
.deck-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.deck-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.deck-field > span {
  font-family: var(--d-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--d-faint);
}

.deck-select {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  min-width: 0;
  padding: 8px 28px 8px 11px;
  border-radius: 10px;
  border: 1px solid var(--d-line-strong);
  background-color: var(--d-card);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  color: var(--d-ink);
  font-size: 12px;
  font-family: inherit;
  transition: border-color 0.18s ease;
}

.deck-select:hover,
.deck-select:focus {
  border-color: var(--d-accent-line);
  outline: none;
}

.deck-select option {
  color: #111827;
  background: #ffffff;
}

html[data-theme='dark'] .deck .deck-select option {
  color: var(--d-ink) !important;
  background: var(--d-card) !important;
}

html[data-theme='dark'] .deck .deck-select {
  background-color: var(--d-card) !important;
  color: var(--d-ink) !important;
}

/* ===== 滑杆 ===== */
.deck-control {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.deck-control.compact {
  gap: 4px;
}

.deck-control-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.deck-control-head span {
  font-family: var(--d-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--d-faint);
}

.deck-control-head strong {
  font-family: var(--d-mono);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--d-accent);
  font-variant-numeric: tabular-nums;
}

.deck-range {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 16px;
  background: transparent;
  --range-value: 0%;
}

.deck-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 4px;
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--d-accent) 45%, #ffffff) 0%,
    var(--d-accent) var(--range-value),
    var(--d-line-strong) var(--range-value),
    var(--d-line-strong) 100%
  );
}

.deck-range::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 13px;
  height: 13px;
  margin-top: -4.5px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid var(--d-accent);
  box-shadow: 0 0 6px var(--d-glow);
  transition: transform 0.15s ease;
}

.deck-range::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

.deck-range::-moz-range-track {
  height: 4px;
  border-radius: 4px;
  background: var(--d-line-strong);
}

.deck-range::-moz-range-progress {
  height: 4px;
  border-radius: 4px;
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--d-accent) 45%, #ffffff),
    var(--d-accent)
  );
}

.deck-range::-moz-range-thumb {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid var(--d-accent);
  box-shadow: 0 0 6px var(--d-glow);
}

/* ===== DSP 主控 ===== */
.deck-master {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 11px;
  border-bottom: 1px solid var(--d-line);
}

.deck-master-copy {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.deck-master-copy > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.deck-master-copy strong {
  font-size: 13px;
  font-weight: 650;
}

.deck-master-copy span {
  font-size: 10.5px;
  color: var(--d-muted);
}

.deck-modules {
  display: flex;
  flex-direction: column;
  gap: 11px;
  transition: opacity 0.25s ease;
}

.deck-modules.dim {
  opacity: 0.45;
  pointer-events: none;
}

.deck-module-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.deck-module-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.deck-module-copy strong {
  font-size: 12.5px;
  font-weight: 600;
}

.deck-module-copy strong.deck-mono {
  font-family: var(--d-mono);
  font-variant-numeric: tabular-nums;
}

.deck-module-copy span {
  font-size: 10.5px;
  color: var(--d-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deck-module-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.deck-inline-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--d-line-strong);
  background: var(--d-well);
  color: var(--d-muted);
  font-size: 11.5px;
  transition: all 0.18s ease;
}

.deck-inline-toggle.on {
  border-color: var(--d-accent-line);
  background: var(--d-accent-soft);
  color: var(--d-accent);
}

.deck-inline-toggle.on .deck-led {
  background: var(--d-accent);
  box-shadow: 0 0 8px var(--d-glow);
}

/* ===== 行动按钮 ===== */
.deck-actions {
  flex-direction: row;
  gap: 8px;
  padding: 2px 0 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.deck-action {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 13px;
  border: 1px solid var(--d-line);
  background: var(--d-card);
  color: var(--d-ink);
  text-align: left;
  transition: all 0.18s ease;
}

.deck-action > i {
  font-size: 17px;
  color: var(--d-muted);
  flex-shrink: 0;
  transition: color 0.18s ease;
}

.deck-action span {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.deck-action strong {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deck-action em {
  font-style: normal;
  font-size: 10px;
  color: var(--d-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deck-action:hover {
  border-color: var(--d-accent-line);
  transform: translateY(-1px);
}

.deck-action:hover > i {
  color: var(--d-accent);
}

.deck-action.accent {
  border-color: var(--d-accent-line);
  background: var(--d-accent-soft);
}

.deck-action.accent > i {
  color: var(--d-accent);
}

.deck-action.full {
  width: 100%;
}

/* ===== 投送 / 书签 ===== */
.deck-cast-list,
.deck-bookmark-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.deck-cast-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--d-line);
  background: var(--d-well);
  color: var(--d-ink);
  text-align: left;
  transition: all 0.18s ease;
}

.deck-cast-item > i {
  font-size: 15px;
  color: var(--d-muted);
}

.deck-cast-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deck-cast-meta {
  font-family: var(--d-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--d-muted);
  flex-shrink: 0;
}

.deck-cast-item:hover {
  border-color: var(--d-accent-line);
  background: var(--d-accent-soft);
}

.deck-bookmark-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--d-line);
  background: var(--d-well);
}

.deck-bookmark-jump {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--d-ink);
  text-align: left;
  min-width: 0;
}

.deck-bookmark-time {
  font-family: var(--d-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--d-accent);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.deck-bookmark-label {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deck-bookmark-kind {
  font-size: 9.5px;
  color: var(--d-success);
  border: 1px solid rgba(32, 198, 94, 0.28);
  background: var(--d-success-soft);
  border-radius: 999px;
  padding: 2px 7px;
  flex-shrink: 0;
}

.deck-bookmark-rename {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--d-accent-line);
  border-radius: 8px;
  background: var(--d-card);
  color: var(--d-ink);
  font-size: 12px;
  font-family: inherit;
  padding: 5px 8px;
  outline: none;
}

/* ===== 插件 ===== */
.deck-extensions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.deck-extension {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--d-line);
  background: var(--d-well);
  color: var(--d-ink);
  text-align: left;
  transition: all 0.18s ease;
}

.deck-extension strong {
  font-size: 12px;
  font-weight: 600;
}

.deck-extension span {
  font-size: 10.5px;
  color: var(--d-muted);
}

.deck-extension:hover {
  border-color: var(--d-accent-line);
  background: var(--d-accent-soft);
}

/* ===== 减少动态 ===== */
@media (prefers-reduced-motion: reduce) {
  .deck *,
  .deck *::before,
  .deck *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
