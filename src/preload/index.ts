import { contextBridge, ipcRenderer } from 'electron'
import type {
  NcmCloudDownloadRequest,
  NcmCloudDownloadResult,
  NcmCloudSelectedFile,
  NcmCloudTransferProgress,
  NcmCloudUploadResult,
  MiniPlayerBootstrap,
  MiniPlayerCommand,
  MiniPlayerSettings,
  MiniPlayerSettingsPatch,
  MiniPlayerStateSnapshot,
  TrayNavigationTarget,
  TrayPlayerBootstrap,
  MotionPreference,
} from './types'
import { createSleepTimerEventBridge } from './sleepTimerEvents.ts'
import { collectClosePersistenceOutcome } from './closePersistence.ts'
import { dataApi, miniPlayerCoverDataApi } from './domains/dataApi.ts'
import { audioEngineApi, bindAudioEngineIpcEvents } from './domains/audioEngineApi.ts'
import { bindDesktopLyricsIpcEvents, desktopLyricsApi } from './domains/desktopLyricsApi.ts'
import { libraryAndFileSystemApi } from './domains/libraryApi.ts'
import { mediaSubscriptionsApi } from './domains/mediaSubscriptionsApi.ts'
import { networkSourcesApi } from './domains/networkSourcesApi.ts'
import { bindSettingsIpcEvents, settingsApi } from './domains/settingsApi.ts'
import { bindThemesIpcEvents, themesApi } from './domains/themesApi.ts'
import { bindPluginsIpcEvents, pluginsApi } from './domains/pluginsApi.ts'
import { NCM_CLOUD_TRANSFER_PROGRESS_CHANNEL } from '../shared/ncmCloud.ts'

const miniPlayerStateCallbacks = new Set<(state: MiniPlayerStateSnapshot) => void>()
const miniPlayerSettingsCallbacks = new Set<(settings: MiniPlayerSettings) => void>()
const miniPlayerMotionPreferenceCallbacks = new Set<(preference: MotionPreference) => void>()
const miniPlayerCommandCallbacks = new Set<(command: MiniPlayerCommand) => void>()
const trayPlayerStateCallbacks = new Set<(state: MiniPlayerStateSnapshot) => void>()
const appNavigationCallbacks = new Set<(target: TrayNavigationTarget) => void>()
const savePlaybackSessionCallbacks = new Set<() => Promise<void> | void>()
const sleepTimerEvents = createSleepTimerEventBridge()

bindSettingsIpcEvents()
bindPluginsIpcEvents()
bindAudioEngineIpcEvents()
bindDesktopLyricsIpcEvents()
bindThemesIpcEvents()

sleepTimerEvents.bind(ipcRenderer)
ipcRenderer.on('desktopLyrics:position', (_event, pos: { x: number; y: number }) => {
  // Forward to a temporary global that the HTML page can read
  ;(window as unknown as Record<string, unknown>).__dlPos = pos
})

ipcRenderer.on('miniPlayer:state', (_event, state: MiniPlayerStateSnapshot) => {
  for (const cb of miniPlayerStateCallbacks) cb(state)
})

ipcRenderer.on('miniPlayer:settings', (_event, settings: MiniPlayerSettings) => {
  for (const cb of miniPlayerSettingsCallbacks) cb(settings)
})

ipcRenderer.on('miniPlayer:motionPreference', (_event, preference: MotionPreference) => {
  for (const cb of miniPlayerMotionPreferenceCallbacks) cb(preference)
})

ipcRenderer.on('miniPlayer:command', (_event, command: MiniPlayerCommand) => {
  for (const cb of miniPlayerCommandCallbacks) cb(command)
})

ipcRenderer.on('trayPlayer:state', (_event, state: MiniPlayerStateSnapshot) => {
  for (const cb of trayPlayerStateCallbacks) cb(state)
})

ipcRenderer.on('app:navigate', (_event, target: TrayNavigationTarget) => {
  if (target !== 'local' && target !== 'streaming') return
  for (const cb of appNavigationCallbacks) cb(target)
})

