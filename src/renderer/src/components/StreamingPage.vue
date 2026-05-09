<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Track } from '../types/music'
import { useNcmStore, type NcmPlaylistSummary } from '../stores/useNcmStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import Card from 'primevue/card'
import Avatar from 'primevue/avatar'
import Button from 'primevue/button'
import Divider from 'primevue/divider'

interface RecSection {
  key: string
  title: string
  tracks: Track[]
  icon: string
}

type StreamingTab = 'home' | 'playlists' | 'library'
type DetailView =
  | { type: 'liked' }
  | { type: 'playlist'; playlist: NcmPlaylistSummary }
  | { type: 'rec'; section: RecSection }

const props = defineProps<{
  menuOpen: boolean
  hasPlayer: boolean
}>()

const activeTab = ref<StreamingTab>('home')
const currentDetail = ref<DetailView | null>(null)
const detailTracks = ref<Track[]>([])
const detailLoading = ref(false)
const detailError = ref('')
const likedCount = ref<number | null>(null)

const dailySongs = ref<Track[]>([])
const personalFmSongs = ref<Track[]>([])
const privateContentSongs = ref<Track[]>([])
const recommendPlaylists = ref<NcmPlaylistSummary[]>([])
const recsLoading = ref(false)
const recsError = ref('')

async function loadRecommendations(): Promise<void> {
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

async function openRecSection(section: RecSection, _event: MouseEvent): Promise<void> {
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

const tabs: TabItem[] = [
  { key: 'home', label: '主页', icon: 'pi pi-home' },
  { key: 'playlists', label: '歌单', icon: 'pi pi-bookmark' },
  { key: 'library', label: '音乐库', icon: 'pi pi-wave-pulse' }
]

const currentView = computed(() => tabs.find((t) => t.key === activeTab.value))

const emit = defineEmits<{
  toggleMenu: []
  backToLocal: []
}>()

const {
  isLoggedIn,
  profile,
  libraryLoading,
  libraryLoaded,
  libraryError,
  likedPlaylist,
  userPlaylists,
  fetchUserLibrary,
  fetchPlaylistTracks,
  fetchLikedTracks,
  fetchRecommendSongs,
  fetchRecommendPlaylists,
  fetchPersonalFm,
  fetchPrivateContent,
  searchSongs,
  likeTrack,
  isTrackLiked,
  syncLikedIds
} = useNcmStore()

// ===== Search =====
const searchQuery = ref('')
const searchResults = ref<Track[]>([])
const searchTotal = ref(0)
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
  searchTotal.value = 0
  searchLoading.value = false
  searchError.value = ''
}

async function performSearch(keywords: string): Promise<void> {
  if (!keywords.trim()) {
    searchResults.value = []
    searchTotal.value = 0
    return
  }
  searchLoading.value = true
  searchError.value = ''
  try {
    const { tracks, total } = await searchSongs(keywords.trim())
    // Only apply if the query is still the same
    if (searchQuery.value.trim() === keywords.trim()) {
      searchResults.value = tracks
      searchTotal.value = total
    }
  } catch (e) {
    if (searchQuery.value.trim() === keywords.trim()) {
      searchError.value = e instanceof Error ? e.message : '搜索失败'
      searchResults.value = []
      searchTotal.value = 0
    }
  } finally {
    if (searchQuery.value.trim() === keywords.trim()) {
      searchLoading.value = false
    }
  }
}

watch(searchQuery, (val) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  const q = val.trim()
  if (!q) {
    searchResults.value = []
    searchTotal.value = 0
    searchLoading.value = false
    searchError.value = ''
    return
  }
  searchLoading.value = true
  searchDebounceTimer = setTimeout(() => {
    performSearch(q)
  }, 300)
})

function onSearchTrackClick(track: Track): void {
  playTrack(track, searchResults.value)
}

const { currentTrack, playTrack, formatTime } = usePlayerStore()

const profileSignature = computed(() => profile.value?.signature?.trim() || '暂无个人简介')

const headerTitle = computed(() => {
  if (isSearching.value) return `搜索: ${searchQuery.value.trim()}`
  if (currentDetail.value?.type === 'rec') return currentDetail.value.section.title
  if (currentDetail.value?.type === 'liked') return '我收藏的歌曲'
  if (currentDetail.value?.type === 'playlist') return currentDetail.value.playlist.name
  return currentView.value?.label ?? '流媒体'
})

