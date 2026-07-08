<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import type { Track } from '../types/music'
import {
  useNcmStore,
  type NcmPlaylistSummary,
  type NcmAlbumSummary,
  type NcmArtistSummary,
  type NcmUserSummary
} from '../stores/useNcmStore'
import { useProviderStore } from '../stores/useProviderStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import { useMusicStore } from '../stores/useMusicStore'
import { useMediaProviders } from '../providers'
import type {
  MediaProviderArtistSummary,
  MediaProviderPlaylistSummary,
  MediaProviderProfile
} from '../providers/mediaProvider'
import StreamingHome from './StreamingHome.vue'
import StreamingLibrary from './StreamingLibrary.vue'
import StreamingSearch from './StreamingSearch.vue'
import {
  buildStreamingSidebarItems,
  getFirstVisibleStreamingTab,
  getUnifiedLibraryProviders,
  hasStreamingSidebarEntries,
  isSidebarItemActiveForProvider,
  type StreamingSidebarItem,
  type StreamingTabKey
} from '../utils/streamingNavigation'
import {
  findBestStreamingArtistMatch,
  resolveLinkedStreamingArtist
} from '../utils/streamingArtistResolution'
import { getRecentTracks, getTopTracks } from '../stores/useListeningStatsStore'
import { resolveUnifiedRecentTracks } from '../utils/unifiedRecentTracks'
import {
  resolveUnifiedFavoriteTracks,
  summarizeUnifiedFavorites
} from '../utils/unifiedFavoriteTracks'
import type { PageState } from './streaming-page/types'
import { useStreamingSearch, type SearchSource, type SearchSourceOption } from './streaming-page/useStreamingSearch'

interface RecSection {
  key: string
  title: string
  tracks: Track[]
  icon: string
}

interface DetailHeaderInfo {
  title: string
  cover: string | null
  desc: string
  icon: string
  intro?: string
}

type StreamingTab = StreamingTabKey
type ArtistDetailTab = 'songs' | 'albums' | 'playlists'
type DetailView =
  | { type: 'liked' }
  | { type: 'playlist'; playlist: MediaProviderPlaylistSummary }
  | { type: 'album'; album: NcmAlbumSummary }
  | { type: 'rec'; section: RecSection }
  | { type: 'artist'; artist: NcmArtistSummary; user?: NcmUserSummary }
  | { type: 'user_list'; listType: 'follows' | 'followers'; users: NcmUserSummary[]; title: string }
  | { type: 'user_playlists'; user: NcmUserSummary; playlists: NcmPlaylistSummary[] }
  | { type: 'recent' }
  | { type: 'ranking' }

const props = defineProps<{
  menuOpen: boolean
  hasPlayer: boolean
  initialTab?: StreamingTab
}>()

const activeTab = ref<StreamingTab>(props.initialTab ?? 'home')
const streamingContentRef = ref<HTMLElement | null>(null)
const streamingTransitionName = ref('stream-page-down')
const currentDetail = ref<DetailView | null>(null)
const detailTracks = ref<Track[]>([])
const detailUsers = ref<NcmUserSummary[]>([])
const artistAlbums = ref<NcmAlbumSummary[]>([])
const artistPlaylists = ref<NcmPlaylistSummary[]>([])
const artistIntro = ref('')
const artistFollowed = ref<boolean | null>(null)
const activeArtistTab = ref<ArtistDetailTab>('songs')
const detailLoading = ref(false)
const detailError = ref('')
const followActionLoading = ref(false)
const followActionError = ref('')
const likedCount = ref<number | null>(null)
let detailLoadToken = 0

const dailySongs = ref<Track[]>([])
const personalFmSongs = ref<Track[]>([])
const privateContentSongs = ref<Track[]>([])
const recommendPlaylists = ref<NcmPlaylistSummary[]>([])
const LIKED_TRACKS_PAGE_SIZE = 100
const LIKED_TRACKS_LOAD_THRESHOLD = 0.75
const likedTracksNextOffset = ref(0)
const likedTracksTotal = ref<number | null>(null)
const likedTracksHasMore = ref(false)
const likedTracksLoadingMore = ref(false)
const likedTracksLoadMoreError = ref('')
const recsLoading = ref(false)
const recsError = ref('')
const avatarLoadFailed = ref(false)
const providerStore = useProviderStore()
const settingsStore = useSettingsStore()
const musicStore = useMusicStore()
const mediaProviders = useMediaProviders()

const NCM_PROVIDER_ID = 'ncm'
const ncmNavigationAvailable = computed(() => providerStore.hasProvider(NCM_PROVIDER_ID))

// ─── Generic external provider state (bili / ytmusic / future) ───────────
// Replaces the previously bili-only refs so any provider declaring a library
// tab can plug into the streaming library view without app-side changes.
interface ExternalProviderState {
  loggedIn: boolean
  profile: MediaProviderProfile | null
  libraryLoading: boolean
  libraryLoaded: boolean
  libraryError: string
  playlists: MediaProviderPlaylistSummary[]
  likedPlaylist: MediaProviderPlaylistSummary | null
  pinnedPlaylistIds: string[]
  pinningPlaylistId: string | number | null
}

function createExternalProviderState(): ExternalProviderState {
  return {
    loggedIn: false,
    profile: null,
    libraryLoading: false,
    libraryLoaded: false,
    libraryError: '',
    playlists: [],
    likedPlaylist: null,
    pinnedPlaylistIds: [],
    pinningPlaylistId: null
  }
}

const externalStates = reactive<Record<string, ExternalProviderState>>({})

function ensureExternalState(id: string): ExternalProviderState {
  if (!externalStates[id]) {
    externalStates[id] = createExternalProviderState()
  }
  return externalStates[id]
}

function isProviderAvailable(id: string): boolean {
  return id === NCM_PROVIDER_ID ? ncmNavigationAvailable.value : providerStore.hasProvider(id)
}

// User's persisted preferred provider — only explicit user toggles change it.
const preferredProvider = ref<string>(
  settingsStore.settings.value.streamingActiveProvider || NCM_PROVIDER_ID
)
const fallbackProvider = ref<string | null>(null)

// Resolved active provider: preferred when available, else the first provider
// that can back the shared music-library surface. If none exists, keep the
// ncm id as an inert fallback so the empty streaming state can render.
const activeProvider = computed<string>(() => {
  if (isProviderAvailable(preferredProvider.value)) return preferredProvider.value
  if (fallbackProvider.value && isProviderAvailable(fallbackProvider.value)) {
    return fallbackProvider.value
  }
  return libraryProviders.value[0]?.id ?? NCM_PROVIDER_ID
})

const isExternalActive = computed(() => activeProvider.value !== NCM_PROVIDER_ID)
const activeExternalState = computed<ExternalProviderState | null>(() =>
  isExternalActive.value ? (externalStates[activeProvider.value] ?? null) : null
)

const activeProviderInfo = computed(() => providerStore.getProvider(activeProvider.value))
const activeProviderLabel = computed(() => {
  if (activeProvider.value === NCM_PROVIDER_ID) return '网易云音乐'
  return activeProviderInfo.value?.name ?? '在线音源'
})

// Providers eligible for the unified music-library toggle (the dropdown on
// the profile card). Providers opt in by declaring `ui.unifiedLibrary: true`.
const libraryProviders = computed(() =>
  getUnifiedLibraryProviders({
    ncmAvailable: ncmNavigationAvailable.value,
    providers: providerStore.providers.value
  })
)
const libraryProviderOptions = computed(() =>
  libraryProviders.value.map((provider) => ({
    ...provider,
    health: providerStore.getProvider(provider.id)?.health,
    loggedIn:
      provider.id === NCM_PROVIDER_ID
        ? isLoggedIn.value
        : (externalStates[provider.id]?.loggedIn ?? false)
  }))
)

async function loadRecommendations(): Promise<void> {
  if (isExternalActive.value) return
  if (!isLoggedIn.value) return
  if (dailySongs.value.length > 0 && personalFmSongs.value.length > 0) return
  recsLoading.value = true
  recsError.value = ''
  try {
    const [daily, fm, pvt, playlists] = await Promise.all([
      fetchRecommendSongs().catch(() => [] as Track[]),
      fetchPersonalFm().catch(() => [] as Track[]),
      fetchPrivateContent().catch(() => [] as Track[]),
      fetchRecommendPlaylists().catch(() => [] as NcmPlaylistSummary[])
    ])
    dailySongs.value = daily
    personalFmSongs.value = fm
    privateContentSongs.value = pvt
    recommendPlaylists.value = playlists
  } catch (e) {
    recsError.value = e instanceof Error ? e.message : '加载推荐失败'
  } finally {
    recsLoading.value = false
  }
}

const recSections = computed<RecSection[]>(() => [
  { key: 'daily', title: '每日推荐', tracks: dailySongs.value, icon: 'pi pi-calendar' },
  { key: 'fm', title: '私人漫游', tracks: personalFmSongs.value, icon: 'pi pi-compass' },
  { key: 'radar', title: '私人雷达', tracks: privateContentSongs.value, icon: 'pi pi-send' }
])

async function openRecSection(section: RecSection): Promise<void> {
  detailLoadToken++
  streamingTransitionName.value = 'stream-page-down'
  currentDetail.value = { type: 'rec', section }
  detailTracks.value = section.tracks
  detailLoading.value = false
  detailError.value = ''
}

type SidebarItem = StreamingSidebarItem

const sidebarItems = computed<SidebarItem[]>(() =>
  buildStreamingSidebarItems({
    ncmAvailable: ncmNavigationAvailable.value,
    providers: providerStore.providers.value
  })
)
const hasOnlineNavigationEntries = computed(() => hasStreamingSidebarEntries(sidebarItems.value))
const visibleTabs = computed(() =>
  sidebarItems.value.filter(
    (item): item is SidebarItem & { tab: StreamingTab } => item.tab === 'home' || item.tab === 'library'
  )
)
const currentView = computed(() => visibleTabs.value.find((item) => item.tab === activeTab.value))

function getStreamingTabIndex(key: StreamingTab): number {
  const index = visibleTabs.value.findIndex((tab) => tab.tab === key)
  return index === -1 ? 0 : index
}

