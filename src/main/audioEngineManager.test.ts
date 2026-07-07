import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'

import type {
  AudioEngineServiceNativeBinding,
  AudioDeviceOption,
  AudioEngineManagerDependencies,
  AudioEngineQueueItem,
  ConvolverInfo,
  LatencyInfo,
  NativeAudioBinding,
  OutputConfig,
  OutputDiagnostics,
  OutputInfo,
  PlaybackInfo,
  PlayMode,
  AudioProcessingSettings,
  VolumeNormalizationMode
} from './audioEngineManager'

const {
  AudioEngineManager,
  DEFAULT_AUDIO_PROCESSING,
  createPlaybackInfoFanoutSignature,
  mapSpectrumToVisualizerBars,
  normalizeAudioProcessingSettings
} = (await import(
  new URL('./audioEngineManager.ts', import.meta.url).href
)) as typeof import('./audioEngineManager')

const DEVICE_OPTIONS: AudioDeviceOption[] = [
  {
    id: 'auto',
    label: 'System Default',
    name: 'System Default',
    isDefault: true,
    supportsExclusive: true,
    pathKind: 'default'
  },
  {
    id: 'dac-1',
    label: 'Desk DAC',
    name: 'Desk DAC',
    isDefault: false,
    supportsExclusive: true,
    pathKind: 'default'
  },
  {
    id: 'asio:studio',
    label: 'Studio ASIO',
    name: 'Studio ASIO',
    isDefault: false,
    supportsExclusive: true,
    pathKind: 'asio',
    minBufferSize: 64,
    maxBufferSize: 2048,
    granularity: 64,
    preferredBufferSize: 256,
    supportsDop: true,
    supportsNativeDsd: true,
    supportedDsdRates: [64],
    nativeDsdSampleRates: [2822400, 5644800, 11289600],
    nativeDsdSampleFormats: ['dsd-int8-msb1'],
    dopCarrierSampleRates: [176400],
    dopCarrierFormats: ['int24-in32'],
    capabilityVersion: 3
  }
]

const TEST_SCHEDULER: AudioEngineManagerDependencies['scheduler'] = {
  now: () => 1000,
  setInterval: () => ({}) as NodeJS.Timeout,
  clearInterval: () => {},
  setImmediate: (callback) => callback()
}

function makeLatencyInfo(
  bufferLatencyMs = 0,
  outputLatencyMs = 0,
  totalLatencyMs = bufferLatencyMs + outputLatencyMs
): LatencyInfo {
  return {
    bufferLatencyMs,
    outputLatencyMs,
    totalLatencyMs
  }
}

function makeDiagnostics(overrides: Partial<OutputDiagnostics> = {}): OutputDiagnostics {
  return {
    sessionUnderrunCount: 0,
    sessionBufferDropCount: 0,
    sessionRecoveryCount: 0,
    lifetimeUnderrunCount: 0,
    lifetimeBufferDropCount: 0,
    lifetimeRecoveryCount: 0,
    driverRestartCount: 0,
    deviceLostCount: 0,
    lastError: '',
    ...overrides
  }
}

function makeOutputInfo(overrides: Partial<OutputInfo> = {}): OutputInfo {
  return {
    exclusive: false,
    supportsOutputPerfect: false,
    sourceExact: false,
    outputPerfect: false,
    pcmPassthrough: false,
    resampled: false,
    perfectReason: '共享输出经过系统混音',
    outputSampleRate: 48000,
    outputBitDepth: 32,
    backend: 'wasapi',
    actualBackend: 'wasapi',
    deviceName: 'System Default',
    actualDeviceName: 'System Default',
    driverName: '',
    actualDriverName: '',
    driverVersion: 0,
    actualDriverVersion: 0,
    actualOutputFormat: 'float32',
    actualSampleRate: 48000,
    actualBitDepth: 32,
    actualChannels: 2,
    accessMode: 'shared',
    devicePathKind: 'default',
    perfectReasonCode: 'shared_mixer',
    capabilityReason: '共享输出经过系统混音',
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
    bufferSizeFrames: 480,
    latencyFrames: 480,
    latencyMs: 10,
    latencyInfo: makeLatencyInfo(10, 0, 10),
    channelRoutingMode: 'auto',
    diagnostics: makeDiagnostics(),
    deviceRecovered: false,
    recoveryCount: 0,
    isDsd: false,
    dsdMode: 'pcm',
    dsdRate: 0,
    ...overrides
  }
}

function makePlaybackInfo(overrides: Partial<PlaybackInfo> = {}): PlaybackInfo {
  const outputInfo = makeOutputInfo(overrides.outputInfo)
  return {
    state: 'stopped',
    position: 0,
    duration: 0,
    volume: 1,
    queueIndex: -1,
    playMode: 'sequential',
    source: '',
    codec: 'flac',
    bitrate: 0,
    sourceSampleRate: 48000,
    sourceBitDepth: 24,
    decodedSampleRate: 48000,
    decodedBitDepth: 32,
    decodedChannels: 2,
    decodedSampleFormat: 'float32',
    outputBackend: outputInfo.backend,
    outputDevice: outputInfo.deviceName,
    actualBackend: outputInfo.actualBackend,
    driverName: outputInfo.driverName,
    driverVersion: outputInfo.driverVersion,
    actualOutputFormat: outputInfo.actualOutputFormat,
    actualSampleRate: outputInfo.actualSampleRate,
    actualBitDepth: outputInfo.actualBitDepth,
    actualChannels: outputInfo.actualChannels,
    bufferSizeFrames: outputInfo.bufferSizeFrames,
    latencyFrames: outputInfo.latencyFrames,
    latencyMs: outputInfo.latencyMs,
    latencyInfo: outputInfo.latencyInfo,
    channelRoutingMode: outputInfo.channelRoutingMode,
    supportsOutputPerfect: outputInfo.supportsOutputPerfect,
    sourceExact: outputInfo.sourceExact,
    diagnostics: outputInfo.diagnostics,
    deviceRecovered: outputInfo.deviceRecovered,
    recoveryCount: outputInfo.recoveryCount,
    outputSampleRate: outputInfo.outputSampleRate,
    outputBitDepth: outputInfo.outputBitDepth,
    channelCount: outputInfo.actualChannels,
    outputPerfect: outputInfo.outputPerfect,
    pcmPassthrough: outputInfo.pcmPassthrough,
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
    perfectReason: outputInfo.perfectReason,
    perfectReasonCode: outputInfo.perfectReasonCode,
    isDsd: outputInfo.isDsd,
    dsdMode: outputInfo.dsdMode,
    dsdRate: outputInfo.dsdRate,
    gaplessActive: false,
    preloadReady: false,
    upcomingTrack: null,
    nativePlaybackActive: false,
    ...overrides,
    outputInfo
  }
}

function assertPlaybackMirrorsOutputInfo(info: PlaybackInfo): void {
  assert.equal(info.outputBackend, info.outputInfo.backend)
  assert.equal(info.outputDevice, info.outputInfo.deviceName)
  assert.equal(info.actualBackend, info.outputInfo.actualBackend)
  assert.equal(info.actualOutputFormat, info.outputInfo.actualOutputFormat)
  assert.equal(info.actualSampleRate, info.outputInfo.actualSampleRate)
  assert.equal(info.actualBitDepth, info.outputInfo.actualBitDepth)
  assert.equal(info.actualChannels, info.outputInfo.actualChannels)
  assert.equal(info.bufferSizeFrames, info.outputInfo.bufferSizeFrames)
  assert.equal(info.latencyFrames, info.outputInfo.latencyFrames)
  assert.equal(info.latencyMs, info.outputInfo.latencyMs)
  assert.deepEqual(info.latencyInfo, info.outputInfo.latencyInfo)
  assert.equal(info.channelRoutingMode, info.outputInfo.channelRoutingMode)
  assert.equal(info.supportsOutputPerfect, info.outputInfo.supportsOutputPerfect)
  assert.equal(info.sourceExact, info.outputInfo.sourceExact)
  assert.deepEqual(info.diagnostics, info.outputInfo.diagnostics)
  assert.equal(info.deviceRecovered, info.outputInfo.deviceRecovered)
  assert.equal(info.recoveryCount, info.outputInfo.recoveryCount)
  assert.equal(info.outputSampleRate, info.outputInfo.outputSampleRate)
  assert.equal(info.outputBitDepth, info.outputInfo.outputBitDepth)
  assert.equal(info.outputPerfect, info.outputInfo.outputPerfect)
  assert.equal(info.pcmPassthrough, info.outputInfo.pcmPassthrough)
  assert.equal(info.perfectReason, info.outputInfo.perfectReason)
  assert.equal(info.perfectReasonCode, info.outputInfo.perfectReasonCode)
  assert.equal(info.isDsd, info.outputInfo.isDsd)
  assert.equal(info.dsdMode, info.outputInfo.dsdMode)
  assert.equal(info.dsdRate, info.outputInfo.dsdRate)
}

test('playback fanout signature ignores native tick position changes', () => {
  const info = makePlaybackInfo({
    state: 'playing',
    position: 12.5,
    duration: 240,
    queueIndex: 0,
    source: 'track.flac',
    nativePlaybackActive: true
  })
  const positionOnlyTick: PlaybackInfo = {
    ...info,
    position: 13
  }

  assert.equal(
    createPlaybackInfoFanoutSignature(info, true),
    createPlaybackInfoFanoutSignature(positionOnlyTick, true)
  )
})

test('playback fanout signature changes for non-position playback facts', () => {
  const info = makePlaybackInfo({
    state: 'playing',
    position: 12.5,
    duration: 240,
    queueIndex: 0,
    source: 'track.flac',
    dspActive: false,
    nativePlaybackActive: true,
    outputInfo: makeOutputInfo({
      actualBackend: 'wasapi',
      perfectReasonCode: 'shared_mixer',
      nativeDsp: {
        plugins: [
          {
            id: 'com.example.eq',
            active: true,
            bypassed: false,
            lastError: ''
          }
        ]
      }
    })
  })
  const base = createPlaybackInfoFanoutSignature(info, true)
  const cases: Array<[string, PlaybackInfo, boolean]> = [
    ['state', { ...info, state: 'paused' }, true],
    ['duration', { ...info, duration: 241 }, true],
    ['queueIndex', { ...info, queueIndex: 1 }, true],
    ['source', { ...info, source: 'other.flac' }, true],
    [
      'actualBackend',
      {
        ...info,
        actualBackend: 'asio',
        outputInfo: { ...info.outputInfo, actualBackend: 'asio' }
      },
      true
    ],
    [
      'perfectReasonCode',
      {
        ...info,
        perfectReasonCode: 'native_dsp_active',
        outputInfo: { ...info.outputInfo, perfectReasonCode: 'native_dsp_active' }
      },
      true
    ],
    [
      'dsdMode',
      {
        ...info,
        isDsd: true,
        dsdMode: 'dop',
        outputInfo: { ...info.outputInfo, isDsd: true, dsdMode: 'dop' }
      },
      true
    ],
    ['dspActive', { ...info, dspActive: true }, true],
    [
      'diagnostics',
      {
        ...info,
        recoveryCount: 1,
        diagnostics: { ...info.diagnostics, lastError: 'driver restart' },
        outputInfo: {
          ...info.outputInfo,
          recoveryCount: 1,
          diagnostics: { ...info.outputInfo.diagnostics, lastError: 'driver restart' }
        }
      },
      true
    ],
    [
      'nativeDspStatus',
      {
        ...info,
        outputInfo: {
          ...info.outputInfo,
          nativeDsp: {
            plugins: [
              {
                id: 'com.example.eq',
                active: false,
                bypassed: true,
                bypassReason: 'process exceeded realtime budget',
                lastError: 'process exceeded realtime budget'
              }
            ]
          }
        }
      },
      true
    ],
    ['nativePlaybackActive', info, false]
  ]

  for (const [label, changedInfo, nativePlaybackActive] of cases) {
    assert.notEqual(
      createPlaybackInfoFanoutSignature(changedInfo, nativePlaybackActive),
      base,
      label
    )
  }
})

class FakeNativeBinding implements NativeAudioBinding {
  playbackInfo: PlaybackInfo
  devices: AudioDeviceOption[]
  lastOutputConfig: OutputConfig = { preferredBufferSize: 0, routingMode: 'auto' }
  lastDspConfig: Partial<AudioProcessingSettings> = {}
  lastEqConfig: Partial<AudioProcessingSettings> = {}
  lastEqPresetConfig: Partial<AudioProcessingSettings> = {}
  lastReplayGainConfig: {
    mode: VolumeNormalizationMode
    preamp: number
    fallback: number
    clip: boolean
  } | null = null
  lastCrossfeedStrength = 0
  loadedImpulseResponsePath = ''
  nativeDspPluginChainJson = ''
  lastLoadedQueue: AudioEngineQueueItem[] = []
  lastLoadedQueueIndex = -1
  failAsioPlayWith = ''
  lastErrorMessage = ''
  nextLeavesStopped = false
  nextCalls = 0
  playbackInfoReads = 0
  spectrumReads = 0
  visualizationReads = 0
  volumeCalls = 0
  playModeCalls = 0
  metadataReads = 0
  upcomingTrackReads = 0
  outputConfigCalls = 0
  outputDeviceCalls = 0
  outputBackendCalls = 0
  loadQueueCalls = 0
  stopCalls = 0
  seekCalls = 0
  enumerateDeviceCalls = 0
  dspConfigCalls = 0
  eqBandsCalls = 0
  eqPresetCalls = 0
  replayGainCalls = 0
  crossfeedCalls = 0
  loadImpulseResponseCalls = 0
  unloadImpulseResponseCalls = 0
  nativeDspPluginChainCalls = 0
  nativeDspPluginStatusReads = 0
  convolverInfoReads = 0
  playCalls: Array<{ backend: string; device: string; source: string; startTime: number }> = []

  constructor(playbackInfo?: Partial<PlaybackInfo>, devices = DEVICE_OPTIONS) {
    this.devices = devices
    this.playbackInfo = makePlaybackInfo(playbackInfo)
  }

  Play = (source: string, startTime = 0): void => {
    const backend = this.playbackInfo.outputInfo.actualBackend
    const device = this.playbackInfo.outputInfo.deviceName
    this.playCalls.push({ backend, device, source, startTime })
    if (backend === 'asio' && this.failAsioPlayWith) {
      this.lastErrorMessage = this.failAsioPlayWith
      throw new Error(this.failAsioPlayWith)
    }
    this.lastErrorMessage = ''
    this.playbackInfo = {
      ...this.playbackInfo,
      state: 'playing',
      source,
      position: startTime,
      nativePlaybackActive: true
    }
  }

  Pause = (): void => {
    this.playbackInfo = {
      ...this.playbackInfo,
      state: this.playbackInfo.state === 'paused' ? 'playing' : 'paused'
    }
  }

  Stop = (): void => {
    this.stopCalls += 1
    this.playbackInfo = {
      ...this.playbackInfo,
      state: 'stopped',
      position: 0
    }
  }

  Seek = (time: number): void => {
    this.seekCalls += 1
    this.playbackInfo = {
      ...this.playbackInfo,
      position: time
    }
  }

