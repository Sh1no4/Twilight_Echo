import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  globalShortcut,
  Menu,
  nativeTheme,
  nativeImage,
  protocol,
  net,
  session,
  Tray,
  screen
} from 'electron'
import { join, extname, basename, dirname, resolve } from 'path'
import { readdirSync, statSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { readFile, writeFile, readdir, stat, rm } from 'fs/promises'
import { randomUUID, createHash } from 'crypto'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { parseFile } from 'music-metadata'
import DiscordRPC from 'discord-rpc'
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
  type PlaybackInfo,
  type OutputConfig,
  type PlayMode,
  type EqMode,
  type EqualizerBand
} from './audioEngineManager'
import {
  DEFAULT_HEADPHONE_COMPENSATION,
  buildEffectiveAudioProcessingSettings,
  normalizeHeadphoneCompensationSettings,
  type HeadphoneCompensationSettings
} from './audioProcessingEffective'
import { OpraCatalog } from './opraCatalog'
import { TwilightPluginManager } from './plugins/manager'
import { PluginIndexService } from './plugins/indexService'
import { derivePlaybackEvents } from './plugins/events'
import type { TwilightPluginUninstallOptions } from './plugins/types'

type PlayerShortcutAction = 'previous' | 'next' | 'playPause'
type AppTheme = 'system' | 'pureWhite' | 'dark'
type PlaybackResumeMode = 'off' | 'track' | 'trackAndPosition'
type UiDensity = 'compact' | 'standard' | 'comfortable'
type NowPlayingBackground = 'blur' | 'fluid' | 'solid'
type LyricAlign = 'center' | 'left'

interface DesktopLyricsSettings {
  enabled: boolean
  fontSize: number
  fontFamily: string
  fontWeight: number
  color: string
  highlightColor: string
  bgColor: string
  bgOpacity: number
  align: LyricAlign
  showTranslation: boolean
  lineSpacing: number
  shadow: boolean
  shadowBlur: number
  shadowColor: string
  windowWidth: number
  windowHeight: number
  windowX: number
  windowY: number
  alwaysOnTop: boolean
  clickThrough: boolean
  maxLines: number
}

const DEFAULT_DESKTOP_LYRICS: DesktopLyricsSettings = {
  enabled: false,
  fontSize: 32,
  fontFamily: 'system',
  fontWeight: 700,
  color: '#ffffff',
  highlightColor: '#FFD700',
  bgColor: '#000000',
  bgOpacity: 30,
  align: 'center',
  showTranslation: true,
  lineSpacing: 1.6,
  shadow: true,
  shadowBlur: 8,
  shadowColor: '#000000',
  windowWidth: 900,
  windowHeight: 160,
  windowX: -1,
  windowY: -1,
  alwaysOnTop: true,
  clickThrough: false,
  maxLines: 2
}

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
  pluginThemeId: string | null
  blurEffect: boolean
  useCoverTheme: boolean
  lyricFontSize: number
  libraryFolders: string[]
  watchLibrary: boolean
  smtcEnabled: boolean
  discordRpcEnabled: boolean
  accentColor: string
  fontFamily: string
  uiDensity: UiDensity
  nowPlayingBackground: NowPlayingBackground
  lyricAlign: LyricAlign
  lyricDimOpacity: number
  playbackResumeMode: PlaybackResumeMode
  audioOutput: AudioOutputId
  audioDevice: string
  audioExclusiveMode: boolean
  audioOutputConfig: OutputConfig
  audioProcessing: AudioProcessingSettings
  headphoneCompensation: HeadphoneCompensationSettings
  audioEqPresets: AudioEqPreset[]
  desktopLyrics: DesktopLyricsSettings
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
  theme: 'system',
  pluginThemeId: null,
  blurEffect: true,
  useCoverTheme: true,
  lyricFontSize: 18,
  libraryFolders: [],
  watchLibrary: true,
  smtcEnabled: true,
  discordRpcEnabled: false,
  accentColor: 'violet',
  fontFamily: 'system',
  uiDensity: 'standard',
  nowPlayingBackground: 'blur',
  lyricAlign: 'center',
  lyricDimOpacity: 40,
  playbackResumeMode: 'off',
  audioOutput:
    process.platform === 'darwin' ? 'coreaudio' : process.platform === 'linux' ? 'alsa' : 'wasapi',
  audioDevice: 'auto',
  audioExclusiveMode: false,
  audioOutputConfig: {
    preferredBufferSize: 0,
    routingMode: 'auto',
    wasapiExclusivePushMode: false
  },
  audioProcessing: DEFAULT_AUDIO_PROCESSING,
  headphoneCompensation: DEFAULT_HEADPHONE_COMPENSATION,
  audioEqPresets: [],
  desktopLyrics: { ...DEFAULT_DESKTOP_LYRICS }
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

function getOpraDatabaseCachePath(): string {
  return join(app.getPath('userData'), 'opra', 'database_v1.jsonl')
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map((n) => parseInt(n, 10) || 0)
  const partsB = b.split('.').map((n) => parseInt(n, 10) || 0)
  const maxLen = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < maxLen; i++) {
    const va = partsA[i] ?? 0
    const vb = partsB[i] ?? 0
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
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
  return theme === 'system' || theme === 'dark' || theme === 'pureWhite'
    ? theme
    : DEFAULT_SETTINGS.theme
}

function normalizePlaybackResumeMode(mode: unknown): PlaybackResumeMode {
  return mode === 'track' || mode === 'trackAndPosition' || mode === 'off'
    ? mode
    : DEFAULT_SETTINGS.playbackResumeMode
}

const ACCENT_COLORS = ['violet', 'blue', 'emerald', 'rose', 'amber', 'slate']

function normalizeAccentColor(value: unknown): string {
  return typeof value === 'string' && ACCENT_COLORS.includes(value)
    ? value
    : DEFAULT_SETTINGS.accentColor
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 64)
}

function normalizeUiDensity(value: unknown): UiDensity {
  return value === 'compact' || value === 'comfortable' ? value : 'standard'
}

function normalizeNowPlayingBackground(value: unknown): NowPlayingBackground {
  return value === 'fluid' || value === 'solid' ? value : 'blur'
}

function normalizePluginThemeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && /^[a-z][a-z0-9-_.]*:[a-z][a-z0-9-_.]*$/.test(normalized)
    ? normalized
    : null
}

function isDefaultAudioDeviceAlias(device: string): boolean {
  const normalized = device.trim()
  const lower = normalized.toLowerCase()
  return (
    lower === 'auto' ||
    lower === 'default' ||
    lower === 'system default' ||
    lower === 'system-default' ||
    normalized === '系统默认'
  )
}

