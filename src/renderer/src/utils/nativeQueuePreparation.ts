import type { Track, TrackSource } from '../types/music'
import type { OfflinePlayablePathRequest } from '../../../shared/offlineDownloads.ts'
import { shouldUseNativePlaybackTarget } from './playbackRouting.ts'

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/

export interface NativeQueueLoadItem {
  id: string
  source: string
  duration?: number
  format?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
  measuredIntegratedLufs?: number
  measuredTruePeakDb?: number
  replayGainTrackGainDb?: number
  replayGainAlbumGainDb?: number
  replayGainTrackPeak?: number
  replayGainAlbumPeak?: number
  r128TrackGainDb?: number
  r128AlbumGainDb?: number
  cueRange?: Track['cueRange']
}

export interface PreparedNativeQueue {
  items: NativeQueueLoadItem[]
  startIndex: number
  delegated: boolean
}

export interface PrepareNativeQueueOptions {
  queue: Track[]
  currentTrack: Track
  currentTarget: string
  currentIndex: number
  isAudioFileAuthorized: (filePath: string) => Promise<boolean>
  getOfflinePlayablePaths: (requests: OfflinePlayablePathRequest[]) => Promise<(string | null)[]>
}

export type PreparePlayerNativeQueueOptions = Omit<
  PrepareNativeQueueOptions,
  'isAudioFileAuthorized' | 'getOfflinePlayablePaths'
>

export interface PlayerNativeQueueBoundary {
  isAudioFileAuthorized: PrepareNativeQueueOptions['isAudioFileAuthorized']
  getOfflinePlayablePaths: PrepareNativeQueueOptions['getOfflinePlayablePaths']
}

/** Actual PlayerStore boundary: renderer identities cross preload once, while
 * filesystem authority and pin integrity remain owned by the main process. */
export async function preparePlayerNativeQueue(
  options: PreparePlayerNativeQueueOptions,
  boundary: PlayerNativeQueueBoundary
): Promise<PreparedNativeQueue | null> {
  return prepareNativeQueue({ ...options, ...boundary })
}

export async function prepareNativeQueue(
  options: PrepareNativeQueueOptions
): Promise<PreparedNativeQueue | null> {
  const offlineTargets = await resolveOfflineTargets(options)
  const currentOfflineTarget = offlineTargets.get(trackOfflineKey(options.currentTrack))
  const currentItem = toQueueItem(
    options.currentTrack,
    currentOfflineTarget ?? getCurrentFallbackTarget(options.currentTrack, options.currentTarget)
  )
  if (!(await isNativeTargetAvailable(options.currentTrack, currentItem.source, options)))
    return null

  const currentIndex = findCurrentQueueIndex(options)
  if (currentIndex < 0) return asCurrentOnly(currentItem)

  const items = options.queue.map((track, index) =>
    index === currentIndex
      ? currentItem
      : toQueueItem(track, offlineTargets.get(trackOfflineKey(track)) ?? getTrackTarget(track))
  )
  const available = await Promise.all(
    options.queue.map((track, index) =>
      isNativeTargetAvailable(track, items[index].source, options)
    )
  )
  if (available.every(Boolean)) {
    return { items, startIndex: currentIndex, delegated: true }
  }
  return asCurrentOnly(currentItem)
}

async function resolveOfflineTargets(
  options: PrepareNativeQueueOptions
): Promise<Map<string, string>> {
  const uniqueTracks = new Map<string, Track>()
  for (const track of [...options.queue, options.currentTrack]) {
    if (getTrackSource(track) === 'local') continue
    uniqueTracks.set(trackOfflineKey(track), track)
  }
  const entries = [...uniqueTracks.entries()]
  if (entries.length === 0) return new Map()
  const requests = entries.map(([, track]) => ({
    providerId: getTrackSource(track),
    trackId: track.id
  }))
  try {
    const paths = await options.getOfflinePlayablePaths(requests)
    if (!Array.isArray(paths) || paths.length !== requests.length) return new Map()
    const result = new Map<string, string>()
    for (let index = 0; index < entries.length; index += 1) {
      const path = paths[index]
      if (typeof path === 'string' && path.trim()) result.set(entries[index][0], path)
    }
    return result
  } catch {
    // A failed pin lookup is never authority for a cached renderer path. Queue
    // preparation falls back to the ordinary online/provider target instead.
    return new Map()
  }
}

