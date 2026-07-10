import { app } from 'electron'
import { stat, readdir } from 'fs/promises'
import { join, resolve } from 'path'
import {
  DEFAULT_AUDIO_PROCESSING,
  normalizeAudioOutput,
  normalizeAudioProcessingSettings,
  type ChannelRoutingMode,
  type OutputConfig
} from '../audioEngineManager'
import {
  DEFAULT_HEADPHONE_COMPENSATION,
  normalizeHeadphoneCompensationSettings
} from '../audioProcessingEffective'
import type {
  AppBackgroundKind,
  AppBackgroundPage,
  AppBackgroundPageOverride,
  AppBackgroundSettings,
  AppBackgroundColorPair,
  AppSettings,
  AppTheme,
  AudioEqPreset,
  BackgroundEffectTheme,
  CardAppearanceSettings,
  CardAppearanceTheme,
  CardHoverEffect,
  CardShadowStrength,
  DesktopLyricsSettings,
  WindowTransparencyEffectSettings,
  MusicCachePolicySettings,
  NowPlayingBackground,
  PlaybackResumeMode,
  ProxyMode,
  SettingsSnapshot,
  StartupHomePage,
  StreamingAudioCachePolicy,
  UiDensity
} from './types'
import type { PlayMode } from '../audioEngineManager'
import {
  loadSettingsFile,
  writeSettingsFile,
  type SettingsFileLoadIssue
} from '../persistence/settingsFile.ts'

let appSettingsLoadIssue: SettingsFileLoadIssue | null = null

export const DEFAULT_DESKTOP_LYRICS: DesktopLyricsSettings = {
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
}

export const DEFAULT_MUSIC_CACHE_POLICY: MusicCachePolicySettings = {
  cover: true,
  lyrics: true,
  metadata: true,
  streamingAudio: 'provider'
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoCheckLogin: true,
  autoLaunch: false,
  launchAtLogin: false,
  hardwareAcceleration: true,
  globalShortcuts: false,
  minimizeToTray: false,
  musicCachePath: '',
  cachePath: '',
  cachePolicy: DEFAULT_MUSIC_CACHE_POLICY,
  autoAnalyzeBpm: true,
  closeToTray: false,
  startupHomePage: 'local',
  theme: 'system',
  pluginThemeId: null,
  blurEffect: true,
  windowTransparency: false,
  windowTransparencyEffect: {
    surfaceOpacity: 55,
    surfaceBlur: 0,
    cardOpacity: 60,
    cardBlur: 24
  },
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
  appBackground: {
    global: {
      light: '#f4f4f7',
      dark: '#17181a',
      kind: 'color',
      image: ''
    },
    pages: {
      local: { inherit: true, light: '#ffffff', dark: '#17181a', kind: 'color', image: '' },
      settings: { inherit: true, light: '#f4f4f7', dark: '#17181a', kind: 'color', image: '' },
      streaming: { inherit: true, light: '#fafbfe', dark: '#17181a', kind: 'color', image: '' },
      player: { inherit: true, light: '#080e17', dark: '#17181a', kind: 'color', image: '' }
    }
  },
  cardAppearance: {
    enabled: false,
    light: {
      blurRadius: 20,
      blurSaturation: 150,
      backgroundColor: '#ffffff',
      backgroundOpacity: 100,
      borderColor: '#0f172a',
      borderOpacity: 8,
      borderWidth: 1,
      borderRadius: 16,
      shadowStrength: 'medium',
      hoverEffect: 'lift',
      glassHighlight: true
    },
    dark: {
      blurRadius: 20,
      blurSaturation: 150,
      backgroundColor: '#181818',
      backgroundOpacity: 100,
      borderColor: '#ffffff',
      borderOpacity: 10,
      borderWidth: 1,
      borderRadius: 16,
      shadowStrength: 'medium',
      hoverEffect: 'lift',
      glassHighlight: true
    },
    background: {
      enabled: false,
      light: { blur: 0, brightness: 100, dim: 0 },
      dark: { blur: 0, brightness: 100, dim: 0 }
    }
  },
  nowPlayingBackground: 'blur',
  lyricAlign: 'center',
  lyricDimOpacity: 40,
  playbackResumeMode: 'off',
  playMode: 'sequential',
  audioOutput:
    process.platform === 'darwin' ? 'coreaudio' : process.platform === 'linux' ? 'alsa' : 'wasapi',
  audioDevice: 'auto',
  audioExclusiveMode: false,
  audioOutputConfig: {
    preferredBufferSize: 0,
    routingMode: 'auto',
    wasapiExclusivePushMode: false
  },
  audioProcessing: DEFAULT_AUDIO_PROCESSING,
  headphoneCompensation: DEFAULT_HEADPHONE_COMPENSATION,
  audioEqPresets: [],
  desktopLyrics: { ...DEFAULT_DESKTOP_LYRICS },
  proxyMode: 'auto',
  proxyHost: '',
  proxyPort: 0,
  streamingActiveProvider: 'ncm'
}

