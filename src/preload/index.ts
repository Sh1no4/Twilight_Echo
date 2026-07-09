import { contextBridge, ipcRenderer } from 'electron'
import type {
  AudioEngineEventCallback,
  AudioEngineEndFileCallback,
  AudioEngineSimpleCallback,
  AudioEngineErrorCallback,
  AudioEnginePlaybackInfoCallback,
  AudioEngineDeviceOptionsChangedCallback,
  AudioEngineServiceCrashCallback,
  AudioEngineServiceReadyCallback,
  PlayerShortcutAction,
  PlayerShortcutStatus,
  PlaybackInfo,
  SettingsSnapshot,
  DesktopLyricsSettings,
  DesktopLyricsTrackPayload,
  LibraryChange,
  PlayMode,
  AudioEngineQueueItem,
  PlaybackSession,
  VisualizationOptions,
  VisualizationData,
  AudioOutputId,
  AudioOutputOption,
  AudioOutputState,
  AudioProcessingSettings,
  OutputConfig,
  NativeAudioMetadata,
  AudioEnginePlayResult,
  AppSettings,
  AudioEqPreset,
  ConvolverInfo,
  OpraCatalogStatus,
  OpraProfile,
  VolumeNormalizationMode,
  TwilightPluginDescriptor,
  TwilightPluginInstallResult,
  TwilightPluginIndexEntry,
  TwilightPluginIndexStatus,
  TwilightPluginExtensionContribution,
  TwilightMediaProviderMethod,
  TwilightMediaProviderRegistration,
  BpmAnalysisCompletedEvent,
  BpmAnalysisRequest,
  BpmAnalysisRequestResult
} from './types'

const audioEngineEventCallbacks = new Set<AudioEngineEventCallback>()
const audioEngineEndFileCallbacks = new Set<AudioEngineEndFileCallback>()
const audioEngineStartFileCallbacks = new Set<AudioEngineSimpleCallback>()
const audioEngineReadyCallbacks = new Set<AudioEngineSimpleCallback>()
const audioEngineErrorCallbacks = new Set<AudioEngineErrorCallback>()
const audioEngineDisconnectedCallbacks = new Set<AudioEngineSimpleCallback>()
const audioEnginePlaybackInfoCallbacks = new Set<AudioEnginePlaybackInfoCallback>()
const audioEngineDeviceOptionsChangedCallbacks =
  new Set<AudioEngineDeviceOptionsChangedCallback>()
const audioEngineServiceCrashCallbacks = new Set<AudioEngineServiceCrashCallback>()
const audioEngineServiceReadyCallbacks = new Set<AudioEngineServiceReadyCallback>()
const playerShortcutCallbacks = new Set<(action: PlayerShortcutAction) => void>()
const settingsChangedCallbacks = new Set<(snapshot: SettingsSnapshot) => void>()
const desktopLyricsToggleCallbacks = new Set<(enabled: boolean) => void>()
const desktopLyricsInitSettingsCallbacks = new Set<(settings: DesktopLyricsSettings) => void>()
const desktopLyricsTrackCallbacks = new Set<(data: DesktopLyricsTrackPayload) => void>()
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

ipcRenderer.on('audioEngine:device-options-changed', (_event, event: { reason: string }) => {
  for (const cb of audioEngineDeviceOptionsChangedCallbacks) {
    cb(event)
  }
})

ipcRenderer.on('audioEngine:service-crash', (_event, event: { reason: string }) => {
  for (const cb of audioEngineServiceCrashCallbacks) {
    cb(event)
  }
})

ipcRenderer.on(
  'audioEngine:service-ready',
  (
    _event,
    event: { manualResumeRequired: boolean; outputRouteSynced: boolean; restoreErrors: string[] }
  ) => {
    for (const cb of audioEngineServiceReadyCallbacks) {
      cb(event)
    }
  }
)

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

