let contextRef = null
let ncmApi = null

const PROVIDER_ID = 'ncm'
const COOKIE_KEY = 'cookie'
const PC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0'
const TRANSIENT_LOGIN_ERROR_CODES = new Set([301, 502, 503, 460])
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
    ui: {
      icon: 'pi pi-cloud',
      color: '#c20c0c',
      description: '内置基础音源',
      authType: 'qr',
      loginInstructions: '请使用网易云音乐 App 扫码登录',
      qrStatusCodes: { waiting: 801, scanned: 802, expired: 800, success: 803 },
      loginExtraActions: [
        { label: '使用官方网页登录', icon: 'pi pi-external-link', method: 'openOfficialLogin' }
      ],
      streamingSections: [
        { id: 'daily', title: '每日推荐', icon: 'pi pi-calendar', method: 'fetchRecommendSongs' },
        { id: 'fm', title: '私人漫游', icon: 'pi pi-compass', method: 'fetchPersonalFm' },
        { id: 'radar', title: '私人雷达', icon: 'pi pi-send', method: 'fetchPrivateContent' }
      ],
      streamingLibraryTab: true,
      streamingSearch: true
    },
    getPlaybackUrl,
    getLyrics,
    searchSongs,
    searchPlaylists,
    searchArtists,
    fetchPlaylistTracks,
    checkLogin,
    getProfile,
    logout,
    openOfficialLogin,
    sendCaptcha,
    loginByPhonePassword,
    loginByPhoneCaptcha,
    loginByEmailPassword,
    getQrLogin,
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
    isTrackLiked
  })

  context.logger.info('Built-in NetEase Cloud Music provider registered')
}

export function deactivate() {
  contextRef = null
  ncmApi = null
  resetCaches()
}

function appendQueryParam(path, key, value) {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
}

function appendQueryParams(path, params) {
  return Object.entries(params).reduce(
    (nextPath, [key, value]) => appendQueryParam(nextPath, key, value),
    path
  )
}

function withPcUa(path) {
  return appendQueryParam(path, 'ua', PC_UA)
}

function withQrLoginParams(path) {
  return appendQueryParams(path, { ua: 'pc' })
}

function shouldUsePcUa(path) {
  if (path.startsWith('/song/url')) return false
  return !path.startsWith('/login/')
}

function normalizeApiMessage(data, fallback) {
  const message = data?.message ?? data?.msg ?? data?.data?.message ?? data?.body?.message
  return typeof message === 'string' && message.trim() ? message.trim() : fallback
}

function isRiskControlMessage(message) {
  return /安全风险|设备环境异常|操作已拦截|高频|风控|ip 高频|IP 高频/i.test(message)
}

