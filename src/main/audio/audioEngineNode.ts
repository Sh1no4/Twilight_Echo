import { createInterface } from 'node:readline'
import {
  AudioEngineManager,
  DEFAULT_AUDIO_PROCESSING,
  normalizeAudioProcessingSettings,
  type AudioEngineConfig
} from '../audioEngineManager.ts'
import { rendererFallbackAllowed } from './nativeBinding.ts'
import { AudioSliceServices, type AnalysisEventEmitter } from './audioSliceServices.ts'

/**
 * Node audio runtime sidecar (Stage 6).
 *
 * Tauri spawns this file with a fixed Node runtime and drives the real
 * `AudioEngineManager` over stdin/stdout as JSON lines. stdout is the framed
 * protocol channel; incidental diagnostics from Node internals are routed to
 * stderr before the manager starts.
 *
 * Message protocol (one JSON object per line):
 *
 *   parent → sidecar
 *     { "kind": "init",   "config": AudioEngineConfig }   // one-time at spawn
 *     { "kind": "call",   "requestId", "method", "args" } // manager method call
 *     { "kind": "deinit", "requestId" }                   // graceful shutdown
 *
 *   sidecar → parent
 *     { "kind": "ready", "capabilities": { nativeAvailable, fallbackAllowed } }
 *     { "kind": "result", "requestId", "ok": true,  "value": ... }
 *     { "kind": "result", "requestId", "ok": false, "error": "..." }
 *     { "kind": "event",  "name": "playback-info|property-change|end-file|...", "payload": ... }
 *     { "kind": "deinitialized", "requestId" }
 *     { "kind": "fatal", "error": "..." }
 *
 * The manager runs the same playback controller / output router / DSP
 * orchestrator used under Electron. When the native addon
 * (`twilight_audio_node.node`) is not present, the manager honestly reports the
 * engine unavailable and `play()` returns `{ nativeStarted: false, fallbackReason }`
 * so the renderer falls back to HTMLAudio without pretending native playback.
 */

const diagnostics = (...args: unknown[]): void => {
  console.error('[audio-engine-node]', ...args)
}
console.log = diagnostics
console.warn = diagnostics

interface InitMessage {
  kind: 'init'
  config?: AudioEngineConfig
  /** User-data directory where slice services (VST3/DSP/analysis) persist. */
  dataDir?: string
}
interface CallMessage {
  kind: 'call'
  requestId: string
  method: string
  args?: unknown[]
}
interface DeinitMessage {
  kind: 'deinit'
  requestId: string
}

/** Methods the parent may drive through the sidecar (mirrors the migrated surface). */
const CALLABLE_METHODS = new Set([
  // queue / transport control
  'loadQueue',
  'play',
  'togglePause',
  'seek',
  'setVolume',
  'setPlaybackRate',
  'setLoopRange',
  'stop',
  'next',
  'previous',
  'setPlayMode',
  'getUpcomingTrack',
  'getPlaybackInfo',
  'isHtmlAudioFallbackAllowed',
  // output routing
  'setExclusiveMode',
  'getExclusiveMode',
  'setAudioOutput',
  'setAudioDevice',
  'setOutputConfig',
  'getOutputConfigApplyStatus',
  'getAudioOutput',
  'getAudioOutputOptions',
  'getAudioOutputState',
  // processing / DSP scene
  'setAudioProcessing',
  'getAudioProcessing',
  'getDspSceneState',
  'setDspScenes',
  'setOutputStage',
  'setStereoImage',
  'applyDspScene',
  'getDspGraphStatus',
  'setEqBands',
  'setEqPreset',
  'setCrossfeedStrength',
  'setReplayGainMode',
  'loadImpulseResponse',
  'unloadImpulseResponse',
  'getConvolverInfo',
  // metadata / visualization
  'getMetadata',
  'getSpectrumData',
  'getVisualizationData'
])

