<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'

const emit = defineEmits<{
  back: []
}>()

const {
  exclusiveMode,
  audioOutput,
  audioOutputOptions,
  audioProcessing: playerAudioProcessing,
  toggleExclusiveMode,
  setAudioOutput
} = usePlayerStore()

const selectedAudioOutput = computed(() =>
  audioOutputOptions.value.find((option) => option.id === audioOutput.value)
)
const exclusiveAvailable = computed(() => selectedAudioOutput.value?.supportsExclusive ?? false)

type EqMode = 'graphic' | 'parametric'
type VolumeNormalizationMode = 'off' | 'track' | 'album' | 'loudnorm'
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
  volumeNormalization: VolumeNormalizationMode
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

const defaultEqBands: EqualizerBand[] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(
  (frequency) => ({
    frequency,
    gain: 0,
    q: 1,
    filterType: 'peak'
  })
)

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

const defaultSettings: AppSettings = {
  autoLaunch: false,
  hardwareAcceleration: true,
  globalShortcuts: false,
  musicCachePath: '',
  closeToTray: false,
  audioProcessing: defaultAudioProcessing,
  audioEqPresets: []
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

const tabs = [
  { key: 'general', label: '通用', icon: 'pi pi-sparkles', description: '启动行为与常用偏好' },
  { key: 'system', label: '系统', icon: 'pi pi-desktop', description: '窗口、缓存与系统集成' },
  { key: 'audio', label: '音频', icon: 'pi pi-sliders-h', description: '输出、Hi-Res 与 DSP' },
  { key: 'personalization', label: '个性化', icon: 'pi pi-palette', description: '界面质感与主题表现' },
  { key: 'shortcuts', label: '快捷键', icon: 'pi pi-bolt', description: '快速控制播放' },
  { key: 'about', label: '关于', icon: 'pi pi-info-circle', description: '版本与应用信息' }
] as const

type TabKey = (typeof tabs)[number]['key']

const props = defineProps<{
  initialSection?: TabKey
}>()

const appSettings = ref<AppSettings>({ ...defaultSettings })
const settingsLoading = ref(false)
const activeTab = ref<TabKey>(props.initialSection ?? 'general')
const presetName = ref('')
const settingsBodyRef = ref<HTMLElement | null>(null)
const generalSection = ref<HTMLElement | null>(null)
const systemSection = ref<HTMLElement | null>(null)
const audioSection = ref<HTMLElement | null>(null)
const personalizationSection = ref<HTMLElement | null>(null)
const shortcutsSection = ref<HTMLElement | null>(null)
const aboutSection = ref<HTMLElement | null>(null)

const activeTabMeta = computed(() => tabs.find((tab) => tab.key === activeTab.value) ?? tabs[0])
const cachePathLabel = computed(() => appSettings.value.musicCachePath || '使用系统默认缓存位置')
const audioProcessing = computed(() => appSettings.value.audioProcessing)
const eqPresets = computed(() => [...builtInEqPresets, ...appSettings.value.audioEqPresets])
const audioFormatTags = ['FLAC', 'WAV', 'ALAC', 'DSD', 'MQA', 'AIFF', 'APE', 'WavPack']

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
        frequency: clampNumber(band.frequency, 20, 24000, defaultBand.frequency),
        gain: clampNumber(band.gain, -12, 12, 0),
        q: clampNumber(band.q, 0.25, 8, 1),
        filterType: normalizeFilterType(band.filterType)
      }
    })
  }
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ...defaultSettings,
    ...settings,
    audioProcessing: normalizeAudioProcessing(settings.audioProcessing),
    audioEqPresets: Array.isArray(settings.audioEqPresets) ? settings.audioEqPresets : []
  }
}

async function loadAppSettings(): Promise<void> {
  settingsLoading.value = true
  try {
    appSettings.value = normalizeSettings(await window.api.settings.get())
    playerAudioProcessing.value = appSettings.value.audioProcessing
  } catch (err) {
    console.error('[settings] 读取设置失败:', err)
  } finally {
    settingsLoading.value = false
  }
}

