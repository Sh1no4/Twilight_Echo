import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open, save } from '@tauri-apps/plugin-dialog'
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import type { ThemeLibrarySnapshot, ThemeTone } from '../../../shared/theme.ts'
import { type DspSceneState } from '../../../shared/dspGraph.ts'
import type {
  AudioOutputId,
  AudioProcessingSettings,
  SettingsSnapshot
} from '../types/settings.ts'
import {
  RuntimeCapabilityError,
  isTauriRuntime,
  type RuntimeCapabilityId
} from './runtimeCapabilities'

function capabilityError(
  id: RuntimeCapabilityId,
  message?: string,
  details?: ConstructorParameters<typeof RuntimeCapabilityError>[2]
): RuntimeCapabilityError {
  return new RuntimeCapabilityError(id, message, details)
}

function resolveSystemTone(): ThemeTone {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'pureWhite'
}

/** Open a single file via plugin-dialog; returns the chosen path or null on cancel. */
async function openSingleFile(
  options: { title?: string; filters?: Array<{ name: string; extensions: string[] }> } = {}
): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: options.title,
    filters: options.filters
  })
  return typeof selected === 'string' ? selected : null
}

/** Open a save dialog; returns the chosen path or null on cancel. */
async function openSavePath(
  options: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> } = {}
): Promise<string | null> {
  const selected = await save({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: options.filters
  })
  return typeof selected === 'string' ? selected : null
}

/**
 * Subscribe to a Tauri backend event emitted from a Rust command (e.g.
 * `settings:changed` / `themes:changed`). `listen` is async, so the returned
 * unsubscribe is race-safe: unsubscribing before the listener resolves marks the
 * subscription inactive and tears down the listener the moment it lands.
 */
function subscribeToTauriEvent<TPayload>(
  channel: string,
  callback: (payload: TPayload) => void
): () => void {
  let active = true
  let unlisten: (() => void) | undefined
  void listen<TPayload>(channel, (event) => {
    if (active) callback(event.payload)
  }).then((handle) => {
    unlisten = handle
    if (!active) handle()
  })
  return () => {
    active = false
    unlisten?.()
  }
}

/*
 * Per-kind DSP asset import dialog filters. Kind involves the asset category;
 * the filter set mirrors the Electron `assetDialogOptions` in `engineIpc.ts`.
 */

function dspAssetFilters(kind: string): Array<{ name: string; extensions: string[] }> {
  switch (kind) {
    case 'impulseResponse':
      return [{ name: 'Impulse Response', extensions: ['wav', 'flac', 'aiff', 'aif'] }]
    case 'correctionProfile':
      return [{ name: 'Correction Profile', extensions: ['txt', 'apo'] }]
    case 'vst3Preset':
      return [{ name: 'VST3 Preset', extensions: ['vstpreset'] }]
    case 'vst3State':
      return [{ name: 'VST3 State', extensions: ['vststate', 'bin'] }]
    default:
      return []
  }
}

function capabilityForSurface(surface: string): RuntimeCapabilityId {
  if (surface === 'fs' || surface === 'library') return 'localLibrary'
  if (surface === 'audioEngine') return 'audioEngine'
  if (surface === 'themes') return 'themes'
  if (surface === 'data' || surface === 'app') return 'data'
  if (surface === 'fonts') return 'fonts'
  if (surface === 'plugins') return 'plugins'
  if (surface === 'providers') return 'providers'
  if (surface === 'extensions') return 'extensions'
  return 'settings'
}

function rejectMethod(surface: string, method: string): (...args: unknown[]) => Promise<never> {
  return (..._args: unknown[]) =>
    Promise.reject(
      capabilityError(
        capabilityForSurface(surface),
        `Tauri 尚未接通 ${surface}.${method}()`,
        {
          surface,
          method,
          reasonCode: 'transport-not-migrated',
          recoverable: false
        }
      )
    )
}

function rejectSurface(name: string): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === 'then') return undefined
      if (typeof prop !== 'string') return Reflect.get(_target, prop)
      return rejectMethod(name, prop)
    }
  })
}

function wrapSurface(name: string, surface: unknown): unknown {
  if (typeof surface !== 'object' || surface === null) return surface
  const target = surface as Record<string, unknown>
  return new Proxy(target, {
    get(_target, prop) {
      if (prop === 'then') return undefined
      if (typeof prop !== 'string') return Reflect.get(target, prop)
      const value = target[prop]
      if (value !== undefined) return value
      return rejectMethod(name, prop)
    }
  })
}

