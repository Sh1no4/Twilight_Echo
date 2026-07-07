import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import { AudioEngineServiceBinding, canUseAudioEngineService } from './audioEngineServiceClient.ts'
import { isBpmAnalysisResult, type BpmAnalysisResult } from './bpm/bpmCache.ts'

const require = createRequire(import.meta.url)

type ElectronModule = typeof import('electron')

function resolveElectronApp(): ElectronModule['app'] | null {
  try {
    const electronModule = require('electron') as ElectronModule | string
    if (typeof electronModule === 'object' && electronModule && 'app' in electronModule) {
      return electronModule.app
    }
  } catch {
    // Node-side tests can import this module without an Electron runtime.
  }
  return null
}

const electronApp = resolveElectronApp()

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
export type DsdOutputMode = 'auto' | 'pcm' | 'dop' | 'native'
export type SacdProgramMode = 'auto' | 'stereo' | 'multichannel'
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
  dsdOutputMode: DsdOutputMode
  sacdProgramMode: SacdProgramMode
  eqEnabled: boolean
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
  volumeNormalization: VolumeNormalizationMode
  replayGainPreamp: number
  replayGainFallback: number
  replayGainClip: boolean
  convolverEnabled: boolean
  convolverIrPath: string
  crossfeedEnabled: boolean
  crossfeedStrength: number
  crossfeedDelayMs: number
  crossfeedCutoffHz: number
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
  supportsExclusive?: boolean
  supportsHogMode?: boolean
  supportsDirectHw?: boolean
  supportsDop?: boolean
  supportsNativeDsd?: boolean
  dopSupportState?: AudioCapabilitySupportState
  nativeDsdSupportState?: AudioCapabilitySupportState
  supportedDsdRates?: number[]
  nativeDsdSampleRates?: number[]
  nativeDsdSampleFormats?: string[]
  dopCarrierSampleRates?: number[]
  dopCarrierFormats?: string[]
  pathKind?: string
  capabilityReason?: string
}

export type AudioCapabilitySupportState =
  | 'verified'
  | 'runtime-probed'
  | 'unsupported'
  | 'unknown'

