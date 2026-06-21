<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useExtensionRegistry } from '../extensions/registry'
import { getPluginThemeKey } from '../extensions/themeSelection'
import type {
  AppSettings,
  AppTheme,
  AudioDeviceOption,
  AudioOutputId,
  AudioProcessingSettings,
  ChannelRoutingMode,
  DesktopLyricsSettings,
  DsdOutputMode,
  LyricAlign,
  NowPlayingBackground,
  OutputConfig,
  PlaybackResumeMode,
  SacdProgramMode,
  UiDensity,
  VolumeNormalizationMode
} from '../types/settings'

type SectionKey =
  | 'general'
  | 'playback'
  | 'dsp'
  | 'cache'
  | 'performance'
  | 'appearance'
  | 'desktopLyrics'
  | 'shortcuts'
  | 'about'

type BooleanSettingKey =
  | 'autoCheckLogin'
  | 'launchAtLogin'
  | 'hardwareAcceleration'
  | 'blurEffect'
  | 'useCoverTheme'
  | 'globalShortcuts'
  | 'watchLibrary'
  | 'smtcEnabled'
  | 'discordRpcEnabled'

const props = defineProps<{
  initialSection?: SectionKey
}>()

const emit = defineEmits<{
  back: []
  openEqualizer: []
}>()

const sections: { key: SectionKey; label: string; icon: string }[] = [
  { key: 'general', label: '常规', icon: 'pi pi-sliders-h' },
  { key: 'playback', label: '播放', icon: 'pi pi-volume-up' },
  { key: 'dsp', label: 'DSP', icon: 'pi pi-sliders-v' },
  { key: 'cache', label: '缓存', icon: 'pi pi-database' },
  { key: 'performance', label: '性能', icon: 'pi pi-bolt' },
  { key: 'appearance', label: '外观', icon: 'pi pi-palette' },
  { key: 'desktopLyrics', label: '桌面歌词', icon: 'pi pi-window-maximize' },
  { key: 'shortcuts', label: '快捷键', icon: 'pi pi-keyboard' },
  { key: 'about', label: '关于', icon: 'pi pi-info-circle' }
]

const colorModeOptions: { value: AppTheme; label: string; icon: string }[] = [
  { value: 'system', label: '系统', icon: 'pi pi-desktop' },
  { value: 'pureWhite', label: '浅色', icon: 'pi pi-sun' },
  { value: 'dark', label: '深色', icon: 'pi pi-moon' }
]

const playbackResumeOptions: { value: PlaybackResumeMode; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'track', label: '记住曲目' },
  { value: 'trackAndPosition', label: '曲目和位置' }
]

const bufferSizeOptions = [
  { value: 0, label: 'Auto' },
  { value: 64, label: '64' },
  { value: 128, label: '128' },
  { value: 256, label: '256' },
  { value: 512, label: '512' },
  { value: 1024, label: '1024' },
  { value: 2048, label: '2048' }
] as const

const routingModeOptions: { value: ChannelRoutingMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'stereo', label: 'Stereo' },
  { value: 'stereo-to-5.1', label: 'Stereo → 5.1' },
  { value: 'stereo-to-7.1', label: 'Stereo → 7.1' },
  { value: 'mono-to-stereo', label: 'Mono → Stereo' },
  { value: 'mono-to-multichannel', label: 'Mono → Multichannel' }
]

const replayGainOptions: { value: VolumeNormalizationMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'track', label: 'Track' },
  { value: 'album', label: 'Album' },
  { value: 'loudnorm', label: 'Loudnorm' }
]

const dsdOutputModeOptions: { value: DsdOutputMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'pcm', label: 'PCM' },
  { value: 'dop', label: 'DoP' },
  { value: 'native', label: 'Native' }
]

const sacdProgramModeOptions: { value: SacdProgramMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'stereo', label: 'Stereo' },
  { value: 'multichannel', label: 'Multichannel' }
]

const fftResolutionOptions = [64, 128, 256, 512, 1024, 2048] as const

const accentColorOptions: { value: string; label: string; class: string }[] = [
  { value: 'violet', label: '紫罗兰', class: 'violet' },
  { value: 'blue', label: '蓝', class: 'blue' },
  { value: 'emerald', label: '翠绿', class: 'emerald' },
  { value: 'rose', label: '玫瑰', class: 'rose' },
  { value: 'amber', label: '琥珀', class: 'amber' },
  { value: 'slate', label: '石板', class: 'slate' }
]

const fontFamilyOptions: { value: string; label: string }[] = [
  { value: 'system', label: '系统默认 (System)' },
  { value: 'inter', label: 'Inter / Roboto' },
  { value: 'lxgw', label: '霞鹜文楷 (LXGW)' },
  { value: 'sarasa', label: 'Sarasa Gothic' },
  { value: 'comic', label: 'Comic Sans MS' }
]

const uiDensityOptions: { value: UiDensity; label: string }[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'comfortable', label: '舒展' }
]

const nowPlayingBackgroundOptions: { value: NowPlayingBackground; label: string; class: string }[] = [
  { value: 'blur', label: '专辑高斯模糊', class: 'blur-cover' },
  { value: 'fluid', label: '动态流体渐变', class: 'fluid-cover' },
  { value: 'solid', label: '纯粹极简纯色', class: 'solid-cover' }
]

const lyricAlignOptions: { value: LyricAlign; label: string }[] = [
  { value: 'center', label: '居中对齐' },
  { value: 'left', label: '靠左对齐' }
]

const GITHUB_URL = 'https://github.com/nousresearch/twilight-echo'
const RELEASES_URL = 'https://github.com/nousresearch/twilight-echo/releases'
const HOMEPAGE_URL = 'https://twilightecho.com'

const updateCheckState = ref<'idle' | 'checking' | 'up-to-date' | 'available' | 'error'>('idle')
const latestVersion = ref('')
const lastUpdateCheck = ref('')
const runningPluginSettingsCommand = ref('')
const pluginSettingsResult = ref<Record<string, string>>({})
const pluginSettingsError = ref<Record<string, string>>({})

const activeSection = ref<SectionKey>(props.initialSection ?? 'general')
const pageRef = ref<HTMLElement | null>(null)

const {
  settings,
  paths,
  appVersion,
  clearingCache,
  formattedCacheSize,
  restartRequired,
  restartReasons,
  loadSettings,
  updateSettings,
  chooseCacheFolder,
  resetCacheFolder,
  refreshCacheSize,
  clearCache,
  relaunch,
  addLibraryFolder,
  removeLibraryFolder,
  openExternalUrl
} = useSettingsStore()

const {
  exclusiveMode,
  audioOutput,
  audioDevice,
  audioOutputOptions,
  audioDeviceOptions,
  audioProcessing,
  audioOutputConfig,
  playbackInfo,
  outputInfo,
  audioEngineError,
  volume,
  toggleExclusiveMode,
  setAudioOutput,
  setAudioDevice,
  setAudioOutputConfig,
  setAudioProcessing,
  setReplayGainMode,
  setCrossfeedStrength,
  selectImpulseResponse,
  clearImpulseResponse,
  refreshAudioOutputState,
  setVolume,
  toggleGapless
} = usePlayerStore()

const { syncExtensions, themeContributions, uiContributions } = useExtensionRegistry()


const volumePercent = computed({
  get: () => Math.round(volume.value * 100),
  set: (value: number) => {
    setVolume(value / 100)
  }
})

const activeCachePath = computed(
  () => paths.value?.activeCachePath ?? settings.value.cachePath ?? ''
)
const pluginThemeOptions = computed(() =>
  themeContributions.value.map((theme) => ({
    value: getPluginThemeKey(theme),
    label: `${theme.name} (${theme.pluginId})`
  }))
)
const pluginSettingsPanels = computed(() =>
  uiContributions.value.filter((contribution) => contribution.kind === 'settingsPanel')
)
const selectedAudioOutput = computed(() =>
  audioOutputOptions.value.find((option) => option.id === audioOutput.value)
)
const exclusiveAvailable = computed(() => selectedAudioOutput.value?.supportsExclusive ?? false)
const isUpmixActive = computed(
  () =>
    audioOutputConfig.value.routingMode === 'stereo-to-5.1' ||
    audioOutputConfig.value.routingMode === 'stereo-to-7.1'
)
const showWasapiPushMode = computed(() => audioOutput.value === 'wasapi' && exclusiveMode.value)

// 高级引擎参数折叠状态
const advancedParamsOpen = ref(false)

// DSP 信号链状态
const eqChainActive = computed(() => audioProcessing.value.dspEnabled && audioProcessing.value.eqEnabled)
const crossfeedChainActive = computed(() => audioProcessing.value.dspEnabled && audioProcessing.value.crossfeedEnabled)
const convolverChainActive = computed(() => audioProcessing.value.dspEnabled && audioProcessing.value.convolverEnabled)

// 输出诊断信息
const outputChainText = computed(() => {
  const info = playbackInfo.value
  if (!info) return '等待音频引擎'
  const codec = info.codec || 'Source'
  const depth = info.sourceBitDepth > 0 ? `${info.sourceBitDepth}bit` : ''
  const rate = info.sourceSampleRate > 0 ? compactRate(info.sourceSampleRate) : ''
  const src = [codec, depth, rate].filter(Boolean).join(' ')
  const out = outputInfo.value
  const backend = out?.actualBackend || info.actualBackend || audioOutput.value
  const actualDepth = (out?.actualBitDepth || info.actualBitDepth || 0) > 0 ? `${out?.actualBitDepth || info.actualBitDepth}bit` : ''
  const actualRate = (out?.actualSampleRate || info.actualSampleRate || 0) > 0 ? compactRate(out?.actualSampleRate || info.actualSampleRate) : ''
  return `${src} -> ${backend.toUpperCase()} ${actualDepth} ${actualRate}`.trim()
})

const outputLatencyText = computed(() => {
  const info = outputInfo.value
  if (!info) return ''
  const total = info.latencyInfo?.totalLatencyMs ?? info.latencyMs ?? 0
  return `Latency ${total.toFixed(1)} ms`
})

const outputDiagnosticsText = computed(() => {
  const diagnostics = outputInfo.value?.diagnostics ?? playbackInfo.value?.diagnostics
  if (!diagnostics) return 'Underrun 0 · Drop 0'
  return `Underrun ${diagnostics.sessionUnderrunCount} · Drop ${diagnostics.sessionBufferDropCount}`
})

// Crossfeed 百分比
const crossfeedPercent = computed(() => Math.round(audioProcessing.value.crossfeedStrength * 100))

function compactRate(rate: number): string {
  return rate > 0 ? `${Math.round(rate / 100) / 10}kHz` : ''
}

const dspInputText = computed(() => {
  const info = playbackInfo.value
  if (!info) return '待命'
  const depth = info.sourceBitDepth > 0 ? `${info.sourceBitDepth}bit` : ''
  const rate = info.sourceSampleRate > 0 ? compactRate(info.sourceSampleRate) : ''
  const codec = info.codec || 'PCM'
  return [codec, depth, rate].filter(Boolean).join(' ') || 'PCM'
})

