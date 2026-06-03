import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export type AudioOutputId = 'wasapi' | 'asio' | 'coreaudio' | 'alsa'
export type PlayMode = 'sequential' | 'repeat' | 'shuffle'
export type EqMode = 'graphic' | 'parametric'
export type VolumeNormalizationMode = 'off' | 'track' | 'album' | 'loudnorm'
export type ChannelRoutingMode =
  | 'auto'
  | 'stereo'
  | 'stereo-to-5.1'
  | 'stereo-to-7.1'
  | 'mono-to-stereo'
  | 'mono-to-multichannel'
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
  dspEnabled: boolean
  clipGuard: boolean
  fftEnabled: boolean
  fftResolution: number
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
  convolverIrPath: string
  crossfeedEnabled: boolean
  crossfeedStrength: number
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
  backend?: string
  name?: string
  channels?: number
  sampleRates?: number[]
  driverName?: string
  driverVersion?: number
  bitDepths?: number[]
  latencyFrames?: number
  minBufferSize?: number
  maxBufferSize?: number
  granularity?: number
  preferredBufferSize?: number
  capabilityVersion?: number
}

export interface OutputConfig {
  preferredBufferSize: number
  routingMode: ChannelRoutingMode
}

export interface LatencyInfo {
  bufferLatencyMs: number
  outputLatencyMs: number
  totalLatencyMs: number
}

