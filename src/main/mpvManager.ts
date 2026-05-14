/* eslint-disable no-control-regex */
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import * as net from 'net'
import type { Socket } from 'net'
import { EventEmitter } from 'events'
import { join } from 'path'
import { app } from 'electron'
import { existsSync, mkdirSync, unlinkSync } from 'fs'

export type AudioOutputId = 'wasapi' | 'asio' | 'coreaudio' | 'alsa'
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

export interface MpvConfig {
  exclusiveMode: boolean
  audioOutput?: AudioOutputId
  audioDevice?: string
  sampleRate?: number | 'auto'
  cacheDir?: string
  audioProcessing?: Partial<AudioProcessingSettings>
}

interface MpvRequest {
  command: unknown[]
  request_id: number
}

interface MpvResponse {
  error: string
  request_id?: number
  data?: unknown
  event?: string
  name?: string
  reason?: string
}

const AUDIO_OUTPUT_OPTIONS: AudioOutputOption[] = [
  {
    id: 'wasapi',
    label: 'WASAPI',
    description: 'Windows native low-latency output with mpv exclusive mode support.',
    platform: 'win32',
    supportsExclusive: true
  },
  {
    id: 'asio',
    label: 'ASIO',
    description: 'Professional Windows driver output. Device control is handled by the ASIO driver.',
    platform: 'win32',
    supportsExclusive: false
  },
  {
    id: 'coreaudio',
    label: 'CoreAudio',
    description: 'macOS native audio output with exclusive/hog mode when supported by mpv.',
    platform: 'darwin',
    supportsExclusive: true
  },
  {
    id: 'alsa',
    label: 'ALSA',
    description: 'Linux native audio output. Exclusive access depends on the device/plugin setup.',
    platform: 'linux',
    supportsExclusive: false
  }
]

const DEFAULT_EQ_BANDS: EqualizerBand[] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(
  (frequency) => ({
    frequency,
    gain: 0,
    q: 1,
    filterType: 'peak'
  })
)

export const DEFAULT_AUDIO_PROCESSING: AudioProcessingSettings = {
  highResolution: true,
  dsdToPcm: true,
  eqEnabled: false,
  eqMode: 'graphic',
  eqPreamp: 0,
  eqBands: DEFAULT_EQ_BANDS,
  volumeNormalization: 'track',
  replayGainPreamp: 0,
  replayGainFallback: 0,
  replayGainClip: true,
  gapless: true,
  crossfadeSeconds: 0
}

let compiledAudioOutputs: Set<string> | null | undefined

export function getAudioOutputOptions(platform: NodeJS.Platform = process.platform): AudioOutputOption[] {
  const platformOptions = AUDIO_OUTPUT_OPTIONS.filter((option) => option.platform === platform)
  if (platform !== process.platform) return platformOptions

  const compiledOutputs = getCompiledAudioOutputs()
  if (!compiledOutputs) return platformOptions

  const filteredOptions = platformOptions.filter((option) => compiledOutputs.has(option.id))
  return filteredOptions.length > 0 ? filteredOptions : platformOptions
}

export function getDefaultAudioOutput(platform: NodeJS.Platform = process.platform): AudioOutputId {
  const firstOption = getAudioOutputOptions(platform)[0]
  return firstOption?.id ?? 'alsa'
}

function normalizeAudioOutput(
  output: AudioOutputId | undefined,
  platform: NodeJS.Platform = process.platform
): AudioOutputId {
  const options = getAudioOutputOptions(platform)
  if (output && options.some((option) => option.id === output)) return output
  return getDefaultAudioOutput(platform)
}

function getAudioOutputOption(output: AudioOutputId): AudioOutputOption {
  return (
    AUDIO_OUTPUT_OPTIONS.find((option) => option.id === output) ??
    AUDIO_OUTPUT_OPTIONS.find((option) => option.id === getDefaultAudioOutput())!
  )
}

