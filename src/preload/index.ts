import { contextBridge, ipcRenderer } from 'electron'
import type {
  AudioEngineEventCallback,
  AudioEngineEndFileCallback,
  AudioEngineSimpleCallback,
  AudioEngineErrorCallback,
  AudioEnginePlaybackInfoCallback,
  AudioEngineConfigAppliedCallback,
  AudioEngineConfigAppliedEvent,
  AudioEngineDeviceOptionsChangedCallback,
  AudioEngineServiceCrashCallback,
  AudioEngineServiceReadyCallback,
  AudioEngineLoudnormStatusCallback,
  LoudnormStatusEvent,
  PlayerShortcutAction,
  PlayerShortcutStatus,
  PlaybackInfo,
  SettingsSnapshot,
  DesktopLyricsSettings,
  DesktopLyricsTrackPayload,
  LibraryChange,
  LocalLibraryRemoveRequest,
  LocalLibraryRemoveResult,
  LocalLibraryResetResult,
  LocalLibraryRestoreRequest,
  LocalLibraryRestoreResult,
  LocalLibraryTagRestoreRequest,
  LocalLibraryTagRestoreResult,
  LocalLibraryTagWriteRequest,
  LocalLibraryTagWriteResult,
  LocalLibraryScanProgress,
  LocalLibraryScanStatus,
  LocalLibraryScanUpdate,
  LibraryWatcherStatusSnapshot,
  DuplicateDetectionReadApi,
  PlayMode,
  AudioEngineQueueItem,
  VisualizationOptions,
  VisualizationData,
  AudioOutputId,
  AudioOutputOption,
  AudioOutputState,
  AudioProcessingSettings,
  OutputConfig,
  OutputConfigApplyStatus,
  NativeAudioMetadata,
  AudioEnginePlayResult,
  NcmCloudDownloadRequest,
  NcmCloudDownloadResult,
  NcmCloudSelectedFile,
  NcmCloudTransferProgress,
  NcmCloudUploadResult,
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
  BpmAnalysisRequestResult,
  LoudnessAnalysisCompletedEvent,
  LoudnessAnalysisRequest,
  LoudnessAnalysisRequestResult,
  MiniPlayerBootstrap,
  MiniPlayerCommand,
  MiniPlayerSettings,
  MiniPlayerSettingsPatch,
  MiniPlayerStateSnapshot,
  TrayNavigationTarget,
  TrayPlayerBootstrap,
  MotionPreference,
  DspAsset,
  DspAssetKind,
  DspCorrectionImportResult,
  DspCorrectionProfile,
  ImportedFrequencyResponse,
  DspGraphStatus,
  DspOutputStageConfig,
  DspProfile,
  DspScene,
  DspSceneState,
  DspStereoImageConfig,
  Vst3CatalogState
} from './types'
import { ProviderWriteIdempotencyCoordinator } from '../shared/providerWriteIdempotency.ts'
import { createSleepTimerEventBridge } from './sleepTimerEvents.ts'
import { collectClosePersistenceOutcome } from './closePersistence.ts'
import { dataApi, miniPlayerCoverDataApi } from './domains/dataApi.ts'
import { mediaSubscriptionsApi } from './domains/mediaSubscriptionsApi.ts'
import { networkSourcesApi } from './domains/networkSourcesApi.ts'
import { bindThemesIpcEvents, themesApi } from './domains/themesApi.ts'
import { NCM_CLOUD_TRANSFER_PROGRESS_CHANNEL } from '../shared/ncmCloud.ts'
import { PROVIDER_DOWNLOAD_CHANGED_CHANNEL } from '../shared/providerDownloads.ts'

