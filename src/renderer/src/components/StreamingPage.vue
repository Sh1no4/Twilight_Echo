<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
import type {
  MediaProviderPlaylistSummary,
  MediaProviderProfile
} from '../providers/mediaProvider'
import StreamingHome from './StreamingHome.vue'
import StreamingLibrary from './StreamingLibrary.vue'
import StreamingSearch from './StreamingSearch.vue'
import BilibiliPage from './BilibiliPage.vue'
import {
  isSidebarItemActiveForProvider,
  shouldShowBilibiliViewForSidebarProvider
} from '../utils/streamingNavigation'

interface PageState {
  first: number
  rows?: number
  page?: number
  pageCount?: number
}

interface RecSection {
  key: string
  title: string
  tracks: Track[]
  icon: string
}

type StreamingTab = 'home' | 'library'
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

defineProps<{
  menuOpen: boolean
  hasPlayer: boolean
}>()

const activeTab = ref<StreamingTab>('home')
const streamingTransitionName = ref('stream-page-down')
const currentDetail = ref<DetailView | null>(null)
const showBilibiliView = ref(false)
const detailTracks = ref<Track[]>([])
const detailUsers = ref<NcmUserSummary[]>([])
const artistAlbums = ref<NcmAlbumSummary[]>([])
const artistPlaylists = ref<NcmPlaylistSummary[]>([])
const activeArtistTab = ref<ArtistDetailTab>('songs')
const detailLoading = ref(false)
const detailError = ref('')
const likedCount = ref<number | null>(null)
let detailLoadToken = 0

const dailySongs = ref<Track[]>([])
const personalFmSongs = ref<Track[]>([])
const privateContentSongs = ref<Track[]>([])
const recommendPlaylists = ref<NcmPlaylistSummary[]>([])
const recsLoading = ref(false)
const recsError = ref('')
const avatarLoadFailed = ref(false)
const providerStore = useProviderStore()
const settingsStore = useSettingsStore()

const NCM_PROVIDER_ID = 'ncm'

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
  return id === NCM_PROVIDER_ID ? true : providerStore.hasProvider(id)
}

// User's persisted preferred provider — only explicit user toggles change it.
const preferredProvider = ref<string>(
  settingsStore.settings.value.streamingActiveProvider || NCM_PROVIDER_ID
)

// Resolved active provider: preferred when available, else fall back to ncm.
// Keeps the user's choice across restarts while degrading gracefully when a
// plugin is disabled (falls back to ncm until the plugin returns).
const activeProvider = computed<string>(() =>
  isProviderAvailable(preferredProvider.value) ? preferredProvider.value : NCM_PROVIDER_ID
)

const isExternalActive = computed(() => activeProvider.value !== NCM_PROVIDER_ID)
const isBiliActive = computed(() => activeProvider.value === 'bili')
const activeExternalState = computed<ExternalProviderState | null>(() =>
  isExternalActive.value ? (externalStates[activeProvider.value] ?? null) : null
)

const activeProviderInfo = computed(() => providerStore.getProvider(activeProvider.value))
const activeProviderLabel = computed(() => {
  if (activeProvider.value === NCM_PROVIDER_ID) return '网易云音乐'
  return activeProviderInfo.value?.name ?? '在线音源'
})

// Providers eligible for the unified music-library toggle (the dropdown on
// the profile card). ncm is always first; other providers opt in by declaring
// `ui.unifiedLibrary: true`. Providers that don't opt in (e.g. Bilibili, a
// video-favorites feature) keep their own sidebar entry instead.
const libraryProviders = computed(() => {
  const list: Array<{ id: string; name: string; icon: string }> = [
    { id: NCM_PROVIDER_ID, name: '网易云音乐', icon: 'pi pi-cloud' }
  ]
  for (const provider of providerStore.providers.value) {
    if (provider.id === NCM_PROVIDER_ID) continue
    if (provider.capabilities.includes('library') && provider.ui?.unifiedLibrary === true) {
      list.push({
        id: provider.id,
        name: provider.name,
        icon: provider.ui?.icon || 'pi pi-music'
      })
    }
  }
  return list
})

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

interface TabItem {
  key: StreamingTab
  label: string
  icon: string
}

interface SidebarItem {
  key: string
  provider: string
  label: string
  icon: string
  tab?: StreamingTab
}

const tabs: TabItem[] = [
  { key: 'home', label: '主页', icon: 'pi pi-sparkles' },
  { key: 'library', label: '音乐库', icon: 'pi pi-heart' }
]
const sidebarItems = computed<SidebarItem[]>(() => {
  const items: SidebarItem[] = tabs.map((tab) => ({
    key: tab.key,
    provider: NCM_PROVIDER_ID,
    label: tab.label,
    icon: tab.icon,
    tab: tab.key
  }))
  for (const provider of providerStore.providers.value) {
    if (provider.id === NCM_PROVIDER_ID) continue
    // Unified-library providers (e.g. YouTube Music) are reached via the
    // profile-card dropdown, NOT a sidebar entry — they share the single
    // "音乐库" item with ncm. Providers that don't opt in (e.g. Bilibili,
    // a video-favorites feature) keep their own sidebar entry.
    if (
      provider.capabilities.includes('library') &&
      provider.ui?.unifiedLibrary !== true &&
      provider.ui?.streamingLibraryTab !== false
    ) {
      items.push({
        key: `${provider.id}-library`,
        provider: provider.id,
        label: provider.name,
        icon: provider.ui?.icon || 'pi pi-music'
      })
    }
  }
  return items
})

const currentView = computed(() => tabs.find((t) => t.key === activeTab.value))

function getStreamingTabIndex(key: StreamingTab): number {
  const index = tabs.findIndex((tab) => tab.key === key)
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
  fetchLikedTracks,
  fetchRecommendSongs,
  fetchRecommendPlaylists,
  fetchPersonalFm,
  fetchPrivateContent,
  searchSongs,
  searchPlaylists,
  searchArtists,
  fetchArtistTopSongs,
  fetchArtistAlbums,
  fetchAlbumTracks,
  fetchArtistPlaylists,
  fetchUserFollows,
  fetchUserFolloweds,
  fetchPlayRecords,
  fetchRecentSongs,
  likeTrack,
  isTrackLiked,
  syncLikedIds
} = useNcmStore()

// ===== Search =====
const searchQuery = ref('')
const searchType = ref<'songs' | 'playlists' | 'artists'>('songs')
const searchResults = ref<Track[]>([])
const searchPlaylistsResults = ref<NcmPlaylistSummary[]>([])
const searchArtistsResults = ref<NcmArtistSummary[]>([])
const searchTotal = ref(0)
const searchOffset = ref(0)
const searchLoading = ref(false)
const searchError = ref('')
const searchInputFocused = ref(false)
const isSearching = computed(() => searchQuery.value.trim().length > 0)

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

