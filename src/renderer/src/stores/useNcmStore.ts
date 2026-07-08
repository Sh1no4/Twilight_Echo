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

export interface NcmAlbumSummary {
  id: number
  name: string
  cover: string | null
  trackCount: number
  publishTime?: number
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
  artistId?: number
  followed?: boolean
}

export interface NcmLoginState {
  loggedIn: boolean
  profile: NcmProfile | null
}

export interface NcmLikedTracksPage {
  tracks: Track[]
  total: number
  offset: number
  limit: number
  nextOffset: number
  hasMore: boolean
}

export interface NcmStore {
  providerAvailable: Ref<boolean>
  providerError: Ref<string>
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
  openOfficialLogin: () => Promise<boolean>
  getQrKey: () => Promise<string | null>
  getQrImage: (key: string) => Promise<string | null>
  checkQrLogin: (key: string) => Promise<{ code: number }>
  fetchUserLibrary: (force?: boolean) => Promise<{
    likedPlaylist: NcmPlaylistSummary | null
    playlists: NcmPlaylistSummary[]
  }>
  fetchPlaylistTracks: (playlistId: number | string, force?: boolean) => Promise<Track[]>
  fetchLikedTracks: (force?: boolean) => Promise<Track[]>
  fetchLikedTracksPage: (offset?: number, limit?: number, force?: boolean) => Promise<NcmLikedTracksPage>
  getSongStreamUrl: (songId: number, force?: boolean) => Promise<string | null>
  fetchRecommendSongs: () => Promise<Track[]>
  fetchRecommendPlaylists: () => Promise<NcmPlaylistSummary[]>
  fetchPersonalFm: () => Promise<Track[]>
  fetchPrivateContent: () => Promise<Track[]>
  fetchLyric: (songId: number) => Promise<{
    lyrics: string | null
    translatedLyrics: string | null
  }>
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
  fetchArtistAlbums: (artistId: number) => Promise<NcmAlbumSummary[]>
  fetchArtistIntro: (artistId: number) => Promise<string>
  fetchArtistFollowState: (artistId: number) => Promise<boolean | null>
  fetchAlbumTracks: (albumId: number) => Promise<Track[]>
  fetchArtistPlaylists: (artistId: number) => Promise<NcmPlaylistSummary[]>
  fetchUserPlaylistsByUid: (uid: number, createdOnly?: boolean) => Promise<NcmPlaylistSummary[]>
  fetchUserFollows: (uid: number, limit?: number, offset?: number) => Promise<NcmUserSummary[]>
  fetchUserFolloweds: (uid: number, limit?: number, offset?: number) => Promise<NcmUserSummary[]>
  fetchPlayRecords: (type?: number) => Promise<Track[]>
  fetchRecentSongs: (limit?: number) => Promise<Track[]>
  followArtist: (artistId: number, follow: boolean) => Promise<void>
  followUser: (userId: number, follow: boolean) => Promise<void>
  likeTrack: (songId: number, like: boolean) => Promise<void>
  isTrackLiked: (ncmSongId: number | undefined) => boolean
  syncLikedIds: (tracks: Track[]) => void
}

const NCM_PROVIDER_ID = 'ncm'

const providerAvailable = ref(true)
const providerError = ref('')
const isLoggedIn = ref(false)
const profile = ref<NcmProfile | null>(null)
const libraryLoading = ref(false)
const libraryLoaded = ref(false)
const libraryError = ref('')
const likedPlaylist = ref<NcmPlaylistSummary | null>(null)
const userPlaylists = ref<NcmPlaylistSummary[]>([])
const likedSongIds = ref<Set<number>>(new Set())

function resetLibraryState(): void {
  libraryLoading.value = false
  libraryLoaded.value = false
  libraryError.value = ''
  likedPlaylist.value = null
  userPlaylists.value = []
  likedSongIds.value = new Set()
}

function markProviderAvailable(): void {
  providerAvailable.value = true
  providerError.value = ''
}

function markProviderUnavailable(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  providerAvailable.value = false
  providerError.value = message || '网易云音乐插件未启用'
  isLoggedIn.value = false
  profile.value = null
  resetLibraryState()
}

async function callNcmProvider<T>(method: string, args: unknown[] = []): Promise<T> {
  try {
    const value = (await window.api.providers.call(NCM_PROVIDER_ID, method as never, args)) as T
    markProviderAvailable()
    return value
  } catch (error) {
    if (error instanceof Error && /Provider 未启用|provider is disabled|does not implement/i.test(error.message)) {
      markProviderUnavailable(error)
    }
    throw error
  }
}

function syncLikedIds(tracks: Track[]): void {
  const ids = new Set<number>()
  for (const track of tracks) {
    if (track.ncmSongId != null) ids.add(track.ncmSongId)
  }
  likedSongIds.value = ids
}

