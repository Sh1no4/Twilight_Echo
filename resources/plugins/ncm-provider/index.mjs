let contextRef = null
let ncmApi = null

const PROVIDER_ID = 'ncm'
const COOKIE_KEY = 'cookie'
const playlistTrackCache = new Map()
const streamUrlCache = new Map()
let likedTracksCache = null
let likedSongIds = new Set()

export async function activate(context) {
  contextRef = context
  ncmApi = context.twilight.internal?.ncm
  if (!ncmApi) {
    throw new Error('Built-in NetEase provider requires the internal NCM gateway')
  }

  await context.twilight.providers.register({
    id: PROVIDER_ID,
    name: 'NetEase Cloud Music',
    capabilities: ['search', 'playbackUrl', 'lyrics', 'cover', 'playlist', 'library', 'login'],
    getPlaybackUrl,
    getLyrics,
    searchSongs,
    searchPlaylists,
    searchArtists,
    fetchPlaylistTracks,
    checkLogin,
    getProfile,
    logout,
    getQrKey,
    getQrImage,
    checkQrLogin,
    fetchUserLibrary,
    fetchLikedTracks,
    fetchRecommendSongs,
    fetchRecommendPlaylists,
    fetchPersonalFm,
    fetchPrivateContent,
    fetchArtistTopSongs,
    fetchArtistPlaylists,
    fetchUserPlaylistsByUid,
    fetchUserFollows,
    fetchUserFolloweds,
    likeTrack,
    isTrackLiked
  })

  context.logger.info('Built-in NetEase Cloud Music provider registered')
}

export function deactivate() {
  contextRef = null
  ncmApi = null
  resetCaches()
}

