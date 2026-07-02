import type { Track, TrackSource } from '../types/music'

export interface PlaybackFallbackOptions {
  failedTrack: Track
  candidates: Track[]
  unavailableSources?: string[]
  sourceReliability?: Record<string, number | undefined>
}

const LOSSLESS_FORMATS = new Set(['flac', 'alac', 'wav', 'wave', 'aiff', 'aif', 'ape', 'wv', 'dsf', 'dff', 'mqa'])
const FALLBACK_DURATION_TOLERANCE_SECONDS = 8

export function findPlaybackFallbackTrack(options: PlaybackFallbackOptions): Track | null {
  const unavailableSources = new Set((options.unavailableSources ?? []).map(normalizeSource))
  const failedSource = getTrackSource(options.failedTrack)
  const failedKey = metadataKey(options.failedTrack)

  const candidates = options.candidates
    .filter((candidate) => candidate.id !== options.failedTrack.id)
    .filter((candidate) => metadataKey(candidate) === failedKey)
    .filter((candidate) => canSharePlaybackFallback(options.failedTrack, candidate))
    .filter((candidate) => !unavailableSources.has(getTrackSource(candidate)))
    .filter((candidate) => getTrackSource(candidate) !== failedSource || failedSource === 'local')
    .sort((left, right) => compareFallbackCandidates(left, right, options.sourceReliability))

  return candidates[0] ?? null
}

function compareFallbackCandidates(
  left: Track,
  right: Track,
  sourceReliability: Record<string, number | undefined> = {}
): number {
  const leftSource = getTrackSource(left)
  const rightSource = getTrackSource(right)
  return (
    compareBoolean(rightSource === 'local', leftSource === 'local') ||
    compareBoolean(isLosslessTrack(right), isLosslessTrack(left)) ||
    getSourceReliability(rightSource, sourceReliability) - getSourceReliability(leftSource, sourceReliability) ||
    left.title.localeCompare(right.title, 'zh') ||
    left.id.localeCompare(right.id)
  )
}

function compareBoolean(left: boolean, right: boolean): number {
  if (left === right) return 0
  return left ? 1 : -1
}

function getSourceReliability(
  source: TrackSource,
  sourceReliability: Record<string, number | undefined>
): number {
  if (source === 'local') return 1
  const value = sourceReliability[normalizeSource(source)]
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

function canSharePlaybackFallback(left: Track, right: Track): boolean {
  if (!left.duration || !right.duration) return true
  return Math.abs(left.duration - right.duration) <= FALLBACK_DURATION_TOLERANCE_SECONDS
}

function metadataKey(track: Track): string {
  return [track.title, track.artist].map(normalizeText).join('::')
}

function normalizeText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeSource(source: string): TrackSource {
  return source.trim().toLowerCase() as TrackSource
}

function getTrackSource(track: Pick<Track, 'id' | 'source'>): TrackSource {
  if (track.source) return normalizeSource(track.source)
  if (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)) return 'local'
  const separatorIndex = track.id.indexOf(':')
  return separatorIndex > 0 ? normalizeSource(track.id.slice(0, separatorIndex)) : 'local'
}

function isLosslessTrack(track: Track): boolean {
  const format = track.format?.trim().toLowerCase()
  if (format && LOSSLESS_FORMATS.has(format)) return true
  if (typeof track.bitDepth === 'number' && track.bitDepth >= 16) return true
  return false
}
