import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
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

export function createWindow(): void {
  runtime.mainWindow = new BrowserWindow({
    width: 1495,
    height: 883,
    show: false,
    frame: false,
    backgroundColor: getWindowBackgroundColor(runtime.appSettings),
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
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

  runtime.mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    runtime.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    runtime.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
