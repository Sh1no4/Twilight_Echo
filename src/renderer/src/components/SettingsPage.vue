<script setup lang="ts">
import { storeToRefs } from 'pinia'
import QRCode from 'qrcode'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MiniPlayerSettingsSection from './settings-page/MiniPlayerSettingsSection.vue'
import { useAudioOutputDspStore } from '../stores/useAudioOutputDspStore'
import { usePlaybackQueueStore } from '../stores/usePlaybackQueueStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useMusicStore } from '../stores/useMusicStore'
import { useExtensionRegistry, type UiContribution } from '../extensions/registry'
import { getPluginThemeKey } from '../extensions/themeSelection'
import {
  DSD_OUTPUT_MODE_OPTIONS,
  HIFI_STATUS_COPY,
  LOUDNORM_TARGET_LUFS,
  LOUDNORM_TRUE_PEAK_CEILING_DB,
  VOLUME_NORMALIZATION_OPTIONS,
  loudnormStatusCopy
} from '../../../shared/audioProcessingOptions.ts'
import type {
  AppSettings,
  AppTheme,
  AppBackgroundKind,
  AppBackgroundPage,
  ProxyMode,
  AudioCapabilitySupportState,
  AudioDeviceOption,
  AudioOutputId,
  AudioProcessingSettings,
  CardAppearanceSettings,
  CardAppearanceTheme,
  CardShadowStrength,
  CardHoverEffect,
  ChannelRoutingMode,
  DesktopLyricsLayout,
  DesktopLyricsSettings,
  DsdOutputMode,
  LyricAlign,
  MusicCachePolicySettings,
  NcmPlaybackQuality,
  OutputConfig,
  PlayerShortcutStatus,
  PlaybackResumeMode,
  StartupHomePage,
  AppBackgroundSettings,
  SacdProgramMode,
  StreamingAudioCachePolicy,
  UiDensity,
  VolumeNormalizationMode,
  WindowTransparencyEffectSettings
} from '../types/settings'
import type { LibraryWatcherStatusSnapshot } from '../../../shared/localLibraryScan.ts'

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
  | 'proxyAllowDirectFallback'
  | 'windowTransparency'
  | 'useCoverTheme'
  | 'globalShortcuts'
  | 'watchLibrary'
  | 'onlineLyricsFallback'
  | 'smtcEnabled'
  | 'discordRpcEnabled'
  | 'remoteControlEnabled'

const props = defineProps<{
  initialSection?: SectionKey
}>()

const emit = defineEmits<{
  back: []
  openEqualizer: []
  openDspRack: []
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

const ncmPlaybackQualityOptions: { value: NcmPlaybackQuality; label: string }[] = [
  { value: 'auto', label: '自动（最高可用）' },
  { value: 'standard', label: '标准' },
  { value: 'exhigh', label: '极高' },
  { value: 'lossless', label: '无损' },
  { value: 'hires', label: 'Hi-Res' }
]

const startupHomePageOptions: { value: StartupHomePage; label: string; icon: string }[] = [
  { value: 'local', label: '本地音乐主页', icon: 'pi pi-home' },
  { value: 'streaming', label: '流媒体主页', icon: 'pi pi-compass' }
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

const replayGainOptions = VOLUME_NORMALIZATION_OPTIONS
const dsdOutputModeOptions = DSD_OUTPUT_MODE_OPTIONS

const sacdProgramModeOptions: { value: SacdProgramMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'stereo', label: 'Stereo' },
  { value: 'multichannel', label: 'Multichannel' }
]

const fftResolutionOptions = [64, 128, 256, 512, 1024, 2048, 4096, 8192] as const

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

const appBackgroundPageOptions: { value: AppBackgroundPage; label: string; desc: string }[] = [
  { value: 'local', label: '本地主页', desc: '本地音乐首页和资料概览背景。' },
  { value: 'settings', label: '设置与插件', desc: '设置页、插件中心等管理界面背景。' },
  { value: 'streaming', label: '流媒体页', desc: '在线音乐浏览、搜索和详情页背景。' },
  { value: 'player', label: '播放页', desc: '沉浸式播放页和全屏播放背景。' }
]

const lyricAlignOptions: { value: LyricAlign; label: string }[] = [
  { value: 'center', label: '居中对齐' },
  { value: 'left', label: '靠左对齐' }
]

const streamingAudioCachePolicyOptions: {
  value: StreamingAudioCachePolicy
  label: string
}[] = [
  { value: 'provider', label: '由 Provider 规则控制' },
  { value: 'off', label: '不缓存流媒体音频' }
]

const GITHUB_URL = 'https://github.com/asenyarzc-cpu/Twilight_Echo'
const RELEASES_URL = 'https://github.com/asenyarzc-cpu/Twilight_Echo/releases'
const HOMEPAGE_URL = 'https://twilightecho.com'

const SETTINGS_SEARCH_INDEX: Array<{
  section: SectionKey
  title: string
  terms: string
}> = [
  { section: 'general', title: '媒体库与启动', terms: '常规 扫描 文件夹 监控 网易云 SMTC Discord 启动 托盘 代理 插件设置 备份 恢复 远程 遥控 PIN DLNA 投送 局域网' },
  { section: 'playback', title: '播放与输出', terms: '播放 输出 设备 独占 音量 削波 无缝 网易云 音质 无损 Hi-Res DSD SACD buffer routing' },
  { section: 'dsp', title: 'DSP 处理器', terms: 'DSP EQ ReplayGain Crossfeed Convolver FFT High-Res DSD SACD' },
  { section: 'cache', title: '缓存策略', terms: '缓存 目录 封面 歌词 元数据 流媒体 BPM 分析 清理' },
  { section: 'performance', title: '性能', terms: '性能 硬件加速 GPU 重启' },
  { section: 'appearance', title: '外观与主题', terms: '外观 主题 插件主题 强调色 背景 字体 密度 歌词 卡片 迷你播放器 自定义 圆角 缩放 布局' },
  { section: 'desktopLyrics', title: '桌面歌词', terms: '桌面歌词 字体 颜色 阴影 对齐 窗口 置顶 鼠标穿透 翻译 行偏移 错落 双语 原文' },
  { section: 'shortcuts', title: '快捷键', terms: '快捷键 全局 播放 暂停 上一首 下一首 注册 冲突' },
  { section: 'about', title: '关于与更新', terms: '关于 版本 更新 GitHub Releases 开源 致谢' }
]

const RESET_DESKTOP_LYRICS: DesktopLyricsSettings = {
  enabled: false,
  fontSize: 32,
  fontFamily: 'system',
  fontWeight: 700,
  color: '#ffffff',
  highlightColor: '#FFD700',
  bgColor: '#000000',
  bgOpacity: 30,
  align: 'center',
  showTranslation: true,
  layout: 'multi',
  lineSpacing: 1.6,
  shadow: true,
  shadowBlur: 8,
  shadowColor: '#000000',
  windowWidth: 900,
  windowHeight: 160,
  windowX: -1,
  windowY: -1,
  alwaysOnTop: true,
  clickThrough: false,
  maxLines: 2,
  lineOffset: 48
}

const updateCheckState = ref<'idle' | 'checking' | 'up-to-date' | 'available' | 'error'>('idle')
const latestVersion = ref('')
const lastUpdateCheck = ref('')
const runningPluginSettingsCommand = ref('')
const pluginSettingsResult = ref<Record<string, string>>({})
const pluginSettingsError = ref<Record<string, string>>({})
const settingsSearchQuery = ref('')
const settingsNotice = ref('')
const settingsError = ref('')
const importSettingsInputRef = ref<HTMLInputElement | null>(null)
const shortcutStatuses = ref<PlayerShortcutStatus[]>([])
const remoteStatus = ref<import('../../../shared/remoteControl.ts').RemoteControlStatus | null>(
  null
)
const remoteStatusError = ref('')
const remoteBusy = ref(false)
const remoteQrDataUrl = ref('')
const remoteQrUrl = ref('')

const activeSection = ref<SectionKey>(props.initialSection ?? 'general')
const pageRef = ref<HTMLElement | null>(null)
const customBackgroundOpen = ref(false)
const cardAppearanceOpen = ref(false)
const backgroundPageOpen = ref<AppBackgroundPage | null>(null)
const backgroundFileInputRef = ref<HTMLInputElement | null>(null)
const pendingBackgroundTarget = ref<'global' | AppBackgroundPage | null>(null)

const {
  settings,
  paths,
  appVersion,
  clearingCache,
  formattedCacheSize,
  clearingBpmAnalysisCache,
  formattedBpmAnalysisCacheSize,
  clearingLoudnessAnalysisCache,
  formattedLoudnessAnalysisCacheSize,
  restartRequired,
  restartReasons,
  loadSettings,
  updateSettings,
  chooseCacheFolder,
  importBackgroundImage,
  exportSettingsBackup: exportSettingsBackupFile,
  importSettingsBackup: importSettingsBackupFile,
  resetCacheFolder,
  refreshCacheSize,
  clearCache,
  refreshBpmAnalysisCacheSize,
  clearBpmAnalysisCache,
  refreshLoudnessAnalysisCacheSize,
  clearLoudnessAnalysisCache,
  getShortcutStatuses,
  relaunch,
  addLibraryFolder,
  removeLibraryFolder,
  openExternalUrl
} = useSettingsStore()

const audioOutputDspStore = useAudioOutputDspStore()
const playbackQueueStore = usePlaybackQueueStore()
const {
  libraryScanStatus,
  libraryScanProgress,
  libraryMetadataEnrichmentStatus,
  startFullLibraryScan,
  pauseLibraryScan,
  resumeLibraryScan,
  cancelLibraryScan,
  cancelLibraryMetadataEnrichment
} = useMusicStore()
const libraryScanCommandError = ref('')
const libraryWatcherStatus = ref<LibraryWatcherStatusSnapshot | null>(null)
let libraryWatcherStatusTimer: number | null = null

const libraryScanIsActive = computed(
  () => libraryScanStatus.value.state === 'running' || libraryScanStatus.value.state === 'paused'
)
const libraryMetadataEnrichmentIsActive = computed(
  () => libraryMetadataEnrichmentStatus.value.state === 'enriching'
)
const libraryScanProgressText = computed(() => {
  const status = libraryScanStatus.value
  if (status.state === 'failed') return status.error || '后台扫描失败'
  if (status.state === 'paused') return `已暂停：${status.current} / ${status.total || '?'} 项`
  if (status.state === 'running') {
    const phase = libraryScanProgress.value?.phase === 'parsing' ? '解析元数据' : '检查文件'
    return `${phase}：${status.current} / ${status.total || '?'} 项`
  }
  if (status.state === 'completed') {
    return `已完成：解析 ${status.parsedFileCount} 个文件，跳过 ${status.skippedUnchanged} 个未变化文件`
  }
  if (status.state === 'cancelled') return '扫描已取消，未提交未完成的结果'
  return '启动时仅核对 path、size 与 mtime；完整元数据重扫只由此处触发。'
})
const libraryMetadataEnrichmentText = computed(() => {
  const status = libraryMetadataEnrichmentStatus.value
  if (status.state === 'enriching') {
    return `后台富化中：已处理 ${status.completed + status.failed} / ${status.total} 首，${status.active} 项并发`
  }
  if (status.state === 'failed') return status.error || '后台元数据富化失败'
  if (status.state === 'completed') {
    return `后台富化完成：成功 ${status.completed} 首，跳过 ${status.skipped} 首`
  }
  if (status.state === 'cancelled') return '后台元数据富化已取消，迟到结果不会写回媒体库'
  return '新曲目会先显示，再在后台补齐封面、歌词和在线 metadata。'
})

function watcherStateLabel(state: string): string {
  switch (state) {
    case 'active':
      return '活跃'
    case 'degraded':
      return '降级轮询'
    case 'failed':
      return '失败'
    case 'disabled':
      return '已关闭'
    default:
      return state
  }
}

function watcherModeLabel(mode: string): string {
  switch (mode) {
    case 'recursive':
      return '递归监听'
    case 'polling':
      return '定时对账'
    case 'none':
      return '未监听'
    default:
      return mode
  }
}

function formatWatcherTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const delta = Date.now() - ms
  if (delta < 0) return '刚刚'
  const seconds = Math.floor(delta / 1000)
  if (seconds < 60) return `${seconds}s 前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} 小时前`
  return new Date(ms).toLocaleString()
}

