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

export type StatusTone = 'success' | 'warning' | 'muted'

export interface HiFiStatusChip {
  label: string
  tone?: StatusTone
}

const props = defineProps<{
  glass?: boolean
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
  playerBarButtons: Array<{
    id: string
    title: string
    description?: string
    command?: string
  }>
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
  setDsdOutputMode: [mode: DsdOutputMode]
  setOutputStage: [partial: Partial<DspOutputStageConfig>]
  setStereoImage: [partial: Partial<DspStereoImageConfig>]
  setAudioOutput: [output: AudioOutputId]
  setAudioDevice: [device: string]
  refreshDevices: []
  selectImpulseResponse: []
  clearImpulseResponse: []
  reloadLyrics: [prefer: 'auto' | 'local' | 'provider']
  runExtension: [command?: string]
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

const activeSection = ref<'console' | 'output' | 'dsp' | 'lyrics'>('console')

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

const dsdOutputModeOptions = DSD_OUTPUT_MODE_OPTIONS
const replayGainOptions = VOLUME_NORMALIZATION_OPTIONS
const sampleRateOptions = DSP_OUTPUT_SAMPLE_RATE_OPTIONS
const resamplerOptions = DSP_RESAMPLER_QUALITY_OPTIONS
const ditherOptions = DSP_DITHER_MODE_OPTIONS

const sectionTabs = [
  { id: 'console' as const, label: '总览', icon: 'ph-gauge' },
  { id: 'output' as const, label: '输出', icon: 'ph-speaker-hifi' },
  { id: 'dsp' as const, label: 'DSP', icon: 'ph-sliders-horizontal' },
  { id: 'lyrics' as const, label: '歌词', icon: 'ph-text-aa' }
]

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
</script>

<template>
  <div class="hifi-panel" :class="{ 'hifi-panel-glass': glass }">
    <nav class="hifi-tabs" aria-label="HiFi 分区">
      <button
        v-for="tab in sectionTabs"
        :key="tab.id"
        type="button"
        class="hifi-tab"
        :class="{ active: activeSection === tab.id }"
        @click="activeSection = tab.id"
      >
        <i class="ph" :class="tab.icon"></i>
        <span>{{ tab.label }}</span>
      </button>
    </nav>

    <div class="hifi-body">
      <!-- 总览 -->
      <section v-if="activeSection === 'console'" class="hifi-section-stack">
        <section class="hifi-section">
          <div class="hifi-section-label">
            <span><em>01</em>Signal Path</span>
            <span class="hifi-section-hint">实时链路</span>
          </div>
          <div class="hifi-chip-row">
            <span
              v-for="chip in statusChips"
              :key="chip.label"
              class="hifi-chip"
              :class="chip.tone || 'muted'"
            >
              {{ chip.label }}
            </span>
          </div>
          <p v-if="outputChainText" class="hifi-chain" :title="outputChainText">
            {{ outputChainText }}
          </p>
          <p v-if="nonPerfectReason" class="hifi-reason">{{ nonPerfectReason }}</p>
          <div v-if="showUnityVolumeCta" class="hifi-unity-cta">
            <div class="hifi-unity-copy">
              <strong>Unity 音量</strong>
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
              class="hifi-mini-btn"
              :class="{ accent: perfectReasonCode === 'volume_not_unity' }"
              :disabled="isVolumeUnity"
              @click="emit('setUnityVolume')"
            >
              {{ HIFI_STATUS_COPY.unityButton }}
            </button>
          </div>
          <div class="hifi-meta-grid dual">
            <div class="hifi-meta">
              <span>Latency</span>
              <strong>{{ outputLatencyText.replace(/^Latency\s*/, '') }}</strong>
            </div>
            <div class="hifi-meta">
              <span>Diagnostics</span>
              <strong>{{ outputDiagnosticsText }}</strong>
            </div>
          </div>
          <p v-if="nativeDsdRuntimeReasonText" class="hifi-reason subtle">
            {{ nativeDsdRuntimeReasonText }}
          </p>
        </section>

        <section class="hifi-section">
          <div class="hifi-section-label">
            <span><em>02</em>Source Quality</span>
            <span class="hifi-chip" :class="sourceQuality.tone">{{ sourceQuality.badge }}</span>
          </div>
          <div class="hifi-quality-grid">
            <div class="hifi-quality-card">
              <span>格式</span>
              <strong>{{ sourceQuality.format }}</strong>
            </div>
            <div class="hifi-quality-card">
              <span>采样率</span>
              <strong>{{ sourceQuality.rate }}</strong>
            </div>
            <div class="hifi-quality-card">
              <span>位深</span>
              <strong>{{ sourceQuality.depth }}</strong>
            </div>
            <div class="hifi-quality-card">
              <span>码率</span>
              <strong>{{ sourceQuality.bitrate }}</strong>
            </div>
          </div>
          <p class="hifi-reason subtle">来源 · {{ sourceQuality.source }}</p>
        </section>

        <section class="hifi-section">
          <div class="hifi-section-label">
            <span><em>03</em>Quick Engine</span>
            <span class="hifi-section-hint">快捷开关</span>
          </div>
          <div class="hifi-toggle-grid">
            <button
              type="button"
              class="hifi-toggle-card"
              :class="{ on: exclusiveMode, disabled: !exclusiveAvailable }"
              :disabled="!exclusiveAvailable"
              @click="emit('toggleExclusive')"
            >
              <i class="ph ph-lock-key"></i>
              <span>Exclusive</span>
              <em>{{ exclusiveMode ? 'ON' : 'OFF' }}</em>
            </button>
            <button
              type="button"
              class="hifi-toggle-card"
              :class="{ on: audioProcessing.gapless }"
              @click="emit('toggleGapless')"
            >
              <i class="ph ph-arrows-merge"></i>
              <span>Gapless</span>
              <em>{{ audioProcessing.gapless ? 'ON' : 'OFF' }}</em>
            </button>
            <button
              type="button"
              class="hifi-toggle-card"
              :class="{ on: audioProcessing.clipGuard }"
              @click="emit('toggleClipGuard')"
            >
              <i class="ph ph-shield-check"></i>
              <span>Clip Guard</span>
              <em>{{ audioProcessing.clipGuard ? 'ON' : 'OFF' }}</em>
            </button>
            <button
              type="button"
              class="hifi-toggle-card"
              :class="{ on: dspMasterOn }"
              @click="emit('toggleDsp')"
            >
              <i class="ph ph-circuitry"></i>
              <span>Master DSP</span>
              <em>{{ dspMasterOn ? 'ON' : 'OFF' }}</em>
            </button>
          </div>
          <div class="hifi-gapless-status" :data-tone="gaplessStatusTone">
            <span v-if="audioProcessing.gapless && gaplessActive" class="hifi-chip success">Active</span>
            <span v-if="audioProcessing.gapless && preloadReady" class="hifi-chip success">Preload</span>
            <span
              v-if="audioProcessing.gapless && gaplessBlockedReason"
              class="hifi-chip warning"
            >Blocked</span>
            <p class="hifi-reason subtle">{{ gaplessStatusText }}</p>
          </div>
          <p class="hifi-reason subtle">{{ HIFI_STATUS_COPY.gaplessNote }}</p>
        </section>

        <section class="hifi-section hifi-footer-section">
          <div class="hifi-action-row triple">
            <button type="button" class="hifi-action" @click="emit('openSettings')">
              <i class="ph ph-gear-six"></i>
              <span>
                <strong>播放设置</strong>
                <em>输出 · 缓存</em>
              </span>
            </button>
            <button type="button" class="hifi-action accent" @click="emit('openEqualizer')">
              <i class="ph ph-faders"></i>
              <span>
                <strong>均衡器</strong>
                <em>完整 EQ 页</em>
              </span>
            </button>
            <button type="button" class="hifi-action" @click="emit('openDsp')">
              <i class="ph ph-sliders-horizontal"></i>
              <span>
                <strong>DSP 工作台</strong>
                <em>空间 · 解码</em>
              </span>
            </button>
          </div>
        </section>
      </section>

      <!-- 输出 -->
      <section v-else-if="activeSection === 'output'" class="hifi-section-stack">
        <section class="hifi-section">
          <div class="hifi-section-label">
            <span><em>01</em>Backend</span>
            <span class="hifi-section-hint">输出后端</span>
          </div>
          <div class="hifi-segmented">
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

        <section class="hifi-section">
          <div class="hifi-section-label">
            <span><em>02</em>Devices</span>
            <button type="button" class="hifi-link-btn" @click="emit('refreshDevices')">
              刷新
            </button>
          </div>
          <div class="hifi-device-list">
            <button
              v-for="device in audioDeviceOptions"
              :key="device.id"
              type="button"
              class="hifi-device-card"
              :class="{ active: audioDevice === device.id }"
              @click="emit('setAudioDevice', device.id)"
            >
              <i :class="deviceIcon(device)"></i>
              <div class="hifi-device-copy">
                <strong>{{ device.label }}</strong>
                <span>{{ deviceSpecText(device) || '系统默认路径' }}</span>
              </div>
              <em v-if="audioDevice === device.id">当前</em>
            </button>
          </div>
          <p v-if="selectedDevice" class="hifi-reason subtle">
            当前设备 · {{ selectedDevice.label }}
          </p>
        </section>

        <section class="hifi-section">
          <div class="hifi-section-label">
            <span><em>03</em>Engine Params</span>
            <span class="hifi-section-hint">缓冲 / 路由 / 交叉淡入</span>
          </div>
          <div class="hifi-toggle-grid compact">
            <button
              type="button"
              class="hifi-toggle-card"
              :class="{ on: exclusiveMode, disabled: !exclusiveAvailable }"
              :disabled="!exclusiveAvailable"
              @click="emit('toggleExclusive')"
            >
              <i class="ph ph-lock-key"></i>
              <span>Exclusive</span>
              <em>{{ exclusiveMode ? 'ON' : 'OFF' }}</em>
            </button>
            <button
              type="button"
              class="hifi-toggle-card"
              :class="{ on: audioProcessing.gapless }"
              @click="emit('toggleGapless')"
            >
              <i class="ph ph-arrows-merge"></i>
              <span>Gapless</span>
              <em>{{ audioProcessing.gapless ? 'ON' : 'OFF' }}</em>
            </button>
          </div>
          <div class="hifi-control">
            <div class="hifi-control-head">
              <span>Crossfade</span>
              <strong>{{ crossfadeSeconds.toFixed(1) }} s</strong>
            </div>
            <input
              class="hifi-range"
              type="range"
              min="0"
              max="12"
              step="0.5"
              :value="crossfadeSeconds"
              :style="{ '--range-value': `${(crossfadeSeconds / 12) * 100}%` }"
              @input="onCrossfadeInput"
            />
          </div>
          <div class="hifi-field-row">
            <label class="hifi-field">
              <span>Buffer</span>
              <select
                class="hifi-select"
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
            <label class="hifi-field">
              <span>Routing</span>
              <select
                class="hifi-select"
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
          <label class="hifi-field">
            <span>DSD Mode</span>
            <select
              class="hifi-select"
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

        <section class="hifi-section">
          <div class="hifi-section-label">
            <span><em>04</em>Output Stage</span>
            <span class="hifi-section-hint">采样率锁 · SRC · dither</span>
          </div>
          <p class="hifi-reason subtle" :title="outputStageHint">{{ outputStageHint }}</p>
          <div class="hifi-field-row">
            <label class="hifi-field">
              <span>Target Rate</span>
              <select
                class="hifi-select"
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
            <label class="hifi-field">
              <span>Resampler</span>
              <select
                class="hifi-select"
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
          <label class="hifi-field">
            <span>Dither</span>
            <select
              class="hifi-select"
              :value="dspOutputStage.dither"
              @change="onDitherChange"
            >
              <option v-for="option in ditherOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <p v-if="outputStageActive" class="hifi-reason">
            采样率锁 / SRC / dither 启用时 outputPerfect=false（graph.outputStage，非 OutputConfig）。
          </p>
        </section>
      </section>

      <!-- DSP -->
      <section v-else-if="activeSection === 'dsp'" class="hifi-section-stack">
        <section class="hifi-section">
          <div class="hifi-master-row">
            <div>
              <strong>Master DSP</strong>
              <span>{{ dspMasterOn ? '处理链已启用' : '旁路 · 样本直通优先' }}</span>
            </div>
            <button
              type="button"
              class="hifi-switch"
              :class="{ active: dspMasterOn }"
              role="switch"
              :aria-checked="dspMasterOn"
              @click="emit('toggleDsp')"
            >
              <span class="hifi-switch-knob"></span>
            </button>
          </div>

          <div class="hifi-module" :class="{ dim: !dspMasterOn }">
            <div class="hifi-module-row">
              <div class="hifi-module-copy">
                <strong>Equalizer</strong>
                <span>{{ eqSummary }}</span>
              </div>
              <div class="hifi-module-actions">
                <button type="button" class="hifi-mini-btn" @click="emit('openEqualizer')">
                  打开 EQ
                </button>
                <button
                  type="button"
                  class="hifi-switch"
                  :class="{ active: eqOn }"
                  role="switch"
                  :aria-checked="eqOn"
                  @click="emit('toggleEq')"
                >
                  <span class="hifi-switch-knob"></span>
                </button>
              </div>
            </div>

            <div class="hifi-module-row">
              <div class="hifi-module-copy">
                <strong>Crossfeed</strong>
                <span>耳机串音 · {{ crossfeedPercent }}%</span>
              </div>
              <button
                type="button"
                class="hifi-switch"
                :class="{ active: crossfeedOn }"
                role="switch"
                :aria-checked="crossfeedOn"
                @click="emit('toggleCrossfeed')"
              >
                <span class="hifi-switch-knob"></span>
              </button>
            </div>
            <div class="hifi-control compact">
              <input
                class="hifi-range"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="crossfeedPercent"
                :style="{ '--range-value': `${crossfeedPercent}%` }"
                @input="onCrossfeedInput"
              />
            </div>

            <div class="hifi-module-row">
              <div class="hifi-module-copy">
                <strong>Convolver</strong>
                <span>{{ convolverPathLabel }}</span>
              </div>
              <div class="hifi-module-actions">
                <button type="button" class="hifi-mini-btn" @click="emit('selectImpulseResponse')">
                  IR
                </button>
                <button
                  v-if="audioProcessing.convolverIrPath"
                  type="button"
                  class="hifi-mini-btn ghost"
                  @click="emit('clearImpulseResponse')"
                >
                  清除
                </button>
                <button
                  type="button"
                  class="hifi-switch"
                  :class="{ active: convolverOn }"
                  role="switch"
                  :aria-checked="convolverOn"
                  @click="emit('toggleConvolver')"
                >
                  <span class="hifi-switch-knob"></span>
                </button>
              </div>
            </div>

            <div class="hifi-field-row">
              <label class="hifi-field">
                <span>ReplayGain</span>
                <select
                  class="hifi-select"
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
              <label class="hifi-field">
                <span>Clip Guard</span>
                <button
                  type="button"
                  class="hifi-inline-toggle"
                  :class="{ on: audioProcessing.clipGuard }"
                  @click="emit('toggleClipGuard')"
                >
                  {{ audioProcessing.clipGuard ? '已开启' : '已关闭' }}
                </button>
              </label>
            </div>

            <p
              v-if="loudnormStatusText"
              class="hifi-reason"
              :class="loudnormStatusTone"
            >
              {{ loudnormStatusText }}
            </p>

            <div class="hifi-control">
              <div class="hifi-control-head">
                <span>RG Preamp</span>
                <strong>{{ replayGainPreamp.toFixed(1) }} dB</strong>
              </div>
              <input
                class="hifi-range"
                type="range"
                min="-12"
                max="12"
                step="0.1"
                :value="replayGainPreamp"
                :style="{ '--range-value': `${((replayGainPreamp + 12) / 24) * 100}%` }"
                @input="onPreampInput"
              />
            </div>

            <div class="hifi-module-row">
              <div class="hifi-module-copy">
                <strong>Balance / Phase</strong>
                <span>{{ stereoImageHint }}</span>
              </div>
              <button
                v-if="stereoImageActive"
                type="button"
                class="hifi-mini-btn ghost"
                @click="resetStereoImage"
              >
                复位
              </button>
            </div>
            <div class="hifi-control compact">
              <div class="hifi-control-head">
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
                class="hifi-range"
                type="range"
                min="-100"
                max="100"
                step="1"
                :value="balancePercent"
                :style="{ '--range-value': `${((balancePercent + 100) / 200) * 100}%` }"
                @input="onBalanceInput"
              />
            </div>
            <div class="hifi-control compact">
              <div class="hifi-control-head">
                <span>Width</span>
                <strong>{{ widthPercent }}%</strong>
              </div>
              <input
                class="hifi-range"
                type="range"
                min="0"
                max="200"
                step="1"
                :value="widthPercent"
                :style="{ '--range-value': `${(widthPercent / 200) * 100}%` }"
                @input="onWidthInput"
              />
            </div>
            <div class="hifi-toggle-grid compact">
              <button
                type="button"
                class="hifi-toggle-card"
                :class="{ on: dspStereoImage.invertLeft }"
                @click="toggleInvertLeft"
              >
                <i class="ph ph-arrows-left-right"></i>
                <span>L Phase</span>
                <em>{{ dspStereoImage.invertLeft ? 'INV' : 'OK' }}</em>
              </button>
              <button
                type="button"
                class="hifi-toggle-card"
                :class="{ on: dspStereoImage.invertRight }"
                @click="toggleInvertRight"
              >
                <i class="ph ph-arrows-left-right"></i>
                <span>R Phase</span>
                <em>{{ dspStereoImage.invertRight ? 'INV' : 'OK' }}</em>
              </button>
            </div>
            <p v-if="stereoImageActive" class="hifi-reason">
              平衡 / 宽度 / 相位写入 graph stereoField + channelStrip，会关闭 outputPerfect。
            </p>
          </div>
        </section>

        <section class="hifi-section hifi-footer-section">
          <div class="hifi-action-row">
            <button type="button" class="hifi-action accent" @click="emit('openEqualizer')">
              <i class="ph ph-faders"></i>
              <span>
                <strong>进入 EQ 页面</strong>
                <em>图形 / 参数均衡</em>
              </span>
            </button>
            <button type="button" class="hifi-action" @click="emit('openDsp')">
              <i class="ph ph-sliders-horizontal"></i>
              <span>
                <strong>完整 DSP 设置</strong>
                <em>高级参数</em>
              </span>
            </button>
          </div>
        </section>
      </section>

      <!-- 歌词 -->
      <section v-else class="hifi-section-stack">
        <section class="hifi-section">
          <div class="hifi-section-label">
            <span><em>01</em>Lyrics Source</span>
            <span class="hifi-section-hint">当前曲目</span>
          </div>
          <div class="hifi-quality-grid">
            <div class="hifi-quality-card">
              <span>原文</span>
              <strong>{{ hasLyrics ? lyricsSourceLabel : '无' }}</strong>
            </div>
            <div class="hifi-quality-card">
              <span>翻译</span>
              <strong>{{ hasTranslatedLyrics ? translatedLyricsSourceLabel : '无' }}</strong>
            </div>
          </div>
          <div class="hifi-action-row triple">
            <button
              type="button"
              class="hifi-action"
              :disabled="!currentTrack || lyricsReloading"
              @click="emit('reloadLyrics', 'auto')"
            >
              <i :class="lyricsReloading ? 'pi pi-spin pi-spinner' : 'ph ph-arrows-clockwise'"></i>
              <span>
                <strong>自动匹配</strong>
                <em>本地优先</em>
              </span>
            </button>
            <button
              type="button"
              class="hifi-action"
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
              class="hifi-action"
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

        <section class="hifi-section">
          <div class="hifi-module-row">
            <div class="hifi-module-copy">
              <strong>桌面歌词</strong>
              <span>{{ desktopLyricsOn ? '独立窗口已开启' : '当前关闭' }}</span>
            </div>
            <button
              type="button"
              class="hifi-switch"
              :class="{ active: desktopLyricsOn }"
              role="switch"
              :aria-checked="desktopLyricsOn"
              @click="emit('toggleDesktopLyrics')"
            >
              <span class="hifi-switch-knob"></span>
            </button>
          </div>
          <p class="hifi-reason subtle">
            歌词来源会优先使用内嵌 / 本地 LRC，缺失时再回落 Provider。重新匹配不会改动音频本身。
          </p>
        </section>

        <section class="hifi-section hifi-footer-section">
          <button type="button" class="hifi-action full" @click="emit('openSettings')">
            <i class="ph ph-text-aa"></i>
            <span>
              <strong>歌词显示样式</strong>
              <em>字号 · 对齐 · 暗度 · 桌面歌词外观</em>
            </span>
          </button>
        </section>
      </section>

      <section v-if="playerBarButtons.length" class="hifi-section">
        <div class="hifi-section-label">
          <span>Extensions</span>
          <span class="hifi-section-hint">插件</span>
        </div>
        <div class="hifi-extension-list">
          <button
            v-for="button in playerBarButtons"
            :key="button.id"
            type="button"
            class="hifi-extension"
            @click="emit('runExtension', button.command)"
          >
            <strong>{{ button.title }}</strong>
            <span>{{ button.description || '插件操作' }}</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