async function updateAppSetting(patch: Partial<AppSettings>): Promise<void> {
  try {
    appSettings.value = normalizeSettings(await window.api.settings.update(patch))
    playerAudioProcessing.value = appSettings.value.audioProcessing
  } catch (err) {
    console.error('[settings] 保存设置失败:', err)
  }
}

async function toggleAppSetting(
  key: keyof Pick<AppSettings, 'autoLaunch' | 'hardwareAcceleration' | 'globalShortcuts' | 'closeToTray'>
): Promise<void> {
  await updateAppSetting({ [key]: !appSettings.value[key] })
}

async function selectMusicCachePath(): Promise<void> {
  const selected = await window.api.settings.selectMusicCachePath()
  if (selected) {
    await updateAppSetting({ musicCachePath: selected })
  }
}

async function resetMusicCachePath(): Promise<void> {
  await updateAppSetting({ musicCachePath: '' })
}

async function updateAudioProcessing(patch: Partial<AudioProcessingSettings>): Promise<void> {
  await updateAppSetting({
    audioProcessing: normalizeAudioProcessing({ ...audioProcessing.value, ...patch })
  })
}

async function toggleAudioProcessing(
  key: keyof Pick<
    AudioProcessingSettings,
    'highResolution' | 'dsdToPcm' | 'eqEnabled' | 'replayGainClip' | 'gapless'
  >
): Promise<void> {
  await updateAudioProcessing({ [key]: !audioProcessing.value[key] })
}

async function updateEqBand(index: number, patch: Partial<EqualizerBand>): Promise<void> {
  const bands = cloneBands(audioProcessing.value.eqBands)
  bands[index] = { ...bands[index], ...patch }
  await updateAudioProcessing({ eqBands: bands })
}

async function applyEqPreset(preset: AudioEqPreset): Promise<void> {
  await updateAudioProcessing({
    eqMode: preset.eqMode,
    eqPreamp: preset.eqPreamp,
    eqBands: cloneBands(preset.eqBands)
  })
}

async function saveEqPreset(): Promise<void> {
  const name = presetName.value.trim()
  if (!name) return
  const nextPreset: AudioEqPreset = {
    id: `custom-${Date.now()}`,
    name,
    eqMode: audioProcessing.value.eqMode,
    eqPreamp: audioProcessing.value.eqPreamp,
    eqBands: cloneBands(audioProcessing.value.eqBands)
  }
  presetName.value = ''
  await updateAppSetting({
    audioEqPresets: [...appSettings.value.audioEqPresets, nextPreset]
  })
}

function getSectionElement(key: TabKey): HTMLElement | null {
  const sections: Record<TabKey, typeof generalSection> = {
    general: generalSection,
    system: systemSection,
    audio: audioSection,
    personalization: personalizationSection,
    shortcuts: shortcutsSection,
    about: aboutSection
  }
  return sections[key].value
}

function scrollToSection(key: TabKey): void {
  activeTab.value = key
  void nextTick(() => {
    const body = settingsBodyRef.value
    const section = getSectionElement(key)
    if (!body || !section) return
    body.scrollTo({
      top: Math.max(0, section.offsetTop - 18),
      behavior: 'smooth'
    })
  })
}

function syncActiveSection(): void {
  const body = settingsBodyRef.value
  if (!body) return
  const currentTop = body.scrollTop + 140
  let nextTab: TabKey = tabs[0].key
  for (const tab of tabs) {
    const section = getSectionElement(tab.key)
    if (section && section.offsetTop <= currentTop) {
      nextTab = tab.key
    }
  }
  activeTab.value = nextTab
}

onMounted(() => {
  void loadAppSettings()
  if (props.initialSection) {
    void nextTick(() => scrollToSection(props.initialSection ?? 'general'))
  }
})

watch(
  () => props.initialSection,
  (section) => {
    if (section) scrollToSection(section)
  }
)
</script>