  SetVolume = (volume: number): void => {
    this.volumeCalls += 1
    this.playbackInfo = {
      ...this.playbackInfo,
      volume
    }
  }

  SetOutputDevice = (device: string): void => {
    this.outputDeviceCalls += 1
    const currentBackend = this.playbackInfo.outputInfo.actualBackend
    const nextDevice =
      device === 'auto' && currentBackend === 'asio'
        ? (this.devices.find((entry) => entry.pathKind === 'asio') ?? this.devices[0])
        : (this.devices.find((entry) => entry.id === device) ?? this.devices[0])
    const deviceName = nextDevice.name || nextDevice.label
    const outputInfo = {
      ...this.playbackInfo.outputInfo,
      deviceName: device,
      actualDeviceName: deviceName,
      devicePathKind: nextDevice.pathKind || this.playbackInfo.outputInfo.devicePathKind
    }
    this.playbackInfo = this.withOutputInfo(outputInfo, {
      outputDevice: device
    })
  }

  SetOutputBackend = (backend: string): void => {
    this.outputBackendCalls += 1
    const exclusive =
      backend === 'asio' || backend === 'wasapi-exclusive' || backend === 'coreaudio-exclusive'
    const accessMode = backend === 'wasapi' || backend === 'coreaudio' ? 'shared' : 'exclusive'
    const devicePathKind =
      backend === 'asio'
        ? 'asio'
        : backend === 'coreaudio' || backend === 'coreaudio-exclusive'
          ? 'hal'
          : 'default'
    const supportsOutputPerfect =
      backend === 'asio' || backend === 'wasapi-exclusive' || backend === 'coreaudio-exclusive'
    const perfectReasonCode = backend === 'wasapi' || backend === 'coreaudio' ? 'shared_mixer' : ''
    const perfectReason =
      backend === 'wasapi' || backend === 'coreaudio' ? '共享输出经过系统混音' : ''
    const capabilityReason = perfectReason
    const outputInfo = {
      ...this.playbackInfo.outputInfo,
      exclusive,
      accessMode,
      backend,
      actualBackend: backend,
      devicePathKind,
      deviceName: backend === 'asio' ? 'asio:studio' : 'auto',
      actualDeviceName: backend === 'asio' ? 'Studio ASIO' : 'System Default',
      supportsOutputPerfect,
      perfectReasonCode,
      perfectReason,
      capabilityReason,
      outputPerfect: false,
      sourceExact: false,
      pcmPassthrough: false
    }
    this.playbackInfo = this.withOutputInfo(outputInfo, {
      outputBackend: backend,
      outputDevice: outputInfo.deviceName,
      actualBackend: backend
    })
  }

  SetOutputConfig = (json: string): void => {
    this.outputConfigCalls += 1
    const parsed = JSON.parse(json) as Partial<OutputConfig>
    this.lastOutputConfig = {
      preferredBufferSize:
        typeof parsed.preferredBufferSize === 'number'
          ? parsed.preferredBufferSize
          : this.lastOutputConfig.preferredBufferSize,
      routingMode:
        typeof parsed.routingMode === 'string'
          ? parsed.routingMode
          : this.lastOutputConfig.routingMode,
      wasapiExclusivePushMode:
        parsed.wasapiExclusivePushMode ?? this.lastOutputConfig.wasapiExclusivePushMode,
      upmixCenterGain: parsed.upmixCenterGain ?? this.lastOutputConfig.upmixCenterGain,
      upmixLfeGain: parsed.upmixLfeGain ?? this.lastOutputConfig.upmixLfeGain,
      upmixLfeLowpassHz: parsed.upmixLfeLowpassHz ?? this.lastOutputConfig.upmixLfeLowpassHz,
      upmixSurroundGain: parsed.upmixSurroundGain ?? this.lastOutputConfig.upmixSurroundGain,
      upmixSideGain: parsed.upmixSideGain ?? this.lastOutputConfig.upmixSideGain,
      upmixSurroundDelayMs:
        parsed.upmixSurroundDelayMs ?? this.lastOutputConfig.upmixSurroundDelayMs
    }
    const actualBufferSize =
      this.playbackInfo.outputInfo.actualBackend === 'asio'
        ? this.resolveAsioBufferSize(this.lastOutputConfig.preferredBufferSize)
        : this.playbackInfo.outputInfo.actualBackend === 'wasapi-exclusive'
          ? this.resolveExclusiveBufferSize(this.lastOutputConfig.preferredBufferSize)
          : this.resolveSharedBufferSize(this.lastOutputConfig.preferredBufferSize)
    const sampleRate = this.playbackInfo.outputInfo.actualSampleRate || 48000
    const bufferLatencyMs = actualBufferSize > 0 ? (actualBufferSize * 1000) / sampleRate : 0
    const driverLatencyMs = this.playbackInfo.outputInfo.actualBackend === 'asio' ? 2 : 1
    const perfectReasonCode =
      this.lastOutputConfig.routingMode && this.lastOutputConfig.routingMode !== 'auto'
        ? 'routing_changes_semantics'
        : this.playbackInfo.outputInfo.actualBackend === 'wasapi' ||
            this.playbackInfo.outputInfo.actualBackend === 'coreaudio'
          ? 'shared_mixer'
          : ''
    const perfectReason =
      perfectReasonCode === 'routing_changes_semantics'
        ? '声道映射改变声道语义'
        : this.playbackInfo.outputInfo.actualBackend === 'wasapi' ||
            this.playbackInfo.outputInfo.actualBackend === 'coreaudio'
          ? '共享输出经过系统混音'
          : ''
    const outputInfo = {
      ...this.playbackInfo.outputInfo,
      bufferSizeFrames: actualBufferSize,
      latencyFrames: actualBufferSize,
      latencyMs: bufferLatencyMs + driverLatencyMs,
      latencyInfo: makeLatencyInfo(
        bufferLatencyMs,
        driverLatencyMs,
        bufferLatencyMs + driverLatencyMs
      ),
      channelRoutingMode: this.lastOutputConfig.routingMode,
      perfectReasonCode,
      perfectReason,
      capabilityReason: perfectReason
    }
    this.playbackInfo = this.withOutputInfo(outputInfo, {
      channelRoutingMode: outputInfo.channelRoutingMode
    })
  }

  LoadQueue = (queueJson: string, startIndex: number): void => {
    this.loadQueueCalls += 1
    const queue = JSON.parse(queueJson) as AudioEngineQueueItem[]
    this.lastLoadedQueue = queue
    this.lastLoadedQueueIndex = startIndex
    this.playbackInfo = {
      ...this.playbackInfo,
      queueIndex: queue.length > 0 ? Math.min(Math.max(0, startIndex), queue.length - 1) : -1
    }
  }
  Next = (): void => {
    this.nextCalls += 1
    if (this.nextLeavesStopped) {
      this.playbackInfo = {
        ...this.playbackInfo,
        state: 'stopped',
        queueIndex: this.playbackInfo.queueIndex + 1
      }
    }
  }
  Previous = (): void => {}
  SetPlayMode = (mode: PlayMode): void => {
    this.playModeCalls += 1
    this.playbackInfo = {
      ...this.playbackInfo,
      playMode: mode
    }
  }

  SetDspConfig = (json: string): void => {
    this.dspConfigCalls += 1
    this.lastDspConfig = JSON.parse(json) as Partial<AudioProcessingSettings>
  }
  LoadImpulseResponse = (path: string): void => {
    this.loadImpulseResponseCalls += 1
    this.loadedImpulseResponsePath = path
  }
  UnloadImpulseResponse = (): void => {
    this.unloadImpulseResponseCalls += 1
    this.loadedImpulseResponsePath = ''
  }
  GetConvolverInfo = (): string => {
    this.convolverInfoReads += 1
    return JSON.stringify({ loaded: false, active: false, reads: this.convolverInfoReads })
  }
  SetEqBands = (json: string): void => {
    this.eqBandsCalls += 1
    this.lastEqConfig = JSON.parse(json) as Partial<AudioProcessingSettings>
  }
  SetEqPreset = (json: string): void => {
    this.eqPresetCalls += 1
    this.lastEqPresetConfig = JSON.parse(json) as Partial<AudioProcessingSettings>
  }
  SetCrossfeedStrength = (strength: number): void => {
    this.crossfeedCalls += 1
    this.lastCrossfeedStrength = strength
  }
  SetReplayGainMode = (
    mode: VolumeNormalizationMode,
    preamp: number,
    fallback: number,
    clip: boolean
  ): void => {
    this.replayGainCalls += 1
    this.lastReplayGainConfig = { mode, preamp, fallback, clip }
  }
  SetDspPluginChain = (json: string): void => {
    this.nativeDspPluginChainCalls += 1
    this.nativeDspPluginChainJson = json
  }
  GetMetadata = (source: string): string => {
    this.metadataReads += 1
    return JSON.stringify({
      source,
      title: `sync metadata ${this.metadataReads}`,
      error: ''
    })
  }
  GetDspPluginStatus = (): string => {
    this.nativeDspPluginStatusReads += 1
    return JSON.stringify({
      plugins: [{ id: 'com.example.eq', reads: this.nativeDspPluginStatusReads }]
    })
  }
  GetPlaybackInfo = (): string => {
    this.playbackInfoReads += 1
    return JSON.stringify(this.playbackInfo)
  }
  GetUpcomingTrack = (): AudioEngineQueueItem | null => {
    this.upcomingTrackReads += 1
    return {
      id: `upcoming-${this.upcomingTrackReads}`,
      source: `file:///upcoming-${this.upcomingTrackReads}.flac`,
      title: `Upcoming ${this.upcomingTrackReads}`
    }
  }
  GetSpectrumData = (points = 64): number[] => {
    this.spectrumReads += 1
    return Array.from({ length: points }, (_, index) => this.spectrumReads + index / 100)
  }
  GetVisualizationData = (optionsJson: string): string => {
    this.visualizationReads += 1
    const options = JSON.parse(optionsJson || '{}') as {
      spectrumPoints?: number
      waveformPoints?: number
      spectrogramFrames?: number
    }
    const spectrumPoints = options.spectrumPoints ?? 64
    const waveformPoints = options.waveformPoints ?? 128
    return JSON.stringify({
      spectrum: Array.from(
        { length: spectrumPoints },
        (_, index) => index / Math.max(1, spectrumPoints - 1)
      ),
      waveform: Array.from({ length: waveformPoints }, (_, index) => Math.sin(index / 8)),
      peakDb: -3,
      rmsDb: -12,
      lufsMomentary: -15,
      spectrogram: [
        Array.from({ length: spectrumPoints }, () => 0.25),
        Array.from({ length: spectrumPoints }, () => 0.5)
      ],
      sampleRate: 48000,
      active: true
    })
  }
  EnumerateDevices = (): string => {
    this.enumerateDeviceCalls += 1
    return JSON.stringify(this.devices)
  }
  EnumerateBackends = (): string =>
    JSON.stringify(['wasapi', 'wasapi-exclusive', 'asio', 'coreaudio', 'coreaudio-exclusive'])
  GetEngineCapabilities = (): string => JSON.stringify({})
  GetLastError = (): string => JSON.stringify({ message: this.lastErrorMessage })

  setDiagnostics(diagnostics: Partial<OutputDiagnostics>, extras: Partial<OutputInfo> = {}): void {
    const nextDiagnostics = {
      ...this.playbackInfo.outputInfo.diagnostics,
      ...diagnostics
    }
    const outputInfo = {
      ...this.playbackInfo.outputInfo,
      diagnostics: nextDiagnostics,
      deviceRecovered: extras.deviceRecovered ?? this.playbackInfo.outputInfo.deviceRecovered,
      recoveryCount: extras.recoveryCount ?? this.playbackInfo.outputInfo.recoveryCount,
      perfectReasonCode: extras.perfectReasonCode ?? this.playbackInfo.outputInfo.perfectReasonCode,
      perfectReason: extras.perfectReason ?? this.playbackInfo.outputInfo.perfectReason,
      capabilityReason: extras.capabilityReason ?? this.playbackInfo.outputInfo.capabilityReason
    }
    this.playbackInfo = this.withOutputInfo(outputInfo)
  }

  private resolveExclusiveBufferSize(requested: number): number {
    if (requested === 0) return 256
    if (requested === 512) return 448
    return requested
  }

  private resolveSharedBufferSize(requested: number): number {
    return requested > 0 ? requested : 480
  }

  private resolveAsioBufferSize(requested: number): number {
    if (requested === 0) return 256
    const clamped = Math.min(2048, Math.max(64, requested))
    return Math.floor(clamped / 64) * 64
  }

  private withOutputInfo(
    outputInfo: OutputInfo,
    overrides: Partial<PlaybackInfo> = {}
  ): PlaybackInfo {
    return {
      ...this.playbackInfo,
      ...overrides,
      outputBackend: overrides.outputBackend ?? outputInfo.backend,
      outputDevice: overrides.outputDevice ?? outputInfo.deviceName,
      actualBackend: overrides.actualBackend ?? outputInfo.actualBackend,
      actualOutputFormat: outputInfo.actualOutputFormat,
      actualSampleRate: outputInfo.actualSampleRate,
      actualBitDepth: outputInfo.actualBitDepth,
      actualChannels: outputInfo.actualChannels,
      bufferSizeFrames: outputInfo.bufferSizeFrames,
      latencyFrames: outputInfo.latencyFrames,
      latencyMs: outputInfo.latencyMs,
      latencyInfo: outputInfo.latencyInfo,
      channelRoutingMode: overrides.channelRoutingMode ?? outputInfo.channelRoutingMode,
      supportsOutputPerfect: outputInfo.supportsOutputPerfect,
      sourceExact: outputInfo.sourceExact,
      diagnostics: outputInfo.diagnostics,
      deviceRecovered: outputInfo.deviceRecovered,
      recoveryCount: outputInfo.recoveryCount,
      outputSampleRate: outputInfo.outputSampleRate,
      outputBitDepth: outputInfo.outputBitDepth,
      outputPerfect: outputInfo.outputPerfect,
      pcmPassthrough: outputInfo.pcmPassthrough,
      perfectReason: outputInfo.perfectReason,
      perfectReasonCode: outputInfo.perfectReasonCode,
      isDsd: outputInfo.isDsd,
      dsdMode: outputInfo.dsdMode,
      dsdRate: outputInfo.dsdRate,
      outputInfo
    }
  }
}

class FakeAudioServiceBinding extends EventEmitter implements AudioEngineServiceNativeBinding {
  stopped = false
  stopCalls = 0
  destroyCalls = 0
  volume = 1
  backend = 'wasapi'
  device = 'auto'
  outputConfig: Partial<OutputConfig> = {}
  dspConfig: Partial<AudioProcessingSettings> = {}
  dspPluginChain = ''
  eqBandsCalls = 0
  replayGainCalls = 0
  crossfeedCalls = 0
  metadataReads = 0
  queue: AudioEngineQueueItem[] = []
  queueIndex = -1
  playCalls = 0
  playAsyncError: Error | null = null
  playbackInfo = makePlaybackInfo({ state: 'playing', nativePlaybackActive: true })

