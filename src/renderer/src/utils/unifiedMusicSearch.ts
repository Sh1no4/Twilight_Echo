import type { MediaProviderCapability, MediaProviderSearchResult } from '../providers/mediaProvider'
import type { Track, TrackSource } from '../types/music'
import { getLogicalTrackKey } from './logicalTrackIdentity.ts'

export interface UnifiedSearchProvider {
  id: string
  name: string
  capabilities: string[] | MediaProviderCapability[]
  available?: boolean
  health?: UnifiedSearchProviderReliabilityInput
}

export interface UnifiedSearchProviderReliabilityInput {
  available?: boolean
  successRate?: number
  methodStats?: Record<string, { successRate?: number } | undefined>
}

export interface UnifiedSearchProviderHealth {
  providerId: string
  providerName: string
  available: boolean
  searchable: boolean
  resultCount: number
  lastError: string | null
}

export interface UnifiedSearchTrackItem {
  kind: 'track'
  track: Track
  source: TrackSource
  sourceName: string
  local: boolean
  lossless: boolean
  providerAvailable: boolean
  providerReliability: number
}

export interface LogicalMusicVariant {
  track: Track
  source: TrackSource
  local: boolean
  lossless: boolean
  providerAvailable: boolean
  providerReliability: number
}

export interface LogicalMusicItem {
  id: string
  title: string
  artist: string
  album: string
  preferredTrack: Track
  variants: LogicalMusicVariant[]
}

