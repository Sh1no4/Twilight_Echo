import type { BpmAnalysisResult } from '../bpm/bpmCache.ts'
import type { LoudnessAnalysisResult } from './loudnessCache.ts'
import type {
  DspGraphStatus,
  DspScene,
  Vst3ScanDescriptor
} from '../../shared/dspGraph.ts'
import type { DspStatePayload } from '../../shared/audioServiceContract.ts'
import type { CueRange } from '../../shared/cue.ts'
import type { DsdRouteSettings } from '../../shared/audioProcessingOptions.ts'

export type { DsdRouteSettings }

export type AudioOutputId = 'wasapi' | 'asio' | 'coreaudio' | 'alsa'
export type PlayMode = 'sequential' | 'listLoop' | 'repeat' | 'shuffle'
export type EqMode = 'graphic' | 'parametric'
export type VolumeNormalizationMode = 'off' | 'track' | 'album' | 'loudnorm'
export type ChannelRoutingMode =
  | 'auto'
  | 'stereo'
  | 'stereo-to-5.1'
  | 'stereo-to-7.1'
  | 'mono-to-stereo'
  | 'mono-to-multichannel'
/** PCM → DSD output-stage modulation; off keeps PCM sources on the float/typed PCM path. */
export type PcmToDsdMode = 'off' | 'dsd64' | 'dsd128' | 'dsd256'
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
  | 'notch'

export interface EqualizerBand {
  frequency: number
  gain: number
  q: number
  filterType: EqualizerFilterType
  enabled?: boolean
  channelMask?: number
}