  Play = (): void => {
    this.playCalls += 1
    this.playbackInfo = makePlaybackInfo({ state: 'playing', nativePlaybackActive: true })
  }
  Pause = (): void => {
    this.playbackInfo = { ...this.playbackInfo, state: 'paused' }
  }
  Stop = (): void => {
    this.stopCalls += 1
    this.stopped = true
    this.playbackInfo = { ...this.playbackInfo, state: 'stopped', nativePlaybackActive: false }
  }
  Seek = (): void => {}
  SetVolume = (volume: number): void => {
    this.volume = volume
  }
  SetOutputDevice = (device: string): void => {
    this.device = device
  }
  SetOutputBackend = (backend: string): void => {
    this.backend = backend
  }
  SetOutputConfig = (json: string): void => {
    this.outputConfig = JSON.parse(json) as Partial<OutputConfig>
    const routingMode =
      typeof this.outputConfig.routingMode === 'string'
        ? this.outputConfig.routingMode
        : this.playbackInfo.outputInfo.channelRoutingMode
    this.playbackInfo = {
      ...this.playbackInfo,
      channelRoutingMode: routingMode,
      outputInfo: {
        ...this.playbackInfo.outputInfo,
        channelRoutingMode: routingMode
      }
    }
  }
  LoadQueue = (queueJson: string, startIndex: number): void => {
    this.queue = JSON.parse(queueJson) as AudioEngineQueueItem[]
    this.queueIndex = startIndex
  }
  SetDspConfig = (json: string): void => {
    this.dspConfig = JSON.parse(json) as Partial<AudioProcessingSettings>
  }
  SetEqBands = (): void => {
    this.eqBandsCalls += 1
  }
  SetReplayGainMode = (): void => {
    this.replayGainCalls += 1
  }
  SetCrossfeedStrength = (): void => {
    this.crossfeedCalls += 1
  }
  SetDspPluginChain = (json: string): void => {
    this.dspPluginChain = json
  }
  GetMetadata = (): string => JSON.stringify({ title: 'sync fallback', error: '' })
  GetPlaybackInfo = (): string => JSON.stringify(this.playbackInfo)
  GetDspPluginStatus = (): string => JSON.stringify({ plugins: [] })
  GetLastError = (): string => JSON.stringify({ message: '' })
  async callAsync(method: string, args: unknown[]): Promise<unknown> {
    if (method === 'Play' && this.playAsyncError) {
      throw this.playAsyncError
    }
    const target = this[method as keyof this]
    if (typeof target === 'function') {
      return (target as (...args: unknown[]) => unknown).apply(this, args)
    }
    return undefined
  }
  async getMetadataAsync(source: string): Promise<string> {
    this.metadataReads += 1
    return JSON.stringify({ source, title: `service metadata ${this.metadataReads}`, error: '' })
  }
  destroy(): void {
    this.destroyCalls += 1
    this.stopped = true
  }
}

class DeferredAudioServiceBinding extends FakeAudioServiceBinding {
  deferredMethods = new Set<string>()
  deferredCalls: Array<{
    method: string
    args: unknown[]
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
  }> = []

  constructor(deferredMethods: string[]) {
    super()
    this.deferredMethods = new Set(deferredMethods)
  }

  override async callAsync(method: string, args: unknown[]): Promise<unknown> {
    if (!this.deferredMethods.has(method)) {
      return await super.callAsync(method, args)
    }
    return await new Promise((resolve, reject) => {
      this.deferredCalls.push({ method, args, resolve, reject })
    })
  }

  resolveDeferredCalls(): void {
    while (this.deferredCalls.length > 0) {
      this.resolveNextDeferredCall()
    }
  }

  resolveNextDeferredCall(): void {
    const call = this.deferredCalls.shift()
    if (!call) return
    const target = this[call.method as keyof this]
    if (typeof target === 'function') {
      call.resolve((target as (...args: unknown[]) => unknown).apply(this, call.args))
    } else {
      call.resolve(undefined)
    }
  }

  rejectDeferredCalls(error: Error): void {
    while (this.deferredCalls.length > 0) {
      const call = this.deferredCalls.shift()
      if (!call) return
      call.reject(error)
    }
  }
}

class AsioFailingAudioServiceBinding extends DeferredAudioServiceBinding {
  directRouteCalls: Array<{ method: string; args: unknown[] }> = []
  private applyingDeferredRouteCall = false

  SetOutputDevice = (device: string): void => {
    if (!this.applyingDeferredRouteCall) {
      this.directRouteCalls.push({ method: 'SetOutputDevice', args: [device] })
      return
    }
    this.device = device
  }

  SetOutputBackend = (backend: string): void => {
    if (!this.applyingDeferredRouteCall) {
      this.directRouteCalls.push({ method: 'SetOutputBackend', args: [backend] })
      return
    }
    this.backend = backend
  }

  SetOutputConfig = (json: string): void => {
    if (!this.applyingDeferredRouteCall) {
      this.directRouteCalls.push({ method: 'SetOutputConfig', args: [json] })
      return
    }
    this.outputConfig = JSON.parse(json) as Partial<OutputConfig>
  }

  override async callAsync(method: string, args: unknown[]): Promise<unknown> {
    if (method === 'Play' && this.backend === 'asio') {
      this.playCalls += 1
      throw new Error('asio backend failed')
    }
    return await super.callAsync(method, args)
  }

  override resolveNextDeferredCall(): void {
    this.applyingDeferredRouteCall = true
    try {
      super.resolveNextDeferredCall()
    } finally {
      this.applyingDeferredRouteCall = false
    }
  }
}

class DeferredNextAudioServiceBinding extends FakeAudioServiceBinding {
  nextCalls = 0
  private nextResolvers: Array<() => void> = []

  Next = (): void => {
    this.nextCalls += 1
  }

  override async callAsync(method: string, args: unknown[]): Promise<unknown> {
    if (method !== 'Next') return await super.callAsync(method, args)
    this.nextCalls += 1
    return await new Promise((resolve) => {
      this.nextResolvers.push(() => {
        this.queueIndex = Math.min(this.queueIndex + 1, this.queue.length - 1)
        const item = this.queue[this.queueIndex]
        this.playbackInfo = makePlaybackInfo({
          state: 'playing',
          source: item?.source ?? '',
          queueIndex: this.queueIndex,
          nativePlaybackActive: true
        })
        resolve(undefined)
      })
    })
  }

  resolveNext(): void {
    const resolve = this.nextResolvers.shift()
    if (resolve) resolve()
  }
}

async function resolveDeferredRouteCalls(service: DeferredAudioServiceBinding): Promise<void> {
  for (let index = 0; index < 3; ++index) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    service.resolveNextDeferredCall()
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function makeManager(
  config: ConstructorParameters<typeof AudioEngineManager>[0],
  nativeBinding: FakeNativeBinding,
  scheduler?: AudioEngineManagerDependencies['scheduler']
): InstanceType<typeof AudioEngineManager> {
  return new AudioEngineManager(config, {
    nativeBinding,
    scheduler: {
      ...TEST_SCHEDULER,
      ...scheduler
    },
    deviceOptionsProvider: () => DEVICE_OPTIONS
  })
}

test('normalizing explicit DSD Auto is not overridden by legacy dsdToPcm flag', () => {
  const normalized = normalizeAudioProcessingSettings({
    ...DEFAULT_AUDIO_PROCESSING,
    dsdToPcm: true,
    dsdOutputMode: 'auto'
  })

  assert.equal(normalized.dsdOutputMode, 'auto')
  assert.equal(normalized.dsdToPcm, false)
})

test('legacy dsdToPcm still maps to PCM when dsdOutputMode is absent', () => {
  const normalized = normalizeAudioProcessingSettings({ dsdToPcm: true })

  assert.equal(normalized.dsdOutputMode, 'pcm')
  assert.equal(normalized.dsdToPcm, true)
})

test('audio processing normalization preserves advanced replaygain, fft, and crossfeed settings', () => {
  const normalized = normalizeAudioProcessingSettings({
    fftEnabled: false,
    replayGainFallback: 20,
    replayGainClip: false,
    crossfeedDelayMs: 5,
    crossfeedCutoffHz: 10
  })

  assert.equal(normalized.fftEnabled, false)
  assert.equal(normalized.replayGainFallback, 12)
  assert.equal(normalized.replayGainClip, false)
  assert.equal(normalized.crossfeedDelayMs, 2)
  assert.equal(normalized.crossfeedCutoffHz, 80)
})

test('setExclusiveMode refreshes backend facts immediately', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  await manager.setExclusiveMode(true)
  const info = await manager.getPlaybackInfo()

  assert.equal(info.outputBackend, 'wasapi-exclusive')
  assert.equal(info.actualBackend, 'wasapi-exclusive')
  assert.equal(info.outputInfo.actualBackend, 'wasapi-exclusive')
  assert.equal(info.outputInfo.accessMode, 'exclusive')
  assert.equal(info.outputInfo.devicePathKind, 'default')
  assert.equal(info.outputInfo.exclusive, true)
  assert.equal(info.outputInfo.supportsOutputPerfect, true)
  assert.equal(info.outputInfo.perfectReasonCode, '')
  assertPlaybackMirrorsOutputInfo(info)
})

test('setExclusiveMode skips native calls and playback fanout when mode is unchanged', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))

  const firstState = await manager.setExclusiveMode(true)
  assert.equal(firstState.exclusiveMode, true)
  assert.equal(nativeBinding.outputBackendCalls, 1)
  assert.equal(nativeBinding.outputConfigCalls, 1)
  assert.equal(playbackUpdates.at(-1)?.outputBackend, 'wasapi-exclusive')
  const fullUpdatesAfterChange = playbackUpdates.length

  const secondState = await manager.setExclusiveMode(true)
  assert.equal(secondState.exclusiveMode, true)
  assert.equal(nativeBinding.outputBackendCalls, 1)
  assert.equal(nativeBinding.outputConfigCalls, 1)
  assert.equal(playbackUpdates.length, fullUpdatesAfterChange)
})

test('setOutputConfig forwards and keeps advanced upmix parameters', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  await manager.setOutputConfig({
    preferredBufferSize: 512,
    routingMode: 'stereo-to-7.1',
    upmixCenterGain: 1.1,
    upmixLfeGain: 0.25,
    upmixLfeLowpassHz: 180,
    upmixSurroundGain: 0.75,
    upmixSideGain: 0.4,
    upmixSurroundDelayMs: 12
  })

  assert.equal(nativeBinding.lastOutputConfig.preferredBufferSize, 512)
  assert.equal(nativeBinding.lastOutputConfig.routingMode, 'stereo-to-7.1')
  assert.equal(nativeBinding.lastOutputConfig.upmixCenterGain, 1.1)
  assert.equal(nativeBinding.lastOutputConfig.upmixLfeGain, 0.25)
  assert.equal(nativeBinding.lastOutputConfig.upmixLfeLowpassHz, 180)
  assert.equal(nativeBinding.lastOutputConfig.upmixSurroundGain, 0.75)
  assert.equal(nativeBinding.lastOutputConfig.upmixSideGain, 0.4)
  assert.equal(nativeBinding.lastOutputConfig.upmixSurroundDelayMs, 12)
})

test('setOutputConfig skips native call and playback fanout when normalized config is unchanged', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))

  await manager.setOutputConfig({ preferredBufferSize: 512, routingMode: 'stereo-to-7.1' })
  assert.equal(nativeBinding.outputConfigCalls, 1)
  assert.equal(playbackUpdates.at(-1)?.outputInfo.channelRoutingMode, 'stereo-to-7.1')
  const fullUpdatesAfterChange = playbackUpdates.length

  await manager.setOutputConfig({ preferredBufferSize: 512, routingMode: 'stereo-to-7.1' })
  assert.equal(nativeBinding.outputConfigCalls, 1)
  assert.equal(playbackUpdates.length, fullUpdatesAfterChange)
})

test('coreaudio exclusive mode maps to coreaudio-exclusive backend', async () => {
  const originalPlatform = process.platform
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  try {
    const nativeBinding = new FakeNativeBinding()
    const manager = makeManager(
      {
        exclusiveMode: false,
        audioOutput: 'coreaudio',
        audioDevice: 'auto'
      },
      nativeBinding
    )

    await manager.setExclusiveMode(true)
    const info = await manager.getPlaybackInfo()

    assert.equal(info.outputBackend, 'coreaudio-exclusive')
    assert.equal(info.actualBackend, 'coreaudio-exclusive')
    assert.equal(info.outputInfo.actualBackend, 'coreaudio-exclusive')
    assert.equal(info.outputInfo.accessMode, 'exclusive')
    assert.equal(info.outputInfo.devicePathKind, 'hal')
    assert.equal(info.outputInfo.exclusive, true)
    assert.equal(info.outputInfo.supportsOutputPerfect, true)
    assert.equal(info.outputInfo.perfectReasonCode, '')
    assertPlaybackMirrorsOutputInfo(info)
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  }
})

test('coreaudio shared mode stays coreaudio with shared_mixer reason', async () => {
  const originalPlatform = process.platform
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  try {
    const nativeBinding = new FakeNativeBinding()
    const manager = makeManager(
      {
        exclusiveMode: false,
        audioOutput: 'coreaudio',
        audioDevice: 'auto'
      },
      nativeBinding
    )

    const info = await manager.getPlaybackInfo()

    assert.equal(info.outputBackend, 'coreaudio')
    assert.equal(info.actualBackend, 'coreaudio')
    assert.equal(info.outputInfo.accessMode, 'shared')
    assert.equal(info.outputInfo.exclusive, false)
    assert.equal(info.outputInfo.supportsOutputPerfect, false)
    assert.equal(info.outputInfo.perfectReasonCode, 'shared_mixer')
    assertPlaybackMirrorsOutputInfo(info)
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  }
})

test('setAudioDevice refreshes canonical device names immediately', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  await manager.setAudioDevice('dac-1')
  const info = await manager.getPlaybackInfo()

  assert.equal(info.outputDevice, 'dac-1')
  assert.equal(info.outputInfo.deviceName, 'dac-1')
  assert.equal(info.outputInfo.actualDeviceName, 'Desk DAC')
  assert.equal(info.outputInfo.devicePathKind, 'default')
  assertPlaybackMirrorsOutputInfo(info)
})

test('setAudioDevice skips native call and playback fanout when normalized device is unchanged', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))

  const firstState = await manager.setAudioDevice('dac-1')
  assert.equal(firstState.device, 'dac-1')
  assert.equal(nativeBinding.outputDeviceCalls, 1)
  assert.equal(playbackUpdates.at(-1)?.outputDevice, 'dac-1')
  const fullUpdatesAfterChange = playbackUpdates.length

  const secondState = await manager.setAudioDevice('dac-1')
  assert.equal(secondState.device, 'dac-1')
  assert.equal(nativeBinding.outputDeviceCalls, 1)
  assert.equal(playbackUpdates.length, fullUpdatesAfterChange)
})

