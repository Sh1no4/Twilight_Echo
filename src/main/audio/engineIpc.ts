import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { release } from 'node:os'
import { join } from 'path'
import { runtime } from '../core/runtime'
import { sleepTimerService } from '../sleepTimer.ts'
import { registerNativeSleepTimerBoundaries } from './sleepTimerNativeBoundary.ts'
import { normalizeOutputConfig } from '../core/settings'
import {
  AudioEngineManager,
  normalizeAudioProcessingSettings,
  type AudioProcessingSettings,
  type AudioOutputId,
  type AudioEngineQueueItem,
  type PlayMode,
  type EqMode,
  type EqualizerBand
} from '../audioEngineManager'
import { normalizeDspScenes, type DspAssetKind } from '../../shared/dspGraph.ts'
import { normalizeCueRange } from '../../shared/cue.ts'
import { DspAssetLibrary } from '../dsp/dspAssetLibrary.ts'
import {
  importCorrectionProfileFile,
  parseCorrectionProfileFile
} from '../dsp/correctionProfile.ts'
import {
  collectDspAssetIds,
  createDspProfile,
  exportDspProfileArchive,
  importDspProfileArchive
} from '../dsp/dspProfileArchive.ts'
import { Vst3CatalogService } from '../dsp/vst3Catalog.ts'
import { rendererFallbackAllowed } from './nativeBinding.ts'
import { importFrequencyResponseFromDialog } from './importFrequencyResponse.ts'
import {
  AudioDiagnosticRecorder,
  collectDsdPcmBlockers,
  createPlaybackDiagnosticEvent,
  type AudioDiagnosticSnapshot
} from './audioDiagnostics.ts'
import {
  persistAudioOutputState,
  persistAudioOutputConfig,
  broadcastPlayerLifecycleEvents,
  getEffectiveAudioProcessing,
  persistAndApplyAudioProcessingState,
  persistDspSceneState
} from './state'
import {
  normalizeFiniteNumber,
  normalizeInteger,
  normalizeIpcArray,
  normalizeIpcString,
  normalizeOptionalIpcString
} from '../security/ipcValidation.ts'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'
import { remoteMediaGrants } from '../security/remoteMediaGrants.ts'
import {
  grantUserSelectedImpulseResponse,
  grantUserSelectedVst3SearchPath,
  registerManagedVst3SearchPaths,
  resolveAuthorizedAudioSource,
  resolveAuthorizedImpulseResponseFile,
  resolveAuthorizedVst3SearchPaths
} from '../security/localPaths.ts'

const MAX_AUDIO_QUEUE_ITEMS = 5000
const MAX_AUDIO_SOURCE_LENGTH = 8192
const MAX_AUDIO_DEVICE_LENGTH = 512

let audioDiagnosticRecorder: AudioDiagnosticRecorder | null = null
let lastAudioDiagnosticPlaybackSignature = ''

const DSP_ASSET_KINDS: DspAssetKind[] = [
  'impulseResponse',
  'correctionProfile',
  'vst3Preset',
  'vst3State'
]

export function requireAudioEngine(): AudioEngineManager {
  if (!runtime.audioEngineManager) throw new Error('原生音频引擎尚未初始化')
  return runtime.audioEngineManager
}

function requireDspAssets(): DspAssetLibrary {
  if (!runtime.dspAssetLibrary) throw new Error('DSP 资料库尚未初始化')
  return runtime.dspAssetLibrary
}

function requireVst3Catalog(): Vst3CatalogService {
  if (!runtime.vst3Catalog) throw new Error('VST3 目录尚未初始化')
  return runtime.vst3Catalog
}

export function toQueueItem(raw: unknown): AudioEngineQueueItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const source =
    typeof item.source === 'string'
      ? item.source
      : typeof item.audioSource === 'string'
        ? item.audioSource
        : typeof item.playUrl === 'string'
          ? item.playUrl
          : typeof item.filePath === 'string'
            ? item.filePath
            : typeof item.streamUrl === 'string'
              ? item.streamUrl
              : ''
  if (!source) return null
  let normalizedSource: string
  try {
    normalizedSource = normalizeIpcString(source, 'queue item source', MAX_AUDIO_SOURCE_LENGTH)
  } catch {
    return null
  }
  const cueRange = item.cueRange === undefined ? undefined : normalizeCueRange(item.cueRange)
  if (cueRange === null) return null
  return {
    id: normalizeQueueText(item.id, normalizedSource) ?? normalizedSource,
    source: normalizedSource,
    title: normalizeQueueText(item.title),
    artist: normalizeQueueText(item.artist),
    album: normalizeQueueText(item.album),
    duration: Number.isFinite(item.duration) ? Number(item.duration) : undefined,
    codec:
      typeof item.format === 'string'
        ? item.format
        : typeof item.codec === 'string'
          ? item.codec
          : undefined,
    sampleRate: Number.isFinite(item.sampleRate) ? Number(item.sampleRate) : undefined,
    bitrate: Number.isFinite(item.bitrate) ? Number(item.bitrate) : undefined,
    bitDepth: Number.isFinite(item.bitDepth) ? Number(item.bitDepth) : undefined,
    measuredIntegratedLufs: Number.isFinite(item.measuredIntegratedLufs)
      ? Number(item.measuredIntegratedLufs)
      : undefined,
    measuredTruePeakDb: Number.isFinite(item.measuredTruePeakDb)
      ? Number(item.measuredTruePeakDb)
      : undefined,
    replayGainTrackGainDb: Number.isFinite(item.replayGainTrackGainDb)
      ? Number(item.replayGainTrackGainDb)
      : undefined,
    replayGainAlbumGainDb: Number.isFinite(item.replayGainAlbumGainDb)
      ? Number(item.replayGainAlbumGainDb)
      : undefined,
    replayGainTrackPeak: Number.isFinite(item.replayGainTrackPeak)
      ? Number(item.replayGainTrackPeak)
      : undefined,
    replayGainAlbumPeak: Number.isFinite(item.replayGainAlbumPeak)
      ? Number(item.replayGainAlbumPeak)
      : undefined,
    r128TrackGainDb: Number.isFinite(item.r128TrackGainDb)
      ? Number(item.r128TrackGainDb)
      : undefined,
    r128AlbumGainDb: Number.isFinite(item.r128AlbumGainDb)
      ? Number(item.r128AlbumGainDb)
      : undefined,
    cueRange
  }
}

