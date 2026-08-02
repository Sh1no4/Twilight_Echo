import type {
  AudioDeviceOption,
  AudioEngineConfig,
  AudioEngineManagerDependencies,
  AudioEngineScheduler,
  AudioOutputId,
  AudioOutputOption,
  AudioOutputState,
  NativeAudioBinding,
  OutputConfig,
  OutputConfigApplyStatus,
  PlaybackInfo
} from './audioEngineTypes.ts'
import {
  AUDIO_DEVICE_OPTIONS_CACHE_TTL_MS,
  AUDIO_DEVICE_OPTIONS_DEFAULT_FOLLOW_POLL_MS,
  AUDIO_DEVICE_OPTIONS_HOTPLUG_POLL_MS,
  DEFAULT_AUDIO_DEVICE_OPTION,
  createDefaultPlaybackInfo,
  deviceCompatibleWithOutput,
  getAudioOutputOptions,
  isDefaultAudioDeviceAlias,
  normalizeAudioDevice,
  normalizeAudioDeviceOptions,
  normalizeAudioOutput,
  normalizeOutputConfig,
  outputConfigsEqual,
  parseNativeJson,
  supportsAudioExclusive
} from './audioEngineHelpers.ts'

export interface OutputRouterHost {
  getNative(): NativeAudioBinding | null
  getPlaybackInfo(): PlaybackInfo
  setPlaybackInfo(info: PlaybackInfo): void
  getLastNativeError(): string
  getScheduler(): AudioEngineScheduler
  isDestroyed(): boolean
  getNativeOutputRouteSynced(): boolean
  setNativeOutputRouteSynced(value: boolean): void
  callNativeMaybeAsync(
    context: string,
    method: keyof NativeAudioBinding,
    ...args: unknown[]
  ): Promise<boolean>
  applyNativeDspGraphOrThrow(context: string): Promise<unknown>
  readNativePlaybackInfo(): PlaybackInfo | null
  readNativePlaybackInfoAsync(): Promise<PlaybackInfo | null>
  mergeNativePlaybackInfo(nativeInfo: PlaybackInfo): PlaybackInfo
  updateOutputPerfect(): void
  publishPlaybackInfo(): void
  syncPlaybackOutputMirrorsFromOutputInfo(): void
  emit(event: string, payload?: unknown): void
}

export class OutputRouter {
  output: AudioOutputId
  device: string
  exclusiveMode: boolean
  outputConfig: OutputConfig
  outputConfigRevision = 0
  outputConfigApplyGeneration = 0
  outputConfigServiceGeneration = 0
  outputConfigApplyQueue: Promise<void> = Promise.resolve()
  outputConfigApplyStatus: OutputConfigApplyStatus = {
    requestedRevision: 0,
    appliedRevision: 0,
    failedRevision: 0,
    state: 'idle',
    error: '',
    generation: 0
  }
  deviceOptionsProvider?: () => AudioDeviceOption[] | null
  lastAudioDeviceOptionsCache: {
    selectedDevice: string
    readAt: number
    options: AudioDeviceOption[]
  } | null = null
  lastAudioDeviceOptionsSignature = ''
  lastAudioDeviceOptionsProbeAt = Number.NEGATIVE_INFINITY
  lastFollowedDefaultDeviceId = ''
  autoDeviceRebindInFlight: Promise<void> | null = null

  private readonly host: OutputRouterHost

  constructor(
    host: OutputRouterHost,
    config: Pick<
      AudioEngineConfig,
      'audioOutput' | 'audioDevice' | 'exclusiveMode' | 'audioOutputConfig'
    >,
    dependencies: Pick<AudioEngineManagerDependencies, 'deviceOptionsProvider'>
  ) {
    this.host = host
    this.deviceOptionsProvider = dependencies.deviceOptionsProvider
    this.output = normalizeAudioOutput(config.audioOutput)
    this.device = normalizeAudioDevice(config.audioDevice)
    this.exclusiveMode = Boolean(config.exclusiveMode)
    this.outputConfig = normalizeOutputConfig(config.audioOutputConfig)
    // Compatible device resolution needs options; defer until host playbackInfo exists.
  }

  /** Call after host playbackInfo is ready and native binding may be available. */
  initializeDeviceSelection(): void {
    this.device = this.resolveCompatibleDevice(this.output, this.device)
    this.exclusiveMode = this.exclusiveMode && supportsAudioExclusive(this.output)
  }

  private get native(): NativeAudioBinding | null {
    return this.host.getNative()
  }

  private get playbackInfo(): PlaybackInfo {
    return this.host.getPlaybackInfo()
  }

  private set playbackInfo(info: PlaybackInfo) {
    this.host.setPlaybackInfo(info)
  }

  private get lastNativeError(): string {
    return this.host.getLastNativeError()
  }

