import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'

export function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window
}

export function installTauriHostBridge(): void {
  if (!isTauriRuntime()) return

  const existing = window.api
  const currentWindow = getCurrentWindow()

  window.api = {
    ...existing,
    window: {
      minimize: () => void currentWindow.minimize(),
      toggleMaximize: () => {
        void currentWindow.isMaximized().then((maximized) =>
          maximized ? currentWindow.unmaximize() : currentWindow.maximize()
        )
      },
      close: () => void currentWindow.close()
    },
    dialog: {
      openFolder: async () => {
        const selected = await open({ directory: true, multiple: false })
        return typeof selected === 'string' ? selected : null
      }
    },
    shell: {
      showItemInFolder: async (filePath) => revealItemInDir(filePath),
      openPath: async (path) => {
        await openPath(path)
        return ''
      },
      openExternal: async (url) => openUrl(url)
    },
    app: {
      ...existing?.app,
      relaunch: async () => invoke('relaunch')
    }
  } as typeof window.api
}
