import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  Tray
} from 'electron'
import { join, extname, basename, dirname, resolve } from 'path'
import { readdirSync, statSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { readFile, writeFile, readdir, stat, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { parseFile } from 'music-metadata'
import {
  DEFAULT_AUDIO_PROCESSING,
  AudioEngineManager,
  normalizeAudioOutput,
  normalizeAudioProcessingSettings,
  type AudioProcessingSettings,
  type AudioOutputId,
  type AudioOutputState,
  type AudioEngineQueueItem,
  type ChannelRoutingMode,
  type OutputConfig,
  type PlayMode,
  type EqMode,
  type EqualizerBand
} from './audioEngineManager'

type PlayerShortcutAction = 'previous' | 'next' | 'playPause'
type AppTheme = 'pureWhite' | 'aurora'
type PlaybackResumeMode = 'off' | 'track' | 'trackAndPosition'

interface AudioEqPreset {
  id: string
  name: string
  eqMode: EqMode
  eqPreamp: number
  eqBands: EqualizerBand[]
}

interface AppSettings {
  autoCheckLogin: boolean
  autoLaunch: boolean
  launchAtLogin: boolean
  hardwareAcceleration: boolean
  globalShortcuts: boolean
  minimizeToTray: boolean
  musicCachePath: string
  cachePath: string
  closeToTray: boolean
  theme: AppTheme
  blurEffect: boolean
  useCoverTheme: boolean
  lyricFontSize: number
  playbackResumeMode: PlaybackResumeMode
  audioOutput: AudioOutputId
  audioDevice: string
  audioExclusiveMode: boolean
  audioOutputConfig: OutputConfig
  audioProcessing: AudioProcessingSettings
  audioEqPresets: AudioEqPreset[]
}

interface PlaybackSession {
  version: number
  savedAt: string
  mode: PlaybackResumeMode
  track: unknown
  position: number
}

interface SettingsSnapshot extends AppSettings {
  settings: AppSettings
  defaults: {
    cachePath: string
  }
  paths: {
    settingsFile: string
    userDataPath: string
    activeCachePath: string
  }
  appVersion: string
  platform: string
  restartRequired: boolean
  restartReasons: string[]
}

const DEFAULT_SETTINGS: AppSettings = {
  autoCheckLogin: true,
  autoLaunch: false,
  launchAtLogin: false,
  hardwareAcceleration: true,
  globalShortcuts: false,
  minimizeToTray: false,
  musicCachePath: '',
  cachePath: '',
  closeToTray: false,
  theme: 'pureWhite',
  blurEffect: true,
  useCoverTheme: true,
  lyricFontSize: 18,
  playbackResumeMode: 'off',
  audioOutput:
    process.platform === 'darwin' ? 'coreaudio' : process.platform === 'linux' ? 'alsa' : 'wasapi',
  audioDevice: 'auto',
  audioExclusiveMode: false,
  audioOutputConfig: {
    preferredBufferSize: 0,
    routingMode: 'auto'
  },
  audioProcessing: DEFAULT_AUDIO_PROCESSING,
  audioEqPresets: []
}

const PLAYER_SHORTCUTS: { accelerator: string; action: PlayerShortcutAction; label: string }[] = [
  { accelerator: 'CommandOrControl+Alt+Left', action: 'previous', label: '上一首' },
  { accelerator: 'CommandOrControl+Alt+Right', action: 'next', label: '下一首' },
  { accelerator: 'CommandOrControl+Alt+Space', action: 'playPause', label: '播放 / 暂停' }
]

function getSettingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function getDefaultCachePath(): string {
  return join(app.getPath('userData'), 'music-cache')
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function normalizeAudioEqPresets(presets: unknown): AudioEqPreset[] {
  if (!Array.isArray(presets)) return []

  return presets
    .map((preset, index): AudioEqPreset | null => {
      if (!preset || typeof preset !== 'object') return null
      const raw = preset as Partial<AudioEqPreset>
      const normalized = normalizeAudioProcessingSettings({
        eqMode: raw.eqMode,
        eqPreamp: raw.eqPreamp,
        eqBands: raw.eqBands
      })
      return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : `custom-${index}`,
        name:
          typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 40) : `Preset ${index + 1}`,
        eqMode: normalized.eqMode,
        eqPreamp: normalized.eqPreamp,
        eqBands: normalized.eqBands
      }
    })
    .filter((preset): preset is AudioEqPreset => Boolean(preset))
    .slice(0, 24)
}

function normalizeAppTheme(theme: unknown): AppTheme {
  return theme === 'aurora' || theme === 'pureWhite' ? theme : DEFAULT_SETTINGS.theme
}

function normalizePlaybackResumeMode(mode: unknown): PlaybackResumeMode {
  return mode === 'track' || mode === 'trackAndPosition' || mode === 'off'
    ? mode
    : DEFAULT_SETTINGS.playbackResumeMode
}

function normalizeAudioDevice(device: unknown): string {
  return typeof device === 'string' && device.trim() ? device.trim() : DEFAULT_SETTINGS.audioDevice
}

function normalizeChannelRoutingMode(value: unknown): ChannelRoutingMode {
  return value === 'stereo' ||
    value === 'stereo-to-5.1' ||
    value === 'stereo-to-7.1' ||
    value === 'mono-to-stereo' ||
    value === 'mono-to-multichannel'
    ? value
    : 'auto'
}

function normalizeOutputConfig(config: unknown): OutputConfig {
  if (!config || typeof config !== 'object') return { ...DEFAULT_SETTINGS.audioOutputConfig }
  const value = config as { preferredBufferSize?: unknown; routingMode?: unknown }
  return {
    preferredBufferSize:
      typeof value.preferredBufferSize === 'number'
        ? clampNumber(Math.trunc(value.preferredBufferSize), 0, 8192, 0)
        : DEFAULT_SETTINGS.audioOutputConfig.preferredBufferSize,
    routingMode: normalizeChannelRoutingMode(value.routingMode)
  }
}

function normalizeAppSettings(settings: Partial<AppSettings>): AppSettings {
  const rawCachePath =
    typeof settings.cachePath === 'string' && settings.cachePath.trim()
      ? settings.cachePath.trim()
      : typeof settings.musicCachePath === 'string' && settings.musicCachePath.trim()
        ? settings.musicCachePath.trim()
        : getDefaultCachePath()
  const cachePath = resolve(rawCachePath)
  const autoLaunch =
    typeof settings.autoLaunch === 'boolean'
      ? settings.autoLaunch
      : typeof settings.launchAtLogin === 'boolean'
        ? settings.launchAtLogin
        : DEFAULT_SETTINGS.autoLaunch
  const launchAtLogin =
    typeof settings.launchAtLogin === 'boolean' ? settings.launchAtLogin : autoLaunch
  const closeToTray =
    typeof settings.closeToTray === 'boolean'
      ? settings.closeToTray
      : typeof settings.minimizeToTray === 'boolean'
        ? settings.minimizeToTray
        : DEFAULT_SETTINGS.closeToTray
  const minimizeToTray =
    typeof settings.minimizeToTray === 'boolean' ? settings.minimizeToTray : closeToTray

  return {
    autoCheckLogin: settings.autoCheckLogin !== false,
    autoLaunch,
    launchAtLogin,
    hardwareAcceleration: settings.hardwareAcceleration !== false,
    globalShortcuts: settings.globalShortcuts === true,
    minimizeToTray,
    musicCachePath: cachePath,
    cachePath,
    closeToTray,
    theme: normalizeAppTheme(settings.theme),
    blurEffect: settings.blurEffect !== false,
    useCoverTheme: settings.useCoverTheme !== false,
    lyricFontSize: clampNumber(settings.lyricFontSize, 14, 28, DEFAULT_SETTINGS.lyricFontSize),
    playbackResumeMode: normalizePlaybackResumeMode(settings.playbackResumeMode),
    audioOutput: normalizeAudioOutput(settings.audioOutput),
    audioDevice: normalizeAudioDevice(settings.audioDevice),
    audioExclusiveMode: settings.audioExclusiveMode === true,
    audioOutputConfig: normalizeOutputConfig(settings.audioOutputConfig),
    audioProcessing: normalizeAudioProcessingSettings(settings.audioProcessing),
    audioEqPresets: normalizeAudioEqPresets(settings.audioEqPresets)
  }
}

function readAppSettings(): AppSettings {
  try {
    const filePath = getSettingsFilePath()
    if (!existsSync(filePath)) return { ...DEFAULT_SETTINGS }
    const raw = readFileSync(filePath, 'utf-8')
    return normalizeAppSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) })
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeAppSettings(settings: AppSettings): void {
  const filePath = getSettingsFilePath()
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
}

