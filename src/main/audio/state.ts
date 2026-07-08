import { app, nativeTheme } from 'electron'
import { runtime } from '../core/runtime'
import type { AppSettings, SettingsSnapshot } from '../core/types'
import {
  createSettingsSnapshot,
  normalizeAppSettings,
  writeAppSettings
} from '../core/settings'
import {
  type AudioProcessingSettings,
  type AudioOutputState,
  type OutputConfig,
  type PlaybackInfo
} from '../audioEngineManager'
import { buildEffectiveAudioProcessingSettings } from '../audioProcessingEffective'
import { derivePlaybackEvents } from '../plugins/events'
import { ensureMusicCacheDirectories } from '../cache/ncmCache'
import { applyDiscordRpcSetting } from '../integrations/discord'
import { applyRuntimeSettings } from '../integrations/shortcutsTray'
import { applyLibraryWatchers } from '../library/watcher'

export function persistAudioOutputState(state: AudioOutputState): SettingsSnapshot {
  runtime.appSettings = normalizeAppSettings({
    ...runtime.appSettings,
    audioOutput: state.output,
    audioDevice: state.device,
    audioExclusiveMode: state.exclusiveMode
  })
  writeAppSettings(runtime.appSettings)
  const snapshot = createSettingsSnapshot(runtime.appSettings, runtime.launchSettings)
  runtime.mainWindow?.webContents.send('settings:changed', snapshot)
  return snapshot
}

export function persistAudioOutputConfig(config: OutputConfig): SettingsSnapshot {
  runtime.appSettings = normalizeAppSettings({
    ...runtime.appSettings,
    audioOutputConfig: config
  })
  writeAppSettings(runtime.appSettings)
  const snapshot = createSettingsSnapshot(runtime.appSettings, runtime.launchSettings)
  runtime.mainWindow?.webContents.send('settings:changed', snapshot)
  return snapshot
}

export function broadcastPlayerLifecycleEvents(info: PlaybackInfo): void {
  const previous = runtime.lastPluginPlaybackInfo
  runtime.lastPluginPlaybackInfo = info
  for (const event of derivePlaybackEvents(previous, info)) {
    const payload =
      event.name === 'player:progress'
        ? event.payload
        : info
    void runtime.pluginManager?.broadcastEvent(event.name, payload)
  }
}

export function persistAudioProcessingState(processing: AudioProcessingSettings): SettingsSnapshot {
  runtime.appSettings = normalizeAppSettings({
    ...runtime.appSettings,
    audioProcessing: processing
  })
  writeAppSettings(runtime.appSettings)
  const snapshot = createSettingsSnapshot(runtime.appSettings, runtime.launchSettings)
  runtime.mainWindow?.webContents.send('settings:changed', snapshot)
  return snapshot
}

export function getEffectiveAudioProcessing(settings: AppSettings = runtime.appSettings): AudioProcessingSettings {
  return buildEffectiveAudioProcessingSettings(
    settings.audioProcessing,
    settings.headphoneCompensation
  )
}

export async function applyEffectiveAudioProcessingToEngine(): Promise<AudioProcessingSettings | null> {
  if (!runtime.audioEngineManager) return null
  return await runtime.audioEngineManager.setAudioProcessing(getEffectiveAudioProcessing())
}

export async function persistAndApplyAudioProcessingState(
  processing: AudioProcessingSettings
): Promise<SettingsSnapshot> {
  const snapshot = persistAudioProcessingState(processing)
  try {
    await applyEffectiveAudioProcessingToEngine()
  } catch (err) {
    console.warn('应用合成 DSP 设置到音频引擎失败，已保留用户设置：', err)
  }
  return snapshot
}