const emit = defineEmits<{
  toggleMenu: []
  backToLocal: []
  login: []
}>()

const {
  providerAvailable,
  providerError,
  isLoggedIn,
  profile,
  libraryLoading,
  libraryLoaded,
  libraryError,
  likedPlaylist,
  userPlaylists,
  fetchUserLibrary,
  fetchUserPlaylistsByUid,
  fetchPlaylistTracks,
  fetchLikedTracksPage,
  fetchRecommendSongs,
  fetchRecommendPlaylists,
  fetchPersonalFm,
  fetchPrivateContent,
  searchSongs,
  searchPlaylists,
  searchArtists,
  fetchArtistTopSongs,
  fetchArtistAlbums,
  fetchArtistIntro,
  fetchArtistFollowState,
  fetchAlbumTracks,
  fetchArtistPlaylists,
  fetchUserFollows,
  fetchUserFolloweds,
  fetchPlayRecords,
  fetchRecentSongs,
  followArtist,
  followUser,
  likeTrack,
  isTrackLiked,
  syncLikedIds,
  checkLogin
} = useNcmStore()

const { currentTrack, playTrack, formatTime } = usePlayerStore()

async function searchUnifiedSongs(
  keywords: string,
  limit?: number,
  offset?: number
): Promise<{ tracks: Track[]; total: number }> {
  const result = await mediaProviders.searchAllSongs({
    query: keywords,
    localTracks: musicStore.tracks.value,
    limit,
    offset
  })
  return {
    tracks: result.logicalItems.map((item) => item.preferredTrack),
    total: result.total
  }
}

// ─── Per-provider and local search functions for source switching ──────────

async function searchProviderSongs(
  providerId: string,
  keywords: string,
  limit?: number,
  offset?: number
): Promise<{ tracks: Track[]; total: number }> {
  const result = await mediaProviders.searchSongs(providerId, keywords, limit, offset)
  return { tracks: result.items, total: result.total }
}

async function searchProviderPlaylists(
  providerId: string,
  keywords: string,
  limit?: number,
  offset?: number
): Promise<{ playlists: MediaProviderPlaylistSummary[]; total: number }> {
  const result = await mediaProviders.searchPlaylists(providerId, keywords, limit, offset)
  return { playlists: result.items, total: result.total }
}

async function searchProviderArtists(
  providerId: string,
  keywords: string,
  limit?: number,
  offset?: number
): Promise<{ artists: MediaProviderArtistSummary[]; total: number }> {
  const result = await mediaProviders.searchArtists(providerId, keywords, limit, offset)
  return { artists: result.items, total: result.total }
}

function normalizeLocalQuery(q: string): string {
  return q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

async function searchLocalSongs(
  keywords: string,
  limit: number = 30,
  offset: number = 0
): Promise<{ tracks: Track[]; total: number }> {
  const q = normalizeLocalQuery(keywords.trim())
  if (!q) return { tracks: [], total: 0 }
  const all = musicStore.tracks.value
  const matched = all.filter(
    (t) =>
      normalizeLocalQuery(t.title).includes(q) ||
      normalizeLocalQuery(t.artist).includes(q) ||
      normalizeLocalQuery(t.album).includes(q)
  )
  return { tracks: matched.slice(offset, offset + limit), total: matched.length }
}

async function searchLocalPlaylists(
  keywords: string,
  limit: number = 30,
  offset: number = 0
): Promise<{ playlists: MediaProviderPlaylistSummary[]; total: number }> {
  const q = normalizeLocalQuery(keywords.trim())
  if (!q) return { playlists: [], total: 0 }
  const matched = musicStore.playlists.value.filter((pl) => normalizeLocalQuery(pl.name).includes(q))
  const summaries: MediaProviderPlaylistSummary[] = matched.map((pl) => ({
    id: pl.id,
    name: pl.name,
    cover: null,
    trackCount: pl.trackIds.length
  }))
  return { playlists: summaries.slice(offset, offset + limit), total: summaries.length }
}

async function searchLocalArtists(
  keywords: string,
  limit: number = 30,
  offset: number = 0
): Promise<{ artists: MediaProviderArtistSummary[]; total: number }> {
  const q = normalizeLocalQuery(keywords.trim())
  if (!q) return { artists: [], total: 0 }
  const matched = musicStore.artists.value.filter((a) => normalizeLocalQuery(a.name).includes(q))
  const summaries: MediaProviderArtistSummary[] = matched.map((a) => ({
    id: a.name,
    name: a.name,
    picUrl: a.cover,
    musicSize: a.trackCount
  }))
  return { artists: summaries.slice(offset, offset + limit), total: summaries.length }
}

const searchSources = computed<SearchSourceOption[]>(() => {
  const sources: SearchSourceOption[] = [
    {
      id: 'all',
      label: '全部音源',
      icon: 'pi pi-bolt',
      available: true,
      supportedTypes: ['songs', 'playlists', 'artists']
    },
    {
      id: 'local',
      label: '本地音乐',
      icon: 'pi pi-desktop',
      available: musicStore.tracks.value.length > 0,
      supportedTypes: ['songs', 'playlists', 'artists']
    }
  ]
  for (const provider of providerStore.providers.value) {
    const hasSearch = provider.capabilities.includes('search')
    const hasPlaylist = provider.capabilities.includes('playlist')
    const supportedTypes: SearchSourceOption['supportedTypes'] = []
    if (hasSearch) supportedTypes.push('songs', 'artists')
    if (hasPlaylist) supportedTypes.push('playlists')
    if (supportedTypes.length === 0) continue
    sources.push({
      id: provider.id,
      label: provider.name,
      icon: provider.ui?.icon || 'pi pi-cloud',
      available: provider.health?.available !== false,
      supportedTypes
    })
  }
  return sources
})

const {
  searchQuery,
  searchType,
  searchSource,
  searchResults,
  searchPlaylistsResults,
  searchArtistsResults,
  searchTotal,
  searchOffset,
  searchLoading,
  searchError,
  searchInputFocused,
  isSearching,
  availableSearchTypes,
  clearSearch,
  performSearch,
  onPageChange,
  onSearchTrackClick
} = useStreamingSearch({
  searchSongs,
  searchUnifiedSongs,
  searchPlaylists,
  searchArtists,
  searchProviderSongs,
  searchProviderPlaylists,
  searchProviderArtists,
  searchLocalSongs,
  searchLocalPlaylists,
  searchLocalArtists,
  searchSources,
  playTrack
})

const sourceMenuOpen = ref(false)
const activeSourceOption = computed(() =>
  searchSources.value.find((s) => s.id === searchSource.value) ?? searchSources.value[0] ?? null
)
function selectSearchSource(sourceId: SearchSource): void {
  const source = searchSources.value.find((s) => s.id === sourceId)
  if (!source || !source.available) return
  searchSource.value = sourceId
  sourceMenuOpen.value = false
}

function closeSourceMenuDelayed(): void {
  setTimeout(() => { sourceMenuOpen.value = false }, 150)
}

// Like button state
const likingTracks = ref<Set<number>>(new Set())

async function onLikeTrack(track: Track, event: MouseEvent): Promise<void> {
  event.stopPropagation()
  const songId = track.ncmSongId
  if (songId == null || likingTracks.value.has(songId)) return
  const currentlyLiked = isTrackLiked(songId)
  likingTracks.value = new Set([...likingTracks.value, songId])
  try {
    await likeTrack(songId, !currentlyLiked)
  } finally {
    const next = new Set(likingTracks.value)
    next.delete(songId)
    likingTracks.value = next
  }
}

const activeProfile = computed(() =>
  isExternalActive.value ? (activeExternalState.value?.profile ?? null) : profile.value
)
const activeLoggedIn = computed(() =>
  isExternalActive.value ? (activeExternalState.value?.loggedIn ?? false) : isLoggedIn.value
)
const activeProviderAvailable = computed(() =>
  isExternalActive.value
    ? isProviderAvailable(activeProvider.value)
    : ncmNavigationAvailable.value && providerAvailable.value
)
const activeProviderError = computed(() =>
  isExternalActive.value ? (activeExternalState.value?.libraryError ?? '') : providerError.value
)
const activeLibraryLoaded = computed(() =>
  isExternalActive.value ? (activeExternalState.value?.libraryLoaded ?? false) : libraryLoaded.value
)
const activeLibraryError = computed(() =>
  isExternalActive.value ? (activeExternalState.value?.libraryError ?? '') : libraryError.value
)
const activeProviderUnavailable = computed(() => {
  const error = activeProviderError.value
  return /Provider 未启用|provider is disabled|does not implement/i.test(error)
})
const showUnifiedSearch = computed(() => hasOnlineNavigationEntries.value && activeProviderAvailable.value && activeLoggedIn.value)
const trackUnitLabel = computed(() => (isExternalActive.value ? '项' : '首歌曲'))
const profileSignature = computed(() => activeProfile.value?.signature?.trim() || '暂无个人简介')
const unifiedFavoriteTracks = computed(() => musicStore.getPlaylistTracks('我收藏的音乐'))
const showActiveLikedPanel = computed(
  () =>
    !isExternalActive.value ||
    unifiedFavoriteTracks.value.length > 0 ||
    Boolean(activeExternalState.value?.likedPlaylist)
)

const headerTitle = computed(() => {
  if (isExternalActive.value && currentDetail.value?.type === 'playlist')
    return currentDetail.value.playlist.name
  if (isExternalActive.value) return activeProviderLabel.value
  if (isSearching.value) return `搜索: ${searchQuery.value.trim()}`
  if (currentDetail.value?.type === 'rec') return currentDetail.value.section.title
  if (currentDetail.value?.type === 'liked') return '我收藏的歌曲'
  if (currentDetail.value?.type === 'recent') return '最近播放'
  if (currentDetail.value?.type === 'ranking') return '听歌排行'
  if (currentDetail.value?.type === 'playlist') return currentDetail.value.playlist.name
  if (currentDetail.value?.type === 'album') return currentDetail.value.album.name
  return currentView.value?.label ?? '流媒体'
})
const headerSubtitle = computed(() => {
  if (isExternalActive.value)
    return activeLoggedIn.value ? '已登录账号的音乐库' : '登录后展示全部音乐库'
  return timeGreeting.value
})

const timeGreeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 5) return '夜深了，放一首安静的歌'
  if (hour < 11) return '早上好，开启美好的一天'
  if (hour < 14) return '中午好，让音乐陪你休息'
  if (hour < 18) return '下午好，继续享受音乐'
  if (hour < 22) return '晚上好，放松一下'
  return '夜深了，放一首安静的歌'
})
const rootLoading = computed(() =>
  isExternalActive.value
    ? (activeExternalState.value?.libraryLoading ?? false) && !currentDetail.value
    : libraryLoading.value && !currentDetail.value
)

