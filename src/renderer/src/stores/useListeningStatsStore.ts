import { ref, watch, type Ref } from 'vue'
import type { Track } from '../types/music'
import { getLogicalTrackKey, normalizeLogicalTrackText } from '../utils/logicalTrackIdentity.ts'

export interface ListeningTrackStat {
  seconds: number
  plays: number
  lastPlayed: number
  skips: number
  completions: number
  title: string
  artist: string
  cover: string | null
  sourceIds?: ListeningTrackSourceId[]
  track?: Track
}

export interface ListeningTrackSourceId {
  source: string
  trackId: string
}

export interface ListeningArtistStat {
  id: string
  name: string
  seconds: number
  plays: number
  skips: number
  completions: number
  trackCount: number
  lastPlayed: number
  cover: string | null
  sourceIds: string[]
}

export interface ListeningStats {
  days: Record<string, number>
  tracks: Record<string, ListeningTrackStat>
}

interface ListeningPlayerState {
  currentTrack: Ref<Track | null>
  isPlaying: Ref<boolean>
  currentTime: Ref<number>
  duration: Ref<number>
}

type ListeningTimerState = Pick<ListeningPlayerState, 'currentTrack' | 'isPlaying'>

const DASHBOARD_STATS_KEY = 'twilight-echo:listening-stats:v1'
const LISTENING_TICK_SECONDS = 5
const COMPLETION_RATIO = 0.9
const SKIP_RATIO = 0.5

const listeningStats = ref<ListeningStats>(loadListeningStats())

let listeningTimer: number | null = null
let lastCountedTrackId = ''
let trackerStarted = false
let lastOutcomeTrack: Track | null = null
let lastOutcomePosition = 0
let lastOutcomeDuration = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeNumberRecord(value: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value)) {
    const numberValue = Number(raw)
    if (Number.isFinite(numberValue) && numberValue > 0) result[key] = numberValue
  }
  return result
}

function normalizeTrackStats(value: Record<string, unknown>): Record<string, ListeningTrackStat> {
  const result: Record<string, ListeningTrackStat> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    const seconds = Number(raw.seconds)
    const plays = Number(raw.plays)
    const lastPlayed = Number(raw.lastPlayed)
    const skips = Number(raw.skips)
    const completions = Number(raw.completions)
    result[id] = {
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
      plays: Number.isFinite(plays) && plays > 0 ? plays : 0,
      lastPlayed: Number.isFinite(lastPlayed) && lastPlayed > 0 ? lastPlayed : 0,
      skips: Number.isFinite(skips) && skips > 0 ? skips : 0,
      completions: Number.isFinite(completions) && completions > 0 ? completions : 0,
      title: typeof raw.title === 'string' ? raw.title : 'Unknown Track',
      artist: typeof raw.artist === 'string' ? raw.artist : 'Unknown Artist',
      cover: typeof raw.cover === 'string' && raw.cover ? raw.cover : null,
      sourceIds: Array.isArray(raw.sourceIds) ? normalizeSourceIds(raw.sourceIds) : undefined,
      track: isTrackSnapshot(raw.track) ? raw.track : undefined
    }
  }
  return result
}

function normalizeSourceIds(value: unknown[]): ListeningTrackSourceId[] {
  return value
    .filter(isRecord)
    .map((raw) => ({
      source: typeof raw.source === 'string' && raw.source ? raw.source : 'local',
      trackId: typeof raw.trackId === 'string' ? raw.trackId : ''
    }))
    .filter((item) => item.trackId.length > 0)
}

function isTrackSnapshot(value: unknown): value is Track {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.artist === 'string' &&
    typeof value.album === 'string' &&
    typeof value.filePath === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.duration === 'number' &&
    typeof value.size === 'number'
  )
}

function loadListeningStats(): ListeningStats {
  try {
    const parsed = JSON.parse(localStorage.getItem(DASHBOARD_STATS_KEY) || '')
    if (parsed && typeof parsed === 'object') {
      return {
        days: isRecord(parsed.days) ? normalizeNumberRecord(parsed.days) : {},
        tracks: isRecord(parsed.tracks) ? normalizeTrackStats(parsed.tracks) : {}
      }
    }
  } catch {
    // Ignore corrupt local dashboard stats and start fresh.
  }
  return { days: {}, tracks: {} }
}

function saveListeningStats(): void {
  localStorage.setItem(DASHBOARD_STATS_KEY, JSON.stringify(listeningStats.value))
}

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function shouldTrackListeningStats(track: Track): boolean {
  return track.source !== 'bili' && !track.id.startsWith('bili:')
}

function addListeningSeconds(track: Track, seconds: number): void {
  recordListening(track, seconds, Date.now())
}

