import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  TWILIGHT_DEFAULT_THEME,
  createDefaultThemeLibraryDocument,
  type ThemeLibrarySnapshot,
  type ThemeTone
} from '../../../shared/theme.ts'
import type {
  LocalLibraryScanStatus,
  LocalLibraryScanUpdate
} from '../../../shared/localLibraryScan'
import {
  DEFAULT_DSP_OUTPUT_STAGE,
  DSP_GRAPH_VERSION,
  type DspGraphStatus,
  type DspSceneState,
  type Vst3CatalogState
} from '../../../shared/dspGraph.ts'
import { DEFAULT_DSD_ROUTE } from '../../../shared/audioProcessingOptions.ts'
import type {
  AudioDeviceOption,
  AudioOutputId,
  AudioOutputOption,
  AudioProcessingSettings
} from '../types/settings.ts'
import {
  RuntimeCapabilityError,
  isTauriRuntime,
  type RuntimeCapabilityId
} from './runtimeCapabilities'

function capabilityError(id: RuntimeCapabilityId, message?: string): RuntimeCapabilityError {
  return new RuntimeCapabilityError(id, message)
}

const idleScanStatus: LocalLibraryScanStatus = {
  jobId: null,
  mode: null,
  state: 'idle',
  current: 0,
  total: 0,
  parsedFileCount: 0,
  skippedUnchanged: 0,
  error: ''
}

const noopScanUpdate: LocalLibraryScanUpdate = {
  jobId: '',
  mode: 'startup',
  state: 'completed',
  libraryRevision: 0,
  exclusions: [],
  addedTracks: [],
  updatedTracks: [],
  removedFilePaths: [],
  parsedFileCount: 0,
  skippedUnchanged: 0
}

const epochIso = new Date(0).toISOString()

function emptyThemeLibrarySnapshot(): ThemeLibrarySnapshot {
  return {
    version: 2,
    revision: 0,
    savedAt: epochIso,
    data: createDefaultThemeLibraryDocument()
  }
}

function resolveSystemTone(): ThemeTone {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'pureWhite'
}

/*
 * Default shapes for the unmigrated audioEngine surface. The real engine runs
 * in the main process; until its IPC surface is migrated to Tauri these keep
 * the renderer's startup refresh and polling loops crash-free. Constants that
 * live in main-process modules (audioEngineHelpers.ts) are duplicated inline
 * here because the renderer must not import from src/main/**.
 */

const DEFAULT_EQ_BANDS = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000
].map((frequency) => ({
  frequency,
  gain: 0,
  q: 1,
  filterType: 'peak' as const
}))

const DEFAULT_AUDIO_PROCESSING: AudioProcessingSettings = {
  dspEnabled: false,
  directMode: false,
  clipGuard: true,
  fftEnabled: true,
  fftResolution: 8192,
  highResolution: true,
  dsdToPcm: false,
  dsdOutputMode: 'auto',
  dsdRoute: DEFAULT_DSD_ROUTE,
  sacdProgramMode: 'auto',
  eqEnabled: false,
  eqMode: 'graphic',
  eqPreamp: 0,
  eqBands: DEFAULT_EQ_BANDS,
  volumeNormalization: 'off',
  replayGainPreamp: 0,
  replayGainFallback: 0,
  replayGainClip: true,
  convolverEnabled: false,
  convolverIrPath: '',
  crossfeedEnabled: false,
  crossfeedStrength: 0,
  crossfeedDelayMs: 0.35,
  crossfeedCutoffHz: 700,
  gapless: true,
  crossfadeSeconds: 0
}

