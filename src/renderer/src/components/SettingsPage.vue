<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GeneralSettingsSection from './settings-page/GeneralSettingsSection.vue'
import AppearanceSettingsSection from './settings-page/AppearanceSettingsSection.vue'
import PlaybackSettingsSection from './settings-page/PlaybackSettingsSection.vue'
import CacheSettingsSection from './settings-page/CacheSettingsSection.vue'
import DesktopLyricsSettingsSection from './settings-page/DesktopLyricsSettingsSection.vue'
import AboutSettingsSection from './settings-page/AboutSettingsSection.vue'
import ShortcutsSettingsSection from './settings-page/ShortcutsSettingsSection.vue'
import EditableRangeValue from './EditableRangeValue.vue'
import AnimatedInput from './AnimatedInput.vue'
import {
  type SectionKey,
  type BooleanSettingKey,
  type SettingsSearchEntry,
  sections,
  startupHomePageOptions,
  trackActivationModeOptions,
  replayGainOptions,
  dsdOutputModeOptions,
  sacdProgramModeOptions,
  fftResolutionOptions,
  streamingAudioCachePolicyOptions,
  SETTINGS_SEARCH_INDEX,
  type PluginSettingsFieldType,
  type PluginSettingsOption,
  type PluginSettingsField,
  type PluginSettingsForm,
  RESET_DESKTOP_LYRICS
} from './settings-page/types.ts'
import { useAudioOutputDspStore } from '../stores/useAudioOutputDspStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useAppNoticeStore } from '../stores/useAppNoticeStore'
import { useThemeStore } from '../stores/useThemeStore'
import { useMusicStore } from '../stores/useMusicStore'
import { useExtensionRegistry, type UiContribution } from '../extensions/registry'
import {
  LOUDNORM_TARGET_LUFS,
  LOUDNORM_TRUE_PEAK_CEILING_DB,
  loudnormStatusCopy
} from '../../../shared/audioProcessingOptions.ts'
import type {
  AppSettings,
  AudioProcessingSettings,
  DesktopLyricsSettings,
  DsdOutputMode,
  MusicCachePolicySettings,
  PlayerShortcutStatus,
  GlobalShortcutSettings,
  StartupHomePage,
  TrackActivationMode,
  SacdProgramMode,
  StreamingAudioCachePolicy,
  VolumeNormalizationMode,
  WindowTransparencyEffectSettings
} from '../types/settings'
import type { LibraryWatcherStatusSnapshot } from '../../../shared/localLibraryScan.ts'
import type { Vst3CatalogState } from '../../../shared/dspGraph.ts'
import {
  DEFAULT_LYRICS_APPEARANCE,
  cloneLyricsAppearance
} from '../../../shared/lyricsAppearance.ts'
import { DEFAULT_PLAYER_BAR_SETTINGS, clonePlayerBarSettings } from '../../../shared/playerBar.ts'

const props = defineProps<{
  initialSection?: SectionKey
}>()

const emit = defineEmits<{
  back: []
  openEqualizer: []
  openDspRack: []
  openThemeStudio: []
  reopenOnboarding: []
}>()

const updateCheckState = ref<'idle' | 'checking' | 'up-to-date' | 'available' | 'error'>('idle')
const latestVersion = ref('')
const lastUpdateCheck = ref('')
const releaseUrl = ref('')
const updateAssetName = ref('')
const updateHasChecksum = ref(false)
const updateError = ref('')
const updateProgress = ref<import('../../../shared/appUpdate').AppUpdateProgress | null>(null)
const updateActionState = ref<'idle' | 'downloading' | 'ready' | 'installing' | 'error'>('idle')
let stopUpdateProgressListener: (() => void) | null = null
const runningPluginSettingsCommand = ref('')
const pluginSettingsResult = ref<Record<string, string>>({})
const pluginSettingsError = ref<Record<string, string>>({})

const pluginSettingsForms = ref<Record<string, PluginSettingsForm | null>>({})
const pluginSettingsValues = ref<Record<string, Record<string, string>>>({})
const settingsSearchQuery = ref('')
const settingsNotice = ref('')
const settingsError = ref('')
const importSettingsInputRef = ref<HTMLInputElement | null>(null)
const shortcutStatuses = ref<PlayerShortcutStatus[]>([])

const activeSection = ref<SectionKey>(props.initialSection ?? 'general')
const pageRef = ref<HTMLElement | null>(null)

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
  windowTransparencySupported,
  lastSettingsError,
  loadSettings,
  updateSettings,
  chooseCacheFolder,
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
  removeLibraryFolder
} = useSettingsStore()

const transparencyUnsupported = computed(
  () => settings.value.windowTransparency === true && windowTransparencySupported.value === false
)
const transparencySupported = computed(() => windowTransparencySupported.value === true)

const audioOutputDspStore = useAudioOutputDspStore()
const {
  libraryScanStatus,
  libraryScanProgress,
  libraryMetadataEnrichmentStatus,
  startFullLibraryScan,
  resetLibrary,
  pauseLibraryScan,
  resumeLibraryScan,
  cancelLibraryScan,
  cancelLibraryMetadataEnrichment,
  refreshLibraryIndex
} = useMusicStore()
const libraryScanCommandError = ref('')
const libraryResetPending = ref(false)
const libraryResetMessage = ref('')
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