function normalizeAudioDevice(device: unknown): string {
  if (typeof device !== 'string') return DEFAULT_SETTINGS.audioDevice
  const normalized = device.trim()
  if (!normalized || isDefaultAudioDeviceAlias(normalized)) return DEFAULT_SETTINGS.audioDevice
  return normalized
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
  const value = config as { preferredBufferSize?: unknown; routingMode?: unknown; wasapiExclusivePushMode?: unknown }
  return {
    preferredBufferSize:
      typeof value.preferredBufferSize === 'number'
        ? clampNumber(Math.trunc(value.preferredBufferSize), 0, 8192, 0)
        : DEFAULT_SETTINGS.audioOutputConfig.preferredBufferSize,
    routingMode: normalizeChannelRoutingMode(value.routingMode),
    wasapiExclusivePushMode: value.wasapiExclusivePushMode === true
  }
}

function normalizeDesktopLyrics(raw: unknown): DesktopLyricsSettings {
  const d = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    enabled: d.enabled === true,
    fontSize: clampNumber(d.fontSize, 12, 80, DEFAULT_DESKTOP_LYRICS.fontSize),
    fontFamily: typeof d.fontFamily === 'string' && d.fontFamily.trim()
      ? d.fontFamily.trim().slice(0, 64)
      : DEFAULT_DESKTOP_LYRICS.fontFamily,
    fontWeight: clampNumber(d.fontWeight, 100, 900, DEFAULT_DESKTOP_LYRICS.fontWeight),
    color: typeof d.color === 'string' ? d.color : DEFAULT_DESKTOP_LYRICS.color,
    highlightColor: typeof d.highlightColor === 'string' ? d.highlightColor : DEFAULT_DESKTOP_LYRICS.highlightColor,
    bgColor: typeof d.bgColor === 'string' ? d.bgColor : DEFAULT_DESKTOP_LYRICS.bgColor,
    bgOpacity: clampNumber(d.bgOpacity, 0, 100, DEFAULT_DESKTOP_LYRICS.bgOpacity),
    align: d.align === 'left' ? 'left' : 'center',
    showTranslation: d.showTranslation !== false,
    lineSpacing: clampNumber(d.lineSpacing, 1.0, 3.0, DEFAULT_DESKTOP_LYRICS.lineSpacing),
    shadow: d.shadow !== false,
    shadowBlur: clampNumber(d.shadowBlur, 0, 30, DEFAULT_DESKTOP_LYRICS.shadowBlur),
    shadowColor: typeof d.shadowColor === 'string' ? d.shadowColor : DEFAULT_DESKTOP_LYRICS.shadowColor,
    windowWidth: clampNumber(d.windowWidth, 200, 3000, DEFAULT_DESKTOP_LYRICS.windowWidth),
    windowHeight: clampNumber(d.windowHeight, 60, 800, DEFAULT_DESKTOP_LYRICS.windowHeight),
    windowX: typeof d.windowX === 'number' ? d.windowX : -1,
    windowY: typeof d.windowY === 'number' ? d.windowY : -1,
    alwaysOnTop: d.alwaysOnTop !== false,
    clickThrough: d.clickThrough === true,
    maxLines: clampNumber(d.maxLines, 1, 5, DEFAULT_DESKTOP_LYRICS.maxLines)
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
    pluginThemeId: normalizePluginThemeId(settings.pluginThemeId),
    blurEffect: settings.blurEffect !== false,
    useCoverTheme: settings.useCoverTheme !== false,
    lyricFontSize: clampNumber(settings.lyricFontSize, 14, 28, DEFAULT_SETTINGS.lyricFontSize),
    libraryFolders: normalizeStringArray(settings.libraryFolders),
    watchLibrary: settings.watchLibrary !== false,
    smtcEnabled: settings.smtcEnabled !== false,
    discordRpcEnabled: settings.discordRpcEnabled === true,
    accentColor: normalizeAccentColor(settings.accentColor),
    fontFamily: typeof settings.fontFamily === 'string' && settings.fontFamily.trim()
      ? settings.fontFamily.trim().slice(0, 64)
      : DEFAULT_SETTINGS.fontFamily,
    uiDensity: normalizeUiDensity(settings.uiDensity),
    nowPlayingBackground: normalizeNowPlayingBackground(settings.nowPlayingBackground),
    lyricAlign: settings.lyricAlign === 'left' ? 'left' : 'center',
    lyricDimOpacity: clampNumber(settings.lyricDimOpacity, 10, 100, DEFAULT_SETTINGS.lyricDimOpacity),
    playbackResumeMode: normalizePlaybackResumeMode(settings.playbackResumeMode),
    audioOutput: normalizeAudioOutput(settings.audioOutput),
    audioDevice: normalizeAudioDevice(settings.audioDevice),
    audioExclusiveMode: settings.audioExclusiveMode === true,
    audioOutputConfig: normalizeOutputConfig(settings.audioOutputConfig),
    audioProcessing: normalizeAudioProcessingSettings(settings.audioProcessing),
    headphoneCompensation: normalizeHeadphoneCompensationSettings(settings.headphoneCompensation),
    audioEqPresets: normalizeAudioEqPresets(settings.audioEqPresets),
    desktopLyrics: normalizeDesktopLyrics(settings.desktopLyrics)
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
let pluginManager: TwilightPluginManager | null = null
let pluginIndexService: PluginIndexService | null = null
let opraCatalog: OpraCatalog | null = null

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
  '.mqa',
  '.iso'
]