export interface AudioProcessingSettings {
  dspEnabled: boolean
  /** Runtime direct path: preserve saved DSP settings while applying an identity graph. */
  directMode: boolean
  clipGuard: boolean
  fftEnabled: boolean
  fftResolution: number
  highResolution: boolean
  dsdToPcm: boolean
  dsdOutputMode: DsdOutputMode
  /** DSD 兼容层路由：与 dsdOutputMode 正交，决定 DSD 走哪条 backend/device。 */
  dsdRoute: DsdRouteSettings
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

export type AudioCapabilitySupportState = 'verified' | 'runtime-probed' | 'unsupported' | 'unknown'

export interface OutputConfig {
  preferredBufferSize: number
  routingMode: ChannelRoutingMode
  wasapiExclusivePushMode?: boolean
  /** After float decode/DSP, modulate PCM to DSD64/128/256 via native DSD or DoP. */
  pcmToDsdMode?: PcmToDsdMode
  upmixCenterGain?: number
  upmixLfeGain?: number
  upmixLfeLowpassHz?: number
  upmixSurroundGain?: number
  upmixSideGain?: number
  upmixSurroundDelayMs?: number
}

export interface OutputConfigApplyStatus {
  requestedRevision: number
  appliedRevision: number
  failedRevision: number
  state: 'idle' | 'pending' | 'applied' | 'failed'
  error: string
  generation: number
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
  dsdIdleFrameCount?: number
  dsdShortReadCount?: number
  dsdTransport?: string
  dsdSourceBitOrder?: string
  dsdSourcePacking?: string
  requestedWireFormat?: string
  actualWireFormat?: string
  containerBits?: number
  validBits?: number
  blockAlign?: number
  semanticSampleRate?: number
  transportSampleRate?: number
  typedRawPath?: boolean
  processingBypassed?: boolean
  nativeDsdNegotiation?: string
  dopRuntimeEvidence?: string
  firstBufferSummary?: string
  processArchitecture?: string
  asioBuildEnabled?: boolean
  asioEnvironmentDisabled?: boolean
  asioRegisteredDriverCount32?: number
  asioRegisteredDriverCount64?: number
  asioLoadableDriverCount64?: number
  /** DSD 兼容层路由的运行时事实（实际走了哪条线），不是配置意图。 */
  dsdRouteOverrideActive?: boolean
  dsdRouteBackend?: string
  dsdRouteDevice?: string
  dsdRouteFallbackReason?: string
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
  /** Initial software gain in [0, 1], restored before the engine reports ready. */
  volume?: number
  audioOutput?: AudioOutputId
  audioDevice?: string
  audioOutputConfig?: Partial<OutputConfig>
  audioProcessing?: Partial<AudioProcessingSettings>
  dspScenes?: DspScene[]
  dspPinnedSceneId?: string | null
}

export type { DspSceneState } from '../../shared/dspGraph.ts'

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
  /** Offline EBU R128 measurement for loudnorm (host-injected). */
  measuredIntegratedLufs?: number
  measuredTruePeakDb?: number
  /** Library / host-injected ReplayGain + R128 tags for track/album cold start. */
  replayGainTrackGainDb?: number
  replayGainAlbumGainDb?: number
  replayGainTrackPeak?: number
  replayGainAlbumPeak?: number
  r128TrackGainDb?: number
  r128AlbumGainDb?: number
  cueRange?: CueRange
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
  /** Application-layer playback rate; 1 = realtime. */
  playbackRate?: number
  requestedConfigRevision: number
  appliedConfigRevision: number
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
  /** Empty when unblocked; else disabled | dsd_path | typed_passthrough | crossfade | format_mismatch */
  gaplessBlockedReason: string
  upcomingTrack: AudioEngineQueueItem | null
  /** Live ICY StreamTitle (radio). Empty when unavailable. */
  streamTitle?: string
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
  nativeDsp?: { plugins: unknown[]; graph?: DspGraphStatus }
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

export interface NativeLoudnessAnalysisOptions {
  maxAnalysisSeconds?: number
}

export type LoudnormStatus = 'idle' | 'measuring' | 'cached' | 'fallback' | 'unavailable'

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
  SetPlaybackRate: (rate: number) => void
  /** A-B loop; end <= start clears. Optional on older native bindings. */
  SetLoopRange?: (startSeconds: number, endSeconds: number) => void
  SetOutputDevice: (device: string) => void
  SetOutputBackend: (backend: string) => void
  SetOutputConfig?: (json: string) => void
  LoadQueue?: (queueJson: string, startIndex: number) => void
  Next?: () => void
  Previous?: () => void
  SetPlayMode?: (mode: 'sequential' | 'repeat' | 'shuffle') => void
  SetDspConfig?: (json: string) => void
  SetDspGraph?: (json: string) => void
  ApplyDspState: (revision: number, json: string) => void
  GetDspGraphStatus: () => string | DspGraphStatus
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
  ScanVst3Module?: (modulePath: string) => string | Vst3ScanDescriptor
  GetMetadata?: (source: string) => string | NativeAudioMetadata
  GetPlaybackInfo?: () => string | PlaybackInfo
  GetUpcomingTrack?: () => string | AudioEngineQueueItem | null
  GetSpectrumData?: (points?: number) => number[]
  GetVisualizationData?: (optionsJson: string) => string | VisualizationData
  AnalyzeBpm?: (source: string, optionsJson?: string) => string | BpmAnalysisResult
  AnalyzeLoudness?: (source: string, optionsJson?: string) => string | LoudnessAnalysisResult
  EnumerateDevices?: () => string | AudioDeviceOption[]
  EnumerateBackends?: () => string
  GetEngineCapabilities?: () => string
  GetLastError?: () => string
  /** 异步调用原生方法（service 模式下等待 utility 进程返回）。直接 N-API 模式不实现此方法。 */
  callAsync?: (method: string, args: unknown[]) => Promise<unknown>
}

export interface AudioEngineServiceNativeBinding extends NativeAudioBinding {
  getMetadataAsync: (source: string) => Promise<string | NativeAudioMetadata>
  applyDspState: (revision: number, payload: DspStatePayload) => Promise<DspGraphStatus>
  applyDspGraph: (json: string) => Promise<DspGraphStatus>
  getDspGraphStatusAsync: () => Promise<DspGraphStatus>
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
  dspAssetPathResolver?: (assetId: string) => string | null
  vst3ModuleResolver?: (
    catalogId: string,
    classId: string
  ) => {
    modulePath: string | null
    classId: string
    reason: string
  }
  vst3StateAssetResolver?: (assetId: string) => {
    path: string | null
    kind: 'vst3Preset' | 'vst3State' | null
    reason: string
  }
}

export interface ConvolverInfo {
  loaded: boolean
  active: boolean
  bypassed: boolean
  irResampled: boolean
  path: string
  sampleRate: number
  channels: number
  lengthFrames: number
  lengthMs: number
  partitionSize: number
  latencyFrames: number
  overrunCount: number
  lastProcessMs: number
  maxProcessMs: number
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