function applyLoginState(state: NcmLoginState): boolean {
  isLoggedIn.value = state.loggedIn
  profile.value = state.profile
  if (!state.loggedIn) resetLibraryState()
  return state.loggedIn
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
    return {
      userId: prof.userId,
      nickname: prof.nickname,
      avatarUrl: prof.avatarUrl,
      signature: prof.signature ?? '',
      follows: prof.follows ?? 0,
      followeds: prof.followeds ?? 0
    }
  }

  async function checkLogin(): Promise<boolean> {
    try {
      const state = await callNcmProvider<NcmLoginState>('checkLogin')
      return applyLoginState(state)
    } catch {
      isLoggedIn.value = false
      profile.value = null
      resetLibraryState()
      return false
    }
  }

  function setLogin(prof: NcmProfile): void {
    if (profile.value?.userId !== prof.userId) resetLibraryState()
    isLoggedIn.value = true
    profile.value = prof
    markProviderAvailable()
  }

  async function logout(): Promise<void> {
    await callNcmProvider<void>('logout')
    isLoggedIn.value = false
    profile.value = null
    resetLibraryState()
  }

  async function openOfficialLogin(): Promise<boolean> {
    const state = await callNcmProvider<NcmLoginState>('openOfficialLogin')
    return applyLoginState(state)
  }

  async function getQrKey(): Promise<string | null> {
    return callNcmProvider<string | null>('getQrKey')
  }

  async function getQrImage(key: string): Promise<string | null> {
    return callNcmProvider<string | null>('getQrImage', [key])
  }

  async function checkQrLogin(key: string): Promise<{ code: number }> {
    return callNcmProvider<{ code: number }>('checkQrLogin', [key])
  }

  async function fetchUserLibrary(force = false): Promise<{
    likedPlaylist: NcmPlaylistSummary | null
    playlists: NcmPlaylistSummary[]
  }> {
    libraryLoading.value = true
    libraryError.value = ''
    try {
      const library = await callNcmProvider<{
        likedPlaylist: NcmPlaylistSummary | null
        playlists: NcmPlaylistSummary[]
      }>('fetchUserLibrary', [force])
      likedPlaylist.value = library.likedPlaylist
      userPlaylists.value = library.playlists
      libraryLoaded.value = true
      return library
    } catch (error) {
      libraryError.value = error instanceof Error ? error.message : '加载网易云音乐库失败'
      throw error
    } finally {
      libraryLoading.value = false
    }
  }

  async function fetchPlaylistTracks(
    playlistId: number | string,
    force = false
  ): Promise<Track[]> {
    return callNcmProvider<Track[]>('fetchPlaylistTracks', [playlistId, force])
  }

  async function fetchLikedTracks(force = false): Promise<Track[]> {
    const tracks = await callNcmProvider<Track[]>('fetchLikedTracks', [force])
    syncLikedIds(tracks)
    return tracks
  }

  async function fetchLikedTracksPage(
    offset = 0,
    limit = 100,
    force = false
  ): Promise<NcmLikedTracksPage> {
    const page = await callNcmProvider<NcmLikedTracksPage>('fetchLikedTracksPage', [
      offset,
      limit,
      force
    ])
    syncLikedIds(page.tracks)
    return page
  }

  async function getSongStreamUrl(songId: number, force = false): Promise<string | null> {
    return callNcmProvider<string | null>('getPlaybackUrl', [
      { id: `ncm:${songId}`, filePath: `ncm:${songId}`, source: 'ncm', ncmSongId: songId },
      { force }
    ])
  }

  async function fetchRecommendSongs(): Promise<Track[]> {
    return callNcmProvider<Track[]>('fetchRecommendSongs')
  }

  async function fetchRecommendPlaylists(): Promise<NcmPlaylistSummary[]> {
    return callNcmProvider<NcmPlaylistSummary[]>('fetchRecommendPlaylists')
  }

  async function fetchPersonalFm(): Promise<Track[]> {
    return callNcmProvider<Track[]>('fetchPersonalFm')
  }

  async function fetchPrivateContent(): Promise<Track[]> {
    return callNcmProvider<Track[]>('fetchPrivateContent')
  }

  async function fetchLyric(songId: number): Promise<{
    lyrics: string | null
    translatedLyrics: string | null
  }> {
    return callNcmProvider<{ lyrics: string | null; translatedLyrics: string | null }>(
      'getLyrics',
      [{ id: `ncm:${songId}`, filePath: `ncm:${songId}`, source: 'ncm', ncmSongId: songId }]
    )
  }

  async function searchSongs(
    keywords: string,
    limit = 30,
    offset = 0
  ): Promise<{ tracks: Track[]; total: number }> {
    const result = await callNcmProvider<{ items: Track[]; total: number }>('searchSongs', [
      keywords,
      limit,
      offset
    ])
    return { tracks: result.items, total: result.total }
  }

  async function searchPlaylists(
    keywords: string,
    limit = 30,
    offset = 0
  ): Promise<{ playlists: NcmPlaylistSummary[]; total: number }> {
    const result = await callNcmProvider<{ items: NcmPlaylistSummary[]; total: number }>(
      'searchPlaylists',
      [keywords, limit, offset]
    )
    return { playlists: result.items, total: result.total }
  }

  async function searchArtists(
    keywords: string,
    limit = 30,
    offset = 0
  ): Promise<{ artists: NcmArtistSummary[]; total: number }> {
    const result = await callNcmProvider<{ items: NcmArtistSummary[]; total: number }>(
      'searchArtists',
      [keywords, limit, offset]
    )
    return { artists: result.items, total: result.total }
  }

  async function fetchArtistTopSongs(artistId: number): Promise<Track[]> {
    return callNcmProvider<Track[]>('fetchArtistTopSongs', [artistId])
  }

  async function fetchArtistAlbums(artistId: number): Promise<NcmAlbumSummary[]> {
    return callNcmProvider<NcmAlbumSummary[]>('fetchArtistAlbums', [artistId])
  }

  async function fetchArtistIntro(artistId: number): Promise<string> {
    return callNcmProvider<string>('fetchArtistIntro', [artistId])
  }

  async function fetchArtistFollowState(artistId: number): Promise<boolean | null> {
    return callNcmProvider<boolean | null>('fetchArtistFollowState', [artistId])
  }

  async function fetchAlbumTracks(albumId: number): Promise<Track[]> {
    return callNcmProvider<Track[]>('fetchAlbumTracks', [albumId])
  }

  async function fetchArtistPlaylists(artistId: number): Promise<NcmPlaylistSummary[]> {
    return callNcmProvider<NcmPlaylistSummary[]>('fetchArtistPlaylists', [artistId])
  }

  async function fetchUserPlaylistsByUid(
    uid: number,
    createdOnly = false
  ): Promise<NcmPlaylistSummary[]> {
    return callNcmProvider<NcmPlaylistSummary[]>('fetchUserPlaylistsByUid', [uid, createdOnly])
  }

  async function fetchUserFollows(
    uid: number,
    limit = 30,
    offset = 0
  ): Promise<NcmUserSummary[]> {
    return callNcmProvider<NcmUserSummary[]>('fetchUserFollows', [uid, limit, offset])
  }

  async function fetchUserFolloweds(
    uid: number,
    limit = 30,
    offset = 0
  ): Promise<NcmUserSummary[]> {
    return callNcmProvider<NcmUserSummary[]>('fetchUserFolloweds', [uid, limit, offset])
  }

  async function likeTrack(songId: number, like: boolean): Promise<void> {
    await callNcmProvider<void>('likeTrack', [songId, like])
    if (like) {
      likedSongIds.value = new Set([...likedSongIds.value, songId])
    } else {
      const next = new Set(likedSongIds.value)
      next.delete(songId)
      likedSongIds.value = next
    }
  }

  function isTrackLiked(ncmSongId: number | undefined): boolean {
    return ncmSongId != null && likedSongIds.value.has(ncmSongId)
  }

  async function fetchPlayRecords(type = 0): Promise<Track[]> {
    return callNcmProvider<Track[]>('fetchPlayRecords', [type])
  }

  async function fetchRecentSongs(limit = 100): Promise<Track[]> {
    return callNcmProvider<Track[]>('fetchRecentSongs', [limit])
  }

  async function followArtist(artistId: number, follow: boolean): Promise<void> {
    await callNcmProvider<void>('followArtist', [artistId, follow])
  }

  async function followUser(userId: number, follow: boolean): Promise<void> {
    await callNcmProvider<void>('followUser', [userId, follow])
  }

  return {
    providerAvailable,
    providerError,
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
    openOfficialLogin,
    getQrKey,
    getQrImage,
    checkQrLogin,
    fetchUserLibrary,
    fetchPlaylistTracks,
    fetchLikedTracks,
    fetchLikedTracksPage,
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
    fetchArtistAlbums,
    fetchArtistIntro,
    fetchArtistFollowState,
    fetchAlbumTracks,
    fetchArtistPlaylists,
    fetchUserPlaylistsByUid,
    fetchUserFollows,
    fetchUserFolloweds,
    fetchPlayRecords,
    fetchRecentSongs,
    followArtist,
    followUser,
    likeTrack,
    isTrackLiked,
    syncLikedIds
  }
}