ipcRenderer.on('desktopLyrics:updateTrack', (_event, data: DesktopLyricsTrackPayload) => {
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
    onChanged: (cb: (change: LibraryChange | undefined) => void): (() => void) => {
      const handler = (_event, change: LibraryChange | undefined): void => cb(change)
      ipcRenderer.on('library:changed', handler)
      return () => ipcRenderer.removeListener('library:changed', handler)
    },
    onCoversMissing: (cb: (info: { dirtyCount: number }) => void): (() => void) => {
      const handler = (_event, info: { dirtyCount: number }): void => cb(info)
      ipcRenderer.on('library:covers-missing', handler)
      return () => ipcRenderer.removeListener('library:covers-missing', handler)
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
    },

    onDeviceOptionsChanged: (
      cb: AudioEngineDeviceOptionsChangedCallback
    ): (() => void) => {
      audioEngineDeviceOptionsChangedCallbacks.add(cb)
      return () => audioEngineDeviceOptionsChangedCallbacks.delete(cb)
    },

    onServiceCrash: (cb: AudioEngineServiceCrashCallback): (() => void) => {
      audioEngineServiceCrashCallbacks.add(cb)
      return () => audioEngineServiceCrashCallbacks.delete(cb)
    },

    onServiceReady: (cb: AudioEngineServiceReadyCallback): (() => void) => {
      audioEngineServiceReadyCallbacks.add(cb)
      return () => audioEngineServiceReadyCallbacks.delete(cb)
    }
  },
  bpmAnalysis: {
    request: (request: BpmAnalysisRequest): Promise<BpmAnalysisRequestResult> =>
      ipcRenderer.invoke('bpmAnalysis:request', request),
    getCacheSize: (): Promise<number> => ipcRenderer.invoke('bpmAnalysis:getCacheSize'),
    clearCache: (): Promise<number> => ipcRenderer.invoke('bpmAnalysis:clearCache'),
    onCompleted: (cb: (event: BpmAnalysisCompletedEvent) => void): (() => void) => {
      const handler = (_event, data: BpmAnalysisCompletedEvent): void => cb(data)
      ipcRenderer.on('bpmAnalysis:completed', handler)
      return () => ipcRenderer.removeListener('bpmAnalysis:completed', handler)
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
    chooseBackgroundImage: (): Promise<string | null> =>
      ipcRenderer.invoke('settings:chooseBackgroundImage'),
    importBackgroundImage: (fileName: string, data: ArrayBuffer): Promise<string | null> =>
      ipcRenderer.invoke('settings:importBackgroundImage', fileName, data),
    exportBackup: (): Promise<string> => ipcRenderer.invoke('settings:export'),
    importBackup: (json: string): Promise<SettingsSnapshot> =>
      ipcRenderer.invoke('settings:import', json),
    getCacheSize: (): Promise<number> => ipcRenderer.invoke('settings:getCacheSize'),
    clearCache: (): Promise<number> => ipcRenderer.invoke('settings:clearCache'),
    getShortcutStatuses: (): Promise<PlayerShortcutStatus[]> =>
      ipcRenderer.invoke('settings:getShortcutStatuses'),
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
    getIndexStatus: (): Promise<TwilightPluginIndexStatus> =>
      ipcRenderer.invoke('plugins:getIndexStatus'),
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
    updateTrack: (data: DesktopLyricsTrackPayload): void => {
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
    onTrackUpdate: (cb: (data: DesktopLyricsTrackPayload) => void): (() => void) => {
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
    contextBridge.exposeInMainWorld('api', exposedApiForDocument())
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = exposedApiForDocument()
}

function exposedApiForDocument(): typeof api | { desktopLyrics: typeof api.desktopLyrics } {
  return isDesktopLyricsDocument() ? { desktopLyrics: api.desktopLyrics } : api
}

function isDesktopLyricsDocument(): boolean {
  try {
    return window.location.pathname.endsWith('/desktop-lyrics.html')
  } catch {
    return false
  }
}