const dspProcessText = computed(() => {
  if (!audioProcessing.value.dspEnabled) return 'Bypass'
  return playbackInfo.value?.dspActive ? '正在处理' : '处理链待命'
})

const dspOutputText = computed(() => {
  const out = outputInfo.value
  if (!out) return audioOutput.value.toUpperCase()
  const backend = out.actualBackend || audioOutput.value
  const mode = out.accessMode ? ` · ${out.accessMode}` : ''
  return `${backend}${mode}`
})

const outputFormatText = computed(() => {
  const info = outputInfo.value
  if (!info) return '等待音频引擎'
  const format = info.actualOutputFormat || playbackInfo.value?.actualOutputFormat || ''
  const rate =
    info.actualSampleRate || info.outputSampleRate || playbackInfo.value?.actualSampleRate || 0
  const bitDepth =
    info.actualBitDepth || info.outputBitDepth || playbackInfo.value?.actualBitDepth || 0
  const channels = info.actualChannels || playbackInfo.value?.actualChannels || 0
  const parts = [
    format,
    rate > 0 ? `${rate} Hz` : '',
    bitDepth > 0 ? `${bitDepth} bit` : '',
    channels > 0 ? `${channels} ch` : ''
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : '未开始播放'
})

const dspModuleCount = computed(() => {
  const p = audioProcessing.value
  let count = 0
  if (p.eqEnabled) count++
  if (p.volumeNormalization !== 'off') count++
  if (p.crossfeedEnabled) count++
  if (p.convolverEnabled) count++
  return count
})

const convolverPathLabel = computed(() => {
  const path = audioProcessing.value.convolverIrPath
  if (!path) return '未加载'
  return path.split(/[\\/]/).pop() || path
})

const replayGainModeLabel = computed(
  () =>
    replayGainOptions.find((option) => option.value === audioProcessing.value.volumeNormalization)
      ?.label ?? 'Off'
)
const eqSummaryText = computed(() =>
  audioProcessing.value.eqEnabled
    ? `${audioProcessing.value.eqMode === 'parametric' ? '参数' : '图形'} · Preamp ${audioProcessing.value.eqPreamp.toFixed(1)} dB`
    : '未启用'
)

function deviceIcon(device: AudioDeviceOption): string {
  const text = `${device.id} ${device.label} ${device.backend || ''}`.toLowerCase()
  if (/speaker|soundbar|monitor|音响|音箱|扬声器|喇叭/.test(text)) return 'pi pi-volume-up'
  if (/usb|dac|asio|hifi|exclusive/.test(text)) return 'pi pi-microchip'
  return 'pi pi-headphones'
}

function deviceSpecText(device: AudioDeviceOption): string {
  const parts = [
    device.backend || audioOutput.value,
    typeof device.channels === 'number' && device.channels > 0 ? `${device.channels}ch` : '',
    device.sampleRates && device.sampleRates.length > 0
      ? compactRate(Math.max(...device.sampleRates))
      : '',
    device.bitDepths && device.bitDepths.length > 0 ? `${Math.max(...device.bitDepths)}bit` : ''
  ].filter(Boolean)
  if (parts.length > 0) return parts.join(' · ')
  if (device.id === 'auto') return '跟随系统默认输出'
  if (device.isDefault) return '系统默认设备'
  return '原生输出设备'
}

function toggleSetting(key: BooleanSettingKey): void {
  void updateSettings({ [key]: !settings.value[key] } as Partial<AppSettings>)
}

async function toggleDesktopLyrics(): Promise<void> {
  const enabled = await window.api.desktopLyrics.toggle()
  await updateSettings({ desktopLyrics: { ...settings.value.desktopLyrics, enabled } })
}

function updateDl<K extends keyof DesktopLyricsSettings>(key: K, value: DesktopLyricsSettings[K]): void {
  if (settings.value.desktopLyrics) {
    settings.value.desktopLyrics[key] = value as any
  }
  const dl = { ...settings.value.desktopLyrics, [key]: value }
  void updateSettings({ desktopLyrics: dl })
}

function setTheme(theme: AppTheme): void {
  if (settings.value.theme === theme) return
  void updateSettings({ theme })
}

function setPlaybackResumeMode(playbackResumeMode: PlaybackResumeMode): void {
  if (settings.value.playbackResumeMode === playbackResumeMode) return
  void updateSettings({ playbackResumeMode })
}

function setPlaybackResumeModeFromSelect(event: Event): void {
  setPlaybackResumeMode((event.target as HTMLSelectElement).value as PlaybackResumeMode)
}

function selectAudioOutput(output: AudioOutputId): void {
  if (audioOutput.value === output) return
  void setAudioOutput(output)
}

function selectAudioDevice(deviceId: string): void {
  if (audioDevice.value === deviceId) return
  void setAudioDevice(deviceId)
}

function setPreferredBufferSize(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value)
  if (audioOutputConfig.value.preferredBufferSize === value) return
  void setAudioOutputConfig({ preferredBufferSize: value })
}

function setRoutingMode(event: Event): void {
  const target = event.target as HTMLSelectElement
  void setAudioOutputConfig({ routingMode: target.value as ChannelRoutingMode })
}

function setUpmixParam(field: keyof OutputConfig, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  void setAudioOutputConfig({ [field]: value } as Partial<OutputConfig>)
}

function toggleWasapiExclusivePushMode(): void {
  void setAudioOutputConfig({
    wasapiExclusivePushMode: !audioOutputConfig.value.wasapiExclusivePushMode
  })
}

function updateAudioProcessing(patch: Partial<AudioProcessingSettings>): void {
  void setAudioProcessing(patch)
}

function setReplayGainFromSelect(event: Event): void {
  void setReplayGainMode((event.target as HTMLSelectElement).value as VolumeNormalizationMode)
}

function setReplayGainPreamp(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  updateAudioProcessing({ dspEnabled: true, replayGainPreamp: value })
}

function setCrossfeedFromInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  void setCrossfeedStrength(value)
}

function setDsdOutputMode(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as DsdOutputMode
  updateAudioProcessing({ dsdOutputMode: value, dsdToPcm: value === 'pcm' })
}

function setSacdProgramMode(event: Event): void {
  updateAudioProcessing({
    sacdProgramMode: (event.target as HTMLSelectElement).value as SacdProgramMode
  })
}

function setFftResolution(event: Event): void {
  updateAudioProcessing({ fftResolution: Number((event.target as HTMLSelectElement).value) })
}

function setVolumeFromInput(event: Event): void {
  volumePercent.value = Number((event.target as HTMLInputElement).value)
}

function setCloseBehavior(event: Event): void {
  void updateSettings({ closeToTray: (event.target as HTMLSelectElement).value === 'tray' })
}

function setAccentColor(color: string): void {
  if (settings.value.accentColor === color) return
  void updateSettings({ accentColor: color })
}

function setFontFamily(event: Event): void {
  void updateSettings({ fontFamily: (event.target as HTMLSelectElement).value })
}

function setPluginTheme(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  void updateSettings({ pluginThemeId: value || null })
}

function setUiDensity(density: UiDensity): void {
  if (settings.value.uiDensity === density) return
  void updateSettings({ uiDensity: density })
}

function setNowPlayingBackground(bg: NowPlayingBackground): void {
  if (settings.value.nowPlayingBackground === bg) return
  void updateSettings({ nowPlayingBackground: bg })
}

function setLyricAlign(event: Event): void {
  void updateSettings({ lyricAlign: (event.target as HTMLSelectElement).value as LyricAlign })
}

function setLyricDimOpacity(event: Event): void {
  void updateSettings({
    lyricDimOpacity: Number((event.target as HTMLInputElement).value)
  })
}

function setLyricFontSize(event: Event): void {
  void updateSettings({
    lyricFontSize: Number((event.target as HTMLInputElement).value)
  })
}

function openGithub(): void {
  void openExternalUrl(GITHUB_URL)
}

function openReleases(): void {
  void openExternalUrl(RELEASES_URL)
}

function openHomepage(): void {
  void openExternalUrl(HOMEPAGE_URL)
}

async function runPluginSettingsPanel(command: string | undefined, panelId: string): Promise<void> {
  if (!command || runningPluginSettingsCommand.value) return
  runningPluginSettingsCommand.value = panelId
  pluginSettingsError.value = { ...pluginSettingsError.value, [panelId]: '' }
  pluginSettingsResult.value = { ...pluginSettingsResult.value, [panelId]: '' }
  try {
    const result = await window.api.extensions.executeCommand(command, [
      {
        source: 'settingsPanel',
        panelId
      }
    ])
    pluginSettingsResult.value = {
      ...pluginSettingsResult.value,
      [panelId]: result == null ? '已执行' : typeof result === 'string' ? result : JSON.stringify(result)
    }
  } catch (err) {
    pluginSettingsError.value = {
      ...pluginSettingsError.value,
      [panelId]: err instanceof Error ? err.message : String(err)
    }
  } finally {
    runningPluginSettingsCommand.value = ''
  }
}

async function checkForUpdates(): Promise<void> {
  updateCheckState.value = 'checking'
  try {
    const result = await window.api.app.checkForUpdates()
    const now = new Date()
    lastUpdateCheck.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    if (result.error) {
      updateCheckState.value = 'error'
    } else if (result.hasUpdate) {
      updateCheckState.value = 'available'
      latestVersion.value = result.latestVersion || ''
    } else {
      updateCheckState.value = 'up-to-date'
    }
  } catch {
    updateCheckState.value = 'error'
  }
}

function toggleClipGuard(): void {
  updateAudioProcessing({ clipGuard: !audioProcessing.value.clipGuard })
}

function toggleGaplessPlayback(): void {
  void toggleGapless()
}

function setCrossfadeSeconds(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  updateAudioProcessing({ crossfadeSeconds: value })
}

function toggleHighResolution(): void {
  updateAudioProcessing({ highResolution: !audioProcessing.value.highResolution })
}

function toggleConvolver(): void {
  updateAudioProcessing({
    dspEnabled: true,
    convolverEnabled: !audioProcessing.value.convolverEnabled
  })
}

function applyDspPreset(preset: 'headphone' | 'dynamic' | 'bypass'): void {
  if (preset === 'bypass') {
    updateAudioProcessing({ dspEnabled: false })
    return
  }
  if (preset === 'headphone') {
    updateAudioProcessing({
      dspEnabled: true,
      crossfeedEnabled: true,
      crossfeedStrength: 0.4,
      eqEnabled: false
    })
    return
  }
  if (preset === 'dynamic') {
    updateAudioProcessing({
      dspEnabled: true,
      eqEnabled: true,
      crossfeedEnabled: false
    })
  }
}

function toggleDspMaster(): void {
  updateAudioProcessing({ dspEnabled: !audioProcessing.value.dspEnabled })
}

function toggleEqFromDsp(): void {
  updateAudioProcessing({
    dspEnabled: true,
    eqEnabled: !audioProcessing.value.eqEnabled
  })
}

