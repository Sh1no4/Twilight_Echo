import { app, shell, BrowserWindow, ipcMain, dialog, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'crypto'
import { basename, dirname, join, resolve } from 'path'
import { readFileSync, existsSync } from 'fs'
import { readFile, writeFile, rm, stat } from 'fs/promises'
import { parseFile } from 'music-metadata'
import { importLyricsFromDialog } from '../lyrics/importLyrics.ts'
import { saveLyricsFromDialog } from '../lyrics/saveLyrics.ts'
import {
  assertOnlineLyricsRateLimit,
  searchOnlineLyrics,
  type OnlineLyricsSearchResult
} from '../lyrics/onlineLyricsSearch.ts'
import {
  DEFAULT_PLAYBACK_BOOKMARKS,
  isPlaybackBookmarksDocument,
  type PlaybackBookmarksDocument
} from '../../shared/playbackBookmarks.ts'
import { createDuplicateDetectionIpcHandlers } from '../library/duplicateDetectionIpc.ts'
import { runtime, type DiscordActivityData } from '../core/runtime'
import type { AppSettings, PlaybackSession } from '../core/types'
import {
  compareVersions,
  createSettingsSnapshot,
  getDefaultCachePath,
  normalizeAppSettings
} from '../core/settings'
import { exportAppSettingsForBackup, importAppSettingsFromBackup } from '../core/settingsBackup'
import { ensureMusicCacheDirectories } from '../cache/ncmCache'
import { clearManagedMusicCache, getManagedMusicCacheSize } from '../cache/musicCacheLayout.ts'
import {
  getLegacyCoverCacheDir,
  getCoverCacheDir,
  importBackgroundImageBuffer,
  importBackgroundImage,
  normalizeBackgroundImageImportData,
  readCachedCover
} from '../library/coverCache'
import { encodeAudioFileUrlPath, findLyricsInDir, getMimeType } from '../library/scan'
import {
  LocalLibraryIndexCoordinator,
  toLocalLibraryScanUpdate
} from '../library/libraryIndexCoordinator.ts'
import { getLibraryWatcherStatusSnapshot } from '../library/watcher.ts'
import { createTagWriteIpcHandlers } from '../library/tagWriteIpc.ts'
import { sleepTimerService } from '../sleepTimer.ts'
import { registerSleepTimerIpc } from './sleepTimerIpc.ts'
import { synchronizeLocalLibraryFileIndexRevision } from '../library/fileIndex.ts'
import type { LocalLibraryScanRunner } from '../library/libraryScanServiceClient.ts'
import {
  MAX_MUSIC_LIBRARY_BYTES,
  assertMusicLibraryRevision,
  beginLibraryPathMutation,
  collectLibraryTrackPathKeys,
  createMusicLibraryDocument,
  loadMusicLibraryDocument,
  normalizeLibraryFilePath,
  persistMusicLibraryDocument,
  replaceActiveLibraryExclusions,
  restoreLibraryExclusions,
  type LoadedMusicLibraryDocument
} from '../library/libraryRepository.ts'
import {
  commitLocalLibraryRemoval,
  createLocalLibraryRemovalJournal,
  getLocalLibraryRemovalJournalPath,
  recoverLocalLibraryRemoval,
  recoverLocalLibraryRemovalResult
} from '../library/removal.ts'
import type {
  LocalLibraryRemoveRequest,
  LocalLibraryRemoveResult,
  LocalLibraryRemovalMode,
  LocalLibraryRestoreRequest,
  LocalLibrarySnapshotInput,
  LocalLibraryTrackSelection,
  LocalMusicLibraryDocument
} from '../../shared/localLibrary.ts'
import type {
  LocalLibraryScanStatus,
  LocalLibraryWorkerScanRequest
} from '../../shared/localLibraryScan.ts'
import {
  isSecureValueEnvelope,
  protectString,
  redactSensitiveText,
  unprotectString
} from '../security/secureStorage.ts'
import { normalizeIpcString, stringifyJsonForIpcStorage } from '../security/ipcValidation.ts'
import { assertTrustedIpcSender, shouldAcceptIpcEvent } from '../security/electronSecurity.ts'
import { updateDiscordActivity, clearDiscordActivity } from '../integrations/discord'
import { updateAppSettings, relaunchApplication } from '../audio/state'
import { resolvePlaybackSessionSave } from '../app/window'
import type { RendererClosePersistenceOutcome } from '../../shared/closePersistence.ts'
import { getPlayerShortcutStatuses } from '../integrations/shortcutsTray'
import {
  resolveAuthorizedAudioFile,
  resolveAuthorizedCacheRoot,
  resolveAuthorizedImpulseResponseFile,
  resolveAuthorizedLibraryDirectory,
  resolveAuthorizedLibraryRootSettings,
  resolveAuthorizedOpenPath,
  resolveAuthorizedShowItemPath,
  filterAuthorizedLibraryRoots,
  grantUserSelectedCacheRoot,
  grantUserSelectedLibraryRoot
} from '../security/localPaths'
import { PersistentJsonFileError, type JsonFileLoadResult } from '../persistence/jsonFile.ts'
import { VersionedDataStore } from '../persistence/versionedDataStore.ts'
import {
  PersistentDataRevisionConflictError,
  createPersistentDataRevisionConflictResponse
} from '../../shared/versionedPersistence.ts'
import {
  isLyricsManagementDocument,
  type LyricsManagementDocument
} from '../../shared/lyricsManagement.ts'
import { playbackSessionCueRangesAreValid } from '../../shared/cue.ts'

const MAX_PLAYBACK_SESSION_BYTES = 2 * 1024 * 1024
const MAX_PLAYLISTS_BYTES = 20 * 1024 * 1024
const MAX_LYRICS_MANAGEMENT_BYTES = 8 * 1024 * 1024
const MAX_PLAYBACK_BOOKMARKS_BYTES = 4 * 1024 * 1024
const MAX_DATA_URL_BYTES = 8 * 1024 * 1024
const MAX_LOCAL_PATH_LENGTH = 4096
const MAX_LYRICS_FILE_NAME_LENGTH = 512
const MAX_BACKGROUND_IMAGE_FILE_NAME_LENGTH = 255
const MAX_SETTINGS_PATCH_BYTES = 512 * 1024
const MAX_SETTINGS_BACKUP_BYTES = 2 * 1024 * 1024
const MAX_DISCORD_ACTIVITY_BYTES = 16 * 1024
const MAX_EXTERNAL_URL_LENGTH = 8192
const MAX_NCM_COOKIE_BYTES = 16 * 1024
const MAX_PLAYBACK_SAVE_REQUEST_ID_LENGTH = 128
const MAX_PLAYBACK_SAVE_ERROR_LENGTH = 2048
const MAX_LIBRARY_MUTATION_ITEMS = 10_000

const persistenceNotifications = new Set<string>()
let musicLibraryTransactionChain: Promise<void> = Promise.resolve()

async function authorizeSettingsPathPatch(
  patch: Partial<AppSettings>
): Promise<Partial<AppSettings>> {
  const authorizedPatch: Partial<AppSettings> = { ...patch }
  const normalizedSettings = normalizeAppSettings({ ...runtime.appSettings, ...patch })

  if (
    Object.prototype.hasOwnProperty.call(patch, 'cachePath') ||
    Object.prototype.hasOwnProperty.call(patch, 'musicCachePath')
  ) {
    const requestedCachePath = normalizedSettings.musicCachePath || getDefaultCachePath()
    if (resolve(requestedCachePath) === resolve(getDefaultCachePath())) {
      ensureMusicCacheDirectories(requestedCachePath)
      await grantUserSelectedCacheRoot(requestedCachePath)
    }
    const cachePath = await resolveAuthorizedCacheRoot(requestedCachePath)
    authorizedPatch.cachePath = cachePath
    authorizedPatch.musicCachePath = cachePath
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'libraryFolders')) {
    authorizedPatch.libraryFolders = await resolveAuthorizedLibraryRootSettings(
      normalizedSettings.libraryFolders
    )
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'audioProcessing')) {
    const audioProcessing = { ...normalizedSettings.audioProcessing }
    if (audioProcessing.convolverIrPath) {
      audioProcessing.convolverIrPath = await resolveAuthorizedImpulseResponseFile(
        audioProcessing.convolverIrPath
      )
    }
    authorizedPatch.audioProcessing = audioProcessing
  }

  return authorizedPatch
}