const likedSummary = computed(() => {
  const unifiedTracks = unifiedFavoriteTracks.value
  if (isExternalActive.value) {
    const state = activeExternalState.value
    return summarizeUnifiedFavorites({
      unifiedTracks,
      providerSummary: {
        name: state?.likedPlaylist?.name ?? '我喜欢的音乐',
        cover: state?.likedPlaylist?.cover ?? null,
        trackCount: state?.likedPlaylist?.trackCount ?? 0
      }
    })
  }
  return summarizeUnifiedFavorites({
    unifiedTracks,
    providerSummary: {
      name: '我收藏的歌曲',
      cover: likedPlaylist.value?.cover ?? null,
      trackCount: likedCount.value ?? likedPlaylist.value?.trackCount ?? 0
    }
  })
})

const userPlaylistEntries = computed(() =>
  isExternalActive.value ? (activeExternalState.value?.playlists ?? []) : userPlaylists.value
)

const currentArtistPlaylists = computed(() =>
  currentDetail.value?.type === 'artist' ? artistPlaylists.value : []
)
const currentArtistAlbums = computed(() =>
  currentDetail.value?.type === 'artist' ? artistAlbums.value : []
)
const artistDetailTabs = computed<Array<{ key: ArtistDetailTab; label: string; count: number }>>(
  () => [
    { key: 'songs', label: '全部歌曲', count: detailTracks.value.length },
    { key: 'albums', label: '专辑', count: currentArtistAlbums.value.length },
    { key: 'playlists', label: '创建的歌单', count: currentArtistPlaylists.value.length }
  ]
)
const hasTrackDetailLoadingSurface = computed(
  () =>
    currentDetail.value?.type === 'liked' ||
    currentDetail.value?.type === 'playlist' ||
    currentDetail.value?.type === 'album' ||
    currentDetail.value?.type === 'artist' ||
    currentDetail.value?.type === 'ranking'
)
const showDetailInitialLoading = computed(
  () =>
    hasTrackDetailLoadingSurface.value &&
    detailLoading.value &&
    detailTracks.value.length === 0 &&
    currentArtistAlbums.value.length === 0 &&
    currentArtistPlaylists.value.length === 0
)
const showDetailOverlayLoading = computed(
  () => detailLoading.value && !showDetailInitialLoading.value
)
const detailTrackCountLabel = computed(() => {
  if (currentDetail.value?.type === 'liked' && likedTracksTotal.value != null) {
    return `${detailTracks.value.length} / ${likedTracksTotal.value} 首`
  }
  return `${detailTracks.value.length} 首`
})

const detailHeaderInfo = computed<DetailHeaderInfo | null>(() => {
  if (!currentDetail.value) return null
  if (currentDetail.value.type === 'liked') {
    return {
      title: '我收藏的歌曲',
      cover: likedSummary.value.cover,
      desc: `共 ${likedSummary.value.trackCount} 首歌曲`,
      icon: 'pi pi-heart-fill'
    }
  }
  if (currentDetail.value.type === 'playlist') {
    return {
      title: currentDetail.value.playlist.name,
      cover: currentDetail.value.playlist.cover,
      desc: `共 ${currentDetail.value.playlist.trackCount} ${trackUnitLabel.value}`,
      icon: 'pi pi-list'
    }
  }
  if (currentDetail.value.type === 'rec') {
    return {
      title: currentDetail.value.section.title,
      cover:
        currentDetail.value.section.tracks.length > 0
          ? currentDetail.value.section.tracks[0].cover
          : null,
      desc: `共 ${currentDetail.value.section.tracks.length} ${trackUnitLabel.value}`,
      icon: currentDetail.value.section.icon
    }
  }
  if (currentDetail.value.type === 'album') {
    return {
      title: currentDetail.value.album.name,
      cover: currentDetail.value.album.cover,
      desc: `共 ${detailTracks.value.length || currentDetail.value.album.trackCount} 首歌曲`,
      icon: 'pi pi-clone'
    }
  }
  if (currentDetail.value.type === 'artist') {
    const songCount = detailTracks.value.length
    const albumCount = artistAlbums.value.length
    const playlistCount = artistPlaylists.value.length
    const descParts: string[] = []
    if (songCount > 0) descParts.push(`${songCount} 首歌曲`)
    if (albumCount > 0) descParts.push(`${albumCount} 张专辑`)
    if (playlistCount > 0) descParts.push(`${playlistCount} 个歌单`)
    return {
      title: currentDetail.value.artist.name,
      cover: currentDetail.value.artist.picUrl,
      desc: descParts.length > 0 ? `共 ${descParts.join('，')}` : '暂无可展示内容',
      intro: artistIntro.value,
      icon: 'pi pi-user'
    }
  }
  if (currentDetail.value.type === 'user_list') {
    return {
      title: currentDetail.value.title,
      cover: null,
      desc: `共 ${currentDetail.value.users.length} 人`,
      icon: 'pi pi-users'
    }
  }
  if (currentDetail.value.type === 'user_playlists') {
    return {
      title: currentDetail.value.user.name + ' 的歌单',
      cover: currentDetail.value.user.picUrl,
      desc: `共 ${currentDetail.value.playlists.length} 个歌单`,
      icon: 'pi pi-user'
    }
  }
  if (currentDetail.value.type === 'recent') {
    return {
      title: '最近播放',
      cover: detailTracks.value.length > 0 ? detailTracks.value[0].cover : null,
      desc: `共 ${detailTracks.value.length} 首歌曲`,
      icon: 'pi pi-history'
    }
  }
  if (currentDetail.value.type === 'ranking') {
    return {
      title: '听歌排行',
      cover: detailTracks.value.length > 0 ? detailTracks.value[0].cover : null,
      desc: `共 ${detailTracks.value.length} 首歌曲`,
      icon: 'pi pi-chart-bar'
    }
  }
  return null
})

const detailFollowState = computed<boolean>(() => {
  if (currentDetail.value?.type === 'artist') return artistFollowed.value === true
  if (currentDetail.value?.type === 'user_playlists') return currentDetail.value.user.followed === true
  return false
})

const showDetailFollowButton = computed(
  () => currentDetail.value?.type === 'artist' || currentDetail.value?.type === 'user_playlists'
)

const detailFollowButtonLabel = computed(() =>
  detailFollowState.value ? '取消关注' : '关注'
)

const detailFollowButtonIcon = computed(() =>
  followActionLoading.value
    ? 'pi pi-spin pi-spinner'
    : detailFollowState.value
      ? 'pi pi-user-minus'
      : 'pi pi-user-plus'
)

function selectTab(key: StreamingTab): void {
  if (isExternalActive.value && key !== 'library' && key !== 'recent') return
  if (activeTab.value !== key) {
    const oldIndex = getStreamingTabIndex(activeTab.value)
    const newIndex = getStreamingTabIndex(key)
    streamingTransitionName.value = newIndex > oldIndex ? 'stream-page-down' : 'stream-page-up'
    resetDetail()
  }
  activeTab.value = key
}

function selectProvider(provider: string, persist = true): void {
  if (!persist) {
    fallbackProvider.value = provider
    return
  }
  fallbackProvider.value = null
  if (preferredProvider.value === provider) return
  // Only an explicit user action changes the persisted preference; availability
  // fallbacks never write back, so the choice survives restarts and plugin toggles.
  preferredProvider.value = provider
  void settingsStore.updateSettings({ streamingActiveProvider: provider })
}

function isSidebarItemActive(item: SidebarItem): boolean {
  if (item.tab === 'library') {
    return (
      activeTab.value === 'library' &&
      libraryProviders.value.some((provider) => provider.id === activeProvider.value)
    )
  }
  return isSidebarItemActiveForProvider({
    itemProvider: item.provider,
    itemKey: item.key,
    activeProvider: activeProvider.value,
    activeTab: activeTab.value
  })
}

function getSharedLibraryProviderId(): string {
  if (libraryProviders.value.some((provider) => provider.id === activeProvider.value)) {
    return activeProvider.value
  }
  return libraryProviders.value[0]?.id ?? NCM_PROVIDER_ID
}

function selectSidebarItem(item: SidebarItem, options: { persistProvider?: boolean } = {}): void {
  const persistProvider = options.persistProvider !== false
  if (item.tab === 'recent') {
    selectTab('recent')
    void openRecent()
    return
  }
  if (item.tab === 'library') {
    const provider = getSharedLibraryProviderId()
    if (activeProvider.value !== provider) {
      selectProvider(provider, persistProvider)
    }
    selectTab('library')
    return
  }
  if (item.provider !== NCM_PROVIDER_ID) {
    selectProvider(item.provider, persistProvider)
    selectTab(item.tab ?? 'library')
    return
  }
  if (activeProvider.value !== NCM_PROVIDER_ID) {
    selectProvider(NCM_PROVIDER_ID, persistProvider)
  }
  if (item.tab) selectTab(item.tab)
}

function resetDetail(): void {
  detailLoadToken++
  if (currentDetail.value) {
    streamingTransitionName.value = 'stream-page-up'
  }
  currentDetail.value = null
  detailTracks.value = []
  detailUsers.value = []
  artistAlbums.value = []
  artistPlaylists.value = []
  artistIntro.value = ''
  artistFollowed.value = null
  activeArtistTab.value = 'songs'
  detailLoading.value = false
  detailError.value = ''
  resetLikedTracksPaging()
  followActionLoading.value = false
  followActionError.value = ''
}

