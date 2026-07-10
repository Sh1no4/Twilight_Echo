import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { existsSync } from 'fs'
import { release } from 'os'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import {
  DEFAULT_MINI_PLAYER_STYLE_ID,
  EMPTY_MINI_PLAYER_STATE,
  normalizeMiniPlayerCommand,
  normalizeMiniPlayerSettings,
  normalizeMiniPlayerStateSnapshot,
  type MiniPlayerBootstrap,
  type MiniPlayerSettings,
  type MiniPlayerSettingsPatch,
  type MiniPlayerStateSnapshot
} from '../../shared/miniPlayer'
import { runtime } from '../core/runtime'
import { createSettingsSnapshot, writeAppSettings } from '../core/settings'
import { assertTrustedIpcSender, shouldAcceptIpcEvent } from '../security/electronSecurity.ts'

const MINI_PLAYER_EDGE_GAP = 22
const MINI_PLAYER_POSITION_SAVE_DELAY_MS = 350

let moveSaveTimer: NodeJS.Timeout | null = null

function supportsNativeRoundedMiniPlayerWindow(): boolean {
  if (process.platform !== 'win32') return false
  const build = Number(release().split('.')[2] ?? 0)
  return Number.isFinite(build) && build >= 22000
}

function getMiniPlayerIconPath(): string | undefined {
  const candidates =
    process.platform === 'win32'
      ? [
          is.dev
            ? join(app.getAppPath(), 'build', 'icon.ico')
            : join(process.resourcesPath, 'icon.ico')
        ]
      : [
          is.dev
            ? join(app.getAppPath(), 'build', 'icon.png')
            : join(process.resourcesPath, 'icon.png')
        ]
  return candidates.find((candidate) => existsSync(candidate))
}

function currentMiniPlayerSettings(): MiniPlayerSettings {
  return normalizeMiniPlayerSettings(runtime.appSettings.miniPlayer)
}

function getMiniPlayerFallbackColor(settings: MiniPlayerSettings): string {
  return (
    settings.profiles[settings.activeStyleId]?.background.fallbackColor ??
    settings.profiles[DEFAULT_MINI_PLAYER_STYLE_ID]?.background.fallbackColor ??
    '#11121d'
  )
}

function resolveInitialBounds(settings: MiniPlayerSettings): Electron.Rectangle {
  const hasSavedPosition = !(settings.windowX === -1 && settings.windowY === -1)
  const display = hasSavedPosition
    ? screen.getDisplayNearestPoint({ x: settings.windowX, y: settings.windowY })
    : runtime.mainWindow && !runtime.mainWindow.isDestroyed()
      ? screen.getDisplayMatching(runtime.mainWindow.getBounds())
      : screen.getPrimaryDisplay()
  const workArea = display.workArea
  const preferredX = hasSavedPosition
    ? settings.windowX
    : workArea.x + workArea.width - settings.windowWidth - MINI_PLAYER_EDGE_GAP
  const preferredY = hasSavedPosition
    ? settings.windowY
    : workArea.y + workArea.height - settings.windowHeight - MINI_PLAYER_EDGE_GAP

  return {
    x: clampNumber(preferredX, workArea.x, workArea.x + workArea.width - settings.windowWidth),
    y: clampNumber(preferredY, workArea.y, workArea.y + workArea.height - settings.windowHeight),
    width: settings.windowWidth,
    height: settings.windowHeight
  }
}

function fitMiniPlayerToWorkArea(win: BrowserWindow, settings: MiniPlayerSettings): void {
  const current = win.getBounds()
  const display = screen.getDisplayMatching(current)
  const workArea = display.workArea
  const width = Math.min(settings.windowWidth, workArea.width)
  const height = Math.min(settings.windowHeight, workArea.height)
  const x = clampNumber(current.x, workArea.x, workArea.x + workArea.width - width)
  const y = clampNumber(current.y, workArea.y, workArea.y + workArea.height - height)
  win.setBounds({ x, y, width, height }, false)
}

function applyMiniPlayerWindowSettings(settings: MiniPlayerSettings): void {
  const win = runtime.miniPlayerWindow
  if (!win || win.isDestroyed()) return

  if (settings.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'screen-saver')
  } else {
    win.setAlwaysOnTop(false)
  }
  if (supportsNativeRoundedMiniPlayerWindow()) {
    win.setBackgroundColor(getMiniPlayerFallbackColor(settings))
  }
  win.setMovable(!settings.positionLocked)
  fitMiniPlayerToWorkArea(win, settings)
}