// Removed animation functions

// Removed old animation functions

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

function clearSearch(): void {
  searchQuery.value = ''
  searchResults.value = []
  searchPlaylistsResults.value = []
  searchArtistsResults.value = []
  searchTotal.value = 0
  searchOffset.value = 0
  searchLoading.value = false
  searchError.value = ''
}

async function performSearch(keywords: string): Promise<void> {
  if (!keywords.trim()) {
    searchResults.value = []
    searchPlaylistsResults.value = []
    searchArtistsResults.value = []
    searchTotal.value = 0
    return
  }
  searchLoading.value = true
  searchError.value = ''
  try {
    if (searchType.value === 'songs') {
      const { tracks, total } = await searchSongs(keywords.trim(), 30, searchOffset.value)
      if (searchQuery.value.trim() === keywords.trim() && searchType.value === 'songs') {
        searchResults.value = tracks
        searchTotal.value = total
      }
    } else if (searchType.value === 'playlists') {
      const { playlists, total } = await searchPlaylists(keywords.trim(), 30, searchOffset.value)
      if (searchQuery.value.trim() === keywords.trim() && searchType.value === 'playlists') {
        searchPlaylistsResults.value = playlists
        searchTotal.value = total
      }
    } else if (searchType.value === 'artists') {
      const { artists, total } = await searchArtists(keywords.trim(), 30, searchOffset.value)
      if (searchQuery.value.trim() === keywords.trim() && searchType.value === 'artists') {
        searchArtistsResults.value = artists
        searchTotal.value = total
      }
    }
  } catch (e) {
    if (searchQuery.value.trim() === keywords.trim()) {
      searchError.value = e instanceof Error ? e.message : '搜索失败'
      searchResults.value = []
      searchPlaylistsResults.value = []
      searchArtistsResults.value = []
      searchTotal.value = 0
    }
  } finally {
    if (searchQuery.value.trim() === keywords.trim()) {
      searchLoading.value = false
    }
  }
}

watch([searchQuery, searchType], ([newQuery, newType], [oldQuery, oldType]) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  const q = newQuery.trim()
  if (!q) {
    searchResults.value = []
    searchPlaylistsResults.value = []
    searchArtistsResults.value = []
    searchTotal.value = 0
    searchOffset.value = 0
    searchLoading.value = false
    searchError.value = ''
    return
  }

  if (oldQuery !== newQuery || oldType !== newType) {
    searchOffset.value = 0
    searchLoading.value = true
    searchDebounceTimer = setTimeout(() => {
      performSearch(q)
    }, 300)
  }
})

function onPageChange(event: PageState): void {
  searchOffset.value = event.first
  performSearch(searchQuery.value.trim())
}

function onSearchTrackClick(track: Track): void {
  playTrack(track, searchResults.value)
}

const { currentTrack, playTrack, formatTime } = usePlayerStore()

