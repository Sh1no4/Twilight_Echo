import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { basename, dirname, join, resolve } from 'path'
import { readFileSync, existsSync } from 'fs'
import { readFile, writeFile, rm } from 'fs/promises'
import { parseFile } from 'music-metadata'
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
  importBackgroundImageBuffer,
  importBackgroundImage,
  normalizeBackgroundImageImportData,
  readCachedCover,
  coverHandleExists,
  migrateBase64Cover
} from '../library/coverCache'
import {
  encodeAudioFileUrlPath,
  findLyricsInDir,
  scanDirectory,
  getMimeType
} from '../library/scan'
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
import {
  PersistentJsonFileError,
  clearJsonFileArtifacts,
  loadJsonFileWithBackup,
  writeJsonFileAtomic,
  type JsonFileLoadResult,
  type JsonFileOptions
} from '../persistence/jsonFile.ts'

const MAX_MUSIC_LIBRARY_BYTES = 100 * 1024 * 1024
const MAX_PLAYBACK_SESSION_BYTES = 2 * 1024 * 1024
const MAX_PLAYLISTS_BYTES = 20 * 1024 * 1024
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

type MusicLibraryFile =
  | unknown[]
  | {
      tracks: unknown[]
      folders?: unknown[]
      [key: string]: unknown
    }

const MUSIC_LIBRARY_JSON_OPTIONS: JsonFileOptions<MusicLibraryFile> = {
  label: 'music library',
  maxBytes: MAX_MUSIC_LIBRARY_BYTES,
  validate: isMusicLibraryFile
}

const PLAYBACK_SESSION_JSON_OPTIONS: JsonFileOptions<PlaybackSession> = {
  label: 'playback session',
  maxBytes: MAX_PLAYBACK_SESSION_BYTES,
  validate: isPlaybackSessionFile
}

const PLAYLISTS_JSON_OPTIONS: JsonFileOptions<unknown[]> = {
  label: 'playlists',
  maxBytes: MAX_PLAYLISTS_BYTES,
  validate: Array.isArray
}