export function setupDataIpc(): void {
  ipcMain.on('window:minimize', (event) => {
    if (!shouldAcceptIpcEvent(event, 'window control IPC')) return
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:toggleMaximize', (event) => {
    if (!shouldAcceptIpcEvent(event, 'window control IPC')) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    if (!shouldAcceptIpcEvent(event, 'window control IPC')) return
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('dialog:openFolder', async (event) => {
    assertTrustedIpcSender(event, 'dialog IPC')
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const folder = await grantUserSelectedLibraryRoot(result.filePaths[0])
    const libraryFolders = await resolveAuthorizedLibraryRootSettings([
      ...runtime.appSettings.libraryFolders,
      folder
    ])
    await updateAppSettings({ libraryFolders })
    return folder
  })

  ipcMain.handle('settings:chooseBackgroundImage', async (event) => {
    assertTrustedIpcSender(event, 'settings IPC')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: '背景图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    }
    const result =
      win && !win.isDestroyed()
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return importBackgroundImage(result.filePaths[0])
  })

  ipcMain.handle(
    'settings:importBackgroundImage',
    async (event, fileName: string, data: unknown) => {
      assertTrustedIpcSender(event, 'settings IPC')
      const buffer = normalizeBackgroundImageImportData(data)
      if (typeof fileName !== 'string' || !buffer) return null
      return importBackgroundImageBuffer(
        normalizeIpcString(
          fileName,
          'background image file name',
          MAX_BACKGROUND_IMAGE_FILE_NAME_LENGTH
        ),
        buffer
      )
    }
  )

  ipcMain.handle('app:relaunch', (event) => {
    assertTrustedIpcSender(event, 'app IPC')
    setTimeout(() => {
      relaunchApplication()
    }, 0)
    return true
  })

  ipcMain.handle(
    'app:playback-session-saved',
    async (event, requestId: string, outcome: unknown) => {
      assertTrustedIpcSender(event, 'app IPC')
      resolvePlaybackSessionSave(
        normalizeIpcString(
          requestId,
          'playback session save request id',
          MAX_PLAYBACK_SAVE_REQUEST_ID_LENGTH
        ),
        normalizeRendererClosePersistenceOutcome(outcome)
      )
      return true
    }
  )

  ipcMain.handle('shell:openPath', async (event, targetPath: string) => {
    assertTrustedIpcSender(event, 'shell IPC')
    const resolvedPath = await resolveAuthorizedOpenPath(
      normalizeLocalPath(targetPath, 'open path')
    )
    return await shell.openPath(resolvedPath)
  })

  ipcMain.handle('shell:openExternal', async (event, url: string) => {
    assertTrustedIpcSender(event, 'shell IPC')
    if (!isSafeExternalUrl(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle('discord:updateActivity', (event, data: DiscordActivityData) => {
    assertTrustedIpcSender(event, 'Discord IPC')
    stringifyJsonForIpcStorage(data, 'Discord activity', MAX_DISCORD_ACTIVITY_BYTES)
    if (runtime.appSettings.discordRpcEnabled) updateDiscordActivity(data)
    return true
  })

  ipcMain.handle('discord:clearActivity', (event) => {
    assertTrustedIpcSender(event, 'Discord IPC')
    clearDiscordActivity()
    return true
  })

  ipcMain.handle('app:checkForUpdates', async (event) => {
    assertTrustedIpcSender(event, 'app IPC')
    try {
      const currentVersion = app.getVersion()
      const response = await fetch(
        'https://api.github.com/repos/asenyarzc-cpu/Twilight_Echo/releases/latest',
        { headers: { 'User-Agent': 'TwilightEcho-Updater' } }
      )
      if (!response.ok) return { hasUpdate: false, currentVersion, error: 'network' }
      const release = (await response.json()) as {
        tag_name?: string
        html_url?: string
        body?: string
      }
      const latestTag = (release.tag_name || '').replace(/^v/, '')
      if (!latestTag) return { hasUpdate: false, currentVersion }
      const hasUpdate = compareVersions(latestTag, currentVersion) > 0
      return {
        hasUpdate,
        currentVersion,
        latestVersion: latestTag,
        releaseUrl: release.html_url || '',
        releaseNotes: release.body || ''
      }
    } catch {
      return { hasUpdate: false, currentVersion: app.getVersion(), error: 'network' }
    }
  })

  ipcMain.handle('settings:get', async (event) => {
    assertTrustedIpcSender(event, 'settings IPC')
    return createSettingsSnapshot(runtime.appSettings, runtime.launchSettings)
  })

  ipcMain.handle('settings:update', async (event, patch: Partial<AppSettings>) => {
    assertTrustedIpcSender(event, 'settings IPC')
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('Settings patch must be an object')
    }
    stringifyJsonForIpcStorage(patch, 'settings patch', MAX_SETTINGS_PATCH_BYTES)
    return await updateAppSettings(await authorizeSettingsPathPatch(patch))
  })

  ipcMain.handle('settings:export', async (event) => {
    assertTrustedIpcSender(event, 'settings IPC')
    return exportAppSettingsForBackup(runtime.appSettings)
  })

  ipcMain.handle('settings:import', async (event, json: string) => {
    assertTrustedIpcSender(event, 'settings IPC')
    if (typeof json !== 'string') {
      throw new Error('Settings backup must be a JSON string')
    }
    if (Buffer.byteLength(json, 'utf-8') > MAX_SETTINGS_BACKUP_BYTES) {
      throw new Error('Settings backup is too large')
    }
    const importedSettings = importAppSettingsFromBackup(
      json,
      runtime.appSettings,
      normalizeAppSettings
    )
    return await updateAppSettings(await authorizeSettingsPathPatch(importedSettings))
  })

  ipcMain.handle('settings:getShortcutStatuses', async (event) => {
    assertTrustedIpcSender(event, 'settings IPC')
    return getPlayerShortcutStatuses()
  })

  ipcMain.handle('settings:chooseCacheFolder', async (event) => {
    assertTrustedIpcSender(event, 'settings IPC')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const options: Electron.OpenDialogOptions = {
      title: '选择缓存位置',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    ensureMusicCacheDirectories(result.filePaths[0])
    return await grantUserSelectedCacheRoot(result.filePaths[0])
  })

  ipcMain.handle('settings:getCacheSize', async (event) => {
    assertTrustedIpcSender(event, 'settings IPC')
    const cachePath = await resolveAuthorizedCacheRoot(
      runtime.appSettings.musicCachePath || getDefaultCachePath()
    )
    return await getManagedMusicCacheSize(cachePath)
  })

  ipcMain.handle('settings:clearCache', async (event) => {
    assertTrustedIpcSender(event, 'settings IPC')
    const cachePath = await resolveAuthorizedCacheRoot(
      runtime.appSettings.musicCachePath || getDefaultCachePath()
    )
    try {
      await clearManagedMusicCache(cachePath)
      await rm(getLegacyCoverCacheDir(), { recursive: true, force: true })
    } catch (error) {
      console.warn('清理缓存失败：', error)
    }
    ensureMusicCacheDirectories(cachePath)
    return await getManagedMusicCacheSize(cachePath)
  })

  ipcMain.handle('shell:showItemInFolder', async (event, filePath: string) => {
    assertTrustedIpcSender(event, 'shell IPC')
    const resolvedPath = await resolveAuthorizedShowItemPath(
      normalizeLocalPath(filePath, 'show item path')
    )
    shell.showItemInFolder(resolvedPath)
  })

  ipcMain.handle('fs:scanMusicFiles', async (event, folderPath: string) => {
    assertTrustedIpcSender(event, 'filesystem IPC')
    const resolvedPath = await resolveAuthorizedLibraryDirectory(
      normalizeLocalPath(folderPath, 'music folder path')
    )
    const scanService = runtime.localLibraryScanService
    if (!scanService) throw new Error('Local library scan service is unavailable')
    const exclusions = await enqueueMusicLibraryTransaction(async () =>
      loadMusicLibraryForTransaction(MUSIC_LIBRARY_FILE).document.exclusions.map(
        (exclusion) => exclusion.filePath
      )
    )
    const request: LocalLibraryWorkerScanRequest = {
      mode: 'full',
      roots: [resolvedPath],
      knownIdentities: [],
      knownTrackPaths: [],
      excludedPaths: exclusions,
      coverCacheDir: getCoverCacheDir()
    }
    const result = await scanService.scan(randomUUID(), request, (progress) => {
      event.sender.send('fs:scanProgress', {
        current: progress.current,
        total: progress.total,
        phase: progress.phase
      })
    })
    if (result.cancelled) return []
    return result.parsedTracks
  })

  ipcMain.handle('fs:readAudioFile', async (event, filePath: string) => {
    assertTrustedIpcSender(event, 'filesystem IPC')
    const resolvedPath = await resolveAuthorizedAudioFile(
      normalizeLocalPath(filePath, 'audio file path')
    )
    const buffer = await readFile(resolvedPath)
    return {
      buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      mimeType: getMimeType(resolvedPath)
    }
  })

  ipcMain.handle('fs:getAudioFileUrl', async (event, filePath: string) => {
    assertTrustedIpcSender(event, 'filesystem IPC')
    const resolvedPath = await resolveAuthorizedAudioFile(
      normalizeLocalPath(filePath, 'audio file path')
    )
    return `twilight-audio:///${encodeAudioFileUrlPath(resolvedPath)}`
  })

  ipcMain.handle('fs:isAudioFileAuthorized', async (event, filePath: string) => {
    assertTrustedIpcSender(event, 'filesystem IPC')
    try {
      await resolveAuthorizedAudioFile(normalizeLocalPath(filePath, 'audio file path'))
      return true
    } catch {
      return false
    }
  })

  const userDataPath = app.getPath('userData')
  const MUSIC_LIBRARY_FILE = join(userDataPath, 'music-library.json')
  const NCM_COOKIE_FILE = join(userDataPath, 'ncm-cookie.json')
  const PLAYBACK_SESSION_FILE = join(userDataPath, 'playback-session.json')
  const PLAYLISTS_FILE = join(userDataPath, 'playlists.json')
  const LYRICS_MANAGEMENT_FILE = join(userDataPath, 'lyrics-management.json')
  const PLAYBACK_BOOKMARKS_FILE = join(userDataPath, 'playback-bookmarks.json')
  const tagWriteIpc = createTagWriteIpcHandlers({
    backupRoot: join(userDataPath, 'tag-backups'),
    assertTrustedSender: (event) =>
      assertTrustedIpcSender(event as IpcMainInvokeEvent, 'library tag mutation IPC'),
    authorizeAudioFile: async (filePath) =>
      await resolveAuthorizedAudioFile(normalizeLocalPath(filePath, 'tag audio file path')),
    redactError: (error) =>
      redactSensitiveText(error instanceof Error ? error.message : String(error))
  })
  const duplicateDetectionIpc = createDuplicateDetectionIpcHandlers({
    assertTrustedSender: (event) =>
      assertTrustedIpcSender(event as IpcMainInvokeEvent, 'library duplicate detection IPC'),
    loadTracks: () => loadMusicLibraryDocument(MUSIC_LIBRARY_FILE).document.tracks,
    authorizeAudioFile: async (filePath) =>
      await resolveAuthorizedAudioFile(
        normalizeLocalPath(filePath, 'duplicate detection audio file')
      )
  })
  const playbackSessionStore = new VersionedDataStore<PlaybackSession | null>({
    filePath: PLAYBACK_SESSION_FILE,
    label: 'playback session',
    maxBytes: MAX_PLAYBACK_SESSION_BYTES,
    isData: (value): value is PlaybackSession | null =>
      value === null || isPlaybackSessionFile(value),
    isLegacy: isPlaybackSessionFile,
    onRecovery: (result) =>
      reportPersistentDataRecovery('Playback session', PLAYBACK_SESSION_FILE, result)
  })
  const playlistsStore = new VersionedDataStore<unknown[]>({
    filePath: PLAYLISTS_FILE,
    label: 'playlists',
    maxBytes: MAX_PLAYLISTS_BYTES,
    isData: Array.isArray,
    isLegacy: Array.isArray,
    onRecovery: (result) => reportPersistentDataRecovery('Playlists', PLAYLISTS_FILE, result)
  })
  const lyricsManagementStore = new VersionedDataStore<LyricsManagementDocument>({
    filePath: LYRICS_MANAGEMENT_FILE,
    label: 'lyrics management',
    maxBytes: MAX_LYRICS_MANAGEMENT_BYTES,
    isData: isLyricsManagementDocument,
    isLegacy: isLyricsManagementDocument,
    onRecovery: (result) =>
      reportPersistentDataRecovery('Lyrics management', LYRICS_MANAGEMENT_FILE, result)
  })
  const playbackBookmarksStore = new VersionedDataStore<PlaybackBookmarksDocument>({
    filePath: PLAYBACK_BOOKMARKS_FILE,
    label: 'playback bookmarks',
    maxBytes: MAX_PLAYBACK_BOOKMARKS_BYTES,
    isData: isPlaybackBookmarksDocument,
    isLegacy: isPlaybackBookmarksDocument,
    onRecovery: (result) =>
      reportPersistentDataRecovery('Playback bookmarks', PLAYBACK_BOOKMARKS_FILE, result)
  })

  try {
    const removalRecovery = recoverLocalLibraryRemoval(MUSIC_LIBRARY_FILE)
    if (removalRecovery.recovered) {
      reportLocalLibraryRemovalRecovery(MUSIC_LIBRARY_FILE, removalRecovery.removedFilePaths)
    }
    const initialLibrary = loadMusicLibraryDocument(MUSIC_LIBRARY_FILE)
    replaceActiveLibraryExclusions(initialLibrary.document.exclusions)
    if (initialLibrary.migrated) {
      persistMusicLibraryDocumentWithIndex(MUSIC_LIBRARY_FILE, initialLibrary.document)
    }
    if (initialLibrary.recovery) {
      reportPersistentDataRecovery('Music library', MUSIC_LIBRARY_FILE, initialLibrary.recovery)
    }
  } catch (error) {
    console.error(
      '[persistence] failed to initialize music library exclusions:',
      redactSensitiveText(errorMessage(error))
    )
    showPersistenceMessage(
      `failed:${getLocalLibraryRemovalJournalPath(MUSIC_LIBRARY_FILE)}`,
      'error',
      '音乐库回收站恢复失败',
      `${redactSensitiveText(errorMessage(error))}\n\n恢复日志：${getLocalLibraryRemovalJournalPath(
        MUSIC_LIBRARY_FILE
      )}`
    )
  }

  const localLibraryIndexCoordinator = new LocalLibraryIndexCoordinator({
    libraryFilePath: MUSIC_LIBRARY_FILE,
    scanRunner: runtime.localLibraryScanService ?? unavailableLocalLibraryScanRunner(),
    enqueueTransaction: enqueueMusicLibraryTransaction,
    loadDocument: () => loadMusicLibraryForTransaction(MUSIC_LIBRARY_FILE),
    persistDocument: (document) => persistMusicLibraryDocument(MUSIC_LIBRARY_FILE, document),
    resolveRoots: async (folders) => {
      const requested = Array.from(new Set([...folders, ...runtime.appSettings.libraryFolders]))
      return await filterAuthorizedLibraryRoots(requested)
    },
    getCoverCacheDir,
    watcherDebounceMs: runtime.libraryWatcherDebounceMs
  })
  runtime.localLibraryIndexCoordinator = localLibraryIndexCoordinator
  runtime.localLibraryScanService?.on('service-error', (error) => {
    const message = redactSensitiveText(errorMessage(error))
    console.error('[library] background scan worker failed:', message)
    localLibraryIndexCoordinator.reportServiceError(new Error(message))
  })
  localLibraryIndexCoordinator.on('progress', (progress) => {
    runtime.mainWindow?.webContents.send('library:scan-progress', progress)
  })
  localLibraryIndexCoordinator.on('status', (status: LocalLibraryScanStatus) => {
    runtime.mainWindow?.webContents.send('library:scan-status', {
      ...status,
      error: redactSensitiveText(status.error)
    })
  })
  localLibraryIndexCoordinator.on('watch-result', (result) => {
    runtime.mainWindow?.webContents.send('library:changed', {
      kind: 'scan',
      update: toLocalLibraryScanUpdate(result)
    })
  })
  localLibraryIndexCoordinator.on('scan-error', (error) => {
    console.warn(
      '[library] incremental watcher scan failed:',
      redactSensitiveText(errorMessage(error))
    )
  })

  ipcMain.handle('library:scanStartup', async (event) => {
    assertTrustedIpcSender(event, 'library scan IPC')
    return await runLocalLibraryScanOperation(async () =>
      toLocalLibraryScanUpdate(await localLibraryIndexCoordinator.scanStartup())
    )
  })

  ipcMain.handle('library:scanFull', async (event) => {
    assertTrustedIpcSender(event, 'library scan IPC')
    return await runLocalLibraryScanOperation(async () =>
      toLocalLibraryScanUpdate(await localLibraryIndexCoordinator.scanFull())
    )
  })

  ipcMain.handle('library:getScanStatus', async (event) => {
    assertTrustedIpcSender(event, 'library scan IPC')
    const status = localLibraryIndexCoordinator.getStatus()
    return { ...status, error: redactSensitiveText(status.error) }
  })

  ipcMain.handle('library:getWatcherStatus', async (event) => {
    assertTrustedIpcSender(event, 'library scan IPC')
    return getLibraryWatcherStatusSnapshot(
      runtime.appSettings.libraryFolders,
      runtime.appSettings.watchLibrary
    )
  })

  ipcMain.handle('library:pauseScan', async (event) => {
    assertTrustedIpcSender(event, 'library scan IPC')
    return localLibraryIndexCoordinator.pause()
  })

  ipcMain.handle('library:resumeScan', async (event) => {
    assertTrustedIpcSender(event, 'library scan IPC')
    return localLibraryIndexCoordinator.resume()
  })

  ipcMain.handle('library:cancelScan', async (event) => {
    assertTrustedIpcSender(event, 'library scan IPC')
    return localLibraryIndexCoordinator.cancel()
  })

  ipcMain.handle(
    'data:saveMusicLibrary',
    async (event, library: LocalLibrarySnapshotInput | unknown[]) => {
      assertTrustedIpcSender(event, 'data IPC')
      const snapshot = normalizeMusicLibrarySnapshot(library)
      snapshot.folders = await filterAuthorizedLibraryRoots(snapshot.folders)
      stringifyJsonForIpcStorage(snapshot, 'music library', MAX_MUSIC_LIBRARY_BYTES)
      return await enqueueMusicLibraryTransaction(async () => {
        const loaded = loadMusicLibraryForTransaction(MUSIC_LIBRARY_FILE)
        assertMusicLibraryRevision(snapshot.revision, loaded.document.revision)
        const nextDocument = createMusicLibraryDocument(snapshot, loaded.document.exclusions)
        nextDocument.revision = loaded.document.revision + 1
        persistMusicLibraryDocumentWithIndex(MUSIC_LIBRARY_FILE, nextDocument)
        return nextDocument
      })
    }
  )

  ipcMain.handle('data:loadMusicLibrary', async (event) => {
    assertTrustedIpcSender(event, 'data IPC')
    return await enqueueMusicLibraryTransaction(async () => {
      const loaded = loadMusicLibraryForTransaction(MUSIC_LIBRARY_FILE)
      const document = loaded.document
      const authorizedFolders = await filterAuthorizedLibraryRoots(document.folders)
      let changed =
        loaded.migrated ||
        authorizedFolders.length !== document.folders.length ||
        authorizedFolders.some((folder, index) => folder !== document.folders[index])
      document.folders = authorizedFolders

      // Lyrics stay lazy-loaded; persisted records only keep lightweight metadata.
      // Metadata and cover processing are performed only by the background scan
      // worker. A full rescan is the explicit repair path for legacy/missing covers.
      const tracks = document.tracks
      for (const track of tracks) {
        if (!track || typeof track !== 'object' || Array.isArray(track)) continue
        const t = track as Record<string, unknown>
        if (t.lyrics) {
          t.lyrics = null
          changed = true
        }
      }

      if (changed) {
        const nextDocument = { ...document, revision: document.revision + 1 }
        persistMusicLibraryDocumentWithIndex(MUSIC_LIBRARY_FILE, nextDocument)
        return nextDocument
      } else {
        replaceActiveLibraryExclusions(document.exclusions)
      }
      return document
    })
  })

  ipcMain.handle('library:removeTracks', async (event, rawRequest: unknown) => {
    assertTrustedIpcSender(event, 'library mutation IPC')
    const request = normalizeLocalLibraryRemoveRequest(rawRequest)
    request.library.folders = await filterAuthorizedLibraryRoots(request.library.folders)
    stringifyJsonForIpcStorage(request, 'library removal request', MAX_MUSIC_LIBRARY_BYTES)

    return await enqueueMusicLibraryTransaction(async () => {
      const loaded = loadMusicLibraryForTransaction(MUSIC_LIBRARY_FILE)
      assertMusicLibraryRevision(request.library.revision, loaded.document.revision)
      const persistedPaths = collectLibraryTrackPathKeys(loaded.document)
      const presentItems = request.items.filter((item) =>
        persistedPaths.has(normalizeLibraryFilePath(item.filePath))
      )
      const missingFailures = request.items
        .filter((item) => !persistedPaths.has(normalizeLibraryFilePath(item.filePath)))
        .map((item) => ({ filePath: item.filePath, message: '曲目不在当前持久化音乐库中' }))
      const authorized = await authorizeLocalLibrarySelections(presentItems, request.mode)
      const document = createMusicLibraryDocument(request.library, loaded.document.exclusions)
      const endPathMutation = beginLibraryPathMutation(
        request.mode === 'trash' ? authorized.items.map((item) => item.filePath) : []
      )
      let result: LocalLibraryRemoveResult
      try {
        try {
          result = await commitLocalLibraryRemoval({
            document,
            items: authorized.items,
            mode: request.mode,
            trashItem: async (filePath) => {
              const authorizedPath = await resolveAuthorizedAudioFile(
                normalizeLocalPath(filePath, 'trash item path')
              )
              await shell.trashItem(authorizedPath)
            },
            persist: (nextDocument) => {
              nextDocument.revision = loaded.document.revision + 1
              persistMusicLibraryDocumentWithIndex(MUSIC_LIBRARY_FILE, nextDocument)
            },
            journal:
              request.mode === 'trash'
                ? createLocalLibraryRemovalJournal(MUSIC_LIBRARY_FILE)
                : undefined
          })
        } catch (error) {
          if (request.mode !== 'trash') throw error
          const recovered = recoverLocalLibraryRemovalResult(
            MUSIC_LIBRARY_FILE,
            document,
            authorized.items
          )
          if (!recovered) throw error
          result = recovered
          reportLocalLibraryRemovalRecovery(MUSIC_LIBRARY_FILE, result.removedFilePaths)
        }
      } finally {
        endPathMutation()
      }
      result.failures.unshift(...missingFailures, ...authorized.failures)
      if (result.removedFilePaths.length === 0) {
        result.library = loaded.document
      }
      return result
    })
  })

  ipcMain.handle('library:restoreExclusions', async (event, rawRequest: unknown) => {
    assertTrustedIpcSender(event, 'library mutation IPC')
    const request = normalizeLocalLibraryRestoreRequest(rawRequest)
    request.library.folders = await filterAuthorizedLibraryRoots(request.library.folders)
    stringifyJsonForIpcStorage(
      request,
      'library exclusion restore request',
      MAX_MUSIC_LIBRARY_BYTES
    )

    return await enqueueMusicLibraryTransaction(async () => {
      const loaded = loadMusicLibraryForTransaction(MUSIC_LIBRARY_FILE)
      assertMusicLibraryRevision(request.library.revision, loaded.document.revision)
      const document = createMusicLibraryDocument(request.library, loaded.document.exclusions)
      const restored = restoreLibraryExclusions(document, request.filePaths)
      if (restored.restoredFilePaths.length > 0) {
        restored.document.revision = loaded.document.revision + 1
        persistMusicLibraryDocumentWithIndex(MUSIC_LIBRARY_FILE, restored.document)
      }
      return {
        library: restored.restoredFilePaths.length > 0 ? restored.document : loaded.document,
        restoredFilePaths: restored.restoredFilePaths
      }
    })
  })

  ipcMain.handle(
    'library:detectDuplicates',
    async (event) => await duplicateDetectionIpc.detect(event)
  )

  // Cover thumbnail loader — returns base64 data URL for a cover:// handle
  ipcMain.handle(
    'library:writeTags',
    async (event, rawRequest: unknown) => await tagWriteIpc.write(event, rawRequest)
  )

  ipcMain.handle(
    'library:restoreTags',
    async (event, rawRequest: unknown) => await tagWriteIpc.restore(event, rawRequest)
  )

  registerSleepTimerIpc(ipcMain, sleepTimerService, assertTrustedIpcSender)

  ipcMain.handle('cover:get', async (event, handle: string): Promise<string | null> => {
    assertTrustedIpcSender(event, 'cover IPC')
    if (!handle || typeof handle !== 'string') return null
    // Pass through existing data: URLs (e.g. from plugins)
    if (handle.startsWith('data:')) return normalizeCoverDataUrl(handle)
    return readCachedCover(handle)
  })

  // Lyrics lazy loader — reads .lrc file on demand, falls back to embedded lyrics
  ipcMain.handle(
    'lyrics:get',
    async (event, dir: string, fileName: string, filePath?: string): Promise<string | null> => {
      assertTrustedIpcSender(event, 'lyrics IPC')
      const safeFileName = basename(
        normalizeIpcString(fileName, 'lyrics file name', MAX_LYRICS_FILE_NAME_LENGTH)
      )
      if (!safeFileName) return null
      let resolvedFilePath: string | null = null
      try {
        resolvedFilePath = filePath
          ? await resolveAuthorizedAudioFile(normalizeLocalPath(filePath, 'lyrics audio file path'))
          : null
      } catch {
        return null
      }
      let resolvedDir = resolvedFilePath ? dirname(resolvedFilePath) : null
      if (!resolvedDir) {
        try {
          resolvedDir = await resolveAuthorizedLibraryDirectory(
            normalizeLocalPath(dir, 'lyrics directory')
          )
        } catch {
          return null
        }
      }
      // 1. Try external .lrc file
      const lrc = findLyricsInDir(resolvedDir, safeFileName)
      if (lrc) return lrc

      // 2. Try embedded lyrics from audio file metadata
      if (resolvedFilePath) {
        try {
          const meta = await parseFile(resolvedFilePath, { skipCovers: true })
          const common = meta.common
          if (common.lyrics && common.lyrics.length > 0) {
            // music-metadata returns lyrics as { language, text } objects or strings
            const first = common.lyrics[0]
            const text = typeof first === 'string' ? first : first?.text
            if (text) return text
          }
        } catch {
          // ignore parse errors
        }
      }
      return null
    }
  )

  ipcMain.handle('lyrics:import', async (event): Promise<string | null> => {
    assertTrustedIpcSender(event, 'lyrics import IPC')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const options: Electron.OpenDialogOptions = {
      title: 'Import LRC lyrics',
      properties: ['openFile'],
      filters: [{ name: 'Lyrics', extensions: ['lrc', 'txt'] }]
    }
    const result =
      win && !win.isDestroyed()
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
    return await importLyricsFromDialog(
      result,
      async (filePath) => await readFile(filePath, 'utf-8'),
      async (filePath) => (await stat(filePath)).size
    )
  })

  ipcMain.handle('lyrics:save', async (event, contents: string): Promise<string | null> => {
    assertTrustedIpcSender(event, 'lyrics save IPC')
    if (typeof contents !== 'string') throw new Error('Lyrics content must be text')
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const options: Electron.SaveDialogOptions = {
      title: 'Save LRC lyrics',
      defaultPath: 'lyrics.lrc',
      filters: [{ name: 'LRC lyrics', extensions: ['lrc'] }]
    }
    const result =
      win && !win.isDestroyed()
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
    const saved = await saveLyricsFromDialog(result, contents)
    return saved?.filePath ?? null
  })

  ipcMain.handle(
    'lyrics:searchOnline',
    async (event, query: unknown): Promise<OnlineLyricsSearchResult> => {
      assertTrustedIpcSender(event, 'lyrics search IPC')
      assertOnlineLyricsRateLimit()
      return await searchOnlineLyrics(query)
    }
  )

  ipcMain.handle('data:loadLyricsManagement', async (event) => {
    assertTrustedIpcSender(event, 'lyrics management IPC')
    try {
      return await lyricsManagementStore.load()
    } catch (error) {
      reportPersistentDataFailure('Lyrics management', LYRICS_MANAGEMENT_FILE, error)
      return null
    }
  })

  ipcMain.handle(
    'data:saveLyricsManagement',
    async (event, document: LyricsManagementDocument, expectedRevision: number) => {
      assertTrustedIpcSender(event, 'lyrics management IPC')
      stringifyJsonForIpcStorage(document, 'lyrics management', MAX_LYRICS_MANAGEMENT_BYTES)
      if (!isLyricsManagementDocument(document)) {
        throw new Error('Lyrics management has an invalid structure')
      }
      return await saveVersionedData(lyricsManagementStore, document, expectedRevision)
    }
  )

  ipcMain.handle('data:loadPlaybackBookmarks', async (event) => {
    assertTrustedIpcSender(event, 'playback bookmarks IPC')
    try {
      return await playbackBookmarksStore.load()
    } catch (error) {
      reportPersistentDataFailure('Playback bookmarks', PLAYBACK_BOOKMARKS_FILE, error)
      return {
        revision: 0,
        data: DEFAULT_PLAYBACK_BOOKMARKS
      }
    }
  })

  ipcMain.handle(
    'data:savePlaybackBookmarks',
    async (event, document: PlaybackBookmarksDocument, expectedRevision: number) => {
      assertTrustedIpcSender(event, 'playback bookmarks IPC')
      stringifyJsonForIpcStorage(document, 'playback bookmarks', MAX_PLAYBACK_BOOKMARKS_BYTES)
      if (!isPlaybackBookmarksDocument(document)) {
        throw new Error('Playback bookmarks have an invalid structure')
      }
      return await saveVersionedData(playbackBookmarksStore, document, expectedRevision)
    }
  )

  ipcMain.handle(
    'data:savePlaybackSession',
    async (event, session: PlaybackSession, expectedRevision: number) => {
      assertTrustedIpcSender(event, 'data IPC')
      stringifyJsonForIpcStorage(session, 'playback session', MAX_PLAYBACK_SESSION_BYTES)
      if (!isPlaybackSessionFile(session))
        throw new Error('Playback session has an invalid structure')
      return await saveVersionedData(playbackSessionStore, session, expectedRevision)
    }
  )

  ipcMain.handle('data:loadPlaybackSession', async (event) => {
    assertTrustedIpcSender(event, 'data IPC')
    try {
      return await playbackSessionStore.load()
    } catch (error) {
      reportPersistentDataFailure('Playback session', PLAYBACK_SESSION_FILE, error)
      return null
    }
  })

  ipcMain.handle('data:clearPlaybackSession', async (event, expectedRevision: number) => {
    assertTrustedIpcSender(event, 'data IPC')
    return await saveVersionedData(playbackSessionStore, null, expectedRevision)
  })

  ipcMain.handle(
    'data:savePlaylists',
    async (event, playlists: unknown, expectedRevision: number) => {
      assertTrustedIpcSender(event, 'data IPC')
      stringifyJsonForIpcStorage(playlists, 'playlists', MAX_PLAYLISTS_BYTES)
      if (!Array.isArray(playlists)) throw new Error('Playlists have an invalid structure')
      return await saveVersionedData(playlistsStore, playlists, expectedRevision)
    }
  )

  ipcMain.handle('data:loadPlaylists', async (event) => {
    assertTrustedIpcSender(event, 'data IPC')
    try {
      return await playlistsStore.load()
    } catch (error) {
      reportPersistentDataFailure('Playlists', PLAYLISTS_FILE, error)
      return null
    }
  })

  ipcMain.handle('data:saveCookie', async (event, cookie: string) => {
    assertTrustedIpcSender(event, 'data IPC')
    await saveNcmCookie(NCM_COOKIE_FILE, normalizeNcmCookieForSave(cookie))
  })

  ipcMain.handle('data:loadCookie', async (event) => {
    assertTrustedIpcSender(event, 'data IPC')
    return loadNcmCookie(NCM_COOKIE_FILE)
  })
}

function enqueueMusicLibraryTransaction<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = musicLibraryTransactionChain.catch(() => {}).then(operation)
  musicLibraryTransactionChain = result.then(
    () => {},
    () => {}
  )
  return result
}

async function runLocalLibraryScanOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const message = redactSensitiveText(errorMessage(error))
    console.error('[library] background scan operation failed:', message)
    throw new Error(message)
  }
}

function unavailableLocalLibraryScanRunner(): LocalLibraryScanRunner {
  const unavailable = (): never => {
    throw new Error('Local library scan service is unavailable')
  }
  return {
    scan: async () => unavailable(),
    pause: () => {},
    resume: () => {},
    cancel: () => {},
    destroy: () => {}
  }
}

function persistMusicLibraryDocumentWithIndex(
  libraryFilePath: string,
  document: LocalMusicLibraryDocument
): void {
  persistMusicLibraryDocument(libraryFilePath, document)
  try {
    synchronizeLocalLibraryFileIndexRevision(libraryFilePath, document.revision)
  } catch (error) {
    // The file index is derived data. A later startup scan will reconcile it.
    console.warn(
      '[library] failed to align the local file index:',
      redactSensitiveText(errorMessage(error))
    )
  }
}

function loadMusicLibraryForTransaction(filePath: string): LoadedMusicLibraryDocument {
  try {
    const removalRecovery = recoverLocalLibraryRemoval(filePath)
    if (removalRecovery.recovered) {
      reportLocalLibraryRemovalRecovery(filePath, removalRecovery.removedFilePaths)
    }
  } catch (error) {
    reportPersistentDataFailure(
      '音乐库回收站恢复日志',
      getLocalLibraryRemovalJournalPath(filePath),
      error
    )
  }
  let loaded: LoadedMusicLibraryDocument
  try {
    loaded = loadMusicLibraryDocument(filePath)
  } catch (error) {
    reportPersistentDataFailure('音乐库', filePath, error)
  }
  if (loaded.recovery) {
    reportPersistentDataRecovery('音乐库', filePath, loaded.recovery)
  }
  return loaded
}

function normalizeMusicLibrarySnapshot(value: unknown): LocalLibrarySnapshotInput {
  if (Array.isArray(value)) return { revision: 0, tracks: value, folders: [] }
  if (!value || typeof value !== 'object') {
    throw new Error('Music library must be an array or object')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.tracks)) throw new Error('Music library tracks must be an array')
  if (record.folders !== undefined && !Array.isArray(record.folders)) {
    throw new Error('Music library folders must be an array')
  }
  return {
    revision:
      typeof record.revision === 'number' &&
      Number.isSafeInteger(record.revision) &&
      record.revision >= 0
        ? record.revision
        : 0,
    tracks: record.tracks,
    folders: (record.folders ?? []).filter((folder): folder is string => typeof folder === 'string')
  }
}

async function authorizeLocalLibrarySelections(
  items: LocalLibraryTrackSelection[],
  mode: LocalLibraryRemovalMode
): Promise<{
  items: LocalLibraryTrackSelection[]
  failures: Array<{ filePath: string; message: string }>
}> {
  const authorizedItems: LocalLibraryTrackSelection[] = []
  const failures: Array<{ filePath: string; message: string }> = []
  for (const item of items) {
    try {
      const requestedPath = normalizeLocalPath(item.filePath, 'library removal item path')
      if (mode === 'trash') {
        await resolveAuthorizedAudioFile(requestedPath)
      }
      authorizedItems.push(item)
    } catch (error) {
      failures.push({
        filePath: item.filePath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return { items: authorizedItems, failures }
}

function normalizeLocalLibraryRemoveRequest(value: unknown): LocalLibraryRemoveRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Library removal request must be an object')
  }
  const record = value as Record<string, unknown>
  if (record.mode !== 'library' && record.mode !== 'trash') {
    throw new Error('Library removal mode must be library or trash')
  }
  if (!Array.isArray(record.items) || record.items.length > MAX_LIBRARY_MUTATION_ITEMS) {
    throw new Error(`Library removal supports at most ${MAX_LIBRARY_MUTATION_ITEMS} items`)
  }
  return {
    mode: record.mode,
    items: record.items.map(normalizeLocalLibraryTrackSelection),
    library: normalizeMusicLibrarySnapshot(record.library)
  }
}

function normalizeLocalLibraryTrackSelection(value: unknown): LocalLibraryTrackSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Library removal item must be an object')
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) {
    throw new Error('Library removal item id is required')
  }
  return {
    id: record.id,
    filePath: normalizeLocalPath(record.filePath, 'library removal item path'),
    title: typeof record.title === 'string' ? record.title.slice(0, 1024) : '',
    artist: typeof record.artist === 'string' ? record.artist.slice(0, 1024) : ''
  }
}

function normalizeLocalLibraryRestoreRequest(value: unknown): LocalLibraryRestoreRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Library exclusion restore request must be an object')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.filePaths) || record.filePaths.length > MAX_LIBRARY_MUTATION_ITEMS) {
    throw new Error(
      `Library exclusion restore supports at most ${MAX_LIBRARY_MUTATION_ITEMS} items`
    )
  }
  return {
    filePaths: record.filePaths.map((filePath) =>
      normalizeLocalPath(filePath, 'library exclusion path')
    ),
    library: normalizeMusicLibrarySnapshot(record.library)
  }
}

