import { ElectronAPI } from '@electron-toolkit/preload'

interface TrackData {
  id: string
  title: string
  artist: string
  album: string
  filePath: string
  fileName: string
  duration: number
  size: number
  cover: string | null
  lyrics: string | null
  translatedLyrics?: string | null
}

interface MpvEvent {
  name: string
  data: unknown
}

type AudioOutputId = 'wasapi' | 'asio' | 'coreaudio' | 'alsa'
type PlayerShortcutAction = 'previous' | 'next' | 'playPause'
type AppTheme = 'pureWhite' | 'aurora'
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
  audioProcessing: AudioProcessingSettings
  audioEqPresets: AudioEqPreset[]
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

interface MpvAPI {
  play: (filePath: string) => Promise<void>
  togglePause: () => Promise<void>
  seek: (time: number) => Promise<void>
  setVolume: (volume: number) => Promise<void>
  stop: () => Promise<void>
  setExclusiveMode: (enabled: boolean) => Promise<void>
  getExclusiveMode: () => Promise<boolean>
  setAudioOutput: (output: AudioOutputId) => Promise<void>
  getAudioOutput: () => Promise<AudioOutputId>
  getAudioOutputOptions: () => Promise<AudioOutputOption[]>
  setAudioProcessing: (
    settings: Partial<AudioProcessingSettings>
  ) => Promise<AudioProcessingSettings>
  getAudioProcessing: () => Promise<AudioProcessingSettings>

  onPropertyChange: (cb: (event: MpvEvent) => void) => () => void
  onEndFile: (cb: (reason: string) => void) => () => void
  onStartFile: (cb: () => void) => () => void
  onReady: (cb: () => void) => () => void
  onError: (cb: (message: string) => void) => () => void
  onDisconnected: (cb: () => void) => () => void
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
  mpv: MpvAPI
  app: {
    relaunch: () => Promise<void>
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