const persistenceNotifications = new Set<string>()

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

  ipcMain.handle('app:playback-session-saved', async (event, requestId: string) => {
    assertTrustedIpcSender(event, 'app IPC')
    resolvePlaybackSessionSave(
      normalizeIpcString(
        requestId,
        'playback session save request id',
        MAX_PLAYBACK_SAVE_REQUEST_ID_LENGTH
      )
    )
    return true
  })

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
    return await scanDirectory(resolvedPath, (current, total) => {
      event.sender.send('fs:scanProgress', { current, total })
    })
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

  const userDataPath = app.getPath('userData')
  const MUSIC_LIBRARY_FILE = join(userDataPath, 'music-library.json')
  const NCM_COOKIE_FILE = join(userDataPath, 'ncm-cookie.json')
  const PLAYBACK_SESSION_FILE = join(userDataPath, 'playback-session.json')
  const PLAYLISTS_FILE = join(userDataPath, 'playlists.json')

  ipcMain.handle(
    'data:saveMusicLibrary',
    async (event, library: { tracks: unknown[]; folders?: string[] } | unknown[]) => {
      assertTrustedIpcSender(event, 'data IPC')
      if (!Array.isArray(library) && (!library || typeof library !== 'object')) {
        throw new Error('Music library must be an array or object')
      }
      const normalizedLibrary = Array.isArray(library)
        ? library
        : {
            ...library,
            folders: await filterAuthorizedLibraryRoots(library.folders)
          }
      writeJsonFileAtomic(
        MUSIC_LIBRARY_FILE,
        stringifyJsonForIpcStorage(normalizedLibrary, 'music library', MAX_MUSIC_LIBRARY_BYTES),
        MUSIC_LIBRARY_JSON_OPTIONS,
        normalizedLibrary
      )
    }
  )

  ipcMain.handle('data:loadMusicLibrary', async (event) => {
    assertTrustedIpcSender(event, 'data IPC')
    let loaded: JsonFileLoadResult<MusicLibraryFile>
    try {
      loaded = loadJsonFileWithBackup(MUSIC_LIBRARY_FILE, MUSIC_LIBRARY_JSON_OPTIONS)
    } catch (error) {
      reportPersistentDataFailure('音乐库', MUSIC_LIBRARY_FILE, error)
    }
    if (loaded.status === 'missing') return []
    if (loaded.status === 'recovered') {
      reportPersistentDataRecovery('音乐库', MUSIC_LIBRARY_FILE, loaded)
    }
    let data: unknown = loaded.value

    // Strip lyrics from saved library — lyrics are lazy-loaded on playback
    const dataRecord =
      !Array.isArray(data) && data && typeof data === 'object'
        ? (data as { tracks?: unknown[]; folders?: unknown[] })
        : null
    const tracks = Array.isArray(data) ? data : dataRecord?.tracks
    if (dataRecord) {
      data = {
        ...dataRecord,
        folders: await filterAuthorizedLibraryRoots(dataRecord.folders)
      }
    }
    if (Array.isArray(tracks)) {
      let changed = false
      for (const track of tracks) {
        const t = track as Record<string, unknown>
        if (t.lyrics) {
          t.lyrics = null
          changed = true
        }
        // Migrate old base64 covers to disk cache
        if (t.cover && typeof t.cover === 'string' && (t.cover as string).startsWith('data:')) {
          const handle = migrateBase64Cover(t.cover as string)
          if (handle) {
            t.cover = handle
            changed = true
          }
        }
      }
      // Cover repair removed from load path (scan responsibility).
      // Lightweight coverHandleExists sweep — only existsSync, no parseFile
      let dirtyCount = 0
      for (const track of tracks) {
        const t = track as Record<string, unknown>
        if (
          typeof t.cover === 'string' &&
          (t.cover as string).startsWith('cover://') &&
          !coverHandleExists(t.cover)
        ) {
          dirtyCount++
        }
      }
      if (dirtyCount > 0 && !runtime.coversMissingNotified) {
        runtime.coversMissingNotified = true
        runtime.mainWindow?.webContents.send('library:covers-missing', { dirtyCount })
      }

      if (changed) {
        try {
          writeJsonFileAtomic(
            MUSIC_LIBRARY_FILE,
            JSON.stringify(data),
            MUSIC_LIBRARY_JSON_OPTIONS,
            data as MusicLibraryFile
          )
        } catch (error) {
          console.warn('保存迁移后的音乐库失败：', redactSensitiveText(errorMessage(error)))
        }
      }
    }
    return data
  })

  // Cover thumbnail loader — returns base64 data URL for a cover:// handle
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

  ipcMain.handle('data:savePlaybackSession', async (event, session: PlaybackSession | null) => {
    assertTrustedIpcSender(event, 'data IPC')
    if (!session) {
      clearJsonFileArtifacts(PLAYBACK_SESSION_FILE)
      return
    }
    writeJsonFileAtomic(
      PLAYBACK_SESSION_FILE,
      stringifyJsonForIpcStorage(session, 'playback session', MAX_PLAYBACK_SESSION_BYTES),
      PLAYBACK_SESSION_JSON_OPTIONS,
      session
    )
  })

  ipcMain.handle('data:loadPlaybackSession', async (event) => {
    assertTrustedIpcSender(event, 'data IPC')
    try {
      const loaded = loadJsonFileWithBackup(PLAYBACK_SESSION_FILE, PLAYBACK_SESSION_JSON_OPTIONS)
      if (loaded.status === 'missing') return null
      if (loaded.status === 'recovered') {
        reportPersistentDataRecovery('播放会话', PLAYBACK_SESSION_FILE, loaded)
      }
      return loaded.value
    } catch (error) {
      reportPersistentDataFailure('播放会话', PLAYBACK_SESSION_FILE, error)
    }
  })

  ipcMain.handle('data:clearPlaybackSession', async (event) => {
    assertTrustedIpcSender(event, 'data IPC')
    clearJsonFileArtifacts(PLAYBACK_SESSION_FILE)
  })

  ipcMain.handle('data:savePlaylists', async (event, playlists: unknown) => {
    assertTrustedIpcSender(event, 'data IPC')
    writeJsonFileAtomic(
      PLAYLISTS_FILE,
      stringifyJsonForIpcStorage(playlists, 'playlists', MAX_PLAYLISTS_BYTES),
      PLAYLISTS_JSON_OPTIONS,
      playlists as unknown[]
    )
  })

  ipcMain.handle('data:loadPlaylists', async (event) => {
    assertTrustedIpcSender(event, 'data IPC')
    try {
      const loaded = loadJsonFileWithBackup(PLAYLISTS_FILE, PLAYLISTS_JSON_OPTIONS)
      if (loaded.status === 'missing') return null
      if (loaded.status === 'recovered') {
        reportPersistentDataRecovery('歌单', PLAYLISTS_FILE, loaded)
      }
      return loaded.value
    } catch (error) {
      reportPersistentDataFailure('歌单', PLAYLISTS_FILE, error)
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

function isMusicLibraryFile(value: unknown): value is MusicLibraryFile {
  if (Array.isArray(value)) return true
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    Array.isArray(record.tracks) && (record.folders === undefined || Array.isArray(record.folders))
  )
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
    (record.queue === undefined || Array.isArray(record.queue))
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