function supportsAudioExclusive(output: AudioOutputId): boolean {
  return getAudioOutputOption(output).supportsExclusive
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
    settings?.volumeNormalization === 'album' ||
    settings?.volumeNormalization === 'loudnorm' ||
    settings?.volumeNormalization === 'off'
      ? settings.volumeNormalization
      : 'track'

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

function getCompiledAudioOutputs(): Set<string> | null {
  if (compiledAudioOutputs !== undefined) return compiledAudioOutputs

  try {
    const result = spawnSync(findMpv(), ['--ao=help'], {
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true
    })
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    const supported = new Set<string>()

    for (const option of AUDIO_OUTPUT_OPTIONS) {
      const pattern = new RegExp(`(^|\\s)${option.id}(\\s|$)`, 'm')
      if (pattern.test(output)) {
        supported.add(option.id)
      }
    }

    compiledAudioOutputs = supported.size > 0 ? supported : null
  } catch {
    compiledAudioOutputs = null
  }

  return compiledAudioOutputs
}

function findMpv(): string {
  const binaryName = process.platform === 'win32' ? 'mpv.exe' : 'mpv'
  const bundledCandidates = [
    join(process.resourcesPath ?? '', 'mpv', binaryName),
    join(app.getAppPath(), 'resources', 'mpv', binaryName)
  ]

  for (const candidate of bundledCandidates) {
    if (existsSync(candidate)) return candidate
  }

  return 'mpv'
}

function isDsdFile(filePath?: string): boolean {
  if (!filePath) return false
  return /\.(dsf|dff)$/i.test(filePath)
}

function formatFilterNumber(value: number): string {
  return Number(value.toFixed(3)).toString()
}

function buildEqualizerBandFilter(band: EqualizerBand): string | null {
  const frequency = formatFilterNumber(band.frequency)
  const q = formatFilterNumber(band.q)
  const gain = formatFilterNumber(band.gain)

  switch (band.filterType) {
    case 'lowShelf':
      if (Math.abs(band.gain) < 0.05) return null
      return `bass=f=${frequency}:width_type=q:width=${q}:g=${gain}`
    case 'highShelf':
      if (Math.abs(band.gain) < 0.05) return null
      return `treble=f=${frequency}:width_type=q:width=${q}:g=${gain}`
    case 'bandPass':
      return `bandpass=f=${frequency}:width_type=q:width=${q}`
    case 'lowPass':
      return `lowpass=f=${frequency}:width_type=q:width=${q}`
    case 'highPass':
      return `highpass=f=${frequency}:width_type=q:width=${q}`
    case 'allPass':
      return `allpass=f=${frequency}:width_type=q:width=${q}`
    case 'peak':
    default:
      if (Math.abs(band.gain) < 0.05) return null
      return `equalizer=f=${frequency}:width_type=q:width=${q}:g=${gain}`
  }
}

function buildAudioFilter(settings: AudioProcessingSettings): string {
  const lavfiFilters: string[] = []

  if (settings.eqEnabled) {
    if (Math.abs(settings.eqPreamp) > 0.01) {
      lavfiFilters.push(`volume=${formatFilterNumber(settings.eqPreamp)}dB`)
    }

    for (const band of settings.eqBands) {
      const filter = buildEqualizerBandFilter(band)
      if (filter) lavfiFilters.push(filter)
    }
  }

  if (settings.volumeNormalization === 'loudnorm') {
    lavfiFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11')
  }

  return lavfiFilters.length > 0 ? `lavfi=[${lavfiFilters.join(',')}]` : ''
}

function getReplayGainMode(settings: AudioProcessingSettings): 'no' | 'track' | 'album' {
  if (settings.volumeNormalization === 'track' || settings.volumeNormalization === 'album') {
    return settings.volumeNormalization
  }
  return 'no'
}

export class MpvManager extends EventEmitter {
  private process: ChildProcess | null = null
  private socket: Socket | null = null
  private requestId = 0
  private pendingRequests = new Map<number, (response: MpvResponse) => void>()
  private buffer = ''
  private pipeName: string
  private config: MpvConfig
  private destroyed = false

  constructor(config: MpvConfig = { exclusiveMode: true }) {
    super()
    const audioOutput = normalizeAudioOutput(config.audioOutput)
    this.config = {
      ...config,
      audioOutput,
      exclusiveMode: config.exclusiveMode && supportsAudioExclusive(audioOutput),
      audioProcessing: normalizeAudioProcessingSettings(config.audioProcessing)
    }
    this.pipeName =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\mpv-te-${process.pid}`
        : join(app.getPath('temp'), `mpv-te-${process.pid}.sock`)
  }

  private printBanner(mpvPath: string): void {
    const audioOutput = normalizeAudioOutput(this.config.audioOutput)
    const outputOption = getAudioOutputOption(audioOutput)
    const processing = normalizeAudioProcessingSettings(this.config.audioProcessing)
    const samplingInfo =
      this.config.sampleRate && this.config.sampleRate !== 'auto'
        ? `fixed ${this.config.sampleRate} Hz`
        : 'auto source rate'
    const exclusiveInfo = supportsAudioExclusive(audioOutput)
      ? this.config.exclusiveMode
        ? 'enabled'
        : 'disabled'
      : 'not supported by output'
    const dspInfo = [
      processing.highResolution ? 'Hi-Res' : null,
      processing.dsdToPcm ? 'DSD->PCM' : null,
      processing.eqEnabled ? 'EQ' : null,
      processing.volumeNormalization !== 'off' ? processing.volumeNormalization : null,
      processing.gapless ? 'gapless' : null,
      processing.crossfadeSeconds > 0 ? `crossfade ${processing.crossfadeSeconds}s` : null
    ]
      .filter(Boolean)
      .join(' / ')

    console.log('')
    console.log('[mpv] Twilight Echo audio engine')
    console.log(`[mpv] binary: ${mpvPath}`)
    console.log(`[mpv] output: ${outputOption.label}`)
    console.log(`[mpv] exclusive: ${exclusiveInfo}`)
    console.log(`[mpv] sample-rate: ${samplingInfo}`)
    console.log(`[mpv] dsp: ${dspInfo || 'off'}`)
    console.log('')
  }

  async start(): Promise<void> {
    const mpvPath = findMpv()
    this.printBanner(mpvPath)
    if (process.platform !== 'win32' && existsSync(this.pipeName)) {
      unlinkSync(this.pipeName)
    }

    const audioOutput = normalizeAudioOutput(this.config.audioOutput)
    const processing = normalizeAudioProcessingSettings(this.config.audioProcessing)

    const args = [
      '--idle=yes',
      `--input-ipc-server=${this.pipeName}`,
      `--ao=${audioOutput}`,
      '--config=no',
      '--no-video',
      '--no-terminal',
      '--volume=70',
      '--volume-max=100',
      `--gapless-audio=${processing.gapless ? 'yes' : 'no'}`,
      '--audio-channels=auto',
      '--keep-open=yes',
      '--msg-level=all=status'
    ]

    if (this.config.exclusiveMode && supportsAudioExclusive(audioOutput)) {
      args.push('--audio-exclusive=yes')
    }

    if (this.config.audioDevice) {
      args.push(`--audio-device=${audioOutput}/${this.config.audioDevice}`)
    }

    if (this.config.sampleRate && this.config.sampleRate !== 'auto') {
      args.push(`--audio-samplerate=${this.config.sampleRate}`)
    }

    if (this.config.cacheDir) {
      mkdirSync(this.config.cacheDir, { recursive: true })
      args.push('--cache=yes', '--cache-on-disk=yes', `--demuxer-cache-dir=${this.config.cacheDir}`)
    }

    this.process = spawn(mpvPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8').trim()
      if (text) {
        console.log('[mpv stderr]', text)
        if (text.includes('error') || text.includes('Error') || text.includes('fail')) {
          this.emit('error', new Error(text))
        }
      }
    })

    this.process.on('error', (err) => {
      this.emit('error', new Error(`Unable to start mpv: ${err.message}`))
    })

    this.process.on('exit', (code) => {
      this.socket?.destroy()
      this.socket = null
      if (!this.destroyed && code !== 0) {
        this.emit('error', new Error(`mpv exited unexpectedly (code=${code})`))
      }
    })

    await this.connectToPipe(15, 400)
    this.emit('ready')
  }

  private connectToPipe(retries: number, delay: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0

      const tryConnect = (): void => {
        attempts++

        const sock = net.createConnection(this.pipeName, async () => {
          this.socket = sock
          this.setupSocket()
          await this.observeProperties()
          await this.applyAudioProcessing()
          resolve()
        })

        sock.on('error', () => {
          sock.removeAllListeners()
          if (this.destroyed) {
            reject(new Error('Manager destroyed'))
            return
          }
          if (attempts < retries) {
            setTimeout(tryConnect, delay)
          } else {
            reject(new Error('Unable to connect to mpv IPC'))
          }
        })
      }

      setTimeout(tryConnect, 600)
    })
  }

  private setupSocket(): void {
    if (!this.socket) return

    this.socket.on('data', (data: Buffer) => {
      this.buffer += data.toString('utf-8')

      let newlineIndex: number
      while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.substring(0, newlineIndex).trim()
        this.buffer = this.buffer.substring(newlineIndex + 1)

        if (!line) continue

        try {
          const msg: MpvResponse = JSON.parse(line)
          this.handleMessage(msg)
        } catch {
          // Ignore malformed IPC packets.
        }
      }
    })

    this.socket.on('error', (err) => {
      if (!this.destroyed) {
        this.emit('error', err)
      }
    })

    this.socket.on('close', () => {
      this.socket = null
      if (!this.destroyed) {
        this.emit('disconnected')
      }
    })
  }

  private handleMessage(msg: MpvResponse): void {
    if (msg.request_id !== undefined && this.pendingRequests.has(msg.request_id)) {
      const resolve = this.pendingRequests.get(msg.request_id)!
      this.pendingRequests.delete(msg.request_id)
      if (msg.error !== 'success') {
        console.error('[mpv cmd error]', JSON.stringify(msg))
      }
      resolve(msg)
      return
    }

    if (msg.event === 'property-change') {
      this.emit('property-change', { name: msg.name, data: msg.data })
      return
    }

    if (msg.event === 'end-file') {
      this.emit('end-file', { reason: msg.reason || 'unknown' })
      return
    }

    if (msg.event === 'start-file') {
      this.emit('start-file')
    }
  }

  private sendCommand(command: unknown[]): Promise<MpvResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('mpv is not connected'))
        return
      }

      const requestId = ++this.requestId
      const request: MpvRequest = {
        command,
        request_id: requestId
      }

      this.pendingRequests.set(requestId, resolve)
      this.socket.write(JSON.stringify(request) + '\n')
    })
  }

  private async sendBestEffort(command: unknown[], label: string): Promise<void> {
    try {
      const resp = await this.sendCommand(command)
      if (resp.error !== 'success') {
        console.warn(`[mpv] ${label} failed: ${resp.error}`)
      }
    } catch (err) {
      console.warn(`[mpv] ${label} failed:`, err)
    }
  }

  private async observeProperties(): Promise<void> {
    const props: [number, string][] = [
      [1, 'time-pos'],
      [2, 'duration'],
      [3, 'pause'],
      [4, 'volume']
    ]

    for (const [id, prop] of props) {
      try {
        const resp = await this.sendCommand(['observe_property', id, prop])
        if (resp.error !== 'success') {
          console.error(`[mpv] Failed to observe ${prop}:`, resp.error)
        }
      } catch (err) {
        console.error(`[mpv] Failed to observe ${prop}:`, err)
      }
    }
  }

  private async applyAudioProcessing(filePath?: string): Promise<void> {
    const settings = normalizeAudioProcessingSettings(this.config.audioProcessing)
    const filter = buildAudioFilter(settings)
    const replayGain = getReplayGainMode(settings)
    const forcePcm = settings.highResolution || (settings.dsdToPcm && isDsdFile(filePath))

    await this.sendBestEffort(['set_property', 'gapless-audio', settings.gapless ? 'yes' : 'no'], 'set gapless')
    await this.sendBestEffort(['set_property', 'replaygain', replayGain], 'set ReplayGain')
    await this.sendBestEffort(['set_property', 'replaygain-preamp', settings.replayGainPreamp], 'set ReplayGain preamp')
    await this.sendBestEffort(
      ['set_property', 'replaygain-fallback', settings.replayGainFallback],
      'set ReplayGain fallback'
    )
    await this.sendBestEffort(['set_property', 'replaygain-clip', settings.replayGainClip ? 'yes' : 'no'], 'set ReplayGain clip')
    await this.sendBestEffort(['set_property', 'audio-format', forcePcm ? 's32' : 'auto'], 'set PCM output format')
    await this.sendBestEffort(['set_property', 'af', filter], 'set audio filters')
  }

  async play(filePath: string): Promise<void> {
    console.log('[mpv] loadfile:', filePath)
    await this.applyAudioProcessing(filePath)
    const resp = await this.sendCommand(['loadfile', filePath, 'replace'])
    if (resp.error !== 'success') {
      throw new Error(`mpv loadfile failed: ${resp.error}`)
    }
    await this.sendCommand(['set_property', 'pause', false])
  }

  async togglePause(): Promise<void> {
    await this.sendCommand(['cycle', 'pause'])
  }

  async seek(time: number): Promise<void> {
    await this.sendCommand(['seek', time, 'absolute'])
  }

  async setVolume(volume: number): Promise<void> {
    await this.sendCommand(['set_property', 'volume', Math.round(volume * 100)])
  }

  async stop(): Promise<void> {
    try {
      await this.sendCommand(['stop'])
    } catch {
      // Ignore if mpv is not connected.
    }
  }

  async getProperty(name: string): Promise<unknown> {
    const response = await this.sendCommand(['get_property', name])
    return response.data
  }

  async setExclusiveMode(enabled: boolean): Promise<void> {
    const audioOutput = normalizeAudioOutput(this.config.audioOutput)
    if (enabled && !supportsAudioExclusive(audioOutput)) {
      throw new Error(`${getAudioOutputOption(audioOutput).label} does not support mpv exclusive mode`)
    }
    this.config.exclusiveMode = enabled
    await this.sendCommand(['set_property', 'audio-exclusive', enabled ? 'yes' : 'no'])
  }

  async getExclusiveMode(): Promise<boolean> {
    return this.config.exclusiveMode
  }

  async setAudioOutput(output: AudioOutputId): Promise<void> {
    const nextOutput = normalizeAudioOutput(output)
    this.config.audioOutput = nextOutput

    if (!supportsAudioExclusive(nextOutput)) {
      this.config.exclusiveMode = false
    }

    const outputResp = await this.sendCommand(['set_property', 'ao', nextOutput])
    if (outputResp.error !== 'success') {
      throw new Error(`${getAudioOutputOption(nextOutput).label} output is unavailable: ${outputResp.error}`)
    }

    if (supportsAudioExclusive(nextOutput)) {
      const exclusiveResp = await this.sendCommand([
        'set_property',
        'audio-exclusive',
        this.config.exclusiveMode ? 'yes' : 'no'
      ])
      if (exclusiveResp.error !== 'success') {
        throw new Error(`Unable to set exclusive mode: ${exclusiveResp.error}`)
      }
    }
  }

  async getAudioOutput(): Promise<AudioOutputId> {
    return normalizeAudioOutput(this.config.audioOutput)
  }

  getAudioOutputOptions(): AudioOutputOption[] {
    return getAudioOutputOptions()
  }

  async setAudioProcessing(settings: Partial<AudioProcessingSettings>): Promise<AudioProcessingSettings> {
    const normalized = normalizeAudioProcessingSettings(settings)
    this.config.audioProcessing = normalized
    if (this.socket && !this.socket.destroyed) {
      await this.applyAudioProcessing()
    }
    return normalized
  }

  getAudioProcessing(): AudioProcessingSettings {
    return normalizeAudioProcessingSettings(this.config.audioProcessing)
  }

  destroy(): void {
    this.destroyed = true
    if (this.socket) {
      try {
        this.socket.write(JSON.stringify({ command: ['quit'], request_id: 0 }) + '\n')
      } catch {
        // Ignore shutdown write errors.
      }
      this.socket.destroy()
      this.socket = null
    }
    if (this.process && !this.process.killed) {
      this.process.kill()
      this.process = null
    }
  }
}