const activeProfile = computed(() =>
  isExternalActive.value ? (activeExternalState.value?.profile ?? null) : profile.value
)
const activeLoggedIn = computed(() =>
  isExternalActive.value ? (activeExternalState.value?.loggedIn ?? false) : isLoggedIn.value
)
const activeProviderAvailable = computed(() =>
  isExternalActive.value ? isProviderAvailable(activeProvider.value) : providerAvailable.value
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
const showNcmSearch = computed(() => !isExternalActive.value && isLoggedIn.value)
const trackUnitLabel = computed(() => (isBiliActive.value ? '个视频' : '首歌曲'))
const profileSignature = computed(() => activeProfile.value?.signature?.trim() || '暂无个人简介')

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
  if (isExternalActive.value) {
    const state = activeExternalState.value
    return {
      name: isBiliActive.value ? 'Bilibili 收藏夹' : '我喜欢的音乐',
      cover: state?.likedPlaylist?.cover ?? null,
      trackCount: isBiliActive.value
        ? (state?.playlists.length ?? 0)
        : (state?.likedPlaylist?.trackCount ?? 0)
    }
  }
  return {
    name: '我收藏的歌曲',
    cover: likedPlaylist.value?.cover ?? null,
    trackCount: likedCount.value ?? likedPlaylist.value?.trackCount ?? 0
  }
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

const detailHeaderInfo = computed(() => {
  if (!currentDetail.value) return null
  if (currentDetail.value.type === 'liked') {
    return {
      title: '我收藏的歌曲',
      cover: likedPlaylist.value?.cover ?? null,
      desc: `共 ${likedCount.value ?? 0} 首歌曲`,
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

function selectTab(key: StreamingTab): void {
  if (isExternalActive.value && key !== 'library') return
  if (activeTab.value !== key) {
    const oldIndex = getStreamingTabIndex(activeTab.value)
    const newIndex = getStreamingTabIndex(key)
    streamingTransitionName.value = newIndex > oldIndex ? 'stream-page-down' : 'stream-page-up'
    resetDetail()
  }
  activeTab.value = key
}

function selectProvider(provider: string): void {
  if (preferredProvider.value === provider) return
  // Only an explicit user action changes the persisted preference; availability
  // fallbacks never write back, so the choice survives restarts and plugin toggles.
  preferredProvider.value = provider
  void settingsStore.updateSettings({ streamingActiveProvider: provider })
}

function isSidebarItemActive(item: SidebarItem): boolean {
  return isSidebarItemActiveForProvider({
    itemProvider: item.provider,
    itemKey: item.key,
    activeProvider: activeProvider.value,
    activeTab: activeTab.value,
    showBilibiliView: showBilibiliView.value
  })
}

function selectSidebarItem(item: SidebarItem): void {
  showBilibiliView.value = shouldShowBilibiliViewForSidebarProvider(item.provider)
  if (item.provider === 'bili') {
    return
  }
  if (item.provider !== NCM_PROVIDER_ID) {
    selectProvider(item.provider)
    return
  }
  if (activeProvider.value !== NCM_PROVIDER_ID) {
    selectProvider(NCM_PROVIDER_ID)
  }
  selectTab(item.key as StreamingTab)
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
  activeArtistTab.value = 'songs'
  detailLoading.value = false
  detailError.value = ''
}

function beginDetailLoad(): number {
  const token = ++detailLoadToken
  detailTracks.value = []
  detailUsers.value = []
  artistAlbums.value = []
  artistPlaylists.value = []
  detailLoading.value = true
  detailError.value = ''
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

function normalizeNameForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

async function findArtistByUserName(user: NcmUserSummary): Promise<NcmArtistSummary | null> {
  const keyword = user.name.trim()
  if (!keyword) return null
  const { artists } = await searchArtists(keyword, 8, 0)
  if (artists.length === 0) return null
  const normalizedKeyword = normalizeNameForMatch(keyword)
  return (
    artists.find((artist) => normalizeNameForMatch(artist.name) === normalizedKeyword) ??
    artists[0] ??
    null
  )
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

async function togglePinnedPlaylist(playlist: MediaProviderPlaylistSummary): Promise<void> {
  // Pinning is currently a Bilibili-specific extension command; gated by the
  // bili provider. Future providers can plug in their own pinning command here.
  if (!isBiliActive.value) return
  const state = activeExternalState.value
  if (!state || state.pinningPlaylistId) return
  const playlistId = String(playlist.id)
  state.pinningPlaylistId = playlistId
  state.libraryError = ''
  try {
    const result = await window.api.extensions.executeCommand('bilibili.setPinnedFavoriteFolder', [
      { id: playlistId }
    ])
    const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
    state.pinnedPlaylistIds = Array.isArray(record.pinnedFavoriteFolderIds)
      ? record.pinnedFavoriteFolderIds.map((id) => String(id)).filter(Boolean)
      : []
    await ensureExternalLibraryLoaded('bili', true)
  } catch (error) {
    state.libraryError = error instanceof Error ? error.message : '设置 Bilibili 收藏夹置顶失败'
  } finally {
    state.pinningPlaylistId = null
  }
}

async function openLikedTracks(force = false): Promise<void> {
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
    const tracks = await fetchLikedTracks(force)
    if (!isActiveDetailLoad(token)) return
    detailTracks.value = tracks
    likedCount.value = tracks.length
    syncLikedIds(tracks)
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

async function openArtist(artist: NcmArtistSummary, linkedUser?: NcmUserSummary): Promise<void> {
  streamingTransitionName.value = 'stream-page-down'
  currentDetail.value = { type: 'artist', artist, user: linkedUser }
  activeArtistTab.value = 'songs'
  const token = beginDetailLoad()

  try {
    let [tracks, albums, artistOwnedPlaylists, userOwnedPlaylists] = await Promise.all([
      fetchArtistTopSongs(artist.id).catch(() => [] as Track[]),
      fetchArtistAlbums(artist.id).catch(() => [] as NcmAlbumSummary[]),
      fetchArtistPlaylists(artist.id).catch(() => [] as NcmPlaylistSummary[]),
      linkedUser
        ? fetchUserPlaylistsByUid(linkedUser.id, true).catch(() => [] as NcmPlaylistSummary[])
        : Promise.resolve([] as NcmPlaylistSummary[])
    ])

    let resolvedArtist = artist
    if (linkedUser && tracks.length === 0) {
      const matchedArtist = await findArtistByUserName(linkedUser).catch(() => null)
      if (matchedArtist && matchedArtist.id !== artist.id) {
        const [matchedTracks, matchedAlbums, matchedPlaylists] = await Promise.all([
          fetchArtistTopSongs(matchedArtist.id).catch(() => [] as Track[]),
          fetchArtistAlbums(matchedArtist.id).catch(() => [] as NcmAlbumSummary[]),
          fetchArtistPlaylists(matchedArtist.id).catch(() => [] as NcmPlaylistSummary[])
        ])
        if (matchedTracks.length > 0 || matchedAlbums.length > 0 || matchedPlaylists.length > 0) {
          resolvedArtist = {
            ...matchedArtist,
            picUrl: matchedArtist.picUrl ?? artist.picUrl
          }
          tracks = matchedTracks
          albums = matchedAlbums
          artistOwnedPlaylists = mergePlaylistSummaries(artistOwnedPlaylists, matchedPlaylists)
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
    const tracks = await fetchRecentSongs()
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
    const tracks = await fetchPlayRecords(1)
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
  if (user.userType === 2 || user.userType === 4 || user.userType === 6) {
    await openArtist({
      id: user.id,
      name: user.name,
      picUrl: user.picUrl,
      albumSize: 0,
      musicSize: user.musicSize
    }, user)
  } else {
    await openUserPlaylists(user)
  }
}

function goBack(): void {
  resetDetail()
}

function onTrackClick(track: Track): void {
  playTrack(track, detailTracks.value)
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

// Side effects of switching the resolved active provider (user toggle, plugin
// enable/disable, or restore after restart). activeProvider falls back to ncm
// automatically when the preferred provider is unavailable, so we only act on
// real changes.
watch(activeProvider, async (provider, oldProvider) => {
  if (provider === oldProvider) return
  resetDetail()
  clearSearch()
  if (provider === NCM_PROVIDER_ID) {
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

    <BilibiliPage
      v-if="showBilibiliView"
      class="streaming-content"
      :menu-open="menuOpen"
      :has-player="hasPlayer"
      @back-to-local="showBilibiliView = false"
    />
    <div v-else class="streaming-content">
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
            v-if="showNcmSearch"
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
          <button v-if="showNcmSearch" class="streaming-round-btn" title="通知">
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

      <!-- Search Type Tabs -->
      <div v-if="showNcmSearch && isSearching && !currentDetail" class="streaming-search-tabs">
        <div
          class="search-tab-pill"
          :class="{ active: searchType === 'songs' }"
          @click="searchType = 'songs'"
        >
          单曲
        </div>
        <div
          class="search-tab-pill"
          :class="{ active: searchType === 'playlists' }"
          @click="searchType = 'playlists'"
        >
          歌单
        </div>
        <div
          class="search-tab-pill"
          :class="{ active: searchType === 'artists' }"
          @click="searchType = 'artists'"
        >
          歌手
        </div>
      </div>

      <Transition :name="streamingTransitionName" mode="out-in">
        <div
          v-if="showNcmSearch && isSearching && !currentDetail"
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
          <StreamingHome
            v-if="activeTab === 'home' && !currentDetail && activeProviderAvailable"
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
                <button
                  v-if="
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
                      <th class="col-cover-header">{{ detailTracks.length }} 首</th>
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
                      <th class="col-cover-header">{{ detailTracks.length }} 首</th>
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
            :show-liked-panel="!isBiliActive"
            :show-social-stats="!isExternalActive"
            :show-feature-cards="!isExternalActive"
            :allow-pin-playlists="isBiliActive"
            :pinned-playlist-ids="activeExternalState?.pinnedPlaylistIds ?? []"
            :pinning-playlist-id="activeExternalState?.pinningPlaylistId ?? null"
            :available-providers="libraryProviders"
            :active-provider="activeProvider"
            @switch-provider="selectProvider"
            @open-user-list="openUserList"
            @open-liked-tracks="openLikedTracks"
            @play-liked-songs="playLikedSongs"
            @open-playlist="openPlaylist"
            @toggle-pinned-playlist="togglePinnedPlaylist"
            @open-recent="openRecent"
            @open-ranking="openRanking"
          />
        </div>
      </Transition>
    </div>

    <!-- Expansion overlay no longer needed, using clip-path on detail-view -->
  </div>
</template>

<style scoped>
.streaming-page {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  box-sizing: border-box;
  background-color: var(--te-streaming-bg);
  background-image: var(--te-streaming-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}

.streaming-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: var(--te-menu-width);
  box-sizing: border-box;
  background: var(--te-card-bg);
  border-right: 1px solid rgba(17, 24, 39, 0.06);
  z-index: 1000;
  overflow: hidden;
  box-shadow: 8px 0 24px rgba(15, 23, 42, 0.04);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transform: translate3d(-100%, 0, 0);
  will-change: transform;
  transition:
    transform 0.32s var(--te-ease-soft),
    box-shadow 0.32s;
}

.streaming-sidebar.open {
  transform: translate3d(0, 0, 0);
}

:global(html[data-theme='dark']) .streaming-sidebar {
  border-right-color: transparent;
  background-color: var(--te-streaming-bg);
  background-image: var(--te-streaming-bg-image);
  background-position: left center;
  background-size: cover;
  background-repeat: no-repeat;
  box-shadow: none;
}

.streaming-sidebar-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 14px 9px 14px 1px;
  width: var(--te-menu-width);
  min-width: 132px;
  max-width: 216px;
}

.streaming-sidebar-header {
  padding: 2px 12px 12px 18px;
  flex-shrink: 0;
}

.streaming-sidebar-title {
  font-size: 13px;
  font-weight: 800;
  color: #6b7280;
  text-transform: none;
  letter-spacing: 0;
}

.streaming-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.streaming-menu-item {
  position: relative;
  display: flex;
  align-items: center;
  height: 42px;
  padding: 0 12px 0 18px;
  cursor: pointer;
  border-radius: 11px;
  color: #111827;
  transition:
    background 0.18s,
    color 0.18s;
  gap: 12px;
  white-space: nowrap;
}

.streaming-menu-item:hover {
  background: var(--te-hover-bg);
}

.streaming-menu-item.active {
  background: var(--te-active-bg);
  color: #0f172a;
  box-shadow: none;
}

.streaming-menu-item.active::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 10px;
  bottom: 10px;
  width: 4px;
  border-radius: 0 999px 999px 0;
  background: #020617;
}

.streaming-menu-item.active .streaming-menu-icon {
  color: #111827;
}

.streaming-menu-icon {
  font-size: 16px;
  width: 17px;
  height: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #4b5563;
  transition: color 0.15s;
}

.streaming-menu-label {
  font-size: 14px;
  font-weight: 700;
  color: currentColor;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.open .streaming-menu-label {
  opacity: 1;
}

.streaming-overlay {
  position: fixed;
  inset: 0 0 96px 0;
  z-index: 999;
  background: rgba(0, 0, 0, 0.15);
}

.streaming-content {
  flex: 0 0 100%;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  width: 100%;
  transform: translate3d(0, 0, 0);
  will-change: transform, flex-basis, width;
  scrollbar-width: thin;
  scrollbar-color: rgba(124, 77, 255, 0.28) transparent;
  transition:
    transform 0.32s var(--te-ease-soft),
    flex-basis 0.32s var(--te-ease-soft),
    width 0.32s var(--te-ease-soft);
}

.streaming-sidebar.open + .streaming-content {
  width: calc(100% - var(--te-menu-width));
  flex-basis: calc(100% - var(--te-menu-width));
  transform: translate3d(var(--te-menu-width), 0, 0);
}

.streaming-content-header {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 64px;
  padding: 12px 0 14px;
  flex-shrink: 0;
  margin: 20px clamp(36px, 6vw, 84px) 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.streaming-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.streaming-content-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--te-neutral-900);
  margin: 0;
}

.streaming-content-subtitle {
  font-size: 12px;
  font-weight: 500;
  color: #666b78;
  margin: 4px 0 0;
}

.streaming-content-body {
  flex: 0 0 auto;
  overflow: visible;
  padding: 14px clamp(36px, 6vw, 84px) 34px;
}

.streaming-page.has-player .streaming-content-body {
  padding-bottom: 126px;
}

.streaming-sidebar-bottom {
  flex-shrink: 0;
  margin-top: auto;
}

.streaming-menu-separator {
  height: 1px;
  background: var(--te-card-border);
  margin: 10px 10px 8px 14px;
}

.streaming-local-btn {
  color: #111827;
}

.streaming-local-btn:hover {
  background: var(--te-hover-bg);
}

.btn-back {
  width: 32px;
  height: 32px;
  border: none;
  background: rgba(124, 77, 255, 0.09);
  cursor: pointer;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--te-primary-500);
  font-size: 16px;
  transition:
    background 0.18s,
    color 0.18s,
    transform 0.18s var(--te-ease-soft);
  flex-shrink: 0;
}

.btn-back:hover {
  background: rgba(124, 77, 255, 0.16);
  color: #5f36df;
  transform: translateY(-1px);
}

.streaming-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  gap: 12px;
  text-align: center;
  border-radius: 8px;
  background: var(--te-card-bg);
  border: 1px solid #eef1f6;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.detail-placeholder {
  min-height: 420px;
}

.placeholder-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--te-neutral-900);
  margin: 0;
}

.placeholder-hint {
  font-size: 13px;
  color: #bbb;
  margin: 0;
}

.library-view,
.detail-view {
  min-height: 100%;
}

.detail-view {
  position: relative;
}

.detail-loading-overlay {
  position: sticky;
  top: 12px;
  z-index: 5;
  width: fit-content;
  margin: 0 40px 12px auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 13px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.74);
  background: var(--te-glass-bg-strong);
  color: rgba(80, 88, 116, 0.72);
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 14px 34px rgba(86, 70, 160, 0.12);
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  pointer-events: none;
}

.detail-loading-overlay i {
  color: var(--te-primary-500);
}

.track-table-wrapper {
  overflow-x: auto;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.64);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.5), rgba(248, 245, 255, 0.32)),
    rgba(255, 255, 255, 0.28);
  box-shadow:
    0 24px 80px rgba(86, 70, 160, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
}

.track-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.track-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.track-table th {
  text-align: left;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0;
  background: var(--te-glass-bg);
  border-bottom: 1px solid rgba(209, 213, 219, 0.42);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
}

.track-row td {
  padding: 14px 12px;
  font-size: 14px;
  color: var(--te-neutral-700);
  border-bottom: 1px solid rgba(229, 231, 235, 0.48);
  vertical-align: middle;
}

.track-row {
  cursor: pointer;
  transition:
    background 0.18s,
    transform 0.18s var(--te-ease-soft),
    box-shadow 0.18s;
}

.track-row:hover {
  background: var(--te-subtle-bg);
  transform: translateX(4px);
  box-shadow: 0 12px 30px rgba(86, 70, 160, 0.08);
}

.track-row:hover td {
  border-bottom-color: rgba(168, 133, 247, 0.24);
}

.track-playing {
  background: linear-gradient(
    90deg,
    rgba(124, 77, 255, 0.16),
    rgba(255, 126, 182, 0.08)
  ) !important;
  box-shadow: inset 3px 0 0 rgba(124, 77, 255, 0.78);
}

.track-playing td {
  border-bottom-color: rgba(124, 77, 255, 0.2) !important;
}

.cover-img {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  object-fit: cover;
}

.cover-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.18), rgba(34, 211, 238, 0.12));
  display: flex;
  align-items: center;
  justify-content: center;
}

.col-index {
  width: 40px;
  color: #bbb !important;
  font-size: 13px !important;
}

.col-cover,
.col-cover-header {
  width: 60px;
  flex-shrink: 0;
}
.col-cover-header {
  color: #888;
  font-size: 10px !important;
  text-align: left;
  padding-left: 12px !important;
}

.playing-indicator {
  display: flex;
  align-items: center;
}

.col-info {
  width: auto;
  line-height: 1.4;
}

.track-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--te-neutral-900);
}

.track-playing .track-title {
  color: var(--te-primary-500);
}

.track-artist {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.col-album {
  width: 180px;
  font-size: 13px !important;
  color: #666 !important;
}

.col-duration {
  width: 80px;
  font-size: 12px !important;
  color: #888 !important;
}

/* ===== Sidebar-aware Page Transition Animation ===== */
.stream-page-down-enter-active,
.stream-page-down-leave-active,
.stream-page-up-enter-active,
.stream-page-up-leave-active {
  transition:
    opacity 0.26s ease,
    transform 0.42s var(--te-ease-soft),
    filter 0.32s ease;
  will-change: transform, opacity, filter;
}

.stream-page-down-enter-from {
  opacity: 0;
  transform: translateY(46px) scale(0.992);
  filter: blur(8px);
}

.stream-page-down-leave-to {
  opacity: 0;
  transform: translateY(-34px) scale(0.992);
  filter: blur(8px);
}

.stream-page-up-enter-from {
  opacity: 0;
  transform: translateY(-46px) scale(0.992);
  filter: blur(8px);
}

.stream-page-up-leave-to {
  opacity: 0;
  transform: translateY(34px) scale(0.992);
  filter: blur(8px);
}

/* ===== Streaming Search Box ===== */
.streaming-header-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  flex: 0 1 auto;
  min-width: 0;
}
.streaming-search-box {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--te-card-bg);
  border: 1px solid #eef1f6;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transition:
    border-color 0.2s,
    background 0.2s,
    box-shadow 0.2s;
  width: clamp(220px, 30vw, 380px);
  flex-shrink: 0;
}

.streaming-search-box.focused {
  border-color: rgba(124, 77, 255, 0.42);
  background: var(--te-subtle-bg);
  box-shadow: 0 0 0 4px rgba(124, 77, 255, 0.1);
}

.streaming-round-btn,
.streaming-avatar-btn {
  position: relative;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  color: var(--te-neutral-700);
  background: var(--te-glass-bg);
  box-shadow: 0 12px 32px rgba(86, 70, 160, 0.08);
  cursor: pointer;
  backdrop-filter: blur(16px) saturate(145%);
  -webkit-backdrop-filter: blur(16px) saturate(145%);
  transition:
    transform 0.18s var(--te-ease-soft),
    background 0.18s,
    box-shadow 0.18s;
}

.streaming-round-btn:hover,
.streaming-avatar-btn:hover {
  transform: translateY(-2px);
  background: var(--te-subtle-bg);
  box-shadow: 0 16px 36px rgba(86, 70, 160, 0.12);
}

.streaming-avatar-btn {
  overflow: hidden;
  padding: 0;
}

.streaming-avatar-btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.notify-dot {
  position: absolute;
  top: 7px;
  right: 8px;
  width: 7px;
  height: 7px;
  border: 2px solid rgba(255, 255, 255, 0.84);
  border-radius: 999px;
  background: #ef4444;
}

.streaming-search-icon {
  font-size: 14px;
  color: #999;
  flex-shrink: 0;
  margin-right: 8px;
  transition: color 0.2s;
}

.streaming-search-box.focused .streaming-search-icon {
  color: var(--te-primary-500);
}

/* ===== Search Tabs ===== */
.streaming-search-tabs {
  display: flex;
  gap: 8px;
  padding: 0 clamp(36px, 6vw, 84px) 14px;
  margin-top: -8px;
}

.search-tab-pill {
  padding: 6px 16px;
  border-radius: 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--te-neutral-700);
  background-color: rgba(255, 255, 255, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.search-tab-pill:hover {
  background-color: rgba(124, 77, 255, 0.1);
  color: var(--te-primary-500);
}

.search-tab-pill.active {
  background: linear-gradient(135deg, var(--te-primary-500), var(--te-primary-300));
  color: #fff;
  box-shadow: 0 12px 30px rgba(124, 77, 255, 0.24);
}

.has-search-tabs {
  padding-top: 0 !important;
}

.streaming-search-input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: #333;
  flex: 1;
  min-width: 0;
  height: 100%;
}

.streaming-search-input::placeholder {
  color: #bbb;
}

.streaming-search-spinner {
  font-size: 14px;
  color: var(--te-primary-500);
  flex-shrink: 0;
  margin-left: 6px;
}

.streaming-search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: rgba(124, 77, 255, 0.12);
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  margin-left: 6px;
  transition: background 0.15s;
}

