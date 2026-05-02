import { ref } from 'vue'
import type { Track } from '../types/music'

export interface NcmProfile {
  userId: number
  nickname: string
  avatarUrl: string
  signature: string
}

export interface NcmPlaylistSummary {
  id: number
  name: string
  cover: string | null
  trackCount: number
}

const isLoggedIn = ref(false)
const profile = ref<NcmProfile | null>(null)
const libraryLoading = ref(false)
const libraryLoaded = ref(false)
const libraryError = ref('')
const likedPlaylist = ref<NcmPlaylistSummary | null>(null)
const userPlaylists = ref<NcmPlaylistSummary[]>([])

const playlistTrackCache = new Map<string, Track[]>()
const streamUrlCache = new Map<number, string | null>()
let likedTracksCache: Track[] | null = null

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
}

function formatDuration(rawDuration: unknown): number {
  if (typeof rawDuration !== 'number' || !isFinite(rawDuration) || rawDuration <= 0) return 0
  return rawDuration > 1000 ? Math.round(rawDuration / 1000) : Math.round(rawDuration)
}

function normalizeTrack(song: Record<string, any>): Track {
  const songId = Number(song.id)
  const artists = Array.isArray(song.ar)
    ? song.ar.map((artist) => artist?.name).filter(Boolean)
    : []
  const artist =
    artists.join(' / ') ||
    song.artist ||
    song.artists?.map?.((item) => item?.name).filter(Boolean).join(' / ') ||
    '未知艺术家'
  const title = song.name || song.title || '未知歌曲'
  const album = song.al?.name || song.album?.name || '未知专辑'
  const cover = song.al?.picUrl || song.album?.picUrl || song.picUrl || song.coverImgUrl || null

  return {
    id: `ncm:${songId}`,
    title,
    artist,
    album,
    filePath: `ncm:${songId}`,
    fileName: `${artist} - ${title}`,
    duration: formatDuration(song.dt ?? song.duration),
    size: 0,
    cover,
    lyrics: null,
    source: 'ncm',
    ncmSongId: songId,
    streamUrl: null
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

  return rawIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
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

async function fetchUserSignature(userId: number): Promise<string> {
  try {
    const data = await requestAuthed(`/user/detail?uid=${userId}`)
    return data.profile?.signature || data.userPoint?.signature || data.data?.profile?.signature || ''
  } catch {
    return ''
  }
}

export function useNcmStore() {
  async function buildProfile(prof: { userId: number; nickname: string; avatarUrl: string; signature?: string }): Promise<NcmProfile> {
    return {
      userId: prof.userId,
      nickname: prof.nickname,
      avatarUrl: prof.avatarUrl,
      signature: prof.signature ?? await fetchUserSignature(prof.userId)
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

    const trackAllData = await requestAuthed(`/playlist/track/all?id=${encodeURIComponent(String(playlistId))}`)
    let songs = getSongItems(trackAllData)

    let playlistDetailData: Record<string, any> | null = null
    if (songs.length === 0) {
      playlistDetailData = await requestAuthed(`/playlist/detail?id=${encodeURIComponent(String(playlistId))}`)
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
    if (!force && streamUrlCache.has(songId)) {
      return streamUrlCache.get(songId) ?? null
    }

    const data = await requestAuthed(`/song/url/v1?id=${songId}&level=exhigh`)
    const streamItems = Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.urls)
        ? data.urls
        : []
    const url = typeof streamItems[0]?.url === 'string' ? streamItems[0].url : null
    streamUrlCache.set(songId, url)
    return url
  }

  return {
    isLoggedIn,
    profile,
    libraryLoading,
    libraryLoaded,
    libraryError,
    likedPlaylist,
    userPlaylists,
    buildProfile,
    checkLogin,
    setLogin,
    logout,
    fetchUserLibrary,
    fetchPlaylistTracks,
    fetchLikedTracks,
    getSongStreamUrl
  }
}
