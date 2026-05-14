<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'

defineEmits<{
  back: []
}>()

type EqMode = 'graphic' | 'parametric'
type EqualizerTab = EqMode | 'square'
type EqualizerFilterType =
  | 'peak'
  | 'lowShelf'
  | 'highShelf'
  | 'bandPass'
  | 'lowPass'
  | 'highPass'
  | 'allPass'

interface EqualizerBand {
  frequency: number
  gain: number
  q: number
  filterType: EqualizerFilterType
}

interface AudioProcessingSettings {
  highResolution: boolean
  dsdToPcm: boolean
  eqEnabled: boolean
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
  volumeNormalization: 'off' | 'track' | 'album' | 'loudnorm'
  replayGainPreamp: number
  replayGainFallback: number
  replayGainClip: boolean
  gapless: boolean
  crossfadeSeconds: number
}

interface AudioEqPreset {
  id: string
  name: string
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
}

interface AppSettings {
  autoLaunch: boolean
  hardwareAcceleration: boolean
  globalShortcuts: boolean
  musicCachePath: string
  closeToTray: boolean
  audioProcessing: AudioProcessingSettings
  audioEqPresets: AudioEqPreset[]
}

const chartWidth = 720
const chartHeight = 270
const chartPad = { left: 48, right: 24, top: 18, bottom: 34 }
const graphMinFrequency = 20
const graphMaxFrequency = 20000
const graphMinGain = -18
const graphMaxGain = 18
const frequencyTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 16000, 20000]
const gainTicks = [-18, -12, -6, 0, 6, 12, 18]
const defaultBandFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

const filterTypes: { value: EqualizerFilterType; label: string; usesGain: boolean }[] = [
  { value: 'peak', label: '峰值', usesGain: true },
  { value: 'lowShelf', label: '低频搁架', usesGain: true },
  { value: 'highShelf', label: '高频搁架', usesGain: true },
  { value: 'bandPass', label: '带通', usesGain: false },
  { value: 'lowPass', label: '低通', usesGain: false },
  { value: 'highPass', label: '高通', usesGain: false },
  { value: 'allPass', label: '全通', usesGain: false }
]

const defaultEqBands: EqualizerBand[] = defaultBandFrequencies.map((frequency) => ({
  frequency,
  gain: 0,
  q: 1,
  filterType: 'peak'
}))

const defaultAudioProcessing: AudioProcessingSettings = {
  highResolution: true,
  dsdToPcm: true,
  eqEnabled: false,
  eqMode: 'graphic',
  eqPreamp: 0,
  eqBands: defaultEqBands,
  volumeNormalization: 'track',
  replayGainPreamp: 0,
  replayGainFallback: 0,
  replayGainClip: true,
  gapless: true,
  crossfadeSeconds: 0
}

const builtInEqPresets: AudioEqPreset[] = [
  {
    id: 'flat',
    name: 'Flat',
    eqMode: 'graphic',
    eqPreamp: 0,
    eqBands: defaultEqBands
  },
  {
    id: 'warm',
    name: 'Warm',
    eqMode: 'graphic',
    eqPreamp: -1,
    eqBands: [2.4, 1.8, 1.1, 0.4, 0, -0.4, -0.5, 0.2, 0.8, 1].map((gain, index) => ({
      ...defaultEqBands[index],
      gain
    }))
  },
  {
    id: 'vocal',
    name: 'Vocal',
    eqMode: 'parametric',
    eqPreamp: -1.5,
    eqBands: [-1, -0.8, -0.2, 0.7, 1.6, 2.4, 2, 1.1, 0.2, -0.6].map((gain, index) => ({
      ...defaultEqBands[index],
      gain,
      q: index >= 4 && index <= 6 ? 1.3 : 1
    }))
  },
  {
    id: 'night',
    name: 'Night',
    eqMode: 'graphic',
    eqPreamp: -2,
    eqBands: [-2.5, -2, -1.1, -0.4, 0, 0.3, 0.2, -0.2, -0.8, -1.4].map((gain, index) => ({
      ...defaultEqBands[index],
      gain
    }))
  }
]

const tabs: { key: EqualizerTab; label: string; icon: string; desc: string }[] = [
  { key: 'graphic', label: '图形均衡器', icon: 'pi pi-chart-bar', desc: '曲线、Master 与 10 波段塑形' },
  { key: 'parametric', label: '参数均衡器', icon: 'pi pi-sliders-h', desc: '频率、滤波器、增益与 Q 值' },
  { key: 'square', label: '配置广场', icon: 'pi pi-compass', desc: '预设分享入口' }
]

const { audioProcessing, setAudioProcessing } = usePlayerStore()