  private get scheduler(): AudioEngineScheduler {
    return this.host.getScheduler()
  }

  private get destroyed(): boolean {
    return this.host.isDestroyed()
  }

  private get nativeOutputRouteSynced(): boolean {
    return this.host.getNativeOutputRouteSynced()
  }

  private set nativeOutputRouteSynced(value: boolean) {
    this.host.setNativeOutputRouteSynced(value)
  }

  private callNativeMaybeAsync(
    context: string,
    method: keyof NativeAudioBinding,
    ...args: unknown[]
  ): Promise<boolean> {
    return this.host.callNativeMaybeAsync(context, method, ...args)
  }

  private applyNativeDspGraphOrThrow(context: string): Promise<unknown> {
    return this.host.applyNativeDspGraphOrThrow(context)
  }

  private readNativePlaybackInfo(): PlaybackInfo | null {
    return this.host.readNativePlaybackInfo()
  }

  private readNativePlaybackInfoAsync(): Promise<PlaybackInfo | null> {
    return this.host.readNativePlaybackInfoAsync()
  }

  private mergeNativePlaybackInfo(nativeInfo: PlaybackInfo): PlaybackInfo {
    return this.host.mergeNativePlaybackInfo(nativeInfo)
  }

  private updateOutputPerfect(): void {
    this.host.updateOutputPerfect()
  }

  private publishPlaybackInfo(): void {
    this.host.publishPlaybackInfo()
  }

  private syncPlaybackOutputMirrorsFromOutputInfo(): void {
    this.host.syncPlaybackOutputMirrorsFromOutputInfo()
  }

  private emit(event: string, payload?: unknown): void {
    this.host.emit(event, payload)
  }

  bumpServiceGeneration(): void {
    this.outputConfigServiceGeneration += 1
    if (this.outputConfigApplyStatus.state === 'pending') {
      // caller supplies reason via failPending if needed
    }
  }

  failPendingOutputConfig(reason: string, generation: number): void {
    if (this.outputConfigApplyStatus.state === 'pending') {
      this.outputConfigApplyStatus = {
        ...this.outputConfigApplyStatus,
        failedRevision: this.outputConfigApplyStatus.requestedRevision,
        state: 'failed',
        error: reason,
        generation
      }
    }
  }

  async restoreAudioServiceOutputRoute(
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
    const synced = results.every((result) => result.ok)
    if (synced) this.rememberFollowedDefaultDeviceFromOptions()
    return {
      synced,
      errors: results.filter((result) => !result.ok).map((result) => result.error)
    }
  }

