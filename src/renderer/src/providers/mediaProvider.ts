import { toRaw } from 'vue'
import type { Track } from '../types/music'
import { unifiedSearchSongs, type UnifiedSearchResult } from '../utils/unifiedMusicSearch.ts'

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
  /** Optional word-level payload (e.g. NetEase YRC). Prefer for timed display when present. */
  wordLyrics?: string | null
}

export interface PlaybackUrlOptions {
  force?: boolean
  quality?: string
}

export interface MediaProviderSearchResult<T> {
  items: T[]
  total: number
}

export interface MediaProviderPlaylistSummary {
  id: number | string
  name: string
  cover: string | null
  /** Durable remote origin when `cover` is a session-scoped twilight-media grant. */
  coverSource?: string | null
  trackCount: number
}

export interface MediaProviderAlbumSummary {
  id: number | string
  name: string
  cover: string | null
  coverSource?: string | null
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

export interface MediaProviderHealth {
  providerId: string
  pluginId: string
  pluginStatus: string
  available: boolean
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  successRate: number
  methodStats?: Record<string, MediaProviderMethodHealth | undefined>
  lastError: string | null
  lastCheckedAt: string | null
}

export interface MediaProviderMethodHealth {
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  successRate: number
  lastError: string | null
  lastCheckedAt: string | null
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
  health?: MediaProviderHealth
  isEnabled?: () => boolean | Promise<boolean>
  getPlaybackUrl?: (track: Track, options?: PlaybackUrlOptions) => Promise<string | null>
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

  update(id: string, patch: Partial<MediaProvider>): boolean {
    const normalizedId = normalizeProviderId(id)
    const current = this.providers.get(normalizedId)
    if (!current) return false
    this.providers.set(normalizedId, {
      ...current,
      ...patch,
      id: normalizedId
    })
    return true
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

  async resolvePlaybackUrl(track: Track, options?: PlaybackUrlOptions): Promise<string | null> {
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

  async searchPlaylists(
    providerId: string,
    keywords: string,
    limit?: number,
    offset?: number
  ): Promise<MediaProviderSearchResult<MediaProviderPlaylistSummary>> {
    const provider = this.get(providerId)
    if (!provider?.searchPlaylists) return { items: [], total: 0 }
    await assertProviderEnabled(provider)
    return provider.searchPlaylists(keywords, limit, offset)
  }

  async searchArtists(
    providerId: string,
    keywords: string,
    limit?: number,
    offset?: number
  ): Promise<MediaProviderSearchResult<MediaProviderArtistSummary>> {
    const provider = this.get(providerId)
    if (!provider?.searchArtists) return { items: [], total: 0 }
    await assertProviderEnabled(provider)
    return provider.searchArtists(keywords, limit, offset)
  }

  async resolveLyrics(track: Track): Promise<MediaProviderLyrics> {
    return this.resolveLyricsAcrossProviders(track)
  }

  /**
   * Prefer the track's own provider, then fan out to other enabled lyric
   * providers (NCM first) using title+artist search for local/library tracks.
   * Never throws: each provider failure is swallowed so online fallback can run.
   */
  async resolveLyricsAcrossProviders(
    track: Track,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<MediaProviderLyrics> {
    const timeoutMs = options?.timeoutMs ?? 8_000
    const empty: MediaProviderLyrics = { lyrics: null, translatedLyrics: null, wordLyrics: null }

    const direct = this.getForTrack(track)
    if (direct?.getLyrics) {
      try {
        await assertProviderEnabled(direct)
        const lyrics = await withTimeout(direct.getLyrics(track), timeoutMs, options?.signal)
        if (hasAnyLyrics(lyrics)) return lyrics
      } catch {
        // continue fan-out
      }
    }

    // Local / unmatched tracks: try lyric-capable providers by title search.
    const query = [track.title, track.artist]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)
      .join(' ')
    if (!query) return empty

    const candidates = this.list()
      .filter((provider) => provider.getLyrics && provider.searchSongs)
      .filter((provider) => provider.id !== direct?.id)
      .sort((a, b) => providerLyricPriority(a.id) - providerLyricPriority(b.id))

    for (const provider of candidates.slice(0, 3)) {
      if (options?.signal?.aborted) break
      try {
        if (!(await isProviderAvailable(provider))) continue
        const search = await withTimeout(
          provider.searchSongs!(query, 5, 0),
          timeoutMs,
          options?.signal
        )
        const match = pickBestLyricSearchMatch(track, search.items)
        if (!match || !provider.getLyrics) continue
        const lyrics = await withTimeout(provider.getLyrics(match), timeoutMs, options?.signal)
        if (hasAnyLyrics(lyrics)) return lyrics
      } catch {
        // try next provider
      }
    }
    return empty
  }

  async searchAllSongs(options: {
    query: string
    localTracks: Track[]
    limit?: number
    offset?: number
  }): Promise<UnifiedSearchResult> {
    const providers = this.list()
    return unifiedSearchSongs({
      ...options,
      providers: await Promise.all(
        providers.map(async (provider) => ({
          id: provider.id,
          name: provider.name,
          capabilities: provider.capabilities,
          available: await isProviderAvailable(provider),
          health: provider.health
        }))
      ),
      searchProviderSongs: (providerId, keywords, limit, offset) =>
        this.searchSongs(providerId, keywords, limit, offset)
    })
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

async function isProviderAvailable(provider: MediaProvider): Promise<boolean> {
  if (!provider.isEnabled) return true
  try {
    return await provider.isEnabled()
  } catch {
    return false
  }
}

function providerLyricPriority(id: string): number {
  const normalized = normalizeProviderId(id)
  if (normalized === 'ncm') return 0
  if (normalized === 'bili') return 2
  return 1
}

function hasAnyLyrics(lyrics: MediaProviderLyrics | null | undefined): boolean {
  if (!lyrics) return false
  return Boolean(lyrics.lyrics || lyrics.translatedLyrics || lyrics.wordLyrics)
}

function normalizeMatchText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function pickBestLyricSearchMatch(local: Track, candidates: Track[]): Track | null {
  const localTitle = normalizeMatchText(local.title)
  const localArtist = normalizeMatchText(local.artist)
  if (!localTitle) return null
  let best: Track | null = null
  let bestScore = -1
  for (const candidate of candidates) {
    const title = normalizeMatchText(candidate.title)
    if (!title || title !== localTitle) continue
    const artist = normalizeMatchText(candidate.artist)
    let score = 10
    if (localArtist && artist) {
      if (artist === localArtist) score += 10
      else if (artist.includes(localArtist) || localArtist.includes(artist)) score += 4
      else continue
    }
    if (
      typeof local.duration === 'number' &&
      local.duration > 0 &&
      typeof candidate.duration === 'number' &&
      candidate.duration > 0
    ) {
      const delta = Math.abs(local.duration - candidate.duration)
      if (delta <= 3) score += 5
      else if (delta <= 8) score += 2
      else if (delta > 30) continue
    }
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return bestScore >= 10 ? best : null
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) throw new Error('Aborted')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Lyrics provider timed out')), timeoutMs)
  })
  const onAbort = (): void => {
    if (timer) clearTimeout(timer)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