function toggleCrossfeedFromDsp(): void {
  updateAudioProcessing({
    dspEnabled: true,
    crossfeedEnabled: !audioProcessing.value.crossfeedEnabled
  })
}

function openEqualizerFromDsp(): void {
  emit('openEqualizer')
}

function scrollToSection(section: SectionKey): void {
  activeSection.value = section
  document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function updateActiveSection(): void {
  const page = pageRef.value
  if (!page) return
  const pageTop = page.getBoundingClientRect().top
  let closest = activeSection.value
  let closestDistance = Number.POSITIVE_INFINITY
  for (const section of sections) {
    const el = document.getElementById(section.key)
    if (!el) continue
    const distance = Math.abs(el.getBoundingClientRect().top - pageTop - 24)
    if (distance < closestDistance) {
      closest = section.key
      closestDistance = distance
    }
  }
  activeSection.value = closest
}

onMounted(async () => {
  await Promise.all([loadSettings(), refreshAudioOutputState()])
  await refreshCacheSize()
  await syncExtensions()
  await nextTick()
  pageRef.value?.addEventListener('scroll', updateActiveSection, { passive: true })
  if (props.initialSection && props.initialSection !== 'general') {
    scrollToSection(props.initialSection)
  }
})

onBeforeUnmount(() => {
  pageRef.value?.removeEventListener('scroll', updateActiveSection)
})
</script>

<template>
  <main ref="pageRef" class="settings-preview-page">
    <div class="settings-preview-layout">
      <nav class="settings-preview-nav" aria-label="设置分区">
        <button
          v-for="section in sections"
          :key="section.key"
          type="button"
          class="preview-nav-item"
          :class="{ active: activeSection === section.key }"
          @click="scrollToSection(section.key)"
        >
          <i :class="section.icon"></i>
          <span>{{ section.label }}</span>
        </button>
      </nav>

      <div class="settings-preview-stack">
        <section id="general" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-sliders-h"></i>
            <h2>常规 (General)</h2>
          </div>

          <div class="section-block">
            <h3>媒体库管理 (Library & Sync)</h3>
            <div class="setting-list">
              <div class="setting-item top-align">
                <div class="setting-copy">
                  <strong>扫描文件夹</strong>
                  <span>添加包含您本地音乐文件的目录。</span>
                </div>
                <div class="folder-list">
                  <div
                    v-for="folder in settings.libraryFolders"
                    :key="folder"
                    class="folder-chip"
                  >
                    <span>{{ folder }}</span>
                    <i class="pi pi-times" @click="removeLibraryFolder(folder)"></i>
                  </div>
                  <div v-if="settings.libraryFolders.length === 0" class="folder-empty-hint">
                    暂未添加任何文件夹
                  </div>
                  <button type="button" class="dashed-button" @click="addLibraryFolder">
                    <i class="pi pi-plus"></i>
                    添加文件夹
                  </button>
                </div>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>实时监控文件夹变动</strong>
                  <span>当添加新音乐时自动同步到媒体库，无需手动刷新。</span>
                </div>
                <span
                  class="toggle-switch"
                  :class="{ active: settings.watchLibrary, inactive: !settings.watchLibrary }"
                  role="switch"
                  :aria-checked="settings.watchLibrary"
                  @click="toggleSetting('watchLibrary')"
                ></span>
              </div>
            </div>
          </div>

          <div class="section-block">
            <h3>集成与社交 (Integration & Social)</h3>
            <div class="setting-list">
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>启动时检查网易云登录</strong>
                  <span>应用启动后自动刷新内置网易云音源的登录状态。</span>
                </div>
                <span
                  class="toggle-switch"
                  :class="{ active: settings.autoCheckLogin, inactive: !settings.autoCheckLogin }"
                  role="switch"
                  :aria-checked="settings.autoCheckLogin"
                  @click="toggleSetting('autoCheckLogin')"
                ></span>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>原生媒体控制 (SMTC)</strong>
                  <span>响应键盘多媒体按键，并在系统锁屏界面显示播放控制。</span>
                </div>
                <span
                  class="toggle-switch"
                  :class="{ active: settings.smtcEnabled, inactive: !settings.smtcEnabled }"
                  role="switch"
                  :aria-checked="settings.smtcEnabled"
                  @click="toggleSetting('smtcEnabled')"
                ></span>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>Discord Rich Presence <i class="pi pi-discord discord-icon"></i></strong>
                  <span>在 Discord 状态中向好友展示您正在播放的音乐。</span>
                </div>
                <span
                  class="toggle-switch"
                  :class="{ active: settings.discordRpcEnabled, inactive: !settings.discordRpcEnabled }"
                  role="switch"
                  :aria-checked="settings.discordRpcEnabled"
                  @click="toggleSetting('discordRpcEnabled')"
                ></span>
              </div>
            </div>
          </div>

          <div class="section-block">
            <h3>启动与窗口 (Startup)</h3>
            <div class="setting-list">
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>开机自动启动</strong>
                  <span>在系统启动时自动在后台运行。</span>
                </div>
                <span
                  class="toggle-switch"
                  :class="{ active: settings.launchAtLogin, inactive: !settings.launchAtLogin }"
                  role="switch"
                  :aria-checked="settings.launchAtLogin"
                  @click="toggleSetting('launchAtLogin')"
                ></span>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>关闭主窗口时</strong>
                  <span>选择点击关闭按钮后的应用行为。</span>
                </div>
                <select
                  class="preview-select"
                  :value="settings.closeToTray ? 'tray' : 'quit'"
                  @change="setCloseBehavior"
                >
                  <option value="tray">最小化到系统托盘</option>
                  <option value="quit">退出应用</option>
                </select>
              </div>
            </div>
          </div>

          <div v-if="pluginSettingsPanels.length > 0" class="section-block">
            <h3>插件设置 (Plugin Settings)</h3>
            <div class="setting-list">
              <template v-for="(panel, index) in pluginSettingsPanels" :key="`${panel.pluginId}:${panel.id}`">
                <hr v-if="index > 0" />
                <div class="setting-item top-align">
                  <div class="setting-copy">
                    <strong>{{ panel.title }}</strong>
                    <span>{{ panel.description || panel.pluginId }}</span>
                    <small v-if="pluginSettingsResult[panel.id]" class="plugin-command-result">
                      {{ pluginSettingsResult[panel.id] }}
                    </small>
                    <small v-if="pluginSettingsError[panel.id]" class="plugin-command-error">
                      {{ pluginSettingsError[panel.id] }}
                    </small>
                  </div>
                  <button
                    type="button"
                    class="soft-button"
                    :disabled="!panel.command || runningPluginSettingsCommand === panel.id"
                    @click="runPluginSettingsPanel(panel.command, panel.id)"
                  >
                    <i v-if="panel.icon" :class="panel.icon"></i>
                    {{ runningPluginSettingsCommand === panel.id ? '执行中…' : '打开设置' }}
                  </button>
                </div>
              </template>
            </div>
          </div>
        </section>

        <section id="playback" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-volume-up"></i>
            <h2>播放 (Playback)</h2>
          </div>

          <div v-if="audioEngineError" class="engine-error">{{ audioEngineError }}</div>

          <div v-if="playbackInfo" class="output-diagnostic-panel">
            <div class="diagnostic-head">
              <span class="diagnostic-label">输出状态诊断</span>
              <span class="diagnostic-status">{{ outputDiagnosticsText }}</span>
            </div>
            <div class="diagnostic-chain">{{ outputChainText }}</div>
            <div class="diagnostic-meta">
              <span v-if="outputLatencyText"><i class="pi pi-clock"></i> {{ outputLatencyText }}</span>
              <span><i class="pi pi-exclamation-triangle"></i> {{ outputDiagnosticsText }}</span>
            </div>
          </div>

          <div class="device-panel">
            <div class="device-panel-head">
              <div>
                <p>Audio Output</p>
                <h3>输出设备与链路</h3>
              </div>
              <button
                type="button"
                class="icon-button"
                title="刷新设备列表"
                @click="refreshAudioOutputState"
              >
                <i class="pi pi-refresh"></i>
              </button>
            </div>
            <div class="device-grid">
              <button
                v-for="device in audioDeviceOptions"
                :key="device.id"
                type="button"
                class="device-card"
                :class="{ active: audioDevice === device.id }"
                @click="selectAudioDevice(device.id)"
              >
                <i :class="deviceIcon(device)"></i>
                <span>{{ device.label }}</span>
                <small>{{ deviceSpecText(device) }}</small>
                <b v-if="audioDevice === device.id">当前</b>
              </button>
            </div>
          </div>

          <div class="section-block">
            <h3>播放引擎 (Engine)</h3>
            <div class="setting-list">
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>输出模式</strong>
                  <span>选择音频后端和系统混音路径。</span>
                </div>
                <div class="segmented-control">
                  <button
                    v-for="option in audioOutputOptions"
                    :key="option.id"
                    type="button"
                    :class="{ active: audioOutput === option.id }"
                    @click="selectAudioOutput(option.id)"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>独占模式 (Exclusive)</strong>
                  <span>尝试绕过系统混音器以获得更直接的输出链路。</span>
                </div>
                <span
                  class="toggle-switch"
                  :class="{ active: exclusiveMode, inactive: !exclusiveMode }"
                  role="switch"
                  :aria-checked="exclusiveMode"
                  :title="exclusiveAvailable ? '' : '当前后端不支持独占模式'"
                  @click="exclusiveAvailable && toggleExclusiveMode()"
                ></span>
              </div>
              <hr />
              <div class="setting-item compact-row">
                <div class="setting-copy">
                  <strong>音量与削波保护</strong>
                  <span>应用音量低于 100% 会改变样本值。</span>
                </div>
                <div class="inline-controls">
                  <input
                    class="number-input"
                    type="number"
                    min="0"
                    max="100"
                    :value="volumePercent"
                    @input="setVolumeFromInput"
                  />
                  <span
                    class="toggle-switch"
                    :class="{ active: audioProcessing.clipGuard, inactive: !audioProcessing.clipGuard }"
                    role="switch"
                    :aria-checked="audioProcessing.clipGuard"
                    @click="toggleClipGuard"
                  ></span>
                </div>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>无缝播放 (Gapless Playback)</strong>
                  <span>消除连续曲目之间的静态间隙或进行交叉淡入淡出。</span>
                </div>
                <div class="inline-controls">
                  <div class="crossfade-group">
                    <span>交叉淡入淡出 (秒)</span>
                    <input
                      class="number-input"
                      type="number"
                      min="0"
                      max="12"
                      step="0.5"
                      :value="audioProcessing.crossfadeSeconds"
                      @input="setCrossfadeSeconds"
                    />
                  </div>
                  <span
                    class="toggle-switch"
                    :class="{ active: audioProcessing.gapless, inactive: !audioProcessing.gapless }"
                    role="switch"
                    :aria-checked="audioProcessing.gapless"
                    @click="toggleGaplessPlayback"
                  ></span>
                </div>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>启动时恢复播放</strong>
                  <span>记住上次播放的曲目和播放位置。</span>
                </div>
                <select
                  class="preview-select"
                  :value="settings.playbackResumeMode"
                  @change="setPlaybackResumeModeFromSelect"
                >
                  <option
                    v-for="option in playbackResumeOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </div>
            </div>
          </div>

          <div class="accordion-preview" :class="{ open: advancedParamsOpen }">
            <button type="button" class="accordion-head" @click="advancedParamsOpen = !advancedParamsOpen">
              <div>
                <strong>高级引擎参数 (Advanced Engine)</strong>
                <span>缓冲、声道路由、DSD 输出和 SACD program。</span>
              </div>
              <i class="pi pi-chevron-down" :class="{ rotated: advancedParamsOpen }"></i>
            </button>
            <div v-if="advancedParamsOpen" class="accordion-body">
              <div class="engine-warning">
                <i class="pi pi-exclamation-triangle"></i>
                <span>警告：以下参数直接与声卡底层交互，调节不当可能导致音频卡顿、无声或爆音。</span>
              </div>
            <div class="advanced-grid">
              <label>
                <span>Buffer Size</span>
                <select
                  class="preview-select"
                  :value="audioOutputConfig.preferredBufferSize"
                  @change="setPreferredBufferSize"
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
              <label>
                <span>Routing</span>
                <select
                  class="preview-select"
                  :value="audioOutputConfig.routingMode"
                  @change="setRoutingMode"
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
              <label>
                <span>DSD Output</span>
                <select
                  class="preview-select"
                  :value="audioProcessing.dsdOutputMode"
                  @change="setDsdOutputMode"
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
            </div>
            <div v-if="isUpmixActive" class="advanced-grid">
              <label>
                <span>Center Gain</span>
                <input
                  class="number-input"
                  type="number"
                  step="0.1"
                  :value="audioOutputConfig.upmixCenterGain ?? 0"
                  @input="(e) => setUpmixParam('upmixCenterGain', e)"
                />
              </label>
              <label>
                <span>LFE Gain</span>
                <input
                  class="number-input"
                  type="number"
                  step="0.1"
                  :value="audioOutputConfig.upmixLfeGain ?? 0"
                  @input="(e) => setUpmixParam('upmixLfeGain', e)"
                />
              </label>
              <label>
                <span>LFE Lowpass (Hz)</span>
                <input
                  class="number-input"
                  type="number"
                  step="1"
                  :value="audioOutputConfig.upmixLfeLowpassHz ?? 80"
                  @input="(e) => setUpmixParam('upmixLfeLowpassHz', e)"
                />
              </label>
              <label>
                <span>Surround Gain</span>
                <input
                  class="number-input"
                  type="number"
                  step="0.1"
                  :value="audioOutputConfig.upmixSurroundGain ?? 0"
                  @input="(e) => setUpmixParam('upmixSurroundGain', e)"
                />
              </label>
              <label>
                <span>Side Gain</span>
                <input
                  class="number-input"
                  type="number"
                  step="0.1"
                  :value="audioOutputConfig.upmixSideGain ?? 0"
                  @input="(e) => setUpmixParam('upmixSideGain', e)"
                />
              </label>
              <label>
                <span>Surround Delay (ms)</span>
                <input
                  class="number-input"
                  type="number"
                  step="0.1"
                  :value="audioOutputConfig.upmixSurroundDelayMs ?? 0"
                  @input="(e) => setUpmixParam('upmixSurroundDelayMs', e)"
                />
              </label>
            </div>
            <div v-if="showWasapiPushMode" class="setting-item wasapi-push-row">
              <div class="setting-copy">
                <strong>WASAPI 独占推送模式</strong>
                <span>事件驱动不兼容时切换到定时器驱动，可解决部分声卡无声/爆音。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: !!audioOutputConfig.wasapiExclusivePushMode, inactive: !audioOutputConfig.wasapiExclusivePushMode }"
                role="switch"
                :aria-checked="!!audioOutputConfig.wasapiExclusivePushMode"
                @click="toggleWasapiExclusivePushMode"
              ></span>
            </div>
            </div>
          </div>
        </section>

        <section id="dsp" class="glass-card preview-section">
          <div class="section-title-row split">
            <div>
              <i class="pi pi-sliders-v"></i>
              <h2>DSP 处理器</h2>
            </div>
            <span
              class="toggle-switch large"
              :class="{ active: audioProcessing.dspEnabled, inactive: !audioProcessing.dspEnabled }"
              role="switch"
              :aria-checked="audioProcessing.dspEnabled"
              @click="toggleDspMaster"
            ></span>
          </div>

          <div class="dsp-signal-chain">
            <div class="signal-node static" :class="{ active: true }">
              <div class="signal-node-circle active">
                <i class="pi pi-file-audio"></i>
              </div>
              <span class="signal-node-label">Input</span>
              <span class="signal-node-name">SOURCE</span>
            </div>
            <div class="signal-line" :class="{ active: eqChainActive }"></div>
            <div class="signal-node" :class="{ active: eqChainActive }" @click="toggleEqFromDsp">
              <div class="signal-node-circle" :class="{ active: eqChainActive }">
                <i class="pi pi-sliders-h"></i>
              </div>
              <span class="signal-node-label">{{ eqChainActive ? 'Active' : 'Bypass' }}</span>
              <span class="signal-node-name">EQ</span>
            </div>
            <div class="signal-line" :class="{ active: crossfeedChainActive }"></div>
            <div
              class="signal-node"
              :class="{ active: crossfeedChainActive }"
              @click="toggleCrossfeedFromDsp"
            >
              <div class="signal-node-circle" :class="{ active: crossfeedChainActive }">
                <i class="pi pi-arrows-h"></i>
              </div>
              <span class="signal-node-label">{{ crossfeedChainActive ? 'Active' : 'Bypass' }}</span>
              <span class="signal-node-name">CROSSFEED</span>
            </div>
            <div class="signal-line" :class="{ active: convolverChainActive }"></div>
            <div class="signal-node" :class="{ active: convolverChainActive }" @click="toggleConvolver">
              <div class="signal-node-circle" :class="{ active: convolverChainActive }">
                <i class="pi pi-microchip"></i>
              </div>
              <span class="signal-node-label">{{ convolverChainActive ? 'Active' : 'Bypass' }}</span>
              <span class="signal-node-name">CONVOLVER</span>
            </div>
            <div class="signal-line active"></div>
            <div class="signal-node static" :class="{ active: true }">
              <div class="signal-node-circle active">
                <i class="pi pi-volume-up"></i>
              </div>
              <span class="signal-node-label">DAC</span>
              <span class="signal-node-name">OUTPUT</span>
            </div>
          </div>

          <div class="dsp-status-grid">
            <div class="dsp-meter">
              <span>Input</span>
              <strong>{{ dspInputText }}</strong>
              <small>源信号格式</small>
            </div>
            <div class="dsp-meter">
              <span>Process</span>
              <strong>{{ dspProcessText }}</strong>
              <small>{{ dspModuleCount }} 个模块激活</small>
            </div>
            <div class="dsp-meter">
              <span>Output</span>
              <strong>{{ dspOutputText }}</strong>
              <small>{{ outputFormatText }}</small>
            </div>
          </div>

          <div :class="{ 'dsp-disabled-content': !audioProcessing.dspEnabled }">
            <div class="dsp-actions">
              <button class="brand-soft-button" type="button" @click="openEqualizerFromDsp">
                <i class="pi pi-sliders-h"></i>
                打开均衡器
              </button>
              <button class="soft-button" type="button" @click="selectImpulseResponse">
                <i class="pi pi-folder-open"></i>
                载入 IR · {{ convolverPathLabel }}
              </button>
              <button class="soft-button" type="button" @click="clearImpulseResponse">
                <i class="pi pi-undo"></i>
                重置
              </button>
            </div>

            <div class="dsp-presets">
              <button class="preset-btn" type="button" @click="applyDspPreset('headphone')">
                <i class="pi pi-headphones"></i> 耳机护耳模式
              </button>
              <button class="preset-btn" type="button" @click="applyDspPreset('dynamic')">
                <i class="pi pi-bolt"></i> 动态增强
              </button>
              <button class="preset-btn" type="button" @click="applyDspPreset('bypass')">
                <i class="pi pi-stop-circle"></i> 纯净直通 (Bit-perfect)
              </button>
            </div>

            <div class="dsp-module-grid">
              <div class="dsp-module-card">
                <h3>基础处理 (Core)</h3>
                <div class="mini-setting">
                  <div>
                    <strong>防破音保护 (Clip Guard)</strong>
                    <span>动态压缩超载信号，防止数字削波失真</span>
                  </div>
                  <span
                    class="toggle-switch"
                    :class="{ active: audioProcessing.clipGuard, inactive: !audioProcessing.clipGuard }"
                    role="switch"
                    :aria-checked="audioProcessing.clipGuard"
                    @click="toggleClipGuard"
                  ></span>
                </div>
                <div class="mini-setting">
                  <div>
                    <strong>音量标准化 (ReplayGain)</strong>
                    <span>响度归一化 · {{ replayGainModeLabel }}</span>
                  </div>
                  <select
                    class="preview-select"
                    :value="audioProcessing.volumeNormalization"
                    @change="setReplayGainFromSelect"
                  >
                    <option
                      v-for="option in replayGainOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </div>
                <div class="mini-setting">
                  <div>
                    <strong>Preamp</strong>
                    <span>预增益 (dB)</span>
                  </div>
                  <input
                    class="number-input"
                    type="number"
                    step="0.1"
                    :value="audioProcessing.replayGainPreamp"
                    @input="setReplayGainPreamp"
                  />
                </div>
              </div>

              <div class="dsp-module-card">
                <h3>空间与声学 (Spatial & Acoustic)</h3>
                <div class="mini-setting">
                  <div>
                    <strong>Parametric EQ</strong>
                    <span>{{ eqSummaryText }}</span>
                  </div>
                  <div class="inline-controls">
                    <span
                      class="toggle-switch"
                      :class="{ active: audioProcessing.eqEnabled, inactive: !audioProcessing.eqEnabled }"
                      role="switch"
                      :aria-checked="audioProcessing.eqEnabled"
                      @click="toggleEqFromDsp"
                    ></span>
                    <button class="soft-button compact" type="button" @click="openEqualizerFromDsp">
                      <i class="pi pi-sliders-h"></i>
                      打开面板
                    </button>
                  </div>
                </div>
                <div class="mini-setting">
                  <div>
                    <strong>耳机交叉馈电 (Crossfeed)</strong>
                    <span>减轻耳机声像过宽的"头中效应"。</span>
                  </div>
                  <div class="inline-controls">
                    <input
                      class="range-input"
                      type="range"
                      min="0"
                      max="100"
                      :value="crossfeedPercent"
                      @input="setCrossfeedFromInput"
                    />
                    <span class="crossfeed-percent">{{ crossfeedPercent }}%</span>
                    <span
                      class="toggle-switch"
                      :class="{ active: audioProcessing.crossfeedEnabled, inactive: !audioProcessing.crossfeedEnabled }"
                      role="switch"
                      :aria-checked="audioProcessing.crossfeedEnabled"
                      @click="updateAudioProcessing({ dspEnabled: true, crossfeedEnabled: !audioProcessing.crossfeedEnabled })"
                    ></span>
                  </div>
                </div>
                <div class="mini-setting">
                  <div>
                    <strong>
                      卷积脉冲响应 (Convolver)
                      <span class="compute-badge"><i class="pi pi-microchip"></i> 高算力消耗</span>
                    </strong>
                    <span>加载 IR 脉冲文件用于空间音效。当前路径：{{ convolverPathLabel }}</span>
                  </div>
                  <div class="inline-controls">
                    <button class="soft-button compact" type="button" @click="selectImpulseResponse">
                      <i class="pi pi-folder-open"></i>
                      选择文件
                    </button>
                    <span
                      class="toggle-switch"
                      :class="{ active: audioProcessing.convolverEnabled, inactive: !audioProcessing.convolverEnabled }"
                      role="switch"
                      :aria-checked="audioProcessing.convolverEnabled"
                      @click="toggleConvolver"
                    ></span>
                  </div>
                </div>
              </div>

              <div class="dsp-module-card">
                <h3>硬核解码 (Decoding)</h3>
                <div class="decode-grid">
                  <label>
                    <span>DSD Mode</span>
                    <select
                      class="preview-select"
                      :value="audioProcessing.dsdOutputMode"
                      @change="setDsdOutputMode"
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
                  <label>
                    <span>SACD Program</span>
                    <select
                      class="preview-select"
                      :value="audioProcessing.sacdProgramMode"
                      @change="setSacdProgramMode"
                    >
                      <option
                        v-for="option in sacdProgramModeOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <label>
                    <span>FFT Resolution</span>
                    <select
                      class="preview-select"
                      :value="audioProcessing.fftResolution"
                      @change="setFftResolution"
                    >
                      <option v-for="option in fftResolutionOptions" :key="option" :value="option">
                        {{ option }}
                      </option>
                    </select>
                  </label>
                  <label class="decode-highres">
                    <span>高解析度处理 (High-Res)</span>
                    <div class="mini-highres">
                      <small>内部启用 64-bit 浮点精度</small>
                      <span
                        class="toggle-switch"
                        :class="{ active: audioProcessing.highResolution, inactive: !audioProcessing.highResolution }"
                        role="switch"
                        :aria-checked="audioProcessing.highResolution"
                        @click="toggleHighResolution"
                      ></span>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="cache" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-database"></i>
            <h2>缓存 (Cache)</h2>
          </div>
          <div class="setting-list">
            <div class="setting-item top-align">
              <div class="setting-copy">
                <strong>缓存目录</strong>
                <span>保存图片、歌词、在线资源和可复用的流媒体缓存。</span>
              </div>
              <div class="path-control">
                <input readonly :value="activeCachePath || '未设置'" />
                <button type="button" class="soft-button" @click="chooseCacheFolder">选择文件夹</button>
                <button type="button" class="muted-button" @click="resetCacheFolder">恢复默认</button>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>缓存占用</strong>
                <span>当前估算：<b>{{ formattedCacheSize }}</b></span>
              </div>
              <button
                class="danger-soft-button solid-hover"
                type="button"
                :disabled="clearingCache"
                @click="clearCache"
              >
                <i class="pi pi-trash"></i>
                {{ clearingCache ? '清理中…' : '清理缓存' }}
              </button>
            </div>
          </div>
        </section>



        <section id="performance" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-bolt"></i>
            <h2>性能 (Performance)</h2>
          </div>
          <div v-if="restartRequired" class="restart-banner">
            <div>
              <strong>需要重启以应用更改</strong>
              <span>{{ restartReasons.join('、') }}</span>
            </div>
            <button class="brand-soft-button" type="button" @click="relaunch">
              <i class="pi pi-refresh"></i>
              立即重启
            </button>
          </div>
          <div class="setting-list">
            <div class="setting-item">
              <div class="setting-copy">
                <strong>硬件加速</strong>
                <span>使用 GPU 加速界面渲染、动画与模糊效果。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.hardwareAcceleration, inactive: !settings.hardwareAcceleration }"
                role="switch"
                :aria-checked="settings.hardwareAcceleration"
                @click="toggleSetting('hardwareAcceleration')"
              ></span>
            </div>
          </div>
        </section>

        <section id="appearance" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-palette"></i>
            <h2>外观 (Appearance)</h2>
          </div>

          <div class="setting-list">
            <div class="setting-item">
              <div class="setting-copy">
                <strong>主题模式</strong>
                <span>跟随系统或固定为浅色、深色。</span>
              </div>
              <div class="theme-segment">
                <button
                  v-for="option in colorModeOptions"
                  :key="option.value"
                  type="button"
                  :class="{ active: settings.theme === option.value }"
                  @click="setTheme(option.value)"
                >
                  <i :class="option.icon"></i>
                  {{ option.label }}
                </button>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>插件主题</strong>
                <span>从已启用主题插件中选择声明式主题样式。</span>
              </div>
              <select
                class="preview-select wide"
                :value="settings.pluginThemeId ?? ''"
                :disabled="pluginThemeOptions.length === 0"
                @change="setPluginTheme"
              >
                <option value="">不使用插件主题</option>
                <option
                  v-for="option in pluginThemeOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>强调色</strong>
                <span>选择界面中的主要品牌色。</span>
              </div>
              <div class="swatch-row">
                <span
                  v-for="option in accentColorOptions"
                  :key="option.value"
                  class="swatch"
                  :class="[option.class, { active: settings.accentColor === option.value }]"
                  :title="option.label"
                  @click="setAccentColor(option.value)"
                >
                  <i v-if="settings.accentColor === option.value" class="pi pi-check"></i>
                </span>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>封面主题色</strong>
                <span>播放页和底栏使用当前专辑封面提取的主题色。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.useCoverTheme, inactive: !settings.useCoverTheme }"
                role="switch"
                :aria-checked="settings.useCoverTheme"
                @click="toggleSetting('useCoverTheme')"
              ></span>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>原生半透明材质 (Mica / Acrylic)</strong>
                <span>启用系统级视窗模糊效果，让背景透出桌面壁纸。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.blurEffect, inactive: !settings.blurEffect }"
                role="switch"
                :aria-checked="settings.blurEffect"
                @click="toggleSetting('blurEffect')"
              ></span>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>全局字体 (Typography)</strong>
                <span>更换界面的主要显示字体。</span>
              </div>
              <select
                class="preview-select wide"
                :value="settings.fontFamily"
                @change="setFontFamily"
              >
                <option v-for="option in fontFamilyOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>界面排版密度 (UI Density)</strong>
                <span>控制列表项的间距与信息密度。</span>
              </div>
              <div class="segmented-control density">
                <button
                  v-for="option in uiDensityOptions"
                  :key="option.value"
                  type="button"
                  :class="{ active: settings.uiDensity === option.value }"
                  @click="setUiDensity(option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <hr />
            <div class="setting-item top-align">
              <div class="setting-copy">
                <strong>沉浸式播放页背景 (Now Playing)</strong>
                <span>全屏播放或详情页的背景视觉风格。</span>
              </div>
              <div class="background-options">
                <button
                  v-for="option in nowPlayingBackgroundOptions"
                  :key="option.value"
                  type="button"
                  :class="{ active: settings.nowPlayingBackground === option.value }"
                  @click="setNowPlayingBackground(option.value)"
                >
                  <span :class="option.class"></span>
                  <small>{{ option.label }}</small>
                </button>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>歌词显示样式 (Lyrics Style)</strong>
                <span>翻译对齐方式、字号及未播放行暗度。</span>
              </div>
              <div class="inline-controls">
                <select
                  class="preview-select"
                  :value="settings.lyricAlign"
                  @change="setLyricAlign"
                >
                  <option v-for="option in lyricAlignOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
                <div class="range-pill">
                  <span>字号</span>
                  <input
                    class="range-input"
                    type="range"
                    min="14"
                    max="28"
                    :value="settings.lyricFontSize"
                    @input="setLyricFontSize"
                  />
                  <span>{{ settings.lyricFontSize }}px</span>
                </div>
                <div class="range-pill">
                  <span>未播放暗度</span>
                  <input
                    class="range-input"
                    type="range"
                    min="10"
                    max="100"
                    :value="settings.lyricDimOpacity"
                    @input="setLyricDimOpacity"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="desktopLyrics" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-window-maximize"></i>
            <h2>桌面歌词 (Desktop Lyrics)</h2>
          </div>

          <div class="setting-list">
            <div class="setting-item">
              <div class="setting-copy">
                <strong>启用桌面歌词</strong>
                <span>在独立窗口中显示桌面歌词，可拖拽移动位置。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.desktopLyrics.enabled, inactive: !settings.desktopLyrics.enabled }"
                role="switch"
                :aria-checked="settings.desktopLyrics.enabled"
                @click="toggleDesktopLyrics"
              ></span>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>字体大小 (Font Size)</strong>
                <span>调整桌面歌词的字号大小。</span>
              </div>
              <div class="inline-controls">
                <input type="range" class="range-input" min="12" max="80" :value="settings.desktopLyrics.fontSize"
                  @input="updateDl('fontSize', Number(($event.target as HTMLInputElement).value))" />
                <span>{{ settings.desktopLyrics.fontSize }}px</span>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>字体粗细 (Font Weight)</strong>
                <span>调整歌词文本的粗细程度。</span>
              </div>
              <select class="preview-select wide" :value="settings.desktopLyrics.fontWeight"
                @change="updateDl('fontWeight', Number(($event.target as HTMLSelectElement).value))">
                <option :value="300">细体 (300)</option>
                <option :value="400">常规 (400)</option>
                <option :value="500">中等 (500)</option>
                <option :value="600">半粗 (600)</option>
                <option :value="700">粗体 (700)</option>
                <option :value="800">特粗 (800)</option>
                <option :value="900">黑体 (900)</option>
              </select>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>行间距 (Line Spacing)</strong>
                <span>调整多行歌词之间的间距。</span>
              </div>
              <div class="inline-controls">
                <input type="range" class="range-input" min="1" max="3" step="0.1" :value="settings.desktopLyrics.lineSpacing"
                  @input="updateDl('lineSpacing', Number(($event.target as HTMLInputElement).value))" />
                <span>{{ settings.desktopLyrics.lineSpacing.toFixed(1) }}</span>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>最大显示行数 (Max Lines)</strong>
                <span>限制桌面歌词最多显示的行数。</span>
              </div>
              <div class="inline-controls">
                <input type="range" class="range-input" min="1" max="5" :value="settings.desktopLyrics.maxLines"
                  @input="updateDl('maxLines', Number(($event.target as HTMLInputElement).value))" />
                <span>{{ settings.desktopLyrics.maxLines }} 行</span>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>默认文字颜色 (Text Color)</strong>
                <span>未播放到该句时的歌词颜色。</span>
              </div>
              <input type="color" :value="settings.desktopLyrics.color" @input="updateDl('color', ($event.target as HTMLInputElement).value)" class="color-picker" />
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>高亮文字颜色 (Highlight Color)</strong>
                <span>当前正在播放的歌词颜色。</span>
              </div>
              <input type="color" :value="settings.desktopLyrics.highlightColor" @input="updateDl('highlightColor', ($event.target as HTMLInputElement).value)" class="color-picker" />
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>背景颜色 (Background Color)</strong>
                <span>桌面歌词窗口的背景色。</span>
              </div>
              <input type="color" :value="settings.desktopLyrics.bgColor" @input="updateDl('bgColor', ($event.target as HTMLInputElement).value)" class="color-picker" />
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>背景透明度 (Background Opacity)</strong>
                <span>调整背景颜色的透明程度。</span>
              </div>
              <div class="inline-controls">
                <input type="range" class="range-input" min="0" max="100" :value="settings.desktopLyrics.bgOpacity"
                  @input="updateDl('bgOpacity', Number(($event.target as HTMLInputElement).value))" />
                <span>{{ settings.desktopLyrics.bgOpacity }}%</span>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>文字阴影 (Text Shadow)</strong>
                <span>为歌词文字添加阴影以提高辨识度。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.desktopLyrics.shadow, inactive: !settings.desktopLyrics.shadow }"
                role="switch"
                :aria-checked="settings.desktopLyrics.shadow"
                @click="updateDl('shadow', !settings.desktopLyrics.shadow)"
              ></span>
            </div>
            <hr v-if="settings.desktopLyrics.shadow" />
            <div class="setting-item" v-if="settings.desktopLyrics.shadow">
              <div class="setting-copy">
                <strong>阴影模糊度 (Shadow Blur)</strong>
                <span>文字阴影的扩散程度。</span>
              </div>
              <div class="inline-controls">
                <input type="range" class="range-input" min="0" max="30" :value="settings.desktopLyrics.shadowBlur"
                  @input="updateDl('shadowBlur', Number(($event.target as HTMLInputElement).value))" />
                <span>{{ settings.desktopLyrics.shadowBlur }}px</span>
              </div>
            </div>
            <hr v-if="settings.desktopLyrics.shadow" />
            <div class="setting-item" v-if="settings.desktopLyrics.shadow">
              <div class="setting-copy">
                <strong>阴影颜色 (Shadow Color)</strong>
                <span>文字阴影的颜色。</span>
              </div>
              <input type="color" :value="settings.desktopLyrics.shadowColor" @input="updateDl('shadowColor', ($event.target as HTMLInputElement).value)" class="color-picker" />
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>对齐方式 (Alignment)</strong>
                <span>歌词文本的水平对齐方式。</span>
              </div>
              <select class="preview-select wide" :value="settings.desktopLyrics.align"
                @change="updateDl('align', ($event.target as HTMLSelectElement).value as LyricAlign)">
                <option value="center">居中对齐 (Center)</option>
                <option value="left">靠左对齐 (Left)</option>
              </select>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>窗口宽度 (Window Width)</strong>
                <span>调整桌面歌词窗口的宽度。</span>
              </div>
              <div class="inline-controls">
                <input type="range" class="range-input" min="200" max="3000" step="10" :value="settings.desktopLyrics.windowWidth"
                  @input="updateDl('windowWidth', Number(($event.target as HTMLInputElement).value))" />
                <span>{{ settings.desktopLyrics.windowWidth }}px</span>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>窗口高度 (Window Height)</strong>
                <span>调整桌面歌词窗口的高度。</span>
              </div>
              <div class="inline-controls">
                <input type="range" class="range-input" min="60" max="800" step="10" :value="settings.desktopLyrics.windowHeight"
                  @input="updateDl('windowHeight', Number(($event.target as HTMLInputElement).value))" />
                <span>{{ settings.desktopLyrics.windowHeight }}px</span>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>始终置顶 (Always on Top)</strong>
                <span>桌面歌词窗口始终显示在其他窗口之前。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.desktopLyrics.alwaysOnTop, inactive: !settings.desktopLyrics.alwaysOnTop }"
                role="switch"
                :aria-checked="settings.desktopLyrics.alwaysOnTop"
                @click="updateDl('alwaysOnTop', !settings.desktopLyrics.alwaysOnTop)"
              ></span>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>鼠标穿透 (Click Through)</strong>
                <span>开启后，鼠标点击事件会穿透歌词窗口，不影响下方操作。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.desktopLyrics.clickThrough, inactive: !settings.desktopLyrics.clickThrough }"
                role="switch"
                :aria-checked="settings.desktopLyrics.clickThrough"
                @click="updateDl('clickThrough', !settings.desktopLyrics.clickThrough)"
              ></span>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>显示翻译 (Show Translation)</strong>
                <span>在原文歌词下方显示对应的翻译（如果存在）。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.desktopLyrics.showTranslation, inactive: !settings.desktopLyrics.showTranslation }"
                role="switch"
                :aria-checked="settings.desktopLyrics.showTranslation"
                @click="updateDl('showTranslation', !settings.desktopLyrics.showTranslation)"
              ></span>
            </div>
          </div>
        </section>

        <section id="shortcuts" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-keyboard"></i>
            <h2>快捷键</h2>
          </div>
          <div class="setting-list">
            <div class="setting-item">
              <div class="setting-copy">
                <strong>全局快捷键 (Global Shortcuts)</strong>
                <span>在应用位于后台时，依然响应系统媒体播放快捷键。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.globalShortcuts, inactive: !settings.globalShortcuts }"
                role="switch"
                :aria-checked="settings.globalShortcuts"
                @click="toggleSetting('globalShortcuts')"
              ></span>
            </div>
            <hr />
            <div class="shortcut-grid">
              <div><span>播放 / 暂停</span><kbd>Ctrl + Alt + Space</kbd></div>
              <div><span>上一首</span><kbd>Ctrl + Alt + Left</kbd></div>
              <div><span>下一首</span><kbd>Ctrl + Alt + Right</kbd></div>
            </div>
          </div>

        </section>

        <section id="about" class="glass-card preview-section about-section">
          <div class="about-glow" aria-hidden="true"></div>
          <div class="section-title-row">
            <i class="pi pi-info-circle"></i>
            <h2>关于 (About)</h2>
          </div>

          <div class="about-hero">
            <div class="logo-shell">
              <div class="logo-mark">
                <img src="/icon.png" alt="Twilight Echo" class="logo-icon" />
              </div>
            </div>
            <div class="about-copy">
              <h3>Twilight Echo</h3>
              <span>Version {{ appVersion || '—' }}</span>
              <p>一款专为发烧友打造的现代级桌面音乐枢纽，支持海量本地高解析度音频与插件化流媒体扩展。</p>
            </div>
          </div>

          <div class="about-cards">
            <div class="update-card">
              <div class="status-icon">
                <i
                  :class="updateCheckState === 'available' ? 'pi pi-download' : updateCheckState === 'error' ? 'pi pi-exclamation-circle' : 'pi pi-check-circle'"
                ></i>
              </div>
              <div>
                <strong v-if="updateCheckState === 'checking'">正在检查更新…</strong>
                <strong v-else-if="updateCheckState === 'available'">发现新版本 v{{ latestVersion }}</strong>
                <strong v-else-if="updateCheckState === 'error'">检查更新失败</strong>
                <strong v-else>当前已是最新版本</strong>
                <span>上次检查：{{ lastUpdateCheck || '—' }}</span>
              </div>
              <button
                v-if="updateCheckState === 'available'"
                class="brand-soft-button"
                type="button"
                @click="openGithub"
              >
                <i class="pi pi-download"></i>
                前往下载
              </button>
              <button
                v-else
                class="soft-button"
                type="button"
                :disabled="updateCheckState === 'checking'"
                @click="checkForUpdates"
              >
                <i class="pi pi-sync"></i>
                检查更新
              </button>
            </div>

            <div class="sponsor-card">
              <i class="pi pi-heart-fill sponsor-watermark"></i>
              <div>
                <h3><i class="pi pi-heart"></i> 支持项目发展</h3>
                <p>Twilight Echo 是一个由热情驱动的免费开源项目。您的慷慨赞助将直接用于服务器开销、持续更新以及给开发者的深夜咖啡。</p>
              </div>
              <span class="sponsor-pending">赞助入口暂未接入</span>
            </div>
          </div>

          <hr />

          <div class="about-links">
            <button type="button" @click="openGithub"><i class="pi pi-github"></i> GitHub</button>
            <button type="button" @click="openReleases"><i class="pi pi-file-o"></i> 更新日志</button>
            <button type="button" @click="openHomepage"><i class="pi pi-heart-fill"></i> 开源致谢</button>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>

