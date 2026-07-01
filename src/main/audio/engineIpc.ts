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
  return {
    id: typeof item.id === 'string' ? item.id : source,
    source,
    title: typeof item.title === 'string' ? item.title : undefined,
    artist: typeof item.artist === 'string' ? item.artist : undefined,
    album: typeof item.album === 'string' ? item.album : undefined,
    duration: typeof item.duration === 'number' ? item.duration : undefined,
    codec: typeof item.format === 'string' ? item.format : undefined,
    sampleRate: typeof item.sampleRate === 'number' ? item.sampleRate : undefined,
    bitrate: typeof item.bitrate === 'number' ? item.bitrate : undefined,
    bitDepth: typeof item.bitDepth === 'number' ? item.bitDepth : undefined
  }
}


export function setupAudioEngineIpc(): void {
  runtime.audioEngineManager = new AudioEngineManager({
    exclusiveMode: runtime.appSettings.audioExclusiveMode,
    audioOutput: runtime.appSettings.audioOutput,
    audioDevice: runtime.appSettings.audioDevice,
    audioOutputConfig: runtime.appSettings.audioOutputConfig,
    audioProcessing: getEffectiveAudioProcessing()
  }, {
    audioServiceEntry: join(__dirname, 'audioEngineService.js')
  })

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
    runtime.mainWindow?.webContents.send('audioEngine:error', `音频服务已重启：${reason}`)
    void runtime.pluginManager?.handleNativeDspHostCrash(reason)
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

  ipcMain.handle('audioEngine:loadQueue', async (_event, items: unknown[], startIndex?: number) => {
    const queue = Array.isArray(items)
      ? items.map(toQueueItem).filter((item): item is AudioEngineQueueItem => Boolean(item))
      : []
    await requireAudioEngine().loadQueue(queue, Number(startIndex) || 0)
  })

  ipcMain.handle('audioEngine:play', async (_event, source: string, startTime?: number) => {
    return await requireAudioEngine().play(source, startTime)
  })

  ipcMain.handle('audioEngine:togglePause', async () => {
    await requireAudioEngine().togglePause()
  })

  ipcMain.handle('audioEngine:seek', async (_event, time: number) => {
    await requireAudioEngine().seek(time)
  })

  ipcMain.handle('audioEngine:setVolume', async (_event, volume: number) => {
    await requireAudioEngine().setVolume(volume)
  })

  ipcMain.handle('audioEngine:stop', async () => {
    await requireAudioEngine().stop()
  })

  ipcMain.handle('audioEngine:next', async () => {
    await requireAudioEngine().next()
  })

  ipcMain.handle('audioEngine:previous', async () => {
    await requireAudioEngine().previous()
  })

  ipcMain.handle('audioEngine:setPlayMode', async (_event, mode: PlayMode) => {
    await requireAudioEngine().setPlayMode(mode)
  })

  ipcMain.handle('audioEngine:getUpcomingTrack', async () => {
    return requireAudioEngine().getUpcomingTrack()
  })

  ipcMain.handle('audioEngine:setExclusiveMode', async (_event, enabled: boolean) => {
    const state = await requireAudioEngine().setExclusiveMode(enabled)
    persistAudioOutputState(state)
    return state
  })

  ipcMain.handle('audioEngine:getExclusiveMode', async () => {
    return await requireAudioEngine().getExclusiveMode()
  })

  ipcMain.handle('audioEngine:setAudioOutput', async (_event, output: string, device?: string) => {
    const state = await requireAudioEngine().setAudioOutput(output as AudioOutputId, device)
    persistAudioOutputState(state)
    return state
  })

  ipcMain.handle('audioEngine:setAudioDevice', async (_event, device: string) => {
    const state = await requireAudioEngine().setAudioDevice(device)
    persistAudioOutputState(state)
    return state
  })

  ipcMain.handle('audioEngine:setOutputConfig', async (_event, config: unknown) => {
    const normalized = normalizeOutputConfig(config)
    await requireAudioEngine().setOutputConfig(normalized)
    persistAudioOutputConfig(normalized)
    return normalized
  })

  ipcMain.handle('audioEngine:getAudioOutput', async () => {
    return await requireAudioEngine().getAudioOutput()
  })

  ipcMain.handle('audioEngine:getAudioOutputOptions', async () => {
    return requireAudioEngine().getAudioOutputOptions()
  })

  ipcMain.handle('audioEngine:getAudioOutputState', async () => {
    return await requireAudioEngine().getAudioOutputState()
  })

  ipcMain.handle(
    'audioEngine:setAudioProcessing',
    async (_event, settings: Partial<AudioProcessingSettings>) => {
      const normalized = normalizeAudioProcessingSettings({
        ...runtime.appSettings.audioProcessing,
        ...settings
      })
      await persistAndApplyAudioProcessingState(normalized)
      return runtime.appSettings.audioProcessing
    }
  )

  ipcMain.handle('audioEngine:getAudioProcessing', async () => {
    return runtime.appSettings.audioProcessing
  })

  ipcMain.handle('audioEngine:selectImpulseResponse', async () => {
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
    return result.filePaths[0]
  })

  ipcMain.handle('audioEngine:loadImpulseResponse', async (_event, path: string) => {
    const normalized = normalizeAudioProcessingSettings({
      ...runtime.appSettings.audioProcessing,
      dspEnabled: true,
      convolverEnabled: true,
      convolverIrPath: path
    })
    await persistAndApplyAudioProcessingState(normalized)
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle('audioEngine:unloadImpulseResponse', async () => {
    const normalized = normalizeAudioProcessingSettings({
      ...runtime.appSettings.audioProcessing,
      convolverEnabled: false,
      convolverIrPath: ''
    })
    await persistAndApplyAudioProcessingState(normalized)
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle('audioEngine:getConvolverInfo', async () => {
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle(
    'audioEngine:setEqBands',
    async (_event, settings: Partial<AudioProcessingSettings>) => {
      const normalized = normalizeAudioProcessingSettings({
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
      const normalized = normalizeAudioProcessingSettings({
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
    const normalizedStrength = Number(strength)
    const normalized = normalizeAudioProcessingSettings({
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
      const normalized = normalizeAudioProcessingSettings({
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
    return await requireAudioEngine().getMetadataAsync(source)
  })

  ipcMain.handle('audioEngine:getPlaybackInfo', async () => {
    return await requireAudioEngine().getPlaybackInfo()
  })

  ipcMain.handle('audioEngine:getSpectrumData', async (_event, points?: number) => {
    return requireAudioEngine().getSpectrumData(points)
  })

  ipcMain.handle('audioEngine:getVisualizationData', async (_event, options?: unknown) => {
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