import { ref, type Ref } from 'vue'
import type { Track } from '../types/music'

export interface NcmProfile {
  userId: number
  nickname: string
  avatarUrl: string
  signature: string
  follows: number
  followeds: number
}

export interface NcmPlaylistSummary {
  id: number
  name: string
  cover: string | null
  trackCount: number
}

export interface NcmArtistSummary {
  id: number
  name: string
  picUrl: string | null
  albumSize: number
  musicSize: number
}

export interface NcmUserSummary {
  id: number
  name: string
  picUrl: string | null
  musicSize: number
  userType: number
}

const isLoggedIn = ref(false)
const profile = ref<NcmProfile | null>(null)
const libraryLoading = ref(false)
const libraryLoaded = ref(false)
const libraryError = ref('')
const likedPlaylist = ref<NcmPlaylistSummary | null>(null)
const userPlaylists = ref<NcmPlaylistSummary[]>([])
const likedSongIds = ref<Set<number>>(new Set())

const playlistTrackCache = new Map<string, Track[]>()
const streamUrlCache = new Map<number, string | null>()
let likedTracksCache: Track[] | null = null

export interface NcmStore {
  isLoggedIn: Ref<boolean>
  profile: Ref<NcmProfile | null>
  libraryLoading: Ref<boolean>
  libraryLoaded: Ref<boolean>
  libraryError: Ref<string>
  likedPlaylist: Ref<NcmPlaylistSummary | null>
  userPlaylists: Ref<NcmPlaylistSummary[]>
  likedSongIds: Ref<Set<number>>
  buildProfile: (prof: {
    userId: number
    nickname: string
    avatarUrl: string
    signature?: string
    follows?: number
    followeds?: number
  }) => Promise<NcmProfile>
  checkLogin: () => Promise<boolean>
  setLogin: (prof: NcmProfile) => void
  logout: () => Promise<void>
  fetchUserLibrary: (force?: boolean) => Promise<{
    likedPlaylist: NcmPlaylistSummary | null
    playlists: NcmPlaylistSummary[]
  }>
  fetchPlaylistTracks: (playlistId: number | string, force?: boolean) => Promise<Track[]>
  fetchLikedTracks: (force?: boolean) => Promise<Track[]>
  getSongStreamUrl: (songId: number, force?: boolean) => Promise<string | null>
  fetchRecommendSongs: () => Promise<Track[]>
  fetchRecommendPlaylists: () => Promise<NcmPlaylistSummary[]>
  fetchPersonalFm: () => Promise<Track[]>
  fetchPrivateContent: () => Promise<Track[]>
  fetchLyric: (songId: number) => Promise<string | null>
  searchSongs: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ tracks: Track[]; total: number }>
  searchPlaylists: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ playlists: NcmPlaylistSummary[]; total: number }>
  searchArtists: (
    keywords: string,
    limit?: number,
    offset?: number
  ) => Promise<{ artists: NcmArtistSummary[]; total: number }>
  fetchArtistTopSongs: (artistId: number) => Promise<Track[]>
  fetchArtistPlaylists: (artistId: number) => Promise<NcmPlaylistSummary[]>
  fetchUserPlaylistsByUid: (uid: number) => Promise<NcmPlaylistSummary[]>
  fetchUserFollows: (uid: number, limit?: number, offset?: number) => Promise<NcmUserSummary[]>
  fetchUserFolloweds: (uid: number, limit?: number, offset?: number) => Promise<NcmUserSummary[]>
  likeTrack: (songId: number, like: boolean) => Promise<void>
  isTrackLiked: (ncmSongId: number | undefined) => boolean
  syncLikedIds: (tracks: Track[]) => void
}

