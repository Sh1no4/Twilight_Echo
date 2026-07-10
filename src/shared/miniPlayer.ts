export const DEFAULT_MINI_PLAYER_STYLE_ID = 'aurora-glass'

export interface MiniPlayerWindowSize {
  width: number
  height: number
}

export interface MiniPlayerSettings {
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
  alwaysOnTop: boolean
  positionLocked: boolean
  styleId: string
  backgroundColor: string
}

export interface MiniPlayerTrackSnapshot {
  id: string
  title: string
  artist: string
  album: string
  cover: string | null
}

export interface MiniPlayerStateSnapshot {
  track: MiniPlayerTrackSnapshot | null
  isPlaying: boolean
  isLoading: boolean
  currentTime: number
  duration: number
  volume: number
  playMode: 'sequential' | 'repeat' | 'shuffle'
  dominantColor: string
  queueIndex: number
  queueLength: number
}

export type MiniPlayerCommand =
  | { type: 'toggle-play' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'cycle-play-mode' }
  | { type: 'seek'; value: number }
  | { type: 'set-volume'; value: number }

export type MiniPlayerSettingsPatch = Partial<
  Pick<
    MiniPlayerSettings,
    | 'alwaysOnTop'
    | 'positionLocked'
    | 'styleId'
    | 'backgroundColor'
    | 'windowWidth'
    | 'windowHeight'
  >
>

export interface MiniPlayerBootstrap {
  state: MiniPlayerStateSnapshot
  settings: MiniPlayerSettings
}

export const DEFAULT_MINI_PLAYER_SETTINGS: Readonly<MiniPlayerSettings> = Object.freeze({
  windowX: -1,
  windowY: -1,
  windowWidth: 500,
  windowHeight: 190,
  alwaysOnTop: false,
  positionLocked: false,
  styleId: DEFAULT_MINI_PLAYER_STYLE_ID,
  backgroundColor: '#11121d'
})

const BUILT_IN_MINI_PLAYER_BACKGROUND_COLORS: Readonly<Record<string, string>> = Object.freeze({
  [DEFAULT_MINI_PLAYER_STYLE_ID]: '#11121d',
  porcelain: '#f4f5fb'
})

export const EMPTY_MINI_PLAYER_STATE: Readonly<MiniPlayerStateSnapshot> = Object.freeze({
  track: null,
  isPlaying: false,
  isLoading: false,
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  playMode: 'sequential',
  dominantColor: '#7c4dff',
  queueIndex: -1,
  queueLength: 0
})

const MAX_TRACK_TEXT_LENGTH = 512
const MAX_COVER_URL_LENGTH = 16_384
const MAX_STYLE_ID_LENGTH = 64
const MAX_PLAYBACK_SECONDS = 60 * 60 * 24 * 7
const MAX_QUEUE_LENGTH = 100_000

export function normalizeMiniPlayerSettings(raw: unknown): MiniPlayerSettings {
  const value = asRecord(raw)
  const styleId = normalizeStyleId(value.styleId)
  const builtInBackgroundColor = BUILT_IN_MINI_PLAYER_BACKGROUND_COLORS[styleId]

  return {
    windowX: normalizeCoordinate(value.windowX, DEFAULT_MINI_PLAYER_SETTINGS.windowX),
    windowY: normalizeCoordinate(value.windowY, DEFAULT_MINI_PLAYER_SETTINGS.windowY),
    windowWidth: clampFiniteNumber(
      value.windowWidth,
      360,
      760,
      DEFAULT_MINI_PLAYER_SETTINGS.windowWidth,
      true
    ),
    windowHeight: clampFiniteNumber(
      value.windowHeight,
      140,
      420,
      DEFAULT_MINI_PLAYER_SETTINGS.windowHeight,
      true
    ),
    alwaysOnTop: value.alwaysOnTop === true,
    positionLocked: value.positionLocked === true,
    styleId,
    backgroundColor:
      builtInBackgroundColor ??
      normalizeHexColor(value.backgroundColor, DEFAULT_MINI_PLAYER_SETTINGS.backgroundColor)
  }
}

export function normalizeMiniPlayerStateSnapshot(raw: unknown): MiniPlayerStateSnapshot {
  const value = asRecord(raw)
  const duration = clampFiniteNumber(value.duration, 0, MAX_PLAYBACK_SECONDS, 0)
  const currentTime = clampFiniteNumber(
    value.currentTime,
    0,
    duration > 0 ? duration : MAX_PLAYBACK_SECONDS,
    0
  )
  const queueLength = clampFiniteNumber(value.queueLength, 0, MAX_QUEUE_LENGTH, 0, true)

  return {
    track: normalizeTrack(value.track),
    isPlaying: value.isPlaying === true,
    isLoading: value.isLoading === true,
    currentTime,
    duration,
    volume: clampFiniteNumber(value.volume, 0, 1, EMPTY_MINI_PLAYER_STATE.volume),
    playMode:
      value.playMode === 'repeat' || value.playMode === 'shuffle' ? value.playMode : 'sequential',
    dominantColor: normalizeDominantColor(value.dominantColor),
    queueIndex: clampFiniteNumber(value.queueIndex, -1, Math.max(-1, queueLength - 1), -1, true),
    queueLength
  }
}

export function normalizeMiniPlayerCommand(raw: unknown): MiniPlayerCommand | null {
  const value = asRecord(raw)
  switch (value.type) {
    case 'toggle-play':
    case 'previous':
    case 'next':
    case 'cycle-play-mode':
      return { type: value.type }
    case 'seek':
      if (typeof value.value !== 'number' || !Number.isFinite(value.value)) return null
      return {
        type: 'seek',
        value: Math.min(MAX_PLAYBACK_SECONDS, Math.max(0, value.value))
      }
    case 'set-volume':
      if (typeof value.value !== 'number' || !Number.isFinite(value.value)) return null
      return { type: 'set-volume', value: Math.min(1, Math.max(0, value.value)) }
    default:
      return null
  }
}

function normalizeTrack(raw: unknown): MiniPlayerTrackSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const id = normalizeText(value.id, MAX_TRACK_TEXT_LENGTH)
  const title = normalizeText(value.title, MAX_TRACK_TEXT_LENGTH)
  if (!id && !title) return null

  const cover = normalizeText(value.cover, MAX_COVER_URL_LENGTH)
  return {
    id: id || title,
    title: title || '未知曲目',
    artist: normalizeText(value.artist, MAX_TRACK_TEXT_LENGTH) || '未知艺术家',
    album: normalizeText(value.album, MAX_TRACK_TEXT_LENGTH),
    cover: cover || null
  }
}

function normalizeStyleId(value: unknown): string {
  const styleId = normalizeText(value, MAX_STYLE_ID_LENGTH)
  return /^[a-z0-9][a-z0-9._-]*$/i.test(styleId) ? styleId : DEFAULT_MINI_PLAYER_STYLE_ID
}

function normalizeDominantColor(value: unknown): string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value.trim())
    ? value.trim()
    : EMPTY_MINI_PLAYER_STATE.dominantColor
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value.trim()) ? value.trim() : fallback
}

function normalizeCoordinate(value: unknown, fallback: number): number {
  return clampFiniteNumber(value, -100_000, 100_000, fallback, true)
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function clampFiniteNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  integer = false
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const normalized = integer ? Math.round(value) : value
  return Math.min(max, Math.max(min, normalized))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