export interface OutputConfig {
  preferredBufferSize: number
  routingMode: ChannelRoutingMode
  wasapiExclusivePushMode?: boolean
  upmixCenterGain?: number
  upmixLfeGain?: number
  upmixLfeLowpassHz?: number
  upmixSurroundGain?: number
  upmixSideGain?: number
  upmixSurroundDelayMs?: number
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

export interface AudioEngineScheduler {
  now: () => number
  setInterval: (callback: () => void, delayMs: number) => NodeJS.Timeout
  clearInterval: (handle: NodeJS.Timeout) => void
  setImmediate: (callback: () => void) => void
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
  | 'perfectReasonCode'
  | 'isDsd'
  | 'dsdMode'
  | 'dsdRate'
> &
  Partial<Pick<OutputInfo, 'accessMode' | 'devicePathKind' | 'capabilityReason'>>

export interface PlaybackInfo extends PlaybackOutputInfoMirror {
  state: 'stopped' | 'playing' | 'paused'
  position: number
  duration: number
  volume: number
  queueIndex: number
  playMode: PlayMode
  source: string
  codec: string
  nativePlaybackActive: boolean
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
  perfectReasonCode: string
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
  accessMode: string
  devicePathKind: string
  perfectReasonCode: string
  capabilityReason: string
  driverDopCapable: boolean
  driverNativeDsdCapable: boolean
  driverDopCarrierSampleRates: number[]
  driverDopCarrierFormats: string[]
  driverNativeDsdSampleRates: number[]
  nativeDsdRuntimeState: string
  nativeDsdRequestedRate: number
  nativeDsdActualRate: number
  nativeDsdChannels: number
  nativeDsdExplicitlyCapable: boolean
  nativeDsdAdvertisedSampleRates: number[]
  nativeDsdRuntimeReason: string
  bufferSizeFrames: number
  latencyFrames: number
  latencyMs: number
  latencyInfo: LatencyInfo
  channelRoutingMode: string
  diagnostics: OutputDiagnostics
  deviceRecovered: boolean
  recoveryCount: number
  nativeDsp?: { plugins: unknown[] }
  isDsd: boolean
  dsdMode: string
  dsdRate: number
}

export interface AudioEnginePlayResult {
  nativeStarted: boolean
  fallbackReason: string
}

export interface VisualizationOptions {
  spectrumPoints?: number
  waveformPoints?: number
  spectrogramFrames?: number
  oscilloscopePoints?: number
  visualizerBarCount?: number
}

export interface VisualizationData {
  spectrum: number[]
  visualizerBars?: number[]
  waveform: number[]
  oscilloscope: number[]
  peakDb: number
  rmsDb: number
  lufsMomentary: number | null
  spectrogram: number[][]
  sampleRate: number
  maxFrequency: number
  active: boolean
  tapStatus: VisualizationTapStatus
  reason: string
}

export interface NativeBpmAnalysisOptions {
  maxAnalysisSeconds?: number
  referenceBpm?: number
}

export type VisualizationTapStatus =
  | 'active'
  | 'stopped'
  | 'disabled'
  | 'no-samples'
  | 'native-unavailable'
  | 'synthetic-fallback'

export interface NativeAudioBinding {
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
  SetDspPluginChain?: (json: string) => void
  GetDspPluginStatus?: () => string | { plugins: unknown[] }
  GetMetadata?: (source: string) => string | NativeAudioMetadata
  GetPlaybackInfo?: () => string | PlaybackInfo
  GetUpcomingTrack?: () => string | AudioEngineQueueItem | null
  GetSpectrumData?: (points?: number) => number[]
  GetVisualizationData?: (optionsJson: string) => string | VisualizationData
  AnalyzeBpm?: (source: string, optionsJson?: string) => string | BpmAnalysisResult
  EnumerateDevices?: () => string | AudioDeviceOption[]
  EnumerateBackends?: () => string
  GetEngineCapabilities?: () => string
  GetLastError?: () => string
  /** 异步调用原生方法（service 模式下等待 utility 进程返回）。直接 N-API 模式不实现此方法。 */
  callAsync?: (method: string, args: unknown[]) => Promise<unknown>
}

export interface AudioEngineServiceNativeBinding extends NativeAudioBinding {
  getMetadataAsync: (source: string) => Promise<string | NativeAudioMetadata>
  destroy: () => void
  on: (
    event: 'crash' | 'error-log' | 'log' | 'ready',
    listener: (...args: any[]) => void
  ) => unknown
}

export interface AudioEngineManagerDependencies {
  nativeBinding?: NativeAudioBinding | null
  scheduler?: Partial<AudioEngineScheduler>
  deviceOptionsProvider?: () => AudioDeviceOption[] | null
  nativeAddonCandidates?: () => string[]
  audioServiceEntry?: string
  audioServiceFactory?: () => AudioEngineServiceNativeBinding
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
  playable?: boolean
  reasonCode?: string
  isDsd: boolean
  dsdMode: string
  dsdRate: number
  outputModes?: string[]
  coverMime: string
  coverDataBase64: string
  replayGainTrackGain: number | null
  replayGainAlbumGain: number | null
  r128TrackGain: number | null
  r128AlbumGain: number | null
  error: string
  isoTracks?: NativeAudioMetadata[]
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

const DEFAULT_EQ_BANDS: EqualizerBand[] = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000
].map((frequency) => ({
  frequency,
  gain: 0,
  q: 1,
  filterType: 'peak'
}))

const MAX_PARAMETRIC_EQ_BANDS = 32
const EQ_PREAMP_MIN_DB = -24
const EQ_PREAMP_MAX_DB = 24
const GRAPHIC_EQ_GAIN_MIN_DB = -12
const GRAPHIC_EQ_GAIN_MAX_DB = 12
const PARAMETRIC_EQ_GAIN_MIN_DB = -24
const PARAMETRIC_EQ_GAIN_MAX_DB = 24
const GRAPHIC_EQ_Q_MIN = 0.25
const GRAPHIC_EQ_Q_MAX = 8
const PARAMETRIC_EQ_Q_MIN = 0.1
const PARAMETRIC_EQ_Q_MAX = 20

export const DEFAULT_AUDIO_PROCESSING: AudioProcessingSettings = {
  dspEnabled: false,
  clipGuard: true,
  fftEnabled: true,
  fftResolution: 8192,
  highResolution: true,
  dsdToPcm: false,
  dsdOutputMode: 'auto',
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

const DEFAULT_OUTPUT_CONFIG: OutputConfig = {
  preferredBufferSize: 0,
  routingMode: 'auto',
  wasapiExclusivePushMode: false,
  upmixCenterGain: 0.7071,
  upmixLfeGain: 0.5,
  upmixLfeLowpassHz: 120,
  upmixSurroundGain: 0.5,
  upmixSideGain: 0.3,
  upmixSurroundDelayMs: 0
}
const PLAYBACK_INFO_CACHE_TTL_MS = 200
const VISUALIZATION_CACHE_TTL_MS = 24
const AUDIO_DEVICE_OPTIONS_CACHE_TTL_MS = 1000
const AUDIO_DEVICE_OPTIONS_HOTPLUG_POLL_MS = 5000
const NATIVE_DSP_PLUGIN_STATUS_CACHE_TTL_MS = 200
const CONVOLVER_INFO_CACHE_TTL_MS = 200
const UPCOMING_TRACK_CACHE_TTL_MS = 200
const METADATA_CACHE_TTL_MS = 1000
const MAX_METADATA_CACHE_ENTRIES = 256
const PLAYBACK_FANOUT_FIELD_SEPARATOR = '\x1f'
const PLAYBACK_FANOUT_RECORD_SEPARATOR = '\x1e'

const DEFAULT_AUDIO_ENGINE_SCHEDULER: AudioEngineScheduler = {
  now: () => Date.now(),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle),
  setImmediate: (callback) => setImmediate(callback)
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

function fanoutValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return text
    .replaceAll(PLAYBACK_FANOUT_FIELD_SEPARATOR, ' ')
    .replaceAll(PLAYBACK_FANOUT_RECORD_SEPARATOR, ' ')
}

function fanoutArray(values: unknown[] | undefined): string {
  if (!Array.isArray(values) || values.length === 0) return ''
  return values.map(fanoutValue).join(',')
}

function nativeDspPluginFanoutSignature(nativeDsp: OutputInfo['nativeDsp'] | undefined): string {
  const plugins = nativeDsp?.plugins
  if (!Array.isArray(plugins) || plugins.length === 0) return '0'
  return plugins
    .map((plugin, index) => {
      if (!plugin || typeof plugin !== 'object') return `${index}:${fanoutValue(plugin)}`
      const record = plugin as Record<string, unknown>
      return [
        index,
        record.id,
        record.name,
        record.path,
        record.version,
        record.loaded,
        record.enabled,
        record.active,
        record.bypassed,
        record.bypassReason,
        record.lastError,
        record.lastProcessTimeUs,
        record.maxProcessTimeUs,
        record.timeoutCount,
        record.overBudgetCount,
        record.processOverBudgetCount,
        record.prepareStatus,
        record.state,
        record.status
      ]
        .map(fanoutValue)
        .join(':')
    })
    .join(PLAYBACK_FANOUT_RECORD_SEPARATOR)
}

export function createPlaybackInfoFanoutSignature(
  info: PlaybackInfo,
  nativePlaybackActive: boolean
): string {
  const outputInfo = info.outputInfo
  const latencyInfo = outputInfo.latencyInfo ?? info.latencyInfo
  const diagnostics = outputInfo.diagnostics ?? info.diagnostics
  const upcomingTrack = info.upcomingTrack
  return [
    info.state,
    info.duration,
    info.volume,
    info.queueIndex,
    info.playMode,
    info.source,
    info.codec,
    nativePlaybackActive,
    info.bitrate,
    info.sourceSampleRate,
    info.sourceBitDepth,
    info.decodedSampleRate,
    info.decodedBitDepth,
    info.decodedChannels,
    info.decodedSampleFormat,
    info.outputBackend,
    info.outputDevice,
    info.actualBackend,
    info.driverName,
    info.driverVersion,
    info.actualOutputFormat,
    info.actualSampleRate,
    info.actualBitDepth,
    info.actualChannels,
    info.bufferSizeFrames,
    info.latencyFrames,
    info.latencyMs,
    latencyInfo.bufferLatencyMs,
    latencyInfo.outputLatencyMs,
    latencyInfo.totalLatencyMs,
    info.channelRoutingMode,
    info.supportsOutputPerfect,
    info.sourceExact,
    info.deviceRecovered,
    info.recoveryCount,
    info.outputSampleRate,
    info.outputBitDepth,
    info.channelCount,
    info.outputPerfect,
    info.pcmPassthrough,
    info.dspActive,
    info.replayGainActive,
    info.eqActive,
    info.convolverActive,
    info.crossfeedActive,
    info.crossfadeActive,
    info.fftActive,
    info.irResampled,
    info.replayGainDb,
    info.crossfeedStrength,
    info.crossfadeSeconds,
    info.convolverLatencyFrames,
    info.partitionSize,
    info.channelMappingMode,
    info.perfectReason,
    info.perfectReasonCode,
    info.isDsd,
    info.dsdMode,
    info.dsdRate,
    info.gaplessActive,
    info.preloadReady,
    upcomingTrack?.id,
    upcomingTrack?.source,
    upcomingTrack?.title,
    upcomingTrack?.artist,
    upcomingTrack?.album,
    upcomingTrack?.duration,
    upcomingTrack?.codec,
    upcomingTrack?.sampleRate,
    upcomingTrack?.bitrate,
    upcomingTrack?.bitDepth,
    outputInfo.exclusive,
    outputInfo.supportsOutputPerfect,
    outputInfo.sourceExact,
    outputInfo.outputPerfect,
    outputInfo.pcmPassthrough,
    outputInfo.resampled,
    outputInfo.perfectReason,
    outputInfo.outputSampleRate,
    outputInfo.outputBitDepth,
    outputInfo.backend,
    outputInfo.actualBackend,
    outputInfo.deviceName,
    outputInfo.actualDeviceName,
    outputInfo.driverName,
    outputInfo.actualDriverName,
    outputInfo.driverVersion,
    outputInfo.actualDriverVersion,
    outputInfo.actualOutputFormat,
    outputInfo.actualSampleRate,
    outputInfo.actualBitDepth,
    outputInfo.actualChannels,
    outputInfo.accessMode,
    outputInfo.devicePathKind,
    outputInfo.perfectReasonCode,
    outputInfo.capabilityReason,
    outputInfo.driverDopCapable,
    outputInfo.driverNativeDsdCapable,
    fanoutArray(outputInfo.driverDopCarrierSampleRates),
    fanoutArray(outputInfo.driverDopCarrierFormats),
    fanoutArray(outputInfo.driverNativeDsdSampleRates),
    outputInfo.nativeDsdRuntimeState,
    outputInfo.nativeDsdRequestedRate,
    outputInfo.nativeDsdActualRate,
    outputInfo.nativeDsdChannels,
    outputInfo.nativeDsdExplicitlyCapable,
    fanoutArray(outputInfo.nativeDsdAdvertisedSampleRates),
    outputInfo.nativeDsdRuntimeReason,
    outputInfo.bufferSizeFrames,
    outputInfo.latencyFrames,
    outputInfo.latencyMs,
    outputInfo.channelRoutingMode,
    diagnostics.sessionUnderrunCount,
    diagnostics.sessionBufferDropCount,
    diagnostics.sessionRecoveryCount,
    diagnostics.lifetimeUnderrunCount,
    diagnostics.lifetimeBufferDropCount,
    diagnostics.lifetimeRecoveryCount,
    diagnostics.driverRestartCount,
    diagnostics.deviceLostCount,
    diagnostics.lastError,
    outputInfo.deviceRecovered,
    outputInfo.recoveryCount,
    nativeDspPluginFanoutSignature(outputInfo.nativeDsp),
    outputInfo.isDsd,
    outputInfo.dsdMode,
    outputInfo.dsdRate
  ]
    .map(fanoutValue)
    .join(PLAYBACK_FANOUT_FIELD_SEPARATOR)
}

function supportsAudioExclusive(output: AudioOutputId): boolean {
  return getAudioOutputOptions().some((option) => option.id === output && option.supportsExclusive)
}

function isDefaultAudioDeviceAlias(device: string): boolean {
  const normalized = device.trim()
  const lower = normalized.toLowerCase()
  return (
    lower === 'auto' ||
    lower === 'default' ||
    lower === 'system default' ||
    lower === 'system-default' ||
    normalized === '系统默认'
  )
}

function normalizeAudioDevice(device: unknown): string {
  if (typeof device !== 'string') return 'auto'
  const normalized = device.trim()
  if (!normalized || isDefaultAudioDeviceAlias(normalized)) return 'auto'
  return normalized
}

function looksLikeWasapiEndpointId(device: string): boolean {
  return /^\{0\.0\.0\./i.test(device.trim())
}

function deviceOptionBelongsToAsio(option: AudioDeviceOption | undefined): boolean {
  if (!option) return false
  return (
    option.backend === 'asio' ||
    option.pathKind === 'asio' ||
    option.id.toLowerCase().startsWith('asio:')
  )
}

function deviceCompatibleWithOutput(
  output: AudioOutputId,
  device: string,
  options: AudioDeviceOption[]
): boolean {
  if (device === 'auto') return true
  const option = options.find((entry) => entry.id === device)
  if (output === 'asio') {
    if (looksLikeWasapiEndpointId(device)) return false
    return option ? deviceOptionBelongsToAsio(option) : true
  }
  return !deviceOptionBelongsToAsio(option) && !device.toLowerCase().startsWith('asio:')
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
      ? clampNumber(Math.trunc(config?.preferredBufferSize ?? 0), 0, 2048, 0)
      : DEFAULT_OUTPUT_CONFIG.preferredBufferSize,
    routingMode: normalizeChannelRoutingMode(config?.routingMode),
    wasapiExclusivePushMode: config?.wasapiExclusivePushMode === true,
    upmixCenterGain: clampNumber(config?.upmixCenterGain, 0, 2, 0.7071),
    upmixLfeGain: clampNumber(config?.upmixLfeGain, 0, 2, 0.5),
    upmixLfeLowpassHz: clampNumber(config?.upmixLfeLowpassHz, 20, 500, 120),
    upmixSurroundGain: clampNumber(config?.upmixSurroundGain, 0, 2, 0.5),
    upmixSideGain: clampNumber(config?.upmixSideGain, 0, 2, 0.3),
    upmixSurroundDelayMs: clampNumber(config?.upmixSurroundDelayMs, 0, 100, 0)
  }
}

function outputConfigsEqual(left: OutputConfig, right: OutputConfig): boolean {
  return (
    left.preferredBufferSize === right.preferredBufferSize &&
    left.routingMode === right.routingMode &&
    left.wasapiExclusivePushMode === right.wasapiExclusivePushMode &&
    left.upmixCenterGain === right.upmixCenterGain &&
    left.upmixLfeGain === right.upmixLfeGain &&
    left.upmixLfeLowpassHz === right.upmixLfeLowpassHz &&
    left.upmixSurroundGain === right.upmixSurroundGain &&
    left.upmixSideGain === right.upmixSideGain &&
    left.upmixSurroundDelayMs === right.upmixSurroundDelayMs
  )
}

function eqBandsEqual(left: EqualizerBand[], right: EqualizerBand[]): boolean {
  if (left.length !== right.length) return false
  return left.every((band, index) => {
    const other = right[index]
    return (
      band.frequency === other.frequency &&
      band.gain === other.gain &&
      band.q === other.q &&
      band.filterType === other.filterType
    )
  })
}

function audioProcessingSettingsEqual(
  left: AudioProcessingSettings,
  right: AudioProcessingSettings
): boolean {
  return (
    left.dspEnabled === right.dspEnabled &&
    left.clipGuard === right.clipGuard &&
    left.fftEnabled === right.fftEnabled &&
    left.fftResolution === right.fftResolution &&
    left.highResolution === right.highResolution &&
    left.dsdToPcm === right.dsdToPcm &&
    left.dsdOutputMode === right.dsdOutputMode &&
    left.sacdProgramMode === right.sacdProgramMode &&
    left.eqEnabled === right.eqEnabled &&
    left.eqMode === right.eqMode &&
    left.eqPreamp === right.eqPreamp &&
    eqBandsEqual(left.eqBands, right.eqBands) &&
    left.volumeNormalization === right.volumeNormalization &&
    left.replayGainPreamp === right.replayGainPreamp &&
    left.replayGainFallback === right.replayGainFallback &&
    left.replayGainClip === right.replayGainClip &&
    left.convolverEnabled === right.convolverEnabled &&
    left.convolverIrPath === right.convolverIrPath &&
    left.crossfeedEnabled === right.crossfeedEnabled &&
    left.crossfeedStrength === right.crossfeedStrength &&
    left.crossfeedDelayMs === right.crossfeedDelayMs &&
    left.crossfeedCutoffHz === right.crossfeedCutoffHz &&
    left.gapless === right.gapless &&
    left.crossfadeSeconds === right.crossfadeSeconds
  )
}

function normalizeVisualizationOptions(
  options?: VisualizationOptions
): Required<VisualizationOptions> {
  return {
    spectrumPoints: Math.trunc(clampNumber(options?.spectrumPoints, 8, 4096, 64)),
    waveformPoints: Math.trunc(clampNumber(options?.waveformPoints, 16, 512, 128)),
    spectrogramFrames: Math.trunc(clampNumber(options?.spectrogramFrames, 0, 96, 48)),
    oscilloscopePoints: Math.trunc(clampNumber(options?.oscilloscopePoints, 0, 4096, 1024)),
    visualizerBarCount: Math.trunc(clampNumber(options?.visualizerBarCount, 0, 256, 0))
  }
}

function visualizationMaxFrequency(sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 20000
  return Math.max(20, Math.min(20000, Math.trunc(sampleRate) / 2))
}

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

function formatAudioDeviceLabel(device: string): string {
  return device === DEFAULT_AUDIO_DEVICE_OPTION.id ? DEFAULT_AUDIO_DEVICE_OPTION.label : device
}

function normalizeAudioCapabilitySupportState(
  value: unknown
): AudioCapabilitySupportState | null {
  return value === 'verified' ||
    value === 'runtime-probed' ||
    value === 'unsupported' ||
    value === 'unknown'
    ? value
    : null
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function getDeviceBackend(option: Partial<AudioDeviceOption>): string {
  const raw = option.backend || (option.id?.startsWith('asio:') ? 'asio' : '')
  return String(raw || '').toLowerCase()
}

function getDevicePathKind(option: Partial<AudioDeviceOption>): string {
  return String(option.pathKind || '').toLowerCase()
}

function deriveDopSupportState(option: Partial<AudioDeviceOption>): AudioCapabilitySupportState {
  const explicit = normalizeAudioCapabilitySupportState(option.dopSupportState)
  if (explicit) return explicit
  if (
    option.supportsDop === true ||
    hasNonEmptyArray(option.dopCarrierSampleRates) ||
    hasNonEmptyArray(option.dopCarrierFormats)
  ) {
    return 'verified'
  }
  if (option.supportsDop === false) return 'unsupported'

  const backend = getDeviceBackend(option)
  const pathKind = getDevicePathKind(option)
  if (
    option.isDefault === true ||
    backend === 'wasapi' ||
    backend === 'coreaudio' ||
    pathKind === 'default' ||
    pathKind === 'endpoint' ||
    pathKind === 'hal'
  ) {
    return 'runtime-probed'
  }
  if (backend === 'asio' || pathKind === 'asio') return 'unknown'
  return 'unknown'
}

function deriveNativeDsdSupportState(
  option: Partial<AudioDeviceOption>
): AudioCapabilitySupportState {
  const explicit = normalizeAudioCapabilitySupportState(option.nativeDsdSupportState)
  if (explicit) return explicit
  if (
    option.supportsNativeDsd === true ||
    hasNonEmptyArray(option.nativeDsdSampleRates) ||
    hasNonEmptyArray(option.nativeDsdSampleFormats) ||
    hasNonEmptyArray(option.supportedDsdRates)
  ) {
    return 'verified'
  }
  if (option.supportsNativeDsd === false) return 'unsupported'

  const backend = getDeviceBackend(option)
  const pathKind = getDevicePathKind(option)
  if (backend === 'wasapi' || backend === 'coreaudio' || pathKind === 'endpoint' || pathKind === 'hal') {
    return 'unsupported'
  }
  if (backend === 'alsa' && pathKind === 'hw') return 'runtime-probed'
  if (backend === 'asio' || pathKind === 'asio') return 'unknown'
  if (option.isDefault === true || pathKind === 'default') return 'unsupported'
  return 'unknown'
}

function withAudioCapabilitySupportStates(option: AudioDeviceOption): AudioDeviceOption {
  return {
    ...option,
    dopSupportState: deriveDopSupportState(option),
    nativeDsdSupportState: deriveNativeDsdSupportState(option)
  }
}

function normalizeAudioDeviceOption(option: unknown): AudioDeviceOption | null {
  if (typeof option === 'string') {
    const id = option.trim()
    if (!id) return null
    return withAudioCapabilitySupportStates({
      id,
      label: formatAudioDeviceLabel(id),
      isDefault: id === DEFAULT_AUDIO_DEVICE_OPTION.id
    })
  }

  if (!option || typeof option !== 'object') return null
  const record = option as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id) return null
  const rawLabel = typeof record.label === 'string' ? record.label.trim() : ''
  return withAudioCapabilitySupportStates({
    ...(record as Partial<AudioDeviceOption>),
    id,
    label:
      id === DEFAULT_AUDIO_DEVICE_OPTION.id ? DEFAULT_AUDIO_DEVICE_OPTION.label : rawLabel || id,
    isDefault: record.isDefault === true
  })
}

function normalizeAudioDeviceOptions(
  rawOptions: unknown,
  selectedDevice: string
): AudioDeviceOption[] {
  const options: AudioDeviceOption[] = []
  const seen = new Set<string>()

  function addOption(option: AudioDeviceOption | null): void {
    if (!option || seen.has(option.id)) return
    seen.add(option.id)
    options.push(option)
  }

  if (Array.isArray(rawOptions)) {
    for (const option of rawOptions) {
      addOption(normalizeAudioDeviceOption(option))
    }
  }

  if (!seen.has(DEFAULT_AUDIO_DEVICE_OPTION.id)) {
    options.unshift({ ...DEFAULT_AUDIO_DEVICE_OPTION })
    seen.add(DEFAULT_AUDIO_DEVICE_OPTION.id)
  }

  if (selectedDevice && !seen.has(selectedDevice)) {
    addOption({
      id: selectedDevice,
      label: formatAudioDeviceLabel(selectedDevice),
      isDefault: selectedDevice === DEFAULT_AUDIO_DEVICE_OPTION.id
    })
  }

  return options
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
  const eqMode: EqMode = settings?.eqMode === 'parametric' ? 'parametric' : 'graphic'
  const rawBands = Array.isArray(settings?.eqBands) ? settings.eqBands : DEFAULT_EQ_BANDS
  const eqBands =
    eqMode === 'parametric'
      ? rawBands.slice(0, MAX_PARAMETRIC_EQ_BANDS).map((band, index) => {
          const defaultBand = DEFAULT_EQ_BANDS[index % DEFAULT_EQ_BANDS.length]
          return {
            frequency: clampNumber(band.frequency, 20, 24000, defaultBand.frequency),
            gain: clampNumber(band.gain, PARAMETRIC_EQ_GAIN_MIN_DB, PARAMETRIC_EQ_GAIN_MAX_DB, 0),
            q: clampNumber(band.q, PARAMETRIC_EQ_Q_MIN, PARAMETRIC_EQ_Q_MAX, 1),
            filterType: normalizeEqualizerFilterType(band.filterType)
          }
        })
      : DEFAULT_EQ_BANDS.map((defaultBand, index) => {
          const band = rawBands[index] ?? defaultBand
          return {
            frequency: clampNumber(band.frequency, 20, 24000, defaultBand.frequency),
            gain: clampNumber(band.gain, GRAPHIC_EQ_GAIN_MIN_DB, GRAPHIC_EQ_GAIN_MAX_DB, 0),
            q: clampNumber(band.q, GRAPHIC_EQ_Q_MIN, GRAPHIC_EQ_Q_MAX, 1),
            filterType: normalizeEqualizerFilterType(band.filterType)
          }
        })

  if (eqBands.length === 0) {
    eqBands.push({
      frequency: DEFAULT_EQ_BANDS[0].frequency,
      gain: 0,
      q: 1,
      filterType: 'peak'
    })
  }

  const volumeNormalization: VolumeNormalizationMode =
    settings?.volumeNormalization === 'track' ||
    settings?.volumeNormalization === 'album' ||
    settings?.volumeNormalization === 'loudnorm'
      ? settings.volumeNormalization
      : 'off'
  const dsdOutputMode: DsdOutputMode =
    settings?.dsdOutputMode === 'auto' ||
    settings?.dsdOutputMode === 'pcm' ||
    settings?.dsdOutputMode === 'dop' ||
    settings?.dsdOutputMode === 'native'
      ? settings.dsdOutputMode
      : settings?.dsdToPcm === true
        ? 'pcm'
        : 'auto'
  const sacdProgramMode: SacdProgramMode =
    settings?.sacdProgramMode === 'stereo' || settings?.sacdProgramMode === 'multichannel'
      ? settings.sacdProgramMode
      : 'auto'

  return {
    dspEnabled: settings?.dspEnabled === true,
    clipGuard: settings?.clipGuard !== false,
    fftEnabled: settings?.fftEnabled !== false,
    fftResolution: clampNumber(settings?.fftResolution, 64, 8192, 8192),
    highResolution: settings?.highResolution !== false,
    dsdToPcm: dsdOutputMode === 'pcm',
    dsdOutputMode,
    sacdProgramMode,
    eqEnabled: settings?.eqEnabled === true,
    eqMode,
    eqPreamp: clampNumber(settings?.eqPreamp, EQ_PREAMP_MIN_DB, EQ_PREAMP_MAX_DB, 0),
    eqBands,
    volumeNormalization,
    replayGainPreamp: clampNumber(settings?.replayGainPreamp, -12, 12, 0),
    replayGainFallback: clampNumber(settings?.replayGainFallback, -12, 12, 0),
    replayGainClip: settings?.replayGainClip !== false,
    convolverEnabled: settings?.convolverEnabled === true,
    convolverIrPath: typeof settings?.convolverIrPath === 'string' ? settings.convolverIrPath : '',
    crossfeedEnabled: settings?.crossfeedEnabled === true,
    crossfeedStrength: clampNumber(settings?.crossfeedStrength, 0, 1, 0),
    crossfeedDelayMs: clampNumber(settings?.crossfeedDelayMs, 0.05, 2, 0.35),
    crossfeedCutoffHz: clampNumber(settings?.crossfeedCutoffHz, 80, 4000, 700),
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

function normalizeNumberArray(value: unknown, length: number): number[] {
  const source = Array.isArray(value) ? value : []
  return Array.from({ length }, (_, index) => {
    const item = source[index]
    return typeof item === 'number' && Number.isFinite(item) ? item : 0
  })
}

function normalizeSpectrogram(value: unknown, frames: number, points: number): number[][] {
  if (frames <= 0 || points <= 0) return []
  const source = Array.isArray(value) ? value.slice(-frames) : []
  return source.map((row) => normalizeNumberArray(row, points))
}

export function mapSpectrumToVisualizerBars(
  spectrum: readonly number[],
  sampleRate: number,
  barCount: number
): number[] {
  if (barCount <= 0) return []
  const bars = Array.from({ length: barCount }, () => 0)
  if (spectrum.length === 0) return bars

  const minFrequency = 20
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100
  const maxFrequency = Math.max(minFrequency, Math.min(20000, rate / 2))
  const fftSize = Math.max(2, spectrum.length * 2)
  const binWidth = rate / fftSize
  const maxBinIndex = Math.max(0, spectrum.length - 1)
  const frequencyRatio = maxFrequency / minFrequency
  const frequencyStepCount = Math.max(1, barCount - 1)

  for (let i = 0; i < barCount; i += 1) {
    const frequency = minFrequency * Math.pow(frequencyRatio, i / frequencyStepCount)
    const binIndexDecimal = frequency / binWidth
    const indexLow = Math.min(Math.floor(binIndexDecimal), maxBinIndex)
    const indexHigh = Math.min(indexLow + 1, maxBinIndex)
    const fract = binIndexDecimal - indexLow
    const valLow = spectrum[indexLow] || 0
    const valHigh = spectrum[indexHigh] || 0
    const value = valLow + (valHigh - valLow) * fract
    bars[i] = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  }

  return bars
}

function withPrecomputedVisualizerBars(
  data: VisualizationData,
  options: Required<VisualizationOptions>
): VisualizationData {
  if (options.visualizerBarCount <= 0) return data
  return {
    ...data,
    spectrum: [],
    spectrogram: [],
    oscilloscope: [],
    visualizerBars: mapSpectrumToVisualizerBars(
      data.spectrum,
      data.sampleRate,
      options.visualizerBarCount
    )
  }
}

function createFallbackVisualizationData(
  options: Required<VisualizationOptions>,
  sampleRate: number,
  phaseSeconds: number,
  reason = 'Native visualization tap unavailable'
): VisualizationData {
  const phase = Number.isFinite(phaseSeconds) ? phaseSeconds : 0
  const spectrum = Array.from({ length: options.spectrumPoints }, (_, index) => {
    const x = index / Math.max(1, options.spectrumPoints - 1)
    const bass = Math.sin((phase * 2.2 + x * 9) * Math.PI) * 0.18
    const mid = Math.sin((phase * 1.15 + x * 23) * Math.PI) * 0.1
    const envelope = Math.pow(1 - x, 0.62)
    return Math.max(0.03, Math.min(1, 0.12 + envelope * (0.34 + bass + mid)))
  })
  const waveform = Array.from({ length: options.waveformPoints }, (_, index) => {
    const x = index / Math.max(1, options.waveformPoints - 1)
    return Math.max(-1, Math.min(1, Math.sin((x * 5.5 + phase * 1.8) * Math.PI) * 0.42))
  })
  const oscilloscope = Array.from({ length: options.oscilloscopePoints }, (_, index) => {
    const x = index / Math.max(1, options.oscilloscopePoints - 1)
    const carrier = Math.sin((x * 10 + phase * 2.4) * Math.PI)
    const harmonic = Math.sin((x * 21 + phase * 1.7) * Math.PI) * 0.22
    return Math.max(-1, Math.min(1, (carrier + harmonic) * 0.48))
  })

  return {
    spectrum,
    waveform,
    oscilloscope,
    peakDb: -18,
    rmsDb: -28,
    lufsMomentary: -24,
    spectrogram: options.spectrogramFrames > 0 ? [spectrum] : [],
    sampleRate: Math.max(1, Math.trunc(sampleRate || 44100)),
    maxFrequency: visualizationMaxFrequency(sampleRate || 44100),
    active: true,
    tapStatus: 'synthetic-fallback',
    reason
  }
}

function createInactiveVisualizationData(
  options: Required<VisualizationOptions>,
  sampleRate = 0,
  tapStatus: VisualizationTapStatus = 'stopped',
  reason = ''
): VisualizationData {
  return {
    spectrum: Array.from({ length: options.spectrumPoints }, () => 0),
    waveform: Array.from({ length: options.waveformPoints }, () => 0),
    oscilloscope: Array.from({ length: options.oscilloscopePoints }, () => 0),
    peakDb: -120,
    rmsDb: -120,
    lufsMomentary: null,
    spectrogram: [],
    sampleRate: Math.max(0, Math.trunc(sampleRate || 0)),
    maxFrequency: visualizationMaxFrequency(sampleRate),
    active: false,
    tapStatus,
    reason
  }
}

function normalizeVisualizationTapStatus(
  value: unknown,
  active: boolean
): VisualizationTapStatus {
  if (
    value === 'active' ||
    value === 'stopped' ||
    value === 'disabled' ||
    value === 'no-samples' ||
    value === 'native-unavailable' ||
    value === 'synthetic-fallback'
  ) {
    return value
  }
  return active ? 'active' : 'no-samples'
}

function normalizeVisualizationData(
  data: Partial<VisualizationData>,
  options: Required<VisualizationOptions>
): VisualizationData {
  const active = data.active === true
  const sampleRate =
    typeof data.sampleRate === 'number' && Number.isFinite(data.sampleRate) ? data.sampleRate : 0
  const maxFrequencyLimit = visualizationMaxFrequency(sampleRate)
  const maxFrequency =
    typeof data.maxFrequency === 'number' && Number.isFinite(data.maxFrequency)
      ? Math.max(20, Math.min(maxFrequencyLimit, data.maxFrequency))
      : maxFrequencyLimit

  return {
    spectrum: normalizeNumberArray(data.spectrum, options.spectrumPoints),
    waveform: normalizeNumberArray(data.waveform, options.waveformPoints),
    oscilloscope: normalizeNumberArray(data.oscilloscope, options.oscilloscopePoints),
    peakDb: typeof data.peakDb === 'number' && Number.isFinite(data.peakDb) ? data.peakDb : -120,
    rmsDb: typeof data.rmsDb === 'number' && Number.isFinite(data.rmsDb) ? data.rmsDb : -120,
    lufsMomentary:
      typeof data.lufsMomentary === 'number' && Number.isFinite(data.lufsMomentary)
        ? data.lufsMomentary
        : null,
    spectrogram: normalizeSpectrogram(
      data.spectrogram,
      options.spectrogramFrames,
      options.spectrumPoints
    ),
    sampleRate,
    maxFrequency,
    active,
    tapStatus: normalizeVisualizationTapStatus(data.tapStatus, active),
    reason: typeof data.reason === 'string' ? data.reason : ''
  }
}

export function getNativeAddonCandidates(): string[] {
  const binary = 'twilight_audio_node.node'
  const appPath = electronApp?.getAppPath?.() ?? process.cwd()
  return [
    join(process.resourcesPath ?? '', 'audio-engine', binary),
    join(appPath, 'resources', 'audio-engine', binary),
    join(appPath, 'audio-engine', 'build', 'default', binary),
    join(appPath, 'audio-engine', 'build', 'mingw-static', binary),
    join(appPath, 'audio-engine', 'build', 'windows-msvc', binary),
    join(appPath, '..', 'audio-engine', 'build', 'default', binary),
    join(appPath, '..', 'audio-engine', 'build', 'mingw-static', binary),
    join(appPath, '..', 'audio-engine', 'build', 'windows-msvc', binary)
  ]
}

function rendererFallbackAllowed(): boolean {
  return process.env.TWILIGHT_ENABLE_HTMLAUDIO_FALLBACK === '1'
}

export function loadNativeBinding(
  getCandidates: () => string[] = getNativeAddonCandidates
): NativeAudioBinding | null {
  for (const candidate of getCandidates()) {
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
  const exclusive =
    output === 'wasapi'
      ? exclusiveMode
      : output === 'asio'
        ? true
        : output === 'coreaudio'
          ? exclusiveMode
          : false
  const supportsOutputPerfect =
    output === 'asio' ||
    (output === 'wasapi' && exclusiveMode) ||
    (output === 'coreaudio' && exclusiveMode)
  const accessMode =
    output === 'asio'
      ? 'exclusive'
      : output === 'wasapi' || output === 'coreaudio'
        ? exclusiveMode
          ? 'exclusive'
          : 'shared'
        : 'shared'
  const devicePathKind = output === 'asio' ? 'asio' : output === 'coreaudio' ? 'hal' : 'default'
  const perfectReasonCode = supportsOutputPerfect
    ? ''
    : output === 'wasapi' || output === 'coreaudio'
      ? 'shared_mixer'
      : 'backend_not_output_perfect'
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
    accessMode,
    devicePathKind,
    perfectReasonCode,
    capabilityReason: perfectReason,
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
    nativeDsdAdvertisedSampleRates: [],
    nativeDsdRuntimeReason: '',
    bufferSizeFrames: 0,
    latencyFrames: 0,
    latencyMs: 0,
    latencyInfo,
    channelRoutingMode: outputConfig.routingMode,
    diagnostics,
    deviceRecovered: false,
    recoveryCount: 0,
    nativeDsp: { plugins: [] },
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
    accessMode,
    devicePathKind,
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
    perfectReasonCode,
    capabilityReason: perfectReason,
    isDsd: false,
    dsdMode: 'pcm',
    dsdRate: 0,
    gaplessActive: false,
    preloadReady: false,
    upcomingTrack: null,
    nativePlaybackActive: false
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

function normalizeDsdState(
  canonicalOutput?: Partial<OutputInfo> | null,
  mirror?: Partial<PlaybackInfo> | null
): { isDsd: boolean; dsdMode: string; dsdRate: number } {
  const canonicalMode =
    typeof canonicalOutput?.dsdMode === 'string' ? canonicalOutput.dsdMode.trim() : ''
  const mirrorMode = typeof mirror?.dsdMode === 'string' ? mirror.dsdMode.trim() : ''
  const canonicalHasMode = canonicalMode.length > 0
  const modeIndicatesDsd = (mode: string): boolean =>
    mode === 'native' || mode === 'dop' || mode === 'unsupported'
  const canonicalIsDsd =
    typeof canonicalOutput?.isDsd === 'boolean'
      ? canonicalOutput.isDsd
      : canonicalHasMode
        ? modeIndicatesDsd(canonicalMode)
        : undefined
  const isDsd = canonicalIsDsd ?? (mirror?.isDsd === true || modeIndicatesDsd(mirrorMode))
  const rawMode = canonicalHasMode ? canonicalMode : mirrorMode
  const dsdMode = isDsd ? rawMode || 'unsupported' : 'pcm'
  const dsdRate = isDsd ? (canonicalOutput?.dsdRate ?? mirror?.dsdRate ?? 0) : 0
  return { isDsd, dsdMode, dsdRate }
}

export class AudioEngineManager extends EventEmitter {
  private native: NativeAudioBinding | null
  private audioServiceBinding: AudioEngineServiceNativeBinding | null = null
  private output: AudioOutputId
  private device: string
  private exclusiveMode: boolean
  private outputConfig: OutputConfig
  private processing: AudioProcessingSettings
  private scheduler: AudioEngineScheduler
  private deviceOptionsProvider?: () => AudioDeviceOption[] | null
  private queue: AudioEngineQueueItem[] = []
  private queueJson = '[]'
  private playbackInfo: PlaybackInfo
  private timer: NodeJS.Timeout | null = null
  private lastTick = 0
  private lastNativePlaybackInfoTickReadAt = Number.NEGATIVE_INFINITY
  private lastPlaybackInfoFanoutKey = ''
  private lastPublishedDuration: number | null = null
  private lastVisualizationCache: {
    key: string
    state: PlaybackInfo['state']
    source: string
    readAt: number
    data: VisualizationData
  } | null = null
  private lastSpectrumCache: {
    points: number
    state: PlaybackInfo['state']
    source: string
    readAt: number
    data: number[]
  } | null = null
  private lastAudioDeviceOptionsCache: {
    selectedDevice: string
    readAt: number
    options: AudioDeviceOption[]
  } | null = null
  private lastAudioDeviceOptionsSignature = ''
  private lastAudioDeviceOptionsProbeAt = Number.NEGATIVE_INFINITY
  private lastNativeDspPluginStatusCache: {
    readAt: number
    status: unknown
  } | null = null
  private lastConvolverInfoCache: {
    readAt: number
    info: ConvolverInfo
  } | null = null
  private lastUpcomingTrackCache: {
    readAt: number
    track: AudioEngineQueueItem | null
  } | null = null
  private metadataCache = new Map<
    string,
    {
      readAt: number
      metadata: NativeAudioMetadata | null
    }
  >()
  private destroyed = false
  private nativePlaybackActive = false
  private nativeOutputRouteSynced = false
  private audioServiceReadyRestoreSerial = 0
  private lastNativeError = ''
  private pendingNativeSource: string | null = null
  private nativeConvolverIrPath: string | null = null
  private nativeDspPluginChainJson = ''

  constructor(
    config: AudioEngineConfig = { exclusiveMode: false },
    dependencies: AudioEngineManagerDependencies = {}
  ) {
    super()
    this.scheduler = {
      ...DEFAULT_AUDIO_ENGINE_SCHEDULER,
      ...(dependencies.scheduler ?? {})
    }
    this.deviceOptionsProvider = dependencies.deviceOptionsProvider
    this.native =
      dependencies.nativeBinding !== undefined
        ? dependencies.nativeBinding
        : this.createNativeBinding(dependencies)
    this.output = normalizeAudioOutput(config.audioOutput)
    this.device = normalizeAudioDevice(config.audioDevice)
    this.device = this.resolveCompatibleDevice(this.output, this.device)
    this.exclusiveMode = config.exclusiveMode && supportsAudioExclusive(this.output)
    this.outputConfig = normalizeOutputConfig(config.audioOutputConfig)
    this.processing = normalizeAudioProcessingSettings(config.audioProcessing)
    this.lastTick = this.scheduler.now()
    this.playbackInfo = createDefaultPlaybackInfo(
      this.output,
      this.device,
      this.exclusiveMode,
      this.outputConfig
    )
    this.resetOutputInfoDefaults()
    this.updateOutputPerfect()
  }

  private createNativeBinding(
    dependencies: AudioEngineManagerDependencies
  ): NativeAudioBinding | null {
    const nativeAddonCandidates = dependencies.nativeAddonCandidates ?? getNativeAddonCandidates
    if (!nativeAddonCandidates().some((candidate) => existsSync(candidate))) {
      this.lastNativeError = '未加载 twilight_audio_node.node'
      return null
    }
    if (dependencies.audioServiceFactory || canUseAudioEngineService()) {
      const service =
        dependencies.audioServiceFactory?.() ??
        new AudioEngineServiceBinding({
          serviceEntry: dependencies.audioServiceEntry ?? join(__dirname, 'audioEngineService.js')
        })
      service.on('crash', (reason: string) => this.handleAudioServiceCrash(reason))
      service.on('ready', () => this.handleAudioServiceReady())
      service.on('error-log', (message: string) => {
        if (message.trim()) console.warn('[音频服务]', message.trim())
      })
      this.audioServiceBinding = service
      return service
    }
    return loadNativeBinding(nativeAddonCandidates)
  }

  private handleAudioServiceCrash(reason: string): void {
    this.lastNativeError = reason
    this.nativePlaybackActive = false
    this.nativeOutputRouteSynced = false
    this.audioServiceReadyRestoreSerial += 1
    this.nativeConvolverIrPath = null
    this.lastNativeDspPluginStatusCache = null
    this.lastConvolverInfoCache = null
    this.invalidateAudioDeviceOptionsCache('audio-service-crash')
    this.invalidateUpcomingTrackCache()
    this.metadataCache.clear()
    const nextDiagnostics = {
      ...this.playbackInfo.outputInfo.diagnostics,
      lastError: reason,
      sessionRecoveryCount: this.playbackInfo.outputInfo.diagnostics.sessionRecoveryCount + 1,
      lifetimeRecoveryCount: this.playbackInfo.outputInfo.diagnostics.lifetimeRecoveryCount + 1
    }
    this.playbackInfo = {
      ...this.playbackInfo,
      state: 'stopped',
      nativePlaybackActive: false,
      outputInfo: {
        ...this.playbackInfo.outputInfo,
        nativeDsp: { plugins: [] },
        diagnostics: nextDiagnostics,
        recoveryCount: this.playbackInfo.outputInfo.recoveryCount + 1
      },
      diagnostics: {
        ...this.playbackInfo.diagnostics,
        lastError: reason,
        sessionRecoveryCount: this.playbackInfo.diagnostics.sessionRecoveryCount + 1,
        lifetimeRecoveryCount: this.playbackInfo.diagnostics.lifetimeRecoveryCount + 1
      },
      recoveryCount: this.playbackInfo.recoveryCount + 1
    }
    this.emit('audio-service-crash', { reason })
    this.publishPlaybackInfo()
  }

  private handleAudioServiceReady(): void {
    const restoreSerial = ++this.audioServiceReadyRestoreSerial
    this.nativeOutputRouteSynced = false
    this.invalidateAudioDeviceOptionsCache('audio-service-ready')
    void this.restoreAudioServiceReadyState().then((result) => {
      if (this.destroyed || restoreSerial !== this.audioServiceReadyRestoreSerial) return
      this.nativeOutputRouteSynced = result.outputRouteSynced
      this.nativePlaybackActive = false
      this.invalidateUpcomingTrackCache()
      this.playbackInfo = {
        ...this.playbackInfo,
        state: 'stopped',
        nativePlaybackActive: false
      }
      this.publishPlaybackInfo()
      this.emit('audio-service-ready', {
        manualResumeRequired: true,
        outputRouteSynced: result.outputRouteSynced,
        restoreErrors: result.errors
      })
    })
  }

  private async restoreAudioServiceReadyState(): Promise<{
    outputRouteSynced: boolean
    errors: string[]
  }> {
    const routeRestore = await this.restoreAudioServiceOutputRoute()
    if (!routeRestore.synced) {
      return {
        outputRouteSynced: false,
        errors: routeRestore.errors
      }
    }

    const stateRestore = await this.restoreAudioServicePlaybackState()
    return {
      outputRouteSynced: stateRestore.synced,
      errors: stateRestore.errors
    }
  }

  private async restoreAudioServiceOutputRoute(
    contextPrefix = '音频服务恢复后应用'
  ): Promise<{ synced: boolean; errors: string[] }> {
    const results: Array<{ ok: boolean; error: string }> = []
    results.push(
      await this.restoreAudioServiceOutputRouteStep(
        'output-backend',
        `${contextPrefix}输出后端`,
        'SetOutputBackend',
        this.getNativeBackendId()
      )
    )
    results.push(
      await this.restoreAudioServiceOutputRouteStep(
        'output-device',
        `${contextPrefix}输出设备`,
        'SetOutputDevice',
        this.device
      )
    )
    results.push(
      await this.restoreAudioServiceOutputRouteStep(
        'output-config',
        `${contextPrefix}输出配置`,
        'SetOutputConfig',
        JSON.stringify(this.outputConfig)
      )
    )
    return {
      synced: results.every((result) => result.ok),
      errors: results.filter((result) => !result.ok).map((result) => result.error)
    }
  }

  private async restoreAudioServiceOutputRouteStep(
    id: string,
    context: string,
    method: keyof NativeAudioBinding,
    ...args: unknown[]
  ): Promise<{ ok: boolean; error: string }> {
    const ok = await this.callNativeMaybeAsync(context, method, ...args)
    return {
      ok,
      error: ok ? '' : `${id}: ${this.lastNativeError || context}`
    }
  }

  private async restoreAudioServicePlaybackState(): Promise<{ synced: boolean; errors: string[] }> {
    const results: Array<{ ok: boolean; error: string }> = []
    results.push(
      await this.restoreAudioServiceOutputRouteStep(
        'dsp-config',
        '音频服务恢复后应用 DSP 配置',
        'SetDspConfig',
        JSON.stringify(this.processing)
      )
    )
    results.push(
      await this.restoreAudioServiceOutputRouteStep(
        'eq-bands',
        '音频服务恢复后应用 EQ 配置',
        'SetEqBands',
        JSON.stringify(this.processing)
      )
    )
    results.push(
      await this.restoreAudioServiceOutputRouteStep(
        'replay-gain',
        '音频服务恢复后应用 ReplayGain 配置',
        'SetReplayGainMode',
        this.processing.volumeNormalization,
        this.processing.replayGainPreamp,
        this.processing.replayGainFallback,
        this.processing.replayGainClip
      )
    )
    results.push(
      await this.restoreAudioServiceOutputRouteStep(
        'crossfeed',
        '音频服务恢复后应用 Crossfeed 配置',
        'SetCrossfeedStrength',
        this.processing.crossfeedEnabled ? this.processing.crossfeedStrength : 0
      )
    )
    if (this.processing.convolverIrPath) {
      const convolverLoaded = await this.restoreAudioServiceOutputRouteStep(
        'convolver-ir',
        '音频服务恢复后加载卷积脉冲响应',
        'LoadImpulseResponse',
        this.processing.convolverIrPath
      )
      if (convolverLoaded.ok) this.nativeConvolverIrPath = this.processing.convolverIrPath
      results.push(convolverLoaded)
    }
    if (this.nativeDspPluginChainJson) {
      results.push(
        await this.restoreAudioServiceOutputRouteStep(
          'native-dsp-plugin-chain',
          '音频服务恢复后应用原生 DSP 插件链',
          'SetDspPluginChain',
          this.nativeDspPluginChainJson
        )
      )
    }
    if (this.queue.length > 0) {
      results.push(
        await this.restoreAudioServiceOutputRouteStep(
          'queue',
          '音频服务恢复后加载队列',
          'LoadQueue',
          JSON.stringify(this.queue),
          this.playbackInfo.queueIndex
        )
      )
    }
    return {
      synced: results.every((result) => result.ok),
      errors: results.filter((result) => !result.ok).map((result) => result.error)
    }
  }

  async start(): Promise<void> {
    this.nativeOutputRouteSynced = false
    const routeRestore = await this.restoreAudioServiceOutputRoute('初始化')
    this.nativeOutputRouteSynced = routeRestore.synced
    this.applyNativeDspSettings('初始化 DSP 配置')
    this.startClock()
    this.scheduler.setImmediate(() => this.emit('ready'))
  }

  async play(source: string, startTime = 0): Promise<AudioEnginePlayResult> {
    if (!source) throw new Error('音频地址为空')
    this.invalidateUpcomingTrackCache()
    const current = this.queue[this.playbackInfo.queueIndex]
    const duration = current?.source === source ? (current.duration ?? 0) : 0
    const firstErrorContext = {
      output: this.output,
      device: this.device,
      exclusiveMode: this.exclusiveMode,
      outputConfig: this.outputConfig
    }
    let nativeStarted = await this.tryNativePlay(
      '播放',
      source,
      startTime,
      firstErrorContext.output !== 'asio'
    )
    let nativeFallbackReason = ''
    if (!nativeStarted && this.shouldFallbackFromAsio(firstErrorContext.output)) {
      nativeFallbackReason = this.lastNativeError || 'ASIO 输出不可用'
      this.output = 'wasapi'
      this.device = 'auto'
      this.exclusiveMode = false
      this.nativeOutputRouteSynced = false
      const fallbackRoute = await this.restoreAudioServiceOutputRoute('ASIO 失败后应用 WASAPI 兜底')
      this.nativeOutputRouteSynced = fallbackRoute.synced
      if (fallbackRoute.synced) {
        nativeStarted = await this.tryNativePlay('WASAPI 兜底播放', source, startTime)
      } else {
        this.lastNativeError = fallbackRoute.errors.join('\n') || this.lastNativeError
      }
      if (!nativeStarted) {
        this.output = firstErrorContext.output
        this.device = firstErrorContext.device
        this.exclusiveMode = firstErrorContext.exclusiveMode
        this.outputConfig = firstErrorContext.outputConfig
      }
    }
    if (!nativeStarted && !rendererFallbackAllowed()) {
      const detail =
        this.lastNativeError ||
        parseNativeJson(this.native?.GetLastError?.(), { message: '' }).message ||
        '原生音频引擎不可用'
      throw new Error(`原生音频播放失败：${detail}`)
    }
    this.nativePlaybackActive = nativeStarted
    this.pendingNativeSource = nativeStarted ? source : null
    const nativeInfo = nativeStarted ? this.readNativePlaybackInfo() : null
    if (nativeInfo?.source === source) {
      this.pendingNativeSource = null
    }
    const isDsd = sourceLooksDsd(source)
    const nativeDsd = nativeInfo ? normalizeDsdState(nativeInfo.outputInfo, nativeInfo) : null
    const playbackIsDsd = isDsd || nativeDsd?.isDsd === true
    const playbackDsdMode = nativeDsd?.isDsd
      ? nativeDsd.dsdMode
      : playbackIsDsd
        ? 'unsupported'
        : 'pcm'
    const playbackDsdRate = nativeDsd?.isDsd ? nativeDsd.dsdRate : 0
    const sourceQueueIndex = this.queue.findIndex((item) => item.source === source)
    this.playbackInfo = {
      ...this.playbackInfo,
      ...nativeInfo,
      state: 'playing',
      position: Math.max(0, Number.isFinite(startTime) ? startTime : 0),
      duration,
      source,
      queueIndex: sourceQueueIndex >= 0 ? sourceQueueIndex : this.playbackInfo.queueIndex,
      codec: inferCodec(source),
      isDsd: playbackIsDsd,
      dsdMode: playbackDsdMode,
      dsdRate: playbackDsdRate,
      outputInfo: nativeInfo?.outputInfo
        ? {
            ...nativeInfo.outputInfo,
            isDsd: playbackIsDsd,
            dsdMode: playbackDsdMode,
            dsdRate: playbackDsdRate
          }
        : this.playbackInfo.outputInfo
    }
    this.lastTick = this.scheduler.now()
    this.emit('start-file')
    this.publishDuration(this.playbackInfo.duration, { force: true })
    this.publishProperty('pause', false)
    this.publishPlaybackInfo()
    return {
      nativeStarted,
      fallbackReason:
        nativeFallbackReason || (nativeStarted ? '' : this.lastNativeError || '原生音频引擎不可用')
    }
  }

  async togglePause(): Promise<void> {
    const native = this.native
    if (!native) {
      this.lastNativeError = '未加载 twilight_audio_node.node'
      return
    }

    // Service 模式：异步等待 utility 进程执行完毕，读取真实状态
    if (typeof native.callAsync === 'function') {
      try {
        await native.callAsync('Pause', [])
        // 等待原生引擎更新状态后读取真实播放信息
        const raw = await native.callAsync('GetPlaybackInfo', [])
        const realInfo = parseNativeJson(
          raw as string | PlaybackInfo | undefined,
          null as PlaybackInfo | null
        )
        if (realInfo) {
          this.playbackInfo = this.mergeNativePlaybackInfo(this.normalizePlaybackInfo(realInfo))
        }
        this.lastTick = this.scheduler.now()
        this.publishProperty('pause', this.playbackInfo.state !== 'playing')
        this.publishPlaybackInfo()
        return
      } catch (err) {
        // 异步调用失败，回退到同步路径
        const message = err instanceof Error ? err.message : String(err)
        this.lastNativeError = message
        console.warn('原生音频引擎异步暂停/继续失败，回退同步路径：', message)
      }
    }

    // 直接 N-API 模式：Pause() 同步阻塞，GetPlaybackInfo() 立即返回真实状态
    this.tryNative('暂停/继续', (n) => n.Pause())
    const nativeInfo = this.readNativePlaybackInfo()
    if (nativeInfo) {
      this.playbackInfo = this.mergeNativePlaybackInfo(nativeInfo)
    }
    this.lastTick = this.scheduler.now()
    this.publishProperty('pause', this.playbackInfo.state !== 'playing')
    this.publishPlaybackInfo()
  }

  async pause(): Promise<void> {
    // 真正的硬暂停：如果已经暂停则不操作，避免 toggle 语义导致的反向翻转
    if (this.playbackInfo.state === 'paused' || this.playbackInfo.state === 'stopped') {
      return
    }
    await this.togglePause()
  }

  async seek(time: number): Promise<void> {
    const position = Math.max(0, Number.isFinite(time) ? time : 0)
    if (this.playbackInfo.state !== 'playing' && Object.is(position, this.playbackInfo.position)) {
      return
    }
    this.tryNative('跳转', (native) => native.Seek(position))
    this.playbackInfo.position = position
    this.lastTick = this.scheduler.now()
    this.publishProperty('time-pos', position)
    this.publishPlaybackInfo()
  }

  async setVolume(volume: number): Promise<void> {
    const normalized = clampNumber(volume, 0, 1, 1)
    if (Object.is(normalized, this.playbackInfo.volume)) return
    this.tryNative('设置音量', (native) => native.SetVolume(normalized))
    this.playbackInfo.volume = normalized
    this.updateOutputPerfect()
    this.publishPlaybackInfo()
  }

  async stop(): Promise<void> {
    if (
      this.playbackInfo.state === 'stopped' &&
      this.playbackInfo.position === 0 &&
      !this.nativePlaybackActive
    ) {
      return
    }
    if (this.nativePlaybackActive) {
      const stopped = await this.callNativeMaybeAsync('停止', 'Stop')
      if (!stopped) {
        const nativeInfo = await this.readNativePlaybackInfoAsync()
        if (nativeInfo) this.playbackInfo = this.mergeNativePlaybackInfo(nativeInfo)
        this.publishPlaybackInfo()
        throw new Error(`原生音频停止失败：${this.lastNativeError || '原生音频引擎不可用'}`)
      }
    } else {
      this.tryNative('停止', (native) => native.Stop())
    }
    this.nativePlaybackActive = false
    this.pendingNativeSource = null
    this.playbackInfo.state = 'stopped'
    this.playbackInfo.position = 0
    this.publishProperty('pause', true)
    this.publishProperty('eof-reached', false)
    this.publishPlaybackInfo()
  }

  async loadQueue(items: AudioEngineQueueItem[], startIndex = 0): Promise<void> {
    const nextQueue = [...items]
    const nextQueueIndex =
      nextQueue.length > 0 ? Math.min(Math.max(0, startIndex), nextQueue.length - 1) : -1
    const nextQueueJson = JSON.stringify(nextQueue)
    if (nextQueueJson === this.queueJson && nextQueueIndex === this.playbackInfo.queueIndex) return

    this.queue = nextQueue
    this.queueJson = nextQueueJson
    this.playbackInfo.queueIndex = nextQueueIndex
    this.invalidateUpcomingTrackCache()
    this.tryNative('加载队列', (native) => {
      native.LoadQueue?.(nextQueueJson, nextQueueIndex)
      native.SetPlayMode?.(this.playbackInfo.playMode)
    })
    this.emit('queue-change', this.queue)
  }

  async next(): Promise<void> {
    if (this.queue.length === 0) return
    this.invalidateUpcomingTrackCache()
    const fallbackIndex = (this.playbackInfo.queueIndex + 1) % this.queue.length
    let nextIndex = fallbackIndex
    const targetSource = this.queue[nextIndex]?.source
    if (this.nativePlaybackActive && this.native?.Next) {
      let nativeInfo: PlaybackInfo | null = null
      if (typeof this.native.callAsync === 'function') {
        try {
          await this.native.callAsync('Next', [])
          nativeInfo = await this.readNativePlaybackInfoAsync()
          this.lastNativeError = ''
        } catch (err) {
          this.lastNativeError = err instanceof Error ? err.message : String(err)
        }
      } else if (this.tryNative('下一首', (native) => native.Next?.())) {
        nativeInfo = this.readNativePlaybackInfo()
      }
      if (
        nativeInfo &&
        nativeInfo.state === 'playing' &&
        nativeInfo.source === targetSource &&
        nativeInfo.queueIndex >= 0 &&
        nativeInfo.queueIndex < this.queue.length
      ) {
        nextIndex = nativeInfo.queueIndex
        this.pendingNativeSource = null
        this.playbackInfo = this.mergeNativePlaybackInfo(nativeInfo)
        this.emit('start-file')
        this.publishPlaybackInfo()
        return
      }
    }
    this.playbackInfo.queueIndex = nextIndex
    await this.play(this.queue[nextIndex].source, 0)
  }

  async previous(): Promise<void> {
    if (this.queue.length === 0) return
    this.invalidateUpcomingTrackCache()
    const fallbackIndex =
      this.playbackInfo.queueIndex <= 0 ? this.queue.length - 1 : this.playbackInfo.queueIndex - 1
    let nextIndex = fallbackIndex
    const targetSource = this.queue[nextIndex]?.source
    if (this.nativePlaybackActive && this.native?.Previous) {
      let nativeInfo: PlaybackInfo | null = null
      if (typeof this.native.callAsync === 'function') {
        try {
          await this.native.callAsync('Previous', [])
          nativeInfo = await this.readNativePlaybackInfoAsync()
          this.lastNativeError = ''
        } catch (err) {
          this.lastNativeError = err instanceof Error ? err.message : String(err)
        }
      } else if (this.tryNative('上一首', (native) => native.Previous?.())) {
        nativeInfo = this.readNativePlaybackInfo()
      }
      if (
        nativeInfo &&
        nativeInfo.state === 'playing' &&
        nativeInfo.source === targetSource &&
        nativeInfo.queueIndex >= 0 &&
        nativeInfo.queueIndex < this.queue.length
      ) {
        nextIndex = nativeInfo.queueIndex
        this.pendingNativeSource = null
        this.playbackInfo = this.mergeNativePlaybackInfo(nativeInfo)
        this.emit('start-file')
        this.publishPlaybackInfo()
        return
      }
    }
    this.playbackInfo.queueIndex = nextIndex
    await this.play(this.queue[nextIndex].source, 0)
  }

  async setExclusiveMode(enabled: boolean): Promise<AudioOutputState> {
    if (enabled && !supportsAudioExclusive(this.output)) {
      throw new Error(`${this.output} 不支持独占模式`)
    }
    if (this.nativeOutputRouteSynced && enabled === this.exclusiveMode) {
      return await this.getAudioOutputState()
    }

    const previousExclusiveMode = this.exclusiveMode
    this.exclusiveMode = enabled
    this.invalidateAudioDeviceOptionsCache('exclusive-mode-changed')
    this.nativeOutputRouteSynced = false
    const backendSynced = await this.callNativeMaybeAsync(
      '切换独占模式',
      'SetOutputBackend',
      this.getNativeBackendId()
    )
    if (!backendSynced) {
      this.exclusiveMode = previousExclusiveMode
      this.invalidateAudioDeviceOptionsCache('exclusive-mode-restore-after-failure')
      throw new Error(`原生音频独占模式切换失败：${this.lastNativeError || '原生音频引擎不可用'}`)
    }
    const configSynced = await this.callNativeMaybeAsync(
      '切换输出配置',
      'SetOutputConfig',
      JSON.stringify(this.outputConfig)
    )
    if (!configSynced) {
      this.exclusiveMode = previousExclusiveMode
      this.invalidateAudioDeviceOptionsCache('exclusive-mode-restore-after-failure')
      throw new Error(`原生音频独占模式配置应用失败：${this.lastNativeError || '原生音频引擎不可用'}`)
    }
    this.nativeOutputRouteSynced = true
    this.refreshOutputInfoFromNative(true)
    return await this.getAudioOutputState()
  }

  async getExclusiveMode(): Promise<boolean> {
    return this.exclusiveMode
  }

  async setAudioOutput(output: AudioOutputId, device?: string): Promise<AudioOutputState> {
    const nextOutput = normalizeAudioOutput(output)
    const outputChanged = nextOutput !== this.output
    const nextDevice = this.resolveCompatibleDevice(
      nextOutput,
      normalizeAudioDevice(device ?? (outputChanged ? 'auto' : this.device))
    )
    const nextExclusiveMode = supportsAudioExclusive(nextOutput) ? this.exclusiveMode : false
    if (
      this.nativeOutputRouteSynced &&
      nextOutput === this.output &&
      nextDevice === this.device &&
      nextExclusiveMode === this.exclusiveMode
    ) {
      return await this.getAudioOutputState()
    }

    this.output = nextOutput
    this.device = nextDevice
    this.exclusiveMode = nextExclusiveMode
    this.invalidateAudioDeviceOptionsCache('audio-output-changed')
    this.nativeOutputRouteSynced = false
    const routeRestore = await this.restoreAudioServiceOutputRoute('切换')
    this.nativeOutputRouteSynced = routeRestore.synced
    this.refreshOutputInfoFromNative(true)
    return await this.getAudioOutputState()
  }

  async setAudioDevice(device: string): Promise<AudioOutputState> {
    const nextDevice = this.resolveCompatibleDevice(this.output, normalizeAudioDevice(device))
    if (this.nativeOutputRouteSynced && nextDevice === this.device) return await this.getAudioOutputState()

    const previousDevice = this.device
    this.device = nextDevice
    this.invalidateAudioDeviceOptionsCache('audio-device-changed')
    this.nativeOutputRouteSynced = false
    const deviceSynced = await this.callNativeMaybeAsync('切换输出设备', 'SetOutputDevice', this.device)
    if (!deviceSynced) {
      this.device = previousDevice
      this.invalidateAudioDeviceOptionsCache('audio-device-restore-after-failure')
      throw new Error(`原生音频输出设备切换失败：${this.lastNativeError || '原生音频引擎不可用'}`)
    }
    this.nativeOutputRouteSynced = true
    this.refreshOutputInfoFromNative(true)
    return await this.getAudioOutputState()
  }

  async setOutputConfig(config: Partial<OutputConfig>): Promise<void> {
    const prevBufferSize = this.outputConfig.preferredBufferSize
    const previousConfig = this.outputConfig
    const nextConfig = normalizeOutputConfig(config)
    if (outputConfigsEqual(nextConfig, this.outputConfig)) return

    this.outputConfig = nextConfig
    const bufferSizeChanged = this.outputConfig.preferredBufferSize !== prevBufferSize
    const needsReopen = bufferSizeChanged && this.output === 'asio'
    this.nativeOutputRouteSynced = false
    if (needsReopen) {
      const reopened = await this.callNativeMaybeAsync(
        '重开 ASIO 后端以应用 buffer size',
        'SetOutputBackend',
        this.getNativeBackendId()
      )
      if (!reopened) {
        this.outputConfig = previousConfig
        throw new Error(`原生音频输出配置重开失败：${this.lastNativeError || '原生音频引擎不可用'}`)
      }
    }
    const configSynced = await this.callNativeMaybeAsync(
      '设置输出配置',
      'SetOutputConfig',
      JSON.stringify(this.outputConfig)
    )
    if (!configSynced) {
      this.outputConfig = previousConfig
      throw new Error(`原生音频输出配置应用失败：${this.lastNativeError || '原生音频引擎不可用'}`)
    }
    this.nativeOutputRouteSynced = true
    this.playbackInfo.outputInfo.channelRoutingMode = this.outputConfig.routingMode
    this.playbackInfo.channelRoutingMode = this.outputConfig.routingMode
    this.refreshOutputInfoFromNative(needsReopen)
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

  notifyAudioDeviceOptionsChanged(reason = 'platform-device-change'): void {
    if (this.destroyed) return
    this.lastAudioDeviceOptionsProbeAt = Number.NEGATIVE_INFINITY
    this.invalidateAudioDeviceOptionsCache(reason)
  }

  async setAudioProcessing(
    settings: Partial<AudioProcessingSettings>
  ): Promise<AudioProcessingSettings> {
    const nextProcessing = this.mergeAudioProcessingSettings(settings)
    if (audioProcessingSettingsEqual(nextProcessing, this.processing)) return this.processing

    const previousProcessing = this.processing
    this.processing = nextProcessing
    const sourceIsDsd =
      sourceLooksDsd(this.playbackInfo.source) ||
      this.playbackInfo.codec.trim().toLowerCase() === 'dsd' ||
      this.playbackInfo.outputInfo.isDsd === true

    if (sourceIsDsd) {
      const mode = this.processing.dsdOutputMode
      const optimisticMode = mode === 'auto' ? 'dop' : mode
      const isForcedPcm = mode === 'pcm'

      this.playbackInfo.outputInfo = {
        ...this.playbackInfo.outputInfo,
        isDsd: true,
        dsdMode: optimisticMode,
        dsdRate: this.playbackInfo.outputInfo.dsdRate || this.playbackInfo.dsdRate || 0,
        perfectReasonCode: isForcedPcm
          ? 'dsd_converted_to_pcm'
          : this.playbackInfo.outputInfo.perfectReasonCode === 'dsd_converted_to_pcm'
            ? ''
            : this.playbackInfo.outputInfo.perfectReasonCode,
        perfectReason: isForcedPcm
          ? 'DSD 当前已转换为 PCM 输出'
          : this.playbackInfo.outputInfo.perfectReason === 'DSD 当前已转换为 PCM 输出'
            ? ''
            : this.playbackInfo.outputInfo.perfectReason,
        capabilityReason: isForcedPcm
          ? 'DSD 当前已转换为 PCM 输出'
          : this.playbackInfo.outputInfo.capabilityReason === 'DSD 当前已转换为 PCM 输出'
            ? ''
            : this.playbackInfo.outputInfo.capabilityReason
      }
      this.syncPlaybackOutputMirrorsFromOutputInfo()
    }
    this.applyNativeDspSettings('更新 DSP 配置', { previousProcessing })
    this.updateOutputPerfect()
    this.publishPlaybackInfo()
    return this.processing
  }

  getAudioProcessing(): AudioProcessingSettings {
    return this.processing
  }

  async loadImpulseResponse(path: string): Promise<ConvolverInfo> {
    this.processing = this.mergeAudioProcessingSettings({
      convolverEnabled: true,
      convolverIrPath: path
    })
    this.lastConvolverInfoCache = null
    if (this.tryNative('加载脉冲响应', (native) => native.LoadImpulseResponse?.(path))) {
      this.nativeConvolverIrPath = path
    }
    this.updateNativeInfoSnapshot()
    return this.getConvolverInfo()
  }

  async unloadImpulseResponse(): Promise<ConvolverInfo> {
    const nextProcessing = this.mergeAudioProcessingSettings({
      convolverEnabled: false,
      convolverIrPath: ''
    })
    if (audioProcessingSettingsEqual(nextProcessing, this.processing))
      return this.getConvolverInfo()

    this.processing = nextProcessing
    this.lastConvolverInfoCache = null
    if (this.tryNative('卸载脉冲响应', (native) => native.UnloadImpulseResponse?.())) {
      this.nativeConvolverIrPath = ''
    }
    this.updateNativeInfoSnapshot()
    return this.getConvolverInfo()
  }

  getConvolverInfo(): ConvolverInfo {
    const canUseIdleCache = !this.processing.convolverIrPath && !this.nativeConvolverIrPath
    const now = this.scheduler.now()
    const cached = this.lastConvolverInfoCache
    if (canUseIdleCache && cached && now - cached.readAt <= CONVOLVER_INFO_CACHE_TTL_MS) {
      return cached.info
    }
    const info = parseNativeJson(this.native?.GetConvolverInfo?.(), {
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
    if (canUseIdleCache && !info.loaded && !info.active) {
      this.lastConvolverInfoCache = {
        readAt: now,
        info
      }
    }
    return info
  }

  async setEqBands(settings: Partial<AudioProcessingSettings>): Promise<AudioProcessingSettings> {
    const nextProcessing = this.mergeAudioProcessingSettings(settings)
    if (audioProcessingSettingsEqual(nextProcessing, this.processing)) return this.processing

    this.processing = nextProcessing
    this.tryNative('更新均衡器', (native) => native.SetEqBands?.(JSON.stringify(this.processing)))
    return this.processing
  }

  async setEqPreset(preset: {
    eqMode: EqMode
    eqPreamp: number
    eqBands: EqualizerBand[]
  }): Promise<AudioProcessingSettings> {
    const nextProcessing = this.mergeAudioProcessingSettings({
      ...preset,
      eqEnabled: true
    })
    if (audioProcessingSettingsEqual(nextProcessing, this.processing)) return this.processing

    this.processing = nextProcessing
    this.tryNative('应用均衡器预设', (native) =>
      native.SetEqPreset?.(JSON.stringify(this.processing))
    )
    return this.processing
  }

  async setCrossfeedStrength(strength: number): Promise<AudioProcessingSettings> {
    const nextProcessing = this.mergeAudioProcessingSettings({
      crossfeedEnabled: strength > 0,
      crossfeedStrength: strength
    })
    if (audioProcessingSettingsEqual(nextProcessing, this.processing)) return this.processing

    this.processing = nextProcessing
    this.tryNative('设置串音强度', (native) =>
      native.SetCrossfeedStrength?.(this.processing.crossfeedStrength)
    )
    return this.processing
  }

  async setReplayGainMode(
    mode: VolumeNormalizationMode,
    preamp = this.processing.replayGainPreamp,
    fallback = this.processing.replayGainFallback,
    clip = this.processing.replayGainClip
  ): Promise<AudioProcessingSettings> {
    const nextProcessing = this.mergeAudioProcessingSettings({
      volumeNormalization: mode,
      replayGainPreamp: preamp,
      replayGainFallback: fallback,
      replayGainClip: clip
    })
    if (audioProcessingSettingsEqual(nextProcessing, this.processing)) return this.processing

    this.processing = nextProcessing
    this.tryNative('设置 ReplayGain', (native) =>
      native.SetReplayGainMode?.(
        this.processing.volumeNormalization,
        this.processing.replayGainPreamp,
        this.processing.replayGainFallback,
        this.processing.replayGainClip
      )
    )
    return this.processing
  }

  setNativeDspPluginChain(chainJson: string): void {
    if (chainJson === this.nativeDspPluginChainJson) return

    this.nativeDspPluginChainJson = chainJson
    this.lastNativeDspPluginStatusCache = null
    this.tryNative('更新原生 DSP 插件链', (native) => {
      native.SetDspPluginChain?.(chainJson)
    })
  }

  getNativeDspPluginStatus(): unknown {
    const now = this.scheduler.now()
    const cached = this.lastNativeDspPluginStatusCache
    if (cached && now - cached.readAt <= NATIVE_DSP_PLUGIN_STATUS_CACHE_TTL_MS) {
      return cached.status
    }
    const status = parseNativeJson(this.native?.GetDspPluginStatus?.(), { plugins: [] })
    this.lastNativeDspPluginStatusCache = {
      readAt: now,
      status
    }
    return status
  }

  getMetadata(source: string): NativeAudioMetadata | null {
    const cached = this.getCachedMetadata(source)
    if (cached.found) return cached.metadata

    const metadata = parseNativeJson(
      this.native?.GetMetadata?.(source),
      null as NativeAudioMetadata | null
    )
    this.cacheMetadata(source, metadata)
    return metadata
  }

  async getMetadataAsync(source: string): Promise<NativeAudioMetadata | null> {
    const cached = this.getCachedMetadata(source)
    if (cached.found) return cached.metadata

    if (this.audioServiceBinding) {
      const metadata = parseNativeJson(
        await this.audioServiceBinding.getMetadataAsync(source),
        null as NativeAudioMetadata | null
      )
      this.cacheMetadata(source, metadata)
      return metadata
    }
    const metadata = this.getMetadata(source)
    this.cacheMetadata(source, metadata)
    return metadata
  }

  async analyzeBpm(
    source: string,
    options: NativeBpmAnalysisOptions = {}
  ): Promise<BpmAnalysisResult | null> {
    const optionsJson = JSON.stringify({
      maxAnalysisSeconds: clampNumber(options.maxAnalysisSeconds, 1, 1800, 180),
      referenceBpm:
        typeof options.referenceBpm === 'number' && Number.isFinite(options.referenceBpm)
          ? options.referenceBpm
          : undefined
    })
    try {
      const raw = this.audioServiceBinding
        ? await this.audioServiceBinding.callAsync?.('AnalyzeBpm', [source, optionsJson])
        : this.native?.AnalyzeBpm?.(source, optionsJson)
      const analysis = parseNativeJson<BpmAnalysisResult | null>(
        raw as string | BpmAnalysisResult | undefined,
        null
      )
      return isBpmAnalysisResult(analysis) ? analysis : null
    } catch {
      return null
    }
  }

  async setPlayMode(mode: PlayMode): Promise<void> {
    if (mode === this.playbackInfo.playMode) return
    this.playbackInfo.playMode = mode
    this.invalidateUpcomingTrackCache()
    this.tryNative('切换播放模式', (native) => native.SetPlayMode?.(mode))
    this.publishPlaybackInfo()
  }

  getUpcomingTrack(): AudioEngineQueueItem | null {
    const now = this.scheduler.now()
    const cached = this.lastUpcomingTrackCache
    if (cached && now - cached.readAt <= UPCOMING_TRACK_CACHE_TTL_MS) {
      return cached.track
    }
    try {
      const track = parseNativeJson(
        this.native?.GetUpcomingTrack?.(),
        null as AudioEngineQueueItem | null
      )
      this.lastUpcomingTrackCache = { readAt: now, track }
      return track
    } catch {
      return this.playbackInfo.upcomingTrack
    }
  }

  async getPlaybackInfo(): Promise<PlaybackInfo> {
    const now = this.scheduler.now()
    if (
      this.nativePlaybackActive &&
      now - this.lastNativePlaybackInfoTickReadAt > PLAYBACK_INFO_CACHE_TTL_MS
    ) {
      const nativeInfo = this.readNativePlaybackInfo()
      if (nativeInfo) {
        this.playbackInfo = this.mergeNativePlaybackInfo(nativeInfo)
        this.lastNativePlaybackInfoTickReadAt = now
      }
    }
    return { ...this.playbackInfo, nativePlaybackActive: this.nativePlaybackActive }
  }

  getSpectrumData(points = 64): number[] {
    const now = this.scheduler.now()
    const cached = this.lastSpectrumCache
    if (
      cached &&
      cached.points === points &&
      cached.state === this.playbackInfo.state &&
      cached.source === this.playbackInfo.source &&
      now - cached.readAt <= VISUALIZATION_CACHE_TTL_MS
    ) {
      return [...cached.data]
    }
    const cache = (data: number[]): number[] => {
      this.lastSpectrumCache = {
        points,
        state: this.playbackInfo.state,
        source: this.playbackInfo.source,
        readAt: now,
        data: [...data]
      }
      return [...data]
    }
    try {
      const nativeSpectrum = this.native?.GetSpectrumData?.(points)
      if (nativeSpectrum) return cache(nativeSpectrum)
    } catch {
      // Keep the visualizer alive while native playback is still optional.
    }
    return cache(
      Array.from({ length: points }, (_, index) => {
        const x = index / Math.max(1, points - 1)
        return (Math.sin((x * 12 + this.playbackInfo.position) * Math.PI) + 1) * 0.25
      })
    )
  }

  getVisualizationData(options: VisualizationOptions = {}): VisualizationData {
    const normalizedOptions = normalizeVisualizationOptions(options)
    const cacheKey = JSON.stringify(normalizedOptions)
    const now = this.scheduler.now()
    const cached = this.lastVisualizationCache
    if (
      cached &&
      cached.key === cacheKey &&
      cached.state === this.playbackInfo.state &&
      cached.source === this.playbackInfo.source &&
      now - cached.readAt <= VISUALIZATION_CACHE_TTL_MS
    ) {
      return cached.data
    }
    const cache = (data: VisualizationData): VisualizationData => {
      const cachedData = withPrecomputedVisualizerBars(data, normalizedOptions)
      this.lastVisualizationCache = {
        key: cacheKey,
        state: this.playbackInfo.state,
        source: this.playbackInfo.source,
        readAt: now,
        data: cachedData
      }
      return cachedData
    }
    let fallbackReason = this.native?.GetVisualizationData
      ? 'Native visualization tap returned no samples'
      : 'Native visualization tap unavailable'
    try {
      const nativeData = parseNativeJson(
        this.native?.GetVisualizationData?.(cacheKey),
        null as VisualizationData | null
      )
      if (nativeData) {
        const normalizedData = normalizeVisualizationData(nativeData, normalizedOptions)
        if (normalizedData.active || this.playbackInfo.state !== 'playing') {
          return cache(normalizedData)
        }
        fallbackReason = normalizedData.reason || 'Native visualization tap returned no samples'
      } else {
        fallbackReason = 'Native visualization tap unavailable'
      }
    } catch {
      fallbackReason = 'Native visualization tap unavailable'
      // Keep the renderer visualizer alive while native playback is still optional.
    }
    if (this.playbackInfo.state === 'playing') {
      return cache(
        createFallbackVisualizationData(
          normalizedOptions,
          this.playbackInfo.actualSampleRate,
          now / 1000,
          fallbackReason
        )
      )
    }
    return cache(
      createInactiveVisualizationData(
        normalizedOptions,
        this.playbackInfo.actualSampleRate,
        fallbackReason === 'Native visualization tap unavailable' ? 'native-unavailable' : 'stopped',
        fallbackReason === 'Native visualization tap unavailable' ? fallbackReason : ''
      )
    )
  }

  destroy(): void {
    if (this.destroyed) return

    this.destroyed = true
    this.nativePlaybackActive = false
    if (this.timer) {
      this.scheduler.clearInterval(this.timer)
      this.timer = null
    }
    this.tryNative('销毁停止', (native) => native.Stop())
    this.audioServiceBinding?.destroy()
    this.audioServiceBinding = null
  }

  private startClock(): void {
    if (this.timer) return
    this.lastTick = this.scheduler.now()
    this.timer = this.scheduler.setInterval(() => this.tick(), 250)
  }

  private readNativePlaybackInfo(): PlaybackInfo | null {
    try {
      const info = parseNativeJson(this.native?.GetPlaybackInfo?.(), null as PlaybackInfo | null)
      if (!info) return null
      return this.normalizePlaybackInfo(info)
    } catch {
      return null
    }
  }

  private async readNativePlaybackInfoAsync(): Promise<PlaybackInfo | null> {
    if (!this.native || typeof this.native.callAsync !== 'function') return this.readNativePlaybackInfo()
    try {
      const raw = (await this.native.callAsync('GetPlaybackInfo', [])) as
        | string
        | PlaybackInfo
        | undefined
      const info = parseNativeJson<PlaybackInfo | null>(raw, null)
      if (!info) return null
      return this.normalizePlaybackInfo(info)
    } catch {
      return null
    }
  }

  private mergeNativePlaybackInfo(nativeInfo: PlaybackInfo): PlaybackInfo {
    if (!this.pendingNativeSource) {
      return this.withQueueIndexForSource({ ...this.playbackInfo, ...nativeInfo })
    }

    if (nativeInfo.source === this.pendingNativeSource) {
      this.pendingNativeSource = null
      return this.withQueueIndexForSource({ ...this.playbackInfo, ...nativeInfo })
    }

    return {
      ...this.playbackInfo,
      state: nativeInfo.state,
      position: nativeInfo.position,
      duration: this.playbackInfo.duration || nativeInfo.duration,
      volume: nativeInfo.volume,
      outputInfo: nativeInfo.outputInfo,
      nativePlaybackActive: nativeInfo.nativePlaybackActive
    }
  }

  private withQueueIndexForSource(info: PlaybackInfo): PlaybackInfo {
    if (!info.source) return info
    const sourceQueueIndex = this.queue.findIndex((item) => item.source === info.source)
    if (sourceQueueIndex < 0 || sourceQueueIndex === info.queueIndex) return info
    return {
      ...info,
      queueIndex: sourceQueueIndex
    }
  }

  private normalizePlaybackInfo(info: PlaybackInfo): PlaybackInfo {
    const preferNonEmpty = (...values: Array<string | undefined | null>): string => {
      for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) return value
      }
      return ''
    }
    const outputInfo: OutputInfo = {
      ...this.playbackInfo.outputInfo,
      ...(info.outputInfo ?? {})
    }
    const canonicalOutput = info.outputInfo
    const sourceExact = canonicalOutput?.sourceExact ?? info.sourceExact ?? false
    const outputPerfect = canonicalOutput?.outputPerfect ?? info.outputPerfect ?? false
    const perfectReason = canonicalOutput?.perfectReason ?? info.perfectReason ?? ''
    const perfectReasonCode = canonicalOutput?.perfectReasonCode ?? info.perfectReasonCode ?? ''
    const supportsOutputPerfect =
      canonicalOutput?.supportsOutputPerfect ??
      info.supportsOutputPerfect ??
      outputInfo.supportsOutputPerfect ??
      false
    const normalizedDsd = normalizeDsdState(canonicalOutput, info)
    const sourceIsDsd = sourceLooksDsd(info.source || this.playbackInfo.source)
    const isDsd = normalizedDsd.isDsd || sourceIsDsd
    const dsdMode = !isDsd
      ? 'pcm'
      : this.processing.dsdOutputMode === 'pcm'
        ? 'pcm'
        : normalizedDsd.isDsd
          ? normalizedDsd.dsdMode
          : 'unsupported'
    const dsdRate = normalizedDsd.dsdRate
    const latencyInfo =
      canonicalOutput?.latencyInfo ?? info.latencyInfo ?? this.playbackInfo.latencyInfo
    const diagnostics =
      canonicalOutput?.diagnostics ?? info.diagnostics ?? this.playbackInfo.diagnostics
    outputInfo.sourceExact = sourceExact
    outputInfo.outputPerfect = outputPerfect
    outputInfo.supportsOutputPerfect = supportsOutputPerfect
    outputInfo.perfectReason =
      isDsd && dsdMode === 'pcm' && normalizedDsd.dsdMode !== 'pcm'
        ? 'DSD 当前已转换为 PCM 输出'
        : perfectReason
    outputInfo.perfectReasonCode =
      isDsd && dsdMode === 'pcm' && normalizedDsd.dsdMode !== 'pcm'
        ? 'dsd_converted_to_pcm'
        : perfectReasonCode
    outputInfo.isDsd = isDsd
    outputInfo.dsdMode = dsdMode
    outputInfo.dsdRate = dsdRate
    outputInfo.backend = preferNonEmpty(
      canonicalOutput?.backend,
      info.outputBackend,
      this.getNativeBackendId()
    )
    outputInfo.actualBackend = preferNonEmpty(canonicalOutput?.actualBackend, outputInfo.backend)
    outputInfo.accessMode = preferNonEmpty(
      canonicalOutput?.accessMode,
      outputInfo.exclusive ? 'exclusive' : 'shared'
    )
    outputInfo.devicePathKind = preferNonEmpty(canonicalOutput?.devicePathKind, 'default')
    outputInfo.capabilityReason = preferNonEmpty(canonicalOutput?.capabilityReason, perfectReason)
    outputInfo.deviceName = preferNonEmpty(
      canonicalOutput?.deviceName,
      info.outputDevice,
      this.device
    )
    outputInfo.actualDeviceName = preferNonEmpty(
      canonicalOutput?.actualDeviceName,
      outputInfo.deviceName
    )
    outputInfo.driverName = preferNonEmpty(canonicalOutput?.driverName, info.driverName)
    outputInfo.actualDriverName = preferNonEmpty(
      canonicalOutput?.actualDriverName,
      outputInfo.driverName
    )
    outputInfo.driverVersion = canonicalOutput?.driverVersion ?? info.driverVersion ?? 0
    outputInfo.actualDriverVersion = canonicalOutput?.actualDriverVersion ?? info.driverVersion ?? 0
    outputInfo.pcmPassthrough = outputInfo.pcmPassthrough === true
    outputInfo.actualOutputFormat =
      canonicalOutput?.actualOutputFormat ?? info.actualOutputFormat ?? ''
    outputInfo.actualSampleRate = canonicalOutput?.actualSampleRate ?? info.actualSampleRate ?? 0
    outputInfo.actualBitDepth = canonicalOutput?.actualBitDepth ?? info.actualBitDepth ?? 0
    outputInfo.actualChannels = canonicalOutput?.actualChannels ?? info.actualChannels ?? 0
    outputInfo.outputSampleRate = canonicalOutput?.outputSampleRate ?? info.outputSampleRate ?? 0
    outputInfo.outputBitDepth = canonicalOutput?.outputBitDepth ?? info.outputBitDepth ?? 0
    outputInfo.bufferSizeFrames = canonicalOutput?.bufferSizeFrames ?? info.bufferSizeFrames ?? 0
    outputInfo.latencyFrames = canonicalOutput?.latencyFrames ?? info.latencyFrames ?? 0
    outputInfo.latencyMs = canonicalOutput?.latencyMs ?? info.latencyMs ?? 0
    outputInfo.channelRoutingMode =
      canonicalOutput?.channelRoutingMode ??
      info.channelRoutingMode ??
      this.outputConfig.routingMode
    outputInfo.deviceRecovered = canonicalOutput?.deviceRecovered ?? info.deviceRecovered ?? false
    outputInfo.recoveryCount = canonicalOutput?.recoveryCount ?? info.recoveryCount ?? 0
    outputInfo.latencyInfo = latencyInfo
    outputInfo.diagnostics = diagnostics
    return {
      ...info,
      outputInfo,
      outputBackend: outputInfo.backend,
      outputDevice: outputInfo.deviceName,
      actualBackend: outputInfo.actualBackend,
      accessMode: outputInfo.accessMode,
      devicePathKind: outputInfo.devicePathKind,
      driverName: preferNonEmpty(
        outputInfo.driverName,
        outputInfo.actualDriverName,
        info.driverName
      ),
      driverVersion:
        outputInfo.driverVersion || outputInfo.actualDriverVersion || info.driverVersion || 0,
      actualOutputFormat: outputInfo.actualOutputFormat,
      actualSampleRate: outputInfo.actualSampleRate,
      actualBitDepth: outputInfo.actualBitDepth,
      actualChannels: outputInfo.actualChannels,
      decodedSampleRate: info.decodedSampleRate || 0,
      decodedBitDepth: info.decodedBitDepth || 0,
      decodedChannels: info.decodedChannels || 0,
      decodedSampleFormat: info.decodedSampleFormat || '',
      bufferSizeFrames: outputInfo.bufferSizeFrames,
      latencyFrames: outputInfo.latencyFrames,
      latencyMs: outputInfo.latencyMs,
      latencyInfo,
      channelRoutingMode: outputInfo.channelRoutingMode,
      supportsOutputPerfect,
      sourceExact,
      diagnostics,
      deviceRecovered: outputInfo.deviceRecovered === true,
      recoveryCount: outputInfo.recoveryCount,
      outputSampleRate: outputInfo.outputSampleRate,
      outputBitDepth: outputInfo.outputBitDepth,
      channelCount: outputInfo.actualChannels || info.channelCount || 0,
      outputPerfect,
      pcmPassthrough: outputInfo.pcmPassthrough === true,
      isDsd,
      dsdMode,
      dsdRate,
      perfectReasonCode: outputInfo.perfectReasonCode,
      capabilityReason: outputInfo.capabilityReason,
      crossfadeActive: info.crossfadeActive === true || this.processing.crossfadeSeconds > 0,
      crossfadeSeconds: info.crossfadeSeconds || this.processing.crossfadeSeconds || 0,
      perfectReason: outputInfo.perfectReason,
      nativePlaybackActive: this.nativePlaybackActive
    }
  }

  private syncPlaybackOutputMirrorsFromOutputInfo(): void {
    const outputInfo = this.playbackInfo.outputInfo
    this.playbackInfo.actualBackend = outputInfo.actualBackend || outputInfo.backend || ''
    this.playbackInfo.accessMode = outputInfo.accessMode || ''
    this.playbackInfo.devicePathKind = outputInfo.devicePathKind || ''
    this.playbackInfo.actualOutputFormat = outputInfo.actualOutputFormat || ''
    this.playbackInfo.actualSampleRate = outputInfo.actualSampleRate || 0
    this.playbackInfo.actualBitDepth = outputInfo.actualBitDepth || 0
    this.playbackInfo.actualChannels = outputInfo.actualChannels || 0
    this.playbackInfo.bufferSizeFrames = outputInfo.bufferSizeFrames || 0
    this.playbackInfo.latencyFrames = outputInfo.latencyFrames || 0
    this.playbackInfo.latencyMs = outputInfo.latencyMs || 0
    this.playbackInfo.latencyInfo = outputInfo.latencyInfo
    this.playbackInfo.channelRoutingMode =
      outputInfo.channelRoutingMode || this.outputConfig.routingMode
    this.playbackInfo.supportsOutputPerfect = outputInfo.supportsOutputPerfect === true
    this.playbackInfo.sourceExact = outputInfo.sourceExact === true
    this.playbackInfo.diagnostics = outputInfo.diagnostics
    this.playbackInfo.deviceRecovered = outputInfo.deviceRecovered === true
    this.playbackInfo.recoveryCount = outputInfo.recoveryCount || 0
    this.playbackInfo.outputSampleRate = outputInfo.outputSampleRate || 0
    this.playbackInfo.outputBitDepth = outputInfo.outputBitDepth || 0
    this.playbackInfo.outputPerfect = outputInfo.outputPerfect === true
    this.playbackInfo.pcmPassthrough = outputInfo.pcmPassthrough === true
    this.playbackInfo.perfectReason = outputInfo.perfectReason || ''
    this.playbackInfo.perfectReasonCode = outputInfo.perfectReasonCode || ''
    this.playbackInfo.capabilityReason = outputInfo.capabilityReason || ''
    this.playbackInfo.isDsd = outputInfo.isDsd === true
    this.playbackInfo.dsdMode =
      outputInfo.isDsd === true ? outputInfo.dsdMode || 'unsupported' : 'pcm'
    this.playbackInfo.dsdRate = outputInfo.isDsd === true ? outputInfo.dsdRate || 0 : 0
  }

  private tick(): void {
    if (this.destroyed) return

    this.pollAudioDeviceOptionsForChanges()

    if (this.nativePlaybackActive) {
      const previousCapabilitySignature = this.createDeviceCapabilityRefreshSignature(
        this.playbackInfo
      )
      const wasPlaying = this.playbackInfo.state === 'playing'
      const previousSource = this.playbackInfo.source
      const previousQueueIndex = this.playbackInfo.queueIndex
      const nativeInfo = this.readNativePlaybackInfo()
      if (nativeInfo) {
        this.playbackInfo = this.mergeNativePlaybackInfo(nativeInfo)
        const nextCapabilitySignature = this.createDeviceCapabilityRefreshSignature(
          this.playbackInfo
        )
        if (nextCapabilitySignature !== previousCapabilitySignature) {
          this.invalidateAudioDeviceOptionsCache('native-output-diagnostics-changed')
        }
        this.lastTick = this.scheduler.now()
        this.lastNativePlaybackInfoTickReadAt = this.lastTick
        this.publishProperty('time-pos', this.playbackInfo.position)
        if (this.playbackInfo.duration > 0) {
          this.publishDuration(this.playbackInfo.duration)
        }
        this.publishPlaybackInfo({ dedupePositionOnly: true })
        const switchedTrack =
          nativeInfo.state !== 'stopped' &&
          ((nativeInfo.source && nativeInfo.source !== previousSource) ||
            (nativeInfo.queueIndex >= 0 && nativeInfo.queueIndex !== previousQueueIndex))
        if (switchedTrack) {
          this.emit('start-file')
        }
        if (wasPlaying && nativeInfo.state === 'stopped') {
          const isAtEnd = this.queue.length === 0 || nativeInfo.queueIndex >= this.queue.length - 1
          if (isAtEnd) {
            // 播放结束：保持 nativePlaybackActive=true 以便持续轮询原生真实状态，
            // 避免状态发散后无法自我纠正。下次 play() 会重新设置状态。
            this.publishProperty('eof-reached', true)
          }
        }
      }
      return
    }

    if (this.playbackInfo.state !== 'playing') return
    const now = this.scheduler.now()
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
    if (this.output === 'coreaudio' && this.exclusiveMode) return 'coreaudio-exclusive'
    return this.output
  }

  private resolveCompatibleDevice(output: AudioOutputId, device: string): string {
    const normalized = normalizeAudioDevice(device)
    const options = this.getAudioDeviceOptions()
    return deviceCompatibleWithOutput(output, normalized, options) ? normalized : 'auto'
  }

  private shouldFallbackFromAsio(output: AudioOutputId): boolean {
    return output === 'asio'
  }

  private mergeAudioProcessingSettings(
    settings: Partial<AudioProcessingSettings>
  ): AudioProcessingSettings {
    const normalized = normalizeAudioProcessingSettings({ ...this.processing, ...settings })
    const explicitlyDisabled = settings.dspEnabled === false
    const processingModuleEnabled =
      normalized.eqEnabled ||
      normalized.volumeNormalization !== 'off' ||
      normalized.convolverEnabled ||
      normalized.convolverIrPath.length > 0 ||
      (normalized.crossfeedEnabled && normalized.crossfeedStrength > 0) ||
      Math.abs(normalized.eqPreamp) > 0.001
    return {
      ...normalized,
      dspEnabled: explicitlyDisabled ? false : normalized.dspEnabled || processingModuleEnabled
    }
  }

  private applyNativeDspSettings(
    context: string,
    options: { previousProcessing?: AudioProcessingSettings } = {}
  ): void {
    const previous = options.previousProcessing
    const force = !previous
    const eqChanged =
      force ||
      previous.eqEnabled !== this.processing.eqEnabled ||
      previous.eqMode !== this.processing.eqMode ||
      previous.eqPreamp !== this.processing.eqPreamp ||
      !eqBandsEqual(previous.eqBands, this.processing.eqBands)
    const replayGainChanged =
      force ||
      previous.volumeNormalization !== this.processing.volumeNormalization ||
      previous.replayGainPreamp !== this.processing.replayGainPreamp ||
      previous.replayGainFallback !== this.processing.replayGainFallback ||
      previous.replayGainClip !== this.processing.replayGainClip
    const crossfeedChanged =
      force ||
      previous.crossfeedEnabled !== this.processing.crossfeedEnabled ||
      previous.crossfeedStrength !== this.processing.crossfeedStrength ||
      previous.crossfeedDelayMs !== this.processing.crossfeedDelayMs ||
      previous.crossfeedCutoffHz !== this.processing.crossfeedCutoffHz
    const convolverChanged =
      force ||
      previous.convolverEnabled !== this.processing.convolverEnabled ||
      previous.convolverIrPath !== this.processing.convolverIrPath

    this.tryNative(context, (native) => {
      native.SetDspConfig?.(JSON.stringify(this.processing))
      if (eqChanged) {
        native.SetEqBands?.(JSON.stringify(this.processing))
      }
      if (replayGainChanged) {
        native.SetReplayGainMode?.(
          this.processing.volumeNormalization,
          this.processing.replayGainPreamp,
          this.processing.replayGainFallback,
          this.processing.replayGainClip
        )
      }
      if (crossfeedChanged) {
        native.SetCrossfeedStrength?.(
          this.processing.crossfeedEnabled ? this.processing.crossfeedStrength : 0
        )
      }
      if (convolverChanged && this.processing.convolverIrPath) {
        if (this.processing.convolverIrPath !== this.nativeConvolverIrPath) {
          native.LoadImpulseResponse?.(this.processing.convolverIrPath)
          this.nativeConvolverIrPath = this.processing.convolverIrPath
        }
      } else if (convolverChanged && this.nativeConvolverIrPath) {
        native.UnloadImpulseResponse?.()
        this.nativeConvolverIrPath = ''
      }
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
    this.refreshOutputInfoFromNative(false)
  }

  private invalidateUpcomingTrackCache(): void {
    this.lastUpcomingTrackCache = null
  }

  private getCachedMetadata(source: string): {
    found: boolean
    metadata: NativeAudioMetadata | null
  } {
    const now = this.scheduler.now()
    const cached = this.metadataCache.get(source)
    if (!cached) {
      return { found: false, metadata: null }
    }
    if (now - cached.readAt > METADATA_CACHE_TTL_MS) {
      this.metadataCache.delete(source)
      return { found: false, metadata: null }
    }
    return { found: true, metadata: cached.metadata }
  }

  private cacheMetadata(source: string, metadata: NativeAudioMetadata | null): void {
    const now = this.scheduler.now()
    this.metadataCache.delete(source)
    this.metadataCache.set(source, {
      readAt: now,
      metadata
    })
    this.pruneMetadataCache(now)
  }

  private pruneMetadataCache(now: number): void {
    for (const [source, cached] of this.metadataCache.entries()) {
      if (now - cached.readAt > METADATA_CACHE_TTL_MS) {
        this.metadataCache.delete(source)
      }
    }
    while (this.metadataCache.size > MAX_METADATA_CACHE_ENTRIES) {
      const oldestSource = this.metadataCache.keys().next().value as string | undefined
      if (!oldestSource) return
      this.metadataCache.delete(oldestSource)
    }
  }

  private refreshOutputInfoFromNative(resetDefaults: boolean): void {
    if (resetDefaults) this.resetOutputInfoDefaults()
    const nativeInfo = this.readNativePlaybackInfo()
    if (nativeInfo) this.playbackInfo = this.mergeNativePlaybackInfo(nativeInfo)
    this.updateOutputPerfect()
    this.publishPlaybackInfo()
  }

  private getAudioDeviceOptions(): AudioDeviceOption[] {
    const injectedDevices = this.deviceOptionsProvider?.()
    if (Array.isArray(injectedDevices) && injectedDevices.length > 0) {
      return normalizeAudioDeviceOptions(injectedDevices, this.device)
    }
    const now = this.scheduler.now()
    const cached = this.lastAudioDeviceOptionsCache
    if (
      cached &&
      cached.selectedDevice === this.device &&
      now - cached.readAt <= AUDIO_DEVICE_OPTIONS_CACHE_TTL_MS
    ) {
      return cached.options
    }
    const options = this.readNativeAudioDeviceOptions()
    this.lastAudioDeviceOptionsCache = {
      selectedDevice: this.device,
      readAt: now,
      options
    }
    this.lastAudioDeviceOptionsSignature = this.createAudioDeviceOptionsSignature(options)
    return options
  }

  private readNativeAudioDeviceOptions(): AudioDeviceOption[] {
    let nativeDevices: unknown = null
    try {
      nativeDevices = parseNativeJson(
        this.native?.EnumerateDevices?.(),
        null as AudioDeviceOption[] | null
      )
    } catch {
      // Fall through to the stable default device.
    }
    const normalizedDevices = normalizeAudioDeviceOptions(nativeDevices, this.device)
    return normalizedDevices.length > 0 ? normalizedDevices : [{ ...DEFAULT_AUDIO_DEVICE_OPTION }]
  }

  private invalidateAudioDeviceOptionsCache(reason: string): void {
    this.lastAudioDeviceOptionsCache = null
    this.emit('audio-device-options-changed', { reason })
  }

  private pollAudioDeviceOptionsForChanges(): void {
    if (!this.native || this.deviceOptionsProvider) return
    const now = this.scheduler.now()
    if (now - this.lastAudioDeviceOptionsProbeAt < AUDIO_DEVICE_OPTIONS_HOTPLUG_POLL_MS) return
    this.lastAudioDeviceOptionsProbeAt = now

    const options = this.readNativeAudioDeviceOptions()
    const signature = this.createAudioDeviceOptionsSignature(options)
    if (this.lastAudioDeviceOptionsSignature && signature !== this.lastAudioDeviceOptionsSignature) {
      this.lastAudioDeviceOptionsCache = {
        selectedDevice: this.device,
        readAt: now,
        options
      }
      this.lastAudioDeviceOptionsSignature = signature
      this.emit('audio-device-options-changed', { reason: 'audio-device-hotplug' })
      return
    }
    this.lastAudioDeviceOptionsSignature = signature
  }

  private createAudioDeviceOptionsSignature(options: AudioDeviceOption[]): string {
    return options
      .map((device) =>
        [
          device.id,
          device.label,
          device.backend || '',
          device.pathKind || '',
          device.capabilityVersion || 0,
          device.dopSupportState || '',
          device.nativeDsdSupportState || '',
          (device.sampleRates || []).join(','),
          (device.bitDepths || []).join(','),
          (device.dopCarrierSampleRates || []).join(','),
          (device.nativeDsdSampleRates || []).join(',')
        ].join(':')
      )
      .join('|')
  }

  private createDeviceCapabilityRefreshSignature(info: PlaybackInfo): string {
    const diagnostics = info.outputInfo.diagnostics
    return [
      info.outputInfo.actualBackend,
      info.outputInfo.actualDeviceName,
      info.outputInfo.devicePathKind,
      diagnostics.deviceLostCount,
      diagnostics.driverRestartCount,
      info.outputInfo.deviceRecovered,
      info.outputInfo.recoveryCount
    ].join('|')
  }

  private tryNative(
    context: string,
    command: (native: NativeAudioBinding) => void,
    logFailure = true
  ): boolean {
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
      if (!logFailure) return false
      const fallbackHint = rendererFallbackAllowed()
        ? '使用临时播放通道'
        : '已阻止 HTMLAudio 静默降级'
      console.warn(`原生音频引擎${context}失败，${fallbackHint}：`, message)
      return false
    }
  }

  private async callNativeMaybeAsync(
    context: string,
    method: keyof NativeAudioBinding,
    ...args: unknown[]
  ): Promise<boolean> {
    if (!this.native) {
      this.lastNativeError = '未加载 twilight_audio_node.node'
      return false
    }
    if (typeof this.native.callAsync === 'function') {
      try {
        await this.native.callAsync(String(method), args)
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
    return this.tryNative(context, (native) => {
      const target = native[method]
      if (typeof target !== 'function') {
        throw new Error(`原生音频引擎不支持 ${String(method)}`)
      }
      ;(target as (...callArgs: unknown[]) => unknown).apply(native, args)
    })
  }

  private async tryNativePlay(
    context: string,
    source: string,
    startTime: number,
    logFailure = true
  ): Promise<boolean> {
    if (!this.native) {
      this.lastNativeError = '未加载 twilight_audio_node.node'
      return false
    }
    if (typeof this.native.callAsync === 'function') {
      try {
        await this.native.callAsync('Play', [source, startTime])
        this.lastNativeError = ''
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.lastNativeError = message
        if (!logFailure) return false
        const fallbackHint = rendererFallbackAllowed()
          ? '使用临时播放通道'
          : '已阻止 HTMLAudio 静默降级'
        console.warn(`原生音频引擎${context}失败，${fallbackHint}：`, message)
        return false
      }
    }
    return this.tryNative(context, (native) => native.Play(source, startTime), logFailure)
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
    const shared = (this.output === 'wasapi' || this.output === 'coreaudio') && !this.exclusiveMode
    const perfectReason =
      this.playbackInfo.outputInfo.perfectReason ||
      (shared
        ? '共享输出经过系统混音'
        : supportsOutputPerfect && !dspActive && noResample && outputFormatMatchesSource
          ? '当前 PCM 渲染路径尚未验证样本级直通'
          : '')
    const perfectReasonCode =
      this.playbackInfo.outputInfo.perfectReasonCode ||
      (shared ? 'shared_mixer' : perfectReason ? 'output_not_perfect' : '')
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
        this.output === 'wasapi' || this.output === 'coreaudio'
          ? this.exclusiveMode
          : this.playbackInfo.outputInfo.exclusive,
      supportsOutputPerfect,
      sourceExact: false,
      outputPerfect: false,
      pcmPassthrough: false,
      resampled: this.nativePlaybackActive ? this.playbackInfo.outputInfo.resampled : false,
      accessMode:
        this.playbackInfo.outputInfo.accessMode ||
        (this.output === 'asio'
          ? 'exclusive'
          : this.output === 'wasapi' || this.output === 'coreaudio'
            ? this.exclusiveMode
              ? 'exclusive'
              : 'shared'
            : 'shared'),
      devicePathKind:
        this.playbackInfo.outputInfo.devicePathKind ||
        (this.output === 'asio' ? 'asio' : this.output === 'coreaudio' ? 'hal' : 'default'),
      perfectReasonCode,
      capabilityReason: this.playbackInfo.outputInfo.capabilityReason || perfectReason,
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

  private publishDuration(duration: number, options: { force?: boolean } = {}): void {
    if (!options.force && Object.is(duration, this.lastPublishedDuration)) return
    this.lastPublishedDuration = duration
    this.publishProperty('duration', duration)
  }

  private createPlaybackInfoFanoutKey(): string {
    return createPlaybackInfoFanoutSignature(this.playbackInfo, this.nativePlaybackActive)
  }

  private publishPlaybackInfo(options: { dedupePositionOnly?: boolean } = {}): void {
    const fanoutKey = this.createPlaybackInfoFanoutKey()
    if (options.dedupePositionOnly && fanoutKey === this.lastPlaybackInfoFanoutKey) return

    this.lastPlaybackInfoFanoutKey = fanoutKey
    this.emit('playback-info', {
      ...this.playbackInfo,
      nativePlaybackActive: this.nativePlaybackActive
    })
  }
}