async function authorizeAudioProcessingSettings(
  settings: Partial<AudioProcessingSettings>
): Promise<AudioProcessingSettings> {
  const normalized = normalizeAudioProcessingSettings(settings)
  if (normalized.convolverIrPath) {
    normalized.convolverIrPath = await resolveAuthorizedImpulseResponseFile(
      normalized.convolverIrPath
    )
  }
  return normalized
}

function normalizeQueueText(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string') return fallback
  const normalized = value
    .replace(/[\0\r\n]/g, ' ')
    .trim()
    .slice(0, 512)
  return normalized || fallback
}

async function resolveAuthorizedPlaybackSource(source: string): Promise<string> {
  if (source.startsWith('twilight-media:')) {
    return remoteMediaGrants.resolve(source, 'audio').source
  }
  return await resolveAuthorizedAudioSource(source)
}

function normalizeDspAssetKind(value: unknown): DspAssetKind {
  if (typeof value === 'string' && DSP_ASSET_KINDS.includes(value as DspAssetKind)) {
    return value as DspAssetKind
  }
  throw new Error('DSP 资料类型无效')
}

function assetDialogOptions(kind: DspAssetKind): Electron.OpenDialogOptions {
  const filters: Record<DspAssetKind, Electron.FileFilter[]> = {
    impulseResponse: [{ name: 'Impulse Response', extensions: ['wav', 'flac', 'aiff', 'aif'] }],
    correctionProfile: [{ name: 'Correction Profile', extensions: ['txt', 'apo'] }],
    vst3Preset: [{ name: 'VST3 Preset', extensions: ['vstpreset'] }],
    vst3State: [{ name: 'VST3 State', extensions: ['vststate', 'bin'] }]
  }
  return {
    title: '导入 DSP 资料',
    properties: ['openFile'],
    filters: [...filters[kind], { name: 'All Files', extensions: ['*'] }]
  }
}

async function reconcileDspAssetReferences(): Promise<void> {
  await runtime.dspAssetLibrary?.reconcileReferences(
    collectDspAssetIds(runtime.appSettings.dspScenes)
  )
}

async function quarantineActiveVst3Nodes(reason: string): Promise<void> {
  const catalog = runtime.vst3Catalog
  if (!catalog) return
  const graph = runtime.audioEngineManager?.getDspSceneState().graph
  for (const node of graph?.nodes ?? []) {
    if (node.type !== 'vst3Plugin' || !node.vst3?.catalogId) continue
    await catalog.quarantine(node.vst3.catalogId, `音频服务崩溃后旁路：${reason}`)
  }
  // Persisted catalog status should be visible immediately. The manager's
  // synchronous recovery gate already prevents a restarted service from
  // launching these modules while this asynchronous work is in flight.
  runtime.audioEngineManager?.refreshDspGraph()
}

function initializeAudioDiagnostics(): AudioDiagnosticRecorder {
  const recorder = new AudioDiagnosticRecorder({
    directory: join(app.getPath('logs'), 'audio'),
    environment: {
      appName: app.getName(),
      appVersion: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      architecture: process.arch,
      osRelease: release(),
      locale: app.getLocale(),
      processVersions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        modules: process.versions.modules
      }
    }
  })
  recorder.record('session-start', {
    selectedOutput: {
      output: runtime.appSettings.audioOutput,
      device: runtime.appSettings.audioDevice,
      exclusiveMode: runtime.appSettings.audioExclusiveMode
    },
    outputConfig: runtime.appSettings.audioOutputConfig,
    configuredProcessing: runtime.appSettings.audioProcessing,
    effectiveProcessing: getEffectiveAudioProcessing(),
    headphoneCompensation: summarizeHeadphoneCompensation()
  })
  return recorder
}

function summarizeHeadphoneCompensation(): Record<string, unknown> {
  const compensation = runtime.appSettings.headphoneCompensation
  return {
    enabled: compensation.enabled,
    productId: compensation.productId,
    productName: compensation.productName,
    vendorName: compensation.vendorName,
    eqId: compensation.eqId,
    preampDb: compensation.preampDb,
    bandCount: compensation.bands.length
  }
}