const headerSubtitle = computed(() => {
  if (isSearching.value) {
    if (searchLoading.value) return '正在搜索...'
    if (searchError.value) return searchError.value
    return `找到 ${searchTotal.value} 首相关歌曲`
  }
  if (currentDetail.value) {
    return `${detailTracks.value.length} 首`
  }
  if (activeTab.value === 'library') {
    return isLoggedIn.value ? '我的网易云收藏与歌单' : '登录后可浏览网易云音乐库'
  }
  if (activeTab.value === 'playlists') {
    return '发现与浏览在线歌单'
  }
  if (isLoggedIn.value && profile.value) {
    return `欢迎回来，${profile.value.nickname}`
  }
  return '连接网易云音乐后可使用'
})

const rootLoading = computed(() => libraryLoading.value && !currentDetail.value)

const likedSummary = computed(() => ({
  name: '我收藏的歌曲',
  cover: likedPlaylist.value?.cover ?? null,
  trackCount: likedCount.value ?? likedPlaylist.value?.trackCount ?? 0
}))

const userPlaylistEntries = computed(() => userPlaylists.value)

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
      desc: `共 ${currentDetail.value.playlist.trackCount} 首歌曲`,
      icon: 'pi pi-list'
    }
  }
  if (currentDetail.value.type === 'rec') {
    return {
      title: currentDetail.value.section.title,
      cover: currentDetail.value.section.tracks.length > 0 ? currentDetail.value.section.tracks[0].cover : null,
      desc: `共 ${currentDetail.value.section.tracks.length} 首歌曲`,
      icon: currentDetail.value.section.icon
    }
  }
  return null
})

function selectTab(key: StreamingTab): void {
  if (activeTab.value !== key) {
    resetDetail()
  }
  activeTab.value = key
}

function resetDetail(): void {
  currentDetail.value = null
  detailTracks.value = []
  detailLoading.value = false
  detailError.value = ''
}

async function ensureLibraryLoaded(force = false): Promise<void> {
  if (!isLoggedIn.value) return
  try {
    await fetchUserLibrary(force)
  } catch {
    // error is already stored in libraryError
  }
}

async function openLikedTracks(force = false): Promise<void> {
  currentDetail.value = { type: 'liked' }
  detailLoading.value = true
  detailError.value = ''

  try {
    const tracks = await fetchLikedTracks(force)
    detailTracks.value = tracks
    likedCount.value = tracks.length
    syncLikedIds(tracks)
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : '加载收藏歌曲失败'
    detailTracks.value = []
  } finally {
    detailLoading.value = false
  }
}

async function openPlaylist(playlist: NcmPlaylistSummary, force = false, _event?: MouseEvent): Promise<void> {
  currentDetail.value = { type: 'playlist', playlist }
  detailLoading.value = true
  detailError.value = ''

  try {
    detailTracks.value = await fetchPlaylistTracks(playlist.id, force)
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : '加载歌单失败'
    detailTracks.value = []
  } finally {
    detailLoading.value = false
  }
}

function goBack(): void {
  resetDetail()
}

function onTrackClick(track: Track): void {
  playTrack(track, detailTracks.value)
}