async function refreshLibraryWatcherStatus(): Promise<void> {
  try {
    libraryWatcherStatus.value = await window.api.library.getWatcherStatus()
  } catch {
    libraryWatcherStatus.value = null
  }
}

async function runFullLibraryScan(): Promise<void> {
  libraryScanCommandError.value = ''
  try {
    await startFullLibraryScan()
  } catch (error) {
    libraryScanCommandError.value = scanCommandErrorMessage(error)
  }
}

async function pauseActiveLibraryScan(): Promise<void> {
  libraryScanCommandError.value = ''
  try {
    if (!(await pauseLibraryScan())) libraryScanCommandError.value = '当前没有可暂停的扫描'
  } catch (error) {
    libraryScanCommandError.value = scanCommandErrorMessage(error)
  }
}

async function resumeActiveLibraryScan(): Promise<void> {
  libraryScanCommandError.value = ''
  try {
    if (!(await resumeLibraryScan())) libraryScanCommandError.value = '当前没有可继续的扫描'
  } catch (error) {
    libraryScanCommandError.value = scanCommandErrorMessage(error)
  }
}

async function cancelActiveLibraryScan(): Promise<void> {
  libraryScanCommandError.value = ''
  try {
    if (!(await cancelLibraryScan())) libraryScanCommandError.value = '当前没有可取消的扫描'
  } catch (error) {
    libraryScanCommandError.value = scanCommandErrorMessage(error)
  }
}

function cancelActiveLibraryMetadataEnrichment(): void {
  libraryScanCommandError.value = ''
  if (!cancelLibraryMetadataEnrichment()) {
    libraryScanCommandError.value = '当前没有可取消的后台富化任务'
  }
}

function scanCommandErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '后台扫描操作失败'
}

const {
  exclusiveMode,
  audioOutput,
  audioDevice,
  audioOutputOptions,
  audioDeviceOptions,
  audioProcessing,
  audioOutputConfig,
  audioOutputConfigApplyStatus,
  playbackInfo,
  outputInfo,
  audioEngineError,
  loudnormStatus
} = storeToRefs(audioOutputDspStore)

const { volume } = storeToRefs(playbackQueueStore)

const {
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
  clearBpmAnalysisFromPlaybackState,
  toggleGapless
} = audioOutputDspStore

const { setVolume, setUnityVolume } = playbackQueueStore

const { syncExtensions, themeContributions, uiContributions } = useExtensionRegistry()


const loudnormStatusText = computed(() => {
  if (audioProcessing.value.volumeNormalization !== 'loudnorm') return ''
  return loudnormStatusCopy(loudnormStatus.value ?? 'idle')
})

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
const filteredSettingsSections = computed(() => {
  const query = settingsSearchQuery.value.trim().toLowerCase()
  if (!query) return []
  return SETTINGS_SEARCH_INDEX.filter((item) =>
    `${item.title} ${item.terms}`.toLowerCase().includes(query)
  )
})
const hasSettingsSearchResults = computed(
  () => settingsSearchQuery.value.trim().length > 0 && filteredSettingsSections.value.length > 0
)
const hasSettingsSearchNoResults = computed(
  () => settingsSearchQuery.value.trim().length > 0 && filteredSettingsSections.value.length === 0
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

function normalizeCapabilityState(
  state: AudioCapabilitySupportState | undefined
): AudioCapabilitySupportState {
  return state ?? 'unknown'
}

function capabilityStateLabel(state: AudioCapabilitySupportState | undefined): string {
  return {
    verified: '已验证',
    'runtime-probed': '运行时探测',
    unsupported: '不支持',
    unknown: '未知'
  }[normalizeCapabilityState(state)]
}

function capabilityStateTone(state: AudioCapabilitySupportState | undefined): string {
  return {
    verified: 'verified',
    'runtime-probed': 'runtime',
    unsupported: 'unsupported',
    unknown: 'unknown'
  }[normalizeCapabilityState(state)]
}

function capabilityStateTitle(device: AudioDeviceOption, label: string): string {
  const reason = device.capabilityReason?.trim()
  return reason ? `${label}: ${reason}` : label
}

function setProxyMode(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as ProxyMode
  void updateSettings({ proxyMode: value })
}

function setProxyHost(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  void updateSettings({ proxyHost: value })
}

function setProxyPort(event: Event): void {
  const value = parseInt((event.target as HTMLInputElement).value, 10)
  void updateSettings({ proxyPort: Number.isFinite(value) ? value : 0 })
}

function toggleSetting(key: BooleanSettingKey): void {
  void updateSettings({ [key]: !settings.value[key] } as Partial<AppSettings>)
  if (key === 'remoteControlEnabled') {
    void refreshRemoteStatus()
  }
}

async function refreshRemoteStatus(): Promise<void> {
  remoteStatusError.value = ''
  try {
    if (!window.api?.remote?.getStatus) {
      remoteStatus.value = null
      return
    }
    remoteStatus.value = await window.api.remote.getStatus()
  } catch (err) {
    remoteStatusError.value = err instanceof Error ? err.message : String(err)
  }
}

async function refreshRemoteQr(urls: string[] | undefined | null): Promise<void> {
  const primary = urls?.find((u) => typeof u === 'string' && u.trim()) ?? ''
  if (!primary) {
    remoteQrDataUrl.value = ''
    remoteQrUrl.value = ''
    return
  }
  if (primary === remoteQrUrl.value && remoteQrDataUrl.value) return
  try {
    remoteQrDataUrl.value = await QRCode.toDataURL(primary, {
      margin: 1,
      width: 160,
      errorCorrectionLevel: 'M'
    })
    remoteQrUrl.value = primary
  } catch {
    remoteQrDataUrl.value = ''
    remoteQrUrl.value = ''
  }
}

watch(
  () => remoteStatus.value?.urls,
  (urls) => {
    void refreshRemoteQr(urls)
  },
  { deep: true }
)

watch(
  () => settings.value.remoteControlEnabled,
  (enabled) => {
    if (!enabled) {
      remoteQrDataUrl.value = ''
      remoteQrUrl.value = ''
    }
  }
)

async function toggleRemoteControl(): Promise<void> {
  remoteBusy.value = true
  remoteStatusError.value = ''
  try {
    const next = !settings.value.remoteControlEnabled
    await updateSettings({ remoteControlEnabled: next })
    if (window.api?.remote?.setEnabled) {
      remoteStatus.value = await window.api.remote.setEnabled(next)
    } else {
      await refreshRemoteStatus()
    }
  } catch (err) {
    remoteStatusError.value = err instanceof Error ? err.message : String(err)
  } finally {
    remoteBusy.value = false
  }
}

async function rotateRemotePin(): Promise<void> {
  remoteBusy.value = true
  remoteStatusError.value = ''
  try {
    if (!window.api?.remote?.rotatePin) return
    const result = await window.api.remote.rotatePin()
    remoteStatus.value = result.status
  } catch (err) {
    remoteStatusError.value = err instanceof Error ? err.message : String(err)
  } finally {
    remoteBusy.value = false
  }
}

async function copyRemoteUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    settingsNotice.value = '已复制远程地址'
  } catch {
    settingsNotice.value = url
  }
}

async function toggleGlobalShortcuts(): Promise<void> {
  await updateSettings({ globalShortcuts: !settings.value.globalShortcuts })
  await refreshShortcutStatuses()
}

function toggleCacheArtifact(key: keyof MusicCachePolicySettings): void {
  if (key === 'streamingAudio') return
  void updateSettings({
    cachePolicy: {
      ...settings.value.cachePolicy,
      [key]: !settings.value.cachePolicy[key]
    }
  })
}

function setStreamingAudioCachePolicy(event: Event): void {
  const streamingAudio = (event.target as HTMLSelectElement).value as StreamingAudioCachePolicy
  void updateSettings({
    cachePolicy: {
      ...settings.value.cachePolicy,
      streamingAudio
    }
  })
}

function toggleAutoAnalyzeBpm(): void {
  void updateSettings({ autoAnalyzeBpm: !settings.value.autoAnalyzeBpm })
}

async function toggleDesktopLyrics(): Promise<void> {
  const enabled = await window.api.desktopLyrics.toggle()
  await updateSettings({ desktopLyrics: { ...settings.value.desktopLyrics, enabled } })
}

function resetSettingsGroup(group: 'appearance' | 'playback' | 'desktopLyrics'): void {
  if (!window.confirm(`恢复${group === 'appearance' ? '外观' : group === 'playback' ? '播放' : '桌面歌词'}设置为默认值？`)) return
  settingsNotice.value = ''
  settingsError.value = ''
  if (group === 'appearance') {
    void updateSettings({
      theme: 'system',
      pluginThemeId: null,
      blurEffect: true,
      useCoverTheme: true,
      lyricFontSize: 18,
      lyricAlign: 'center',
      lyricDimOpacity: 40,
      fontFamily: 'system',
      uiDensity: 'standard'
    }).then(() => {
      settingsNotice.value = '外观设置已恢复默认'
    })
    return
  }
  if (group === 'playback') {
    void updateSettings({
      playbackResumeMode: 'off',
      sleepTimer: { defaultMinutes: 30, fadeSeconds: 10 },
      ncmPlaybackQuality: 'auto',
      audioExclusiveMode: false,
      audioOutputConfig: {
        preferredBufferSize: 0,
        routingMode: 'auto',
        wasapiExclusivePushMode: false
      }
    }).then(() => {
      settingsNotice.value = '播放设置已恢复默认'
    })
    void setAudioProcessing({
      dspEnabled: false,
      clipGuard: true,
      fftEnabled: true,
      fftResolution: 8192,
      highResolution: true,
      dsdToPcm: false,
      dsdOutputMode: 'auto',
      sacdProgramMode: 'auto',
      eqEnabled: false,
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
    })
    return
  }
  void updateSettings({ desktopLyrics: { ...RESET_DESKTOP_LYRICS } }).then(() => {
    settingsNotice.value = '桌面歌词设置已恢复默认'
  })
}