const activeTab = ref<EqualizerTab>('graphic')
const appSettings = ref<AppSettings | null>(null)
const presetName = ref('')
const saving = ref(false)
const presetMenuOpen = ref(false)
const selectedBandIndex = ref(0)

const userPresets = computed(() => appSettings.value?.audioEqPresets ?? [])
const activeTabMeta = computed(() => tabs.find((tab) => tab.key === activeTab.value) ?? tabs[0])
const selectedBand = computed(() => audioProcessing.value.eqBands[selectedBandIndex.value] ?? audioProcessing.value.eqBands[0])
const selectedFilter = computed(
  () => filterTypes.find((filter) => filter.value === selectedBand.value?.filterType) ?? filterTypes[0]
)

const responsePath = computed(() =>
  responsePoints.value.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
)
const responseFillPath = computed(() => {
  if (responsePoints.value.length === 0) return ''
  const first = responsePoints.value[0]
  const last = responsePoints.value[responsePoints.value.length - 1]
  const zero = gainToY(0)
  return `${responsePath.value} L${last.x.toFixed(2)},${zero.toFixed(2)} L${first.x.toFixed(2)},${zero.toFixed(2)} Z`
})

const responsePoints = computed(() => {
  const points: { x: number; y: number }[] = []
  const steps = 144
  for (let index = 0; index <= steps; index++) {
    const ratio = index / steps
    const frequency = frequencyFromRatio(ratio)
    const gain = estimateTotalGain(frequency)
    points.push({
      x: frequencyToX(frequency),
      y: gainToY(gain)
    })
  }
  return points
})

function cloneBands(bands: EqualizerBand[]): EqualizerBand[] {
  return bands.map((band) => ({ ...band }))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.min(max, Math.max(min, next))
}

function normalizeFilterType(value: unknown): EqualizerFilterType {
  if (
    value === 'lowShelf' ||
    value === 'highShelf' ||
    value === 'bandPass' ||
    value === 'lowPass' ||
    value === 'highPass' ||
    value === 'allPass'
  ) {
    return value
  }
  return 'peak'
}

function normalizeAudioProcessing(settings?: Partial<AudioProcessingSettings>): AudioProcessingSettings {
  const rawBands = Array.isArray(settings?.eqBands) ? settings.eqBands : defaultEqBands
  return {
    ...defaultAudioProcessing,
    ...settings,
    eqPreamp: clampNumber(settings?.eqPreamp, -12, 12, 0),
    replayGainPreamp: clampNumber(settings?.replayGainPreamp, -12, 12, 0),
    replayGainFallback: clampNumber(settings?.replayGainFallback, -12, 12, 0),
    crossfadeSeconds: clampNumber(settings?.crossfadeSeconds, 0, 12, 0),
    eqBands: defaultEqBands.map((defaultBand, index) => {
      const band = rawBands[index] ?? defaultBand
      return {
        frequency: clampNumber(band.frequency, 20, 20000, defaultBand.frequency),
        gain: clampNumber(band.gain, -12, 12, 0),
        q: clampNumber(band.q, 0.25, 8, 1),
        filterType: normalizeFilterType(band.filterType)
      }
    })
  }
}

async function loadAppSettings(): Promise<void> {
  try {
    const settings = await window.api.settings.get()
    appSettings.value = {
      ...settings,
      audioProcessing: normalizeAudioProcessing(settings.audioProcessing),
      audioEqPresets: settings.audioEqPresets.map((preset) => ({
        ...preset,
        eqBands: normalizeAudioProcessing({ eqBands: preset.eqBands }).eqBands
      }))
    }
    audioProcessing.value = appSettings.value.audioProcessing
    if (audioProcessing.value.eqMode === 'parametric') {
      activeTab.value = 'parametric'
    }
  } catch (err) {
    console.error('[eq] 读取均衡器设置失败:', err)
  }
}

async function updateAudioProcessing(patch: Partial<AudioProcessingSettings>): Promise<void> {
  const nextSettings = normalizeAudioProcessing({ ...audioProcessing.value, ...patch })
  await setAudioProcessing(nextSettings)
  if (appSettings.value) {
    appSettings.value = {
      ...appSettings.value,
      audioProcessing: nextSettings
    }
  }
}

async function updateEqBand(index: number, patch: Partial<EqualizerBand>): Promise<void> {
  const bands = cloneBands(audioProcessing.value.eqBands)
  if (!bands[index]) return
  bands[index] = {
    ...bands[index],
    ...patch,
    frequency: patch.frequency !== undefined ? clampNumber(patch.frequency, 20, 20000, bands[index].frequency) : bands[index].frequency,
    gain: patch.gain !== undefined ? clampNumber(patch.gain, -12, 12, bands[index].gain) : bands[index].gain,
    q: patch.q !== undefined ? clampNumber(patch.q, 0.25, 8, bands[index].q) : bands[index].q,
    filterType: patch.filterType !== undefined ? normalizeFilterType(patch.filterType) : bands[index].filterType
  }
  await updateAudioProcessing({ eqBands: bands })
}