function describeApiError(code, data) {
  const rawMessage = normalizeApiMessage(data, '')
  if (rawMessage && isRiskControlMessage(rawMessage)) {
    if (/安全风险|设备环境异常|操作已拦截/i.test(rawMessage)) {
      return `网易云拦截了当前网络或设备环境：${rawMessage}。请停止频繁重试，切换网络/设备或按官方提示 24 小时后再试。`
    }
    return `网易云登录接口触发高频或风控限制：${rawMessage}。请等待几分钟后再试。`
  }
  if (code === 301) return '网易云登录态无效或接口缓存了未登录结果，请重新登录或等待 2 分钟后重试。'
  if (code === 400) return normalizeApiMessage(data, '网易云登录参数无效，请检查账号、密码或验证码。')
  if (code === 502) return '网易云二维码状态检查失败，已尝试无 Cookie 模式，请刷新二维码后重试。'
  if (code === 503) return '网易云登录接口触发高频/风控限制，请等待几分钟后再试。'
  if (code === 460) return '网易云限制了当前网络环境，请切换到国内网络或稍后重试。'
  return normalizeApiMessage(data, 'NetEase API request failed')
}

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName}不能为空`)
  }
  return value.trim()
}

function normalizeCountryCode(countrycode) {
  const normalized = typeof countrycode === 'string' && countrycode.trim() ? countrycode.trim() : '86'
  return /^[0-9]{1,6}$/.test(normalized) ? normalized : '86'
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
  const data = await ncmApi.request(shouldUsePcUa(path) ? withPcUa(path) : path, cookie)
  if (data && typeof data === 'object' && data.code === -1) {
    throw new Error(data.message || 'NetEase API request failed')
  }
  return data && typeof data === 'object' ? data : {}
}

function assertSuccessfulLoginResponse(data) {
  const code = Number(data?.code ?? data?.body?.code)
  if (code !== 200 || typeof data?.cookie !== 'string' || !data.cookie.includes('MUSIC_U=')) {
    throw new Error(describeApiError(Number.isFinite(code) ? code : -1, data))
  }
  return data.cookie
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

function normalizeAlbum(album) {
  return {
    id: Number(album.id),
    name: album.name || '未命名专辑',
    cover: album.picUrl || album.blurPicUrl || null,
    trackCount: typeof album.size === 'number' ? album.size : (album.songCount ?? 0),
    publishTime:
      typeof album.publishTime === 'number'
        ? album.publishTime
        : typeof album.publishTime === 'string'
          ? Number(album.publishTime)
          : undefined
  }
}

function normalizeArtist(item) {
  return {
    id: Number(item.id),
    name: item.name || item.artistName || '未知歌手',
    picUrl: item.picUrl || item.img1v1Url || item.avatarUrl || null,
    albumSize: item.albumSize || 0,
    musicSize: item.musicSize || 0
  }
}

function getPlaylistItems(data) {
  if (Array.isArray(data.playlist)) return data.playlist
  if (Array.isArray(data.data?.playlist)) return data.data.playlist
  return []
}

function getAlbumItems(data) {
  if (Array.isArray(data.hotAlbums)) return data.hotAlbums
  if (Array.isArray(data.albums)) return data.albums
  if (Array.isArray(data.data?.hotAlbums)) return data.data.hotAlbums
  if (Array.isArray(data.data?.albums)) return data.data.albums
  return []
}

function getArtistItems(data) {
  if (Array.isArray(data.artists)) return data.artists
  if (Array.isArray(data.data?.artists)) return data.data.artists
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.data?.data)) return data.data.data
  if (Array.isArray(data.list)) return data.list
  if (Array.isArray(data.data?.list)) return data.data.list
  return []
}

function getSongItems(data) {
  if (Array.isArray(data.songs)) return data.songs
  if (Array.isArray(data.data?.songs)) return data.data.songs
  if (Array.isArray(data.result?.songs)) return data.result.songs
  if (Array.isArray(data.data?.result?.songs)) return data.data.result.songs
  if (Array.isArray(data.playlist?.tracks)) return data.playlist.tracks
  if (Array.isArray(data.playlist?.songs)) return data.playlist.songs
  if (Array.isArray(data.data?.playlist?.tracks)) return data.data.playlist.tracks
  if (Array.isArray(data.data?.artist?.hotSongs)) return data.data.artist.hotSongs
  if (Array.isArray(data.artist?.hotSongs)) return data.artist.hotSongs
  if (Array.isArray(data.hotSongs)) return data.hotSongs
  if (Array.isArray(data.data)) return data.data
  return []
}

function getPagedMoreFlag(data) {
  const candidates = [data?.more, data?.hasMore, data?.data?.more, data?.data?.hasMore]
  const value = candidates.find((candidate) => typeof candidate === 'boolean')
  return typeof value === 'boolean' ? value : undefined
}

async function fetchPagedItems({ makePath, getItems, limit = 100, maxPages = 100 }) {
  const items = []
  const seen = new Set()
  let offset = 0

  for (let page = 0; page < maxPages; page += 1) {
    const data = await requestAuthed(makePath(limit, offset))
    const pageItems = getItems(data)
    if (!Array.isArray(pageItems) || pageItems.length === 0) break

    let added = 0
    for (const item of pageItems) {
      const key = String(item?.id ?? `${offset}:${added}`)
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
      added += 1
    }

    const hasMore = getPagedMoreFlag(data)
    if (added === 0 || hasMore === false) break
    if (pageItems.length < limit && hasMore !== true) break
    offset += pageItems.length || limit
  }

  return items
}

function addPositiveId(target, value) {
  const normalized = Number(value)
  if (Number.isFinite(normalized) && normalized > 0) target.add(normalized)
}

function normalizeFollowed(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  return undefined
}

function mergePlaylists(...groups) {
  const seen = new Set()
  const merged = []
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    for (const playlist of group) {
      const key = String(playlist?.id ?? '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      merged.push(playlist)
    }
  }
  return merged
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

async function openOfficialLogin() {
  const cookie = await ncmApi.officialLogin()
  if (!cookie || typeof cookie !== 'string' || !cookie.includes('MUSIC_U=')) {
    throw new Error('网易云官方登录未返回有效 Cookie')
  }
  await saveCookie(cookie)
  return await checkLogin()
}

function isPlaylistCreatedByUid(playlist, uid) {
  const ownerId = Number(playlist.userId ?? playlist.creator?.userId)
  const targetUid = Number(uid)
  return Number.isFinite(ownerId) && Number.isFinite(targetUid) && ownerId === targetUid
}

async function sendCaptcha(phone, countrycode = '86') {
  const normalizedPhone = requireNonEmptyString(phone, '手机号')
  const data = await request(
    `/captcha/sent?phone=${encodeURIComponent(normalizedPhone)}&ctcode=${encodeURIComponent(
      normalizeCountryCode(countrycode)
    )}`
  )
  const code = Number(data.code)
  if (code !== 200) {
    return { code: Number.isFinite(code) ? code : -1, message: describeApiError(code, data) }
  }
  return { code: 200, message: normalizeApiMessage(data, '验证码已发送') }
}

async function finishAccountLogin(data) {
  const cookie = assertSuccessfulLoginResponse(data)
  await saveCookie(cookie)
  return await checkLogin()
}

async function loginByPhonePassword(phone, password, countrycode = '86') {
  const normalizedPhone = requireNonEmptyString(phone, '手机号')
  const normalizedPassword = requireNonEmptyString(password, '密码')
  const data = await request(
    `/login/cellphone?phone=${encodeURIComponent(normalizedPhone)}&password=${encodeURIComponent(
      normalizedPassword
    )}&countrycode=${encodeURIComponent(normalizeCountryCode(countrycode))}`
  )
  return await finishAccountLogin(data)
}

async function loginByPhoneCaptcha(phone, captcha, countrycode = '86') {
  const normalizedPhone = requireNonEmptyString(phone, '手机号')
  const normalizedCaptcha = requireNonEmptyString(captcha, '验证码')
  const data = await request(
    `/login/cellphone?phone=${encodeURIComponent(normalizedPhone)}&captcha=${encodeURIComponent(
      normalizedCaptcha
    )}&countrycode=${encodeURIComponent(normalizeCountryCode(countrycode))}`
  )
  return await finishAccountLogin(data)
}

async function loginByEmailPassword(email, password) {
  const normalizedEmail = requireNonEmptyString(email, '邮箱')
  const normalizedPassword = requireNonEmptyString(password, '密码')
  const data = await request(
    `/login?email=${encodeURIComponent(normalizedEmail)}&password=${encodeURIComponent(normalizedPassword)}`
  )
  return await finishAccountLogin(data)
}

async function getQrKey() {
  const data = await request('/login/qr/key')
  return data.code === 200 && data.data?.unikey ? data.data.unikey : null
}

async function getQrImage(key) {
  const data = await request(
    withQrLoginParams(`/login/qr/create?key=${encodeURIComponent(String(key))}&platform=web&qrimg=true`)
  )
  if (data.code !== 200 || !data.data?.qrimg) return null
  const raw = data.data.qrimg
  return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`
}