async function playLikedSongs(): Promise<void> {
  if (currentDetail.value?.type !== 'liked') {
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
  await ensureLibraryLoaded(true)
}

watch(activeTab, async (tab) => {
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
    if (activeTab.value === 'home') {
      loadRecommendations()
    }
    if (activeTab.value === 'library') {
      await ensureLibraryLoaded(true)
    }
  }
)

onMounted(async () => {
  if (activeTab.value === 'home' && isLoggedIn.value) {
    loadRecommendations()
  }
  if (activeTab.value === 'library') {
    await ensureLibraryLoaded()
  }
})
</script>

<template>
  <div class="streaming-page" :style="{ bottom: props.hasPlayer ? '72px' : '0px' }">
    <div class="streaming-sidebar" :class="{ open: menuOpen }" :style="{ bottom: props.hasPlayer ? '72px' : '0px' }">
      <div class="streaming-sidebar-inner">
        <div class="streaming-sidebar-header">
          <span class="streaming-sidebar-title">流媒体</span>
        </div>
        <nav class="streaming-nav">
          <div
            v-for="tab in tabs"
            :key="tab.key"
            class="streaming-menu-item"
            :class="{ active: activeTab === tab.key }"
            @click="selectTab(tab.key)"
          >
            <i class="streaming-menu-icon" :class="tab.icon"></i>
            <span class="streaming-menu-label">{{ tab.label }}</span>
          </div>
        </nav>
        <div class="streaming-sidebar-bottom">
          <div class="streaming-menu-separator"></div>
          <div class="streaming-menu-item streaming-local-btn" @click="emit('backToLocal')">
            <i class="pi pi-home" style="font-size: 16px; width: 20px; text-align: center; flex-shrink: 0"></i>
            <span class="streaming-menu-label">本地模式</span>
          </div>
        </div>
      </div>
    </div>


    <div class="streaming-content">
      <div class="streaming-content-header">
        <div class="streaming-header-left">
          <button v-if="currentDetail || isSearching" class="btn-back" title="返回" @click="isSearching ? clearSearch() : goBack()">
            <i class="pi pi-arrow-left"></i>
          </button>
          <div>
            <h2 class="streaming-content-title">{{ headerTitle }}</h2>
          </div>
        </div>
        <div class="streaming-header-right">
          <div v-if="isLoggedIn" class="streaming-search-box" :class="{ focused: searchInputFocused }">
            <i class="pi pi-search streaming-search-icon"></i>
            <input
              v-model="searchQuery"
              type="text"
              class="streaming-search-input"
              placeholder="搜索网易云音乐..."
              @focus="searchInputFocused = true"
              @blur="searchInputFocused = false"
            />
            <i v-if="searchLoading" class="pi pi-spin pi-spinner streaming-search-spinner"></i>
            <button v-else-if="searchQuery" class="streaming-search-clear" @click="clearSearch">
              <i class="pi pi-times"></i>
            </button>
          </div>
        </div>
      </div>

      <Transition name="tab-fade" mode="out-in">
        <div v-if="isSearching" key="search-results" class="streaming-content-body">
          <div v-if="searchLoading && searchResults.length === 0" class="streaming-placeholder">
            <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #999"></i>
            <p class="placeholder-title">正在搜索</p>
            <p class="placeholder-hint">请稍候...</p>
          </div>
          <div v-else-if="searchError && searchResults.length === 0" class="streaming-placeholder">
            <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
            <p class="placeholder-title">搜索失败</p>
            <p class="placeholder-hint">{{ searchError }}</p>
            <Button label="重试" severity="contrast" @click="performSearch(searchQuery.trim())" />
          </div>
          <div v-else-if="searchResults.length === 0" class="streaming-placeholder">
            <i class="pi pi-search" style="font-size: 40px; color: #ccc"></i>
            <p class="placeholder-title">未找到相关歌曲</p>
            <p class="placeholder-hint">试试换个关键词搜索</p>
          </div>
          <div v-else class="track-table-wrapper">
            <table class="track-table">
              <thead>
                <tr>
                  <th class="col-cover-header">{{ searchTotal }} 首</th>
                  <th class="col-index">#</th>
                  <th class="col-info">标题</th>
                  <th class="col-like-header"></th>
                  <th class="col-album">专辑</th>
                  <th class="col-duration">时长</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(track, index) in searchResults"
                  :key="track.id"
                  class="track-row"
                  :class="{ 'track-playing': currentTrack?.id === track.id }"
                  @click="onSearchTrackClick(track)"
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
                      :class="{ liked: isTrackLiked(track.ncmSongId), loading: likingTracks.has(track.ncmSongId ?? 0) }"
                      :disabled="likingTracks.has(track.ncmSongId ?? 0)"
                      @click="onLikeTrack(track, $event)"
                      title="喜欢"
                    >
                      <i v-if="likingTracks.has(track.ncmSongId ?? 0)" class="pi pi-spin pi-spinner" style="font-size: 14px"></i>
                      <i v-else :class="isTrackLiked(track.ncmSongId) ? 'pi pi-heart-fill' : 'pi pi-heart'" style="font-size: 14px"></i>
                    </button>
                  </td>
                  <td class="col-album">{{ track.album }}</td>
                  <td class="col-duration">{{ formatTime(track.duration) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-else :key="activeTab" class="streaming-content-body">
        <div v-if="activeTab === 'home' && !currentDetail" class="home-view">
          <div v-if="!isLoggedIn" class="streaming-placeholder">
            <i class="pi pi-home" style="font-size: 48px; color: #ccc"></i>
            <p class="placeholder-title">流媒体主页</p>
            <p class="placeholder-hint">点击左上角头像登录网易云音乐</p>
          </div>
          <div v-else-if="recsLoading" class="streaming-placeholder">
            <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #999"></i>
            <p class="placeholder-title">正在加载推荐</p>
            <p class="placeholder-hint">请稍候...</p>
          </div>
          <div v-else-if="recsError" class="streaming-placeholder">
            <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
            <p class="placeholder-title">加载失败</p>
            <p class="placeholder-hint">{{ recsError }}</p>
            <Button label="重试" severity="contrast" @click="loadRecommendations" />
          </div>
          <div v-else class="rec-sections">
            <Divider align="left">
              <span class="section-title main-section-title">个人推荐</span>
            </Divider>
            <div class="playlist-grid">
              <div
                v-for="section in recSections"
                :key="section.key"
                class="playlist-grid-card"
                @click="openRecSection(section, $event)"
              >
                <img
                  v-if="section.tracks.length > 0 && section.tracks[0].cover"
                  :src="section.tracks[0].cover"
                  class="playlist-grid-cover"
                  alt=""
                />
                <div v-else class="playlist-grid-cover-placeholder">
                  <i :class="section.icon" style="font-size: 28px; color: #bbb"></i>
                </div>
                <div class="playlist-grid-name">{{ section.title }}</div>
                <div class="playlist-grid-count">{{ section.tracks.length || '暂无' }} 首</div>
              </div>
            </div>

            <Divider align="left" style="margin-top: 32px;">
              <span class="section-title main-section-title">歌单推荐</span>
            </Divider>
            <div class="playlist-grid">
              <div
                v-for="playlist in recommendPlaylists"
                :key="playlist.id"
                class="playlist-grid-card"
                @click="openPlaylist(playlist, false, $event)"
              >
                <img v-if="playlist.cover" :src="playlist.cover" class="playlist-grid-cover" alt="" />
                <div v-else class="playlist-grid-cover-placeholder">
                  <i class="pi pi-list" style="font-size: 28px; color: #bbb"></i>
                </div>
                <div class="playlist-grid-name">{{ playlist.name }}</div>
                <div class="playlist-grid-count">{{ playlist.trackCount }} 首</div>
              </div>
            </div>

          </div>
        </div>

        <div v-else-if="activeTab === 'playlists' && !currentDetail" class="streaming-placeholder">
          <i class="pi pi-bookmark" style="font-size: 48px; color: #ccc"></i>
          <p class="placeholder-title">歌单页暂不展示个人歌单</p>
          <p class="placeholder-hint">你创建的歌单已经移动到音乐库页面下方列表</p>
        </div>

        <div v-else-if="!isLoggedIn && !currentDetail" class="streaming-placeholder">
          <i class="pi pi-user" style="font-size: 48px; color: #ccc"></i>
          <p class="placeholder-title">请先登录网易云音乐</p>
          <p class="placeholder-hint">登录后即可加载我收藏的歌曲和在线歌单</p>
        </div>

        <div v-else-if="rootLoading && !currentDetail" class="streaming-placeholder">
          <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #999"></i>
          <p class="placeholder-title">正在加载音乐库</p>
          <p class="placeholder-hint">请稍候...</p>
        </div>

        <div v-else-if="!currentDetail && libraryError" class="streaming-placeholder">
          <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
          <p class="placeholder-title">加载失败</p>
          <p class="placeholder-hint">{{ libraryError }}</p>
          <Button label="重试" severity="contrast" @click="retryCurrentView" />
        </div>

        <div v-else-if="currentDetail" class="detail-view">
          <div v-if="detailHeaderInfo" class="detail-playlist-header">
            <img v-if="detailHeaderInfo.cover" :src="detailHeaderInfo.cover" class="detail-playlist-cover" alt="cover" />
            <div v-else class="detail-playlist-cover-placeholder">
              <i :class="detailHeaderInfo.icon"></i>
            </div>
            <div class="detail-playlist-info">
              <h2 class="detail-playlist-name">{{ detailHeaderInfo.title }}</h2>
              <p class="detail-playlist-desc">{{ detailHeaderInfo.desc }}</p>
              <Button
                label="播放全部"
                icon="pi pi-play"
                rounded
                severity="contrast"
                class="detail-play-btn"
                :disabled="detailLoading || detailTracks.length === 0"
                @click="detailTracks.length > 0 && playTrack(detailTracks[0], detailTracks)"
              />
            </div>
          </div>

          <div v-if="detailLoading && detailTracks.length === 0" class="streaming-placeholder detail-placeholder">
            <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #999"></i>
            <p class="placeholder-title">正在加载歌曲</p>
            <p class="placeholder-hint">请稍候...</p>
          </div>

          <div v-else-if="detailError" class="streaming-placeholder detail-placeholder">
            <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
            <p class="placeholder-title">加载失败</p>
            <p class="placeholder-hint">{{ detailError }}</p>
            <Button label="重试" severity="contrast" @click="retryCurrentView" />
          </div>

          <div v-else-if="detailTracks.length === 0 && !detailLoading" class="streaming-placeholder detail-placeholder">
            <i class="pi pi-wave-pulse" style="font-size: 40px; color: #ccc"></i>
            <p class="placeholder-title">暂无歌曲</p>
            <p class="placeholder-hint">这个页面目前没有可展示的歌曲</p>
          </div>

          <div v-else class="detail-content">
            <div class="track-table-wrapper">
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
                      :class="{ liked: isTrackLiked(track.ncmSongId), loading: likingTracks.has(track.ncmSongId ?? 0) }"
                      :disabled="likingTracks.has(track.ncmSongId ?? 0)"
                      @click="onLikeTrack(track, $event)"
                      title="喜欢"
                    >
                      <i v-if="likingTracks.has(track.ncmSongId ?? 0)" class="pi pi-spin pi-spinner" style="font-size: 14px"></i>
                      <i v-else :class="isTrackLiked(track.ncmSongId) ? 'pi pi-heart-fill' : 'pi pi-heart'" style="font-size: 14px"></i>
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

        <div v-else class="library-view">
          <div class="library-hero">
            <Card class="profile-card compact-profile-card">
              <template #content>
                <div class="profile-row compact-profile-row">
                  <Avatar
                    v-if="profile?.avatarUrl"
                    :image="profile.avatarUrl"
                    shape="circle"
                    size="xlarge"
                  />
                  <Avatar v-else icon="pi pi-user" shape="circle" size="xlarge" />
                  <div class="profile-meta">
                    <div class="profile-name">{{ profile?.nickname || '未登录用户' }}</div>
                    <div class="profile-subtitle">网易云音乐个人音乐库</div>
                    <p class="profile-signature">{{ profileSignature }}</p>
                  </div>
                </div>
              </template>
            </Card>

            <Card class="liked-songs-card liked-songs-hero-card" @click="openLikedTracks()">
              <template #content>
                <div class="liked-card-content hero-liked-card-content">
                  <div class="liked-card-main">
                    <div class="liked-card-badge liked-card-badge-hero">我的收藏</div>
                    <h3 class="liked-card-title">{{ likedSummary.name }}</h3>
                    <p class="liked-card-desc">{{ likedSummary.trackCount }} 首歌曲</p>
                    <Button
                      label="播放"
                      icon="pi pi-play"
                      rounded
                      severity="contrast"
                      class="liked-play-btn"
                      @click.stop="playLikedSongs"
                    />
                  </div>
                  <div class="liked-card-cover-wrap hero-liked-cover-wrap">
                    <img v-if="likedSummary.cover" :src="likedSummary.cover" class="liked-card-cover hero-liked-card-cover" alt="cover" />
                    <div v-else class="liked-card-cover-placeholder hero-liked-card-cover-placeholder">
                      <i class="pi pi-heart-fill"></i>
                    </div>
                  </div>
                </div>
              </template>
            </Card>
          </div>

          <Divider align="left">
            <span class="section-title">我的歌单</span>
          </Divider>

          <div v-if="libraryLoaded && userPlaylistEntries.length === 0" class="empty-state only-empty-state">
            <p class="empty-text">暂无在线歌单</p>
            <p class="empty-hint">当前账号还没有可展示的在线歌单</p>
          </div>

          <div v-else class="playlist-list">
            <Card
              v-for="playlist in userPlaylistEntries"
              :key="playlist.id"
              class="playlist-list-item"
              @click="openPlaylist(playlist, false, $event)"
            >
              <template #content>
                <div class="playlist-row">
                  <Avatar
                    v-if="playlist.cover"
                    :image="playlist.cover"
                    shape="square"
                    size="large"
                    class="playlist-avatar"
                  />
                  <Avatar
                    v-else
                    icon="pi pi-list"
                    shape="square"
                    size="large"
                    class="playlist-avatar"
                  />
                  <div class="playlist-meta">
                    <div class="playlist-row-title">{{ playlist.name }}</div>
                    <div class="playlist-row-subtitle">{{ playlist.trackCount }} 首</div>
                  </div>
                  <Button icon="pi pi-chevron-right" text rounded aria-label="打开歌单" />
                </div>
              </template>
            </Card>
          </div>
        </div>
        </div>
      </Transition>
    </div>

    <!-- Expansion overlay no longer needed, using clip-path on detail-view -->
  </div>
</template>

<style scoped>
.streaming-page {
  position: fixed;
  inset: 32px 0 72px 0;
  z-index: 50;
  display: flex;
  background: #fff;
}

.streaming-sidebar {
  position: fixed;
  top: 32px;
  left: 0;
  width: 0;
  background: #fff;
  border-right: 1px solid #e8e8e8;
  z-index: 1000;
  overflow: hidden;
  transition: width 0.25s ease;
}

.streaming-sidebar.open {
  width: 25vw;
  min-width: 150px;
  max-width: 270px;
}

.streaming-sidebar-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px 8px;
  width: 25vw;
  min-width: 150px;
  max-width: 270px;
}

.streaming-sidebar-header {
  padding: 8px 12px 16px;
  flex-shrink: 0;
}

.streaming-sidebar-title {
  font-size: 13px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.streaming-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.streaming-menu-item {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 12px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s;
  gap: 12px;
  white-space: nowrap;
}

.streaming-menu-item:hover {
  background: #f0f0f0;
}

.streaming-menu-item.active {
  background: #e8f0fe;
}

.streaming-menu-item.active .streaming-menu-icon {
  color: #1a73e8;
}

.streaming-menu-icon {
  font-size: 18px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #555;
  transition: color 0.15s;
}

.streaming-menu-label {
  font-size: 14px;
  color: #333;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.open .streaming-menu-label {
  opacity: 1;
}

.streaming-overlay {
  position: fixed;
  inset: 32px 0 72px 0;
  z-index: 999;
  background: rgba(0, 0, 0, 0.15);
}

.streaming-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin-left: 0;
  transition: margin-left 0.25s ease;
}

.streaming-sidebar.open + .streaming-content {
  margin-left: clamp(150px, 25vw, 270px);
}

.streaming-content-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 40px 20px;
  flex-shrink: 0;
}

.streaming-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.streaming-content-title {
  font-size: 24px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0;
}

.streaming-content-subtitle {
  font-size: 13px;
  color: #888;
  margin: 4px 0 0;
}

.streaming-content-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 40px 24px;
}