function getRestartReasons(settings: AppSettings, launch: AppSettings): string[] {
  const reasons: string[] = []
  if (settings.hardwareAcceleration !== launch.hardwareAcceleration) {
    reasons.push('GPU 加速')
  }
  if (resolve(settings.musicCachePath) !== resolve(launch.musicCachePath)) {
    reasons.push('缓存位置')
  }
  return reasons
}

function createSettingsSnapshot(settings: AppSettings, launch: AppSettings): SettingsSnapshot {
  const restartReasons = getRestartReasons(settings, launch)
  return {
    ...settings,
    settings: { ...settings },
    defaults: {
      cachePath: getDefaultCachePath()
    },
    paths: {
      settingsFile: getSettingsFilePath(),
      userDataPath: app.getPath('userData'),
      activeCachePath: launch.musicCachePath || getDefaultCachePath()
    },
    appVersion: app.getVersion(),
    platform: process.platform,
    restartRequired: restartReasons.length > 0,
    restartReasons
  }
}

async function getDirectorySize(directory: string): Promise<number> {
  try {
    const info = await stat(directory)
    if (!info.isDirectory()) return info.size

    const entries = await readdir(directory, { withFileTypes: true })
    const sizes = await Promise.all(
      entries.map((entry) => {
        const fullPath = join(directory, entry.name)
        return entry.isDirectory() ? getDirectorySize(fullPath) : stat(fullPath).then((s) => s.size)
      })
    )
    return sizes.reduce((sum, size) => sum + size, 0)
  } catch {
    return 0
  }
}