async function getQrLogin() {
  const key = await getQrKey()
  if (!key) return null
  const imageDataUrl = await getQrImage(key)
  return { key, imageDataUrl }
}

async function checkQrLogin(key) {
  const encodedKey = encodeURIComponent(String(key))
  let data = await request(withQrLoginParams(`/login/qr/check?key=${encodedKey}`))
  let code = Number(data.code)

  if (code === 502) {
    data = await request(withQrLoginParams(`/login/qr/check?key=${encodedKey}&noCookie=true`))
    code = Number(data.code)
  }

  if (TRANSIENT_LOGIN_ERROR_CODES.has(code)) {
    return {
      code,
      message: describeApiError(code, data),
      retryAfterSeconds: code === 503 || code === 460 ? 180 : 120
    }
  }

  if (code === 803 && data.cookie) {
    await saveCookie(data.cookie)
  }
  return {
    code: Number.isFinite(code) ? code : -1,
    message: Number.isFinite(code) ? undefined : normalizeApiMessage(data, '二维码登录状态异常')
  }
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

  // 一次性获取全部歌曲（limit 设为足够大，API 内部会先取 trackIds 再按 limit 切片请求详情）
  const trackAllData = await requestAuthed(
    `/playlist/track/all?id=${encodeURIComponent(String(playlistId))}&limit=100000`
  )
  let songs = getSongItems(trackAllData)

  // 回退：用 playlist/detail 拿 trackIds，再分批请求详情
  if (songs.length === 0) {
    const detailData = await requestAuthed(`/playlist/detail?id=${encodeURIComponent(String(playlistId))}`)
    songs = getSongItems(detailData)

    if (songs.length === 0) {
      const ids = getPlaylistTrackIds(detailData)
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

function getPlaybackUrlRequestPaths(songId) {
  const encodedId = encodeURIComponent(String(songId))
  return [
    `/song/url?id=${encodedId}&br=999000`,
    `/song/url?id=${encodedId}&br=320000`,
    `/song/url?id=${encodedId}&br=128000`,
    `/song/url/v1?id=${encodedId}&level=exhigh`,
    `/song/url/v1?id=${encodedId}&level=higher`,
    `/song/url/v1?id=${encodedId}&level=standard`
  ]
}

function getPlaybackStreamItems(data) {
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data?.urls)) return data.urls
  if (Array.isArray(data?.url)) return data.url
  return []
}

function getPlaybackFailureMessage(data, streamItem) {
  const message = streamItem?.msg ?? streamItem?.message ?? data?.msg ?? data?.message
  return typeof message === 'string' && message.trim() ? message.trim() : ''
}

async function getPlaybackUrl(track, options = {}) {
  const songId = getSongIdFromTrack(track)
  if (songId == null) throw new Error('Missing NetEase song ID, cannot play')
  const force = options?.force === true

  if (!force && streamUrlCache.has(songId)) return streamUrlCache.get(songId)

  let lastFailureMessage = ''
  for (const path of getPlaybackUrlRequestPaths(songId)) {
    try {
      const data = await requestAuthed(path)
      const streamItems = getPlaybackStreamItems(data)
      const streamItem = streamItems[0] ?? {}
      const url = typeof streamItem.url === 'string' && streamItem.url ? streamItem.url : null
      if (url) {
        rememberStreamAudioMeta(songId, streamItem)
        streamUrlCache.set(songId, url)
        void ncmApi
          .cacheSong(songId, url, track?.fileName)
          .catch(() => {})
        return url
      }
      lastFailureMessage = getPlaybackFailureMessage(data, streamItem) || lastFailureMessage
    } catch (error) {
      lastFailureMessage = error instanceof Error ? error.message : String(error)
    }
  }

  if (lastFailureMessage) getContext().logger.warn(`网易云播放地址解析失败：${lastFailureMessage}`)
  return null
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
    items: artists.map(normalizeArtist),
    total
  }
}