async function applyEqPreset(preset: AudioEqPreset): Promise<void> {
  activeTab.value = preset.eqMode
  await updateAudioProcessing({
    eqMode: preset.eqMode,
    eqPreamp: preset.eqPreamp,
    eqBands: cloneBands(preset.eqBands)
  })
  presetMenuOpen.value = false
}

async function saveEqPreset(): Promise<void> {
  const name = presetName.value.trim()
  if (!name || !appSettings.value || saving.value) return
  saving.value = true
  try {
    const nextPreset: AudioEqPreset = {
      id: `custom-${Date.now()}`,
      name,
      eqMode: audioProcessing.value.eqMode,
      eqPreamp: audioProcessing.value.eqPreamp,
      eqBands: cloneBands(audioProcessing.value.eqBands)
    }
    appSettings.value = await window.api.settings.update({
      audioEqPresets: [...userPresets.value, nextPreset]
    })
    presetName.value = ''
    presetMenuOpen.value = true
  } catch (err) {
    console.error('[eq] 保存预设失败:', err)
  } finally {
    saving.value = false
  }
}

function switchTab(tab: EqualizerTab): void {
  activeTab.value = tab
  if (tab === 'graphic' || tab === 'parametric') {
    void updateAudioProcessing({ eqMode: tab })
  }
}

function openAdvancedSettings(index = selectedBandIndex.value): void {
  selectedBandIndex.value = Math.min(Math.max(index, 0), audioProcessing.value.eqBands.length - 1)
  activeTab.value = 'parametric'
  void updateAudioProcessing({ eqMode: 'parametric' })
}

async function resetEqualizer(): Promise<void> {
  await updateAudioProcessing({
    eqEnabled: false,
    eqMode: activeTab.value === 'parametric' ? 'parametric' : 'graphic',
    eqPreamp: 0,
    eqBands: cloneBands(defaultEqBands)
  })
}

function togglePresetMenu(): void {
  presetMenuOpen.value = !presetMenuOpen.value
}

function formatFrequency(frequency: number): string {
  if (frequency >= 1000) return `${Number((frequency / 1000).toFixed(frequency % 1000 === 0 ? 0 : 1))}k`
  return `${Math.round(frequency)}`
}

function formatFrequencyLong(frequency: number): string {
  return frequency >= 1000 ? `${formatFrequency(frequency)}Hz` : `${Math.round(frequency)}Hz`
}

function frequencyToX(frequency: number): number {
  const min = Math.log10(graphMinFrequency)
  const max = Math.log10(graphMaxFrequency)
  const ratio = (Math.log10(clampNumber(frequency, graphMinFrequency, graphMaxFrequency, graphMinFrequency)) - min) / (max - min)
  return chartPad.left + ratio * (chartWidth - chartPad.left - chartPad.right)
}

function frequencyFromRatio(ratio: number): number {
  const min = Math.log10(graphMinFrequency)
  const max = Math.log10(graphMaxFrequency)
  return 10 ** (min + ratio * (max - min))
}

function gainToY(gain: number): number {
  const ratio = (clampNumber(gain, graphMinGain, graphMaxGain, 0) - graphMinGain) / (graphMaxGain - graphMinGain)
  return chartHeight - chartPad.bottom - ratio * (chartHeight - chartPad.top - chartPad.bottom)
}

function estimateBandGainAtFrequency(band: EqualizerBand, frequency: number): number {
  const ratio = Math.log2(frequency / band.frequency)
  const width = Math.max(0.18, 1.35 / band.q)

  switch (band.filterType) {
    case 'lowShelf':
      return band.gain / (1 + Math.exp(ratio * 5))
    case 'highShelf':
      return band.gain / (1 + Math.exp(-ratio * 5))
    case 'bandPass':
      return 5.5 * Math.exp(-(ratio * ratio) / (2 * width * width))
    case 'lowPass':
      return -16 / (1 + Math.exp(-ratio * 7))
    case 'highPass':
      return -16 / (1 + Math.exp(ratio * 7))
    case 'allPass':
      return 0
    case 'peak':
    default:
      return band.gain * Math.exp(-(ratio * ratio) / (2 * width * width))
  }
}

function estimateTotalGain(frequency: number): number {
  const bandGain = audioProcessing.value.eqBands.reduce((sum, band) => sum + estimateBandGainAtFrequency(band, frequency), 0)
  return clampNumber(audioProcessing.value.eqPreamp + bandGain, graphMinGain, graphMaxGain, 0)
}