function withPcUa(path) {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}ua=pc`
}

function resetCaches() {
  playlistTrackCache.clear()
  streamUrlCache.clear()
  likedTracksCache = null
  likedSongIds = new Set()
}

function getContext() {
  if (!contextRef || !ncmApi) throw new Error('NetEase provider is not active')
  return contextRef
}

async function getCookie() {
  const value = await getContext().settings.get(COOKIE_KEY)
  return typeof value === 'string' ? value : ''
}

async function saveCookie(cookie) {
  if (cookie) {
    await getContext().settings.set(COOKIE_KEY, cookie)
  } else {
    await getContext().settings.delete(COOKIE_KEY)
  }
}

async function request(path, cookie) {
  const data = await ncmApi.request(withPcUa(path), cookie)
  if (data && typeof data === 'object' && data.code === -1) {
    throw new Error(data.message || 'NetEase API request failed')
  }
  return data && typeof data === 'object' ? data : {}
}

async function requestAuthed(path) {
  const cookie = await getCookie()
  if (!cookie) throw new Error('请先登录网易云音乐')
  return request(path, cookie)
}

async function ensureProfile() {
  const login = await checkLogin()
  if (!login.loggedIn || !login.profile) throw new Error('请先登录网易云音乐')
  return login.profile
}

function formatDuration(rawDuration) {
  if (typeof rawDuration !== 'number' || !isFinite(rawDuration) || rawDuration <= 0) return 0
  return rawDuration > 1000 ? Math.round(rawDuration / 1000) : Math.round(rawDuration)
}

function normalizeNcmFormat(rawFormat) {
  if (typeof rawFormat !== 'string' || !rawFormat.trim()) return undefined
  const format = rawFormat.trim().toLowerCase()
  return format === 'mp4' ? 'm4a' : format
}

function getSongAudioMeta(song) {
  const candidates = [
    song.sq,
    song.hr,
    song.h,
    song.m,
    song.l,
    song.mainSong?.sq,
    song.mainSong?.h
  ].filter(Boolean)
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

function normalizeTrack(song) {
  const songId = Number(song.id)
  const artists = Array.isArray(song.ar) ? song.ar.map((artist) => artist?.name).filter(Boolean) : []
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
    translatedLyrics: null,
    source: 'ncm',
    ncmSongId: songId,
    streamUrl: null,
    format: audioMeta.format,
    sampleRate: audioMeta.sampleRate,
    bitrate: audioMeta.bitrate
  }
}

function rememberStreamAudioMeta(songId, item) {
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
    if (!track) return
    if (format) track.format = format
    if (Number.isFinite(bitrate) && bitrate > 0) track.bitrate = bitrate
    if (Number.isFinite(sampleRate) && sampleRate > 0) track.sampleRate = sampleRate
    if (Number.isFinite(size) && size > 0) track.size = size
  }
}

function normalizePlaylist(playlist) {
  return {
    id: Number(playlist.id),
    name: playlist.name || '未命名歌单',
    cover: playlist.coverImgUrl || playlist.picUrl || null,
    trackCount: typeof playlist.trackCount === 'number' ? playlist.trackCount : 0
  }
}

function getPlaylistItems(data) {
  if (Array.isArray(data.playlist)) return data.playlist
  if (Array.isArray(data.data?.playlist)) return data.data.playlist
  return []
}

function getSongItems(data) {
  if (Array.isArray(data.songs)) return data.songs
  if (Array.isArray(data.data?.songs)) return data.data.songs
  if (Array.isArray(data.playlist?.tracks)) return data.playlist.tracks
  if (Array.isArray(data.playlist?.songs)) return data.playlist.songs
  if (Array.isArray(data.data?.playlist?.tracks)) return data.data.playlist.tracks
  if (Array.isArray(data.data)) return data.data
  return []
}

function getLikelistIds(data) {
  const rawIds = Array.isArray(data.ids)
    ? data.ids
    : Array.isArray(data.data?.ids)
      ? data.data.ids
      : []
  return rawIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
}

function getPlaylistTrackIds(data) {
  const rawTrackIds = Array.isArray(data.playlist?.trackIds)
    ? data.playlist.trackIds
    : Array.isArray(data.data?.playlist?.trackIds)
      ? data.data.playlist.trackIds
      : []
  return rawTrackIds
    .map((item) => Number(item?.id ?? item))
    .filter((id) => Number.isFinite(id) && id > 0)
}

function isLikedPlaylistItem(item) {
  return item.specialType === 5 || item.specialType === '5' || item.name === '喜欢的音乐'
}

async function fetchUserDetailInfo(userId) {
  try {
    const data = await requestAuthed(`/user/detail?uid=${userId}`)
    return {
      signature: data.profile?.signature || data.userPoint?.signature || data.data?.profile?.signature || '',
      follows: data.profile?.follows || 0,
      followeds: data.profile?.followeds || 0
    }
  } catch {
    return { signature: '', follows: 0, followeds: 0 }
  }
}

async function buildProfile(prof) {
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

async function checkLogin() {
  try {
    const cookie = await getCookie()
    if (!cookie) {
      resetCaches()
      return { loggedIn: false, profile: null }
    }
    const data = await request(`/login/status?timestamp=${Date.now()}`, cookie)
    const profileData = data.data?.profile || data.profile
    if ((data.data?.code === 200 || data.code === 200) && profileData) {
      const profile = await buildProfile({
        userId: profileData.userId,
        nickname: profileData.nickname,
        avatarUrl: profileData.avatarUrl,
        signature: profileData.signature
      })
      return { loggedIn: true, profile }
    }
    await saveCookie('')
    resetCaches()
    return { loggedIn: false, profile: null }
  } catch {
    resetCaches()
    return { loggedIn: false, profile: null }
  }
}

async function getProfile() {
  return (await checkLogin()).profile
}

async function logout() {
  await saveCookie('')
  resetCaches()
}

async function getQrKey() {
  const data = await request('/login/qr/key')
  return data.code === 200 && data.data?.unikey ? data.data.unikey : null
}

async function getQrImage(key) {
  const data = await request(`/login/qr/create?key=${encodeURIComponent(String(key))}&qrimg=true&platform=web`)
  if (data.code !== 200 || !data.data?.qrimg) return null
  const raw = data.data.qrimg
  return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`
}

async function checkQrLogin(key) {
  const data = await request(`/login/qr/check?key=${encodeURIComponent(String(key))}`)
  const code = Number(data.code)
  if (code === 803 && data.cookie) {
    await saveCookie(data.cookie)
  }
  return { code: Number.isFinite(code) ? code : -1 }
}

async function fetchUserLibrary(force = false) {
  if (force) {
    playlistTrackCache.clear()
    likedTracksCache = null
  }
  const currentProfile = await ensureProfile()
  const data = await requestAuthed(`/user/playlist?uid=${currentProfile.userId}&limit=1000`)
  const items = getPlaylistItems(data)
  const likedItem = items.find(isLikedPlaylistItem) ?? null
  return {
    likedPlaylist: likedItem ? normalizePlaylist(likedItem) : null,
    playlists: items.filter((item) => Number(item.id) !== Number(likedItem?.id)).map(normalizePlaylist)
  }
}