.streaming-search-clear i {
  font-size: 10px;
  color: #666;
}

.streaming-search-clear:hover {
  background: rgba(124, 77, 255, 0.2);
}

/* Detail Playlist Header */
.detail-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.detail-playlist-header {
  display: flex;
  align-items: flex-end;
  gap: 24px;
  min-height: 176px;
  padding: 18px;
  border: 1px solid #eef1f6;
  border-radius: 8px;
  background: var(--te-card-bg);
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  margin-bottom: 18px;
}

.detail-playlist-cover,
.detail-playlist-cover-placeholder {
  width: 132px;
  height: 132px;
  border-radius: 8px;
  object-fit: cover;
  box-shadow: 0 24px 55px rgba(86, 70, 160, 0.18);
  flex-shrink: 0;
}

.detail-playlist-cover-placeholder {
  background:
    radial-gradient(circle at 72% 22%, rgba(255, 255, 255, 0.54), transparent 24%),
    linear-gradient(135deg, #7c4dff 0%, #c084fc 48%, #ff7eb6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 64px;
}

.detail-playlist-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.detail-playlist-name {
  font-size: clamp(22px, 3vw, 30px);
  font-weight: 800;
  color: var(--te-neutral-900);
  margin: 0 0 12px 0;
  line-height: 1.2;
}

.detail-playlist-desc {
  font-size: 14px;
  color: #666;
  margin: 0 0 24px 0;
}

.detail-play-btn {
  align-self: flex-start;
}

.stream-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 20px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background:
    radial-gradient(circle at 34% 24%, rgba(255, 255, 255, 0.32), transparent 26%),
    linear-gradient(135deg, var(--te-neutral-900), rgba(52, 61, 87, 0.9));
  color: #fff;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  box-shadow:
    0 16px 34px rgba(52, 61, 87, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition:
    transform 0.2s var(--te-ease-soft),
    box-shadow 0.2s,
    opacity 0.2s;
}

.stream-action-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow:
    0 20px 42px rgba(52, 61, 87, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.26);
}

