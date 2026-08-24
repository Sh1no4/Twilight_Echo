import type { Track } from '../types/music'
import { getLogicalTrackKey } from './logicalTrackIdentity.ts'
import {
  canShareTrackIdentity,
  compareSourceVariants,
  getTrackSource,
  toSourceVariant,
  type SourceVariant
} from './logicalTrackModel.ts'

/**
 * 聚合歌单视图：把一个歌单里跨音源的曲目按"同一段录音"折叠成一行，让用户按行
 * 选择用哪个音源播放，并按音源整体显示 / 隐藏。
 *
 * 分组刻意用 `canShareTrackIdentity` 而不是 `buildLogicalTracks` 内部的时长判定
 * ——同一个 provider 永远不会把一个歌曲 id 发两次，所以同 provider 的两个不同 id
 * 是两段不同录音，哪怕标题歌手完全相同。用宽判定会让同名同歌手的不同歌互相顶掉。
 */

export interface AggregatePlaylistLike {
  kind?: string
}

export interface AggregatePlaylistOrderLike {
  pinnedAt?: string | null
  createdAt: string
  updatedAt?: string
}

export interface AggregateRow {
  /** 稳定的行标识：本行所有音源里字典序最小的 trackId，可直接当持久化 key。 */
  anchorTrackId: string
  title: string
  artist: string
  album: string
  /** 本行全部音源，最佳优先（含被隐藏的）。 */
  allVariants: SourceVariant[]
  /** 本行未被隐藏的音源，最佳优先。 */
  visibleVariants: SourceVariant[]
  /** 当前用来播放这一行的音源。 */
  selectedVariant: SourceVariant
  /** 用户为这一行显式选过音源，且该选择当前仍然可用。 */
  variantPinned: boolean
}

export interface AggregateSourceCount {
  source: string
  count: number
  hidden: boolean
}

export interface BuildAggregateRowsInput {
  tracks: Track[]
  hiddenSources?: string[]
  variantPreferences?: Record<string, string>
}

export function isAggregatePlaylist(playlist: AggregatePlaylistLike): boolean {
  return playlist.kind === 'aggregate'
}

/** 置顶优先（按置顶时间倒序），其余按最近更新倒序；同序保持原有相对次序。 */
export function sortAggregatePlaylists<T extends AggregatePlaylistOrderLike>(playlists: T[]): T[] {
  return playlists
    .map((playlist, index) => ({ playlist, index }))
    .sort((left, right) => {
      const leftPinned = left.playlist.pinnedAt || ''
      const rightPinned = right.playlist.pinnedAt || ''
      if (leftPinned && rightPinned && leftPinned !== rightPinned) {
        return rightPinned.localeCompare(leftPinned)
      }
      if (!!leftPinned !== !!rightPinned) return leftPinned ? -1 : 1
      const leftTouched = left.playlist.updatedAt || left.playlist.createdAt || ''
      const rightTouched = right.playlist.updatedAt || right.playlist.createdAt || ''
      if (leftTouched !== rightTouched) return rightTouched.localeCompare(leftTouched)
      return left.index - right.index
    })
    .map((entry) => entry.playlist)
}

export function buildAggregateRows({
  tracks,
  hiddenSources = [],
  variantPreferences = {}
}: BuildAggregateRowsInput): AggregateRow[] {
  const hidden = new Set(hiddenSources)
  const rows: AggregateRow[] = []

  for (const group of groupTracksByRecording(tracks)) {
    const allVariants = group.slice().sort(compareSourceVariants)
    const anchorTrackId = allVariants.reduce(
      (anchor, variant) => (variant.track.id < anchor ? variant.track.id : anchor),
      allVariants[0].track.id
    )
    const visibleVariants = allVariants.filter((variant) => !hidden.has(variant.source))
    // 一行的所有音源都被隐藏了，这一行就整体消失。
    if (visibleVariants.length === 0) continue

    const preferred = variantPreferences[anchorTrackId]
    const pinnedVariant = preferred
      ? visibleVariants.find((variant) => variant.source === preferred)
      : undefined
    const selectedVariant = pinnedVariant ?? visibleVariants[0]

    rows.push({
      anchorTrackId,
      title: selectedVariant.track.title,
      artist: selectedVariant.track.artist,
      album: selectedVariant.track.album,
      allVariants,
      visibleVariants,
      selectedVariant,
      variantPinned: !!pinnedVariant
    })
  }

  return rows
}

/** 筛选条要展示的音源清单：本地优先，其余按音源 id 字母序。 */
export function collectAggregateSources(
  tracks: Track[],
  hiddenSources: string[] = []
): AggregateSourceCount[] {
  const hidden = new Set(hiddenSources)
  const counts = new Map<string, number>()
  for (const track of tracks) {
    const source = getTrackSource(track)
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }
  // 被隐藏的音源在歌单里可能已经一首不剩，但仍要出现在筛选条上才能取消隐藏。
  for (const source of hidden) {
    if (!counts.has(source)) counts.set(source, 0)
  }
  return Array.from(counts.entries())
    .map(([source, count]) => ({ source, count, hidden: hidden.has(source) }))
    .sort((left, right) => {
      if (left.source === right.source) return 0
      if (left.source === 'local') return -1
      if (right.source === 'local') return 1
      return left.source.localeCompare(right.source, 'en')
    })
}

/** 可见行按当前选定音源展开的播放队列。 */
export function resolveAggregateQueue(rows: AggregateRow[]): Track[] {
  return rows.map((row) => row.selectedVariant.track)
}

/** 切换音源隐藏状态后的新 hiddenSources，顺序稳定以免持久化快照无意义地抖动。 */
export function toggleHiddenSource(hiddenSources: string[], source: string): string[] {
  return hiddenSources.includes(source)
    ? hiddenSources.filter((item) => item !== source)
    : [...hiddenSources, source]
}

function groupTracksByRecording(tracks: Track[]): SourceVariant[][] {
  const groups: SourceVariant[][] = []
  const groupsByKey = new Map<string, SourceVariant[][]>()

  for (const track of tracks) {
    const variant = toSourceVariant({ track })
    const key = getLogicalTrackKey(track)
    const candidates = groupsByKey.get(key)
    const existing = candidates?.find((group) =>
      group.every((member) => canShareTrackIdentity(member.track, track))
    )
    if (existing) {
      existing.push(variant)
      continue
    }
    const nextGroup = [variant]
    groups.push(nextGroup)
    if (candidates) candidates.push(nextGroup)
    else groupsByKey.set(key, [nextGroup])
  }

  return groups
}