function updateTp<K extends keyof WindowTransparencyEffectSettings>(
  key: K,
  value: WindowTransparencyEffectSettings[K]
): void {
  void updateSettings({
    windowTransparencyEffect: { ...settings.value.windowTransparencyEffect, [key]: value }
  })
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

function setStartupHomePage(startupHomePage: StartupHomePage): void {
  if (settings.value.startupHomePage === startupHomePage) return
  void updateSettings({ startupHomePage })
}

function setPlaybackResumeModeFromSelect(event: Event): void {
  setPlaybackResumeMode((event.target as HTMLSelectElement).value as PlaybackResumeMode)
}

function setSleepTimerDefaultMinutes(event: Event): void {
  const value = Math.trunc(Number((event.target as HTMLInputElement).value))
  if (!Number.isFinite(value)) return
  void updateSettings({
    sleepTimer: { ...settings.value.sleepTimer, defaultMinutes: Math.max(1, Math.min(720, value)) }
  })
}

function setSleepTimerFadeSeconds(event: Event): void {
  const value = Math.trunc(Number((event.target as HTMLInputElement).value))
  if (!Number.isFinite(value)) return
  void updateSettings({
    sleepTimer: { ...settings.value.sleepTimer, fadeSeconds: Math.max(0, Math.min(120, value)) }
  })
}

function setNcmPlaybackQuality(event: Event): void {
  void updateSettings({
    ncmPlaybackQuality: (event.target as HTMLSelectElement).value as NcmPlaybackQuality
  })
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
  if (audioOutputConfigApplyStatus.value.state === 'pending') return
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
  if (audioOutputConfigApplyStatus.value.state === 'pending') return
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

function setReplayGainFallback(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  updateAudioProcessing({ dspEnabled: true, replayGainFallback: value })
}

function toggleReplayGainClip(): void {
  updateAudioProcessing({ dspEnabled: true, replayGainClip: !audioProcessing.value.replayGainClip })
}

function setCrossfeedFromInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  void setCrossfeedStrength(value)
}

function setCrossfeedDelay(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  updateAudioProcessing({ dspEnabled: true, crossfeedDelayMs: value })
}

function setCrossfeedCutoff(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  updateAudioProcessing({ dspEnabled: true, crossfeedCutoffHz: value })
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

function toggleFftEnabled(): void {
  updateAudioProcessing({ fftEnabled: !audioProcessing.value.fftEnabled })
}

function setVolumeFromInput(event: Event): void {
  volumePercent.value = Number((event.target as HTMLInputElement).value)
}

function setCloseBehavior(event: Event): void {
  void updateSettings({ closeToTray: (event.target as HTMLSelectElement).value === 'tray' })
}

function setAccentColor(mode: 'light' | 'dark', color: string): void {
  if (mode === 'light') {
    if (settings.value.lightAccentColor === color) return
    void updateSettings({ accentColor: color, lightAccentColor: color })
    return
  }
  if (settings.value.darkAccentColor === color) return
  void updateSettings({ darkAccentColor: color })
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

function toBackgroundImageStyle(image: string): string {
  return image ? `url("${image.replace(/"/g, '\\"')}")` : 'none'
}

function cloneAppBackground(): AppBackgroundSettings {
  const background = settings.value.appBackground
  return {
    global: { ...background.global },
    pages: {
      local: { ...background.pages.local },
      settings: { ...background.pages.settings },
      streaming: { ...background.pages.streaming },
      player: { ...background.pages.player }
    }
  }
}

function setGlobalBackgroundColor(mode: 'light' | 'dark', color: string): void {
  if (settings.value.appBackground.global[mode] === color) return
  const appBackground = cloneAppBackground()
  appBackground.global[mode] = color
  void updateSettings({
    appBackground
  })
}

function setGlobalBackgroundKind(kind: AppBackgroundKind): void {
  if (settings.value.appBackground.global.kind === kind) return
  const appBackground = cloneAppBackground()
  appBackground.global.kind = kind
  void updateSettings({
    appBackground
  })
}

function openBackgroundFilePicker(target: 'global' | AppBackgroundPage): void {
  pendingBackgroundTarget.value = target
  backgroundFileInputRef.value?.click()
}

async function applyGlobalBackgroundImage(image: string): Promise<void> {
  const appBackground = cloneAppBackground()
  appBackground.global.kind = 'image'
  appBackground.global.image = image
  void updateSettings({
    appBackground
  })
}

async function handleBackgroundFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const target = pendingBackgroundTarget.value
  input.value = ''
  pendingBackgroundTarget.value = null
  if (!file || !target) return
  const image = await importBackgroundImage(file)
  if (!image) return
  if (target === 'global') {
    await applyGlobalBackgroundImage(image)
    return
  }
  await applyPageBackgroundImage(target, image)
}

function clearGlobalBackgroundImage(): void {
  if (!settings.value.appBackground.global.image && settings.value.appBackground.global.kind === 'color') return
  const appBackground = cloneAppBackground()
  appBackground.global.kind = 'color'
  appBackground.global.image = ''
  void updateSettings({
    appBackground
  })
}

function setPageBackgroundInherited(page: AppBackgroundPage, inherit: boolean): void {
  const current = settings.value.appBackground.pages[page]
  if (current.inherit === inherit) return
  const appBackground = cloneAppBackground()
  appBackground.pages[page].inherit = inherit
  void updateSettings({
    appBackground
  })
}

function setPageBackgroundKind(page: AppBackgroundPage, kind: AppBackgroundKind): void {
  const current = settings.value.appBackground.pages[page]
  if (current.kind === kind) return
  const appBackground = cloneAppBackground()
  appBackground.pages[page].inherit = false
  appBackground.pages[page].kind = kind
  void updateSettings({
    appBackground
  })
}

function setPageBackgroundColor(page: AppBackgroundPage, mode: 'light' | 'dark', color: string): void {
  const current = settings.value.appBackground.pages[page]
  if (current[mode] === color && !current.inherit) return
  const appBackground = cloneAppBackground()
  appBackground.pages[page].inherit = false
  appBackground.pages[page][mode] = color
  void updateSettings({
    appBackground
  })
}

async function applyPageBackgroundImage(page: AppBackgroundPage, image: string): Promise<void> {
  const appBackground = cloneAppBackground()
  appBackground.pages[page].inherit = false
  appBackground.pages[page].kind = 'image'
  appBackground.pages[page].image = image
  void updateSettings({
    appBackground
  })
}

function clearPageBackgroundImage(page: AppBackgroundPage): void {
  const current = settings.value.appBackground.pages[page]
  if (!current.image && current.kind === 'color') return
  const appBackground = cloneAppBackground()
  appBackground.pages[page].kind = 'color'
  appBackground.pages[page].image = ''
  void updateSettings({
    appBackground
  })
}

function toggleBackgroundPage(page: AppBackgroundPage): void {
  backgroundPageOpen.value = backgroundPageOpen.value === page ? null : page
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

const cardAppearanceTab = ref<'light' | 'dark'>('light')

const cardShadowOptions: { value: CardShadowStrength; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'subtle', label: '弱' },
  { value: 'medium', label: '中' },
  { value: 'strong', label: '强' }
]

const cardHoverOptions: { value: CardHoverEffect; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'lift', label: '上浮' },
  { value: 'zoom', label: '放大' },
  { value: 'glow', label: '发光' }
]

function cloneCardAppearance(): CardAppearanceSettings {
  const ca = settings.value.cardAppearance
  return {
    enabled: ca.enabled,
    light: { ...ca.light },
    dark: { ...ca.dark },
    background: {
      enabled: ca.background.enabled,
      light: { ...ca.background.light },
      dark: { ...ca.background.dark }
    }
  }
}

function toggleCardAppearance(): void {
  const cardAppearance = cloneCardAppearance()
  cardAppearance.enabled = !cardAppearance.enabled
  void updateSettings({ cardAppearance })
}

function toggleCardBackgroundEffect(): void {
  const cardAppearance = cloneCardAppearance()
  cardAppearance.background.enabled = !cardAppearance.background.enabled
  void updateSettings({ cardAppearance })
}

function setCardField<K extends keyof CardAppearanceTheme>(
  field: K,
  value: CardAppearanceTheme[K]
): void {
  const cardAppearance = cloneCardAppearance()
  const theme = cardAppearanceTab.value
  cardAppearance[theme][field] = value
  void updateSettings({ cardAppearance })
}

function setBgEffectField<K extends keyof (typeof settings.value.cardAppearance.background.light)>(
  field: K,
  value: number
): void {
  const cardAppearance = cloneCardAppearance()
  const theme = cardAppearanceTab.value
  ;(cardAppearance.background[theme] as any)[field] = value
  void updateSettings({ cardAppearance })
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

function pluginPanelStateKey(panel: UiContribution): string {
  return `${panel.pluginId}:${panel.id}`
}

async function runPluginSettingsPanel(panel: UiContribution): Promise<void> {
  const stateKey = pluginPanelStateKey(panel)
  if (!panel.command || runningPluginSettingsCommand.value) return
  runningPluginSettingsCommand.value = stateKey
  pluginSettingsError.value = { ...pluginSettingsError.value, [stateKey]: '' }
  pluginSettingsResult.value = { ...pluginSettingsResult.value, [stateKey]: '' }
  try {
    const result = await window.api.extensions.executeCommand(panel.command, [
      {
        source: 'settingsPanel',
        panelId: panel.id
      }
    ])
    pluginSettingsResult.value = {
      ...pluginSettingsResult.value,
      [stateKey]: result == null ? '已执行' : typeof result === 'string' ? result : JSON.stringify(result)
    }
  } catch (err) {
    pluginSettingsError.value = {
      ...pluginSettingsError.value,
      [stateKey]: err instanceof Error ? err.message : String(err)
    }
  } finally {
    runningPluginSettingsCommand.value = ''
  }
}

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

async function exportSettingsBackup(): Promise<void> {
  settingsNotice.value = ''
  settingsError.value = ''
  try {
    const json = await exportSettingsBackupFile()
    downloadTextFile(`twilight-echo-settings-${new Date().toISOString().slice(0, 10)}.json`, json)
    settingsNotice.value = '设置备份已导出'
  } catch (err) {
    settingsError.value = err instanceof Error ? err.message : String(err)
  }
}

function importSettingsBackup(): void {
  importSettingsInputRef.value?.click()
}

async function handleSettingsBackupSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!window.confirm('导入设置备份会覆盖当前设置。确认继续？')) return
  settingsNotice.value = ''
  settingsError.value = ''
  try {
    await importSettingsBackupFile(await file.text())
    await refreshShortcutStatuses()
    settingsNotice.value = '设置备份已导入'
  } catch (err) {
    settingsError.value = err instanceof Error ? err.message : String(err)
  }
}

async function confirmClearCache(): Promise<void> {
  if (
    !window.confirm(
      `确认清理缓存？\n\n当前估算：${formattedCacheSize.value}\n将删除封面、歌词、元数据和可复用流媒体缓存。用户固定的离线下载不会被删除。此操作不可恢复。`
    )
  ) {
    return
  }
  await clearCache()
}

async function confirmClearBpmAnalysisCache(): Promise<void> {
  if (
    !window.confirm(
      `确认清理 BPM 分析缓存？\n\n当前估算：${formattedBpmAnalysisCacheSize.value}\n已分析的歌曲下次播放时会重新后台分析。此操作不可恢复。`
    )
  ) {
    return
  }
  await clearBpmAnalysisCache()
  clearBpmAnalysisFromPlaybackState()
}

