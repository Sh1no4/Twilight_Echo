import { EventEmitter } from 'events'
import { createRequire } from 'module'
import { randomUUID } from 'crypto'
import type {
  AudioDeviceOption,
  AudioEngineQueueItem,
  ConvolverInfo,
  NativeAudioBinding,
  NativeAudioMetadata,
  PlayMode,
  PlaybackInfo,
  VisualizationData,
  VolumeNormalizationMode
} from './audioEngineManager'

const require = createRequire(import.meta.url)

type UtilityProcessLike = {
  postMessage: (message: AudioServiceRequest) => void
  kill: () => void
  on: (
    event: 'message' | 'exit' | 'error',
    listener:
      | ((message: AudioServiceResponse | AudioServiceEvent) => void)
      | ((code: number | null) => void)
      | ((error: unknown, location?: string) => void)
  ) => void
  stdout?: { on: (event: 'data', listener: (chunk: Buffer) => void) => void }
  stderr?: { on: (event: 'data', listener: (chunk: Buffer) => void) => void }
}

type ElectronModule = {
  utilityProcess?: {
    fork: (
      modulePath: string,
      args?: string[],
      options?: { serviceName?: string; stdio?: 'pipe' }
    ) => UtilityProcessLike
  }
}

type AudioServiceRequest = {
  kind: 'request'
  requestId: string
  method: keyof NativeAudioBinding
  args: unknown[]
}

type AudioServiceResponse = {
  kind: 'response'
  requestId: string
  ok: boolean
  value?: unknown
  error?: string
}

type AudioServiceEvent = {
  kind: 'ready' | 'fatal'
  error?: string
}

const MAX_VISUALIZATION_CACHE_KEYS = 8
const DEFAULT_MAX_IN_FLIGHT_REQUESTS = 128
const AUDIO_SERVICE_BUSY_CODE = 'ERR_AUDIO_SERVICE_BUSY'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

type AudioServiceError = Error & {
  code?: string
}

type CoalescedControlRequest = {
  args: unknown[]
  inFlight: boolean
  scheduled: boolean
}

export interface AudioEngineServiceBindingOptions {
  serviceEntry: string
  requestTimeoutMs?: number
  restartDelayMs?: number
  maxInFlightRequests?: number
  electron?: ElectronModule
}

export class AudioEngineServiceBinding extends EventEmitter implements NativeAudioBinding {
  private readonly options: AudioEngineServiceBindingOptions
  private child: UtilityProcessLike | null = null
  private pending = new Map<string, PendingRequest>()
  private requestTimeoutMs: number
  private restartDelayMs: number
  private maxInFlightRequests: number
  private stopped = false
  private restarting = false
  private generation = 0
  private cacheRequestSerial = new Map<string, number>()
  private cacheRequestsInFlight = new Set<string>()
  private lastPlaybackInfo: string | PlaybackInfo | null = null
  private lastDspStatus: string | { plugins: unknown[] } = { plugins: [] }
  private lastConvolverInfo: string | ConvolverInfo | null = null
  private lastVisualizationDataByKey = new Map<string, string | VisualizationData>()
  private visualizationCacheKeys = new Set<string>()
  private visualizationRequestKeyByCacheKey = new Map<string, string>()
  private lastDevices: string | AudioDeviceOption[] | null = null
  private lastUpcomingTrack: string | AudioEngineQueueItem | null = null
  private lastErrorJson = '{"message":""}'
  private coalescedControls = new Map<keyof NativeAudioBinding, CoalescedControlRequest>()

  constructor(options: AudioEngineServiceBindingOptions) {
    super()
    this.options = options
    this.requestTimeoutMs = options.requestTimeoutMs ?? 1500
    this.restartDelayMs = options.restartDelayMs ?? 500
    this.maxInFlightRequests = Math.max(
      1,
      Math.floor(options.maxInFlightRequests ?? DEFAULT_MAX_IN_FLIGHT_REQUESTS)
    )
    this.start()
  }

  /**
   * 异步调用原生方法并等待 utility 进程返回结果。
   * 用于 play/pause 等需要确认真实状态的控制命令。
   */
  callAsync(method: string, args: unknown[]): Promise<unknown> {
    return this.call(method as keyof NativeAudioBinding, args)
  }

  Play(source: string, startTime?: number): void {
    this.fireAndForget('Play', [source, startTime])
  }

  Pause(): void {
    this.fireAndForget('Pause', [])
  }