test('default output device display labels normalize to auto', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: '系统默认'
    },
    nativeBinding
  )

  assert.equal((await manager.getAudioOutputState()).device, 'auto')

  await manager.setAudioDevice('System Default')
  const state = await manager.getAudioOutputState()
  const info = await manager.getPlaybackInfo()

  assert.equal(state.device, 'auto')
  assert.equal(info.outputDevice, 'auto')
  assert.equal(info.outputInfo.deviceName, 'auto')
})

test('setOutputConfig uses the actual native buffer size and latency facts', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  await manager.setExclusiveMode(true)
  await manager.setOutputConfig({ preferredBufferSize: 512 })
  const info = await manager.getPlaybackInfo()

  assert.equal(info.outputInfo.actualBackend, 'wasapi-exclusive')
  assert.equal(info.outputInfo.bufferSizeFrames, 448)
  assert.equal(info.bufferSizeFrames, 448)
  assert.equal(info.outputInfo.latencyFrames, 448)
  assert.equal(info.latencyFrames, 448)
  assert.equal(info.outputInfo.latencyInfo.bufferLatencyMs > 0, true)
  assert.equal(
    info.outputInfo.latencyInfo.totalLatencyMs >= info.outputInfo.latencyInfo.bufferLatencyMs,
    true
  )
  assert.equal(info.outputInfo.latencyMs, info.outputInfo.latencyInfo.totalLatencyMs)
  assert.equal(info.latencyInfo.totalLatencyMs, info.outputInfo.latencyInfo.totalLatencyMs)
  assertPlaybackMirrorsOutputInfo(info)
})

test('ASIO output config uses the native applied buffer and capability facts', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  await manager.setAudioOutput('asio', 'asio:studio')
  await manager.setOutputConfig({ preferredBufferSize: 1000 })
  const info = await manager.getPlaybackInfo()
  const state = await manager.getAudioOutputState()
  const asioDevice = state.deviceOptions.find((device) => device.id === 'asio:studio')

  assert.equal(info.outputInfo.backend, 'asio')
  assert.equal(info.outputInfo.actualBackend, 'asio')
  assert.equal(info.outputInfo.accessMode, 'exclusive')
  assert.equal(info.outputInfo.devicePathKind, 'asio')
  assert.equal(info.outputInfo.deviceName, 'asio:studio')
  assert.equal(info.outputInfo.actualDeviceName, 'Studio ASIO')
  assert.equal(info.outputInfo.supportsOutputPerfect, true)
  assert.equal(info.outputInfo.bufferSizeFrames, 960)
  assert.equal(info.outputInfo.latencyFrames, 960)
  assert.equal(info.outputInfo.latencyInfo.bufferLatencyMs, 20)
  assert.equal(info.outputInfo.latencyInfo.outputLatencyMs, 2)
  assert.equal(info.outputInfo.latencyInfo.totalLatencyMs, 22)
  assert.equal(info.outputInfo.latencyMs, 22)
  assert.equal(info.outputInfo.perfectReasonCode, '')
  assert.equal(asioDevice?.minBufferSize, 64)
  assert.equal(asioDevice?.maxBufferSize, 2048)
  assert.equal(asioDevice?.granularity, 64)
  assert.equal(asioDevice?.preferredBufferSize, 256)
  assert.equal(asioDevice?.supportsDop, true)
  assert.equal(asioDevice?.dopSupportState, 'verified')
  assert.equal(asioDevice?.supportsNativeDsd, true)
  assert.equal(asioDevice?.nativeDsdSupportState, 'verified')
  assert.deepEqual(asioDevice?.supportedDsdRates, [64])
  assert.deepEqual(asioDevice?.nativeDsdSampleRates, [2822400, 5644800, 11289600])
  assert.deepEqual(asioDevice?.nativeDsdSampleFormats, ['dsd-int8-msb1'])
  assert.deepEqual(asioDevice?.dopCarrierSampleRates, [176400])
  assert.deepEqual(asioDevice?.dopCarrierFormats, ['int24-in32'])
  assert.equal(asioDevice?.capabilityVersion, 3)
  assertPlaybackMirrorsOutputInfo(info)
})

test('audio device options expose runtime-probed DSD support states without forcing boolean support', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'dac-1'
    },
    nativeBinding
  )

  const state = await manager.getAudioOutputState()
  const defaultDevice = state.deviceOptions.find((device) => device.id === 'auto')
  const dac = state.deviceOptions.find((device) => device.id === 'dac-1')

  assert.equal(defaultDevice?.dopSupportState, 'runtime-probed')
  assert.equal(defaultDevice?.nativeDsdSupportState, 'unsupported')
  assert.equal(dac?.supportsDop, undefined)
  assert.equal(dac?.dopSupportState, 'runtime-probed')
  assert.equal(dac?.nativeDsdSupportState, 'unsupported')
})

test('setAudioOutput skips native calls and playback fanout when output and device are unchanged', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))

  const firstState = await manager.setAudioOutput('asio', 'asio:studio')
  assert.equal(firstState.output, 'asio')
  assert.equal(firstState.device, 'asio:studio')
  assert.equal(nativeBinding.outputBackendCalls, 1)
  assert.equal(nativeBinding.outputDeviceCalls, 1)
  assert.equal(nativeBinding.outputConfigCalls, 1)
  assert.equal(playbackUpdates.at(-1)?.outputBackend, 'asio')
  const fullUpdatesAfterChange = playbackUpdates.length

  const secondState = await manager.setAudioOutput('asio', 'asio:studio')
  assert.equal(secondState.output, 'asio')
  assert.equal(secondState.device, 'asio:studio')
  assert.equal(nativeBinding.outputBackendCalls, 1)
  assert.equal(nativeBinding.outputDeviceCalls, 1)
  assert.equal(nativeBinding.outputConfigCalls, 1)
  assert.equal(playbackUpdates.length, fullUpdatesAfterChange)
})

test('audio service output switches wait for route RPCs before marking synced', async () => {
  const service = new DeferredAudioServiceBinding([
    'SetOutputBackend',
    'SetOutputDevice',
    'SetOutputConfig'
  ])
  const manager = new AudioEngineManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioOutputConfig: { preferredBufferSize: 512 }
    },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const internals = manager as unknown as {
    nativeOutputRouteSynced: boolean
  }

  const startup = manager.start()
  await resolveDeferredRouteCalls(service)
  await startup

  const switchPromise = manager.setAudioOutput('asio', 'asio:studio')
  let resolved = false
  switchPromise.then(() => {
    resolved = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(resolved, false)
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputBackend']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(resolved, false)
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputDevice']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(resolved, false)
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputConfig']
  )

  service.resolveNextDeferredCall()
  const state = await switchPromise

  assert.equal(resolved, true)
  assert.equal(internals.nativeOutputRouteSynced, true)
  assert.equal(state.output, 'asio')
  assert.equal(state.device, 'asio:studio')
  assert.equal(service.backend, 'asio')
  assert.equal(service.device, 'asio:studio')
  assert.equal(service.outputConfig.preferredBufferSize, 512)

  manager.destroy()
})

test('audio service startup waits for route RPCs before emitting ready', async () => {
  const service = new DeferredAudioServiceBinding([
    'SetOutputBackend',
    'SetOutputDevice',
    'SetOutputConfig'
  ])
  const manager = new AudioEngineManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'dac-1',
      audioOutputConfig: { preferredBufferSize: 512 }
    },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const internals = manager as unknown as {
    nativeOutputRouteSynced: boolean
  }
  let ready = false
  manager.on('ready', () => {
    ready = true
  })

  const startPromise = manager.start()
  let resolved = false
  startPromise.then(() => {
    resolved = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(resolved, false)
  assert.equal(ready, false)
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputBackend']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(resolved, false)
  assert.equal(ready, false)
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputDevice']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(resolved, false)
  assert.equal(ready, false)
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputConfig']
  )

  service.resolveNextDeferredCall()
  await startPromise

  assert.equal(resolved, true)
  assert.equal(ready, true)
  assert.equal(internals.nativeOutputRouteSynced, true)
  assert.equal(service.backend, 'wasapi-exclusive')
  assert.equal(service.device, 'dac-1')
  assert.equal(service.outputConfig.preferredBufferSize, 512)

  manager.destroy()
})

test('audio service device switches wait for device RPC before marking synced', async () => {
  const service = new DeferredAudioServiceBinding(['SetOutputDevice'])
  const manager = new AudioEngineManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const internals = manager as unknown as {
    nativeOutputRouteSynced: boolean
  }

  const startup = manager.start()
  await resolveDeferredRouteCalls(service)
  await startup
  const switchPromise = manager.setAudioDevice('dac-1')
  let resolved = false
  switchPromise.then(() => {
    resolved = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(resolved, false)
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputDevice']
  )

  service.resolveNextDeferredCall()
  const state = await switchPromise

  assert.equal(resolved, true)
  assert.equal(internals.nativeOutputRouteSynced, true)
  assert.equal(state.device, 'dac-1')
  assert.equal(service.device, 'dac-1')

  manager.destroy()
})

test('audio service exclusive mode switches wait for backend and config RPCs before marking synced', async () => {
  const service = new DeferredAudioServiceBinding(['SetOutputBackend', 'SetOutputConfig'])
  const manager = new AudioEngineManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioOutputConfig: { preferredBufferSize: 256 }
    },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const internals = manager as unknown as {
    nativeOutputRouteSynced: boolean
  }

  const startup = manager.start()
  await resolveDeferredRouteCalls(service)
  await startup

  const switchPromise = manager.setExclusiveMode(true)
  let resolved = false
  switchPromise.then(() => {
    resolved = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(resolved, false)
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputBackend']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(resolved, false)
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputConfig']
  )

  service.resolveNextDeferredCall()
  const state = await switchPromise

  assert.equal(resolved, true)
  assert.equal(internals.nativeOutputRouteSynced, true)
  assert.equal(state.exclusiveMode, true)
  assert.equal(service.backend, 'wasapi-exclusive')
  assert.equal(service.outputConfig.preferredBufferSize, 256)

  manager.destroy()
})

test('audio service output config changes wait for config RPC before marking synced', async () => {
  const service = new DeferredAudioServiceBinding(['SetOutputConfig'])
  const manager = new AudioEngineManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioOutputConfig: { preferredBufferSize: 256, routingMode: 'auto' }
    },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const internals = manager as unknown as {
    nativeOutputRouteSynced: boolean
  }

  const startup = manager.start()
  await resolveDeferredRouteCalls(service)
  await startup

  const configPromise = manager.setOutputConfig({
    preferredBufferSize: 512,
    routingMode: 'stereo-to-5.1'
  })
  let resolved = false
  configPromise.then(() => {
    resolved = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(resolved, false)
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputConfig']
  )

  service.resolveNextDeferredCall()
  await configPromise

  const info = await manager.getPlaybackInfo()
  assert.equal(resolved, true)
  assert.equal(internals.nativeOutputRouteSynced, true)
  assert.equal(service.outputConfig.preferredBufferSize, 512)
  assert.equal(service.outputConfig.routingMode, 'stereo-to-5.1')
  assert.equal(info.channelRoutingMode, 'stereo-to-5.1')

  manager.destroy()
})

test('backend and device switches do not leave stale output facts', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  await manager.setExclusiveMode(true)
  await manager.setOutputConfig({ preferredBufferSize: 512 })
  const exclusiveInfo = await manager.getPlaybackInfo()
  assert.equal(exclusiveInfo.outputInfo.actualBackend, 'wasapi-exclusive')
  assert.equal(exclusiveInfo.outputInfo.accessMode, 'exclusive')
  assert.equal(exclusiveInfo.outputInfo.devicePathKind, 'default')
  assert.equal(exclusiveInfo.outputInfo.actualDeviceName, 'System Default')
  assert.equal(exclusiveInfo.outputInfo.bufferSizeFrames, 448)

  await manager.setAudioOutput('asio', 'asio:studio')
  await manager.setOutputConfig({ preferredBufferSize: 1000 })
  const asioInfo = await manager.getPlaybackInfo()
  assert.equal(asioInfo.outputInfo.actualBackend, 'asio')
  assert.equal(asioInfo.outputInfo.accessMode, 'exclusive')
  assert.equal(asioInfo.outputInfo.devicePathKind, 'asio')
  assert.equal(asioInfo.outputInfo.deviceName, 'asio:studio')
  assert.equal(asioInfo.outputInfo.actualDeviceName, 'Studio ASIO')
  assert.equal(asioInfo.outputInfo.bufferSizeFrames, 960)
  assert.equal(asioInfo.outputInfo.perfectReasonCode, '')
  assertPlaybackMirrorsOutputInfo(asioInfo)

  await manager.setAudioOutput('wasapi', 'auto')
  await manager.setExclusiveMode(false)
  await manager.setOutputConfig({ preferredBufferSize: 0 })
  const sharedInfo = await manager.getPlaybackInfo()
  assert.equal(sharedInfo.outputInfo.backend, 'wasapi')
  assert.equal(sharedInfo.outputInfo.actualBackend, 'wasapi')
  assert.equal(sharedInfo.outputInfo.accessMode, 'shared')
  assert.equal(sharedInfo.outputInfo.devicePathKind, 'default')
  assert.equal(sharedInfo.outputInfo.deviceName, 'auto')
  assert.equal(sharedInfo.outputInfo.actualDeviceName, 'System Default')
  assert.equal(sharedInfo.outputInfo.bufferSizeFrames, 480)
  assert.equal(sharedInfo.outputInfo.latencyInfo.bufferLatencyMs, 10)
  assert.equal(sharedInfo.outputInfo.latencyInfo.outputLatencyMs, 1)
  assert.equal(sharedInfo.outputInfo.latencyInfo.totalLatencyMs, 11)
  assert.equal(sharedInfo.outputInfo.perfectReasonCode, 'shared_mixer')
  assert.equal(sharedInfo.outputInfo.supportsOutputPerfect, false)
  assertPlaybackMirrorsOutputInfo(sharedInfo)
})

test('switching to ASIO does not keep a WASAPI endpoint device id', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: '{0.0.0.00000000}.{f968bbfb-342c-4419-adef-8082728d6c2d}'
    },
    nativeBinding
  )

  await manager.setAudioOutput('asio')
  const state = await manager.getAudioOutputState()
  const info = await manager.getPlaybackInfo()

  assert.equal(state.output, 'asio')
  assert.equal(state.device, 'auto')
  assert.equal(info.outputInfo.actualBackend, 'asio')
  assert.equal(info.outputInfo.devicePathKind, 'asio')
  assert.notEqual(
    info.outputInfo.deviceName,
    '{0.0.0.00000000}.{f968bbfb-342c-4419-adef-8082728d6c2d}'
  )
  assertPlaybackMirrorsOutputInfo(info)
})

