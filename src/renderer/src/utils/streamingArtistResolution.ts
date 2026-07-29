export interface StreamingArtistCandidate {
  id: number | string
  name: string
  picUrl: string | null
}

export interface StreamingLinkedUser {
  name: string
}

export interface StreamingArtistNavigationRequest {
  key: number
  providerId: string
  artistName: string
}

export function getPrimaryStreamingArtistName(value: string): string {
  const normalized = value.trim()
  if (!normalized) return ''
  return normalized.split(/\s+\/\s+/, 1)[0]?.trim() ?? normalized
}

export function normalizeStreamingArtistName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

export function findBestStreamingArtistMatch<T extends StreamingArtistCandidate>(
  keyword: string,
  artists: T[]
): T | null {
  if (artists.length === 0) return null
  const normalizedKeyword = normalizeStreamingArtistName(keyword)
  return (
    artists.find((artist) => normalizeStreamingArtistName(artist.name) === normalizedKeyword) ??
    null
  )
}

export async function resolveLinkedStreamingArtist<
  T extends StreamingArtistCandidate,
  U extends StreamingLinkedUser
>(
  initialArtist: T,
  linkedUser: U | undefined,
  findArtistByUserName: (user: U) => Promise<T | null>
): Promise<T> {
  if (!linkedUser) return initialArtist
  const matchedArtist = await findArtistByUserName(linkedUser).catch(() => null)
  if (!matchedArtist) return initialArtist
  return {
    ...matchedArtist,
    picUrl: matchedArtist.picUrl ?? initialArtist.picUrl
  }
}