function persistMiniPlayerPosition(win: BrowserWindow): void {
  if (win.isDestroyed() || runtime.miniPlayerWindow !== win) return
  const { x, y } = win.getBounds()
  runtime.appSettings = {
    ...runtime.appSettings,
    miniPlayer: {
      ...currentMiniPlayerSettings(),
      windowX: x,
      windowY: y
    }
  }
  writeAppSettings(runtime.appSettings)
}

function scheduleMiniPlayerPositionSave(win: BrowserWindow): void {
  if (moveSaveTimer) clearTimeout(moveSaveTimer)
  moveSaveTimer = setTimeout(() => {
    moveSaveTimer = null
    persistMiniPlayerPosition(win)
  }, MINI_PLAYER_POSITION_SAVE_DELAY_MS)
}

function sendMiniPlayerState(state: MiniPlayerStateSnapshot): void {
  const win = runtime.miniPlayerWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('miniPlayer:state', state)
}

function sendMiniPlayerSettings(settings = currentMiniPlayerSettings()): void {
  const win = runtime.miniPlayerWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('miniPlayer:settings', settings)
}

function enterMiniPlayerMode(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  runtime.mainWindow?.hide()
  sendMiniPlayerSettings()
  sendMiniPlayerState(runtime.latestMiniPlayerState ?? { ...EMPTY_MINI_PLAYER_STATE })
}

