import { ref, watch, type Ref } from 'vue'
import type { Track } from '../types/music'
import { usePlayerStore } from './usePlayerStore'

export interface ListeningTrackStat {
  seconds: number
  plays: number
  lastPlayed: number
  title: string
  artist: string
  cover: string | null
  track?: Track
}

export interface ListeningStats {
  days: Record<string, number>
  tracks: Record<string, ListeningTrackStat>
}

const DASHBOARD_STATS_KEY = 'twilight-echo:listening-stats:v1'
const LISTENING_TICK_SECONDS = 5

const listeningStats = ref<ListeningStats>(loadListeningStats())

let listeningTimer: number | null = null
let lastCountedTrackId = ''
let trackerStarted = false

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
    result[id] = {
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
      plays: Number.isFinite(plays) && plays > 0 ? plays : 0,
      lastPlayed: Number.isFinite(lastPlayed) && lastPlayed > 0 ? lastPlayed : 0,
      title: typeof raw.title === 'string' ? raw.title : 'Unknown Track',
      artist: typeof raw.artist === 'string' ? raw.artist : 'Unknown Artist',
      cover: typeof raw.cover === 'string' && raw.cover ? raw.cover : null,
      track: isTrackSnapshot(raw.track) ? raw.track : undefined
    }
  }
  return result
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

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function shouldTrackListeningStats(track: Track): boolean {
  return track.source !== 'bili' && !track.id.startsWith('bili:')
}

function addListeningSeconds(track: Track, seconds: number): void {
  if (!shouldTrackListeningStats(track)) return
  const today = dayKey(new Date())
  const nextStats: ListeningStats = {
    days: { ...listeningStats.value.days },
    tracks: { ...listeningStats.value.tracks }
  }
  nextStats.days[today] = (nextStats.days[today] ?? 0) + seconds
  const previous = nextStats.tracks[track.id] ?? {
    seconds: 0,
    plays: 0,
    lastPlayed: 0,
    title: track.title,
    artist: track.artist,
    cover: track.cover
  }
  nextStats.tracks[track.id] = {
    seconds: previous.seconds + seconds,
    plays: previous.plays + (lastCountedTrackId === track.id ? 0 : 1),
    lastPlayed: Date.now(),
    title: track.title || previous.title,
    artist: track.artist || previous.artist,
    cover: track.cover || previous.cover,
    track: cloneTrack(track)
  }
  lastCountedTrackId = track.id
  listeningStats.value = nextStats
  saveListeningStats()
}

function cloneTrack(track: Track): Track {
  return JSON.parse(JSON.stringify(track)) as Track
}

function startListeningTimer(): void {
  stopListeningTimer()
  const { currentTrack, isPlaying } = usePlayerStore()
  listeningTimer = window.setInterval(() => {
    const track = currentTrack.value
    if (!track || !isPlaying.value) return
    addListeningSeconds(track, LISTENING_TICK_SECONDS)
  }, LISTENING_TICK_SECONDS * 1000)
}

function stopListeningTimer(): void {
  if (listeningTimer !== null) {
    window.clearInterval(listeningTimer)
    listeningTimer = null
  }
}

export function setupListeningStatsTracking(): void {
  if (trackerStarted) return
  trackerStarted = true
  const { currentTrack, isPlaying } = usePlayerStore()
  watch(
    [isPlaying, () => currentTrack.value?.id],
    ([playing, trackId]) => {
      if (!playing || !trackId) {
        stopListeningTimer()
        return
      }
      startListeningTimer()
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