async function fetchArtistTopSongs(artistId) {
  const encodedId = encodeURIComponent(String(artistId))
  try {
    const songs = await fetchPagedItems({
      makePath: (limit, offset) =>
        `/artist/songs?id=${encodedId}&order=hot&limit=${limit}&offset=${offset}`,
      getItems: getSongItems,
      limit: 100
    })
    if (songs.length > 0) return songs.map(normalizeTrack)
  } catch (error) {
    const fallbackEndpoints = [`/artist/top/song?id=${encodedId}`, `/artists?id=${encodedId}`]
    for (const endpoint of fallbackEndpoints) {
      try {
        const data = await requestAuthed(endpoint)
        const songs = getSongItems(data)
        if (songs.length > 0) return songs.map(normalizeTrack)
      } catch {
        // Continue to the next fallback endpoint.
      }
    }
    throw error
  }

  return []
}

async function fetchArtistAlbums(artistId) {
  const encodedId = encodeURIComponent(String(artistId))
  const albums = await fetchPagedItems({
    makePath: (limit, offset) =>
      `/artist/album?id=${encodedId}&limit=${limit}&offset=${offset}`,
    getItems: getAlbumItems,
    limit: 100
  })
  return albums.map(normalizeAlbum)
}

async function fetchArtistIntro(artistId) {
  const data = await requestAuthed(`/artist/desc?id=${encodeURIComponent(String(artistId))}`)
  const candidates = [
    data.briefDesc,
    data.data?.briefDesc,
    data.introduction?.[0]?.txt,
    data.data?.introduction?.[0]?.txt
  ]
  const intro = candidates.find((value) => typeof value === 'string' && value.trim())
  return typeof intro === 'string' ? intro.trim() : ''
}

async function fetchArtistFollowState(artistId) {
  const data = await requestAuthed(`/artist/detail/dynamic?id=${encodeURIComponent(String(artistId))}`)
  const candidates = [
    data.followed,
    data.isSub,
    data.sub,
    data.data?.followed,
    data.data?.isSub,
    data.data?.sub
  ]
  for (const candidate of candidates) {
    const followed = normalizeFollowed(candidate)
    if (typeof followed === 'boolean') return followed
  }
  return null
}

async function fetchAlbumTracks(albumId) {
  const data = await requestAuthed(`/album?id=${encodeURIComponent(String(albumId))}`)
  return getSongItems(data).map(normalizeTrack)
}