function recordPlaybackDiagnostic(
  info: Awaited<ReturnType<AudioEngineManager['getPlaybackInfo']>>
): void {
  const engine = runtime.audioEngineManager
  const recorder = audioDiagnosticRecorder
  if (!engine || !recorder) return
  try {
    const details = createPlaybackDiagnosticEvent({
      playback: info,
      processing: getEffectiveAudioProcessing(),
      outputConfig: engine.getOutputConfig(),
      sceneState: engine.getDspSceneState(),
      selectedOutput: {
        output: runtime.appSettings.audioOutput,
        device: runtime.appSettings.audioDevice,
        exclusiveMode: runtime.appSettings.audioExclusiveMode
      }
    })
    const signatureDetails = { ...details, position: 0 }
    const signature = JSON.stringify(signatureDetails)
    if (signature === lastAudioDiagnosticPlaybackSignature) return
    lastAudioDiagnosticPlaybackSignature = signature
    const warning = info.isDsd && info.dsdMode === 'pcm'
    recorder.record('playback-state', details, warning ? 'warning' : 'info')
  } catch (error) {
    recorder.record(
      'diagnostic-collection-failed',
      { phase: 'playback-state', message: error instanceof Error ? error.message : String(error) },
      'error'
    )
  }
}

async function captureAudioDiagnosticSnapshot(): Promise<AudioDiagnosticSnapshot> {
  const engine = requireAudioEngine()
  const configuredProcessing = runtime.appSettings.audioProcessing
  const effectiveProcessing = getEffectiveAudioProcessing()
  const outputConfig = engine.getOutputConfig()
  const dspSceneState = engine.getDspSceneState()
  const playback = await captureDiagnosticValue(() => engine.getPlaybackInfo())
  const outputState = await captureDiagnosticValue(() => engine.getAudioOutputState())
  const dspGraphStatus = await captureDiagnosticValue(() => engine.getDspGraphStatus())
  const diagnosis = isPlaybackInfo(playback)
    ? {
        dsdPcmFallback: playback.isDsd && playback.dsdMode === 'pcm',
        perfectReasonCode: playback.perfectReasonCode,
        perfectReason: playback.perfectReason,
        blockers: collectDsdPcmBlockers({
          playback,
          processing: effectiveProcessing,
          outputConfig,
          sceneState: dspSceneState
        }),
        nativeDsdRuntimeState: playback.outputInfo.nativeDsdRuntimeState,
        nativeDsdRuntimeReason: playback.outputInfo.nativeDsdRuntimeReason
      }
    : { unavailable: true }
  return {
    playback,
    outputState,
    outputConfig,
    outputConfigApplyStatus: engine.getOutputConfigApplyStatus(),
    configuredProcessing,
    effectiveProcessing,
    headphoneCompensation: summarizeHeadphoneCompensation(),
    dspSceneState,
    dspGraphStatus,
    diagnosis
  }
}

async function captureDiagnosticValue<T>(
  read: () => T | Promise<T>
): Promise<T | { error: string }> {
  try {
    return await read()
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function isPlaybackInfo(
  value: unknown
): value is Awaited<ReturnType<AudioEngineManager['getPlaybackInfo']>> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'outputInfo' in value &&
    'volume' in value &&
    'state' in value
  )
}