async function saveVersionedData<T>(
  store: VersionedDataStore<T>,
  data: T,
  expectedRevision: number
) {
  try {
    return await store.save(data, expectedRevision)
  } catch (error) {
    if (error instanceof PersistentDataRevisionConflictError) {
      return createPersistentDataRevisionConflictResponse(error)
    }
    throw error
  }
}

function normalizeRendererClosePersistenceOutcome(value: unknown): RendererClosePersistenceOutcome {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Renderer close persistence outcome must be an object')
  }
  const record = value as Record<string, unknown>
  if (record.status === 'saved') return { status: 'saved' }
  if (record.status === 'failed') {
    return {
      status: 'failed',
      error: normalizeIpcString(
        record.error,
        'renderer close persistence error',
        MAX_PLAYBACK_SAVE_ERROR_LENGTH
      )
    }
  }
  throw new Error('Renderer close persistence outcome has an invalid status')
}

function isPlaybackSessionFile(value: unknown): value is PlaybackSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const track = record.track
  return (
    record.version === 1 &&
    typeof record.savedAt === 'string' &&
    (record.mode === 'off' || record.mode === 'track' || record.mode === 'trackAndPosition') &&
    !!track &&
    typeof track === 'object' &&
    !Array.isArray(track) &&
    typeof (track as Record<string, unknown>).id === 'string' &&
    typeof record.position === 'number' &&
    Number.isFinite(record.position) &&
    record.position >= 0 &&
    (record.queue === undefined || Array.isArray(record.queue)) &&
    playbackSessionCueRangesAreValid(value)
  )
}

