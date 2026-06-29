import { toRaw } from 'vue'
import type { Track } from '../types/music'

export type MediaProviderCapability =
  | 'search'
  | 'playbackUrl'
  | 'lyrics'
  | 'cover'
  | 'playlist'
  | 'library'
  | 'login'

export interface MediaProviderLyrics {
  lyrics: string | null
  translatedLyrics: string | null
}

export interface MediaProviderSearchResult<T> {
  items: T[]
  total: number
}

export interface MediaProviderPlaylistSummary {
  id: number | string
  name: string
  cover: string | null
  trackCount: number
}

export interface MediaProviderAlbumSummary {
  id: number | string
  name: string
  cover: string | null
  trackCount: number
  publishTime?: number
}

export interface MediaProviderArtistSummary {
  id: number | string
  name: string
  picUrl: string | null
  albumSize?: number
  musicSize?: number
}

export interface MediaProviderProfile {
  userId: number | string
  nickname: string
  avatarUrl: string
  signature?: string
  follows?: number
  followeds?: number
}

export interface MediaProviderQrLogin {
  key: string
  qrContent?: string
  imageDataUrl?: string
  expiresInSeconds?: number
}

export interface MediaProviderUserSummary {
  id: number | string
  name: string
  picUrl: string | null
  musicSize?: number
  userType?: number
  artistId?: number | string
  followed?: boolean
}

export interface MediaProvider {
  id: string
  name: string
  source: 'internal' | 'plugin'
  capabilities: MediaProviderCapability[]
  isEnabled?: () => boolean | Promise<boolean>
  getPlaybackUrl?: (track: Track, options?: { force?: boolean }) => Promise<string | null>
  getLyrics?: (track: Track) => Promise<MediaProviderLyrics>
  searchSongs?: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<MediaProviderSearchResult<Track>>
  searchPlaylists?: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<MediaProviderSearchResult<MediaProviderPlaylistSummary>>
  searchArtists?: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<MediaProviderSearchResult<MediaProviderArtistSummary>>
  fetchPlaylistTracks?: (playlistId: number | string, force?: boolean) => Promise<Track[]>
  checkLogin?: () => Promise<{ loggedIn: boolean; profile: MediaProviderProfile | null }>
  getProfile?: () => Promise<MediaProviderProfile | null>
  logout?: () => Promise<void>
  getQrLogin?: () => Promise<MediaProviderQrLogin | null>
  getQrKey?: () => Promise<string | null>
  getQrImage?: (key: string) => Promise<string | null>
  checkQrLogin?: (key: string) => Promise<{ code: number }>
  fetchUserLibrary?: (force?: boolean) => Promise<{
    likedPlaylist: MediaProviderPlaylistSummary | null
    playlists: MediaProviderPlaylistSummary[]
  }>
  fetchLikedTracks?: (force?: boolean) => Promise<Track[]>
  fetchRecommendSongs?: () => Promise<Track[]>
  fetchRecommendPlaylists?: () => Promise<MediaProviderPlaylistSummary[]>
  fetchPersonalFm?: () => Promise<Track[]>
  fetchPrivateContent?: () => Promise<Track[]>
  fetchArtistTopSongs?: (artistId: number | string) => Promise<Track[]>
  fetchArtistAlbums?: (artistId: number | string) => Promise<MediaProviderAlbumSummary[]>
  fetchArtistIntro?: (artistId: number | string) => Promise<string>
  fetchArtistFollowState?: (artistId: number | string) => Promise<boolean | null>
  fetchAlbumTracks?: (albumId: number | string) => Promise<Track[]>
  fetchArtistPlaylists?: (artistId: number | string) => Promise<MediaProviderPlaylistSummary[]>
  fetchUserPlaylistsByUid?: (
    uid: number | string,
    createdOnly?: boolean
  ) => Promise<MediaProviderPlaylistSummary[]>
  fetchUserFollows?: (
    uid: number | string,
    limit?: number,
    offset?: number
  ) => Promise<MediaProviderUserSummary[]>
  fetchUserFolloweds?: (
    uid: number | string,
    limit?: number,
    offset?: number
  ) => Promise<MediaProviderUserSummary[]>
  fetchPlayRecords?: (type?: number) => Promise<Track[]>
  fetchRecentSongs?: (limit?: number) => Promise<Track[]>
  followArtist?: (artistId: number | string, follow: boolean) => Promise<void>
  followUser?: (userId: number | string, follow: boolean) => Promise<void>
  likeTrack?: (trackId: number | string, like: boolean) => Promise<void>
  isTrackLiked?: (trackId: number | string | undefined) => boolean | Promise<boolean>
}

