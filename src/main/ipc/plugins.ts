import { app, ipcMain } from 'electron'
import { join, resolve } from 'path'
import { readFileSync, realpathSync } from 'fs'
import { runtime } from '../core/runtime'
import { TwilightPluginManager } from '../plugins/manager'
import { PluginIndexService, resolvePluginIndexUrl } from '../plugins/indexService'
import { isTwilightMediaProviderMethod } from '../plugins/providerRouting'
import type { TwilightMediaProviderMethod, TwilightPluginUninstallOptions } from '../plugins/types'
import {
  bundledPluginPath,
  bundledPluginIndexPath,
  requestNcmApi,
  openNcmOfficialLogin
} from '../ncm/api'
import { getCachedNcmSong, cacheNcmSong } from '../cache/ncmCache'
import {
  normalizeFiniteNumber,
  normalizeIpcString,
  stringifyJsonForIpcStorage
} from '../security/ipcValidation.ts'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'

const MAX_PLUGIN_ID_LENGTH = 128
const MAX_PROVIDER_ID_LENGTH = 128
const MAX_IPC_PATH_LENGTH = 4096
const MAX_UI_COMMAND_LENGTH = 256
const MAX_PROVIDER_ARGS = 16
const MAX_EXTENSION_COMMAND_ARGS = 16
const MAX_PLUGIN_IPC_ARGS_BYTES = 512 * 1024
const MAX_NATIVE_DSP_PARAMETERS = 128
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const DSP_PARAMETER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/

