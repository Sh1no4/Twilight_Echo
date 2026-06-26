import type { Track } from '../types/music'

export interface LocalGridSearchItem {
  name: string
  path?: string
  artist?: string
  tracks?: Track[]
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function includesQuery(value: string | undefined | null, query: string): boolean {
  return typeof value === 'string' && normalizeSearchText(value).includes(query)
}

export function filterLocalGridItems<T extends LocalGridSearchItem>(
  items: T[],
  query: string
): T[] {
  const q = normalizeSearchText(query.trim())
  if (!q) return items

  return items.filter((item) => {
    if (
      includesQuery(item.name, q) ||
      includesQuery(item.path, q) ||
      includesQuery(item.artist, q)
    ) {
      return true
    }

    return item.tracks?.some(
      (track) =>
        includesQuery(track.title, q) ||
        includesQuery(track.artist, q) ||
        includesQuery(track.album, q) ||
        includesQuery(track.fileName, q) ||
        includesQuery(track.filePath, q)
    ) === true
  })
}