<template>
  <div class="settings-page">
    <button type="button" class="settings-back-button" aria-label="返回" @click="emit('back')">
      <i class="pi pi-chevron-left"></i>
    </button>

    <div class="settings-shell">
      <aside class="settings-sidebar" aria-label="设置分类">
        <nav class="settings-nav">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="nav-option"
            :class="{ active: activeTab === tab.key }"
            @click="scrollToSection(tab.key)"
          >
            <span class="nav-copy">
              <span class="nav-label">{{ tab.label }}</span>
              <span class="nav-desc">{{ tab.description }}</span>
            </span>
          </button>
        </nav>
      </aside>

      <main class="settings-content">
        <header class="content-header">
          <div class="content-title-row">
            <div>
              <h1>{{ activeTabMeta.label }}</h1>
              <p>{{ activeTabMeta.description }}</p>
            </div>
          </div>
        </header>

        <div ref="settingsBodyRef" class="settings-body" @scroll.passive="syncActiveSection">
          <section ref="generalSection" class="tab-section" data-section="general">
            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">开机自动启动</span>
                <p class="setting-item-desc">登录系统后自动启动 Twilight Echo。</p>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: appSettings.autoLaunch }"
                role="switch"
                :aria-checked="appSettings.autoLaunch"
                :disabled="settingsLoading"
                @click="toggleAppSetting('autoLaunch')"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">关闭到托盘</span>
                <p class="setting-item-desc">点击关闭按钮时隐藏到系统托盘，播放器继续运行。</p>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: appSettings.closeToTray }"
                role="switch"
                :aria-checked="appSettings.closeToTray"
                :disabled="settingsLoading"
                @click="toggleAppSetting('closeToTray')"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>
          </section>

          <section ref="systemSection" class="tab-section" data-section="system">
            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">GPU 硬件加速</span>
                <p class="setting-item-desc">启用 Chromium GPU 加速以提升界面渲染表现，修改后重启生效。</p>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: appSettings.hardwareAcceleration }"
                role="switch"
                :aria-checked="appSettings.hardwareAcceleration"
                :disabled="settingsLoading"
                @click="toggleAppSetting('hardwareAcceleration')"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-item cache-setting-item">
              <div class="setting-main">
                <span class="setting-item-label">音乐缓存位置</span>
                <p class="setting-item-desc">用于保存渲染缓存与 mpv 播放缓存，修改后重启应用完整生效。</p>
              </div>
              <div class="setting-actions">
                <span class="cache-path" :title="cachePathLabel">{{ cachePathLabel }}</span>
                <button type="button" class="setting-action-btn" @click="selectMusicCachePath">选择</button>
                <button
                  v-if="appSettings.musicCachePath"
                  type="button"
                  class="setting-action-btn subtle"
                  @click="resetMusicCachePath"
                >
                  默认
                </button>
              </div>
            </div>
          </section>

          <section ref="audioSection" class="tab-section audio-section" data-section="audio">
            <div class="audio-hero">
              <div>
                <span class="audio-kicker">MPV Hi-Fi Engine</span>
                <h2>高分辨率音频链路</h2>
                <p>FLAC / WAV / ALAC / DSD / MQA 等格式交给 mpv 解码，DSD 可转 PCM 输出，DSP 在解码后进入输出后端。</p>
              </div>
              <div class="format-cloud">
                <span v-for="format in audioFormatTags" :key="format">{{ format }}</span>
              </div>
            </div>

            <div class="audio-grid">
              <div class="setting-item output-setting-item audio-card wide-card">
                <div class="setting-main">
                  <span class="setting-item-label">音频输出</span>
                  <p class="setting-item-desc">根据当前系统提供 WASAPI / ASIO / CoreAudio / ALSA 选项。</p>
                </div>
                <div class="audio-output-options">
                  <button
                    v-for="option in audioOutputOptions"
                    :key="option.id"
                    type="button"
                    class="audio-output-option"
                    :class="{ active: audioOutput === option.id }"
                    @click="setAudioOutput(option.id)"
                  >
                    <span class="audio-output-label">{{ option.label }}</span>
                    <span class="audio-output-desc">{{ option.description }}</span>
                  </button>
                </div>
              </div>

              <div class="setting-item audio-card">
                <div class="setting-main">
                  <span class="setting-item-label">独占模式</span>
                  <p class="setting-item-desc">支持时绕过系统混音器，直通音频设备。</p>
                </div>
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

              <div class="setting-item audio-card">
                <div class="setting-main">
                  <span class="setting-item-label">Hi-Res 输出</span>
                  <p class="setting-item-desc">保持高采样率源文件，按设备能力输出高精度 PCM。</p>
                </div>
                <button
                  class="toggle-switch"
                  :class="{ active: audioProcessing.highResolution }"
                  role="switch"
                  :aria-checked="audioProcessing.highResolution"
                  @click="toggleAudioProcessing('highResolution')"
                >
                  <span class="toggle-knob"></span>
                </button>
              </div>

              <div class="setting-item audio-card">
                <div class="setting-main">
                  <span class="setting-item-label">DSD 转 PCM</span>
                  <p class="setting-item-desc">DSF / DFF 文件通过 mpv/FFmpeg 转成 PCM 输出。</p>
                </div>
                <button
                  class="toggle-switch"
                  :class="{ active: audioProcessing.dsdToPcm }"
                  role="switch"
                  :aria-checked="audioProcessing.dsdToPcm"
                  @click="toggleAudioProcessing('dsdToPcm')"
                >
                  <span class="toggle-knob"></span>
                </button>
              </div>

              <div class="setting-item audio-card">
                <div class="setting-main">
                  <span class="setting-item-label">音量标准化</span>
                  <p class="setting-item-desc">ReplayGain 或 loudnorm 降低曲目之间的响度差异。</p>
                </div>
                <select
                  class="glass-select"
                  :value="audioProcessing.volumeNormalization"
                  @change="
                    updateAudioProcessing({
                      volumeNormalization: ($event.target as HTMLSelectElement).value as VolumeNormalizationMode
                    })
                  "
                >
                  <option value="off">关闭</option>
                  <option value="track">ReplayGain Track</option>
                  <option value="album">ReplayGain Album</option>
                  <option value="loudnorm">Loudnorm DSP</option>
                </select>
              </div>

              <div class="setting-item audio-card">
                <div class="setting-main">
                  <span class="setting-item-label">Gapless 播放</span>
                  <p class="setting-item-desc">连续专辑无缝衔接，适合 Live 与概念专辑。</p>
                </div>
                <button
                  class="toggle-switch"
                  :class="{ active: audioProcessing.gapless }"
                  role="switch"
                  :aria-checked="audioProcessing.gapless"
                  @click="toggleAudioProcessing('gapless')"
                >
                  <span class="toggle-knob"></span>
                </button>
              </div>

              <div class="setting-item audio-card range-card">
                <div class="setting-main">
                  <span class="setting-item-label">Crossfade</span>
                  <p class="setting-item-desc">当前曲目结束前自动切换，时间为 {{ audioProcessing.crossfadeSeconds.toFixed(1) }}s。</p>
                </div>
                <input
                  class="glass-range"
                  type="range"
                  min="0"
                  max="12"
                  step="0.5"
                  :value="audioProcessing.crossfadeSeconds"
                  @input="
                    updateAudioProcessing({
                      crossfadeSeconds: Number(($event.target as HTMLInputElement).value)
                    })
                  "
                />
              </div>
            </div>

            <div class="eq-panel">
              <div class="eq-header">
                <div>
                  <span class="setting-item-label">均衡器</span>
                  <p class="setting-item-desc">10 波段 Graphic EQ，也可调整 Q 值作为 Parametric EQ 使用。</p>
                </div>
                <div class="eq-actions">
                  <button
                    class="toggle-switch"
                    :class="{ active: audioProcessing.eqEnabled }"
                    role="switch"
                    :aria-checked="audioProcessing.eqEnabled"
                    @click="toggleAudioProcessing('eqEnabled')"
                  >
                    <span class="toggle-knob"></span>
                  </button>
                </div>
              </div>

              <div class="preset-row">
                <button
                  v-for="preset in eqPresets"
                  :key="preset.id"
                  type="button"
                  class="preset-chip"
                  @click="applyEqPreset(preset)"
                >
                  {{ preset.name }}
                </button>
              </div>

              <div class="eq-mode-row">
                <div class="segmented">
                  <button
                    type="button"
                    :class="{ active: audioProcessing.eqMode === 'graphic' }"
                    @click="updateAudioProcessing({ eqMode: 'graphic' })"
                  >
                    10 Band
                  </button>
                  <button
                    type="button"
                    :class="{ active: audioProcessing.eqMode === 'parametric' }"
                    @click="updateAudioProcessing({ eqMode: 'parametric' })"
                  >
                    Parametric
                  </button>
                </div>
                <label class="preamp-control">
                  <span>Preamp {{ audioProcessing.eqPreamp.toFixed(1) }} dB</span>
                  <input
                    class="glass-range"
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
                </label>
              </div>

              <div class="eq-bands">
                <div v-for="(band, index) in audioProcessing.eqBands" :key="band.frequency" class="eq-band">
                  <span class="eq-gain">{{ band.gain.toFixed(1) }}</span>
                  <input
                    class="vertical-range"
                    type="range"
                    min="-12"
                    max="12"
                    step="0.5"
                    :value="band.gain"
                    @input="
                      updateEqBand(index, {
                        gain: Number(($event.target as HTMLInputElement).value)
                      })
                    "
                  />
                  <span class="eq-frequency">{{ band.frequency >= 1000 ? `${band.frequency / 1000}k` : band.frequency }}</span>
                  <input
                    v-if="audioProcessing.eqMode === 'parametric'"
                    class="q-input"
                    type="number"
                    min="0.25"
                    max="8"
                    step="0.1"
                    :value="band.q"
                    @change="
                      updateEqBand(index, {
                        q: Number(($event.target as HTMLInputElement).value)
                      })
                    "
                  />
                </div>
              </div>

              <div class="preset-save">
                <input v-model="presetName" class="glass-input" type="text" placeholder="自定义预设名称" />
                <button type="button" class="setting-action-btn" @click="saveEqPreset">保存预设</button>
              </div>
            </div>
          </section>

          <section ref="personalizationSection" class="tab-section" data-section="personalization">
            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">毛玻璃效果</span>
                <p class="setting-item-desc">播放页和设置页使用统一的毛玻璃层级。</p>
              </div>
              <button class="toggle-switch active" role="switch" aria-checked="true">
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">主题色</span>
                <p class="setting-item-desc">界面主题色提取自当前播放歌曲的封面。</p>
              </div>
              <span class="setting-item-value">跟随封面</span>
            </div>
          </section>

          <section ref="shortcutsSection" class="tab-section" data-section="shortcuts">
            <div class="setting-item">
              <div class="setting-main">
                <span class="setting-item-label">全局快捷键</span>
                <p class="setting-item-desc">应用在后台或托盘运行时，也可以切换歌曲与控制播放。</p>
              </div>
              <button
                class="toggle-switch"
                :class="{ active: appSettings.globalShortcuts }"
                role="switch"
                :aria-checked="appSettings.globalShortcuts"
                :disabled="settingsLoading"
                @click="toggleAppSetting('globalShortcuts')"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>

            <div class="shortcut-list">
              <div class="shortcut-item">
                <span class="shortcut-label">播放 / 暂停</span>
                <span class="shortcut-keys"><kbd>Ctrl</kbd><span>+</span><kbd>Alt</kbd><span>+</span><kbd>Space</kbd></span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-label">上一首</span>
                <span class="shortcut-keys"><kbd>Ctrl</kbd><span>+</span><kbd>Alt</kbd><span>+</span><kbd>←</kbd></span>
              </div>
              <div class="shortcut-item">
                <span class="shortcut-label">下一首</span>
                <span class="shortcut-keys"><kbd>Ctrl</kbd><span>+</span><kbd>Alt</kbd><span>+</span><kbd>→</kbd></span>
              </div>
            </div>
          </section>

          <section ref="aboutSection" class="tab-section" data-section="about">
            <div class="about-info">
              <div class="about-item">
                <span class="about-label">应用名称</span>
                <span class="about-value">Twilight Echo</span>
              </div>
              <div class="about-item">
                <span class="about-label">版本</span>
                <span class="about-value">v0.20.0</span>
              </div>
              <div class="about-item">
                <span class="about-label">技术栈</span>
                <span class="about-value">Electron + Vue 3 + MPV</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  position: fixed;
  inset: 48px 0 0;
  z-index: 1200;
  overflow: hidden;
  padding: 0;
  background: #f7f8fb;
}