<style>
@font-face {
  font-family: 'Outfit';
  src: url('/font/Outfit-VariableFont_wght.woff2') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Noto Sans SC';
  src: url('/font/NotoSansSC-VariableFont_wght.woff2') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
</style>

<style scoped>

.settings-preview-page {
  --brand-50: #f5f3ff;
  --brand-100: #ede9fe;
  --brand-200: #ddd6fe;
  --brand-300: #c4b5fd;
  --brand-400: #a78bfa;
  --brand-500: #8b5cf6;
  --brand-600: #7c3aed;
  --brand-700: #6d28d9;
  position: fixed;
  inset: 0;
  z-index: 60;
  width: 100%;
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 48px 48px;
  background: #f4f4f7;
  color: #111827;
  font-family: 'Outfit', 'Noto Sans SC', var(--te-font-sans), sans-serif;
  scroll-behavior: smooth;
}

.settings-preview-page::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.settings-preview-page::-webkit-scrollbar-track {
  background: transparent;
}

.settings-preview-page::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.15);
}

.settings-preview-page::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}

.settings-preview-page button,
.settings-preview-page input,
.settings-preview-page select {
  font: inherit;
}

.settings-preview-layout {
  width: min(100%, 1280px);
  margin: 0 auto;
}

.settings-preview-layout {
  position: relative;
  display: block;
  padding-top: 32px;
}