function isGainDisabled(band: EqualizerBand | undefined): boolean {
  if (!band) return true
  return !filterTypes.find((filter) => filter.value === band.filterType)?.usesGain
}

onMounted(() => {
  void loadAppSettings()
})
</script>

<template>
  <div class="eq-page">
    <aside class="eq-sidebar">
      <nav class="eq-nav">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="eq-nav-item"
          :class="{ active: activeTab === tab.key }"
          @click="switchTab(tab.key)"
        >
          <span>
            <span class="eq-nav-label">{{ tab.label }}</span>
            <span class="eq-nav-desc">{{ tab.desc }}</span>
          </span>
        </button>
      </nav>
    </aside>

    <main class="eq-content">
      <header class="eq-header">
        <div class="eq-heading">
          <div>
            <h1>{{ activeTabMeta.label }}</h1>
            <p>{{ activeTabMeta.desc }}</p>
          </div>
        </div>

        <button
          v-if="activeTab !== 'square'"
          class="eq-enable"
          :class="{ active: audioProcessing.eqEnabled }"
          type="button"
          @click="updateAudioProcessing({ eqEnabled: !audioProcessing.eqEnabled })"
        >
          <span>{{ audioProcessing.eqEnabled ? '已启用' : '已关闭' }}</span>
          <span class="eq-switch"><span></span></span>
        </button>
      </header>

      <section v-if="activeTab === 'graphic'" class="eq-workbench">
        <div class="eq-toolbar">
          <div class="preset-menu-anchor">
            <button type="button" class="eq-command preset-menu-button" @click="togglePresetMenu">
              选择预设
              <i class="pi pi-chevron-down"></i>
            </button>
            <div v-if="presetMenuOpen" class="preset-menu">
              <div class="preset-menu-section">
                <span class="preset-menu-title">内置预设</span>
                <button
                  v-for="preset in builtInEqPresets"
                  :key="preset.id"
                  type="button"
                  class="preset-menu-item"
                  @click="applyEqPreset(preset)"
                >
                  {{ preset.name }}
                </button>
              </div>
              <div class="preset-menu-section">
                <span class="preset-menu-title">自定义预设</span>
                <button
                  v-for="preset in userPresets"
                  :key="preset.id"
                  type="button"
                  class="preset-menu-item"
                  @click="applyEqPreset(preset)"
                >
                  {{ preset.name }}
                </button>
                <span v-if="userPresets.length === 0" class="preset-empty">暂无自定义预设</span>
              </div>
              <div class="preset-create">
                <input v-model="presetName" type="text" placeholder="新建预设名称" />
                <button type="button" :disabled="saving || !presetName.trim()" @click="saveEqPreset">
                  新建
                </button>
              </div>
            </div>
          </div>
          <button type="button" class="eq-command" @click="openAdvancedSettings()">高级设置</button>
          <button type="button" class="eq-command soft" @click="resetEqualizer">重置</button>
        </div>

        <div class="response-card">
          <svg class="response-chart" :viewBox="`0 0 ${chartWidth} ${chartHeight}`" role="img" aria-label="均衡器响应曲线">
            <defs>
              <linearGradient id="eqStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#7c4dff" />
                <stop offset="52%" stop-color="#22d3ee" />
                <stop offset="100%" stop-color="#ff7eb6" />
              </linearGradient>
              <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#7c4dff" stop-opacity="0.22" />
                <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <g class="chart-grid">
              <line
                v-for="gain in gainTicks"
                :key="'gain-' + gain"
                :x1="chartPad.left"
                :x2="chartWidth - chartPad.right"
                :y1="gainToY(gain)"
                :y2="gainToY(gain)"
                :class="{ zero: gain === 0 }"
              />
              <line
                v-for="frequency in frequencyTicks"
                :key="'freq-' + frequency"
                :x1="frequencyToX(frequency)"
                :x2="frequencyToX(frequency)"
                :y1="chartPad.top"
                :y2="chartHeight - chartPad.bottom"
              />
            </g>
            <g class="chart-labels">
              <text
                v-for="gain in gainTicks"
                :key="'gain-label-' + gain"
                :x="chartPad.left - 14"
                :y="gainToY(gain) + 4"
                text-anchor="end"
              >
                {{ gain > 0 ? `+${gain}` : gain }}
              </text>
              <text
                v-for="frequency in frequencyTicks"
                :key="'freq-label-' + frequency"
                :x="frequencyToX(frequency)"
                :y="chartHeight - 10"
                text-anchor="middle"
              >
                {{ formatFrequency(frequency) }}
              </text>
            </g>
            <path class="response-fill" :d="responseFillPath" />
            <path class="response-line" :d="responsePath" />
          </svg>
        </div>


        <div class="graphic-board">
          <div class="graphic-band master-band">
            <span class="band-gain">{{ audioProcessing.eqPreamp.toFixed(1) }}</span>
            <input
              type="range"
              min="-12"
              max="12"
              step="0.5"
              :value="audioProcessing.eqPreamp"
              @input="
                updateAudioProcessing({
                  eqPreamp: Number(($event.target as HTMLInputElement).value)
                })
              "
            />
            <span class="band-frequency">MASTER</span>
          </div>
          <div
            v-for="(band, index) in audioProcessing.eqBands"
            :key="index + '-' + band.frequency"
            class="graphic-band"
            :class="{ selected: selectedBandIndex === index }"
            @click="selectedBandIndex = index"
            @dblclick="openAdvancedSettings(index)"
          >
            <span class="band-gain">{{ band.gain.toFixed(1) }}</span>
            <input
              type="range"
              min="-12"
              max="12"
              step="0.5"
              :disabled="isGainDisabled(band)"
              :value="band.gain"
              @input="
                updateEqBand(index, {
                  gain: Number(($event.target as HTMLInputElement).value)
                })
              "
            />
            <span class="band-frequency">{{ formatFrequency(band.frequency) }}</span>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'parametric'" class="eq-workbench parametric-workbench">
        <div class="eq-toolbar">
          <div class="preset-menu-anchor">
            <button type="button" class="eq-command preset-menu-button" @click="togglePresetMenu">
              选择预设
              <i class="pi pi-chevron-down"></i>
            </button>
            <div v-if="presetMenuOpen" class="preset-menu">
              <div class="preset-menu-section">
                <span class="preset-menu-title">内置预设</span>
                <button
                  v-for="preset in builtInEqPresets"
                  :key="preset.id"
                  type="button"
                  class="preset-menu-item"
                  @click="applyEqPreset(preset)"
                >
                  {{ preset.name }}
                </button>
              </div>
              <div class="preset-menu-section">
                <span class="preset-menu-title">自定义预设</span>
                <button
                  v-for="preset in userPresets"
                  :key="preset.id"
                  type="button"
                  class="preset-menu-item"
                  @click="applyEqPreset(preset)"
                >
                  {{ preset.name }}
                </button>
                <span v-if="userPresets.length === 0" class="preset-empty">暂无自定义预设</span>
              </div>
              <div class="preset-create">
                <input v-model="presetName" type="text" placeholder="新建预设名称" />
                <button type="button" :disabled="saving || !presetName.trim()" @click="saveEqPreset">
                  新建
                </button>
              </div>
            </div>
          </div>
          <button type="button" class="eq-command" @click="activeTab = 'graphic'">返回图形</button>
          <button type="button" class="eq-command soft" @click="resetEqualizer">重置</button>
        </div>

        <div class="response-card compact">
          <svg class="response-chart" :viewBox="`0 0 ${chartWidth} ${chartHeight}`" role="img" aria-label="参数均衡器响应曲线">
            <defs>
              <linearGradient id="eqStrokeParametric" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#7c4dff" />
                <stop offset="52%" stop-color="#22d3ee" />
                <stop offset="100%" stop-color="#ff7eb6" />
              </linearGradient>
              <linearGradient id="eqFillParametric" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#7c4dff" stop-opacity="0.22" />
                <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <g class="chart-grid">
              <line
                v-for="gain in gainTicks"
                :key="'p-gain-' + gain"
                :x1="chartPad.left"
                :x2="chartWidth - chartPad.right"
                :y1="gainToY(gain)"
                :y2="gainToY(gain)"
                :class="{ zero: gain === 0 }"
              />
              <line
                v-for="frequency in frequencyTicks"
                :key="'p-freq-' + frequency"
                :x1="frequencyToX(frequency)"
                :x2="frequencyToX(frequency)"
                :y1="chartPad.top"
                :y2="chartHeight - chartPad.bottom"
              />
              <line
                v-if="selectedBand"
                class="selected-frequency"
                :x1="frequencyToX(selectedBand.frequency)"
                :x2="frequencyToX(selectedBand.frequency)"
                :y1="chartPad.top"
                :y2="chartHeight - chartPad.bottom"
              />
            </g>
            <g class="chart-labels">
              <text
                v-for="gain in gainTicks"
                :key="'p-gain-label-' + gain"
                :x="chartPad.left - 14"
                :y="gainToY(gain) + 4"
                text-anchor="end"
              >
                {{ gain > 0 ? `+${gain}` : gain }}
              </text>
              <text
                v-for="frequency in frequencyTicks"
                :key="'p-freq-label-' + frequency"
                :x="frequencyToX(frequency)"
                :y="chartHeight - 10"
                text-anchor="middle"
              >
                {{ formatFrequency(frequency) }}
              </text>
            </g>
            <path class="response-fill parametric-fill" :d="responseFillPath" />
            <path class="response-line parametric-line" :d="responsePath" />
          </svg>
        </div>

        <div class="band-selector frequency-tabs">
          <button
            v-for="(band, index) in audioProcessing.eqBands"
            :key="'select-' + index"
            type="button"
            :class="{ active: selectedBandIndex === index }"
            @click="selectedBandIndex = index"
          >
            {{ formatFrequency(band.frequency) }}
          </button>
        </div>


        <div v-if="selectedBand" class="parameter-editor">
          <div class="editor-title">
            <span>{{ formatFrequencyLong(selectedBand.frequency) }}</span>
            <strong>{{ selectedFilter.label }}</strong>
          </div>
          <label class="editor-row">
            <span>FREQ(Hz)[20~20k]</span>
            <input
              type="number"
              min="20"
              max="20000"
              step="1"
              :value="Math.round(selectedBand.frequency)"
              @change="
                updateEqBand(selectedBandIndex, {
                  frequency: Number(($event.target as HTMLInputElement).value)
                })
              "
            />
          </label>
          <label class="editor-row">
            <span>滤波器类型</span>
            <select
              :value="selectedBand.filterType"
              @change="
                updateEqBand(selectedBandIndex, {
                  filterType: ($event.target as HTMLSelectElement).value as EqualizerFilterType
                })
              "
            >
              <option v-for="filter in filterTypes" :key="filter.value" :value="filter.value">
                {{ filter.label }}
              </option>
            </select>
          </label>
          <label class="editor-row range-row" :class="{ disabled: isGainDisabled(selectedBand) }">
            <span>GAIN(dB)[-12.0~12.0]</span>
            <strong>{{ selectedBand.gain.toFixed(1) }}</strong>
            <input
              type="range"
              min="-12"
              max="12"
              step="0.5"
              :disabled="isGainDisabled(selectedBand)"
              :value="selectedBand.gain"
              @input="
                updateEqBand(selectedBandIndex, {
                  gain: Number(($event.target as HTMLInputElement).value)
                })
              "
            />
          </label>
          <label class="editor-row range-row">
            <span>Q[0.25~8.00]</span>
            <strong>{{ selectedBand.q.toFixed(2) }}</strong>
            <input
              type="range"
              min="0.25"
              max="8"
              step="0.05"
              :value="selectedBand.q"
              @input="
                updateEqBand(selectedBandIndex, {
                  q: Number(($event.target as HTMLInputElement).value)
                })
              "
            />
          </label>
        </div>
      </section>

      <section v-else class="eq-square">
        <div class="square-panel">
          <span class="square-icon"><i class="pi pi-compass"></i></span>
          <h2>配置广场</h2>
          <p>这里会用于展示、导入和分享均衡器配置。当前先保留页面结构，后续可以接入在线预设源。</p>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.eq-page {
  position: fixed;
  inset: 48px 0 0;
  z-index: 1300;
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  gap: 0;
  padding: 0;
  background: #f7f8fb;
  overflow: hidden;
}