.settings-back-button {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 40;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(52, 61, 87, 0.86);
  font-size: 18px;
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s;
}

.settings-back-button:hover {
  background: #f7f5ff;
  color: var(--te-primary-500);
}

.settings-shell {
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  gap: 0;
}

.settings-sidebar,
.settings-content {
  position: relative;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: #fff;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.settings-sidebar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 16px 12px;
  align-self: stretch;
  border-right: 1px solid #e8ebf2;
}

.settings-content {
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #f7f8fb;
}

.settings-sidebar::before,
.settings-content::before {
  display: none;
}

.settings-nav,
.content-header,
.settings-body {
  position: relative;
  z-index: 1;
}

.settings-title-block,
.nav-copy,
.setting-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.settings-title {
  font-size: 16px;
  font-weight: 850;
  color: var(--te-neutral-900);
  line-height: 1.1;
}

.settings-subtitle {
  margin-top: 2px;
  font-size: 10px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.58);
}

.settings-nav {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: auto;
  justify-content: center;
  align-items: stretch;
  gap: 6px;
}

.nav-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: rgba(52, 61, 87, 0.72);
  cursor: pointer;
  text-align: left;
  justify-content: flex-start;
  overflow: hidden;
  transition:
    transform 0.22s var(--te-ease-soft),
    border-color 0.22s,
    box-shadow 0.22s,
    color 0.22s;
}

