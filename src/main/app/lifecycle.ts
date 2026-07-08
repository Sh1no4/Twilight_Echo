import { app, BrowserWindow, protocol, net } from 'electron'
import { join, extname } from 'path'
import { readFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { runtime } from '../core/runtime'
import { ensureMusicCacheDirectories } from '../cache/ncmCache'
import {
  resolveBackgroundImageFile,
  resolveCoverCacheFile
} from '../library/coverCache'
import {
  decodeAudioFileUrlPath,
  resolvePlayableAudioFile
} from '../library/scan'
import {
  unregisterPlayerShortcuts,
  destroyTray,
  applyRuntimeSettings
} from '../integrations/shortcutsTray'
import {
  showDesktopLyrics,
  setupDesktopLyricsIpc
} from '../integrations/desktopLyrics'
import {
  setupNcmIpc,
  setupNcmApi
} from '../ncm/api'
import { setupAudioEngineIpc } from '../audio/engineIpc'
import { setupBpmAnalysisIpc } from '../bpm/bpmIpc'
import { setupOpraIpc } from '../ipc/opra'
import { setupPluginIpc } from '../ipc/plugins'
import { setupDataIpc } from '../ipc/data'
import { createWindow } from './window'

export function startApp(): void {
  runtime.launchSettings = { ...runtime.appSettings }

  if (!runtime.appSettings.hardwareAcceleration) {
    app.disableHardwareAcceleration()
  }

  if (runtime.appSettings.musicCachePath) {
    try {
      ensureMusicCacheDirectories(runtime.appSettings.musicCachePath)
      app.commandLine.appendSwitch(
        'disk-cache-dir',
        join(runtime.appSettings.musicCachePath, 'renderer-cache')
      )
    } catch (err) {
      console.warn('无法使用自定义缓存目录：', err)
    }
  }

  // Streaming provider URLs are resolved asynchronously after user commands.
  // Desktop playback must not be blocked by Chromium's web-page autoplay policy.
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

  // Linux 上透明窗口需要显式启用透明视觉，否则整窗不渲染（纯透明）
  if (process.platform === 'linux' && runtime.appSettings.windowTransparency === true) {
    app.commandLine.appendSwitch('enable-transparent-visuals')
  }

  const gotSingleInstanceLock = app.requestSingleInstanceLock()
  if (!gotSingleInstanceLock) {
    app.quit()
  } else {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: 'twilight-audio',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true
        }
      },
      {
        scheme: 'background',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true
        }
      }
    ])

    app.on('second-instance', () => {
      const win = runtime.mainWindow
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })

    app.whenReady().then(() => {
      electronApp.setAppUserModelId('com.TwilightEcho.music')

      // Register cover:// protocol — Chromium reads JPEGs directly from disk,
      // no IPC, no base64, browser manages decode cache natively.
      protocol.handle('cover', (request) => {
        const url = new URL(request.url)
        const fileName = url.hostname + url.pathname
        // Sanitize: only allow alphanumeric/hash filenames
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '')
        if (!safeName.endsWith('.jpg')) {
          return new Response('Forbidden', { status: 403 })
        }
        const filePath = resolveCoverCacheFile(safeName)
        if (!filePath) {
          return new Response('Not Found', { status: 404 })
        }
        const data = readFileSync(filePath)
        return new Response(data, {
          headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' }
        })
      })

      protocol.handle('background', (request) => {
        const url = new URL(request.url)
        const fileName = (url.hostname + url.pathname).replace(/^\/+/, '')
        const filePath = resolveBackgroundImageFile(fileName)
        if (!filePath) {
          return new Response('Not Found', { status: 404 })
        }
        const ext = extname(filePath).toLowerCase()
        const contentType =
          ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
        const data = readFileSync(filePath)
        return new Response(data, {
          headers: { 'Content-Type': contentType, 'Cache-Control': 'max-age=86400' }
        })
      })

      protocol.handle('twilight-audio', async (request) => {
        try {
          const url = new URL(request.url)
          const encodedPath = url.pathname.replace(/^\/+/, '')
          if (!encodedPath) return new Response('Bad Request', { status: 400 })
          const filePath = await resolvePlayableAudioFile(decodeAudioFileUrlPath(encodedPath))
          return net.fetch(pathToFileURL(filePath).toString(), {
            headers: request.headers,
            bypassCustomProtocolHandlers: true
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : '无法读取音频文件'
          return new Response(message, { status: 404 })
        }
      })

      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      setupDataIpc()
      setupDesktopLyricsIpc()

      if (runtime.appSettings.desktopLyrics.enabled) {
        showDesktopLyrics()
      }

      // Linux 上透明窗口必须等合成器视觉就绪后再建窗，否则内容不渲染
      if (process.platform === 'linux' && runtime.appSettings.windowTransparency === true) {
        setTimeout(() => {
          createWindow()
          applyRuntimeSettings()
        }, 360)
      } else {
        createWindow()
        applyRuntimeSettings()
      }

      setupAudioEngineIpc()
      setupBpmAnalysisIpc()
      setupNcmIpc()
      setupOpraIpc()
      setupPluginIpc()
      setupNcmApi()

      app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin' && !runtime.appSettings.closeToTray) {
        app.quit()
      }
    })

    app.on('before-quit', () => {
      runtime.forceQuit = true
      void runtime.pluginManager?.broadcastEvent('app:before-quit', null)
    })

    app.on('will-quit', () => {
      unregisterPlayerShortcuts()
      destroyTray()
      void runtime.pluginManager?.destroy()
      runtime.audioEngineManager?.destroy()
      runtime.audioEngineManager = null
      runtime.bpmAnalysisManager = null
      runtime.pluginManager = null
      if (runtime.ncmServer) {
        runtime.ncmServer.close()
        runtime.ncmServer = null
      }
    })
  }
}