.eq-sidebar,
.eq-content {
  position: relative;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: #fff;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.eq-sidebar::before,
.eq-content::before {
  display: none;
}

.eq-sidebar {
  display: flex;
  align-items: center;
  padding: 16px 12px;
  border-right: 1px solid #e8ebf2;
}

.eq-content {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #f7f8fb;
  overflow: visible;
}

.eq-nav,
.eq-header,
.eq-workbench,
.eq-square {
  position: relative;
  z-index: 1;
}

.eq-nav-icon,
.eq-heading-icon,
.square-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  color: var(--te-primary-500);
  background: #f3f0ff;
}

.eq-title,
.eq-subtitle,
.eq-nav-label,
.eq-nav-desc {
  display: block;
}

.eq-title {
  font-size: 16px;
  line-height: 1.1;
  font-weight: 900;
  color: var(--te-neutral-900);
}

.eq-subtitle {
  margin-top: 2px;
  font-size: 10px;
  font-weight: 750;
  color: rgba(80, 88, 116, 0.58);
}

.eq-nav {
  display: grid;
  width: 100%;
  height: auto;
  align-content: center;
  gap: 6px;
}

.eq-nav-item {
  position: relative;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: rgba(52, 61, 87, 0.72);
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  transition:
    transform 0.22s var(--te-ease-soft),
    border-color 0.22s,
    box-shadow 0.22s;
}

