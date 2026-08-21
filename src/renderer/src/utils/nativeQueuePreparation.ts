import type { Track, TrackSource } from '../types/music'
import { isTwilightMediaGrantTarget, shouldUseNativePlaybackTarget } from './playbackRouting.ts'

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
}

export type PreparePlayerNativeQueueOptions = Omit<
  PrepareNativeQueueOptions,
  'isAudioFileAuthorized'
>

export interface PlayerNativeQueueBoundary {
  isAudioFileAuthorized: PrepareNativeQueueOptions['isAudioFileAuthorized']
}

/** Actual PlayerStore boundary: renderer identities cross preload once, while
 * filesystem authority remains owned by the main process. */
export async function preparePlayerNativeQueue(
  options: PreparePlayerNativeQueueOptions,
  boundary: PlayerNativeQueueBoundary
): Promise<PreparedNativeQueue | null> {
  return prepareNativeQueue({ ...options, ...boundary })
}

export async function prepareNativeQueue(
  options: PrepareNativeQueueOptions
): Promise<PreparedNativeQueue | null> {
  const currentItem = toQueueItem(
    options.currentTrack,
    getCurrentFallbackTarget(options.currentTrack, options.currentTarget)
  )
  if (!(await isNativeTargetAvailable(options.currentTrack, currentItem.source, options)))
    return null

  const currentIndex = findCurrentQueueIndex(options)
  if (currentIndex < 0) return asCurrentOnly(currentItem)

  const items = options.queue.map((track, index) =>
    index === currentIndex
      ? currentItem
      : toQueueItem(track, getTrackTarget(track))
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
  return track.cueRange ? track.filePath : track.subTrack || track.streamUrl || track.filePath
}

/**
 * Prefer the already-resolved play target for the current track. That may be a
 * remote URL, a twilight-media grant, or an authorized managed-cache path
 * (ncm-cache) returned by the provider. Renderer-restored local fields on
 * provider tracks are not trusted unless they already are the resolved target
 * or an ordinary remote URL on the track.
 */
function getCurrentFallbackTarget(track: Track, currentTarget: string): string {
  if (getTrackSource(track) === 'local') return currentTarget
  const trimmed = currentTarget.trim()
  if (trimmed && (isAuthorizedRemoteUrl(trimmed) || isLocalFilesystemTarget(trimmed))) {
    return currentTarget
  }
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

function isLocalFilesystemTarget(target: string): boolean {
  const trimmed = target.trim()
  if (!trimmed) return false
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmed)) return true
  if (trimmed.startsWith('/') || trimmed.startsWith('\\\\')) return true
  return false
}

/** 8.4：预取/提交的 NCM 远程播放地址只在这个窗口内可信（CDN 签发链接会过期）。 */
export const NCM_STREAM_URL_MAX_AGE_MS = 10 * 60_000

export interface NcmStreamUrlFreshness {
  /** trackId → 最近一次播放解析提交该轨 streamUrl 的时间戳。 */
  committedAtByTrackId: ReadonlyMap<string, number>
  nowMs?: number
  maxAgeMs?: number
}

/**
 * 剥离队列里过期或来路不明的 NCM 远程播放地址：只有提交时间在窗口内的
 * http(s) 地址才允许携带进原生队列；其余一律留空，由渲染层切曲时重解析
 * （provider 侧的磁盘缓存/TTL 内存缓存会让重解析近乎零成本）。本地缓存路径
 * 等非 http 目标是 provider 托管成品，不参与过期剥离。
 */
export function stripStaleNcmStreamUrls(
  queue: readonly Track[],
  freshness: NcmStreamUrlFreshness
): Track[] {
  const now = freshness.nowMs ?? Date.now()
  const maxAge = freshness.maxAgeMs ?? NCM_STREAM_URL_MAX_AGE_MS
  let changed = false
  const items = queue.map((track) => {
    if (getTrackSource(track) !== 'ncm') return track
    const streamUrl = track.streamUrl
    if (typeof streamUrl !== 'string' || !/^https?:\/\//i.test(streamUrl)) return track
    const committedAt = freshness.committedAtByTrackId.get(track.id)
    if (committedAt != null && now - committedAt <= maxAge) return track
    changed = true
    return { ...track, streamUrl: '' }
  })
  return changed ? items : ([...queue] as Track[])
}

function isAuthorizedRemoteUrl(target: string): boolean {
  // Opaque grants are already vetted when issued by main (protectProviderMedia).
  if (isTwilightMediaGrantTarget(target)) return true
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