export function getWindowBackgroundColor(settings: AppSettings): string {
  if (settings.theme === 'dark') return settings.appBackground.global.dark
  if (settings.theme === 'system' && nativeTheme.shouldUseDarkColors) {
    return settings.appBackground.global.dark
  }
  return settings.appBackground.global.light
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<SettingsSnapshot> {
  const previousCachePath = runtime.appSettings.musicCachePath
  const shouldUpdateAudioProcessing = Object.prototype.hasOwnProperty.call(patch, 'audioProcessing')
  const shouldUpdateHeadphoneCompensation = Object.prototype.hasOwnProperty.call(
    patch,
    'headphoneCompensation'
  )
  const shouldUpdateAudioOutputConfig = Object.prototype.hasOwnProperty.call(
    patch,
    'audioOutputConfig'
  )
  const shouldUpdateAudioOutput = Object.prototype.hasOwnProperty.call(patch, 'audioOutput')
  const shouldUpdateAudioDevice = Object.prototype.hasOwnProperty.call(patch, 'audioDevice')
  const shouldUpdateExclusiveMode = Object.prototype.hasOwnProperty.call(
    patch,
    'audioExclusiveMode'
  )
  const shouldUpdateWindowBackground =
    Object.prototype.hasOwnProperty.call(patch, 'theme') ||
    Object.prototype.hasOwnProperty.call(patch, 'appBackground')
  runtime.appSettings = normalizeAppSettings({ ...runtime.appSettings, ...patch })
  if (shouldUpdateWindowBackground && !runtime.appSettings.windowTransparency) {
    runtime.mainWindow?.setBackgroundColor(getWindowBackgroundColor(runtime.appSettings))
  }

  if (
    runtime.audioEngineManager &&
    (shouldUpdateAudioOutput || shouldUpdateAudioDevice || shouldUpdateExclusiveMode)
  ) {
    let audioState: AudioOutputState
    if (shouldUpdateAudioOutput) {
      audioState = await runtime.audioEngineManager.setAudioOutput(
        runtime.appSettings.audioOutput,
        runtime.appSettings.audioDevice
      )
    } else if (shouldUpdateAudioDevice) {
      audioState = await runtime.audioEngineManager.setAudioDevice(runtime.appSettings.audioDevice)
    } else {
      audioState = await runtime.audioEngineManager.getAudioOutputState()
    }

    if (shouldUpdateExclusiveMode && audioState.exclusiveAvailable) {
      audioState = await runtime.audioEngineManager.setExclusiveMode(runtime.appSettings.audioExclusiveMode)
    }

    runtime.appSettings = normalizeAppSettings({
      ...runtime.appSettings,
      audioOutput: audioState.output,
      audioDevice: audioState.device,
      audioExclusiveMode: audioState.exclusiveMode
    })
  }

  writeAppSettings(runtime.appSettings)

  if (runtime.appSettings.musicCachePath && runtime.appSettings.musicCachePath !== previousCachePath) {
    try {
      ensureMusicCacheDirectories(runtime.appSettings.musicCachePath)
    } catch (err) {
      console.warn('创建缓存目录失败：', err)
    }
  }

  if ((shouldUpdateAudioProcessing || shouldUpdateHeadphoneCompensation) && runtime.audioEngineManager) {
    try {
      await applyEffectiveAudioProcessingToEngine()
    } catch (err) {
      console.warn('应用合成 DSP 设置到音频引擎失败，已保留设置：', err)
    }
  }

  if (shouldUpdateAudioOutputConfig) {
    await runtime.audioEngineManager?.setOutputConfig(runtime.appSettings.audioOutputConfig)
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'discordRpcEnabled')) {
    applyDiscordRpcSetting(runtime.appSettings.discordRpcEnabled)
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, 'libraryFolders') ||
    Object.prototype.hasOwnProperty.call(patch, 'watchLibrary')
  ) {
    applyLibraryWatchers(runtime.appSettings.libraryFolders, runtime.appSettings.watchLibrary)
  }

  // Forward desktop lyrics settings changes directly to the lyrics window
  if (
    Object.prototype.hasOwnProperty.call(patch, 'desktopLyrics') &&
    runtime.desktopLyricsWindow &&
    !runtime.desktopLyricsWindow.isDestroyed()
  ) {
    const dl = runtime.appSettings.desktopLyrics
    runtime.desktopLyricsWindow.setAlwaysOnTop(dl.alwaysOnTop, 'screen-saver')
    runtime.desktopLyricsWindow.setIgnoreMouseEvents(dl.clickThrough, { forward: true })
    if (
      dl.windowWidth !== runtime.desktopLyricsWindow.getBounds().width ||
      dl.windowHeight !== runtime.desktopLyricsWindow.getBounds().height
    ) {
      runtime.desktopLyricsWindow.setSize(dl.windowWidth, dl.windowHeight)
    }
    runtime.desktopLyricsWindow.webContents.send('desktopLyrics:initSettings', dl)
  }

  applyRuntimeSettings()
  const snapshot = createSettingsSnapshot(runtime.appSettings, runtime.launchSettings)
  runtime.mainWindow?.webContents.send('settings:changed', snapshot)
  return snapshot
}

export function relaunchApplication(): void {
  runtime.forceQuit = true
  app.relaunch({
    args: process.argv.slice(1)
  })
  app.quit()
}