.eq-nav-item::before {
  display: none;
}

.eq-nav-item:hover,
.eq-nav-item.active {
  transform: none;
  background: #f7f5ff;
  border-color: #e8e2ff;
  box-shadow: none;
}

.eq-nav-item.active::after {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  bottom: 9px;
  width: 3px;
  border-radius: 999px;
  background: #7c4dff;
}

.eq-nav-icon {
  position: relative;
  z-index: 1;
  width: 34px;
  height: 34px;
}

.eq-nav-item > span:last-child {
  position: relative;
  z-index: 1;
}

.eq-nav-label {
  font-size: 12px;
  font-weight: 900;
  color: var(--te-neutral-900);
}

.eq-nav-desc {
  display: none;
}

.eq-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 28px 14px;
  border-bottom: 1px solid #edf0f6;
  background: #fff;
}

.eq-heading {
  display: flex;
  align-items: center;
  gap: 0;
}

.eq-heading-icon {
  width: 44px;
  height: 44px;
  font-size: 18px;
  box-shadow: 0 14px 30px rgba(86, 70, 160, 0.1);
}

.eq-header h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.1;
  font-weight: 900;
  color: var(--te-neutral-900);
}

.eq-header p {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.62);
}

.eq-enable,
.eq-command,
.preset-chip,
.preset-create button,
.save-row button {
  border: 1px solid #e5e8f0;
  border-radius: 8px;
  background: #fff;
  color: rgba(52, 61, 87, 0.86);
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(34, 42, 68, 0.05);
  transition:
    transform 0.2s var(--te-ease-soft),
    background 0.2s,
    box-shadow 0.2s;
}