const AUDIO_OUTPUT_OPTIONS: AudioOutputOption[] = [
  {
    id: 'wasapi',
    label: '系统音频输出',
    description: '系统原生输出。关闭独占时使用共享模式，开启独占时直接访问设备。',
    platform: 'win32',
    supportsExclusive: true
  },
  {
    id: 'asio',
    label: '专业声卡输出',
    description: 'Windows x64 专业声卡驱动输出；自动枚举已安装的 ASIO 驱动。',
    platform: 'win32',
    supportsExclusive: true
  },
  {
    id: 'coreaudio',
    label: '苹果系统音频',
    description: '苹果系统原生音频输出后端。开启独占模式时使用 Hog Mode 绕过系统混音器。',
    platform: 'darwin',
    supportsExclusive: true
  },
  {
    id: 'alsa',
    label: '系统音频输出',
    description: '系统原生音频输出后端。',
    platform: 'linux',
    supportsExclusive: false
  }
]

const DEFAULT_AUDIO_DEVICE_OPTION: AudioDeviceOption = {
  id: 'auto',
  label: '系统默认',
  isDefault: true,
  supportsExclusive: false,
  supportsHogMode: false,
  supportsDirectHw: false,
  supportsDop: false,
  supportsNativeDsd: false,
  dopSupportState: 'runtime-probed',
  nativeDsdSupportState: 'unsupported',
  supportedDsdRates: [],
  nativeDsdSampleRates: [],
  nativeDsdSampleFormats: [],
  dopCarrierSampleRates: [],
  dopCarrierFormats: [],
  pathKind: 'default',
  capabilityReason: ''
}

function defaultAudioOutputState(
  output: AudioOutputId = 'wasapi',
  device = 'auto',
  exclusiveMode = false
): {
  output: AudioOutputId
  device: string
  exclusiveMode: boolean
  exclusiveAvailable: boolean
  outputOptions: AudioOutputOption[]
  deviceOptions: AudioDeviceOption[]
} {
  return {
    output,
    device,
    exclusiveMode,
    exclusiveAvailable: output === 'wasapi' || output === 'asio' || output === 'coreaudio',
    outputOptions: AUDIO_OUTPUT_OPTIONS,
    deviceOptions: [DEFAULT_AUDIO_DEVICE_OPTION]
  }
}

function createDefaultDspSceneState(
  scenes: DspSceneState['scenes'] = [],
  activeSceneId: string | null = null
): DspSceneState {
  return {
    scenes,
    pinnedSceneId: activeSceneId,
    activeSceneId,
    graph: { version: DSP_GRAPH_VERSION, nodes: [], outputStage: DEFAULT_DSP_OUTPUT_STAGE },
    requiresPcmFallback: false,
    dsdPcmFallbackApplied: false
  }
}

function createDefaultDspGraphStatus(): DspGraphStatus {
  return {
    revision: 0,
    activeSceneId: null,
    totalLatencyFrames: 0,
    totalTailFrames: 0,
    nodes: [],
    compileState: 'bypassed',
    applyState: 'idle'
  }
}

