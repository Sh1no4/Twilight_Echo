import type { MediaProviderSearchResult } from '../providers/mediaProvider.ts'
import type { Track } from '../types/music'
import { enrichLocalTrackMetadata, findBestMetadataMatch } from './musicMetadataMatching.ts'

export interface LibraryMetadataEnrichmentProvider {
  searchSongs: (
    query: string,
    limit?: number,
    offset?: number
  ) => Promise<MediaProviderSearchResult<Track>>
}

export async function enrichLocalTracksFromProviders(
  tracks: Track[],
  provider: LibraryMetadataEnrichmentProvider | null | undefined
): Promise<Track[]> {
  if (!provider) return tracks

  let changed = false
  const enrichedTracks: Track[] = []
  for (const track of tracks) {
    const enriched = await enrichOneLocalTrack(track, provider)
    if (enriched !== track) changed = true
    enrichedTracks.push(enriched)
  }

  return changed ? enrichedTracks : tracks
}

async function enrichOneLocalTrack(
  track: Track,
  provider: LibraryMetadataEnrichmentProvider
): Promise<Track> {
  if (!isLocalTrack(track) || !needsMetadataEnrichment(track)) return track

  try {
    const result = await provider.searchSongs(buildMetadataSearchQuery(track), 8, 0)
    const match = findBestMetadataMatch(track, result.items)
    return enrichLocalTrackMetadata(track, match)
  } catch {
    return track
  }
}

function isLocalTrack(track: Track): boolean {
  return track.source === 'local' || track.id.startsWith('local:')
}

function needsMetadataEnrichment(track: Track): boolean {
  return !track.album || !track.cover || !track.lyrics || !track.translatedLyrics
}

function buildMetadataSearchQuery(track: Track): string {
  return [track.title, track.artist].map((part) => part.trim()).filter(Boolean).join(' ')
}