export function getSettingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getDefaultCachePath(): string {
  return join(app.getPath('userData'), 'music-cache')
}

export function getOpraDatabaseCachePath(): string {
  return join(app.getPath('userData'), 'opra', 'database_v1.jsonl')
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function normalizeProxyMode(value: unknown): ProxyMode {
  if (value === 'auto' || value === 'custom' || value === 'off') return value
  return 'auto'
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map((n) => parseInt(n, 10) || 0)
  const partsB = b.split('.').map((n) => parseInt(n, 10) || 0)
  const maxLen = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < maxLen; i++) {
    const va = partsA[i] ?? 0
    const vb = partsB[i] ?? 0
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
}

export function normalizeAudioEqPresets(presets: unknown): AudioEqPreset[] {
  if (!Array.isArray(presets)) return []

  return presets
    .map((preset, index): AudioEqPreset | null => {
      if (!preset || typeof preset !== 'object') return null
      const raw = preset as Partial<AudioEqPreset>
      const normalized = normalizeAudioProcessingSettings({
        eqMode: raw.eqMode,
        eqPreamp: raw.eqPreamp,
        eqBands: raw.eqBands
      })
      return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : `custom-${index}`,
        name:
          typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 40) : `Preset ${index + 1}`,
        eqMode: normalized.eqMode,
        eqPreamp: normalized.eqPreamp,
        eqBands: normalized.eqBands
      }
    })
    .filter((preset): preset is AudioEqPreset => Boolean(preset))
    .slice(0, 24)
}

export function normalizeAppTheme(theme: unknown): AppTheme {
  return theme === 'system' || theme === 'dark' || theme === 'pureWhite'
    ? theme
    : DEFAULT_SETTINGS.theme
}

export function normalizePlaybackResumeMode(mode: unknown): PlaybackResumeMode {
  return mode === 'track' || mode === 'trackAndPosition' || mode === 'off'
    ? mode
    : DEFAULT_SETTINGS.playbackResumeMode
}

export function normalizeStartupHomePage(value: unknown): StartupHomePage {
  return value === 'streaming' ? 'streaming' : 'local'
}

export function normalizeStreamingAudioCachePolicy(value: unknown): StreamingAudioCachePolicy {
  return value === 'off' ? 'off' : 'provider'
}

export function normalizeMusicCachePolicy(raw: unknown): MusicCachePolicySettings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    cover: value.cover !== false,
    lyrics: value.lyrics !== false,
    metadata: value.metadata !== false,
    streamingAudio: normalizeStreamingAudioCachePolicy(value.streamingAudio)
  }
}

export function normalizePlayMode(mode: unknown): PlayMode {
  return mode === 'repeat' || mode === 'shuffle' ? mode : 'sequential'
}

export const ACCENT_COLORS = ['violet', 'blue', 'emerald', 'rose', 'amber', 'slate']

export function normalizeAccentColor(value: unknown): string {
  return typeof value === 'string' && ACCENT_COLORS.includes(value)
    ? value
    : DEFAULT_SETTINGS.accentColor
}

export function normalizeLightAccentColor(value: unknown): string {
  return typeof value === 'string' && ACCENT_COLORS.includes(value)
    ? value
    : DEFAULT_SETTINGS.lightAccentColor
}

export function normalizeDarkAccentColor(value: unknown, legacyValue: unknown): string {
  if (typeof value === 'string' && ACCENT_COLORS.includes(value)) return value
  if (typeof legacyValue === 'string' && ACCENT_COLORS.includes(legacyValue)) return legacyValue
  return DEFAULT_SETTINGS.darkAccentColor
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 64)
}

export function normalizeUiDensity(value: unknown): UiDensity {
  return value === 'compact' || value === 'comfortable' ? value : 'standard'
}

export function normalizeNowPlayingBackground(value: unknown): NowPlayingBackground {
  return value === 'fluid' || value === 'solid' ? value : 'blur'
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return normalized.toLowerCase()
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) return `#${normalized.toLowerCase()}`
  return fallback
}