  async restoreAudioServiceOutputRouteStep(
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
      throw new Error(
        `原生音频独占模式配置应用失败：${this.lastNativeError || '原生音频引擎不可用'}`
      )
    }
    this.nativeOutputRouteSynced = true
    this.refreshOutputInfoFromNative(true)
    await this.applyNativeDspGraphOrThrow('独占模式切换后解析 DSP 场景')
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
    await this.applyNativeDspGraphOrThrow('输出后端切换后解析 DSP 场景')
    return await this.getAudioOutputState()
  }

  async setAudioDevice(device: string): Promise<AudioOutputState> {
    const nextDevice = this.resolveCompatibleDevice(this.output, normalizeAudioDevice(device))
    if (this.nativeOutputRouteSynced && nextDevice === this.device)
      return await this.getAudioOutputState()

    const previousDevice = this.device
    this.device = nextDevice
    this.invalidateAudioDeviceOptionsCache('audio-device-changed')
    this.nativeOutputRouteSynced = false
    const deviceSynced = await this.callNativeMaybeAsync(
      '切换输出设备',
      'SetOutputDevice',
      this.device
    )
    if (!deviceSynced) {
      this.device = previousDevice
      this.invalidateAudioDeviceOptionsCache('audio-device-restore-after-failure')
      throw new Error(`原生音频输出设备切换失败：${this.lastNativeError || '原生音频引擎不可用'}`)
    }
    this.nativeOutputRouteSynced = true
    this.refreshOutputInfoFromNative(true)
    this.rememberFollowedDefaultDeviceFromOptions()
    await this.applyNativeDspGraphOrThrow('输出设备切换后解析 DSP 场景')
    return await this.getAudioOutputState()
  }

  async setOutputConfig(config: Partial<OutputConfig>): Promise<void> {
    const revision = ++this.outputConfigRevision
    const generation = ++this.outputConfigApplyGeneration
    this.outputConfigApplyStatus = {
      ...this.outputConfigApplyStatus,
      requestedRevision: revision,
      state: 'pending',
      error: '',
      generation
    }

    const queued = this.outputConfigApplyQueue.then(async () => {
      const serviceGeneration = this.outputConfigServiceGeneration
      const changed = await this.applyOutputConfigDirect(config)
      if (serviceGeneration !== this.outputConfigServiceGeneration) {
        throw new Error('音频服务在输出拓扑更新期间重启')
      }
      if (changed) {
        const nativeInfo = await this.readNativePlaybackInfoAsync()
        if (serviceGeneration !== this.outputConfigServiceGeneration) {
          throw new Error('音频服务在读取输出拓扑 ACK 时重启')
        }
        if (nativeInfo) {
          this.playbackInfo = this.mergeNativePlaybackInfo(nativeInfo)
          this.publishPlaybackInfo()
        }
      }
      if (generation === this.outputConfigApplyGeneration) {
        this.outputConfigApplyStatus = {
          ...this.outputConfigApplyStatus,
          appliedRevision: revision,
          state: 'applied',
          error: '',
          generation
        }
      }
    })
    this.outputConfigApplyQueue = queued.catch(() => undefined)
    try {
      await queued
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (generation === this.outputConfigApplyGeneration) {
        this.outputConfigApplyStatus = {
          ...this.outputConfigApplyStatus,
          failedRevision: revision,
          state: 'failed',
          error: message,
          generation
        }
      }
      throw error
    }
  }

  getOutputConfig(): OutputConfig {
    return { ...this.outputConfig }
  }

  getOutputConfigApplyStatus(): OutputConfigApplyStatus {
    return { ...this.outputConfigApplyStatus }
  }

  private async applyOutputConfigDirect(config: Partial<OutputConfig>): Promise<boolean> {
    const previousConfig = this.outputConfig
    const nextConfig = normalizeOutputConfig({ ...previousConfig, ...config })
    if (outputConfigsEqual(nextConfig, this.outputConfig)) return false

    const bufferSizeChanged = nextConfig.preferredBufferSize !== previousConfig.preferredBufferSize
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
      JSON.stringify(nextConfig)
    )
    if (!configSynced) {
      this.outputConfig = previousConfig
      throw new Error(`原生音频输出配置应用失败：${this.lastNativeError || '原生音频引擎不可用'}`)
    }
    this.outputConfig = nextConfig
    this.nativeOutputRouteSynced = true
    this.playbackInfo.outputInfo.channelRoutingMode = this.outputConfig.routingMode
    this.playbackInfo.channelRoutingMode = this.outputConfig.routingMode
    this.refreshOutputInfoFromNative(needsReopen)
    await this.applyNativeDspGraphOrThrow('输出配置切换后解析 DSP 场景')
    return true
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
    void this.maybeRebindAutoOutputDevice(reason)
  }

  getNativeBackendId(): string {
    if (this.output === 'wasapi' && this.exclusiveMode) return 'wasapi-exclusive'
    if (this.output === 'coreaudio' && this.exclusiveMode) return 'coreaudio-exclusive'
    return this.output
  }

  resolveCompatibleDevice(output: AudioOutputId, device: string): string {
    const normalized = normalizeAudioDevice(device)
    const options = this.getAudioDeviceOptions()
    if (output === 'asio' && normalized.startsWith('asio:')) {
      if (options.some((option) => option.id === normalized && option.backend === 'asio')) {
        return normalized
      }
      const legacyName = normalized.slice('asio:'.length)
      const matches = options.filter(
        (option) => option.backend === 'asio' && option.label === legacyName
      )
      if (matches.length === 1) return matches[0].id
      return 'auto'
    }
    return deviceCompatibleWithOutput(output, normalized, options) ? normalized : 'auto'
  }

  shouldFallbackFromAsio(output: AudioOutputId): boolean {
    return output === 'asio'
  }

  resetOutputInfoDefaults(): void {
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

  refreshOutputInfoFromNative(resetDefaults: boolean): void {
    if (resetDefaults) this.resetOutputInfoDefaults()
    const nativeInfo = this.readNativePlaybackInfo()
    if (nativeInfo) this.playbackInfo = this.mergeNativePlaybackInfo(nativeInfo)
    this.updateOutputPerfect()
    this.publishPlaybackInfo()
  }

  getAudioDeviceOptions(): AudioDeviceOption[] {
    const injectedDevices = this.deviceOptionsProvider?.()
    if (Array.isArray(injectedDevices) && injectedDevices.length > 0) {
      return normalizeAudioDeviceOptions(injectedDevices)
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
    const normalizedDevices = normalizeAudioDeviceOptions(nativeDevices)
    return normalizedDevices.length > 0 ? normalizedDevices : [{ ...DEFAULT_AUDIO_DEVICE_OPTION }]
  }

  invalidateAudioDeviceOptionsCache(reason: string): void {
    this.lastAudioDeviceOptionsCache = null
    this.emit('audio-device-options-changed', { reason })
  }

  pollAudioDeviceOptionsForChanges(): void {
    if (!this.native || this.deviceOptionsProvider) return
    const now = this.scheduler.now()
    const pollMs =
      this.device === 'auto'
        ? AUDIO_DEVICE_OPTIONS_DEFAULT_FOLLOW_POLL_MS
        : AUDIO_DEVICE_OPTIONS_HOTPLUG_POLL_MS
    if (now - this.lastAudioDeviceOptionsProbeAt < pollMs) return
    this.lastAudioDeviceOptionsProbeAt = now

    const options = this.readNativeAudioDeviceOptions()
    const signature = this.createAudioDeviceOptionsSignature(options)
    if (
      this.lastAudioDeviceOptionsSignature &&
      signature !== this.lastAudioDeviceOptionsSignature
    ) {
      this.lastAudioDeviceOptionsCache = {
        selectedDevice: this.device,
        readAt: now,
        options
      }
      this.lastAudioDeviceOptionsSignature = signature
      this.emit('audio-device-options-changed', { reason: 'audio-device-hotplug' })
      void this.maybeRebindAutoOutputDevice('audio-device-hotplug')
      return
    }
    this.lastAudioDeviceOptionsSignature = signature
    // Signature can be stable on some hosts while the default endpoint still flips; always check.
    void this.maybeRebindAutoOutputDevice('audio-device-default-follow-poll')
  }

  private resolvePhysicalDefaultDeviceId(options: AudioDeviceOption[]): string {
    const physical = options.find(
      (option) =>
        option.isDefault === true &&
        option.id &&
        option.id !== DEFAULT_AUDIO_DEVICE_OPTION.id &&
        !isDefaultAudioDeviceAlias(option.id)
    )
    return physical?.id || ''
  }

  private rememberFollowedDefaultDeviceFromOptions(
    options: AudioDeviceOption[] = this.readNativeAudioDeviceOptions()
  ): void {
    if (this.device !== 'auto') {
      this.lastFollowedDefaultDeviceId = ''
      return
    }
    const defaultId = this.resolvePhysicalDefaultDeviceId(options)
    if (defaultId) this.lastFollowedDefaultDeviceId = defaultId
  }

  private maybeRebindAutoOutputDevice(reason: string): void {
    if (this.destroyed) return
    if (this.device !== 'auto') return
    if (!this.native || !this.nativeOutputRouteSynced) return
    if (this.autoDeviceRebindInFlight) return

    // Always follow OS default while selection is `auto`. When idle, SetOutputDevice only
    // updates the preferred endpoint; when playing/paused the native path rebinds in place.
    this.autoDeviceRebindInFlight = this.rebindAutoOutputDevice(reason).finally(() => {
      this.autoDeviceRebindInFlight = null
    })
  }

  private async rebindAutoOutputDevice(reason: string): Promise<void> {
    if (this.destroyed || this.device !== 'auto' || !this.native) return

    try {
      const options = this.readNativeAudioDeviceOptions()
      const now = this.scheduler.now()
      this.lastAudioDeviceOptionsCache = {
        selectedDevice: this.device,
        readAt: now,
        options
      }
      this.lastAudioDeviceOptionsSignature = this.createAudioDeviceOptionsSignature(options)

      const defaultId = this.resolvePhysicalDefaultDeviceId(options)
      if (!defaultId) return

      // First observation only latches the current OS default; rebind only when it changes later.
      if (!this.lastFollowedDefaultDeviceId) {
        this.lastFollowedDefaultDeviceId = defaultId
        return
      }
      if (defaultId === this.lastFollowedDefaultDeviceId) return

      const previousFollowed = this.lastFollowedDefaultDeviceId
      this.lastFollowedDefaultDeviceId = defaultId
      const deviceSynced = await this.callNativeMaybeAsync(
        '跟随系统默认输出设备',
        'SetOutputDevice',
        'auto'
      )
      if (!deviceSynced) {
        this.lastFollowedDefaultDeviceId = previousFollowed
        console.warn(
          `跟随系统默认输出设备失败（${reason}）：`,
          this.lastNativeError || '原生音频引擎不可用'
        )
        return
      }
      this.refreshOutputInfoFromNative(true)
      // Re-resolve DSP only while actively playing so idle default flips stay cheap.
      if (this.playbackInfo.state === 'playing' || this.playbackInfo.state === 'paused') {
        await this.applyNativeDspGraphOrThrow('系统默认输出设备切换后解析 DSP 场景')
      }
    } catch (error) {
      console.warn(`跟随系统默认输出设备失败（${reason}）：`, error)
    }
  }

  private createAudioDeviceOptionsSignature(options: AudioDeviceOption[]): string {
    return options
      .map((device) =>
        [
          device.id,
          device.label,
          device.isDefault ? '1' : '0',
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

  createDeviceCapabilityRefreshSignature(info: PlaybackInfo): string {
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
}
