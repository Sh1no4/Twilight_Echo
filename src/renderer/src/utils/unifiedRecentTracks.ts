import type { ListeningTrackStat } from '../stores/useListeningStatsStore'
import type { Track } from '../types/music'
import { getLogicalTrackKey } from './logicalTrackIdentity.ts'
import { buildLogicalTracks, type LogicalTrack } from './logicalTrackModel.ts'

export type UnifiedRecentStat = ListeningTrackStat & { id: string }

export function resolveUnifiedRecentTracks({
  recentStats,
  localTracks
}: {
  recentStats: UnifiedRecentStat[]
  localTracks: Track[]
}): Track[] {
  const resolveTrack = createUnifiedRecentTrackResolver(localTracks)
  const tracks: Track[] = []
  const seen = new Set<string>()

  for (const stat of recentStats) {
    const resolved = resolveTrack(stat)
    const seenKey = getLogicalTrackKey(stat)
    if (!resolved || seen.has(seenKey)) continue
    seen.add(seenKey)
    tracks.push(resolved)
  }

  return tracks
}

export function createUnifiedRecentTrackResolver(
  localTracks: Track[]
): (stat: UnifiedRecentStat) => Track | null {
  const localById = buildLocalTrackIdMap(localTracks)
  const localByLogicalKey = buildLocalLogicalTrackMap(localTracks)

  return (stat) => resolveRecentTrack(stat, localById, localByLogicalKey)
}

function resolveRecentTrack(
  stat: UnifiedRecentStat,
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

function buildLocalTrackIdMap(localTracks: Track[]): Map<string, Track> {
  const result = new Map<string, Track>()
  for (const track of localTracks) {
    result.set(track.id, track)
  }
  return result
}

function* localLogicalTrackInputs(localTracks: Track[]) {
  for (const track of localTracks) {
    yield {
      track,
      source: 'local' as const,
      sourceName: '本地音乐',
      providerAvailable: true
    }
  }
}

function buildLocalLogicalTrackMap(localTracks: Track[]): Map<string, LogicalTrack> {
  const result = new Map<string, LogicalTrack>()
  for (const logicalTrack of buildLogicalTracks(localLogicalTrackInputs(localTracks))) {
    if (!result.has(logicalTrack.id)) result.set(logicalTrack.id, logicalTrack)
  }
  return result
}
