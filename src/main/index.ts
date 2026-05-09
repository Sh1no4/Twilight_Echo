import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname, basename, dirname } from 'path'
import { readdirSync, statSync, readFileSync, existsSync, writeFileSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { parseFile } from 'music-metadata'
import { MpvManager } from './mpvManager'

const SUPPORTED_EXTENSIONS = [
  '.mp3', '.flac', '.wav', '.aac', '.ogg', '.wma', '.m4a',
  '.aiff', '.aif', '.opus', '.webm', '.alac', '.ape', '.wv',
  '.dsf', '.dff'
]

const COVER_NAMES = [
  'cover.jpg', 'cover.png', 'cover.webp',
  'folder.jpg', 'folder.png',
  'album.jpg', 'album.png',
  'front.jpg', 'front.png',
  'artwork.jpg', 'artwork.png'
]

const coverCache = new Map<string, string | null>()

function findCoverInDir(dir: string): string | null {
  if (coverCache.has(dir)) return coverCache.get(dir) ?? null
  for (const name of COVER_NAMES) {
    const fullPath = join(dir, name)
    if (existsSync(fullPath)) {
      try {
        const data = readFileSync(fullPath)
        const ext = extname(name).slice(1)
        const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp'
        const dataUrl = `data:${mime};base64,${data.toString('base64')}`
        coverCache.set(dir, dataUrl)
        return dataUrl
      } catch { /* skip */ }
    }
  }
  coverCache.set(dir, null)
  return null
}

function findLyricsInDir(dir: string, musicFileName: string): string | null {
  const baseName = basename(musicFileName, extname(musicFileName))
  const lrcPath = join(dir, baseName + '.lrc')
  if (!existsSync(lrcPath)) return null
  try {
    return readFileSync(lrcPath, 'utf-8')
  } catch {
    return null
  }
}

function getNameFromFile(filePath: string): { artist: string; title: string } {
  const ext = extname(filePath)
  const nameWithoutExt = basename(filePath, ext)
  const dashIndex = nameWithoutExt.indexOf(' - ')
  if (dashIndex > 0) {
    return {
      artist: nameWithoutExt.substring(0, dashIndex).trim(),
      title: nameWithoutExt.substring(dashIndex + 3).trim()
    }
  }
  return { artist: '未知艺术家', title: nameWithoutExt }
}

interface FileEntry {
  fullPath: string
  fileName: string
  dir: string
  size: number
}

async function collectFilesAsync(dirPath: string): Promise<FileEntry[]> {
  const results: FileEntry[] = []
  try {
    const entries = readdirSync(dirPath)
    for (const entry of entries) {
      const fullPath = join(dirPath, entry)
      try {
        const st = statSync(fullPath)
        if (st.isDirectory()) {
          results.push(...(await collectFilesAsync(fullPath)))
        } else if (st.isFile()) {
          const ext = extname(entry).toLowerCase()
          if (SUPPORTED_EXTENSIONS.includes(ext)) {
            results.push({
              fullPath,
              fileName: entry,
              dir: dirname(fullPath),
              size: st.size
            })
          }
        }
      } catch { /* skip */ }
      // Yield to event loop every few files
      if (results.length % 100 === 0) {
        await new Promise(resolve => setImmediate(resolve))
      }
    }
  } catch { /* skip */ }
  return results
}

async function parseTrack(file: FileEntry): Promise<unknown> {
  const id = randomUUID()
  try {
    const meta = await parseFile(file.fullPath, { skipCovers: false })
    const common = meta.common

    let cover: string | null = null

    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0]
      const mime = pic.format || 'image/jpeg'
      const base64 = Buffer.from(pic.data).toString('base64')
      cover = `data:${mime};base64,${base64}`
    }

    if (!cover) {
      cover = findCoverInDir(file.dir)
    }

    const artist = common.artist || common.albumartist
    const title = common.title
    const album = common.album

    const fileName = getNameFromFile(file.fullPath)

    const lyrics = findLyricsInDir(file.dir, file.fileName)

    return {
      id,
      title: title || fileName.title,
      artist: artist || fileName.artist,
      album: album || '未知专辑',
      filePath: file.fullPath,
      fileName: file.fileName,
      duration: Math.round(meta.format.duration || 0),
      size: file.size,
      cover,
      lyrics,
      format: meta.format.container,
      sampleRate: meta.format.sampleRate,
      bitrate: meta.format.bitrate,
      bitDepth: meta.format.bitsPerSample
    }
  } catch {
    const fileName = getNameFromFile(file.fullPath)
    return {
      id,
      title: fileName.title,
      artist: fileName.artist,
      album: '未知专辑',
      filePath: file.fullPath,
      fileName: file.fileName,
      duration: 0,
      size: file.size,
      cover: findCoverInDir(file.dir),
      lyrics: findLyricsInDir(file.dir, file.fileName)
    }
  }
}