export function setupPluginIpc(): void {
  if (runtime.pluginManager) return
  const bundledPluginIds = ['com.twilightecho.provider.ncm']
  runtime.pluginManager = new TwilightPluginManager({
    appVersion: app.getVersion(),
    hostEntry: join(__dirname, 'pluginHost.js'),
    bundledPlugins: [
      {
        id: bundledPluginIds[0],
        sourcePath: bundledPluginPath('ncm-provider'),
        defaultEnabled: true
      }
    ],
    ncm: {
      request: requestNcmApi,
      officialLogin: openNcmOfficialLogin,
      getCachedSong: async (songId) => getCachedNcmSong(Number(songId)),
      cacheSong: async (songId, url, fileName) => {
        if (runtime.appSettings.cachePolicy.streamingAudio !== 'provider') return null
        return cacheNcmSong(Number(songId), url, fileName)
      }
    },
    getPlaybackInfo: async () => runtime.audioEngineManager?.getPlaybackInfo() ?? null,
    applyNativeDspPluginChain: async (chainJson) => {
      await runtime.audioEngineManager?.setNativeDspPluginChain(chainJson)
    },
    player: {
      play: async () => {
        await runtime.audioEngineManager?.togglePause()
      },
      pause: async () => {
        await runtime.audioEngineManager?.pause()
      },
      togglePause: async () => {
        await runtime.audioEngineManager?.togglePause()
      },
      stop: async () => {
        await runtime.audioEngineManager?.stop()
      },
      next: async () => {
        await runtime.audioEngineManager?.next()
      },
      previous: async () => {
        await runtime.audioEngineManager?.previous()
      }
    },
    getProxyEnv: (): Record<string, string> => {
      if (runtime.appSettings.proxyMode === 'off') return {}
      if (runtime.appSettings.proxyMode === 'custom' && runtime.appSettings.proxyHost && runtime.appSettings.proxyPort > 0) {
        return { HTTPS_PROXY: `http://${runtime.appSettings.proxyHost}:${runtime.appSettings.proxyPort}` }
      }
      return {}
    }
  })
  runtime.pluginIndexService = new PluginIndexService({
    appVersion: app.getVersion(),
    localIndexPath: bundledPluginIndexPath(),
    remoteIndexUrl: resolvePluginIndexUrl(process.env.TWILIGHT_PLUGIN_INDEX_URL),
    cacheIndexPath: join(app.getPath('userData'), 'plugin-index', 'cache', 'plugins.json'),
    bundledPluginIds
  })

  runtime.pluginManagerReady = runtime.pluginManager
    .initialize()
    .then(() => {
      void runtime.pluginManager?.broadcastEvent('app:ready', {
        version: app.getVersion(),
        platform: process.platform
      })
    })
    .catch((error) => {
      console.error('[插件系统] 初始化失败：', error)
    })

  runtime.pluginManager.on('changed', () => {
    runtime.mainWindow?.webContents.send('plugins:changed')
  })

  ipcMain.handle('plugins:list', async (event) => {
    assertTrustedIpcSender(event, 'plugin IPC')
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.list()
  })
  ipcMain.handle('plugins:installFromPath', async (_event, sourcePath: string) => {
    assertTrustedIpcSender(_event, 'plugin IPC')
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.installFromPath(
      normalizeIpcString(sourcePath, 'plugin package path', MAX_IPC_PATH_LENGTH)
    )
  })
  ipcMain.handle('plugins:chooseAndInstall', async (event) => {
    assertTrustedIpcSender(event, 'plugin IPC')
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.chooseAndInstall()
  })
  ipcMain.handle('plugins:enable', async (_event, id: string) => {
    assertTrustedIpcSender(_event, 'plugin IPC')
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.enable(normalizePluginId(id))
  })
  ipcMain.handle('plugins:disable', async (_event, id: string) => {
    assertTrustedIpcSender(_event, 'plugin IPC')
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.disable(normalizePluginId(id))
  })
  ipcMain.handle('plugins:uninstall', async (_event, id: string, options?: TwilightPluginUninstallOptions) => {
    assertTrustedIpcSender(_event, 'plugin IPC')
    await runtime.pluginManagerReady
    await runtime.pluginManager!.uninstall(normalizePluginId(id), normalizeUninstallOptions(options))
    return true
  })
  ipcMain.handle('plugins:openLog', async (_event, id: string) => {
    assertTrustedIpcSender(_event, 'plugin IPC')
    await runtime.pluginManagerReady
    await runtime.pluginManager!.openLog(normalizePluginId(id))
  })
  ipcMain.handle('plugins:getLog', async (_event, id: string) => {
    assertTrustedIpcSender(_event, 'plugin IPC')
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.getLog(normalizePluginId(id))
  })
  ipcMain.handle('plugins:listIndex', async (event) => {
    assertTrustedIpcSender(event, 'plugin IPC')
    await runtime.pluginManagerReady
    const [entries, installed] = await Promise.all([
      runtime.pluginIndexService!.list(),
      runtime.pluginManager!.list()
    ])
    return entries.map((entry) => ({
      ...entry,
      installState: runtime.pluginIndexService!.describeInstallState(entry, installed),
      installedVersion: installed.find((plugin) => plugin.id === entry.id)?.version
    }))
  })
  ipcMain.handle('plugins:refreshIndex', async (event) => {
    assertTrustedIpcSender(event, 'plugin IPC')
    await runtime.pluginManagerReady
    const [entries, installed] = await Promise.all([
      runtime.pluginIndexService!.refresh(),
      runtime.pluginManager!.list()
    ])
    return entries.map((entry) => ({
      ...entry,
      installState: runtime.pluginIndexService!.describeInstallState(entry, installed),
      installedVersion: installed.find((plugin) => plugin.id === entry.id)?.version
    }))
  })
  ipcMain.handle('plugins:getIndexStatus', async (event) => {
    assertTrustedIpcSender(event, 'plugin IPC')
    await runtime.pluginManagerReady
    return runtime.pluginIndexService!.getStatus()
  })
  ipcMain.handle('plugins:installFromIndex', async (_event, id: string) => {
    assertTrustedIpcSender(_event, 'plugin IPC')
    await runtime.pluginManagerReady
    const downloaded = await runtime.pluginIndexService!.downloadPackage(normalizePluginId(id))
    try {
      return await runtime.pluginManager!.installFromPath(downloaded.packagePath, {
        source: 'index',
        sourceLabel: downloaded.entry.sourceUrl
      })
    } finally {
      await downloaded.cleanup()
    }
  })
  ipcMain.handle('plugins:setNativeDspParameters', async (_event, id: string, parameters: Record<string, number>) => {
    assertTrustedIpcSender(_event, 'plugin IPC')
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.setNativeDspPluginParameters(
      normalizePluginId(id),
      normalizeNativeDspParameters(parameters)
    )
  })
  ipcMain.handle('providers:list', async (event) => {
    assertTrustedIpcSender(event, 'provider IPC')
    await runtime.pluginManagerReady
    return runtime.pluginManager!.listProviders()
  })
  ipcMain.handle(
    'providers:call',
    async (_event, providerId: string, method: Parameters<TwilightPluginManager['callProvider']>[1], args: unknown[]) => {
      assertTrustedIpcSender(_event, 'provider IPC')
      await runtime.pluginManagerReady
      return await runtime.pluginManager!.callProvider(
        normalizeProviderId(providerId),
        normalizeProviderMethod(method),
        normalizePluginIpcArgs(args, 'provider call args', MAX_PROVIDER_ARGS)
      )
    }
  )
  ipcMain.handle('extensions:list', async (event) => {
    assertTrustedIpcSender(event, 'extension IPC')
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.listExtensions()
  })
  ipcMain.handle('extensions:executeCommand', async (_event, command: string, args?: unknown[]) => {
    assertTrustedIpcSender(_event, 'extension IPC')
    await runtime.pluginManagerReady
    return runtime.pluginManager!.executeUiCommand(
      normalizeIpcString(command, 'extension command', MAX_UI_COMMAND_LENGTH),
      normalizePluginIpcArgs(args, 'extension command args', MAX_EXTENSION_COMMAND_ARGS)
    )
  })
  ipcMain.handle('extensions:readThemeStylesheet', async (_event, stylesheetPath: string) => {
    assertTrustedIpcSender(_event, 'extension IPC')
    await runtime.pluginManagerReady
    const normalized = realpathSync(
      resolve(normalizeIpcString(stylesheetPath, 'theme stylesheet path', MAX_IPC_PATH_LENGTH))
    )
    const extensions = await runtime.pluginManager!.listExtensions()
    const allowed = extensions.some((entry) =>
      entry.themes.some((theme) => isRegisteredThemeStylesheet(theme.stylesheet, normalized))
    )
    if (!allowed) throw new Error('主题 stylesheet 未注册')
    return readFileSync(normalized, 'utf-8')
  })
}

