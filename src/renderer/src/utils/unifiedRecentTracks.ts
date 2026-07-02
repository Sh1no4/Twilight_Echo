import type { ListeningTrackStat } from '../stores/useListeningStatsStore'
import type { Track } from '../types/music'
import { getLogicalTrackKey } from './logicalTrackIdentity.ts'
import { buildLogicalTracks, type LogicalTrack } from './logicalTrackModel.ts'

type RecentStat = ListeningTrackStat & { id: string }

export function resolveUnifiedRecentTracks({
  recentStats,
  localTracks
}: {
  recentStats: RecentStat[]
  localTracks: Track[]
}): Track[] {
  const localById = new Map(localTracks.map((track) => [track.id, track]))
  const localByLogicalKey = buildLocalLogicalTrackMap(localTracks)
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
  localByLogicalKey: Map<string, LogicalTrack>
): Track | null {
  for (const source of stat.sourceIds ?? []) {
    const localTrack = localById.get(source.trackId)
    const localLogicalTrack = localTrack
      ? localByLogicalKey.get(getLogicalTrackKey(localTrack))
      : undefined
    if (localLogicalTrack) return localLogicalTrack.preferredTrack
    if (localTrack) return localTrack
  }

  const localVariant = localByLogicalKey.get(getLogicalTrackKey(stat))
  if (localVariant) return localVariant.preferredTrack

  return stat.track ?? null
}

function buildLocalLogicalTrackMap(localTracks: Track[]): Map<string, LogicalTrack> {
  const result = new Map<string, LogicalTrack>()
  for (const logicalTrack of buildLogicalTracks(
    localTracks.map((track) => ({
      track,
      source: 'local',
      sourceName: '本地音乐',
      providerAvailable: true
    }))
  )) {
    if (!result.has(logicalTrack.id)) result.set(logicalTrack.id, logicalTrack)
  }
  return result
}
