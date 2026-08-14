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

/*
 * Not every Electron IPC surface has been migrated to Tauri yet. Accessing an
 * unmigrated surface (`window.api.audioEngine.play()`) or method would throw a
 * TypeError and crash a page. These proxies return a heuristic stub instead so
 * the app keeps mounting; unimplemented calls log a warning for the migration.
 */
function makeStubMethod(surface: string, method: string): (...args: unknown[]) => unknown {
  return (..._args: unknown[]): unknown => {
    console.warn(`[tauri-bridge] ${surface}.${method}() not implemented yet`)
    const m = method.toLowerCase()
    if (m.startsWith('on')) return () => {}
    if (m.startsWith('list') || m.startsWith('search')) return Promise.resolve([])
    if (m.startsWith('get') || m.startsWith('load') || m.startsWith('fetch')) return Promise.resolve(null)
    if (m.startsWith('is') || m === 'toggle') return Promise.resolve(false)
    if (m === 'cancel' || m === 'clear' || m === 'reset' || m === 'delete') return Promise.resolve(true)
    if (m.startsWith('import') || m.startsWith('choose')) return Promise.resolve(null)
    return Promise.resolve(undefined)
  }
}

function makeStubSurface(name: string): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === 'then') return undefined
      if (typeof prop !== 'string') return Reflect.get(_target, prop)
      return makeStubMethod(name, prop)
    }
  })
}

function wrapSurface(name: string, surface: unknown): unknown {
  if (typeof surface !== 'object' || surface === null) return surface
  const target = surface as Record<string, unknown>
  return new Proxy(target, {
    get(_target, prop) {
      if (prop === 'then') return undefined
      if (typeof prop !== 'string') return Reflect.get(target, prop)
      const value = target[prop]
      if (value !== undefined) return value
      return makeStubMethod(name, prop)
    }
  })
}

function createBridgeApi(api: Record<string, unknown>): typeof window.api {
  return new Proxy(api, {
    get(target, prop) {
      if (prop === 'then') return undefined
      if (typeof prop !== 'string') return Reflect.get(target, prop)
      const value = target[prop]
      if (value !== undefined) return wrapSurface(prop, value)
      return makeStubSurface(prop)
    }
  }) as unknown as typeof window.api
}

export function installTauriHostBridge(): void {
  if (!isTauriRuntime()) return

  const existing = window.api
  const currentWindow = getCurrentWindow()

  window.api = createBridgeApi({
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
    fs: {
      scanMusicFiles: async () => [],
      readAudioFile: async () => ({ buffer: new ArrayBuffer(0), mimeType: '' }),
      getAudioFileUrl: async () => '',
      isAudioFileAuthorized: async () => false,
      onScanProgress: () => () => {}
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
      list: async () => [],
      installFromPath: async () => {
        throw new Error('插件安装未启用')
      },
      chooseAndInstall: async () => null,
      enable: async () => {
        throw new Error('插件系统未启用')
      },
      disable: async () => {
        throw new Error('插件系统未启用')
      },
      uninstall: async () => {
        throw new Error('插件系统未启用')
      },
      openLog: async () => {
        throw new Error('插件系统未启用')
      },
      getLog: async () => '',
      listIndex: async () => [],
      refreshIndex: async () => [],
      getIndexStatus: async () => ({
        sourceUrl: '',
        configuredSourceUrl: '',
        sourceKind: 'bundled',
        loadedFrom: 'bundled',
        lastFetchedAt: null,
        expiresAt: null,
        loadedAt: new Date(0).toISOString(),
        stale: false,
        expired: false,
        originVerified: false,
        officialSource: false,
        cacheFormat: null,
        trustStoreError: null,
        error: '插件市场未启用'
      }),
      installFromIndex: async () => {
        throw new Error('插件安装未启用')
      },
      setNativeDspParameters: async () => {
        throw new Error('插件系统未启用')
      },
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
  })
}
