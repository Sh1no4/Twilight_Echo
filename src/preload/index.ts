import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type AudioEngineEventCallback = (event: { name: string; data: unknown }) => void
type AudioEngineEndFileCallback = (reason: string) => void
type AudioEngineSimpleCallback = () => void
type AudioEngineErrorCallback = (message: string) => void
type AudioEnginePlaybackInfoCallback = (info: PlaybackInfo) => void
type AudioOutputId = 'wasapi' | 'asio' | 'coreaudio' | 'alsa'
type PlayMode = 'sequential' | 'repeat' | 'shuffle'
type PlayerShortcutAction = 'previous' | 'next' | 'playPause'
type AppTheme = 'system' | 'pureWhite' | 'dark'
type PlaybackResumeMode = 'off' | 'track' | 'trackAndPosition'
type UiDensity = 'compact' | 'standard' | 'comfortable'
type NowPlayingBackground = 'blur' | 'fluid' | 'solid'
type LyricAlign = 'center' | 'left'

interface DesktopLyricsSettings {
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

type BuiltInTrackSource = 'local' | 'ncm'
type TrackSource = BuiltInTrackSource | (string & {})
type TwilightPluginType = 'provider' | 'tool' | 'ui' | 'theme' | 'dsp'
type TwilightPluginStatus = 'installed' | 'enabled' | 'disabled' | 'invalid' | 'failed'
type TwilightPluginIndexInstallState =
  | 'not-installed'
  | 'installed'
  | 'update-available'
  | 'incompatible'
  | 'built-in-blocked'
type TwilightMediaProviderCapability =
  | 'search'
  | 'playbackUrl'
  | 'lyrics'
  | 'cover'
  | 'playlist'
  | 'library'
  | 'login'
type TwilightMediaProviderMethod =
  | 'getPlaybackUrl'
  | 'getLyrics'
  | 'searchSongs'
  | 'searchPlaylists'
  | 'searchArtists'
  | 'fetchPlaylistTracks'
  | 'checkLogin'
  | 'getProfile'
  | 'logout'
  | 'openOfficialLogin'
  | 'sendCaptcha'
  | 'loginByPhonePassword'
  | 'loginByPhoneCaptcha'
  | 'loginByEmailPassword'
  | 'getQrLogin'
  | 'getQrKey'
  | 'getQrImage'
  | 'checkQrLogin'
  | 'fetchUserLibrary'
  | 'fetchLikedTracks'
  | 'fetchRecommendSongs'
  | 'fetchRecommendPlaylists'
  | 'fetchPersonalFm'
  | 'fetchPrivateContent'
  | 'fetchArtistTopSongs'
  | 'fetchArtistPlaylists'
  | 'fetchUserPlaylistsByUid'
  | 'fetchUserFollows'
  | 'fetchUserFolloweds'
  | 'likeTrack'
  | 'isTrackLiked'

interface TwilightProviderStreamingSection {
  id: string
  title: string
  icon: string
  method: string
  args?: unknown[]
}

interface TwilightProviderUiMetadata {
  icon: string
  color?: string
  description?: string
  authType: 'qr' | 'oauth' | 'cookie'
  loginInstructions?: string
  qrStatusCodes?: {
    waiting: number
    scanned: number | null
    expired: number
    denied?: number
    success: number
  }
  showBrowserButton?: boolean
  loginExtraActions?: Array<{
    label: string
    icon: string
    method: string
  }>
  streamingSections?: TwilightProviderStreamingSection[]
  streamingLibraryTab?: boolean
  streamingSearch?: boolean
  unifiedLibrary?: boolean
}
type EqMode = 'graphic' | 'parametric'
type VolumeNormalizationMode = 'off' | 'track' | 'album' | 'loudnorm'
type ChannelRoutingMode =
  | 'auto'
  | 'stereo'
  | 'stereo-to-5.1'
  | 'stereo-to-7.1'
  | 'mono-to-stereo'
  | 'mono-to-multichannel'
type DsdOutputMode = 'auto' | 'pcm' | 'dop' | 'native'
type SacdProgramMode = 'auto' | 'stereo' | 'multichannel'
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

interface HeadphoneCompensationSettings {
  enabled: boolean
  productId: string
  productName: string
  vendorName: string
  eqId: string
  author: string
  details: string
  link: string
  preampDb: number
  bands: EqualizerBand[]
}

interface AudioEqPreset {
  id: string
  name: string
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
}

interface ConvolverInfo {
  loaded: boolean
  active: boolean
  irResampled: boolean
  path: string
  sampleRate: number
  channels: number
  lengthFrames: number
  lengthMs: number
  partitionSize: number
  latencyFrames: number
  channelMappingMode: string
  warning: string
  lastError: string
}

interface NativeAudioMetadata {
  source: string
  title: string
  artist: string
  album: string
  albumArtist: string
  composer: string
  year: string
  genre: string
  trackNumber: string
  discNumber: string
  comment: string
  codec: string
  container: string
  channelLayout: string
  sampleRate: number
  channelCount: number
  bitDepth: number
  bitrate: number
  duration: number
  playable?: boolean
  reasonCode?: string
  isDsd: boolean
  dsdMode: string
  dsdRate: number
  outputModes?: string[]
  coverMime: string
  coverDataBase64: string
  replayGainTrackGain: number | null
  replayGainAlbumGain: number | null
  r128TrackGain: number | null
  r128AlbumGain: number | null
  error: string
  isoTracks?: NativeAudioMetadata[]
}

interface VisualizationOptions {
  spectrumPoints?: number
  waveformPoints?: number
  spectrogramFrames?: number
}

interface VisualizationData {
  spectrum: number[]
  waveform: number[]
  peakDb: number
  rmsDb: number
  lufsMomentary: number | null
  spectrogram: number[][]
  sampleRate: number
  active: boolean
}

interface TrackData {
  id: string
  title: string
  artist: string
  album: string
  filePath: string
  fileName: string
  dir?: string
  duration: number
  size: number
  cover: string | null
  lyrics: string | null
  translatedLyrics?: string | null
  source?: TrackSource
  ncmSongId?: number
  streamUrl?: string | null
  format?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
}

interface AudioEngineQueueItem {
  id: string
  source: string
  title?: string
  artist?: string
  album?: string
  duration?: number
  codec?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
}

interface PlaybackSession {
  version: 1
  savedAt: string
  mode: PlaybackResumeMode
  track: TrackData
  position: number
}

interface AppSettings {
  autoCheckLogin: boolean
  autoLaunch: boolean
  launchAtLogin: boolean
  hardwareAcceleration: boolean
  globalShortcuts: boolean
  minimizeToTray: boolean
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
  lightAccentColor: string
  darkAccentColor: string
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
  headphoneCompensation: HeadphoneCompensationSettings
  audioEqPresets: AudioEqPreset[]
  desktopLyrics: DesktopLyricsSettings
  streamingActiveProvider: string
}

interface OpraCatalogStatus {
  loaded: boolean
  loading: boolean
  source: 'empty' | 'cache' | 'network'
  cachePath: string
  vendorCount: number
  productCount: number
  profileCount: number
  lastUpdatedAt: string | null
  lastError: string
}

interface OpraProfile {
  eqId: string
  productId: string
  productName: string
  vendorName: string
  author: string
  details: string
  link: string
  attributionUrl: string
  preampDb: number
  bands: EqualizerBand[]
  applicable: boolean
  unsupportedBandTypes: string[]
}

interface SettingsSnapshot extends AppSettings {
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

interface AudioDeviceOption {
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

interface TwilightPluginDescriptor {
  id: string
  name: string
  version: string
  description: string
  author: string
  license: string
  type: TwilightPluginType[]
  main?: string
  binary?: Record<string, string>
  dependencies?: Record<string, string>
  engines: {
    twilightEcho: string
  }
  apiVersion: number
  permissions: string[]
  status: TwilightPluginStatus
  enabled: boolean
  builtIn: boolean
  error: string | null
  isDsp: boolean
  source: 'directory' | 'tep' | 'bundled' | 'index' | 'scan'
  installedAt: string | null
  updatedAt: string | null
  paths: {
    root: string
    versionRoot: string
    manifestPath: string
    dataDir: string
    logPath: string
  }
}

interface TwilightPluginInstallResult {
  plugin: TwilightPluginDescriptor
  warning: string
}

interface TwilightPluginIndexEntry {
  id: string
  name: string
  version: string
  description: string
  author: string
  license: string
  type: TwilightPluginType[]
  main?: string
  binary?: Record<string, string>
  dependencies?: Record<string, string>
  engines: {
    twilightEcho: string
  }
  apiVersion: number
  permissions: string[]
  homepage?: string
  repository?: string
  icon?: string
  sourceUrl: string
  checksumSha256: string
  tags?: string[]
  verified?: boolean
  installState?: TwilightPluginIndexInstallState
  installedVersion?: string
}

interface TwilightMediaProviderRegistration {
  id: string
  name: string
  capabilities: TwilightMediaProviderCapability[]
  ui?: TwilightProviderUiMetadata
}

type TwilightUiContributionKind =
  | 'sidebarPage'
  | 'playerBarButton'
  | 'settingsPanel'
  | 'localSidebarItem'
  | 'streamingHome'

interface TwilightUiContribution {
  id: string
  kind: TwilightUiContributionKind
  title: string
  description?: string
  icon?: string
  command?: string
  renderMode?: 'command' | 'html'
  autoLoad?: boolean
}

interface TwilightThemeContribution {
  id: string
  name: string
  description?: string
  variables?: Record<string, string>
  stylesheet?: string
}

interface TwilightPluginExtensionContribution {
  pluginId: string
  ui: TwilightUiContribution[]
  themes: TwilightThemeContribution[]
}

interface OutputConfig {
  preferredBufferSize: number
  routingMode: ChannelRoutingMode
  wasapiExclusivePushMode?: boolean
}

interface LatencyInfo {
  bufferLatencyMs: number
  outputLatencyMs: number
  totalLatencyMs: number
}

interface OutputDiagnostics {
  sessionUnderrunCount: number
  sessionBufferDropCount: number
  sessionRecoveryCount: number
  lifetimeUnderrunCount: number
  lifetimeBufferDropCount: number
  lifetimeRecoveryCount: number
  driverRestartCount: number
  deviceLostCount: number
  lastError: string
}

interface AudioOutputOption {
  id: AudioOutputId
  label: string
  description: string
  platform: NodeJS.Platform
  supportsExclusive: boolean
}

interface AudioOutputState {
  output: AudioOutputId
  device: string
  exclusiveMode: boolean
  exclusiveAvailable: boolean
  outputOptions: AudioOutputOption[]
  deviceOptions: AudioDeviceOption[]
}

interface OutputInfo {
  exclusive: boolean
  supportsOutputPerfect: boolean
  sourceExact: boolean
  outputPerfect: boolean
  pcmPassthrough: boolean
  resampled: boolean
  perfectReason: string
  outputSampleRate: number
  outputBitDepth: number
  backend: string
  actualBackend: string
  deviceName: string
  actualDeviceName: string
  driverName: string
  actualDriverName: string
  driverVersion: number
  actualDriverVersion: number
  actualOutputFormat: string
  actualSampleRate: number
  actualBitDepth: number
  actualChannels: number
  accessMode: string
  devicePathKind: string
  perfectReasonCode: string
  capabilityReason: string
  driverDopCapable: boolean
  driverNativeDsdCapable: boolean
  driverDopCarrierSampleRates: number[]
  driverDopCarrierFormats: string[]
  driverNativeDsdSampleRates: number[]
  nativeDsdRuntimeState: string
  nativeDsdRequestedRate: number
  nativeDsdActualRate: number
  nativeDsdChannels: number
  nativeDsdExplicitlyCapable: boolean
  nativeDsdAdvertisedSampleRates: number[]
  nativeDsdRuntimeReason: string
  bufferSizeFrames: number
  latencyFrames: number
  latencyMs: number
  latencyInfo: LatencyInfo
  channelRoutingMode: string
  diagnostics: OutputDiagnostics
  deviceRecovered: boolean
  recoveryCount: number
  nativeDsp?: { plugins: unknown[] }
  isDsd: boolean
  dsdMode: string
  dsdRate: number
}

type PlaybackOutputInfoMirror = Pick<
  OutputInfo,
  | 'actualBackend'
  | 'actualOutputFormat'
  | 'actualSampleRate'
  | 'actualBitDepth'
  | 'actualChannels'
  | 'bufferSizeFrames'
  | 'latencyFrames'
  | 'latencyMs'
  | 'latencyInfo'
  | 'channelRoutingMode'
  | 'supportsOutputPerfect'
  | 'sourceExact'
  | 'diagnostics'
  | 'deviceRecovered'
  | 'recoveryCount'
  | 'outputSampleRate'
  | 'outputBitDepth'
  | 'outputPerfect'
  | 'pcmPassthrough'
  | 'perfectReason'
  | 'perfectReasonCode'
  | 'isDsd'
  | 'dsdMode'
  | 'dsdRate'
> &
  Partial<Pick<OutputInfo, 'accessMode' | 'devicePathKind' | 'capabilityReason'>>

interface PlaybackInfo extends PlaybackOutputInfoMirror {
  state: 'stopped' | 'playing' | 'paused'
  position: number
  duration: number
  volume: number
  queueIndex: number
  playMode: PlayMode
  source: string
  codec: string
  bitrate: number
  sourceSampleRate: number
  sourceBitDepth: number
  decodedSampleRate: number
  decodedBitDepth: number
  decodedChannels: number
  decodedSampleFormat: string
  outputBackend: string
  outputDevice: string
  outputInfo: OutputInfo
  actualBackend: string
  driverName: string
  driverVersion: number
  actualOutputFormat: string
  actualSampleRate: number
  actualBitDepth: number
  actualChannels: number
  bufferSizeFrames: number
  latencyFrames: number
  latencyMs: number
  latencyInfo: LatencyInfo
  channelRoutingMode: string
  supportsOutputPerfect: boolean
  sourceExact: boolean
  diagnostics: OutputDiagnostics
  deviceRecovered: boolean
  recoveryCount: number
  outputSampleRate: number
  outputBitDepth: number
  channelCount: number
  outputPerfect: boolean
  pcmPassthrough: boolean
  dspActive: boolean
  replayGainActive: boolean
  eqActive: boolean
  convolverActive: boolean
  crossfeedActive: boolean
  crossfadeActive: boolean
  fftActive: boolean
  irResampled: boolean
  replayGainDb: number
  crossfeedStrength: number
  crossfadeSeconds: number
  convolverLatencyFrames: number
  partitionSize: number
  channelMappingMode: string
  perfectReason: string
  perfectReasonCode: string
  isDsd: boolean
  dsdMode: string
  dsdRate: number
  gaplessActive: boolean
  preloadReady: boolean
  upcomingTrack: AudioEngineQueueItem | null
}

interface AudioEnginePlayResult {
  nativeStarted: boolean
  fallbackReason: string
}

const audioEngineEventCallbacks = new Set<AudioEngineEventCallback>()
const audioEngineEndFileCallbacks = new Set<AudioEngineEndFileCallback>()
const audioEngineStartFileCallbacks = new Set<AudioEngineSimpleCallback>()
const audioEngineReadyCallbacks = new Set<AudioEngineSimpleCallback>()
const audioEngineErrorCallbacks = new Set<AudioEngineErrorCallback>()
const audioEngineDisconnectedCallbacks = new Set<AudioEngineSimpleCallback>()
const audioEnginePlaybackInfoCallbacks = new Set<AudioEnginePlaybackInfoCallback>()
const playerShortcutCallbacks = new Set<(action: PlayerShortcutAction) => void>()
const settingsChangedCallbacks = new Set<(snapshot: SettingsSnapshot) => void>()
const desktopLyricsToggleCallbacks = new Set<(enabled: boolean) => void>()
const desktopLyricsInitSettingsCallbacks = new Set<(settings: DesktopLyricsSettings) => void>()
const desktopLyricsTrackCallbacks = new Set<(data: { lyrics: string | null; translatedLyrics?: string | null; title?: string; artist?: string }) => void>()
const desktopLyricsTimeCallbacks = new Set<(time: number) => void>()
const desktopLyricsSettingsUpdateCallbacks = new Set<(settings: DesktopLyricsSettings) => void>()
const savePlaybackSessionCallbacks = new Set<() => Promise<void> | void>()
const pluginChangedCallbacks = new Set<() => void>()

ipcRenderer.on('audioEngine:property-change', (_event, data: { name: string; data: unknown }) => {
  for (const cb of audioEngineEventCallbacks) {
    cb(data)
  }
})

ipcRenderer.on('audioEngine:end-file', (_event, data: { reason: string }) => {
  for (const cb of audioEngineEndFileCallbacks) {
    cb(data.reason)
  }
})

ipcRenderer.on('audioEngine:start-file', () => {
  for (const cb of audioEngineStartFileCallbacks) {
    cb()
  }
})

ipcRenderer.on('audioEngine:ready', () => {
  for (const cb of audioEngineReadyCallbacks) {
    cb()
  }
})

ipcRenderer.on('audioEngine:error', (_event, message: string) => {
  for (const cb of audioEngineErrorCallbacks) {
    cb(message)
  }
})

ipcRenderer.on('audioEngine:disconnected', () => {
  for (const cb of audioEngineDisconnectedCallbacks) {
    cb()
  }
})

ipcRenderer.on('audioEngine:playback-info', (_event, info: PlaybackInfo) => {
  for (const cb of audioEnginePlaybackInfoCallbacks) {
    cb(info)
  }
})

ipcRenderer.on('player:shortcut', (_event, action: PlayerShortcutAction) => {
  for (const cb of playerShortcutCallbacks) {
    cb(action)
  }
})

ipcRenderer.on('settings:changed', (_event, snapshot: SettingsSnapshot) => {
  for (const cb of settingsChangedCallbacks) {
    cb(snapshot)
  }
})

ipcRenderer.on('plugins:changed', () => {
  for (const cb of pluginChangedCallbacks) {
    cb()
  }
})

ipcRenderer.on('desktopLyrics:toggleChanged', (_event, enabled: boolean) => {
  for (const cb of desktopLyricsToggleCallbacks) {
    cb(enabled)
  }
})

ipcRenderer.on('desktopLyrics:initSettings', (_event, settings: DesktopLyricsSettings) => {
  for (const cb of desktopLyricsInitSettingsCallbacks) {
    cb(settings)
  }
})

ipcRenderer.on('desktopLyrics:updateTrack', (_event, data: { lyrics: string | null; translatedLyrics?: string | null; title?: string; artist?: string }) => {
  for (const cb of desktopLyricsTrackCallbacks) {
    cb(data)
  }
})

ipcRenderer.on('desktopLyrics:updateTime', (_event, time: number) => {
  for (const cb of desktopLyricsTimeCallbacks) {
    cb(time)
  }
})

ipcRenderer.on('desktopLyrics:updateSettings', (_event, settings: DesktopLyricsSettings) => {
  for (const cb of desktopLyricsSettingsUpdateCallbacks) {
    cb(settings)
  }
})

ipcRenderer.on('desktopLyrics:position', (_event, pos: { x: number; y: number }) => {
  // Forward to a temporary global that the HTML page can read
  ;(window as unknown as Record<string, unknown>).__dlPos = pos
})

ipcRenderer.on('app:save-playback-session', async (_event, requestId: string) => {
  try {
    await Promise.allSettled(
      [...savePlaybackSessionCallbacks].map((cb) => Promise.resolve().then(cb))
    )
  } finally {
    await ipcRenderer.invoke('app:playback-session-saved', requestId)
  }
})

const api = {
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('window:toggleMaximize'),
    close: (): void => ipcRenderer.send('window:close')
  },
  dialog: {
    openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder')
  },
  shell: {
    showItemInFolder: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('shell:showItemInFolder', filePath),
    openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:openPath', path),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
  },
  discord: {
    updateActivity: (data: {
      title: string
      artist: string
      album?: string
      playing: boolean
      startTime?: number
    }): Promise<void> => ipcRenderer.invoke('discord:updateActivity', data),
    clearActivity: (): Promise<void> => ipcRenderer.invoke('discord:clearActivity')
  },
  library: {
    onChanged: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('library:changed', handler)
      return () => ipcRenderer.removeListener('library:changed', handler)
    }
  },
  fs: {
    scanMusicFiles: (folderPath: string): Promise<unknown[]> =>
      ipcRenderer.invoke('fs:scanMusicFiles', folderPath),
    readAudioFile: (filePath: string): Promise<{ buffer: ArrayBuffer; mimeType: string }> =>
      ipcRenderer.invoke('fs:readAudioFile', filePath),
    getAudioFileUrl: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('fs:getAudioFileUrl', filePath),
    onScanProgress: (cb: (progress: { current: number; total: number }) => void): (() => void) => {
      const handler = (_event, data: { current: number; total: number }): void => cb(data)
      ipcRenderer.on('fs:scanProgress', handler)
      return () => ipcRenderer.removeListener('fs:scanProgress', handler)
    }
  },
  audioEngine: {
    loadQueue: (items: AudioEngineQueueItem[], startIndex?: number): Promise<void> =>
      ipcRenderer.invoke('audioEngine:loadQueue', items, startIndex),
    play: (filePath: string, startTime?: number): Promise<AudioEnginePlayResult> =>
      ipcRenderer.invoke('audioEngine:play', filePath, startTime),
    togglePause: (): Promise<void> => ipcRenderer.invoke('audioEngine:togglePause'),
    seek: (time: number): Promise<void> => ipcRenderer.invoke('audioEngine:seek', time),
    setVolume: (volume: number): Promise<void> =>
      ipcRenderer.invoke('audioEngine:setVolume', volume),
    stop: (): Promise<void> => ipcRenderer.invoke('audioEngine:stop'),
    next: (): Promise<void> => ipcRenderer.invoke('audioEngine:next'),
    previous: (): Promise<void> => ipcRenderer.invoke('audioEngine:previous'),
    setPlayMode: (mode: PlayMode): Promise<void> =>
      ipcRenderer.invoke('audioEngine:setPlayMode', mode),
    getUpcomingTrack: (): Promise<AudioEngineQueueItem | null> =>
      ipcRenderer.invoke('audioEngine:getUpcomingTrack'),
    setExclusiveMode: (enabled: boolean): Promise<AudioOutputState> =>
      ipcRenderer.invoke('audioEngine:setExclusiveMode', enabled),
    getExclusiveMode: (): Promise<boolean> => ipcRenderer.invoke('audioEngine:getExclusiveMode'),
    setAudioOutput: (output: AudioOutputId, device?: string): Promise<AudioOutputState> =>
      ipcRenderer.invoke('audioEngine:setAudioOutput', output, device),
    setAudioDevice: (device: string): Promise<AudioOutputState> =>
      ipcRenderer.invoke('audioEngine:setAudioDevice', device),
    setOutputConfig: (config: OutputConfig): Promise<OutputConfig> =>
      ipcRenderer.invoke('audioEngine:setOutputConfig', config),
    getAudioOutput: (): Promise<AudioOutputId> => ipcRenderer.invoke('audioEngine:getAudioOutput'),
    getAudioOutputOptions: (): Promise<AudioOutputOption[]> =>
      ipcRenderer.invoke('audioEngine:getAudioOutputOptions'),
    getAudioOutputState: (): Promise<AudioOutputState> =>
      ipcRenderer.invoke('audioEngine:getAudioOutputState'),
    setAudioProcessing: (
      settings: Partial<AudioProcessingSettings>
    ): Promise<AudioProcessingSettings> =>
      ipcRenderer.invoke('audioEngine:setAudioProcessing', settings),
    getAudioProcessing: (): Promise<AudioProcessingSettings> =>
      ipcRenderer.invoke('audioEngine:getAudioProcessing'),
    selectImpulseResponse: (): Promise<string | null> =>
      ipcRenderer.invoke('audioEngine:selectImpulseResponse'),
    loadImpulseResponse: (path: string): Promise<ConvolverInfo> =>
      ipcRenderer.invoke('audioEngine:loadImpulseResponse', path),
    unloadImpulseResponse: (): Promise<ConvolverInfo> =>
      ipcRenderer.invoke('audioEngine:unloadImpulseResponse'),
    getConvolverInfo: (): Promise<ConvolverInfo> =>
      ipcRenderer.invoke('audioEngine:getConvolverInfo'),
    setEqBands: (settings: Partial<AudioProcessingSettings>): Promise<AudioProcessingSettings> =>
      ipcRenderer.invoke('audioEngine:setEqBands', settings),
    setEqPreset: (preset: AudioEqPreset): Promise<AudioProcessingSettings> =>
      ipcRenderer.invoke('audioEngine:setEqPreset', preset),
    setCrossfeedStrength: (strength: number): Promise<AudioProcessingSettings> =>
      ipcRenderer.invoke('audioEngine:setCrossfeedStrength', strength),
    setReplayGainMode: (
      mode: VolumeNormalizationMode,
      preamp?: number,
      fallback?: number,
      clip?: boolean
    ): Promise<AudioProcessingSettings> =>
      ipcRenderer.invoke('audioEngine:setReplayGainMode', mode, preamp, fallback, clip),
    getMetadata: (source: string): Promise<NativeAudioMetadata | null> =>
      ipcRenderer.invoke('audioEngine:getMetadata', source),
    getPlaybackInfo: (): Promise<PlaybackInfo> => ipcRenderer.invoke('audioEngine:getPlaybackInfo'),
    getSpectrumData: (points?: number): Promise<number[]> =>
      ipcRenderer.invoke('audioEngine:getSpectrumData', points),
    getVisualizationData: (options?: VisualizationOptions): Promise<VisualizationData> =>
      ipcRenderer.invoke('audioEngine:getVisualizationData', options),

    onPropertyChange: (cb: AudioEngineEventCallback): (() => void) => {
      audioEngineEventCallbacks.add(cb)
      return () => audioEngineEventCallbacks.delete(cb)
    },

    onEndFile: (cb: AudioEngineEndFileCallback): (() => void) => {
      audioEngineEndFileCallbacks.add(cb)
      return () => audioEngineEndFileCallbacks.delete(cb)
    },

    onStartFile: (cb: AudioEngineSimpleCallback): (() => void) => {
      audioEngineStartFileCallbacks.add(cb)
      return () => audioEngineStartFileCallbacks.delete(cb)
    },

    onReady: (cb: AudioEngineSimpleCallback): (() => void) => {
      audioEngineReadyCallbacks.add(cb)
      return () => audioEngineReadyCallbacks.delete(cb)
    },

    onError: (cb: AudioEngineErrorCallback): (() => void) => {
      audioEngineErrorCallbacks.add(cb)
      return () => audioEngineErrorCallbacks.delete(cb)
    },

    onDisconnected: (cb: AudioEngineSimpleCallback): (() => void) => {
      audioEngineDisconnectedCallbacks.add(cb)
      return () => audioEngineDisconnectedCallbacks.delete(cb)
    },

    onPlaybackInfo: (cb: AudioEnginePlaybackInfoCallback): (() => void) => {
      audioEnginePlaybackInfoCallbacks.add(cb)
      return () => audioEnginePlaybackInfoCallbacks.delete(cb)
    }
  },
  opra: {
    search: (query: string): Promise<OpraProfile[]> => ipcRenderer.invoke('opra:search', query),
    getProfile: (eqId: string): Promise<OpraProfile | null> =>
      ipcRenderer.invoke('opra:getProfile', eqId),
    refresh: (): Promise<OpraCatalogStatus> => ipcRenderer.invoke('opra:refresh'),
    getStatus: (): Promise<OpraCatalogStatus> => ipcRenderer.invoke('opra:getStatus')
  },
  app: {
    relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
    checkForUpdates: (): Promise<{
      hasUpdate: boolean
      currentVersion: string
      latestVersion?: string
      releaseUrl?: string
      releaseNotes?: string
      error?: string
    }> => ipcRenderer.invoke('app:checkForUpdates'),
    onSavePlaybackSession: (cb: () => Promise<void> | void): (() => void) => {
      savePlaybackSessionCallbacks.add(cb)
      return () => savePlaybackSessionCallbacks.delete(cb)
    }
  },
  ncm: {
    getPort: (): Promise<number> => ipcRenderer.invoke('ncm:getPort'),
    request: (path: string, cookie?: string): Promise<unknown> =>
      ipcRenderer.invoke('ncm:request', path, cookie),
    getCachedSong: (songId: number): Promise<string | null> =>
      ipcRenderer.invoke('ncm:getCachedSong', songId),
    cacheSong: (songId: number, url: string, fileName?: string): Promise<string | null> =>
      ipcRenderer.invoke('ncm:cacheSong', songId, url, fileName)
  },
  data: {
    saveMusicLibrary: (data: { tracks: unknown[]; folders: string[] }): Promise<void> =>
      ipcRenderer.invoke('data:saveMusicLibrary', data),
    loadMusicLibrary: (): Promise<{ tracks: unknown[]; folders: string[] } | unknown[]> =>
      ipcRenderer.invoke('data:loadMusicLibrary'),
    getCover: (handle: string): Promise<string | null> =>
      ipcRenderer.invoke('cover:get', handle),
    getLyrics: (dir: string, fileName: string, filePath?: string): Promise<string | null> =>
      ipcRenderer.invoke('lyrics:get', dir, fileName, filePath),
    savePlaybackSession: (session: PlaybackSession | null): Promise<void> =>
      ipcRenderer.invoke('data:savePlaybackSession', session),
    loadPlaybackSession: (): Promise<PlaybackSession | null> =>
      ipcRenderer.invoke('data:loadPlaybackSession'),
    clearPlaybackSession: (): Promise<void> => ipcRenderer.invoke('data:clearPlaybackSession'),
    savePlaylists: (playlists: unknown): Promise<void> => ipcRenderer.invoke('data:savePlaylists', playlists),
    loadPlaylists: (): Promise<unknown> => ipcRenderer.invoke('data:loadPlaylists'),
    saveCookie: (cookie: string): Promise<void> => ipcRenderer.invoke('data:saveCookie', cookie),
    loadCookie: (): Promise<string> => ipcRenderer.invoke('data:loadCookie')
  },
  settings: {
    get: (): Promise<SettingsSnapshot> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>): Promise<SettingsSnapshot> =>
      ipcRenderer.invoke('settings:update', patch),
    chooseCacheFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('settings:chooseCacheFolder'),
    getCacheSize: (): Promise<number> => ipcRenderer.invoke('settings:getCacheSize'),
    clearCache: (): Promise<number> => ipcRenderer.invoke('settings:clearCache'),
    onChanged: (cb: (snapshot: SettingsSnapshot) => void): (() => void) => {
      settingsChangedCallbacks.add(cb)
      return () => settingsChangedCallbacks.delete(cb)
    },
    onPlayerShortcut: (cb: (action: PlayerShortcutAction) => void): (() => void) => {
      playerShortcutCallbacks.add(cb)
      return () => playerShortcutCallbacks.delete(cb)
    }
  },
  plugins: {
    list: (): Promise<TwilightPluginDescriptor[]> => ipcRenderer.invoke('plugins:list'),
    installFromPath: (path: string): Promise<TwilightPluginInstallResult> =>
      ipcRenderer.invoke('plugins:installFromPath', path),
    chooseAndInstall: (): Promise<TwilightPluginInstallResult | null> =>
      ipcRenderer.invoke('plugins:chooseAndInstall'),
    enable: (id: string): Promise<TwilightPluginDescriptor> =>
      ipcRenderer.invoke('plugins:enable', id),
    disable: (id: string): Promise<TwilightPluginDescriptor> =>
      ipcRenderer.invoke('plugins:disable', id),
    uninstall: (id: string, options?: { removeData?: boolean }): Promise<void> =>
      ipcRenderer.invoke('plugins:uninstall', id, options),
    openLog: (id: string): Promise<void> => ipcRenderer.invoke('plugins:openLog', id),
    getLog: (id: string): Promise<string> => ipcRenderer.invoke('plugins:getLog', id),
    listIndex: (): Promise<TwilightPluginIndexEntry[]> => ipcRenderer.invoke('plugins:listIndex'),
    refreshIndex: (): Promise<TwilightPluginIndexEntry[]> =>
      ipcRenderer.invoke('plugins:refreshIndex'),
    installFromIndex: (id: string): Promise<TwilightPluginInstallResult> =>
      ipcRenderer.invoke('plugins:installFromIndex', id),
    setNativeDspParameters: (id: string, parameters: Record<string, number>): Promise<TwilightPluginDescriptor> =>
      ipcRenderer.invoke('plugins:setNativeDspParameters', id, parameters),
    onChanged: (cb: () => void): (() => void) => {
      pluginChangedCallbacks.add(cb)
      return () => pluginChangedCallbacks.delete(cb)
    }
  },
  providers: {
    list: (): Promise<TwilightMediaProviderRegistration[]> => ipcRenderer.invoke('providers:list'),
    call: (providerId: string, method: TwilightMediaProviderMethod, args: unknown[]): Promise<unknown> =>
      ipcRenderer.invoke('providers:call', providerId, method, args)
  },
  extensions: {
    list: (): Promise<TwilightPluginExtensionContribution[]> => ipcRenderer.invoke('extensions:list'),
    executeCommand: (command: string, args?: unknown[]): Promise<unknown> =>
      ipcRenderer.invoke('extensions:executeCommand', command, args),
    readThemeStylesheet: (stylesheetPath: string): Promise<string> =>
      ipcRenderer.invoke('extensions:readThemeStylesheet', stylesheetPath)
  },
  desktopLyrics: {
    toggle: (): Promise<boolean> => ipcRenderer.invoke('desktopLyrics:toggle'),
    show: (): Promise<void> => ipcRenderer.invoke('desktopLyrics:show'),
    hide: (): Promise<void> => ipcRenderer.invoke('desktopLyrics:hide'),
    updateTrack: (data: { lyrics: string | null; translatedLyrics?: string | null; title?: string; artist?: string }): void => {
      ipcRenderer.send('desktopLyrics:updateTrack', data)
    },
    updateTime: (time: number): void => {
      ipcRenderer.send('desktopLyrics:updateTime', time)
    },
    updateSettings: (settings: DesktopLyricsSettings): void => {
      ipcRenderer.send('desktopLyrics:updateSettings', settings)
    },
    onToggle: (cb: (enabled: boolean) => void): (() => void) => {
      desktopLyricsToggleCallbacks.add(cb)
      return () => desktopLyricsToggleCallbacks.delete(cb)
    },
    onInitSettings: (cb: (settings: DesktopLyricsSettings) => void): (() => void) => {
      desktopLyricsInitSettingsCallbacks.add(cb)
      return () => desktopLyricsInitSettingsCallbacks.delete(cb)
    },
    onTrackUpdate: (cb: (data: { lyrics: string | null; translatedLyrics?: string | null; title?: string; artist?: string }) => void): (() => void) => {
      desktopLyricsTrackCallbacks.add(cb)
      return () => desktopLyricsTrackCallbacks.delete(cb)
    },
    onTimeUpdate: (cb: (time: number) => void): (() => void) => {
      desktopLyricsTimeCallbacks.add(cb)
      return () => desktopLyricsTimeCallbacks.delete(cb)
    },
    onSettingsUpdate: (cb: (settings: DesktopLyricsSettings) => void): (() => void) => {
      desktopLyricsSettingsUpdateCallbacks.add(cb)
      return () => desktopLyricsSettingsUpdateCallbacks.delete(cb)
    },
    getPosition: (): void => {
      ipcRenderer.send('desktopLyrics:getPosition')
    },
    move: (x: number, y: number): void => {
      ipcRenderer.send('desktopLyrics:move', { x, y })
    },
    requestClose: (): void => {
      ipcRenderer.send('desktopLyrics:requestClose')
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