function normalizePluginId(value: unknown): string {
  const id = normalizeIpcString(value, 'plugin id', MAX_PLUGIN_ID_LENGTH).toLowerCase()
  if (!PLUGIN_ID_PATTERN.test(id)) throw new Error('plugin id is invalid')
  return id
}

function normalizeProviderId(value: unknown): string {
  const id = normalizeIpcString(value, 'provider id', MAX_PROVIDER_ID_LENGTH).toLowerCase()
  if (!PROVIDER_ID_PATTERN.test(id)) throw new Error('provider id is invalid')
  return id
}

function normalizeProviderMethod(value: unknown): TwilightMediaProviderMethod {
  const method = normalizeIpcString(value, 'provider method', 80)
  if (!isTwilightMediaProviderMethod(method)) throw new Error('provider method is invalid')
  return method
}

function normalizePluginIpcArgs(value: unknown, field: string, maxItems: number): unknown[] {
  const args = Array.isArray(value) ? value.slice(0, maxItems) : []
  stringifyJsonForIpcStorage(args, field, MAX_PLUGIN_IPC_ARGS_BYTES)
  return args
}

function normalizeUninstallOptions(value: unknown): TwilightPluginUninstallOptions | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('plugin uninstall options must be an object')
  return { removeData: (value as Record<string, unknown>).removeData === true }
}

function normalizeNativeDspParameters(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_NATIVE_DSP_PARAMETERS)
  const parameters: Record<string, number> = {}
  for (const [key, raw] of entries) {
    if (!DSP_PARAMETER_ID_PATTERN.test(key)) continue
    parameters[key] = normalizeFiniteNumber(raw, `DSP parameter ${key}`, 0, -1_000_000, 1_000_000)
  }
  stringifyJsonForIpcStorage(parameters, 'DSP parameters', MAX_PLUGIN_IPC_ARGS_BYTES)
  return parameters
}

function isRegisteredThemeStylesheet(stylesheet: string | undefined, expectedRealPath: string): boolean {
  if (!stylesheet) return false
  try {
    return realpathSync(resolve(stylesheet)) === expectedRealPath
  } catch {
    return false
  }
}