ipcRenderer.on('app:save-playback-session', async (_event, requestId: string) => {
  const outcome = await collectClosePersistenceOutcome(savePlaybackSessionCallbacks)
  try {
    await ipcRenderer.invoke('app:playback-session-saved', requestId, outcome)
  } catch (error) {
    // The main process treats a missing result as a timeout and keeps the
    // window open. Do not convert this IPC failure into a successful ACK.
    console.error('[persistence] Failed to report close persistence outcome:', error)
  }
})

const miniPlayerWindowApi = {
  getBootstrap: (): Promise<MiniPlayerBootstrap> => ipcRenderer.invoke('miniPlayer:getBootstrap'),
  command: (command: MiniPlayerCommand): void => {
    ipcRenderer.send('miniPlayer:command', command)
  },
  updateSettings: (patch: MiniPlayerSettingsPatch): Promise<MiniPlayerSettings> =>
    ipcRenderer.invoke('miniPlayer:updateSettings', patch),
  chooseBackgroundImage: (): Promise<string | null> =>
    ipcRenderer.invoke('miniPlayer:chooseBackgroundImage'),
  minimize: (): void => {
    ipcRenderer.send('miniPlayer:minimize')
  },
  returnToMain: (): void => {
    ipcRenderer.send('miniPlayer:returnToMain')
  },
  onState: (cb: (state: MiniPlayerStateSnapshot) => void): (() => void) => {
    miniPlayerStateCallbacks.add(cb)
    return () => miniPlayerStateCallbacks.delete(cb)
  },
  onSettings: (cb: (settings: MiniPlayerSettings) => void): (() => void) => {
    miniPlayerSettingsCallbacks.add(cb)
    return () => miniPlayerSettingsCallbacks.delete(cb)
  },
  onMotionPreference: (cb: (preference: MotionPreference) => void): (() => void) => {
    miniPlayerMotionPreferenceCallbacks.add(cb)
    return () => miniPlayerMotionPreferenceCallbacks.delete(cb)
  }
}

const miniPlayerHostApi = {
  ...miniPlayerWindowApi,
  open: (): Promise<MiniPlayerSettings> => ipcRenderer.invoke('miniPlayer:open'),
  publishState: (state: MiniPlayerStateSnapshot): void => {
    ipcRenderer.send('miniPlayer:publishState', state)
  },
  onCommand: (cb: (command: MiniPlayerCommand) => void): (() => void) => {
    miniPlayerCommandCallbacks.add(cb)
    return () => miniPlayerCommandCallbacks.delete(cb)
  }
}

const trayPlayerWindowApi = {
  getBootstrap: (): Promise<TrayPlayerBootstrap> => ipcRenderer.invoke('trayPlayer:getBootstrap'),
  command: (command: MiniPlayerCommand): void => {
    ipcRenderer.send('trayPlayer:command', command)
  },
  navigate: (target: TrayNavigationTarget): void => {
    ipcRenderer.send('trayPlayer:navigate', target)
  },
  hide: (): void => {
    ipcRenderer.send('trayPlayer:hide')
  },
  onState: (cb: (state: MiniPlayerStateSnapshot) => void): (() => void) => {
    trayPlayerStateCallbacks.add(cb)
    return () => trayPlayerStateCallbacks.delete(cb)
  }
}

