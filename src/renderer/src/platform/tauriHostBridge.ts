import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  TWILIGHT_DEFAULT_THEME,
  createDefaultThemeLibraryDocument,
  type ThemeLibrarySnapshot,
  type ThemeTone
} from '../../../shared/theme.ts'
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

const epochIso = new Date(0).toISOString()

function emptyThemeLibrarySnapshot(): ThemeLibrarySnapshot {
  return {
    version: 2,
    revision: 0,
    savedAt: epochIso,
    data: createDefaultThemeLibraryDocument()
  }
}

function resolveSystemTone(): ThemeTone {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'pureWhite'
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
    themes: {
      getSystemTone: async (): Promise<ThemeTone> => resolveSystemTone(),
      getBootstrap: async () => ({
        library: emptyThemeLibrarySnapshot(),
        defaultTheme: TWILIGHT_DEFAULT_THEME
      }),
      list: async () => emptyThemeLibrarySnapshot(),
      save: async () => emptyThemeLibrarySnapshot(),
      delete: async () => emptyThemeLibrarySnapshot(),
      setActive: async () => emptyThemeLibrarySnapshot(),
      setWindowInheritance: async () => emptyThemeLibrarySnapshot(),
      importTheme: async () => null,
      exportTheme: async () => null,
      importAsset: async () => null,
      validateAssets: async () => true,
      copyAssets: async () => undefined,
      onChanged: () => () => {},
      onSystemToneChanged: () => () => {}
    },
    ncmCloud: {
      chooseUploadFiles: async () => [],
      upload: async () => ({ transferId: '', handle: '', fileName: '', accepted: true }),
      download: async () => ({ transferId: '', fileName: '', accepted: false, cancelled: false }),
      cancel: async () => true,
      onProgress: () => () => {}
    },
    miniPlayer: {
      open: async () => null,
      getBootstrap: async () => null,
      command: () => {},
      updateSettings: async (patch) => patch,
      chooseBackgroundImage: async () => null,
      minimize: () => {},
      returnToMain: () => {},
      publishState: () => {},
      onState: () => () => {},
      onSettings: () => () => {},
      onMotionPreference: () => () => {},
      onCommand: () => () => {}
    },
    providers: {
      list: async () => [],
      call: async () => {
        throw new Error('Provider 未启用')
      },
      cancel: () => {}
    },
    extensions: {
      list: async () => [],
      executeCommand: async () => undefined,
      readThemeStylesheet: async () => ''
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
