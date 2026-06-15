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
    fork: (modulePath: string, args?: string[], options?: { serviceName?: string; stdio?: 'pipe' }) => UtilityProcessLike
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

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface AudioEngineServiceBindingOptions {
  serviceEntry: string
  requestTimeoutMs?: number
  restartDelayMs?: number
}

export class AudioEngineServiceBinding extends EventEmitter implements NativeAudioBinding {
  private readonly options: AudioEngineServiceBindingOptions
  private child: UtilityProcessLike | null = null
  private pending = new Map<string, PendingRequest>()
  private requestTimeoutMs: number
  private restartDelayMs: number
  private stopped = false
  private restarting = false
  private lastPlaybackInfo: string | PlaybackInfo | null = null
  private lastDspStatus: string | { plugins: unknown[] } = { plugins: [] }
  private lastConvolverInfo: string | ConvolverInfo | null = null
  private lastVisualizationData: string | VisualizationData | null = null
  private lastDevices: string | AudioDeviceOption[] | null = null
  private lastUpcomingTrack: string | AudioEngineQueueItem | null = null
  private lastErrorJson = '{"message":""}'

  constructor(options: AudioEngineServiceBindingOptions) {
    super()
    this.options = options
    this.requestTimeoutMs = options.requestTimeoutMs ?? 1500
    this.restartDelayMs = options.restartDelayMs ?? 500
    this.start()
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
    this.fireAndForget('Seek', [time])
  }

  SetVolume(volume: number): void {
    this.fireAndForget('SetVolume', [volume])
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
    void this.call('GetConvolverInfo', []).then((value) => {
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

  SetReplayGainMode(mode: VolumeNormalizationMode, preamp: number, fallback: number, clip: boolean): void {
    this.fireAndForget('SetReplayGainMode', [mode, preamp, fallback, clip])
  }

  SetDspPluginChain(json: string): void {
    this.fireAndForget('SetDspPluginChain', [json])
  }

  GetDspPluginStatus(): string | { plugins: unknown[] } {
    void this.call('GetDspPluginStatus', []).then((value) => {
      this.lastDspStatus = value as string | { plugins: unknown[] }
    })
    return this.lastDspStatus
  }

  GetMetadata(source: string): string | NativeAudioMetadata {
    void source
    return '{"error":"metadata requires async audio service RPC"}'
  }

  GetPlaybackInfo(): string | PlaybackInfo {
    void this.call('GetPlaybackInfo', []).then((value) => {
      this.lastPlaybackInfo = value as string | PlaybackInfo
    })
    return this.lastPlaybackInfo ?? '{"state":"stopped"}'
  }

  GetUpcomingTrack(): string | AudioEngineQueueItem | null {
    void this.call('GetUpcomingTrack', []).then((value) => {
      this.lastUpcomingTrack = value as string | AudioEngineQueueItem | null
    })
    return this.lastUpcomingTrack
  }

  GetSpectrumData(points?: number): number[] {
    void points
    return []
  }

  GetVisualizationData(optionsJson: string): string | VisualizationData {
    void this.call('GetVisualizationData', [optionsJson]).then((value) => {
      this.lastVisualizationData = value as string | VisualizationData
    })
    return this.lastVisualizationData ?? '{"spectrum":[],"waveform":[],"peakDb":-120,"rmsDb":-120,"lufsMomentary":null,"spectrogram":[],"sampleRate":0,"active":false}'
  }

  EnumerateDevices(): string | AudioDeviceOption[] {
    void this.call('EnumerateDevices', []).then((value) => {
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
    this.child?.kill()
    this.child = null
  }

  private start(): void {
    if (this.stopped) return
    const electron = resolveElectron()
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
      child.on('message', (message) => this.handleMessage(message))
      child.on('exit', (code) => this.handleExit(`音频服务进程退出：${code ?? 'unknown'}`))
      child.on('error', (error, location) =>
        this.handleExit(`音频服务进程错误：${location ?? ''} ${error instanceof Error ? error.message : String(error)}`)
      )
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
      this.handleExit(message.error ?? '音频服务启动失败')
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

  private handleExit(reason: string): void {
    if (this.stopped) return
    this.recordFailure(reason)
    this.child = null
    this.lastDspStatus = { plugins: [] }
    this.lastPlaybackInfo = '{"state":"stopped"}'
    this.emit('crash', reason)
    if (this.restarting) return
    this.restarting = true
    setTimeout(() => {
      this.restarting = false
      this.start()
    }, this.restartDelayMs)
  }

  private fireAndForget(method: keyof NativeAudioBinding, args: unknown[]): void {
    void this.call(method, args).catch((error) => {
      this.recordFailure(error instanceof Error ? error.message : String(error))
    })
  }

  private call(method: keyof NativeAudioBinding, args: unknown[]): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error('音频服务不可用'))
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`音频服务调用超时：${String(method)}`))
      }, this.requestTimeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      this.child?.postMessage({ kind: 'request', requestId, method, args })
    })
  }

  private recordFailure(message: string): void {
    this.lastErrorJson = JSON.stringify({ message })
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
      this.pending.delete(requestId)
    }
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
