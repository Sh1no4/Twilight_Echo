import { BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { runtime } from '../core/runtime'
import { normalizeOutputConfig } from '../core/settings'
import {
  AudioEngineManager,
  normalizeAudioProcessingSettings,
  type AudioProcessingSettings,
  type AudioOutputId,
  type AudioEngineQueueItem,
  type PlayMode,
  type EqMode,
  type EqualizerBand
} from '../audioEngineManager'
import {
  persistAudioOutputState,
  persistAudioOutputConfig,
  broadcastPlayerLifecycleEvents,
  getEffectiveAudioProcessing,
  persistAndApplyAudioProcessingState
} from './state'
import {
  normalizeFiniteNumber,
  normalizeInteger,
  normalizeIpcArray,
  normalizeIpcString,
  normalizeOptionalIpcString
} from '../security/ipcValidation.ts'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'
import {
  grantUserSelectedImpulseResponse,
  resolveAuthorizedAudioSource,
  resolveAuthorizedImpulseResponseFile
} from '../security/localPaths.ts'

const MAX_AUDIO_QUEUE_ITEMS = 1000
const MAX_AUDIO_SOURCE_LENGTH = 8192
const MAX_AUDIO_DEVICE_LENGTH = 512

export function requireAudioEngine(): AudioEngineManager {
  if (!runtime.audioEngineManager) throw new Error('原生音频引擎尚未初始化')
  return runtime.audioEngineManager
}

export function toQueueItem(raw: unknown): AudioEngineQueueItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const source =
    typeof item.source === 'string'
      ? item.source
      : typeof item.audioSource === 'string'
        ? item.audioSource
        : typeof item.playUrl === 'string'
          ? item.playUrl
          : typeof item.filePath === 'string'
            ? item.filePath
            : typeof item.streamUrl === 'string'
              ? item.streamUrl
              : ''
  if (!source) return null
  let normalizedSource: string
  try {
    normalizedSource = normalizeIpcString(source, 'queue item source', MAX_AUDIO_SOURCE_LENGTH)
  } catch {
    return null
  }
  return {
    id: normalizeQueueText(item.id, normalizedSource) ?? normalizedSource,
    source: normalizedSource,
    title: normalizeQueueText(item.title),
    artist: normalizeQueueText(item.artist),
    album: normalizeQueueText(item.album),
    duration: Number.isFinite(item.duration) ? Number(item.duration) : undefined,
    codec: typeof item.format === 'string' ? item.format : undefined,
    sampleRate: Number.isFinite(item.sampleRate) ? Number(item.sampleRate) : undefined,
    bitrate: Number.isFinite(item.bitrate) ? Number(item.bitrate) : undefined,
    bitDepth: Number.isFinite(item.bitDepth) ? Number(item.bitDepth) : undefined
  }
}

async function authorizeAudioProcessingSettings(
  settings: Partial<AudioProcessingSettings>
): Promise<AudioProcessingSettings> {
  const normalized = normalizeAudioProcessingSettings(settings)
  if (normalized.convolverIrPath) {
    normalized.convolverIrPath = await resolveAuthorizedImpulseResponseFile(
      normalized.convolverIrPath
    )
  }
  return normalized
}

function normalizeQueueText(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string') return fallback
  const normalized = value
    .replace(/[\0\r\n]/g, ' ')
    .trim()
    .slice(0, 512)
  return normalized || fallback
}

