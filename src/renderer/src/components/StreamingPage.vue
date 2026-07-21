<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
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
import { usePlaybackQueueStore } from '../stores/usePlaybackQueueStore'
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
import StreamingDetailStage from './streaming-page/StreamingDetailStage.vue'
import StreamingSocialStage from './streaming-page/StreamingSocialStage.vue'
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
import {
  searchLocalStreamingArtists,
  searchLocalStreamingPlaylists,
  searchLocalStreamingSongs
} from './streaming-page/localStreamingSearch'
import {
  useStreamingSearch,
  type SearchSource,
  type SearchSourceOption
} from './streaming-page/useStreamingSearch'
import { useTrackMultiSelect } from './song-list/useTrackMultiSelect'
import {
  executeStreamingBatchRemoval,
  removeStreamingProviderFavorite
} from './streaming-page/streamingBatchRemoval.ts'

interface RecSection {
  key: string
  title: string
  tracks: Track[]
  icon: string
}

interface DetailHeaderInfo {
  title: string
  cover: string | null
  coverSource?: string | null
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

const streamingViewKey = computed(() => {
  const detail = currentDetail.value
  if (!detail) return `tab:${activeTab.value}`
  switch (detail.type) {
    case 'liked':
      return 'detail:liked'
    case 'playlist':
      return `detail:playlist:${detail.playlist.id}`
    case 'album':
      return `detail:album:${detail.album.id}`
    case 'rec':
      return `detail:rec:${detail.section.key}`
    case 'artist':
      return `detail:artist:${detail.artist.id}`
    case 'user_list':
      return `detail:user_list:${detail.listType}`
    case 'user_playlists':
      return `detail:user_playlists:${detail.user.id}`
    case 'recent':
      return 'detail:recent'
    case 'ranking':
      return 'detail:ranking'
    default:
      return `detail:${(detail as { type: string }).type}`
  }
})

function beginDetailTransition(): void {
  streamingTransitionName.value = 'stream-detail-forward'
  const el = streamingContentRef.value
  if (el) el.scrollTop = 0
}

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
  beginDetailTransition()
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
    (item): item is SidebarItem & { tab: StreamingTab } =>
      item.tab === 'home' || item.tab === 'library'
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
  createPlaylist: createNcmPlaylist,
  deletePlaylist: deleteNcmPlaylist,
  addTracksToPlaylist: addNcmTracksToPlaylist,
  removeTracksFromPlaylist: removeNcmTracksFromPlaylist,
  checkLogin
} = useNcmStore()

const playbackStore = usePlaybackQueueStore()
const { currentTrack } = storeToRefs(playbackStore)
const { playTrack, formatTime } = playbackStore

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

async function searchLocalSongs(
  keywords: string,
  limit: number = 30,
  offset: number = 0
): Promise<{ tracks: Track[]; total: number }> {
  return searchLocalStreamingSongs(musicStore.tracks.value, keywords, limit, offset)
}

async function searchLocalPlaylists(
  keywords: string,
  limit: number = 30,
  offset: number = 0
): Promise<{ playlists: MediaProviderPlaylistSummary[]; total: number }> {
  return searchLocalStreamingPlaylists(musicStore.playlists.value, keywords, limit, offset)
}

async function searchLocalArtists(
  keywords: string,
  limit: number = 30,
  offset: number = 0
): Promise<{ artists: MediaProviderArtistSummary[]; total: number }> {
  return searchLocalStreamingArtists(musicStore.artists.value, keywords, limit, offset)
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
const activeSourceOption = computed(
  () =>
    searchSources.value.find((s) => s.id === searchSource.value) ?? searchSources.value[0] ?? null
)
function selectSearchSource(sourceId: SearchSource): void {
  const source = searchSources.value.find((s) => s.id === sourceId)
  if (!source || !source.available) return
  searchSource.value = sourceId
  sourceMenuOpen.value = false
}

function closeSourceMenuDelayed(): void {
  setTimeout(() => {
    sourceMenuOpen.value = false
  }, 150)
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
const showUnifiedSearch = computed(
  () => hasOnlineNavigationEntries.value && activeProviderAvailable.value && activeLoggedIn.value
)
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
const showTrackDetailStage = computed(() => {
  const detail = currentDetail.value
  if (!detail) return false
  if (detail.type === 'user_list' || detail.type === 'user_playlists') return false
  if (detail.type === 'artist') return false
  return true
})
const showDetailOverlayLoading = computed(() => {
  // Track / social stages own their skeletons; only show sticky overlay for partial reloads.
  if (showTrackDetailStage.value) {
    return detailLoading.value && detailTracks.value.length > 0
  }
  const detail = currentDetail.value
  if (detail?.type === 'user_list') {
    return detailLoading.value && detailUsers.value.length > 0
  }
  if (detail?.type === 'user_playlists') {
    return detailLoading.value && detail.playlists.length > 0
  }
  if (detail?.type === 'artist') {
    return (
      detailLoading.value &&
      (detailTracks.value.length > 0 ||
        currentArtistAlbums.value.length > 0 ||
        currentArtistPlaylists.value.length > 0)
    )
  }
  return detailLoading.value && !showDetailInitialLoading.value
})
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
      coverSource: likedSummary.value.coverSource ?? null,
      desc: `共 ${likedSummary.value.trackCount} 首歌曲`,
      icon: 'pi pi-heart-fill'
    }
  }
  if (currentDetail.value.type === 'playlist') {
    return {
      title: currentDetail.value.playlist.name,
      cover: currentDetail.value.playlist.cover,
      coverSource: currentDetail.value.playlist.coverSource ?? null,
      desc: `共 ${currentDetail.value.playlist.trackCount} ${trackUnitLabel.value}`,
      icon: 'pi pi-list'
    }
  }
  if (currentDetail.value.type === 'rec') {
    const firstTrack = currentDetail.value.section.tracks[0]
    return {
      title: currentDetail.value.section.title,
      cover: firstTrack?.cover ?? null,
      coverSource: firstTrack?.coverSource ?? null,
      desc: `共 ${currentDetail.value.section.tracks.length} ${trackUnitLabel.value}`,
      icon: currentDetail.value.section.icon
    }
  }
  if (currentDetail.value.type === 'album') {
    return {
      title: currentDetail.value.album.name,
      cover: currentDetail.value.album.cover,
      coverSource: currentDetail.value.album.coverSource ?? null,
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
    const firstTrack = detailTracks.value[0]
    return {
      title: '最近播放',
      cover: firstTrack?.cover ?? null,
      coverSource: firstTrack?.coverSource ?? null,
      desc: `共 ${detailTracks.value.length} 首歌曲`,
      icon: 'pi pi-history'
    }
  }
  if (currentDetail.value.type === 'ranking') {
    const firstTrack = detailTracks.value[0]
    return {
      title: '听歌排行',
      cover: firstTrack?.cover ?? null,
      coverSource: firstTrack?.coverSource ?? null,
      desc: `共 ${detailTracks.value.length} 首歌曲`,
      icon: 'pi pi-chart-bar'
    }
  }
  return null
})