async function scanDirectory(dirPath: string, onProgress?: (current: number, total: number) => void): Promise<unknown[]> {
  const files = await collectFilesAsync(dirPath)
  const total = files.length
  const results: unknown[] = []
  const batchSize = 10
  
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(parseTrack))
    results.push(...batchResults)
    
    if (onProgress) {
      onProgress(results.length, total)
    }
    
    // Small delay to keep UI responsive
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  return results
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mime: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.wma': 'audio/x-ms-wma',
    '.m4a': 'audio/mp4',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff',
    '.opus': 'audio/opus',
    '.webm': 'audio/webm',
    '.alac': 'audio/mp4',
    '.ape': 'audio/ape',
    '.wv': 'audio/wavpack',
    '.dsf': 'audio/dsf',
    '.dff': 'audio/dsf'
  }
  return mime[ext] || 'application/octet-stream'
}

let mpvManager: MpvManager | null = null
let mainWindow: BrowserWindow | null = null
let ncmServer: import('http').Server | null = null
const NCM_API_PORT = 3100

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 768,
    show: false,
    frame: false,
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupMpvIpc(): void {
  mpvManager = new MpvManager({
    exclusiveMode: false
  })

  mpvManager.on('property-change', ({ name, data }) => {
    mainWindow?.webContents.send('mpv:property-change', { name, data })
  })

  mpvManager.on('end-file', ({ reason }) => {
    mainWindow?.webContents.send('mpv:end-file', { reason })
  })

  mpvManager.on('start-file', () => {
    mainWindow?.webContents.send('mpv:start-file')
  })

  mpvManager.on('error', (err: Error) => {
    console.error('[mpv]', err.message)
    mainWindow?.webContents.send('mpv:error', err.message)
  })

  mpvManager.on('ready', () => {
    mainWindow?.webContents.send('mpv:ready')
  })

  mpvManager.on('disconnected', () => {
    mainWindow?.webContents.send('mpv:disconnected')
  })

  function requireMpv(): MpvManager {
    if (!mpvManager) throw new Error('mpv 引擎未初始化')
    return mpvManager
  }

  ipcMain.handle('mpv:play', async (_event, filePath: string) => {
    console.log('[ipc] mpv:play 收到请求:', filePath)
    await requireMpv().play(filePath)
    console.log('[ipc] mpv:play 完成')
  })

  ipcMain.handle('mpv:togglePause', async () => {
    await requireMpv().togglePause()
  })

  ipcMain.handle('mpv:seek', async (_event, time: number) => {
    await requireMpv().seek(time)
  })

  ipcMain.handle('mpv:setVolume', async (_event, volume: number) => {
    await requireMpv().setVolume(volume)
  })

  ipcMain.handle('mpv:stop', async () => {
    await requireMpv().stop()
  })

  ipcMain.handle('mpv:setExclusiveMode', async (_event, enabled: boolean) => {
    await requireMpv().setExclusiveMode(enabled)
  })

  ipcMain.handle('mpv:getExclusiveMode', async () => {
    return (await requireMpv().getExclusiveMode())
  })

  mpvManager.start().then(() => {
    console.log('[mpv] 启动成功')
  }).catch((err: Error) => {
    console.error('[mpv]', err.message)
  })

  ipcMain.handle('ncm:getPort', () => NCM_API_PORT)

  ipcMain.handle('ncm:request', async (_event, path: string, cookie?: string) => {
    const sep = path.includes('?') ? '&' : '?'
    let url = `http://localhost:${NCM_API_PORT}${path}${sep}timestamp=${Date.now()}`
    // Pass cookie as query parameter, not HTTP header
    // This matches the official NCM API convention (cookie is a module-level parameter)
    if (cookie) {
      url += `&cookie=${encodeURIComponent(cookie)}`
    }
    const res = await fetch(url)
    return res.json()
  })
}

async function setupNcmApi(): Promise<void> {
  try {
    const tokenPath = join(tmpdir(), 'anonymous_token')
    if (!existsSync(tokenPath)) {
      writeFileSync(tokenPath, '', 'utf-8')
    }
    const { serveNcmApi } = await import('@neteasecloudmusicapienhanced/api/server.js')
    const app = await serveNcmApi({
      port: NCM_API_PORT,
      checkVersion: false
    })
    ncmServer = app.server
    console.log(`[ncm] 网易云音乐 API 已启动 @ http://localhost:${NCM_API_PORT}`)
  } catch (err) {
    console.error('[ncm] 启动失败:', err)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
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

  const userDataPath = app.getPath('userData')
  const MUSIC_LIBRARY_FILE = join(userDataPath, 'music-library.json')
  const NCM_COOKIE_FILE = join(userDataPath, 'ncm-cookie.json')

  ipcMain.handle('data:saveMusicLibrary', async (_event, tracks: unknown[]) => {
    await writeFile(MUSIC_LIBRARY_FILE, JSON.stringify(tracks), 'utf-8')
  })

  ipcMain.handle('data:loadMusicLibrary', async () => {
    if (!existsSync(MUSIC_LIBRARY_FILE)) return []
    try {
      const raw = readFileSync(MUSIC_LIBRARY_FILE, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return []
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

  createWindow()

  setupMpvIpc()
  setupNcmApi()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  mpvManager?.destroy()
  mpvManager = null
  if (ncmServer) {
    ncmServer.close()
    ncmServer = null
  }
})