export interface OutputDiagnostics {
  sessionUnderrunCount: number
  sessionBufferDropCount: number
  sessionRecoveryCount: number
  lifetimeUnderrunCount: number
  lifetimeBufferDropCount: number
  lifetimeRecoveryCount: number
  driverRestartCount: number
  deviceLostCount: number
  lastError: string
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
  audioOutputConfig?: Partial<OutputConfig>
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

export type PlaybackOutputInfoMirror = Pick<
  OutputInfo,
  | 'actualBackend'
  | 'actualOutputFormat'
  | 'actualSampleRate'
  | 'actualBitDepth'
  | 'actualChannels'
  | 'bufferSizeFrames'
  | 'latencyFrames'
  | 'latencyMs'
  | 'latencyInfo'
  | 'channelRoutingMode'
  | 'supportsOutputPerfect'
  | 'sourceExact'
  | 'diagnostics'
  | 'deviceRecovered'
  | 'recoveryCount'
  | 'outputSampleRate'
  | 'outputBitDepth'
  | 'outputPerfect'
  | 'pcmPassthrough'
  | 'perfectReason'
  | 'isDsd'
  | 'dsdMode'
  | 'dsdRate'
>

export interface PlaybackInfo extends PlaybackOutputInfoMirror {
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
  decodedSampleRate: number
  decodedBitDepth: number
  decodedChannels: number
  decodedSampleFormat: string
  outputBackend: string
  outputDevice: string
  outputInfo: OutputInfo
  actualBackend: string
  driverName: string
  driverVersion: number
  actualOutputFormat: string
  actualSampleRate: number
  actualBitDepth: number
  actualChannels: number
  bufferSizeFrames: number
  latencyFrames: number
  latencyMs: number
  latencyInfo: LatencyInfo
  channelRoutingMode: string
  supportsOutputPerfect: boolean
  sourceExact: boolean
  diagnostics: OutputDiagnostics
  deviceRecovered: boolean
  recoveryCount: number
  outputSampleRate: number
  outputBitDepth: number
  channelCount: number
  outputPerfect: boolean
  pcmPassthrough: boolean
  dspActive: boolean
  replayGainActive: boolean
  eqActive: boolean
  convolverActive: boolean
  crossfeedActive: boolean
  crossfadeActive: boolean
  fftActive: boolean
  irResampled: boolean
  replayGainDb: number
  crossfeedStrength: number
  crossfadeSeconds: number
  convolverLatencyFrames: number
  partitionSize: number
  channelMappingMode: string
  perfectReason: string
  isDsd: boolean
  dsdMode: string
  dsdRate: number
  gaplessActive: boolean
  preloadReady: boolean
  upcomingTrack: AudioEngineQueueItem | null
}

export interface OutputInfo {
  exclusive: boolean
  supportsOutputPerfect: boolean
  sourceExact: boolean
  outputPerfect: boolean
  pcmPassthrough: boolean
  resampled: boolean
  perfectReason: string
  outputSampleRate: number
  outputBitDepth: number
  backend: string
  actualBackend: string
  deviceName: string
  actualDeviceName: string
  driverName: string
  actualDriverName: string
  driverVersion: number
  actualDriverVersion: number
  actualOutputFormat: string
  actualSampleRate: number
  actualBitDepth: number
  actualChannels: number
  bufferSizeFrames: number
  latencyFrames: number
  latencyMs: number
  latencyInfo: LatencyInfo
  channelRoutingMode: string
  diagnostics: OutputDiagnostics
  deviceRecovered: boolean
  recoveryCount: number
  isDsd: boolean
  dsdMode: string
  dsdRate: number
}

export interface AudioEnginePlayResult {
  nativeStarted: boolean
  fallbackReason: string
}

interface NativeAudioBinding {
  Play: (source: string, startTime?: number) => void
  Pause: () => void
  Stop: () => void
  Seek: (time: number) => void
  SetVolume: (volume: number) => void
  SetOutputDevice: (device: string) => void
  SetOutputBackend: (backend: string) => void
  SetOutputConfig?: (json: string) => void
  LoadQueue?: (queueJson: string, startIndex: number) => void
  Next?: () => void
  Previous?: () => void
  SetPlayMode?: (mode: PlayMode) => void
  SetDspConfig?: (json: string) => void
  LoadImpulseResponse?: (path: string) => void
  UnloadImpulseResponse?: () => void
  GetConvolverInfo?: () => string | ConvolverInfo
  SetEqBands?: (json: string) => void
  SetEqPreset?: (json: string) => void
  SetCrossfeedStrength?: (strength: number) => void
  SetReplayGainMode?: (
    mode: VolumeNormalizationMode,
    preamp: number,
    fallback: number,
    clip: boolean
  ) => void
  GetMetadata?: (source: string) => string | NativeAudioMetadata
  GetPlaybackInfo?: () => string | PlaybackInfo
  GetUpcomingTrack?: () => string | AudioEngineQueueItem | null
  GetSpectrumData?: (points?: number) => number[]
  EnumerateDevices?: () => string | AudioDeviceOption[]
  EnumerateBackends?: () => string
  GetEngineCapabilities?: () => string
  GetLastError?: () => string
}

export interface ConvolverInfo {
  loaded: boolean
  active: boolean
  irResampled: boolean
  path: string
  sampleRate: number
  channels: number
  lengthFrames: number
  lengthMs: number
  partitionSize: number
  latencyFrames: number
  channelMappingMode: string
  warning: string
  lastError: string
}

export interface NativeAudioMetadata {
  source: string
  title: string
  artist: string
  album: string
  albumArtist: string
  composer: string
  year: string
  genre: string
  trackNumber: string
  discNumber: string
  comment: string
  codec: string
  container: string
  channelLayout: string
  sampleRate: number
  channelCount: number
  bitDepth: number
  bitrate: number
  duration: number
  isDsd: boolean
  dsdMode: string
  dsdRate: number
  coverMime: string
  coverDataBase64: string
  replayGainTrackGain: number | null
  replayGainAlbumGain: number | null
  r128TrackGain: number | null
  r128AlbumGain: number | null
  error: string
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
    supportsExclusive: false
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
  dspEnabled: false,
  clipGuard: true,
  fftEnabled: true,
  fftResolution: 64,
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
  convolverIrPath: '',
  crossfeedEnabled: false,
  crossfeedStrength: 0,
  gapless: true,
  crossfadeSeconds: 0
}

const DEFAULT_OUTPUT_CONFIG: OutputConfig = {
  preferredBufferSize: 0,
  routingMode: 'auto'
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

function normalizeChannelRoutingMode(value: unknown): ChannelRoutingMode {
  return value === 'stereo' ||
    value === 'stereo-to-5.1' ||
    value === 'stereo-to-7.1' ||
    value === 'mono-to-stereo' ||
    value === 'mono-to-multichannel'
    ? value
    : 'auto'
}

function normalizeOutputConfig(config?: Partial<OutputConfig>): OutputConfig {
  return {
    preferredBufferSize: Number.isFinite(config?.preferredBufferSize)
      ? clampNumber(Math.trunc(config?.preferredBufferSize ?? 0), 0, 8192, 0)
      : DEFAULT_OUTPUT_CONFIG.preferredBufferSize,
    routingMode: normalizeChannelRoutingMode(config?.routingMode)
  }
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
    dspEnabled: settings?.dspEnabled === true,
    clipGuard: settings?.clipGuard !== false,
    fftEnabled: settings?.fftEnabled !== false,
    fftResolution: clampNumber(settings?.fftResolution, 64, 2048, 64),
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
    convolverIrPath: typeof settings?.convolverIrPath === 'string' ? settings.convolverIrPath : '',
    crossfeedEnabled: settings?.crossfeedEnabled === true,
    crossfeedStrength: clampNumber(settings?.crossfeedStrength, 0, 1, 0),
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

function rendererFallbackAllowed(): boolean {
  return process.env.TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK === '1'
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

function createDefaultPlaybackInfo(
  output: AudioOutputId,
  device: string,
  exclusiveMode: boolean,
  outputConfig: OutputConfig
): PlaybackInfo {
  const exclusive = output === 'wasapi' ? exclusiveMode : output === 'asio'
  const supportsOutputPerfect = output === 'asio' || (output === 'wasapi' && exclusiveMode)
  const perfectReason = supportsOutputPerfect
    ? ''
    : output === 'wasapi'
      ? '共享输出经过系统混音'
      : output === 'coreaudio'
        ? 'CoreAudio 默认输出可能经过系统混音或格式转换'
        : output === 'alsa'
          ? 'ALSA 当前设备未声明 hw 直连 bit-perfect 能力'
          : '当前输出路径未声明 bit-perfect 能力'
  const latencyInfo: LatencyInfo = {
    bufferLatencyMs: 0,
    outputLatencyMs: 0,
    totalLatencyMs: 0
  }
  const diagnostics: OutputDiagnostics = {
    sessionUnderrunCount: 0,
    sessionBufferDropCount: 0,
    sessionRecoveryCount: 0,
    lifetimeUnderrunCount: 0,
    lifetimeBufferDropCount: 0,
    lifetimeRecoveryCount: 0,
    driverRestartCount: 0,
    deviceLostCount: 0,
    lastError: ''
  }
  const outputInfo: OutputInfo = {
    exclusive,
    supportsOutputPerfect,
    sourceExact: false,
    outputPerfect: false,
    pcmPassthrough: false,
    resampled: false,
    perfectReason,
    outputSampleRate: 0,
    outputBitDepth: 0,
    backend: output,
    actualBackend: output,
    deviceName: device,
    actualDeviceName: device,
    driverName: '',
    actualDriverName: '',
    driverVersion: 0,
    actualDriverVersion: 0,
    actualOutputFormat: '',
    actualSampleRate: 0,
    actualBitDepth: 0,
    actualChannels: 0,
    bufferSizeFrames: 0,
    latencyFrames: 0,
    latencyMs: 0,
    latencyInfo,
    channelRoutingMode: outputConfig.routingMode,
    diagnostics,
    deviceRecovered: false,
    recoveryCount: 0,
    isDsd: false,
    dsdMode: 'pcm',
    dsdRate: 0
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
    decodedSampleRate: 0,
    decodedBitDepth: 0,
    decodedChannels: 0,
    decodedSampleFormat: '',
    outputBackend: output,
    outputDevice: device,
    outputInfo,
    actualBackend: output,
    driverName: '',
    driverVersion: 0,
    actualOutputFormat: '',
    actualSampleRate: 0,
    actualBitDepth: 0,
    actualChannels: 0,
    bufferSizeFrames: 0,
    latencyFrames: 0,
    latencyMs: 0,
    latencyInfo,
    channelRoutingMode: outputConfig.routingMode,
    supportsOutputPerfect,
    sourceExact: false,
    diagnostics,
    deviceRecovered: false,
    recoveryCount: 0,
    outputSampleRate: 0,
    outputBitDepth: 0,
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
    channelMappingMode: '',
    perfectReason,
    isDsd: false,
    dsdMode: 'pcm',
    dsdRate: 0,
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

function sourceLooksDsd(source: string): boolean {
  return /\.(dsf|dff)$/i.test(source)
}

export class AudioEngineManager extends EventEmitter {
  private native = loadNativeBinding()
  private output: AudioOutputId
  private device: string
  private exclusiveMode: boolean
  private outputConfig: OutputConfig
  private processing: AudioProcessingSettings
  private queue: AudioEngineQueueItem[] = []
  private playbackInfo: PlaybackInfo
  private timer: NodeJS.Timeout | null = null
  private lastTick = Date.now()
  private destroyed = false
  private nativePlaybackActive = false
  private lastNativeError = ''

  constructor(config: AudioEngineConfig = { exclusiveMode: false }) {
    super()
    this.output = normalizeAudioOutput(config.audioOutput)
    this.device = normalizeAudioDevice(config.audioDevice)
    this.exclusiveMode = config.exclusiveMode && supportsAudioExclusive(this.output)
    this.outputConfig = normalizeOutputConfig(config.audioOutputConfig)
    this.processing = normalizeAudioProcessingSettings(config.audioProcessing)
    this.playbackInfo = createDefaultPlaybackInfo(
      this.output,
      this.device,
      this.exclusiveMode,
      this.outputConfig
    )
    this.resetOutputInfoDefaults()
    this.updateOutputPerfect()
  }

  async start(): Promise<void> {
    this.tryNative('初始化输出后端', (native) => native.SetOutputBackend(this.getNativeBackendId()))
    this.tryNative('初始化输出设备', (native) => native.SetOutputDevice(this.device))
    this.applyNativeOutputConfig('初始化输出配置')
    this.applyNativeDspSettings('初始化 DSP 配置')
    this.startClock()
    setImmediate(() => this.emit('ready'))
  }

  async play(source: string, startTime = 0): Promise<AudioEnginePlayResult> {
    if (!source) throw new Error('音频地址为空')
    const current = this.queue[this.playbackInfo.queueIndex]
    const duration = current?.source === source ? (current.duration ?? 0) : 0
    const nativeStarted = this.tryNative('播放', (native) => native.Play(source, startTime))
    if (!nativeStarted && !rendererFallbackAllowed()) {
      const detail =
        this.lastNativeError ||
        parseNativeJson(this.native?.GetLastError?.(), { message: '' }).message ||
        '原生音频引擎不可用'
      throw new Error(`原生音频播放失败：${detail}`)
    }
    this.nativePlaybackActive = nativeStarted
    const nativeInfo = nativeStarted ? this.readNativePlaybackInfo() : null
    const isDsd = sourceLooksDsd(source)
    this.playbackInfo = {
      ...this.playbackInfo,
      state: 'playing',
      position: Math.max(0, Number.isFinite(startTime) ? startTime : 0),
      duration,
      source,
      codec: inferCodec(source),
      isDsd,
      dsdMode: isDsd ? 'unsupported' : 'pcm',
      dsdRate: 0,
      ...nativeInfo
    }
    this.lastTick = Date.now()
    this.emit('start-file')
    this.publishProperty('duration', this.playbackInfo.duration)
    this.publishProperty('pause', false)
    this.publishPlaybackInfo()
    return {
      nativeStarted,
      fallbackReason: nativeStarted ? '' : this.lastNativeError || '原生音频引擎不可用'
    }
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
    this.updateOutputPerfect()
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
    this.playbackInfo.queueIndex =
      this.queue.length > 0 ? Math.min(Math.max(0, startIndex), this.queue.length - 1) : -1
    this.tryNative('加载队列', (native) =>
      native.LoadQueue?.(JSON.stringify(this.queue), this.playbackInfo.queueIndex)
    )
    this.emit('queue-change', this.queue)
  }

  async next(): Promise<void> {
    if (this.queue.length === 0) return
    if (
      this.nativePlaybackActive &&
      this.native?.Next &&
      this.tryNative('下一首', (native) => native.Next?.())
    ) {
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
    if (
      this.nativePlaybackActive &&
      this.native?.Previous &&
      this.tryNative('上一首', (native) => native.Previous?.())
    ) {
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
    this.applyNativeOutputConfig('切换输出配置')
    this.resetOutputInfoDefaults()
    this.updateOutputPerfect()
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
    this.applyNativeOutputConfig('切换输出配置')
    this.resetOutputInfoDefaults()
    this.updateOutputPerfect()
    return await this.getAudioOutputState()
  }

  async setAudioDevice(device: string): Promise<AudioOutputState> {
    this.device = normalizeAudioDevice(device)
    this.tryNative('切换输出设备', (native) => native.SetOutputDevice(this.device))
    this.playbackInfo.outputDevice = this.device
    this.playbackInfo.outputInfo.deviceName = this.device
    this.playbackInfo.outputInfo.actualDeviceName = this.device
    return await this.getAudioOutputState()
  }

  async setOutputConfig(config: Partial<OutputConfig>): Promise<void> {
    this.outputConfig = normalizeOutputConfig(config)
    this.applyNativeOutputConfig('设置输出配置')
    this.playbackInfo.outputInfo.channelRoutingMode = this.outputConfig.routingMode
    this.playbackInfo.channelRoutingMode = this.outputConfig.routingMode
    this.updateOutputPerfect()
    this.publishPlaybackInfo()
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
    this.applyNativeDspSettings('更新 DSP 配置')
    this.updateOutputPerfect()
    this.publishPlaybackInfo()
    return this.processing
  }

  getAudioProcessing(): AudioProcessingSettings {
    return this.processing
  }

  async loadImpulseResponse(path: string): Promise<ConvolverInfo> {
    this.processing = normalizeAudioProcessingSettings({
      ...this.processing,
      convolverIrPath: path
    })
    this.tryNative('加载脉冲响应', (native) => native.LoadImpulseResponse?.(path))
    this.updateNativeInfoSnapshot()
    return this.getConvolverInfo()
  }

  async unloadImpulseResponse(): Promise<ConvolverInfo> {
    this.processing = normalizeAudioProcessingSettings({
      ...this.processing,
      convolverIrPath: ''
    })
    this.tryNative('卸载脉冲响应', (native) => native.UnloadImpulseResponse?.())
    this.updateNativeInfoSnapshot()
    return this.getConvolverInfo()
  }

  getConvolverInfo(): ConvolverInfo {
    return parseNativeJson(this.native?.GetConvolverInfo?.(), {
      loaded: false,
      active: false,
      irResampled: false,
      path: '',
      sampleRate: 0,
      channels: 0,
      lengthFrames: 0,
      lengthMs: 0,
      partitionSize: 0,
      latencyFrames: 0,
      channelMappingMode: '',
      warning: '',
      lastError: ''
    })
  }

  async setEqBands(settings: Partial<AudioProcessingSettings>): Promise<AudioProcessingSettings> {
    this.processing = normalizeAudioProcessingSettings({ ...this.processing, ...settings })
    this.tryNative('更新均衡器', (native) => native.SetEqBands?.(JSON.stringify(this.processing)))
    this.updateNativeInfoSnapshot()
    return this.processing
  }

  async setEqPreset(preset: {
    eqMode: EqMode
    eqPreamp: number
    eqBands: EqualizerBand[]
  }): Promise<AudioProcessingSettings> {
    this.processing = normalizeAudioProcessingSettings({
      ...this.processing,
      ...preset,
      eqEnabled: true
    })
    this.tryNative('应用均衡器预设', (native) =>
      native.SetEqPreset?.(JSON.stringify(this.processing))
    )
    this.updateNativeInfoSnapshot()
    return this.processing
  }

  async setCrossfeedStrength(strength: number): Promise<AudioProcessingSettings> {
    this.processing = normalizeAudioProcessingSettings({
      ...this.processing,
      crossfeedEnabled: strength > 0,
      crossfeedStrength: strength
    })
    this.tryNative('设置串音强度', (native) =>
      native.SetCrossfeedStrength?.(this.processing.crossfeedStrength)
    )
    this.updateNativeInfoSnapshot()
    return this.processing
  }

  async setReplayGainMode(
    mode: VolumeNormalizationMode,
    preamp = this.processing.replayGainPreamp,
    fallback = this.processing.replayGainFallback,
    clip = this.processing.replayGainClip
  ): Promise<AudioProcessingSettings> {
    this.processing = normalizeAudioProcessingSettings({
      ...this.processing,
      volumeNormalization: mode,
      replayGainPreamp: preamp,
      replayGainFallback: fallback,
      replayGainClip: clip
    })
    this.tryNative('设置 ReplayGain', (native) =>
      native.SetReplayGainMode?.(
        this.processing.volumeNormalization,
        this.processing.replayGainPreamp,
        this.processing.replayGainFallback,
        this.processing.replayGainClip
      )
    )
    this.updateNativeInfoSnapshot()
    return this.processing
  }

  getMetadata(source: string): NativeAudioMetadata | null {
    return parseNativeJson(this.native?.GetMetadata?.(source), null as NativeAudioMetadata | null)
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
      const info = parseNativeJson(this.native?.GetPlaybackInfo?.(), null as PlaybackInfo | null)
      return info ? this.normalizePlaybackInfo(info) : null
    } catch {
      return null
    }
  }

  private normalizePlaybackInfo(info: PlaybackInfo): PlaybackInfo {
    const outputInfo: OutputInfo = {
      ...this.playbackInfo.outputInfo,
      ...(info.outputInfo ?? {})
    }
    const canonicalOutput = info.outputInfo
    const sourceExact = canonicalOutput?.sourceExact === true
    const outputPerfect = canonicalOutput?.outputPerfect === true
    const perfectReason = canonicalOutput?.perfectReason || ''
    const isDsd =
      canonicalOutput?.isDsd === true ||
      canonicalOutput?.dsdMode === 'native' ||
      canonicalOutput?.dsdMode === 'dop' ||
      canonicalOutput?.dsdMode === 'unsupported'
    const dsdMode = isDsd ? canonicalOutput?.dsdMode || 'unsupported' : 'pcm'
    const dsdRate = isDsd ? canonicalOutput?.dsdRate || 0 : 0
    outputInfo.sourceExact = sourceExact
    outputInfo.outputPerfect = outputPerfect
    outputInfo.perfectReason = perfectReason
    outputInfo.isDsd = isDsd
    outputInfo.dsdMode = dsdMode
    outputInfo.dsdRate = dsdRate
    outputInfo.backend = outputInfo.backend || info.outputBackend || this.getNativeBackendId()
    outputInfo.actualBackend = outputInfo.actualBackend || outputInfo.backend
    outputInfo.deviceName = outputInfo.deviceName || info.outputDevice || this.device
    outputInfo.actualDeviceName = outputInfo.actualDeviceName || outputInfo.deviceName
    outputInfo.actualDriverName = outputInfo.actualDriverName || outputInfo.driverName || ''
    outputInfo.actualDriverVersion = outputInfo.actualDriverVersion || info.driverVersion || 0
    outputInfo.pcmPassthrough = outputInfo.pcmPassthrough === true
    outputInfo.latencyInfo = outputInfo.latencyInfo || info.latencyInfo || this.playbackInfo.latencyInfo
    outputInfo.diagnostics =
      outputInfo.diagnostics || info.diagnostics || this.playbackInfo.diagnostics
    return {
      ...info,
      outputInfo,
      outputBackend: outputInfo.backend,
      outputDevice: outputInfo.deviceName,
      actualBackend: outputInfo.actualBackend,
      driverName: outputInfo.driverName || outputInfo.actualDriverName || info.driverName || '',
      driverVersion: outputInfo.driverVersion || outputInfo.actualDriverVersion || info.driverVersion || 0,
      actualOutputFormat: outputInfo.actualOutputFormat || info.actualOutputFormat || '',
      actualSampleRate: outputInfo.actualSampleRate || info.actualSampleRate || 0,
      actualBitDepth: outputInfo.actualBitDepth || info.actualBitDepth || 0,
      actualChannels: outputInfo.actualChannels || info.actualChannels || 0,
      decodedSampleRate: info.decodedSampleRate || 0,
      decodedBitDepth: info.decodedBitDepth || 0,
      decodedChannels: info.decodedChannels || 0,
      decodedSampleFormat: info.decodedSampleFormat || '',
      bufferSizeFrames: outputInfo.bufferSizeFrames || info.bufferSizeFrames || 0,
      latencyFrames: outputInfo.latencyFrames || info.latencyFrames || 0,
      latencyMs: outputInfo.latencyMs || info.latencyMs || 0,
      latencyInfo: outputInfo.latencyInfo,
      channelRoutingMode:
        outputInfo.channelRoutingMode || info.channelRoutingMode || this.outputConfig.routingMode,
      supportsOutputPerfect: outputInfo.supportsOutputPerfect === true,
      sourceExact,
      diagnostics: outputInfo.diagnostics,
      deviceRecovered: outputInfo.deviceRecovered === true,
      recoveryCount: outputInfo.recoveryCount || info.recoveryCount || 0,
      outputSampleRate: outputInfo.outputSampleRate || info.outputSampleRate || 0,
      outputBitDepth: outputInfo.outputBitDepth || info.outputBitDepth || 0,
      channelCount: outputInfo.actualChannels || info.channelCount || 0,
      outputPerfect,
      pcmPassthrough: outputInfo.pcmPassthrough === true,
      isDsd,
      dsdMode,
      dsdRate,
      crossfadeActive: info.crossfadeActive === true || this.processing.crossfadeSeconds > 0,
      crossfadeSeconds: info.crossfadeSeconds || this.processing.crossfadeSeconds || 0,
      perfectReason
    }
  }

  private syncPlaybackOutputMirrorsFromOutputInfo(): void {
    const outputInfo = this.playbackInfo.outputInfo
    this.playbackInfo.supportsOutputPerfect = outputInfo.supportsOutputPerfect === true
    this.playbackInfo.sourceExact = outputInfo.sourceExact === true
    this.playbackInfo.outputPerfect = outputInfo.outputPerfect === true
    this.playbackInfo.pcmPassthrough = outputInfo.pcmPassthrough === true
    this.playbackInfo.perfectReason = outputInfo.perfectReason || ''
    this.playbackInfo.isDsd = outputInfo.isDsd === true
    this.playbackInfo.dsdMode = outputInfo.isDsd === true ? outputInfo.dsdMode || 'unsupported' : 'pcm'
    this.playbackInfo.dsdRate = outputInfo.isDsd === true ? outputInfo.dsdRate || 0 : 0
  }

  private tick(): void {
    if (this.destroyed) return

    if (this.nativePlaybackActive) {
      const wasPlaying = this.playbackInfo.state === 'playing'
      const previousSource = this.playbackInfo.source
      const previousQueueIndex = this.playbackInfo.queueIndex
      const nativeInfo = this.readNativePlaybackInfo()
      if (nativeInfo) {
        this.playbackInfo = { ...this.playbackInfo, ...nativeInfo }
        this.lastTick = Date.now()
        this.publishProperty('time-pos', this.playbackInfo.position)
        if (this.playbackInfo.duration > 0) {
          this.publishProperty('duration', this.playbackInfo.duration)
        }
        this.publishPlaybackInfo()
        const switchedTrack =
          nativeInfo.state !== 'stopped' &&
          ((nativeInfo.source && nativeInfo.source !== previousSource) ||
            (nativeInfo.queueIndex >= 0 && nativeInfo.queueIndex !== previousQueueIndex))
        if (switchedTrack) {
          this.emit('start-file')
        }
        if (wasPlaying && nativeInfo.state === 'stopped') {
          this.nativePlaybackActive = false
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

  private applyNativeDspSettings(context: string): void {
    this.tryNative(context, (native) => {
      native.SetDspConfig?.(JSON.stringify(this.processing))
      native.SetEqBands?.(JSON.stringify(this.processing))
      native.SetReplayGainMode?.(
        this.processing.volumeNormalization,
        this.processing.replayGainPreamp,
        this.processing.replayGainFallback,
        this.processing.replayGainClip
      )
      native.SetCrossfeedStrength?.(
        this.processing.crossfeedEnabled ? this.processing.crossfeedStrength : 0
      )
      if (this.processing.convolverIrPath) {
        native.LoadImpulseResponse?.(this.processing.convolverIrPath)
      } else {
        native.UnloadImpulseResponse?.()
      }
    })
  }

  private applyNativeOutputConfig(context: string): void {
    this.tryNative(context, (native) => {
      native.SetOutputConfig?.(JSON.stringify(this.outputConfig))
    })
  }

  private resetOutputInfoDefaults(): void {
    const fallback = createDefaultPlaybackInfo(
      this.output,
      this.device,
      this.exclusiveMode,
      this.outputConfig
    )
    this.playbackInfo.outputBackend = this.getNativeBackendId()
    this.playbackInfo.outputDevice = this.device
    this.playbackInfo.actualBackend = this.getNativeBackendId()
    this.playbackInfo.outputInfo = {
      ...fallback.outputInfo,
      backend: this.getNativeBackendId(),
      actualBackend: this.getNativeBackendId()
    }
    this.syncPlaybackOutputMirrorsFromOutputInfo()
  }

  private updateNativeInfoSnapshot(): void {
    const nativeInfo = this.readNativePlaybackInfo()
    if (nativeInfo) this.playbackInfo = { ...this.playbackInfo, ...nativeInfo }
    this.updateOutputPerfect()
    this.publishPlaybackInfo()
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
    if (!this.native) {
      this.lastNativeError = '未加载 twilight_audio_node.node'
      return false
    }
    try {
      command(this.native)
      this.lastNativeError = ''
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.lastNativeError = message
      const fallbackHint = rendererFallbackAllowed()
        ? '使用临时播放通道'
        : '已阻止 HTMLAudio 静默降级'
      console.warn(`原生音频引擎${context}失败，${fallbackHint}：`, message)
      return false
    }
  }

  private updateOutputPerfect(): void {
    if (this.nativePlaybackActive) {
      this.playbackInfo = this.normalizePlaybackInfo(this.playbackInfo)
      return
    }

    const dspActive =
      (this.processing.dspEnabled && this.processing.eqEnabled) ||
      (this.processing.dspEnabled && this.processing.volumeNormalization !== 'off') ||
      (this.processing.dspEnabled && this.playbackInfo.convolverActive) ||
      (this.processing.dspEnabled &&
        this.processing.crossfeedEnabled &&
        this.processing.crossfeedStrength > 0) ||
      (this.processing.dspEnabled && Math.abs(this.processing.eqPreamp) > 0.001) ||
      this.processing.crossfadeSeconds > 0 ||
      Math.abs(this.playbackInfo.volume - 1) > 0.001
    const replayGainActive =
      this.processing.dspEnabled && this.processing.volumeNormalization !== 'off'
    const eqActive = this.processing.dspEnabled && this.processing.eqEnabled
    const convolverActive = this.processing.dspEnabled && this.playbackInfo.convolverActive
    const crossfeedActive =
      this.processing.dspEnabled &&
      this.processing.crossfeedEnabled &&
      this.processing.crossfeedStrength > 0
    const crossfadeActive = this.processing.crossfadeSeconds > 0
    const supportsOutputPerfect = this.playbackInfo.outputInfo.supportsOutputPerfect === true
    const outputFormatMatchesSource =
      this.playbackInfo.sourceSampleRate > 0 &&
      this.playbackInfo.outputSampleRate > 0 &&
      this.playbackInfo.sourceSampleRate === this.playbackInfo.outputSampleRate &&
      this.playbackInfo.sourceBitDepth > 0 &&
      this.playbackInfo.outputBitDepth > 0 &&
      this.playbackInfo.sourceBitDepth === this.playbackInfo.outputBitDepth
    const noResample = !this.playbackInfo.outputInfo.resampled
    const shared = this.output === 'wasapi' && !this.exclusiveMode
    const perfectReason =
      this.playbackInfo.outputInfo.perfectReason ||
      (shared
        ? '共享输出经过系统混音'
        : supportsOutputPerfect && !dspActive && noResample && outputFormatMatchesSource
          ? '当前 PCM 渲染路径尚未验证样本级直通'
          : '')
    this.playbackInfo.replayGainActive = replayGainActive
    this.playbackInfo.eqActive = eqActive
    this.playbackInfo.convolverActive = convolverActive
    this.playbackInfo.crossfeedActive = crossfeedActive
    this.playbackInfo.crossfeedStrength = crossfeedActive ? this.processing.crossfeedStrength : 0
    this.playbackInfo.crossfadeActive = crossfadeActive
    this.playbackInfo.crossfadeSeconds = crossfadeActive ? this.processing.crossfadeSeconds : 0
    this.playbackInfo.dspActive = dspActive
    this.playbackInfo.outputInfo = {
      ...this.playbackInfo.outputInfo,
      exclusive:
        this.output === 'wasapi' ? this.exclusiveMode : this.playbackInfo.outputInfo.exclusive,
      supportsOutputPerfect,
      sourceExact: false,
      outputPerfect: false,
      pcmPassthrough: false,
      resampled: this.nativePlaybackActive ? this.playbackInfo.outputInfo.resampled : false,
      perfectReason,
      outputSampleRate: this.playbackInfo.outputSampleRate,
      outputBitDepth: this.playbackInfo.outputBitDepth,
      backend: this.playbackInfo.outputBackend,
      actualBackend: this.playbackInfo.actualBackend || this.playbackInfo.outputBackend,
      deviceName: this.playbackInfo.outputInfo.deviceName || this.playbackInfo.outputDevice,
      actualDeviceName:
        this.playbackInfo.outputInfo.actualDeviceName ||
        this.playbackInfo.outputInfo.deviceName ||
        this.playbackInfo.outputDevice
    }
    this.syncPlaybackOutputMirrorsFromOutputInfo()
  }

  private publishProperty(name: string, data: unknown): void {
    this.emit('property-change', { name, data })
  }

  private publishPlaybackInfo(): void {
    this.emit('playback-info', { ...this.playbackInfo })
  }
}