.settings-preview-nav {
  position: fixed;
  left: max(24px, calc((100vw - 896px) / 4 - 96px));
  top: 44%;
  z-index: 100;
  display: flex;
  width: 192px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  max-height: calc(100vh - 96px);
  transform: translateY(-50%);
}

.preview-nav-item {
  display: grid;
  grid-template-columns: 16px auto;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  min-height: 40px;
  padding: 10px 16px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: #4b5563;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  text-align: center;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease;
}

.preview-nav-item i {
  width: 16px;
  text-align: center;
}

.preview-nav-item:hover {
  background: rgba(255, 255, 255, 0.6);
  color: #111827;
}

.preview-nav-item.active {
  border-color: var(--brand-100);
  background: #ffffff;
  color: var(--brand-600);
  font-weight: 800;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.08);
}

.settings-preview-stack {
  display: flex;
  width: min(100%, 896px);
  flex-direction: column;
  gap: 32px;
  margin: 0 auto;
  padding-bottom: 40px;
}

.glass-card {
  border: 1px solid rgba(255, 255, 255, 1);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 4px 20px -5px rgba(0, 0, 0, 0.05);
  -webkit-backdrop-filter: blur(24px);
  backdrop-filter: blur(24px);
}

.preview-section {
  scroll-margin-top: 24px;
  padding: 32px;
}

