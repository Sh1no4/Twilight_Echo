import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export type AudioOutputId = 'wasapi' | 'asio' | 'coreaudio' | 'alsa'
export type PlayMode = 'sequential' | 'repeat' | 'shuffle'
export type EqMode = 'graphic' | 'parametric'
export type VolumeNormalizationMode = 'off' | 'track' | 'album' | 'loudnorm'
export type EqualizerFilterType =
  | 'peak'
  | 'lowShelf'
  | 'highShelf'
  | 'bandPass'
  | 'lowPass'
  | 'highPass'
  | 'allPass'

export interface EqualizerBand {
  frequency: number
  gain: number
  q: number
  filterType: EqualizerFilterType
}

export interface AudioProcessingSettings {
  highResolution: boolean
  dsdToPcm: boolean
  eqEnabled: boolean
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
  volumeNormalization: VolumeNormalizationMode
  replayGainPreamp: number
  replayGainFallback: number
  replayGainClip: boolean
  gapless: boolean
  crossfadeSeconds: number
}

export interface AudioOutputOption {
  id: AudioOutputId
  label: string
  description: string
  platform: NodeJS.Platform
  supportsExclusive: boolean
}

export interface AudioDeviceOption {
  id: string
  label: string
  isDefault: boolean
}

export interface AudioOutputState {
  output: AudioOutputId
  device: string
  exclusiveMode: boolean
  exclusiveAvailable: boolean
  outputOptions: AudioOutputOption[]
  deviceOptions: AudioDeviceOption[]
}

export interface AudioEngineConfig {
  exclusiveMode: boolean
  audioOutput?: AudioOutputId
  audioDevice?: string
  audioProcessing?: Partial<AudioProcessingSettings>
}

export interface AudioEngineQueueItem {
  id: string
  source: string
  title?: string
  artist?: string
  album?: string
  duration?: number
  codec?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
}

export interface PlaybackInfo {
  state: 'stopped' | 'playing' | 'paused'
  position: number
  duration: number
  volume: number
  queueIndex: number
  playMode: PlayMode
  source: string
  codec: string
  bitrate: number
  sourceSampleRate: number
  sourceBitDepth: number
  outputBackend: string
  outputDevice: string
  outputInfo: OutputInfo
  outputSampleRate: number
  outputBitDepth: number
  channelCount: number
  bitPerfect: boolean
  dspActive: boolean
  resampleReason: string
  dsdMode: string
  gaplessActive: boolean
  preloadReady: boolean
  upcomingTrack: AudioEngineQueueItem | null
}

export interface OutputInfo {
  exclusive: boolean
  bitPerfect: boolean
  resampled: boolean
  outputSampleRate: number
  outputBitDepth: number
  backend: string
  deviceName: string
}

export interface AudioEnginePlayResult {
  nativeStarted: boolean
}

interface NativeAudioBinding {
  Play: (source: string, startTime?: number) => void
  Pause: () => void
  Stop: () => void
  Seek: (time: number) => void
  SetVolume: (volume: number) => void
  SetOutputDevice: (device: string) => void
  SetOutputBackend: (backend: string) => void
  LoadQueue?: (queueJson: string, startIndex: number) => void
  Next?: () => void
  Previous?: () => void
  SetPlayMode?: (mode: PlayMode) => void
  SetDspConfig?: (json: string) => void
  GetPlaybackInfo?: () => string | PlaybackInfo
  GetUpcomingTrack?: () => string | AudioEngineQueueItem | null
  GetSpectrumData?: (points?: number) => number[]
  EnumerateDevices?: () => string | AudioDeviceOption[]
  EnumerateBackends?: () => string
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
    description: '专业声卡驱动输出；配置声卡开发包后编译启用。',
    platform: 'win32',
    supportsExclusive: true
  },
  {
    id: 'coreaudio',
    label: '苹果系统音频',
    description: '苹果系统原生音频输出后端。',
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

const DEFAULT_EQ_BANDS: EqualizerBand[] = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000
].map((frequency) => ({
  frequency,
  gain: 0,
  q: 1,
  filterType: 'peak'
}))