.stream-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.artist-detail-panel,
.artist-playlists-only,
.artist-playlist-section {
  margin-top: 24px;
}

.artist-detail-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 18px;
}

.artist-detail-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid #e7ebf4;
  border-radius: 999px;
  background: var(--te-card-bg);
  color: rgba(42, 49, 74, 0.72);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(34, 42, 68, 0.06);
  transition:
    transform 0.2s var(--te-ease-soft),
    border-color 0.2s,
    background 0.2s,
    color 0.2s;
}

.artist-detail-tab strong {
  min-width: 18px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(26, 115, 232, 0.1);
  color: #1a73e8;
  font-size: 12px;
  line-height: 1.3;
}

.artist-detail-tab:hover {
  transform: translateY(-1px);
  border-color: rgba(26, 115, 232, 0.26);
}

.artist-detail-tab.active {
  background: #1a73e8;
  border-color: #1a73e8;
  color: #fff;
  box-shadow: 0 14px 30px rgba(26, 115, 232, 0.22);
}

.artist-detail-tab.active strong {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.artist-section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.artist-section-heading h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: var(--te-neutral-900);
}

.artist-section-heading p {
  margin: 5px 0 0;
  font-size: 12px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.62);
}

.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  gap: 14px;
}

.playlist-grid-card {
  cursor: pointer;
  padding: 10px;
  border-radius: 8px;
  background: var(--te-card-bg);
  border: 1px solid #eef1f6;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transition:
    transform 0.24s var(--te-ease-soft),
    box-shadow 0.24s,
    background 0.24s;
}

