import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type {
  AppSettings,
  AppTheme,
  AudioOutputId,
  AudioProcessingSettings,
  SettingsSnapshot
} from '../types/settings'

function getFallbackAudioOutput(): AudioOutputId {
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('mac')) return 'coreaudio'
  if (platform.includes('linux')) return 'alsa'
  return 'wasapi'
}

const fallbackAudioProcessing: AudioProcessingSettings = {
  dspEnabled: false,
  clipGuard: true,
  fftEnabled: true,
  fftResolution: 64,
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
  gapless: true,
  crossfadeSeconds: 0
}

const fallbackSettings: AppSettings = {
  autoCheckLogin: true,
  autoLaunch: false,
  minimizeToTray: false,
  launchAtLogin: false,
  hardwareAcceleration: true,
  globalShortcuts: false,
  musicCachePath: '',
  cachePath: '',
  closeToTray: false,
  theme: 'system',
  pluginThemeId: null,
  blurEffect: true,
  useCoverTheme: true,
  lyricFontSize: 18,
  playbackResumeMode: 'off',
  audioOutput: getFallbackAudioOutput(),
  audioDevice: 'auto',
  audioExclusiveMode: false,
  audioOutputConfig: {
    preferredBufferSize: 0,
    routingMode: 'auto'
  },
  audioProcessing: fallbackAudioProcessing,
  audioEqPresets: []
}

const settings = ref<AppSettings>({ ...fallbackSettings })
const defaults = ref<SettingsSnapshot['defaults']>({ cachePath: '' })
const paths = ref<SettingsSnapshot['paths'] | null>(null)
const appVersion = ref('')
const platform = ref('')
const restartReasons = ref<string[]>([])
const loaded = ref(false)
const loading = ref(false)
const saving = ref(false)
const clearingCache = ref(false)
const cacheSize = ref<number | null>(null)
let listenerSetup = false
let systemThemeListenerSetup = false

const systemThemeQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

function formatBytes(bytes: number | null): string {
  if (bytes == null) return 'Calculating...'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`
}

function resolveTheme(theme: AppTheme): Exclude<AppTheme, 'system'> {
  if (theme !== 'system') return theme
  return systemThemeQuery?.matches ? 'dark' : 'pureWhite'
}

function applyDomSettings(): void {
  const resolvedTheme = resolveTheme(settings.value.theme)
  document.documentElement.dataset.theme = resolvedTheme
  document.documentElement.dataset.themePreference = settings.value.theme
  document.documentElement.style.colorScheme = resolvedTheme === 'dark' ? 'dark' : 'light'
  document.body.classList.toggle('te-no-blur', !settings.value.blurEffect)
  document.documentElement.style.setProperty(
    '--te-lyric-font-size',
    `${settings.value.lyricFontSize}px`
  )
}

function handleSystemThemeChange(): void {
  if (settings.value.theme === 'system') {
    applyDomSettings()
  }
}

function setupSystemThemeListener(): void {
  if (systemThemeListenerSetup || !systemThemeQuery) return
  systemThemeListenerSetup = true
  systemThemeQuery.addEventListener('change', handleSystemThemeChange)
}

function applySnapshot(snapshot: SettingsSnapshot): void {
  settings.value = { ...snapshot.settings }
  defaults.value = { ...snapshot.defaults }
  paths.value = { ...snapshot.paths }
  appVersion.value = snapshot.appVersion
  platform.value = snapshot.platform
  restartReasons.value = [...snapshot.restartReasons]
  loaded.value = true
  applyDomSettings()
}

function setupListener(): void {
  if (listenerSetup) return
  listenerSetup = true
  setupSystemThemeListener()
  window.api.settings.onChanged((snapshot) => {
    applySnapshot(snapshot)
  })
}

if (typeof document !== 'undefined') {
  const applyInitialDomSettings = (): void => {
    setupSystemThemeListener()
    applyDomSettings()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyInitialDomSettings, { once: true })
  } else {
    applyInitialDomSettings()
  }
}

export function useSettingsStore(): {
  settings: Ref<AppSettings>
  defaults: Ref<SettingsSnapshot['defaults']>
  paths: Ref<SettingsSnapshot['paths'] | null>
  appVersion: Ref<string>
  platform: Ref<string>
  loaded: Ref<boolean>
  loading: Ref<boolean>
  saving: Ref<boolean>
  clearingCache: Ref<boolean>
  cacheSize: Ref<number | null>
  formattedCacheSize: ComputedRef<string>
  restartRequired: ComputedRef<boolean>
  restartReasons: Ref<string[]>
  loadSettings: () => Promise<AppSettings>
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  chooseCacheFolder: () => Promise<void>
  resetCacheFolder: () => Promise<void>
  refreshCacheSize: () => Promise<void>
  clearCache: () => Promise<void>
  openCacheFolder: () => Promise<void>
  relaunch: () => Promise<void>
} {
  const formattedCacheSize = computed(() => formatBytes(cacheSize.value))
  const restartRequired = computed(() => restartReasons.value.length > 0)

  async function loadSettings(): Promise<AppSettings> {
    setupListener()
    loading.value = true
    try {
      const snapshot = await window.api.settings.get()
      applySnapshot(snapshot)
      return settings.value
    } finally {
      loading.value = false
    }
  }

  async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    saving.value = true
    try {
      const snapshot = await window.api.settings.update(patch)
      applySnapshot(snapshot)
      return settings.value
    } finally {
      saving.value = false
    }
  }

  async function chooseCacheFolder(): Promise<void> {
    const folder = await window.api.settings.chooseCacheFolder()
    if (folder) {
      await updateSettings({ cachePath: folder })
    }
  }

  async function resetCacheFolder(): Promise<void> {
    if (!defaults.value.cachePath) return
    await updateSettings({ cachePath: defaults.value.cachePath })
  }

  async function refreshCacheSize(): Promise<void> {
    cacheSize.value = await window.api.settings.getCacheSize()
  }

  async function clearCache(): Promise<void> {
    clearingCache.value = true
    try {
      cacheSize.value = await window.api.settings.clearCache()
    } finally {
      clearingCache.value = false
    }
  }

  async function openCacheFolder(): Promise<void> {
    const targetPath = settings.value.cachePath || paths.value?.activeCachePath
    if (targetPath) {
      await window.api.shell.openPath(targetPath)
    }
  }

  async function relaunch(): Promise<void> {
    await window.api.app.relaunch()
  }

  return {
    settings,
    defaults,
    paths,
    appVersion,
    platform,
    loaded,
    loading,
    saving,
    clearingCache,
    cacheSize,
    formattedCacheSize,
    restartRequired,
    restartReasons,
    loadSettings,
    updateSettings,
    chooseCacheFolder,
    resetCacheFolder,
    refreshCacheSize,
    clearCache,
    openCacheFolder,
    relaunch
  }
}