.eq-enable {
  height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-radius: 10px;
}

.eq-command,
.preset-chip,
.preset-create button,
.save-row button {
  height: 32px;
  padding: 0 12px;
}

.eq-command.soft {
  background:
    linear-gradient(135deg, rgba(170, 120, 110, 0.16), rgba(124, 77, 255, 0.08)),
    rgba(255, 255, 255, 0.5);
}

.eq-command:hover,
.preset-chip:hover,
.preset-create button:hover:not(:disabled),
.save-row button:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #f7f5ff;
  box-shadow: 0 10px 22px rgba(34, 42, 68, 0.08);
}

.eq-switch {
  position: relative;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: rgba(210, 216, 230, 0.72);
  box-shadow: inset 0 1px 2px rgba(80, 88, 116, 0.16);
}

.eq-switch span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 4px 10px rgba(32, 38, 62, 0.18);
  transition: transform 0.22s var(--te-ease-soft);
}

.eq-enable.active .eq-switch {
  background: linear-gradient(135deg, var(--te-primary-500), var(--te-accent-cyan));
}

.eq-enable.active .eq-switch span {
  transform: translateX(16px);
}

.eq-workbench,
.eq-square {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: visible;
  padding: 18px 28px 28px;
}

.eq-toolbar,
.band-selector {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.eq-toolbar {
  justify-content: flex-start;
  margin-bottom: 12px;
  overflow: visible;
  position: relative;
  z-index: 20;
}

.preset-menu-anchor {
  position: relative;
  z-index: 30;
}

.preset-menu-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.preset-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: 260px;
  max-height: min(420px, calc(100vh - 170px));
  overflow-y: auto;
  padding: 10px;
  border: 1px solid #e8ebf2;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 22px 54px rgba(34, 42, 68, 0.16);
}

.preset-menu-section {
  display: grid;
  gap: 6px;
  padding-bottom: 10px;
}

.preset-menu-section + .preset-menu-section {
  padding-top: 10px;
  border-top: 1px solid #edf0f6;
}

.preset-menu-title,
.preset-empty {
  font-size: 11px;
  font-weight: 800;
  color: rgba(80, 88, 116, 0.56);
}

.preset-menu-item {
  width: 100%;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--te-neutral-900);
  font-size: 12px;
  font-weight: 800;
  text-align: left;
  cursor: pointer;
}

.preset-menu-item:hover {
  background: #f7f5ff;
}

.preset-create {
  display: flex;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid #edf0f6;
}

.preset-create input {
  min-width: 0;
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #e8ebf2;
  border-radius: 8px;
  background: #fff;
  color: rgba(52, 61, 87, 0.86);
  font-size: 12px;
  font-weight: 760;
  outline: none;
}