function resetLikedTracksPaging(): void {
  likedTracksNextOffset.value = 0
  likedTracksTotal.value = null
  likedTracksHasMore.value = false
  likedTracksLoadingMore.value = false
  likedTracksLoadMoreError.value = ''
}

function getSidebarItemsSignature(): string {
  return sidebarItems.value
    .map((item) => `${item.key}:${item.provider}:${item.tab ?? 'external'}`)
    .join('|')
}

function ensureVisibleSidebarSelection(): void {
  if (!hasOnlineNavigationEntries.value) {
    fallbackProvider.value = null
    resetDetail()
    clearSearch()
    return
  }
  if (sidebarItems.value.some((item) => isSidebarItemActive(item))) {
    return
  }
  const firstTab = getFirstVisibleStreamingTab(sidebarItems.value)
  const nextItem = firstTab
    ? sidebarItems.value.find((item) => item.tab === firstTab)
    : sidebarItems.value[0]
  if (nextItem) {
    selectSidebarItem(nextItem, { persistProvider: false })
  }
}

function beginDetailLoad(): number {
  const token = ++detailLoadToken
  detailTracks.value = []
  detailUsers.value = []
  artistAlbums.value = []
  artistPlaylists.value = []
  artistIntro.value = ''
  artistFollowed.value = null
  detailLoading.value = true
  detailError.value = ''
  resetLikedTracksPaging()
  followActionError.value = ''
  return token
}

function isActiveDetailLoad(token: number): boolean {
  return token === detailLoadToken
}

function mergePlaylistSummaries(...groups: NcmPlaylistSummary[][]): NcmPlaylistSummary[] {
  const seen = new Set<number>()
  const merged: NcmPlaylistSummary[] = []
  for (const group of groups) {
    for (const playlist of group) {
      if (seen.has(playlist.id)) continue
      seen.add(playlist.id)
      merged.push(playlist)
    }
  }
  return merged
}

async function findArtistByUserName(user: NcmUserSummary): Promise<NcmArtistSummary | null> {
  const keyword = user.name.trim()
  if (!keyword) return null
  const { artists } = await searchArtists(keyword, 8, 0)
  return findBestStreamingArtistMatch(keyword, artists)
}

async function ensureLibraryLoaded(force = false): Promise<void> {
  if (isExternalActive.value) {
    await ensureExternalLibraryLoaded(activeProvider.value, force)
    return
  }
  if (!isLoggedIn.value) return
  try {
    await fetchUserLibrary(force)
  } catch {
    // error is already stored in libraryError
  }
}

function externalProviderName(id: string): string {
  return providerStore.getProvider(id)?.name ?? id
}

async function refreshExternalProviderState(id: string): Promise<void> {
  await providerStore.syncProviders().catch(() => undefined)
  const state = ensureExternalState(id)
  if (!isProviderAvailable(id)) {
    state.loggedIn = false
    state.profile = null
    state.playlists = []
    state.likedPlaylist = null
    state.pinnedPlaylistIds = []
    state.libraryLoaded = false
    state.libraryError = ''
    return
  }
  try {
    const loginState = await providerStore.checkLogin(id)
    state.loggedIn = loginState.loggedIn
    state.profile = loginState.profile ?? null
    if (!loginState.loggedIn) {
      state.playlists = []
      state.likedPlaylist = null
      state.pinnedPlaylistIds = []
      state.libraryLoaded = false
    }
    state.libraryError = ''
  } catch (error) {
    state.loggedIn = false
    state.profile = null
    state.libraryError =
      error instanceof Error ? error.message : `${externalProviderName(id)} 登录状态检查失败`
  }
}

async function ensureExternalLibraryLoaded(id: string, force = false): Promise<void> {
  const state = ensureExternalState(id)
  if (!isProviderAvailable(id) || !state.loggedIn) return
  if (state.libraryLoaded && !force) return
  state.libraryLoading = true
  state.libraryError = ''
  try {
    const library = await providerStore.fetchUserLibrary(id, force)
    state.likedPlaylist = library.likedPlaylist ?? null
    state.playlists = library.playlists
    state.pinnedPlaylistIds = library.playlists
      .filter((playlist) => {
        const playlistWithPinned = playlist as MediaProviderPlaylistSummary & { pinned?: boolean }
        return playlistWithPinned.pinned === true
      })
      .map((playlist) => String(playlist.id))
    state.libraryLoaded = true
  } catch (error) {
    state.libraryError =
      error instanceof Error ? error.message : `加载 ${externalProviderName(id)} 音乐库失败`
  } finally {
    state.libraryLoading = false
  }
}

async function openLikedTracks(force = false): Promise<void> {
  const unifiedTracks = unifiedFavoriteTracks.value
  if (unifiedTracks.length > 0) {
    streamingTransitionName.value = 'stream-page-down'
    currentDetail.value = { type: 'liked' }
    detailTracks.value = resolveUnifiedFavoriteTracks({
      unifiedTracks,
      providerTracks: []
    }).tracks
    likedCount.value = detailTracks.value.length
    detailError.value = ''
    detailLoading.value = false
    return
  }

  // External providers (e.g. YouTube Music) expose liked music as a playlist
  // (ytm's "LM"), so open it through the generic playlist path rather than the
  // ncm-only fetchLikedTracks.
  if (isExternalActive.value) {
    const liked = activeExternalState.value?.likedPlaylist
    if (liked) {
      await openPlaylist(liked, force)
      return
    }
    streamingTransitionName.value = 'stream-page-down'
    currentDetail.value = { type: 'liked' }
    detailTracks.value = []
    detailLoading.value = false
    return
  }

  streamingTransitionName.value = 'stream-page-down'
  currentDetail.value = { type: 'liked' }
  const token = beginDetailLoad()

  try {
    const page = await fetchLikedTracksPage(0, LIKED_TRACKS_PAGE_SIZE, force)
    if (!isActiveDetailLoad(token)) return
    detailTracks.value = page.tracks
    likedCount.value = page.total
    likedTracksTotal.value = page.total
    likedTracksNextOffset.value = page.nextOffset
    likedTracksHasMore.value = page.hasMore
    syncLikedIds(page.tracks)
    await nextTick()
    void ensureLikedTracksScrollable()
  } catch (error) {
    if (!isActiveDetailLoad(token)) return
    detailError.value = error instanceof Error ? error.message : '加载收藏歌曲失败'
    detailTracks.value = []
  } finally {
    if (isActiveDetailLoad(token)) {
      detailLoading.value = false
    }
  }
}

async function loadMoreLikedTracks(): Promise<void> {
  if (currentDetail.value?.type !== 'liked') return
  if (isExternalActive.value) return
  if (likedTracksLoadingMore.value || !likedTracksHasMore.value) return

  const token = detailLoadToken
  likedTracksLoadingMore.value = true
  likedTracksLoadMoreError.value = ''

  try {
    const page = await fetchLikedTracksPage(
      likedTracksNextOffset.value,
      LIKED_TRACKS_PAGE_SIZE,
      false
    )
    if (!isActiveDetailLoad(token) || currentDetail.value?.type !== 'liked') return
    const existing = new Set(detailTracks.value.map((track) => track.id))
    const nextTracks = page.tracks.filter((track) => !existing.has(track.id))
    detailTracks.value = [...detailTracks.value, ...nextTracks]
    likedCount.value = page.total
    likedTracksTotal.value = page.total
    likedTracksNextOffset.value = page.nextOffset
    likedTracksHasMore.value = page.hasMore
    syncLikedIds(page.tracks)
    await nextTick()
    void ensureLikedTracksScrollable()
  } catch (error) {
    if (!isActiveDetailLoad(token)) return
    likedTracksLoadMoreError.value = error instanceof Error ? error.message : '继续加载收藏歌曲失败'
  } finally {
    if (isActiveDetailLoad(token)) {
      likedTracksLoadingMore.value = false
    }
  }
}

async function ensureLikedTracksScrollable(): Promise<void> {
  await nextTick()
  const element = streamingContentRef.value
  if (!element) return
  if (currentDetail.value?.type !== 'liked' || !likedTracksHasMore.value) return
  if (likedTracksLoadingMore.value) return
  if (element.scrollHeight > element.clientHeight + 48) return
  await loadMoreLikedTracks()
}

async function openPlaylist(playlist: MediaProviderPlaylistSummary, force = false): Promise<void> {
  streamingTransitionName.value = 'stream-page-down'
  currentDetail.value = { type: 'playlist', playlist }
  const token = beginDetailLoad()

  try {
    const tracks = isExternalActive.value
      ? await providerStore.fetchPlaylistTracks(activeProvider.value, playlist.id, force)
      : await fetchPlaylistTracks(playlist.id, force)
    if (!isActiveDetailLoad(token)) return
    detailTracks.value = tracks
  } catch (error) {
    if (!isActiveDetailLoad(token)) return
    detailError.value = error instanceof Error ? error.message : '加载列表失败'
    detailTracks.value = []
  } finally {
    if (isActiveDetailLoad(token)) {
      detailLoading.value = false
    }
  }
}

async function openAlbum(album: NcmAlbumSummary): Promise<void> {
  streamingTransitionName.value = 'stream-page-down'
  currentDetail.value = { type: 'album', album }
  const token = beginDetailLoad()

  try {
    const tracks = await fetchAlbumTracks(album.id)
    if (!isActiveDetailLoad(token)) return
    detailTracks.value = tracks
  } catch (error) {
    if (!isActiveDetailLoad(token)) return
    detailError.value = error instanceof Error ? error.message : '加载专辑失败'
    detailTracks.value = []
  } finally {
    if (isActiveDetailLoad(token)) {
      detailLoading.value = false
    }
  }
}