  Stop(): void {
    this.fireAndForget('Stop', [])
  }

  Seek(time: number): void {
    this.coalescedFireAndForget('Seek', [time])
  }

  SetVolume(volume: number): void {
    this.coalescedFireAndForget('SetVolume', [volume])
  }

  SetOutputDevice(device: string): void {
    this.fireAndForget('SetOutputDevice', [device])
  }

  SetOutputBackend(backend: string): void {
    this.fireAndForget('SetOutputBackend', [backend])
  }

  SetOutputConfig(json: string): void {
    this.fireAndForget('SetOutputConfig', [json])
  }

  LoadQueue(queueJson: string, startIndex: number): void {
    this.fireAndForget('LoadQueue', [queueJson, startIndex])
  }

  Next(): void {
    this.fireAndForget('Next', [])
  }

  Previous(): void {
    this.fireAndForget('Previous', [])
  }

  SetPlayMode(mode: PlayMode): void {
    this.fireAndForget('SetPlayMode', [mode])
  }

  SetDspConfig(json: string): void {
    this.fireAndForget('SetDspConfig', [json])
  }

  LoadImpulseResponse(path: string): void {
    this.fireAndForget('LoadImpulseResponse', [path])
  }

  UnloadImpulseResponse(): void {
    this.fireAndForget('UnloadImpulseResponse', [])
  }

  GetConvolverInfo(): string | ConvolverInfo {
    this.refreshCache('GetConvolverInfo', [], (value) => {
      this.lastConvolverInfo = value as string | ConvolverInfo
    })
    return this.lastConvolverInfo ?? '{"loaded":false,"active":false}'
  }

  SetEqBands(json: string): void {
    this.fireAndForget('SetEqBands', [json])
  }

  SetEqPreset(json: string): void {
    this.fireAndForget('SetEqPreset', [json])
  }

  SetCrossfeedStrength(strength: number): void {
    this.fireAndForget('SetCrossfeedStrength', [strength])
  }

  SetReplayGainMode(
    mode: VolumeNormalizationMode,
    preamp: number,
    fallback: number,
    clip: boolean
  ): void {
    this.fireAndForget('SetReplayGainMode', [mode, preamp, fallback, clip])
  }

  SetDspPluginChain(json: string): void {
    this.fireAndForget('SetDspPluginChain', [json])
  }

  GetDspPluginStatus(): string | { plugins: unknown[] } {
    this.refreshCache('GetDspPluginStatus', [], (value) => {
      this.lastDspStatus = value as string | { plugins: unknown[] }
    })
    return this.lastDspStatus
  }

  GetMetadata(source: string): string | NativeAudioMetadata {
    void source
    return '{"error":"metadata requires async audio service RPC"}'
  }

  GetPlaybackInfo(): string | PlaybackInfo {
    this.refreshCache('GetPlaybackInfo', [], (value) => {
      this.lastPlaybackInfo = value as string | PlaybackInfo
    })
    return this.lastPlaybackInfo ?? '{"state":"stopped"}'
  }

  GetUpcomingTrack(): string | AudioEngineQueueItem | null {
    this.refreshCache('GetUpcomingTrack', [], (value) => {
      this.lastUpcomingTrack = value as string | AudioEngineQueueItem | null
    })
    return this.lastUpcomingTrack
  }

  GetSpectrumData(points?: number): number[] {
    void points
    return []
  }

  GetVisualizationData(optionsJson: string): string | VisualizationData {
    const cacheKey = optionsJson || '{}'
    this.touchVisualizationCacheKey(cacheKey, optionsJson)
    this.refreshCache('GetVisualizationData', [optionsJson], (value) => {
      this.touchVisualizationCacheKey(cacheKey, optionsJson)
      this.lastVisualizationDataByKey.set(cacheKey, value as string | VisualizationData)
    })
    return (
      this.lastVisualizationDataByKey.get(cacheKey) ??
      '{"spectrum":[],"waveform":[],"peakDb":-120,"rmsDb":-120,"lufsMomentary":null,"spectrogram":[],"sampleRate":0,"active":false}'
    )
  }

  EnumerateDevices(): string | AudioDeviceOption[] {
    this.refreshCache('EnumerateDevices', [], (value) => {
      this.lastDevices = value as string | AudioDeviceOption[]
    })
    return this.lastDevices ?? '[]'
  }

  EnumerateBackends(): string {
    return '[]'
  }

  GetEngineCapabilities(): string {
    return '{"audioPluginSystem":true,"nativeDsp":true,"audioService":true}'
  }