let manager: AudioEngineManager | null = null
let slice: AudioSliceServices | null = null
let shuttingDown = false

function post(message: unknown): void {
  if (shuttingDown) return
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function emit(event: 'ready' | 'error' | 'playback-info' | 'property-change' | 'end-file' | 'start-file' | 'config-applied' | 'loudnorm-status' | 'service-crash' | 'service-ready' | 'device-options-changed' | 'queue-change' | 'sleep-timer-boundary' | 'disconnected', payload: unknown): void {
  post({ kind: 'event', name: event, payload })
}

/** Forward an analysis completion event (bpm/loudness) under its own surface channel. */
const emitAnalysis: AnalysisEventEmitter = (surface, name, payload) => {
  post({ kind: 'analysis-event', surface, name, payload })
}

/** Merge a partial config from the parent with engine defaults. */
function normalizeConfig(config: AudioEngineConfig = { exclusiveMode: false }): AudioEngineConfig {
  const merged = { ...config }
  return {
    exclusiveMode: merged.exclusiveMode ?? false,
    volume: merged.volume ?? 1,
    audioOutput: merged.audioOutput ?? 'wasapi',
    audioDevice: merged.audioDevice ?? 'auto',
    audioOutputConfig: merged.audioOutputConfig ?? {},
    audioProcessing: merged.audioProcessing
      ? normalizeAudioProcessingSettings(merged.audioProcessing)
      : { ...DEFAULT_AUDIO_PROCESSING, eqBands: DEFAULT_AUDIO_PROCESSING.eqBands.map((band) => ({ ...band })) },
    dspScenes: merged.dspScenes ?? [],
    dspPinnedSceneId: merged.dspPinnedSceneId ?? null
  }
}

function wireEvents(engine: AudioEngineManager): void {
  engine.on('ready', () => emit('ready', null))
  engine.on('error', (error: Error) => emit('error', error instanceof Error ? error.message : String(error)))
  engine.on('playback-info', (info: unknown) => emit('playback-info', info))
  engine.on('property-change', (event: { name: string; data: unknown }) => emit('property-change', event))
  engine.on('end-file', (event: { reason: string }) => emit('end-file', event))
  engine.on('start-file', () => emit('start-file', null))
  engine.on('config-applied', (event: unknown) => emit('config-applied', event))
  engine.on('loudnorm-status', (event: unknown) => emit('loudnorm-status', event))
  engine.on('audio-service-crash', (event: { reason: string }) => emit('service-crash', event))
  engine.on('audio-service-ready', (event: unknown) => emit('service-ready', event))
  engine.on('audio-device-options-changed', (event: { reason: string }) =>
    emit('device-options-changed', event)
  )
  engine.on('queue-change', (queue: unknown) => emit('queue-change', queue))
  engine.on('sleep-timer-boundary', (boundary: unknown) => emit('sleep-timer-boundary', boundary))
}

function handleInit(message: InitMessage): void {
  if (manager) {
    post({ kind: 'ready', capabilities: describeCapabilities() })
    return
  }
  try {
    manager = new AudioEngineManager(normalizeConfig(message.config))
    wireEvents(manager)
    slice = new AudioSliceServices()
    const dataDir =
      (message.config as { dataDir?: string } | undefined)?.dataDir ?? message.dataDir
    if (dataDir) slice.setup(dataDir, manager, emitAnalysis)
    void manager.start().then(() => {
      post({ kind: 'ready', capabilities: describeCapabilities() })
    })
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    post({ kind: 'fatal', error: messageText })
  }
}

function describeCapabilities(): Record<string, unknown> {
  return {
    nativeAvailable: manager?.isNativeAvailable() === true,
    fallbackAllowed: rendererFallbackAllowed()
  }
}

/** Methods served by the Stage 6B slice services (VST3 / DSP assets / analysis / diagnostics). */
const SLICE_METHODS = new Set([
  'vst3GetState',
  'vst3SetEnabled',
  'vst3SetSearchPaths',
  'vst3Scan',
  'vst3ClearQuarantine',
  'dspList',
  'dspImportAsset',
  'dspImportCorrectionProfile',
  'dspImportFrequencyResponse',
  'dspGetCorrectionProfile',
  'dspDeleteAsset',
  'dspExportProfile',
  'dspImportProfile',
  'bpmRequest',
  'bpmGetCacheSize',
  'bpmClearCache',
  'bpmCancel',
  'loudnessRequest',
  'loudnessGetCacheSize',
  'loudnessClearCache',
  'loudnessGetStatus',
  'loudnessCancel',
  'diagExport'
])

/**
 * Output-query methods that must report a structured `native-unavailable`
 * instead of the WASAPI default shape when the native addon is not loaded,
 * mirroring the honest `play()` fallback contract (Stage 6B).
 */
const NATIVE_BOUNDARY_METHODS = new Set(['getAudioOutputOptions', 'getAudioOutputState'])

async function handleCall(message: CallMessage): Promise<void> {
  const { requestId } = message
  if (!manager) {
    post({ kind: 'result', requestId, ok: false, error: '音频引擎尚未初始化' })
    return
  }
  if (NATIVE_BOUNDARY_METHODS.has(message.method) && !manager.isNativeAvailable()) {
    post({
      kind: 'result',
      requestId,
      ok: false,
      error: JSON.stringify({
        capability: 'audioEngine',
        surface: 'audioEngine',
        method: message.method,
        reasonCode: 'native-unavailable',
        recoverable: true
      })
    })
    return
  }
  if (SLICE_METHODS.has(message.method) && slice) {
    const handler = slice[message.method as keyof AudioSliceServices] as unknown
    if (typeof handler === 'function') {
      try {
        const value = await (handler as (...args: unknown[]) => unknown).apply(slice, message.args ?? [])
        post({ kind: 'result', requestId, ok: true, value: value ?? null })
      } catch (error) {
        post({
          kind: 'result',
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      return
    }
  }
  if (!CALLABLE_METHODS.has(message.method)) {
    post({ kind: 'result', requestId, ok: false, error: `音频引擎不支持方法：${message.method}` })
    return
  }
  const method = message.method as keyof AudioEngineManager
  const handler = manager[method] as unknown
  if (typeof handler !== 'function') {
    post({ kind: 'result', requestId, ok: false, error: `音频引擎不支持方法：${message.method}` })
    return
  }
  try {
    const value = await (handler as (...args: unknown[]) => unknown).apply(manager, message.args ?? [])
    post({ kind: 'result', requestId, ok: true, value: value ?? null })
  } catch (error) {
    post({
      kind: 'result',
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function handleDeinit(message: DeinitMessage): Promise<void> {
  try {
    manager?.destroy()
  } catch (error) {
    diagnostics('销毁音频引擎失败：', error)
  }
  manager = null
  slice = null
  // The parent must receive the ack before the process exits; `post` is gated
  // on `shuttingDown`, so flip the flag only after the ack is queued.
  process.stdout.write(`${JSON.stringify({ kind: 'deinitialized', requestId: message.requestId })}\n`)
  shuttingDown = true
  process.exit(0)
}

async function handleMessage(message: InitMessage | CallMessage | DeinitMessage): Promise<void> {
  switch (message.kind) {
    case 'init':
      return handleInit(message as InitMessage)
    case 'call':
      return handleCall(message as CallMessage)
    case 'deinit':
      return handleDeinit(message as DeinitMessage)
  }
}

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity })
reader.on('line', (line) => {
  if (!line.trim()) return
  let message: unknown
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  void handleMessage(message as InitMessage | CallMessage | DeinitMessage)
})
reader.on('close', () => {
  if (!shuttingDown) {
    try {
      manager?.destroy()
    } catch {
      // best-effort teardown when the parent disconnects
    }
  }
  process.exit(0)
})
