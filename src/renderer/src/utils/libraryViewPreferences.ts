import type { Track } from '../types/music'
import { getTrackSource, isLosslessTrack } from './logicalTrackModel.ts'

export type LibrarySortKey =
  | 'title'
  | 'artist'
  | 'album'
  | 'playlist'
  | 'trackNumber'
  | 'duration'
  | 'format'
  | 'sampleRate'
  | 'addedAt'
  | 'lastPlayed'

export type LibrarySortDirection = 'asc' | 'desc'

export interface LibraryViewFilters {
  lossless: boolean
  dsd: boolean
  sampleRate: number | null
  bitDepth: number | null
  folder: string | null
  provider: string | null
}

export interface LibraryViewState {
  sortKey: LibrarySortKey
  sortDirection: LibrarySortDirection
  filters: LibraryViewFilters
}

export interface LibraryViewStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'twilight-echo:library-view-preferences:v2'
const DSD_FORMATS = new Set(['dsf', 'dff', 'dsd', 'sacd iso'])
const SORT_KEYS = new Set<LibrarySortKey>([
  'title',
  'artist',
  'album',
  'playlist',
  'trackNumber',
  'duration',
  'format',
  'sampleRate',
  'addedAt',
  'lastPlayed'
])

export function createDefaultLibraryViewState(category = 'allSongs'): LibraryViewState {
  const sortKey: LibrarySortKey =
    category === 'recent'
      ? 'lastPlayed'
      : category === 'albums'
        ? 'trackNumber'
        : category === 'playlists'
          ? 'playlist'
          : 'title'
  return {
    sortKey,
    sortDirection: category === 'recent' ? 'desc' : 'asc',
    filters: {
      lossless: false,
      dsd: false,
      sampleRate: null,
      bitDepth: null,
      folder: null,
      provider: null
    }
  }
}

export function libraryViewKey(category: string, filter: string | null): string {
  return `${category}:${filter ?? ''}`
}

export function trackFolder(track: Track): string {
  if (track.dir) return track.dir
  const normalized = track.filePath.replace(/[\\/]+$/, '')
  const separator = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return separator >= 0 ? normalized.slice(0, separator) : ''
}

export function isDsdTrack(track: Track): boolean {
  return DSD_FORMATS.has(track.format?.trim().toLowerCase() ?? '')
}

export function applyLibraryView(
  tracks: readonly Track[],
  state: LibraryViewState,
  lastPlayedByTrackId: ReadonlyMap<string, number> = new Map()
): Track[] {
  const filtered = tracks.filter((track) => {
    const filters = state.filters
    if (filters.lossless && !isLosslessTrack(track)) return false
    if (filters.dsd && !isDsdTrack(track)) return false
    if (filters.sampleRate !== null && track.sampleRate !== filters.sampleRate) return false
    if (filters.bitDepth !== null && track.bitDepth !== filters.bitDepth) return false
    if (filters.folder !== null && trackFolder(track) !== filters.folder) return false
    if (filters.provider !== null && getTrackSource(track) !== filters.provider) return false
    return true
  })

  return filtered
    .map((track, index) => ({ track, index }))
    .sort((left, right) => {
      const comparison = compareTracks(left.track, right.track, state.sortKey, lastPlayedByTrackId)
      if (comparison !== 0) return state.sortDirection === 'asc' ? comparison : -comparison
      return left.index - right.index || left.track.id.localeCompare(right.track.id)
    })
    .map(({ track }) => track)
}

export class LibraryViewPreferences {
  private readonly storage: LibraryViewStorage

  constructor(storage: LibraryViewStorage = browserStorage()) {
    this.storage = storage
  }

  read(viewKey: string, category = 'allSongs'): LibraryViewState {
    const fallback = createDefaultLibraryViewState(category)
    try {
      const value = this.storage.getItem(STORAGE_KEY)
      if (!value) return fallback
      const parsed = JSON.parse(value) as Record<string, unknown>
      return normalizeViewState(parsed[viewKey], fallback)
    } catch {
      return fallback
    }
  }