function createMiniPlayerWindow(): BrowserWindow {
  const settings = currentMiniPlayerSettings()
  const bounds = resolveInitialBounds(settings)
  const nativeRoundedWindow = supportsNativeRoundedMiniPlayerWindow()
  runtime.appSettings = {
    ...runtime.appSettings,
    miniPlayer: {
      ...settings,
      windowX: bounds.x,
      windowY: bounds.y
    }
  }

  const win = new BrowserWindow({
    ...bounds,
    title: 'Twilight Echo Mini Player',
    show: false,
    frame: false,
    transparent: !nativeRoundedWindow,
    backgroundColor: nativeRoundedWindow ? getMiniPlayerFallbackColor(settings) : '#00000000',
    alwaysOnTop: settings.alwaysOnTop,
    movable: !settings.positionLocked,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    hasShadow: nativeRoundedWindow,
    roundedCorners: true,
    thickFrame: nativeRoundedWindow,
    autoHideMenuBar: true,
    icon: getMiniPlayerIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  runtime.miniPlayerWindow = win

  win.setBackgroundColor(nativeRoundedWindow ? getMiniPlayerFallbackColor(settings) : '#00000000')

  applyMiniPlayerWindowSettings(settings)

  win.on('ready-to-show', () => {
    if (runtime.miniPlayerWindow !== win || win.isDestroyed()) return
    enterMiniPlayerMode(win)
  })

  win.on('move', () => scheduleMiniPlayerPositionSave(win))

  win.on('close', (event) => {
    if (runtime.forceQuit) {
      persistMiniPlayerPosition(win)
      return
    }
    event.preventDefault()
    restoreMainWindowFromMiniPlayer()
  })

  win.on('closed', () => {
    if (moveSaveTimer) {
      clearTimeout(moveSaveTimer)
      moveSaveTimer = null
    }
    if (runtime.miniPlayerWindow === win) runtime.miniPlayerWindow = null
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('did-finish-load', () => {
    sendMiniPlayerSettings()
    sendMiniPlayerState(runtime.latestMiniPlayerState ?? { ...EMPTY_MINI_PLAYER_STATE })
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    console.error(`[mini-player] renderer load failed: ${errorCode} ${errorDescription}`)
    restoreMainWindowFromMiniPlayer()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const rendererUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
    rendererUrl.searchParams.set('window', 'mini-player')
    if (nativeRoundedWindow) rendererUrl.searchParams.set('nativeCorners', '1')
    void win.loadURL(rendererUrl.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: nativeRoundedWindow
        ? { window: 'mini-player', nativeCorners: '1' }
        : { window: 'mini-player' }
    })
  }

  return win
}

export function showMiniPlayer(): MiniPlayerSettings {
  const existing = runtime.miniPlayerWindow
  if (existing && !existing.isDestroyed()) {
    if (!existing.webContents.isLoadingMainFrame()) enterMiniPlayerMode(existing)
  } else {
    createMiniPlayerWindow()
  }
  return currentMiniPlayerSettings()
}

export function hideMiniPlayerWindow(): void {
  const win = runtime.miniPlayerWindow
  if (win && !win.isDestroyed()) win.hide()
}

export function restoreMainWindowFromMiniPlayer(): void {
  const miniPlayerWindow = runtime.miniPlayerWindow
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    persistMiniPlayerPosition(miniPlayerWindow)
    miniPlayerWindow.destroy()
  }
  runtime.miniPlayerWindow = null

  const mainWindow = runtime.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function updateMiniPlayerSettings(patch: unknown): MiniPlayerSettings {
  const current = currentMiniPlayerSettings()
  const value =
    patch && typeof patch === 'object' && !Array.isArray(patch)
      ? (patch as Record<string, unknown>)
      : {}
  const candidate: Record<string, unknown> = { ...current }
  const allowedKeys: (keyof MiniPlayerSettingsPatch)[] = [
    'alwaysOnTop',
    'positionLocked',
    'activeStyleId',
    'profiles',
    'windowWidth',
    'windowHeight'
  ]
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) candidate[key] = value[key]
  }

  const settings = normalizeMiniPlayerSettings(candidate)
  runtime.appSettings = { ...runtime.appSettings, miniPlayer: settings }
  writeAppSettings(runtime.appSettings)
  applyMiniPlayerWindowSettings(settings)
  sendMiniPlayerSettings(settings)
  runtime.mainWindow?.webContents.send(
    'settings:changed',
    createSettingsSnapshot(runtime.appSettings, runtime.launchSettings)
  )
  return settings
}

function assertSenderWindow(
  event: IpcMainEvent | IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | null,
  capability: string
): void {
  assertTrustedIpcSender(event, capability)
  if (
    !expectedWindow ||
    expectedWindow.isDestroyed() ||
    event.sender.id !== expectedWindow.webContents.id
  ) {
    throw new Error(`${capability} rejected from unexpected window`)
  }
}

function shouldAcceptSenderWindow(
  event: IpcMainEvent | IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | null,
  capability: string
): boolean {
  if (!shouldAcceptIpcEvent(event, capability)) return false
  if (
    expectedWindow &&
    !expectedWindow.isDestroyed() &&
    event.sender.id === expectedWindow.webContents.id
  ) {
    return true
  }
  console.warn(`${capability} rejected from unexpected window`)
  return false
}

export function setupMiniPlayerIpc(): void {
  ipcMain.handle('miniPlayer:open', (event) => {
    assertSenderWindow(event, runtime.mainWindow, 'mini player host IPC')
    return showMiniPlayer()
  })

  ipcMain.on('miniPlayer:publishState', (event, rawState: unknown) => {
    if (!shouldAcceptSenderWindow(event, runtime.mainWindow, 'mini player state IPC')) return
    const state = normalizeMiniPlayerStateSnapshot(rawState)
    runtime.latestMiniPlayerState = state
    sendMiniPlayerState(state)
  })

  ipcMain.handle('miniPlayer:getBootstrap', (event): MiniPlayerBootstrap => {
    assertSenderWindow(event, runtime.miniPlayerWindow, 'mini player window IPC')
    return {
      state: runtime.latestMiniPlayerState ?? { ...EMPTY_MINI_PLAYER_STATE },
      settings: currentMiniPlayerSettings()
    }
  })

  ipcMain.on('miniPlayer:command', (event, rawCommand: unknown) => {
    if (!shouldAcceptSenderWindow(event, runtime.miniPlayerWindow, 'mini player command IPC')) {
      return
    }
    const command = normalizeMiniPlayerCommand(rawCommand)
    if (!command) return
    const mainWindow = runtime.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send('miniPlayer:command', command)
  })

  ipcMain.handle('miniPlayer:updateSettings', (event, patch: MiniPlayerSettingsPatch) => {
    assertSenderWindow(event, runtime.miniPlayerWindow, 'mini player settings IPC')
    return updateMiniPlayerSettings(patch)
  })

  ipcMain.on('miniPlayer:minimize', (event) => {
    if (!shouldAcceptSenderWindow(event, runtime.miniPlayerWindow, 'mini player window IPC')) {
      return
    }
    runtime.miniPlayerWindow?.minimize()
  })

  ipcMain.on('miniPlayer:returnToMain', (event) => {
    if (!shouldAcceptSenderWindow(event, runtime.miniPlayerWindow, 'mini player window IPC')) {
      return
    }
    restoreMainWindowFromMiniPlayer()
  })
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), Math.max(min, max)))
}