  GetLastError(): string {
    return this.lastErrorJson
  }

  async getMetadataAsync(source: string): Promise<string | NativeAudioMetadata> {
    return (await this.call('GetMetadata', [source])) as string | NativeAudioMetadata
  }

  destroy(): void {
    this.stopped = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('音频服务已停止'))
    }
    this.pending.clear()
    this.coalescedControls.clear()
    this.child?.kill()
    this.child = null
  }

  private start(): void {
    if (this.stopped) return
    const electron = this.options.electron ?? resolveElectron()
    if (!electron?.utilityProcess) {
      this.recordFailure('当前运行时不支持 Electron utilityProcess')
      return
    }
    try {
      const child = electron.utilityProcess.fork(this.options.serviceEntry, [], {
        serviceName: 'twilight-audio-engine',
        stdio: 'pipe'
      })
      this.child = child
      child.on('message', (message) => {
        if (this.child !== child) return
        this.handleMessage(message)
      })
      child.on('exit', (code) => {
        if (this.child !== child) return
        this.handleExit(`音频服务进程退出：${code ?? 'unknown'}`)
      })
      child.on('error', (error, location) => {
        if (this.child !== child) return
        this.handleExit(
          `音频服务进程错误：${location ?? ''} ${error instanceof Error ? error.message : String(error)}`
        )
      })
      child.stdout?.on('data', (chunk) => this.emit('log', chunk.toString()))
      child.stderr?.on('data', (chunk) => this.emit('error-log', chunk.toString()))
    } catch (error) {
      this.recordFailure(error instanceof Error ? error.message : String(error))
    }
  }

  private handleMessage(message: AudioServiceResponse | AudioServiceEvent): void {
    if (message.kind === 'ready') {
      this.emit('ready')
      return
    }
    if (message.kind === 'fatal') {
      this.handleFatal(message.error ?? '音频服务启动失败')
      return
    }
    if (message.kind !== 'response') return
    const pending = this.pending.get(message.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.requestId)
    if (message.ok) pending.resolve(message.value)
    else pending.reject(new Error(message.error ?? '音频服务调用失败'))
  }

  private handleFatal(reason: string): void {
    const child = this.child
    this.child = null
    try {
      child?.kill()
    } catch {
      // The service already reported fatal startup failure; keep the original reason.
    }
    this.handleExit(reason, { restart: false })
  }

  private handleExit(reason: string, options: { restart?: boolean } = {}): void {
    if (this.stopped) return
    this.recordFailure(reason)
    this.child = null
    this.generation += 1
    this.clearServiceDerivedCaches()
    this.emit('crash', reason)
    if (options.restart === false) return
    if (this.restarting) return
    this.restarting = true
    setTimeout(() => {
      this.restarting = false
      this.start()
    }, this.restartDelayMs)
  }

  private fireAndForget(method: keyof NativeAudioBinding, args: unknown[]): void {
    void this.call(method, args).catch((error) => {
      if (isAudioServiceBusyError(error)) {
        this.recordTransientFailure(error.message)
        return
      }
      this.recordFailure(error instanceof Error ? error.message : String(error))
    })
  }

  private coalescedFireAndForget(method: keyof NativeAudioBinding, args: unknown[]): void {
    let request = this.coalescedControls.get(method)
    if (!request) {
      request = { args, inFlight: false, scheduled: false }
      this.coalescedControls.set(method, request)
    } else {
      request.args = args
    }

    if (request.inFlight || request.scheduled) return
    request.scheduled = true
    queueMicrotask(() => this.flushCoalescedControl(method))
  }

  private flushCoalescedControl(method: keyof NativeAudioBinding): void {
    const request = this.coalescedControls.get(method)
    if (!request || request.inFlight || this.stopped) return

    request.scheduled = false
    request.inFlight = true
    const args = request.args
    void this.call(method, args)
      .catch((error) => {
        if (isAudioServiceBusyError(error)) {
          this.recordTransientFailure(error.message)
          return
        }
        this.recordFailure(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        const latest = this.coalescedControls.get(method)
        if (!latest) return
        latest.inFlight = false
        if (latest.args === args || this.stopped) {
          this.coalescedControls.delete(method)
          return
        }
        latest.scheduled = true
        queueMicrotask(() => this.flushCoalescedControl(method))
      })
  }

  private refreshCache(
    method: keyof NativeAudioBinding,
    args: unknown[],
    apply: (value: unknown) => void
  ): void {
    const cacheKey = `${String(method)}:${JSON.stringify(args)}`
    if (this.cacheRequestsInFlight.has(cacheKey)) return
    this.cacheRequestsInFlight.add(cacheKey)
    const serial = (this.cacheRequestSerial.get(cacheKey) ?? 0) + 1
    this.cacheRequestSerial.set(cacheKey, serial)
    void this.call(method, args)
      .then((value) => {
        if (this.cacheRequestSerial.get(cacheKey) !== serial) return
        apply(value)
      })
      .catch((error) => {
        if (this.cacheRequestSerial.get(cacheKey) !== serial) return
        this.lastErrorJson = JSON.stringify({
          message: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        this.cacheRequestsInFlight.delete(cacheKey)
      })
  }

  private touchVisualizationCacheKey(cacheKey: string, optionsJson: string): void {
    const requestCacheKey = this.visualizationRequestCacheKey(optionsJson)
    this.visualizationRequestKeyByCacheKey.set(cacheKey, requestCacheKey)
    this.visualizationCacheKeys.delete(cacheKey)
    this.visualizationCacheKeys.add(cacheKey)
    while (this.visualizationCacheKeys.size > MAX_VISUALIZATION_CACHE_KEYS) {
      const oldest = this.visualizationCacheKeys.values().next().value as string | undefined
      if (!oldest) return
      this.visualizationCacheKeys.delete(oldest)
      this.lastVisualizationDataByKey.delete(oldest)
      const oldestRequestCacheKey = this.visualizationRequestKeyByCacheKey.get(oldest)
      this.visualizationRequestKeyByCacheKey.delete(oldest)
      if (oldestRequestCacheKey) {
        this.cacheRequestSerial.delete(oldestRequestCacheKey)
        this.cacheRequestsInFlight.delete(oldestRequestCacheKey)
      }
    }
  }

  private visualizationRequestCacheKey(optionsJson: string): string {
    return `GetVisualizationData:${JSON.stringify([optionsJson])}`
  }

  private clearServiceDerivedCaches(): void {
    this.lastDspStatus = { plugins: [] }
    this.lastPlaybackInfo = '{"state":"stopped"}'
    this.lastConvolverInfo = null
    this.lastVisualizationDataByKey.clear()
    this.visualizationCacheKeys.clear()
    this.visualizationRequestKeyByCacheKey.clear()
    this.lastDevices = null
    this.lastUpcomingTrack = null
    this.cacheRequestSerial.clear()
    this.cacheRequestsInFlight.clear()
  }

  private call(method: keyof NativeAudioBinding, args: unknown[]): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error('音频服务不可用'))
    if (this.pending.size >= this.maxInFlightRequests) {
      return Promise.reject(createAudioServiceBusyError(method))
    }
    const requestId = randomUUID()
    const generation = this.generation
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`音频服务调用超时：${String(method)}`))
      }, this.requestTimeoutMs)
      this.pending.set(requestId, {
        resolve: (value) => {
          if (generation !== this.generation) return
          resolve(value)
        },
        reject,
        timer
      })
      try {
        this.child?.postMessage({ kind: 'request', requestId, method, args })
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        const message = err instanceof Error ? err.message : String(err)
        this.recordTransientFailure(message)
        reject(err)
      }
    })
  }

  private recordFailure(message: string): void {
    this.lastErrorJson = JSON.stringify({ message })
    this.coalescedControls.clear()
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
      this.pending.delete(requestId)
    }
  }

  private recordTransientFailure(message: string): void {
    this.lastErrorJson = JSON.stringify({ message })
  }
}

export function canUseAudioEngineService(): boolean {
  if (process.env.TWILIGHT_AUDIO_SERVICE === '0') return false
  return Boolean(resolveElectron()?.utilityProcess)
}

function resolveElectron(): ElectronModule | null {
  try {
    const electron = require('electron') as ElectronModule | string
    return typeof electron === 'object' && electron ? electron : null
  } catch {
    return null
  }
}

function createAudioServiceBusyError(method: keyof NativeAudioBinding): AudioServiceError {
  const error = new Error(`音频服务请求过多：${String(method)}`) as AudioServiceError
  error.code = AUDIO_SERVICE_BUSY_CODE
  return error
}

function isAudioServiceBusyError(error: unknown): error is AudioServiceError {
  return error instanceof Error && (error as AudioServiceError).code === AUDIO_SERVICE_BUSY_CODE
}
