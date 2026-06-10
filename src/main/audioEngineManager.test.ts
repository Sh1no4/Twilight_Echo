import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  AudioDeviceOption,
  AudioEngineManagerDependencies,
  AudioEngineQueueItem,
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

const { AudioEngineManager, DEFAULT_AUDIO_PROCESSING, normalizeAudioProcessingSettings } =
  (await import(
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

class FakeNativeBinding implements NativeAudioBinding {
  playbackInfo: PlaybackInfo
  devices: AudioDeviceOption[]
  lastOutputConfig: OutputConfig = { preferredBufferSize: 0, routingMode: 'auto' }
  lastDspConfig: Partial<AudioProcessingSettings> = {}
  lastEqConfig: Partial<AudioProcessingSettings> = {}
  lastReplayGainConfig: {
    mode: VolumeNormalizationMode
    preamp: number
    fallback: number
    clip: boolean
  } | null = null
  lastCrossfeedStrength = 0
  loadedImpulseResponsePath = ''

  constructor(playbackInfo?: Partial<PlaybackInfo>, devices = DEVICE_OPTIONS) {
    this.devices = devices
    this.playbackInfo = makePlaybackInfo(playbackInfo)
  }

  Play = (source: string, startTime = 0): void => {
    this.playbackInfo = {
      ...this.playbackInfo,
      state: 'playing',
      source,
      position: startTime
    }
  }

  Pause = (): void => {
    this.playbackInfo = {
      ...this.playbackInfo,
      state: this.playbackInfo.state === 'paused' ? 'playing' : 'paused'
    }
  }

  Stop = (): void => {
    this.playbackInfo = {
      ...this.playbackInfo,
      state: 'stopped',
      position: 0
    }
  }

  Seek = (time: number): void => {
    this.playbackInfo = {
      ...this.playbackInfo,
      position: time
    }
  }

  SetVolume = (volume: number): void => {
    this.playbackInfo = {
      ...this.playbackInfo,
      volume
    }
  }

  SetOutputDevice = (device: string): void => {
    const nextDevice = this.devices.find((entry) => entry.id === device) ?? this.devices[0]
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
    const exclusive = backend === 'asio' || backend === 'wasapi-exclusive'
    const accessMode = backend === 'wasapi' ? 'shared' : 'exclusive'
    const devicePathKind = backend === 'asio' ? 'asio' : 'default'
    const supportsOutputPerfect = backend === 'asio' || backend === 'wasapi-exclusive'
    const perfectReasonCode = backend === 'wasapi' ? 'shared_mixer' : ''
    const perfectReason = backend === 'wasapi' ? '共享输出经过系统混音' : ''
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
    const parsed = JSON.parse(json) as Partial<OutputConfig>
    this.lastOutputConfig = {
      preferredBufferSize:
        typeof parsed.preferredBufferSize === 'number' ? parsed.preferredBufferSize : this.lastOutputConfig.preferredBufferSize,
      routingMode:
        typeof parsed.routingMode === 'string' ? parsed.routingMode : this.lastOutputConfig.routingMode
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
        : this.playbackInfo.outputInfo.actualBackend === 'wasapi'
          ? 'shared_mixer'
          : ''
    const perfectReason =
      perfectReasonCode === 'routing_changes_semantics'
        ? '声道映射改变声道语义'
        : this.playbackInfo.outputInfo.actualBackend === 'wasapi'
          ? '共享输出经过系统混音'
          : ''
    const outputInfo = {
      ...this.playbackInfo.outputInfo,
      bufferSizeFrames: actualBufferSize,
      latencyFrames: actualBufferSize,
      latencyMs: bufferLatencyMs + driverLatencyMs,
      latencyInfo: makeLatencyInfo(bufferLatencyMs, driverLatencyMs, bufferLatencyMs + driverLatencyMs),
      channelRoutingMode: this.lastOutputConfig.routingMode,
      perfectReasonCode,
      perfectReason,
      capabilityReason: perfectReason
    }
    this.playbackInfo = this.withOutputInfo(outputInfo, {
      channelRoutingMode: outputInfo.channelRoutingMode
    })
  }

  LoadQueue = (_queueJson: string, _startIndex: number): void => {}
  Next = (): void => {}
  Previous = (): void => {}
  SetPlayMode = (mode: PlayMode): void => {
    this.playbackInfo = {
      ...this.playbackInfo,
      playMode: mode
    }
  }

  SetDspConfig = (json: string): void => {
    this.lastDspConfig = JSON.parse(json) as Partial<AudioProcessingSettings>
  }
  LoadImpulseResponse = (path: string): void => {
    this.loadedImpulseResponsePath = path
  }
  UnloadImpulseResponse = (): void => {
    this.loadedImpulseResponsePath = ''
  }
  GetConvolverInfo = (): string => JSON.stringify({ loaded: false, active: false })
  SetEqBands = (json: string): void => {
    this.lastEqConfig = JSON.parse(json) as Partial<AudioProcessingSettings>
  }
  SetEqPreset = (_json: string): void => {}
  SetCrossfeedStrength = (strength: number): void => {
    this.lastCrossfeedStrength = strength
  }
  SetReplayGainMode = (
    mode: VolumeNormalizationMode,
    preamp: number,
    fallback: number,
    clip: boolean
  ): void => {
    this.lastReplayGainConfig = { mode, preamp, fallback, clip }
  }
  GetMetadata = (_source: string): string => JSON.stringify(null)
  GetPlaybackInfo = (): string => JSON.stringify(this.playbackInfo)
  GetUpcomingTrack = (): AudioEngineQueueItem | null => null
  GetSpectrumData = (): number[] => []
  GetVisualizationData = (optionsJson: string): string => {
    const options = JSON.parse(optionsJson || '{}') as {
      spectrumPoints?: number
      waveformPoints?: number
      spectrogramFrames?: number
    }
    const spectrumPoints = options.spectrumPoints ?? 64
    const waveformPoints = options.waveformPoints ?? 128
    return JSON.stringify({
      spectrum: Array.from({ length: spectrumPoints }, (_, index) => index / Math.max(1, spectrumPoints - 1)),
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
  EnumerateDevices = (): string => JSON.stringify(this.devices)
  EnumerateBackends = (): string => JSON.stringify(['wasapi', 'wasapi-exclusive', 'asio'])
  GetEngineCapabilities = (): string => JSON.stringify({})
  GetLastError = (): string => JSON.stringify({ message: '' })

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

function makeManager(
  config: ConstructorParameters<typeof AudioEngineManager>[0],
  nativeBinding: FakeNativeBinding
): InstanceType<typeof AudioEngineManager> {
  return new AudioEngineManager(config, {
    nativeBinding,
    scheduler: TEST_SCHEDULER,
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
  assert.equal(info.outputInfo.latencyInfo.totalLatencyMs >= info.outputInfo.latencyInfo.bufferLatencyMs, true)
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
  assert.equal(asioDevice?.supportsNativeDsd, true)
  assert.deepEqual(asioDevice?.supportedDsdRates, [64])
  assert.deepEqual(asioDevice?.nativeDsdSampleRates, [2822400, 5644800, 11289600])
  assert.deepEqual(asioDevice?.nativeDsdSampleFormats, ['dsd-int8-msb1'])
  assert.deepEqual(asioDevice?.dopCarrierSampleRates, [176400])
  assert.deepEqual(asioDevice?.dopCarrierFormats, ['int24-in32'])
  assert.equal(asioDevice?.capabilityVersion, 3)
  assertPlaybackMirrorsOutputInfo(info)
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
})

test('getVisualizationData returns inactive shape when native visualization is unavailable', () => {
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