function trackOfflineKey(track: Pick<Track, 'id' | 'source'>): string {
  return `${getTrackSource(track)}\0${track.id}`
}

function asCurrentOnly(item: NativeQueueLoadItem): PreparedNativeQueue {
  return { items: [item], startIndex: 0, delegated: false }
}

function findCurrentQueueIndex(options: PrepareNativeQueueOptions): number {
  const candidate = options.queue[options.currentIndex]
  if (candidate?.id === options.currentTrack.id) return options.currentIndex
  return options.queue.findIndex((track) => track.id === options.currentTrack.id)
}

function getTrackTarget(track: Track): string {
  return track.cueRange ? track.filePath : track.subTrack || track.streamUrl || track.filePath
}

/**
 * A provider track may only use a local path returned by the main-process pin
 * lookup above. Renderer-restored fields (including offlinePath) and a caller-
 * supplied local currentTarget are not proof that the path belongs to this
 * provider identity. When no verified pin exists, retain only the ordinary
 * HTTP(S) provider target; an empty target fails closed in availability checks.
 */
function getCurrentFallbackTarget(track: Track, currentTarget: string): string {
  if (getTrackSource(track) === 'local') return currentTarget
  if (isAuthorizedRemoteUrl(currentTarget)) return currentTarget
  const onlineTarget = [track.subTrack, track.streamUrl, track.filePath].find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && isAuthorizedRemoteUrl(candidate)
  )
  return onlineTarget ?? ''
}

function getTrackSource(track: Pick<Track, 'id' | 'source'>): TrackSource {
  if (track.source) return track.source
  if (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)) return 'local'
  const separatorIndex = track.id.indexOf(':')
  return (separatorIndex > 0 ? track.id.slice(0, separatorIndex) : 'local') as TrackSource
}

function toQueueItem(track: Track, source: string): NativeQueueLoadItem {
  const item: NativeQueueLoadItem = {
    id: track.id,
    duration: track.duration,
    source,
    format: track.format,
    sampleRate: track.sampleRate,
    bitrate: track.bitrate,
    bitDepth: track.bitDepth
  }
  if (track.cueRange) item.cueRange = { ...track.cueRange }
  if (
    typeof track.replayGainTrackGainDb === 'number' &&
    Number.isFinite(track.replayGainTrackGainDb)
  ) {
    item.replayGainTrackGainDb = track.replayGainTrackGainDb
  }
  if (
    typeof track.replayGainAlbumGainDb === 'number' &&
    Number.isFinite(track.replayGainAlbumGainDb)
  ) {
    item.replayGainAlbumGainDb = track.replayGainAlbumGainDb
  }
  if (typeof track.replayGainTrackPeak === 'number' && Number.isFinite(track.replayGainTrackPeak)) {
    item.replayGainTrackPeak = track.replayGainTrackPeak
  }
  if (typeof track.replayGainAlbumPeak === 'number' && Number.isFinite(track.replayGainAlbumPeak)) {
    item.replayGainAlbumPeak = track.replayGainAlbumPeak
  }
  if (typeof track.r128TrackGainDb === 'number' && Number.isFinite(track.r128TrackGainDb)) {
    item.r128TrackGainDb = track.r128TrackGainDb
  }
  if (typeof track.r128AlbumGainDb === 'number' && Number.isFinite(track.r128AlbumGainDb)) {
    item.r128AlbumGainDb = track.r128AlbumGainDb
  }
  return item
}

async function isNativeTargetAvailable(
  track: Track,
  target: string,
  options: PrepareNativeQueueOptions
): Promise<boolean> {
  if (!shouldUseNativePlaybackTarget(getTrackSource(track), target)) return false
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(target.trim())) {
    return await isAuthorizedLocalFile(target, options)
  }
  if (isAuthorizedRemoteUrl(target)) return true
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target.trim())) return false
  return await isAuthorizedLocalFile(target, options)
}

async function isAuthorizedLocalFile(
  target: string,
  options: PrepareNativeQueueOptions
): Promise<boolean> {
  try {
    return await options.isAudioFileAuthorized(target)
  } catch {
    return false
  }
}

function isAuthorizedRemoteUrl(target: string): boolean {
  try {
    const parsed = new URL(target.trim())
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}