export async function setupAudioEngineIpc(): Promise<void> {
  let initialAudioProcessing = getEffectiveAudioProcessing()
  try {
    initialAudioProcessing = await authorizeAudioProcessingSettings(initialAudioProcessing)
  } catch (error) {
    console.warn('Configured impulse response is unavailable or unauthorized:', error)
    initialAudioProcessing = normalizeAudioProcessingSettings({
      ...initialAudioProcessing,
      convolverEnabled: false,
      convolverIrPath: ''
    })
  }
  runtime.dspAssetLibrary = new DspAssetLibrary(join(app.getPath('userData'), 'dsp-assets'))
  await runtime.dspAssetLibrary.initialize()
  runtime.audioEngineManager = new AudioEngineManager(
    {
      exclusiveMode: runtime.appSettings.audioExclusiveMode,
      audioOutput: runtime.appSettings.audioOutput,
      audioDevice: runtime.appSettings.audioDevice,
      audioOutputConfig: runtime.appSettings.audioOutputConfig,
      audioProcessing: initialAudioProcessing,
      dspScenes: runtime.appSettings.dspScenes,
      dspPinnedSceneId: runtime.appSettings.dspPinnedSceneId
    },
    {
      audioServiceEntry: join(__dirname, 'audioEngineService.js'),
      dspAssetPathResolver: (assetId) => runtime.dspAssetLibrary?.getKnownPath(assetId) ?? null,
      vst3StateAssetResolver: (assetId) =>
        runtime.dspAssetLibrary?.resolveVst3State(assetId) ?? {
          path: null,
          kind: null,
          reason: 'The DSP asset library is not initialized'
        },
      vst3ModuleResolver: (catalogId, classId) =>
        runtime.vst3Catalog?.resolveAvailableModule(catalogId, classId) ?? {
          modulePath: null,
          classId,
          reason: 'VST3 catalog is not initialized'
        }
    }
  )
  runtime.vst3Catalog = new Vst3CatalogService(join(app.getPath('userData'), 'dsp-vst3'), {
    scan: (modulePath) => requireAudioEngine().scanVst3Module(modulePath)
  })
  await runtime.vst3Catalog.initialize()
  await registerManagedVst3SearchPaths((await runtime.vst3Catalog.getState()).searchPaths)
  runtime.audioEngineManager.refreshDspGraph()
  await reconcileDspAssetReferences()
  audioDiagnosticRecorder = initializeAudioDiagnostics()
  lastAudioDiagnosticPlaybackSignature = ''

  runtime.audioEngineManager.on('property-change', ({ name, data }) => {
    runtime.mainWindow?.webContents.send('audioEngine:property-change', { name, data })
    void runtime.pluginManager?.broadcastEvent(`audioEngine:${name}`, data)
  })

  runtime.audioEngineManager.on('end-file', ({ reason }) => {
    audioDiagnosticRecorder?.record('end-file', { reason })
    runtime.mainWindow?.webContents.send('audioEngine:end-file', { reason })
    void runtime.pluginManager?.broadcastEvent('audioEngine:end-file', { reason })
  })

  registerNativeSleepTimerBoundaries(runtime.audioEngineManager, sleepTimerService)

  runtime.audioEngineManager.on('start-file', () => {
    audioDiagnosticRecorder?.record('start-file')
    runtime.mainWindow?.webContents.send('audioEngine:start-file')
    void runtime.pluginManager?.broadcastEvent('audioEngine:start-file', null)
  })

  runtime.audioEngineManager.on('queue-change', (queue) => {
    void runtime.pluginManager?.broadcastEvent('player:queue-change', { queue })
  })

  runtime.audioEngineManager.on('error', (err: Error) => {
    audioDiagnosticRecorder?.record('engine-error', { message: err.message }, 'error')
    console.error('[音频引擎]', err.message)
    runtime.mainWindow?.webContents.send('audioEngine:error', err.message)
  })

  runtime.audioEngineManager.on('audio-service-crash', ({ reason }) => {
    audioDiagnosticRecorder?.record('audio-service-crash', { reason }, 'error')
    console.error('[音频服务]', reason)
    runtime.mainWindow?.webContents.send('audioEngine:service-crash', { reason })
    runtime.mainWindow?.webContents.send('audioEngine:error', `音频服务已重启：${reason}`)
    void runtime.pluginManager?.handleNativeDspHostCrash(reason)
    void quarantineActiveVst3Nodes(reason)
  })

  runtime.audioEngineManager.on('audio-service-ready', (event) => {
    audioDiagnosticRecorder?.record('audio-service-ready', event)
    runtime.mainWindow?.webContents.send('audioEngine:service-ready', event)
    void runtime.pluginManager?.broadcastEvent('audioEngine:service-ready', event)
  })

  runtime.audioEngineManager.on('audio-service-stderr', ({ message }) => {
    audioDiagnosticRecorder?.record('audio-service-stderr', { message }, 'warning')
  })

  runtime.audioEngineManager.on('audio-service-stdout', ({ message }) => {
    audioDiagnosticRecorder?.record('audio-service-stdout', { message })
  })

  runtime.audioEngineManager.on('audio-device-options-changed', ({ reason }) => {
    audioDiagnosticRecorder?.record('device-options-changed', { reason })
    runtime.mainWindow?.webContents.send('audioEngine:device-options-changed', { reason })
  })

  runtime.audioEngineManager.on('ready', () => {
    audioDiagnosticRecorder?.record('engine-ready')
    runtime.mainWindow?.webContents.send('audioEngine:ready')
    void runtime.pluginManager?.broadcastEvent('audioEngine:ready', null)
  })

  runtime.audioEngineManager.on('playback-info', (info) => {
    recordPlaybackDiagnostic(info)
    runtime.mainWindow?.webContents.send('audioEngine:playback-info', info)
    void runtime.pluginManager?.broadcastEvent('player:playback-info', info)
    broadcastPlayerLifecycleEvents(info)
  })

  runtime.audioEngineManager.on('config-applied', (event) => {
    audioDiagnosticRecorder?.record('output-config-applied', event)
    runtime.mainWindow?.webContents.send('audioEngine:config-applied', event)
  })

  runtime.audioEngineManager.on('loudnorm-status', (event) => {
    audioDiagnosticRecorder?.record('loudnorm-status', event)
    runtime.mainWindow?.webContents.send('audioEngine:loudnorm-status', event)
  })

  ipcMain.handle('audioEngine:loadQueue', async (_event, items: unknown, startIndex?: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    if (!Array.isArray(items) || items.length > MAX_AUDIO_QUEUE_ITEMS) {
      throw new Error('Audio queue is invalid or too large')
    }
    const queue = normalizeIpcArray(items, 'audio queue', MAX_AUDIO_QUEUE_ITEMS, toQueueItem)
    if (queue.length !== items.length) {
      throw new Error('Audio queue contains an invalid item')
    }
    const authorizedQueue = await Promise.all(
      queue.map(async (item) => ({
        ...item,
        source: await resolveAuthorizedPlaybackSource(item.source)
      }))
    )
    const normalizedStartIndex = normalizeInteger(
      startIndex,
      'queue start index',
      0,
      0,
      Math.max(0, authorizedQueue.length - 1)
    )
    await requireAudioEngine().loadQueue(authorizedQueue, normalizedStartIndex)
  })

  ipcMain.handle('audioEngine:play', async (_event, source: string, startTime?: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const authorizedSource = await resolveAuthorizedPlaybackSource(
      normalizeIpcString(source, 'audio source', MAX_AUDIO_SOURCE_LENGTH)
    )
    const normalizedStartTime = normalizeFiniteNumber(
      startTime,
      'start time',
      0,
      0,
      Number.MAX_SAFE_INTEGER
    )
    audioDiagnosticRecorder?.record('play-requested', {
      source: authorizedSource,
      startTime: normalizedStartTime
    })
    try {
      const result = await requireAudioEngine().play(authorizedSource, normalizedStartTime)
      audioDiagnosticRecorder?.record(
        'play-result',
        result,
        result.nativeStarted ? 'info' : 'warning'
      )
      return result
    } catch (error) {
      audioDiagnosticRecorder?.record(
        'play-failed',
        { message: error instanceof Error ? error.message : String(error) },
        'error'
      )
      throw error
    }
  })

  ipcMain.handle('audioEngine:isHtmlAudioFallbackAllowed', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return rendererFallbackAllowed()
  })

  ipcMain.handle('audioEngine:togglePause', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    await requireAudioEngine().togglePause()
  })

  ipcMain.handle('audioEngine:seek', async (_event, time: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    await requireAudioEngine().seek(
      normalizeFiniteNumber(time, 'seek time', 0, 0, Number.MAX_SAFE_INTEGER)
    )
  })

  ipcMain.handle('audioEngine:setVolume', async (_event, volume: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const normalizedVolume = normalizeFiniteNumber(volume, 'volume', 1, 0, 1)
    await requireAudioEngine().setVolume(normalizedVolume)
    audioDiagnosticRecorder?.record('volume-changed', {
      volume: normalizedVolume,
      unity: Math.abs(normalizedVolume - 1) <= 0.001
    })
  })

  ipcMain.handle('audioEngine:setPlaybackRate', async (_event, rate: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const normalizedRate = normalizeFiniteNumber(rate, 'playback rate', 1, 0.5, 2)
    await requireAudioEngine().setPlaybackRate(normalizedRate)
    audioDiagnosticRecorder?.record('playback-rate-changed', { playbackRate: normalizedRate })
  })

  ipcMain.handle(
    'audioEngine:setLoopRange',
    async (_event, startSeconds: unknown, endSeconds: unknown) => {
      assertTrustedIpcSender(_event, 'audio engine IPC')
      const start =
        typeof startSeconds === 'number' && Number.isFinite(startSeconds) ? startSeconds : -1
      const end = typeof endSeconds === 'number' && Number.isFinite(endSeconds) ? endSeconds : -1
      return await requireAudioEngine().setLoopRange(start, end)
    }
  )

  ipcMain.handle('audioEngine:stop', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    await requireAudioEngine().stop()
  })

  ipcMain.handle('audioEngine:next', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    await requireAudioEngine().next()
  })

  ipcMain.handle('audioEngine:previous', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    await requireAudioEngine().previous()
  })

  ipcMain.handle('audioEngine:setPlayMode', async (_event, mode: PlayMode) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    await requireAudioEngine().setPlayMode(
      mode === 'repeat' || mode === 'shuffle' ? mode : 'sequential'
    )
  })

  ipcMain.handle('audioEngine:getUpcomingTrack', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return requireAudioEngine().getUpcomingTrack()
  })

  ipcMain.handle('audioEngine:setExclusiveMode', async (_event, enabled: boolean) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const state = await requireAudioEngine().setExclusiveMode(enabled === true)
    persistAudioOutputState(state)
    audioDiagnosticRecorder?.record('exclusive-mode-changed', state)
    return state
  })

  ipcMain.handle('audioEngine:getExclusiveMode', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return await requireAudioEngine().getExclusiveMode()
  })

  ipcMain.handle('audioEngine:setAudioOutput', async (_event, output: string, device?: string) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const state = await requireAudioEngine().setAudioOutput(
      normalizeIpcString(output, 'audio output', 64) as AudioOutputId,
      normalizeOptionalIpcString(device, 'audio device', MAX_AUDIO_DEVICE_LENGTH)
    )
    persistAudioOutputState(state)
    audioDiagnosticRecorder?.record('audio-output-changed', state)
    return state
  })

  ipcMain.handle('audioEngine:setAudioDevice', async (_event, device: string) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const state = await requireAudioEngine().setAudioDevice(
      normalizeIpcString(device, 'audio device', MAX_AUDIO_DEVICE_LENGTH)
    )
    persistAudioOutputState(state)
    audioDiagnosticRecorder?.record('audio-device-changed', state)
    return state
  })

  ipcMain.handle('audioEngine:setOutputConfig', async (_event, config: unknown) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const normalized = normalizeOutputConfig(config)
    const engine = requireAudioEngine()
    await engine.setOutputConfig(normalized)
    const applied = engine.getOutputConfig()
    persistAudioOutputConfig(applied)
    audioDiagnosticRecorder?.record('output-config-changed', {
      requested: normalized,
      applied,
      applyStatus: engine.getOutputConfigApplyStatus()
    })
    return applied
  })

  ipcMain.handle('audioEngine:getOutputConfigApplyStatus', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return requireAudioEngine().getOutputConfigApplyStatus()
  })

  ipcMain.handle('audioEngine:getAudioOutput', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return await requireAudioEngine().getAudioOutput()
  })

  ipcMain.handle('audioEngine:getAudioOutputOptions', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return requireAudioEngine().getAudioOutputOptions()
  })

  ipcMain.handle('audioEngine:getAudioOutputState', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return await requireAudioEngine().getAudioOutputState()
  })

  ipcMain.handle(
    'audioEngine:setAudioProcessing',
    async (_event, settings: Partial<AudioProcessingSettings>) => {
      assertTrustedIpcSender(_event, 'audio engine IPC')
      const normalized = await authorizeAudioProcessingSettings({
        ...runtime.appSettings.audioProcessing,
        ...settings
      })
      await persistAndApplyAudioProcessingState(normalized)
      audioDiagnosticRecorder?.record('audio-processing-changed', {
        configured: runtime.appSettings.audioProcessing,
        effective: getEffectiveAudioProcessing(),
        headphoneCompensation: summarizeHeadphoneCompensation()
      })
      return runtime.appSettings.audioProcessing
    }
  )

  ipcMain.handle('audioEngine:getAudioProcessing', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return runtime.appSettings.audioProcessing
  })

  ipcMain.handle('audioEngine:getDspSceneState', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return requireAudioEngine().getDspSceneState()
  })

  ipcMain.handle(
    'audioEngine:setDspScenes',
    async (event, scenes: unknown, pinnedSceneId?: unknown) => {
      assertTrustedIpcSender(event, 'audio engine IPC')
      const normalizedScenes = normalizeDspScenes(scenes, runtime.appSettings.audioProcessing)
      const normalizedPin =
        typeof pinnedSceneId === 'string' &&
        normalizedScenes.some((scene) => scene.id === pinnedSceneId)
          ? pinnedSceneId
          : null
      const state = await requireAudioEngine().setDspScenes(normalizedScenes, normalizedPin)
      persistDspSceneState(state)
      await reconcileDspAssetReferences()
      return state
    }
  )

  ipcMain.handle('audioEngine:setOutputStage', async (event, partial: unknown) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const raw =
      partial && typeof partial === 'object' && !Array.isArray(partial)
        ? (partial as Record<string, unknown>)
        : {}
    const state = await requireAudioEngine().setOutputStage(raw)
    persistDspSceneState(state)
    return state
  })

  ipcMain.handle('audioEngine:setStereoImage', async (event, partial: unknown) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const raw =
      partial && typeof partial === 'object' && !Array.isArray(partial)
        ? (partial as Record<string, unknown>)
        : {}
    const state = await requireAudioEngine().setStereoImage(raw)
    persistDspSceneState(state)
    return state
  })

  ipcMain.handle(
    'audioEngine:applyDspScene',
    async (event, sceneId: unknown, confirmDsdPcmFallback?: unknown) => {
      assertTrustedIpcSender(event, 'audio engine IPC')
      const state = await requireAudioEngine().applyDspScene(
        typeof sceneId === 'string' ? sceneId : null,
        confirmDsdPcmFallback === true
      )
      persistDspSceneState(state)
      await reconcileDspAssetReferences()
      return state
    }
  )

  ipcMain.handle('audioEngine:getDspGraphStatus', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return requireAudioEngine().getDspGraphStatus()
  })

  ipcMain.handle('audioEngine:getDspAssets', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return await requireDspAssets().list()
  })

  ipcMain.handle('audioEngine:importDspAsset', async (event, kind: unknown) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const assetKind = normalizeDspAssetKind(kind)
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const result = win
      ? await dialog.showOpenDialog(win, assetDialogOptions(assetKind))
      : await dialog.showOpenDialog(assetDialogOptions(assetKind))
    if (result.canceled || result.filePaths.length === 0) return null
    if (assetKind === 'correctionProfile') {
      return (await importCorrectionProfileFile(result.filePaths[0], requireDspAssets())).asset
    }
    return await requireDspAssets().importFile({ kind: assetKind, sourcePath: result.filePaths[0] })
  })

  ipcMain.handle('audioEngine:importDspCorrectionProfile', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const options = assetDialogOptions('correctionProfile')
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return await importCorrectionProfileFile(result.filePaths[0], requireDspAssets())
  })

  ipcMain.handle('audioEngine:importFrequencyResponse', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const options: Electron.OpenDialogOptions = {
      title: '导入 AutoEq 耳机频响 CSV',
      properties: ['openFile'],
      filters: [{ name: 'AutoEq CSV', extensions: ['csv'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return await importFrequencyResponseFromDialog(
      result,
      async (filePath) => await readFile(filePath, 'utf-8'),
      async (filePath) => (await stat(filePath)).size
    )
  })

  ipcMain.handle('audioEngine:getDspCorrectionProfile', async (event, assetId: unknown) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const id = normalizeIpcString(assetId, 'DSP correction asset id', 160)
    if (!/^correctionProfile:[a-f0-9]{64}$/.test(id)) {
      throw new Error('DSP 校正资料标识无效')
    }
    const assets = requireDspAssets()
    const asset = await assets.get(id)
    if (!asset || asset.kind !== 'correctionProfile') throw new Error('DSP 校正资料不存在')
    return await parseCorrectionProfileFile(await assets.getPath(id))
  })

  ipcMain.handle('audioEngine:deleteDspAsset', async (event, assetId: unknown) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const id = normalizeIpcString(assetId, 'DSP asset id', 160)
    if (!/^[a-zA-Z]+:[a-f0-9]{64}$/.test(id)) throw new Error('DSP 资料标识无效')
    await requireDspAssets().remove(id)
    return await requireDspAssets().list()
  })

  ipcMain.handle('audioEngine:exportDspProfile', async (event, name?: unknown) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const result = win
      ? await dialog.showSaveDialog(win, {
          title: '导出 DSP 配置包',
          defaultPath: 'DSP Profile.tedsp',
          filters: [{ name: 'Twilight Echo DSP Profile', extensions: ['tedsp'] }]
        })
      : await dialog.showSaveDialog({
          title: '导出 DSP 配置包',
          defaultPath: 'DSP Profile.tedsp',
          filters: [{ name: 'Twilight Echo DSP Profile', extensions: ['tedsp'] }]
        })
    if (result.canceled || !result.filePath) return null
    const scenes = runtime.appSettings.dspScenes
    const profile = createDspProfile({
      name: typeof name === 'string' ? name : 'DSP Profile',
      scenes,
      pinnedSceneId: runtime.appSettings.dspPinnedSceneId,
      assetIds: collectDspAssetIds(scenes)
    })
    await exportDspProfileArchive({ outputPath: result.filePath, profile }, requireDspAssets())
    return profile
  })

  ipcMain.handle('audioEngine:importDspProfile', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '导入 DSP 配置包',
          properties: ['openFile'],
          filters: [{ name: 'Twilight Echo DSP Profile', extensions: ['tedsp'] }]
        })
      : await dialog.showOpenDialog({
          title: '导入 DSP 配置包',
          properties: ['openFile'],
          filters: [{ name: 'Twilight Echo DSP Profile', extensions: ['tedsp'] }]
        })
    if (result.canceled || result.filePaths.length === 0) return null
    const imported = await importDspProfileArchive(result.filePaths[0], requireDspAssets())
    const scenes = normalizeDspScenes(imported.profile.scenes, runtime.appSettings.audioProcessing)
    const pinnedSceneId =
      typeof imported.profile.pinnedSceneId === 'string' &&
      scenes.some((scene) => scene.id === imported.profile.pinnedSceneId)
        ? imported.profile.pinnedSceneId
        : null
    const state = await requireAudioEngine().setDspScenes(scenes, pinnedSceneId)
    persistDspSceneState(state)
    await reconcileDspAssetReferences()
    return { state, profile: imported.profile, importedAssets: imported.importedAssets }
  })

  ipcMain.handle('audioEngine:getVst3Catalog', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return await requireVst3Catalog().getState()
  })

  ipcMain.handle('audioEngine:setVst3Enabled', async (event, enabled: unknown) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const state = await requireVst3Catalog().setEnabled(enabled === true)
    requireAudioEngine().refreshDspGraph()
    return state
  })

  ipcMain.handle('audioEngine:selectVst3SearchPath', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '选择 VST3 搜索目录',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({ title: '选择 VST3 搜索目录', properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return await grantUserSelectedVst3SearchPath(result.filePaths[0])
  })

  ipcMain.handle('audioEngine:setVst3SearchPaths', async (event, paths: unknown) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const authorized = await resolveAuthorizedVst3SearchPaths(paths)
    const state = await requireVst3Catalog().setSearchPaths(authorized)
    requireAudioEngine().refreshDspGraph()
    return state
  })

  ipcMain.handle('audioEngine:scanVst3Plugins', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const state = await requireVst3Catalog().scan()
    requireAudioEngine().refreshDspGraph()
    return state
  })

  ipcMain.handle('audioEngine:clearVst3Quarantine', async (event, id: unknown) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const catalogId = normalizeIpcString(id, 'VST3 catalog id', 160)
    const catalog = requireVst3Catalog()
    await catalog.clearQuarantine(catalogId)
    // Re-probe in the scanner process before allowing this one module back
    // into the graph. A bad module remains isolated when the probe fails.
    const state = await catalog.scan()
    const entry = state.entries.find((candidate) => candidate.id === catalogId)
    if (entry?.status === 'available') requireAudioEngine().clearVst3RecoveryBypass(catalogId)
    requireAudioEngine().refreshDspGraph()
    return state
  })

  ipcMain.handle('audioEngine:selectImpulseResponse', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const options: Electron.OpenDialogOptions = {
      title: '选择卷积脉冲响应',
      properties: ['openFile'],
      filters: [
        { name: 'Impulse Response', extensions: ['wav', 'flac', 'aiff', 'aif'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return await grantUserSelectedImpulseResponse(result.filePaths[0])
  })

  ipcMain.handle('audioEngine:loadImpulseResponse', async (_event, path: string) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const convolverIrPath = await resolveAuthorizedImpulseResponseFile(
      normalizeIpcString(path, 'impulse response path', MAX_AUDIO_SOURCE_LENGTH)
    )
    const normalized = await authorizeAudioProcessingSettings({
      ...runtime.appSettings.audioProcessing,
      dspEnabled: true,
      convolverEnabled: true,
      convolverIrPath
    })
    await persistAndApplyAudioProcessingState(normalized)
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle('audioEngine:unloadImpulseResponse', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const normalized = normalizeAudioProcessingSettings({
      ...runtime.appSettings.audioProcessing,
      convolverEnabled: false,
      convolverIrPath: ''
    })
    await persistAndApplyAudioProcessingState(normalized)
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle('audioEngine:getConvolverInfo', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle(
    'audioEngine:setEqBands',
    async (_event, settings: Partial<AudioProcessingSettings>) => {
      assertTrustedIpcSender(_event, 'audio engine IPC')
      const normalized = await authorizeAudioProcessingSettings({
        ...runtime.appSettings.audioProcessing,
        ...settings,
        dspEnabled: true,
        eqEnabled: true
      })
      await persistAndApplyAudioProcessingState(normalized)
      return runtime.appSettings.audioProcessing
    }
  )

  ipcMain.handle(
    'audioEngine:setEqPreset',
    async (
      _event,
      preset: {
        eqMode: EqMode
        eqPreamp: number
        eqBands: EqualizerBand[]
      }
    ) => {
      assertTrustedIpcSender(_event, 'audio engine IPC')
      const normalized = await authorizeAudioProcessingSettings({
        ...runtime.appSettings.audioProcessing,
        ...preset,
        dspEnabled: true,
        eqEnabled: true
      })
      await persistAndApplyAudioProcessingState(normalized)
      return runtime.appSettings.audioProcessing
    }
  )

  ipcMain.handle('audioEngine:setCrossfeedStrength', async (_event, strength: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const normalizedStrength = normalizeFiniteNumber(strength, 'crossfeed strength', 0, 0, 1)
    const normalized = await authorizeAudioProcessingSettings({
      ...runtime.appSettings.audioProcessing,
      dspEnabled: true,
      crossfeedEnabled: normalizedStrength > 0,
      crossfeedStrength: normalizedStrength
    })
    await persistAndApplyAudioProcessingState(normalized)
    return runtime.appSettings.audioProcessing
  })

  ipcMain.handle(
    'audioEngine:setReplayGainMode',
    async (
      _event,
      mode: AudioProcessingSettings['volumeNormalization'],
      preamp?: number,
      fallback?: number,
      clip?: boolean
    ) => {
      assertTrustedIpcSender(_event, 'audio engine IPC')
      const normalized = await authorizeAudioProcessingSettings({
        ...runtime.appSettings.audioProcessing,
        dspEnabled: true,
        volumeNormalization: mode,
        replayGainPreamp: preamp ?? runtime.appSettings.audioProcessing.replayGainPreamp,
        replayGainFallback: fallback ?? runtime.appSettings.audioProcessing.replayGainFallback,
        replayGainClip: clip ?? runtime.appSettings.audioProcessing.replayGainClip
      })
      await persistAndApplyAudioProcessingState(normalized)
      return runtime.appSettings.audioProcessing
    }
  )

  ipcMain.handle('audioEngine:getMetadata', async (_event, source: string) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    return await requireAudioEngine().getMetadataAsync(
      await resolveAuthorizedAudioSource(
        normalizeIpcString(source, 'metadata source', MAX_AUDIO_SOURCE_LENGTH)
      )
    )
  })

  ipcMain.handle('audioEngine:getPlaybackInfo', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return await requireAudioEngine().getPlaybackInfo()
  })

  ipcMain.handle('audioEngine:exportDiagnostics', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const recorder = audioDiagnosticRecorder
    if (!recorder) throw new Error('音频诊断记录器尚未初始化')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const options: Electron.SaveDialogOptions = {
      title: '导出音频诊断日志',
      defaultPath: `TwilightEcho-audio-diagnostics-${timestamp}.json`,
      filters: [{ name: 'Twilight Echo Audio Diagnostics', extensions: ['json'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { filePath: null }
    recorder.record('diagnostic-export-requested')
    const snapshot = await captureAudioDiagnosticSnapshot()
    await recorder.exportReport(result.filePath, snapshot)
    return { filePath: result.filePath }
  })

  ipcMain.handle('audioEngine:getSpectrumData', async (_event, points?: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    return requireAudioEngine().getSpectrumData(
      normalizeInteger(points, 'spectrum points', 128, 8, 4096)
    )
  })

  ipcMain.handle('audioEngine:getVisualizationData', async (_event, options?: unknown) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    return requireAudioEngine().getVisualizationData(
      typeof options === 'object' && options !== null ? options : {}
    )
  })

  runtime.audioEngineManager.start().catch((err: Error) => {
    console.error('原生音频引擎启动失败：', err.message)
  })
}
