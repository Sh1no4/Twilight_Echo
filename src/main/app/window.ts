import { app, BrowserWindow, shell } from 'electron'
import { release } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { runtime } from '../core/runtime'
import { getWindowBackgroundColor } from '../audio/state'
import { installAudioDeviceHotplugWatcher } from '../audio/deviceHotplug'

const PLAYBACK_SESSION_SAVE_TIMEOUT_MS = 1800
const pendingPlaybackSessionSaves = new Map<string, () => void>()

export function resolvePlaybackSessionSave(requestId: string): void {
  const resolvePending = pendingPlaybackSessionSaves.get(requestId)
  if (!resolvePending) return
  pendingPlaybackSessionSaves.delete(requestId)
  resolvePending()
}

async function requestRendererPlaybackSessionSave(): Promise<void> {
  const win = runtime.mainWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return

  const requestId = randomUUID()
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      pendingPlaybackSessionSaves.delete(requestId)
      resolve()
    }, PLAYBACK_SESSION_SAVE_TIMEOUT_MS)

    pendingPlaybackSessionSaves.set(requestId, () => {
      clearTimeout(timer)
      resolve()
    })

    win.webContents.send('app:save-playback-session', requestId)
  })
}

async function closeMainWindowAfterPlaybackSessionSave(win: BrowserWindow): Promise<void> {
  runtime.savingPlaybackSessionBeforeClose = true
  try {
    await requestRendererPlaybackSessionSave()
  } catch (err) {
    console.warn('关闭前保存播放会话失败：', err)
  } finally {
    runtime.savingPlaybackSessionBeforeClose = false
    if (!win.isDestroyed()) {
      const shouldQuitAfterClose = runtime.forceQuit
      if (shouldQuitAfterClose) {
        win.once('closed', () => {
          setTimeout(() => app.quit(), 0)
        })
      }
      runtime.closingAfterPlaybackSessionSave = true
      win.close()
      runtime.closingAfterPlaybackSessionSave = false
    }
  }
}

export function getAppIconPath(): string {
  if (process.platform === 'win32') {
    return is.dev
      ? join(app.getAppPath(), 'build', 'icon.ico')
      : join(process.resourcesPath, 'icon.ico')
  }
  return is.dev
    ? join(app.getAppPath(), 'build', 'icon.png')
    : join(process.resourcesPath, 'icon.png')
}

// Win11 22H2 (build 22621) 及以上支持原生亚克力背板（DWM systembackdrop）
export function supportsWindowsAcrylic(): boolean {
  if (process.platform !== 'win32') return false
  const build = Number(release().split('.')[2] ?? 0)
  return Number.isFinite(build) && build >= 22621
}

export function createWindow(): void {
  const transparent = runtime.appSettings.windowTransparency === true
  // Windows 上用原生亚克力模糊：backgroundMaterial 与 transparent 互斥，
  // 需保持 transparent: false 并用全透明 backgroundColor 露出背板
  const acrylic = transparent && supportsWindowsAcrylic()

  runtime.mainWindow = new BrowserWindow({
    width: 1495,
    height: 883,
    show: false,
    frame: false,
    transparent: transparent && !acrylic,
    backgroundColor: transparent ? '#00000000' : getWindowBackgroundColor(runtime.appSettings),
    ...(acrylic ? { backgroundMaterial: 'acrylic' as const } : {}),
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false
    }
  })

  runtime.mainWindow.on('ready-to-show', () => {
    runtime.mainWindow?.show()
  })

  runtime.mainWindow.on('close', (event) => {
    if (runtime.appSettings.closeToTray && !runtime.forceQuit) {
      event.preventDefault()
      runtime.mainWindow?.hide()
      return
    }

    if (!runtime.closingAfterPlaybackSessionSave) {
      event.preventDefault()
      if (!runtime.savingPlaybackSessionBeforeClose && runtime.mainWindow) {
        void closeMainWindowAfterPlaybackSessionSave(runtime.mainWindow)
      }
    }
  })

  runtime.mainWindow.on('closed', () => {
    runtime.mainWindow = null
  })

  installAudioDeviceHotplugWatcher(runtime.mainWindow)

  runtime.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  runtime.mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    runtime.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    runtime.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function isAllowedAppNavigation(url: string): boolean {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    try {
      const target = new URL(url)
      const devServer = new URL(process.env['ELECTRON_RENDERER_URL'])
      return target.origin === devServer.origin
    } catch {
      return false
    }
  }

  const rendererUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
  return url === rendererUrl || url.startsWith(`${rendererUrl}#`)
}