async function resetLocalLibrary(): Promise<void> {
  libraryScanCommandError.value = ''
  libraryResetMessage.value = ''
  if (
    !window.confirm(
      '将清空本地媒体库索引和当前界面中的全部本地曲目。\n\n不会删除磁盘上的音乐文件，也不会删除播放列表；之后可通过“完整重扫”重新建立媒体库。\n\n确定重置吗？'
    )
  ) {
    return
  }

  libraryResetPending.value = true
  try {
    const removedCount = await resetLibrary()
    libraryResetMessage.value = `媒体库已重置，已从索引移除 ${removedCount} 首曲目；磁盘文件未删除。`
  } catch (error) {
    libraryScanCommandError.value = scanCommandErrorMessage(error)
  } finally {
    libraryResetPending.value = false
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

const { audioOutput, audioProcessing, playbackInfo, outputInfo, loudnormStatus } =
  storeToRefs(audioOutputDspStore)

const {
  setAudioProcessing,
  setReplayGainMode,
  setCrossfeedStrength,
  selectImpulseResponse,
  clearImpulseResponse,
  refreshAudioOutputState,
  clearBpmAnalysisFromPlaybackState
} = audioOutputDspStore

const { syncExtensions, uiContributions } = useExtensionRegistry()
const themeStore = useThemeStore()

const loudnormStatusText = computed(() => {
  if (audioProcessing.value.volumeNormalization !== 'loudnorm') return ''
  return loudnormStatusCopy(loudnormStatus.value ?? 'idle')
})

const activeCachePath = computed(
  () => paths.value?.activeCachePath ?? settings.value.cachePath ?? ''
)
const pluginSettingsPanels = computed(() =>
  uiContributions.value.filter((contribution) => contribution.kind === 'settingsPanel')
)
const activeSearchIndex = ref(-1)
const filteredSearchResults = computed(() => {
  const query = settingsSearchQuery.value.trim().toLowerCase()
  if (!query) return []
  const matches = SETTINGS_SEARCH_INDEX.map((entry) => {
    const title = entry.title.toLowerCase()
    const terms = entry.terms.toLowerCase()
    let score = 0
    if (title === query) score = 4
    else if (title.startsWith(query)) score = 3
    else if (title.includes(query)) score = 2
    else if (terms.includes(query)) score = 1
    return { entry, score }
  })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry)
  return matches
})
// 结果集变化时修正选中索引，避免越界
watch(filteredSearchResults, (matches) => {
  if (activeSearchIndex.value >= matches.length) {
    activeSearchIndex.value = matches.length > 0 ? 0 : -1
  }
})
const hasSettingsSearchResults = computed(
  () => settingsSearchQuery.value.trim().length > 0 && filteredSearchResults.value.length > 0
)
const hasSettingsSearchNoResults = computed(
  () => settingsSearchQuery.value.trim().length > 0 && filteredSearchResults.value.length === 0
)

// DSP 信号链状态
const eqChainActive = computed(
  () => audioProcessing.value.dspEnabled && audioProcessing.value.eqEnabled
)
const crossfeedChainActive = computed(
  () => audioProcessing.value.dspEnabled && audioProcessing.value.crossfeedEnabled
)
const convolverChainActive = computed(
  () => audioProcessing.value.dspEnabled && audioProcessing.value.convolverEnabled
)

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

async function setGenreSeparators(event: Event): Promise<void> {
  const value = (event.target as HTMLInputElement).value
  await updateSettings({ genreSeparators: value })
  refreshLibraryIndex()
}

function toggleSetting(key: BooleanSettingKey): void {
  if (key === 'windowTransparency' && !windowTransparencySupported.value) {
    settingsNotice.value =
      '当前系统不支持窗口透明（Linux Wayland，或 Windows 未开启系统透明效果），已自动使用不透明窗口。'
    return
  }
  void updateSettings({ [key]: !settings.value[key] } as Partial<AppSettings>)
}

const { pushNotice } = useAppNoticeStore()
watch(lastSettingsError, (error) => {
  if (!error) return
  settingsError.value = error
  pushNotice({
    kind: 'error',
    message: `设置保存失败：${error}`
  })
})

async function toggleGlobalShortcuts(): Promise<void> {
  await updateSettings({ globalShortcuts: !settings.value.globalShortcuts })
  await refreshShortcutStatuses()
}

async function onUpdateShortcutBindings(patch: Partial<GlobalShortcutSettings>): Promise<void> {
  await updateSettings({
    globalShortcutBindings: { ...settings.value.globalShortcutBindings, ...patch }
  })
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
  if (
    !window.confirm(
      `恢复${group === 'appearance' ? '外观' : group === 'playback' ? '播放' : '桌面歌词'}设置为默认值？`
    )
  )
    return
  settingsNotice.value = ''
  settingsError.value = ''
  if (group === 'appearance') {
    void (async () => {
      await themeStore.setActive({ kind: 'builtin', id: 'builtin:twilight-echo-default' })
      await updateSettings({
        theme: 'system',
        motionPreference: 'system',
        blurEffect: true,
        useCoverTheme: true,
        lyricsAppearance: cloneLyricsAppearance(DEFAULT_LYRICS_APPEARANCE),
        playerBar: clonePlayerBarSettings(DEFAULT_PLAYER_BAR_SETTINGS),
        fontFamily: 'system',
        uiDensity: 'standard'
      })
      settingsNotice.value = '外观设置已恢复默认'
    })().catch((cause) => {
      settingsError.value = cause instanceof Error ? cause.message : '外观设置恢复失败'
    })
    return
  }
  if (group === 'playback') {
    void updateSettings({
      playbackResumeMode: 'off',
      previousButtonAction: 'restart',
      sleepTimer: { defaultMinutes: 30, fadeSeconds: 10 },
      ncmPlaybackQuality: 'auto',
      audioExclusiveMode: false,
      audioOutputConfig: {
        preferredBufferSize: 0,
        routingMode: 'auto',
        wasapiExclusivePushMode: false,
        pcmToDsdMode: 'off'
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

function updateDesktopLyrics(patch: Partial<DesktopLyricsSettings>): void {
  if (settings.value.desktopLyrics) {
    Object.assign(settings.value.desktopLyrics, patch)
  }
  const dl = { ...settings.value.desktopLyrics, ...patch }
  void updateSettings({ desktopLyrics: dl })
}

function setStartupHomePage(startupHomePage: StartupHomePage): void {
  if (settings.value.startupHomePage === startupHomePage) return
  void updateSettings({ startupHomePage })
}

function setTrackActivationMode(trackActivationMode: TrackActivationMode): void {
  if (settings.value.trackActivationMode === trackActivationMode) return
  void updateSettings({ trackActivationMode })
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
  setCrossfeedPercent(value)
}

function setCrossfeedPercent(value: number): void {
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

async function selectDsdOutputMode(value: DsdOutputMode): Promise<void> {
  await setAudioProcessing({ dsdOutputMode: value, dsdToPcm: value === 'pcm' })
}

function setDsdOutputMode(event: Event): void {
  void selectDsdOutputMode((event.target as HTMLSelectElement).value as DsdOutputMode)
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

function setCloseBehavior(event: Event): void {
  void updateSettings({ closeToTray: (event.target as HTMLSelectElement).value === 'tray' })
}

function pluginPanelStateKey(panel: UiContribution): string {
  return `${panel.pluginId}:${panel.id}`
}

function normalizePluginSettingsForm(value: unknown): PluginSettingsForm | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.kind !== 'settings-form') return null
  const submitCommand = typeof record.submitCommand === 'string' ? record.submitCommand.trim() : ''
  if (!submitCommand || submitCommand.length > 160 || !Array.isArray(record.fields)) return null
  const fields = record.fields.slice(0, 20).flatMap((raw): PluginSettingsField[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const field = raw as Record<string, unknown>
    const key = typeof field.key === 'string' ? field.key.trim() : ''
    const label = typeof field.label === 'string' ? field.label.trim() : ''
    const type = field.type
    if (
      !/^[A-Za-z0-9_.:-]{1,80}$/.test(key) ||
      !label ||
      label.length > 100 ||
      !['text', 'password', 'url', 'select'].includes(String(type))
    ) {
      return []
    }
    const options = Array.isArray(field.options)
      ? field.options.slice(0, 30).flatMap((rawOption): PluginSettingsOption[] => {
          if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) return []
          const option = rawOption as Record<string, unknown>
          const optionLabel = typeof option.label === 'string' ? option.label.trim() : ''
          const optionValue = typeof option.value === 'string' ? option.value : ''
          if (!optionLabel || optionLabel.length > 100 || optionValue.length > 200) return []
          return [{ label: optionLabel, value: optionValue }]
        })
      : []
    if (type === 'select' && options.length === 0) return []
    return [
      {
        key,
        label,
        type: type as PluginSettingsFieldType,
        required: field.required === true,
        placeholder: typeof field.placeholder === 'string' ? field.placeholder.slice(0, 200) : '',
        value:
          type === 'password'
            ? ''
            : typeof field.value === 'string'
              ? field.value.slice(0, 4096)
              : '',
        options
      }
    ]
  })
  if (fields.length === 0) return null
  return {
    submitCommand,
    fields,
    notice: typeof record.notice === 'string' ? record.notice.slice(0, 500) : ''
  }
}

function setPluginSettingsField(panel: UiContribution, key: string, value: string): void {
  const stateKey = pluginPanelStateKey(panel)
  pluginSettingsValues.value = {
    ...pluginSettingsValues.value,
    [stateKey]: {
      ...(pluginSettingsValues.value[stateKey] ?? {}),
      [key]: value.slice(0, 4096)
    }
  }
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
    const form = normalizePluginSettingsForm(result)
    if (form) {
      pluginSettingsForms.value = { ...pluginSettingsForms.value, [stateKey]: form }
      pluginSettingsValues.value = {
        ...pluginSettingsValues.value,
        [stateKey]: Object.fromEntries(form.fields.map((field) => [field.key, field.value]))
      }
      pluginSettingsResult.value = { ...pluginSettingsResult.value, [stateKey]: '' }
      return
    }
    pluginSettingsForms.value = { ...pluginSettingsForms.value, [stateKey]: null }
    pluginSettingsResult.value = {
      ...pluginSettingsResult.value,
      [stateKey]:
        result == null ? '已执行' : typeof result === 'string' ? result : JSON.stringify(result)
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

async function submitPluginSettingsForm(panel: UiContribution): Promise<void> {
  const stateKey = pluginPanelStateKey(panel)
  const form = pluginSettingsForms.value[stateKey]
  if (!form || runningPluginSettingsCommand.value) return
  const values = pluginSettingsValues.value[stateKey] ?? {}
  const missingField = form.fields.find((field) => field.required && !values[field.key]?.trim())
  if (missingField) {
    pluginSettingsError.value = {
      ...pluginSettingsError.value,
      [stateKey]: `请填写${missingField.label}`
    }
    return
  }
  runningPluginSettingsCommand.value = stateKey
  pluginSettingsError.value = { ...pluginSettingsError.value, [stateKey]: '' }
  pluginSettingsResult.value = { ...pluginSettingsResult.value, [stateKey]: '' }
  try {
    const plainValues = JSON.parse(JSON.stringify(values)) as Record<string, string>
    const result = await window.api.extensions.executeCommand(form.submitCommand, [plainValues])
    const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : null
    const refreshedForm = normalizePluginSettingsForm(record?.form)
    if (refreshedForm) {
      pluginSettingsForms.value = { ...pluginSettingsForms.value, [stateKey]: refreshedForm }
      pluginSettingsValues.value = {
        ...pluginSettingsValues.value,
        [stateKey]: Object.fromEntries(
          refreshedForm.fields.map((field) => [field.key, field.value])
        )
      }
    } else {
      pluginSettingsValues.value = {
        ...pluginSettingsValues.value,
        [stateKey]: Object.fromEntries(
          form.fields.map((field) => [
            field.key,
            field.type === 'password' ? '' : (values[field.key] ?? '')
          ])
        )
      }
    }
    pluginSettingsResult.value = {
      ...pluginSettingsResult.value,
      [stateKey]:
        typeof record?.message === 'string'
          ? record.message.slice(0, 500)
          : result == null
            ? '设置已保存'
            : typeof result === 'string'
              ? result
              : '设置已保存'
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

function ensureUpdateProgressListener(): void {
  if (stopUpdateProgressListener) return
  stopUpdateProgressListener =
    window.api.app.onUpdateProgress?.((progress) => {
      updateProgress.value = progress
      if (
        progress.phase === 'downloading' ||
        progress.phase === 'resolving' ||
        progress.phase === 'verifying'
      ) {
        updateActionState.value = 'downloading'
      } else if (progress.phase === 'ready') {
        updateActionState.value = 'ready'
      } else if (progress.phase === 'installing') {
        updateActionState.value = 'installing'
      } else if (progress.phase === 'error') {
        updateActionState.value = 'error'
        updateError.value = progress.error || '更新失败'
      }
    }) || null
}

async function checkForUpdates(): Promise<void> {
  updateCheckState.value = 'checking'
  updateError.value = ''
  updateActionState.value = 'idle'
  updateProgress.value = null
  try {
    const result = await window.api.app.checkForUpdates()
    const now = new Date()
    lastUpdateCheck.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    latestVersion.value = result.latestVersion || ''
    releaseUrl.value = result.releaseUrl || ''
    updateAssetName.value = result.assetName || ''
    updateHasChecksum.value = Boolean(result.hasChecksum)
    if (result.error === 'network') {
      updateCheckState.value = 'error'
      updateError.value = '网络错误，无法检查更新'
    } else if (result.error === 'unsupported-platform') {
      updateCheckState.value = 'available'
      updateError.value = '发现新版本；当前平台请从发布页手动下载'
    } else if (result.error === 'no-asset') {
      updateCheckState.value = 'available'
      updateError.value = '发现新版本，但 Release 中未找到 Windows 安装包'
    } else if (result.error === 'no-checksum') {
      updateCheckState.value = 'error'
      updateError.value = '发现新版本，但 Release 未提供安装包 SHA-256 校验和，已拒绝下载'
    } else if (result.hasUpdate) {
      updateCheckState.value = 'available'
    } else {
      updateCheckState.value = 'up-to-date'
    }
  } catch {
    updateCheckState.value = 'error'
    updateError.value = '检查更新失败'
    releaseUrl.value = ''
  }
}

async function downloadUpdate(): Promise<void> {
  ensureUpdateProgressListener()
  updateError.value = ''
  updateActionState.value = 'downloading'
  updateProgress.value = {
    phase: 'resolving',
    percent: 0,
    receivedBytes: 0,
    totalBytes: 0,
    message: '正在准备下载…'
  }
  try {
    const result = await window.api.app.downloadUpdate()
    if (!result.ok) {
      updateActionState.value = result.cancelled ? 'idle' : 'error'
      updateError.value = result.error
      if (result.cancelled) updateProgress.value = null
      return
    }
    updateActionState.value = 'ready'
    updateAssetName.value = result.assetName
    updateHasChecksum.value = result.verified
  } catch (error) {
    updateActionState.value = 'error'
    updateError.value = error instanceof Error ? error.message : '下载失败'
  }
}

async function cancelUpdateDownload(): Promise<void> {
  try {
    await window.api.app.cancelUpdateDownload()
  } catch {
    // ignore
  }
  updateActionState.value = 'idle'
  updateProgress.value = null
  updateError.value = ''
}

async function installUpdate(): Promise<void> {
  updateError.value = ''
  const warnings: string[] = [
    '安装程序启动后本应用会退出。',
    'Windows 可能弹出 SmartScreen 或 UAC 提示，请选择官方签名包继续。'
  ]
  if (!updateHasChecksum.value) {
    warnings.push('此安装包未提供 SHA-256 校验和，无法验证完整性。')
  }
  if (
    !window.confirm(
      `${warnings.join('\n')}\n\n仅建议安装官方 GitHub Release 发布的签名安装包。\n确定继续安装并退出吗？`
    )
  ) {
    return
  }
  updateActionState.value = 'installing'
  try {
    const result = await window.api.app.installUpdate()
    if (!result.ok) {
      updateActionState.value = 'error'
      updateError.value = result.error
      const installerPath =
        'installerPath' in result && typeof result.installerPath === 'string'
          ? result.installerPath
          : updateProgress.value?.installerPath
      if (installerPath) {
        const openFolder = window.confirm(
          `${result.error}\n\n是否打开安装包所在文件夹以便手动安装？`
        )
        if (openFolder) {
          await window.api.shell.showItemInFolder(installerPath)
        }
      }
      return
    }
  } catch (error) {
    updateActionState.value = 'error'
    updateError.value = error instanceof Error ? error.message : '启动安装程序失败'
  }
}

function openReleasePage(): void {
  const url = releaseUrl.value || 'https://github.com/asenyarzc-cpu/Twilight_Echo/releases'
  void window.api?.shell?.openExternal?.(url)
}

async function exportAudioDiagnostics(): Promise<void> {
  try {
    const result = await window.api.audioEngine.exportDiagnostics()
    if (!result.filePath) return
    window.alert(`音频诊断日志已导出：\n${result.filePath}\n\n请将此 JSON 文件发给开发者。`)
  } catch (error) {
    window.alert(error instanceof Error ? error.message : '导出音频诊断日志失败')
  }
}

function toggleClipGuard(): void {
  updateAudioProcessing({ clipGuard: !audioProcessing.value.clipGuard })
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

// VST3 宿主设置（目录状态持久化在主进程 Vst3CatalogService，不新增设置字段）
const vst3Catalog = ref<Vst3CatalogState | null>(null)
const vst3Busy = ref(false)
const vst3Scanning = ref(false)
const vst3Error = ref('')

const vst3Enabled = computed(() => vst3Catalog.value?.enabled === true)
const vst3SearchPaths = computed(() => vst3Catalog.value?.searchPaths ?? [])
const vst3Helpers = computed(() => vst3Catalog.value?.helpers ?? null)
const vst3HelpersReady = computed(() => {
  if (!vst3Helpers.value) return true
  return (
    vst3Helpers.value.platformSupported &&
    vst3Helpers.value.scannerPresent &&
    vst3Helpers.value.hostPresent
  )
})
const vst3PlatformSupported = computed(() => vst3Helpers.value?.platformSupported !== false)
const vst3HelpersNotice = computed(() => {
  if (!vst3Catalog.value || vst3HelpersReady.value || !vst3Helpers.value) return ''
  if (!vst3Helpers.value.platformSupported) return 'VST3 仅在 Windows x64 构建中提供。'
  if (!vst3Helpers.value.scannerPresent || !vst3Helpers.value.hostPresent) {
    return '本构建未包含 VST3 扫描/宿主组件。开发环境请执行 pnpm run stage:vst3-msvc，或安装完整 Windows 签名包。'
  }
  return ''
})
const vst3ScanSummary = computed(() => {
  const catalog = vst3Catalog.value
  if (!catalog) return '尚未读取 VST3 目录状态'
  const total = catalog.entries.length
  if (total === 0) return '尚未发现任何 VST3 模块'
  const available = catalog.entries.filter((entry) => entry.status === 'available').length
  const quarantined = catalog.entries.filter((entry) => entry.status === 'quarantined').length
  const parts = [`共 ${total} 个模块`, `${available} 个可用`]
  if (quarantined > 0) parts.push(`${quarantined} 个已隔离`)
  return parts.join(' · ')
})

function vst3ErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'VST3 操作失败'
}

async function refreshVst3Catalog(): Promise<void> {
  if (!window.api?.audioEngine?.getVst3Catalog) return
  try {
    vst3Catalog.value = await window.api.audioEngine.getVst3Catalog()
    vst3Error.value = ''
  } catch (error) {
    vst3Error.value = vst3ErrorMessage(error)
  }
}

async function toggleVst3Enabled(): Promise<void> {
  if (vst3Busy.value || !vst3Catalog.value || !vst3PlatformSupported.value) return
  vst3Busy.value = true
  try {
    vst3Catalog.value = await window.api.audioEngine.setVst3Enabled(!vst3Catalog.value.enabled)
    vst3Error.value = ''
  } catch (error) {
    vst3Error.value = vst3ErrorMessage(error)
  } finally {
    vst3Busy.value = false
  }
}

async function addVst3SearchPath(): Promise<void> {
  if (vst3Busy.value || !vst3Catalog.value) return
  vst3Busy.value = true
  try {
    const selected = await window.api.audioEngine.selectVst3SearchPath()
    if (selected && !vst3SearchPaths.value.includes(selected)) {
      vst3Catalog.value = await window.api.audioEngine.setVst3SearchPaths([
        ...vst3SearchPaths.value,
        selected
      ])
    }
    vst3Error.value = ''
  } catch (error) {
    vst3Error.value = vst3ErrorMessage(error)
  } finally {
    vst3Busy.value = false
  }
}

async function removeVst3SearchPath(path: string): Promise<void> {
  if (vst3Busy.value || !vst3Catalog.value) return
  vst3Busy.value = true
  try {
    vst3Catalog.value = await window.api.audioEngine.setVst3SearchPaths(
      vst3SearchPaths.value.filter((candidate) => candidate !== path)
    )
    vst3Error.value = ''
  } catch (error) {
    vst3Error.value = vst3ErrorMessage(error)
  } finally {
    vst3Busy.value = false
  }
}

async function rescanVst3Plugins(): Promise<void> {
  if (vst3Scanning.value || !vst3Enabled.value) return
  vst3Scanning.value = true
  try {
    vst3Catalog.value = await window.api.audioEngine.scanVst3Plugins()
    vst3Error.value = ''
  } catch (error) {
    vst3Error.value = vst3ErrorMessage(error)
  } finally {
    vst3Scanning.value = false
  }
}

function scrollToSection(section: SectionKey): void {
  activeSection.value = section
  document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function scrollToSearchResult(entry: SettingsSearchEntry): void {
  settingsSearchQuery.value = ''
  scrollToSection(entry.section)
  // 定位到具体的设置项
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const sectionEl = document.getElementById(entry.section)
      if (!sectionEl) return
      const target = findSettingItem(sectionEl, entry)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      highlightSettingItem(target)
    })
  })
}

function findSettingItem(sectionEl: HTMLElement, entry: SettingsSearchEntry): HTMLElement | null {
  const matchText = (entry.match ?? entry.title).trim().toLowerCase()
  // 优先匹配 .setting-item（常规设置项）
  const settingItems = sectionEl.querySelectorAll<HTMLElement>('.setting-item')
  for (const item of settingItems) {
    const copy = item.querySelector('.setting-copy')
    const strong = copy?.querySelector('strong')
    if (strong && strong.textContent?.trim().toLowerCase().includes(matchText)) {
      return item
    }
  }
  // 回退：匹配 h3 区块标题（如 about 分区）
  const headings = sectionEl.querySelectorAll<HTMLElement>('h3')
  for (const heading of headings) {
    if (heading.textContent?.trim().toLowerCase().includes(matchText)) {
      return heading
    }
  }
  // 再回退：匹配任意 strong / span / button 文本（about 的更新卡、赞助卡等）
  const fallbacks = sectionEl.querySelectorAll<HTMLElement>('strong, span, button')
  for (const el of fallbacks) {
    if (el.textContent?.trim().toLowerCase().includes(matchText)) {
      return el
    }
  }
  return null
}

let searchHighlightTimer: number | null = null

function highlightSettingItem(item: HTMLElement | null): void {
  if (searchHighlightTimer !== null) {
    window.clearTimeout(searchHighlightTimer)
    searchHighlightTimer = null
  }
  document.querySelectorAll('.setting-item.search-target-flash').forEach((el) => {
    el.classList.remove('search-target-flash')
  })
  if (!item) return
  item.classList.add('search-target-flash')
  searchHighlightTimer = window.setTimeout(() => {
    item.classList.remove('search-target-flash')
    searchHighlightTimer = null
  }, 2200)
}

function moveSearchSelection(delta: number): void {
  const results = filteredSearchResults.value
  if (results.length === 0) return
  const next = activeSearchIndex.value + delta
  activeSearchIndex.value = ((next % results.length) + results.length) % results.length
}

function handleSettingsSearchEnter(): void {
  const results = filteredSearchResults.value
  if (results.length === 0) return
  const target =
    activeSearchIndex.value >= 0 && activeSearchIndex.value < results.length
      ? results[activeSearchIndex.value]
      : results[0]
  scrollToSearchResult(target)
}

function clearSettingsSearch(): void {
  settingsSearchQuery.value = ''
  activeSearchIndex.value = -1
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
  await Promise.all([loadSettings(), refreshAudioOutputState(), themeStore.load()])
  await Promise.all([
    refreshCacheSize(),
    refreshBpmAnalysisCacheSize(),
    refreshLoudnessAnalysisCacheSize()
  ])
  await refreshShortcutStatuses()
  await refreshVst3Catalog()
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
      ref="importSettingsInputRef"
      class="visually-hidden-file-input"
      type="file"
      accept="application/json,.json"
      @change="handleSettingsBackupSelected"
    />
    <div class="settings-preview-layout">
      <nav class="settings-preview-nav" aria-label="设置分区">
        <div class="settings-nav-search-wrap">
          <div class="settings-search-box settings-nav-search">
            <i class="pi pi-search"></i>
            <AnimatedInput
              v-model="settingsSearchQuery"
              type="text"
              class="settings-search-input"
              placeholder="搜索设置"
              aria-label="搜索设置"
              @focus="activeSearchIndex = filteredSearchResults.length > 0 ? 0 : -1"
              @keydown.down.prevent="moveSearchSelection(1)"
              @keydown.up.prevent="moveSearchSelection(-1)"
              @keydown.enter.prevent="handleSettingsSearchEnter"
              @keydown.esc.prevent="clearSettingsSearch"
            />
            <button
              v-if="settingsSearchQuery"
              type="button"
              class="settings-search-clear"
              @click="clearSettingsSearch"
              aria-label="清除搜索"
            >
              <i class="pi pi-times"></i>
            </button>
          </div>
          <div
            v-if="hasSettingsSearchResults"
            class="settings-nav-results"
            role="listbox"
            aria-label="搜索结果"
          >
            <button
              v-for="(result, index) in filteredSearchResults"
              :key="`${result.section}:${result.title}`"
              type="button"
              role="option"
              :aria-selected="activeSearchIndex === index"
              :class="{ active: activeSearchIndex === index }"
              @mouseenter="activeSearchIndex = index"
              @click="scrollToSearchResult(result)"
            >
              <i :class="sections.find((section) => section.key === result.section)?.icon"></i>
              <span class="settings-nav-result-title">{{ result.title }}</span>
              <small>{{ sections.find((section) => section.key === result.section)?.label }}</small>
            </button>
          </div>
          <div v-else-if="hasSettingsSearchNoResults" class="settings-nav-empty">
            没有找到匹配的设置
          </div>
        </div>
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
        <header class="settings-page-header">
          <h1 class="settings-page-title">设置</h1>
        </header>
        <section class="settings-command-bar glass-card">
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
          <div v-if="settingsNotice" class="settings-inline-notice">{{ settingsNotice }}</div>
          <div v-if="settingsError" class="settings-inline-error">{{ settingsError }}</div>
        </section>

        <div v-if="restartRequired" class="restart-banner restart-banner-sticky" role="status">
          <div>
            <strong>需要重启以应用更改</strong>
            <span>{{ restartReasons.join('、') }}</span>
          </div>
          <button class="brand-soft-button" type="button" @click="relaunch">
            <i class="pi pi-refresh"></i>
            立即重启
          </button>
        </div>

        <GeneralSettingsSection
          :library-watcher-status="libraryWatcherStatus"
          :library-scan-status="libraryScanStatus"
          :library-scan-is-active="libraryScanIsActive"
          :library-scan-progress-text="libraryScanProgressText"
          :library-metadata-enrichment-text="libraryMetadataEnrichmentText"
          :library-metadata-enrichment-is-active="libraryMetadataEnrichmentIsActive"
          :library-reset-message="libraryResetMessage"
          :library-scan-command-error="libraryScanCommandError"
          :library-reset-pending="libraryResetPending"
          :plugin-settings-panels="pluginSettingsPanels"
          :plugin-settings-result="pluginSettingsResult"
          :plugin-settings-error="pluginSettingsError"
          :plugin-settings-forms="pluginSettingsForms"
          :plugin-settings-values="pluginSettingsValues"
          :running-plugin-settings-command="runningPluginSettingsCommand"
          :plugin-panel-state-key="pluginPanelStateKey"
          :track-activation-mode-options="trackActivationModeOptions"
          :startup-home-page-options="startupHomePageOptions"
          :update-settings="updateSettings"
          :add-library-folder="addLibraryFolder"
          :remove-library-folder="removeLibraryFolder"
          :toggle-setting="toggleSetting"
          :set-genre-separators="setGenreSeparators"
          :set-track-activation-mode="setTrackActivationMode"
          :set-startup-home-page="setStartupHomePage"
          :set-close-behavior="setCloseBehavior"
          :watcher-state-label="watcherStateLabel"
          :watcher-mode-label="watcherModeLabel"
          :format-watcher-time="formatWatcherTime"
          :run-full-library-scan="runFullLibraryScan"
          :pause-active-library-scan="pauseActiveLibraryScan"
          :resume-active-library-scan="resumeActiveLibraryScan"
          :cancel-active-library-scan="cancelActiveLibraryScan"
          :reset-local-library="resetLocalLibrary"
          :cancel-active-library-metadata-enrichment="cancelActiveLibraryMetadataEnrichment"
          :export-settings-backup="exportSettingsBackup"
          :import-settings-backup="importSettingsBackup"
          :reset-settings-group="resetSettingsGroup"
          :run-plugin-settings-panel="runPluginSettingsPanel"
          :set-plugin-settings-field="setPluginSettingsField"
          :submit-plugin-settings-form="submitPluginSettingsForm"
          @reopen-onboarding="emit('reopenOnboarding')"
        />

        <PlaybackSettingsSection />

        <AppearanceSettingsSection @open-theme-studio="emit('openThemeStudio')" />

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
            <div
              class="signal-node"
              data-te-interactive
              role="switch"
              tabindex="0"
              aria-label="均衡器"
              :aria-checked="eqChainActive"
              :class="{ active: eqChainActive }"
              @click="toggleEqFromDsp"
              @keydown.enter.prevent="toggleEqFromDsp"
              @keydown.space.prevent="toggleEqFromDsp"
            >
              <div class="signal-node-circle" :class="{ active: eqChainActive }">
                <i class="pi pi-sliders-h"></i>
              </div>
              <span class="signal-node-label">{{ eqChainActive ? 'Active' : 'Bypass' }}</span>
              <span class="signal-node-name">EQ</span>
            </div>
            <div class="signal-line" :class="{ active: crossfeedChainActive }"></div>
            <div
              class="signal-node"
              data-te-interactive
              role="switch"
              tabindex="0"
              aria-label="Crossfeed"
              :aria-checked="crossfeedChainActive"
              :class="{ active: crossfeedChainActive }"
              @click="toggleCrossfeedFromDsp"
              @keydown.enter.prevent="toggleCrossfeedFromDsp"
              @keydown.space.prevent="toggleCrossfeedFromDsp"
            >
              <div class="signal-node-circle" :class="{ active: crossfeedChainActive }">
                <i class="pi pi-arrows-h"></i>
              </div>
              <span class="signal-node-label">{{
                crossfeedChainActive ? 'Active' : 'Bypass'
              }}</span>
              <span class="signal-node-name">CROSSFEED</span>
            </div>
            <div class="signal-line" :class="{ active: convolverChainActive }"></div>
            <div
              class="signal-node"
              data-te-interactive
              role="switch"
              tabindex="0"
              aria-label="卷积混响"
              :aria-checked="convolverChainActive"
              :class="{ active: convolverChainActive }"
              @click="toggleConvolver"
              @keydown.enter.prevent="toggleConvolver"
              @keydown.space.prevent="toggleConvolver"
            >
              <div class="signal-node-circle" :class="{ active: convolverChainActive }">
                <i class="pi pi-microchip"></i>
              </div>
              <span class="signal-node-label">{{
                convolverChainActive ? 'Active' : 'Bypass'
              }}</span>
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
                    :class="{
                      active: audioProcessing.clipGuard,
                      inactive: !audioProcessing.clipGuard
                    }"
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
                    :class="{
                      active: audioProcessing.replayGainClip,
                      inactive: !audioProcessing.replayGainClip
                    }"
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
                      :class="{
                        active: audioProcessing.eqEnabled,
                        inactive: !audioProcessing.eqEnabled
                      }"
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
                    <EditableRangeValue
                      :value="crossfeedPercent"
                      :min="0"
                      :max="100"
                      suffix="%"
                      aria-label="编辑耳机交叉馈电强度"
                      @change="setCrossfeedPercent"
                    />
                    <span
                      class="toggle-switch"
                      :class="{
                        active: audioProcessing.crossfeedEnabled,
                        inactive: !audioProcessing.crossfeedEnabled
                      }"
                      role="switch"
                      :aria-checked="audioProcessing.crossfeedEnabled"
                      @click="
                        updateAudioProcessing({
                          dspEnabled: true,
                          crossfeedEnabled: !audioProcessing.crossfeedEnabled
                        })
                      "
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
                    <button
                      class="soft-button compact"
                      type="button"
                      @click="selectImpulseResponse"
                    >
                      <i class="pi pi-folder-open"></i>
                      选择文件
                    </button>
                    <span
                      class="toggle-switch"
                      :class="{
                        active: audioProcessing.convolverEnabled,
                        inactive: !audioProcessing.convolverEnabled
                      }"
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
                        <option
                          v-for="option in fftResolutionOptions"
                          :key="option"
                          :value="option"
                        >
                          {{ option }}
                        </option>
                      </select>
                      <span
                        class="toggle-switch"
                        :class="{
                          active: audioProcessing.fftEnabled,
                          inactive: !audioProcessing.fftEnabled
                        }"
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

          <div class="dsp-module-card vst3-settings-card" data-testid="settings-vst3-card">
            <h3>VST3 插件 (VST3 Host)</h3>
            <div class="mini-setting">
              <div>
                <strong>启用 VST3 宿主</strong>
                <span>允许在 DSP Rack 中加载扫描到的 VST3 效果插件。仅 Windows x64 可用。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{
                  active: vst3Enabled,
                  inactive: !vst3Enabled,
                  disabled: !vst3Catalog || !vst3PlatformSupported || vst3Busy
                }"
                role="switch"
                data-testid="settings-vst3-toggle"
                :aria-checked="vst3Enabled"
                :aria-disabled="!vst3Catalog || !vst3PlatformSupported || vst3Busy"
                @click="toggleVst3Enabled"
              ></span>
            </div>
            <p v-if="vst3HelpersNotice" class="setting-hint" data-testid="settings-vst3-helpers">
              {{ vst3HelpersNotice }}
            </p>
            <div class="mini-setting top-align">
              <div>
                <strong>搜索目录</strong>
                <span>扫描 VST3 模块的目录列表。修改后需重新扫描才会生效。</span>
              </div>
              <div class="folder-list" data-testid="settings-vst3-paths">
                <div v-for="path in vst3SearchPaths" :key="path" class="folder-chip">
                  <span :title="path">{{ path }}</span>
                  <i
                    class="pi pi-times"
                    data-te-interactive
                    role="button"
                    tabindex="0"
                    :aria-label="`移除 VST3 搜索目录 ${path}`"
                    @click="removeVst3SearchPath(path)"
                    @keydown.enter.prevent="removeVst3SearchPath(path)"
                    @keydown.space.prevent="removeVst3SearchPath(path)"
                  ></i>
                </div>
                <div v-if="vst3SearchPaths.length === 0" class="folder-empty-hint">
                  暂未配置任何搜索目录
                </div>
                <button
                  type="button"
                  class="dashed-button"
                  :disabled="!vst3Catalog || vst3Busy"
                  @click="addVst3SearchPath"
                >
                  <i class="pi pi-plus"></i>
                  添加目录
                </button>
              </div>
            </div>
            <div class="mini-setting">
              <div>
                <strong>插件目录状态</strong>
                <span data-testid="settings-vst3-summary">{{ vst3ScanSummary }}</span>
              </div>
              <button
                class="soft-button compact"
                type="button"
                data-testid="settings-vst3-rescan"
                :disabled="!vst3Enabled || vst3Scanning || !vst3HelpersReady"
                @click="rescanVst3Plugins"
              >
                <i class="pi pi-refresh" :class="{ 'pi-spin': vst3Scanning }"></i>
                {{ vst3Scanning ? '扫描中…' : '重新扫描' }}
              </button>
            </div>
            <p v-if="vst3Error" class="setting-hint" data-testid="settings-vst3-error">
              {{ vst3Error }}
            </p>
          </div>
        </section>

        <CacheSettingsSection
          :active-cache-path="activeCachePath"
          :cache-policy="settings.cachePolicy"
          :auto-analyze-bpm="settings.autoAnalyzeBpm"
          :streaming-audio-cache-policy-options="streamingAudioCachePolicyOptions"
          :formatted-bpm-analysis-cache-size="formattedBpmAnalysisCacheSize"
          :clearing-bpm-analysis-cache="clearingBpmAnalysisCache"
          :formatted-loudness-analysis-cache-size="formattedLoudnessAnalysisCacheSize"
          :clearing-loudness-analysis-cache="clearingLoudnessAnalysisCache"
          :formatted-cache-size="formattedCacheSize"
          :clearing-cache="clearingCache"
          @choose-cache-folder="chooseCacheFolder"
          @reset-cache-folder="resetCacheFolder"
          @toggle-cache-artifact="toggleCacheArtifact"
          @set-streaming-audio-cache-policy="setStreamingAudioCachePolicy"
          @toggle-auto-analyze-bpm="toggleAutoAnalyzeBpm"
          @confirm-clear-bpm-analysis-cache="confirmClearBpmAnalysisCache"
          @confirm-clear-loudness-analysis-cache="confirmClearLoudnessAnalysisCache"
          @confirm-clear-cache="confirmClearCache"
        />

        <section id="performance" class="glass-card preview-section">
          <div class="section-title-row">
            <i class="pi pi-bolt"></i>
            <h2>性能 (Performance)</h2>
          </div>
          <div class="setting-list">
            <div class="setting-item">
              <div class="setting-copy">
                <strong>硬件加速</strong>
                <span>使用 GPU 加速界面渲染、动画与模糊效果。</span>
              </div>
              <span
                class="toggle-switch"
                :class="{
                  active: settings.hardwareAcceleration,
                  inactive: !settings.hardwareAcceleration
                }"
                role="switch"
                :aria-checked="settings.hardwareAcceleration"
                @click="toggleSetting('hardwareAcceleration')"
              ></span>
            </div>
            <div class="setting-item">
              <div class="setting-copy">
                <strong>窗口透明</strong>
                <span
                  >让窗口底层透明，显示系统模糊效果（Windows 11 22H2+ 使用原生亚克力模糊；Linux X11
                  需合成器支持，如 KWin / picom；Linux Wayland、以及 Windows
                  未开启系统透明效果时暂不支持）。更改后需重启。</span
                >
              </div>
              <span
                class="toggle-switch"
                :class="{
                  active: settings.windowTransparency,
                  inactive: !settings.windowTransparency,
                  disabled: !transparencySupported
                }"
                role="switch"
                :aria-checked="settings.windowTransparency"
                :aria-disabled="!transparencySupported"
                @click="toggleSetting('windowTransparency')"
              ></span>
            </div>
            <div v-if="transparencyUnsupported" class="settings-inline-warning" role="status">
              当前系统不支持透明窗口（Linux Wayland，或 Windows
              未开启系统透明效果），已自动回退为不透明窗口，应用仍可正常使用。
            </div>
            <template v-if="settings.windowTransparency && transparencySupported">
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>表面不透明度 (Surface Opacity)</strong>
                  <span>页面背景表面的不透明程度，越低越通透。</span>
                </div>
                <div class="inline-controls">
                  <input
                    type="range"
                    class="range-input"
                    min="0"
                    max="100"
                    :value="settings.windowTransparencyEffect.surfaceOpacity"
                    @input="
                      updateTp('surfaceOpacity', Number(($event.target as HTMLInputElement).value))
                    "
                  />
                  <EditableRangeValue
                    :value="settings.windowTransparencyEffect.surfaceOpacity"
                    :min="0"
                    :max="100"
                    suffix="%"
                    aria-label="编辑表面不透明度"
                    @change="updateTp('surfaceOpacity', $event)"
                  />
                </div>
              </div>
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>表面模糊度 (Surface Blur)</strong>
                  <span>页面背景表面的应用内模糊强度。</span>
                </div>
                <div class="inline-controls">
                  <input
                    type="range"
                    class="range-input"
                    min="0"
                    max="60"
                    :value="settings.windowTransparencyEffect.surfaceBlur"
                    @input="
                      updateTp('surfaceBlur', Number(($event.target as HTMLInputElement).value))
                    "
                  />
                  <EditableRangeValue
                    :value="settings.windowTransparencyEffect.surfaceBlur"
                    :min="0"
                    :max="60"
                    suffix="px"
                    aria-label="编辑表面模糊度"
                    @change="updateTp('surfaceBlur', $event)"
                  />
                </div>
              </div>
              <hr />
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>卡片不透明度 (Card Opacity)</strong>
                  <span>卡片表面的不透明程度，越低越通透。</span>
                </div>
                <div class="inline-controls">
                  <input
                    type="range"
                    class="range-input"
                    min="0"
                    max="100"
                    :value="settings.windowTransparencyEffect.cardOpacity"
                    @input="
                      updateTp('cardOpacity', Number(($event.target as HTMLInputElement).value))
                    "
                  />
                  <EditableRangeValue
                    :value="settings.windowTransparencyEffect.cardOpacity"
                    :min="0"
                    :max="100"
                    suffix="%"
                    aria-label="编辑卡片不透明度"
                    @change="updateTp('cardOpacity', $event)"
                  />
                </div>
              </div>
              <div class="setting-item">
                <div class="setting-copy">
                  <strong>卡片模糊度 (Card Blur)</strong>
                  <span>卡片表面的应用内模糊强度。</span>
                </div>
                <div class="inline-controls">
                  <input
                    type="range"
                    class="range-input"
                    min="0"
                    max="60"
                    :value="settings.windowTransparencyEffect.cardBlur"
                    @input="updateTp('cardBlur', Number(($event.target as HTMLInputElement).value))"
                  />
                  <EditableRangeValue
                    :value="settings.windowTransparencyEffect.cardBlur"
                    :min="0"
                    :max="60"
                    suffix="px"
                    aria-label="编辑卡片模糊度"
                    @change="updateTp('cardBlur', $event)"
                  />
                </div>
              </div>
            </template>
          </div>
        </section>

        <DesktopLyricsSettingsSection
          :desktop-lyrics="settings.desktopLyrics"
          @toggle="toggleDesktopLyrics"
          @update="updateDesktopLyrics"
        />
        <ShortcutsSettingsSection
          :global-shortcuts="settings.globalShortcuts"
          :shortcut-statuses="shortcutStatuses"
          :shortcut-bindings="settings.globalShortcutBindings"
          @update:global-shortcuts="toggleGlobalShortcuts"
          @update:shortcut-bindings="onUpdateShortcutBindings"
        />

        <AboutSettingsSection
          :app-version="appVersion"
          :update-check-state="updateCheckState"
          :latest-version="latestVersion"
          :last-update-check="lastUpdateCheck"
          :release-url="releaseUrl"
          :asset-name="updateAssetName"
          :has-checksum="updateHasChecksum"
          :update-error="updateError"
          :update-progress="updateProgress"
          :update-action-state="updateActionState"
          @check-for-updates="checkForUpdates"
          @download-update="downloadUpdate"
          @cancel-update-download="cancelUpdateDownload"
          @install-update="installUpdate"
          @open-release-page="openReleasePage"
          @export-audio-diagnostics="exportAudioDiagnostics"
        />
      </div>
    </div>
  </main>
