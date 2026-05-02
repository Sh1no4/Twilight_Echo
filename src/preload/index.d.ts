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
}

interface MpvEvent {
  name: string
  data: unknown
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
    close: () => void
  }
  dialog: {
    openFolder: () => Promise<string | null>
  }
  fs: {
    scanMusicFiles: (folderPath: string) => Promise<TrackData[]>
    readAudioFile: (filePath: string) => Promise<{ buffer: ArrayBuffer; mimeType: string }>
  }
  mpv: MpvAPI
  ncm: {
    getPort: () => Promise<number>
    request: (path: string, cookie?: string) => Promise<unknown>
  }
  data: {
    saveMusicLibrary: (tracks: unknown[]) => Promise<void>
    loadMusicLibrary: () => Promise<unknown[]>
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