.streaming-sidebar-bottom {
  flex-shrink: 0;
  margin-top: auto;
}

.streaming-menu-separator {
  height: 1px;
  background: #e8e8e8;
  margin: 8px 12px;
}

.streaming-local-btn {
  color: #555;
}

.streaming-local-btn:hover {
  background: #f0f0f0;
}

.btn-back {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 16px;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.btn-back:hover {
  background: #f0f0f0;
  color: #1a1a1a;
}

.streaming-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  gap: 12px;
  text-align: center;
}

.detail-placeholder {
  min-height: 420px;
}

.placeholder-title {
  font-size: 18px;
  font-weight: 500;
  color: #999;
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

.library-hero {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(360px, 1.1fr);
  gap: 18px;
  align-items: stretch;
  margin-bottom: 8px;
}

.profile-card,
.liked-songs-card,
.playlist-list-item {
  border-radius: 20px;
  overflow: hidden;
}

.profile-card {
  margin-bottom: 20px;
}

.compact-profile-card {
  margin-bottom: 0;
}

.profile-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.compact-profile-row {
  align-items: flex-start;
}

.profile-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-name {
  font-size: 22px;
  font-weight: 700;
  color: #1a1a1a;
}

.profile-subtitle {
  font-size: 13px;
  color: #888;
}

.profile-signature {
  font-size: 14px;
  line-height: 1.6;
  color: #666;
  margin: 10px 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.liked-songs-card {
  cursor: pointer;
  margin-bottom: 8px;
}

.liked-songs-hero-card {
  margin-bottom: 0;
  background: linear-gradient(135deg, #6a5cff 0%, #a855f7 48%, #ec4899 100%);
  color: #fff;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  box-shadow: 0 16px 40px rgba(126, 87, 255, 0.24);
}

.liked-songs-hero-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 22px 50px rgba(126, 87, 255, 0.3);
}

.liked-card-content {
  display: flex;
  align-items: center;
  gap: 18px;
}

.hero-liked-card-content {
  height: 100%;
  justify-content: space-between;
}

.liked-card-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  min-width: 0;
  flex: 1;
}

.liked-card-cover-wrap {
  flex-shrink: 0;
}

.liked-card-cover,
.liked-card-cover-placeholder {
  width: 84px;
  height: 84px;
  border-radius: 18px;
}

.hero-liked-card-cover,
.hero-liked-card-cover-placeholder {
  width: 112px;
  height: 112px;
  border-radius: 24px;
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.18);
}