function encodeAudioFileUrlPath(filePath: string): string {
  return Buffer.from(filePath, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function decodeAudioFileUrlPath(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='), 'base64').toString(
    'utf-8'
  )
}

async function resolvePlayableAudioFile(filePath: string): Promise<string> {
  const resolvedPath = resolve(filePath)
  const fileStat = await stat(resolvedPath)
  if (!fileStat.isFile()) {
    throw new Error('音频路径不是文件')
  }
  if (!SUPPORTED_EXTENSIONS.includes(extname(resolvedPath).toLowerCase())) {
    throw new Error('不支持的音频文件类型')
  }
  return resolvedPath
}

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

// ─── Cover thumbnail disk cache ─────────────────────────────────────
// Covers are resized to 500px JPEG (~30-80KB each) and stored on disk.
// Track.cover stores "cover://<hash>.jpg" instead of multi-MB base64 strings.
// A pre-blurred 32px version ("cover://<hash>_blur.jpg") is also generated
// for background use, eliminating expensive CSS filter: blur() at runtime.
const COVER_THUMBNAIL_WIDTH = 500
const COVER_JPEG_QUALITY = 85
const COVER_BLUR_WIDTH = 32

function getCoverCacheDir(): string {
  return join(app.getPath('userData'), 'cover-cache')
}

function ensureCoverCacheDir(): string {
  const dir = getCoverCacheDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Extract cover from image buffer, resize, save to disk cache. Returns cover:// handle.
 *  Also generates a tiny pre-blurred version for background use. */
function cacheCoverFromBuffer(data: Buffer, _mime?: string): string | null {
  try {
    const img = nativeImage.createFromBuffer(data)
    if (img.isEmpty()) return null
    const originalSize = img.getSize()
    let resized = img
    if (originalSize.width > COVER_THUMBNAIL_WIDTH) {
      resized = img.resize({ width: COVER_THUMBNAIL_WIDTH, quality: 'good' })
    }
    const jpegBuf = resized.toJPEG(COVER_JPEG_QUALITY)
    const hash = createHash('md5').update(jpegBuf).digest('hex').slice(0, 16)
    const fileName = `${hash}.jpg`
    const cacheDir = ensureCoverCacheDir()
    const fullPath = join(cacheDir, fileName)
    if (!existsSync(fullPath)) {
      writeFileSync(fullPath, jpegBuf)
    }
    // Generate pre-blurred tiny version for background (eliminates CSS blur at runtime)
    const blurFileName = `${hash}_blur.jpg`
    const blurPath = join(cacheDir, blurFileName)
    if (!existsSync(blurPath)) {
      const blurred = resized.resize({ width: COVER_BLUR_WIDTH, quality: 'good' })
      writeFileSync(blurPath, blurred.toJPEG(60))
    }
    return `cover://${fileName}`
  } catch {
    return null
  }
}

/** Extract cover from an image file on disk, resize, save to cache. Returns cover:// handle. */
function cacheCoverFromFile(filePath: string): string | null {
  try {
    const data = readFileSync(filePath)
    return cacheCoverFromBuffer(data)
  } catch {
    return null
  }
}

/** Read a cached cover file and return as base64 data URL. */
function readCachedCover(handle: string): string | null {
  if (!handle.startsWith('cover://')) return null
  const fileName = handle.slice('cover://'.length)
  const fullPath = join(getCoverCacheDir(), fileName)
  if (!existsSync(fullPath)) return null
  try {
    const data = readFileSync(fullPath)
    return `data:image/jpeg;base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

/** Migrate a base64 data: URL cover to disk cache. Returns cover:// handle. */
function migrateBase64Cover(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  try {
    const buf = Buffer.from(match[2], 'base64')
    return cacheCoverFromBuffer(buf, match[1])
  } catch {
    return null
  }
}

const coverCache = new Map<string, string | null>()

function findCoverInDir(dir: string): string | null {
  if (coverCache.has(dir)) return coverCache.get(dir) ?? null
  for (const name of COVER_NAMES) {
    const fullPath = join(dir, name)
    if (existsSync(fullPath)) {
      const handle = cacheCoverFromFile(fullPath)
      if (handle) {
        coverCache.set(dir, handle)
        return handle
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
  const queue: string[] = [dirPath]

  while (queue.length > 0) {
    const currentDir = queue.shift()!
    try {
      const entries = readdirSync(currentDir)
      for (const entry of entries) {
        const fullPath = join(currentDir, entry)
        try {
          const st = statSync(fullPath)
          if (st.isDirectory()) {
            queue.push(fullPath)
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
  }
  return results
}

async function parseTrack(file: FileEntry): Promise<unknown[]> {
  const ext = file.fileName.toLowerCase()
  if (ext.endsWith('.iso')) {
    try {
      const meta = await audioEngineManager?.getMetadataAsync(file.fullPath)
      if (meta && meta.isoTracks && meta.isoTracks.length > 0) {
        return meta.isoTracks.filter(isoTrack => isoTrack.playable !== false).map(isoTrack => {
          return {
            id: randomUUID(),
            title: isoTrack.title || 'Unknown Track',
            artist: isoTrack.artist || 'Unknown Artist',
            album: isoTrack.album || 'Unknown Album',
            filePath: file.fullPath,
            fileName: file.fileName,
            dir: file.dir,
            duration: Math.round(isoTrack.duration || 0),
            size: file.size,
            cover: findCoverInDir(file.dir),
            lyrics: findLyricsInDir(file.dir, file.fileName),
            format: isoTrack.container || 'SACD ISO',
            sampleRate: isoTrack.sampleRate,
            bitDepth: isoTrack.bitDepth || 1,
            subTrack: isoTrack.source
          }
        })
      }
    } catch {
      /* fallback below */
    }
  }

  const id = randomUUID()
  try {
    const meta = await parseFile(file.fullPath, { skipCovers: false })
    const common = meta.common

    let cover: string | null = null

    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0]
      cover = cacheCoverFromBuffer(Buffer.from(pic.data), pic.format)
    }

    if (!cover) {
      cover = findCoverInDir(file.dir)
    }

    const artist = common.artist || common.albumartist
    const title = common.title
    const album = common.album

    const fileName = getNameFromFile(file.fullPath)

    // Lyrics are NOT loaded during scan — they're lazy-loaded on playback
    // to avoid keeping hundreds of MB of LRC text in memory permanently.

    return [{
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
      lyrics: null,
      format: meta.format.container,
      sampleRate: meta.format.sampleRate,
      bitrate: meta.format.bitrate,
      bitDepth: meta.format.bitsPerSample
    }]
  } catch {
    const fileName = getNameFromFile(file.fullPath)
    return [{
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
      lyrics: null
    }]
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
    results.push(...batchResults.flat())

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
let desktopLyricsWindow: BrowserWindow | null = null
let ncmServer: import('http').Server | null = null
let tray: Tray | null = null
let forceQuit = false
let closingAfterPlaybackSessionSave = false
let savingPlaybackSessionBeforeClose = false
let lastPluginPlaybackInfo: PlaybackInfo | null = null
const NCM_API_PORT = 3100
const PLAYBACK_SESSION_SAVE_TIMEOUT_MS = 1800
const NCM_OFFICIAL_LOGIN_TIMEOUT_MS = 180000
const NCM_API_REQUEST_TIMEOUT_MS = 25000
const pendingPlaybackSessionSaves = new Map<string, () => void>()

function bundledPluginPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'plugins', name)
    : join(process.cwd(), 'resources', 'plugins', name)
}

function bundledPluginIndexPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'plugin-index', 'plugins.json')
    : join(process.cwd(), 'resources', 'plugin-index', 'plugins.json')
}

async function requestNcmApi(path: string, cookie?: string): Promise<unknown> {
  const sep = path.includes('?') ? '&' : '?'
  let url = `http://localhost:${NCM_API_PORT}${path}${sep}timestamp=${Date.now()}`
  const headers: Record<string, string> = {}
  if (cookie) {
    headers.Cookie = cookie
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .join('; ')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NCM_API_REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers })
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
}

async function collectNcmOfficialCookie(partition: string): Promise<string> {
  const ses = session.fromPartition(partition)
  const cookies = await ses.cookies.get({ domain: '.music.163.com' })
  const names = new Set(['MUSIC_U', '__csrf', 'NMTID', 'MUSIC_A'])
  return cookies
    .filter((cookie) => names.has(cookie.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join(';')
}

async function openNcmOfficialLogin(): Promise<string> {
  const partition = `persist:twilight-ncm-login-${Date.now()}`
  const ses = session.fromPartition(partition)
  await ses.clearStorageData().catch(() => undefined)

  return await new Promise<string>((resolveLogin, rejectLogin) => {
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
    const loginWindow = new BrowserWindow({
      width: 920,
      height: 680,
      minWidth: 720,
      minHeight: 560,
      title: '网易云音乐登录',
      parent: owner,
      modal: false,
      show: false,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })

    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      ses.cookies.removeListener('changed', handleCookieChanged)
      loginWindow.removeAllListeners('closed')
    }
    const finish = (cookie: string): void => {
      if (settled) return
      settled = true
      cleanup()
      if (!loginWindow.isDestroyed()) loginWindow.close()
      resolveLogin(cookie)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (!loginWindow.isDestroyed()) loginWindow.close()
      rejectLogin(error)
    }
    const checkCookie = async (): Promise<void> => {
      const cookie = await collectNcmOfficialCookie(partition)
      if (cookie.includes('MUSIC_U=')) finish(cookie)
    }
    const handleCookieChanged = (): void => {
      void checkCookie().catch(() => undefined)
    }
    const timer = setTimeout(() => {
      fail(new Error('网易云官方登录超时'))
    }, NCM_OFFICIAL_LOGIN_TIMEOUT_MS)

    ses.cookies.on('changed', handleCookieChanged)
    loginWindow.once('closed', () => {
      if (!settled) {
        settled = true
        cleanup()
        rejectLogin(new Error('已取消网易云官方登录'))
      }
    })
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?music\.163\.com\//i.test(url)) return { action: 'allow' }
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    loginWindow.webContents.on('will-navigate', (event, url) => {
      if (/^https?:\/\/([^/]+\.)?music\.163\.com\//i.test(url)) return
      event.preventDefault()
      void shell.openExternal(url)
    })
    loginWindow.once('ready-to-show', () => loginWindow.show())
    loginWindow
      .loadURL('https://music.163.com/#/login')
      .then(() => checkCookie())
      .catch((error) => fail(error instanceof Error ? error : new Error(String(error))))
  })
}

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
  } catch {
    // Some platforms / sandboxed environments don't support setLoginItemSettings
  }
}

// ── Discord Rich Presence ──────────────────────────────────────────
const DISCORD_CLIENT_ID = '1390521943809896488' // Twilight Echo application ID
interface DiscordActivityData {
  title: string
  artist: string
  album?: string
  playing: boolean
  startTime?: number
}

let discordClient: DiscordRPC.Client | null = null
let discordConnected = false
let discordConnectAttempted = false
let discordReconnectTimer: NodeJS.Timeout | null = null
let lastDiscordActivity: DiscordActivityData | null = null

function connectDiscord(): void {
  if (discordConnectAttempted || discordConnected) return
  discordConnectAttempted = true
  try {
    discordClient = new DiscordRPC.Client({ transport: 'ipc' })
    discordClient.once('connected', () => {
      discordConnected = true
      if (lastDiscordActivity) updateDiscordActivity(lastDiscordActivity)
    })
    discordClient.once('disconnected', () => {
      discordConnected = false
      discordClient = null
      if (discordReconnectTimer) clearTimeout(discordReconnectTimer)
      discordReconnectTimer = setTimeout(() => {
        discordConnectAttempted = false
        if (appSettings.discordRpcEnabled) connectDiscord()
      }, 15000)
    })
    void discordClient.login({ clientId: DISCORD_CLIENT_ID }).catch(() => {
      // Discord not running or IPC unavailable — silently retry later
      discordConnected = false
      discordClient = null
      if (discordReconnectTimer) clearTimeout(discordReconnectTimer)
      discordReconnectTimer = setTimeout(() => {
        discordConnectAttempted = false
        if (appSettings.discordRpcEnabled) connectDiscord()
      }, 30000)
    })
  } catch {
    discordConnectAttempted = false
  }
}

function disconnectDiscord(): void {
  if (discordReconnectTimer) {
    clearTimeout(discordReconnectTimer)
    discordReconnectTimer = null
  }
  if (discordClient) {
    try { void discordClient.destroy() } catch { /* ignore */ }
    discordClient = null
  }
  discordConnected = false
  discordConnectAttempted = false
}

function updateDiscordActivity(data: DiscordActivityData): void {
  lastDiscordActivity = data
  if (!discordConnected || !discordClient) return
  const activity: DiscordRPC.Presence = {
    details: data.title || 'Unknown track',
    state: data.artist ? `by ${data.artist}` : '',
    instance: false
  }
  if (data.playing && data.startTime) {
    activity.startTimestamp = data.startTime
    activity.type = 2 // ActivityType.Listening
  }
  try {
    void discordClient.setActivity(activity)
  } catch {
    // ignore transient errors
  }
}

function clearDiscordActivity(): void {
  lastDiscordActivity = null
  if (!discordConnected || !discordClient) return
  try { void discordClient.clearActivity() } catch { /* ignore */ }
}

function applyDiscordRpcSetting(enabled: boolean): void {
  if (enabled) {
    connectDiscord()
  } else {
    clearDiscordActivity()
    disconnectDiscord()
  }
}
// ── end Discord Rich Presence ──────────────────────────────────────

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
  applyDiscordRpcSetting(appSettings.discordRpcEnabled)
  applyLibraryWatchers(appSettings.libraryFolders, appSettings.watchLibrary)
  registerPlayerShortcuts()
  syncTrayState()
}

// ── Library folder watchers ───────────────────────────────────────
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ape', '.m4a', '.ogg', '.opus', '.wma', '.aac', '.dsf', '.dff', '.iso'])
const libraryWatchers = new Map<string, { watcher: ReturnType<typeof import('fs')['watch']>; debounce: NodeJS.Timeout | null }>()
let libraryWatcherDebounceMs = 2000

function notifyLibraryChanged(): void {
  mainWindow?.webContents.send('library:changed')
}

function createFolderWatcher(folder: string): void {
  if (libraryWatchers.has(folder)) return
  try {
    const { watch } = require('fs') as typeof import('fs')
    const watcher = watch(folder, { recursive: true }, (_eventType, filename) => {
      if (!filename) return
      const ext = extname(filename).toLowerCase()
      if (!AUDIO_EXTENSIONS.has(ext)) return
      const entry = libraryWatchers.get(folder)
      if (!entry) return
      if (entry.debounce) clearTimeout(entry.debounce)
      entry.debounce = setTimeout(() => {
        entry.debounce = null
        notifyLibraryChanged()
      }, libraryWatcherDebounceMs)
    })
    libraryWatchers.set(folder, { watcher, debounce: null })
  } catch {
    // Folder may not exist yet or watching unsupported — skip silently
  }
}

function removeFolderWatcher(folder: string): void {
  const entry = libraryWatchers.get(folder)
  if (!entry) return
  if (entry.debounce) clearTimeout(entry.debounce)
  try { entry.watcher.close() } catch { /* ignore */ }
  libraryWatchers.delete(folder)
}

function applyLibraryWatchers(folders: string[], enabled: boolean): void {
  // Remove watchers for folders no longer in the list
  for (const folder of libraryWatchers.keys()) {
    if (!folders.includes(folder)) removeFolderWatcher(folder)
  }
  if (!enabled) {
    // Remove all watchers when monitoring is disabled
    for (const folder of libraryWatchers.keys()) removeFolderWatcher(folder)
    return
  }
  // Add watchers for new folders
  for (const folder of folders) {
    if (!libraryWatchers.has(folder)) createFolderWatcher(folder)
  }
}
// ── end Library folder watchers ───────────────────────────────────

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

function broadcastPlayerLifecycleEvents(info: PlaybackInfo): void {
  const previous = lastPluginPlaybackInfo
  lastPluginPlaybackInfo = info
  for (const event of derivePlaybackEvents(previous, info)) {
    const payload =
      event.name === 'player:progress'
        ? event.payload
        : info
    void pluginManager?.broadcastEvent(event.name, payload)
  }
}

function persistAudioProcessingState(processing: AudioProcessingSettings): SettingsSnapshot {
  appSettings = normalizeAppSettings({
    ...appSettings,
    audioProcessing: processing
  })
  writeAppSettings(appSettings)
  const snapshot = createSettingsSnapshot(appSettings, launchSettings)
  mainWindow?.webContents.send('settings:changed', snapshot)
  return snapshot
}

function getEffectiveAudioProcessing(settings: AppSettings = appSettings): AudioProcessingSettings {
  return buildEffectiveAudioProcessingSettings(
    settings.audioProcessing,
    settings.headphoneCompensation
  )
}

async function applyEffectiveAudioProcessingToEngine(): Promise<AudioProcessingSettings | null> {
  if (!audioEngineManager) return null
  return await audioEngineManager.setAudioProcessing(getEffectiveAudioProcessing())
}

async function persistAndApplyAudioProcessingState(
  processing: AudioProcessingSettings
): Promise<SettingsSnapshot> {
  const snapshot = persistAudioProcessingState(processing)
  try {
    await applyEffectiveAudioProcessingToEngine()
  } catch (err) {
    console.warn('应用合成 DSP 设置到音频引擎失败，已保留用户设置：', err)
  }
  return snapshot
}

async function updateAppSettings(patch: Partial<AppSettings>): Promise<SettingsSnapshot> {
  const previousCachePath = appSettings.musicCachePath
  const shouldUpdateAudioProcessing = Object.prototype.hasOwnProperty.call(patch, 'audioProcessing')
  const shouldUpdateHeadphoneCompensation = Object.prototype.hasOwnProperty.call(
    patch,
    'headphoneCompensation'
  )
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

  if ((shouldUpdateAudioProcessing || shouldUpdateHeadphoneCompensation) && audioEngineManager) {
    try {
      await applyEffectiveAudioProcessingToEngine()
    } catch (err) {
      console.warn('应用合成 DSP 设置到音频引擎失败，已保留设置：', err)
    }
  }

  if (shouldUpdateAudioOutputConfig) {
    await audioEngineManager?.setOutputConfig(appSettings.audioOutputConfig)
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'discordRpcEnabled')) {
    applyDiscordRpcSetting(appSettings.discordRpcEnabled)
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, 'libraryFolders') ||
    Object.prototype.hasOwnProperty.call(patch, 'watchLibrary')
  ) {
    applyLibraryWatchers(appSettings.libraryFolders, appSettings.watchLibrary)
  }

  // Forward desktop lyrics settings changes directly to the lyrics window
  if (
    Object.prototype.hasOwnProperty.call(patch, 'desktopLyrics') &&
    desktopLyricsWindow &&
    !desktopLyricsWindow.isDestroyed()
  ) {
    const dl = appSettings.desktopLyrics
    desktopLyricsWindow.setAlwaysOnTop(dl.alwaysOnTop, 'screen-saver')
    desktopLyricsWindow.setIgnoreMouseEvents(dl.clickThrough, { forward: true })
    if (
      dl.windowWidth !== desktopLyricsWindow.getBounds().width ||
      dl.windowHeight !== desktopLyricsWindow.getBounds().height
    ) {
      desktopLyricsWindow.setSize(dl.windowWidth, dl.windowHeight)
    }
    desktopLyricsWindow.webContents.send('desktopLyrics:initSettings', dl)
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

function getWindowBackgroundColor(settings: AppSettings): string {
  if (settings.theme === 'dark') return '#080b12'
  if (settings.theme === 'system' && nativeTheme.shouldUseDarkColors) return '#080b12'
  return '#ffffff'
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1495,
    height: 883,
    show: false,
    frame: false,
    backgroundColor: getWindowBackgroundColor(appSettings),
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
    audioProcessing: getEffectiveAudioProcessing()
  }, {
    audioServiceEntry: join(__dirname, 'audioEngineService.js')
  })

  audioEngineManager.on('property-change', ({ name, data }) => {
    mainWindow?.webContents.send('audioEngine:property-change', { name, data })
    void pluginManager?.broadcastEvent(`audioEngine:${name}`, data)
  })

  audioEngineManager.on('end-file', ({ reason }) => {
    mainWindow?.webContents.send('audioEngine:end-file', { reason })
    void pluginManager?.broadcastEvent('audioEngine:end-file', { reason })
  })

  audioEngineManager.on('start-file', () => {
    mainWindow?.webContents.send('audioEngine:start-file')
    void pluginManager?.broadcastEvent('audioEngine:start-file', null)
  })

  audioEngineManager.on('queue-change', (queue) => {
    void pluginManager?.broadcastEvent('player:queue-change', { queue })
  })

  audioEngineManager.on('error', (err: Error) => {
    console.error('[音频引擎]', err.message)
    mainWindow?.webContents.send('audioEngine:error', err.message)
  })

  audioEngineManager.on('audio-service-crash', ({ reason }) => {
    console.error('[音频服务]', reason)
    mainWindow?.webContents.send('audioEngine:error', `音频服务已重启：${reason}`)
    void pluginManager?.handleNativeDspHostCrash(reason)
  })

  audioEngineManager.on('ready', () => {
    mainWindow?.webContents.send('audioEngine:ready')
    void pluginManager?.broadcastEvent('audioEngine:ready', null)
  })

  audioEngineManager.on('playback-info', (info) => {
    mainWindow?.webContents.send('audioEngine:playback-info', info)
    void pluginManager?.broadcastEvent('player:playback-info', info)
    broadcastPlayerLifecycleEvents(info)
  })

  function requireAudioEngine(): AudioEngineManager {
    if (!audioEngineManager) throw new Error('原生音频引擎尚未初始化')
    return audioEngineManager
  }

  function toQueueItem(raw: unknown): AudioEngineQueueItem | null {
    if (!raw || typeof raw !== 'object') return null
    const item = raw as Record<string, unknown>
    const source =
      typeof item.source === 'string'
        ? item.source
        : typeof item.audioSource === 'string'
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
      const normalized = normalizeAudioProcessingSettings({
        ...appSettings.audioProcessing,
        ...settings
      })
      await persistAndApplyAudioProcessingState(normalized)
      return appSettings.audioProcessing
    }
  )

  ipcMain.handle('audioEngine:getAudioProcessing', async () => {
    return appSettings.audioProcessing
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
    const normalized = normalizeAudioProcessingSettings({
      ...appSettings.audioProcessing,
      dspEnabled: true,
      convolverEnabled: true,
      convolverIrPath: path
    })
    await persistAndApplyAudioProcessingState(normalized)
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle('audioEngine:unloadImpulseResponse', async () => {
    const normalized = normalizeAudioProcessingSettings({
      ...appSettings.audioProcessing,
      convolverEnabled: false,
      convolverIrPath: ''
    })
    await persistAndApplyAudioProcessingState(normalized)
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle('audioEngine:getConvolverInfo', async () => {
    return requireAudioEngine().getConvolverInfo()
  })

  ipcMain.handle(
    'audioEngine:setEqBands',
    async (_event, settings: Partial<AudioProcessingSettings>) => {
      const normalized = normalizeAudioProcessingSettings({
        ...appSettings.audioProcessing,
        ...settings,
        dspEnabled: true,
        eqEnabled: true
      })
      await persistAndApplyAudioProcessingState(normalized)
      return appSettings.audioProcessing
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
      const normalized = normalizeAudioProcessingSettings({
        ...appSettings.audioProcessing,
        ...preset,
        dspEnabled: true,
        eqEnabled: true
      })
      await persistAndApplyAudioProcessingState(normalized)
      return appSettings.audioProcessing
    }
  )

  ipcMain.handle('audioEngine:setCrossfeedStrength', async (_event, strength: number) => {
    const normalizedStrength = Number(strength)
    const normalized = normalizeAudioProcessingSettings({
      ...appSettings.audioProcessing,
      dspEnabled: true,
      crossfeedEnabled: normalizedStrength > 0,
      crossfeedStrength: normalizedStrength
    })
    await persistAndApplyAudioProcessingState(normalized)
    return appSettings.audioProcessing
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
      const normalized = normalizeAudioProcessingSettings({
        ...appSettings.audioProcessing,
        dspEnabled: true,
        volumeNormalization: mode,
        replayGainPreamp: preamp ?? appSettings.audioProcessing.replayGainPreamp,
        replayGainFallback: fallback ?? appSettings.audioProcessing.replayGainFallback,
        replayGainClip: clip ?? appSettings.audioProcessing.replayGainClip
      })
      await persistAndApplyAudioProcessingState(normalized)
      return appSettings.audioProcessing
    }
  )

  ipcMain.handle('audioEngine:getMetadata', async (_event, source: string) => {
    return await requireAudioEngine().getMetadataAsync(source)
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
    return requestNcmApi(path, cookie)
  })
}

function setupOpraIpc(): void {
  opraCatalog = new OpraCatalog(getOpraDatabaseCachePath())
  void opraCatalog.loadFromCache()

  function requireOpraCatalog(): OpraCatalog {
    if (!opraCatalog) {
      opraCatalog = new OpraCatalog(getOpraDatabaseCachePath())
    }
    return opraCatalog
  }

  ipcMain.handle('opra:search', async (_event, query: string) => {
    return await requireOpraCatalog().search(typeof query === 'string' ? query : '')
  })

  ipcMain.handle('opra:getProfile', async (_event, eqId: string) => {
    return await requireOpraCatalog().getProfile(typeof eqId === 'string' ? eqId : '')
  })

  ipcMain.handle('opra:refresh', async () => {
    return await requireOpraCatalog().refresh()
  })

  ipcMain.handle('opra:getStatus', async () => {
    return requireOpraCatalog().getStatus()
  })
}

function setupPluginIpc(): void {
  if (pluginManager) return
  const bundledPluginIds = ['com.twilightecho.provider.ncm']
  pluginManager = new TwilightPluginManager({
    appVersion: app.getVersion(),
    hostEntry: join(__dirname, 'pluginHost.js'),
    bundledPlugins: [
      {
        id: bundledPluginIds[0],
        sourcePath: bundledPluginPath('ncm-provider'),
        defaultEnabled: true
      }
    ],
    ncm: {
      request: requestNcmApi,
      officialLogin: openNcmOfficialLogin,
      getCachedSong: async (songId) => getCachedNcmSong(Number(songId)),
      cacheSong: async (songId, url, fileName) => cacheNcmSong(Number(songId), url, fileName)
    },
    getPlaybackInfo: async () => audioEngineManager?.getPlaybackInfo() ?? null,
    applyNativeDspPluginChain: async (chainJson) => {
      await audioEngineManager?.setNativeDspPluginChain(chainJson)
    },
    player: {
      play: async () => {
        await audioEngineManager?.togglePause()
      },
      pause: async () => {
        await audioEngineManager?.pause()
      },
      togglePause: async () => {
        await audioEngineManager?.togglePause()
      },
      stop: async () => {
        await audioEngineManager?.stop()
      },
      next: async () => {
        await audioEngineManager?.next()
      },
      previous: async () => {
        await audioEngineManager?.previous()
      }
    }
  })
  pluginIndexService = new PluginIndexService({
    appVersion: app.getVersion(),
    localIndexPath: bundledPluginIndexPath(),
    remoteIndexUrl: process.env.TWILIGHT_PLUGIN_INDEX_URL,
    bundledPluginIds
  })

  void pluginManager
    .initialize()
    .then(() => {
      void pluginManager?.broadcastEvent('app:ready', {
        version: app.getVersion(),
        platform: process.platform
      })
    })
    .catch((error) => {
      console.error('[插件系统] 初始化失败：', error)
    })

  pluginManager.on('changed', () => {
    mainWindow?.webContents.send('plugins:changed')
  })

  ipcMain.handle('plugins:list', async () => {
    return await pluginManager!.list()
  })
  ipcMain.handle('plugins:installFromPath', async (_event, sourcePath: string) => {
    return await pluginManager!.installFromPath(sourcePath)
  })
  ipcMain.handle('plugins:chooseAndInstall', async () => {
    return await pluginManager!.chooseAndInstall()
  })
  ipcMain.handle('plugins:enable', async (_event, id: string) => {
    return await pluginManager!.enable(id)
  })
  ipcMain.handle('plugins:disable', async (_event, id: string) => {
    return await pluginManager!.disable(id)
  })
  ipcMain.handle('plugins:uninstall', async (_event, id: string, options?: TwilightPluginUninstallOptions) => {
    await pluginManager!.uninstall(id, options)
    return true
  })
  ipcMain.handle('plugins:openLog', async (_event, id: string) => {
    await pluginManager!.openLog(id)
  })
  ipcMain.handle('plugins:getLog', async (_event, id: string) => {
    return await pluginManager!.getLog(id)
  })
  ipcMain.handle('plugins:listIndex', async () => {
    const [entries, installed] = await Promise.all([
      pluginIndexService!.list(),
      pluginManager!.list()
    ])
    return entries.map((entry) => ({
      ...entry,
      installState: pluginIndexService!.describeInstallState(entry, installed),
      installedVersion: installed.find((plugin) => plugin.id === entry.id)?.version
    }))
  })
  ipcMain.handle('plugins:refreshIndex', async () => {
    const [entries, installed] = await Promise.all([
      pluginIndexService!.refresh(),
      pluginManager!.list()
    ])
    return entries.map((entry) => ({
      ...entry,
      installState: pluginIndexService!.describeInstallState(entry, installed),
      installedVersion: installed.find((plugin) => plugin.id === entry.id)?.version
    }))
  })
  ipcMain.handle('plugins:installFromIndex', async (_event, id: string) => {
    const downloaded = await pluginIndexService!.downloadPackage(id)
    try {
      return await pluginManager!.installFromPath(downloaded.packagePath, {
        source: 'index',
        sourceLabel: downloaded.entry.sourceUrl
      })
    } finally {
      await downloaded.cleanup()
    }
  })
  ipcMain.handle('plugins:setNativeDspParameters', async (_event, id: string, parameters: Record<string, number>) => {
    return await pluginManager!.setNativeDspPluginParameters(id, parameters)
  })
  ipcMain.handle('providers:list', async () => {
    return pluginManager!.listProviders()
  })
  ipcMain.handle(
    'providers:call',
    async (_event, providerId: string, method: Parameters<TwilightPluginManager['callProvider']>[1], args: unknown[]) => {
      return await pluginManager!.callProvider(providerId, method, Array.isArray(args) ? args : [])
    }
  )
  ipcMain.handle('extensions:list', async () => {
    return pluginManager!.listExtensions()
  })
  ipcMain.handle('extensions:executeCommand', async (_event, command: string, args?: unknown[]) => {
    return await pluginManager!.executeUiCommand(command, Array.isArray(args) ? args : [])
  })
  ipcMain.handle('extensions:readThemeStylesheet', async (_event, stylesheetPath: string) => {
    const normalized = resolve(stylesheetPath)
    const allowed = pluginManager!.listExtensions().some((entry) =>
      entry.themes.some((theme) => theme.stylesheet && resolve(theme.stylesheet) === normalized)
    )
    if (!allowed) throw new Error('主题 stylesheet 未注册')
    return readFileSync(normalized, 'utf-8')
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

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'twilight-audio',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ])

  app.on('second-instance', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.TwilightEcho.music')

    // Register cover:// protocol — Chromium reads JPEGs directly from disk,
    // no IPC, no base64, browser manages decode cache natively.
    protocol.handle('cover', (request) => {
      const url = new URL(request.url)
      const fileName = url.hostname + url.pathname
      // Sanitize: only allow alphanumeric/hash filenames
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '')
      if (!safeName.endsWith('.jpg')) {
        return new Response('Forbidden', { status: 403 })
      }
      const filePath = join(getCoverCacheDir(), safeName)
      if (!existsSync(filePath)) {
        return new Response('Not Found', { status: 404 })
      }
      const data = readFileSync(filePath)
      return new Response(data, {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' }
      })
    })

    protocol.handle('twilight-audio', async (request) => {
      try {
        const url = new URL(request.url)
        const encodedPath = url.pathname.replace(/^\/+/, '')
        if (!encodedPath) return new Response('Bad Request', { status: 400 })
        const filePath = await resolvePlayableAudioFile(decodeAudioFileUrlPath(encodedPath))
        return net.fetch(pathToFileURL(filePath).toString(), {
          headers: request.headers,
          bypassCustomProtocolHandlers: true
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : '无法读取音频文件'
        return new Response(message, { status: 404 })
      }
    })

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

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle('discord:updateActivity', (_event, data: DiscordActivityData) => {
    if (appSettings.discordRpcEnabled) updateDiscordActivity(data)
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
        'https://api.github.com/repos/nousresearch/twilight-echo/releases/latest',
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
    await writeFile(MUSIC_LIBRARY_FILE, JSON.stringify(library), 'utf-8')
  })

  ipcMain.handle('data:loadMusicLibrary', async () => {
    if (!existsSync(MUSIC_LIBRARY_FILE)) return []
    try {
      const raw = await readFile(MUSIC_LIBRARY_FILE, 'utf-8')
      const data = JSON.parse(raw)
      // Strip lyrics from saved library — lyrics are lazy-loaded on playback
      const tracks = Array.isArray(data) ? data : data.tracks
      if (Array.isArray(tracks)) {
        let changed = false
        for (const track of tracks) {
          if (track.lyrics) {
            track.lyrics = null
            changed = true
          }
          // Migrate old base64 covers to disk cache
          if (track.cover && typeof track.cover === 'string' && track.cover.startsWith('data:')) {
            const handle = migrateBase64Cover(track.cover)
            if (handle) {
              track.cover = handle
              changed = true
            }
          }
        }
        if (changed) {
          await writeFile(MUSIC_LIBRARY_FILE, JSON.stringify(data), 'utf-8')
        }
      }
      return data
    } catch {
      return []
    }
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

  // === Desktop Lyrics Window ===
  function createDesktopLyricsWindow(): void {
    if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) return

    const dl = appSettings.desktopLyrics
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
    const x = dl.windowX >= 0 ? dl.windowX : Math.round((screenWidth - dl.windowWidth) / 2)
    const y = dl.windowY >= 0 ? dl.windowY : screenHeight - dl.windowHeight - 60

    desktopLyricsWindow = new BrowserWindow({
      width: dl.windowWidth,
      height: dl.windowHeight,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: dl.alwaysOnTop,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })

    desktopLyricsWindow.setAlwaysOnTop(dl.alwaysOnTop, 'screen-saver')
    if (dl.clickThrough) {
      desktopLyricsWindow.setIgnoreMouseEvents(true, { forward: true })
    }

    desktopLyricsWindow.on('ready-to-show', () => {
      desktopLyricsWindow?.show()
      // Send initial settings
      desktopLyricsWindow?.webContents.send('desktopLyrics:initSettings', appSettings.desktopLyrics)
    })

    desktopLyricsWindow.on('closed', () => {
      desktopLyricsWindow = null
    })

    // Save position on move
    let moveSaveTimer: NodeJS.Timeout | null = null
    desktopLyricsWindow.on('move', () => {
      if (moveSaveTimer) clearTimeout(moveSaveTimer)
      moveSaveTimer = setTimeout(() => {
        if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return
        const [px, py] = desktopLyricsWindow.getPosition()
        appSettings.desktopLyrics.windowX = px
        appSettings.desktopLyrics.windowY = py
        writeAppSettings(appSettings)
      }, 500)
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      // In dev mode, we can't load a separate HTML file from the dev server easily
      // So load the file directly
      desktopLyricsWindow.loadFile(join(__dirname, '../../resources/desktop-lyrics.html'))
    } else {
      desktopLyricsWindow.loadFile(join(__dirname, '../../resources/desktop-lyrics.html'))
    }
  }

  function showDesktopLyrics(): void {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) {
      createDesktopLyricsWindow()
    } else {
      desktopLyricsWindow.show()
    }
  }

  function hideDesktopLyrics(): void {
    if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsWindow.hide()
    }
  }

  function toggleDesktopLyrics(): boolean {
    const shouldShow = !appSettings.desktopLyrics.enabled
    appSettings.desktopLyrics.enabled = shouldShow
    writeAppSettings(appSettings)
    if (shouldShow) {
      showDesktopLyrics()
    } else {
      hideDesktopLyrics()
    }
    // Notify renderer
    mainWindow?.webContents.send('desktopLyrics:toggleChanged', shouldShow)
    return shouldShow
  }

  function applyDesktopLyricsSettings(settings: DesktopLyricsSettings): void {
    appSettings.desktopLyrics = { ...settings }
    writeAppSettings(appSettings)
    if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      // Update window properties
      desktopLyricsWindow.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver')
      desktopLyricsWindow.setIgnoreMouseEvents(settings.clickThrough, { forward: true })
      if (settings.windowWidth !== desktopLyricsWindow.getBounds().width ||
          settings.windowHeight !== desktopLyricsWindow.getBounds().height) {
        desktopLyricsWindow.setSize(settings.windowWidth, settings.windowHeight)
      }
      desktopLyricsWindow.webContents.send('desktopLyrics:initSettings', settings)
    }
  }

  // Forward track/time updates from renderer to lyrics window
  ipcMain.on('desktopLyrics:updateTrack', (_event, data: { lyrics: string | null; translatedLyrics?: string | null; title?: string; artist?: string }) => {
    if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsWindow.webContents.send('desktopLyrics:updateTrack', data)
    }
  })

  ipcMain.on('desktopLyrics:updateTime', (_event, time: number) => {
    if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsWindow.webContents.send('desktopLyrics:updateTime', time)
    }
  })

  ipcMain.on('desktopLyrics:updateSettings', (_event, settings: DesktopLyricsSettings) => {
    applyDesktopLyricsSettings(settings)
  })

  ipcMain.handle('desktopLyrics:toggle', async () => {
    return toggleDesktopLyrics()
  })

  ipcMain.handle('desktopLyrics:show', async () => {
    showDesktopLyrics()
  })

  ipcMain.handle('desktopLyrics:hide', async () => {
    hideDesktopLyrics()
  })

  // Lyrics window → main: get current position (for drag start)
  ipcMain.on('desktopLyrics:getPosition', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition()
      event.sender.send('desktopLyrics:position', { x, y })
    }
  })

  // Lyrics window → main: move window
  ipcMain.on('desktopLyrics:move', (event, data: { x: number; y: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.setPosition(data.x, data.y)
    }
  })

  // Lyrics window → main: request close (close button in toolbar)
  ipcMain.on('desktopLyrics:requestClose', () => {
    appSettings.desktopLyrics.enabled = false
    writeAppSettings(appSettings)
    hideDesktopLyrics()
    mainWindow?.webContents.send('desktopLyrics:toggleChanged', false)
  })

  createWindow()
  applyRuntimeSettings()

  setupAudioEngineIpc()
  setupOpraIpc()
  setupPluginIpc()
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
  void pluginManager?.broadcastEvent('app:before-quit', null)
})

app.on('will-quit', () => {
  unregisterPlayerShortcuts()
  destroyTray()
  void pluginManager?.destroy()
  audioEngineManager?.destroy()
  audioEngineManager = null
  pluginManager = null
  if (ncmServer) {
    ncmServer.close()
    ncmServer = null
  }
})
}