.response-card,
.graphic-board,
.parameter-editor,
.square-panel {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid #e8ebf2;
  background: #fff;
  box-shadow: 0 12px 28px rgba(34, 42, 68, 0.06);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.response-card {
  min-height: 230px;
  padding: 12px;
}

.response-card.compact {
  min-height: 240px;
}

.response-chart {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 250px;
}

.response-card.compact .response-chart {
  min-height: 210px;
}

.chart-grid line {
  stroke: rgba(80, 88, 116, 0.18);
  stroke-width: 1;
}

.chart-grid line.zero {
  stroke: rgba(124, 77, 255, 0.32);
  stroke-width: 1.4;
}

.chart-grid .selected-frequency {
  stroke: rgba(124, 77, 255, 0.48);
  stroke-width: 1.8;
}

.chart-labels text {
  fill: rgba(80, 88, 116, 0.58);
  font-size: 12px;
  font-weight: 800;
}

.response-fill {
  fill: url(#eqFill);
}

.response-line {
  fill: none;
  stroke: url(#eqStroke);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 10px 18px rgba(124, 77, 255, 0.16));
}

.parametric-fill {
  fill: url(#eqFillParametric);
}

.parametric-line {
  stroke: url(#eqStrokeParametric);
}

.editor-row input,
.editor-row select {
  height: 34px;
  min-width: 220px;
  padding: 0 10px;
  border: 1px solid #e8ebf2;
  border-radius: 8px;
  background: #fff;
  color: rgba(52, 61, 87, 0.86);
  font-size: 12px;
  font-weight: 760;
  outline: none;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.56);
}

.graphic-board {
  display: grid;
  grid-template-columns: repeat(11, minmax(48px, 1fr));
  gap: 8px;
  min-height: 278px;
  padding: 18px 14px 14px;
}

.graphic-band {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  border-radius: 8px;
  padding: 8px 2px;
  cursor: pointer;
  transition:
    background 0.2s,
    transform 0.2s var(--te-ease-soft);
}

.graphic-band:hover,
.graphic-band.selected {
  background: #f3f0ff;
  transform: translateY(-1px);
}

.graphic-band input {
  width: 150px;
  height: 28px;
  margin: 58px -52px;
  transform: rotate(-90deg);
  accent-color: var(--te-primary-500);
}

.graphic-band input:disabled {
  opacity: 0.42;
}

.band-gain,
.band-frequency {
  font-size: 11px;
  font-weight: 850;
  color: rgba(80, 88, 116, 0.64);
}

.master-band .band-frequency {
  color: var(--te-primary-500);
}

.band-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0;
  padding: 7px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #e8ebf2;
}

.frequency-tabs {
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(124, 77, 255, 0.26) transparent;
}

.band-selector button {
  height: 32px;
  min-width: 72px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(80, 88, 116, 0.72);
  font-weight: 850;
  cursor: pointer;
}

.band-selector button.active {
  background: #f3f0ff;
  color: var(--te-primary-500);
}

.parameter-editor {
  max-width: 760px;
  padding: 16px;
}

.editor-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.editor-title span {
  font-size: 24px;
  font-weight: 900;
  color: var(--te-neutral-900);
}

.editor-title strong {
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.5);
  color: rgba(80, 88, 116, 0.74);
  font-size: 12px;
}

.editor-row {
  min-height: 52px;
  display: grid;
  grid-template-columns: 190px minmax(180px, 1fr);
  align-items: center;
  gap: 14px;
  padding: 10px 0;
  border-top: 1px solid #edf0f6;
}

.editor-row span {
  color: rgba(80, 88, 116, 0.66);
  font-size: 13px;
  font-weight: 850;
}

.editor-row strong {
  color: rgba(52, 61, 87, 0.88);
  font-size: 13px;
  font-weight: 900;
}

.range-row {
  grid-template-columns: 190px 54px minmax(180px, 1fr);
}

.range-row input[type='range'] {
  width: 100%;
  min-width: 0;
  accent-color: var(--te-primary-500);
}

.range-row.disabled {
  opacity: 0.56;
}

.square-panel {
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 34px;
}

.square-icon {
  width: 54px;
  height: 54px;
  font-size: 22px;
  box-shadow: 0 16px 34px rgba(86, 70, 160, 0.1);
}

.square-panel h2 {
  margin: 16px 0 8px;
  font-size: 24px;
  font-weight: 900;
  color: var(--te-neutral-900);
}

.square-panel p {
  max-width: 460px;
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.64);
}

@media (max-width: 980px) {
  .eq-page {
    grid-template-columns: 1fr;
    padding: 12px;
  }

  .eq-sidebar {
    max-height: 220px;
  }

  .eq-nav {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .eq-header,
  .save-row,
  .editor-row,
  .range-row {
    align-items: flex-start;
    grid-template-columns: 1fr;
  }

  .graphic-board {
    grid-template-columns: repeat(4, minmax(52px, 1fr));
    row-gap: 18px;
  }
}

</style>
