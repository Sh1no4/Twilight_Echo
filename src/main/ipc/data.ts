import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { statSync, readFileSync, existsSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from 'fs'
import { readFile, writeFile, rm } from 'fs/promises'
import { parseFile } from 'music-metadata'
import { runtime, type DiscordActivityData } from '../core/runtime'
import type { AppSettings, PlaybackSession } from '../core/types'
import {
  compareVersions,
  createSettingsSnapshot,
  getDirectorySize,
  getDefaultCachePath,
  normalizeAppSettings
} from '../core/settings'
import {
  exportAppSettingsForBackup,
  importAppSettingsFromBackup
} from '../core/settingsBackup'
import {
  ensureMusicCacheDirectories
} from '../cache/ncmCache'
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
  resolvePlayableAudioFile,
  findLyricsInDir,
  scanDirectory,
  getMimeType
} from '../library/scan'
import {
  updateDiscordActivity,
  clearDiscordActivity
} from '../integrations/discord'
import {
  updateAppSettings,
  relaunchApplication
} from '../audio/state'
import { resolvePlaybackSessionSave } from '../app/window'
import { getPlayerShortcutStatuses } from '../integrations/shortcutsTray'

export function setupDataIpc(): void {
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:toggleMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('dialog:openFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:chooseBackgroundImage', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: '背景图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    }
    const result = win && !win.isDestroyed()
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return importBackgroundImage(result.filePaths[0])
  })

  ipcMain.handle('settings:importBackgroundImage', async (_event, fileName: string, data: unknown) => {
    const buffer = normalizeBackgroundImageImportData(data)
    if (typeof fileName !== 'string' || !buffer) return null
    return importBackgroundImageBuffer(fileName, buffer)
  })

  ipcMain.handle('app:relaunch', () => {
    setTimeout(() => {
      relaunchApplication()
    }, 0)
    return true
  })

  ipcMain.handle('app:playback-session-saved', async (_event, requestId: string) => {
    resolvePlaybackSessionSave(requestId)
    return true
  })

  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    return await shell.openPath(targetPath)
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle('discord:updateActivity', (_event, data: DiscordActivityData) => {
    if (runtime.appSettings.discordRpcEnabled) updateDiscordActivity(data)
    return true
  })

  ipcMain.handle('discord:clearActivity', () => {
    clearDiscordActivity()
    return true
  })

  ipcMain.handle('app:checkForUpdates', async () => {
    try {
      const currentVersion = app.getVersion()
      const response = await fetch(
        'https://api.github.com/repos/asenyarzc-cpu/Twilight_Echo/releases/latest',
        { headers: { 'User-Agent': 'TwilightEcho-Updater' } }
      )
      if (!response.ok) return { hasUpdate: false, currentVersion, error: 'network' }
      const release = await response.json() as { tag_name?: string; html_url?: string; body?: string }
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

  ipcMain.handle('settings:get', async () => {
    return createSettingsSnapshot(runtime.appSettings, runtime.launchSettings)
  })

  ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
    return await updateAppSettings(patch)
  })

  ipcMain.handle('settings:export', async () => {
    return exportAppSettingsForBackup(runtime.appSettings)
  })

  ipcMain.handle('settings:import', async (_event, json: string) => {
    if (typeof json !== 'string') {
      throw new Error('Settings backup must be a JSON string')
    }
    const importedSettings = importAppSettingsFromBackup(
      json,
      runtime.appSettings,
      normalizeAppSettings
    )
    return await updateAppSettings(importedSettings)
  })

  ipcMain.handle('settings:getShortcutStatuses', async () => {
    return getPlayerShortcutStatuses()
  })

  ipcMain.handle('settings:chooseCacheFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? runtime.mainWindow
    const options: Electron.OpenDialogOptions = {
      title: '选择缓存位置',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:getCacheSize', async () => {
    return await getDirectorySize(runtime.appSettings.musicCachePath || getDefaultCachePath())
  })

  ipcMain.handle('settings:clearCache', async () => {
    const cachePath = runtime.appSettings.musicCachePath || getDefaultCachePath()
    try {
      await rm(cachePath, { recursive: true, force: true })
      await rm(getLegacyCoverCacheDir(), { recursive: true, force: true })
    } catch (error) {
      console.warn('清理缓存失败：', error)
    }
    ensureMusicCacheDirectories(cachePath)
    return await getDirectorySize(cachePath)
  })

  ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('fs:scanMusicFiles', async (event, folderPath: string) => {
    return await scanDirectory(folderPath, (current, total) => {
      event.sender.send('fs:scanProgress', { current, total })
    })
  })

  ipcMain.handle('fs:readAudioFile', async (_event, filePath: string) => {
    const buffer = await readFile(filePath)
    return {
      buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      mimeType: getMimeType(filePath)
    }
  })

  ipcMain.handle('fs:getAudioFileUrl', async (_event, filePath: string) => {
    const resolvedPath = await resolvePlayableAudioFile(filePath)
    return `twilight-audio:///${encodeAudioFileUrlPath(resolvedPath)}`
  })

  const userDataPath = app.getPath('userData')
  const MUSIC_LIBRARY_FILE = join(userDataPath, 'music-library.json')
  const NCM_COOKIE_FILE = join(userDataPath, 'ncm-cookie.json')
  const PLAYBACK_SESSION_FILE = join(userDataPath, 'playback-session.json')
  const PLAYLISTS_FILE = join(userDataPath, 'playlists.json')

  ipcMain.handle('data:saveMusicLibrary', async (_event, library: { tracks: unknown[]; folders?: string[] } | unknown[]) => {
    const tmpPath = MUSIC_LIBRARY_FILE + '.tmp'
    const bakPath = MUSIC_LIBRARY_FILE + '.bak'
    try {
      writeFileSync(tmpPath, JSON.stringify(library), 'utf-8')
      // Copy current dest to .bak (keep dest intact — avoids rename-to-bak window)
      if (existsSync(MUSIC_LIBRARY_FILE)) {
        copyFileSync(MUSIC_LIBRARY_FILE, bakPath)
      }
      // Atomic rename (Windows: MoveFileEx + REPLACE_EXISTING)
      try {
        renameSync(tmpPath, MUSIC_LIBRARY_FILE)
      } catch {
        // EPERM/EBUSY fallback: unlink dest then rename tmp
        if (existsSync(MUSIC_LIBRARY_FILE)) {
          unlinkSync(MUSIC_LIBRARY_FILE)
        }
        renameSync(tmpPath, MUSIC_LIBRARY_FILE)
      }
      // Success: clean up .bak
      try { unlinkSync(bakPath) } catch { /* bak may not exist on first save */ }
    } catch (err) {
      // Failure: restore .bak → dest if available
      try {
        if (existsSync(bakPath)) {
          copyFileSync(bakPath, MUSIC_LIBRARY_FILE)
        }
      } catch { /* best-effort restore */ }
      // Clean up orphaned tmp
      try { unlinkSync(tmpPath) } catch { /* ignore */ }
      throw err
    }
  })

  ipcMain.handle('data:loadMusicLibrary', async () => {
    // Auto-recovery from .bak if dest is missing, empty, or corrupt
    if (!existsSync(MUSIC_LIBRARY_FILE) || statSync(MUSIC_LIBRARY_FILE).size === 0) {
      const bakPath = MUSIC_LIBRARY_FILE + '.bak'
      if (existsSync(bakPath)) {
        try { copyFileSync(bakPath, MUSIC_LIBRARY_FILE) } catch { /* best-effort */ }
      }
    }

    if (!existsSync(MUSIC_LIBRARY_FILE)) return []

    let raw: string
    try {
      raw = readFileSync(MUSIC_LIBRARY_FILE, 'utf-8')
    } catch {
      return []
    }

    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      // JSON.parse failed — try .bak recovery
      const bakPath = MUSIC_LIBRARY_FILE + '.bak'
      if (existsSync(bakPath)) {
        try {
          copyFileSync(bakPath, MUSIC_LIBRARY_FILE)
          raw = readFileSync(MUSIC_LIBRARY_FILE, 'utf-8')
          data = JSON.parse(raw)
        } catch {
          return []
        }
      } else {
        return []
      }
    }

    // Strip lyrics from saved library — lyrics are lazy-loaded on playback
    const tracks = Array.isArray(data) ? data : (data as { tracks?: unknown[] }).tracks
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
        try { writeFileSync(MUSIC_LIBRARY_FILE, JSON.stringify(data), 'utf-8') } catch { /* best-effort */ }
      }
    }
    return data
  })

  // Cover thumbnail loader — returns base64 data URL for a cover:// handle
  ipcMain.handle('cover:get', async (_event, handle: string): Promise<string | null> => {
    if (!handle || typeof handle !== 'string') return null
    // Pass through existing data: URLs (e.g. from plugins)
    if (handle.startsWith('data:')) return handle
    return readCachedCover(handle)
  })

  // Lyrics lazy loader — reads .lrc file on demand, falls back to embedded lyrics
  ipcMain.handle('lyrics:get', async (_event, dir: string, fileName: string, filePath?: string): Promise<string | null> => {
    // 1. Try external .lrc file
    const lrc = findLyricsInDir(dir, fileName)
    if (lrc) return lrc

    // 2. Try embedded lyrics from audio file metadata
    if (filePath) {
      try {
        const meta = await parseFile(filePath, { skipCovers: true })
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
  })

  ipcMain.handle('data:savePlaybackSession', async (_event, session: PlaybackSession | null) => {
    if (!session) {
      await rm(PLAYBACK_SESSION_FILE, { force: true })
      return
    }
    await writeFile(PLAYBACK_SESSION_FILE, JSON.stringify(session), 'utf-8')
  })

  ipcMain.handle('data:loadPlaybackSession', async () => {
    if (!existsSync(PLAYBACK_SESSION_FILE)) return null
    try {
      const raw = readFileSync(PLAYBACK_SESSION_FILE, 'utf-8')
      return JSON.parse(raw) as PlaybackSession
    } catch {
      return null
    }
  })

  ipcMain.handle('data:clearPlaybackSession', async () => {
    await rm(PLAYBACK_SESSION_FILE, { force: true })
  })

  ipcMain.handle('data:savePlaylists', async (_event, playlists: unknown) => {
    await writeFile(PLAYLISTS_FILE, JSON.stringify(playlists), 'utf-8')
  })

  ipcMain.handle('data:loadPlaylists', async () => {
    if (!existsSync(PLAYLISTS_FILE)) return null
    try {
      const raw = readFileSync(PLAYLISTS_FILE, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  })

  ipcMain.handle('data:saveCookie', async (_event, cookie: string) => {
    await writeFile(NCM_COOKIE_FILE, JSON.stringify({ cookie }), 'utf-8')
  })

  ipcMain.handle('data:loadCookie', async () => {
    if (!existsSync(NCM_COOKIE_FILE)) return ''
    try {
      const raw = readFileSync(NCM_COOKIE_FILE, 'utf-8')
      return JSON.parse(raw).cookie || ''
    } catch {
      return ''
    }
  })
}
