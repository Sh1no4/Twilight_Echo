import { app, BrowserWindow, dialog, protocol, net } from 'electron'
import { join, extname } from 'path'
import { readFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { runtime } from '../core/runtime'
import { ensureMusicCacheDirectories } from '../cache/ncmCache'
import {
  getCoverCacheContentType,
  isCoverCacheFileName,
  resolveBackgroundImageFile,
  resolveCoverCacheFile
} from '../library/coverCache'
import { decodeAudioFileUrlPath } from '../library/scan'
import { initializeLocalPathGrants, resolveAuthorizedAudioFile } from '../security/localPaths'
import {
  unregisterPlayerShortcuts,
  destroyTray,
  applyRuntimeSettings
} from '../integrations/shortcutsTray'
import { showDesktopLyrics, setupDesktopLyricsIpc } from '../integrations/desktopLyrics'
import { restoreMainWindowFromMiniPlayer, setupMiniPlayerIpc } from '../integrations/miniPlayer'
import { setupNcmIpc, setupNcmApi } from '../ncm/api'
import { setupAudioEngineIpc } from '../audio/engineIpc'
import { AudioAnalysisServiceClient } from '../audioAnalysisServiceClient.ts'
import { LocalLibraryScanServiceClient } from '../library/libraryScanServiceClient.ts'
import { setupBpmAnalysisIpc } from '../bpm/bpmIpc'
import { setupLoudnessAnalysisIpc } from '../audio/loudnessIpc'
import { setupOpraIpc } from '../ipc/opra'
import { setupPluginIpc } from '../ipc/plugins'
import { setupDataIpc } from '../ipc/data'
import { setupOfflineDownloadIpc, destroyOfflineDownloadIpc } from '../offline/offlineDownloadIpc.ts'
import { setupRadioMediaIpc, destroyRadioMediaIpc } from '../radio/radioMediaIpc.ts'
import { setupRemoteIpc, destroyRemoteIpc } from '../remote/remoteIpc.ts'
import { installElectronSecurity } from '../security/electronSecurity.ts'
import { createRemoteMediaRequestHandler } from '../security/remoteMediaGrants.ts'
import { createWindow } from './window'
import { consumeAppSettingsLoadIssue } from '../core/settings'
import type { SettingsFileLoadIssue } from '../persistence/settingsFile.ts'

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
        scheme: 'twilight-media',
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
      if (runtime.miniPlayerWindow && !runtime.miniPlayerWindow.isDestroyed()) {
        restoreMainWindowFromMiniPlayer()
        return
      }
      const win = runtime.mainWindow
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })

    app.whenReady().then(async () => {
      electronApp.setAppUserModelId('com.TwilightEcho.music')
      installElectronSecurity()
      await initializeLocalPathGrants(runtime.launchSettings)

      // Register cover:// protocol — Chromium reads cached image assets directly from disk,
      // no IPC, no base64, browser manages decode cache natively.
      protocol.handle('cover', (request) => {
        const url = new URL(request.url)
        const fileName = url.hostname + url.pathname
        // Sanitize: only allow alphanumeric/hash filenames
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '')
        if (!isCoverCacheFileName(safeName)) {
          return new Response('Forbidden', { status: 403 })
        }
        const filePath = resolveCoverCacheFile(safeName)
        if (!filePath) {
          return new Response('Not Found', { status: 404 })
        }
        const data = readFileSync(filePath)
        return new Response(data, {
          headers: {
            'Content-Type': getCoverCacheContentType(safeName),
            'Cache-Control': 'max-age=86400'
          }
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
          const filePath = await resolveAuthorizedAudioFile(decodeAudioFileUrlPath(encodedPath))
          return net.fetch(pathToFileURL(filePath).toString(), {
            headers: request.headers,
            bypassCustomProtocolHandlers: true
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : '无法读取音频文件'
          return new Response(message, { status: 404 })
        }
      })

      protocol.handle(
        'twilight-media',
        createRemoteMediaRequestHandler({
          fetch: (source, init) =>
            net.fetch(source, {
              ...init,
              bypassCustomProtocolHandlers: true
            })
        })
      )

      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      runtime.localLibraryScanService = new LocalLibraryScanServiceClient({
        serviceEntry: join(__dirname, 'libraryScanService.js')
      })
      setupDataIpc()
      setupDesktopLyricsIpc()
      setupMiniPlayerIpc()

      if (runtime.appSettings.desktopLyrics.enabled) {
        showDesktopLyrics()
      }

      await setupAudioEngineIpc()
      runtime.audioAnalysisService = new AudioAnalysisServiceClient({
        serviceEntry: join(__dirname, 'audioAnalysisService.js')
      })
      setupBpmAnalysisIpc()
      setupLoudnessAnalysisIpc()
      setupNcmIpc()
      await setupOfflineDownloadIpc()
      setupRadioMediaIpc()
      setupRemoteIpc()
      setupOpraIpc()
      setupPluginIpc()
      setupNcmApi()

      // Linux 上透明窗口必须等合成器视觉就绪后再建窗，否则内容不渲染
      if (process.platform === 'linux' && runtime.appSettings.windowTransparency === true) {
        setTimeout(() => {
          createWindow()
          applyRuntimeSettings()
          showAppSettingsLoadIssue(consumeAppSettingsLoadIssue())
        }, 360)
      } else {
        createWindow()
        applyRuntimeSettings()
        showAppSettingsLoadIssue(consumeAppSettingsLoadIssue())
      }

      app.on('activate', function () {
        if (runtime.miniPlayerWindow && !runtime.miniPlayerWindow.isDestroyed()) {
          restoreMainWindowFromMiniPlayer()
        } else if (BrowserWindow.getAllWindows().length === 0) {
          createWindow()
        }
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
      runtime.bpmAnalysisManager?.cancel()
      runtime.loudnessAnalysisManager?.cancel()
      runtime.audioAnalysisService?.destroy()
      runtime.audioAnalysisService = null
      runtime.localLibraryIndexCoordinator?.destroy()
      runtime.localLibraryIndexCoordinator = null
      runtime.localLibraryScanService?.destroy()
      runtime.localLibraryScanService = null
      runtime.audioEngineManager?.destroy()
      runtime.audioEngineManager = null
      runtime.bpmAnalysisManager = null
      runtime.loudnessAnalysisManager = null
      runtime.pluginManager = null
      destroyOfflineDownloadIpc()
      destroyRadioMediaIpc()
      void destroyRemoteIpc()
      if (runtime.ncmServer) {
        runtime.ncmServer.close()
        runtime.ncmServer = null
      }
    })
  }
}

function showAppSettingsLoadIssue(issue: SettingsFileLoadIssue | null): void {
  if (!issue) return

  const options: Electron.MessageBoxOptions =
    issue.kind === 'recovered'
      ? {
          type: 'warning',
          title: 'Twilight Echo 数据恢复',
          message: '设置已从备份恢复',
          detail: issue.restoreError
            ? `已读取有效备份，但恢复主文件失败：${issue.restoreError}`
            : issue.corruptCopyPath
              ? `主文件已由最后一个有效备份恢复。损坏副本保留在：${issue.corruptCopyPath}`
              : '主文件缺失，已由最后一个有效备份恢复。',
          buttons: ['确定'],
          defaultId: 0
        }
      : {
          type: 'error',
          title: 'Twilight Echo 数据恢复',
          message: '设置主文件和备份均已损坏',
          detail: buildCorruptSettingsDetail(issue),
          buttons: ['使用默认设置继续'],
          defaultId: 0
        }
  const win = runtime.mainWindow
  const prompt =
    win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
  void prompt.catch((error) => {
    console.error('[persistence] failed to show settings recovery notice:', error)
  })
}

function buildCorruptSettingsDetail(
  issue: Extract<SettingsFileLoadIssue, { kind: 'corrupt' }>
): string {
  const preservedPaths = [issue.corruptCopyPath, issue.corruptBackupCopyPath].filter(Boolean)
  const preservedDetail =
    preservedPaths.length > 0
      ? `\n\n损坏副本已保留：\n${preservedPaths.join('\n')}`
      : '\n\n无法创建额外副本；请先备份原设置文件。'
  return `应用本次使用默认设置，未把损坏内容当作有效配置。\n主文件：${issue.primaryError}\n备份：${issue.backupError}${preservedDetail}`
}