async function confirmClearLoudnessAnalysisCache(): Promise<void> {
  if (
    !window.confirm(
      `确认清理 Loudnorm / 响度分析缓存？\n\n当前估算：${formattedLoudnessAnalysisCacheSize.value}\n已测量的响度下次播放时会重新后台分析。此操作不可恢复。`
    )
  ) {
    return
  }
  await clearLoudnessAnalysisCache()
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

function openDspRackFromDsp(): void {
  emit('openDspRack')
}

function scrollToSection(section: SectionKey): void {
  activeSection.value = section
  document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function scrollToSearchResult(section: SectionKey): void {
  settingsSearchQuery.value = ''
  scrollToSection(section)
}

async function refreshShortcutStatuses(): Promise<void> {
  try {
    shortcutStatuses.value = await getShortcutStatuses()
  } catch (err) {
    shortcutStatuses.value = []
    settingsError.value = err instanceof Error ? err.message : String(err)
  }
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
  await Promise.all([refreshCacheSize(), refreshBpmAnalysisCacheSize(), refreshLoudnessAnalysisCacheSize()])
  await refreshShortcutStatuses()
  await refreshRemoteStatus()
  await syncExtensions()
  await refreshLibraryWatcherStatus()
  libraryWatcherStatusTimer = window.setInterval(() => {
    void refreshLibraryWatcherStatus()
  }, 5_000)
  await nextTick()
  pageRef.value?.addEventListener('scroll', updateActiveSection, { passive: true })
  if (props.initialSection && props.initialSection !== 'general') {
    scrollToSection(props.initialSection)
  }
})

onBeforeUnmount(() => {
  pageRef.value?.removeEventListener('scroll', updateActiveSection)
  if (libraryWatcherStatusTimer !== null) {
    window.clearInterval(libraryWatcherStatusTimer)
    libraryWatcherStatusTimer = null
  }
})
</script>

<template>
  <main ref="pageRef" class="settings-preview-page">
    <input
      ref="backgroundFileInputRef"
      class="visually-hidden-file-input"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      @change="handleBackgroundFileSelected"
    />
    <input
      ref="importSettingsInputRef"
      class="visually-hidden-file-input"
      type="file"
      accept="application/json,.json"
      @change="handleSettingsBackupSelected"
    />
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
        <section class="settings-command-bar glass-card">
          <div class="settings-search-box">
            <i class="pi pi-search"></i>
            <input
              v-model="settingsSearchQuery"
              type="search"
              placeholder="搜索设置、分区或说明"
              aria-label="搜索设置"
            />
          </div>
          <div class="settings-command-actions">
            <button type="button" class="soft-button" @click="exportSettingsBackup">
              <i class="pi pi-download"></i>
              导出设置
            </button>
            <button type="button" class="soft-button" @click="importSettingsBackup">
              <i class="pi pi-upload"></i>
              导入设置
            </button>
          </div>
          <div v-if="hasSettingsSearchResults" class="settings-search-results">
            <button
              v-for="result in filteredSettingsSections"
              :key="result.section"
              type="button"
              @click="scrollToSearchResult(result.section)"
            >
              <i :class="sections.find((section) => section.key === result.section)?.icon"></i>
              {{ result.title }}
            </button>
          </div>
          <div v-else-if="hasSettingsSearchNoResults" class="settings-search-empty">
            没有找到匹配的设置
          </div>
          <div v-if="settingsNotice" class="settings-inline-notice">{{ settingsNotice }}</div>
          <div v-if="settingsError" class="settings-inline-error">{{ settingsError }}</div>
        </section>

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
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>在线歌词回退 (LRCLIB)</strong>
                  <span>本地与 Provider 均无歌词时，按标题/艺人/时长搜索 LRCLIB 作为最后回退。默认关闭。</span>
                </div>
                <span
                  class="toggle-switch"
                  :class="{
                    active: settings.onlineLyricsFallback,
                    inactive: !settings.onlineLyricsFallback
                  }"
                  role="switch"
                  :aria-checked="settings.onlineLyricsFallback"
                  @click="toggleSetting('onlineLyricsFallback')"
                ></span>
              </div>
              <div
                v-if="settings.libraryFolders.length > 0"
                class="setting-item top-align watcher-status-panel"
              >
                <div class="setting-copy">
                  <strong>媒体库监控状态</strong>
                  <span>各根目录的监听状态；Linux 或失败时会自动降级为定时对账扫描。</span>
                </div>
                <div class="watcher-status-list" aria-live="polite">
                  <div
                    v-for="item in libraryWatcherStatus?.folders ??
                    settings.libraryFolders.map((folder) => ({
                      folder,
                      state: settings.watchLibrary ? 'failed' : 'disabled',
                      mode: 'none',
                      lastError: null,
                      lastEventAt: null,
                      lastReconcileAt: null
                    }))"
                    :key="item.folder"
                    class="watcher-status-row"
                  >
                    <span class="watcher-status-path" :title="item.folder">{{ item.folder }}</span>
                    <span class="watcher-status-badge" :data-state="item.state">
                      {{ watcherStateLabel(item.state) }}
                      · {{ watcherModeLabel(item.mode) }}
                    </span>
                    <span class="watcher-status-times">
                      事件 {{ formatWatcherTime(item.lastEventAt) }} · 对账
                      {{ formatWatcherTime(item.lastReconcileAt) }}
                    </span>
                    <span v-if="item.lastError" class="watcher-status-error">{{ item.lastError }}</span>
                  </div>
                </div>
              </div>
              <hr />
              <div class="setting-item top-align">
                <div class="setting-copy">
                  <strong>完整重扫</strong>
                  <span>显式重新解析全部本地文件的 metadata 与封面；可暂停或取消。</span>
                </div>
                <div class="library-scan-panel" aria-live="polite">
                  <progress
                    v-if="libraryScanIsActive"
                    class="library-scan-progress"
                    :value="libraryScanStatus.total > 0 ? libraryScanStatus.current : undefined"
                    :max="libraryScanStatus.total > 0 ? libraryScanStatus.total : 1"
                  ></progress>
                  <span class="library-scan-copy">{{ libraryScanProgressText }}</span>
                  <span class="library-scan-copy">{{ libraryMetadataEnrichmentText }}</span>
                  <span v-if="libraryScanCommandError" class="library-scan-error">
                    {{ libraryScanCommandError }}
                  </span>
                  <div class="library-scan-actions">
                    <button
                      type="button"
                      class="brand-soft-button"
                      :disabled="libraryScanIsActive"
                      @click="runFullLibraryScan"
                    >
                      完整重扫
                    </button>
                    <button
                      v-if="libraryScanStatus.state === 'running'"
                      type="button"
                      class="soft-button"
                      @click="pauseActiveLibraryScan"
                    >
                      暂停
                    </button>
                    <button
                      v-if="libraryScanStatus.state === 'paused'"
                      type="button"
                      class="soft-button"
                      @click="resumeActiveLibraryScan"
                    >
                      继续
                    </button>
                    <button
                      v-if="libraryScanIsActive"
                      type="button"
                      class="danger-soft-button"
                      @click="cancelActiveLibraryScan"
                    >
                      取消
                    </button>
                    <button
                      v-if="libraryMetadataEnrichmentIsActive"
                      type="button"
                      class="soft-button"
                      @click="cancelActiveLibraryMetadataEnrichment"
                    >
                      取消富化
                    </button>
                  </div>
                </div>
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
              <hr />
              <div class="setting-item top-align">
                <div class="setting-copy">
                  <strong>局域网远程控制</strong>
                  <span>
                    默认关闭。开启后在局域网提供 Web 遥控页（PIN 配对 + Token），并支持 DLNA 投送。
                  </span>
                </div>
                <span
                  class="toggle-switch"
                  :class="{
                    active: settings.remoteControlEnabled,
                    inactive: !settings.remoteControlEnabled
                  }"
                  role="switch"
                  :aria-checked="settings.remoteControlEnabled"
                  :aria-busy="remoteBusy"
                  @click="toggleRemoteControl"
                ></span>
              </div>
              <div v-if="settings.remoteControlEnabled" class="setting-item top-align remote-control-panel">
                <div class="setting-copy">
                  <strong>配对 PIN / 访问地址</strong>
                  <span>
                    状态：
                    {{
                      remoteStatus?.running
                        ? `运行中 · 端口 ${remoteStatus.port ?? '—'}`
                        : '未运行'
                    }}
                    <template v-if="remoteStatus?.paired"> · 已配对</template>
                    <template v-if="(remoteStatus?.clientCount ?? 0) > 0">
                      · {{ remoteStatus?.clientCount }} 客户端
                    </template>
                  </span>
                  <div v-if="remoteStatus?.pin" class="remote-pin-row">
                    <code class="remote-pin">{{ remoteStatus.pin }}</code>
                    <button
                      type="button"
                      class="soft-button"
                      :disabled="remoteBusy"
                      @click="rotateRemotePin"
                    >
                      更换 PIN
                    </button>
                    <button
                      type="button"
                      class="soft-button"
                      :disabled="remoteBusy"
                      @click="refreshRemoteStatus"
                    >
                      刷新
                    </button>
                  </div>
                  <div
                    v-if="remoteQrDataUrl || (remoteStatus?.urls?.length ?? 0) > 0"
                    class="remote-access-row"
                  >
                    <div v-if="remoteQrDataUrl" class="remote-qr-block">
                      <img
                        class="remote-qr"
                        :src="remoteQrDataUrl"
                        :alt="`远程控制二维码：${remoteQrUrl}`"
                        width="160"
                        height="160"
                      />
                      <span class="remote-qr-hint">手机扫码打开遥控页</span>
                    </div>
                    <ul v-if="(remoteStatus?.urls?.length ?? 0) > 0" class="remote-url-list">
                      <li v-for="url in remoteStatus?.urls ?? []" :key="url">
                        <button type="button" class="linkish" @click="copyRemoteUrl(url)">
                          {{ url }}
                        </button>
                      </li>
                    </ul>
                  </div>
                  <span v-if="remoteStatus?.lastError" class="remote-error">
                    {{ remoteStatus.lastError }}
                  </span>
                  <span v-if="remoteStatusError" class="remote-error">{{ remoteStatusError }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="section-block">
            <h3>启动与窗口 (Startup)</h3>
            <div class="setting-list">
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>启动后进入</strong>
                  <span>选择每次打开应用时默认显示的主页。</span>
                </div>
                <div class="segmented-control">
                  <button
                    v-for="option in startupHomePageOptions"
                    :key="option.value"
                    type="button"
                    :class="{ active: settings.startupHomePage === option.value }"
                    @click="setStartupHomePage(option.value)"
                  >
                    <i :class="option.icon"></i>
                    {{ option.label }}
                  </button>
                </div>
              </div>
              <hr />
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

          <div class="section-block">
            <h3>备份与恢复 (Backup & Reset)</h3>
            <div class="setting-list">
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>设置备份</strong>
                  <span>导出当前设置为 JSON，或从备份文件恢复；导入前会二次确认。</span>
                </div>
                <div class="inline-controls">
                  <button type="button" class="soft-button" @click="exportSettingsBackup">
                    <i class="pi pi-download"></i>
                    导出
                  </button>
                  <button type="button" class="soft-button" @click="importSettingsBackup">
                    <i class="pi pi-upload"></i>
                    导入
                  </button>
                </div>
              </div>
              <hr />
              <div class="setting-item top-align">
                <div class="setting-copy">
                  <strong>按分组恢复默认</strong>
                  <span>只重置选中的设置分组，不清空媒体库、插件和本地数据。</span>
                </div>
                <div class="inline-controls reset-group-actions">
                  <button type="button" class="muted-button" @click="resetSettingsGroup('appearance')">
                    外观
                  </button>
                  <button type="button" class="muted-button" @click="resetSettingsGroup('playback')">
                    播放
                  </button>
                  <button type="button" class="muted-button" @click="resetSettingsGroup('desktopLyrics')">
                    桌面歌词
                  </button>
                </div>
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
                    <small
                      v-if="pluginSettingsResult[pluginPanelStateKey(panel)]"
                      class="plugin-command-result"
                    >
                      {{ pluginSettingsResult[pluginPanelStateKey(panel)] }}
                    </small>
                    <small
                      v-if="pluginSettingsError[pluginPanelStateKey(panel)]"
                      class="plugin-command-error"
                    >
                      {{ pluginSettingsError[pluginPanelStateKey(panel)] }}
                    </small>
                  </div>
                  <button
                    type="button"
                    class="soft-button"
                    :disabled="!panel.command || Boolean(runningPluginSettingsCommand)"
                    @click="runPluginSettingsPanel(panel)"
                  >
                    <i v-if="panel.icon" :class="panel.icon"></i>
                    {{ runningPluginSettingsCommand === pluginPanelStateKey(panel) ? '执行中…' : '打开设置' }}
                  </button>
                </div>
              </template>
            </div>
          </div>
          <div class="section-block">
            <h3>网络代理 (Network Proxy)</h3>
            <div class="setting-list">
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>代理模式</strong>
                  <span>为流媒体插件（YouTube Music 等）配置 HTTP 代理，需重启后生效。</span>
                </div>
                <select
                  class="preview-select"
                  :value="settings.proxyMode"
                  @change="setProxyMode"
                >
                  <option value="auto">自动检测</option>
                  <option value="custom">自定义</option>
                  <option value="off">关闭</option>
                </select>
              </div>
              <template v-if="settings.proxyMode === 'custom'">
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>代理地址</strong>
                    <span>HTTP 代理服务器地址，不含协议前缀。</span>
                  </div>
                  <input
                    class="preview-select"
                    type="text"
                    placeholder="127.0.0.1"
                    :value="settings.proxyHost"
                    @change="setProxyHost"
                  />
                </div>
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>代理端口</strong>
                    <span>HTTP 代理服务器端口。</span>
                  </div>
                  <input
                    class="preview-select"
                    type="number"
                    placeholder="7897"
                    :value="settings.proxyPort || ''"
                    @change="setProxyPort"
                    min="0"
                    max="65535"
                  />
                </div>
              </template>
              <template v-if="settings.proxyMode !== 'off'">
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>代理失败时允许直连</strong>
                    <span>默认关闭。开启后代理连接失败才会尝试直连；已取消的请求永不回退。</span>
                  </div>
                  <span
                    class="toggle-switch"
                    :class="{
                      active: settings.proxyAllowDirectFallback,
                      inactive: !settings.proxyAllowDirectFallback
                    }"
                    role="switch"
                    :aria-checked="settings.proxyAllowDirectFallback"
                    @click="toggleSetting('proxyAllowDirectFallback')"
                  ></span>
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
                <div class="device-capability-row">
                  <span
                    class="device-capability-chip"
                    :class="capabilityStateTone(device.dopSupportState)"
                    :title="capabilityStateTitle(device, 'DoP')"
                  >
                    DoP {{ capabilityStateLabel(device.dopSupportState) }}
                  </span>
                  <span
                    class="device-capability-chip"
                    :class="capabilityStateTone(device.nativeDsdSupportState)"
                    :title="capabilityStateTitle(device, 'Native DSD')"
                  >
                    Native DSD {{ capabilityStateLabel(device.nativeDsdSupportState) }}
                  </span>
                </div>
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
                  <span>
                    {{ HIFI_STATUS_COPY.volumeNotUnityHint }}。低于 100% 会改变样本值。
                  </span>
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
                  <button
                    type="button"
                    class="soft-button"
                    :disabled="volumePercent >= 100"
                    title="将软件音量固定为 100%（Unity）"
                    @click="setUnityVolume"
                  >
                    {{ HIFI_STATUS_COPY.unityButton }}
                  </button>
                  <span
                    class="toggle-switch"
                    :class="{ active: audioProcessing.clipGuard, inactive: !audioProcessing.clipGuard }"
                    role="switch"
                    :aria-checked="audioProcessing.clipGuard"
                    title="削波保护"
                    @click="toggleClipGuard"
                  ></span>
                </div>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>无缝播放 (Gapless Playback)</strong>
                  <span>{{ HIFI_STATUS_COPY.gaplessNote }}</span>
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
              <hr />
              <div class="setting-item compact-row">
                <div class="setting-copy">
                  <strong>睡眠定时器</strong>
                  <span>播放器可按默认时长停止，或等待当前曲目、队列结束。</span>
                </div>
                <div class="inline-controls">
                  <label class="crossfade-group">
                    <span>默认分钟</span>
                    <input
                      class="number-input"
                      type="number"
                      min="1"
                      max="720"
                      :value="settings.sleepTimer.defaultMinutes"
                      @input="setSleepTimerDefaultMinutes"
                    />
                  </label>
                  <label class="crossfade-group">
                    <span>淡出秒数</span>
                    <input
                      class="number-input"
                      type="number"
                      min="0"
                      max="120"
                      :value="settings.sleepTimer.fadeSeconds"
                      @input="setSleepTimerFadeSeconds"
                    />
                  </label>
                </div>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>网易云播放音质</strong>
                  <span>自动按 Hi-Res、无损、极高和标准依次回退；也可固定为其中一档。</span>
                </div>
                <select
                  class="preview-select"
                  :value="settings.ncmPlaybackQuality"
                  @change="setNcmPlaybackQuality"
                >
                  <option
                    v-for="option in ncmPlaybackQualityOptions"
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
                  :disabled="audioOutputConfigApplyStatus.state === 'pending'"
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
                :aria-disabled="audioOutputConfigApplyStatus.state === 'pending'"
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
              <button class="brand-soft-button" type="button" @click="openDspRackFromDsp">
                <i class="pi pi-th-large"></i>
                打开 DSP Rack
              </button>
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
                <i class="pi pi-stop-circle"></i> DSP 旁路 (DSP Bypass)
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
                    <strong>音量标准化 (ReplayGain / Loudnorm)</strong>
                    <span>
                      {{
                        audioProcessing.volumeNormalization === 'loudnorm'
                          ? `EBU R128 Loudnorm · 缓存命中用测量增益（${LOUDNORM_TARGET_LUFS} LUFS / ${LOUDNORM_TRUE_PEAK_CEILING_DB} dBTP）；首次播放无缓存时用 Fallback 并后台测量`
                          : `响度归一化 · ${replayGainModeLabel}`
                      }}
                    </span>
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
                <p
                  v-if="loudnormStatusText"
                  class="setting-hint"
                  data-testid="settings-loudnorm-status"
                >
                  {{ loudnormStatusText }}
                </p>
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
                <div class="mini-setting">
                  <div>
                    <strong>Fallback Gain</strong>
                    <span>曲目缺少 ReplayGain/R128 标签时使用的增益 (dB)</span>
                  </div>
                  <input
                    class="number-input"
                    type="number"
                    step="0.1"
                    min="-12"
                    max="12"
                    :value="audioProcessing.replayGainFallback"
                    @input="setReplayGainFallback"
                  />
                </div>
                <div class="mini-setting">
                  <div>
                    <strong>ReplayGain Clip</strong>
                    <span>应用 ReplayGain 后限制到 [-1, 1]，避免标准化造成数字削波。</span>
                  </div>
                  <span
                    class="toggle-switch"
                    :class="{ active: audioProcessing.replayGainClip, inactive: !audioProcessing.replayGainClip }"
                    role="switch"
                    :aria-checked="audioProcessing.replayGainClip"
                    @click="toggleReplayGainClip"
                  ></span>
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
                    <strong>Crossfeed Delay</strong>
                    <span>左右声道串音延迟，范围 0.05-2.0 ms。</span>
                  </div>
                  <input
                    class="number-input"
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="2"
                    :value="audioProcessing.crossfeedDelayMs"
                    @input="setCrossfeedDelay"
                  />
                </div>
                <div class="mini-setting">
                  <div>
                    <strong>Crossfeed Cutoff</strong>
                    <span>串音低通截止频率，范围 80-4000 Hz。</span>
                  </div>
                  <input
                    class="number-input"
                    type="number"
                    step="10"
                    min="80"
                    max="4000"
                    :value="audioProcessing.crossfeedCutoffHz"
                    @input="setCrossfeedCutoff"
                  />
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
                    <span>FFT Capture</span>
                    <div class="mini-highres">
                      <select
                        class="preview-select"
                        :value="audioProcessing.fftResolution"
                        :disabled="!audioProcessing.fftEnabled"
                        @change="setFftResolution"
                      >
                        <option v-for="option in fftResolutionOptions" :key="option" :value="option">
                          {{ option }}
                        </option>
                      </select>
                      <span
                        class="toggle-switch"
                        :class="{ active: audioProcessing.fftEnabled, inactive: !audioProcessing.fftEnabled }"
                        role="switch"
                        :aria-checked="audioProcessing.fftEnabled"
                        @click="toggleFftEnabled"
                      ></span>
                    </div>
                  </label>
                  <label class="decode-highres">
                    <span>高解析度处理 (High-Res)</span>
                    <div class="mini-highres">
                      <small>High-Res 当前为自动链路能力，原生 DSP 链未消费手动开关。</small>
                      <span class="read-only-pill" title="当前版本暂未接入原生处理链">自动</span>
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
                <span>保存图片、歌词、在线资源和可复用的流媒体缓存；用户固定的离线下载独立保留。</span>
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
                <strong>封面缓存</strong>
                <span>允许本地库和 Provider 复用已获取的专辑封面。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.cachePolicy.cover, inactive: !settings.cachePolicy.cover }"
                role="switch"
                :aria-checked="settings.cachePolicy.cover"
                @click="toggleCacheArtifact('cover')"
              ></span>
            </div>
            <div class="setting-item">
              <div class="setting-copy">
                <strong>歌词缓存</strong>
                <span>缓存 LRC、翻译歌词和 Provider 返回的歌词增强结果。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.cachePolicy.lyrics, inactive: !settings.cachePolicy.lyrics }"
                role="switch"
                :aria-checked="settings.cachePolicy.lyrics"
                @click="toggleCacheArtifact('lyrics')"
              ></span>
            </div>
            <div class="setting-item">
              <div class="setting-copy">
                <strong>元数据缓存</strong>
                <span>缓存在线匹配得到的艺人、专辑和曲目信息，不覆盖本地文件身份。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.cachePolicy.metadata, inactive: !settings.cachePolicy.metadata }"
                role="switch"
                :aria-checked="settings.cachePolicy.metadata"
                @click="toggleCacheArtifact('metadata')"
              ></span>
            </div>
            <div class="setting-item">
              <div class="setting-copy">
                <strong>流媒体音频缓存</strong>
                <span>仅在插件和平台规则允许时缓存音频；关闭后 Provider 请求不会落盘音频。</span>
              </div>
              <select
                class="preview-select compact-select"
                :value="settings.cachePolicy.streamingAudio"
                @change="setStreamingAudioCachePolicy"
              >
                <option
                  v-for="option in streamingAudioCachePolicyOptions"
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
                <strong>BPM 自动分析</strong>
                <span>首次播放本地音频时在后台精算 BPM，并缓存结果供下次播放直接使用。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.autoAnalyzeBpm, inactive: !settings.autoAnalyzeBpm }"
                role="switch"
                :aria-checked="settings.autoAnalyzeBpm"
                @click="toggleAutoAnalyzeBpm"
              ></span>
            </div>
            <div class="setting-item">
              <div class="setting-copy">
                <strong>BPM 分析缓存</strong>
                <span>当前估算：<b>{{ formattedBpmAnalysisCacheSize }}</b></span>
              </div>
              <button
                class="danger-soft-button solid-hover"
                type="button"
                :disabled="clearingBpmAnalysisCache"
                @click="confirmClearBpmAnalysisCache"
              >
                <i class="pi pi-trash"></i>
                {{ clearingBpmAnalysisCache ? '清理中…' : '清理 BPM 缓存' }}
              </button>
            </div>
            <div class="setting-item">
              <div class="setting-copy">
                <strong>Loudnorm / 响度分析缓存</strong>
                <span>当前估算：<b>{{ formattedLoudnessAnalysisCacheSize }}</b> · 上限 512 条，命中 identity 跳过重测</span>
              </div>
              <button
                class="danger-soft-button solid-hover"
                type="button"
                :disabled="clearingLoudnessAnalysisCache"
                @click="confirmClearLoudnessAnalysisCache"
              >
                <i class="pi pi-trash"></i>
                {{ clearingLoudnessAnalysisCache ? '清理中…' : '清理响度缓存' }}
              </button>
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
                @click="confirmClearCache"
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
            <div class="setting-item">
              <div class="setting-copy">
                <strong>窗口透明</strong>
                <span>让窗口底层透明，显示系统模糊效果（Windows 11 22H2+ 使用原生亚克力模糊；Linux 需合成器支持，如 niri / Hyprland / KWin）。更改后需重启。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{ active: settings.windowTransparency, inactive: !settings.windowTransparency }"
                role="switch"
                :aria-checked="settings.windowTransparency"
                @click="toggleSetting('windowTransparency')"
              ></span>
            </div>
            <template v-if="settings.windowTransparency">
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>表面不透明度 (Surface Opacity)</strong>
                  <span>页面背景表面的不透明程度，越低越通透。</span>
                </div>
                <div class="inline-controls">
                  <input type="range" class="range-input" min="0" max="100" :value="settings.windowTransparencyEffect.surfaceOpacity"
                    @input="updateTp('surfaceOpacity', Number(($event.target as HTMLInputElement).value))" />
                  <span>{{ settings.windowTransparencyEffect.surfaceOpacity }}%</span>
                </div>
              </div>
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>表面模糊度 (Surface Blur)</strong>
                  <span>页面背景表面的应用内模糊强度。</span>
                </div>
                <div class="inline-controls">
                  <input type="range" class="range-input" min="0" max="60" :value="settings.windowTransparencyEffect.surfaceBlur"
                    @input="updateTp('surfaceBlur', Number(($event.target as HTMLInputElement).value))" />
                  <span>{{ settings.windowTransparencyEffect.surfaceBlur }}px</span>
                </div>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>卡片不透明度 (Card Opacity)</strong>
                  <span>卡片表面的不透明程度，越低越通透。</span>
                </div>
                <div class="inline-controls">
                  <input type="range" class="range-input" min="0" max="100" :value="settings.windowTransparencyEffect.cardOpacity"
                    @input="updateTp('cardOpacity', Number(($event.target as HTMLInputElement).value))" />
                  <span>{{ settings.windowTransparencyEffect.cardOpacity }}%</span>
                </div>
              </div>
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>卡片模糊度 (Card Blur)</strong>
                  <span>卡片表面的应用内模糊强度。</span>
                </div>
                <div class="inline-controls">
                  <input type="range" class="range-input" min="0" max="60" :value="settings.windowTransparencyEffect.cardBlur"
                    @input="updateTp('cardBlur', Number(($event.target as HTMLInputElement).value))" />
                  <span>{{ settings.windowTransparencyEffect.cardBlur }}px</span>
                </div>
              </div>
            </template>
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
                <strong>浅色强调色</strong>
                <span>浅色模式下设置、本地主页和主要控件使用的主题色。</span>
              </div>
              <div class="swatch-row">
                <span
                  v-for="option in accentColorOptions"
                  :key="option.value"
                  class="swatch"
                  :class="[option.class, { active: settings.lightAccentColor === option.value }]"
                  :title="option.label"
                  @click="setAccentColor('light', option.value)"
                >
                  <i v-if="settings.lightAccentColor === option.value" class="pi pi-check"></i>
                </span>
              </div>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>深色强调色</strong>
                <span>深色模式下复用同一组选项，可与浅色模式独立保存。</span>
              </div>
              <div class="swatch-row">
                <span
                  v-for="option in accentColorOptions"
                  :key="option.value"
                  class="swatch"
                  :class="[option.class, { active: settings.darkAccentColor === option.value }]"
                  :title="option.label"
                  @click="setAccentColor('dark', option.value)"
                >
                  <i v-if="settings.darkAccentColor === option.value" class="pi pi-check"></i>
                </span>
              </div>
            </div>
            <hr />
            <div class="setting-item top-align">
              <div class="setting-copy">
                <strong>自定义背景</strong>
                <span>控制整个 App 的统一主背景，可上传图片，也可给不同页面单独覆盖。</span>
              </div>
              <div class="background-accordion">
                <button
                  type="button"
                  class="background-accordion-trigger"
                  :class="{ active: customBackgroundOpen }"
                  @click="customBackgroundOpen = !customBackgroundOpen"
                >
                  <span>
                    {{ settings.appBackground.global.kind === 'image' && settings.appBackground.global.image ? '图片背景' : '纯色背景' }}
                  </span>
                  <i class="pi pi-chevron-down"></i>
                </button>
                <div v-if="customBackgroundOpen" class="background-accordion-panel">
                  <section class="background-editor">
                    <div class="background-editor-head">
                      <div>
                        <strong>统一背景</strong>
                        <span>深色模式默认 #17181a，图片模式下颜色会作为回退底色。</span>
                      </div>
                      <div class="background-kind-toggle">
                        <button
                          type="button"
                          :class="{ active: settings.appBackground.global.kind === 'color' }"
                          @click="setGlobalBackgroundKind('color')"
                        >
                          纯色
                        </button>
                        <button
                          type="button"
                          :class="{ active: settings.appBackground.global.kind === 'image' }"
                          @click="setGlobalBackgroundKind('image')"
                        >
                          图片
                        </button>
                      </div>
                    </div>
                    <div class="background-color-stack">
                      <label class="color-field">
                        <span>浅色</span>
                        <input
                          type="color"
                          :value="settings.appBackground.global.light"
                          @input="setGlobalBackgroundColor('light', ($event.target as HTMLInputElement).value)"
                        />
                        <code>{{ settings.appBackground.global.light }}</code>
                      </label>
                      <label class="color-field">
                        <span>深色</span>
                        <input
                          type="color"
                          :value="settings.appBackground.global.dark"
                          @input="setGlobalBackgroundColor('dark', ($event.target as HTMLInputElement).value)"
                        />
                        <code>{{ settings.appBackground.global.dark }}</code>
                      </label>
                    </div>
                    <div class="background-image-actions">
                      <span
                        v-if="settings.appBackground.global.image"
                        class="background-image-preview"
                        :style="{ backgroundImage: toBackgroundImageStyle(settings.appBackground.global.image) }"
                      ></span>
                      <button type="button" class="pill-action" @click="openBackgroundFilePicker('global')">
                        <i class="pi pi-image"></i>
                        <span>{{ settings.appBackground.global.image ? '更换图片' : '选择图片' }}</span>
                      </button>
                      <button
                        type="button"
                        class="pill-action ghost"
                        :disabled="!settings.appBackground.global.image"
                        @click="clearGlobalBackgroundImage"
                      >
                        移除图片
                      </button>
                      <small>{{ settings.appBackground.global.image ? '已选择图片' : '支持 JPG / PNG / WebP' }}</small>
                    </div>
                  </section>

                  <section class="background-editor">
                    <div class="background-editor-head">
                      <div>
                        <strong>页面背景覆盖</strong>
                        <span>默认继承统一背景，展开后可给单个页面单独设置纯色或图片。</span>
                      </div>
                    </div>
                    <div class="page-background-list">
                      <div
                        v-for="page in appBackgroundPageOptions"
                        :key="page.value"
                        class="page-background-row"
                        :class="{ expanded: backgroundPageOpen === page.value }"
                      >
                        <button
                          type="button"
                          class="page-background-header"
                          @click="toggleBackgroundPage(page.value)"
                        >
                          <span class="page-background-copy">
                            <strong>{{ page.label }}</strong>
                            <span>{{ page.desc }}</span>
                          </span>
                          <span class="page-background-state">
                            {{ settings.appBackground.pages[page.value].inherit ? '继承' : settings.appBackground.pages[page.value].kind === 'image' ? '图片' : '纯色' }}
                          </span>
                          <i class="pi pi-chevron-down"></i>
                        </button>
                        <div v-if="backgroundPageOpen === page.value" class="page-background-controls">
                          <button
                            type="button"
                            class="inherit-toggle"
                            :class="{ active: settings.appBackground.pages[page.value].inherit }"
                            @click="setPageBackgroundInherited(page.value, !settings.appBackground.pages[page.value].inherit)"
                          >
                            {{ settings.appBackground.pages[page.value].inherit ? '当前继承统一背景' : '当前使用自定义背景' }}
                          </button>
                          <div
                            class="background-kind-toggle"
                            :class="{ disabled: settings.appBackground.pages[page.value].inherit }"
                          >
                            <button
                              type="button"
                              :class="{ active: settings.appBackground.pages[page.value].kind === 'color' }"
                              @click="setPageBackgroundKind(page.value, 'color')"
                            >
                              纯色
                            </button>
                            <button
                              type="button"
                              :class="{ active: settings.appBackground.pages[page.value].kind === 'image' }"
                              @click="setPageBackgroundKind(page.value, 'image')"
                            >
                              图片
                            </button>
                          </div>
                          <div
                            class="background-color-stack compact"
                            :class="{ disabled: settings.appBackground.pages[page.value].inherit }"
                          >
                            <label class="color-field">
                              <span>浅色</span>
                              <input
                                type="color"
                                :value="settings.appBackground.pages[page.value].light"
                                @input="setPageBackgroundColor(page.value, 'light', ($event.target as HTMLInputElement).value)"
                              />
                              <code>{{ settings.appBackground.pages[page.value].light }}</code>
                            </label>
                            <label class="color-field">
                              <span>深色</span>
                              <input
                                type="color"
                                :value="settings.appBackground.pages[page.value].dark"
                                @input="setPageBackgroundColor(page.value, 'dark', ($event.target as HTMLInputElement).value)"
                              />
                              <code>{{ settings.appBackground.pages[page.value].dark }}</code>
                            </label>
                          </div>
                          <div
                            class="background-image-actions"
                            :class="{ disabled: settings.appBackground.pages[page.value].inherit }"
                          >
                            <span
                              v-if="settings.appBackground.pages[page.value].image"
                              class="background-image-preview"
                              :style="{ backgroundImage: toBackgroundImageStyle(settings.appBackground.pages[page.value].image) }"
                            ></span>
                            <button
                              type="button"
                              class="pill-action"
                              @click="openBackgroundFilePicker(page.value)"
                            >
                              <i class="pi pi-image"></i>
                              <span>{{ settings.appBackground.pages[page.value].image ? '更换图片' : '选择图片' }}</span>
                            </button>
                            <button
                              type="button"
                              class="pill-action ghost"
                              :disabled="!settings.appBackground.pages[page.value].image"
                              @click="clearPageBackgroundImage(page.value)"
                            >
                              移除图片
                            </button>
                            <small>{{ settings.appBackground.pages[page.value].image ? '已选择图片' : '未设置图片' }}</small>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
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
            <MiniPlayerSettingsSection />
            <hr />
            <button
              type="button"
              class="settings-accordion-trigger"
              :class="{ open: cardAppearanceOpen }"
              :aria-expanded="cardAppearanceOpen"
              @click="cardAppearanceOpen = !cardAppearanceOpen"
            >
              <span class="setting-copy">
                <strong>卡片与背景自定义</strong>
                <span>自由调节卡片模糊、颜色、圆角、阴影及背景模糊等外观。</span>
              </span>
              <i class="pi pi-chevron-down"></i>
            </button>
            <div v-if="cardAppearanceOpen" class="settings-accordion-body">
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>启用自定义外观</strong>
                  <span>开启后应用下方卡片与背景效果。</span>
                </div>
                <span
                  class="toggle-switch"
                  :class="{ active: settings.cardAppearance.enabled }"
                  role="switch"
                  :aria-checked="settings.cardAppearance.enabled"
                  @click="toggleCardAppearance"
                ></span>
              </div>
              <div v-if="settings.cardAppearance.enabled">
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>编辑主题</strong>
                    <span>分别设置浅色与深色模式下的卡片外观。</span>
                  </div>
                  <div class="theme-segment">
                    <button
                      type="button"
                      :class="{ active: cardAppearanceTab === 'light' }"
                      @click="cardAppearanceTab = 'light'"
                    >
                      <i class="pi pi-sun"></i>
                      浅色
                    </button>
                    <button
                      type="button"
                      :class="{ active: cardAppearanceTab === 'dark' }"
                      @click="cardAppearanceTab = 'dark'"
                    >
                      <i class="pi pi-moon"></i>
                      深色
                    </button>
                  </div>
                </div>
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>卡片模糊强度</strong>
                    <span>控制卡片毛玻璃的模糊半径。</span>
                  </div>
                  <div class="range-pill">
                    <span>模糊</span>
                    <input
                      class="range-input"
                      type="range"
                      min="0"
                      max="40"
                      :value="settings.cardAppearance[cardAppearanceTab].blurRadius"
                      @input="setCardField('blurRadius', Number(($event.target as HTMLInputElement).value))"
                    />
                    <span>{{ settings.cardAppearance[cardAppearanceTab].blurRadius }}px</span>
                  </div>
                </div>
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>卡片模糊饱和度</strong>
                    <span>增强或减弱毛玻璃的色彩饱和感。</span>
                  </div>
                  <div class="range-pill">
                    <span>饱和度</span>
                    <input
                      class="range-input"
                      type="range"
                      min="80"
                      max="180"
                      :value="settings.cardAppearance[cardAppearanceTab].blurSaturation"
                      @input="setCardField('blurSaturation', Number(($event.target as HTMLInputElement).value))"
                    />
                    <span>{{ settings.cardAppearance[cardAppearanceTab].blurSaturation }}%</span>
                  </div>
                </div>
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>卡片背景颜色</strong>
                    <span>自定义卡片的底色。</span>
                  </div>
                  <div class="inline-controls">
                    <input
                      type="color"
                      class="color-picker"
                      :value="settings.cardAppearance[cardAppearanceTab].backgroundColor"
                      @input="setCardField('backgroundColor', ($event.target as HTMLInputElement).value)"
                    />
                    <div class="range-pill">
                      <span>不透明度</span>
                      <input
                        class="range-input"
                        type="range"
                        min="0"
                        max="100"
                        :value="settings.cardAppearance[cardAppearanceTab].backgroundOpacity"
                        @input="setCardField('backgroundOpacity', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span>{{ settings.cardAppearance[cardAppearanceTab].backgroundOpacity }}%</span>
                    </div>
                  </div>
                </div>
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>卡片边框</strong>
                    <span>自定义边框颜色、透明度与宽度。</span>
                  </div>
                  <div class="inline-controls">
                    <input
                      type="color"
                      class="color-picker"
                      :value="settings.cardAppearance[cardAppearanceTab].borderColor"
                      @input="setCardField('borderColor', ($event.target as HTMLInputElement).value)"
                    />
                    <div class="range-pill">
                      <span>透明度</span>
                      <input
                        class="range-input"
                        type="range"
                        min="0"
                        max="100"
                        :value="settings.cardAppearance[cardAppearanceTab].borderOpacity"
                        @input="setCardField('borderOpacity', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span>{{ settings.cardAppearance[cardAppearanceTab].borderOpacity }}%</span>
                    </div>
                    <div class="range-pill">
                      <span>宽度</span>
                      <input
                        class="range-input"
                        type="range"
                        min="0"
                        max="3"
                        step="0.5"
                        :value="settings.cardAppearance[cardAppearanceTab].borderWidth"
                        @input="setCardField('borderWidth', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span>{{ settings.cardAppearance[cardAppearanceTab].borderWidth }}px</span>
                    </div>
                  </div>
                </div>
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>卡片圆角半径</strong>
                    <span>控制卡片边角的圆滑程度。</span>
                  </div>
                  <div class="range-pill">
                    <span>圆角</span>
                    <input
                      class="range-input"
                      type="range"
                      min="0"
                      max="24"
                      :value="settings.cardAppearance[cardAppearanceTab].borderRadius"
                      @input="setCardField('borderRadius', Number(($event.target as HTMLInputElement).value))"
                    />
                    <span>{{ settings.cardAppearance[cardAppearanceTab].borderRadius }}px</span>
                  </div>
                </div>
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>卡片阴影强度</strong>
                    <span>控制卡片投影的深浅。</span>
                  </div>
                  <div class="segmented-control">
                    <button
                      v-for="option in cardShadowOptions"
                      :key="option.value"
                      type="button"
                      :class="{ active: settings.cardAppearance[cardAppearanceTab].shadowStrength === option.value }"
                      @click="setCardField('shadowStrength', option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>卡片悬浮效果</strong>
                    <span>鼠标悬停时卡片的动效。</span>
                  </div>
                  <div class="segmented-control">
                    <button
                      v-for="option in cardHoverOptions"
                      :key="option.value"
                      type="button"
                      :class="{ active: settings.cardAppearance[cardAppearanceTab].hoverEffect === option.value }"
                      @click="setCardField('hoverEffect', option.value)"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>玻璃高光</strong>
                    <span>在卡片顶部添加内描边光泽。</span>
                  </div>
                  <span
                    class="toggle-switch"
                    :class="{ active: settings.cardAppearance[cardAppearanceTab].glassHighlight }"
                    role="switch"
                    :aria-checked="settings.cardAppearance[cardAppearanceTab].glassHighlight"
                    @click="setCardField('glassHighlight', !settings.cardAppearance[cardAppearanceTab].glassHighlight)"
                  ></span>
                </div>
                <hr />
                <div class="setting-item">
                  <div class="setting-copy">
                    <strong>背景模糊与暗化</strong>
                    <span>对 App 背景图片施加模糊、亮度调节与暗化遮罩。</span>
                  </div>
                  <span
                    class="toggle-switch"
                    :class="{ active: settings.cardAppearance.background.enabled }"
                    role="switch"
                    :aria-checked="settings.cardAppearance.background.enabled"
                    @click="toggleCardBackgroundEffect"
                  ></span>
                </div>
                <div v-if="settings.cardAppearance.background.enabled">
                  <hr />
                  <div class="setting-item">
                    <div class="setting-copy">
                      <strong>背景模糊</strong>
                      <span>模糊背景图片的半径。</span>
                    </div>
                    <div class="range-pill">
                      <span>模糊</span>
                      <input
                        class="range-input"
                        type="range"
                        min="0"
                        max="30"
                        :value="settings.cardAppearance.background[cardAppearanceTab].blur"
                        @input="setBgEffectField('blur', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span>{{ settings.cardAppearance.background[cardAppearanceTab].blur }}px</span>
                    </div>
                  </div>
                  <hr />
                  <div class="setting-item">
                    <div class="setting-copy">
                      <strong>背景亮度</strong>
                      <span>调暗或提亮背景图片。</span>
                    </div>
                    <div class="range-pill">
                      <span>亮度</span>
                      <input
                        class="range-input"
                        type="range"
                        min="50"
                        max="120"
                        :value="settings.cardAppearance.background[cardAppearanceTab].brightness"
                        @input="setBgEffectField('brightness', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span>{{ settings.cardAppearance.background[cardAppearanceTab].brightness }}%</span>
                    </div>
                  </div>
                  <hr />
                  <div class="setting-item">
                    <div class="setting-copy">
                      <strong>背景暗化遮罩</strong>
                      <span>叠加黑色遮罩使前景更突出。</span>
                    </div>
                    <div class="range-pill">
                      <span>暗化</span>
                      <input
                        class="range-input"
                        type="range"
                        min="0"
                        max="80"
                        :value="settings.cardAppearance.background[cardAppearanceTab].dim"
                        @input="setBgEffectField('dim', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span>{{ settings.cardAppearance.background[cardAppearanceTab].dim }}%</span>
                    </div>
                  </div>
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
                <strong>行水平偏移 (Line Offset)</strong>
                <span>多行时交错左右位置：正值=第1行偏左、第2行偏右；0 为对齐。</span>
              </div>
              <div class="inline-controls">
                <input type="range" class="range-input" min="-200" max="200" step="1"
                  :value="settings.desktopLyrics.lineOffset ?? 48"
                  @input="updateDl('lineOffset', Number(($event.target as HTMLInputElement).value))" />
                <span>{{ settings.desktopLyrics.lineOffset ?? 48 }}px</span>
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
                <strong>布局模式 (Layout)</strong>
                <span>多行：连续多句歌词；双语：第一行原文、第二行翻译（当前句）。</span>
              </div>
              <select
                class="preview-select wide"
                :value="settings.desktopLyrics.layout ?? 'multi'"
                @change="updateDl('layout', ($event.target as HTMLSelectElement).value as DesktopLyricsLayout)"
              >
                <option value="multi">多行歌词 (Multi)</option>
                <option value="bilingual">双语分行 (Original + Translation)</option>
              </select>
            </div>
            <hr />
            <div class="setting-item">
              <div class="setting-copy">
                <strong>显示翻译 (Show Translation)</strong>
                <span>多行模式下在原文下附带翻译；双语模式下控制是否显示第二行翻译。</span>
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
                @click="toggleGlobalShortcuts"
              ></span>
            </div>
            <hr />
            <div v-if="shortcutStatuses.length > 0" class="shortcut-grid">
              <div v-for="shortcut in shortcutStatuses" :key="shortcut.action">
                <span>{{ shortcut.label }}</span>
                <kbd>{{ shortcut.accelerator }}</kbd>
              </div>
            </div>
            <div v-else class="shortcut-grid">
              <div><span>快捷键状态</span><kbd>读取中</kbd></div>
            </div>
            <div v-if="shortcutStatuses.length > 0" class="shortcut-status-list">
              <div
                v-for="shortcut in shortcutStatuses"
                :key="`${shortcut.action}:status`"
                class="shortcut-status-row"
                :class="{
                  registered: settings.globalShortcuts && shortcut.registered,
                  failed: settings.globalShortcuts && !shortcut.registered
                }"
              >
                <span>
                  <i
                    :class="
                      !settings.globalShortcuts
                        ? 'pi pi-minus-circle'
                        : shortcut.registered
                          ? 'pi pi-check-circle'
                          : 'pi pi-exclamation-circle'
                    "
                  ></i>
                  {{ shortcut.label }}
                </span>
                <small>
                  {{
                    !settings.globalShortcuts
                      ? '未启用'
                      : shortcut.registered
                        ? '已注册'
                        : shortcut.error || '注册失败'
                  }}
                </small>
              </div>
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
                    @click="openReleases"
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
</style>