function recordListening(track: Track, seconds: number, timestamp: number): void {
  if (!shouldTrackListeningStats(track)) return
  const today = dayKey(timestamp)
  const statKey = getListeningStatKey(track)
  const nextStats: ListeningStats = {
    days: { ...listeningStats.value.days },
    tracks: { ...listeningStats.value.tracks }
  }
  nextStats.days[today] = (nextStats.days[today] ?? 0) + seconds
  const previous = nextStats.tracks[statKey] ?? {
    seconds: 0,
    plays: 0,
    lastPlayed: 0,
    skips: 0,
    completions: 0,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    sourceIds: []
  }
  nextStats.tracks[statKey] = {
    seconds: previous.seconds + seconds,
    plays: previous.plays + (lastCountedTrackId === track.id ? 0 : 1),
    lastPlayed: timestamp,
    skips: previous.skips,
    completions: previous.completions,
    title: track.title || previous.title,
    artist: track.artist || previous.artist,
    cover: track.cover || previous.cover,
    sourceIds: upsertSourceId(previous.sourceIds, track),
    track: cloneTrack(track)
  }
  lastCountedTrackId = track.id
  listeningStats.value = nextStats
  saveListeningStats()
}

function recordPlaybackOutcome(
  track: Track,
  {
    position,
    duration,
    timestamp
  }: {
    position: number
    duration: number
    timestamp: number
  }
): void {
  if (!shouldTrackListeningStats(track)) return
  const normalizedDuration =
    Number.isFinite(duration) && duration > 0 ? duration : track.duration
  if (!Number.isFinite(position) || !Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
    return
  }

  const ratio = Math.max(0, position) / normalizedDuration
  const outcome =
    ratio >= COMPLETION_RATIO ? 'completion' : ratio < SKIP_RATIO ? 'skip' : null
  if (!outcome) return

  const statKey = getListeningStatKey(track)
  const previous = listeningStats.value.tracks[statKey] ?? createEmptyTrackStat(track)
  const nextStats: ListeningStats = {
    days: { ...listeningStats.value.days },
    tracks: { ...listeningStats.value.tracks }
  }

  nextStats.tracks[statKey] = {
    ...previous,
    lastPlayed: Math.max(previous.lastPlayed, timestamp),
    skips: previous.skips + (outcome === 'skip' ? 1 : 0),
    completions: previous.completions + (outcome === 'completion' ? 1 : 0),
    title: track.title || previous.title,
    artist: track.artist || previous.artist,
    cover: track.cover || previous.cover,
    sourceIds: upsertSourceId(previous.sourceIds, track),
    track: cloneTrack(track)
  }
  listeningStats.value = nextStats
  saveListeningStats()
}

function recordPlaybackTransition({
  previousTrack,
  nextTrack,
  position,
  duration,
  timestamp
}: {
  previousTrack: Track | null
  nextTrack: Track | null
  position: number
  duration: number
  timestamp: number
}): void {
  if (!previousTrack || previousTrack.id === nextTrack?.id) return
  recordPlaybackOutcome(previousTrack, { position, duration, timestamp })
}

function createEmptyTrackStat(track: Track): ListeningTrackStat {
  return {
    seconds: 0,
    plays: 0,
    lastPlayed: 0,
    skips: 0,
    completions: 0,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    sourceIds: []
  }
}

function upsertSourceId(
  sourceIds: ListeningTrackSourceId[] | undefined,
  track: Track
): ListeningTrackSourceId[] {
  const source = getTrackSource(track)
  const next = (sourceIds ?? []).filter((item) => item.trackId !== track.id)
  next.push({ source, trackId: track.id })
  return next
}

function getListeningStatKey(track: Track): string {
  return getLogicalTrackKey(track)
}

function getTrackSource(track: Pick<Track, 'id' | 'source'>): string {
  if (track.source) return track.source
  const separatorIndex = track.id.indexOf(':')
  return separatorIndex > 0 ? track.id.slice(0, separatorIndex) : 'local'
}

function normalizeStatText(value: string | undefined): string {
  return normalizeLogicalTrackText(value)
}

function cloneTrack(track: Track): Track {
  // Shallow copy — cover is now a lightweight handle, lyrics excluded to save memory
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    filePath: track.filePath,
    fileName: track.fileName,
    dir: track.dir,
    duration: track.duration,
    size: track.size,
    cover: track.cover,
    lyrics: null,
    source: track.source,
    ncmSongId: track.ncmSongId,
    streamUrl: track.streamUrl,
    format: track.format,
    sampleRate: track.sampleRate,
    bitrate: track.bitrate,
    bitDepth: track.bitDepth
  }
}

function startListeningTimer(player: ListeningTimerState): void {
  stopListeningTimer()
  listeningTimer = window.setInterval(() => {
    const track = player.currentTrack.value
    if (!track || !player.isPlaying.value) return
    addListeningSeconds(track, LISTENING_TICK_SECONDS)
  }, LISTENING_TICK_SECONDS * 1000)
}

function stopListeningTimer(): void {
  if (listeningTimer !== null) {
    window.clearInterval(listeningTimer)
    listeningTimer = null
  }
}