export const DEFAULT_AUDIO_PROCESSING: AudioProcessingSettings = {
  highResolution: true,
  dsdToPcm: true,
  eqEnabled: false,
  eqMode: 'graphic',
  eqPreamp: 0,
  eqBands: DEFAULT_EQ_BANDS,
  volumeNormalization: 'off',
  replayGainPreamp: 0,
  replayGainFallback: 0,
  replayGainClip: true,
  gapless: true,
  crossfadeSeconds: 0
}

function isAudioOutputId(output: unknown): output is AudioOutputId {
  return output === 'wasapi' || output === 'asio' || output === 'coreaudio' || output === 'alsa'
}

export function getAudioOutputOptions(
  platform: NodeJS.Platform = process.platform
): AudioOutputOption[] {
  return AUDIO_OUTPUT_OPTIONS.filter((option) => option.platform === platform)
}

function getDefaultAudioOutput(platform: NodeJS.Platform = process.platform): AudioOutputId {
  return getAudioOutputOptions(platform)[0]?.id ?? 'alsa'
}

export function normalizeAudioOutput(
  output: unknown,
  platform: NodeJS.Platform = process.platform
): AudioOutputId {
  const options = getAudioOutputOptions(platform)
  if (isAudioOutputId(output) && options.some((option) => option.id === output)) return output
  return getDefaultAudioOutput(platform)
}

function supportsAudioExclusive(output: AudioOutputId): boolean {
  return getAudioOutputOptions().some((option) => option.id === output && option.supportsExclusive)
}

