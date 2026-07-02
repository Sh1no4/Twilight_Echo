import type { Track, TrackSource } from '../types/music'
import { getLogicalTrackKey } from './logicalTrackIdentity.ts'

export interface SourceVariantInput {
  track: Track
  source?: TrackSource
  sourceName?: string
  providerAvailable?: boolean
  providerReliability?: number
  lossless?: boolean
}

export interface SourceVariant {
  track: Track
  source: TrackSource
  sourceName: string
  local: boolean
  lossless: boolean
  providerAvailable: boolean
  providerReliability: number
}

export interface LogicalTrack {
  id: string
  title: string
  artist: string
  album: string
  preferredTrack: Track
  variants: SourceVariant[]
}

const LOSSLESS_FORMATS = new Set(['flac', 'alac', 'wav', 'wave', 'aiff', 'aif', 'ape', 'wv', 'dsf', 'dff', 'mqa'])
const LOGICAL_DURATION_TOLERANCE_SECONDS = 8

export function buildLogicalTracks(inputs: SourceVariantInput[]): LogicalTrack[] {
  const groups: LogicalTrack[] = []

  for (const input of inputs) {
    const variant = toSourceVariant(input)
    const candidateKey = getLogicalTrackKey(variant.track)
    const existing = groups.find((item) => {
      if (item.id !== candidateKey) return false
      return canShareLogicalTrack(item.preferredTrack, variant.track)
    })

    if (existing) {
      existing.variants = [...existing.variants, variant].sort(compareSourceVariants)
      existing.preferredTrack = existing.variants[0].track
      continue
    }

    groups.push({
      id: candidateKey,
      title: variant.track.title.trim() || '未知歌曲',
      artist: variant.track.artist.trim() || '未知艺术家',
      album: variant.track.album.trim() || '未知专辑',
      preferredTrack: variant.track,
      variants: [variant]
    })
  }

  return groups
}

export function toSourceVariant(input: SourceVariantInput): SourceVariant {
  const source = getTrackSource(input.track, input.source)
  const local = source === 'local'
  const track = input.track.source === source ? input.track : { ...input.track, source }
  return {
    track,
    source,
    sourceName: input.sourceName ?? (local ? '本地音乐' : source),
    local,
    lossless: input.lossless ?? isLosslessTrack(input.track),
    providerAvailable: input.providerAvailable !== false,
    providerReliability: local ? 1 : clampReliability(input.providerReliability ?? 1)
  }
}

export function compareSourceVariants(left: SourceVariant, right: SourceVariant): number {
  return (
    compareSourceVariantPriority(left, right) ||
    left.track.title.localeCompare(right.track.title, 'zh') ||
    left.track.id.localeCompare(right.track.id)
  )
}

export function compareSourceVariantPriority(left: SourceVariant, right: SourceVariant): number {
  return (
    compareBoolean(right.local, left.local) ||
    compareBoolean(right.lossless, left.lossless) ||
    compareBoolean(right.providerAvailable, left.providerAvailable) ||
    right.providerReliability - left.providerReliability
  )
}

export function compareSourceVariantsByTitle(left: SourceVariant, right: SourceVariant): number {
  return (
    compareSourceVariantPriority(left, right) ||
    left.track.title.localeCompare(right.track.title, 'zh') ||
    left.track.id.localeCompare(right.track.id)
  )
}

export function canShareLogicalTrack(left: Track, right: Track): boolean {
  if (!left.duration || !right.duration) return true
  return Math.abs(left.duration - right.duration) <= LOGICAL_DURATION_TOLERANCE_SECONDS
}

export function getTrackSource(track: Pick<Track, 'id' | 'source'>, fallback?: string): TrackSource {
  if (track.source) return normalizeTrackSource(track.source)
  if (fallback) return normalizeTrackSource(fallback)
  const id = track.id.trim()
  if (/^[a-zA-Z]:[\\/]/.test(id) || /^[\\/]/.test(id)) return 'local'
  const separatorIndex = id.indexOf(':')
  return separatorIndex > 0 ? normalizeTrackSource(id.slice(0, separatorIndex)) : 'local'
}

export function isLosslessTrack(track: Track): boolean {
  const format = track.format?.trim().toLowerCase()
  if (format && LOSSLESS_FORMATS.has(format)) return true
  if (typeof track.bitDepth === 'number' && track.bitDepth >= 16) return true
  return false
}

export function clampReliability(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function compareBoolean(left: boolean, right: boolean): number {
  if (left === right) return 0
  return left ? 1 : -1
}

function normalizeTrackSource(source: string): TrackSource {
  return source.trim().toLowerCase() as TrackSource
}