export function normalizeBackgroundKind(value: unknown): AppBackgroundKind {
  return value === 'image' ? 'image' : 'color'
}

export function normalizeBackgroundImageHandle(value: unknown): string {
  return typeof value === 'string' && /^background:\/\/[a-zA-Z0-9._-]+$/.test(value) ? value : ''
}

export const APP_BACKGROUND_PAGES: AppBackgroundPage[] = [
  'local',
  'settings',
  'streaming',
  'player'
]

export function normalizeAppBackground(raw: unknown): AppBackgroundSettings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    global?: Partial<AppBackgroundColorPair>
    pages?: Partial<Record<AppBackgroundPage, Partial<AppBackgroundPageOverride>>>
  }
  const defaultBackground = DEFAULT_SETTINGS.appBackground
  const global = {
    light: normalizeHexColor(value.global?.light, defaultBackground.global.light),
    dark: normalizeHexColor(value.global?.dark, defaultBackground.global.dark),
    kind: normalizeBackgroundKind(value.global?.kind),
    image: normalizeBackgroundImageHandle(value.global?.image)
  }
  const pages = APP_BACKGROUND_PAGES.reduce(
    (acc, page) => {
      const defaults = defaultBackground.pages[page]
      const override = value.pages?.[page]
      acc[page] = {
        inherit: override?.inherit !== false,
        light: normalizeHexColor(override?.light, defaults.light),
        dark: normalizeHexColor(override?.dark, defaults.dark),
        kind: normalizeBackgroundKind(override?.kind),
        image: normalizeBackgroundImageHandle(override?.image)
      }
      return acc
    },
    {} as Record<AppBackgroundPage, AppBackgroundPageOverride>
  )
  return { global, pages }
}

export const CARD_SHADOW_STRENGTHS: CardShadowStrength[] = ['none', 'subtle', 'medium', 'strong']
export const CARD_HOVER_EFFECTS: CardHoverEffect[] = ['none', 'lift', 'zoom', 'glow']

export function normalizeCardShadowStrength(value: unknown): CardShadowStrength {
  return typeof value === 'string' && CARD_SHADOW_STRENGTHS.includes(value as CardShadowStrength)
    ? (value as CardShadowStrength)
    : 'medium'
}

export function normalizeCardHoverEffect(value: unknown): CardHoverEffect {
  return typeof value === 'string' && CARD_HOVER_EFFECTS.includes(value as CardHoverEffect)
    ? (value as CardHoverEffect)
    : 'lift'
}

export function normalizeCardAppearanceTheme(
  raw: unknown,
  defaults: CardAppearanceTheme
): CardAppearanceTheme {
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    blurRadius: clampNumber(t.blurRadius, 0, 40, defaults.blurRadius),
    blurSaturation: clampNumber(t.blurSaturation, 80, 180, defaults.blurSaturation),
    backgroundColor: normalizeHexColor(t.backgroundColor, defaults.backgroundColor),
    backgroundOpacity: clampNumber(t.backgroundOpacity, 0, 100, defaults.backgroundOpacity),
    borderColor: normalizeHexColor(t.borderColor, defaults.borderColor),
    borderOpacity: clampNumber(t.borderOpacity, 0, 100, defaults.borderOpacity),
    borderWidth: clampNumber(t.borderWidth, 0, 3, defaults.borderWidth),
    borderRadius: clampNumber(t.borderRadius, 0, 24, defaults.borderRadius),
    shadowStrength: normalizeCardShadowStrength(t.shadowStrength),
    hoverEffect: normalizeCardHoverEffect(t.hoverEffect),
    glassHighlight: t.glassHighlight !== false
  }
}

export function normalizeWindowTransparencyEffect(raw: unknown): WindowTransparencyEffectSettings {
  const defaults = DEFAULT_SETTINGS.windowTransparencyEffect
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    surfaceOpacity: clampNumber(t.surfaceOpacity, 20, 100, defaults.surfaceOpacity),
    surfaceBlur: clampNumber(t.surfaceBlur, 0, 60, defaults.surfaceBlur),
    cardOpacity: clampNumber(t.cardOpacity, 0, 100, defaults.cardOpacity),
    cardBlur: clampNumber(t.cardBlur, 0, 60, defaults.cardBlur)
  }
}