function reportPersistentDataRecovery<T>(
  label: string,
  filePath: string,
  result: Extract<JsonFileLoadResult<T>, { status: 'recovered' }>
): void {
  const recoveryDetail = result.restoreError
    ? `已读取备份，但恢复主文件失败：${redactSensitiveText(result.restoreError)}`
    : '主文件已由最后一个有效备份恢复。'
  const corruptDetail = result.corruptCopyPath ? `\n损坏副本保留在：${result.corruptCopyPath}` : ''
  console.warn(`[persistence] ${label} recovered from backup`, filePath, result.restoreError ?? '')
  showPersistenceMessage(
    `recovered:${filePath}`,
    'warning',
    `${label}已从备份恢复`,
    `${recoveryDetail}${corruptDetail}`
  )
}

function reportLocalLibraryRemovalRecovery(filePath: string, removedFilePaths: string[]): void {
  const count = removedFilePaths.length
  console.warn(`[persistence] completed ${count} interrupted local library removal(s)`, filePath)
  showPersistenceMessage(
    `removal-recovered:${filePath}`,
    'warning',
    '已完成中断的回收站操作',
    `Twilight Echo 根据恢复日志清理了 ${count} 条已移入回收站的音乐库记录。`
  )
}

function reportPersistentDataFailure(label: string, filePath: string, error: unknown): never {
  const message = errorMessage(error)
  const detail =
    error instanceof PersistentJsonFileError
      ? `主文件错误：${redactSensitiveText(error.primaryError)}\n备份错误：${redactSensitiveText(error.backupError)}\n\n文件：${filePath}`
      : `${redactSensitiveText(message)}\n\n文件：${filePath}`
  console.error(`[persistence] failed to load ${label}:`, redactSensitiveText(message))
  showPersistenceMessage(
    `failed:${filePath}`,
    'error',
    `${label}文件已损坏`,
    `${detail}\n\n应用没有把它当作空数据覆盖，请保留该文件以便恢复。`
  )
  throw error instanceof Error ? error : new Error(message)
}

