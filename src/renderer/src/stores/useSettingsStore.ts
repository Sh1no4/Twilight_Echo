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

const fallbackHeadphoneCompensation = {
  enabled: false,
  productId: '',
  productName: '',
  vendorName: '',
  eqId: '',
  author: '',
  details: '',
  link: '',
  preampDb: 0,
  bands: []
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
  libraryFolders: [],
  watchLibrary: true,
  smtcEnabled: true,
  discordRpcEnabled: false,
  accentColor: 'blue',
  lightAccentColor: 'blue',
  darkAccentColor: 'amber',
  fontFamily: 'system',
  uiDensity: 'standard',
  nowPlayingBackground: 'blur',
  lyricAlign: 'center',
  lyricDimOpacity: 40,
  playbackResumeMode: 'off',
  audioOutput: getFallbackAudioOutput(),
  audioDevice: 'auto',
  audioExclusiveMode: false,
  audioOutputConfig: {
    preferredBufferSize: 0,
    routingMode: 'auto'
  },
  audioProcessing: fallbackAudioProcessing,
  headphoneCompensation: fallbackHeadphoneCompensation,
  audioEqPresets: [],
  desktopLyrics: {
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
    maxLines: 2
  },
  proxyMode: 'auto',
  proxyHost: '',
  proxyPort: 0,
  streamingActiveProvider: 'ncm'
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

interface AccentPalette {
  primary500: string
  primary400: string
  primary300: string
  rgb: string
  glow: string
  soft: string
  active: string
  brand50: string
  brand100: string
  brand200: string
  brand300: string
  brand400: string
  brand500: string
  brand600: string
  brand700: string
}

const ACCENT_PALETTES: Record<string, AccentPalette> = {
  violet: {
    primary500: '#8b5cf6',
    primary400: '#a78bfa',
    primary300: '#c4b5fd',
    rgb: '139, 92, 246',
    glow: 'rgba(139, 92, 246, 0.18)',
    soft: 'rgba(139, 92, 246, 0.08)',
    active: 'rgba(139, 92, 246, 0.16)',
    brand50: '#f5f3ff',
    brand100: '#ede9fe',
    brand200: '#ddd6fe',
    brand300: '#c4b5fd',
    brand400: '#a78bfa',
    brand500: '#8b5cf6',
    brand600: '#7c3aed',
    brand700: '#6d28d9'
  },
  blue: {
    primary500: '#2563eb',
    primary400: '#3b82f6',
    primary300: '#93c5fd',
    rgb: '37, 99, 235',
    glow: 'rgba(37, 99, 235, 0.14)',
    soft: 'rgba(37, 99, 235, 0.08)',
    active: 'rgba(37, 99, 235, 0.14)',
    brand50: '#eff6ff',
    brand100: '#dbeafe',
    brand200: '#bfdbfe',
    brand300: '#93c5fd',
    brand400: '#60a5fa',
    brand500: '#2563eb',
    brand600: '#1d4ed8',
    brand700: '#1e40af'
  },
  emerald: {
    primary500: '#10b981',
    primary400: '#34d399',
    primary300: '#6ee7b7',
    rgb: '16, 185, 129',
    glow: 'rgba(16, 185, 129, 0.16)',
    soft: 'rgba(16, 185, 129, 0.08)',
    active: 'rgba(16, 185, 129, 0.15)',
    brand50: '#ecfdf5',
    brand100: '#d1fae5',
    brand200: '#a7f3d0',
    brand300: '#6ee7b7',
    brand400: '#34d399',
    brand500: '#10b981',
    brand600: '#059669',
    brand700: '#047857'
  },
  rose: {
    primary500: '#e11d48',
    primary400: '#fb7185',
    primary300: '#fda4af',
    rgb: '225, 29, 72',
    glow: 'rgba(225, 29, 72, 0.16)',
    soft: 'rgba(225, 29, 72, 0.08)',
    active: 'rgba(225, 29, 72, 0.14)',
    brand50: '#fff1f2',
    brand100: '#ffe4e6',
    brand200: '#fecdd3',
    brand300: '#fda4af',
    brand400: '#fb7185',
    brand500: '#e11d48',
    brand600: '#be123c',
    brand700: '#9f1239'
  },
  amber: {
    primary500: '#f59e0b',
    primary400: '#fbbf24',
    primary300: '#fde68a',
    rgb: '245, 158, 11',
    glow: 'rgba(245, 158, 11, 0.18)',
    soft: 'rgba(245, 158, 11, 0.09)',
    active: 'rgba(245, 158, 11, 0.16)',
    brand50: '#fffbeb',
    brand100: '#fef3c7',
    brand200: '#fde68a',
    brand300: '#fcd34d',
    brand400: '#fbbf24',
    brand500: '#f59e0b',
    brand600: '#d97706',
    brand700: '#b45309'
  },
  slate: {
    primary500: '#334155',
    primary400: '#64748b',
    primary300: '#94a3b8',
    rgb: '51, 65, 85',
    glow: 'rgba(51, 65, 85, 0.16)',
    soft: 'rgba(51, 65, 85, 0.08)',
    active: 'rgba(51, 65, 85, 0.14)',
    brand50: '#f8fafc',
    brand100: '#f1f5f9',
    brand200: '#e2e8f0',
    brand300: '#cbd5e1',
    brand400: '#94a3b8',
    brand500: '#334155',
    brand600: '#1f2937',
    brand700: '#0f172a'
  }
}

const FONT_FAMILY_MAP: Record<string, string> = {
  system: "var(--te-font-sans, system-ui, -apple-system, 'Segoe UI', sans-serif)",
  inter: "'Inter', 'Roboto', system-ui, sans-serif",
  lxgw: "'LXGW WenKai', '霞鹜文楷', serif",
  sarasa: "'Sarasa Gothic', '更纱黑体', monospace",
  comic: "'Comic Sans MS', cursive"
}

function applyDomSettings(): void {
  const resolvedTheme = resolveTheme(settings.value.theme)
  const accent =
    resolvedTheme === 'dark'
      ? settings.value.darkAccentColor || settings.value.accentColor
      : settings.value.lightAccentColor || settings.value.accentColor
  const palette = ACCENT_PALETTES[accent] ?? ACCENT_PALETTES.blue
  document.documentElement.dataset.theme = resolvedTheme
  document.documentElement.dataset.themePreference = settings.value.theme
  document.documentElement.style.colorScheme = resolvedTheme === 'dark' ? 'dark' : 'light'
  document.body.classList.toggle('te-no-blur', !settings.value.blurEffect)
  document.documentElement.style.setProperty(
    '--te-lyric-font-size',
    `${settings.value.lyricFontSize}px`
  )
  document.documentElement.dataset.accent = accent
  document.documentElement.style.setProperty('--te-accent', palette.primary500)
  document.documentElement.style.setProperty('--te-primary-500', palette.primary500)
  document.documentElement.style.setProperty('--te-primary-400', palette.primary400)
  document.documentElement.style.setProperty('--te-primary-300', palette.primary300)
  document.documentElement.style.setProperty('--te-primary-rgb', palette.rgb)
  document.documentElement.style.setProperty('--te-glow-main', palette.glow)
  document.documentElement.style.setProperty('--te-accent-soft', palette.soft)
  document.documentElement.style.setProperty('--te-active-bg', palette.active)
  document.documentElement.style.setProperty('--brand-50', palette.brand50)
  document.documentElement.style.setProperty('--brand-100', palette.brand100)
  document.documentElement.style.setProperty('--brand-200', palette.brand200)
  document.documentElement.style.setProperty('--brand-300', palette.brand300)
  document.documentElement.style.setProperty('--brand-400', palette.brand400)
  document.documentElement.style.setProperty('--brand-500', palette.brand500)
  document.documentElement.style.setProperty('--brand-600', palette.brand600)
  document.documentElement.style.setProperty('--brand-700', palette.brand700)
  document.documentElement.style.setProperty(
    '--te-font-sans',
    FONT_FAMILY_MAP[settings.value.fontFamily] ?? FONT_FAMILY_MAP.system
  )
  document.documentElement.dataset.density = settings.value.uiDensity
  document.documentElement.dataset.nowPlayingBg = settings.value.nowPlayingBackground
  document.documentElement.dataset.lyricAlign = settings.value.lyricAlign
  document.documentElement.style.setProperty(
    '--te-lyric-dim-opacity',
    `${settings.value.lyricDimOpacity / 100}`
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
  addLibraryFolder: () => Promise<void>
  removeLibraryFolder: (folder: string) => Promise<void>
  openExternalUrl: (url: string) => Promise<void>
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

  async function addLibraryFolder(): Promise<void> {
    const folder = await window.api.dialog.openFolder()
    if (!folder) return
    if (settings.value.libraryFolders.includes(folder)) return
    await updateSettings({ libraryFolders: [...settings.value.libraryFolders, folder] })
  }

  async function removeLibraryFolder(folder: string): Promise<void> {
    const next = settings.value.libraryFolders.filter((item) => item !== folder)
    if (next.length === settings.value.libraryFolders.length) return
    await updateSettings({ libraryFolders: next })
  }

  async function openExternalUrl(url: string): Promise<void> {
    await window.api.shell.openExternal(url)
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
    relaunch,
    addLibraryFolder,
    removeLibraryFolder,
    openExternalUrl
  }
}