.nav-option::before {
  display: none;
}

.nav-option:hover,
.nav-option.active {
  color: var(--te-neutral-900);
  transform: none;
  background: #f7f5ff;
  border-color: #e8e2ff;
  box-shadow: none;
}

.nav-option.active::after {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  bottom: 9px;
  width: 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--te-primary-500), var(--te-accent-cyan));
}

.nav-icon,
.content-icon {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  color: var(--te-primary-500);
  background:
    radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.14), rgba(34, 211, 238, 0.1));
}

.nav-icon {
  width: 32px;
  height: 32px;
}

.nav-copy {
  position: relative;
  z-index: 1;
  gap: 2px;
  width: 100%;
  text-align: left;
}

.nav-label {
  font-size: 12px;
  font-weight: 850;
}

.nav-desc {
  display: none;
}

.content-header {
  padding: 18px 28px 14px;
  border-bottom: 1px solid #edf0f6;
  background: #fff;
}

.content-title-row {
  display: flex;
  align-items: center;
  gap: 0;
}

.content-icon {
  width: 44px;
  height: 44px;
  font-size: 18px;
  box-shadow: 0 14px 30px rgba(86, 70, 160, 0.1);
}

.content-header h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.1;
  font-weight: 900;
  color: var(--te-neutral-900);
  letter-spacing: 0;
}