export function normalizeBackgroundEffectTheme(
  raw: unknown,
  defaults: BackgroundEffectTheme
): BackgroundEffectTheme {
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    blur: clampNumber(t.blur, 0, 30, defaults.blur),
    brightness: clampNumber(t.brightness, 50, 120, defaults.brightness),
    dim: clampNumber(t.dim, 0, 80, defaults.dim)
  }
}

export function normalizeCardAppearance(raw: unknown): CardAppearanceSettings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const defaults = DEFAULT_SETTINGS.cardAppearance
  const bgRaw = (
    typeof value.background === 'object' && value.background !== null ? value.background : {}
  ) as Record<string, unknown>
  return {
    enabled: value.enabled === true,
    light: normalizeCardAppearanceTheme(value.light, defaults.light),
    dark: normalizeCardAppearanceTheme(value.dark, defaults.dark),
    background: {
      enabled: bgRaw.enabled === true,
      light: normalizeBackgroundEffectTheme(bgRaw.light, defaults.background.light),
      dark: normalizeBackgroundEffectTheme(bgRaw.dark, defaults.background.dark)
    }
  }
}

export function normalizePluginThemeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && /^[a-z][a-z0-9-_.]*:[a-z][a-z0-9-_.]*$/.test(normalized) ? normalized : null
}

export function isDefaultAudioDeviceAlias(device: string): boolean {
  const normalized = device.trim()
  const lower = normalized.toLowerCase()
  return (
    lower === 'auto' ||
    lower === 'default' ||
    lower === 'system default' ||
    lower === 'system-default' ||
    normalized === '系统默认'
  )
}

export function normalizeAudioDevice(device: unknown): string {
  if (typeof device !== 'string') return DEFAULT_SETTINGS.audioDevice
  const normalized = device.trim()
  if (!normalized || isDefaultAudioDeviceAlias(normalized)) return DEFAULT_SETTINGS.audioDevice
  return normalized
}

export function normalizeChannelRoutingMode(value: unknown): ChannelRoutingMode {
  return value === 'stereo' ||
    value === 'stereo-to-5.1' ||
    value === 'stereo-to-7.1' ||
    value === 'mono-to-stereo' ||
    value === 'mono-to-multichannel'
    ? value
    : 'auto'
}

export function normalizeOutputConfig(config: unknown): OutputConfig {
  if (!config || typeof config !== 'object') return { ...DEFAULT_SETTINGS.audioOutputConfig }
  const value = config as Partial<Record<keyof OutputConfig, unknown>>
  return {
    preferredBufferSize:
      typeof value.preferredBufferSize === 'number'
        ? clampNumber(Math.trunc(value.preferredBufferSize), 0, 8192, 0)
        : DEFAULT_SETTINGS.audioOutputConfig.preferredBufferSize,
    routingMode: normalizeChannelRoutingMode(value.routingMode),
    wasapiExclusivePushMode: value.wasapiExclusivePushMode === true,
    upmixCenterGain: clampNumber(value.upmixCenterGain, 0, 2, 0.7071),
    upmixLfeGain: clampNumber(value.upmixLfeGain, 0, 2, 0.5),
    upmixLfeLowpassHz: clampNumber(value.upmixLfeLowpassHz, 20, 500, 120),
    upmixSurroundGain: clampNumber(value.upmixSurroundGain, 0, 2, 0.5),
    upmixSideGain: clampNumber(value.upmixSideGain, 0, 2, 0.3),
    upmixSurroundDelayMs: clampNumber(value.upmixSurroundDelayMs, 0, 100, 0)
  }
}