.section-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
}

.section-title-row.split {
  justify-content: space-between;
}

.section-title-row.split > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title-row i {
  color: var(--brand-500);
  font-size: 18px;
}

.section-title-row h2 {
  margin: 0;
  color: #1f2937;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0;
}

.section-block + .section-block {
  margin-top: 32px;
}

.section-block h3,
.dsp-module-card h3 {
  margin: 0 0 16px;
  color: var(--brand-500);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.setting-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-list hr,
.about-section hr {
  width: 100%;
  height: 1px;
  margin: 0;
  border: 0;
  background: rgba(243, 244, 246, 0.82);
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.setting-item.top-align {
  align-items: flex-start;
}

.setting-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
  padding-right: 8px;
}

.setting-copy strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #1f2937;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.35;
}

.setting-copy span {
  color: #6b7280;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.45;
}

.setting-copy small {
  font-size: 12px;
  line-height: 1.45;
}

.plugin-command-result {
  color: #047857;
  font-weight: 800;
}

.plugin-command-error {
  color: #dc2626;
  font-weight: 800;
}

.setting-copy b {
  color: var(--brand-600);
  font-weight: 800;
}

.discord-icon {
  color: #6366f1 !important;
  font-size: 14px !important;
}

.folder-list {
  display: flex;
  width: 256px;
  flex-direction: column;
  gap: 8px;
}