async function openArtist(artist: MediaProviderArtistSummary, linkedUser?: NcmUserSummary): Promise<void> {
  const ncmArtist: NcmArtistSummary = {
    id: Number(artist.id),
    name: artist.name,
    picUrl: artist.picUrl,
    albumSize: artist.albumSize ?? 0,
    musicSize: artist.musicSize ?? 0
  }
  streamingTransitionName.value = 'stream-page-down'
  currentDetail.value = { type: 'artist', artist: ncmArtist, user: linkedUser }
  activeArtistTab.value = 'songs'
  const token = beginDetailLoad()

  try {
    let resolvedArtist = await resolveLinkedStreamingArtist(
      ncmArtist,
      linkedUser,
      findArtistByUserName
    )
    let [
      tracks,
      albums,
      artistOwnedPlaylists,
      userOwnedPlaylists,
      intro,
      followed
    ] = await Promise.all([
      fetchArtistTopSongs(resolvedArtist.id).catch(() => [] as Track[]),
      fetchArtistAlbums(resolvedArtist.id).catch(() => [] as NcmAlbumSummary[]),
      fetchArtistPlaylists(resolvedArtist.id).catch(() => [] as NcmPlaylistSummary[]),
      linkedUser
        ? fetchUserPlaylistsByUid(linkedUser.id, true).catch(() => [] as NcmPlaylistSummary[])
        : Promise.resolve([] as NcmPlaylistSummary[]),
      fetchArtistIntro(resolvedArtist.id).catch(() => ''),
      fetchArtistFollowState(resolvedArtist.id).catch(() => null)
    ])

    if (linkedUser && resolvedArtist.id === artist.id && tracks.length === 0) {
      const matchedArtist = await findArtistByUserName(linkedUser).catch(() => null)
      if (matchedArtist && matchedArtist.id !== artist.id) {
        const [
          matchedTracks,
          matchedAlbums,
          matchedPlaylists,
          matchedIntro,
          matchedFollowed
        ] = await Promise.all([
          fetchArtistTopSongs(matchedArtist.id).catch(() => [] as Track[]),
          fetchArtistAlbums(matchedArtist.id).catch(() => [] as NcmAlbumSummary[]),
          fetchArtistPlaylists(matchedArtist.id).catch(() => [] as NcmPlaylistSummary[]),
          fetchArtistIntro(matchedArtist.id).catch(() => ''),
          fetchArtistFollowState(matchedArtist.id).catch(() => null)
        ])
        if (matchedTracks.length > 0 || matchedAlbums.length > 0 || matchedPlaylists.length > 0) {
          resolvedArtist = {
            ...matchedArtist,
            picUrl: matchedArtist.picUrl ?? artist.picUrl
          }
          tracks = matchedTracks
          albums = matchedAlbums
          artistOwnedPlaylists = mergePlaylistSummaries(artistOwnedPlaylists, matchedPlaylists)
          intro = matchedIntro
          followed = matchedFollowed
        }
      }
    }

    if (!isActiveDetailLoad(token)) return
    if (currentDetail.value?.type === 'artist') {
      currentDetail.value.artist = resolvedArtist
    }
    detailTracks.value = tracks
    artistAlbums.value = albums
    artistPlaylists.value = mergePlaylistSummaries(artistOwnedPlaylists, userOwnedPlaylists)
    artistIntro.value = intro
    artistFollowed.value = followed
  } catch (error) {
    if (!isActiveDetailLoad(token)) return
    detailError.value = error instanceof Error ? error.message : '加载歌手页面失败'
    detailTracks.value = []
    artistAlbums.value = []
    artistPlaylists.value = []
  } finally {
    if (isActiveDetailLoad(token)) {
      detailLoading.value = false
    }
  }
}

async function openUserList(listType: 'follows' | 'followers'): Promise<void> {
  if (!profile.value) return
  streamingTransitionName.value = 'stream-page-down'
  currentDetail.value = {
    type: 'user_list',
    listType,
    users: [],
    title: listType === 'follows' ? '关注' : '粉丝'
  }
  const token = beginDetailLoad()

  try {
    const uid = profile.value.userId
    const fetchFunc = listType === 'follows' ? fetchUserFollows : fetchUserFolloweds
    const users = await fetchFunc(uid, 100, 0)
    if (!isActiveDetailLoad(token)) return
    detailUsers.value = users
    if (currentDetail.value.type === 'user_list') {
      currentDetail.value.users = detailUsers.value
    }
  } catch (error) {
    if (!isActiveDetailLoad(token)) return
    detailError.value =
      error instanceof Error
        ? error.message
        : `加载${listType === 'follows' ? '关注' : '粉丝'}列表失败`
  } finally {
    if (isActiveDetailLoad(token)) {
      detailLoading.value = false
    }
  }
}

async function openUserPlaylists(user: NcmUserSummary): Promise<void> {
  streamingTransitionName.value = 'stream-page-down'
  currentDetail.value = { type: 'user_playlists', user, playlists: [] }
  const token = beginDetailLoad()

  try {
    const playlists = await fetchUserPlaylistsByUid(user.id)
    if (!isActiveDetailLoad(token)) return
    if (currentDetail.value.type === 'user_playlists') {
      currentDetail.value.playlists = playlists
    }
  } catch (error) {
    if (!isActiveDetailLoad(token)) return
    detailError.value = error instanceof Error ? error.message : '加载用户歌单失败'
  } finally {
    if (isActiveDetailLoad(token)) {
      detailLoading.value = false
    }
  }
}

async function openRecent(): Promise<void> {
  streamingTransitionName.value = 'stream-page-down'
  currentDetail.value = { type: 'recent' }
  const token = beginDetailLoad()

  try {
    const recentStats = getRecentTracks()
    const providerId = activeProvider.value
    const filteredStats = recentStats.filter(
      (stat) => stat.sourceIds?.some((sid) => sid.source === providerId)
    )
    let tracks = resolveUnifiedRecentTracks({
      recentStats: filteredStats,
      localTracks: musicStore.tracks.value
    })
    if (providerId === NCM_PROVIDER_ID) {
      const serverRecent = await fetchRecentSongs().catch(() => [] as Track[])
      const seenIds = new Set(tracks.map((t) => t.id))
      for (const t of serverRecent) {
        if (!seenIds.has(t.id)) {
          tracks.push(t)
          seenIds.add(t.id)
        }
      }
    }

    if (!isActiveDetailLoad(token)) return
    detailTracks.value = tracks
  } catch (error) {
    if (!isActiveDetailLoad(token)) return
    detailError.value = error instanceof Error ? error.message : '加载最近播放失败'
    detailTracks.value = []
  } finally {
    if (isActiveDetailLoad(token)) {
      detailLoading.value = false
    }
  }
}

async function openRanking(): Promise<void> {
  streamingTransitionName.value = 'stream-page-down'
  currentDetail.value = { type: 'ranking' }
  const token = beginDetailLoad()

  try {
    const topStats = getTopTracks()
    let tracks = resolveUnifiedRecentTracks({
      recentStats: topStats,
      localTracks: musicStore.tracks.value
    })
    if (tracks.length === 0) {
      tracks = await fetchPlayRecords(1)
    }
    if (!isActiveDetailLoad(token)) return
    detailTracks.value = tracks
  } catch (error) {
    if (!isActiveDetailLoad(token)) return
    detailError.value = error instanceof Error ? error.message : '加载听歌排行失败'
    detailTracks.value = []
  } finally {
    if (isActiveDetailLoad(token)) {
      detailLoading.value = false
    }
  }
}

async function onUserClick(user: NcmUserSummary): Promise<void> {
  const artistId = Number(user.artistId ?? user.id)
  if ((user.userType === 2 || user.userType === 4 || user.userType === 6) && Number.isFinite(artistId) && artistId > 0) {
    await openArtist({
      id: artistId,
      name: user.name,
      picUrl: user.picUrl,
      albumSize: 0,
      musicSize: user.musicSize
    }, user)
  } else {
    await openUserPlaylists(user)
  }
}

async function toggleCurrentDetailFollow(): Promise<void> {
  const detail = currentDetail.value
  if (!detail || followActionLoading.value) return
  const nextFollowState = !detailFollowState.value
  followActionLoading.value = true
  followActionError.value = ''
  try {
    if (detail.type === 'artist') {
      await followArtist(detail.artist.id, nextFollowState)
      artistFollowed.value = nextFollowState
      return
    }
    if (detail.type === 'user_playlists') {
      await followUser(detail.user.id, nextFollowState)
      detail.user.followed = nextFollowState
    }
  } catch (error) {
    followActionError.value =
      error instanceof Error ? error.message : nextFollowState ? '关注失败' : '取消关注失败'
  } finally {
    followActionLoading.value = false
  }
}

function goBack(): void {
  resetDetail()
}

function onTrackClick(track: Track): void {
  playTrack(track, detailTracks.value)
}

function onStreamingContentScroll(event: Event): void {
  const element = event.currentTarget as HTMLElement | null
  if (!element || currentDetail.value?.type !== 'liked') return
  if (!likedTracksHasMore.value || likedTracksLoadingMore.value) return
  const scrollable = element.scrollHeight - element.clientHeight
  if (scrollable <= 0) return
  const ratio = (element.scrollTop + element.clientHeight) / element.scrollHeight
  if (ratio >= LIKED_TRACKS_LOAD_THRESHOLD) {
    void loadMoreLikedTracks()
  }
}

async function playLikedSongs(): Promise<void> {
  // For external providers the liked view is a playlist detail; detect it so we
  // don't re-open it on every play click.
  const likedId = activeExternalState.value?.likedPlaylist?.id
  const isViewingLiked =
    currentDetail.value?.type === 'liked' ||
    (isExternalActive.value &&
      currentDetail.value?.type === 'playlist' &&
      currentDetail.value.playlist.id === likedId)
  if (!isViewingLiked) {
    await openLikedTracks()
  }
  if (detailTracks.value.length > 0) {
    playTrack(detailTracks.value[0], detailTracks.value)
  }
}

async function retryCurrentView(): Promise<void> {
  if (currentDetail.value?.type === 'liked') {
    await openLikedTracks(true)
    return
  }
  if (currentDetail.value?.type === 'playlist') {
    await openPlaylist(currentDetail.value.playlist, true)
    return
  }
  if (currentDetail.value?.type === 'album') {
    await openAlbum(currentDetail.value.album)
    return
  }
  if (currentDetail.value?.type === 'artist') {
    await openArtist(currentDetail.value.artist)
    return
  }
  if (currentDetail.value?.type === 'recent') {
    await openRecent()
    return
  }
  if (currentDetail.value?.type === 'ranking') {
    await openRanking()
    return
  }
  await ensureLibraryLoaded(true)
}

