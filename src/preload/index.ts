import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type MpvEventCallback = (event: { name: string; data: unknown }) => void
type MpvEndFileCallback = (reason: string) => void
type MpvSimpleCallback = () => void
type MpvErrorCallback = (message: string) => void

const mpvEventCallbacks = new Set<MpvEventCallback>()
const mpvEndFileCallbacks = new Set<MpvEndFileCallback>()
const mpvStartFileCallbacks = new Set<MpvSimpleCallback>()
const mpvReadyCallbacks = new Set<MpvSimpleCallback>()
const mpvErrorCallbacks = new Set<MpvErrorCallback>()
const mpvDisconnectedCallbacks = new Set<MpvSimpleCallback>()

ipcRenderer.on('mpv:property-change', (_event, data: { name: string; data: unknown }) => {
  for (const cb of mpvEventCallbacks) {
    cb(data)
  }
})

ipcRenderer.on('mpv:end-file', (_event, data: { reason: string }) => {
  for (const cb of mpvEndFileCallbacks) {
    cb(data.reason)
  }
})

ipcRenderer.on('mpv:start-file', () => {
  for (const cb of mpvStartFileCallbacks) {
    cb()
  }
})

ipcRenderer.on('mpv:ready', () => {
  for (const cb of mpvReadyCallbacks) {
    cb()
  }
})

ipcRenderer.on('mpv:error', (_event, message: string) => {
  for (const cb of mpvErrorCallbacks) {
    cb(message)
  }
})

ipcRenderer.on('mpv:disconnected', () => {
  for (const cb of mpvDisconnectedCallbacks) {
    cb()
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
      ipcRenderer.invoke('shell:showItemInFolder', filePath)
  },
  fs: {
    scanMusicFiles: (folderPath: string): Promise<unknown[]> =>
      ipcRenderer.invoke('fs:scanMusicFiles', folderPath),
    readAudioFile: (filePath: string): Promise<{ buffer: ArrayBuffer; mimeType: string }> =>
      ipcRenderer.invoke('fs:readAudioFile', filePath),
    onScanProgress: (cb: (progress: { current: number; total: number }) => void): (() => void) => {
      const handler = (_event, data: { current: number; total: number }): void => cb(data)
      ipcRenderer.on('fs:scanProgress', handler)
      return () => ipcRenderer.removeListener('fs:scanProgress', handler)
    }
  },
  mpv: {
    play: (filePath: string): Promise<void> => ipcRenderer.invoke('mpv:play', filePath),
    togglePause: (): Promise<void> => ipcRenderer.invoke('mpv:togglePause'),
    seek: (time: number): Promise<void> => ipcRenderer.invoke('mpv:seek', time),
    setVolume: (volume: number): Promise<void> => ipcRenderer.invoke('mpv:setVolume', volume),
    stop: (): Promise<void> => ipcRenderer.invoke('mpv:stop'),
    setExclusiveMode: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('mpv:setExclusiveMode', enabled),
    getExclusiveMode: (): Promise<boolean> => ipcRenderer.invoke('mpv:getExclusiveMode'),

    onPropertyChange: (cb: MpvEventCallback): (() => void) => {
      mpvEventCallbacks.add(cb)
      return () => mpvEventCallbacks.delete(cb)
    },

    onEndFile: (cb: MpvEndFileCallback): (() => void) => {
      mpvEndFileCallbacks.add(cb)
      return () => mpvEndFileCallbacks.delete(cb)
    },

    onStartFile: (cb: MpvSimpleCallback): (() => void) => {
      mpvStartFileCallbacks.add(cb)
      return () => mpvStartFileCallbacks.delete(cb)
    },

    onReady: (cb: MpvSimpleCallback): (() => void) => {
      mpvReadyCallbacks.add(cb)
      return () => mpvReadyCallbacks.delete(cb)
    },

    onError: (cb: MpvErrorCallback): (() => void) => {
      mpvErrorCallbacks.add(cb)
      return () => mpvErrorCallbacks.delete(cb)
    },

    onDisconnected: (cb: MpvSimpleCallback): (() => void) => {
      mpvDisconnectedCallbacks.add(cb)
      return () => mpvDisconnectedCallbacks.delete(cb)
    }
  },
  ncm: {
    getPort: (): Promise<number> => ipcRenderer.invoke('ncm:getPort'),
    request: (path: string, cookie?: string): Promise<unknown> =>
      ipcRenderer.invoke('ncm:request', path, cookie)
  },
  data: {
    saveMusicLibrary: (tracks: unknown[]): Promise<void> =>
      ipcRenderer.invoke('data:saveMusicLibrary', tracks),
    loadMusicLibrary: (): Promise<unknown[]> => ipcRenderer.invoke('data:loadMusicLibrary'),
    saveCookie: (cookie: string): Promise<void> => ipcRenderer.invoke('data:saveCookie', cookie),
    loadCookie: (): Promise<string> => ipcRenderer.invoke('data:loadCookie')
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