const audioEngineEventCallbacks = new Set<AudioEngineEventCallback>()
const audioEngineEndFileCallbacks = new Set<AudioEngineEndFileCallback>()
const audioEngineStartFileCallbacks = new Set<AudioEngineSimpleCallback>()
const audioEngineReadyCallbacks = new Set<AudioEngineSimpleCallback>()
const audioEngineErrorCallbacks = new Set<AudioEngineErrorCallback>()
const audioEngineDisconnectedCallbacks = new Set<AudioEngineSimpleCallback>()
const audioEnginePlaybackInfoCallbacks = new Set<AudioEnginePlaybackInfoCallback>()
const audioEngineLoudnormStatusCallbacks = new Set<AudioEngineLoudnormStatusCallback>()
const audioEngineConfigAppliedCallbacks = new Set<AudioEngineConfigAppliedCallback>()
const audioEngineDeviceOptionsChangedCallbacks = new Set<AudioEngineDeviceOptionsChangedCallback>()
const audioEngineServiceCrashCallbacks = new Set<AudioEngineServiceCrashCallback>()
const audioEngineServiceReadyCallbacks = new Set<AudioEngineServiceReadyCallback>()
const providerWriteIdempotency = new ProviderWriteIdempotencyCoordinator()
const playerShortcutCallbacks = new Set<(action: PlayerShortcutAction) => void>()
const settingsChangedCallbacks = new Set<(snapshot: SettingsSnapshot) => void>()
const desktopLyricsToggleCallbacks = new Set<(enabled: boolean) => void>()
const desktopLyricsInitSettingsCallbacks = new Set<(settings: DesktopLyricsSettings) => void>()
const desktopLyricsTrackCallbacks = new Set<(data: DesktopLyricsTrackPayload) => void>()
const desktopLyricsTimeCallbacks = new Set<(time: number) => void>()
const desktopLyricsSettingsUpdateCallbacks = new Set<(settings: DesktopLyricsSettings) => void>()
const desktopLyricsLoadFailedCallbacks = new Set<
  (payload: { code: number; description: string }) => void
>()
const miniPlayerStateCallbacks = new Set<(state: MiniPlayerStateSnapshot) => void>()
const miniPlayerSettingsCallbacks = new Set<(settings: MiniPlayerSettings) => void>()
const miniPlayerMotionPreferenceCallbacks = new Set<(preference: MotionPreference) => void>()
const miniPlayerCommandCallbacks = new Set<(command: MiniPlayerCommand) => void>()
const trayPlayerStateCallbacks = new Set<(state: MiniPlayerStateSnapshot) => void>()
const appNavigationCallbacks = new Set<(target: TrayNavigationTarget) => void>()
const savePlaybackSessionCallbacks = new Set<() => Promise<void> | void>()
const pluginChangedCallbacks = new Set<() => void>()
const providerDownloadChangedCallbacks = new Set<
  (tasks: import('./types').ProviderDownloadTaskSnapshot[]) => void
>()
const sleepTimerEvents = createSleepTimerEventBridge()

bindThemesIpcEvents()

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

sleepTimerEvents.bind(ipcRenderer)

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

ipcRenderer.on('audioEngine:loudnorm-status', (_event, event: LoudnormStatusEvent) => {
  for (const cb of audioEngineLoudnormStatusCallbacks) {
    cb(event)
  }
})

