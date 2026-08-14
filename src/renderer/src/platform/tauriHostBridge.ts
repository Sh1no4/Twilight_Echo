import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import type {
  LocalLibraryScanStatus,
  LocalLibraryScanUpdate
} from '../../../shared/localLibraryScan'

export function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window
}

const idleScanStatus: LocalLibraryScanStatus = {
  jobId: null,
  mode: null,
  state: 'idle',
  current: 0,
  total: 0,
  parsedFileCount: 0,
  skippedUnchanged: 0,
  error: ''
}

const noopScanUpdate: LocalLibraryScanUpdate = {
  jobId: '',
  mode: 'startup',
  state: 'completed',
  libraryRevision: 0,
  exclusions: [],
  addedTracks: [],
  updatedTracks: [],
  removedFilePaths: [],
  parsedFileCount: 0,
  skippedUnchanged: 0
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
      relaunch: async () => invoke('relaunch'),
      onNavigate: () => () => {},
      consumePendingNavigation: async () => null,
      onSavePlaybackSession: () => () => {}
    },
    library: {
      onChanged: () => () => {},
      onCoversMissing: () => () => {},
      onScanProgress: () => () => {},
      onScanStatus: () => () => {},
      getScanStatus: async () => idleScanStatus,
      scanStartup: async () => noopScanUpdate,
      scanFull: async () => noopScanUpdate
    },
    plugins: {
      onChanged: () => () => {}
    },
    settings: {
      get: () => invoke('settings_get'),
      update: (patch) => invoke('settings_update', { patch }),
      onChanged: () => () => {},
      chooseCacheFolder: async () => null,
      chooseBackgroundImage: async () => null,
      importBackgroundImage: async () => null,
      exportBackup: async () => '{}',
      importBackup: () => invoke('settings_get'),
      getCacheSize: async () => 0,
      clearCache: async () => 0,
      getShortcutStatuses: async () => [],
      onPlayerShortcut: () => () => {}
    },
    data: {
      ...existing?.data,
      loadMusicLibrary: () => invoke('data_load_music_library'),
      saveMusicLibrary: (data) => invoke('data_save_music_library', { data }),
      loadPlaybackSession: async () => null,
      savePlaybackSession: async () => undefined,
      clearPlaybackSession: async () => undefined,
      loadPlaylists: async () => null,
      savePlaylists: async () => ({ version: 2, revision: 0, savedAt: new Date().toISOString(), data: [] })
    }
  } as unknown as typeof window.api
}
