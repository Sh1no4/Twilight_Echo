/**
 * Stage 0 — WindowAPI parity contract
 *
 * Electron is the full-featured baseline: every surface.method in this manifest
 * is exposed to the renderer by `src/preload/index.ts` (`window.api`), with the
 * auxiliary windows (desktop lyrics, mini player, tray player) exposing their own
 * subsets. The emerging Tauri runtime migrates those surfaces one method at a
 * time; `src/renderer/src/platform/tauriHostBridge.ts` wires each migrated method
 * to a real Tauri command (or an explicit capability rejection) and still falls
 * back to heuristic Proxy stubs for everything else.
 *
 * This module is the *contract*. It records for every surface.method:
 *
 * - `channel`        — the Electron main-process IPC channel (invoke/send/on).
 * - `mutates`        — whether the method changes main-process state.
 * - `revisionCas`    — whether writes use the versioned envelope
 *                      (`expectedRevision` / CAS conflict detection).
 * - `params`         — parameter names (auto-verified against the preload).
 * - `returns`        — `promise` | `void` | `unsubscribe`.
 * - `events`         — the IPC event channel(s) an `on*` method subscribes to.
 * - `platform`       — platform applicability (default `all`; platform
 *                      differences live at the backend layer).
 * - `securityBoundary` — the main-process validation boundary.
 * - `tauriTransport` — how the Tauri bridge currently transports this method:
 *                      `tauri-invoke` (real Tauri command), `tauri-native`
 *                      (real Tauri JS API), `tauri-stub` (default/heuristic
 *                      shape), `tauri-reject` (`RuntimeCapabilityError`),
 *                      `tauri-unmigrated` (Proxy heuristic stub).
 * - `testEvidence`   — test suites asserting Electron/Tauri behavior.
 *
 * The parity test (`src/main/ipc/windowApiParity.test.ts`) auto-extracts the
 * real preload surface and the real bridge transport and asserts this manifest
 * stays in sync: new preload APIs must be added here, and a method cannot be
 * declared `tauri-invoke`/`tauri-native` while the bridge still stubs it.
 *
 * Parameter and return *types* are governed by `src/preload/types.ts` and the
 * inferred `typeof api`; this manifest records the behavioral contract so the
 * types stay in a single source of truth.
 */

export const WINDOW_API_WINDOWS = ['main', 'desktopLyrics', 'miniPlayer', 'trayPlayer'] as const

export type WindowApiWindow = (typeof WINDOW_API_WINDOWS)[number]

/** How the Tauri host bridge currently transports a surface.method. */
export type TauriTransport =
  | 'tauri-invoke' // real Tauri command via invoke()
  | 'tauri-native' // real Tauri JS API (window/dialog/opener/convertFileSrc)
  | 'tauri-stub' // explicit default/heuristic shape in the bridge
  | 'tauri-reject' // rejects with RuntimeCapabilityError
  | 'tauri-unmigrated' // not wired in the bridge -> Proxy heuristic stub

export type WindowApiReturnKind = 'promise' | 'void' | 'unsubscribe'

export type WindowApiPlatform = 'all' | 'win32' | 'darwin' | 'linux'

export interface WindowApiMethodRecord {
  method: string
  /** Electron main-process IPC channel (invoke/send/on). */
  channel: string
  /** True when the method mutates main-process persistent or runtime state. */
  mutates: boolean
  /** True when writes use the versioned envelope with expectedRevision (CAS). */
  revisionCas?: boolean
  /** Parameter names (auto-verified against the preload signature). */
  params?: string[]
  /** Return kind (auto-verified against the preload implementation). */
  returns: WindowApiReturnKind
  /** IPC event channel(s) this on* method subscribes to. */
  events?: string[]
  /** Platform applicability; default 'all'. */
  platform?: WindowApiPlatform
  /** Main-process security boundary / validation expectation. */
  securityBoundary?: string
  /** Tauri transport classification (auto-verified against the bridge). */
  tauriTransport?: TauriTransport
  /** Test suites asserting Electron or Tauri behavior for this method. */
  testEvidence?: string[]
  /** Windows exposing this method; defaults to the surface's windows. */
  windows?: WindowApiWindow[]
}

export interface WindowApiSurfaceRecord {
  surface: string
  /** Windows exposing this surface. */
  windows: WindowApiWindow[]
  /** Main-process security boundary shared by the surface's methods. */
  securityBoundary?: string
  /** Test suites asserting Electron or Tauri behavior for this surface. */
  testEvidence?: string[]
  /** Default Tauri transport for the surface's methods (per-method overrides). */
  tauriTransport?: TauriTransport
  methods: ResolvedWindowApiMethodRecord[]
}

/**
 * A method record with the Tauri transport resolved (per-method override, else
 * the surface default, else `tauri-unmigrated`). `s()` produces these from the
 * loose `m()` records, so consumers always see a definite transport.
 */
export interface ResolvedWindowApiMethodRecord extends WindowApiMethodRecord {
  tauriTransport: TauriTransport
}

function m(
  method: string,
  channel: string,
  opts: Partial<Omit<WindowApiMethodRecord, 'method' | 'channel'>> = {}
): WindowApiMethodRecord {
  const returns = method.startsWith('on') ? 'unsubscribe' : 'promise'
  return { method, channel, mutates: false, returns, ...opts }
}

function s(
  surfaceName: string,
  methods: WindowApiMethodRecord[],
  opts: {
    windows?: WindowApiWindow[]
    securityBoundary?: string
    testEvidence?: string[]
    transport?: TauriTransport
  } = {}
): WindowApiSurfaceRecord {
  const { windows = ['main'], securityBoundary, testEvidence, transport } = opts
  return {
    surface: surfaceName,
    windows,
    ...(securityBoundary ? { securityBoundary } : {}),
    ...(testEvidence ? { testEvidence } : {}),
    methods: methods.map((method) => ({
      ...method,
      tauriTransport: method.tauriTransport ?? transport ?? 'tauri-unmigrated'
    }))
  }
}