// Keep preferredProvider in sync with persisted settings (initial load and
// any external change). This is how the app restores the user's last provider
// choice after restart.
watch(
  () => settingsStore.settings.value.streamingActiveProvider,
  (pref) => {
    if (typeof pref === 'string' && pref && pref !== preferredProvider.value) {
      preferredProvider.value = pref
    }
  }
)

watch(
  getSidebarItemsSignature,
  () => {
    ensureVisibleSidebarSelection()
  },
  { flush: 'post' }
)

// Side effects of switching the resolved active provider (user toggle, plugin
// enable/disable, or restore after restart). activeProvider falls back to the
// first provider that can back the current streaming surface, so we only act
// on real changes.
watch(activeProvider, async (provider, oldProvider) => {
  if (provider === oldProvider) return
  resetDetail()
  clearSearch()
  if (provider === NCM_PROVIDER_ID) {
    if (!ncmNavigationAvailable.value) return
    if (activeTab.value === 'home' && isLoggedIn.value) {
      loadRecommendations()
    } else if (activeTab.value === 'library') {
      await ensureLibraryLoaded()
    }
    return
  }
  // External provider: default to the library tab and load its state.
  const providerInfo = providerStore.getProvider(provider)
  if (providerInfo?.ui?.streamingLibraryTab !== false) {
    activeTab.value = 'library'
  }
  await refreshExternalProviderState(provider)
  await ensureExternalLibraryLoaded(provider)
})

watch(activeTab, async (tab) => {
  if (isExternalActive.value) {
    if (tab !== 'library') {
      activeTab.value = 'library'
      return
    }
    const state = ensureExternalState(activeProvider.value)
    if (state.loggedIn) await ensureExternalLibraryLoaded(activeProvider.value)
    return
  }
  if (!ncmNavigationAvailable.value) return
  if (tab === 'home' && isLoggedIn.value) {
    loadRecommendations()
  }
  if (tab === 'library' && isLoggedIn.value) {
    await ensureLibraryLoaded()
  }
})

watch(
  () => isLoggedIn.value,
  async (loggedIn) => {
    if (!loggedIn) {
      resetDetail()
      likedCount.value = null
      dailySongs.value = []
      personalFmSongs.value = []
      privateContentSongs.value = []
      return
    }
    if (isExternalActive.value) return
    if (!ncmNavigationAvailable.value) return
    if (activeTab.value === 'home') {
      loadRecommendations()
    }
    if (activeTab.value === 'library') {
      await ensureLibraryLoaded(true)
    }
  }
)

onMounted(async () => {
  await providerStore.syncProviders().catch(() => undefined)
  // syncProviders may have resolved the preferred external provider, in which
  // case the activeProvider watcher above already handles the initial load.
  if (activeProvider.value === NCM_PROVIDER_ID) {
    if (!ncmNavigationAvailable.value) return
    await checkLogin()
    if (activeTab.value === 'home' && isLoggedIn.value) {
      loadRecommendations()
    } else if (activeTab.value === 'library') {
      await ensureLibraryLoaded()
    }
    return
  }
  // External provider active (e.g. returning from a successful login on the
  // login page): re-check login state and load the library. The provider id
  // didn't change, so the activeProvider watcher won't fire — we must refresh
  // explicitly here, otherwise a just-completed login wouldn't be reflected.
  await refreshExternalProviderState(activeProvider.value)
  if (activeExternalState.value?.loggedIn) {
    await ensureExternalLibraryLoaded(activeProvider.value)
  }
})
</script>

