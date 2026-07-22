import type { Track } from '../types/music'

export interface FavoriteSummary {
  name: string
  trackCount: number
  cover: string | null
  coverSource?: string | null
}

export interface ResolvedFavoriteTracks {
  source: 'unified' | 'provider'
  tracks: Track[]
}

export function resolveUnifiedFavoriteTracks({
  unifiedTracks,
  providerTracks
}: {
  unifiedTracks: Track[]
  providerTracks: Track[]
}): ResolvedFavoriteTracks {
  if (unifiedTracks.length > 0) {
    return {
      source: 'unified',
      tracks: unifiedTracks
    }
  }
  return {
    source: 'provider',
    tracks: providerTracks
  }
}

export function summarizeUnifiedFavorites({
  unifiedTracks,
  providerSummary
}: {
  unifiedTracks: Track[]
  providerSummary: FavoriteSummary
}): FavoriteSummary {
  if (unifiedTracks.length === 0) return providerSummary
  const coverTrack = unifiedTracks.find((track) => track.cover)
  return {
    name: '我收藏的歌曲',
    trackCount: unifiedTracks.length,
    cover: coverTrack?.cover ?? null,
    ...(coverTrack?.coverSource ? { coverSource: coverTrack.coverSource } : {})
  }
}