ipcRenderer.on('audioEngine:config-applied', (_event, event: AudioEngineConfigAppliedEvent) => {
  for (const cb of audioEngineConfigAppliedCallbacks) {
    cb(event)
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

ipcRenderer.on(
  PROVIDER_DOWNLOAD_CHANGED_CHANNEL,
  (_event, tasks: import('./types').ProviderDownloadTaskSnapshot[]) => {
    for (const cb of providerDownloadChangedCallbacks) {
      cb(tasks)
    }
  }
)

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

ipcRenderer.on(
  'desktopLyrics:loadFailed',
  (_event, payload: { code: number; description: string }) => {
    for (const cb of desktopLyricsLoadFailedCallbacks) {
      cb(payload)
    }
  }
)

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

const duplicateDetectionApi: DuplicateDetectionReadApi = {
  detectDuplicates: (): Promise<
    import('../shared/duplicateDetection.ts').DuplicateDetectionResult
  > => ipcRenderer.invoke('library:detectDuplicates')
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
  library: {
    removeTracks: (request: LocalLibraryRemoveRequest): Promise<LocalLibraryRemoveResult> =>
      ipcRenderer.invoke('library:removeTracks', request),
    restoreExclusions: (request: LocalLibraryRestoreRequest): Promise<LocalLibraryRestoreResult> =>
      ipcRenderer.invoke('library:restoreExclusions', request),
    reset: (): Promise<LocalLibraryResetResult> => ipcRenderer.invoke('library:reset'),
    ...duplicateDetectionApi,
    writeTags: (request: LocalLibraryTagWriteRequest): Promise<LocalLibraryTagWriteResult> =>
      ipcRenderer.invoke('library:writeTags', request),
    restoreTags: (request: LocalLibraryTagRestoreRequest): Promise<LocalLibraryTagRestoreResult> =>
      ipcRenderer.invoke('library:restoreTags', request),
    scanStartup: (): Promise<LocalLibraryScanUpdate> => ipcRenderer.invoke('library:scanStartup'),
    scanFull: (): Promise<LocalLibraryScanUpdate> => ipcRenderer.invoke('library:scanFull'),
    getScanStatus: (): Promise<LocalLibraryScanStatus> =>
      ipcRenderer.invoke('library:getScanStatus'),
    getWatcherStatus: (): Promise<LibraryWatcherStatusSnapshot> =>
      ipcRenderer.invoke('library:getWatcherStatus'),
    pauseScan: (): Promise<boolean> => ipcRenderer.invoke('library:pauseScan'),
    resumeScan: (): Promise<boolean> => ipcRenderer.invoke('library:resumeScan'),
    cancelScan: (): Promise<boolean> => ipcRenderer.invoke('library:cancelScan'),
    onChanged: (cb: (change: LibraryChange | undefined) => void): (() => void) => {
      const handler = (_event, change: LibraryChange | undefined): void => cb(change)
      ipcRenderer.on('library:changed', handler)
      return () => ipcRenderer.removeListener('library:changed', handler)
    },
    onCoversMissing: (cb: (info: { dirtyCount: number }) => void): (() => void) => {
      const handler = (_event, info: { dirtyCount: number }): void => cb(info)
      ipcRenderer.on('library:covers-missing', handler)
      return () => ipcRenderer.removeListener('library:covers-missing', handler)
    },
    onScanProgress: (cb: (progress: LocalLibraryScanProgress) => void): (() => void) => {
      const handler = (_event, progress: LocalLibraryScanProgress): void => cb(progress)
      ipcRenderer.on('library:scan-progress', handler)
      return () => ipcRenderer.removeListener('library:scan-progress', handler)
    },
    onScanStatus: (cb: (status: LocalLibraryScanStatus) => void): (() => void) => {
      const handler = (_event, status: LocalLibraryScanStatus): void => cb(status)
      ipcRenderer.on('library:scan-status', handler)
      return () => ipcRenderer.removeListener('library:scan-status', handler)
    }
  },
  fs: {
    scanMusicFiles: (folderPath: string): Promise<unknown[]> =>
      ipcRenderer.invoke('fs:scanMusicFiles', folderPath),
    readAudioFile: (filePath: string): Promise<{ buffer: ArrayBuffer; mimeType: string }> =>
      ipcRenderer.invoke('fs:readAudioFile', filePath),
    getAudioFileUrl: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('fs:getAudioFileUrl', filePath),
    isAudioFileAuthorized: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('fs:isAudioFileAuthorized', filePath),
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
    isHtmlAudioFallbackAllowed: (): Promise<boolean> =>
      ipcRenderer.invoke('audioEngine:isHtmlAudioFallbackAllowed'),
    togglePause: (): Promise<void> => ipcRenderer.invoke('audioEngine:togglePause'),
    seek: (time: number): Promise<void> => ipcRenderer.invoke('audioEngine:seek', time),
    setVolume: (volume: number): Promise<void> =>
      ipcRenderer.invoke('audioEngine:setVolume', volume),
    setPlaybackRate: (rate: number): Promise<void> =>
      ipcRenderer.invoke('audioEngine:setPlaybackRate', rate),
    setLoopRange: (startSeconds: number, endSeconds: number): Promise<boolean> =>
      ipcRenderer.invoke('audioEngine:setLoopRange', startSeconds, endSeconds),
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
    getOutputConfigApplyStatus: (): Promise<OutputConfigApplyStatus> =>
      ipcRenderer.invoke('audioEngine:getOutputConfigApplyStatus'),
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
    getDspSceneState: (): Promise<DspSceneState> =>
      ipcRenderer.invoke('audioEngine:getDspSceneState'),
    setDspScenes: (scenes: DspScene[], pinnedSceneId?: string | null): Promise<DspSceneState> =>
      ipcRenderer.invoke('audioEngine:setDspScenes', scenes, pinnedSceneId),
    setOutputStage: (partial: Partial<DspOutputStageConfig>): Promise<DspSceneState> =>
      ipcRenderer.invoke('audioEngine:setOutputStage', partial),
    setStereoImage: (partial: Partial<DspStereoImageConfig>): Promise<DspSceneState> =>
      ipcRenderer.invoke('audioEngine:setStereoImage', partial),
    applyDspScene: (
      sceneId: string | null,
      confirmDsdPcmFallback = false
    ): Promise<DspSceneState> =>
      ipcRenderer.invoke('audioEngine:applyDspScene', sceneId, confirmDsdPcmFallback),
    getDspGraphStatus: (): Promise<DspGraphStatus> =>
      ipcRenderer.invoke('audioEngine:getDspGraphStatus'),
    getDspAssets: (): Promise<DspAsset[]> => ipcRenderer.invoke('audioEngine:getDspAssets'),
    importDspAsset: (kind: DspAssetKind): Promise<DspAsset | null> =>
      ipcRenderer.invoke('audioEngine:importDspAsset', kind),
    importDspCorrectionProfile: (): Promise<DspCorrectionImportResult | null> =>
      ipcRenderer.invoke('audioEngine:importDspCorrectionProfile'),
    importFrequencyResponse: (): Promise<ImportedFrequencyResponse | null> =>
      ipcRenderer.invoke('audioEngine:importFrequencyResponse'),
    getDspCorrectionProfile: (assetId: string): Promise<DspCorrectionProfile> =>
      ipcRenderer.invoke('audioEngine:getDspCorrectionProfile', assetId),
    deleteDspAsset: (assetId: string): Promise<DspAsset[]> =>
      ipcRenderer.invoke('audioEngine:deleteDspAsset', assetId),
    exportDspProfile: (name?: string): Promise<DspProfile | null> =>
      ipcRenderer.invoke('audioEngine:exportDspProfile', name),
    importDspProfile: (): Promise<{
      state: DspSceneState
      profile: DspProfile
      importedAssets: DspAsset[]
    } | null> => ipcRenderer.invoke('audioEngine:importDspProfile'),
    getVst3Catalog: (): Promise<Vst3CatalogState> =>
      ipcRenderer.invoke('audioEngine:getVst3Catalog'),
    setVst3Enabled: (enabled: boolean): Promise<Vst3CatalogState> =>
      ipcRenderer.invoke('audioEngine:setVst3Enabled', enabled),
    selectVst3SearchPath: (): Promise<string | null> =>
      ipcRenderer.invoke('audioEngine:selectVst3SearchPath'),
    setVst3SearchPaths: (paths: string[]): Promise<Vst3CatalogState> =>
      ipcRenderer.invoke('audioEngine:setVst3SearchPaths', paths),
    scanVst3Plugins: (): Promise<Vst3CatalogState> =>
      ipcRenderer.invoke('audioEngine:scanVst3Plugins'),
    clearVst3Quarantine: (id: string): Promise<Vst3CatalogState> =>
      ipcRenderer.invoke('audioEngine:clearVst3Quarantine', id),
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
    exportDiagnostics: (): Promise<{ filePath: string | null }> =>
      ipcRenderer.invoke('audioEngine:exportDiagnostics'),
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

    onLoudnormStatus: (cb: AudioEngineLoudnormStatusCallback): (() => void) => {
      audioEngineLoudnormStatusCallbacks.add(cb)
      return () => audioEngineLoudnormStatusCallbacks.delete(cb)
    },

    onConfigApplied: (cb: AudioEngineConfigAppliedCallback): (() => void) => {
      audioEngineConfigAppliedCallbacks.add(cb)
      return () => audioEngineConfigAppliedCallbacks.delete(cb)
    },

    onDeviceOptionsChanged: (cb: AudioEngineDeviceOptionsChangedCallback): (() => void) => {
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
    cancel: (filePath?: string): Promise<void> =>
      ipcRenderer.invoke('bpmAnalysis:cancel', filePath),
    onCompleted: (cb: (event: BpmAnalysisCompletedEvent) => void): (() => void) => {
      const handler = (_event, data: BpmAnalysisCompletedEvent): void => cb(data)
      ipcRenderer.on('bpmAnalysis:completed', handler)
      return () => ipcRenderer.removeListener('bpmAnalysis:completed', handler)
    }
  },
  loudnessAnalysis: {
    request: (request: LoudnessAnalysisRequest): Promise<LoudnessAnalysisRequestResult> =>
      ipcRenderer.invoke('loudnessAnalysis:request', request),
    getCacheSize: (): Promise<number> => ipcRenderer.invoke('loudnessAnalysis:getCacheSize'),
    clearCache: (): Promise<number> => ipcRenderer.invoke('loudnessAnalysis:clearCache'),
    getStatus: (): Promise<{ status: string; source: string | null }> =>
      ipcRenderer.invoke('loudnessAnalysis:getStatus'),
    cancel: (filePath?: string): Promise<void> =>
      ipcRenderer.invoke('loudnessAnalysis:cancel', filePath),
    onCompleted: (cb: (event: LoudnessAnalysisCompletedEvent) => void): (() => void) => {
      const handler = (_event, data: LoudnessAnalysisCompletedEvent): void => cb(data)
      ipcRenderer.on('loudnessAnalysis:completed', handler)
      return () => ipcRenderer.removeListener('loudnessAnalysis:completed', handler)
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
  fonts: {
    listInstalled: (): Promise<string[]> => ipcRenderer.invoke('fonts:listInstalled')
  },
  ...themesApi,
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
    setNativeDspParameters: (
      id: string,
      parameters: Record<string, number>
    ): Promise<TwilightPluginDescriptor> =>
      ipcRenderer.invoke('plugins:setNativeDspParameters', id, parameters),
    onChanged: (cb: () => void): (() => void) => {
      pluginChangedCallbacks.add(cb)
      return () => pluginChangedCallbacks.delete(cb)
    }
  },
  providers: {
    list: (): Promise<TwilightMediaProviderRegistration[]> => ipcRenderer.invoke('providers:list'),
    call: async (
      providerId: string,
      method: TwilightMediaProviderMethod,
      args: unknown[],
      options?: { idempotencyKey?: string; requestId?: string }
    ): Promise<unknown> => {
      const ipcOptions = {
        ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        ...(options?.requestId ? { requestId: options.requestId } : {})
      }
      const lease = providerWriteIdempotency.begin(
        providerId,
        method,
        args,
        options?.idempotencyKey
      )
      try {
        const value = await ipcRenderer.invoke('providers:call', providerId, method, args, {
          ...ipcOptions,
          ...(lease.idempotencyKey ? { idempotencyKey: lease.idempotencyKey } : {})
        })
        lease.settle(true)
        return value
      } catch (error) {
        lease.settle(false)
        throw error
      }
    },
    cancel: (requestId: string): void => {
      ipcRenderer.send('providers:cancel', requestId)
    }
  },
  providerDownloads: {
    list: (): Promise<import('./types').ProviderDownloadTaskSnapshot[]> =>
      ipcRenderer.invoke('providerDownloads:list'),
    create: (
      input: import('./types').ProviderDownloadCreateInput
    ): Promise<import('./types').ProviderDownloadTaskSnapshot> =>
      ipcRenderer.invoke('providerDownloads:create', input),
    cancel: (taskId: string): Promise<void> =>
      ipcRenderer.invoke('providerDownloads:cancel', taskId),
    retry: (taskId: string): Promise<import('./types').ProviderDownloadTaskSnapshot> =>
      ipcRenderer.invoke('providerDownloads:retry', taskId),
    onChanged: (
      cb: (tasks: import('./types').ProviderDownloadTaskSnapshot[]) => void
    ): (() => void) => {
      providerDownloadChangedCallbacks.add(cb)
      return () => providerDownloadChangedCallbacks.delete(cb)
    }
  },
  extensions: {
    list: (): Promise<TwilightPluginExtensionContribution[]> =>
      ipcRenderer.invoke('extensions:list'),
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
    onLoadFailed: (cb: (payload: { code: number; description: string }) => void): (() => void) => {
      desktopLyricsLoadFailedCallbacks.add(cb)
      return () => desktopLyricsLoadFailedCallbacks.delete(cb)
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
  },
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