export async function setupAudioEngineIpc(): Promise<void> {
  let initialAudioProcessing = getEffectiveAudioProcessing()
  try {
    initialAudioProcessing = await authorizeAudioProcessingSettings(initialAudioProcessing)
  } catch (error) {
    console.warn('Configured impulse response is unavailable or unauthorized:', error)
    initialAudioProcessing = normalizeAudioProcessingSettings({
      ...initialAudioProcessing,
      convolverEnabled: false,
      convolverIrPath: ''
    })
  }
  runtime.audioEngineManager = new AudioEngineManager(
    {
      exclusiveMode: runtime.appSettings.audioExclusiveMode,
      audioOutput: runtime.appSettings.audioOutput,
      audioDevice: runtime.appSettings.audioDevice,
      audioOutputConfig: runtime.appSettings.audioOutputConfig,
      audioProcessing: initialAudioProcessing
    },
    {
      audioServiceEntry: join(__dirname, 'audioEngineService.js')
    }
  )

  runtime.audioEngineManager.on('property-change', ({ name, data }) => {
    runtime.mainWindow?.webContents.send('audioEngine:property-change', { name, data })
    void runtime.pluginManager?.broadcastEvent(`audioEngine:${name}`, data)
  })

  runtime.audioEngineManager.on('end-file', ({ reason }) => {
    runtime.mainWindow?.webContents.send('audioEngine:end-file', { reason })
    void runtime.pluginManager?.broadcastEvent('audioEngine:end-file', { reason })
  })

  runtime.audioEngineManager.on('start-file', () => {
    runtime.mainWindow?.webContents.send('audioEngine:start-file')
    void runtime.pluginManager?.broadcastEvent('audioEngine:start-file', null)
  })

  runtime.audioEngineManager.on('queue-change', (queue) => {
    void runtime.pluginManager?.broadcastEvent('player:queue-change', { queue })
  })

  runtime.audioEngineManager.on('error', (err: Error) => {
    console.error('[音频引擎]', err.message)
    runtime.mainWindow?.webContents.send('audioEngine:error', err.message)
  })

  runtime.audioEngineManager.on('audio-service-crash', ({ reason }) => {
    console.error('[音频服务]', reason)
    runtime.mainWindow?.webContents.send('audioEngine:service-crash', { reason })
    runtime.mainWindow?.webContents.send('audioEngine:error', `音频服务已重启：${reason}`)
    void runtime.pluginManager?.handleNativeDspHostCrash(reason)
  })

  runtime.audioEngineManager.on('audio-service-ready', (event) => {
    runtime.mainWindow?.webContents.send('audioEngine:service-ready', event)
    void runtime.pluginManager?.broadcastEvent('audioEngine:service-ready', event)
  })

  runtime.audioEngineManager.on('audio-device-options-changed', ({ reason }) => {
    runtime.mainWindow?.webContents.send('audioEngine:device-options-changed', { reason })
  })

  runtime.audioEngineManager.on('ready', () => {
    runtime.mainWindow?.webContents.send('audioEngine:ready')
    void runtime.pluginManager?.broadcastEvent('audioEngine:ready', null)
  })

  runtime.audioEngineManager.on('playback-info', (info) => {
    runtime.mainWindow?.webContents.send('audioEngine:playback-info', info)
    void runtime.pluginManager?.broadcastEvent('player:playback-info', info)
    broadcastPlayerLifecycleEvents(info)
  })

  ipcMain.handle('audioEngine:loadQueue', async (_event, items: unknown, startIndex?: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    if (!Array.isArray(items) || items.length > MAX_AUDIO_QUEUE_ITEMS) {
      throw new Error('Audio queue is invalid or too large')
    }
    const queue = normalizeIpcArray(items, 'audio queue', MAX_AUDIO_QUEUE_ITEMS, toQueueItem)
    if (queue.length !== items.length) {
      throw new Error('Audio queue contains an invalid item')
    }
    const authorizedQueue = await Promise.all(
      queue.map(async (item) => ({
        ...item,
        source: await resolveAuthorizedAudioSource(item.source)
      }))
    )
    const normalizedStartIndex = normalizeInteger(
      startIndex,
      'queue start index',
      0,
      0,
      Math.max(0, authorizedQueue.length - 1)
    )
    await requireAudioEngine().loadQueue(authorizedQueue, normalizedStartIndex)
  })

  ipcMain.handle('audioEngine:play', async (_event, source: string, startTime?: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    return await requireAudioEngine().play(
      await resolveAuthorizedAudioSource(
        normalizeIpcString(source, 'audio source', MAX_AUDIO_SOURCE_LENGTH)
      ),
      normalizeFiniteNumber(startTime, 'start time', 0, 0, Number.MAX_SAFE_INTEGER)
    )
  })

  ipcMain.handle('audioEngine:togglePause', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    await requireAudioEngine().togglePause()
  })

  ipcMain.handle('audioEngine:seek', async (_event, time: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    await requireAudioEngine().seek(
      normalizeFiniteNumber(time, 'seek time', 0, 0, Number.MAX_SAFE_INTEGER)
    )
  })

  ipcMain.handle('audioEngine:setVolume', async (_event, volume: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    await requireAudioEngine().setVolume(normalizeFiniteNumber(volume, 'volume', 1, 0, 1))
  })

  ipcMain.handle('audioEngine:stop', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    await requireAudioEngine().stop()
  })

  ipcMain.handle('audioEngine:next', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    await requireAudioEngine().next()
  })

  ipcMain.handle('audioEngine:previous', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    await requireAudioEngine().previous()
  })

  ipcMain.handle('audioEngine:setPlayMode', async (_event, mode: PlayMode) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    await requireAudioEngine().setPlayMode(
      mode === 'repeat' || mode === 'shuffle' ? mode : 'sequential'
    )
  })

  ipcMain.handle('audioEngine:getUpcomingTrack', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return requireAudioEngine().getUpcomingTrack()
  })

  ipcMain.handle('audioEngine:setExclusiveMode', async (_event, enabled: boolean) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const state = await requireAudioEngine().setExclusiveMode(enabled === true)
    persistAudioOutputState(state)
    return state
  })

  ipcMain.handle('audioEngine:getExclusiveMode', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return await requireAudioEngine().getExclusiveMode()
  })

  ipcMain.handle('audioEngine:setAudioOutput', async (_event, output: string, device?: string) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const state = await requireAudioEngine().setAudioOutput(
      normalizeIpcString(output, 'audio output', 64) as AudioOutputId,
      normalizeOptionalIpcString(device, 'audio device', MAX_AUDIO_DEVICE_LENGTH)
    )
    persistAudioOutputState(state)
    return state
  })

  ipcMain.handle('audioEngine:setAudioDevice', async (_event, device: string) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const state = await requireAudioEngine().setAudioDevice(
      normalizeIpcString(device, 'audio device', MAX_AUDIO_DEVICE_LENGTH)
    )
    persistAudioOutputState(state)
    return state
  })

  ipcMain.handle('audioEngine:setOutputConfig', async (_event, config: unknown) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const normalized = normalizeOutputConfig(config)
    await requireAudioEngine().setOutputConfig(normalized)
    persistAudioOutputConfig(normalized)
    return normalized
  })

  ipcMain.handle('audioEngine:getAudioOutput', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return await requireAudioEngine().getAudioOutput()
  })

  ipcMain.handle('audioEngine:getAudioOutputOptions', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return requireAudioEngine().getAudioOutputOptions()
  })

  ipcMain.handle('audioEngine:getAudioOutputState', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return await requireAudioEngine().getAudioOutputState()
  })

  ipcMain.handle(
    'audioEngine:setAudioProcessing',
    async (_event, settings: Partial<AudioProcessingSettings>) => {
      assertTrustedIpcSender(_event, 'audio engine IPC')
      const normalized = await authorizeAudioProcessingSettings({
        ...runtime.appSettings.audioProcessing,
        ...settings
      })
      await persistAndApplyAudioProcessingState(normalized)
      return runtime.appSettings.audioProcessing
    }
  )

  ipcMain.handle('audioEngine:getAudioProcessing', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return runtime.appSettings.audioProcessing
  })

  ipcMain.handle('audioEngine:selectImpulseResponse', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const options: Electron.OpenDialogOptions = {
      title: '选择卷积脉冲响应',
      properties: ['openFile'],
      filters: [
        { name: 'Impulse Response', extensions: ['wav', 'flac', 'aiff', 'aif'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return await grantUserSelectedImpulseResponse(result.filePaths[0])
  })

  ipcMain.handle('audioEngine:loadImpulseResponse', async (_event, path: string) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const convolverIrPath = await resolveAuthorizedImpulseResponseFile(
      normalizeIpcString(path, 'impulse response path', MAX_AUDIO_SOURCE_LENGTH)
    )
    const normalized = await authorizeAudioProcessingSettings({
      ...runtime.appSettings.audioProcessing,
      dspEnabled: true,
      convolverEnabled: true,
      convolverIrPath
    })
    await persistAndApplyAudioProcessingState(normalized)
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle('audioEngine:unloadImpulseResponse', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    const normalized = normalizeAudioProcessingSettings({
      ...runtime.appSettings.audioProcessing,
      convolverEnabled: false,
      convolverIrPath: ''
    })
    await persistAndApplyAudioProcessingState(normalized)
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle('audioEngine:getConvolverInfo', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle(
    'audioEngine:setEqBands',
    async (_event, settings: Partial<AudioProcessingSettings>) => {
      assertTrustedIpcSender(_event, 'audio engine IPC')
      const normalized = await authorizeAudioProcessingSettings({
        ...runtime.appSettings.audioProcessing,
        ...settings,
        dspEnabled: true,
        eqEnabled: true
      })
      await persistAndApplyAudioProcessingState(normalized)
      return runtime.appSettings.audioProcessing
    }
  )

  ipcMain.handle(
    'audioEngine:setEqPreset',
    async (
      _event,
      preset: {
        eqMode: EqMode
        eqPreamp: number
        eqBands: EqualizerBand[]
      }
    ) => {
      assertTrustedIpcSender(_event, 'audio engine IPC')
      const normalized = await authorizeAudioProcessingSettings({
        ...runtime.appSettings.audioProcessing,
        ...preset,
        dspEnabled: true,
        eqEnabled: true
      })
      await persistAndApplyAudioProcessingState(normalized)
      return runtime.appSettings.audioProcessing
    }
  )

  ipcMain.handle('audioEngine:setCrossfeedStrength', async (_event, strength: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    const normalizedStrength = normalizeFiniteNumber(strength, 'crossfeed strength', 0, 0, 1)
    const normalized = await authorizeAudioProcessingSettings({
      ...runtime.appSettings.audioProcessing,
      dspEnabled: true,
      crossfeedEnabled: normalizedStrength > 0,
      crossfeedStrength: normalizedStrength
    })
    await persistAndApplyAudioProcessingState(normalized)
    return runtime.appSettings.audioProcessing
  })

  ipcMain.handle(
    'audioEngine:setReplayGainMode',
    async (
      _event,
      mode: AudioProcessingSettings['volumeNormalization'],
      preamp?: number,
      fallback?: number,
      clip?: boolean
    ) => {
      assertTrustedIpcSender(_event, 'audio engine IPC')
      const normalized = await authorizeAudioProcessingSettings({
        ...runtime.appSettings.audioProcessing,
        dspEnabled: true,
        volumeNormalization: mode,
        replayGainPreamp: preamp ?? runtime.appSettings.audioProcessing.replayGainPreamp,
        replayGainFallback: fallback ?? runtime.appSettings.audioProcessing.replayGainFallback,
        replayGainClip: clip ?? runtime.appSettings.audioProcessing.replayGainClip
      })
      await persistAndApplyAudioProcessingState(normalized)
      return runtime.appSettings.audioProcessing
    }
  )

  ipcMain.handle('audioEngine:getMetadata', async (_event, source: string) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    return await requireAudioEngine().getMetadataAsync(
      await resolveAuthorizedAudioSource(
        normalizeIpcString(source, 'metadata source', MAX_AUDIO_SOURCE_LENGTH)
      )
    )
  })

  ipcMain.handle('audioEngine:getPlaybackInfo', async (event) => {
    assertTrustedIpcSender(event, 'audio engine IPC')
    return await requireAudioEngine().getPlaybackInfo()
  })

  ipcMain.handle('audioEngine:getSpectrumData', async (_event, points?: number) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    return requireAudioEngine().getSpectrumData(
      normalizeInteger(points, 'spectrum points', 128, 8, 4096)
    )
  })

  ipcMain.handle('audioEngine:getVisualizationData', async (_event, options?: unknown) => {
    assertTrustedIpcSender(_event, 'audio engine IPC')
    return requireAudioEngine().getVisualizationData(
      typeof options === 'object' && options !== null ? options : {}
    )
  })

  runtime.audioEngineManager
    .start()
    .then(() => {
      console.log('原生音频引擎已启动')
    })
    .catch((err: Error) => {
      console.error('原生音频引擎启动失败：', err.message)
    })
}