.liked-card-cover {
  object-fit: cover;
}

.liked-card-cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ff758c 0%, #ff7eb3 100%);
  color: #fff;
  font-size: 28px;
}

.hero-liked-card-cover-placeholder {
  background: rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(10px);
}

.liked-card-info {
  flex: 1;
  min-width: 0;
}

.liked-card-badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: #ffe8ee;
  color: #d94870;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 10px;
}

.liked-card-badge-hero {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}

.liked-card-title {
  font-size: 22px;
  font-weight: 700;
  color: #1a1a1a;
  margin: 0 0 6px;
}

.liked-songs-hero-card .liked-card-title,
.liked-songs-hero-card .liked-card-desc {
  color: #fff;
}

.liked-card-desc {
  font-size: 14px;
  color: #777;
  margin: 0;
}

.liked-play-btn {
  margin-top: 18px;
}

.hero-liked-cover-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #666;
}

.main-section-title {
  font-size: 20px !important;
  font-weight: 800 !important;
  color: #1a1a1a !important;
}

.playlist-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.playlist-list-item {
  cursor: pointer;
}

.playlist-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.playlist-avatar {
  flex-shrink: 0;
}

.playlist-meta {
  flex: 1;
  min-width: 0;
}

.playlist-row-title {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playlist-row-subtitle {
  font-size: 12px;
  color: #888;
  margin-top: 4px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  text-align: center;
}

.empty-text {
  font-size: 18px;
  color: #999;
  margin: 0 0 8px;
}

.empty-hint {
  font-size: 13px;
  color: #bbb;
  margin: 0;
}

.track-table-wrapper {
  overflow-x: auto;
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
  letter-spacing: 0.5px;
  background: #fff;
  border-bottom: 1px solid #eee;
}

.track-row td {
  padding: 14px 12px;
  font-size: 14px;
  color: #333;
  border-bottom: 1px solid #f2f2f2;
  vertical-align: middle;
}

.track-row {
  cursor: pointer;
  transition: background 0.1s;
}

.track-row:hover {
  background: #fafafa;
}

.track-row:hover td {
  border-bottom-color: #e8e8e8;
}

.track-playing {
  background: #e8f0fe !important;
}

.track-playing td {
  border-bottom-color: #d4e4fc !important;
}


.cover-img {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
}

.cover-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.col-index {
  width: 40px;
  color: #bbb !important;
  font-size: 13px !important;
}

.col-cover, .col-cover-header {
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
  font-weight: 500;
  color: #1a1a1a;
}

.track-playing .track-title {
  color: #1a73e8;
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

/* ===== Home Recommendations ===== */
.home-view {
  min-height: 100%;
}

.rec-sections {
  display: flex;
  flex-direction: column;
}

.rec-hero-row {
  display: flex;
  gap: 14px;
}

.rec-hero-card {
  flex-shrink: 0;
  width: 150px;
  cursor: pointer;
  transition: transform 0.15s;
}

.rec-hero-card:hover {
  transform: translateY(-3px);
}

.rec-hero-cover {
  width: 150px;
  height: 150px;
  object-fit: cover;
  border-radius: 10px;
  margin-bottom: 8px;
}

.rec-hero-cover-placeholder {
  width: 150px;
  height: 150px;
  border-radius: 10px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.rec-hero-name {
  font-size: 13px;
  font-weight: 500;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.rec-hero-count {
  font-size: 11px;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Detail view after clicking a rec hero card */
.rec-detail {
  margin-top: 24px;
}

.rec-detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.rec-detail-title {
  font-size: 20px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0;
}

.rec-detail-count {
  font-size: 12px;
  color: #999;
}

.rec-empty {
  height: 60px;
  display: flex;
  align-items: center;
  color: #bbb;
  font-size: 13px;
}

.rec-track-list {
  display: flex;
  flex-direction: column;
}

.rec-track-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s;
}

.rec-track-row:hover {
  background: #fafafa;
}

.rec-track-row.track-playing {
  background: #e8f0fe;
}

.rec-track-row.track-playing .rec-track-title {
  color: #1a73e8;
}

.rec-track-index {
  width: 28px;
  text-align: center;
  font-size: 13px;
  color: #bbb;
  flex-shrink: 0;
}

.rec-track-row.track-playing .rec-track-index {
  color: #1a73e8;
}

.rec-track-cover {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}

.rec-track-cover-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rec-track-info {
  flex: 1;
  min-width: 0;
}

.rec-track-title {
  font-size: 14px;
  font-weight: 500;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rec-track-artist {
  font-size: 12px;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.rec-track-duration {
  font-size: 12px;
  color: #bbb;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* ===== Tab Transition Animation ===== */
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.tab-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.tab-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ===== Streaming Search Box ===== */
.streaming-header-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 1;
}
.streaming-search-box {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  background: #f5f5f5;
  border: 1.5px solid transparent;
  transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
  min-width: 200px;
  max-width: 320px;
  flex-shrink: 0;
}

.streaming-search-box.focused {
  border-color: #1a73e8;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.1);
}

.streaming-search-icon {
  font-size: 14px;
  color: #999;
  flex-shrink: 0;
  margin-right: 8px;
  transition: color 0.2s;
}

.streaming-search-box.focused .streaming-search-icon {
  color: #1a73e8;
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
  color: #1a73e8;
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
  background: #ddd;
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
  background: #ccc;
}

/* Playlist Grid for Recommendations */
.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 20px;
  margin-top: 16px;
}

.playlist-grid-card {
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: transform 0.2s;
}

.playlist-grid-card:hover {
  transform: translateY(-4px);
}

.playlist-grid-cover,
.playlist-grid-cover-placeholder {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 12px;
  margin-bottom: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.playlist-grid-cover-placeholder {
  background: #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.playlist-grid-name {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 4px;
  line-height: 1.4;
}

.playlist-grid-count {
  font-size: 12px;
  color: #999;
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
  padding-bottom: 32px;
  border-bottom: 1px solid #eee;
  margin-bottom: 24px;
}

.detail-playlist-cover,
.detail-playlist-cover-placeholder {
  width: 200px;
  height: 200px;
  border-radius: 16px;
  object-fit: cover;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  flex-shrink: 0;
}

.detail-playlist-cover-placeholder {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
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
  font-size: 32px;
  font-weight: 800;
  color: #1a1a1a;
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
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 600;
}

/* ===== Like Button ===== */
.col-like, .col-like-header {
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
  transition: color 0.2s, background 0.2s, transform 0.15s;
  padding: 0;
}

.btn-like:hover {
  background: #fce4ec;
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
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}
</style>