function createDefaultPlaybackInfo(): Record<string, unknown> {
  const outputInfo = {
    exclusive: false,
    supportsOutputPerfect: false,
    sourceExact: false,
    outputPerfect: false,
    pcmPassthrough: false,
    resampled: false,
    accessMode: 'shared',
    devicePathKind: 'default',
    perfectReasonCode: 'shared_mixer',
    capabilityReason: '共享输出经过系统混音',
    perfectReason: '共享输出经过系统混音',
    outputSampleRate: 0,
    outputBitDepth: 0,
    backend: 'wasapi',
    actualBackend: 'wasapi',
    deviceName: 'auto',
    actualDeviceName: 'auto',
    driverName: '',
    actualDriverName: '',
    driverVersion: 0,
    actualDriverVersion: 0,
    actualOutputFormat: '',
    actualSampleRate: 0,
    actualBitDepth: 0,
    actualChannels: 0,
    driverDopCapable: false,
    driverNativeDsdCapable: false,
    driverDopCarrierSampleRates: [],
    driverDopCarrierFormats: [],
    driverNativeDsdSampleRates: [],
    nativeDsdRuntimeState: 'unsupported',
    nativeDsdRequestedRate: 0,
    nativeDsdActualRate: 0,
    nativeDsdChannels: 0,
    nativeDsdExplicitlyCapable: false,
    bufferSizeFrames: 0,
    latencyFrames: 0,
    latencyMs: 0,
    latencyInfo: { bufferLatencyMs: 0, outputLatencyMs: 0, totalLatencyMs: 0 },
    channelRoutingMode: 'auto',
    diagnostics: {
      sessionUnderrunCount: 0,
      sessionBufferDropCount: 0,
      sessionRecoveryCount: 0,
      lifetimeUnderrunCount: 0,
      lifetimeBufferDropCount: 0,
      lifetimeRecoveryCount: 0,
      driverRestartCount: 0,
      deviceLostCount: 0,
      driverXrunCount: 0,
      lastError: ''
    },
    deviceRecovered: false,
    recoveryCount: 0
  }
  return {
    state: 'stopped',
    nativePlaybackActive: false,
    position: 0,
    duration: 0,
    volume: 1,
    playbackRate: 1,
    requestedConfigRevision: 0,
    appliedConfigRevision: 0,
    queueIndex: -1,
    playMode: 'off',
    source: '',
    codec: '',
    bitrate: 0,
    sourceSampleRate: 0,
    sourceBitDepth: 0,
    decodedSampleRate: 0,
    decodedBitDepth: 0,
    decodedChannels: 0,
    decodedSampleFormat: '',
    outputBackend: 'wasapi',
    outputDevice: 'auto',
    outputInfo,
    ...outputInfo,
    channelCount: 0,
    outputPerfect: false,
    pcmPassthrough: false,
    dspActive: false,
    replayGainActive: false,
    eqActive: false,
    convolverActive: false,
    crossfeedActive: false,
    crossfadeActive: false,
    fftActive: false,
    irResampled: false,
    replayGainDb: 0,
    crossfeedStrength: 0,
    crossfadeSeconds: 0,
    convolverLatencyFrames: 0,
    partitionSize: 0,
    channelMappingMode: 'auto',
    perfectReason: '共享输出经过系统混音',
    perfectReasonCode: 'shared_mixer',
    isDsd: false,
    dsdMode: 'pcm',
    dsdRate: 0
  }
}

function createDefaultVisualizationData(): Record<string, unknown> {
  return {
    spectrum: [],
    visualizerBars: [],
    waveform: [],
    oscilloscope: [],
    peakDb: -120,
    rmsDb: -120,
    lufsMomentary: null,
    spectrogram: [],
    sampleRate: 0,
    maxFrequency: 20000,
    active: false,
    tapStatus: 'stopped',
    reason: 'audio-engine-unavailable'
  }
}

function createDefaultVst3Catalog(): Vst3CatalogState {
  return {
    enabled: false,
    searchPaths: [],
    entries: [],
    helpers: { platformSupported: false, scannerPresent: false, hostPresent: false }
  }
}

/*
 * Every Electron IPC surface has not been migrated to Tauri yet. Accessing an
 * unmigrated surface (`window.api.audioEngine.play()`) or method would throw a
 * TypeError and crash a page. These proxies return a heuristic stub instead so
 * the app keeps mounting. Each unimplemented surface.method warns at most once:
 * polled methods (e.g. library.getWatcherStatus every 5s while SettingsPage is
 * open) must not flood the console, but the first call still records every
 * surface the renderer actually touches for the migration.
 */
const warnedStubMethods = new Set<string>()

function makeStubMethod(surface: string, method: string): (...args: unknown[]) => unknown {
  return (..._args: unknown[]): unknown => {
    const key = `${surface}.${method}`
    if (!warnedStubMethods.has(key)) {
      warnedStubMethods.add(key)
      console.warn(`[tauri-bridge] ${surface}.${method}() not implemented yet`)
    }
    const m = method.toLowerCase()
    if (m.startsWith('on')) return () => {}
    if (m.startsWith('list') || m.startsWith('search')) return Promise.resolve([])
    if (m.startsWith('get') || m.startsWith('load') || m.startsWith('fetch')) return Promise.resolve(null)
    if (m.startsWith('is') || m === 'toggle') return Promise.resolve(false)
    if (m === 'cancel' || m === 'clear' || m === 'reset' || m === 'delete') return Promise.resolve(true)
    if (m.startsWith('import') || m.startsWith('choose')) return Promise.resolve(null)
    return Promise.resolve(undefined)
  }
}