</template>

<style>
.plugin-settings-form {
  display: grid;
  gap: 12px;
  margin: 0 0 14px;
  padding: 16px;
  border: 1px solid var(--te-settings-border);
  border-radius: 12px;
  background: var(--te-settings-card-bg);
}

.plugin-settings-notice {
  margin: 0;
  color: var(--te-settings-muted);
  font-size: 12px;
  line-height: 1.6;
}

.plugin-settings-field {
  display: grid;
  grid-template-columns: minmax(140px, 220px) minmax(220px, 1fr);
  align-items: center;
  gap: 16px;
}

.plugin-settings-field > span {
  color: var(--te-settings-text);
  font-size: 13px;
  font-weight: 600;
}

.plugin-settings-field b {
  color: var(--te-danger, #ef4444);
}

.plugin-settings-field .preview-select {
  width: 100%;
  max-width: none;
}

.plugin-settings-submit {
  justify-self: end;
}

@media (max-width: 760px) {
  .plugin-settings-field {
    grid-template-columns: 1fr;
    gap: 7px;
  }
}
</style>

<style src="./settings-page/SettingsPage.css"></style>

<style>
html[data-theme='dark'] .settings-preview-page {
  /* This block is emitted after SettingsPage.css, so preserve the complete
     opaque image stack rather than resetting the page to a transparent layer. */
  background-color: var(--te-settings-backplate, #17181a) !important;
  background-image:
    var(--te-settings-bg-image, none), linear-gradient(var(--te-settings-bg), var(--te-settings-bg)) !important;
  background-position: center, center;
  background-size: cover, cover;
  background-repeat: no-repeat, no-repeat;
  background-attachment: fixed, fixed;
  color: var(--te-text);
}

html[data-theme='dark'] .settings-preview-page::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.28);
}