export interface UnifiedSearchOptions {
  query: string
  localTracks: Track[]
  providers: UnifiedSearchProvider[]
  limit?: number
  offset?: number
  searchProviderSongs: (
    providerId: string,
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<MediaProviderSearchResult<Track>>
}

export interface UnifiedSearchResult {
  items: UnifiedSearchTrackItem[]
  logicalItems: LogicalMusicItem[]
  health: Record<string, UnifiedSearchProviderHealth>
}

const LOSSLESS_FORMATS = new Set(['flac', 'alac', 'wav', 'wave', 'aiff', 'aif', 'ape', 'wv', 'dsf', 'dff', 'mqa'])
const LOGICAL_DURATION_TOLERANCE_SECONDS = 8

export async function unifiedSearchSongs(options: UnifiedSearchOptions): Promise<UnifiedSearchResult> {
  const query = options.query.trim()
  const limit = options.limit ?? 30
  const offset = options.offset ?? 0
  const localItems = searchLocalTracks(options.localTracks, query).map((track) =>
    toSearchItem(track, {
      sourceName: '本地音乐',
      providerAvailable: true
    })
  )
  const health: Record<string, UnifiedSearchProviderHealth> = {}

  const providerItems = (
    await Promise.all(
      options.providers.map(async (provider) => {
        const providerAvailable = provider.available !== false && provider.health?.available !== false
        const providerReliability = getProviderReliability(provider)
        const searchable = provider.capabilities.includes('search')
        const baseHealth: UnifiedSearchProviderHealth = {
          providerId: provider.id,
          providerName: provider.name,
          available: providerAvailable,
          searchable,
          resultCount: 0,
          lastError: null
        }
        health[provider.id] = baseHealth
        if (!query || !searchable || !providerAvailable) return []

        try {
          const result = await options.searchProviderSongs(provider.id, query, limit, offset)
          baseHealth.resultCount = result.items.length
          return result.items.map((track) =>
            toSearchItem(track, {
              sourceName: provider.name,
              providerAvailable: true,
              providerReliability,
              source: provider.id
            })
          )
        } catch (error) {
          baseHealth.available = false
          baseHealth.lastError = error instanceof Error ? error.message : String(error)
          return []
        }
      })
    )
  ).flat()

  const items = [...localItems, ...providerItems].sort(compareSearchItems)
  return {
    items,
    logicalItems: buildLogicalMusicItemsFromSearchItems(items),
    health
  }
}

export function buildLogicalMusicItems(tracks: Track[]): LogicalMusicItem[] {
  return buildLogicalMusicItemsFromSearchItems(
    tracks.map((track) =>
      toSearchItem(track, {
        sourceName: getTrackSource(track) === 'local' ? '本地音乐' : getTrackSource(track),
        providerAvailable: true
      })
    )
  )
}

function buildLogicalMusicItemsFromSearchItems(searchItems: UnifiedSearchTrackItem[]): LogicalMusicItem[] {
  const groups: LogicalMusicItem[] = []

  for (const searchItem of searchItems) {
    const track = searchItem.track
    const candidateKey = getLogicalTrackKey(track)
    const existing = groups.find((item) => {
      if (item.id !== candidateKey) return false
      return canShareLogicalItem(item.preferredTrack, track)
    })
    const variant = toLogicalVariant(searchItem)
    if (existing) {
      existing.variants = [...existing.variants, variant].sort(compareLogicalVariants)
      existing.preferredTrack = existing.variants[0].track
      continue
    }

    groups.push({
      id: candidateKey,
      title: track.title.trim() || '未知歌曲',
      artist: track.artist.trim() || '未知艺术家',
      album: track.album.trim() || '未知专辑',
      preferredTrack: track,
      variants: [variant]
    })
  }

  return groups
}

function searchLocalTracks(tracks: Track[], query: string): Track[] {
  if (!query) return []
  const normalizedQuery = normalizeSearchText(query)
  return tracks.filter((track) =>
    [track.title, track.artist, track.album, track.fileName]
      .map(normalizeSearchText)
      .some((value) => value.includes(normalizedQuery))
  )
}

function toSearchItem(
  track: Track,
  options: {
    sourceName: string
    providerAvailable: boolean
    providerReliability?: number
    source?: string
  }
): UnifiedSearchTrackItem {
  const source = getTrackSource(track, options.source)
  const local = source === 'local'
  return {
    kind: 'track',
    track: { ...track, source },
    source,
    sourceName: options.sourceName,
    local,
    lossless: isLosslessTrack(track),
    providerAvailable: options.providerAvailable,
    providerReliability: local ? 1 : clampReliability(options.providerReliability ?? 1)
  }
}

function toLogicalVariant(item: UnifiedSearchTrackItem): LogicalMusicVariant {
  return {
    track: item.track,
    source: item.source,
    local: item.local,
    lossless: item.lossless,
    providerAvailable: item.providerAvailable,
    providerReliability: item.providerReliability
  }
}

function compareSearchItems(left: UnifiedSearchTrackItem, right: UnifiedSearchTrackItem): number {
  return (
    compareBoolean(right.local, left.local) ||
    compareBoolean(right.lossless, left.lossless) ||
    compareBoolean(right.providerAvailable, left.providerAvailable) ||
    right.providerReliability - left.providerReliability ||
    left.track.title.localeCompare(right.track.title, 'zh') ||
    left.track.artist.localeCompare(right.track.artist, 'zh') ||
    left.track.id.localeCompare(right.track.id)
  )
}

function compareLogicalVariants(left: LogicalMusicVariant, right: LogicalMusicVariant): number {
  return (
    compareBoolean(right.local, left.local) ||
    compareBoolean(right.lossless, left.lossless) ||
    compareBoolean(right.providerAvailable, left.providerAvailable) ||
    right.providerReliability - left.providerReliability ||
    left.track.title.localeCompare(right.track.title, 'zh') ||
    left.track.id.localeCompare(right.track.id)
  )
}

function compareBoolean(left: boolean, right: boolean): number {
  if (left === right) return 0
  return left ? 1 : -1
}

function getProviderReliability(provider: UnifiedSearchProvider): number {
  const playbackUrlSuccessRate = provider.health?.methodStats?.getPlaybackUrl?.successRate
  if (typeof playbackUrlSuccessRate === 'number') return clampReliability(playbackUrlSuccessRate)
  if (typeof provider.health?.successRate === 'number') return clampReliability(provider.health.successRate)
  return provider.available === false || provider.health?.available === false ? 0 : 1
}

function clampReliability(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function canShareLogicalItem(left: Track, right: Track): boolean {
  if (!left.duration || !right.duration) return true
  return Math.abs(left.duration - right.duration) <= LOGICAL_DURATION_TOLERANCE_SECONDS
}

function normalizeSearchText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function getTrackSource(track: Pick<Track, 'id' | 'source'>, fallback?: string): TrackSource {
  if (track.source) return track.source
  if (fallback) return fallback
  if (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)) return 'local'
  const separatorIndex = track.id.indexOf(':')
  return separatorIndex > 0 ? track.id.slice(0, separatorIndex) : 'local'
}

function isLosslessTrack(track: Track): boolean {
  const format = track.format?.trim().toLowerCase()
  if (format && LOSSLESS_FORMATS.has(format)) return true
  if (typeof track.bitDepth === 'number' && track.bitDepth >= 16) return true
  return false
}