export async function setupListeningStatsTracking(): Promise<void> {
  if (trackerStarted) return
  trackerStarted = true
  const { usePlayerStore } = await import('./usePlayerStore.ts')
  const { currentTrack, isPlaying, currentTime, duration } = usePlayerStore()
  lastOutcomeTrack = currentTrack.value
  lastOutcomePosition = currentTime.value
  lastOutcomeDuration = duration.value
  watch(
    [isPlaying, () => currentTrack.value?.id],
    ([playing, trackId]) => {
      if (!playing || !trackId) {
        stopListeningTimer()
        return
      }
      startListeningTimer({ currentTrack, isPlaying })
    },
    { immediate: true }
  )
  watch(
    [currentTrack, currentTime, duration],
    ([track, position, trackDuration], [previousTrack]) => {
      const previousSnapshot = lastOutcomeTrack
      if (previousSnapshot && previousSnapshot.id !== track?.id) {
        recordPlaybackTransition({
          previousTrack: previousSnapshot,
          nextTrack: track,
          position: lastOutcomePosition,
          duration: lastOutcomeDuration,
          timestamp: Date.now()
        })
      }
      lastOutcomeTrack = track
      lastOutcomePosition = position
      lastOutcomeDuration = trackDuration
      if (!previousTrack && track) {
        lastOutcomePosition = position
        lastOutcomeDuration = trackDuration
      }
    },
    { immediate: true }
  )
}

export function useListeningStatsStore(): {
  listeningStats: Ref<ListeningStats>
} {
  return {
    listeningStats
  }
}

export function getRecentTracks(limit = 100): Array<ListeningTrackStat & { id: string }> {
  return Object.entries(listeningStats.value.tracks)
    .filter(([, stat]) => stat.lastPlayed > 0)
    .sort(([, a], [, b]) => b.lastPlayed - a.lastPlayed)
    .slice(0, limit)
    .map(([id, stat]) => ({ id, ...stat }))
}

export function getTopTracks(limit = 100): Array<ListeningTrackStat & { id: string }> {
  return Object.entries(listeningStats.value.tracks)
    .filter(([, stat]) => stat.plays > 0 || stat.seconds > 0)
    .sort(([, a], [, b]) => {
      if (b.plays !== a.plays) return b.plays - a.plays
      if (b.seconds !== a.seconds) return b.seconds - a.seconds
      return b.lastPlayed - a.lastPlayed
    })
    .slice(0, limit)
    .map(([id, stat]) => ({ id, ...stat }))
}

export function getTopArtists(limit = 50): ListeningArtistStat[] {
  const artists = new Map<string, ListeningArtistStat>()
  for (const stat of Object.values(listeningStats.value.tracks)) {
    const artistId = normalizeStatText(stat.artist)
    if (!artistId) continue
    const previous = artists.get(artistId)
    const sourceIds = stat.sourceIds?.map((source) => source.trackId) ?? []
    if (!previous) {
      artists.set(artistId, {
        id: artistId,
        name: stat.artist,
        seconds: stat.seconds,
        plays: stat.plays,
        skips: stat.skips,
        completions: stat.completions,
        trackCount: 1,
        lastPlayed: stat.lastPlayed,
        cover: stat.cover,
        sourceIds: [...sourceIds]
      })
      continue
    }
    previous.seconds += stat.seconds
    previous.plays += stat.plays
    previous.skips += stat.skips
    previous.completions += stat.completions
    previous.trackCount += 1
    if (stat.lastPlayed >= previous.lastPlayed) {
      previous.name = stat.artist
      previous.lastPlayed = stat.lastPlayed
      previous.cover = stat.cover || previous.cover
    }
    for (const sourceId of sourceIds) {
      if (!previous.sourceIds.includes(sourceId)) previous.sourceIds.push(sourceId)
    }
  }

  return Array.from(artists.values())
    .sort((a, b) => {
      if (b.plays !== a.plays) return b.plays - a.plays
      if (b.seconds !== a.seconds) return b.seconds - a.seconds
      return b.lastPlayed - a.lastPlayed
    })
    .slice(0, limit)
}

export function resetListeningStatsForTest(): void {
  listeningStats.value = { days: {}, tracks: {} }
  lastCountedTrackId = ''
  lastOutcomeTrack = null
  lastOutcomePosition = 0
  lastOutcomeDuration = 0
}

export function recordListeningForTest(track: Track, seconds: number, timestamp: number): void {
  recordListening(track, seconds, timestamp)
}

export function recordPlaybackOutcomeForTest(
  track: Track,
  options: { position: number; duration: number; timestamp: number }
): void {
  recordPlaybackOutcome(track, options)
}

export function recordPlaybackTransitionForTest(options: {
  previousTrack: Track | null
  nextTrack: Track | null
  position: number
  duration: number
  timestamp: number
}): void {
  recordPlaybackTransition(options)
}
