/**
 * Playback bookmarks / resume points keyed by logical track identity.
 * Stored outside the library index so rescans never wipe user markers.
 */

export const PLAYBACK_BOOKMARKS_SCHEMA_VERSION = 1 as const
export const MAX_BOOKMARKS = 5_000
export const MAX_BOOKMARKS_PER_TRACK = 64
export const MAX_BOOKMARK_LABEL_LENGTH = 120
export const DEFAULT_LONG_TRACK_RESUME_SECONDS = 20 * 60

export interface PlaybackBookmark {
  id: string
  trackKey: string
  trackId?: string
  title?: string
  artist?: string
  positionSeconds: number
  label: string
  createdAt: string
  updatedAt: string
  /** Auto-recorded pause/switch resume points for long tracks. */
  kind: 'manual' | 'resume'
}

export interface PlaybackBookmarksDocument {
  schemaVersion: typeof PLAYBACK_BOOKMARKS_SCHEMA_VERSION
  longTrackResumeSeconds: number
  bookmarks: PlaybackBookmark[]
}

export const DEFAULT_PLAYBACK_BOOKMARKS: PlaybackBookmarksDocument = {
  schemaVersion: PLAYBACK_BOOKMARKS_SCHEMA_VERSION,
  longTrackResumeSeconds: DEFAULT_LONG_TRACK_RESUME_SECONDS,
  bookmarks: []
}

export function clampBookmarkPosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 1000) / 1000
}

export function isPlaybackBookmark(value: unknown): value is PlaybackBookmark {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.trackKey === 'string' &&
    typeof record.positionSeconds === 'number' &&
    typeof record.label === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    (record.kind === 'manual' || record.kind === 'resume')
  )
}

export function isPlaybackBookmarksDocument(value: unknown): value is PlaybackBookmarksDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== PLAYBACK_BOOKMARKS_SCHEMA_VERSION) return false
  if (typeof record.longTrackResumeSeconds !== 'number') return false
  if (!Array.isArray(record.bookmarks)) return false
  if (record.bookmarks.length > MAX_BOOKMARKS) return false
  return record.bookmarks.every(isPlaybackBookmark)
}

export function clonePlaybackBookmarksDocument(
  document: PlaybackBookmarksDocument
): PlaybackBookmarksDocument {
  return {
    schemaVersion: PLAYBACK_BOOKMARKS_SCHEMA_VERSION,
    longTrackResumeSeconds: document.longTrackResumeSeconds,
    bookmarks: document.bookmarks.map((bookmark) => ({ ...bookmark }))
  }
}

export function bookmarksForTrack(
  document: PlaybackBookmarksDocument,
  trackKey: string
): PlaybackBookmark[] {
  return document.bookmarks
    .filter((bookmark) => bookmark.trackKey === trackKey)
    .sort((a, b) => a.positionSeconds - b.positionSeconds || a.createdAt.localeCompare(b.createdAt))
}