html[data-theme='dark'] .settings-preview-page::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.42);
}

html[data-theme='dark'] .settings-preview-page .preview-nav-item {
  color: var(--te-text-muted);
}

html[data-theme='dark'] .settings-preview-page .preview-nav-item:hover,
html[data-theme='dark'] .settings-preview-page .preview-nav-item.active {
  border-color: rgba(var(--te-primary-rgb), 0.28);
  background: var(--te-card-bg);
  color: var(--te-text);
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
html[data-theme='dark'] .settings-preview-page .settings-search-box,
html[data-theme='dark'] .settings-preview-page .settings-nav-search,
html[data-theme='dark'] .settings-preview-page .shortcut-status-row,
html[data-theme='dark'] .settings-preview-page .read-only-pill {
  border-color: var(--te-card-border);
  background: var(--te-card-bg);
  color: rgba(226, 232, 240, 0.9);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
}

html[data-theme='dark'] .settings-preview-page .settings-nav-results,
html[data-theme='dark'] .settings-preview-page .settings-nav-empty {
  border-color: var(--te-card-border);
  background: var(--te-card-bg);
  color: rgba(226, 232, 240, 0.9);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.42);
}

html[data-theme='dark'] .settings-preview-page .settings-nav-results button {
  color: rgba(226, 232, 240, 0.88);
}

