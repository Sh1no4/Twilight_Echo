export type AppTheme = 'system' | 'pureWhite' | 'dark'
export type PlaybackResumeMode = 'off' | 'track' | 'trackAndPosition'
export type AudioOutputId = 'wasapi' | 'asio' | 'coreaudio' | 'alsa'
export type EqMode = 'graphic' | 'parametric'
export type VolumeNormalizationMode = 'off' | 'track' | 'album' | 'loudnorm'
export type ChannelRoutingMode =
  | 'auto'
  | 'stereo'
  | 'stereo-to-5.1'
  | 'stereo-to-7.1'
  | 'mono-to-stereo'
  | 'mono-to-multichannel'
export type DsdOutputMode = 'auto' | 'pcm' | 'dop' | 'native'
export type SacdProgramMode = 'auto' | 'stereo' | 'multichannel'
export type UiDensity = 'compact' | 'standard' | 'comfortable'
export type NowPlayingBackground = 'blur' | 'fluid' | 'solid'
export type LyricAlign = 'center' | 'left'

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

export type EqualizerFilterType =
  | 'peak'
  | 'lowShelf'
  | 'highShelf'
  | 'bandPass'
  | 'lowPass'
  | 'highPass'
  | 'allPass'

export interface EqualizerBand {
  frequency: number
  gain: number
  q: number
  filterType: EqualizerFilterType
}

export interface AudioProcessingSettings {
  dspEnabled: boolean
  clipGuard: boolean
  fftEnabled: boolean
  fftResolution: number
  highResolution: boolean
  dsdToPcm: boolean
  dsdOutputMode: DsdOutputMode
  sacdProgramMode: SacdProgramMode
  eqEnabled: boolean
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
  volumeNormalization: VolumeNormalizationMode
  replayGainPreamp: number
  replayGainFallback: number
  replayGainClip: boolean
  convolverEnabled: boolean
  convolverIrPath: string
  crossfeedEnabled: boolean
  crossfeedStrength: number
  gapless: boolean
  crossfadeSeconds: number
}

export interface AudioEqPreset {
  id: string
  name: string
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
}

export interface AudioOutputOption {
  id: AudioOutputId
  label: string
  description: string
  platform: NodeJS.Platform
  supportsExclusive: boolean
}

export interface AudioDeviceOption {
  id: string
  label: string
  isDefault: boolean
  backend?: string
  name?: string
  channels?: number
  sampleRates?: number[]
  driverName?: string
  driverVersion?: number
  bitDepths?: number[]
  latencyFrames?: number
  minBufferSize?: number
  maxBufferSize?: number
  granularity?: number
  preferredBufferSize?: number
  capabilityVersion?: number
  supportsExclusive?: boolean
  supportsHogMode?: boolean
  supportsDirectHw?: boolean
  supportsDop?: boolean
  supportsNativeDsd?: boolean
  supportedDsdRates?: number[]
  nativeDsdSampleRates?: number[]
  nativeDsdSampleFormats?: string[]
  dopCarrierSampleRates?: number[]
  dopCarrierFormats?: string[]
  pathKind?: string
  capabilityReason?: string
}

export interface OutputConfig {
  preferredBufferSize: number
  routingMode: ChannelRoutingMode
  wasapiExclusivePushMode?: boolean
  upmixCenterGain?: number
  upmixLfeGain?: number
  upmixLfeLowpassHz?: number
  upmixSurroundGain?: number
  upmixSideGain?: number
  upmixSurroundDelayMs?: number
}

export interface AppSettings {
  autoCheckLogin: boolean
  autoLaunch: boolean
  minimizeToTray: boolean
  launchAtLogin: boolean
  hardwareAcceleration: boolean
  globalShortcuts: boolean
  musicCachePath: string
  cachePath: string
  closeToTray: boolean
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
  fontFamily: string
  uiDensity: UiDensity
  nowPlayingBackground: NowPlayingBackground
  lyricAlign: LyricAlign
  lyricDimOpacity: number
  playbackResumeMode: PlaybackResumeMode
  audioOutput: AudioOutputId
  audioDevice: string
  audioExclusiveMode: boolean
  audioOutputConfig: OutputConfig
  audioProcessing: AudioProcessingSettings
  audioEqPresets: AudioEqPreset[]
  desktopLyrics: DesktopLyricsSettings
}

export interface SettingsSnapshot {
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