.content-header p {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.62);
}

.settings-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scroll-behavior: smooth;
  padding: 18px 28px 28px;
}

.tab-section {
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 28px;
  margin-bottom: 18px;
  scroll-margin-top: 18px;
  border-bottom: 1px solid #edf0f6;
}

.audio-section {
  max-width: 820px;
}

.tab-section:last-child {
  border-bottom: 0;
  margin-bottom: 0;
  padding-bottom: 0;
}

.setting-item,
.shortcut-item,
.about-item,
.audio-hero,
.eq-panel {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid #e8ebf2;
  background: #fff;
  box-shadow: 0 12px 28px rgba(34, 42, 68, 0.06);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.setting-item {
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 14px;
  transition:
    transform 0.22s var(--te-ease-soft),
    border-color 0.22s,
    box-shadow 0.22s;
}

.setting-item:hover,
.shortcut-item:hover,
.about-item:hover,
.audio-hero:hover,
.eq-panel:hover {
  transform: translateY(-1px);
  border-color: #dde2ee;
  box-shadow: 0 16px 32px rgba(34, 42, 68, 0.08);
}

.setting-main {
  gap: 5px;
}

.setting-item-label,
.shortcut-label,
.about-label {
  font-size: 13px;
  font-weight: 850;
  color: var(--te-neutral-900);
}

.setting-item-desc {
  margin: 3px 0 0;
  max-width: 560px;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(80, 88, 116, 0.62);
}

.setting-item-value,
.about-value {
  flex-shrink: 0;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.48);
  color: rgba(80, 88, 116, 0.78);
  font-size: 12px;
  font-weight: 800;
}