function normalizeAudioDevice(device: unknown): string {
  return typeof device === 'string' && device.trim() ? device.trim() : 'auto'
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function normalizeEqualizerFilterType(value: unknown): EqualizerFilterType {
  if (
    value === 'lowShelf' ||
    value === 'highShelf' ||
    value === 'bandPass' ||
    value === 'lowPass' ||
    value === 'highPass' ||
    value === 'allPass'
  ) {
    return value
  }
  return 'peak'
}

export function normalizeAudioProcessingSettings(
  settings?: Partial<AudioProcessingSettings>
): AudioProcessingSettings {
  const rawBands = Array.isArray(settings?.eqBands) ? settings.eqBands : DEFAULT_EQ_BANDS
  const eqBands = DEFAULT_EQ_BANDS.map((defaultBand, index) => {
    const band = rawBands[index] ?? defaultBand
    return {
      frequency: clampNumber(band.frequency, 20, 24000, defaultBand.frequency),
      gain: clampNumber(band.gain, -12, 12, 0),
      q: clampNumber(band.q, 0.25, 8, 1),
      filterType: normalizeEqualizerFilterType(band.filterType)
    }
  })

  const volumeNormalization: VolumeNormalizationMode =
    settings?.volumeNormalization === 'track' ||
    settings?.volumeNormalization === 'album' ||
    settings?.volumeNormalization === 'loudnorm'
      ? settings.volumeNormalization
      : 'off'

  return {
    highResolution: settings?.highResolution !== false,
    dsdToPcm: settings?.dsdToPcm !== false,
    eqEnabled: settings?.eqEnabled === true,
    eqMode: settings?.eqMode === 'parametric' ? 'parametric' : 'graphic',
    eqPreamp: clampNumber(settings?.eqPreamp, -12, 12, 0),
    eqBands,
    volumeNormalization,
    replayGainPreamp: clampNumber(settings?.replayGainPreamp, -12, 12, 0),
    replayGainFallback: clampNumber(settings?.replayGainFallback, -12, 12, 0),
    replayGainClip: settings?.replayGainClip !== false,
    gapless: settings?.gapless !== false,
    crossfadeSeconds: clampNumber(settings?.crossfadeSeconds, 0, 12, 0)
  }
}

function parseNativeJson<T>(value: string | T | undefined, fallback: T): T {
  if (typeof value !== 'string') return value ?? fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function getNativeAddonCandidates(): string[] {
  const binary = 'twilight_audio_node.node'
  return [
    join(process.resourcesPath ?? '', 'audio-engine', binary),
    join(app.getAppPath(), 'resources', 'audio-engine', binary),
    join(app.getAppPath(), 'audio-engine', 'build', 'default', binary),
    join(app.getAppPath(), 'audio-engine', 'build', 'mingw-static', binary),
    join(app.getAppPath(), 'audio-engine', 'build', 'windows-msvc', binary),
    join(app.getAppPath(), '..', 'audio-engine', 'build', 'default', binary),
    join(app.getAppPath(), '..', 'audio-engine', 'build', 'mingw-static', binary),
    join(app.getAppPath(), '..', 'audio-engine', 'build', 'windows-msvc', binary)
  ]
}

function loadNativeBinding(): NativeAudioBinding | null {
  for (const candidate of getNativeAddonCandidates()) {
    if (!existsSync(candidate)) continue
    try {
      // Native addons must be loaded dynamically because the file is produced by CMake.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(candidate) as NativeAudioBinding
    } catch (err) {
      console.warn('原生音频模块加载失败：', candidate, err)
    }
  }
  return null
}

function createDefaultPlaybackInfo(output: AudioOutputId, device: string): PlaybackInfo {
  const exclusive = output !== 'wasapi'
  const outputInfo: OutputInfo = {
    exclusive,
    bitPerfect: exclusive,
    resampled: false,
    outputSampleRate: 0,
    outputBitDepth: 0,
    backend: output,
    deviceName: device
  }
  return {
    state: 'stopped',
    position: 0,
    duration: 0,
    volume: 1,
    queueIndex: -1,
    playMode: 'sequential',
    source: '',
    codec: '未知',
    bitrate: 0,
    sourceSampleRate: 0,
    sourceBitDepth: 0,
    outputBackend: output,
    outputDevice: device,
    outputInfo,
    outputSampleRate: 0,
    outputBitDepth: 0,
    channelCount: 0,
    bitPerfect: exclusive,
    dspActive: false,
    resampleReason: output === 'wasapi' ? '共享输出经过系统混音' : '',
    dsdMode: 'unsupported',
    gaplessActive: false,
    preloadReady: false,
    upcomingTrack: null
  }
}

function inferCodec(source: string): string {
  const ext = source.split('.').pop()?.toLowerCase()
  if (!ext) return '未知'
  if (ext === 'm4a' || ext === 'mp4') return 'aac/alac'
  if (ext === 'aif' || ext === 'aiff') return 'aiff'
  if (ext === 'dsf' || ext === 'dff') return 'dsd'
  return ext
}

export class AudioEngineManager extends EventEmitter {
  private native = loadNativeBinding()
  private output: AudioOutputId
  private device: string
  private exclusiveMode: boolean
  private processing: AudioProcessingSettings
  private queue: AudioEngineQueueItem[] = []
  private playbackInfo: PlaybackInfo
  private timer: NodeJS.Timeout | null = null
  private lastTick = Date.now()
  private destroyed = false
  private nativePlaybackActive = false

  constructor(config: AudioEngineConfig = { exclusiveMode: false }) {
    super()
    this.output = normalizeAudioOutput(config.audioOutput)
    this.device = normalizeAudioDevice(config.audioDevice)
    this.exclusiveMode = config.exclusiveMode && supportsAudioExclusive(this.output)
    this.processing = normalizeAudioProcessingSettings(config.audioProcessing)
    this.playbackInfo = createDefaultPlaybackInfo(this.output, this.device)
    this.playbackInfo.outputBackend = this.getNativeBackendId()
    this.updateBitPerfect()
  }

  async start(): Promise<void> {
    this.tryNative('初始化输出后端', (native) => native.SetOutputBackend(this.getNativeBackendId()))
    this.tryNative('初始化输出设备', (native) => native.SetOutputDevice(this.device))
    this.tryNative('初始化 DSP 配置', (native) => native.SetDspConfig?.(JSON.stringify(this.processing)))
    this.startClock()
    setImmediate(() => this.emit('ready'))
  }

  async play(source: string, startTime = 0): Promise<AudioEnginePlayResult> {
    if (!source) throw new Error('音频地址为空')
    const current = this.queue[this.playbackInfo.queueIndex]
    const duration = current?.source === source ? current.duration ?? 0 : 0
    const nativeStarted = this.tryNative('播放', (native) => native.Play(source, startTime))
    this.nativePlaybackActive = nativeStarted
    const nativeInfo = nativeStarted ? this.readNativePlaybackInfo() : null
    this.playbackInfo = {
      ...this.playbackInfo,
      state: 'playing',
      position: Math.max(0, Number.isFinite(startTime) ? startTime : 0),
      duration,
      source,
      codec: inferCodec(source),
      dsdMode: /\.(dsf|dff)$/i.test(source) ? 'native-pending' : 'pcm',
      ...nativeInfo
    }
    this.lastTick = Date.now()
    this.emit('start-file')
    this.publishProperty('duration', this.playbackInfo.duration)
    this.publishProperty('pause', false)
    this.publishPlaybackInfo()
    return { nativeStarted }
  }

  async togglePause(): Promise<void> {
    this.tryNative('暂停/继续', (native) => native.Pause())
    this.playbackInfo.state = this.playbackInfo.state === 'paused' ? 'playing' : 'paused'
    this.lastTick = Date.now()
    this.publishProperty('pause', this.playbackInfo.state !== 'playing')
    this.publishPlaybackInfo()
  }

  async pause(): Promise<void> {
    await this.togglePause()
  }

  async seek(time: number): Promise<void> {
    const position = Math.max(0, Number.isFinite(time) ? time : 0)
    this.tryNative('跳转', (native) => native.Seek(position))
    this.playbackInfo.position = position
    this.lastTick = Date.now()
    this.publishProperty('time-pos', position)
    this.publishPlaybackInfo()
  }

  async setVolume(volume: number): Promise<void> {
    const normalized = clampNumber(volume, 0, 1, 1)
    this.tryNative('设置音量', (native) => native.SetVolume(normalized))
    this.playbackInfo.volume = normalized
    this.updateBitPerfect()
    this.publishPlaybackInfo()
  }

  async stop(): Promise<void> {
    this.tryNative('停止', (native) => native.Stop())
    this.nativePlaybackActive = false
    this.playbackInfo.state = 'stopped'
    this.playbackInfo.position = 0
    this.publishProperty('pause', true)
    this.publishProperty('eof-reached', false)
    this.publishPlaybackInfo()
  }

  async loadQueue(items: AudioEngineQueueItem[], startIndex = 0): Promise<void> {
    this.queue = [...items]
    this.playbackInfo.queueIndex = this.queue.length > 0 ? Math.min(Math.max(0, startIndex), this.queue.length - 1) : -1
    this.tryNative('加载队列', (native) =>
      native.LoadQueue?.(JSON.stringify(this.queue), this.playbackInfo.queueIndex)
    )
    this.emit('queue-change', this.queue)
  }

  async next(): Promise<void> {
    if (this.queue.length === 0) return
    if (this.nativePlaybackActive && this.native?.Next && this.tryNative('下一首', (native) => native.Next?.())) {
      const nativeInfo = this.readNativePlaybackInfo()
      if (nativeInfo) {
        this.playbackInfo = { ...this.playbackInfo, ...nativeInfo }
      }
      this.emit('start-file')
      this.publishPlaybackInfo()
      return
    }
    const nextIndex = (this.playbackInfo.queueIndex + 1) % this.queue.length
    this.playbackInfo.queueIndex = nextIndex
    this.tryNative('下一首', (native) => native.Next?.())
    await this.play(this.queue[nextIndex].source, 0)
  }

  async previous(): Promise<void> {
    if (this.queue.length === 0) return
    if (this.nativePlaybackActive && this.native?.Previous && this.tryNative('上一首', (native) => native.Previous?.())) {
      const nativeInfo = this.readNativePlaybackInfo()
      if (nativeInfo) {
        this.playbackInfo = { ...this.playbackInfo, ...nativeInfo }
      }
      this.emit('start-file')
      this.publishPlaybackInfo()
      return
    }
    const nextIndex =
      this.playbackInfo.queueIndex <= 0 ? this.queue.length - 1 : this.playbackInfo.queueIndex - 1
    this.playbackInfo.queueIndex = nextIndex
    this.tryNative('上一首', (native) => native.Previous?.())
    await this.play(this.queue[nextIndex].source, 0)
  }

  async setExclusiveMode(enabled: boolean): Promise<AudioOutputState> {
    if (enabled && !supportsAudioExclusive(this.output)) {
      throw new Error(`${this.output} 不支持独占模式`)
    }
    this.exclusiveMode = enabled
    this.tryNative('切换独占模式', (native) => native.SetOutputBackend(this.getNativeBackendId()))
    this.playbackInfo.outputBackend = this.getNativeBackendId()
    this.updateBitPerfect()
    return await this.getAudioOutputState()
  }

  async getExclusiveMode(): Promise<boolean> {
    return this.exclusiveMode
  }

  async setAudioOutput(output: AudioOutputId, device?: string): Promise<AudioOutputState> {
    this.output = normalizeAudioOutput(output)
    this.device = normalizeAudioDevice(device ?? this.device)
    if (!supportsAudioExclusive(this.output)) this.exclusiveMode = false
    this.tryNative('切换输出后端', (native) => native.SetOutputBackend(this.getNativeBackendId()))
    this.tryNative('切换输出设备', (native) => native.SetOutputDevice(this.device))
    this.playbackInfo.outputBackend = this.getNativeBackendId()
    this.playbackInfo.outputDevice = this.device
    this.updateBitPerfect()
    return await this.getAudioOutputState()
  }

  async setAudioDevice(device: string): Promise<AudioOutputState> {
    this.device = normalizeAudioDevice(device)
    this.tryNative('切换输出设备', (native) => native.SetOutputDevice(this.device))
    this.playbackInfo.outputDevice = this.device
    return await this.getAudioOutputState()
  }

  async getAudioOutput(): Promise<AudioOutputId> {
    return this.output
  }

  getAudioOutputOptions(): AudioOutputOption[] {
    return getAudioOutputOptions()
  }

  async getAudioOutputState(): Promise<AudioOutputState> {
    return {
      output: this.output,
      device: this.device,
      exclusiveMode: this.exclusiveMode,
      exclusiveAvailable: supportsAudioExclusive(this.output),
      outputOptions: getAudioOutputOptions(),
      deviceOptions: this.getAudioDeviceOptions()
    }
  }

  async setAudioProcessing(
    settings: Partial<AudioProcessingSettings>
  ): Promise<AudioProcessingSettings> {
    this.processing = normalizeAudioProcessingSettings(settings)
    this.tryNative('更新 DSP 配置', (native) => native.SetDspConfig?.(JSON.stringify(this.processing)))
    this.updateBitPerfect()
    this.publishPlaybackInfo()
    return this.processing
  }

  getAudioProcessing(): AudioProcessingSettings {
    return this.processing
  }

  async setPlayMode(mode: PlayMode): Promise<void> {
    this.playbackInfo.playMode = mode
    this.tryNative('切换播放模式', (native) => native.SetPlayMode?.(mode))
    const nativeInfo = this.readNativePlaybackInfo()
    if (nativeInfo) this.playbackInfo = { ...this.playbackInfo, ...nativeInfo }
    this.publishPlaybackInfo()
  }

  getUpcomingTrack(): AudioEngineQueueItem | null {
    try {
      return parseNativeJson(this.native?.GetUpcomingTrack?.(), null as AudioEngineQueueItem | null)
    } catch {
      return this.playbackInfo.upcomingTrack
    }
  }

  async getPlaybackInfo(): Promise<PlaybackInfo> {
    if (this.nativePlaybackActive) {
      const nativeInfo = this.readNativePlaybackInfo()
      if (nativeInfo) {
        this.playbackInfo = { ...this.playbackInfo, ...nativeInfo }
      }
    }
    return { ...this.playbackInfo }
  }

  getSpectrumData(points = 64): number[] {
    try {
      const nativeSpectrum = this.native?.GetSpectrumData?.(points)
      if (nativeSpectrum) return [...nativeSpectrum]
    } catch {
      // Keep the visualizer alive while native playback is still optional.
    }
    return Array.from({ length: points }, (_, index) => {
      const x = index / Math.max(1, points - 1)
      return (Math.sin((x * 12 + this.playbackInfo.position) * Math.PI) + 1) * 0.25
    })
  }

  destroy(): void {
    this.destroyed = true
    this.nativePlaybackActive = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.tryNative('销毁停止', (native) => native.Stop())
  }

  private startClock(): void {
    if (this.timer) return
    this.lastTick = Date.now()
    this.timer = setInterval(() => this.tick(), 250)
  }

  private readNativePlaybackInfo(): PlaybackInfo | null {
    try {
      return parseNativeJson(this.native?.GetPlaybackInfo?.(), null as PlaybackInfo | null)
    } catch {
      return null
    }
  }

  private tick(): void {
    if (this.destroyed) return

    if (this.nativePlaybackActive) {
      const wasPlaying = this.playbackInfo.state === 'playing'
      const nativeInfo = this.readNativePlaybackInfo()
      if (nativeInfo) {
        this.playbackInfo = { ...this.playbackInfo, ...nativeInfo }
        this.lastTick = Date.now()
        this.publishProperty('time-pos', this.playbackInfo.position)
        if (this.playbackInfo.duration > 0) {
          this.publishProperty('duration', this.playbackInfo.duration)
        }
        this.publishPlaybackInfo()
        if (wasPlaying && nativeInfo.state === 'stopped') {
          this.nativePlaybackActive = false
          this.publishProperty('eof-reached', true)
          this.emit('end-file', { reason: 'eof' })
        }
      }
      return
    }

    if (this.playbackInfo.state !== 'playing') return
    const now = Date.now()
    const elapsed = (now - this.lastTick) / 1000
    this.lastTick = now
    this.playbackInfo.position += elapsed
    if (
      this.playbackInfo.duration > 0 &&
      this.playbackInfo.position >= this.playbackInfo.duration
    ) {
      this.playbackInfo.position = this.playbackInfo.duration
      this.playbackInfo.state = 'stopped'
      this.publishProperty('time-pos', this.playbackInfo.position)
      this.publishProperty('eof-reached', true)
      this.emit('end-file', { reason: 'eof' })
      return
    }
    this.publishProperty('time-pos', this.playbackInfo.position)
  }

  private getNativeBackendId(): string {
    if (this.output === 'wasapi' && this.exclusiveMode) return 'wasapi-exclusive'
    return this.output
  }

  private getAudioDeviceOptions(): AudioDeviceOption[] {
    try {
      const nativeDevices = parseNativeJson(
        this.native?.EnumerateDevices?.(),
        null as AudioDeviceOption[] | null
      )
      if (nativeDevices && Array.isArray(nativeDevices) && nativeDevices.length > 0) {
        return nativeDevices
      }
    } catch {
      // Fall through to the stable default device.
    }
    return [{ id: 'auto', label: '系统默认', isDefault: true }]
  }

  private tryNative(context: string, command: (native: NativeAudioBinding) => void): boolean {
    if (!this.native) return false
    try {
      command(this.native)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`原生音频引擎${context}失败，使用临时播放通道：`, message)
      return false
    }
  }

  private updateBitPerfect(): void {
    const dspActive =
      this.processing.eqEnabled ||
      this.processing.volumeNormalization !== 'off' ||
      Math.abs(this.processing.eqPreamp) > 0.001 ||
      Math.abs(this.playbackInfo.volume - 1) > 0.001
    const shared = this.output === 'wasapi' && !this.exclusiveMode
    this.playbackInfo.dspActive = dspActive
    this.playbackInfo.bitPerfect = !dspActive && !shared
    this.playbackInfo.outputInfo = {
      ...this.playbackInfo.outputInfo,
      exclusive: !shared,
      bitPerfect: this.playbackInfo.bitPerfect,
      resampled: this.nativePlaybackActive ? this.playbackInfo.outputInfo.resampled : false,
      outputSampleRate: this.playbackInfo.outputSampleRate,
      outputBitDepth: this.playbackInfo.outputBitDepth,
      backend: this.playbackInfo.outputBackend,
      deviceName: this.playbackInfo.outputInfo.deviceName || this.playbackInfo.outputDevice
    }
    this.playbackInfo.resampleReason = shared ? '共享输出经过系统混音' : ''
  }

  private publishProperty(name: string, data: unknown): void {
    this.emit('property-change', { name, data })
  }

  private publishPlaybackInfo(): void {
    this.emit('playback-info', { ...this.playbackInfo })
  }
}