test('ASIO play failure falls back to native WASAPI instead of throwing to HTMLAudio', async () => {
  const nativeBinding = new FakeNativeBinding()
  nativeBinding.failAsioPlayWith =
    '无法找到请求的 ASIO 设备：{0.0.0.00000000}.{f968bbfb-342c-4419-adef-8082728d6c2d}'
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'asio',
      audioDevice: 'asio:studio'
    },
    nativeBinding
  )

  await manager.setAudioOutput('asio', 'asio:studio')
  const result = await manager.play('album.dsf', 0)
  const state = await manager.getAudioOutputState()
  const info = await manager.getPlaybackInfo()

  assert.equal(result.nativeStarted, true)
  assert.match(result.fallbackReason, /无法找到请求的 ASIO 设备/)
  assert.deepEqual(
    nativeBinding.playCalls.map((call) => call.backend),
    ['asio', 'wasapi']
  )
  assert.equal(state.output, 'wasapi')
  assert.equal(state.device, 'auto')
  assert.equal(info.state, 'playing')
  assert.equal(info.outputInfo.actualBackend, 'wasapi')
  assert.equal(info.outputInfo.accessMode, 'shared')
  assert.equal(info.outputInfo.deviceName, 'auto')
  assert.equal(info.source, 'album.dsf')
  assert.equal(info.isDsd, true)
  assertPlaybackMirrorsOutputInfo(info)
})

test('audio service ASIO play fallback waits for WASAPI route RPCs before retrying playback', async () => {
  const service = new AsioFailingAudioServiceBinding([
    'SetOutputBackend',
    'SetOutputDevice',
    'SetOutputConfig'
  ])
  const manager = new AudioEngineManager(
    {
      exclusiveMode: false,
      audioOutput: 'asio',
      audioDevice: 'asio:studio',
      audioOutputConfig: { preferredBufferSize: 512 }
    },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const internals = manager as unknown as {
    nativeOutputRouteSynced: boolean
  }

  const startup = manager.start()
  await resolveDeferredRouteCalls(service)
  await startup
  assert.equal(service.backend, 'asio')
  assert.equal(service.device, 'asio:studio')

  const playPromise = manager.play('album.dsf', 0)
  let resolved = false
  let rejected: unknown = null
  playPromise.then(
    () => {
      resolved = true
    },
    (error) => {
      rejected = error
    }
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(resolved, false)
  assert.equal(rejected, null)
  assert.equal(service.playCalls, 1)
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(service.directRouteCalls, [])
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputBackend']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(resolved, false)
  assert.equal(rejected, null)
  assert.equal(service.playCalls, 1)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputDevice']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(resolved, false)
  assert.equal(rejected, null)
  assert.equal(service.playCalls, 1)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputConfig']
  )

  service.resolveNextDeferredCall()
  const result = await playPromise
  const state = await manager.getAudioOutputState()

  assert.equal(resolved, true)
  assert.equal(rejected, null)
  assert.equal(result.nativeStarted, true)
  assert.match(result.fallbackReason, /asio backend failed/)
  assert.equal(service.playCalls, 2)
  assert.equal(service.backend, 'wasapi')
  assert.equal(service.device, 'auto')
  assert.equal(service.outputConfig.preferredBufferSize, 512)
  assert.equal(internals.nativeOutputRouteSynced, true)
  assert.equal(state.output, 'wasapi')
  assert.equal(state.device, 'auto')

  manager.destroy()
})

test('next falls back to Play when native Next advances but does not keep playback active', async () => {
  const nativeBinding = new FakeNativeBinding()
  nativeBinding.nextLeavesStopped = true
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const queue = [
    { id: '1', source: 'first.flac', title: 'First' },
    { id: '2', source: 'second.flac', title: 'Second' }
  ]

  await manager.loadQueue(queue, 0)
  await manager.play(queue[0].source, 0)
  await manager.next()
  const info = await manager.getPlaybackInfo()

  assert.equal(nativeBinding.nextCalls, 1)
  assert.deepEqual(
    nativeBinding.playCalls.map((call) => call.source),
    ['first.flac', 'second.flac']
  )
  assert.equal(info.state, 'playing')
  assert.equal(info.queueIndex, 1)
  assert.equal(info.source, 'second.flac')
})

test('next falls back to target track when native Next reports stale playback info', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const queue = [
    { id: '1', source: 'first.flac', title: 'First' },
    { id: '2', source: 'second.flac', title: 'Second' }
  ]

  await manager.loadQueue(queue, 0)
  await manager.play(queue[0].source, 0)
  await manager.next()
  const info = await manager.getPlaybackInfo()

  assert.equal(nativeBinding.nextCalls, 1)
  assert.deepEqual(
    nativeBinding.playCalls.map((call) => call.source),
    ['first.flac', 'second.flac']
  )
  assert.equal(info.queueIndex, 1)
  assert.equal(info.source, 'second.flac')
})

test('audio service next waits for Next ack before falling back to Play', async () => {
  const service = new DeferredNextAudioServiceBinding()
  const manager = new AudioEngineManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const queue = [
    { id: '1', source: 'first.flac', title: 'First' },
    { id: '2', source: 'second.flac', title: 'Second' }
  ]

  await manager.loadQueue(queue, 0)
  await manager.play(queue[0].source, 0)
  const nextPromise = manager.next()
  let resolved = false
  nextPromise.then(() => {
    resolved = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(resolved, false)
  assert.equal(service.nextCalls, 1)
  assert.equal(service.playCalls, 1)

  service.resolveNext()
  await nextPromise
  const info = await manager.getPlaybackInfo()

  assert.equal(service.playCalls, 1)
  assert.equal(resolved, true)
  assert.equal(info.state, 'playing')
  assert.equal(info.queueIndex, 1)
  assert.equal(info.source, 'second.flac')

  manager.destroy()
})

test('loadQueue skips native call and queue fanout when normalized queue is unchanged', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const queue: AudioEngineQueueItem[] = [
    { id: 'local:one', source: 'one.flac', title: 'One' },
    { id: 'local:two', source: 'two.flac', title: 'Two' }
  ]
  const queueChanges: AudioEngineQueueItem[][] = []
  manager.on('queue-change', (items: AudioEngineQueueItem[]) => queueChanges.push(items))

  await manager.loadQueue(queue, 1)
  assert.equal(nativeBinding.loadQueueCalls, 1)
  assert.equal(nativeBinding.playModeCalls, 1)
  assert.deepEqual(nativeBinding.lastLoadedQueue, queue)
  assert.equal(nativeBinding.lastLoadedQueueIndex, 1)
  assert.equal(queueChanges.length, 1)

  await manager.loadQueue(
    queue.map((item) => ({ ...item })),
    99
  )
  assert.equal(nativeBinding.loadQueueCalls, 1)
  assert.equal(nativeBinding.playModeCalls, 1)
  assert.deepEqual(nativeBinding.lastLoadedQueue, queue)
  assert.equal(nativeBinding.lastLoadedQueueIndex, 1)
  assert.equal(queueChanges.length, 1)
})

test('loadQueue reapplies play mode to clear stale native repeat mode', async () => {
  const nativeBinding = new FakeNativeBinding({ playMode: 'repeat' })
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const queue: AudioEngineQueueItem[] = [{ id: 'local:one', source: 'one.flac', title: 'One' }]

  await manager.loadQueue(queue, 0)

  assert.equal(nativeBinding.loadQueueCalls, 1)
  assert.equal(nativeBinding.playModeCalls, 1)
  assert.equal(nativeBinding.playbackInfo.playMode, 'sequential')
})

test('getPlaybackInfo reuses fresh native playback info from the manager tick', async () => {
  const nativeBinding = new FakeNativeBinding()
  let now = 1000
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding,
    {
      now: () => now
    }
  )

  await manager.play('track.flac', 0)
  assert.equal(nativeBinding.playbackInfoReads, 1)

  nativeBinding.playbackInfo = {
    ...nativeBinding.playbackInfo,
    position: 0.25
  }
  const tickManager = manager as unknown as { tick: () => void }
  tickManager.tick()
  assert.equal(nativeBinding.playbackInfoReads, 2)

  const cachedInfo = await manager.getPlaybackInfo()
  assert.equal(nativeBinding.playbackInfoReads, 2)
  assert.equal(cachedInfo.position, 0.25)

  now += 250
  nativeBinding.playbackInfo = {
    ...nativeBinding.playbackInfo,
    position: 0.5
  }
  const refreshedInfo = await manager.getPlaybackInfo()
  assert.equal(nativeBinding.playbackInfoReads, 3)
  assert.equal(refreshedInfo.position, 0.5)

  const repeatedInfo = await manager.getPlaybackInfo()
  assert.equal(nativeBinding.playbackInfoReads, 3)
  assert.equal(repeatedInfo.position, 0.5)
})

test('native tick skips full playback-info fanout when only position changes', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  const timePositions: number[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))
  manager.on('property-change', ({ name, data }) => {
    if (name === 'time-pos') timePositions.push(data as number)
  })

  await manager.play('track.flac', 0)
  const fullUpdatesAfterPlay = playbackUpdates.length

  nativeBinding.playbackInfo = {
    ...nativeBinding.playbackInfo,
    position: 0.25
  }
  const tickManager = manager as unknown as { tick: () => void }
  tickManager.tick()

  assert.equal(timePositions.at(-1), 0.25)
  assert.equal(playbackUpdates.length, fullUpdatesAfterPlay)
})

test('native tick publishes playback-info when non-position playback facts change', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))
  const queue = [
    { id: '1', source: 'first.flac', title: 'First' },
    { id: '2', source: 'second.flac', title: 'Second' }
  ]

  await manager.loadQueue(queue, 0)
  await manager.play(queue[0].source, 0)
  playbackUpdates.length = 0

  nativeBinding.playbackInfo = {
    ...nativeBinding.playbackInfo,
    position: 0.25,
    source: queue[1].source,
    queueIndex: 1
  }
  const tickManager = manager as unknown as { tick: () => void }
  tickManager.tick()

  assert.equal(playbackUpdates.length, 1)
  assert.equal(playbackUpdates[0].source, queue[1].source)
  assert.equal(playbackUpdates[0].queueIndex, 1)
})

test('native tick skips repeated duration property changes until duration changes', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const durations: number[] = []
  manager.on('property-change', ({ name, data }) => {
    if (name === 'duration') durations.push(data as number)
  })
  const queue = [{ id: '1', source: 'track.flac', title: 'Track', duration: 120 }]

  await manager.loadQueue(queue, 0)
  await manager.play(queue[0].source, 0)
  assert.deepEqual(durations, [120])

  nativeBinding.playbackInfo = {
    ...nativeBinding.playbackInfo,
    position: 0.25,
    duration: 120
  }
  const tickManager = manager as unknown as { tick: () => void }
  tickManager.tick()
  assert.deepEqual(durations, [120])

  nativeBinding.playbackInfo = {
    ...nativeBinding.playbackInfo,
    position: 0.5,
    duration: 121
  }
  tickManager.tick()
  assert.deepEqual(durations, [120, 121])
})

test('setVolume skips native call and playback fanout when normalized volume is unchanged', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))

  await manager.setVolume(0.5)
  assert.equal(nativeBinding.volumeCalls, 1)
  assert.equal(playbackUpdates.at(-1)?.volume, 0.5)
  const fullUpdatesAfterChange = playbackUpdates.length

  await manager.setVolume(0.5)
  assert.equal(nativeBinding.volumeCalls, 1)
  assert.equal(playbackUpdates.length, fullUpdatesAfterChange)
})

test('seek skips native call and fanout when paused position is unchanged', async () => {
  const nativeBinding = new FakeNativeBinding({ state: 'paused', position: 32 })
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  const timePositions: number[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))
  manager.on('property-change', (event: { name: string; data: unknown }) => {
    if (event.name === 'time-pos') timePositions.push(event.data as number)
  })

  await manager.seek(48)
  assert.equal(nativeBinding.seekCalls, 1)
  assert.deepEqual(timePositions, [48])
  assert.equal(playbackUpdates.at(-1)?.position, 48)
  const fullUpdatesAfterSeek = playbackUpdates.length

  await manager.seek(48)
  assert.equal(nativeBinding.seekCalls, 1)
  assert.deepEqual(timePositions, [48])
  assert.equal(playbackUpdates.length, fullUpdatesAfterSeek)
})

test('stop skips native call and playback fanout when already idle', async () => {
  const nativeBinding = new FakeNativeBinding({ state: 'stopped', position: 0 })
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  const propertyChanges: Array<{ name: string; data: unknown }> = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))
  manager.on('property-change', (event: { name: string; data: unknown }) =>
    propertyChanges.push(event)
  )

  await manager.stop()

  assert.equal(nativeBinding.stopCalls, 0)
  assert.equal(playbackUpdates.length, 0)
  assert.equal(propertyChanges.length, 0)
})

test('setPlayMode skips native call and playback fanout when mode is unchanged', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))

  await manager.setPlayMode('repeat')
  assert.equal(nativeBinding.playModeCalls, 1)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.at(-1)?.playMode, 'repeat')
  const fullUpdatesAfterChange = playbackUpdates.length

  await manager.setPlayMode('repeat')
  assert.equal(nativeBinding.playModeCalls, 1)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, fullUpdatesAfterChange)
})

test('getUpcomingTrack reuses native result briefly and invalidates on play mode change', async () => {
  const nativeBinding = new FakeNativeBinding()
  let now = 1000
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding,
    {
      now: () => now
    }
  )

  const first = manager.getUpcomingTrack()
  const second = manager.getUpcomingTrack()

  assert.equal(nativeBinding.upcomingTrackReads, 1)
  assert.deepEqual(second, first)

  now += 250
  const refreshed = manager.getUpcomingTrack()
  assert.equal(nativeBinding.upcomingTrackReads, 2)
  assert.notDeepEqual(refreshed, first)

  const cached = manager.getUpcomingTrack()
  assert.equal(nativeBinding.upcomingTrackReads, 2)
  assert.deepEqual(cached, refreshed)

  await manager.setPlayMode('repeat')
  const afterModeChange = manager.getUpcomingTrack()

  assert.equal(nativeBinding.upcomingTrackReads, 3)
  assert.notDeepEqual(afterModeChange, refreshed)
})

test('getMetadata reuses native metadata for the same source within the cache window', () => {
  const nativeBinding = new FakeNativeBinding()
  let now = 1000
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding,
    {
      now: () => now
    }
  )

  const first = manager.getMetadata('file:///album/track.flac')
  const second = manager.getMetadata('file:///album/track.flac')

  assert.equal(nativeBinding.metadataReads, 1)
  assert.deepEqual(second, first)

  const other = manager.getMetadata('file:///album/other.flac')
  assert.equal(nativeBinding.metadataReads, 2)
  assert.notDeepEqual(other, first)

  now += 1250
  const refreshed = manager.getMetadata('file:///album/track.flac')
  assert.equal(nativeBinding.metadataReads, 3)
  assert.notDeepEqual(refreshed, first)
})

test('getMetadata bounds expired and unique metadata cache entries', () => {
  const nativeBinding = new FakeNativeBinding()
  let now = 1000
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding,
    {
      now: () => now
    }
  )
  const internals = manager as unknown as {
    metadataCache: Map<string, unknown>
  }

  for (let index = 0; index < 260; ++index) {
    manager.getMetadata(`file:///album/side-a-${index}.flac`)
  }

  now += 1250

  for (let index = 0; index < 260; ++index) {
    manager.getMetadata(`file:///album/side-b-${index}.flac`)
  }

  assert.ok(
    internals.metadataCache.size <= 256,
    `metadata cache retained ${internals.metadataCache.size} entries`
  )
  assert.equal(internals.metadataCache.has('file:///album/side-a-0.flac'), false)
})