function withPcUa(path: string): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}ua=pc`
}

function resetLibraryState(): void {
  libraryLoading.value = false
  libraryLoaded.value = false
  libraryError.value = ''
  likedPlaylist.value = null
  userPlaylists.value = []
  playlistTrackCache.clear()
  streamUrlCache.clear()
  likedTracksCache = null
  likedSongIds.value = new Set()
}

function formatDuration(rawDuration: unknown): number {
  if (typeof rawDuration !== 'number' || !isFinite(rawDuration) || rawDuration <= 0) return 0
  return rawDuration > 1000 ? Math.round(rawDuration / 1000) : Math.round(rawDuration)
}

function normalizeNcmFormat(rawFormat: unknown): string | undefined {
  if (typeof rawFormat !== 'string' || !rawFormat.trim()) return undefined
  const format = rawFormat.trim().toLowerCase()
  if (format === 'mp4') return 'm4a'
  return format
}

function getSongAudioMeta(song: Record<string, any>): {
  format?: string
  bitrate?: number
  sampleRate?: number
  size?: number
} {
  const candidates = [song.sq, song.hr, song.h, song.m, song.l, song.mainSong?.sq, song.mainSong?.h].filter(
    Boolean
  ) as Record<string, any>[]
  const source = candidates.find((item) => item.br || item.bitrate || item.sr || item.size) ?? {}
  const bitrate = Number(source.br ?? source.bitrate ?? song.br ?? song.bitrate)
  const sampleRate = Number(source.sr ?? source.sampleRate ?? song.sr ?? song.sampleRate)
  const size = Number(source.size ?? song.size)
  const format =
    normalizeNcmFormat(source.type ?? source.encodeType ?? source.format ?? song.type ?? song.encodeType) ??
    undefined

  return {
    format,
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : undefined,
    sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : undefined,
    size: Number.isFinite(size) && size > 0 ? size : undefined
  }
}

function normalizeTrack(song: Record<string, any>): Track {
  const songId = Number(song.id)
  const artists = Array.isArray(song.ar)
    ? song.ar.map((artist) => artist?.name).filter(Boolean)
    : []
  const artist =
    artists.join(' / ') ||
    song.artist ||
    song.artists
      ?.map?.((item) => item?.name)
      .filter(Boolean)
      .join(' / ') ||
    '未知艺术家'
  const title = song.name || song.title || '未知歌曲'
  const album = song.al?.name || song.album?.name || '未知专辑'
  const cover = song.al?.picUrl || song.album?.picUrl || song.picUrl || song.coverImgUrl || null
  const audioMeta = getSongAudioMeta(song)

  return {
    id: `ncm:${songId}`,
    title,
    artist,
    album,
    filePath: `ncm:${songId}`,
    fileName: `${artist} - ${title}`,
    duration: formatDuration(song.dt ?? song.duration),
    size: audioMeta.size ?? 0,
    cover,
    lyrics: null,
    source: 'ncm',
    ncmSongId: songId,
    streamUrl: null,
    format: audioMeta.format,
    sampleRate: audioMeta.sampleRate,
    bitrate: audioMeta.bitrate
  }
}

function rememberStreamAudioMeta(songId: number, item: Record<string, any>): void {
  const format = normalizeNcmFormat(item.type ?? item.encodeType ?? item.format)
  const bitrate = Number(item.br ?? item.bitrate)
  const sampleRate = Number(item.sr ?? item.sampleRate)
  const size = Number(item.size)
  for (const tracks of playlistTrackCache.values()) {
    const track = tracks.find((candidate) => candidate.ncmSongId === songId)
    if (!track) continue
    if (format) track.format = format
    if (Number.isFinite(bitrate) && bitrate > 0) track.bitrate = bitrate
    if (Number.isFinite(sampleRate) && sampleRate > 0) track.sampleRate = sampleRate
    if (Number.isFinite(size) && size > 0) track.size = size
  }
  if (likedTracksCache) {
    const track = likedTracksCache.find((candidate) => candidate.ncmSongId === songId)
    if (track) {
      if (format) track.format = format
      if (Number.isFinite(bitrate) && bitrate > 0) track.bitrate = bitrate
      if (Number.isFinite(sampleRate) && sampleRate > 0) track.sampleRate = sampleRate
      if (Number.isFinite(size) && size > 0) track.size = size
    }
  }
}

function normalizePlaylist(playlist: Record<string, any>): NcmPlaylistSummary {
  return {
    id: Number(playlist.id),
    name: playlist.name || '未命名歌单',
    cover: playlist.coverImgUrl || playlist.picUrl || null,
    trackCount: typeof playlist.trackCount === 'number' ? playlist.trackCount : 0
  }
}

function getPlaylistItems(data: Record<string, any>): Record<string, any>[] {
  if (Array.isArray(data.playlist)) return data.playlist
  if (Array.isArray(data.data?.playlist)) return data.data.playlist
  return []
}

function getSongItems(data: Record<string, any>): Record<string, any>[] {
  if (Array.isArray(data.songs)) return data.songs
  if (Array.isArray(data.data?.songs)) return data.data.songs
  if (Array.isArray(data.playlist?.tracks)) return data.playlist.tracks
  if (Array.isArray(data.playlist?.songs)) return data.playlist.songs
  if (Array.isArray(data.data?.playlist?.tracks)) return data.data.playlist.tracks
  if (Array.isArray(data.data)) return data.data
  return []
}

function getLikelistIds(data: Record<string, any>): number[] {
  const rawIds = Array.isArray(data.ids)
    ? data.ids
    : Array.isArray(data.data?.ids)
      ? data.data.ids
      : []

  return rawIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
}

function getPlaylistTrackIds(data: Record<string, any>): number[] {
  const rawTrackIds = Array.isArray(data.playlist?.trackIds)
    ? data.playlist.trackIds
    : Array.isArray(data.data?.playlist?.trackIds)
      ? data.data.playlist.trackIds
      : []

  return rawTrackIds
    .map((item) => Number(item?.id ?? item))
    .filter((id) => Number.isFinite(id) && id > 0)
}

function isLikedPlaylistItem(item: Record<string, any>): boolean {
  return item.specialType === 5 || item.specialType === '5' || item.name === '喜欢的音乐'
}

async function requestAuthed(path: string): Promise<Record<string, any>> {
  const cookie = await window.api.data.loadCookie()
  if (!cookie) {
    throw new Error('请先登录网易云音乐')
  }

  return (await window.api.ncm.request(withPcUa(path), cookie)) as Record<string, any>
}

async function ensureProfile(checkLogin: () => Promise<boolean>): Promise<NcmProfile> {
  if (profile.value) return profile.value
  const ok = await checkLogin()
  if (!ok || !profile.value) {
    throw new Error('请先登录网易云音乐')
  }
  return profile.value
}

async function fetchUserDetailInfo(
  userId: number
): Promise<{ signature: string; follows: number; followeds: number }> {
  try {
    const data = await requestAuthed(`/user/detail?uid=${userId}`)
    return {
      signature:
        data.profile?.signature || data.userPoint?.signature || data.data?.profile?.signature || '',
      follows: data.profile?.follows || 0,
      followeds: data.profile?.followeds || 0
    }
  } catch {
    return { signature: '', follows: 0, followeds: 0 }
  }
}

export function useNcmStore(): NcmStore {
  async function buildProfile(prof: {
    userId: number
    nickname: string
    avatarUrl: string
    signature?: string
    follows?: number
    followeds?: number
  }): Promise<NcmProfile> {
    const detail =
      prof.signature === undefined || prof.follows === undefined
        ? await fetchUserDetailInfo(prof.userId)
        : null

    return {
      userId: prof.userId,
      nickname: prof.nickname,
      avatarUrl: prof.avatarUrl,
      signature: prof.signature ?? detail?.signature ?? '',
      follows: prof.follows ?? detail?.follows ?? 0,
      followeds: prof.followeds ?? detail?.followeds ?? 0
    }
  }

  async function checkLogin(): Promise<boolean> {
    try {
      const cookie = await window.api.data.loadCookie()
      if (!cookie) {
        isLoggedIn.value = false
        profile.value = null
        resetLibraryState()
        return false
      }
      const data = (await window.api.ncm.request(
        `/login/status?timestamp=${Date.now()}`,
        cookie
      )) as Record<string, any>
      const profileData = data.data?.profile || data.profile
      if ((data.data?.code === 200 || data.code === 200) && profileData) {
        const nextProfile = await buildProfile({
          userId: profileData.userId,
          nickname: profileData.nickname,
          avatarUrl: profileData.avatarUrl,
          signature: profileData.signature
        })
        if (profile.value?.userId !== nextProfile.userId) {
          resetLibraryState()
        }
        isLoggedIn.value = true
        profile.value = nextProfile
        return true
      }
      isLoggedIn.value = false
      profile.value = null
      resetLibraryState()
      return false
    } catch {
      isLoggedIn.value = false
      profile.value = null
      resetLibraryState()
      return false
    }
  }

  function setLogin(prof: NcmProfile): void {
    if (profile.value?.userId !== prof.userId) {
      resetLibraryState()
    }
    isLoggedIn.value = true
    profile.value = prof
  }

  async function logout(): Promise<void> {
    await window.api.data.saveCookie('')
    isLoggedIn.value = false
    profile.value = null
    resetLibraryState()
  }

  async function fetchUserLibrary(force = false): Promise<{
    likedPlaylist: NcmPlaylistSummary | null
    playlists: NcmPlaylistSummary[]
  }> {
    if (libraryLoaded.value && !force) {
      return {
        likedPlaylist: likedPlaylist.value,
        playlists: userPlaylists.value
      }
    }

    if (force) {
      playlistTrackCache.clear()
      likedTracksCache = null
    }

    const currentProfile = await ensureProfile(checkLogin)
    libraryLoading.value = true
    libraryError.value = ''

    try {
      const data = await requestAuthed(`/user/playlist?uid=${currentProfile.userId}&limit=1000`)
      const items = getPlaylistItems(data)
      const likedItem = items.find(isLikedPlaylistItem) ?? null

      likedPlaylist.value = likedItem ? normalizePlaylist(likedItem) : null
      userPlaylists.value = items
        .filter((item) => Number(item.id) !== Number(likedItem?.id))
        .map(normalizePlaylist)

      libraryLoaded.value = true

      return {
        likedPlaylist: likedPlaylist.value,
        playlists: userPlaylists.value
      }
    } catch (error) {
      libraryError.value = error instanceof Error ? error.message : '加载网易云音乐库失败'
      throw error
    } finally {
      libraryLoading.value = false
    }
  }

  async function fetchPlaylistTracks(playlistId: number | string, force = false): Promise<Track[]> {
    const cacheKey = String(playlistId)
    if (!force && playlistTrackCache.has(cacheKey)) {
      return playlistTrackCache.get(cacheKey) ?? []
    }

    const trackAllData = await requestAuthed(
      `/playlist/track/all?id=${encodeURIComponent(String(playlistId))}`
    )
    let songs = getSongItems(trackAllData)

    let playlistDetailData: Record<string, any> | null = null
    if (songs.length === 0) {
      playlistDetailData = await requestAuthed(
        `/playlist/detail?id=${encodeURIComponent(String(playlistId))}`
      )
      songs = getSongItems(playlistDetailData)
    }

    if (songs.length === 0) {
      const detailSource = playlistDetailData ?? trackAllData
      const ids = getPlaylistTrackIds(detailSource)
      if (ids.length > 0) {
        const detailSongs: Record<string, any>[] = []
        const chunkSize = 200
        for (let index = 0; index < ids.length; index += chunkSize) {
          const chunk = ids.slice(index, index + chunkSize)
          const detail = await requestAuthed(`/song/detail?ids=${chunk.join(',')}`)
          detailSongs.push(...getSongItems(detail))
        }
        songs = detailSongs
      }
    }

    const tracks = songs.map(normalizeTrack)
    playlistTrackCache.set(cacheKey, tracks)
    return tracks
  }

  async function fetchLikedTracks(force = false): Promise<Track[]> {
    if (!force && likedTracksCache) {
      return likedTracksCache
    }

    const library = await fetchUserLibrary(force)
    if (library.likedPlaylist) {
      const tracks = await fetchPlaylistTracks(library.likedPlaylist.id, force)
      if (tracks.length > 0) {
        likedTracksCache = tracks
        return tracks
      }
    }

    const currentProfile = await ensureProfile(checkLogin)
    const data = await requestAuthed(`/likelist?uid=${currentProfile.userId}`)
    const ids = getLikelistIds(data)

    if (ids.length === 0) {
      likedTracksCache = []
      return []
    }

    const songs: Record<string, any>[] = []
    const chunkSize = 200

    for (let index = 0; index < ids.length; index += chunkSize) {
      const chunk = ids.slice(index, index + chunkSize)
      const detail = await requestAuthed(`/song/detail?ids=${chunk.join(',')}`)
      songs.push(...getSongItems(detail))
    }

    const normalized = songs.map(normalizeTrack)
    const trackBySongId = new Map<number, Track>()
    for (const track of normalized) {
      if (track.ncmSongId) {
        trackBySongId.set(track.ncmSongId, track)
      }
    }

    likedTracksCache = ids
      .map((id) => trackBySongId.get(id))
      .filter((track): track is Track => !!track)

    if (likedTracksCache.length === 0) {
      likedTracksCache = normalized
    }

    return likedTracksCache
  }

  async function getSongStreamUrl(songId: number, force = false): Promise<string | null> {
    if (!force) {
      try {
        const cached = await window.api.ncm.getCachedSong(songId)
        if (cached) {
          streamUrlCache.set(songId, cached)
          return cached
        }
      } catch {
        /* cache miss falls through to online url */
      }
    }

    if (!force && streamUrlCache.has(songId)) {
      return streamUrlCache.get(songId) ?? null
    }

    const data = await requestAuthed(`/song/url/v1?id=${songId}&level=exhigh`)
    const streamItems = Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.urls)
        ? data.urls
        : []
    const streamItem = (streamItems[0] ?? {}) as Record<string, any>
    const url = typeof streamItem.url === 'string' ? streamItem.url : null
    rememberStreamAudioMeta(songId, streamItem)
    streamUrlCache.set(songId, url)
    if (url) {
      void window.api.ncm
        .cacheSong(songId, url)
        .then((cached) => {
          if (cached && streamUrlCache.get(songId) === url) {
            streamUrlCache.set(songId, cached)
          }
        })
        .catch(() => {})
    }
    return url
  }

  async function fetchRecommendSongs(): Promise<Track[]> {
    const data = await requestAuthed(`/recommend/songs`)
    const dailySongs = Array.isArray(data.data?.dailySongs)
      ? data.data.dailySongs
      : Array.isArray(data.dailySongs)
        ? data.dailySongs
        : []
    if (dailySongs.length > 0) return dailySongs.map(normalizeTrack)
    // fallback to generic parsing
    return getSongItems(data).map(normalizeTrack)
  }

  async function fetchPersonalFm(): Promise<Track[]> {
    const data = await requestAuthed(`/personal_fm`)
    const fmData = Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.result)
        ? data.result
        : []
    if (fmData.length > 0) return fmData.map(normalizeTrack)
    return getSongItems(data).map(normalizeTrack)
  }

  async function fetchPrivateContent(): Promise<Track[]> {
    const data = await requestAuthed(`/personalized/privatecontent`)
    const result = Array.isArray(data.result)
      ? data.result
      : Array.isArray(data.data)
        ? data.data
        : []
    if (result.length > 0) return result.map(normalizeTrack)
    return getSongItems(data).map(normalizeTrack)
  }

  async function fetchRecommendPlaylists(): Promise<NcmPlaylistSummary[]> {
    try {
      const data = await requestAuthed(`/recommend/resource`)
      const recommend = Array.isArray(data.recommend)
        ? data.recommend
        : Array.isArray(data.data)
          ? data.data
          : []
      return recommend.map((item: any) => ({
        id: Number(item.id),
        name: item.name || '未命名歌单',
        cover: item.picUrl || item.coverImgUrl || null,
        trackCount: item.trackCount || 0
      }))
    } catch {
      return []
    }
  }

  async function fetchLyric(songId: number): Promise<string | null> {
    try {
      const data = await requestAuthed(`/lyric/new?id=${songId}`)
      const lrc = data.lrc?.lyric || data.data?.lrc?.lyric || ''
      if (lrc) return lrc
      const data2 = await requestAuthed(`/lyric?id=${songId}`)
      return data2.lrc?.lyric || data2.data?.lrc?.lyric || null
    } catch {
      return null
    }
  }

  async function searchSongs(
    keywords: string,
    limit = 30,
    offset = 0
  ): Promise<{ tracks: Track[]; total: number }> {
    const data = await requestAuthed(
      `/cloudsearch?keywords=${encodeURIComponent(keywords)}&type=1&limit=${limit}&offset=${offset}`
    )
    const result = data.result || data.data?.result || {}
    const songs: Record<string, any>[] = Array.isArray(result.songs) ? result.songs : []
    const total = typeof result.songCount === 'number' ? result.songCount : songs.length
    return { tracks: songs.map(normalizeTrack), total }
  }

  async function searchPlaylists(
    keywords: string,
    limit = 30,
    offset = 0
  ): Promise<{ playlists: NcmPlaylistSummary[]; total: number }> {
    const data = await requestAuthed(
      `/cloudsearch?keywords=${encodeURIComponent(keywords)}&type=1000&limit=${limit}&offset=${offset}`
    )
    const result = data.result || data.data?.result || {}
    const playlists: Record<string, any>[] = Array.isArray(result.playlists) ? result.playlists : []
    const total = typeof result.playlistCount === 'number' ? result.playlistCount : playlists.length
    return { playlists: playlists.map(normalizePlaylist), total }
  }

  async function searchArtists(
    keywords: string,
    limit = 30,
    offset = 0
  ): Promise<{ artists: NcmArtistSummary[]; total: number }> {
    const data = await requestAuthed(
      `/cloudsearch?keywords=${encodeURIComponent(keywords)}&type=100&limit=${limit}&offset=${offset}`
    )
    const result = data.result || data.data?.result || {}
    const artists: Record<string, any>[] = Array.isArray(result.artists) ? result.artists : []
    const total = typeof result.artistCount === 'number' ? result.artistCount : artists.length
    return {
      artists: artists.map((item) => ({
        id: Number(item.id),
        name: item.name || '未知歌手',
        picUrl: item.picUrl || item.img1v1Url || null,
        albumSize: item.albumSize || 0,
        musicSize: item.musicSize || 0
      })),
      total
    }
  }

  async function fetchArtistTopSongs(artistId: number): Promise<Track[]> {
    try {
      const data = await requestAuthed(`/artist/top/song?id=${artistId}`)
      if (data.songs && Array.isArray(data.songs) && data.songs.length > 0) {
        return data.songs.map(normalizeTrack)
      }
    } catch {
      // fallback
    }
    const data = await requestAuthed(`/artists?id=${artistId}`)
    const hotSongs = Array.isArray(data.hotSongs) ? data.hotSongs : []
    return hotSongs.map(normalizeTrack)
  }

  async function fetchArtistPlaylists(artistId: number): Promise<NcmPlaylistSummary[]> {
    const candidateUserIds = new Set<number>()

    try {
      const detail = await requestAuthed(`/artist/detail?id=${artistId}`)
      const ids = [
        detail.data?.artist?.accountId,
        detail.data?.artist?.userId,
        detail.data?.user?.userId,
        detail.artist?.accountId,
        detail.artist?.userId,
        detail.user?.userId
      ]
      for (const id of ids) {
        const normalized = Number(id)
        if (Number.isFinite(normalized) && normalized > 0) candidateUserIds.add(normalized)
      }
    } catch {
      // Some artists do not expose a linked user account.
    }

    for (const uid of candidateUserIds) {
      try {
        const playlists = await fetchUserPlaylistsByUid(uid)
        if (playlists.length > 0) return playlists
      } catch {
        // Try the next candidate account id.
      }
    }

    return []
  }

  async function fetchUserPlaylistsByUid(uid: number): Promise<NcmPlaylistSummary[]> {
    const data = await requestAuthed(`/user/playlist?uid=${uid}&limit=1000`)
    const playlists = Array.isArray(data.playlist) ? data.playlist : []
    return playlists.map(normalizePlaylist)
  }

  async function fetchUserFollows(uid: number, limit = 30, offset = 0): Promise<NcmUserSummary[]> {
    const data = await requestAuthed(`/user/follows?uid=${uid}&limit=${limit}&offset=${offset}`)
    const follows = Array.isArray(data.follow) ? data.follow : []
    return follows.map((item) => ({
      id: Number(item.userId),
      name: item.nickname || '未知用户',
      picUrl: item.avatarUrl || null,
      musicSize: item.playlistCount || 0,
      userType: item.userType || 0
    }))
  }

  async function fetchUserFolloweds(
    uid: number,
    limit = 30,
    offset = 0
  ): Promise<NcmUserSummary[]> {
    const data = await requestAuthed(`/user/followeds?uid=${uid}&limit=${limit}&offset=${offset}`)
    const followeds = Array.isArray(data.followeds) ? data.followeds : []
    return followeds.map((item) => ({
      id: Number(item.userId),
      name: item.nickname || '未知用户',
      picUrl: item.avatarUrl || null,
      musicSize: item.playlistCount || 0,
      userType: item.userType || 0
    }))
  }

  async function likeTrack(songId: number, like: boolean): Promise<void> {
    await requestAuthed(`/like?id=${songId}&like=${String(like)}`)
    if (like) {
      likedSongIds.value = new Set([...likedSongIds.value, songId])
    } else {
      const next = new Set(likedSongIds.value)
      next.delete(songId)
      likedSongIds.value = next
    }
  }

  function isTrackLiked(ncmSongId: number | undefined): boolean {
    if (ncmSongId == null) return false
    return likedSongIds.value.has(ncmSongId)
  }

  function syncLikedIds(tracks: Track[]): void {
    const ids = new Set<number>()
    for (const t of tracks) {
      if (t.ncmSongId != null) ids.add(t.ncmSongId)
    }
    likedSongIds.value = ids
  }

  return {
    isLoggedIn,
    profile,
    libraryLoading,
    libraryLoaded,
    libraryError,
    likedPlaylist,
    userPlaylists,
    likedSongIds,
    buildProfile,
    checkLogin,
    setLogin,
    logout,
    fetchUserLibrary,
    fetchPlaylistTracks,
    fetchLikedTracks,
    getSongStreamUrl,
    fetchRecommendSongs,
    fetchRecommendPlaylists,
    fetchPersonalFm,
    fetchPrivateContent,
    fetchLyric,
    searchSongs,
    searchPlaylists,
    searchArtists,
    fetchArtistTopSongs,
    fetchArtistPlaylists,
    fetchUserPlaylistsByUid,
    fetchUserFollows,
    fetchUserFolloweds,
    likeTrack,
    isTrackLiked,
    syncLikedIds
  }
}