let appSettings = readAppSettings()
const launchSettings = { ...appSettings }

if (!appSettings.hardwareAcceleration) {
  app.disableHardwareAcceleration()
}

function ensureMusicCacheDirectories(rootPath: string): void {
  if (!rootPath) return
  mkdirSync(rootPath, { recursive: true })
  mkdirSync(join(rootPath, 'renderer-cache'), { recursive: true })
  mkdirSync(join(rootPath, 'audio-engine-cache'), { recursive: true })
  mkdirSync(join(rootPath, 'ncm-cache'), { recursive: true })
}

function getMusicCacheRoot(): string {
  const root = appSettings.musicCachePath || join(app.getPath('userData'), 'music-cache')
  ensureMusicCacheDirectories(root)
  return root
}

function getNcmCacheDir(): string {
  const dir = join(getMusicCacheRoot(), 'ncm-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

function inferNcmCacheExtension(
  url: string,
  contentType?: string | null,
  fileName?: string
): string {
  const nameExt = fileName ? extname(fileName).toLowerCase() : ''
  if (nameExt && /^[a-z0-9.]+$/i.test(nameExt)) return nameExt

  const mime = (contentType || '').toLowerCase()
  if (mime.includes('flac')) return '.flac'
  if (mime.includes('wav')) return '.wav'
  if (mime.includes('aac')) return '.aac'
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a'
  if (mime.includes('ogg')) return '.ogg'

  try {
    const parsed = new URL(url)
    const pathExt = extname(parsed.pathname).toLowerCase()
    if (pathExt && /^[a-z0-9.]+$/i.test(pathExt)) return pathExt
  } catch {
    /* keep fallback */
  }

  return '.mp3'
}

function getCachedNcmSong(songId: number): string | null {
  const dir = getNcmCacheDir()
  const prefix = `${songId}.`
  const file = readdirSync(dir).find((name) => name.startsWith(prefix))
  if (!file) return null
  const fullPath = join(dir, file)
  return existsSync(fullPath) ? fullPath : null
}

async function cacheNcmSong(
  songId: number,
  url: string,
  fileName?: string
): Promise<string | null> {
  if (!Number.isFinite(songId) || songId <= 0 || !/^https?:\/\//i.test(url)) return null

  const cached = getCachedNcmSong(songId)
  if (cached) return cached

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ext = inferNcmCacheExtension(url, res.headers.get('content-type'), fileName)
    const target = join(getNcmCacheDir(), `${songId}${ext}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    await writeFile(target, buffer)
    return target
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('网易云歌曲缓存失败：', songId, message)
    return null
  } finally {
    clearTimeout(timer)
  }
}

if (appSettings.musicCachePath) {
  try {
    ensureMusicCacheDirectories(appSettings.musicCachePath)
    app.commandLine.appendSwitch(
      'disk-cache-dir',
      join(appSettings.musicCachePath, 'renderer-cache')
    )
  } catch (err) {
    console.warn('无法使用自定义缓存目录：', err)
  }
}

const SUPPORTED_EXTENSIONS = [
  '.mp3',
  '.flac',
  '.wav',
  '.wave',
  '.aac',
  '.ogg',
  '.wma',
  '.m4a',
  '.mp4',
  '.aiff',
  '.aif',
  '.opus',
  '.webm',
  '.alac',
  '.ape',
  '.wv',
  '.dsf',
  '.dff',
  '.mqa'
]

const COVER_NAMES = [
  'cover.jpg',
  'cover.png',
  'cover.webp',
  'folder.jpg',
  'folder.png',
  'album.jpg',
  'album.png',
  'front.jpg',
  'front.png',
  'artwork.jpg',
  'artwork.png'
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
      } catch {
        /* skip */
      }
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
      } catch {
        /* skip */
      }
      // Yield to event loop every few files
      if (results.length % 100 === 0) {
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
  } catch {
    /* skip */
  }
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
      dir: file.dir,
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
      dir: file.dir,
      duration: 0,
      size: file.size,
      cover: findCoverInDir(file.dir),
      lyrics: findLyricsInDir(file.dir, file.fileName)
    }
  }
}

async function scanDirectory(
  dirPath: string,
  onProgress?: (current: number, total: number) => void
): Promise<unknown[]> {
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
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return results
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  const mime: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.wave': 'audio/wav',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.wma': 'audio/x-ms-wma',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff',
    '.opus': 'audio/opus',
    '.webm': 'audio/webm',
    '.alac': 'audio/mp4',
    '.ape': 'audio/ape',
    '.wv': 'audio/wavpack',
    '.dsf': 'audio/dsf',
    '.dff': 'audio/dsf',
    '.mqa': 'audio/flac'
  }
  return mime[ext] || 'application/octet-stream'
}

let audioEngineManager: AudioEngineManager | null = null
let mainWindow: BrowserWindow | null = null
let ncmServer: import('http').Server | null = null
let tray: Tray | null = null
let forceQuit = false
let closingAfterPlaybackSessionSave = false
let savingPlaybackSessionBeforeClose = false
const NCM_API_PORT = 3100
const PLAYBACK_SESSION_SAVE_TIMEOUT_MS = 1800
const pendingPlaybackSessionSaves = new Map<string, () => void>()

function resolvePlaybackSessionSave(requestId: string): void {
  const resolvePending = pendingPlaybackSessionSaves.get(requestId)
  if (!resolvePending) return
  pendingPlaybackSessionSaves.delete(requestId)
  resolvePending()
}

async function requestRendererPlaybackSessionSave(): Promise<void> {
  const win = mainWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return

  const requestId = randomUUID()
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      pendingPlaybackSessionSaves.delete(requestId)
      resolve()
    }, PLAYBACK_SESSION_SAVE_TIMEOUT_MS)

    pendingPlaybackSessionSaves.set(requestId, () => {
      clearTimeout(timer)
      resolve()
    })

    win.webContents.send('app:save-playback-session', requestId)
  })
}

async function closeMainWindowAfterPlaybackSessionSave(win: BrowserWindow): Promise<void> {
  savingPlaybackSessionBeforeClose = true
  try {
    await requestRendererPlaybackSessionSave()
  } catch (err) {
    console.warn('关闭前保存播放会话失败：', err)
  } finally {
    savingPlaybackSessionBeforeClose = false
    if (!win.isDestroyed()) {
      const shouldQuitAfterClose = forceQuit
      if (shouldQuitAfterClose) {
        win.once('closed', () => {
          setTimeout(() => app.quit(), 0)
        })
      }
      closingAfterPlaybackSessionSave = true
      win.close()
      closingAfterPlaybackSessionSave = false
    }
  }
}

function sendPlayerShortcut(action: PlayerShortcutAction): void {
  if (mainWindow?.isDestroyed() === false) {
    mainWindow.webContents.send('player:shortcut', action)
  }
}

function applyAutoLaunch(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath
    })
  } catch (err) {
    console.warn('设置开机自启动失败：', err)
  }
}

function unregisterPlayerShortcuts(): void {
  for (const shortcut of PLAYER_SHORTCUTS) {
    globalShortcut.unregister(shortcut.accelerator)
  }
}

function registerPlayerShortcuts(): void {
  unregisterPlayerShortcuts()
  if (!appSettings.globalShortcuts) return

  for (const shortcut of PLAYER_SHORTCUTS) {
    const ok = globalShortcut.register(shortcut.accelerator, () => {
      sendPlayerShortcut(shortcut.action)
    })
    if (!ok) {
      console.warn(`全局快捷键注册失败：${shortcut.label} ${shortcut.accelerator}`)
    }
  }
}

function createTray(): void {
  if (tray) return

  const iconPath = join(app.getAppPath(), 'resources', 'icon.png')
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('Twilight Echo')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示 Twilight Echo',
        click: () => {
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
      {
        label: '隐藏窗口',
        click: () => mainWindow?.hide()
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          forceQuit = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

function syncTrayState(): void {
  if (appSettings.closeToTray) {
    createTray()
  } else {
    destroyTray()
  }
}

function applyRuntimeSettings(): void {
  applyAutoLaunch(appSettings.autoLaunch)
  registerPlayerShortcuts()
  syncTrayState()
}

function persistAudioOutputState(state: AudioOutputState): SettingsSnapshot {
  appSettings = normalizeAppSettings({
    ...appSettings,
    audioOutput: state.output,
    audioDevice: state.device,
    audioExclusiveMode: state.exclusiveMode
  })
  writeAppSettings(appSettings)
  const snapshot = createSettingsSnapshot(appSettings, launchSettings)
  mainWindow?.webContents.send('settings:changed', snapshot)
  return snapshot
}

function persistAudioOutputConfig(config: OutputConfig): SettingsSnapshot {
  appSettings = normalizeAppSettings({
    ...appSettings,
    audioOutputConfig: config
  })
  writeAppSettings(appSettings)
  const snapshot = createSettingsSnapshot(appSettings, launchSettings)
  mainWindow?.webContents.send('settings:changed', snapshot)
  return snapshot
}

async function updateAppSettings(patch: Partial<AppSettings>): Promise<SettingsSnapshot> {
  const previousCachePath = appSettings.musicCachePath
  const shouldUpdateAudioProcessing = Object.prototype.hasOwnProperty.call(patch, 'audioProcessing')
  const shouldUpdateAudioOutputConfig = Object.prototype.hasOwnProperty.call(
    patch,
    'audioOutputConfig'
  )
  const shouldUpdateAudioOutput = Object.prototype.hasOwnProperty.call(patch, 'audioOutput')
  const shouldUpdateAudioDevice = Object.prototype.hasOwnProperty.call(patch, 'audioDevice')
  const shouldUpdateExclusiveMode = Object.prototype.hasOwnProperty.call(
    patch,
    'audioExclusiveMode'
  )
  appSettings = normalizeAppSettings({ ...appSettings, ...patch })

  if (
    audioEngineManager &&
    (shouldUpdateAudioOutput || shouldUpdateAudioDevice || shouldUpdateExclusiveMode)
  ) {
    let audioState: AudioOutputState
    if (shouldUpdateAudioOutput) {
      audioState = await audioEngineManager.setAudioOutput(
        appSettings.audioOutput,
        appSettings.audioDevice
      )
    } else if (shouldUpdateAudioDevice) {
      audioState = await audioEngineManager.setAudioDevice(appSettings.audioDevice)
    } else {
      audioState = await audioEngineManager.getAudioOutputState()
    }

    if (shouldUpdateExclusiveMode && audioState.exclusiveAvailable) {
      audioState = await audioEngineManager.setExclusiveMode(appSettings.audioExclusiveMode)
    }

    appSettings = normalizeAppSettings({
      ...appSettings,
      audioOutput: audioState.output,
      audioDevice: audioState.device,
      audioExclusiveMode: audioState.exclusiveMode
    })
  }

  writeAppSettings(appSettings)

  if (appSettings.musicCachePath && appSettings.musicCachePath !== previousCachePath) {
    try {
      ensureMusicCacheDirectories(appSettings.musicCachePath)
    } catch (err) {
      console.warn('创建缓存目录失败：', err)
    }
  }

  if (shouldUpdateAudioProcessing) {
    await audioEngineManager?.setAudioProcessing(appSettings.audioProcessing)
  }

  if (shouldUpdateAudioOutputConfig) {
    await audioEngineManager?.setOutputConfig(appSettings.audioOutputConfig)
  }

  applyRuntimeSettings()
  const snapshot = createSettingsSnapshot(appSettings, launchSettings)
  mainWindow?.webContents.send('settings:changed', snapshot)
  return snapshot
}

function relaunchApplication(): void {
  forceQuit = true
  app.relaunch({
    args: process.argv.slice(1)
  })
  app.quit()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1495,
    height: 883,
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

  mainWindow.on('close', (event) => {
    if (appSettings.closeToTray && !forceQuit) {
      event.preventDefault()
      mainWindow?.hide()
      return
    }

    if (!closingAfterPlaybackSessionSave) {
      event.preventDefault()
      if (!savingPlaybackSessionBeforeClose && mainWindow) {
        void closeMainWindowAfterPlaybackSessionSave(mainWindow)
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
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

function setupAudioEngineIpc(): void {
  audioEngineManager = new AudioEngineManager({
    exclusiveMode: appSettings.audioExclusiveMode,
    audioOutput: appSettings.audioOutput,
    audioDevice: appSettings.audioDevice,
    audioOutputConfig: appSettings.audioOutputConfig,
    audioProcessing: appSettings.audioProcessing
  })

  audioEngineManager.on('property-change', ({ name, data }) => {
    mainWindow?.webContents.send('audioEngine:property-change', { name, data })
  })

  audioEngineManager.on('end-file', ({ reason }) => {
    mainWindow?.webContents.send('audioEngine:end-file', { reason })
  })

  audioEngineManager.on('start-file', () => {
    mainWindow?.webContents.send('audioEngine:start-file')
  })

  audioEngineManager.on('error', (err: Error) => {
    console.error('[音频引擎]', err.message)
    mainWindow?.webContents.send('audioEngine:error', err.message)
  })

  audioEngineManager.on('ready', () => {
    mainWindow?.webContents.send('audioEngine:ready')
  })

  audioEngineManager.on('playback-info', (info) => {
    mainWindow?.webContents.send('audioEngine:playback-info', info)
  })

  function requireAudioEngine(): AudioEngineManager {
    if (!audioEngineManager) throw new Error('原生音频引擎尚未初始化')
    return audioEngineManager
  }

  function toQueueItem(raw: unknown): AudioEngineQueueItem | null {
    if (!raw || typeof raw !== 'object') return null
    const item = raw as Record<string, unknown>
    const source =
      typeof item.audioSource === 'string'
        ? item.audioSource
        : typeof item.playUrl === 'string'
          ? item.playUrl
          : typeof item.filePath === 'string'
            ? item.filePath
            : typeof item.streamUrl === 'string'
              ? item.streamUrl
              : ''
    if (!source) return null
    return {
      id: typeof item.id === 'string' ? item.id : source,
      source,
      title: typeof item.title === 'string' ? item.title : undefined,
      artist: typeof item.artist === 'string' ? item.artist : undefined,
      album: typeof item.album === 'string' ? item.album : undefined,
      duration: typeof item.duration === 'number' ? item.duration : undefined,
      codec: typeof item.format === 'string' ? item.format : undefined,
      sampleRate: typeof item.sampleRate === 'number' ? item.sampleRate : undefined,
      bitrate: typeof item.bitrate === 'number' ? item.bitrate : undefined,
      bitDepth: typeof item.bitDepth === 'number' ? item.bitDepth : undefined
    }
  }

  ipcMain.handle('audioEngine:loadQueue', async (_event, items: unknown[], startIndex?: number) => {
    const queue = Array.isArray(items)
      ? items.map(toQueueItem).filter((item): item is AudioEngineQueueItem => Boolean(item))
      : []
    await requireAudioEngine().loadQueue(queue, Number(startIndex) || 0)
  })

  ipcMain.handle('audioEngine:play', async (_event, source: string, startTime?: number) => {
    return await requireAudioEngine().play(source, startTime)
  })

  ipcMain.handle('audioEngine:togglePause', async () => {
    await requireAudioEngine().togglePause()
  })

  ipcMain.handle('audioEngine:pause', async () => {
    await requireAudioEngine().pause()
  })

  ipcMain.handle('audioEngine:seek', async (_event, time: number) => {
    await requireAudioEngine().seek(time)
  })

  ipcMain.handle('audioEngine:setVolume', async (_event, volume: number) => {
    await requireAudioEngine().setVolume(volume)
  })

  ipcMain.handle('audioEngine:stop', async () => {
    await requireAudioEngine().stop()
  })

  ipcMain.handle('audioEngine:next', async () => {
    await requireAudioEngine().next()
  })

  ipcMain.handle('audioEngine:previous', async () => {
    await requireAudioEngine().previous()
  })

  ipcMain.handle('audioEngine:setPlayMode', async (_event, mode: PlayMode) => {
    await requireAudioEngine().setPlayMode(mode)
  })

  ipcMain.handle('audioEngine:getUpcomingTrack', async () => {
    return requireAudioEngine().getUpcomingTrack()
  })

  ipcMain.handle('audioEngine:setExclusiveMode', async (_event, enabled: boolean) => {
    const state = await requireAudioEngine().setExclusiveMode(enabled)
    persistAudioOutputState(state)
    return state
  })

  ipcMain.handle('audioEngine:getExclusiveMode', async () => {
    return await requireAudioEngine().getExclusiveMode()
  })

  ipcMain.handle('audioEngine:setAudioOutput', async (_event, output: string, device?: string) => {
    const state = await requireAudioEngine().setAudioOutput(output as AudioOutputId, device)
    persistAudioOutputState(state)
    return state
  })

  ipcMain.handle('audioEngine:setAudioDevice', async (_event, device: string) => {
    const state = await requireAudioEngine().setAudioDevice(device)
    persistAudioOutputState(state)
    return state
  })

  ipcMain.handle('audioEngine:setOutputConfig', async (_event, config: unknown) => {
    const normalized = normalizeOutputConfig(config)
    await requireAudioEngine().setOutputConfig(normalized)
    persistAudioOutputConfig(normalized)
    return normalized
  })

  ipcMain.handle('audioEngine:getAudioOutput', async () => {
    return await requireAudioEngine().getAudioOutput()
  })

  ipcMain.handle('audioEngine:getAudioOutputOptions', async () => {
    return requireAudioEngine().getAudioOutputOptions()
  })

  ipcMain.handle('audioEngine:getAudioOutputState', async () => {
    return await requireAudioEngine().getAudioOutputState()
  })

  ipcMain.handle(
    'audioEngine:setAudioProcessing',
    async (_event, settings: Partial<AudioProcessingSettings>) => {
      const normalized = await requireAudioEngine().setAudioProcessing(settings)
      appSettings = normalizeAppSettings({ ...appSettings, audioProcessing: normalized })
      writeAppSettings(appSettings)
      return normalized
    }
  )

  ipcMain.handle('audioEngine:getAudioProcessing', async () => {
    return requireAudioEngine().getAudioProcessing()
  })

  ipcMain.handle('audioEngine:selectImpulseResponse', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const options: Electron.OpenDialogOptions = {
      title: '选择卷积脉冲响应',
      properties: ['openFile'],
      filters: [
        { name: 'Impulse Response', extensions: ['wav', 'flac', 'aiff', 'aif'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('audioEngine:loadImpulseResponse', async (_event, path: string) => {
    const info = await requireAudioEngine().loadImpulseResponse(path)
    appSettings = normalizeAppSettings({
      ...appSettings,
      audioProcessing: requireAudioEngine().getAudioProcessing()
    })
    writeAppSettings(appSettings)
    return info
  })

  ipcMain.handle('audioEngine:unloadImpulseResponse', async () => {
    const info = await requireAudioEngine().unloadImpulseResponse()
    appSettings = normalizeAppSettings({
      ...appSettings,
      audioProcessing: requireAudioEngine().getAudioProcessing()
    })
    writeAppSettings(appSettings)
    return info
  })

  ipcMain.handle('audioEngine:getConvolverInfo', async () => {
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle(
    'audioEngine:setEqBands',
    async (_event, settings: Partial<AudioProcessingSettings>) => {
      const normalized = await requireAudioEngine().setEqBands(settings)
      appSettings = normalizeAppSettings({ ...appSettings, audioProcessing: normalized })
      writeAppSettings(appSettings)
      return normalized
    }
  )

  ipcMain.handle(
    'audioEngine:setEqPreset',
    async (
      _event,
      preset: {
        eqMode: EqMode
        eqPreamp: number
        eqBands: EqualizerBand[]
      }
    ) => {
      const normalized = await requireAudioEngine().setEqPreset(preset)
      appSettings = normalizeAppSettings({ ...appSettings, audioProcessing: normalized })
      writeAppSettings(appSettings)
      return normalized
    }
  )

  ipcMain.handle('audioEngine:setCrossfeedStrength', async (_event, strength: number) => {
    const normalized = await requireAudioEngine().setCrossfeedStrength(Number(strength))
    appSettings = normalizeAppSettings({ ...appSettings, audioProcessing: normalized })
    writeAppSettings(appSettings)
    return normalized
  })

  ipcMain.handle(
    'audioEngine:setReplayGainMode',
    async (
      _event,
      mode: AudioProcessingSettings['volumeNormalization'],
      preamp?: number,
      fallback?: number,
      clip?: boolean
    ) => {
      const normalized = await requireAudioEngine().setReplayGainMode(mode, preamp, fallback, clip)
      appSettings = normalizeAppSettings({ ...appSettings, audioProcessing: normalized })
      writeAppSettings(appSettings)
      return normalized
    }
  )

  ipcMain.handle('audioEngine:getMetadata', async (_event, source: string) => {
    return requireAudioEngine().getMetadata(source)
  })

  ipcMain.handle('audioEngine:getPlaybackInfo', async () => {
    return await requireAudioEngine().getPlaybackInfo()
  })

  ipcMain.handle('audioEngine:getSpectrumData', async (_event, points?: number) => {
    return requireAudioEngine().getSpectrumData(points)
  })

  ipcMain.handle('audioEngine:getVisualizationData', async (_event, options?: unknown) => {
    return requireAudioEngine().getVisualizationData(
      typeof options === 'object' && options !== null ? options : {}
    )
  })

  audioEngineManager
    .start()
    .then(() => {
      console.log('原生音频引擎已启动')
    })
    .catch((err: Error) => {
      console.error('原生音频引擎启动失败：', err.message)
    })

  ipcMain.handle('ncm:getPort', () => NCM_API_PORT)

  ipcMain.handle('ncm:getCachedSong', async (_event, songId: number) => {
    return getCachedNcmSong(Number(songId))
  })

  ipcMain.handle(
    'ncm:cacheSong',
    async (_event, songId: number, url: string, fileName?: string) => {
      return await cacheNcmSong(Number(songId), url, fileName)
    }
  )

  ipcMain.handle('ncm:request', async (_event, path: string, cookie?: string) => {
    const sep = path.includes('?') ? '&' : '?'
    let url = `http://localhost:${NCM_API_PORT}${path}${sep}timestamp=${Date.now()}`
    if (cookie) {
      url += `&cookie=${encodeURIComponent(cookie)}`
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      const res = await fetch(url, { signal: controller.signal })
      return await res.json()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('网易云请求失败：', path, message)
      return {
        code: -1,
        message
      }
    } finally {
      clearTimeout(timer)
    }
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
    console.log(`网易云音乐服务已启动：http://localhost:${NCM_API_PORT}`)
  } catch (err) {
    console.error('网易云音乐服务启动失败：', err)
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

  ipcMain.handle('settings:get', async () => {
    return createSettingsSnapshot(appSettings, launchSettings)
  })

  ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
    return await updateAppSettings(patch)
  })

  ipcMain.handle('settings:chooseCacheFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
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

  ipcMain.handle('settings:selectMusicCachePath', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const options: Electron.OpenDialogOptions = {
      title: '选择音乐缓存位置',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:getCacheSize', async () => {
    return await getDirectorySize(appSettings.musicCachePath || getDefaultCachePath())
  })

  ipcMain.handle('settings:clearCache', async () => {
    const cachePath = appSettings.musicCachePath || getDefaultCachePath()
    try {
      await rm(cachePath, { recursive: true, force: true })
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

  const userDataPath = app.getPath('userData')
  const MUSIC_LIBRARY_FILE = join(userDataPath, 'music-library.json')
  const NCM_COOKIE_FILE = join(userDataPath, 'ncm-cookie.json')
  const PLAYBACK_SESSION_FILE = join(userDataPath, 'playback-session.json')

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
  applyRuntimeSettings()

  setupAudioEngineIpc()
  setupNcmApi()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !appSettings.closeToTray) {
    app.quit()
  }
})

app.on('before-quit', () => {
  forceQuit = true
})

app.on('will-quit', () => {
  unregisterPlayerShortcuts()
  destroyTray()
  audioEngineManager?.destroy()
  audioEngineManager = null
  if (ncmServer) {
    ncmServer.close()
    ncmServer = null
  }
})