html[data-theme='dark'] .settings-preview-page .settings-nav-results button:hover,
html[data-theme='dark'] .settings-preview-page .settings-nav-results button.active {
  background: rgba(var(--te-primary-rgb), 0.16);
  color: var(--te-primary-300);
}

html[data-theme='dark'] .settings-preview-page .settings-nav-results button small {
  color: rgba(148, 163, 184, 0.72);
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
html[data-theme='dark'] .settings-preview-page .settings-search-box .settings-search-input {
  color: rgba(148, 163, 184, 0.88);
}

html[data-theme='dark'] .settings-preview-page .segmented-control button.active,
html[data-theme='dark'] .settings-preview-page .theme-segment button.active,
html[data-theme='dark'] .settings-preview-page .background-kind-toggle button.active {
  background: var(--te-card-bg);
  color: var(--te-text);
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
  color: var(--te-text);
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
html[data-theme='dark'] .settings-preview-page .inherit-toggle,
html[data-theme='dark'] .settings-preview-page .dashed-button,
html[data-theme='dark'] .settings-preview-page .folder-empty-hint {
  border-color: var(--te-card-border);
  background: var(--te-card-bg);
  color: rgba(203, 213, 225, 0.9);
  box-shadow: none;
}

html[data-theme='dark'] .settings-preview-page .folder-empty-hint {
  border: 1px dashed var(--te-card-border);
  border-radius: 12px;
}

html[data-theme='dark'] .settings-preview-page .inherit-toggle.active {
  border-color: rgba(var(--te-primary-rgb), 0.34);
  background: rgba(var(--te-primary-rgb), 0.14);
  color: var(--te-primary-300);
}

html[data-theme='dark'] .settings-preview-page .dashed-button:hover,
html[data-theme='dark'] .settings-preview-page .brand-soft-button:hover,
html[data-theme='dark'] .settings-preview-page .preset-btn:hover,
html[data-theme='dark'] .settings-preview-page .settings-nav-results button.active {
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