export const WINDOW_API_MANIFEST: WindowApiSurfaceRecord[] = [
  s(
    'sleepTimer',
    [
      m('configure', 'sleepTimer:configure', { mutates: true, params: ['state'], tauriTransport: 'tauri-invoke' }),
      m('cancel', 'sleepTimer:cancel', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('getState', 'sleepTimer:getState', { tauriTransport: 'tauri-invoke' }),
      m('boundary', 'sleepTimer:boundary', { mutates: true, params: ['boundary'], tauriTransport: 'tauri-invoke' }),
      m('onState', 'sleepTimer:status', { params: ['callback'], events: ['sleepTimer:status'], tauriTransport: 'tauri-native' }),
      m('onTrigger', 'sleepTimer:trigger', { params: ['callback'], events: ['sleepTimer:trigger'], tauriTransport: 'tauri-native' })
    ],
    { testEvidence: ['test:sleep-timer'], transport: 'tauri-invoke' }
  ),
  s(
    'window',
    [
      m('minimize', 'window:minimize', { mutates: true, returns: 'void' }),
      m('toggleMaximize', 'window:toggleMaximize', { mutates: true, returns: 'void' }),
      m('close', 'window:close', { mutates: true, returns: 'void' })
    ],
    { securityBoundary: 'windowSystem', testEvidence: ['test:app'], transport: 'tauri-native' }
  ),
  s(
    'dialog',
    [m('openFolder', 'dialog:openFolder')],
    { securityBoundary: 'systemDialog', testEvidence: ['test:app'], transport: 'tauri-native' }
  ),
  s(
    'shell',
    [
      m('showItemInFolder', 'shell:showItemInFolder', { params: ['filePath'] }),
      m('openPath', 'shell:openPath', { params: ['path'] }),
      m('openExternal', 'shell:openExternal', { params: ['url'] })
    ],
    { securityBoundary: 'systemShell', testEvidence: ['test:app'], transport: 'tauri-native' }
  ),
  s(
    'discord',
    [
      m('getStatus', 'discord:getStatus'),
      m('updateActivity', 'discord:updateActivity', { mutates: true, params: ['data'] }),
      m('clearActivity', 'discord:clearActivity', { mutates: true })
    ],
    { securityBoundary: 'richPresence', transport: 'tauri-reject' }
  ),
  s(
    'library',
    [
      m('removeTracks', 'library:removeTracks', { mutates: true, params: ['request'], tauriTransport: 'tauri-invoke' }),
      m('restoreExclusions', 'library:restoreExclusions', { mutates: true, params: ['request'], tauriTransport: 'tauri-invoke' }),
      m('reset', 'library:reset', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('detectDuplicates', 'library:detectDuplicates', { tauriTransport: 'tauri-reject' }),
      m('writeTags', 'library:writeTags', { mutates: true, params: ['request'], tauriTransport: 'tauri-reject' }),
      m('restoreTags', 'library:restoreTags', { mutates: true, params: ['request'], tauriTransport: 'tauri-reject' }),
      m('scanStartup', 'library:scanStartup', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('scanFull', 'library:scanFull', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('getScanStatus', 'library:getScanStatus', { tauriTransport: 'tauri-invoke' }),
      m('getWatcherStatus', 'library:getWatcherStatus', { tauriTransport: 'tauri-reject' }),
      m('pauseScan', 'library:pauseScan', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('resumeScan', 'library:resumeScan', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('cancelScan', 'library:cancelScan', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('onChanged', 'library:changed', { params: ['cb'], events: ['library:changed'], tauriTransport: 'tauri-native' }),
      m('onCoversMissing', 'library:covers-missing', { params: ['cb'], events: ['library:covers-missing'], tauriTransport: 'tauri-native' }),
      m('onScanProgress', 'library:scan-progress', { params: ['cb'], events: ['library:scan-progress'], tauriTransport: 'tauri-native' }),
      m('onScanStatus', 'library:scan-status', { params: ['cb'], events: ['library:scan-status'], tauriTransport: 'tauri-native' })
    ],
    {
      securityBoundary: 'localLibrary',
      testEvidence: ['test:app', 'test:cue', 'test:duplicate-detection', 'test:tag-duplicate-management'],
      transport: 'tauri-invoke'
    }
  ),
  s(
    'fs',
    [
      m('scanMusicFiles', 'fs:scanMusicFiles', { params: ['folderPath'], tauriTransport: 'tauri-invoke' }),
      m('readAudioFile', 'fs:readAudioFile', { params: ['filePath'], tauriTransport: 'tauri-invoke' }),
      m('getAudioFileUrl', 'fs:getAudioFileUrl', { params: ['filePath'], tauriTransport: 'tauri-native' }),
      m('isAudioFileAuthorized', 'fs:isAudioFileAuthorized', { params: ['filePath'], tauriTransport: 'tauri-invoke' }),
      m('onScanProgress', 'fs:scanProgress', { params: ['cb'], events: ['fs:scanProgress'], tauriTransport: 'tauri-reject' })
    ],
    { securityBoundary: 'fileSystem', testEvidence: ['test:app'] }
  ),
  s(
    'audioEngine',
    [
      m('loadQueue', 'audioEngine:loadQueue', { mutates: true, params: ['items', 'startIndex'], tauriTransport: 'tauri-invoke' }),
      m('play', 'audioEngine:play', { mutates: true, params: ['filePath', 'startTime'], tauriTransport: 'tauri-invoke' }),
      m('isHtmlAudioFallbackAllowed', 'audioEngine:isHtmlAudioFallbackAllowed', {
        tauriTransport: 'tauri-invoke'
      }),
      m('togglePause', 'audioEngine:togglePause', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('seek', 'audioEngine:seek', { mutates: true, params: ['time'], tauriTransport: 'tauri-invoke' }),
      m('setVolume', 'audioEngine:setVolume', { mutates: true, params: ['volume'], tauriTransport: 'tauri-invoke' }),
      m('setPlaybackRate', 'audioEngine:setPlaybackRate', { mutates: true, params: ['rate'], tauriTransport: 'tauri-invoke' }),
      m('setLoopRange', 'audioEngine:setLoopRange', { mutates: true, params: ['startSeconds', 'endSeconds'], tauriTransport: 'tauri-invoke' }),
      m('stop', 'audioEngine:stop', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('next', 'audioEngine:next', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('previous', 'audioEngine:previous', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('setPlayMode', 'audioEngine:setPlayMode', { mutates: true, params: ['mode'], tauriTransport: 'tauri-invoke' }),
      m('getUpcomingTrack', 'audioEngine:getUpcomingTrack', { tauriTransport: 'tauri-invoke' }),
      m('setExclusiveMode', 'audioEngine:setExclusiveMode', {
        mutates: true,
        params: ['enabled'],
        tauriTransport: 'tauri-invoke'
      }),
      m('getExclusiveMode', 'audioEngine:getExclusiveMode', { tauriTransport: 'tauri-invoke' }),
      m('setAudioOutput', 'audioEngine:setAudioOutput', {
        mutates: true,
        params: ['output', 'device'],
        tauriTransport: 'tauri-invoke'
      }),
      m('setAudioDevice', 'audioEngine:setAudioDevice', {
        mutates: true,
        params: ['device'],
        tauriTransport: 'tauri-invoke'
      }),
      m('setOutputConfig', 'audioEngine:setOutputConfig', { mutates: true, params: ['config'], tauriTransport: 'tauri-invoke' }),
      m('getOutputConfigApplyStatus', 'audioEngine:getOutputConfigApplyStatus', { tauriTransport: 'tauri-invoke' }),
      m('getAudioOutput', 'audioEngine:getAudioOutput', { tauriTransport: 'tauri-invoke' }),
      m('getAudioOutputOptions', 'audioEngine:getAudioOutputOptions', { tauriTransport: 'tauri-invoke' }),
      m('getAudioOutputState', 'audioEngine:getAudioOutputState', { tauriTransport: 'tauri-invoke' }),
      m('setAudioProcessing', 'audioEngine:setAudioProcessing', {
        mutates: true,
        params: ['settings'],
        tauriTransport: 'tauri-invoke'
      }),
      m('getAudioProcessing', 'audioEngine:getAudioProcessing', { tauriTransport: 'tauri-invoke' }),
      m('getDspSceneState', 'audioEngine:getDspSceneState', { tauriTransport: 'tauri-invoke' }),
      m('setDspScenes', 'audioEngine:setDspScenes', {
        mutates: true,
        params: ['scenes', 'pinnedSceneId'],
        tauriTransport: 'tauri-invoke'
      }),
      m('setOutputStage', 'audioEngine:setOutputStage', {
        mutates: true,
        params: ['partial'],
        tauriTransport: 'tauri-invoke'
      }),
      m('setStereoImage', 'audioEngine:setStereoImage', {
        mutates: true,
        params: ['partial'],
        tauriTransport: 'tauri-invoke'
      }),
      m('applyDspScene', 'audioEngine:applyDspScene', {
        mutates: true,
        params: ['sceneId', 'confirmDsdPcmFallback'],
        tauriTransport: 'tauri-invoke'
      }),
      m('getDspGraphStatus', 'audioEngine:getDspGraphStatus', { tauriTransport: 'tauri-invoke' }),
      m('getDspAssets', 'audioEngine:getDspAssets', { tauriTransport: 'tauri-invoke' }),
      m('importDspAsset', 'audioEngine:importDspAsset', { mutates: true, params: ['kind'], tauriTransport: 'tauri-invoke' }),
      m('importDspCorrectionProfile', 'audioEngine:importDspCorrectionProfile', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('importFrequencyResponse', 'audioEngine:importFrequencyResponse', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('getDspCorrectionProfile', 'audioEngine:getDspCorrectionProfile', { params: ['assetId'], tauriTransport: 'tauri-invoke' }),
      m('deleteDspAsset', 'audioEngine:deleteDspAsset', { mutates: true, params: ['assetId'], tauriTransport: 'tauri-invoke' }),
      m('exportDspProfile', 'audioEngine:exportDspProfile', { params: ['name'], tauriTransport: 'tauri-invoke' }),
      m('importDspProfile', 'audioEngine:importDspProfile', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('getVst3Catalog', 'audioEngine:getVst3Catalog', { tauriTransport: 'tauri-invoke' }),
      m('setVst3Enabled', 'audioEngine:setVst3Enabled', {
        mutates: true,
        params: ['enabled'],
        tauriTransport: 'tauri-invoke'
      }),
      m('selectVst3SearchPath', 'audioEngine:selectVst3SearchPath', { mutates: true, tauriTransport: 'tauri-native' }),
      m('setVst3SearchPaths', 'audioEngine:setVst3SearchPaths', {
        mutates: true,
        params: ['paths'],
        tauriTransport: 'tauri-invoke'
      }),
      m('scanVst3Plugins', 'audioEngine:scanVst3Plugins', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('clearVst3Quarantine', 'audioEngine:clearVst3Quarantine', { mutates: true, params: ['id'], tauriTransport: 'tauri-invoke' }),
      m('selectImpulseResponse', 'audioEngine:selectImpulseResponse', { mutates: true, tauriTransport: 'tauri-native' }),
      m('loadImpulseResponse', 'audioEngine:loadImpulseResponse', { mutates: true, params: ['path'], tauriTransport: 'tauri-invoke' }),
      m('unloadImpulseResponse', 'audioEngine:unloadImpulseResponse', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('getConvolverInfo', 'audioEngine:getConvolverInfo', { tauriTransport: 'tauri-invoke' }),
      m('setEqBands', 'audioEngine:setEqBands', { mutates: true, params: ['settings'], tauriTransport: 'tauri-invoke' }),
      m('setEqPreset', 'audioEngine:setEqPreset', { mutates: true, params: ['preset'], tauriTransport: 'tauri-invoke' }),
      m('setCrossfeedStrength', 'audioEngine:setCrossfeedStrength', { mutates: true, params: ['strength'], tauriTransport: 'tauri-invoke' }),
      m('setReplayGainMode', 'audioEngine:setReplayGainMode', {
        mutates: true,
        params: ['mode', 'preamp', 'fallback', 'clip'],
        tauriTransport: 'tauri-invoke'
      }),
      m('getMetadata', 'audioEngine:getMetadata', { params: ['source'], tauriTransport: 'tauri-invoke' }),
      m('getPlaybackInfo', 'audioEngine:getPlaybackInfo', { tauriTransport: 'tauri-invoke' }),
      m('exportDiagnostics', 'audioEngine:exportDiagnostics', { tauriTransport: 'tauri-invoke' }),
      m('getSpectrumData', 'audioEngine:getSpectrumData', { params: ['points'], tauriTransport: 'tauri-invoke' }),
      m('getVisualizationData', 'audioEngine:getVisualizationData', {
        params: ['options'],
        tauriTransport: 'tauri-invoke'
      }),
      m('onPropertyChange', 'audioEngine:property-change', { params: ['cb'], events: ['audioEngine:property-change'], tauriTransport: 'tauri-native' }),
      m('onEndFile', 'audioEngine:end-file', { params: ['cb'], events: ['audioEngine:end-file'], tauriTransport: 'tauri-native' }),
      m('onStartFile', 'audioEngine:start-file', { params: ['cb'], events: ['audioEngine:start-file'], tauriTransport: 'tauri-native' }),
      m('onReady', 'audioEngine:ready', { params: ['cb'], events: ['audioEngine:ready'], tauriTransport: 'tauri-native' }),
      m('onError', 'audioEngine:error', { params: ['cb'], events: ['audioEngine:error'], tauriTransport: 'tauri-native' }),
      m('onDisconnected', 'audioEngine:disconnected', { params: ['cb'], events: ['audioEngine:disconnected'], tauriTransport: 'tauri-native' }),
      m('onPlaybackInfo', 'audioEngine:playback-info', { params: ['cb'], events: ['audioEngine:playback-info'], tauriTransport: 'tauri-native' }),
      m('onLoudnormStatus', 'audioEngine:loudnorm-status', { params: ['cb'], events: ['audioEngine:loudnorm-status'], tauriTransport: 'tauri-native' }),
      m('onConfigApplied', 'audioEngine:config-applied', { params: ['cb'], events: ['audioEngine:config-applied'], tauriTransport: 'tauri-native' }),
      m('onDeviceOptionsChanged', 'audioEngine:device-options-changed', {
        params: ['cb'],
        events: ['audioEngine:device-options-changed'],
        tauriTransport: 'tauri-native'
      }),
      m('onServiceCrash', 'audioEngine:service-crash', { params: ['cb'], events: ['audioEngine:service-crash'], tauriTransport: 'tauri-native' }),
      m('onServiceReady', 'audioEngine:service-ready', { params: ['cb'], events: ['audioEngine:service-ready'], tauriTransport: 'tauri-native' })
    ],
    {
      securityBoundary: 'audioEngine',
      testEvidence: ['test:playback-routing', 'test:audio-engine'],
      transport: 'tauri-invoke'
    }
  ),
  s(
    'bpmAnalysis',
    [
      m('request', 'bpmAnalysis:request', { mutates: true, params: ['request'], tauriTransport: 'tauri-invoke' }),
      m('getCacheSize', 'bpmAnalysis:getCacheSize', { tauriTransport: 'tauri-invoke' }),
      m('clearCache', 'bpmAnalysis:clearCache', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('cancel', 'bpmAnalysis:cancel', { mutates: true, params: ['filePath'], tauriTransport: 'tauri-invoke' }),
      m('onCompleted', 'bpmAnalysis:completed', { params: ['cb'], events: ['bpmAnalysis:completed'], tauriTransport: 'tauri-native' })
    ],
    { transport: 'tauri-invoke' }
  ),
  s(
    'loudnessAnalysis',
    [
      m('request', 'loudnessAnalysis:request', { mutates: true, params: ['request'], tauriTransport: 'tauri-invoke' }),
      m('getCacheSize', 'loudnessAnalysis:getCacheSize', { tauriTransport: 'tauri-invoke' }),
      m('clearCache', 'loudnessAnalysis:clearCache', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('getStatus', 'loudnessAnalysis:getStatus', { tauriTransport: 'tauri-invoke' }),
      m('cancel', 'loudnessAnalysis:cancel', { mutates: true, params: ['filePath'], tauriTransport: 'tauri-invoke' }),
      m('onCompleted', 'loudnessAnalysis:completed', { params: ['cb'], events: ['loudnessAnalysis:completed'], tauriTransport: 'tauri-native' })
    ],
    { transport: 'tauri-invoke' }
  ),
  s(
    'opra',
    [
      m('search', 'opra:search', { params: ['query'], tauriTransport: 'tauri-reject' }),
      m('getProfile', 'opra:getProfile', { params: ['eqId'], tauriTransport: 'tauri-reject' }),
      m('refresh', 'opra:refresh', { mutates: true, tauriTransport: 'tauri-reject' }),
      m('getStatus', 'opra:getStatus', { tauriTransport: 'tauri-reject' })
    ],
    { testEvidence: ['test:app'], transport: 'tauri-reject' }
  ),
  s(
    'app',
    [
      m('consumePendingNavigation', 'app:consumePendingNavigation', {
        tauriTransport: 'tauri-invoke'
      }),
      m('relaunch', 'app:relaunch', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('checkForUpdates', 'app:checkForUpdates', { tauriTransport: 'tauri-reject' }),
      m('downloadUpdate', 'app:downloadUpdate', { mutates: true, tauriTransport: 'tauri-reject' }),
      m('cancelUpdateDownload', 'app:cancelUpdateDownload', { mutates: true, tauriTransport: 'tauri-reject' }),
      m('installUpdate', 'app:installUpdate', { mutates: true, tauriTransport: 'tauri-reject' }),
      m('onUpdateProgress', 'app:update-progress', { params: ['cb'], events: ['app:update-progress'], tauriTransport: 'tauri-reject' }),
      m('onSavePlaybackSession', 'app:save-playback-session', {
        params: ['cb'],
        events: ['app:save-playback-session'],
        tauriTransport: 'tauri-reject'
      }),
      m('onNavigate', 'app:navigate', {
        params: ['cb'],
        events: ['app:navigate'],
        tauriTransport: 'tauri-native'
      })
    ],
    { securityBoundary: 'appLifecycle', testEvidence: ['test:app'] }
  ),
  s(
    'ncm',
    [
      m('getPort', 'ncm:getPort', { tauriTransport: 'tauri-reject' }),
      m('request', 'ncm:request', { params: ['path', 'cookie'], tauriTransport: 'tauri-reject' }),
      m('getCachedSong', 'ncm:getCachedSong', { params: ['songId'], tauriTransport: 'tauri-reject' }),
      m('cacheSong', 'ncm:cacheSong', { mutates: true, params: ['songId', 'url', 'fileName'], tauriTransport: 'tauri-reject' })
    ],
    { transport: 'tauri-reject' }
  ),
  s(
    'ncmCloud',
    [
      m('chooseUploadFiles', 'ncmCloud:chooseUploadFiles'),
      m('upload', 'ncmCloud:upload', { mutates: true, params: ['handle'] }),
      m('download', 'ncmCloud:download', { mutates: true, params: ['request'] }),
      m('cancel', 'ncmCloud:cancel', { mutates: true, params: ['transferId'] }),
      m('onProgress', 'ncmCloud:progress', { params: ['callback'], events: ['ncmCloud:progress'] })
    ],
    { testEvidence: ['test:plugins'], transport: 'tauri-reject' }
  ),
  s(
    'radio',
    [
      m('loadStations', 'radio:loadStations', { tauriTransport: 'tauri-invoke' }),
      m('saveStations', 'radio:saveStations', { mutates: true, revisionCas: true, params: ['document', 'expectedRevision'], tauriTransport: 'tauri-invoke' }),
      m('importPlaylist', 'radio:importPlaylist', { mutates: true, params: ['payload'], tauriTransport: 'tauri-reject' }),
      m('searchDirectory', 'radio:searchDirectory', { params: ['payload'], tauriTransport: 'tauri-reject' })
    ],
    { testEvidence: ['test:radio-remote'], transport: 'tauri-invoke' }
  ),
  s(
    'podcast',
    [
      m('loadSubscriptions', 'podcast:loadSubscriptions', { tauriTransport: 'tauri-invoke' }),
      m('saveSubscriptions', 'podcast:saveSubscriptions', {
        mutates: true,
        revisionCas: true,
        params: ['document', 'expectedRevision'],
        tauriTransport: 'tauri-invoke'
      }),
      m('subscribe', 'podcast:subscribe', { mutates: true, params: ['feedUrl'], tauriTransport: 'tauri-reject' }),
      m('refresh', 'podcast:refresh', { mutates: true, params: ['subscriptionId'], tauriTransport: 'tauri-reject' }),
      m('refreshAll', 'podcast:refreshAll', { mutates: true, tauriTransport: 'tauri-reject' })
    ],
    { testEvidence: ['test:radio-remote'], transport: 'tauri-invoke' }
  ),
  s(
    'networkSources',
    [
      m('listProfiles', 'networkSources:listProfiles', { tauriTransport: 'tauri-reject' }),
      m('createProfile', 'networkSources:createProfile', { mutates: true, params: ['input'], tauriTransport: 'tauri-reject' }),
      m('updateProfile', 'networkSources:updateProfile', { mutates: true, params: ['id', 'patch'], tauriTransport: 'tauri-reject' }),
      m('deleteProfile', 'networkSources:deleteProfile', { mutates: true, params: ['id'], tauriTransport: 'tauri-reject' }),
      m('listDirectory', 'networkSources:listDirectory', { params: ['profileId', 'remotePath'], tauriTransport: 'tauri-reject' }),
      m('testConnection', 'networkSources:testConnection', { params: ['profileId'], tauriTransport: 'tauri-reject' }),
      m('resolvePlayback', 'networkSources:resolvePlayback', { params: ['profileId', 'entry'], tauriTransport: 'tauri-reject' }),
      m('scanDirectory', 'networkSources:scanDirectory', { mutates: true, params: ['profileId', 'remotePath'], tauriTransport: 'tauri-reject' }),
      m('listLibrary', 'networkSources:listLibrary', { params: ['profileId', 'query'], tauriTransport: 'tauri-reject' }),
      m('removeLibraryEntry', 'networkSources:removeLibraryEntry', { mutates: true, params: ['profileId', 'entryId'], tauriTransport: 'tauri-reject' }),
      m('enrichLibrary', 'networkSources:enrichLibrary', { mutates: true, params: ['profileId'], tauriTransport: 'tauri-reject' }),
      m('cacheInfo', 'networkSources:cacheInfo', { tauriTransport: 'tauri-reject' }),
      m('clearCache', 'networkSources:clearCache', { mutates: true, tauriTransport: 'tauri-reject' }),
      m('searchLibrary', 'networkSources:searchLibrary', { params: ['query'], tauriTransport: 'tauri-reject' }),
      m('coverDataUrl', 'networkSources:coverDataUrl', { params: ['profileId', 'entryId'], tauriTransport: 'tauri-reject' })
    ],
    { securityBoundary: 'networkSource', testEvidence: ['test:network-sources'], transport: 'tauri-reject' }
  ),
  s(
    'remote',
    [
      m('getStatus', 'remote:getStatus', { tauriTransport: 'tauri-reject' }),
      m('setEnabled', 'remote:setEnabled', { mutates: true, params: ['enabled'], tauriTransport: 'tauri-reject' }),
      m('rotatePin', 'remote:rotatePin', { mutates: true, tauriTransport: 'tauri-reject' }),
      m('publishState', 'remote:publishState', { mutates: true, params: ['snapshot'], tauriTransport: 'tauri-reject' }),
      m('discoverDlna', 'remote:discoverDlna', { tauriTransport: 'tauri-reject' }),
      m('getDlnaDevices', 'remote:getDlnaDevices', { tauriTransport: 'tauri-reject' }),
      m('castToDevice', 'remote:castToDevice', { mutates: true, params: ['payload'], tauriTransport: 'tauri-reject' }),
      m('stopCast', 'remote:stopCast', { mutates: true, tauriTransport: 'tauri-reject' }),
      m('getCastTarget', 'remote:getCastTarget', { tauriTransport: 'tauri-reject' }),
      m('controlCast', 'remote:controlCast', { mutates: true, params: ['payload'], tauriTransport: 'tauri-reject' })
    ],
    { securityBoundary: 'remoteCast', testEvidence: ['test:radio-remote'], transport: 'tauri-reject' }
  ),
  s(
    'data',
    [
      m('saveMusicLibrary', 'data:saveMusicLibrary', { mutates: true, params: ['data'], tauriTransport: 'tauri-invoke' }),
      m('loadMusicLibrary', 'data:loadMusicLibrary', { tauriTransport: 'tauri-invoke' }),
      m('getCover', 'cover:get', { params: ['handle'], windows: ['main', 'miniPlayer'], tauriTransport: 'tauri-invoke' }),
      m('grantRemoteCover', 'cover:grantRemote', { mutates: true, params: ['source'], windows: ['main', 'miniPlayer'], tauriTransport: 'tauri-reject' }),
      m('getLyrics', 'lyrics:get', { params: ['dir', 'fileName', 'filePath'], tauriTransport: 'tauri-reject' }),
      m('importLyrics', 'lyrics:import', { mutates: true, tauriTransport: 'tauri-reject' }),
      m('saveLyrics', 'lyrics:save', { mutates: true, params: ['contents'], tauriTransport: 'tauri-reject' }),
      m('searchOnlineLyrics', 'lyrics:searchOnline', { params: ['query'], tauriTransport: 'tauri-reject' }),
      m('saveLyricsManagement', 'data:saveLyricsManagement', {
        mutates: true,
        revisionCas: true,
        params: ['document', 'expectedRevision'],
        tauriTransport: 'tauri-invoke'
      }),
      m('loadLyricsManagement', 'data:loadLyricsManagement', { tauriTransport: 'tauri-invoke' }),
      m('loadPlaybackBookmarks', 'data:loadPlaybackBookmarks', { tauriTransport: 'tauri-invoke' }),
      m('savePlaybackBookmarks', 'data:savePlaybackBookmarks', {
        mutates: true,
        revisionCas: true,
        params: ['document', 'expectedRevision'],
        tauriTransport: 'tauri-invoke'
      }),
      m('savePlaybackSession', 'data:savePlaybackSession', {
        mutates: true,
        revisionCas: true,
        params: ['session', 'expectedRevision'],
        tauriTransport: 'tauri-invoke'
      }),
      m('loadPlaybackSession', 'data:loadPlaybackSession', { tauriTransport: 'tauri-invoke' }),
      m('clearPlaybackSession', 'data:clearPlaybackSession', {
        mutates: true,
        revisionCas: true,
        params: ['expectedRevision'],
        tauriTransport: 'tauri-invoke'
      }),
      m('savePlaylists', 'data:savePlaylists', {
        mutates: true,
        revisionCas: true,
        params: ['playlists', 'expectedRevision'],
        tauriTransport: 'tauri-invoke'
      }),
      m('loadPlaylists', 'data:loadPlaylists', { tauriTransport: 'tauri-invoke' }),
      m('saveCookie', 'data:saveCookie', { mutates: true, params: ['cookie'], tauriTransport: 'tauri-reject' }),
      m('loadCookie', 'data:loadCookie', { tauriTransport: 'tauri-reject' })
    ],
    {
      securityBoundary: 'persistence',
      testEvidence: ['test:app', 'test:playlist-lifecycle', 'test:lyrics-management']
    }
  ),
  s(
    'settings',
    [
      m('get', 'settings:get', { tauriTransport: 'tauri-invoke' }),
      m('update', 'settings:update', { mutates: true, params: ['patch'], tauriTransport: 'tauri-invoke' }),
      m('chooseCacheFolder', 'settings:chooseCacheFolder', { tauriTransport: 'tauri-reject' }),
      m('chooseBackgroundImage', 'settings:chooseBackgroundImage', { tauriTransport: 'tauri-reject' }),
      m('importBackgroundImage', 'settings:importBackgroundImage', { mutates: true, params: ['fileName', 'data'], tauriTransport: 'tauri-reject' }),
      m('exportBackup', 'settings:export', { tauriTransport: 'tauri-invoke' }),
      m('importBackup', 'settings:import', { mutates: true, params: ['json'], tauriTransport: 'tauri-invoke' }),
      m('getCacheSize', 'settings:getCacheSize', { tauriTransport: 'tauri-invoke' }),
      m('clearCache', 'settings:clearCache', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('getShortcutStatuses', 'settings:getShortcutStatuses', { tauriTransport: 'tauri-invoke' }),
      m('onChanged', 'settings:changed', {
        params: ['cb'],
        events: ['settings:changed'],
        tauriTransport: 'tauri-native'
      }),
      m('onPlayerShortcut', 'player:shortcut', { params: ['cb'], events: ['player:shortcut'] })
    ],
    { securityBoundary: 'settings', testEvidence: ['test:app'], transport: 'tauri-reject' }
  ),
  s(
    'fonts',
    [m('listInstalled', 'fonts:listInstalled', { tauriTransport: 'tauri-invoke' })],
    { securityBoundary: 'fontEnumeration', testEvidence: ['test:app'] }
  ),
  s(
    'themes',
    [
      m('getSystemTone', 'themes:getSystemTone', { tauriTransport: 'tauri-stub' }),
      m('getBootstrap', 'themes:getBootstrap', { tauriTransport: 'tauri-invoke' }),
      m('list', 'themes:list', { tauriTransport: 'tauri-invoke' }),
      m('save', 'themes:save', { mutates: true, revisionCas: true, params: ['profile', 'expectedRevision'], tauriTransport: 'tauri-invoke' }),
      m('delete', 'themes:delete', { mutates: true, revisionCas: true, params: ['profileId', 'expectedRevision'], tauriTransport: 'tauri-invoke' }),
      m('setActive', 'themes:setActive', { mutates: true, revisionCas: true, params: ['selection', 'expectedRevision'], tauriTransport: 'tauri-invoke' }),
      m('setWindowInheritance', 'themes:setWindowInheritance', {
        mutates: true,
        revisionCas: true,
        params: ['inheritance', 'expectedRevision'],
        tauriTransport: 'tauri-invoke'
      }),
      m('importTheme', 'themes:import', { mutates: true, revisionCas: true, params: ['expectedRevision'] }),
      m('exportTheme', 'themes:export', { params: ['profileId'] }),
      m('importAsset', 'themes:importAsset', { mutates: true, params: ['profileId', 'type'] }),
      m('validateAssets', 'themes:validateAssets', { params: ['profileId', 'assets'] }),
      m('copyAssets', 'themes:copyAssets', { mutates: true, params: ['sourceProfileId', 'targetProfileId'] }),
      m('onChanged', 'themes:changed', {
        params: ['cb'],
        events: ['themes:changed'],
        tauriTransport: 'tauri-native'
      }),
      m('onSystemToneChanged', 'themes:systemToneChanged', {
        params: ['cb'],
        events: ['themes:systemToneChanged'],
        tauriTransport: 'tauri-stub'
      })
    ],
    { securityBoundary: 'themePersistence', testEvidence: ['test:themes'], transport: 'tauri-reject' }
  ),
  s(
    'plugins',
    [
      m('list', 'plugins:list', { tauriTransport: 'tauri-invoke' }),
      m('installFromPath', 'plugins:installFromPath', { mutates: true, params: ['path'], tauriTransport: 'tauri-invoke' }),
      m('chooseAndInstall', 'plugins:chooseAndInstall', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('enable', 'plugins:enable', { mutates: true, params: ['id'], tauriTransport: 'tauri-invoke' }),
      m('disable', 'plugins:disable', { mutates: true, params: ['id'], tauriTransport: 'tauri-invoke' }),
      m('uninstall', 'plugins:uninstall', { mutates: true, params: ['id', 'options'], tauriTransport: 'tauri-invoke' }),
      m('openLog', 'plugins:openLog', { mutates: true, params: ['id'], tauriTransport: 'tauri-invoke' }),
      m('getLog', 'plugins:getLog', { params: ['id'], tauriTransport: 'tauri-invoke' }),
      m('listIndex', 'plugins:listIndex', { tauriTransport: 'tauri-invoke' }),
      m('refreshIndex', 'plugins:refreshIndex', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('getIndexStatus', 'plugins:getIndexStatus', { tauriTransport: 'tauri-invoke' }),
      m('installFromIndex', 'plugins:installFromIndex', { mutates: true, params: ['id'], tauriTransport: 'tauri-invoke' }),
      m('setNativeDspParameters', 'plugins:setNativeDspParameters', {
        mutates: true,
        params: ['id', 'parameters'],
        tauriTransport: 'tauri-invoke'
      }),
      m('onChanged', 'plugins:changed', { params: ['cb'], events: ['plugins:changed'], tauriTransport: 'tauri-reject' })
    ],
    { securityBoundary: 'pluginHost', testEvidence: ['test:plugins'], transport: 'tauri-invoke' }
  ),
  s(
    'providers',
    [
      m('list', 'providers:list', { tauriTransport: 'tauri-invoke' }),
      m('call', 'providers:call', { mutates: true, params: ['providerId', 'method', 'args', 'options'], tauriTransport: 'tauri-invoke' }),
      m('cancel', 'providers:cancel', { mutates: true, params: ['requestId'], returns: 'void', tauriTransport: 'tauri-invoke' })
    ],
    { securityBoundary: 'providerRpc', testEvidence: ['test:plugins'], transport: 'tauri-invoke' }
  ),
  s(
    'providerDownloads',
    [
      m('list', 'providerDownloads:list', { tauriTransport: 'tauri-reject' }),
      m('create', 'providerDownloads:create', { mutates: true, params: ['input'], tauriTransport: 'tauri-reject' }),
      m('cancel', 'providerDownloads:cancel', { mutates: true, params: ['taskId'], tauriTransport: 'tauri-reject' }),
      m('retry', 'providerDownloads:retry', { mutates: true, params: ['taskId'], tauriTransport: 'tauri-reject' }),
      m('onChanged', 'providerDownloads:changed', { params: ['cb'], events: ['providerDownloads:changed'], tauriTransport: 'tauri-reject' })
    ],
    { securityBoundary: 'providerDownload', testEvidence: ['test:plugins'], transport: 'tauri-reject' }
  ),
  s(
    'extensions',
    [
      m('list', 'extensions:list', { tauriTransport: 'tauri-invoke' }),
      m('executeCommand', 'extensions:executeCommand', { mutates: true, params: ['command', 'args'], tauriTransport: 'tauri-invoke' }),
      m('readThemeStylesheet', 'extensions:readThemeStylesheet', { params: ['stylesheetPath'], tauriTransport: 'tauri-invoke' })
    ],
    { securityBoundary: 'extensionHost', testEvidence: ['test:plugins'], transport: 'tauri-invoke' }
  ),
  s(
    'desktopLyrics',
    [
      m('toggle', 'desktopLyrics:toggle', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('show', 'desktopLyrics:show', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('hide', 'desktopLyrics:hide', { mutates: true, tauriTransport: 'tauri-invoke' }),
      m('updateTrack', 'desktopLyrics:updateTrack', {
        mutates: true,
        params: ['data'],
        returns: 'void',
        tauriTransport: 'tauri-invoke'
      }),
      m('updateTime', 'desktopLyrics:updateTime', {
        mutates: true,
        params: ['time'],
        returns: 'void',
        tauriTransport: 'tauri-invoke'
      }),
      m('updateSettings', 'desktopLyrics:updateSettings', {
        mutates: true,
        params: ['settings'],
        returns: 'void',
        tauriTransport: 'tauri-invoke'
      }),
      m('onToggle', 'desktopLyrics:toggleChanged', {
        params: ['cb'],
        events: ['desktopLyrics:toggleChanged'],
        tauriTransport: 'tauri-native'
      }),
      m('onInitSettings', 'desktopLyrics:initSettings', {
        params: ['cb'],
        events: ['desktopLyrics:initSettings'],
        tauriTransport: 'tauri-native'
      }),
      m('onTrackUpdate', 'desktopLyrics:updateTrack', {
        params: ['cb'],
        events: ['desktopLyrics:updateTrack'],
        tauriTransport: 'tauri-native'
      }),
      m('onTimeUpdate', 'desktopLyrics:updateTime', {
        params: ['cb'],
        events: ['desktopLyrics:updateTime'],
        tauriTransport: 'tauri-native'
      }),
      m('onSettingsUpdate', 'desktopLyrics:updateSettings', {
        params: ['cb'],
        events: ['desktopLyrics:updateSettings'],
        tauriTransport: 'tauri-native'
      }),
      m('onLoadFailed', 'desktopLyrics:loadFailed', {
        params: ['cb'],
        events: ['desktopLyrics:loadFailed'],
        tauriTransport: 'tauri-native'
      }),
      m('getPosition', 'desktopLyrics:getPosition', {
        returns: 'void',
        tauriTransport: 'tauri-invoke'
      }),
      m('move', 'desktopLyrics:move', {
        mutates: true,
        params: ['x', 'y'],
        returns: 'void',
        tauriTransport: 'tauri-invoke'
      }),
      m('requestClose', 'desktopLyrics:requestClose', {
        mutates: true,
        returns: 'void',
        tauriTransport: 'tauri-invoke'
      })
    ],
    {
      windows: ['main', 'desktopLyrics'],
      securityBoundary: 'auxWindow',
      testEvidence: ['test:app'],
      transport: 'tauri-invoke'
    }
  ),
  s(
    'miniPlayer',
    [
      m('getBootstrap', 'miniPlayer:getBootstrap', {
        tauriTransport: 'tauri-invoke',
        windows: ['main', 'miniPlayer']
      }),
      m('command', 'miniPlayer:command', {
        mutates: true,
        params: ['command'],
        returns: 'void',
        tauriTransport: 'tauri-invoke',
        windows: ['main', 'miniPlayer']
      }),
      m('updateSettings', 'miniPlayer:updateSettings', {
        mutates: true,
        params: ['patch'],
        tauriTransport: 'tauri-invoke',
        windows: ['main', 'miniPlayer']
      }),
      m('chooseBackgroundImage', 'miniPlayer:chooseBackgroundImage', {
        tauriTransport: 'tauri-invoke',
        windows: ['main', 'miniPlayer']
      }),
      m('minimize', 'miniPlayer:minimize', {
        returns: 'void',
        tauriTransport: 'tauri-invoke',
        windows: ['main', 'miniPlayer']
      }),
      m('returnToMain', 'miniPlayer:returnToMain', {
        returns: 'void',
        tauriTransport: 'tauri-invoke',
        windows: ['main', 'miniPlayer']
      }),
      m('onState', 'miniPlayer:state', {
        params: ['cb'],
        events: ['miniPlayer:state'],
        tauriTransport: 'tauri-native',
        windows: ['main', 'miniPlayer']
      }),
      m('onSettings', 'miniPlayer:settings', {
        params: ['cb'],
        events: ['miniPlayer:settings'],
        tauriTransport: 'tauri-native',
        windows: ['main', 'miniPlayer']
      }),
      m('onMotionPreference', 'miniPlayer:motionPreference', {
        params: ['cb'],
        events: ['miniPlayer:motionPreference'],
        tauriTransport: 'tauri-native',
        windows: ['main', 'miniPlayer']
      }),
      m('open', 'miniPlayer:open', {
        mutates: true,
        tauriTransport: 'tauri-invoke',
        windows: ['main']
      }),
      m('publishState', 'miniPlayer:publishState', {
        mutates: true,
        params: ['state'],
        returns: 'void',
        tauriTransport: 'tauri-invoke',
        windows: ['main']
      }),
      m('onCommand', 'miniPlayer:command', {
        params: ['cb'],
        events: ['miniPlayer:command'],
        tauriTransport: 'tauri-native',
        windows: ['main']
      })
    ],
    {
      windows: ['main', 'miniPlayer'],
      securityBoundary: 'auxWindow',
      testEvidence: ['test:playback-routing'],
      transport: 'tauri-invoke'
    }
  ),
  s(
    'trayPlayer',
    [
      m('getBootstrap', 'trayPlayer:getBootstrap', {
        tauriTransport: 'tauri-invoke',
        windows: ['main', 'trayPlayer']
      }),
      m('command', 'trayPlayer:command', {
        mutates: true,
        params: ['command'],
        returns: 'void',
        tauriTransport: 'tauri-invoke',
        windows: ['main', 'trayPlayer']
      }),
      m('navigate', 'trayPlayer:navigate', {
        mutates: true,
        params: ['target'],
        returns: 'void',
        tauriTransport: 'tauri-invoke',
        windows: ['main', 'trayPlayer']
      }),
      m('hide', 'trayPlayer:hide', {
        returns: 'void',
        tauriTransport: 'tauri-invoke',
        windows: ['main', 'trayPlayer']
      }),
      m('onState', 'trayPlayer:state', {
        params: ['cb'],
        events: ['trayPlayer:state'],
        tauriTransport: 'tauri-native',
        windows: ['main', 'trayPlayer']
      }),
      m('toggle', 'trayPlayer:toggle', {
        mutates: true,
        tauriTransport: 'tauri-invoke',
        windows: ['main']
      }),
      m('isVisible', 'trayPlayer:isVisible', {
        tauriTransport: 'tauri-invoke',
        windows: ['main']
      })
    ],
    {
      windows: ['main', 'trayPlayer'],
      securityBoundary: 'auxWindow',
      testEvidence: ['test:app'],
      transport: 'tauri-invoke'
    }
  ),
  s(
    'debug',
    [m('appendNativeTrace', 'debug:appendNativeTrace', { mutates: true, params: ['message'], tauriTransport: 'tauri-invoke' })],
    { transport: 'tauri-invoke' }
  )
]

/** Look up a surface record by name. */
export function getWindowApiSurface(surfaceName: string): WindowApiSurfaceRecord | undefined {
  return WINDOW_API_MANIFEST.find((entry) => entry.surface === surfaceName)
}

/** Look up a method record by surface and method name (transport resolved). */
export function getWindowApiMethod(
  surfaceName: string,
  method: string
): ResolvedWindowApiMethodRecord | undefined {
  return getWindowApiSurface(surfaceName)?.methods.find((entry) => entry.method === method)
}

/** Every surface.method that the main window exposes, in `surface.method` form. */
export function getMainWindowApiMethods(): string[] {
  const out: string[] = []
  for (const surface of WINDOW_API_MANIFEST) {
    for (const method of surface.methods) {
      const windows = method.windows ?? surface.windows
      if (windows.includes('main')) out.push(`${surface.surface}.${method.method}`)
    }
  }
  return out
}
