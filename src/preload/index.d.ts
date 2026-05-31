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
type PlayerShortcutAction = 'previous' | 'next' | 'playPause'
type AppTheme = 'pureWhite' | 'aurora'
type PlaybackResumeMode = 'off' | 'track' | 'trackAndPosition'
type TrackSource = 'local' | 'ncm'
type EqMode = 'graphic' | 'parametric'
type VolumeNormalizationMode = 'off' | 'track' | 'album' | 'loudnorm'
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
  highResolution: boolean
  dsdToPcm: boolean
  eqEnabled: boolean
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
  volumeNormalization: VolumeNormalizationMode
  replayGainPreamp: number
  replayGainFallback: number
  replayGainClip: boolean
  gapless: boolean
  crossfadeSeconds: number
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
  audioProcessing: AudioProcessingSettings
  audioEqPresets: AudioEqPreset[]
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
  bitPerfect: boolean
  resampled: boolean
  outputSampleRate: number
  outputBitDepth: number
  backend: string
  deviceName: string
}

interface PlaybackInfo {
  state: 'stopped' | 'playing' | 'paused'
  position: number
  duration: number
  volume: number
  queueIndex: number
  source: string
  codec: string
  bitrate: number
  sourceSampleRate: number
  sourceBitDepth: number
  outputBackend: string
  outputDevice: string
  outputInfo: OutputInfo
  outputSampleRate: number
  outputBitDepth: number
  channelCount: number
  bitPerfect: boolean
  dspActive: boolean
  resampleReason: string
  dsdMode: string
}

interface AudioEnginePlayResult {
  nativeStarted: boolean
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
  setExclusiveMode: (enabled: boolean) => Promise<AudioOutputState>
  getExclusiveMode: () => Promise<boolean>
  setAudioOutput: (output: AudioOutputId, device?: string) => Promise<AudioOutputState>
  setAudioDevice: (device: string) => Promise<AudioOutputState>
  getAudioOutput: () => Promise<AudioOutputId>
  getAudioOutputOptions: () => Promise<AudioOutputOption[]>
  getAudioOutputState: () => Promise<AudioOutputState>
  setAudioProcessing: (
    settings: Partial<AudioProcessingSettings>
  ) => Promise<AudioProcessingSettings>
  getAudioProcessing: () => Promise<AudioProcessingSettings>
  getPlaybackInfo: () => Promise<PlaybackInfo>
  getSpectrumData: (points?: number) => Promise<number[]>

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