<template>
  <div class="streaming-page" :class="{ 'has-player': hasPlayer }">
    <div
      class="streaming-sidebar"
      :class="{ open: menuOpen }"
    >
      <div class="streaming-sidebar-inner">
        <div class="streaming-sidebar-header">
          <span class="streaming-sidebar-title">流媒体</span>
        </div>
        <nav class="streaming-nav">
          <div
            v-for="item in sidebarItems"
            :key="item.key"
            class="streaming-menu-item"
            :class="{ active: isSidebarItemActive(item) }"
            @click="selectSidebarItem(item)"
          >
            <i class="streaming-menu-icon" :class="item.icon"></i>
            <span class="streaming-menu-label">{{ item.label }}</span>
          </div>
        </nav>
        <div class="streaming-sidebar-bottom">
          <div class="streaming-menu-separator"></div>
          <div class="streaming-menu-item streaming-local-btn" @click="emit('backToLocal')">
            <i class="streaming-menu-icon pi pi-desktop"></i>
            <span class="streaming-menu-label">本地模式</span>
          </div>
        </div>
      </div>
    </div>

    <div
      ref="streamingContentRef"
      class="streaming-content"
      @scroll="onStreamingContentScroll"
    >
      <div class="streaming-content-header">
        <div class="streaming-header-left">
          <button
            v-if="currentDetail || isSearching"
            class="btn-back"
            title="返回"
            @click="currentDetail ? goBack() : clearSearch()"
          >
            <i class="pi pi-arrow-left"></i>
          </button>
          <div>
            <h2 class="streaming-content-title">{{ headerTitle }}</h2>
            <p
              v-if="activeTab === 'home' && !currentDetail && !isSearching"
              class="streaming-content-subtitle"
            >
              {{ headerSubtitle }}
            </p>
            <p
              v-else-if="isExternalActive && !currentDetail && !isSearching"
              class="streaming-content-subtitle"
            >
              {{ headerSubtitle }}
            </p>
          </div>
        </div>
        <div class="streaming-header-right">
          <div
            v-if="showUnifiedSearch"
            class="streaming-search-box"
            :class="{ focused: searchInputFocused }"
          >
            <i class="pi pi-search streaming-search-icon"></i>
            <input
              v-model="searchQuery"
              type="text"
              class="streaming-search-input"
              placeholder="搜索音乐、歌手、专辑"
              @focus="searchInputFocused = true"
              @blur="searchInputFocused = false"
            />
            <i v-if="searchLoading" class="pi pi-spin pi-spinner streaming-search-spinner"></i>
            <button v-else-if="searchQuery" class="streaming-search-clear" @click="clearSearch">
              <i class="pi pi-times"></i>
            </button>
          </div>
          <button v-if="!isExternalActive && showUnifiedSearch" class="streaming-round-btn" title="通知">
            <i class="pi pi-bell"></i>
            <span class="notify-dot"></span>
          </button>
          <button
            v-if="activeLoggedIn"
            class="streaming-avatar-btn"
            title="个人资料"
            @click="$emit('toggleMenu')"
          >
            <img
              v-if="activeProfile?.avatarUrl && !avatarLoadFailed"
              :src="activeProfile.avatarUrl"
              alt=""
              @error="avatarLoadFailed = true"
            />
            <i v-else class="pi pi-user"></i>
          </button>
        </div>
      </div>

      <!-- Search Type Tabs + Source Selector -->
      <div v-if="showUnifiedSearch && isSearching && !currentDetail" class="streaming-search-tabs">
        <div class="search-type-group">
          <div
            class="search-tab-pill"
            :class="{ active: searchType === 'songs', disabled: !availableSearchTypes.includes('songs') }"
            @click="availableSearchTypes.includes('songs') && (searchType = 'songs')"
          >
            单曲
          </div>
          <div
            class="search-tab-pill"
            :class="{ active: searchType === 'playlists', disabled: !availableSearchTypes.includes('playlists') }"
            @click="availableSearchTypes.includes('playlists') && (searchType = 'playlists')"
          >
            歌单
          </div>
          <div
            class="search-tab-pill"
            :class="{ active: searchType === 'artists', disabled: !availableSearchTypes.includes('artists') }"
            @click="availableSearchTypes.includes('artists') && (searchType = 'artists')"
          >
            歌手
          </div>
        </div>
        <div class="search-source-dropdown" :class="{ open: sourceMenuOpen }">
          <button
            class="search-source-trigger"
            @click="sourceMenuOpen = !sourceMenuOpen"
            @blur="closeSourceMenuDelayed"
          >
            <i v-if="activeSourceOption?.icon" class="pi" :class="activeSourceOption.icon" style="font-size: 13px"></i>
            <span>{{ activeSourceOption?.label ?? '音源' }}</span>
            <i class="pi pi-chevron-down" style="font-size: 10px"></i>
          </button>
          <div v-if="sourceMenuOpen" class="search-source-menu">
            <div
              v-for="source in searchSources"
              :key="source.id"
              class="search-source-option"
              :class="{ active: searchSource === source.id, disabled: !source.available }"
              @mousedown.prevent="selectSearchSource(source.id)"
            >
              <i v-if="source.icon" class="pi" :class="source.icon" style="font-size: 13px"></i>
              <span>{{ source.label }}</span>
              <i v-if="searchSource === source.id" class="pi pi-check" style="font-size: 12px; margin-left: auto"></i>
            </div>
          </div>
        </div>
      </div>

      <Transition :name="streamingTransitionName" mode="out-in">
        <div
          v-if="showUnifiedSearch && isSearching && !currentDetail"
          key="search-results"
          class="streaming-content-body"
          :class="{ 'has-search-tabs': isSearching }"
        >
          <StreamingSearch
            :search-type="searchType"
            :search-results="searchResults"
            :search-playlists-results="searchPlaylistsResults"
            :search-artists-results="searchArtistsResults"
            :search-total="searchTotal"
            :search-offset="searchOffset"
            :search-loading="searchLoading"
            :search-error="searchError"
            :current-track="currentTrack"
            :liking-tracks="likingTracks"
            :is-track-liked="isTrackLiked"
            :format-time="formatTime"
            @search-track-click="onSearchTrackClick"
            @like-track="onLikeTrack"
            @open-playlist="openPlaylist"
            @open-artist="openArtist"
            @page-change="onPageChange"
            @retry="performSearch(searchQuery)"
          />
        </div>
        <div v-else :key="activeTab" class="streaming-content-body">
          <div v-if="!hasOnlineNavigationEntries && !currentDetail" class="streaming-placeholder">
            <i class="pi pi-plug" style="font-size: 48px; color: #ccc"></i>
            <p class="placeholder-title">未启用可用的在线音源</p>
            <p class="placeholder-hint">请在设置的插件页启用网易云音乐或其它音源插件。</p>
          </div>

          <StreamingHome
            v-else-if="activeTab === 'home' && !currentDetail && activeProviderAvailable"
            :is-logged-in="isLoggedIn"
            :recs-loading="recsLoading"
            :recs-error="recsError"
            :rec-sections="recSections"
            :recommend-playlists="recommendPlaylists"
            @load-recommendations="loadRecommendations"
            @open-rec-section="openRecSection"
            @open-playlist="openPlaylist"
          />

          <div v-else-if="(!activeProviderAvailable || activeProviderUnavailable) && !currentDetail" class="streaming-placeholder">
            <i class="pi pi-ban" style="font-size: 48px; color: #ccc"></i>
            <p class="placeholder-title">
              {{ isExternalActive ? `${activeProviderLabel} 插件已停用` : '网易云音乐插件已停用' }}
            </p>
            <p class="placeholder-hint">
              {{
                activeProviderError ||
                (isExternalActive
                  ? `请在设置的插件页重新启用 ${activeProviderLabel}。`
                  : '请在设置的插件页重新启用 NetEase Cloud Music。')
              }}
            </p>
          </div>

          <div v-else-if="!activeLoggedIn && !currentDetail" class="streaming-placeholder">
            <i class="pi pi-user" style="font-size: 48px; color: #ccc"></i>
            <p class="placeholder-title">
              {{ isExternalActive ? `请先登录 ${activeProviderLabel}` : '请先登录网易云音乐' }}
            </p>
            <p class="placeholder-hint">
              {{
                isExternalActive
                  ? '登录后即可加载全部音乐库'
                  : '登录后即可加载我收藏的歌曲和在线歌单'
              }}
            </p>
            <button type="button" class="stream-action-btn" @click="emit('login')">
              <i class="pi pi-user"></i>
              <span>账号登录</span>
            </button>
          </div>

          <div v-else-if="rootLoading && !currentDetail" class="streaming-placeholder">
            <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #999"></i>
            <p class="placeholder-title">正在加载音乐库</p>
            <p class="placeholder-hint">请稍候...</p>
          </div>

          <div v-else-if="!currentDetail && activeLibraryError" class="streaming-placeholder">
            <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
            <p class="placeholder-title">加载失败</p>
            <p class="placeholder-hint">{{ activeLibraryError }}</p>
            <button type="button" class="stream-action-btn" @click="retryCurrentView">
              <span>重试</span>
            </button>
          </div>

          <div v-else-if="currentDetail" class="detail-view">
            <div
              v-if="showDetailOverlayLoading"
              class="detail-loading-overlay"
              aria-live="polite"
            >
              <i class="pi pi-spin pi-spinner"></i>
              <span>正在加载</span>
            </div>

            <div v-if="detailHeaderInfo" class="detail-playlist-header">
              <img
                v-if="detailHeaderInfo.cover"
                :src="detailHeaderInfo.cover"
                class="detail-playlist-cover"
                alt="cover"
              />
              <div v-else class="detail-playlist-cover-placeholder">
                <i :class="detailHeaderInfo.icon"></i>
              </div>
              <div class="detail-playlist-info">
                <h2 class="detail-playlist-name">{{ detailHeaderInfo.title }}</h2>
                <p class="detail-playlist-desc">{{ detailHeaderInfo.desc }}</p>
                <p v-if="detailHeaderInfo.intro" class="detail-artist-intro">
                  {{ detailHeaderInfo.intro }}
                </p>
                <button
                  v-if="showDetailFollowButton"
                  type="button"
                  class="stream-action-btn detail-play-btn detail-follow-btn"
                  :class="{ followed: detailFollowState }"
                  :disabled="followActionLoading"
                  @click="toggleCurrentDetailFollow"
                >
                  <i :class="detailFollowButtonIcon"></i>
                  <span>{{ detailFollowButtonLabel }}</span>
                </button>
                <button
                  v-else-if="
                    currentDetail?.type !== 'user_list' && currentDetail?.type !== 'user_playlists'
                  "
                  type="button"
                  class="stream-action-btn detail-play-btn"
                  :disabled="detailLoading || detailTracks.length === 0"
                  @click="detailTracks.length > 0 && playTrack(detailTracks[0], detailTracks)"
                >
                  <i class="pi pi-play"></i>
                  <span>播放全部</span>
                </button>
                <p v-if="followActionError" class="detail-follow-error">
                  {{ followActionError }}
                </p>
              </div>
            </div>

            <div
              v-if="showDetailInitialLoading"
              class="detail-content playlist-loading-state"
              aria-live="polite"
            >
              <div class="track-table-wrapper playlist-loading-table">
                <table class="track-table skeleton-table">
                  <thead>
                    <tr>
                      <th class="col-cover-header"></th>
                      <th class="col-index">#</th>
                      <th class="col-info">标题</th>
                      <th v-if="!isExternalActive" class="col-like-header"></th>
                      <th class="col-album">专辑</th>
                      <th class="col-duration">时长</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="i in 10" :key="i" class="track-row skeleton-row">
                      <td class="col-cover">
                        <div
                          class="skeleton-box skeleton-cover-box"
                          :style="{ animationDelay: `${i * 0.05}s` }"
                        ></div>
                      </td>
                      <td class="col-index">
                        <div
                          class="skeleton-box skeleton-index-box"
                          :style="{ animationDelay: `${i * 0.05}s` }"
                        ></div>
                      </td>
                      <td class="col-info">
                        <div
                          class="skeleton-box skeleton-title-box"
                          :style="{ animationDelay: `${i * 0.05}s` }"
                        ></div>
                        <div
                          class="skeleton-box skeleton-artist-box"
                          :style="{ animationDelay: `${i * 0.05}s` }"
                        ></div>
                      </td>
                      <td v-if="!isExternalActive" class="col-like"></td>
                      <td class="col-album">
                        <div
                          class="skeleton-box skeleton-album-box"
                          :style="{ animationDelay: `${i * 0.05}s` }"
                        ></div>
                      </td>
                      <td class="col-duration">
                        <div
                          class="skeleton-box skeleton-time-box"
                          :style="{ animationDelay: `${i * 0.05}s` }"
                        ></div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div
              v-else-if="currentDetail?.type === 'user_list'"
              class="rec-sections"
              style="padding: 0 40px; margin-top: 16px"
            >
              <div v-if="detailLoading" class="streaming-placeholder">
                <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #999"></i>
                <p class="placeholder-title">正在加载</p>
              </div>
              <div v-else-if="detailError" class="streaming-placeholder">
                <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
                <p class="placeholder-title">加载失败</p>
                <p class="placeholder-hint">{{ detailError }}</p>
              </div>
              <div v-else-if="detailUsers.length === 0" class="streaming-placeholder">
                <i class="pi pi-users" style="font-size: 40px; color: #ccc"></i>
                <p class="placeholder-title">暂无数据</p>
              </div>
              <div v-else class="playlist-grid">
                <div
                  v-for="user in detailUsers"
                  :key="user.id"
                  class="playlist-grid-card artist-card"
                  @click="onUserClick(user as any)"
                >
                  <img
                    v-if="user.picUrl"
                    :src="user.picUrl"
                    class="playlist-grid-cover artist-cover"
                    alt=""
                  />
                  <div v-else class="playlist-grid-cover-placeholder artist-cover">
                    <i class="pi pi-user" style="font-size: 28px; color: #bbb"></i>
                  </div>
                  <div class="playlist-grid-name">{{ user.name }}</div>
                </div>
              </div>
            </div>

            <div
              v-else-if="currentDetail?.type === 'user_playlists'"
              class="rec-sections"
              style="padding: 0 40px; margin-top: 16px"
            >
              <div v-if="!detailLoading && detailError" class="streaming-placeholder">
                <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
                <p class="placeholder-title">加载失败</p>
                <p class="placeholder-hint">{{ detailError }}</p>
              </div>
              <div
                v-else-if="!detailLoading && currentDetail.playlists.length === 0"
                class="streaming-placeholder"
              >
                <i class="pi pi-list" style="font-size: 40px; color: #ccc"></i>
                <p class="placeholder-title">暂无歌单</p>
              </div>
              <div v-else-if="!detailLoading" class="playlist-grid">
                <div
                  v-for="playlist in currentDetail.playlists"
                  :key="playlist.id"
                  class="playlist-grid-card"
                  @click="openPlaylist(playlist, false)"
                >
                  <img
                    v-if="playlist.cover"
                    :src="playlist.cover"
                    class="playlist-grid-cover"
                    alt=""
                  />
                  <div v-else class="playlist-grid-cover-placeholder">
                    <i class="pi pi-list" style="font-size: 28px; color: #bbb"></i>
                  </div>
                  <div class="playlist-grid-name">{{ playlist.name }}</div>
                  <div class="playlist-grid-count">{{ playlist.trackCount }} 首</div>
                </div>
              </div>
            </div>

            <div v-else-if="detailError" class="streaming-placeholder detail-placeholder">
              <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
              <p class="placeholder-title">加载失败</p>
              <p class="placeholder-hint">{{ detailError }}</p>
              <button type="button" class="stream-action-btn" @click="retryCurrentView">
                <span>重试</span>
              </button>
            </div>

            <div
              v-else-if="
                currentDetail?.type === 'artist'
              "
              class="artist-detail-panel"
            >
              <div class="artist-detail-tabs" role="tablist" aria-label="歌手内容">
                <button
                  v-for="tab in artistDetailTabs"
                  :key="tab.key"
                  type="button"
                  class="artist-detail-tab"
                  :class="{ active: activeArtistTab === tab.key }"
                  role="tab"
                  :aria-selected="activeArtistTab === tab.key"
                  @click="activeArtistTab = tab.key"
                >
                  <span>{{ tab.label }}</span>
                  <strong>{{ tab.count }}</strong>
                </button>
              </div>

              <div
                v-if="activeArtistTab === 'songs' && detailTracks.length === 0"
                class="streaming-placeholder detail-placeholder"
              >
                <i class="pi pi-wave-pulse" style="font-size: 40px; color: #ccc"></i>
                <p class="placeholder-title">暂无歌曲</p>
                <p class="placeholder-hint">这个歌手目前没有可展示的歌曲</p>
              </div>

              <div v-else-if="activeArtistTab === 'songs'" class="track-table-wrapper">
                <table class="track-table">
                  <thead>
                    <tr>
                      <th class="col-cover-header">{{ detailTrackCountLabel }}</th>
                      <th class="col-index">#</th>
                      <th class="col-info">标题</th>
                      <th class="col-like-header"></th>
                      <th class="col-album">专辑</th>
                      <th class="col-duration">时长</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(track, index) in detailTracks"
                      :key="track.id"
                      class="track-row"
                      :class="{ 'track-playing': currentTrack?.id === track.id }"
                      @click="onTrackClick(track)"
                      @dblclick="onTrackClick(track)"
                    >
                      <td class="col-cover">
                        <img v-if="track.cover" :src="track.cover" class="cover-img" alt="cover" />
                        <div v-else class="cover-placeholder">
                          <i class="pi pi-wave-pulse" style="font-size: 18px; color: #bbb"></i>
                        </div>
                      </td>
                      <td class="col-index">
                        <span v-if="currentTrack?.id === track.id" class="playing-indicator">
                          <i class="pi pi-volume-up" style="font-size: 12px; color: #1a73e8"></i>
                        </span>
                        <span v-else>{{ index + 1 }}</span>
                      </td>
                      <td class="col-info">
                        <div class="track-title">{{ track.title }}</div>
                        <div class="track-artist">{{ track.artist }}</div>
                      </td>
                      <td class="col-like">
                        <button
                          class="btn-like"
                          :class="{
                            liked: isTrackLiked(track.ncmSongId),
                            loading: likingTracks.has(track.ncmSongId ?? 0)
                          }"
                          :disabled="likingTracks.has(track.ncmSongId ?? 0)"
                          title="喜欢"
                          @click="onLikeTrack(track, $event)"
                        >
                          <i
                            v-if="likingTracks.has(track.ncmSongId ?? 0)"
                            class="pi pi-spin pi-spinner"
                            style="font-size: 14px"
                          ></i>
                          <i
                            v-else
                            :class="
                              isTrackLiked(track.ncmSongId) ? 'pi pi-heart-fill' : 'pi pi-heart'
                            "
                            style="font-size: 14px"
                          ></i>
                        </button>
                      </td>
                      <td class="col-album">{{ track.album }}</td>
                      <td class="col-duration">{{ formatTime(track.duration) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div
                v-else-if="activeArtistTab === 'albums' && currentArtistAlbums.length === 0"
                class="streaming-placeholder detail-placeholder"
              >
                <i class="pi pi-clone" style="font-size: 40px; color: #ccc"></i>
                <p class="placeholder-title">暂无专辑</p>
                <p class="placeholder-hint">这个歌手目前没有可展示的专辑</p>
              </div>

              <div v-else-if="activeArtistTab === 'albums'" class="playlist-grid">
                <div
                  v-for="album in currentArtistAlbums"
                  :key="album.id"
                  class="playlist-grid-card"
                  @click="openAlbum(album)"
                >
                  <img
                    v-if="album.cover"
                    :src="album.cover"
                    class="playlist-grid-cover"
                    alt=""
                  />
                  <div v-else class="playlist-grid-cover-placeholder">
                    <i class="pi pi-clone" style="font-size: 28px; color: #bbb"></i>
                  </div>
                  <div class="playlist-grid-name">{{ album.name }}</div>
                  <div class="playlist-grid-count">{{ album.trackCount }} 首</div>
                </div>
              </div>

              <div
                v-else-if="currentArtistPlaylists.length === 0"
                class="streaming-placeholder detail-placeholder"
              >
                <i class="pi pi-list" style="font-size: 40px; color: #ccc"></i>
                <p class="placeholder-title">暂无创建的歌单</p>
                <p class="placeholder-hint">
                  {{ currentDetail.user?.name ?? currentDetail.artist.name }} 目前没有公开创建的歌单
                </p>
              </div>

              <div v-else class="playlist-grid">
                <div
                  v-for="playlist in currentArtistPlaylists"
                  :key="playlist.id"
                  class="playlist-grid-card"
                  @click="openPlaylist(playlist, false)"
                >
                  <img
                    v-if="playlist.cover"
                    :src="playlist.cover"
                    class="playlist-grid-cover"
                    alt=""
                  />
                  <div v-else class="playlist-grid-cover-placeholder">
                    <i class="pi pi-list" style="font-size: 28px; color: #bbb"></i>
                  </div>
                  <div class="playlist-grid-name">{{ playlist.name }}</div>
                  <div class="playlist-grid-count">{{ playlist.trackCount }} 首</div>
                </div>
              </div>
            </div>

            <div
              v-else-if="detailTracks.length === 0 && !detailLoading"
              class="streaming-placeholder detail-placeholder"
            >
              <i :class="currentDetail?.type === 'recent' ? 'pi pi-history' : 'pi pi-wave-pulse'" style="font-size: 40px; color: #ccc"></i>
              <p class="placeholder-title">
                {{ currentDetail?.type === 'recent' ? '还没有播放记录' : '暂无内容' }}
              </p>
              <p class="placeholder-hint">
                {{ currentDetail?.type === 'recent' ? '在 Twilight Echo 中播放歌曲后，这里会显示您的最近播放记录' : '这个页面目前没有可展示的歌曲或歌单' }}
              </p>
            </div>

            <div v-else class="detail-content">
              <div class="track-table-wrapper">
                <table class="track-table">
                  <thead>
                    <tr>
                      <th class="col-cover-header">{{ detailTrackCountLabel }}</th>
                      <th class="col-index">#</th>
                      <th class="col-info">标题</th>
                      <th v-if="!isExternalActive" class="col-like-header"></th>
                      <th class="col-album">专辑</th>
                      <th class="col-duration">时长</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(track, index) in detailTracks"
                      :key="track.id"
                      class="track-row"
                      :class="{ 'track-playing': currentTrack?.id === track.id }"
                      @click="onTrackClick(track)"
                      @dblclick="onTrackClick(track)"
                    >
                      <td class="col-cover">
                        <img v-if="track.cover" :src="track.cover" class="cover-img" alt="cover" />
                        <div v-else class="cover-placeholder">
                          <i class="pi pi-wave-pulse" style="font-size: 18px; color: #bbb"></i>
                        </div>
                      </td>
                      <td class="col-index">
                        <span v-if="currentTrack?.id === track.id" class="playing-indicator">
                          <i class="pi pi-volume-up" style="font-size: 12px; color: #1a73e8"></i>
                        </span>
                        <span v-else>{{ index + 1 }}</span>
                      </td>
                      <td class="col-info">
                        <div class="track-title">{{ track.title }}</div>
                        <div class="track-artist">{{ track.artist }}</div>
                      </td>
                      <td v-if="!isExternalActive" class="col-like">
                        <button
                          class="btn-like"
                          :class="{
                            liked: isTrackLiked(track.ncmSongId),
                            loading: likingTracks.has(track.ncmSongId ?? 0)
                          }"
                          :disabled="likingTracks.has(track.ncmSongId ?? 0)"
                          title="喜欢"
                          @click="onLikeTrack(track, $event)"
                        >
                          <i
                            v-if="likingTracks.has(track.ncmSongId ?? 0)"
                            class="pi pi-spin pi-spinner"
                            style="font-size: 14px"
                          ></i>
                          <i
                            v-else
                            :class="
                              isTrackLiked(track.ncmSongId) ? 'pi pi-heart-fill' : 'pi pi-heart'
                            "
                            style="font-size: 14px"
                          ></i>
                        </button>
                      </td>
                      <td class="col-album">{{ track.album }}</td>
                      <td class="col-duration">{{ formatTime(track.duration) }}</td>
                    </tr>
                  </tbody>
	                </table>
	              </div>
              <div
                v-if="currentDetail?.type === 'liked' && !isExternalActive"
                class="liked-page-loader"
              >
                <span v-if="likedTracksLoadingMore">
                  <i class="pi pi-spin pi-spinner"></i>
                  正在加载更多
                </span>
                <button
                  v-else-if="likedTracksLoadMoreError"
                  type="button"
                  class="liked-page-retry"
                  @click="loadMoreLikedTracks"
                >
                  <i class="pi pi-refresh"></i>
                  <span>继续加载</span>
                </button>
                <span v-else-if="likedTracksHasMore">继续向下滚动加载更多</span>
                <span v-else-if="likedTracksTotal != null && detailTracks.length > 0">已加载全部</span>
              </div>
	            </div>
          </div>

          <StreamingLibrary
            v-else-if="activeTab === 'library' && !currentDetail"
            :is-logged-in="activeLoggedIn"
            :provider-label="activeProviderLabel"
            :profile="activeProfile"
            :profile-signature="profileSignature"
            :liked-summary="likedSummary"
            :library-loaded="activeLibraryLoaded"
            :user-playlist-entries="userPlaylistEntries"
            :show-liked-panel="showActiveLikedPanel"
            :show-social-stats="!isExternalActive"
            :show-feature-cards="!isExternalActive"
            :allow-pin-playlists="false"
            :pinned-playlist-ids="activeExternalState?.pinnedPlaylistIds ?? []"
            :pinning-playlist-id="activeExternalState?.pinningPlaylistId ?? null"
            :available-providers="libraryProviderOptions"
            :active-provider="activeProvider"
            @switch-provider="selectProvider"
            @open-user-list="openUserList"
            @open-liked-tracks="openLikedTracks"
            @play-liked-songs="playLikedSongs"
            @open-playlist="openPlaylist"
            @open-recent="openRecent"
            @open-ranking="openRanking"
          />
        </div>
      </Transition>
    </div>

    <!-- Expansion overlay no longer needed, using clip-path on detail-view -->
  </div>
</template>

<style scoped src="./streaming-page/StreamingPage.css"></style>