.folder-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #374151;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
  font-size: 12px;
  font-weight: 800;
}

.folder-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-chip i {
  color: #9ca3af;
  font-size: 12px;
  cursor: pointer;
}

.folder-empty-hint {
  padding: 8px 12px;
  color: #9ca3af;
  font-size: 12px;
  font-weight: 600;
}

.dashed-button,
.soft-button,
.muted-button,
.danger-soft-button,
.brand-soft-button,
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.dashed-button {
  width: 100%;
  min-height: 36px;
  border: 1px dashed #d1d5db;
  background: rgba(249, 250, 251, 0.5);
  color: #6b7280;
}

.dashed-button:hover {
  border-color: var(--brand-500);
  background: var(--brand-50);
  color: var(--brand-600);
}

.soft-button,
.muted-button {
  min-height: 30px;
  padding: 6px 16px;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #374151;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.06);
}

.soft-button:hover {
  border-color: #d1d5db;
}

.muted-button {
  background: #f3f4f6;
  color: #4b5563;
  box-shadow: none;
}

.danger-soft-button {
  min-height: 30px;
  padding: 6px 16px;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #dc2626;
  box-shadow: 0 1px 5px rgba(220, 38, 38, 0.08);
}

.danger-soft-button:hover,
.danger-soft-button.solid-hover:hover {
  background: #fee2e2;
}

.danger-soft-button.solid-hover:hover {
  border-color: #ef4444;
  background: #ef4444;
  color: #fff;
}

.brand-soft-button {
  min-height: 38px;
  padding: 8px 16px;
  border: 1px solid var(--brand-200);
  background: var(--brand-50);
  color: var(--brand-700);
  box-shadow: 0 1px 5px rgba(124, 58, 237, 0.08);
}

.brand-soft-button:hover {
  background: var(--brand-100);
}

.icon-button {
  width: 32px;
  height: 32px;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #4b5563;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.06);
}

.icon-button:hover {
  border-color: var(--brand-300);
  color: var(--brand-600);
}

/* Desktop Lyrics controls */
.range-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 200px;
  height: 6px;
  border-radius: 3px;
  background: #e5e7eb;
  outline: none;
  cursor: pointer;
}
.range-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--brand-500, #7c3aed);
  cursor: pointer;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
}
.color-picker {
  width: 40px;
  height: 32px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  cursor: pointer;
  background: #fff;
  padding: 2px;
}
.select-control {
  padding: 6px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 13px;
  color: #333;
  background: #fff;
  cursor: pointer;
  outline: none;
}
.select-control:focus {
  border-color: var(--brand-400, #8b5cf6);
}

.toggle-switch {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  width: 40px;
  height: 20px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.toggle-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.toggle-switch.active {
  background: var(--brand-500);
}

.toggle-switch.active::after {
  left: 22px;
}

.toggle-switch.inactive {
  background: #d1d5db;
}

.toggle-switch.inactive::after {
  left: 2px;
}

.toggle-switch.large {
  width: 48px;
  height: 26px;
}

.toggle-switch.large::after {
  top: 3px;
  width: 20px;
  height: 20px;
}

.toggle-switch.large.active::after {
  left: 25px;
}

.preview-select,
.number-input {
  height: 34px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  outline: none;
  background: #fff;
  color: #374151;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.05);
  font-size: 12px;
  font-weight: 800;
}

.preview-select {
  width: 144px;
  padding: 0 12px;
  appearance: none;
}

.preview-select.wide {
  width: 160px;
  background: #f9fafb;
  box-shadow: none;
}

.number-input {
  width: 56px;
  padding: 0 8px;
  text-align: right;
}

.preview-select:focus,
.number-input:focus {
  border-color: var(--brand-500);
}

.device-panel {
  margin-bottom: 32px;
  overflow: hidden;
  border: 1px solid rgba(229, 231, 235, 0.75);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.62);
}

.device-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
}

.device-panel-head p {
  margin: 0 0 2px;
  color: var(--brand-500);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.device-panel-head h3 {
  margin: 0;
  color: #1f2937;
  font-size: 15px;
  font-weight: 900;
}

.device-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 0 20px 20px;
}

.device-card {
  position: relative;
  display: grid;
  min-height: 132px;
  gap: 4px;
  align-content: end;
  padding: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.95), rgba(249, 250, 251, 0.78)),
    #ffffff;
  color: #374151;
  text-align: left;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
  cursor: pointer;
}

.device-card:hover,
.device-card.active {
  border-color: var(--brand-300);
  box-shadow: 0 14px 32px rgba(124, 58, 237, 0.12);
}

.device-card i {
  position: absolute;
  top: 16px;
  left: 16px;
  color: var(--brand-500);
  font-size: 28px;
}

.device-card span {
  overflow: hidden;
  color: #1f2937;
  font-size: 13px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-card small {
  overflow: hidden;
  color: #6b7280;
  font-size: 11px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-card b {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--brand-50);
  color: var(--brand-600);
  font-size: 10px;
  font-weight: 900;
}

.segmented-control,
.theme-segment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(229, 231, 235, 0.7);
  border-radius: 12px;
  background: rgba(243, 244, 246, 0.8);
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.04);
}

.segmented-control button,
.theme-segment button {
  min-height: 32px;
  padding: 7px 16px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
}

.segmented-control button.active,
.theme-segment button.active {
  background: #fff;
  color: #1f2937;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.08);
}

.theme-segment button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.theme-segment button.active i {
  color: var(--brand-500);
}

.inline-controls {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
}

.compact-row {
  min-height: 38px;
}

.accordion-preview {
  margin-top: 24px;
  overflow: hidden;
  border: 1px solid rgba(229, 231, 235, 0.65);
  border-radius: 12px;
  background: rgba(249, 250, 251, 0.7);
}

.accordion-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 20px;
}

.accordion-head div {
  display: grid;
  gap: 3px;
}

.accordion-head strong {
  color: #1f2937;
  font-size: 13px;
  font-weight: 900;
}

.accordion-head span {
  color: #6b7280;
  font-size: 12px;
  font-weight: 500;
}

.accordion-head i {
  color: #9ca3af;
}

.advanced-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  padding: 14px 20px 20px;
  border-top: 1px solid rgba(229, 231, 235, 0.6);
}

.advanced-grid label,
.decode-grid label {
  display: grid;
  gap: 7px;
}

.advanced-grid label span,
.decode-grid label span {
  color: #6b7280;
  font-size: 11px;
  font-weight: 800;
}

.dsp-status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.dsp-meter {
  display: grid;
  gap: 3px;
  min-height: 92px;
  padding: 18px;
  border: 1px solid rgba(229, 231, 235, 0.72);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.dsp-meter span {
  color: var(--brand-500);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.dsp-meter strong {
  color: #1f2937;
  font-size: 16px;
  font-weight: 900;
}

.dsp-meter small {
  color: #6b7280;
  font-size: 11px;
  font-weight: 600;
}

.dsp-disabled-content {
  opacity: 0.5;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.dsp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 24px;
}

.dsp-module-grid {
  display: grid;
  gap: 18px;
}

.dsp-module-card {
  padding: 18px;
  border: 1px solid rgba(229, 231, 235, 0.7);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.76);
}

.mini-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 48px;
}

.mini-setting + .mini-setting {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(243, 244, 246, 0.85);
}

.mini-setting div {
  display: grid;
  gap: 3px;
}

.mini-setting strong {
  color: #1f2937;
  font-size: 13px;
  font-weight: 900;
}

.mini-setting span {
  color: #6b7280;
  font-size: 12px;
  font-weight: 500;
}

.soft-button.compact {
  min-height: 30px;
  padding-inline: 12px;
}

.range-input {
  width: 96px;
  accent-color: var(--brand-500);
}

.decode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.path-control {
  display: flex;
  min-width: min(100%, 520px);
  flex: 1;
  justify-content: flex-end;
  gap: 8px;
}

.path-control input {
  min-width: 0;
  flex: 1;
  height: 38px;
  padding: 0 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  outline: none;
  background: #f9fafb;
  color: #6b7280;
  font-size: 13px;
}

.plugin-empty {
  display: grid;
  place-items: center;
  min-height: 180px;
  gap: 8px;
  border: 1px dashed #d1d5db;
  border-radius: 14px;
  background: rgba(249, 250, 251, 0.55);
  color: #6b7280;
  text-align: center;
}

.plugin-empty i {
  color: var(--brand-400);
  font-size: 30px;
}

.plugin-empty strong {
  color: #1f2937;
  font-size: 14px;
  font-weight: 900;
}

.plugin-empty span {
  font-size: 12px;
  font-weight: 500;
}

.swatch-row {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.12);
}