function showPersistenceMessage(
  key: string,
  type: 'warning' | 'error',
  message: string,
  detail: string
): void {
  if (persistenceNotifications.has(key)) return
  persistenceNotifications.add(key)
  const options: Electron.MessageBoxOptions = {
    type,
    title: 'Twilight Echo 数据恢复',
    message,
    detail,
    buttons: ['确定'],
    noLink: true
  }
  const win = runtime.mainWindow
  const prompt =
    win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
  void prompt.catch(() => {
    persistenceNotifications.delete(key)
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  if (Buffer.byteLength(url, 'utf-8') > MAX_EXTERNAL_URL_LENGTH) return false
  if (/[\0\r\n]/.test(url)) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function isSafeLocalPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  const normalized = path.trim()
  if (!normalized) return false
  if (normalized.length > MAX_LOCAL_PATH_LENGTH) return false
  const hasUrlScheme = /^[a-z][a-z0-9+.-]*:/i.test(normalized)
  const isWindowsDrivePath = /^[a-zA-Z]:[\\/]/.test(normalized)
  if (hasUrlScheme && !isWindowsDrivePath) return false
  return true
}

function normalizeNcmCookieForSave(cookie: unknown): string {
  if (cookie == null || cookie === '') return ''
  const normalized = normalizeIpcString(cookie, 'NCM cookie', MAX_NCM_COOKIE_BYTES)
  return normalized
}

function normalizeLocalPath(path: unknown, field: string): string {
  const normalized = normalizeIpcString(path, field, MAX_LOCAL_PATH_LENGTH)
  if (!isSafeLocalPath(normalized)) throw new Error(`${field} is not a safe local path`)
  return normalized
}

function normalizeCoverDataUrl(handle: string): string | null {
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(handle)) return null
  if (Buffer.byteLength(handle, 'utf-8') > MAX_DATA_URL_BYTES) return null
  return handle
}

async function saveNcmCookie(filePath: string, cookie: string): Promise<void> {
  await writeFile(
    filePath,
    JSON.stringify(
      {
        cookie: protectString(cookie, ncmCookieScope(filePath))
      },
      null,
      2
    ),
    'utf-8'
  )
}

async function loadNcmCookie(filePath: string): Promise<string> {
  if (!existsSync(filePath)) return ''
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
    const cookie = (parsed as Record<string, unknown>).cookie
    if (isSecureValueEnvelope(cookie)) {
      return unprotectString(cookie, ncmCookieScope(filePath)) ?? ''
    }
    if (typeof cookie === 'string') {
      await saveNcmCookie(filePath, cookie)
      return cookie
    }
    return ''
  } catch (error) {
    console.warn(
      '读取网易云 Cookie 失败：',
      redactSensitiveText(error instanceof Error ? error.message : error)
    )
    return ''
  }
}

function ncmCookieScope(filePath: string): string {
  return `ncm-cookie:${filePath}`
}