function makeStubSurface(name: string): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === 'then') return undefined
      if (typeof prop !== 'string') return Reflect.get(_target, prop)
      return makeStubMethod(name, prop)
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
      return makeStubMethod(name, prop)
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
      return makeStubSurface(prop)
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
        void currentWindow.isMaximized().then((maximized) =>
          maximized ? currentWindow.unmaximize() : currentWindow.maximize()
        )
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
      scanMusicFiles: async () => [],
      readAudioFile: async () => ({ buffer: new ArrayBuffer(0), mimeType: '' }),
      getAudioFileUrl: async () => '',
      isAudioFileAuthorized: async () => false,
      onScanProgress: () => () => {}
    },
    app: {
      ...existing?.app,
      relaunch: async () => invoke('relaunch'),
      onNavigate: () => () => {},
      consumePendingNavigation: async () => null,
      onSavePlaybackSession: () => () => {}
    },
    library: {
      onChanged: () => () => {},
      onCoversMissing: () => () => {},
      onScanProgress: () => () => {},
      onScanStatus: () => () => {},
      getScanStatus: async () => idleScanStatus,
      scanStartup: async () => noopScanUpdate,
      scanFull: async () => noopScanUpdate
    },
    plugins: {
      list: () => Promise.reject(capabilityError('plugins')),
      installFromPath: () => Promise.reject(capabilityError('plugins')),
      chooseAndInstall: () => Promise.reject(capabilityError('plugins')),
      enable: () => Promise.reject(capabilityError('plugins')),
      disable: () => Promise.reject(capabilityError('plugins')),
      uninstall: () => Promise.reject(capabilityError('plugins')),
      openLog: () => Promise.reject(capabilityError('plugins')),
      getLog: () => Promise.reject(capabilityError('plugins')),
      listIndex: () => Promise.reject(capabilityError('plugins')),
      refreshIndex: () => Promise.reject(capabilityError('plugins')),
      getIndexStatus: () => Promise.reject(capabilityError('plugins')),
      installFromIndex: () => Promise.reject(capabilityError('plugins')),
      setNativeDspParameters: () => Promise.reject(capabilityError('plugins')),
      onChanged: () => () => {}
    },
    fonts: {
      listInstalled: () => Promise.reject(capabilityError('fonts'))
    },
    settings: {
      get: () => invoke('settings_get'),
      update: (patch) => invoke('settings_update', { patch }),
      onChanged: () => () => {},
      chooseCacheFolder: async () => null,
      chooseBackgroundImage: async () => null,
      importBackgroundImage: async () => null,
      exportBackup: async () => '{}',
      importBackup: () => invoke('settings_get'),
      getCacheSize: async () => 0,
      clearCache: async () => 0,
      getShortcutStatuses: async () => [],
      onPlayerShortcut: () => () => {}
    },
    themes: {
      getSystemTone: async (): Promise<ThemeTone> => resolveSystemTone(),
      getBootstrap: async () => ({
        library: emptyThemeLibrarySnapshot(),
        defaultTheme: TWILIGHT_DEFAULT_THEME
      }),
      list: async () => emptyThemeLibrarySnapshot(),
      save: async () => emptyThemeLibrarySnapshot(),
      delete: async () => emptyThemeLibrarySnapshot(),
      setActive: async () => emptyThemeLibrarySnapshot(),
      setWindowInheritance: async () => emptyThemeLibrarySnapshot(),
      importTheme: async () => null,
      exportTheme: async () => null,
      importAsset: async () => null,
      validateAssets: async () => true,
      copyAssets: async () => undefined,
      onChanged: () => () => {},
      onSystemToneChanged: () => () => {}
    },
    ncmCloud: {
      chooseUploadFiles: async () => [],
      upload: async () => ({ transferId: '', handle: '', fileName: '', accepted: true }),
      download: async () => ({ transferId: '', fileName: '', accepted: false, cancelled: false }),
      cancel: async () => true,
      onProgress: () => () => {}
    },
    miniPlayer: {
      open: async () => null,
      getBootstrap: async () => null,
      command: () => {},
      updateSettings: async (patch) => patch,
      chooseBackgroundImage: async () => null,
      minimize: () => {},
      returnToMain: () => {},
      publishState: () => {},
      onState: () => () => {},
      onSettings: () => () => {},
      onMotionPreference: () => () => {},
      onCommand: () => () => {}
    },
    providers: {
      list: () => Promise.reject(capabilityError('providers')),
      call: () =>
        Promise.reject(
          capabilityError('providers', 'Provider 未启用：当前运行时不支持在线音源')
        ),
      cancel: () => {}
    },
    extensions: {
      list: () => Promise.reject(capabilityError('extensions')),
      executeCommand: () => Promise.reject(capabilityError('extensions')),
      readThemeStylesheet: () => Promise.reject(capabilityError('extensions'))
    },
    data: {
      ...existing?.data,
      loadMusicLibrary: () => invoke('data_load_music_library'),
      saveMusicLibrary: (data) => invoke('data_save_music_library', { data }),
      loadPlaybackSession: async () => null,
      savePlaybackSession: async () => undefined,
      clearPlaybackSession: async () => undefined,
      loadPlaylists: async () => null,
      savePlaylists: async () => ({ version: 2, revision: 0, savedAt: new Date().toISOString(), data: [] })
    },
    audioEngine: {
      getAudioOutputState: async () => defaultAudioOutputState(),
      getAudioProcessing: async () => ({
        ...DEFAULT_AUDIO_PROCESSING,
        eqBands: DEFAULT_EQ_BANDS.map((band) => ({ ...band }))
      }),
      getDspSceneState: async () => createDefaultDspSceneState(),
      getDspGraphStatus: async () => createDefaultDspGraphStatus(),
      getPlaybackInfo: async () => createDefaultPlaybackInfo(),
      getVisualizationData: async () => createDefaultVisualizationData(),
      getVst3Catalog: async () => createDefaultVst3Catalog(),
      getDspAssets: async () => [],
      getAudioOutputOptions: async () => AUDIO_OUTPUT_OPTIONS,
      isHtmlAudioFallbackAllowed: async () => false,
      setExclusiveMode: async (next: boolean) => defaultAudioOutputState('wasapi', 'auto', next),
      setAudioOutput: async (output: AudioOutputId, device = 'auto') =>
        defaultAudioOutputState(output, device, false),
      setAudioDevice: async (device: string) => defaultAudioOutputState('wasapi', device, false),
      setAudioProcessing: async (settings: AudioProcessingSettings) => ({
        ...DEFAULT_AUDIO_PROCESSING,
        ...settings,
        eqBands: settings.eqBands ?? DEFAULT_EQ_BANDS
      }),
      setDspScenes: async (scenes: DspSceneState['scenes'], pinnedSceneId: string | null) =>
        createDefaultDspSceneState(scenes, pinnedSceneId),
      applyDspScene: async (sceneId: string) => createDefaultDspSceneState([], sceneId),
      setOutputStage: async () => createDefaultDspSceneState(),
      setStereoImage: async () => createDefaultDspSceneState(),
      setVst3Enabled: async (enabled: boolean) => ({ ...createDefaultVst3Catalog(), enabled }),
      setVst3SearchPaths: async (searchPaths: string[]) => ({
        ...createDefaultVst3Catalog(),
        searchPaths
      }),
      scanVst3Plugins: async () => createDefaultVst3Catalog()
    }
  })
}