export function normalizeDesktopLyrics(raw: unknown): DesktopLyricsSettings {
  const d = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    enabled: d.enabled === true,
    fontSize: clampNumber(d.fontSize, 12, 80, DEFAULT_DESKTOP_LYRICS.fontSize),
    fontFamily:
      typeof d.fontFamily === 'string' && d.fontFamily.trim()
        ? d.fontFamily.trim().slice(0, 64)
        : DEFAULT_DESKTOP_LYRICS.fontFamily,
    fontWeight: clampNumber(d.fontWeight, 100, 900, DEFAULT_DESKTOP_LYRICS.fontWeight),
    color: typeof d.color === 'string' ? d.color : DEFAULT_DESKTOP_LYRICS.color,
    highlightColor:
      typeof d.highlightColor === 'string'
        ? d.highlightColor
        : DEFAULT_DESKTOP_LYRICS.highlightColor,
    bgColor: typeof d.bgColor === 'string' ? d.bgColor : DEFAULT_DESKTOP_LYRICS.bgColor,
    bgOpacity: clampNumber(d.bgOpacity, 0, 100, DEFAULT_DESKTOP_LYRICS.bgOpacity),
    align: d.align === 'left' ? 'left' : 'center',
    showTranslation: d.showTranslation !== false,
    lineSpacing: clampNumber(d.lineSpacing, 1.0, 3.0, DEFAULT_DESKTOP_LYRICS.lineSpacing),
    shadow: d.shadow !== false,
    shadowBlur: clampNumber(d.shadowBlur, 0, 30, DEFAULT_DESKTOP_LYRICS.shadowBlur),
    shadowColor:
      typeof d.shadowColor === 'string' ? d.shadowColor : DEFAULT_DESKTOP_LYRICS.shadowColor,
    windowWidth: clampNumber(d.windowWidth, 200, 3000, DEFAULT_DESKTOP_LYRICS.windowWidth),
    windowHeight: clampNumber(d.windowHeight, 60, 800, DEFAULT_DESKTOP_LYRICS.windowHeight),
    windowX: typeof d.windowX === 'number' ? d.windowX : -1,
    windowY: typeof d.windowY === 'number' ? d.windowY : -1,
    alwaysOnTop: d.alwaysOnTop !== false,
    clickThrough: d.clickThrough === true,
    maxLines: clampNumber(d.maxLines, 1, 5, DEFAULT_DESKTOP_LYRICS.maxLines)
  }
}

export function normalizeAppSettings(settings: Partial<AppSettings>): AppSettings {
  const rawCachePath =
    typeof settings.cachePath === 'string' && settings.cachePath.trim()
      ? settings.cachePath.trim()
      : typeof settings.musicCachePath === 'string' && settings.musicCachePath.trim()
        ? settings.musicCachePath.trim()
        : getDefaultCachePath()
  const cachePath = resolve(rawCachePath)
  const launchAtLogin =
    typeof settings.launchAtLogin === 'boolean'
      ? settings.launchAtLogin
      : typeof settings.autoLaunch === 'boolean'
        ? settings.autoLaunch
        : DEFAULT_SETTINGS.launchAtLogin
  const autoLaunch = launchAtLogin
  const closeToTray =
    typeof settings.closeToTray === 'boolean'
      ? settings.closeToTray
      : typeof settings.minimizeToTray === 'boolean'
        ? settings.minimizeToTray
        : DEFAULT_SETTINGS.closeToTray
  const minimizeToTray =
    typeof settings.minimizeToTray === 'boolean' ? settings.minimizeToTray : closeToTray

  return {
    autoCheckLogin: settings.autoCheckLogin !== false,
    autoLaunch,
    launchAtLogin,
    hardwareAcceleration: settings.hardwareAcceleration !== false,
    globalShortcuts: settings.globalShortcuts === true,
    minimizeToTray,
    musicCachePath: cachePath,
    cachePath,
    cachePolicy: normalizeMusicCachePolicy(settings.cachePolicy),
    autoAnalyzeBpm: settings.autoAnalyzeBpm !== false,
    closeToTray,
    startupHomePage: normalizeStartupHomePage(settings.startupHomePage),
    theme: normalizeAppTheme(settings.theme),
    pluginThemeId: normalizePluginThemeId(settings.pluginThemeId),
    blurEffect: settings.blurEffect !== false,
    windowTransparency: settings.windowTransparency === true,
    windowTransparencyEffect: normalizeWindowTransparencyEffect(settings.windowTransparencyEffect),
    useCoverTheme: settings.useCoverTheme !== false,
    lyricFontSize: clampNumber(settings.lyricFontSize, 14, 28, DEFAULT_SETTINGS.lyricFontSize),
    libraryFolders: normalizeStringArray(settings.libraryFolders),
    watchLibrary: settings.watchLibrary !== false,
    smtcEnabled: settings.smtcEnabled !== false,
    discordRpcEnabled: settings.discordRpcEnabled === true,
    accentColor: normalizeAccentColor(
      settings.lightAccentColor ?? DEFAULT_SETTINGS.lightAccentColor
    ),
    lightAccentColor: normalizeLightAccentColor(settings.lightAccentColor),
    darkAccentColor: normalizeDarkAccentColor(settings.darkAccentColor, settings.accentColor),
    fontFamily:
      typeof settings.fontFamily === 'string' && settings.fontFamily.trim()
        ? settings.fontFamily.trim().slice(0, 64)
        : DEFAULT_SETTINGS.fontFamily,
    uiDensity: normalizeUiDensity(settings.uiDensity),
    appBackground: normalizeAppBackground(settings.appBackground),
    cardAppearance: normalizeCardAppearance(settings.cardAppearance),
    nowPlayingBackground: normalizeNowPlayingBackground(settings.nowPlayingBackground),
    lyricAlign: settings.lyricAlign === 'left' ? 'left' : 'center',
    lyricDimOpacity: clampNumber(
      settings.lyricDimOpacity,
      10,
      100,
      DEFAULT_SETTINGS.lyricDimOpacity
    ),
    playbackResumeMode: normalizePlaybackResumeMode(settings.playbackResumeMode),
    playMode: normalizePlayMode(settings.playMode),
    audioOutput: normalizeAudioOutput(settings.audioOutput),
    audioDevice: normalizeAudioDevice(settings.audioDevice),
    audioExclusiveMode: settings.audioExclusiveMode === true,
    audioOutputConfig: normalizeOutputConfig(settings.audioOutputConfig),
    audioProcessing: normalizeAudioProcessingSettings(settings.audioProcessing),
    headphoneCompensation: normalizeHeadphoneCompensationSettings(settings.headphoneCompensation),
    audioEqPresets: normalizeAudioEqPresets(settings.audioEqPresets),
    desktopLyrics: normalizeDesktopLyrics(settings.desktopLyrics),
    proxyMode: normalizeProxyMode(settings.proxyMode),
    proxyHost:
      typeof settings.proxyHost === 'string' ? settings.proxyHost.trim().slice(0, 255) : '',
    proxyPort: clampNumber(settings.proxyPort, 0, 65535, 0),
    streamingActiveProvider:
      typeof settings.streamingActiveProvider === 'string' &&
      settings.streamingActiveProvider.trim()
        ? settings.streamingActiveProvider.trim()
        : DEFAULT_SETTINGS.streamingActiveProvider
  }
}