<style scoped src="./settings-page/SettingsPage.css"></style>





<style>

html[data-theme='dark'] .settings-preview-page {
  background-color: var(--te-settings-bg);
  background-image: var(--te-settings-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  color: rgba(248, 250, 252, 0.95);
}

html[data-theme='dark'] .settings-preview-page::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.28);
}

html[data-theme='dark'] .settings-preview-page::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.42);
}

html[data-theme='dark'] .settings-preview-page .preview-nav-item {
  color: rgba(148, 163, 184, 0.86);
}

html[data-theme='dark'] .settings-preview-page .preview-nav-item:hover,
html[data-theme='dark'] .settings-preview-page .preview-nav-item.active {
  border-color: rgba(var(--te-primary-rgb), 0.28);
  background: var(--te-card-bg);
  color: rgba(248, 250, 252, 0.95);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
}

html[data-theme='dark'] .settings-preview-page .glass-card,
html[data-theme='dark'] .settings-preview-page .device-panel,
html[data-theme='dark'] .settings-preview-page .device-card,
html[data-theme='dark'] .settings-preview-page .accordion-preview,
html[data-theme='dark'] .settings-preview-page .dsp-module-card,
html[data-theme='dark'] .settings-preview-page .dsp-meter,
html[data-theme='dark'] .settings-preview-page .folder-chip,
html[data-theme='dark'] .settings-preview-page .preview-select,
html[data-theme='dark'] .settings-preview-page .preview-select.wide,
html[data-theme='dark'] .settings-preview-page .select-control,
html[data-theme='dark'] .settings-preview-page .number-input,
html[data-theme='dark'] .settings-preview-page .path-control input,
html[data-theme='dark'] .settings-preview-page .plugin-empty,
html[data-theme='dark'] .settings-preview-page .range-pill,
html[data-theme='dark'] .settings-preview-page .shortcut-grid,
html[data-theme='dark'] .settings-preview-page .shortcut-grid kbd,
html[data-theme='dark'] .settings-preview-page .update-card,
html[data-theme='dark'] .settings-preview-page .about-links button,
html[data-theme='dark'] .settings-preview-page .output-diagnostic-panel,
html[data-theme='dark'] .settings-preview-page .preset-btn,
html[data-theme='dark'] .settings-preview-page .background-accordion,
html[data-theme='dark'] .settings-preview-page .background-editor,
html[data-theme='dark'] .settings-preview-page .background-kind-toggle,
html[data-theme='dark'] .settings-preview-page .color-field,
html[data-theme='dark'] .settings-preview-page .page-background-row,
html[data-theme='dark'] .settings-preview-page .page-background-row.expanded,
html[data-theme='dark'] .settings-preview-page .inherit-toggle,
html[data-theme='dark'] .settings-preview-page .pill-action.ghost,
html[data-theme='dark'] .settings-preview-page .dashed-button,
html[data-theme='dark'] .settings-preview-page .settings-search-box,
html[data-theme='dark'] .settings-preview-page .settings-search-empty,
html[data-theme='dark'] .settings-preview-page .shortcut-status-row,
html[data-theme='dark'] .settings-preview-page .read-only-pill {
  border-color: var(--te-card-border);
  background: var(--te-card-bg);
  color: rgba(226, 232, 240, 0.9);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
}