const api = {
  sleepTimer: {
    configure: (state: import('../shared/sleepTimer.ts').SleepTimerState) =>
      ipcRenderer.invoke('sleepTimer:configure', state),
    cancel: () => ipcRenderer.invoke('sleepTimer:cancel'),
    getState: () => ipcRenderer.invoke('sleepTimer:getState'),
    boundary: (boundary: 'trackEnd' | 'queueEnd') =>
      ipcRenderer.invoke('sleepTimer:boundary', boundary),
    onState: sleepTimerEvents.onState,
    onTrigger: sleepTimerEvents.onTrigger
  },
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
    getStatus: (): Promise<{
      enabled: boolean
      connected: boolean
      lastError: string | null
    }> => ipcRenderer.invoke('discord:getStatus'),
    updateActivity: (data: {
      title: string
      artist: string
      album?: string
      playing: boolean
      startTime?: number
    }): Promise<void> => ipcRenderer.invoke('discord:updateActivity', data),
    clearActivity: (): Promise<void> => ipcRenderer.invoke('discord:clearActivity')
  },
  ...libraryAndFileSystemApi,
  ...audioEngineApi,
  app: {
    consumePendingNavigation: (): Promise<TrayNavigationTarget | null> =>
      ipcRenderer.invoke('app:consumePendingNavigation'),
    relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
    checkForUpdates: (): Promise<import('../shared/appUpdate').AppUpdateCheckResult> =>
      ipcRenderer.invoke('app:checkForUpdates'),
    downloadUpdate: (): Promise<import('../shared/appUpdate').AppUpdateDownloadResult> =>
      ipcRenderer.invoke('app:downloadUpdate'),
    cancelUpdateDownload: (): Promise<boolean> => ipcRenderer.invoke('app:cancelUpdateDownload'),
    installUpdate: (): Promise<import('../shared/appUpdate').AppUpdateInstallResult> =>
      ipcRenderer.invoke('app:installUpdate'),
    onUpdateProgress: (
      cb: (progress: import('../shared/appUpdate').AppUpdateProgress) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: import('../shared/appUpdate').AppUpdateProgress
      ): void => {
        cb(progress)
      }
      ipcRenderer.on('app:update-progress', handler)
      return () => ipcRenderer.removeListener('app:update-progress', handler)
    },
    onSavePlaybackSession: (cb: () => Promise<void> | void): (() => void) => {
      savePlaybackSessionCallbacks.add(cb)
      return () => savePlaybackSessionCallbacks.delete(cb)
    },
    onNavigate: (cb: (target: TrayNavigationTarget) => void): (() => void) => {
      appNavigationCallbacks.add(cb)
      return () => appNavigationCallbacks.delete(cb)
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
  ncmCloud: {
    chooseUploadFiles: (): Promise<NcmCloudSelectedFile[]> =>
      ipcRenderer.invoke('ncmCloud:chooseUploadFiles'),
    upload: (handle: string): Promise<NcmCloudUploadResult> =>
      ipcRenderer.invoke('ncmCloud:upload', handle),
    download: (request: NcmCloudDownloadRequest): Promise<NcmCloudDownloadResult> =>
      ipcRenderer.invoke('ncmCloud:download', request),
    cancel: (transferId: string): Promise<boolean> =>
      ipcRenderer.invoke('ncmCloud:cancel', transferId),
    onProgress: (callback: (progress: NcmCloudTransferProgress) => void): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: NcmCloudTransferProgress
      ): void => {
        callback(progress)
      }
      ipcRenderer.on(NCM_CLOUD_TRANSFER_PROGRESS_CHANNEL, handler)
      return () => ipcRenderer.removeListener(NCM_CLOUD_TRANSFER_PROGRESS_CHANNEL, handler)
    }
  },
  ...mediaSubscriptionsApi,
  ...networkSourcesApi,
  ...dataApi,
  ...settingsApi,
  fonts: {
    listInstalled: (): Promise<string[]> => ipcRenderer.invoke('fonts:listInstalled')
  },
  ...themesApi,
  ...pluginsApi,
  desktopLyrics: desktopLyricsApi,
  miniPlayer: miniPlayerHostApi,
  trayPlayer: trayPlayerWindowApi,
  debug: {
    appendNativeTrace: (message: string): Promise<void> =>
      ipcRenderer.invoke('debug:appendNativeTrace', message)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', exposedApiForDocument())
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = exposedApiForDocument()
}

function exposedApiForDocument():
  | typeof api
  | { desktopLyrics: typeof api.desktopLyrics }
  | { miniPlayer: typeof miniPlayerWindowApi; data: typeof miniPlayerCoverDataApi }
  | { trayPlayer: typeof trayPlayerWindowApi } {
  if (isDesktopLyricsDocument()) return { desktopLyrics: api.desktopLyrics }
  if (isMiniPlayerDocument()) {
    return { miniPlayer: miniPlayerWindowApi, data: miniPlayerCoverDataApi }
  }
  if (isTrayPlayerDocument()) return { trayPlayer: trayPlayerWindowApi }
  return api
}

function isDesktopLyricsDocument(): boolean {
  try {
    return window.location.pathname.endsWith('/desktop-lyrics.html')
  } catch {
    return false
  }
}

function isMiniPlayerDocument(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('window') === 'mini-player'
  } catch {
    return false
  }
}

function isTrayPlayerDocument(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('window') === 'tray-player'
  } catch {
    return false
  }
}