export function readAppSettings(): AppSettings {
  const result = loadSettingsFile(getSettingsFilePath(), DEFAULT_SETTINGS, normalizeAppSettings)
  appSettingsLoadIssue = result.issue
  if (result.issue?.kind === 'recovered') {
    console.warn('[persistence] application settings recovered from backup')
  } else if (result.issue?.kind === 'corrupt') {
    console.error('[persistence] application settings are corrupt; using defaults for this run')
  }
  return result.settings
}

export function writeAppSettings(settings: AppSettings): void {
  writeSettingsFile(getSettingsFilePath(), settings)
}

export function consumeAppSettingsLoadIssue(): SettingsFileLoadIssue | null {
  const issue = appSettingsLoadIssue
  appSettingsLoadIssue = null
  return issue
}

export function getRestartReasons(settings: AppSettings, launch: AppSettings): string[] {
  const reasons: string[] = []
  if (settings.hardwareAcceleration !== launch.hardwareAcceleration) {
    reasons.push('GPU 加速')
  }
  if (settings.windowTransparency !== launch.windowTransparency) {
    reasons.push('窗口透明')
  }
  if (resolve(settings.musicCachePath) !== resolve(launch.musicCachePath)) {
    reasons.push('缓存位置')
  }
  return reasons
}

export function createSettingsSnapshot(
  settings: AppSettings,
  launch: AppSettings
): SettingsSnapshot {
  const restartReasons = getRestartReasons(settings, launch)
  return {
    ...settings,
    settings: { ...settings },
    defaults: {
      cachePath: getDefaultCachePath()
    },
    paths: {
      settingsFile: getSettingsFilePath(),
      userDataPath: app.getPath('userData'),
      activeCachePath: launch.musicCachePath || getDefaultCachePath()
    },
    appVersion: app.getVersion(),
    platform: process.platform,
    restartRequired: restartReasons.length > 0,
    restartReasons
  }
}

export async function getDirectorySize(directory: string): Promise<number> {
  try {
    const info = await stat(directory)
    if (!info.isDirectory()) return info.size

    const entries = await readdir(directory, { withFileTypes: true })
    const sizes = await Promise.all(
      entries.map((entry) => {
        const fullPath = join(directory, entry.name)
        return entry.isDirectory() ? getDirectorySize(fullPath) : stat(fullPath).then((s) => s.size)
      })
    )
    return sizes.reduce((sum, size) => sum + size, 0)
  } catch {
    return 0
  }
}