async function fetchPlaylistTracks(playlistId, force = false) {
  const cacheKey = String(playlistId)
  if (!force && playlistTrackCache.has(cacheKey)) return playlistTrackCache.get(cacheKey) ?? []

  const trackAllData = await requestAuthed(`/playlist/track/all?id=${encodeURIComponent(String(playlistId))}`)
  let songs = getSongItems(trackAllData)
  let playlistDetailData = null

  if (songs.length === 0) {
    playlistDetailData = await requestAuthed(`/playlist/detail?id=${encodeURIComponent(String(playlistId))}`)
    songs = getSongItems(playlistDetailData)
  }

  if (songs.length === 0) {
    const detailSource = playlistDetailData ?? trackAllData
    const ids = getPlaylistTrackIds(detailSource)
    if (ids.length > 0) {
      const detailSongs = []
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

async function fetchLikedTracks(force = false) {
  if (!force && likedTracksCache) return likedTracksCache

  const library = await fetchUserLibrary(force)
  if (library.likedPlaylist) {
    const tracks = await fetchPlaylistTracks(library.likedPlaylist.id, force)
    if (tracks.length > 0) {
      likedTracksCache = tracks
      syncLikedIds(tracks)
      return tracks
    }
  }

  const currentProfile = await ensureProfile()
  const data = await requestAuthed(`/likelist?uid=${currentProfile.userId}`)
  const ids = getLikelistIds(data)
  if (ids.length === 0) {
    likedTracksCache = []
    likedSongIds = new Set()
    return []
  }

  const songs = []
  const chunkSize = 200
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize)
    const detail = await requestAuthed(`/song/detail?ids=${chunk.join(',')}`)
    songs.push(...getSongItems(detail))
  }

  const normalized = songs.map(normalizeTrack)
  const trackBySongId = new Map()
  for (const track of normalized) {
    if (track.ncmSongId) trackBySongId.set(track.ncmSongId, track)
  }

  likedTracksCache = ids.map((id) => trackBySongId.get(id)).filter(Boolean)
  if (likedTracksCache.length === 0) likedTracksCache = normalized
  syncLikedIds(likedTracksCache)
  return likedTracksCache
}

function getSongIdFromTrack(track) {
  if (track?.ncmSongId != null) return Number(track.ncmSongId)
  if (typeof track?.id !== 'string' || !track.id.startsWith('ncm:')) return null
  const songId = Number(track.id.slice('ncm:'.length))
  return Number.isFinite(songId) && songId > 0 ? songId : null
}

async function getPlaybackUrl(track, options = {}) {
  const songId = getSongIdFromTrack(track)
  if (songId == null) throw new Error('Missing NetEase song ID, cannot play')
  const force = options?.force === true

  if (!force) {
    try {
      const cached = await ncmApi.getCachedSong(songId)
      if (cached) {
        streamUrlCache.set(songId, cached)
        return cached
      }
    } catch {
      // Cache miss falls through.
    }
  }

  if (!force && streamUrlCache.has(songId)) return streamUrlCache.get(songId) ?? null

  const data = await requestAuthed(`/song/url/v1?id=${songId}&level=exhigh`)
  const streamItems = Array.isArray(data.data) ? data.data : Array.isArray(data.urls) ? data.urls : []
  const streamItem = streamItems[0] ?? {}
  const url = typeof streamItem.url === 'string' ? streamItem.url : null
  rememberStreamAudioMeta(songId, streamItem)
  streamUrlCache.set(songId, url)
  if (url) {
    void ncmApi
      .cacheSong(songId, url, track?.fileName)
      .then((cached) => {
        if (cached && streamUrlCache.get(songId) === url) streamUrlCache.set(songId, cached)
      })
      .catch(() => {})
  }
  return url
}

async function fetchRecommendSongs() {
  const data = await requestAuthed('/recommend/songs')
  const dailySongs = Array.isArray(data.data?.dailySongs)
    ? data.data.dailySongs
    : Array.isArray(data.dailySongs)
      ? data.dailySongs
      : []
  if (dailySongs.length > 0) return dailySongs.map(normalizeTrack)
  return getSongItems(data).map(normalizeTrack)
}

async function fetchPersonalFm() {
  const data = await requestAuthed('/personal_fm')
  const fmData = Array.isArray(data.data) ? data.data : Array.isArray(data.result) ? data.result : []
  if (fmData.length > 0) return fmData.map(normalizeTrack)
  return getSongItems(data).map(normalizeTrack)
}

async function fetchPrivateContent() {
  const data = await requestAuthed('/personalized/privatecontent')
  const result = Array.isArray(data.result) ? data.result : Array.isArray(data.data) ? data.data : []
  if (result.length > 0) return result.map(normalizeTrack)
  return getSongItems(data).map(normalizeTrack)
}

async function fetchRecommendPlaylists() {
  try {
    const data = await requestAuthed('/recommend/resource')
    const recommend = Array.isArray(data.recommend) ? data.recommend : Array.isArray(data.data) ? data.data : []
    return recommend.map((item) => ({
      id: Number(item.id),
      name: item.name || '未命名歌单',
      cover: item.picUrl || item.coverImgUrl || null,
      trackCount: item.trackCount || 0
    }))
  } catch {
    return []
  }
}

function extractLyricText(data, key) {
  return data[key]?.lyric || data.data?.[key]?.lyric || null
}

async function getLyrics(track) {
  const songId = getSongIdFromTrack(track)
  if (songId == null) return { lyrics: null, translatedLyrics: null }
  try {
    const data = await requestAuthed(`/lyric/new?id=${songId}`)
    const lyrics = extractLyricText(data, 'lrc')
    const translatedLyrics = extractLyricText(data, 'tlyric')
    if (lyrics || translatedLyrics) return { lyrics, translatedLyrics }
    const data2 = await requestAuthed(`/lyric?id=${songId}`)
    return {
      lyrics: extractLyricText(data2, 'lrc'),
      translatedLyrics: extractLyricText(data2, 'tlyric')
    }
  } catch {
    return { lyrics: null, translatedLyrics: null }
  }
}

async function searchSongs(keywords, limit = 30, offset = 0) {
  const data = await requestAuthed(
    `/cloudsearch?keywords=${encodeURIComponent(keywords)}&type=1&limit=${limit}&offset=${offset}`
  )
  const result = data.result || data.data?.result || {}
  const songs = Array.isArray(result.songs) ? result.songs : []
  const total = typeof result.songCount === 'number' ? result.songCount : songs.length
  return { items: songs.map(normalizeTrack), total }
}

async function searchPlaylists(keywords, limit = 30, offset = 0) {
  const data = await requestAuthed(
    `/cloudsearch?keywords=${encodeURIComponent(keywords)}&type=1000&limit=${limit}&offset=${offset}`
  )
  const result = data.result || data.data?.result || {}
  const playlists = Array.isArray(result.playlists) ? result.playlists : []
  const total = typeof result.playlistCount === 'number' ? result.playlistCount : playlists.length
  return { items: playlists.map(normalizePlaylist), total }
}

async function searchArtists(keywords, limit = 30, offset = 0) {
  const data = await requestAuthed(
    `/cloudsearch?keywords=${encodeURIComponent(keywords)}&type=100&limit=${limit}&offset=${offset}`
  )
  const result = data.result || data.data?.result || {}
  const artists = Array.isArray(result.artists) ? result.artists : []
  const total = typeof result.artistCount === 'number' ? result.artistCount : artists.length
  return {
    items: artists.map((item) => ({
      id: Number(item.id),
      name: item.name || '未知歌手',
      picUrl: item.picUrl || item.img1v1Url || null,
      albumSize: item.albumSize || 0,
      musicSize: item.musicSize || 0
    })),
    total
  }
}

async function fetchArtistTopSongs(artistId) {
  try {
    const data = await requestAuthed(`/artist/top/song?id=${artistId}`)
    if (Array.isArray(data.songs) && data.songs.length > 0) return data.songs.map(normalizeTrack)
  } catch {
    // Fall back to the legacy endpoint.
  }
  const data = await requestAuthed(`/artists?id=${artistId}`)
  const hotSongs = Array.isArray(data.hotSongs) ? data.hotSongs : []
  return hotSongs.map(normalizeTrack)
}

async function fetchArtistPlaylists(artistId) {
  const candidateUserIds = new Set()
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

async function fetchUserPlaylistsByUid(uid) {
  const data = await requestAuthed(`/user/playlist?uid=${uid}&limit=1000`)
  const playlists = Array.isArray(data.playlist) ? data.playlist : []
  return playlists.map(normalizePlaylist)
}

async function fetchUserFollows(uid, limit = 30, offset = 0) {
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

async function fetchUserFolloweds(uid, limit = 30, offset = 0) {
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

async function likeTrack(songId, like) {
  await requestAuthed(`/like?id=${songId}&like=${String(like)}`)
  if (like) {
    likedSongIds = new Set([...likedSongIds, Number(songId)])
  } else {
    const next = new Set(likedSongIds)
    next.delete(Number(songId))
    likedSongIds = next
  }
}

function isTrackLiked(ncmSongId) {
  const songId = Number(ncmSongId)
  return Number.isFinite(songId) && likedSongIds.has(songId)
}

function syncLikedIds(tracks) {
  likedSongIds = new Set(
    tracks
      .map((track) => Number(track.ncmSongId))
      .filter((id) => Number.isFinite(id) && id > 0)
  )
}