.toggle-switch {
  position: relative;
  flex-shrink: 0;
  width: 46px;
  height: 26px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 999px;
  background:
    linear-gradient(145deg, rgba(221, 225, 235, 0.92), rgba(255, 255, 255, 0.52)),
    rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 0;
  box-shadow:
    inset 0 1px 2px rgba(80, 88, 116, 0.12),
    0 10px 24px rgba(86, 70, 160, 0.08);
}

.toggle-switch:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.toggle-switch.active {
  background: linear-gradient(135deg, var(--te-primary-500), var(--te-accent-cyan));
  box-shadow:
    0 12px 28px rgba(124, 77, 255, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 4px 10px rgba(32, 38, 62, 0.18);
  transition: transform 0.22s var(--te-ease-soft);
}

.toggle-switch.active .toggle-knob {
  transform: translateX(20px);
}

.cache-setting-item {
  align-items: flex-start;
}

.setting-actions {
  min-width: 260px;
  max-width: 380px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.cache-path,
.glass-input,
.glass-select,
.q-input {
  border: 1px solid rgba(255, 255, 255, 0.66);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.42);
  color: rgba(52, 61, 87, 0.86);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.56);
  outline: none;
}

.cache-path {
  min-width: 0;
  flex: 1;
  padding: 7px 10px;
  color: rgba(80, 88, 116, 0.68);
  font-size: 12px;
  font-weight: 760;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.setting-action-btn,
.preset-chip,
.segmented button {
  flex-shrink: 0;
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(124, 77, 255, 0.14), rgba(34, 211, 238, 0.1)),
    rgba(255, 255, 255, 0.54);
  color: rgba(52, 61, 87, 0.86);
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
  box-shadow: 0 10px 22px rgba(86, 70, 160, 0.08);
  transition:
    transform 0.2s var(--te-ease-soft),
    background 0.2s,
    box-shadow 0.2s;
}

.setting-action-btn:hover,
.preset-chip:hover,
.segmented button:hover,
.segmented button.active {
  transform: translateY(-1px);
  background:
    linear-gradient(135deg, rgba(124, 77, 255, 0.2), rgba(34, 211, 238, 0.14)),
    rgba(255, 255, 255, 0.72);
  box-shadow: 0 14px 28px rgba(86, 70, 160, 0.12);
}

.setting-action-btn.subtle {
  background: rgba(255, 255, 255, 0.42);
  color: rgba(80, 88, 116, 0.64);
}

.audio-hero {
  min-height: 126px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 270px;
  gap: 16px;
  padding: 18px;
}

.audio-kicker {
  font-size: 11px;
  font-weight: 850;
  color: var(--te-primary-500);
}

.audio-hero h2 {
  margin: 8px 0 8px;
  font-size: 22px;
  line-height: 1.12;
  font-weight: 900;
  color: var(--te-neutral-900);
}

.audio-hero p {
  max-width: 520px;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(80, 88, 116, 0.66);
}

.format-cloud {
  display: flex;
  flex-wrap: wrap;
  align-content: center;
  gap: 8px;
}

.format-cloud span {
  padding: 8px 10px;
  border-radius: 8px;
  background:
    radial-gradient(circle at 30% 18%, rgba(255, 255, 255, 0.92), transparent 38%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.14), rgba(34, 211, 238, 0.08));
  color: rgba(52, 61, 87, 0.78);
  font-size: 12px;
  font-weight: 900;
  box-shadow: 0 12px 26px rgba(86, 70, 160, 0.08);
}

.audio-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.audio-card {
  min-height: 74px;
}

.wide-card,
.range-card {
  grid-column: 1 / -1;
}

.output-setting-item {
  align-items: stretch;
  flex-direction: column;
}