test('getMetadataAsync reuses service metadata for the same source within the cache window', async () => {
  const service = new FakeAudioServiceBinding()
  let now = 1000
  const manager = new AudioEngineManager(
    { exclusiveMode: false },
    {
      audioServiceFactory: () => service,
      scheduler: {
        ...TEST_SCHEDULER,
        now: () => now
      },
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )

  const first = await manager.getMetadataAsync('service-track.flac')
  const second = await manager.getMetadataAsync('service-track.flac')

  assert.equal(service.metadataReads, 1)
  assert.deepEqual(second, first)

  const other = await manager.getMetadataAsync('other-service-track.flac')
  assert.equal(service.metadataReads, 2)
  assert.notDeepEqual(other, first)

  now += 1250
  const refreshed = await manager.getMetadataAsync('service-track.flac')
  assert.equal(service.metadataReads, 3)
  assert.notDeepEqual(refreshed, first)

  manager.destroy()
})

test('setOutputConfig keeps routing and non-perfect reasons in sync', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  await manager.setOutputConfig({ routingMode: 'stereo-to-7.1' })
  const info = await manager.getPlaybackInfo()

  assert.equal(info.outputInfo.channelRoutingMode, 'stereo-to-7.1')
  assert.equal(info.channelRoutingMode, 'stereo-to-7.1')
  assert.equal(info.outputInfo.perfectReasonCode, 'routing_changes_semantics')
  assert.equal(info.perfectReasonCode, 'routing_changes_semantics')
  assertPlaybackMirrorsOutputInfo(info)
})

test('ASIO diagnostics and recovery facts propagate through manager refresh', async () => {
  const nativeBinding = new FakeNativeBinding({
    outputInfo: {
      ...makeOutputInfo({
        backend: 'asio',
        actualBackend: 'asio',
        accessMode: 'exclusive',
        devicePathKind: 'asio',
        deviceName: 'asio:studio',
        actualDeviceName: 'Studio ASIO',
        supportsOutputPerfect: true,
        perfectReason: '',
        perfectReasonCode: '',
        capabilityReason: ''
      })
    }
  })
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'asio',
      audioDevice: 'asio:studio'
    },
    nativeBinding
  )

  await manager.setAudioOutput('asio', 'asio:studio')
  await manager.play('track.flac', 0)
  nativeBinding.setDiagnostics(
    {
      sessionUnderrunCount: 1,
      sessionBufferDropCount: 1,
      sessionRecoveryCount: 2,
      driverRestartCount: 1,
      deviceLostCount: 1,
      lastError: 'ASIO driver restart after buffer failure'
    },
    {
      deviceRecovered: true,
      recoveryCount: 2,
      perfectReasonCode: 'driver_restart',
      perfectReason: 'ASIO driver restart after buffer failure',
      capabilityReason: 'ASIO driver restart after buffer failure'
    }
  )

  const info = await manager.getPlaybackInfo()

  assert.equal(info.outputInfo.actualBackend, 'asio')
  assert.equal(info.outputInfo.accessMode, 'exclusive')
  assert.equal(info.outputInfo.devicePathKind, 'asio')
  assert.equal(info.outputInfo.deviceRecovered, true)
  assert.equal(info.deviceRecovered, true)
  assert.equal(info.outputInfo.recoveryCount, 2)
  assert.equal(info.recoveryCount, 2)
  assert.equal(info.outputInfo.diagnostics.sessionUnderrunCount, 1)
  assert.equal(info.outputInfo.diagnostics.sessionBufferDropCount, 1)
  assert.equal(info.outputInfo.diagnostics.sessionRecoveryCount, 2)
  assert.equal(info.outputInfo.diagnostics.driverRestartCount, 1)
  assert.equal(info.outputInfo.diagnostics.deviceLostCount, 1)
  assert.equal(info.outputInfo.diagnostics.lastError, 'ASIO driver restart after buffer failure')
  assert.equal(info.outputInfo.perfectReasonCode, 'driver_restart')
  assert.equal(info.perfectReasonCode, 'driver_restart')
  assertPlaybackMirrorsOutputInfo(info)
})

test('getAudioOutputState can use injected device options without native enumeration', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  const state = await manager.getAudioOutputState()

  assert.equal(state.deviceOptions.length, DEVICE_OPTIONS.length)
  assert.equal(state.deviceOptions[1].label, 'Desk DAC')
  assert.equal(state.deviceOptions[2].pathKind, 'asio')
  assert.equal(state.deviceOptions[2].supportsDop, true)
  assert.equal(state.deviceOptions[2].capabilityVersion, 3)
})

test('getAudioOutputState reuses native device options within the output state cache window', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = new AudioEngineManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    {
      nativeBinding,
      scheduler: TEST_SCHEDULER
    }
  )
  const enumerateCallsAfterConstruction = nativeBinding.enumerateDeviceCalls

  const first = await manager.getAudioOutputState()
  const enumerateCallsAfterFirstRead = nativeBinding.enumerateDeviceCalls
  const second = await manager.getAudioOutputState()

  assert.ok(enumerateCallsAfterFirstRead <= enumerateCallsAfterConstruction + 1)
  assert.equal(nativeBinding.enumerateDeviceCalls, enumerateCallsAfterFirstRead)
  assert.deepEqual(second.deviceOptions, first.deviceOptions)
})

test('native device recovery diagnostics invalidate device options cache', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = new AudioEngineManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    {
      nativeBinding,
      scheduler: TEST_SCHEDULER
    }
  )
  const refreshReasons: string[] = []
  manager.on('audio-device-options-changed', ({ reason }) => {
    refreshReasons.push(reason)
  })

  await manager.play('file:///music.flac')
  const first = await manager.getAudioOutputState()
  const enumerateCallsAfterFirstRead = nativeBinding.enumerateDeviceCalls
  nativeBinding.devices = [
    ...nativeBinding.devices,
    {
      id: 'dac-hotplug',
      label: 'Hotplug DAC',
      isDefault: false,
      backend: 'wasapi',
      pathKind: 'endpoint'
    }
  ]
  assert.equal((await manager.getAudioOutputState()).deviceOptions.length, first.deviceOptions.length)

  nativeBinding.setDiagnostics({ deviceLostCount: 1 }, { deviceRecovered: true, recoveryCount: 1 })
  ;(manager as unknown as { tick: () => void }).tick()
  const refreshed = await manager.getAudioOutputState()

  assert.ok(nativeBinding.enumerateDeviceCalls > enumerateCallsAfterFirstRead)
  assert.equal(refreshed.deviceOptions.some((device) => device.id === 'dac-hotplug'), true)
  assert.equal(refreshReasons.includes('native-output-diagnostics-changed'), true)
})

test('device hotplug polling refreshes device options while playback is stopped', async () => {
  const nativeBinding = new FakeNativeBinding()
  let now = 1000
  const manager = new AudioEngineManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    {
      nativeBinding,
      scheduler: {
        ...TEST_SCHEDULER,
        now: () => now
      }
    }
  )
  const refreshReasons: string[] = []
  manager.on('audio-device-options-changed', ({ reason }) => {
    refreshReasons.push(reason)
  })

  const first = await manager.getAudioOutputState()
  nativeBinding.devices = [
    ...nativeBinding.devices,
    {
      id: 'usb-dac-new',
      label: 'New USB DAC',
      isDefault: false,
      backend: 'wasapi',
      pathKind: 'endpoint'
    }
  ]
  now += 5001
  ;(manager as unknown as { tick: () => void }).tick()
  const refreshed = await manager.getAudioOutputState()

  assert.equal(refreshed.deviceOptions.length, first.deviceOptions.length + 1)
  assert.equal(refreshed.deviceOptions.some((device) => device.id === 'usb-dac-new'), true)
  assert.equal(refreshReasons.includes('audio-device-hotplug'), true)
})

test('platform device change notifications refresh device options immediately', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = new AudioEngineManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    {
      nativeBinding,
      scheduler: TEST_SCHEDULER
    }
  )
  const refreshReasons: string[] = []
  manager.on('audio-device-options-changed', ({ reason }) => {
    refreshReasons.push(reason)
  })

  const first = await manager.getAudioOutputState()
  const enumerateCallsAfterFirstRead = nativeBinding.enumerateDeviceCalls
  nativeBinding.devices = [
    ...nativeBinding.devices,
    {
      id: 'wm-devicechange-dac',
      label: 'WM_DEVICECHANGE DAC',
      isDefault: false,
      backend: 'wasapi',
      pathKind: 'endpoint'
    }
  ]
  assert.equal((await manager.getAudioOutputState()).deviceOptions.length, first.deviceOptions.length)

  manager.notifyAudioDeviceOptionsChanged('platform-device-change:wm-devicechange')
  const refreshed = await manager.getAudioOutputState()

  assert.ok(nativeBinding.enumerateDeviceCalls > enumerateCallsAfterFirstRead)
  assert.equal(refreshed.deviceOptions.length, first.deviceOptions.length + 1)
  assert.equal(refreshed.deviceOptions.some((device) => device.id === 'wm-devicechange-dac'), true)
  assert.equal(refreshReasons.includes('platform-device-change:wm-devicechange'), true)
})

test('getSpectrumData reuses native spectrum data within one visual frame', () => {
  const nativeBinding = new FakeNativeBinding()
  let now = 1000
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding,
    {
      now: () => now
    }
  )

  const first = manager.getSpectrumData(12)
  const second = manager.getSpectrumData(12)

  assert.equal(nativeBinding.spectrumReads, 1)
  assert.deepEqual(second, first)
  assert.notStrictEqual(second, first)

  first[0] = 999
  const third = manager.getSpectrumData(12)
  assert.equal(nativeBinding.spectrumReads, 1)
  assert.notEqual(third[0], 999)

  now += 100
  const refreshed = manager.getSpectrumData(12)
  assert.equal(nativeBinding.spectrumReads, 2)
  assert.notDeepEqual(refreshed, second)
})

test('getVisualizationData normalizes native visualization data', () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  const data = manager.getVisualizationData({
    spectrumPoints: 12,
    waveformPoints: 20,
    spectrogramFrames: 1
  })

  assert.equal(data.active, true)
  assert.equal(data.sampleRate, 48000)
  assert.equal(data.spectrum.length, 12)
  assert.equal(data.waveform.length, 20)
  assert.equal(data.spectrogram.length, 1)
    assert.equal(data.spectrogram[0].length, 12)
    assert.equal(data.peakDb, -3)
    assert.equal(data.rmsDb, -12)
    assert.equal(data.lufsMomentary, -15)
    assert.equal(data.tapStatus, 'active')
    assert.equal(data.reason, '')
})

test('getVisualizationData preserves high-resolution spectrum requests for the visualizer', () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  const data = manager.getVisualizationData({
    spectrumPoints: 4096,
    waveformPoints: 20,
    spectrogramFrames: 1
  })

  assert.equal(data.spectrum.length, 4096)
  assert.equal(data.spectrogram[0].length, 4096)
})

test('getVisualizationData caps native maxFrequency at Nyquist', () => {
  const nativeBinding = new FakeNativeBinding()
  nativeBinding.GetVisualizationData = () =>
    JSON.stringify({
      spectrum: Array.from({ length: 64 }, () => 0.5),
      waveform: Array.from({ length: 20 }, () => 0),
      peakDb: -6,
      rmsDb: -16,
      lufsMomentary: -18,
      spectrogram: [],
      sampleRate: 32000,
      maxFrequency: 20000,
      active: true
    })
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  const data = manager.getVisualizationData({
    spectrumPoints: 64,
    waveformPoints: 20,
    spectrogramFrames: 0
  })

  assert.equal(data.sampleRate, 32000)
  assert.equal(data.maxFrequency, 16000)
})

test('getVisualizationData can precompute visualizer bars without returning the full spectrum payload', () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  const data = manager.getVisualizationData({
    spectrumPoints: 4096,
    waveformPoints: 20,
    spectrogramFrames: 0,
    oscilloscopePoints: 0,
    visualizerBarCount: 130
  })

  assert.equal(data.active, true)
  assert.equal(data.spectrum.length, 0)
  assert.equal(data.visualizerBars?.length, 130)
  assert.equal(data.waveform.length, 20)
  assert.ok(data.visualizerBars?.some((value) => value > 0))
})

test('mapSpectrumToVisualizerBars keeps flat spectrum visually flat', () => {
  const bars = mapSpectrumToVisualizerBars(Array.from({ length: 4096 }, () => 0.5), 48000, 130)

  assert.equal(bars.length, 130)
  const min = Math.min(...bars)
  const max = Math.max(...bars)
  assert.ok(max - min < 0.0001, `expected flat bars, got range ${max - min}`)
  assert.ok(Math.abs(bars[0] - 0.5) < 0.0001, `expected raw normalized value, got ${bars[0]}`)
})

test('mapSpectrumToVisualizerBars maps a 1kHz peak near the 1kHz visual band', () => {
  const sampleRate = 48000
  const spectrumLength = 4096
  const fftSize = spectrumLength * 2
  const peakFrequency = 1000
  const spectrum = Array.from({ length: spectrumLength }, (_, bin) => {
    const frequency = bin * (sampleRate / fftSize)
    const distance = (frequency - peakFrequency) / 80
    return Math.exp(-distance * distance)
  })

  const bars = mapSpectrumToVisualizerBars(spectrum, sampleRate, 130)
  const peakBar = bars.reduce((best, value, index) => (value > bars[best] ? index : best), 0)
  const minFrequency = 20
  const maxFrequency = 20000
  const ratio = maxFrequency / minFrequency
  const centerFrequency = minFrequency * Math.pow(ratio, peakBar / (130 - 1))

  assert.ok(
    centerFrequency >= 900 && centerFrequency <= 1125,
    `expected 1kHz near peak bar center ${centerFrequency.toFixed(1)}Hz`
  )
})

test('mapSpectrumToVisualizerBars caps visual frequency range at Nyquist', () => {
  const bars = mapSpectrumToVisualizerBars(Array.from({ length: 4096 }, () => 1), 32000, 130)

  assert.equal(bars.length, 130)
  assert.ok(bars.every((value) => value > 0 && value <= 1))
})

test('getVisualizationData can omit unused visualization payloads', () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  const data = manager.getVisualizationData({
    spectrumPoints: 2048,
    waveformPoints: 96,
    spectrogramFrames: 0,
    oscilloscopePoints: 0
  })

  assert.equal(data.active, true)
  assert.equal(data.spectrum.length, 2048)
  assert.equal(data.waveform.length, 96)
  assert.equal(data.spectrogram.length, 0)
  assert.equal(data.oscilloscope.length, 0)
})