.playlist-grid-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 18px 38px rgba(34, 42, 68, 0.1);
}

.playlist-grid-cover,
.playlist-grid-cover-placeholder {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  object-fit: cover;
  box-shadow: 0 16px 30px rgba(86, 70, 160, 0.13);
}

.playlist-grid-cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.86), transparent 34%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.22), rgba(34, 211, 238, 0.12));
}

.artist-cover {
  border-radius: 50% !important;
}

.playlist-grid-name {
  margin-top: 11px;
  font-size: 13px;
  font-weight: 700;
  color: var(--te-neutral-900);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.playlist-grid-count {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.56);
}

/* ===== Like Button ===== */
.col-like,
.col-like-header {
  width: 44px;
  flex-shrink: 0;
  text-align: center;
}

.col-like-header {
  padding: 0 !important;
}

.btn-like {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 50%;
  cursor: pointer;
  color: #ccc;
  transition:
    color 0.2s,
    background 0.2s,
    transform 0.15s;
  padding: 0;
}

.btn-like:hover {
  background: rgba(232, 67, 147, 0.12);
  color: #e91e63;
  transform: scale(1.15);
}

.btn-like.liked {
  color: #e91e63;
}

.btn-like.liked:hover {
  background: #fce4ec;
  color: #c62828;
}

.btn-like.loading {
  color: #e91e63;
  pointer-events: none;
}

.btn-like:disabled {
  pointer-events: none;
  opacity: 0.6;
}

/* ===== Page Expansion Animation Removed ===== */

.cover-anim-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #7c4dff 0%, #c084fc 48%, #ff7eb6 100%);
}
/* ===== Skeleton Animation ===== */
.playlist-loading-state {
  gap: 0;
}

.playlist-loading-table {
  min-height: 430px;
}

.skeleton-box {
  background: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
  position: relative;
  overflow: hidden;
}

.skeleton-box::after {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 50%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
  animation: skeleton-shimmer 1.5s infinite ease-in-out;
}

@keyframes skeleton-shimmer {
  100% {
    left: 200%;
  }
}

.skeleton-table {
  border-collapse: collapse;
}

.skeleton-row {
  cursor: default !important;
}

.skeleton-row:hover {
  background: transparent !important;
}

.skeleton-cover-box {
  width: 40px;
  height: 40px;
  border-radius: 6px;
}

.skeleton-index-box {
  width: 16px;
  height: 16px;
  margin: 0 auto;
}

.skeleton-title-box {
  width: 60%;
  height: 14px;
  margin-bottom: 8px;
}

.skeleton-artist-box {
  width: 30%;
  height: 12px;
}

.skeleton-album-box {
  width: 70%;
  height: 14px;
}

.skeleton-time-box {
  width: 40px;
  height: 14px;
}

/* ===== Reference-style Streaming Content Refresh ===== */
.streaming-page {
  background-color: var(--te-streaming-bg);
  background-image: var(--te-streaming-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}

.streaming-content {
  position: relative;
  isolation: isolate;
}

.streaming-content::before {
  content: '';
  position: absolute;
  inset: 20px 28px 26px;
  z-index: -1;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.28)),
    rgba(255, 255, 255, 0.24);
  box-shadow:
    0 28px 90px rgba(86, 70, 160, 0.11),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(26px) saturate(148%);
  -webkit-backdrop-filter: blur(26px) saturate(148%);
}

.streaming-content-header {
  min-height: 82px;
  margin: 20px 40px 0;
  padding: 20px 0 14px;
}

