import type {
  AudioOutputId,
  OutputConfig,
  AudioProcessingSettings,
  PlayMode,
  EqMode,
  EqualizerBand
} from '../audioEngineManager'
import type { HeadphoneCompensationSettings } from '../audioProcessingEffective'

export type PlayerShortcutAction = 'previous' | 'next' | 'playPause'
export type AppTheme = 'system' | 'pureWhite' | 'dark'
export type PlaybackResumeMode = 'off' | 'track' | 'trackAndPosition'
export type StartupHomePage = 'local' | 'streaming'
export type UiDensity = 'compact' | 'standard' | 'comfortable'
export type ProxyMode = 'auto' | 'custom' | 'off'
export type NowPlayingBackground = 'blur' | 'fluid' | 'solid'
export type LyricAlign = 'center' | 'left'
export type StreamingAudioCachePolicy = 'off' | 'provider'
export type AppBackgroundPage = 'local' | 'settings' | 'streaming' | 'player'
export type AppBackgroundKind = 'color' | 'image'

export interface AppBackgroundColorPair {
  light: string
  dark: string
  kind: AppBackgroundKind
  image: string
}

export interface AppBackgroundPageOverride extends AppBackgroundColorPair {
  inherit: boolean
}

export interface AppBackgroundSettings {
  global: AppBackgroundColorPair
  pages: Record<AppBackgroundPage, AppBackgroundPageOverride>
}

export type CardShadowStrength = 'none' | 'subtle' | 'medium' | 'strong'
export type CardHoverEffect = 'none' | 'lift' | 'zoom' | 'glow'

export interface CardAppearanceTheme {
  blurRadius: number
  blurSaturation: number
  backgroundColor: string
  backgroundOpacity: number
  borderColor: string
  borderOpacity: number
  borderWidth: number
  borderRadius: number
  shadowStrength: CardShadowStrength
  hoverEffect: CardHoverEffect
  glassHighlight: boolean
}

export interface BackgroundEffectTheme {
  blur: number
  brightness: number
  dim: number
}

export interface BackgroundEffectSettings {
  enabled: boolean
  light: BackgroundEffectTheme
  dark: BackgroundEffectTheme
}

export interface CardAppearanceSettings {
  enabled: boolean
  light: CardAppearanceTheme
  dark: CardAppearanceTheme
  background: BackgroundEffectSettings
}

export interface DesktopLyricsSettings {
  enabled: boolean
  fontSize: number
  fontFamily: string
  fontWeight: number
  color: string
  highlightColor: string
  bgColor: string
  bgOpacity: number
  align: LyricAlign
  showTranslation: boolean
  lineSpacing: number
  shadow: boolean
  shadowBlur: number
  shadowColor: string
  windowWidth: number
  windowHeight: number
  windowX: number
  windowY: number
  alwaysOnTop: boolean
  clickThrough: boolean
  maxLines: number
}

export interface MusicCachePolicySettings {
  cover: boolean
  lyrics: boolean
  metadata: boolean
  streamingAudio: StreamingAudioCachePolicy
}

export interface AudioEqPreset {
  id: string
  name: string
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
}

export interface AppSettings {
  autoCheckLogin: boolean
  autoLaunch: boolean
  launchAtLogin: boolean
  hardwareAcceleration: boolean
  globalShortcuts: boolean
  minimizeToTray: boolean
  musicCachePath: string
  cachePath: string
  cachePolicy: MusicCachePolicySettings
  autoAnalyzeBpm: boolean
  closeToTray: boolean
  startupHomePage: StartupHomePage
  theme: AppTheme
  pluginThemeId: string | null
  blurEffect: boolean
  useCoverTheme: boolean
  lyricFontSize: number
  libraryFolders: string[]
  watchLibrary: boolean
  smtcEnabled: boolean
  discordRpcEnabled: boolean
  accentColor: string
  lightAccentColor: string
  darkAccentColor: string
  fontFamily: string
  uiDensity: UiDensity
  appBackground: AppBackgroundSettings
  cardAppearance: CardAppearanceSettings
  nowPlayingBackground: NowPlayingBackground
  lyricAlign: LyricAlign
  lyricDimOpacity: number
  playbackResumeMode: PlaybackResumeMode
  playMode: PlayMode
  audioOutput: AudioOutputId
  audioDevice: string
  audioExclusiveMode: boolean
  audioOutputConfig: OutputConfig
  audioProcessing: AudioProcessingSettings
  headphoneCompensation: HeadphoneCompensationSettings
  audioEqPresets: AudioEqPreset[]
  desktopLyrics: DesktopLyricsSettings
  proxyMode: ProxyMode
  proxyHost: string
  proxyPort: number
  streamingActiveProvider: string
}

export interface PlaybackSession {
  version: number
  savedAt: string
  mode: PlaybackResumeMode
  playMode?: PlayMode
  track: unknown
  position: number
}

export interface SettingsSnapshot extends AppSettings {
  settings: AppSettings
  defaults: {
    cachePath: string
  }
  paths: {
    settingsFile: string
    userDataPath: string
    activeCachePath: string
  }
  appVersion: string
  platform: string
  restartRequired: boolean
  restartReasons: string[]
}

export interface PlayerShortcutStatus {
  accelerator: string
  action: PlayerShortcutAction
  label: string
  registered: boolean
  error: string | null
}

export const PLAYER_SHORTCUTS: { accelerator: string; action: PlayerShortcutAction; label: string }[] = [
  { accelerator: 'CommandOrControl+Alt+Left', action: 'previous', label: '上一首' },
  { accelerator: 'CommandOrControl+Alt+Right', action: 'next', label: '下一首' },
  { accelerator: 'CommandOrControl+Alt+Space', action: 'playPause', label: '播放 / 暂停' }
]
