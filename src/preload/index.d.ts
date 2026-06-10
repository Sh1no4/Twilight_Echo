import { ElectronAPI } from '@electron-toolkit/preload'

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

interface AudioEngineEvent {
  name: string
  data: unknown
}

type AudioOutputId = 'wasapi' | 'asio' | 'coreaudio' | 'alsa'
type PlayMode = 'sequential' | 'repeat' | 'shuffle'
type PlayerShortcutAction = 'previous' | 'next' | 'playPause'
type AppTheme = 'system' | 'pureWhite' | 'dark' | 'aurora'
type PlaybackResumeMode = 'off' | 'track' | 'trackAndPosition'
type TrackSource = 'local' | 'ncm'
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

interface AudioEqPreset {
  id: string
  name: string
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
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
  blurEffect: boolean
  useCoverTheme: boolean
  lyricFontSize: number
  playbackResumeMode: PlaybackResumeMode
  audioOutput: AudioOutputId
  audioDevice: string
  audioExclusiveMode: boolean
  audioOutputConfig: OutputConfig
  audioProcessing: AudioProcessingSettings
  audioEqPresets: AudioEqPreset[]
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
  isDsd: boolean
  dsdMode: string
  dsdRate: number
  coverMime: string
  coverDataBase64: string
  replayGainTrackGain: number | null
  replayGainAlbumGain: number | null
  r128TrackGain: number | null
  r128AlbumGain: number | null
  error: string
}

interface PlaybackSession {
  version: 1
  savedAt: string
  mode: PlaybackResumeMode
  track: TrackData
  position: number
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

interface AudioOutputOption {
  id: AudioOutputId
  label: string
  description: string
  platform: NodeJS.Platform
  supportsExclusive: boolean
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
  pathKind?: string
  capabilityReason?: string
}

interface OutputConfig {
  preferredBufferSize: number
  routingMode: ChannelRoutingMode
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

interface AudioEngineAPI {
  loadQueue: (items: TrackData[], startIndex?: number) => Promise<void>
  play: (filePath: string, startTime?: number) => Promise<AudioEnginePlayResult>
  togglePause: () => Promise<void>
  seek: (time: number) => Promise<void>
  setVolume: (volume: number) => Promise<void>
  stop: () => Promise<void>
  next: () => Promise<void>
  previous: () => Promise<void>
  setPlayMode: (mode: PlayMode) => Promise<void>
  getUpcomingTrack: () => Promise<AudioEngineQueueItem | null>
  setExclusiveMode: (enabled: boolean) => Promise<AudioOutputState>
  getExclusiveMode: () => Promise<boolean>
  setAudioOutput: (output: AudioOutputId, device?: string) => Promise<AudioOutputState>
  setAudioDevice: (device: string) => Promise<AudioOutputState>
  setOutputConfig: (config: OutputConfig) => Promise<OutputConfig>
  getAudioOutput: () => Promise<AudioOutputId>
  getAudioOutputOptions: () => Promise<AudioOutputOption[]>
  getAudioOutputState: () => Promise<AudioOutputState>
  setAudioProcessing: (
    settings: Partial<AudioProcessingSettings>
  ) => Promise<AudioProcessingSettings>
  getAudioProcessing: () => Promise<AudioProcessingSettings>
  selectImpulseResponse: () => Promise<string | null>
  loadImpulseResponse: (path: string) => Promise<ConvolverInfo>
  unloadImpulseResponse: () => Promise<ConvolverInfo>
  getConvolverInfo: () => Promise<ConvolverInfo>
  setEqBands: (settings: Partial<AudioProcessingSettings>) => Promise<AudioProcessingSettings>
  setEqPreset: (preset: AudioEqPreset) => Promise<AudioProcessingSettings>
  setCrossfeedStrength: (strength: number) => Promise<AudioProcessingSettings>
  setReplayGainMode: (
    mode: VolumeNormalizationMode,
    preamp?: number,
    fallback?: number,
    clip?: boolean
  ) => Promise<AudioProcessingSettings>
  getMetadata: (source: string) => Promise<NativeAudioMetadata | null>
  getPlaybackInfo: () => Promise<PlaybackInfo>
  getSpectrumData: (points?: number) => Promise<number[]>
  getVisualizationData: (options?: VisualizationOptions) => Promise<VisualizationData>

  onPropertyChange: (cb: (event: AudioEngineEvent) => void) => () => void
  onEndFile: (cb: (reason: string) => void) => () => void
  onStartFile: (cb: () => void) => () => void
  onReady: (cb: () => void) => () => void
  onError: (cb: (message: string) => void) => () => void
  onDisconnected: (cb: () => void) => () => void
  onPlaybackInfo: (cb: (info: PlaybackInfo) => void) => () => void
}

interface WindowAPI {
  window: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
  }
  dialog: {
    openFolder: () => Promise<string | null>
  }
  shell: {
    showItemInFolder: (filePath: string) => Promise<void>
    openPath: (path: string) => Promise<string>
  }
  fs: {
    scanMusicFiles: (folderPath: string) => Promise<TrackData[]>
    readAudioFile: (filePath: string) => Promise<{ buffer: ArrayBuffer; mimeType: string }>
    onScanProgress: (cb: (progress: { current: number; total: number }) => void) => () => void
  }
  audioEngine: AudioEngineAPI
  app: {
    relaunch: () => Promise<void>
    onSavePlaybackSession: (cb: () => Promise<void> | void) => () => void
  }
  ncm: {
    getPort: () => Promise<number>
    request: (path: string, cookie?: string) => Promise<unknown>
    getCachedSong: (songId: number) => Promise<string | null>
    cacheSong: (songId: number, url: string, fileName?: string) => Promise<string | null>
  }
  data: {
    saveMusicLibrary: (data: { tracks: unknown[]; folders: string[] }) => Promise<void>
    loadMusicLibrary: () => Promise<{ tracks: unknown[]; folders: string[] } | unknown[]>
    savePlaybackSession: (session: PlaybackSession | null) => Promise<void>
    loadPlaybackSession: () => Promise<PlaybackSession | null>
    clearPlaybackSession: () => Promise<void>
    saveCookie: (cookie: string) => Promise<void>
    loadCookie: () => Promise<string>
  }
  settings: {
    get: () => Promise<SettingsSnapshot>
    update: (patch: Partial<AppSettings>) => Promise<SettingsSnapshot>
    chooseCacheFolder: () => Promise<string | null>
    selectMusicCachePath: () => Promise<string | null>
    getCacheSize: () => Promise<number>
    clearCache: () => Promise<number>
    onChanged: (cb: (snapshot: SettingsSnapshot) => void) => () => void
    onPlayerShortcut: (cb: (action: PlayerShortcutAction) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: WindowAPI
  }
}