.audio-output-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.audio-output-option {
  position: relative;
  min-height: 58px;
  padding: 10px;
  border: 1px solid #e8ebf2;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  transition:
    transform 0.22s var(--te-ease-soft),
    border-color 0.22s,
    box-shadow 0.22s,
    background 0.22s;
}

.audio-output-option:hover,
.audio-output-option.active {
  transform: translateY(-1px);
  border-color: rgba(255, 255, 255, 0.84);
  box-shadow: 0 16px 36px rgba(86, 70, 160, 0.1);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.66), rgba(255, 255, 255, 0.28)),
    rgba(255, 255, 255, 0.2);
}

.audio-output-option.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 12px;
  bottom: 12px;
  width: 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--te-primary-500), var(--te-accent-cyan));
}

.audio-output-label,
.audio-output-desc {
  display: block;
}

.audio-output-label {
  font-size: 13px;
  font-weight: 900;
  color: var(--te-neutral-900);
}

.audio-output-desc {
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.45;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.6);
}

.glass-select {
  min-width: 188px;
  height: 34px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 800;
}

.glass-range {
  width: min(320px, 100%);
  accent-color: var(--te-primary-500);
}

.eq-panel {
  padding: 18px;
}

.eq-header,
.eq-mode-row,
.preset-save {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.eq-mode-row {
  margin-top: 16px;
}

.segmented {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.36);
  border: 1px solid rgba(255, 255, 255, 0.62);
}

.segmented button {
  height: 28px;
  box-shadow: none;
}

.preamp-control {
  display: flex;
  align-items: center;
  gap: 10px;
  color: rgba(80, 88, 116, 0.68);
  font-size: 12px;
  font-weight: 850;
}

.eq-bands {
  display: grid;
  grid-template-columns: repeat(10, minmax(42px, 1fr));
  gap: 8px;
  min-height: 236px;
  margin-top: 18px;
}

.eq-band {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.eq-gain,
.eq-frequency {
  font-size: 11px;
  font-weight: 850;
  color: rgba(80, 88, 116, 0.64);
}

.vertical-range {
  width: 148px;
  height: 26px;
  margin: 58px -55px;
  transform: rotate(-90deg);
  accent-color: var(--te-primary-500);
}

.q-input {
  width: 46px;
  height: 26px;
  padding: 0 4px;
  text-align: center;
  font-size: 11px;
  font-weight: 800;
}

.preset-save {
  justify-content: flex-start;
  margin-top: 18px;
}

.glass-input {
  height: 34px;
  min-width: 210px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 760;
}

.shortcut-list,
.about-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.shortcut-item,
.about-item {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  transition:
    transform 0.22s var(--te-ease-soft),
    border-color 0.22s,
    box-shadow 0.22s;
}

.shortcut-keys {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  color: rgba(80, 88, 116, 0.56);
  font-size: 12px;
  font-weight: 800;
}

.shortcut-item kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 24px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.36)),
    rgba(255, 255, 255, 0.46);
  color: rgba(52, 61, 87, 0.82);
  font-family: inherit;
  font-size: 12px;
  font-weight: 850;
  box-shadow: 0 8px 18px rgba(86, 70, 160, 0.08);
}

.about-value {
  max-width: 56%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes settings-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.992);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 980px) {
  .settings-page {
    padding: 12px;
  }

  .settings-shell {
    grid-template-columns: 1fr;
    height: calc(100vh - 24px);
  }

  .settings-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .nav-desc {
    max-width: 100%;
  }

  .content-header,
  .settings-body {
    padding-left: 18px;
    padding-right: 18px;
  }

  .setting-item,
  .eq-header,
  .eq-mode-row,
  .preset-save {
    align-items: flex-start;
    flex-direction: column;
  }

  .setting-actions {
    width: 100%;
    min-width: 0;
    max-width: none;
  }

  .audio-hero {
    grid-template-columns: 1fr;
  }

  .audio-grid {
    grid-template-columns: 1fr;
  }

  .eq-bands {
    grid-template-columns: repeat(5, minmax(42px, 1fr));
    row-gap: 18px;
  }
}

</style>
