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

interface AppSettings {
  autoCheckLogin: boolean
  minimizeToTray: boolean
  launchAtLogin: boolean
  hardwareAcceleration: boolean
  cachePath: string
  blurEffect: boolean
  useCoverTheme: boolean
  lyricFontSize: number
}

interface SettingsSnapshot {
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

interface MpvAPI {
  play: (filePath: string) => Promise<void>
  togglePause: () => Promise<void>
  seek: (time: number) => Promise<void>
  setVolume: (volume: number) => Promise<void>
  stop: () => Promise<void>
  setExclusiveMode: (enabled: boolean) => Promise<void>
  getExclusiveMode: () => Promise<boolean>

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
    openPath: (targetPath: string) => Promise<string>
  }
  app: {
    relaunch: () => Promise<void>
  }
  settings: {
    get: () => Promise<SettingsSnapshot>
    update: (patch: Partial<AppSettings>) => Promise<SettingsSnapshot>
    chooseCacheFolder: () => Promise<string | null>
    getCacheSize: () => Promise<number>
    clearCache: () => Promise<number>
    onChanged: (cb: (snapshot: SettingsSnapshot) => void) => () => void
  }
  fs: {
    scanMusicFiles: (folderPath: string) => Promise<TrackData[]>
    readAudioFile: (filePath: string) => Promise<{ buffer: ArrayBuffer; mimeType: string }>
    onScanProgress: (cb: (progress: { current: number; total: number }) => void) => () => void
  }
  mpv: MpvAPI
  ncm: {
    getPort: () => Promise<number>
    request: (path: string, cookie?: string) => Promise<unknown>
  }
  data: {
    saveMusicLibrary: (data: { tracks: unknown[]; folders: string[] }) => Promise<void>
    loadMusicLibrary: () => Promise<{ tracks: unknown[]; folders: string[] } | unknown[]>
    saveCookie: (cookie: string) => Promise<void>
    loadCookie: () => Promise<string>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: WindowAPI
  }
}
