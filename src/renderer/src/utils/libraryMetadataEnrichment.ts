import type { MediaProviderSearchResult } from '../providers/mediaProvider.ts'
import type { Track } from '../types/music'
import {
  enrichLocalTrackMetadata,
  findBestMetadataMatch,
  type MetadataEnrichmentPolicy
} from './musicMetadataMatching.ts'

export interface LibraryMetadataEnrichmentProvider {
  searchSongs: (
    query: string,
    limit?: number,
    offset?: number
  ) => Promise<MediaProviderSearchResult<Track>>
}

export interface LibraryMetadataEnrichmentOptions {
  cachePolicy?: Partial<MetadataEnrichmentPolicy>
}

export async function enrichLocalTracksFromProviders(
  tracks: Track[],
  provider: LibraryMetadataEnrichmentProvider | null | undefined,
  options: LibraryMetadataEnrichmentOptions = {}
): Promise<Track[]> {
  if (!provider) return tracks

  const policy = normalizeMetadataEnrichmentPolicy(options.cachePolicy)
  let changed = false
  const enrichedTracks: Track[] = []
  for (const track of tracks) {
    const enriched = await enrichOneLocalTrack(track, provider, policy)
    if (enriched !== track) changed = true
    enrichedTracks.push(enriched)
  }

  return changed ? enrichedTracks : tracks
}

async function enrichOneLocalTrack(
  track: Track,
  provider: LibraryMetadataEnrichmentProvider,
  policy: MetadataEnrichmentPolicy
): Promise<Track> {
  if (!isLocalTrack(track) || !needsMetadataEnrichment(track, policy)) return track

  try {
    const result = await provider.searchSongs(buildMetadataSearchQuery(track), 8, 0)
    const match = findBestMetadataMatch(track, result.items)
    return enrichLocalTrackMetadata(track, match, policy)
  } catch {
    return track
  }
}

function isLocalTrack(track: Track): boolean {
  return track.source === 'local' || track.id.startsWith('local:')
}

function needsMetadataEnrichment(track: Track, policy: MetadataEnrichmentPolicy): boolean {
  return (
    (policy.metadata && !track.album) ||
    (policy.cover && !track.cover) ||
    (policy.lyrics && (!track.lyrics || !track.translatedLyrics))
  )
}

function buildMetadataSearchQuery(track: Track): string {
  return [track.title, track.artist].map((part) => part.trim()).filter(Boolean).join(' ')
}

function normalizeMetadataEnrichmentPolicy(
  value: Partial<MetadataEnrichmentPolicy> | undefined
): MetadataEnrichmentPolicy {
  return {
    cover: value?.cover !== false,
    lyrics: value?.lyrics !== false,
    metadata: value?.metadata !== false
  }
}