export class MediaProviderRegistry {
  private providers = new Map<string, MediaProvider>()

  register(provider: MediaProvider): void {
    const id = normalizeProviderId(provider.id)
    if (!id) throw new Error('MediaProvider id is required')
    if (this.providers.has(id)) throw new Error(`MediaProvider already registered: ${id}`)
    this.providers.set(id, { ...provider, id })
  }

  unregister(id: string): void {
    this.providers.delete(normalizeProviderId(id))
  }

  unregisterWhere(predicate: (provider: MediaProvider) => boolean): void {
    for (const provider of this.providers.values()) {
      if (predicate(provider)) {
        this.providers.delete(provider.id)
      }
    }
  }

  list(): MediaProvider[] {
    return [...this.providers.values()]
  }

  get(id: string): MediaProvider | null {
    return this.providers.get(normalizeProviderId(id)) ?? null
  }

  getForTrack(track: Track): MediaProvider | null {
    const providerId = getTrackProviderId(track)
    return providerId ? this.get(providerId) : null
  }

  async resolvePlaybackUrl(track: Track, options?: { force?: boolean }): Promise<string | null> {
    const provider = this.getForTrack(track)
    if (!provider?.getPlaybackUrl) return null
    await assertProviderEnabled(provider)
    return provider.getPlaybackUrl(track, options)
  }

  async searchSongs(
    providerId: string,
    keywords: string,
    limit?: number,
    offset?: number
  ): Promise<MediaProviderSearchResult<Track>> {
    const provider = this.get(providerId)
    if (!provider?.searchSongs) return { items: [], total: 0 }
    await assertProviderEnabled(provider)
    return provider.searchSongs(keywords, limit, offset)
  }

  async resolveLyrics(track: Track): Promise<MediaProviderLyrics> {
    const provider = this.getForTrack(track)
    if (!provider?.getLyrics) return { lyrics: null, translatedLyrics: null }
    await assertProviderEnabled(provider)
    return provider.getLyrics(track)
  }
}

export function getTrackProviderId(track: Pick<Track, 'id' | 'source'>): string | null {
  if (track.source) return normalizeProviderId(track.source)
  if (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)) return null
  const separatorIndex = track.id.indexOf(':')
  if (separatorIndex <= 0) return null
  return normalizeProviderId(track.id.slice(0, separatorIndex))
}

export function getProviderLocalId(trackId: string, providerId: string): string | null {
  const prefix = `${normalizeProviderId(providerId)}:`
  return trackId.startsWith(prefix) ? trackId.slice(prefix.length) : null
}

export function toProviderIpcArgs(args: unknown[]): unknown[] {
  return args.map((arg) => toProviderIpcValue(arg))
}

function toProviderIpcValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value

  const raw = toRaw(value) as object
  if (seen.has(raw)) return null
  seen.add(raw)

  if (Array.isArray(raw)) {
    return raw.map((item) => toProviderIpcValue(item, seen))
  }

  const output: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(raw)) {
    if (typeof nestedValue === 'function' || typeof nestedValue === 'symbol') continue
    output[key] = toProviderIpcValue(nestedValue, seen)
  }
  return output
}

function normalizeProviderId(id: string): string {
  return id.trim().toLowerCase()
}

async function assertProviderEnabled(provider: MediaProvider): Promise<void> {
  if (!provider.isEnabled) return
  if (!(await provider.isEnabled())) {
    throw new Error(`${provider.name} provider is disabled or not logged in`)
  }
}
