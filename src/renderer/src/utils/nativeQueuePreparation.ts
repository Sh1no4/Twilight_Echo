import type { Track, TrackSource } from '../types/music'
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
}

export async function prepareNativeQueue(
  options: PrepareNativeQueueOptions
): Promise<PreparedNativeQueue | null> {
  const currentItem = toQueueItem(options.currentTrack, options.currentTarget)
  if (!(await isNativeTargetAvailable(options.currentTrack, currentItem.source, options)))
    return null

  const currentIndex = findCurrentQueueIndex(options)
  if (currentIndex < 0) return asCurrentOnly(currentItem)

  const items = options.queue.map((track, index) =>
    index === currentIndex ? currentItem : toQueueItem(track, getTrackTarget(track))
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

function asCurrentOnly(item: NativeQueueLoadItem): PreparedNativeQueue {
  return { items: [item], startIndex: 0, delegated: false }
}

function findCurrentQueueIndex(options: PrepareNativeQueueOptions): number {
  const candidate = options.queue[options.currentIndex]
  if (candidate?.id === options.currentTrack.id) return options.currentIndex
  return options.queue.findIndex((track) => track.id === options.currentTrack.id)
}

function getTrackTarget(track: Track): string {
  return track.subTrack || track.streamUrl || track.filePath
}

function getTrackSource(track: Track): TrackSource {
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
  if (typeof track.replayGainTrackGainDb === 'number' && Number.isFinite(track.replayGainTrackGainDb)) {
    item.replayGainTrackGainDb = track.replayGainTrackGainDb
  }
  if (typeof track.replayGainAlbumGainDb === 'number' && Number.isFinite(track.replayGainAlbumGainDb)) {
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