html[data-theme='dark'] .settings-preview-page .accordion-head,
html[data-theme='dark'] .settings-preview-page .accordion-body,
html[data-theme='dark'] .settings-preview-page .advanced-grid,
html[data-theme='dark'] .settings-preview-page .wasapi-push-row {
  border-color: var(--te-card-border);
  background: transparent;
}

html[data-theme='dark'] .settings-preview-page .setting-list hr,
html[data-theme='dark'] .settings-preview-page .about-section hr {
  background: var(--te-card-border);
}

html[data-theme='dark'] .settings-preview-page .segmented-control,
html[data-theme='dark'] .settings-preview-page .theme-segment {
  border-color: var(--te-card-border);
  background: var(--te-subtle-bg);
  box-shadow: none;
}

html[data-theme='dark'] .settings-preview-page .segmented-control button,
html[data-theme='dark'] .settings-preview-page .theme-segment button,
html[data-theme='dark'] .settings-preview-page .background-options button,
html[data-theme='dark'] .settings-preview-page .background-accordion-trigger,
html[data-theme='dark'] .settings-preview-page .background-kind-toggle button,
html[data-theme='dark'] .settings-preview-page .page-background-header,
html[data-theme='dark'] .settings-preview-page .settings-search-box input {
  color: rgba(148, 163, 184, 0.88);
}