test('getVisualizationData reuses native visualization data within one visual frame', () => {
  const source = readFileSync(new URL('./audioEngineManager.ts', import.meta.url), 'utf8')
  assert.match(source, /const VISUALIZATION_CACHE_TTL_MS = 24/)

  const nativeBinding = new FakeNativeBinding()
  let now = 1000
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding,
    {
      now: () => now
    }
  )

  const first = manager.getVisualizationData({
    spectrumPoints: 12,
    waveformPoints: 20,
    spectrogramFrames: 1
  })
  const second = manager.getVisualizationData({
    spectrumPoints: 12,
    waveformPoints: 20,
    spectrogramFrames: 1
  })

  assert.equal(nativeBinding.visualizationReads, 1)
  assert.strictEqual(second, first)

  now += 100
  const refreshed = manager.getVisualizationData({
    spectrumPoints: 12,
    waveformPoints: 20,
    spectrogramFrames: 1
  })
  assert.equal(nativeBinding.visualizationReads, 2)
  assert.notStrictEqual(refreshed, first)
})

test('getVisualizationData returns inactive shape when native visualization is unavailable while stopped', () => {
  const nativeBinding = new FakeNativeBinding()
  delete (nativeBinding as Partial<NativeAudioBinding>).GetVisualizationData
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  const data = manager.getVisualizationData({
    spectrumPoints: 12,
    waveformPoints: 20,
    spectrogramFrames: 4
  })

  assert.equal(data.active, false)
  assert.equal(data.sampleRate, 0)
  assert.equal(data.spectrum.length, 12)
  assert.equal(data.waveform.length, 20)
    assert.equal(data.spectrogram.length, 0)
    assert.equal(data.peakDb, -120)
    assert.equal(data.rmsDb, -120)
    assert.equal(data.lufsMomentary, null)
    assert.equal(data.tapStatus, 'native-unavailable')
    assert.equal(data.reason, 'Native visualization tap unavailable')
})

test('getVisualizationData returns animated fallback data when native visualization is unavailable while playing', async () => {
  const nativeBinding = new FakeNativeBinding()
  delete (nativeBinding as Partial<NativeAudioBinding>).GetVisualizationData
  let now = 1000
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding,
    {
      now: () => now
    }
  )

  await manager.play('file:///music.flac')
  const data = manager.getVisualizationData({
    spectrumPoints: 12,
    waveformPoints: 20,
    spectrogramFrames: 4
  })
  now += 250
  const nextData = manager.getVisualizationData({
    spectrumPoints: 12,
    waveformPoints: 20,
    spectrogramFrames: 4
  })

  assert.equal(data.active, true)
  assert.ok(data.sampleRate > 0)
  assert.equal(data.spectrum.length, 12)
  assert.equal(data.waveform.length, 20)
  assert.equal(data.spectrogram.length, 1)
  assert.equal(data.spectrogram[0].length, 12)
  assert.notDeepEqual(nextData.spectrum, data.spectrum)
  assert.ok(data.spectrum.some((value) => value > 0))
  assert.ok(data.waveform.some((value) => value !== 0))
    assert.equal(data.peakDb, -18)
    assert.equal(data.rmsDb, -28)
    assert.equal(data.lufsMomentary, -24)
    assert.equal(data.tapStatus, 'synthetic-fallback')
    assert.equal(data.reason, 'Native visualization tap unavailable')
})

test('getVisualizationData falls back while playback is active but native visualization is inactive', async () => {
  const nativeBinding = new FakeNativeBinding()
  nativeBinding.GetVisualizationData = (optionsJson: string): string => {
    const options = JSON.parse(optionsJson || '{}') as {
      spectrumPoints?: number
      waveformPoints?: number
      oscilloscopePoints?: number
    }
    return JSON.stringify({
      spectrum: Array.from({ length: options.spectrumPoints ?? 64 }, () => 0),
      waveform: Array.from({ length: options.waveformPoints ?? 128 }, () => 0),
      oscilloscope: Array.from({ length: options.oscilloscopePoints ?? 1024 }, () => 0),
      peakDb: -120,
      rmsDb: -120,
      lufsMomentary: null,
      spectrogram: [],
      sampleRate: 0,
      active: false
    })
  }
  let now = 1000
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding,
    {
      now: () => now
    }
  )

  await manager.play('file:///music.flac')
  const data = manager.getVisualizationData({
    spectrumPoints: 12,
    waveformPoints: 20,
    spectrogramFrames: 4
  })
  now += 250
  const nextData = manager.getVisualizationData({
    spectrumPoints: 12,
    waveformPoints: 20,
    spectrogramFrames: 4
  })

    assert.equal(data.active, true)
    assert.ok(data.sampleRate > 0)
    assert.notDeepEqual(nextData.spectrum, data.spectrum)
    assert.ok(data.spectrum.some((value) => value > 0))
    assert.ok(data.waveform.some((value) => value !== 0))
    assert.equal(data.tapStatus, 'synthetic-fallback')
    assert.equal(data.reason, 'Native visualization tap returned no samples')
})

test('DSP module updates enable the native DSP chain instead of only toggling UI state', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioProcessing: {
        dspEnabled: false,
        eqEnabled: false,
        volumeNormalization: 'off',
        crossfeedEnabled: false,
        crossfeedStrength: 0,
        convolverIrPath: ''
      }
    },
    nativeBinding
  )

  const eq = await manager.setAudioProcessing({ eqEnabled: true })
  assert.equal(eq.dspEnabled, true)
  assert.equal(eq.eqEnabled, true)
  assert.equal(nativeBinding.lastDspConfig.dspEnabled, true)
  assert.equal(nativeBinding.lastDspConfig.eqEnabled, true)

  const replayGain = await manager.setReplayGainMode('track', 1.5, -3, true)
  assert.equal(replayGain.dspEnabled, true)
  assert.equal(replayGain.volumeNormalization, 'track')
  assert.deepEqual(nativeBinding.lastReplayGainConfig, {
    mode: 'track',
    preamp: 1.5,
    fallback: -3,
    clip: true
  })

  const crossfeed = await manager.setCrossfeedStrength(0.35)
  assert.equal(crossfeed.dspEnabled, true)
  assert.equal(crossfeed.crossfeedEnabled, true)
  assert.equal(crossfeed.crossfeedStrength, 0.35)
  assert.equal(nativeBinding.lastCrossfeedStrength, 0.35)

  const convolver = await manager.loadImpulseResponse('C:\\ir\\headphones.wav')
  assert.equal(manager.getAudioProcessing().dspEnabled, true)
  assert.equal(manager.getAudioProcessing().convolverEnabled, true)
  assert.equal(manager.getAudioProcessing().convolverIrPath, 'C:\\ir\\headphones.wav')
  assert.equal(nativeBinding.loadedImpulseResponsePath, 'C:\\ir\\headphones.wav')
  assert.equal(convolver.loaded, false)

  await manager.unloadImpulseResponse()
  assert.equal(manager.getAudioProcessing().convolverEnabled, false)
  assert.equal(manager.getAudioProcessing().convolverIrPath, '')
  assert.equal(nativeBinding.loadedImpulseResponsePath, '')
})

test('setAudioProcessing skips native DSP fanout when normalized settings are unchanged', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioProcessing: {
        dspEnabled: false,
        eqEnabled: false,
        volumeNormalization: 'off',
        crossfeedEnabled: false,
        crossfeedStrength: 0,
        convolverIrPath: ''
      }
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))

  await manager.setAudioProcessing({ eqEnabled: true })
  assert.equal(nativeBinding.dspConfigCalls, 1)
  assert.equal(nativeBinding.eqBandsCalls, 1)
  assert.equal(nativeBinding.replayGainCalls, 0)
  assert.equal(nativeBinding.crossfeedCalls, 0)
  assert.equal(nativeBinding.unloadImpulseResponseCalls, 0)
  assert.equal(playbackUpdates.length, 1)

  const unchanged = await manager.setAudioProcessing({ eqEnabled: true })

  assert.equal(unchanged.dspEnabled, true)
  assert.equal(unchanged.eqEnabled, true)
  assert.equal(nativeBinding.dspConfigCalls, 1)
  assert.equal(nativeBinding.eqBandsCalls, 1)
  assert.equal(nativeBinding.replayGainCalls, 0)
  assert.equal(nativeBinding.crossfeedCalls, 0)
  assert.equal(nativeBinding.unloadImpulseResponseCalls, 0)
  assert.equal(playbackUpdates.length, 1)
})

test('unloadImpulseResponse skips native fanout when no impulse response is loaded', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioProcessing: {
        dspEnabled: false,
        convolverEnabled: false,
        convolverIrPath: ''
      }
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))

  const convolver = await manager.unloadImpulseResponse()

  assert.equal(convolver.loaded, false)
  assert.equal(manager.getAudioProcessing().convolverEnabled, false)
  assert.equal(manager.getAudioProcessing().convolverIrPath, '')
  assert.equal(nativeBinding.unloadImpulseResponseCalls, 0)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, 0)
})

test('getConvolverInfo reuses idle native convolver info within the polling cache window', () => {
  const nativeBinding = new FakeNativeBinding()
  let now = 1000
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioProcessing: {
        dspEnabled: false,
        convolverEnabled: false,
        convolverIrPath: ''
      }
    },
    nativeBinding,
    {
      now: () => now
    }
  )

  const first = manager.getConvolverInfo() as ConvolverInfo & { reads?: number }
  const second = manager.getConvolverInfo() as ConvolverInfo & { reads?: number }

  assert.equal(nativeBinding.convolverInfoReads, 1)
  assert.equal(second.reads, first.reads)

  now += 250
  const refreshed = manager.getConvolverInfo() as ConvolverInfo & { reads?: number }

  assert.equal(nativeBinding.convolverInfoReads, 2)
  assert.equal(refreshed.reads, 2)
})

test('specialized DSP setters skip native calls when normalized settings are unchanged', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))

  await manager.setEqBands({ eqEnabled: true, eqPreamp: 1 })
  assert.equal(nativeBinding.eqBandsCalls, 1)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, 0)

  await manager.setEqBands({ eqEnabled: true, eqPreamp: 1 })
  assert.equal(nativeBinding.eqBandsCalls, 1)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, 0)

  await manager.setCrossfeedStrength(0.35)
  assert.equal(nativeBinding.crossfeedCalls, 1)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, 0)

  await manager.setCrossfeedStrength(0.35)
  assert.equal(nativeBinding.crossfeedCalls, 1)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, 0)

  await manager.setReplayGainMode('track', 1.5, -3, true)
  assert.equal(nativeBinding.replayGainCalls, 1)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, 0)

  await manager.setReplayGainMode('track', 1.5, -3, true)
  assert.equal(nativeBinding.replayGainCalls, 1)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, 0)
})

test('setEqPreset skips native calls when normalized preset is unchanged', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))
  const preset = {
    eqMode: 'graphic' as const,
    eqPreamp: 2,
    eqBands: DEFAULT_AUDIO_PROCESSING.eqBands.map((band, index) => ({
      ...band,
      gain: index === 0 ? 1.5 : 0
    }))
  }

  const first = await manager.setEqPreset(preset)
  assert.equal(first.eqEnabled, true)
  assert.equal(first.eqPreamp, 2)
  assert.equal(nativeBinding.eqPresetCalls, 1)
  assert.equal(nativeBinding.lastEqPresetConfig.eqEnabled, true)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, 0)

  const second = await manager.setEqPreset(preset)
  assert.equal(second.eqEnabled, true)
  assert.equal(second.eqPreamp, 2)
  assert.equal(nativeBinding.eqPresetCalls, 1)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, 0)
})

test('turning the DSP master switch off still bypasses processing modules', async () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioProcessing: {
        dspEnabled: true,
        eqEnabled: true,
        volumeNormalization: 'track',
        crossfeedEnabled: true,
        crossfeedStrength: 0.4
      }
    },
    nativeBinding
  )

  const processing = await manager.setAudioProcessing({ dspEnabled: false })

  assert.equal(processing.dspEnabled, false)
  assert.equal(processing.eqEnabled, true)
  assert.equal(processing.volumeNormalization, 'track')
  assert.equal(processing.crossfeedEnabled, true)
  assert.equal(nativeBinding.lastDspConfig.dspEnabled, false)
})

test('canonical outputInfo clears stale DoP mirrors on PCM DSD fallback', async () => {
  const nativeBinding = new FakeNativeBinding({
    source: 'album.dsf',
    codec: 'dsd',
    isDsd: true,
    dsdMode: 'dop',
    dsdRate: 64,
    outputInfo: makeOutputInfo({
      isDsd: true,
      dsdMode: 'pcm',
      dsdRate: 64,
      actualOutputFormat: 'float32',
      actualSampleRate: 176400,
      actualBitDepth: 32,
      outputSampleRate: 176400,
      outputBitDepth: 32,
      perfectReason: 'DSD 当前已转换为 PCM 输出',
      perfectReasonCode: 'dsd_converted_to_pcm',
      capabilityReason: 'DSD 当前已转换为 PCM 输出'
    })
  })
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  await manager.play('album.dsf', 0)
  const info = await manager.getPlaybackInfo()

  assert.equal(info.outputInfo.isDsd, true)
  assert.equal(info.outputInfo.dsdMode, 'pcm')
  assert.equal(info.outputInfo.dsdRate, 64)
  assert.equal(info.isDsd, true)
  assert.equal(info.dsdMode, 'pcm')
  assert.equal(info.dsdRate, 64)
  assert.equal(info.perfectReasonCode, 'dsd_converted_to_pcm')
  assertPlaybackMirrorsOutputInfo(info)
})

test('switching DSD output mode to PCM does not leave stale DoP state', async () => {
  const nativeBinding = new FakeNativeBinding({
    source: 'album.dsf',
    codec: 'dsd',
    isDsd: true,
    dsdMode: 'dop',
    dsdRate: 64,
    outputInfo: makeOutputInfo({
      isDsd: true,
      dsdMode: 'dop',
      dsdRate: 64,
      actualOutputFormat: 'pcm_dop',
      actualSampleRate: 176400,
      actualBitDepth: 24,
      outputSampleRate: 176400,
      outputBitDepth: 24,
      perfectReason: '当前 DSD 正在通过 DoP 载波传输',
      perfectReasonCode: 'dsd_dop',
      capabilityReason: '当前 DSD 正在通过 DoP 载波传输'
    })
  })
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  await manager.play('album.dsf', 0)
  const dopInfo = await manager.getPlaybackInfo()
  assert.equal(dopInfo.outputInfo.dsdMode, 'dop')
  assert.equal(dopInfo.dsdMode, 'dop')

  await manager.setAudioProcessing({ dsdOutputMode: 'pcm' })
  const pcmInfo = await manager.getPlaybackInfo()

  assert.equal(pcmInfo.outputInfo.isDsd, true)
  assert.equal(pcmInfo.outputInfo.dsdMode, 'pcm')
  assert.equal(pcmInfo.outputInfo.dsdRate, 64)
  assert.equal(pcmInfo.isDsd, true)
  assert.equal(pcmInfo.dsdMode, 'pcm')
  assert.equal(pcmInfo.dsdRate, 64)
  assert.equal(pcmInfo.perfectReasonCode, 'dsd_converted_to_pcm')
  assert.notEqual(pcmInfo.outputInfo.dsdMode, 'dop')
  assertPlaybackMirrorsOutputInfo(pcmInfo)
})

