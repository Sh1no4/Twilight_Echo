import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { runtime } from '../core/runtime'
import type { DesktopLyricsSettings } from '../core/types'
import type { DesktopLyricsTrackPayload } from '../../preload/types'
import { writeAppSettings } from '../core/settings'

function sendDesktopLyricsSnapshot(): void {
  if (!runtime.desktopLyricsWindow || runtime.desktopLyricsWindow.isDestroyed()) return

  runtime.desktopLyricsWindow.webContents.send('desktopLyrics:initSettings', runtime.appSettings.desktopLyrics)
  if (runtime.latestDesktopLyricsTrack) {
    runtime.desktopLyricsWindow.webContents.send('desktopLyrics:updateTrack', runtime.latestDesktopLyricsTrack)
  }
  runtime.desktopLyricsWindow.webContents.send('desktopLyrics:updateTime', runtime.latestDesktopLyricsTime)
}

function createDesktopLyricsWindow(): void {
  if (runtime.desktopLyricsWindow && !runtime.desktopLyricsWindow.isDestroyed()) return

  const dl = runtime.appSettings.desktopLyrics
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const x = dl.windowX >= 0 ? dl.windowX : Math.round((screenWidth - dl.windowWidth) / 2)
  const y = dl.windowY >= 0 ? dl.windowY : screenHeight - dl.windowHeight - 60

  runtime.desktopLyricsWindow = new BrowserWindow({
    width: dl.windowWidth,
    height: dl.windowHeight,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: dl.alwaysOnTop,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  runtime.desktopLyricsWindow.setAlwaysOnTop(dl.alwaysOnTop, 'screen-saver')
  if (dl.clickThrough) {
    runtime.desktopLyricsWindow.setIgnoreMouseEvents(true, { forward: true })
  }

  runtime.desktopLyricsWindow.on('ready-to-show', () => {
    runtime.desktopLyricsWindow?.show()
    sendDesktopLyricsSnapshot()
  })

  runtime.desktopLyricsWindow.on('closed', () => {
    runtime.desktopLyricsWindow = null
  })

  // Save position on move
  let moveSaveTimer: NodeJS.Timeout | null = null
  runtime.desktopLyricsWindow.on('move', () => {
    if (moveSaveTimer) clearTimeout(moveSaveTimer)
    moveSaveTimer = setTimeout(() => {
      if (!runtime.desktopLyricsWindow || runtime.desktopLyricsWindow.isDestroyed()) return
      const [px, py] = runtime.desktopLyricsWindow.getPosition()
      runtime.appSettings.desktopLyrics.windowX = px
      runtime.appSettings.desktopLyrics.windowY = py
      writeAppSettings(runtime.appSettings)
    }, 500)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    // In dev mode, we can't load a separate HTML file from the dev server easily
    // So load the file directly
    runtime.desktopLyricsWindow.loadFile(join(__dirname, '../../resources/desktop-lyrics.html'))
  } else {
    runtime.desktopLyricsWindow.loadFile(join(__dirname, '../../resources/desktop-lyrics.html'))
  }
}

export function showDesktopLyrics(): void {
  if (!runtime.desktopLyricsWindow || runtime.desktopLyricsWindow.isDestroyed()) {
    createDesktopLyricsWindow()
  } else {
    runtime.desktopLyricsWindow.show()
    sendDesktopLyricsSnapshot()
  }
}

export function hideDesktopLyrics(): void {
  if (runtime.desktopLyricsWindow && !runtime.desktopLyricsWindow.isDestroyed()) {
    runtime.desktopLyricsWindow.hide()
  }
}

function toggleDesktopLyrics(): boolean {
  const shouldShow = !runtime.appSettings.desktopLyrics.enabled
  runtime.appSettings.desktopLyrics.enabled = shouldShow
  writeAppSettings(runtime.appSettings)
  if (shouldShow) {
    showDesktopLyrics()
  } else {
    hideDesktopLyrics()
  }
  // Notify renderer
  runtime.mainWindow?.webContents.send('desktopLyrics:toggleChanged', shouldShow)
  return shouldShow
}

export function applyDesktopLyricsSettings(settings: DesktopLyricsSettings): void {
  runtime.appSettings.desktopLyrics = { ...settings }
  writeAppSettings(runtime.appSettings)
  if (runtime.desktopLyricsWindow && !runtime.desktopLyricsWindow.isDestroyed()) {
    // Update window properties
    runtime.desktopLyricsWindow.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver')
    runtime.desktopLyricsWindow.setIgnoreMouseEvents(settings.clickThrough, { forward: true })
    if (settings.windowWidth !== runtime.desktopLyricsWindow.getBounds().width ||
        settings.windowHeight !== runtime.desktopLyricsWindow.getBounds().height) {
      runtime.desktopLyricsWindow.setSize(settings.windowWidth, settings.windowHeight)
    }
    runtime.desktopLyricsWindow.webContents.send('desktopLyrics:initSettings', settings)
  }
}

export function setupDesktopLyricsIpc(): void {
  // Forward track/time updates from renderer to lyrics window
  ipcMain.on('desktopLyrics:updateTrack', (_event, data: DesktopLyricsTrackPayload) => {
    runtime.latestDesktopLyricsTrack = data
    if (runtime.desktopLyricsWindow && !runtime.desktopLyricsWindow.isDestroyed()) {
      runtime.desktopLyricsWindow.webContents.send('desktopLyrics:updateTrack', data)
    }
  })

  ipcMain.on('desktopLyrics:updateTime', (_event, time: number) => {
    runtime.latestDesktopLyricsTime = time
    if (runtime.desktopLyricsWindow && !runtime.desktopLyricsWindow.isDestroyed()) {
      runtime.desktopLyricsWindow.webContents.send('desktopLyrics:updateTime', time)
    }
  })

  ipcMain.on('desktopLyrics:updateSettings', (_event, settings: DesktopLyricsSettings) => {
    applyDesktopLyricsSettings(settings)
  })

  ipcMain.handle('desktopLyrics:toggle', async () => {
    return toggleDesktopLyrics()
  })

  ipcMain.handle('desktopLyrics:show', async () => {
    showDesktopLyrics()
  })

  ipcMain.handle('desktopLyrics:hide', async () => {
    hideDesktopLyrics()
  })

  // Lyrics window → main: get current position (for drag start)
  ipcMain.on('desktopLyrics:getPosition', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition()
      event.sender.send('desktopLyrics:position', { x, y })
    }
  })

  // Lyrics window → main: move window
  ipcMain.on('desktopLyrics:move', (event, data: { x: number; y: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.setPosition(data.x, data.y)
    }
  })

  // Lyrics window → main: request close (close button in toolbar)
  ipcMain.on('desktopLyrics:requestClose', () => {
    runtime.appSettings.desktopLyrics.enabled = false
    writeAppSettings(runtime.appSettings)
    hideDesktopLyrics()
    runtime.mainWindow?.webContents.send('desktopLyrics:toggleChanged', false)
  })
}
