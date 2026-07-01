import { app, ipcMain } from 'electron'
import { join, resolve } from 'path'
import { readFileSync } from 'fs'
import { runtime } from '../core/runtime'
import { TwilightPluginManager } from '../plugins/manager'
import { PluginIndexService, resolvePluginIndexUrl } from '../plugins/indexService'
import type { TwilightPluginUninstallOptions } from '../plugins/types'
import {
  bundledPluginPath,
  bundledPluginIndexPath,
  requestNcmApi,
  openNcmOfficialLogin
} from '../ncm/api'
import { getCachedNcmSong, cacheNcmSong } from '../cache/ncmCache'

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
      cacheSong: async (songId, url, fileName) => cacheNcmSong(Number(songId), url, fileName)
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

  ipcMain.handle('plugins:list', async () => {
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.list()
  })
  ipcMain.handle('plugins:installFromPath', async (_event, sourcePath: string) => {
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.installFromPath(sourcePath)
  })
  ipcMain.handle('plugins:chooseAndInstall', async () => {
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.chooseAndInstall()
  })
  ipcMain.handle('plugins:enable', async (_event, id: string) => {
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.enable(id)
  })
  ipcMain.handle('plugins:disable', async (_event, id: string) => {
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.disable(id)
  })
  ipcMain.handle('plugins:uninstall', async (_event, id: string, options?: TwilightPluginUninstallOptions) => {
    await runtime.pluginManagerReady
    await runtime.pluginManager!.uninstall(id, options)
    return true
  })
  ipcMain.handle('plugins:openLog', async (_event, id: string) => {
    await runtime.pluginManagerReady
    await runtime.pluginManager!.openLog(id)
  })
  ipcMain.handle('plugins:getLog', async (_event, id: string) => {
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.getLog(id)
  })
  ipcMain.handle('plugins:listIndex', async () => {
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
  ipcMain.handle('plugins:refreshIndex', async () => {
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
  ipcMain.handle('plugins:getIndexStatus', async () => {
    await runtime.pluginManagerReady
    return runtime.pluginIndexService!.getStatus()
  })
  ipcMain.handle('plugins:installFromIndex', async (_event, id: string) => {
    await runtime.pluginManagerReady
    const downloaded = await runtime.pluginIndexService!.downloadPackage(id)
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
    await runtime.pluginManagerReady
    return await runtime.pluginManager!.setNativeDspPluginParameters(id, parameters)
  })
  ipcMain.handle('providers:list', async () => {
    await runtime.pluginManagerReady
    return runtime.pluginManager!.listProviders()
  })
  ipcMain.handle(
    'providers:call',
    async (_event, providerId: string, method: Parameters<TwilightPluginManager['callProvider']>[1], args: unknown[]) => {
      await runtime.pluginManagerReady
      return await runtime.pluginManager!.callProvider(providerId, method, Array.isArray(args) ? args : [])
    }
  )
  ipcMain.handle('extensions:list', async () => {
    await runtime.pluginManagerReady
    return runtime.pluginManager!.listExtensions()
  })
  ipcMain.handle('extensions:executeCommand', async (_event, command: string, args?: unknown[]) => {
    await runtime.pluginManagerReady
    return runtime.pluginManager!.executeUiCommand(command, Array.isArray(args) ? args : [])
  })
  ipcMain.handle('extensions:readThemeStylesheet', async (_event, stylesheetPath: string) => {
    await runtime.pluginManagerReady
    const normalized = resolve(stylesheetPath)
    const allowed = runtime.pluginManager!.listExtensions().some((entry) =>
      entry.themes.some((theme) => theme.stylesheet && resolve(theme.stylesheet) === normalized)
    )
    if (!allowed) throw new Error('主题 stylesheet 未注册')
    return readFileSync(normalized, 'utf-8')
  })
}