const detailFollowState = computed<boolean>(() => {
  if (currentDetail.value?.type === 'artist') return artistFollowed.value === true
  if (currentDetail.value?.type === 'user_playlists')
    return currentDetail.value.user.followed === true
  return false
})

const showDetailFollowButton = computed(
  () => currentDetail.value?.type === 'artist' || currentDetail.value?.type === 'user_playlists'
)

const detailFollowButtonLabel = computed(() => (detailFollowState.value ? '取消关注' : '关注'))

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
    resetDetail({ animate: false })
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

function resetDetail(options?: { animate?: boolean }): void {
  detailLoadToken++
  const animate = options?.animate !== false
  if (animate && currentDetail.value) {
    streamingTransitionName.value = 'stream-detail-back'
    const el = streamingContentRef.value
    if (el) el.scrollTop = 0
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
    beginDetailTransition()
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
    beginDetailTransition()
    currentDetail.value = { type: 'liked' }
    detailTracks.value = []
    detailLoading.value = false
    return
  }

  beginDetailTransition()
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
  beginDetailTransition()
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
  beginDetailTransition()
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

async function openArtist(
  artist: MediaProviderArtistSummary,
  linkedUser?: NcmUserSummary
): Promise<void> {
  const ncmArtist: NcmArtistSummary = {
    id: Number(artist.id),
    name: artist.name,
    picUrl: artist.picUrl,
    albumSize: artist.albumSize ?? 0,
    musicSize: artist.musicSize ?? 0
  }
  beginDetailTransition()
  currentDetail.value = { type: 'artist', artist: ncmArtist, user: linkedUser }
  activeArtistTab.value = 'songs'
  const token = beginDetailLoad()

  try {
    let resolvedArtist = await resolveLinkedStreamingArtist(
      ncmArtist,
      linkedUser,
      findArtistByUserName
    )
    let [tracks, albums, artistOwnedPlaylists, userOwnedPlaylists, intro, followed] =
      await Promise.all([
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
        const [matchedTracks, matchedAlbums, matchedPlaylists, matchedIntro, matchedFollowed] =
          await Promise.all([
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
  beginDetailTransition()
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
  beginDetailTransition()
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
  beginDetailTransition()
  currentDetail.value = { type: 'recent' }
  const token = beginDetailLoad()

  try {
    const recentStats = getRecentTracks()
    const providerId = activeProvider.value
    const filteredStats = recentStats.filter((stat) =>
      stat.sourceIds?.some((sid) => sid.source === providerId)
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
  beginDetailTransition()
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
  if (
    (user.userType === 2 || user.userType === 4 || user.userType === 6) &&
    Number.isFinite(artistId) &&
    artistId > 0
  ) {
    await openArtist(
      {
        id: artistId,
        name: user.name,
        picUrl: user.picUrl,
        albumSize: 0,
        musicSize: user.musicSize
      },
      user
    )
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
  clearSelection()
  resetDetail()
}

const streamingListTracks = computed(() => {
  if (isSearching.value && !currentDetail.value) return searchResults.value
  return detailTracks.value
})

const multiSelectEnabled = computed(
  () =>
    !!currentDetail.value ||
    (isSearching.value && !currentDetail.value && searchType.value === 'songs')
)

const multiSelect = useTrackMultiSelect({
  tracks: streamingListTracks,
  resetSources: [
    currentDetail,
    activeTab,
    searchQuery,
    searchType,
    isSearching,
    () => detailTracks.value.length
  ],
  enabled: multiSelectEnabled
})

const {
  selectedIds,
  selectedCount,
  hasSelection,
  isSelected,
  clearSelection,
  getSelectedTracks,
  ensureContextSelection
} = multiSelect

const selectionAllFavorited = computed(() => {
  const selected = getSelectedTracks()
  if (selected.length === 0) return false
  return selected.every((track) => {
    if (track.ncmSongId != null) return isTrackLiked(track.ncmSongId)
    return musicStore.isFavoriteTrack(track)
  })
})

const selectionActionLabel = computed(() =>
  selectedCount.value > 1 ? ` (${selectedCount.value})` : ''
)

const showStreamingContextMenu = ref(false)
const streamingContextMenuX = ref(0)
const streamingContextMenuY = ref(0)
const showStreamingPlaylistSubmenu = ref(false)
const streamingContextMenuTrack = ref<Track | null>(null)

function closeStreamingContextMenu(): void {
  showStreamingContextMenu.value = false
  showStreamingPlaylistSubmenu.value = false
  streamingContextMenuTrack.value = null
}

function onStreamingTrackContextMenu(track: Track, index: number, event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  ensureContextSelection(track, index)
  streamingContextMenuTrack.value = track
  streamingContextMenuX.value = event.clientX
  streamingContextMenuY.value = event.clientY
  showStreamingPlaylistSubmenu.value = false
  showStreamingContextMenu.value = true
  void nextTick(() => {
    const menu = document.querySelector('.streaming-context-menu') as HTMLElement | null
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      streamingContextMenuX.value = Math.max(8, event.clientX - rect.width)
    }
    if (rect.bottom > window.innerHeight) {
      streamingContextMenuY.value = Math.max(8, event.clientY - rect.height)
    }
  })
}

function handleContextPlayTrack(): void {
  const track = streamingContextMenuTrack.value
  if (!track) return
  const list = streamingListTracks.value
  playTrack(track, list.length > 0 ? list : [track])
  closeStreamingContextMenu()
}

async function handleContextFavorite(): Promise<void> {
  closeStreamingContextMenu()
  await handleStreamingBatchFavorite()
}

function handleContextAddToPlaylist(): void {
  closeStreamingContextMenu()
  openAddToNcmPlaylistDialog(getSelectedTracks())
}

function handleContextCreatePlaylist(): void {
  closeStreamingContextMenu()
  openCreateNcmPlaylistDialog(getSelectedTracks())
}

async function handleContextAddToOwnedPlaylist(
  playlist: MediaProviderPlaylistSummary
): Promise<void> {
  closeStreamingContextMenu()
  addToNcmPlaylistTracks.value = getSelectedTracks().filter(
    (track) => track.ncmSongId != null && Number.isFinite(track.ncmSongId) && track.ncmSongId > 0
  )
  if (addToNcmPlaylistTracks.value.length === 0) {
    setStreamingBatchRemovalError('所选曲目没有可写入网易云歌单的歌曲 ID')
    return
  }
  await confirmAddTracksToNcmPlaylist(playlist)
}

async function handleContextRemoveFromPlaylist(): Promise<void> {
  closeStreamingContextMenu()
  await handleStreamingBatchDelete()
}

async function handleContextLikeTrack(): Promise<void> {
  const track = streamingContextMenuTrack.value
  if (!track?.ncmSongId) return
  closeStreamingContextMenu()
  if (likingTracks.value.has(track.ncmSongId)) return
  likingTracks.value = new Set([...likingTracks.value, track.ncmSongId])
  try {
    await likeTrack(track.ncmSongId, !isTrackLiked(track.ncmSongId))
  } finally {
    const next = new Set(likingTracks.value)
    next.delete(track.ncmSongId)
    likingTracks.value = next
  }
}

const contextMenuSingleLiked = computed(() => {
  const track = streamingContextMenuTrack.value
  if (!track?.ncmSongId) return false
  return isTrackLiked(track.ncmSongId)
})

const contextMenuCanLike = computed(
  () =>
    !isExternalActive.value &&
    streamingContextMenuTrack.value?.ncmSongId != null &&
    selectedCount.value <= 1
)

onMounted(() => {
  window.addEventListener('click', closeStreamingContextMenu)
})

onUnmounted(() => {
  window.removeEventListener('click', closeStreamingContextMenu)
})

function onTrackClick(track: Track, index: number, event?: MouseEvent): void {
  if (event && (event.shiftKey || event.ctrlKey || event.metaKey)) {
    multiSelect.onRowClick(track, index, event)
    return
  }
  if (event) {
    multiSelect.onRowClick(track, index, event)
  }
  playTrack(track, detailTracks.value)
}

function playDetailTrack(track: Track, _index: number): void {
  playTrack(track, detailTracks.value)
}

function playAllDetailTracks(): void {
  if (detailTracks.value.length === 0) return
  playTrack(detailTracks.value[0], detailTracks.value)
}

function shufflePlayDetailTracks(): void {
  if (detailTracks.value.length === 0) return
  const shuffled = [...detailTracks.value]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  playTrack(shuffled[0], shuffled)
}

function isDetailTrackLiking(ncmSongId?: number | null): boolean {
  return ncmSongId != null && likingTracks.value.has(ncmSongId)
}

function isDetailTrackLiked(ncmSongId?: number | null): boolean {
  if (ncmSongId == null) return false
  return isTrackLiked(ncmSongId)
}

const detailLikedFooter = computed(() => {
  if (currentDetail.value?.type !== 'liked' || isExternalActive.value) return null
  return {
    loadingMore: likedTracksLoadingMore.value,
    hasMore: likedTracksHasMore.value,
    loadMoreError: likedTracksLoadMoreError.value,
    total: likedTracksTotal.value,
    loaded: detailTracks.value.length
  }
})

const socialPeople = computed(() =>
  detailUsers.value.map((user) => ({
    id: user.id,
    name: user.name,
    picUrl: user.picUrl ?? null
  }))
)

const socialCollections = computed(() => {
  const detail = currentDetail.value
  if (detail?.type === 'user_playlists') {
    return detail.playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      cover: playlist.cover,
      coverSource: playlist.coverSource ?? null,
      trackCount: playlist.trackCount
    }))
  }
  if (detail?.type === 'artist') {
    if (activeArtistTab.value === 'albums') {
      return currentArtistAlbums.value.map((album) => ({
        id: album.id,
        name: album.name,
        cover: album.cover,
        coverSource: album.coverSource ?? null,
        trackCount: album.trackCount
      }))
    }
    if (activeArtistTab.value === 'playlists') {
      return currentArtistPlaylists.value.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        cover: playlist.cover,
        coverSource: playlist.coverSource ?? null,
        trackCount: playlist.trackCount
      }))
    }
  }
  return []
})

const socialCollectionEmptyHint = computed(() => {
  if (currentDetail.value?.type !== 'artist' || activeArtistTab.value !== 'playlists') return ''
  const name = currentDetail.value.user?.name ?? currentDetail.value.artist.name
  return `${name} 目前没有公开创建的歌单`
})

function onSocialPersonClick(person: { id: string | number; name: string; picUrl?: string | null }): void {
  const user = detailUsers.value.find((item) => String(item.id) === String(person.id))
  if (user) void onUserClick(user)
}

function onArtistTabChange(key: string): void {
  if (key === 'songs' || key === 'albums' || key === 'playlists') {
    activeArtistTab.value = key
  }
}

const socialStageKind = computed(() => currentDetail.value?.type ?? 'user_list')

const socialStageLoading = computed(() => {
  if (!detailLoading.value || !currentDetail.value) return false
  const detail = currentDetail.value
  if (detail.type === 'user_list') return detailUsers.value.length === 0
  if (detail.type === 'user_playlists') return detail.playlists.length === 0
  if (detail.type === 'artist') {
    return (
      detailTracks.value.length === 0 &&
      currentArtistAlbums.value.length === 0 &&
      currentArtistPlaylists.value.length === 0
    )
  }
  return false
})

function onSocialCollectionClick(item: {
  id: string | number
  name: string
  cover?: string | null
  coverSource?: string | null
  trackCount?: number
}): void {
  const detail = currentDetail.value
  if (detail?.type === 'user_playlists') {
    const playlist = detail.playlists.find((entry) => String(entry.id) === String(item.id))
    if (playlist) openPlaylist(playlist, false)
    return
  }
  if (detail?.type === 'artist') {
    if (activeArtistTab.value === 'albums') {
      const album = currentArtistAlbums.value.find((entry) => String(entry.id) === String(item.id))
      if (album) openAlbum(album)
      return
    }
    if (activeArtistTab.value === 'playlists') {
      const playlist = currentArtistPlaylists.value.find(
        (entry) => String(entry.id) === String(item.id)
      )
      if (playlist) openPlaylist(playlist, false)
    }
  }
}

function onSearchTrackClickWithSelect(track: Track, event: MouseEvent): void {
  const index = searchResults.value.findIndex((item) => item.id === track.id)
  const result = multiSelect.onRowClick(track, Math.max(0, index), event)
  if (result === 'play') {
    onSearchTrackClick(track)
  }
}

async function handleStreamingBatchFavorite(): Promise<void> {
  const selected = getSelectedTracks()
  if (selected.length === 0) return
  const allLiked = selectionAllFavorited.value
  for (const track of selected) {
    if (track.ncmSongId != null) {
      if (likingTracks.value.has(track.ncmSongId)) continue
      likingTracks.value = new Set([...likingTracks.value, track.ncmSongId])
      try {
        await likeTrack(track.ncmSongId, !allLiked)
      } finally {
        const next = new Set(likingTracks.value)
        next.delete(track.ncmSongId)
        likingTracks.value = next
      }
    } else if (allLiked) {
      musicStore.removeFavoriteTrack(track)
    } else {
      musicStore.addFavoriteTrack(track)
    }
  }
}

const showCreateNcmPlaylistDialog = ref(false)
const newNcmPlaylistName = ref('')
const createNcmPlaylistBusy = ref(false)
const createNcmPlaylistError = ref('')
const createNcmPlaylistSeedTracks = ref<Track[]>([])
const showAddToNcmPlaylistDialog = ref(false)
const addToNcmPlaylistBusy = ref(false)
const addToNcmPlaylistError = ref('')
const addToNcmPlaylistTracks = ref<Track[]>([])
const deletingNcmPlaylistId = ref<string | number | null>(null)

const ownedUserPlaylists = computed(() =>
  userPlaylistEntries.value.filter((playlist) => playlist.owned === true)
)

const canMutateCurrentNcmPlaylist = computed(() => {
  if (isExternalActive.value) return false
  const detail = currentDetail.value
  if (detail?.type !== 'playlist') return false
  return detail.playlist.owned === true
})

const canManageNcmPlaylists = computed(() => !isExternalActive.value && isLoggedIn.value)

function openCreateNcmPlaylistDialog(seedTracks: Track[] = []): void {
  if (!canManageNcmPlaylists.value) return
  createNcmPlaylistSeedTracks.value = seedTracks
  newNcmPlaylistName.value = ''
  createNcmPlaylistError.value = ''
  showCreateNcmPlaylistDialog.value = true
}

function closeCreateNcmPlaylistDialog(): void {
  if (createNcmPlaylistBusy.value) return
  showCreateNcmPlaylistDialog.value = false
  createNcmPlaylistSeedTracks.value = []
  newNcmPlaylistName.value = ''
  createNcmPlaylistError.value = ''
}

async function confirmCreateNcmPlaylist(): Promise<void> {
  const name = newNcmPlaylistName.value.trim()
  if (!name || createNcmPlaylistBusy.value) return
  createNcmPlaylistBusy.value = true
  createNcmPlaylistError.value = ''
  try {
    const playlist = await createNcmPlaylist(name)
    const seedIds = createNcmPlaylistSeedTracks.value
      .map((track) => track.ncmSongId)
      .filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    if (seedIds.length > 0) {
      await addNcmTracksToPlaylist(playlist.id, seedIds)
    }
    showCreateNcmPlaylistDialog.value = false
    createNcmPlaylistSeedTracks.value = []
    newNcmPlaylistName.value = ''
    clearSelection()
  } catch (error) {
    createNcmPlaylistError.value = error instanceof Error ? error.message : '创建歌单失败'
  } finally {
    createNcmPlaylistBusy.value = false
  }
}

async function handleDeleteNcmPlaylist(playlist: MediaProviderPlaylistSummary): Promise<void> {
  if (!canManageNcmPlaylists.value || deletingNcmPlaylistId.value != null) return
  const label = playlist.owned === false ? '取消收藏该歌单' : '删除该歌单'
  const confirmed = window.confirm(`${label}「${playlist.name}」？此操作不可撤销。`)
  if (!confirmed) return
  deletingNcmPlaylistId.value = playlist.id
  try {
    await deleteNcmPlaylist(playlist.id)
    if (
      currentDetail.value?.type === 'playlist' &&
      String(currentDetail.value.playlist.id) === String(playlist.id)
    ) {
      currentDetail.value = null
      detailTracks.value = []
    }
  } catch (error) {
    libraryError.value = error instanceof Error ? error.message : '删除歌单失败'
  } finally {
    deletingNcmPlaylistId.value = null
  }
}

function openAddToNcmPlaylistDialog(tracks: Track[] = getSelectedTracks()): void {
  if (!canManageNcmPlaylists.value) return
  const ncmTracks = tracks.filter(
    (track) => track.ncmSongId != null && Number.isFinite(track.ncmSongId) && track.ncmSongId > 0
  )
  if (ncmTracks.length === 0) {
    setStreamingBatchRemovalError('所选曲目没有可写入网易云歌单的歌曲 ID')
    return
  }
  addToNcmPlaylistTracks.value = ncmTracks
  addToNcmPlaylistError.value = ''
  showAddToNcmPlaylistDialog.value = true
}

function closeAddToNcmPlaylistDialog(): void {
  if (addToNcmPlaylistBusy.value) return
  showAddToNcmPlaylistDialog.value = false
  addToNcmPlaylistTracks.value = []
  addToNcmPlaylistError.value = ''
}

function convertAddToCreatePlaylist(): void {
  if (addToNcmPlaylistBusy.value) return
  const tracks = [...addToNcmPlaylistTracks.value]
  showAddToNcmPlaylistDialog.value = false
  addToNcmPlaylistTracks.value = []
  addToNcmPlaylistError.value = ''
  openCreateNcmPlaylistDialog(tracks)
}

async function confirmAddTracksToNcmPlaylist(playlist: MediaProviderPlaylistSummary): Promise<void> {
  if (addToNcmPlaylistBusy.value) return
  const trackIds = addToNcmPlaylistTracks.value
    .map((track) => track.ncmSongId)
    .filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
  if (trackIds.length === 0) return
  addToNcmPlaylistBusy.value = true
  addToNcmPlaylistError.value = ''
  try {
    await addNcmTracksToPlaylist(playlist.id, trackIds)
    if (
      currentDetail.value?.type === 'playlist' &&
      String(currentDetail.value.playlist.id) === String(playlist.id)
    ) {
      const existing = new Set(detailTracks.value.map((track) => track.id))
      detailTracks.value = [
        ...detailTracks.value,
        ...addToNcmPlaylistTracks.value.filter((track) => !existing.has(track.id))
      ]
      currentDetail.value = {
        ...currentDetail.value,
        playlist: {
          ...currentDetail.value.playlist,
          trackCount: (currentDetail.value.playlist.trackCount ?? 0) + trackIds.length
        }
      }
    }
    showAddToNcmPlaylistDialog.value = false
    addToNcmPlaylistTracks.value = []
    clearSelection()
  } catch (error) {
    addToNcmPlaylistError.value = error instanceof Error ? error.message : '添加到歌单失败'
  } finally {
    addToNcmPlaylistBusy.value = false
  }
}

async function handleStreamingBatchDelete(): Promise<void> {
  const selected = getSelectedTracks()
  if (selected.length === 0) return

  if (canMutateCurrentNcmPlaylist.value && currentDetail.value?.type === 'playlist') {
    const playlistId = currentDetail.value.playlist.id
    const trackIds = selected
      .map((track) => track.ncmSongId)
      .filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    if (trackIds.length === 0) {
      setStreamingBatchRemovalError('所选曲目没有可从网易云歌单移除的歌曲 ID')
      return
    }
    try {
      await removeNcmTracksFromPlaylist(playlistId, trackIds)
      const removedSongIds = new Set(trackIds)
      detailTracks.value = detailTracks.value.filter(
        (track) => track.ncmSongId == null || !removedSongIds.has(track.ncmSongId)
      )
      currentDetail.value = {
        ...currentDetail.value,
        playlist: {
          ...currentDetail.value.playlist,
          trackCount: Math.max(0, (currentDetail.value.playlist.trackCount ?? 0) - trackIds.length)
        }
      }
      clearSelection()
    } catch (error) {
      setStreamingBatchRemovalError(error instanceof Error ? error.message : '从歌单移除失败')
    }
    return
  }

  try {
    const result = await executeStreamingBatchRemoval(selected, {
      removeLocalTracks: musicStore.removeLocalTracks,
      removeProviderTrack: (track) =>
        removeStreamingProviderFavorite(track, {
          providers: mediaProviders,
          removeNcmFavorite: (songId) => likeTrack(songId, false),
          removeSnapshotFavorite: musicStore.removeFavoriteTrack
        })
    })
    const removed = new Set(result.removedTrackIds)
    detailTracks.value = detailTracks.value.filter((track) => !removed.has(track.id))
    if (isSearching.value) {
      searchResults.value = searchResults.value.filter((track) => !removed.has(track.id))
    }
    setStreamingBatchRemovalError(result.failures.map((failure) => failure.message).join('；'))
    clearSelection()
  } catch (error) {
    setStreamingBatchRemovalError(error instanceof Error ? error.message : '移除曲目失败')
  }
}

function handleStreamingBatchAddToPlaylist(): void {
  openAddToNcmPlaylistDialog(getSelectedTracks())
}

function setStreamingBatchRemovalError(message: string): void {
  if (isSearching.value && !currentDetail.value) searchError.value = message
  else detailError.value = message
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

watch(isSearching, (searching, wasSearching) => {
  if (currentDetail.value) return
  if (searching && !wasSearching) {
    streamingTransitionName.value = 'stream-detail-forward'
    const el = streamingContentRef.value
    if (el) el.scrollTop = 0
    return
  }
  if (!searching && wasSearching) {
    streamingTransitionName.value = 'stream-detail-back'
    const el = streamingContentRef.value
    if (el) el.scrollTop = 0
  }
})

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
    <div class="streaming-sidebar" :class="{ open: menuOpen }">
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

    <div ref="streamingContentRef" class="streaming-content" @scroll="onStreamingContentScroll">
      <header
        class="streaming-content-header"
        :class="{
          'is-detail': !!currentDetail,
          'is-searching': isSearching && !currentDetail
        }"
      >
        <div class="streaming-header-left">
          <button
            v-if="currentDetail || isSearching"
            type="button"
            class="btn-back"
            title="返回"
            @click="currentDetail ? goBack() : clearSearch()"
          >
            <i class="pi pi-arrow-left"></i>
          </button>
          <div class="streaming-header-copy">
            <div v-if="currentDetail || isSearching" class="streaming-header-kicker" aria-hidden="true">
              <span class="streaming-header-kicker-mark"></span>
              <span class="streaming-header-kicker-text">
                {{ currentDetail ? '详情' : '搜索' }}
              </span>
            </div>
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
            <button
              v-else-if="searchQuery"
              type="button"
              class="streaming-search-clear"
              @click="clearSearch"
            >
              <i class="pi pi-times"></i>
            </button>
          </div>
          <button
            v-if="activeLoggedIn"
            type="button"
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
      </header>

      <!-- Search Type Tabs + Source Selector -->
      <div v-if="showUnifiedSearch && isSearching && !currentDetail" class="streaming-search-tabs">
        <div class="search-type-group">
          <div
            class="search-tab-pill"
            :class="{
              active: searchType === 'songs',
              disabled: !availableSearchTypes.includes('songs')
            }"
            @click="availableSearchTypes.includes('songs') && (searchType = 'songs')"
          >
            单曲
          </div>
          <div
            class="search-tab-pill"
            :class="{
              active: searchType === 'playlists',
              disabled: !availableSearchTypes.includes('playlists')
            }"
            @click="availableSearchTypes.includes('playlists') && (searchType = 'playlists')"
          >
            歌单
          </div>
          <div
            class="search-tab-pill"
            :class="{
              active: searchType === 'artists',
              disabled: !availableSearchTypes.includes('artists')
            }"
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
            <i
              v-if="activeSourceOption?.icon"
              class="pi"
              :class="activeSourceOption.icon"
              style="font-size: 13px"
            ></i>
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
              <i
                v-if="searchSource === source.id"
                class="pi pi-check"
                style="font-size: 12px; margin-left: auto"
              ></i>
            </div>
          </div>
        </div>
      </div>

      <Transition :name="streamingTransitionName" mode="out-in">
        <div
          v-if="showUnifiedSearch && isSearching && !currentDetail"
          key="search-results"
          class="streaming-content-body stream-view-panel"
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
            :selected-ids="selectedIds"
            :has-selection="hasSelection"
            :selected-count="selectedCount"
            :selection-all-favorited="selectionAllFavorited"
            :can-add-to-playlist="canManageNcmPlaylists"
            @search-track-click="onSearchTrackClickWithSelect"
            @like-track="onLikeTrack"
            @open-playlist="openPlaylist"
            @open-artist="openArtist"
            @page-change="onPageChange"
            @retry="performSearch(searchQuery)"
            @batch-favorite="handleStreamingBatchFavorite"
            @batch-add-to-playlist="handleStreamingBatchAddToPlaylist"
            @batch-delete="handleStreamingBatchDelete"
            @clear-selection="clearSelection"
            @track-context-menu="onStreamingTrackContextMenu"
          />
        </div>
        <div v-else :key="streamingViewKey" class="streaming-content-body stream-view-panel">
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

          <div
            v-else-if="(!activeProviderAvailable || activeProviderUnavailable) && !currentDetail"
            class="streaming-placeholder"
          >
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
            <div v-if="showDetailOverlayLoading" class="detail-loading-overlay" aria-live="polite">
              <i class="pi pi-spin pi-spinner"></i>
              <span>正在加载</span>
            </div>

            <!-- Track playlist / rec / liked / album / recent / ranking: editorial stage -->
            <template v-if="showTrackDetailStage">
              <div v-if="detailError" class="streaming-placeholder detail-placeholder">
                <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
                <p class="placeholder-title">加载失败</p>
                <p class="placeholder-hint">{{ detailError }}</p>
                <button type="button" class="stream-action-btn" @click="retryCurrentView">
                  <span>重试</span>
                </button>
              </div>

              <StreamingDetailStage
                v-else-if="detailHeaderInfo"
                :kind="currentDetail.type"
                :title="detailHeaderInfo.title"
                :cover="detailHeaderInfo.cover"
                :cover-source="detailHeaderInfo.coverSource"
                :description="detailHeaderInfo.desc"
                :intro="detailHeaderInfo.intro"
                :icon="detailHeaderInfo.icon"
                :track-count-label="detailTrackCountLabel"
                :tracks="detailTracks"
                :current-track-id="currentTrack?.id ?? null"
                :is-external="isExternalActive"
                :loading="detailLoading && detailTracks.length === 0"
                :has-selection="hasSelection"
                :selected-count="selectedCount"
                :selection-all-favorited="selectionAllFavorited"
                :can-add-to-playlist="canManageNcmPlaylists"
                :can-remove-from-playlist="canMutateCurrentNcmPlaylist"
                :is-selected="isSelected"
                :is-track-liked="isDetailTrackLiked"
                :is-liking="isDetailTrackLiking"
                :format-time="formatTime"
                :liked-footer="detailLikedFooter"
                @play-all="playAllDetailTracks"
                @shuffle-play="shufflePlayDetailTracks"
                @play-track="playDetailTrack"
                @track-click="onTrackClick"
                @like-track="onLikeTrack"
                @batch-favorite="handleStreamingBatchFavorite"
                @batch-add-to-playlist="handleStreamingBatchAddToPlaylist"
                @batch-delete="handleStreamingBatchDelete"
                @clear-selection="clearSelection"
                @load-more-liked="loadMoreLikedTracks"
                @track-context-menu="onStreamingTrackContextMenu"
              />
            </template>

            <!-- Artist / social / user playlists: editorial social stage -->
            <StreamingSocialStage
              v-else-if="detailHeaderInfo"
              :kind="socialStageKind"
              :title="detailHeaderInfo.title"
              :cover="detailHeaderInfo.cover"
              :cover-source="detailHeaderInfo.coverSource"
              :description="detailHeaderInfo.desc"
              :intro="detailHeaderInfo.intro"
              :icon="detailHeaderInfo.icon"
              :loading="socialStageLoading"
              :error="detailError"
              :show-follow="showDetailFollowButton"
              :follow-label="detailFollowButtonLabel"
              :follow-icon="detailFollowButtonIcon"
              :follow-active="detailFollowState"
              :follow-loading="followActionLoading"
              :follow-error="followActionError"
              :people="socialPeople"
              :collections="socialCollections"
              :collection-empty-hint="socialCollectionEmptyHint"
              :tabs="socialStageKind === 'artist' ? artistDetailTabs : []"
              :active-tab="socialStageKind === 'artist' ? activeArtistTab : ''"
              :tracks="detailTracks"
              :current-track-id="currentTrack?.id ?? null"
              :is-external="isExternalActive"
              :has-selection="hasSelection"
              :selected-count="selectedCount"
              :selection-all-favorited="selectionAllFavorited"
              :can-add-to-playlist="canManageNcmPlaylists"
              :is-selected="isSelected"
              :is-track-liked="isDetailTrackLiked"
              :is-liking="isDetailTrackLiking"
              :format-time="formatTime"
              :track-count-label="detailTrackCountLabel"
              @follow="toggleCurrentDetailFollow"
              @retry="retryCurrentView"
              @person-click="onSocialPersonClick"
              @collection-click="onSocialCollectionClick"
              @tab-change="onArtistTabChange"
              @play-all="playAllDetailTracks"
              @shuffle-play="shufflePlayDetailTracks"
              @play-track="playDetailTrack"
              @track-click="onTrackClick"
              @like-track="onLikeTrack"
              @batch-favorite="handleStreamingBatchFavorite"
              @batch-add-to-playlist="handleStreamingBatchAddToPlaylist"
              @batch-delete="handleStreamingBatchDelete"
              @clear-selection="clearSelection"
              @track-context-menu="onStreamingTrackContextMenu"
            />
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
            :allow-playlist-mutations="canManageNcmPlaylists"
            :deleting-playlist-id="deletingNcmPlaylistId"
            :pinned-playlist-ids="activeExternalState?.pinnedPlaylistIds ?? []"
            :pinning-playlist-id="activeExternalState?.pinningPlaylistId ?? null"
            :available-providers="libraryProviderOptions"
            :active-provider="activeProvider"
            @switch-provider="selectProvider"
            @open-user-list="openUserList"
            @open-liked-tracks="openLikedTracks"
            @play-liked-songs="playLikedSongs"
            @open-playlist="openPlaylist"
            @create-playlist="openCreateNcmPlaylistDialog()"
            @delete-playlist="handleDeleteNcmPlaylist"
            @open-recent="openRecent"
            @open-ranking="openRanking"
          />
        </div>
      </Transition>
    </div>

    <Teleport to="body">
      <div
        v-if="showStreamingContextMenu"
        class="streaming-context-menu"
        :style="{ top: `${streamingContextMenuY}px`, left: `${streamingContextMenuX}px` }"
        @click.stop
      >
        <div class="menu-item" @click="handleContextPlayTrack">
          <i class="pi pi-play"></i>
          <span>播放</span>
        </div>
        <div class="menu-item" @click="handleContextFavorite">
          <i :class="selectionAllFavorited ? 'pi pi-heart-fill' : 'pi pi-heart'"></i>
          <span>
            {{ selectionAllFavorited ? '取消收藏' : '加入收藏' }}{{ selectionActionLabel }}
          </span>
        </div>
        <div
          v-if="contextMenuCanLike"
          class="menu-item"
          @click="handleContextLikeTrack"
        >
          <i :class="contextMenuSingleLiked ? 'pi pi-heart-fill' : 'pi pi-heart'"></i>
          <span>{{ contextMenuSingleLiked ? '取消喜欢' : '喜欢' }}</span>
        </div>
        <div
          v-if="canManageNcmPlaylists"
          class="menu-item"
          @mouseenter="showStreamingPlaylistSubmenu = true"
          @mouseleave="showStreamingPlaylistSubmenu = false"
        >
          <i class="pi pi-plus"></i>
          <span>添加到歌单{{ selectionActionLabel }}</span>
          <i class="pi pi-chevron-right submenu-icon"></i>
          <div v-if="showStreamingPlaylistSubmenu" class="submenu">
            <div class="menu-item create-playlist-menu-item" @click="handleContextCreatePlaylist">
              <i class="pi pi-plus"></i>
              <span>创建新歌单</span>
            </div>
            <div
              v-if="ownedUserPlaylists.length === 0"
              class="menu-item disabled"
            >
              暂无自建歌单
            </div>
            <div
              v-for="playlist in ownedUserPlaylists"
              :key="playlist.id"
              class="menu-item"
              @click="handleContextAddToOwnedPlaylist(playlist)"
            >
              {{ playlist.name }}
            </div>
            <div class="menu-item" @click="handleContextAddToPlaylist">
              <i class="pi pi-list"></i>
              <span>选择歌单…</span>
            </div>
          </div>
        </div>
        <div
          v-if="canMutateCurrentNcmPlaylist"
          class="menu-item danger"
          @click="handleContextRemoveFromPlaylist"
        >
          <i class="pi pi-minus-circle"></i>
          <span>从歌单移除{{ selectionActionLabel }}</span>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <Transition name="dialog-fade">
        <div
          v-if="showCreateNcmPlaylistDialog"
          class="ncm-playlist-dialog-overlay"
          @click.self="closeCreateNcmPlaylistDialog"
        >
          <div class="ncm-playlist-dialog" role="dialog" aria-modal="true" aria-label="创建歌单">
            <h3>创建网易云歌单</h3>
            <input
              v-model="newNcmPlaylistName"
              type="text"
              maxlength="50"
              placeholder="请输入歌单名称"
              :disabled="createNcmPlaylistBusy"
              autofocus
              @keyup.enter="confirmCreateNcmPlaylist"
            />
            <p v-if="createNcmPlaylistError" class="ncm-playlist-dialog-error">
              {{ createNcmPlaylistError }}
            </p>
            <div class="ncm-playlist-dialog-actions">
              <button type="button" :disabled="createNcmPlaylistBusy" @click="closeCreateNcmPlaylistDialog">
                取消
              </button>
              <button
                type="button"
                class="primary"
                :disabled="createNcmPlaylistBusy || !newNcmPlaylistName.trim()"
                @click="confirmCreateNcmPlaylist"
              >
                {{ createNcmPlaylistBusy ? '创建中…' : '创建' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="dialog-fade">
        <div
          v-if="showAddToNcmPlaylistDialog"
          class="ncm-playlist-dialog-overlay"
          @click.self="closeAddToNcmPlaylistDialog"
        >
          <div class="ncm-playlist-dialog" role="dialog" aria-modal="true" aria-label="添加到歌单">
            <h3>添加到网易云歌单</h3>
            <p class="ncm-playlist-dialog-hint">
              已选 {{ addToNcmPlaylistTracks.length }} 首，选择目标歌单
            </p>
            <div class="ncm-playlist-picker">
              <button
                type="button"
                class="ncm-playlist-picker-item create"
                :disabled="addToNcmPlaylistBusy"
                @click="convertAddToCreatePlaylist"
              >
                <i class="pi pi-plus"></i>
                <span>新建歌单并添加</span>
              </button>
              <button
                v-for="playlist in ownedUserPlaylists"
                :key="playlist.id"
                type="button"
                class="ncm-playlist-picker-item"
                :disabled="addToNcmPlaylistBusy"
                @click="confirmAddTracksToNcmPlaylist(playlist)"
              >
                <img v-if="playlist.cover" :src="playlist.cover" alt="" />
                <i v-else class="pi pi-list"></i>
                <span>
                  <strong>{{ playlist.name }}</strong>
                  <small>{{ playlist.trackCount ?? 0 }} 首</small>
                </span>
              </button>
              <p v-if="ownedUserPlaylists.length === 0" class="ncm-playlist-dialog-hint">
                暂无自建歌单，可先新建一个
              </p>
            </div>
            <p v-if="addToNcmPlaylistError" class="ncm-playlist-dialog-error">
              {{ addToNcmPlaylistError }}
            </p>
            <div class="ncm-playlist-dialog-actions">
              <button type="button" :disabled="addToNcmPlaylistBusy" @click="closeAddToNcmPlaylistDialog">
                取消
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped src="./streaming-page/StreamingPage.css"></style>