html[data-theme='dark'] .settings-preview-page .segmented-control button.active,
html[data-theme='dark'] .settings-preview-page .theme-segment button.active,
html[data-theme='dark'] .settings-preview-page .background-kind-toggle button.active {
  background: var(--te-card-bg);
  color: rgba(248, 250, 252, 0.95);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
}

html[data-theme='dark'] .settings-preview-page .dsp-signal-chain {
  border-color: var(--te-card-border);
  background: var(--te-subtle-bg);
}

html[data-theme='dark'] .settings-preview-page .device-card:hover,
html[data-theme='dark'] .settings-preview-page .device-card.active {
  border-color: rgba(var(--te-primary-rgb), 0.42);
  background: rgba(var(--te-primary-rgb), 0.1);
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.32);
}

html[data-theme='dark'] .settings-preview-page .device-card > i {
  display: inline-flex;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: #07080a;
  color: var(--te-primary-400);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 10px 24px rgba(0, 0, 0, 0.26);
}

html[data-theme='dark'] .settings-preview-page .device-capability-chip {
  border-color: rgba(255, 255, 255, 0.08);
  background: #07080a;
  color: rgba(203, 213, 225, 0.86);
}

html[data-theme='dark'] .settings-preview-page .device-capability-chip.verified {
  border-color: rgba(34, 197, 94, 0.26);
  background: rgba(20, 83, 45, 0.34);
  color: #86efac;
}