.streaming-content-title {
  color: #242946;
  font-size: 22px;
  letter-spacing: 0;
}

.streaming-content-subtitle {
  color: rgba(82, 90, 122, 0.68);
  font-size: 13px;
}

.streaming-content-body {
  padding: 16px 40px 36px;
}

.btn-back,
.streaming-round-btn,
.streaming-avatar-btn {
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 8px;
  background: var(--te-subtle-bg);
  box-shadow:
    0 12px 28px rgba(86, 70, 160, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.btn-back {
  color: #6f46e8;
}

.streaming-search-box {
  height: 36px;
  width: clamp(260px, 34vw, 460px);
  border-radius: 999px;
  background: var(--te-subtle-bg);
  border-color: rgba(255, 255, 255, 0.78);
  box-shadow:
    0 14px 34px rgba(86, 70, 160, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.streaming-search-box.focused {
  background: var(--te-subtle-bg);
  border-color: rgba(168, 133, 247, 0.46);
  box-shadow:
    0 0 0 4px rgba(124, 77, 255, 0.09),
    0 18px 44px rgba(86, 70, 160, 0.12);
}

.streaming-search-input {
  color: #27304f;
  font-size: 13px;
}

.streaming-search-tabs {
  padding: 0 40px 14px;
  gap: 8px;
}

.search-tab-pill {
  min-height: 32px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(64, 73, 108, 0.68);
  background: var(--te-subtle-bg);
  border-color: rgba(255, 255, 255, 0.72);
  box-shadow: 0 10px 24px rgba(86, 70, 160, 0.06);
}

.search-tab-pill.active {
  background: linear-gradient(135deg, #7c4dff, #b469f4);
  color: #fff;
  box-shadow: 0 14px 30px rgba(124, 77, 255, 0.22);
}

.streaming-placeholder,
.track-table-wrapper,
.detail-playlist-header,
.playlist-grid-card {
  border-radius: 8px;
  border-color: rgba(255, 255, 255, 0.72);
  background:
    radial-gradient(circle at 18% 12%, rgba(255, 255, 255, 0.78), transparent 30%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.64), rgba(249, 246, 255, 0.32)),
    rgba(255, 255, 255, 0.24);
  box-shadow:
    0 20px 58px rgba(86, 70, 160, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
}

.streaming-placeholder {
  min-height: 330px;
}

.placeholder-title {
  color: #242946;
  font-weight: 800;
}

.placeholder-hint {
  color: rgba(82, 90, 122, 0.58);
  font-weight: 700;
}

.detail-playlist-header {
  position: relative;
  align-items: center;
  min-height: 218px;
  margin-bottom: 24px;
  padding: 24px;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.72);
}

.detail-playlist-header::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 82% 42%, rgba(255, 255, 255, 0.52), transparent 16%),
    radial-gradient(circle at 84% 44%, rgba(124, 77, 255, 0.12), transparent 28%),
    linear-gradient(115deg, rgba(238, 228, 255, 0.46), rgba(222, 240, 255, 0.34));
}

.detail-playlist-cover,
.detail-playlist-cover-placeholder,
.detail-playlist-info {
  position: relative;
  z-index: 1;
}

.detail-playlist-cover,
.detail-playlist-cover-placeholder {
  width: 168px;
  height: 168px;
  border-radius: 16px;
  box-shadow: 0 24px 50px rgba(86, 70, 160, 0.18);
}

.detail-playlist-name {
  color: #242946;
  font-size: clamp(26px, 4vw, 38px);
  font-weight: 800;
}

.detail-playlist-desc {
  color: rgba(82, 90, 122, 0.64);
  font-weight: 500;
}

.stream-action-btn {
  min-height: 36px;
  border-radius: 8px;
  background: linear-gradient(135deg, #7c4dff, #b469f4);
  box-shadow: 0 15px 32px rgba(124, 77, 255, 0.24);
}

.track-table-wrapper {
  border-radius: 8px;
  overflow: hidden;
}

.track-table {
  border-spacing: 0;
}

.track-table th {
  height: 42px;
  padding: 0 14px;
  color: rgba(82, 90, 122, 0.54);
  font-size: 11px;
  font-weight: 700;
  background: var(--te-subtle-bg);
  border-bottom-color: rgba(213, 219, 235, 0.5);
}

.track-row td {
  padding: 12px 14px;
  color: rgba(54, 62, 96, 0.74);
  border-bottom-color: rgba(226, 231, 242, 0.56);
}

.track-row:hover {
  background: var(--te-subtle-bg);
  transform: none;
  box-shadow: inset 3px 0 0 rgba(124, 77, 255, 0.34);
}

.track-playing {
  background: linear-gradient(
    90deg,
    rgba(124, 77, 255, 0.13),
    rgba(255, 126, 182, 0.07)
  ) !important;
}

.cover-img,
.cover-placeholder {
  width: 42px;
  height: 42px;
  border-radius: 14px;
}

.track-title {
  color: #222744;
  font-weight: 800;
}

.track-artist,
.col-album,
.col-duration,
.col-index {
  color: rgba(82, 90, 122, 0.58) !important;
}

.btn-like {
  color: rgba(124, 77, 255, 0.32);
}

.btn-like:hover,
.btn-like.liked {
  color: #e84393;
}

.playlist-grid {
  grid-template-columns: repeat(auto-fill, minmax(142px, 1fr));
  gap: 18px;
}

.playlist-grid-card {
  padding: 12px;
}

.playlist-grid-card:hover {
  transform: translateY(-4px);
  box-shadow:
    0 24px 64px rgba(86, 70, 160, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}

.playlist-grid-cover,
.playlist-grid-cover-placeholder {
  border-radius: 16px;
}

.playlist-grid-name {
  color: #242946;
}

.playlist-grid-count {
  color: rgba(82, 90, 122, 0.58);
}

.skeleton-box {
  border-radius: 8px;
  background: rgba(124, 77, 255, 0.06);
}

@media (max-width: 900px) {
  .streaming-content::before {
    inset: 12px;
  }

  .streaming-content-header,
  .streaming-content-body,
  .streaming-search-tabs {
    margin-left: 22px;
    margin-right: 22px;
    padding-left: 0;
    padding-right: 0;
  }

  .streaming-content-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .streaming-header-right {
    width: 100%;
    justify-content: flex-start;
  }

  .streaming-search-box {
    width: min(100%, 440px);
  }

  .detail-playlist-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .detail-playlist-cover,
  .detail-playlist-cover-placeholder {
    width: 132px;
    height: 132px;
  }
}

/* ===== White Card Streaming Refinement ===== */
.streaming-page {
  background-color: var(--te-streaming-bg);
  background-image: var(--te-streaming-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}

.streaming-sidebar.open {
  transform: translate3d(0, 0, 0);
}

.streaming-sidebar-inner {
  width: var(--te-menu-width);
  min-width: 132px;
  max-width: 216px;
  padding: 14px 9px 14px 1px;
}

.streaming-sidebar.open + .streaming-content {
  transform: translate3d(var(--te-menu-width), 0, 0);
  width: calc(100% - var(--te-menu-width));
  flex-basis: calc(100% - var(--te-menu-width));
}

.streaming-menu-item {
  height: 42px;
  padding: 0 12px 0 18px;
  border-radius: 11px;
}

.streaming-menu-icon {
  width: 17px;
  height: 17px;
  font-size: 16px;
}

.streaming-menu-label {
  font-size: 14px;
}

.streaming-content::before {
  display: none;
}

.streaming-content-header {
  min-height: 64px;
  margin: 20px clamp(36px, 6vw, 84px) 0;
  padding: 12px 0 14px;
}

.streaming-content-title {
  font-size: 18px;
}

.streaming-content-subtitle {
  font-size: 12px;
}

.streaming-content-body {
  padding: 14px clamp(36px, 6vw, 84px) 34px;
}

.streaming-search-tabs {
  padding: 0 clamp(36px, 6vw, 84px) 14px;
}

.streaming-search-box {
  height: 32px;
  width: clamp(220px, 30vw, 380px);
}

.streaming-search-input {
  font-size: 12px;
}

.streaming-search-box,
.btn-back,
.streaming-round-btn,
.streaming-avatar-btn,
.search-tab-pill,
.streaming-placeholder,
.track-table-wrapper,
.detail-playlist-header,
.playlist-grid-card {
  background: var(--te-card-bg);
  border-color: #eef1f6;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.streaming-search-box.focused {
  background: var(--te-card-bg);
  border-color: #d9d1ff;
  box-shadow: 0 0 0 4px rgba(124, 77, 255, 0.08);
}

.search-tab-pill.active {
  background: #7c4dff;
  box-shadow: 0 12px 24px rgba(124, 77, 255, 0.18);
}

.streaming-placeholder,
.track-table-wrapper,
.detail-playlist-header,
.playlist-grid-card {
  border-radius: 8px;
}

.streaming-placeholder {
  min-height: 260px;
}

.detail-playlist-header {
  min-height: 176px;
  margin-bottom: 18px;
  padding: 18px;
}

.detail-playlist-cover,
.detail-playlist-cover-placeholder {
  width: 132px;
  height: 132px;
}

.detail-playlist-name {
  font-size: clamp(22px, 3vw, 30px);
}

.track-table th {
  height: 36px;
  padding: 0 12px;
}

.track-row td {
  padding: 10px 12px;
}

.cover-img,
.cover-placeholder {
  width: 36px;
  height: 36px;
}

.playlist-grid {
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  gap: 14px;
}

.playlist-grid-card {
  padding: 10px;
}

.detail-playlist-header::before {
  display: none;
}

.detail-playlist-header {
  background: var(--te-card-bg);
  border: 1px solid #eef1f6;
}

.track-table th {
  background: #fbfcff;
  border-bottom-color: #eef1f6;
}

.track-row td {
  border-bottom-color: #f0f2f7;
}

.track-row:hover {
  background: #faf8ff;
  box-shadow: inset 3px 0 0 rgba(124, 77, 255, 0.28);
}

.track-playing {
  background: #f5f1ff !important;
}

.cover-placeholder,
.playlist-grid-cover-placeholder,
.detail-playlist-cover-placeholder {
  background: #f3f0ff;
}

.stream-action-btn {
  background: #7c4dff;
  box-shadow: 0 12px 24px rgba(124, 77, 255, 0.2);
}

.playlist-grid-card:hover {
  box-shadow: 0 18px 38px rgba(34, 42, 68, 0.1);
}

:global(html[data-theme='dark']) .streaming-page {
  background-color: var(--te-streaming-bg);
  background-image: var(--te-streaming-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}

:global(html[data-theme='dark']) .streaming-search-box,
:global(html[data-theme='dark']) .btn-back,
:global(html[data-theme='dark']) .streaming-round-btn,
:global(html[data-theme='dark']) .streaming-avatar-btn,
:global(html[data-theme='dark']) .search-tab-pill,
:global(html[data-theme='dark']) .streaming-placeholder,
:global(html[data-theme='dark']) .track-table-wrapper,
:global(html[data-theme='dark']) .detail-playlist-header,
:global(html[data-theme='dark']) .playlist-grid-card {
  background: var(--te-card-bg);
  border-color: var(--te-card-border);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.24);
}

:global(html[data-theme='dark']) .streaming-search-box.focused {
  background: #1d1d1d;
  border-color: rgba(var(--te-primary-rgb), 0.42);
  box-shadow: 0 0 0 4px rgba(var(--te-primary-rgb), 0.12);
}

:global(html[data-theme='dark']) .search-tab-pill.active,
:global(html[data-theme='dark']) .stream-action-btn {
  background: var(--te-primary-500);
  color: #111111;
  box-shadow: 0 12px 24px rgba(var(--te-primary-rgb), 0.18);
}

:global(html[data-theme='dark']) .detail-playlist-header {
  background: var(--te-card-bg);
  border-color: var(--te-card-border);
}

:global(html[data-theme='dark']) .track-table th {
  background: #141414;
  border-bottom-color: var(--te-card-border);
}

:global(html[data-theme='dark']) .track-row td {
  border-bottom-color: rgba(255, 255, 255, 0.075);
}

:global(html[data-theme='dark']) .track-row:hover {
  background: rgba(245, 158, 11, 0.08);
  box-shadow: inset 3px 0 0 rgba(var(--te-primary-rgb), 0.42);
}

:global(html[data-theme='dark']) .track-playing {
  background: rgba(245, 158, 11, 0.12) !important;
}

:global(html[data-theme='dark']) .cover-placeholder,
:global(html[data-theme='dark']) .playlist-grid-cover-placeholder,
:global(html[data-theme='dark']) .detail-playlist-cover-placeholder {
  background: #242016;
  color: var(--te-primary-400);
}

:global(html[data-theme='dark']) .playlist-grid-card:hover {
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.34);
}

@media (max-width: 900px) {
  .streaming-content-header,
  .streaming-content-body,
  .streaming-search-tabs {
    margin-left: 24px;
    margin-right: 24px;
    padding-left: 0;
    padding-right: 0;
  }
}
</style>