  write(viewKey: string, state: LibraryViewState): void {
    try {
      const current = this.readAll()
      current[viewKey] = state
      this.storage.setItem(STORAGE_KEY, JSON.stringify(current))
    } catch {
      // View preferences are optional. A blocked or full localStorage must not block library use.
    }
  }

  private readAll(): Record<string, LibraryViewState> {
    const value = this.storage.getItem(STORAGE_KEY)
    if (!value) return {}
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, LibraryViewState>)
      : {}
  }
}

function compareTracks(
  left: Track,
  right: Track,
  key: LibrarySortKey,
  lastPlayedByTrackId: ReadonlyMap<string, number>
): number {
  switch (key) {
    case 'duration':
      return numericValue(left.duration) - numericValue(right.duration)
    case 'sampleRate':
      return numericValue(left.sampleRate) - numericValue(right.sampleRate)
    case 'addedAt':
      return numericValue(left.addedAt) - numericValue(right.addedAt)
    case 'lastPlayed':
      return numericValue(lastPlayedByTrackId.get(left.id)) - numericValue(lastPlayedByTrackId.get(right.id))
    case 'format':
      return textValue(left.format).localeCompare(textValue(right.format), 'zh')
    case 'artist':
      return textValue(left.artist).localeCompare(textValue(right.artist), 'zh')
    case 'album':
      return textValue(left.album).localeCompare(textValue(right.album), 'zh')
    case 'playlist':
      // Playlists keep their own stored order (insertion order); the stable
      // sort below falls back to the input index, so nothing reorders them.
      return 0
    case 'trackNumber':
      return compareAlbumOrder(left, right)
    case 'title':
      return textValue(left.title).localeCompare(textValue(right.title), 'zh')
  }
}

/** Disc then track; missing tags sort last; fileName natural order as last resort. */
function compareAlbumOrder(left: Track, right: Track): number {
  const disc = sortIndex(left.discNumber) - sortIndex(right.discNumber)
  if (disc !== 0) return disc
  const track = sortIndex(left.trackNumber) - sortIndex(right.trackNumber)
  if (track !== 0) return track
  const byFile = naturalTextCompare(textValue(left.fileName), textValue(right.fileName))
  if (byFile !== 0) return byFile
  return textValue(left.title).localeCompare(textValue(right.title), 'zh')
}

function sortIndex(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER
}

function naturalTextCompare(left: string, right: string): number {
  return left.localeCompare(right, 'zh', { numeric: true, sensitivity: 'base' })
}

function normalizeViewState(value: unknown, fallback: LibraryViewState): LibraryViewState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const candidate = value as Partial<LibraryViewState>
  const filters: Partial<LibraryViewFilters> =
    candidate.filters && typeof candidate.filters === 'object'
      ? (candidate.filters as Partial<LibraryViewFilters>)
      : {}
  return {
    sortKey: typeof candidate.sortKey === 'string' && SORT_KEYS.has(candidate.sortKey as LibrarySortKey)
      ? (candidate.sortKey as LibrarySortKey)
      : fallback.sortKey,
    sortDirection: candidate.sortDirection === 'desc' ? 'desc' : 'asc',
    filters: {
      lossless: filters.lossless === true,
      dsd: filters.dsd === true,
      sampleRate: finitePositiveNumber(filters.sampleRate),
      bitDepth: finitePositiveNumber(filters.bitDepth),
      folder: nonEmptyString(filters.folder),
      provider: nonEmptyString(filters.provider)
    }
  }
}

function browserStorage(): LibraryViewStorage {
  return {
    getItem: (key) => globalThis.localStorage?.getItem(key) ?? null,
    setItem: (key, value) => {
      if (!globalThis.localStorage) throw new Error('localStorage is unavailable')
      globalThis.localStorage.setItem(key, value)
    }
  }
}

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function numericValue(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function textValue(value: string | undefined): string {
  return value?.trim() ?? ''
}
