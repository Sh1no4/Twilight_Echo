import { app, globalShortcut, Menu, nativeImage, Tray } from 'electron'
import { existsSync } from 'fs'
import { runtime } from '../core/runtime'
import { PLAYER_SHORTCUTS } from '../core/types'
import type { PlayerShortcutAction, PlayerShortcutStatus } from '../core/types'
import { buildPlayerShortcutStatuses } from '../core/shortcutStatus'
import { getAppIconPath } from '../app/window'
import { applyDiscordRpcSetting } from './discord'
import { applyLibraryWatchers } from '../library/watcher'
import { hideMiniPlayerWindow, restoreMainWindowFromMiniPlayer } from './miniPlayer'

let playerShortcutStatuses: PlayerShortcutStatus[] = buildPlayerShortcutStatuses(
  PLAYER_SHORTCUTS,
  false,
  () => false
)

export function sendPlayerShortcut(action: PlayerShortcutAction): void {
  if (runtime.mainWindow?.isDestroyed() === false) {
    runtime.mainWindow.webContents.send('player:shortcut', action)
  }
}

export function applyAutoLaunch(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath
    })
  } catch {
    // Some platforms / sandboxed environments don't support setLoginItemSettings
  }
}

export function unregisterPlayerShortcuts(): void {
  for (const shortcut of PLAYER_SHORTCUTS) {
    globalShortcut.unregister(shortcut.accelerator)
  }
}

export function registerPlayerShortcuts(): void {
  unregisterPlayerShortcuts()
  playerShortcutStatuses = buildPlayerShortcutStatuses(
    PLAYER_SHORTCUTS,
    runtime.appSettings.globalShortcuts,
    (accelerator) => {
      const shortcut = PLAYER_SHORTCUTS.find((item) => item.accelerator === accelerator)
      if (!shortcut) return false
      const ok = globalShortcut.register(shortcut.accelerator, () => {
        sendPlayerShortcut(shortcut.action)
      })
      if (!ok) {
        console.warn(`全局快捷键注册失败：${shortcut.label} ${shortcut.accelerator}`)
      }
      return ok
    }
  )
}

export function getPlayerShortcutStatuses(): PlayerShortcutStatus[] {
  return playerShortcutStatuses.map((status) => ({ ...status }))
}

export function resetPlayerShortcutStatuses(): void {
  playerShortcutStatuses = buildPlayerShortcutStatuses(PLAYER_SHORTCUTS, false, () => false)
}

export function createTray(): void {
  if (runtime.tray) return

  const iconPath = getAppIconPath()
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()
  runtime.tray = new Tray(icon)
  runtime.tray.setToolTip('Twilight Echo')
  runtime.tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示 Twilight Echo',
        click: () => {
          restoreMainWindowFromMiniPlayer()
        }
      },
      {
        label: '隐藏窗口',
        click: () => {
          runtime.mainWindow?.hide()
          hideMiniPlayerWindow()
        }
      },
      { type: 'separator' },
      {
        label: '播放/暂停',
        click: () => sendPlayerShortcut('playPause')
      },
      {
        label: '上一首',
        click: () => sendPlayerShortcut('previous')
      },
      {
        label: '下一首',
        click: () => sendPlayerShortcut('next')
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          runtime.forceQuit = true
          app.quit()
        }
      }
    ])
  )
  runtime.tray.on('double-click', () => {
    restoreMainWindowFromMiniPlayer()
  })
}

export function destroyTray(): void {
  runtime.tray?.destroy()
  runtime.tray = null
}

export function syncTrayState(): void {
  if (runtime.appSettings.closeToTray) {
    createTray()
  } else {
    destroyTray()
  }
}

export function applyRuntimeSettings(): void {
  applyAutoLaunch(runtime.appSettings.launchAtLogin)
  applyDiscordRpcSetting(runtime.appSettings.discordRpcEnabled)
  applyLibraryWatchers(runtime.appSettings.libraryFolders, runtime.appSettings.watchLibrary)
  registerPlayerShortcuts()
  syncTrayState()
}