html[data-theme='dark'] .settings-preview-page .device-capability-chip.runtime {
  border-color: rgba(var(--te-primary-rgb), 0.28);
  background: rgba(var(--te-primary-rgb), 0.16);
  color: var(--te-primary-300);
}

html[data-theme='dark'] .settings-preview-page .device-capability-chip.unsupported {
  border-color: rgba(248, 113, 113, 0.24);
  background: rgba(127, 29, 29, 0.3);
  color: #fca5a5;
}

html[data-theme='dark'] .settings-preview-page .device-capability-chip.unknown {
  border-color: rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.82);
  color: rgba(203, 213, 225, 0.78);
}

html[data-theme='dark'] .settings-preview-page .device-card > b {
  border: 1px solid rgba(var(--te-primary-rgb), 0.32);
  background: #07080a;
  color: var(--te-primary-300);
}

html[data-theme='dark'] .settings-preview-page .section-title-row h2,
html[data-theme='dark'] .settings-preview-page .setting-copy strong,
html[data-theme='dark'] .settings-preview-page .accordion-head strong,
html[data-theme='dark'] .settings-preview-page .device-panel-head h3,
html[data-theme='dark'] .settings-preview-page .device-card span,
html[data-theme='dark'] .settings-preview-page .dsp-meter strong,
html[data-theme='dark'] .settings-preview-page .mini-setting strong,
html[data-theme='dark'] .settings-preview-page .plugin-empty strong,
html[data-theme='dark'] .settings-preview-page .shortcut-grid span,
html[data-theme='dark'] .settings-preview-page .about-copy h3,
html[data-theme='dark'] .settings-preview-page .update-card strong,
html[data-theme='dark'] .settings-preview-page .background-editor-head strong,
html[data-theme='dark'] .settings-preview-page .page-background-copy strong,
html[data-theme='dark'] .settings-preview-page .signal-node.active .signal-node-name,
html[data-theme='dark'] .settings-preview-page .shortcut-status-row span {
  color: rgba(248, 250, 252, 0.95);
}

html[data-theme='dark'] .settings-preview-page .setting-copy span,
html[data-theme='dark'] .settings-preview-page .accordion-head span,
html[data-theme='dark'] .settings-preview-page .advanced-grid label span,
html[data-theme='dark'] .settings-preview-page .decode-grid label span,
html[data-theme='dark'] .settings-preview-page .dsp-meter small,
html[data-theme='dark'] .settings-preview-page .mini-setting span,
html[data-theme='dark'] .settings-preview-page .setting-hint,
html[data-theme='dark'] .settings-preview-page .folder-chip,
html[data-theme='dark'] .settings-preview-page .folder-empty-hint,
html[data-theme='dark'] .settings-preview-page .device-card small,
html[data-theme='dark'] .settings-preview-page .plugin-empty,
html[data-theme='dark'] .settings-preview-page .range-pill span,
html[data-theme='dark'] .settings-preview-page .shortcut-grid kbd,
html[data-theme='dark'] .settings-preview-page .about-copy p,
html[data-theme='dark'] .settings-preview-page .update-card span,
html[data-theme='dark'] .settings-preview-page .background-editor-head span,
html[data-theme='dark'] .settings-preview-page .background-image-actions small,
html[data-theme='dark'] .settings-preview-page .color-field span,
html[data-theme='dark'] .settings-preview-page .color-field code,
html[data-theme='dark'] .settings-preview-page .page-background-copy span,
html[data-theme='dark'] .settings-preview-page .page-background-state,
html[data-theme='dark'] .settings-preview-page .signal-node-name,
html[data-theme='dark'] .settings-preview-page .crossfade-group,
html[data-theme='dark'] .settings-preview-page .crossfeed-percent,
html[data-theme='dark'] .settings-preview-page .diagnostic-chain,
html[data-theme='dark'] .settings-preview-page .diagnostic-meta,
html[data-theme='dark'] .settings-preview-page .mini-highres small,
html[data-theme='dark'] .settings-preview-page .shortcut-status-row small {
  color: rgba(148, 163, 184, 0.82);
}

html[data-theme='dark'] .settings-preview-page .background-options span {
  border-color: var(--te-card-border);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2);
}

html[data-theme='dark'] .settings-preview-page .background-options button.active small {
  color: var(--te-primary-300);
}

html[data-theme='dark'] .settings-preview-page .signal-node-circle {
  border-color: rgba(148, 163, 184, 0.34);
  background: var(--te-card-bg);
}

html[data-theme='dark'] .settings-preview-page .signal-node-circle.active {
  border-color: var(--brand-500);
  background: rgba(var(--te-primary-rgb), 0.14);
}

html[data-theme='dark'] .settings-preview-page .signal-line {
  border-bottom-color: rgba(148, 163, 184, 0.34);
}

html[data-theme='dark'] .settings-preview-page .mini-setting + .mini-setting,
html[data-theme='dark'] .settings-preview-page .accordion-body,
html[data-theme='dark'] .settings-preview-page .advanced-grid,
html[data-theme='dark'] .settings-preview-page .wasapi-push-row {
  border-top-color: var(--te-card-border);
}

html[data-theme='dark'] .settings-preview-page .muted-button,
html[data-theme='dark'] .settings-preview-page .soft-button,
html[data-theme='dark'] .settings-preview-page .icon-button,
html[data-theme='dark'] .settings-preview-page .brand-soft-button,
html[data-theme='dark'] .settings-preview-page .inherit-toggle {
  border-color: var(--te-card-border);
  background: var(--te-subtle-bg);
  color: rgba(203, 213, 225, 0.9);
  box-shadow: none;
}

html[data-theme='dark'] .settings-preview-page .inherit-toggle.active {
  border-color: rgba(var(--te-primary-rgb), 0.34);
  background: rgba(var(--te-primary-rgb), 0.14);
  color: var(--te-primary-300);
}

html[data-theme='dark'] .settings-preview-page .dashed-button:hover,
html[data-theme='dark'] .settings-preview-page .brand-soft-button:hover,
html[data-theme='dark'] .settings-preview-page .preset-btn:hover,
html[data-theme='dark'] .settings-preview-page .settings-search-results button {
  border-color: rgba(var(--te-primary-rgb), 0.34);
  background: rgba(var(--te-primary-rgb), 0.14);
  color: var(--te-primary-300);
}

html[data-theme='dark'] .settings-preview-page .restart-banner,
html[data-theme='dark'] .settings-preview-page .engine-warning,
html[data-theme='dark'] .settings-preview-page .compute-badge,
html[data-theme='dark'] .settings-preview-page .sponsor-card,
html[data-theme='dark'] .settings-preview-page .sponsor-pending {
  border-color: rgba(245, 158, 11, 0.28);
  background: rgba(245, 158, 11, 0.12);
  color: #fbbf24;
}

html[data-theme='dark'] .settings-preview-page .restart-banner strong,
html[data-theme='dark'] .settings-preview-page .sponsor-card h3 {
  color: #fde68a;
}

html[data-theme='dark'] .settings-preview-page .restart-banner span,
html[data-theme='dark'] .settings-preview-page .sponsor-card p {
  color: rgba(253, 230, 138, 0.78);
}

html[data-theme='dark'] .settings-preview-page .engine-error {
  border-color: rgba(248, 113, 113, 0.34);
  background: rgba(127, 29, 29, 0.26);
  color: #fca5a5;
}

.settings-preview-page .remote-control-panel .remote-pin-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}

.settings-preview-page .remote-pin {
  font-size: 1.35rem;
  letter-spacing: 0.28em;
  font-weight: 700;
  padding: 6px 12px;
  border-radius: 10px;
  background: rgba(var(--te-primary-rgb), 0.12);
}

.settings-preview-page .remote-url-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.settings-preview-page .remote-url-list .linkish {
  border: 0;
  background: transparent;
  color: var(--te-primary-600, #2563eb);
  cursor: pointer;
  padding: 0;
  text-align: left;
  font: inherit;
  text-decoration: underline;
  word-break: break-all;
}

.settings-preview-page .remote-error {
  display: block;
  margin-top: 8px;
  color: #f87171;
  font-size: 0.9rem;
}
</style>