.swatch.active {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

.swatch i {
  color: #fff;
  font-size: 10px;
}

.swatch.violet { color: #8b5cf6; background: #8b5cf6; }
.swatch.blue { background: #3b82f6; }
.swatch.emerald { background: #10b981; }
.swatch.rose { background: #fb7185; }
.swatch.amber { background: #f59e0b; }
.swatch.slate { background: #1f2937; }

.density button {
  min-width: 56px;
}

.background-options {
  display: flex;
  gap: 16px;
}

.background-options button {
  display: grid;
  justify-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.16s ease;
}

.background-options button:hover,
.background-options button.active {
  opacity: 1;
}

.background-options span {
  width: 64px;
  height: 40px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.08);
}

.background-options small {
  color: inherit;
  font-size: 10px;
  font-weight: 800;
}

.background-options button.active span {
  border-color: var(--brand-500);
  outline: 2px solid rgba(139, 92, 246, 0.3);
  outline-offset: 1px;
}

.background-options button.active small {
  color: var(--brand-600);
}

.blur-cover {
  filter: blur(2px);
  background: linear-gradient(135deg, #93c5fd, #c4b5fd 52%, #f9a8d4);
}

.background-options button:hover .blur-cover {
  filter: blur(0);
}

.fluid-cover {
  background: linear-gradient(90deg, #22d3ee, #3b82f6);
}

.solid-cover {
  background: #111827;
}

.range-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.range-pill span {
  color: #6b7280;
  font-size: 12px;
  font-weight: 800;
}

.shortcut-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 16px;
  border: 1px solid rgba(229, 231, 235, 0.75);
  border-radius: 12px;
  background: #f9fafb;
}

.shortcut-grid div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.shortcut-grid span {
  color: #374151;
  font-size: 13px;
  font-weight: 600;
}

.shortcut-grid kbd {
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #4b5563;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 700;
}

.about-section {
  position: relative;
  overflow: hidden;
}

.about-glow {
  position: absolute;
  top: -128px;
  right: -128px;
  width: 320px;
  height: 320px;
  border-radius: 999px;
  background: rgba(167, 139, 250, 0.1);
  filter: blur(100px);
  pointer-events: none;
}

.about-hero {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 32px;
}

.logo-shell {
  position: relative;
  flex: 0 0 auto;
}

.logo-mark {
  position: relative;
  display: flex;
  width: 96px;
  height: 96px;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
}

.logo-mark img {
  width: 88px;
  height: 88px;
  object-fit: contain;
  border-radius: 12px;
}

.about-copy {
  display: grid;
  justify-items: start;
  gap: 10px;
  text-align: left;
}

.about-copy h3 {
  margin: 0;
  color: #1f2937;
  font-size: 24px;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.about-copy span {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--brand-50);
  color: var(--brand-600);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.about-copy p {
  max-width: 560px;
  margin: 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.65;
}

.about-cards {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 12px;
  margin-bottom: 32px;
}

.update-card,
.sponsor-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-radius: 12px;
}

.update-card {
  border: 1px solid #e5e7eb;
  background: #fff;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.06);
}

.status-icon {
  display: flex;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid #dcfce7;
  border-radius: 10px;
  background: #f0fdf4;
  color: #22c55e;
}

.update-card > div:nth-child(2) {
  display: grid;
  flex: 1;
  gap: 2px;
}

.update-card strong {
  color: #1f2937;
  font-size: 13px;
  font-weight: 900;
}

.update-card span {
  color: #9ca3af;
  font-size: 11px;
}

.sponsor-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(251, 191, 36, 0.6);
  background: linear-gradient(90deg, #fffbeb, rgba(255, 247, 237, 0.5));
  box-shadow: 0 1px 5px rgba(245, 158, 11, 0.08);
}

.sponsor-watermark {
  position: absolute;
  right: -8px;
  bottom: -8px;
  color: rgba(245, 158, 11, 0.1);
  font-size: 60px;
  transform: rotate(12deg);
  pointer-events: none;
}

.sponsor-card h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 2px;
  color: #92400e;
  font-size: 12px;
  font-weight: 900;
}

.sponsor-card p {
  max-width: 540px;
  margin: 0;
  color: rgba(146, 64, 14, 0.8);
  font-size: 11px;
  line-height: 1.6;
}

.sponsor-pending {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 8px 16px;
  border: 1px solid #fde68a;
  border-radius: 8px;
  background: #fff;
  color: #b45309;
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
}

.about-links button:hover {
  transform: translateY(-1px);
}

.about-links {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding-top: 32px;
}

.about-links button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  padding: 12px 24px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  color: #374151;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.06);
  cursor: pointer;
  font-size: 14px;
  font-weight: 900;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.about-links button:hover {
  border-color: #d1d5db;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
}

.about-links button:nth-child(2):hover {
  border-color: var(--brand-300);
  color: var(--brand-600);
}

.about-links button:nth-child(3):hover {
  border-color: #fda4af;
  color: #e11d48;
}

@media (max-width: 1024px) {
  .settings-preview-page {
    padding: 0 24px 24px;
  }

  .settings-preview-layout {
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding-top: 32px;
  }

  .settings-preview-nav {
    position: sticky;
    top: 0;
    left: auto;
    width: 100%;
    max-width: 100%;
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    min-height: auto;
    overflow-x: auto;
    padding-bottom: 8px;
    transform: none;
  }

  .preview-nav-item {
    flex: 0 0 auto;
  }

  .settings-preview-stack {
    width: 100%;
  }
}

@media (max-width: 760px) {
  .settings-preview-page {
    padding: 0 16px 40px;
  }

  .preview-section {
    padding: 24px;
  }

  .setting-item,
  .setting-item.top-align,
  .mini-setting,
  .update-card,
  .sponsor-card,
  .about-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .folder-list,
  .preview-select,
  .preview-select.wide,
  .path-control,
  .path-control input,
  .soft-button,
  .muted-button,
  .danger-soft-button,
  .brand-soft-button {
    width: 100%;
  }

  .device-grid,
  .dsp-status-grid,
  .advanced-grid,
  .decode-grid,
  .shortcut-grid {
    grid-template-columns: 1fr;
  }

  .path-control,
  .inline-controls,
  .background-options,
  .about-links {
    flex-direction: column;
    align-items: stretch;
  }

  .theme-segment,
  .segmented-control {
    width: 100%;
  }

  .theme-segment button,
  .segmented-control button {
    flex: 1;
  }

  .about-copy {
    justify-items: center;
    text-align: center;
  }

  .about-links button {
    flex: 1;
  }
}
</style>


<style scoped>
.engine-error {
  margin-bottom: 20px;
  padding: 12px 16px;
  border: 1px solid #fecaca;
  border-radius: 10px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 12px;
  font-weight: 700;
}

.plugin-extension-group {
  margin-top: 24px;
}

.plugin-extension-group h3 {
  margin: 0 0 16px;
  color: var(--brand-500);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.wasapi-push-row {
  padding: 14px 20px;
  border-top: 1px solid rgba(229, 231, 235, 0.6);
}

.restart-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  padding: 14px 18px;
  border: 1px solid #fde68a;
  border-radius: 12px;
  background: linear-gradient(90deg, #fffbeb, rgba(255, 247, 237, 0.6));
}

.restart-banner strong {
  color: #92400e;
  font-size: 13px;
  font-weight: 900;
}

.restart-banner span {
  color: rgba(146, 64, 14, 0.8);
  font-size: 12px;
}

/* ── 输出状态诊断面板 ── */
.output-diagnostic-panel {
  margin-bottom: 24px;
  padding: 16px 20px;
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 12px;
  background: rgba(249, 250, 251, 0.5);
}

.diagnostic-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.diagnostic-label {
  color: var(--brand-600);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.diagnostic-status {
  color: #ef4444;
  font-size: 12px;
  font-weight: 700;
}

.diagnostic-chain {
  color: #374151;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.diagnostic-meta {
  display: flex;
  gap: 16px;
  color: #6b7280;
  font-size: 11px;
  font-weight: 500;
}

.diagnostic-meta i {
  margin-right: 4px;
}

/* ── 无缝播放 Crossfade ── */
.crossfade-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
}

/* ── 高级引擎参数折叠 ── */
.accordion-preview .accordion-head {
  cursor: pointer;
  border: 0;
  background: transparent;
  width: 100%;
  text-align: left;
}

.accordion-preview .accordion-head i {
  transition: transform 0.3s ease;
}

.accordion-preview .accordion-head i.rotated {
  transform: rotate(180deg);
}

.accordion-body {
  border-top: 1px solid rgba(229, 231, 235, 0.6);
  padding: 14px 20px 20px;
}

.engine-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 16px;
  padding: 10px 14px;
  border: 1px solid #fed7aa;
  border-radius: 10px;
  background: #fff7ed;
  color: #c2410c;
  font-size: 12px;
  font-weight: 600;
}

.engine-warning i {
  color: #f97316;
  margin-top: 1px;
  flex-shrink: 0;
}

/* ── DSP 信号流可视化链路图 ── */
.dsp-signal-chain {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0;
  margin-bottom: 24px;
  padding: 24px 16px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 16px;
  background: rgba(249, 250, 251, 0.5);
}

.signal-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: opacity 0.3s ease;
  opacity: 0.45;
}

.signal-node.static {
  cursor: default;
}

.signal-node.active {
  opacity: 1;
}

.signal-node-circle {
  display: flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border: 2px dashed #d1d5db;
  border-radius: 50%;
  background: #fff;
  transition: all 0.3s ease;
}

.signal-node-circle.active {
  border: 2px solid var(--brand-500);
  box-shadow: 0 0 15px rgba(139, 92, 246, 0.15);
  background: var(--brand-50);
}

.signal-node-circle i {
  color: #9ca3af;
  font-size: 18px;
  transition: color 0.3s ease;
}

.signal-node-circle.active i {
  color: var(--brand-500);
}

.signal-node-label {
  color: #9ca3af;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.signal-node.active .signal-node-label {
  color: var(--brand-500);
}

.signal-node-name {
  color: #6b7280;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.05em;
}

.signal-node.active .signal-node-name {
  color: #1f2937;
}

.signal-line {
  flex: 1;
  height: 2px;
  min-width: 20px;
  border-bottom: 2px dashed #d1d5db;
  transition: all 0.3s ease;
}

.signal-line.active {
  border-bottom: 2px solid var(--brand-500);
  background: linear-gradient(90deg, var(--brand-500), transparent);
}

/* ── DSP 快速情景预设 ── */
.dsp-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 20px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.preset-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 8px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  color: #6b7280;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.04);
  transition: all 0.16s ease;
}

.preset-btn:hover {
  border-color: var(--brand-300);
  color: var(--brand-600);
  background: var(--brand-50);
}

/* ── Crossfeed 百分比 ── */
.crossfeed-percent {
  min-width: 32px;
  text-align: right;
  color: #4b5563;
  font-size: 12px;
  font-weight: 800;
}

/* ── Convolver 高算力消耗标签 ── */
.compute-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  padding: 2px 6px;
  border: 1px solid #fed7aa;
  border-radius: 4px;
  background: #fff7ed;
  color: #c2410c;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.05em;
}

.compute-badge i {
  font-size: 9px;
}

/* ── High-Res 解码组 ── */
.decode-highres {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.mini-highres {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mini-highres small {
  color: #6b7280;
  font-size: 12px;
  font-weight: 500;
}
</style>