async function fetchArtistPlaylists(artistId) {
  const candidateUserIds = new Set()
  try {
    const detail = await requestAuthed(`/artist/detail?id=${encodeURIComponent(String(artistId))}`)
    const ids = [
      detail.data?.artist?.accountId,
      detail.data?.artist?.userId,
      detail.data?.artist?.profile?.userId,
      detail.data?.user?.userId,
      detail.data?.userProfile?.userId,
      detail.artist?.accountId,
      detail.artist?.userId,
      detail.artist?.profile?.userId,
      detail.user?.userId,
      detail.userProfile?.userId
    ]
    ids.forEach((id) => addPositiveId(candidateUserIds, id))
  } catch {
    // Some artists do not expose a linked user account.
  }

  const playlistGroups = []
  for (const uid of candidateUserIds) {
    try {
      const playlists = await fetchUserPlaylistsByUid(uid, true)
      if (playlists.length > 0) playlistGroups.push(playlists)
    } catch {
      // Try the next candidate account id.
    }
  }
  return mergePlaylists(...playlistGroups)
}

async function fetchUserPlaylistsByUid(uid, createdOnly = false) {
  const data = await requestAuthed(
    `/user/playlist?uid=${encodeURIComponent(String(uid))}&limit=1000`
  )
  const playlists = getPlaylistItems(data)
  const visiblePlaylists = createdOnly
    ? playlists.filter((playlist) => isPlaylistCreatedByUid(playlist, uid))
    : playlists
  return visiblePlaylists.map(normalizePlaylist)
}

async function fetchUserFollows(uid, limit = 30, offset = 0) {
  const data = await requestAuthed(`/artist/sublist?limit=${limit}&offset=${offset}`)
  const artists = getArtistItems(data)
  return artists.map((item) => {
    const artist = normalizeArtist(item)
    return {
      id: artist.id,
      name: artist.name,
      picUrl: artist.picUrl,
      musicSize: artist.musicSize,
      userType: 2,
      artistId: artist.id,
      followed: true
    }
  })
}

async function fetchUserFolloweds(uid, limit = 30, offset = 0) {
  const data = await requestAuthed(`/user/followeds?uid=${uid}&limit=${limit}&offset=${offset}`)
  const followeds = Array.isArray(data.followeds) ? data.followeds : []
  return followeds.map((item) => ({
    id: Number(item.userId),
    name: item.nickname || '未知用户',
    picUrl: item.avatarUrl || null,
    musicSize: item.playlistCount || 0,
    userType: item.userType || 0,
    followed: normalizeFollowed(item.followed ?? item.followMe ?? item.mutual)
  }))
}

async function followArtist(artistId, follow) {
  const data = await requestAuthed(
    `/artist/sub?id=${encodeURIComponent(String(artistId))}&t=${follow ? '1' : '0'}`
  )
  const code = Number(data.code)
  if (Number.isFinite(code) && code !== 200) {
    throw new Error(normalizeApiMessage(data, follow ? '关注歌手失败' : '取消关注歌手失败'))
  }
}

async function followUser(userId, follow) {
  const data = await requestAuthed(
    `/follow?id=${encodeURIComponent(String(userId))}&t=${follow ? '1' : '0'}`
  )
  const code = Number(data.code)
  if (Number.isFinite(code) && code !== 200) {
    throw new Error(normalizeApiMessage(data, follow ? '关注用户失败' : '取消关注用户失败'))
  }
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

// ── 听歌排行 (user/record) ──────────────────────────────────────────
// type: 0 = 全部时间, 1 = 最近一周
async function fetchPlayRecords(type = 1) {
  const currentProfile = await ensureProfile()
  const data = await requestAuthed(`/user/record?uid=${currentProfile.userId}&type=${type}`)
  const list =
    Array.isArray(data.weekData) ? data.weekData :
    Array.isArray(data.allData) ? data.allData :
    Array.isArray(data.data?.weekData) ? data.data.weekData :
    Array.isArray(data.data?.allData) ? data.data.allData :
    []
  return list.map((item) => {
    const track = normalizeTrack(item.song || item)
    track.playCount = Number(item.playCount ?? item.playcount ?? 0) || 0
    track.score = Number(item.score ?? 0) || 0
    return track
  })
}

// ── 最近播放歌曲 (record/recent/song) ────────────────────────────────
async function fetchRecentSongs(limit = 100) {
  const data = await requestAuthed(`/record/recent/song?limit=${limit}`)
  const list =
    Array.isArray(data.data?.list) ? data.data.list :
    Array.isArray(data.list) ? data.list :
    []
  return list.map((item) => {
    // /record/recent/song 返回结构: { resourceId, playTime, resourceType, data: { song fields } }
    const song = item.data ?? item.song ?? item
    const track = normalizeTrack(song)
    track.playTime = Number(item.playTime ?? 0) || 0
    return track
  })
}