function createBridgeApi(api: Record<string, unknown>): typeof window.api {
  return new Proxy(api, {
    get(target, prop) {
      if (prop === 'then') return undefined
      if (typeof prop !== 'string') return Reflect.get(target, prop)
      const value = target[prop]
      if (value !== undefined) return wrapSurface(prop, value)
      return rejectSurface(prop)
    }
  }) as unknown as typeof window.api
}

export function installTauriHostBridge(): void {
  if (!isTauriRuntime()) return

  const existing = window.api
  const currentWindow = getCurrentWindow()

  window.api = createBridgeApi({
    ...existing,
    window: {
      minimize: () => void currentWindow.minimize(),
      toggleMaximize: () => {
        void currentWindow
          .isMaximized()
          .then((maximized) => (maximized ? currentWindow.unmaximize() : currentWindow.maximize()))
      },
      close: () => void currentWindow.close()
    },
    dialog: {
      openFolder: async () => {
        const selected = await open({ directory: true, multiple: false })
        return typeof selected === 'string' ? selected : null
      }
    },
    shell: {
      showItemInFolder: async (filePath) => revealItemInDir(filePath),
      openPath: async (path) => {
        await openPath(path)
        return ''
      },
      openExternal: async (url) => openUrl(url)
    },
    fs: {
      scanMusicFiles: (folderPath: string) => invoke('fs_scan_music_files', { folderPath }),
      readAudioFile: async (filePath: string) => {
        const result = await invoke<{ buffer: string; mimeType: string }>('fs_read_audio_file', {
          filePath
        })
        const bytes = Uint8Array.from(atob(result.buffer), (char) => char.charCodeAt(0))
        return { buffer: bytes.buffer, mimeType: result.mimeType }
      },
      getAudioFileUrl: async (filePath: string) => convertFileSrc(filePath),
      isAudioFileAuthorized: (filePath: string) =>
        invoke<boolean>('fs_is_audio_file_authorized', { filePath }),
      onScanProgress: rejectMethod('fs', 'onScanProgress')
    },
    app: {
      ...existing?.app,
      relaunch: async () => invoke('relaunch'),
      onNavigate: rejectMethod('app', 'onNavigate'),
      consumePendingNavigation: rejectMethod('app', 'consumePendingNavigation'),
      onSavePlaybackSession: rejectMethod('app', 'onSavePlaybackSession')
    },
    library: {
      scanStartup: () => invoke('library_scan_startup'),
      scanFull: () => invoke('library_scan_full'),
      getScanStatus: () => invoke('library_get_scan_status'),
      pauseScan: () => invoke<boolean>('library_pause_scan'),
      resumeScan: () => invoke<boolean>('library_resume_scan'),
      cancelScan: () => invoke<boolean>('library_cancel_scan'),
      removeTracks: (request: unknown) => invoke('library_remove_tracks', { request }),
      restoreExclusions: (request: unknown) => invoke('library_restore_exclusions', { request }),
      reset: () => invoke('library_reset'),
      onChanged: (cb: (change: unknown) => void) =>
        subscribeToTauriEvent<unknown>('library:changed', cb),
      onCoversMissing: (cb: (info: { dirtyCount: number }) => void) =>
        subscribeToTauriEvent<{ dirtyCount: number }>('library:covers-missing', cb),
      onScanProgress: (cb: (progress: unknown) => void) =>
        subscribeToTauriEvent<unknown>('library:scan-progress', cb),
      onScanStatus: (cb: (status: unknown) => void) =>
        subscribeToTauriEvent<unknown>('library:scan-status', cb)
    },
    plugins: {
      list: () => invoke('plugins_list'),
      enable: (id: string) => invoke('plugins_enable', { id }),
      disable: (id: string) => invoke('plugins_disable', { id }),
      uninstall: (id: string, options?: { removeData?: boolean }) =>
        invoke('plugins_uninstall', { id, removeData: options?.removeData }),
      openLog: (id: string) => invoke('plugins_open_log', { id }),
      getLog: (id: string) => invoke('plugins_get_log', { id }),
      installFromPath: (path: string) => invoke('plugins_install_from_path', { sourcePath: path }),
      chooseAndInstall: () => invoke('plugins_choose_and_install'),
      listIndex: () => invoke('plugins_list_index'),
      refreshIndex: () => invoke('plugins_refresh_index'),
      getIndexStatus: () => invoke('plugins_get_index_status'),
      installFromIndex: (id: string) => invoke('plugins_install_from_index', { id }),
      setNativeDspParameters: (id: string, parameters: Record<string, number>) =>
        invoke('plugins_set_native_dsp_parameters', { id, parameters }),
      onChanged: rejectMethod('plugins', 'onChanged')
    },
    fonts: {
      listInstalled: () => invoke<string[]>('fonts_list_installed')
    },
    settings: {
      get: () => invoke('settings_get'),
      update: (patch) => invoke('settings_update', { patch }),
      getCacheSize: () => invoke<number>('settings_get_cache_size'),
      clearCache: () => invoke<number>('settings_clear_cache'),
      getShortcutStatuses: () => invoke('settings_get_shortcut_statuses'),
      onChanged: (cb: (snapshot: SettingsSnapshot) => void) =>
        subscribeToTauriEvent<SettingsSnapshot>('settings:changed', cb),
      chooseCacheFolder: rejectMethod('settings', 'chooseCacheFolder'),
      chooseBackgroundImage: rejectMethod('settings', 'chooseBackgroundImage'),
      importBackgroundImage: rejectMethod('settings', 'importBackgroundImage'),
      exportBackup: rejectMethod('settings', 'exportBackup'),
      importBackup: rejectMethod('settings', 'importBackup'),
      onPlayerShortcut: rejectMethod('settings', 'onPlayerShortcut')
    },
    themes: {
      getSystemTone: async (): Promise<ThemeTone> => resolveSystemTone(),
      getBootstrap: () => invoke('themes_get_bootstrap'),
      list: () => invoke('themes_list'),
      save: (profile, expectedRevision) => invoke('themes_save', { profile, expectedRevision }),
      delete: (profileId, expectedRevision) =>
        invoke('themes_delete', { profileId, expectedRevision }),
      setActive: (selection, expectedRevision) =>
        invoke('themes_set_active', { selection, expectedRevision }),
      setWindowInheritance: (inheritance, expectedRevision) =>
        invoke('themes_set_window_inheritance', { inheritance, expectedRevision }),
      onChanged: (cb: (snapshot: ThemeLibrarySnapshot) => void) =>
        subscribeToTauriEvent<ThemeLibrarySnapshot>('themes:changed', cb),
      onSystemToneChanged: (cb: (tone: ThemeTone) => void) => {
        const media = window.matchMedia?.('(prefers-color-scheme: dark)')
        const handler = () => cb(media?.matches ? 'dark' : 'pureWhite')
        media?.addEventListener('change', handler)
        return () => media?.removeEventListener('change', handler)
      },
      importTheme: rejectMethod('themes', 'importTheme'),
      exportTheme: rejectMethod('themes', 'exportTheme'),
      importAsset: rejectMethod('themes', 'importAsset'),
      validateAssets: rejectMethod('themes', 'validateAssets'),
      copyAssets: rejectMethod('themes', 'copyAssets')
    },
    ncmCloud: {
      chooseUploadFiles: rejectMethod('ncmCloud', 'chooseUploadFiles'),
      upload: rejectMethod('ncmCloud', 'upload'),
      download: rejectMethod('ncmCloud', 'download'),
      cancel: rejectMethod('ncmCloud', 'cancel'),
      onProgress: rejectMethod('ncmCloud', 'onProgress')
    },
    miniPlayer: {
      open: rejectMethod('miniPlayer', 'open'),
      getBootstrap: rejectMethod('miniPlayer', 'getBootstrap'),
      command: rejectMethod('miniPlayer', 'command'),
      updateSettings: rejectMethod('miniPlayer', 'updateSettings'),
      chooseBackgroundImage: rejectMethod('miniPlayer', 'chooseBackgroundImage'),
      minimize: rejectMethod('miniPlayer', 'minimize'),
      returnToMain: rejectMethod('miniPlayer', 'returnToMain'),
      publishState: rejectMethod('miniPlayer', 'publishState'),
      onState: rejectMethod('miniPlayer', 'onState'),
      onSettings: rejectMethod('miniPlayer', 'onSettings'),
      onMotionPreference: rejectMethod('miniPlayer', 'onMotionPreference'),
      onCommand: rejectMethod('miniPlayer', 'onCommand')
    },
    providers: {
      list: () => invoke('providers_list'),
      call: (
        providerId: string,
        method: string,
        args: unknown[] = [],
        options?: { idempotencyKey?: string; requestId?: string }
      ) => invoke('providers_call', { providerId, method, args, options }),
      cancel: (requestId: string) => invoke('providers_cancel', { requestId })
    },
    extensions: {
      list: () => invoke('extensions_list'),
      executeCommand: (command: string, args?: unknown[]) =>
        invoke('extensions_execute_command', { command, args }),
      readThemeStylesheet: (stylesheetPath: string) =>
        invoke('extensions_read_theme_stylesheet', { stylesheetPath })
    },
    data: {
      ...existing?.data,
      loadMusicLibrary: () => invoke('data_load_music_library'),
      saveMusicLibrary: (data) => invoke('data_save_music_library', { data }),
      getCover: (handle: string) => invoke<string | null>('data_get_cover', { handle }),
      grantRemoteCover: rejectMethod('data', 'grantRemoteCover'),
      loadPlaybackSession: () => invoke('data_load_playback_session'),
      savePlaybackSession: (session, expectedRevision) =>
        invoke('data_save_playback_session', { session, expectedRevision }),
      clearPlaybackSession: (expectedRevision) =>
        invoke('data_clear_playback_session', { expectedRevision }),
      loadPlaylists: () => invoke('data_load_playlists'),
      savePlaylists: (playlists, expectedRevision) =>
        invoke('data_save_playlists', { playlists, expectedRevision }),
      loadLyricsManagement: () => invoke('data_load_lyrics_management'),
      saveLyricsManagement: (document, expectedRevision) =>
        invoke('data_save_lyrics_management', { document, expectedRevision }),
      loadPlaybackBookmarks: () => invoke('data_load_playback_bookmarks'),
      savePlaybackBookmarks: (document, expectedRevision) =>
        invoke('data_save_playback_bookmarks', { document, expectedRevision })
    },
    audioEngine: {
      // ── Stage 6A: basic playback / output / DSP scene wired through the Node audio sidecar ──
      loadQueue: (items: unknown[], startIndex?: number) =>
        invoke('audio_engine_load_queue', { items, startIndex }),
      play: (filePath: string, startTime?: number) =>
        invoke('audio_engine_play', { source: filePath, startTime }),
      isHtmlAudioFallbackAllowed: () =>
        invoke<boolean>('audio_engine_is_html_audio_fallback_allowed'),
      togglePause: () => invoke('audio_engine_toggle_pause'),
      seek: (time: number) => invoke('audio_engine_seek', { time }),
      setVolume: (volume: number) => invoke('audio_engine_set_volume', { volume }),
      setPlaybackRate: (rate: number) => invoke('audio_engine_set_playback_rate', { rate }),
      setLoopRange: (startSeconds: number, endSeconds: number) =>
        invoke<boolean>('audio_engine_set_loop_range', { startSeconds, endSeconds }),
      stop: () => invoke('audio_engine_stop'),
      next: () => invoke('audio_engine_next'),
      previous: () => invoke('audio_engine_previous'),
      setPlayMode: (mode: string) => invoke('audio_engine_set_play_mode', { mode }),
      getUpcomingTrack: () => invoke('audio_engine_get_upcoming_track'),
      setExclusiveMode: (enabled: boolean) =>
        invoke('audio_engine_set_exclusive_mode', { enabled }),
      getExclusiveMode: () => invoke<boolean>('audio_engine_get_exclusive_mode'),
      setAudioOutput: (output: AudioOutputId, device?: string) =>
        invoke('audio_engine_set_audio_output', { output, device }),
      setAudioDevice: (device: string) => invoke('audio_engine_set_audio_device', { device }),
      setOutputConfig: (config: Record<string, unknown>) =>
        invoke('audio_engine_set_output_config', { config }),
      getOutputConfigApplyStatus: () => invoke('audio_engine_get_output_config_apply_status'),
      getAudioOutput: () => invoke('audio_engine_get_audio_output'),
      getAudioOutputOptions: () => invoke('audio_engine_get_audio_output_options'),
      getAudioOutputState: () => invoke('audio_engine_get_audio_output_state'),
      setAudioProcessing: (settings: AudioProcessingSettings) =>
        invoke('audio_engine_set_audio_processing', { settings }),
      getAudioProcessing: () => invoke('audio_engine_get_audio_processing'),
      getDspSceneState: () => invoke('audio_engine_get_dsp_scene_state'),
      setDspScenes: (scenes: DspSceneState['scenes'], pinnedSceneId: string | null) =>
        invoke('audio_engine_set_dsp_scenes', { scenes, pinnedSceneId }),
      setOutputStage: (partial: Record<string, unknown>) =>
        invoke('audio_engine_set_output_stage', { partial }),
      setStereoImage: (partial: Record<string, unknown>) =>
        invoke('audio_engine_set_stereo_image', { partial }),
      applyDspScene: (sceneId: string | null, confirmDsdPcmFallback = false) =>
        invoke('audio_engine_apply_dsp_scene', { sceneId, confirmDsdPcmFallback }),
      getDspGraphStatus: () => invoke('audio_engine_get_dsp_graph_status'),
      setEqBands: (settings: Record<string, unknown>) =>
        invoke('audio_engine_set_eq_bands', { settings }),
      setEqPreset: (preset: Record<string, unknown>) =>
        invoke('audio_engine_set_eq_preset', { preset }),
      setCrossfeedStrength: (strength: number) =>
        invoke('audio_engine_set_crossfeed_strength', { strength }),
      setReplayGainMode: (mode: string, preamp?: number, fallback?: number, clip?: boolean) =>
        invoke('audio_engine_set_replay_gain_mode', { mode, preamp, fallback, clip }),
      loadImpulseResponse: (path: string) =>
        invoke('audio_engine_load_impulse_response', { path }),
      unloadImpulseResponse: () => invoke('audio_engine_unload_impulse_response'),
      getConvolverInfo: () => invoke('audio_engine_get_convolver_info'),
      getMetadata: (source: string) => invoke('audio_engine_get_metadata', { source }),
      getPlaybackInfo: () => invoke('audio_engine_get_playback_info'),
      getSpectrumData: (points?: number) => invoke('audio_engine_get_spectrum_data', { points }),
      getVisualizationData: (options?: Record<string, unknown>) =>
        invoke('audio_engine_get_visualization_data', { options }),

      // ── Events forwarded by the Rust audio runtime from the Node sidecar ──
      onPropertyChange: (cb: (event: { name: string; data: unknown }) => void) =>
        subscribeToTauriEvent<{ name: string; data: unknown }>('audioEngine:property-change', (event) =>
          cb(event)
        ),
      onEndFile: (cb: (event: { reason: string }) => void) =>
        subscribeToTauriEvent<{ reason: string }>('audioEngine:end-file', (event) => cb(event)),
      onStartFile: (cb: () => void) =>
        subscribeToTauriEvent<null>('audioEngine:start-file', () => cb()),
      onReady: (cb: () => void) => subscribeToTauriEvent<null>('audioEngine:ready', () => cb()),
      onError: (cb: (message: string) => void) =>
        subscribeToTauriEvent<string>('audioEngine:error', (message) => cb(message)),
      onPlaybackInfo: (cb: (info: Record<string, unknown>) => void) =>
        subscribeToTauriEvent<Record<string, unknown>>('audioEngine:playback-info', (info) =>
          cb(info)
        ),
      onLoudnormStatus: (cb: (event: { status: string; source: string | null }) => void) =>
        subscribeToTauriEvent<{ status: string; source: string | null }>(
          'audioEngine:loudnorm-status',
          (event) => cb(event)
        ),
      onConfigApplied: (cb: (event: Record<string, unknown>) => void) =>
        subscribeToTauriEvent<Record<string, unknown>>('audioEngine:config-applied', (event) =>
          cb(event)
        ),
      onDeviceOptionsChanged: (cb: (event: { reason: string }) => void) =>
        subscribeToTauriEvent<{ reason: string }>('audioEngine:device-options-changed', (event) =>
          cb(event)
        ),
      onServiceCrash: (cb: (event: { reason: string }) => void) =>
        subscribeToTauriEvent<{ reason: string }>('audioEngine:service-crash', (event) =>
          cb(event)
        ),
      onServiceReady: (cb: (event: Record<string, unknown>) => void) =>
        subscribeToTauriEvent<Record<string, unknown>>('audioEngine:service-ready', (event) =>
          cb(event)
        ),

      onDisconnected: (cb: () => void) =>
        subscribeToTauriEvent<{ reason: string }>('audioEngine:disconnected', () => cb()),

      // ── Stage 6B: VST3 catalog / DSP assets / analysis / diagnostics ──
      getVst3Catalog: () => invoke('audio_engine_get_vst3_catalog'),
      setVst3Enabled: (enabled: boolean) =>
        invoke('audio_engine_set_vst3_enabled', { enabled }),
      selectVst3SearchPath: async () => {
        const selected = await open({
          title: '选择 VST3 搜索目录',
          directory: true,
          multiple: false
        })
        return typeof selected === 'string' ? selected : null
      },
      setVst3SearchPaths: (searchPaths: string[]) =>
        invoke('audio_engine_set_vst3_search_paths', { paths: searchPaths }),
      scanVst3Plugins: () => invoke('audio_engine_scan_vst3_plugins'),
      clearVst3Quarantine: (id: string) =>
        invoke('audio_engine_clear_vst3_quarantine', { id }),
      selectImpulseResponse: () =>
        open({
          title: '选择卷积脉冲响应',
          directory: false,
          multiple: false,
          filters: dspAssetFilters('impulseResponse')
        }).then((selected) => (typeof selected === 'string' ? selected : null)),
      getDspAssets: () => invoke('audio_engine_get_dsp_assets'),
      importDspAsset: async (kind: string) => {
        const filters = dspAssetFilters(kind)
        const sourcePath = await openSingleFile({ title: '导入 DSP 资产', filters })
        if (!sourcePath) return null
        return invoke('audio_engine_import_dsp_asset', { kind, sourcePath })
      },
      importDspCorrectionProfile: async () => {
        const sourcePath = await openSingleFile({
          title: '导入 DSP 校正资料',
          filters: [{ name: 'Correction Profile', extensions: ['txt', 'apo'] }]
        })
        if (!sourcePath) return null
        return invoke('audio_engine_import_dsp_correction_profile', { sourcePath })
      },
      importFrequencyResponse: async () => {
        const sourcePath = await openSingleFile({
          title: '导入 AutoEq 耳机频响 CSV',
          filters: [{ name: 'AutoEq CSV', extensions: ['csv'] }]
        })
        if (!sourcePath) return null
        return invoke('audio_engine_import_frequency_response', { sourcePath })
      },
      getDspCorrectionProfile: (assetId: string) =>
        invoke('audio_engine_get_dsp_correction_profile', { assetId }),
      deleteDspAsset: (assetId: string) =>
        invoke('audio_engine_delete_dsp_asset', { assetId }),
      exportDspProfile: async (name?: string) => {
        const outputPath = await openSavePath({
          title: '导出 DSP 配置包',
          defaultPath: 'DSP Profile.tedsp',
          filters: [{ name: 'Twilight Echo DSP Profile', extensions: ['tedsp'] }]
        })
        if (!outputPath) return null
        return invoke('audio_engine_export_dsp_profile', { name, outputPath })
      },
      importDspProfile: async () => {
        const filePath = await openSingleFile({
          title: '导入 DSP 配置包',
          filters: [{ name: 'Twilight Echo DSP Profile', extensions: ['tedsp'] }]
        })
        if (!filePath) return null
        return invoke('audio_engine_import_dsp_profile', { filePath })
      },
      exportDiagnostics: async () => {
        const filePath = await openSavePath({
          title: '导出音频诊断日志',
          defaultPath: `TwilightEcho-audio-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
          filters: [{ name: 'Twilight Echo Audio Diagnostics', extensions: ['json'] }]
        })
        if (!filePath) return { filePath: null }
        return invoke('audio_engine_export_diagnostics', { filePath })
      }
    },
    bpmAnalysis: {
      request: (request: unknown) => invoke('audio_engine_bpm_request', { request }),
      getCacheSize: () => invoke('audio_engine_bpm_get_cache_size'),
      clearCache: () => invoke('audio_engine_bpm_clear_cache'),
      cancel: (filePath?: string) => invoke('audio_engine_bpm_cancel', { filePath }),
      onCompleted: (cb: (event: { trackId: string; filePath: string; analysis: unknown }) => void) =>
        subscribeToTauriEvent<{ trackId: string; filePath: string; analysis: unknown }>(
          'bpmAnalysis:completed',
          (event) => cb(event)
        )
    },
    loudnessAnalysis: {
      request: (request: unknown) => invoke('audio_engine_loudness_request', { request }),
      getCacheSize: () => invoke('audio_engine_loudness_get_cache_size'),
      clearCache: () => invoke('audio_engine_loudness_clear_cache'),
      getStatus: () => invoke('audio_engine_loudness_get_status'),
      cancel: (filePath?: string) => invoke('audio_engine_loudness_cancel', { filePath }),
      onCompleted: (cb: (event: { trackId: string; filePath: string; analysis: unknown }) => void) =>
        subscribeToTauriEvent<{ trackId: string; filePath: string; analysis: unknown }>(
          'loudnessAnalysis:completed',
          (event) => cb(event)
        )
    }
  })
}
