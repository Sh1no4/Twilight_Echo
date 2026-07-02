import type { ListeningTrackStat } from '../stores/useListeningStatsStore'
import type { Track } from '../types/music'
import { getLogicalTrackKey } from './logicalTrackIdentity.ts'

type RecentStat = ListeningTrackStat & { id: string }

export function resolveUnifiedRecentTracks({
  recentStats,
  localTracks
}: {
  recentStats: RecentStat[]
  localTracks: Track[]
}): Track[] {
  const localById = new Map(localTracks.map((track) => [track.id, track]))
  const localByLogicalKey = new Map<string, Track>()
  for (const track of localTracks) {
    const key = getLogicalTrackKey(track)
    if (!localByLogicalKey.has(key)) localByLogicalKey.set(key, track)
  }
  const tracks: Track[] = []
  const seen = new Set<string>()

  for (const stat of recentStats) {
    const resolved = resolveRecentTrack(stat, localById, localByLogicalKey)
    const seenKey = getLogicalTrackKey(stat)
    if (!resolved || seen.has(seenKey)) continue
    seen.add(seenKey)
    tracks.push(resolved)
  }

  return tracks
}

function resolveRecentTrack(
  stat: RecentStat,
  localById: Map<string, Track>,
  localByLogicalKey: Map<string, Track>
): Track | null {
  for (const source of stat.sourceIds ?? []) {
    const localTrack = localById.get(source.trackId)
    if (localTrack) return localTrack
  }

  const localVariant = localByLogicalKey.get(getLogicalTrackKey(stat))
  if (localVariant) return localVariant

  return stat.track ?? null
}