test('audio service crash stops native playback and keeps manager usable', async () => {
  const service = new FakeAudioServiceBinding()
  const manager = new AudioEngineManager(
    { exclusiveMode: false },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )

  let crashReason = ''
  manager.on('audio-service-crash', ({ reason }) => {
    crashReason = reason
  })

  const meta = await manager.getMetadataAsync('service-track.flac')
  assert.equal(meta?.title, 'service metadata 1')

  service.emit('crash', 'native dsp crash fixture exited')
  const info = await manager.getPlaybackInfo()

  assert.equal(crashReason, 'native dsp crash fixture exited')
  assert.equal(info.state, 'stopped')
  assert.equal(info.nativePlaybackActive, false)
  assert.equal(info.outputInfo.diagnostics.lastError, 'native dsp crash fixture exited')
  assert.equal(info.outputInfo.nativeDsp?.plugins.length, 0)
  assert.equal(info.outputInfo.recoveryCount, 1)

  manager.destroy()
})

test('audio service play waits for utility process confirmation before marking playing', async () => {
  const service = new FakeAudioServiceBinding()
  service.playAsyncError = new Error('audio service child missing')
  const manager = new AudioEngineManager(
    { exclusiveMode: false },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const originalWarn = console.warn
  console.warn = () => {}

  try {
    await assert.rejects(() => manager.play('service-track.flac', 0), /audio service child missing/)

    const info = await manager.getPlaybackInfo()
    assert.equal(info.state, 'stopped')
    assert.equal(info.nativePlaybackActive, false)
    assert.equal(service.playCalls, 0)
  } finally {
    console.warn = originalWarn
    manager.destroy()
  }
})

test('audio service stop waits for utility process confirmation before marking stopped', async () => {
  const service = new DeferredAudioServiceBinding(['Stop'])
  service.playbackInfo = makePlaybackInfo({
    state: 'playing',
    source: 'service-track.flac',
    nativePlaybackActive: true
  })
  const manager = new AudioEngineManager(
    { exclusiveMode: false },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  await manager.play('service-track.flac', 0)

  const stopPromise = manager.stop()
  await new Promise((resolve) => setTimeout(resolve, 0))

  let info = await manager.getPlaybackInfo()
  assert.equal(service.stopCalls, 0)
  assert.equal(info.state, 'playing')
  assert.equal(info.nativePlaybackActive, true)

  service.resolveNextDeferredCall()
  await stopPromise

  info = await manager.getPlaybackInfo()
  assert.equal(service.stopCalls, 1)
  assert.equal(info.state, 'stopped')
  assert.equal(info.nativePlaybackActive, false)

  manager.destroy()
})

test('destroy skips duplicate native Stop after the manager is already destroyed', () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )

  manager.destroy()
  manager.destroy()

  assert.equal(nativeBinding.stopCalls, 1)
})

test('destroy skips duplicate audio service teardown after the manager is already destroyed', () => {
  const service = new FakeAudioServiceBinding()
  const manager = new AudioEngineManager(
    { exclusiveMode: false },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )

  manager.destroy()
  manager.destroy()

  assert.equal(service.stopCalls, 1)
  assert.equal(service.destroyCalls, 1)
})

test('setNativeDspPluginChain skips native calls when chain JSON is unchanged', () => {
  const nativeBinding = new FakeNativeBinding()
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding
  )
  const playbackUpdates: PlaybackInfo[] = []
  manager.on('playback-info', (info: PlaybackInfo) => playbackUpdates.push(info))
  const chainJson = '{"plugins":[{"id":"com.example.eq"}]}'

  manager.setNativeDspPluginChain(chainJson)
  assert.equal(nativeBinding.nativeDspPluginChainCalls, 1)
  assert.equal(nativeBinding.nativeDspPluginChainJson, chainJson)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, 0)

  manager.setNativeDspPluginChain(chainJson)
  assert.equal(nativeBinding.nativeDspPluginChainCalls, 1)
  assert.equal(nativeBinding.playbackInfoReads, 0)
  assert.equal(playbackUpdates.length, 0)
})

test('getNativeDspPluginStatus reuses native status within the polling cache window', () => {
  const nativeBinding = new FakeNativeBinding()
  let now = 1000
  const manager = makeManager(
    {
      exclusiveMode: false,
      audioOutput: 'wasapi',
      audioDevice: 'auto'
    },
    nativeBinding,
    {
      now: () => now
    }
  )

  const first = manager.getNativeDspPluginStatus() as { plugins: Array<{ reads: number }> }
  const second = manager.getNativeDspPluginStatus() as { plugins: Array<{ reads: number }> }

  assert.equal(nativeBinding.nativeDspPluginStatusReads, 1)
  assert.equal(second.plugins[0]?.reads, first.plugins[0]?.reads)

  manager.setNativeDspPluginChain('{"plugins":[{"id":"com.example.eq"}]}')
  const afterChainUpdate = manager.getNativeDspPluginStatus() as {
    plugins: Array<{ reads: number }>
  }

  assert.equal(nativeBinding.nativeDspPluginStatusReads, 2)
  assert.equal(afterChainUpdate.plugins[0]?.reads, 2)

  now += 250
  const refreshed = manager.getNativeDspPluginStatus() as { plugins: Array<{ reads: number }> }

  assert.equal(nativeBinding.nativeDspPluginStatusReads, 3)
  assert.equal(refreshed.plugins[0]?.reads, 3)
})

test('audio service ready after restart restores configuration and queue without auto-resume', async () => {
  const service = new FakeAudioServiceBinding()
  const manager = new AudioEngineManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioOutputConfig: { preferredBufferSize: 512, routingMode: 'stereo-to-5.1' },
      audioProcessing: { eqEnabled: true, crossfeedEnabled: true, crossfeedStrength: 0.35 }
    },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const queue: AudioEngineQueueItem[] = [
    { id: 'local:one', source: 'one.flac', title: 'One' },
    { id: 'local:two', source: 'two.flac', title: 'Two' }
  ]
  let serviceReadyManualResumeRequired = false
  let serviceReadyOutputRouteSynced = false
  manager.on('audio-service-ready', ({ manualResumeRequired, outputRouteSynced }) => {
    serviceReadyManualResumeRequired = manualResumeRequired
    serviceReadyOutputRouteSynced = outputRouteSynced
  })

  await manager.start()
  assert.equal(service.eqBandsCalls, 1)
  assert.equal(service.replayGainCalls, 1)
  assert.equal(service.crossfeedCalls, 1)

  await manager.setAudioOutput('asio', 'asio:studio')
  await manager.loadQueue(queue, 1)
  manager.setNativeDspPluginChain('{"plugins":[{"id":"com.example.eq"}]}')
  await manager.play('two.flac', 12)
  service.emit('crash', 'service crashed')

  service.backend = 'wasapi'
  service.device = 'auto'
  service.outputConfig = {}
  service.dspConfig = {}
  service.dspPluginChain = ''
  service.queue = []
  service.queueIndex = -1
  service.playCalls = 0
  service.emit('ready')
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(serviceReadyManualResumeRequired, true)
  assert.equal(serviceReadyOutputRouteSynced, true)
  assert.equal(service.backend, 'asio')
  assert.equal(service.device, 'asio:studio')
  assert.equal(service.outputConfig.preferredBufferSize, 512)
  assert.equal(service.outputConfig.routingMode, 'stereo-to-5.1')
  assert.equal(service.dspConfig.eqEnabled, true)
  assert.equal(service.dspConfig.crossfeedStrength, 0.35)
  assert.equal(service.eqBandsCalls, 2)
  assert.equal(service.replayGainCalls, 2)
  assert.equal(service.crossfeedCalls, 2)
  assert.equal(service.dspPluginChain, '{"plugins":[{"id":"com.example.eq"}]}')
  assert.deepEqual(service.queue, queue)
  assert.equal(service.queueIndex, 1)
  assert.equal(service.playCalls, 0)

  const info = await manager.getPlaybackInfo()
  assert.equal(info.state, 'stopped')
  assert.equal(info.nativePlaybackActive, false)

  manager.destroy()
})

test('audio service ready keeps output route unsynced until restore RPCs acknowledge', async () => {
  const service = new DeferredAudioServiceBinding([
    'SetOutputBackend',
    'SetOutputDevice',
    'SetOutputConfig'
  ])
  const manager = new AudioEngineManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioOutputConfig: { preferredBufferSize: 512 },
      audioProcessing: { eqEnabled: true, crossfeedEnabled: true, crossfeedStrength: 0.35 }
    },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const internals = manager as unknown as {
    nativeOutputRouteSynced: boolean
  }
  let serviceReadyManualResumeRequired = false
  let serviceReadyOutputRouteSynced = false
  manager.on('audio-service-ready', ({ manualResumeRequired, outputRouteSynced }) => {
    serviceReadyManualResumeRequired = manualResumeRequired
    serviceReadyOutputRouteSynced = outputRouteSynced
  })

  const startup = manager.start()
  await resolveDeferredRouteCalls(service)
  await startup
  const initialRouteSwitch = manager.setAudioOutput('asio', 'asio:studio')
  await resolveDeferredRouteCalls(service)
  await initialRouteSwitch
  const queue: AudioEngineQueueItem[] = [
    { id: 'local:one', source: 'one.flac', title: 'One' },
    { id: 'local:two', source: 'two.flac', title: 'Two' }
  ]
  await manager.loadQueue(queue, 1)
  manager.setNativeDspPluginChain('{"plugins":[{"id":"com.example.eq"}]}')
  service.emit('crash', 'service crashed before route restore')
  service.backend = 'wasapi'
  service.device = 'auto'
  service.outputConfig = {}
  service.dspConfig = {}
  service.dspPluginChain = ''
  service.queue = []
  service.queueIndex = -1

  service.emit('ready')
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.equal(serviceReadyManualResumeRequired, false)
  assert.equal(serviceReadyOutputRouteSynced, false)
  assert.deepEqual(service.dspConfig, {})
  assert.equal(service.dspPluginChain, '')
  assert.deepEqual(service.queue, [])
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputBackend']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputDevice']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputConfig']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(internals.nativeOutputRouteSynced, true)
  assert.equal(serviceReadyManualResumeRequired, true)
  assert.equal(serviceReadyOutputRouteSynced, true)
  assert.equal(service.backend, 'asio')
  assert.equal(service.device, 'asio:studio')
  assert.equal(service.outputConfig.preferredBufferSize, 512)
  assert.equal(service.dspConfig.eqEnabled, true)
  assert.equal(service.dspConfig.crossfeedStrength, 0.35)
  assert.equal(service.dspPluginChain, '{"plugins":[{"id":"com.example.eq"}]}')
  assert.deepEqual(service.queue, queue)
  assert.equal(service.queueIndex, 1)

  manager.destroy()
})

test('audio service ready waits for DSP and queue restore RPCs before enabling manual resume', async () => {
  const service = new DeferredAudioServiceBinding([
    'SetOutputBackend',
    'SetOutputDevice',
    'SetOutputConfig',
    'SetDspConfig',
    'SetDspPluginChain',
    'LoadQueue'
  ])
  const manager = new AudioEngineManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioOutputConfig: { preferredBufferSize: 512 },
      audioProcessing: { eqEnabled: true, crossfeedEnabled: true, crossfeedStrength: 0.35 }
    },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const serviceReadyEvents: Array<{
    manualResumeRequired: boolean
    outputRouteSynced: boolean
    restoreErrors: string[]
  }> = []
  manager.on('audio-service-ready', (event) => {
    serviceReadyEvents.push(event)
  })

  const startup = manager.start()
  await resolveDeferredRouteCalls(service)
  await startup
  const initialRouteSwitch = manager.setAudioOutput('asio', 'asio:studio')
  await resolveDeferredRouteCalls(service)
  await initialRouteSwitch
  const queue: AudioEngineQueueItem[] = [
    { id: 'local:one', source: 'one.flac', title: 'One' },
    { id: 'local:two', source: 'two.flac', title: 'Two' }
  ]
  await manager.loadQueue(queue, 1)
  manager.setNativeDspPluginChain('{"plugins":[{"id":"com.example.eq"}]}')
  service.emit('crash', 'service crashed before full restore')
  service.backend = 'wasapi'
  service.device = 'auto'
  service.outputConfig = {}
  service.dspConfig = {}
  service.dspPluginChain = ''
  service.queue = []
  service.queueIndex = -1

  service.emit('ready')
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(serviceReadyEvents.length, 0)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputBackend']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(serviceReadyEvents.length, 0)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputDevice']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(serviceReadyEvents.length, 0)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetOutputConfig']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(serviceReadyEvents.length, 0)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetDspConfig']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(serviceReadyEvents.length, 0)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['SetDspPluginChain']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(serviceReadyEvents.length, 0)
  assert.deepEqual(
    service.deferredCalls.map((call) => call.method),
    ['LoadQueue']
  )

  service.resolveNextDeferredCall()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(serviceReadyEvents.length, 1)
  assert.equal(serviceReadyEvents[0].manualResumeRequired, true)
  assert.equal(serviceReadyEvents[0].outputRouteSynced, true)
  assert.deepEqual(serviceReadyEvents[0].restoreErrors, [])
  assert.equal(service.dspConfig.eqEnabled, true)
  assert.equal(service.dspConfig.crossfeedStrength, 0.35)
  assert.equal(service.dspPluginChain, '{"plugins":[{"id":"com.example.eq"}]}')
  assert.deepEqual(service.queue, queue)
  assert.equal(service.queueIndex, 1)

  manager.destroy()
})

test('audio service ready reports output route restore failures without enabling resume', async () => {
  const service = new DeferredAudioServiceBinding(['SetOutputDevice'])
  const manager = new AudioEngineManager(
    {
      exclusiveMode: true,
      audioOutput: 'wasapi',
      audioDevice: 'auto',
      audioOutputConfig: { preferredBufferSize: 512 }
    },
    {
      audioServiceFactory: () => service,
      scheduler: TEST_SCHEDULER,
      deviceOptionsProvider: () => DEVICE_OPTIONS
    }
  )
  const internals = manager as unknown as {
    nativeOutputRouteSynced: boolean
  }
  const serviceReadyEvents: Array<{
    manualResumeRequired: boolean
    outputRouteSynced: boolean
    restoreErrors: string[]
  }> = []
  manager.on('audio-service-ready', (event) => {
    serviceReadyEvents.push(event)
  })

  const startup = manager.start()
  await resolveDeferredRouteCalls(service)
  await startup
  const initialRouteSwitch = manager.setAudioOutput('asio', 'asio:studio')
  await resolveDeferredRouteCalls(service)
  await initialRouteSwitch
  service.emit('crash', 'service crashed before route restore failure')
  service.emit('ready')
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(serviceReadyEvents.length, 0)
  assert.equal(internals.nativeOutputRouteSynced, false)

  service.rejectDeferredCalls(new Error('device disappeared'))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(internals.nativeOutputRouteSynced, false)
  assert.equal(serviceReadyEvents.length, 1)
  assert.equal(serviceReadyEvents[0].manualResumeRequired, true)
  assert.equal(serviceReadyEvents[0].outputRouteSynced, false)
  assert.match(serviceReadyEvents[0].restoreErrors.join('\n'), /device disappeared/)

  manager.destroy()
})
