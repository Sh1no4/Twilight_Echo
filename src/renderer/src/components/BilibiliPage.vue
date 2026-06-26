<script setup lang="ts">
import QRCode from 'qrcode'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Track } from '../types/music'
import { useProviderStore } from '../stores/useProviderStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import type {
  MediaProviderPlaylistSummary,
  MediaProviderProfile
} from '../providers/mediaProvider'

defineProps<{
  menuOpen: boolean
  hasPlayer: boolean
}>()

const emit = defineEmits<{
  toggleMenu: []
  backToLocal: []
}>()

const BILI_PROVIDER_ID = 'bili'
const POLL_INTERVAL = 5000
const SEARCH_PAGE_SIZE = 30

type BiliTab = 'search' | 'library'
type QrStatus = 'idle' | 'loading' | 'waiting' | 'scanned' | 'expired' | 'success' | 'error'

interface BiliQrStatusCodes {
  waiting: number
  scanned: number | null
  expired: number
  denied?: number
  success: number
}

// Bilibili QR scan status codes (per the bili provider contract):
// waiting=86101, scanned=86090, expired=86038, success=0. The provider may
// override these via its ui.qrStatusCodes metadata — same resolution strategy
// as LoginPage.
const BILI_DEFAULT_QR_STATUS_CODES: BiliQrStatusCodes = {
  waiting: 86101,
  scanned: 86090,
  expired: 86038,
  success: 0
}

const providerStore = useProviderStore()
const { currentTrack, playTrack, formatTime } = usePlayerStore()

// ─── Login state ───────────────────────────────────────────────────────
const loggedIn = ref(false)
const profile = ref<MediaProviderProfile | null>(null)
const loginChecking = ref(false)
const loginError = ref('')

// ─── QR login state ────────────────────────────────────────────────────
const qrImage = ref('')
const qrKey = ref('')
const qrStatus = ref<QrStatus>('idle')
let pollTimer: ReturnType<typeof setInterval> | null = null

// ─── Library state ──────────────────────────────────────────────────────
const playlists = ref<MediaProviderPlaylistSummary[]>([])
const pinnedPlaylistIds = ref<string[]>([])
const pinningPlaylistId = ref<string | null>(null)
const libraryLoading = ref(false)
const libraryLoaded = ref(false)
const libraryError = ref('')

// ─── Tabs / detail ─────────────────────────────────────────────────────
const activeTab = ref<BiliTab>('search')
const currentDetail = ref<{ playlist: MediaProviderPlaylistSummary } | null>(null)
const detailTracks = ref<Track[]>([])
const detailLoading = ref(false)
const detailError = ref('')
let detailLoadToken = 0

// ─── Search state ───────────────────────────────────────────────────────
const searchQuery = ref('')
const searchResults = ref<Track[]>([])
const searchTotal = ref(0)
const searchOffset = ref(0)
const searchLoading = ref(false)
const searchError = ref('')
const searchInputFocused = ref(false)
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

// ─── Computed ──────────────────────────────────────────────────────────
const biliQrStatusCodes = computed<BiliQrStatusCodes>(
  () => providerStore.getProvider(BILI_PROVIDER_ID)?.ui?.qrStatusCodes ?? BILI_DEFAULT_QR_STATUS_CODES
)

const isSearching = computed(() => searchQuery.value.trim().length > 0)
const showSearchBox = computed(
  () => activeTab.value === 'search' && loggedIn.value && !currentDetail.value
)

const profileName = computed(
  () => profile.value?.nickname || (profile.value ? String(profile.value.userId) : '哔哩哔哩用户')
)

const headerTitle = computed(() => {
  if (currentDetail.value) return currentDetail.value.playlist.name
  if (activeTab.value === 'search' && isSearching.value) return `搜索: ${searchQuery.value.trim()}`
  if (activeTab.value === 'search') return '搜索'
  return '收藏夹'
})

const headerSubtitle = computed(() => {
  if (currentDetail.value) return `共 ${detailTracks.value.length} 个视频`
  if (!loggedIn.value) return '登录后即可浏览收藏夹与搜索视频'
  if (activeTab.value === 'search') return '搜索哔哩哔哩视频，以音频方式播放'
  return '浏览你的哔哩哔哩视频收藏夹'
})

const qrStatusText = computed(() => {
  switch (qrStatus.value) {
    case 'loading':
      return '正在生成二维码...'
    case 'waiting':
      return '请使用哔哩哔哩 App 扫码登录'
    case 'scanned':
      return '已扫码，请在手机上确认登录'
    case 'expired':
      return '二维码已过期，请点击刷新'
    case 'success':
      return '登录成功'
    case 'error':
      return loginError.value || '二维码登录异常，请重试'
    default:
      return '点击下方按钮获取登录二维码'
  }
})

const totalPageCount = computed(() => Math.max(1, Math.ceil(searchTotal.value / SEARCH_PAGE_SIZE)))
const currentPage = computed(() => Math.floor(searchOffset.value / SEARCH_PAGE_SIZE) + 1)

// ─── QR status helpers (mirror LoginPage) ─────────────────────────────
function isQrStatus(code: number, type: 'waiting' | 'scanned' | 'expired' | 'success'): boolean {
  const codes = biliQrStatusCodes.value
  switch (type) {
    case 'waiting':
      return code === codes.waiting
    case 'scanned':
      return codes.scanned !== null && code === codes.scanned
    case 'expired':
      return code === codes.expired || codes.denied === code
    case 'success':
      return code === codes.success
    default:
      return false
  }
}

// ─── Login / QR flow ───────────────────────────────────────────────────
async function refreshLogin(): Promise<void> {
  loginChecking.value = true
  loginError.value = ''
  try {
    await providerStore.syncProviders().catch(() => undefined)
    if (!providerStore.hasProvider(BILI_PROVIDER_ID)) {
      loggedIn.value = false
      profile.value = null
      loginError.value = '哔哩哔哩插件未启用，请在设置的插件页中启用。'
      return
    }
    const state = await providerStore.checkLogin(BILI_PROVIDER_ID)
    loggedIn.value = state.loggedIn
    profile.value = state.profile ?? null
    if (state.loggedIn) {
      await loadLibrary()
    }
  } catch (error) {
    loggedIn.value = false
    profile.value = null
    loginError.value = error instanceof Error ? error.message : '哔哩哔哩登录状态检查失败'
  } finally {
    loginChecking.value = false
  }
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function pollQrLogin(): Promise<void> {
  if (!qrKey.value) return
  try {
    const result = await providerStore.checkQrLogin(BILI_PROVIDER_ID, qrKey.value)
    if (isQrStatus(result.code, 'expired')) {
      qrStatus.value = 'expired'
      stopPolling()
      return
    }
    if (isQrStatus(result.code, 'success')) {
      stopPolling()
      qrStatus.value = 'success'
      await refreshLogin()
      return
    }
    if (isQrStatus(result.code, 'scanned')) {
      qrStatus.value = 'scanned'
      return
    }
    if (isQrStatus(result.code, 'waiting')) {
      qrStatus.value = 'waiting'
    }
  } catch {
    // Transient polling error — keep polling until expiry/success.
  }
}

function startPolling(): void {
  stopPolling()
  pollTimer = setInterval(() => {
    void pollQrLogin()
  }, POLL_INTERVAL)
}

async function startQrLogin(): Promise<void> {
  stopPolling()
  qrStatus.value = 'loading'
  qrImage.value = ''
  qrKey.value = ''
  loginError.value = ''
  try {
    if (!providerStore.hasProvider(BILI_PROVIDER_ID)) {
      await providerStore.syncProviders().catch(() => undefined)
    }
    if (!providerStore.hasProvider(BILI_PROVIDER_ID)) {
      qrStatus.value = 'error'
      loginError.value = '哔哩哔哩插件未启用，请在设置的插件页中启用。'
      return
    }
    const qr = await providerStore.getQrLogin(BILI_PROVIDER_ID)
    if (!qr?.key) {
      qrStatus.value = 'error'
      loginError.value = '获取哔哩哔哩登录二维码失败'
      return
    }
    qrKey.value = qr.key
    // Reuse the exact QR rendering approach LoginPage uses: prefer the
    // provider-supplied image, otherwise render qrContent/key to a data URL.
    qrImage.value =
      qr.imageDataUrl ||
      (await QRCode.toDataURL(qr.qrContent || qr.key, { margin: 1, width: 220 }))
    qrStatus.value = 'waiting'
    startPolling()
  } catch (error) {
    qrStatus.value = 'error'
    loginError.value = error instanceof Error ? error.message : '获取二维码失败'
  }
}

async function handleLogout(): Promise<void> {
  stopPolling()
  try {
    await providerStore.logout(BILI_PROVIDER_ID)
  } catch {
    // ignore — state is refreshed regardless
  }
  qrStatus.value = 'idle'
  qrImage.value = ''
  qrKey.value = ''
  await refreshLogin()
  if (!loggedIn.value && providerStore.hasProvider(BILI_PROVIDER_ID)) {
    void startQrLogin()
  }
}

// ─── Library ───────────────────────────────────────────────────────────
async function loadLibrary(force = false): Promise<void> {
  if (!loggedIn.value) return
  if (libraryLoaded.value && !force) return
  libraryLoading.value = true
  libraryError.value = ''
  try {
    const library = await providerStore.fetchUserLibrary(BILI_PROVIDER_ID, force)
    playlists.value = library.playlists
    pinnedPlaylistIds.value = library.playlists
      .filter((playlist) => {
        const withPinned = playlist as MediaProviderPlaylistSummary & { pinned?: boolean }
        return withPinned.pinned === true
      })
      .map((playlist) => String(playlist.id))
    libraryLoaded.value = true
  } catch (error) {
    libraryError.value = error instanceof Error ? error.message : '加载哔哩哔哩收藏夹失败'
  } finally {
    libraryLoading.value = false
  }
}

async function togglePinnedPlaylist(playlist: MediaProviderPlaylistSummary): Promise<void> {
  if (pinningPlaylistId.value) return
  const playlistId = String(playlist.id)
  pinningPlaylistId.value = playlistId
  libraryError.value = ''
  try {
    const result = await window.api.extensions.executeCommand(
      'bilibili.setPinnedFavoriteFolder',
      [{ id: playlistId }]
    )
    const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
    pinnedPlaylistIds.value = Array.isArray(record.pinnedFavoriteFolderIds)
      ? record.pinnedFavoriteFolderIds.map((id) => String(id)).filter(Boolean)
      : []
    await loadLibrary(true)
  } catch (error) {
    libraryError.value = error instanceof Error ? error.message : '设置哔哩哔哩收藏夹置顶失败'
  } finally {
    pinningPlaylistId.value = null
  }
}

// ─── Playlist detail ──────────────────────────────────────────────────
function resetDetail(): void {
  detailLoadToken++
  currentDetail.value = null
  detailTracks.value = []
  detailLoading.value = false
  detailError.value = ''
}

async function openPlaylist(playlist: MediaProviderPlaylistSummary, force = false): Promise<void> {
  currentDetail.value = { playlist }
  const token = ++detailLoadToken
  detailTracks.value = []
  detailLoading.value = true
  detailError.value = ''
  try {
    const tracks = await providerStore.fetchPlaylistTracks(BILI_PROVIDER_ID, playlist.id, force)
    if (token !== detailLoadToken) return
    detailTracks.value = tracks
  } catch (error) {
    if (token !== detailLoadToken) return
    detailError.value = error instanceof Error ? error.message : '加载收藏夹视频失败'
    detailTracks.value = []
  } finally {
    if (token === detailLoadToken) detailLoading.value = false
  }
}

async function refreshDetail(): Promise<void> {
  if (currentDetail.value) {
    await openPlaylist(currentDetail.value.playlist, true)
  }
}

// ─── Search ───────────────────────────────────────────────────────────
async function performSearch(keywords: string): Promise<void> {
  const q = keywords.trim()
  if (!q) {
    searchResults.value = []
    searchTotal.value = 0
    return
  }
  searchLoading.value = true
  searchError.value = ''
  try {
    const result = await providerStore.callProvider<{ items: Track[]; total: number }>(
      BILI_PROVIDER_ID,
      'searchSongs',
      [q, SEARCH_PAGE_SIZE, searchOffset.value]
    )
    if (searchQuery.value.trim() === q) {
      searchResults.value = result.items
      searchTotal.value = result.total
    }
  } catch (error) {
    if (searchQuery.value.trim() === q) {
      searchError.value = error instanceof Error ? error.message : '搜索失败'
      searchResults.value = []
      searchTotal.value = 0
    }
  } finally {
    if (searchQuery.value.trim() === q) searchLoading.value = false
  }
}

watch(searchQuery, (newQuery, oldQuery) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  const q = newQuery.trim()
  if (!q) {
    searchResults.value = []
    searchTotal.value = 0
    searchOffset.value = 0
    searchLoading.value = false
    searchError.value = ''
    return
  }
  if (oldQuery !== newQuery) {
    searchOffset.value = 0
  }
  searchLoading.value = true
  searchDebounceTimer = setTimeout(() => {
    void performSearch(q)
  }, 300)
})

function clearSearch(): void {
  searchQuery.value = ''
  searchResults.value = []
  searchTotal.value = 0
  searchOffset.value = 0
  searchLoading.value = false
  searchError.value = ''
}

function goSearchPage(first: number): void {
  const normalized = Math.max(
    0,
    Math.min(first, Math.max(0, searchTotal.value - SEARCH_PAGE_SIZE))
  )
  searchOffset.value = normalized
  void performSearch(searchQuery.value.trim())
}

// ─── Navigation / track click ──────────────────────────────────────────
function selectTab(tab: BiliTab): void {
  if (activeTab.value === tab) return
  activeTab.value = tab
  resetDetail()
}

function goBack(): void {
  if (currentDetail.value) {
    resetDetail()
    return
  }
  if (isSearching.value) clearSearch()
}

function onSearchTrackClick(track: Track): void {
  playTrack(track, searchResults.value)
}

function onDetailTrackClick(track: Track): void {
  playTrack(track, detailTracks.value)
}

// ─── Lifecycle ─────────────────────────────────────────────────────────
onMounted(async () => {
  await refreshLogin()
  if (!loggedIn.value && providerStore.hasProvider(BILI_PROVIDER_ID) && qrStatus.value === 'idle') {
    void startQrLogin()
  }
})

onBeforeUnmount(() => {
  stopPolling()
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
})
</script>

<template>
  <div class="bili-page" :class="{ 'has-player': hasPlayer, 'menu-open': menuOpen }">
    <header class="bili-header">
      <div class="bili-header-left">
        <button
          class="bili-icon-btn hamburger"
          :title="menuOpen ? '关闭菜单' : '打开菜单'"
          @click="emit('toggleMenu')"
        >
          <i :class="menuOpen ? 'pi pi-times' : 'pi pi-bars'"></i>
        </button>
        <button
          v-if="currentDetail || isSearching"
          class="bili-icon-btn btn-back"
          title="返回"
          @click="goBack"
        >
          <i class="pi pi-arrow-left"></i>
        </button>
        <div class="bili-title-wrap">
          <h2 class="bili-content-title">
            <i class="pi pi-video bili-title-icon"></i>
            {{ headerTitle }}
          </h2>
          <p class="bili-content-subtitle">{{ headerSubtitle }}</p>
        </div>
      </div>
      <div class="bili-header-right">
        <div
          v-if="showSearchBox"
          class="bili-search-box"
          :class="{ focused: searchInputFocused }"
        >
          <i class="pi pi-search bili-search-icon"></i>
          <input
            v-model="searchQuery"
            type="text"
            class="bili-search-input"
            placeholder="搜索哔哩哔哩视频"
            @focus="searchInputFocused = true"
            @blur="searchInputFocused = false"
          />
          <i v-if="searchLoading" class="pi pi-spin pi-spinner bili-search-spinner"></i>
          <button v-else-if="searchQuery" class="bili-search-clear" @click="clearSearch">
            <i class="pi pi-times"></i>
          </button>
        </div>
        <button class="bili-local-btn" title="返回流媒体" @click="emit('backToLocal')">
          <i class="pi pi-globe"></i>
          <span>流媒体</span>
        </button>
        <div
          v-if="loggedIn && profile?.avatarUrl"
          class="bili-avatar"
          :title="profileName"
        >
          <img :src="profile.avatarUrl" alt="" />
        </div>
        <div v-else-if="loggedIn" class="bili-avatar bili-avatar-placeholder" :title="profileName">
          <i class="pi pi-user"></i>
        </div>
      </div>
    </header>

    <!-- Internal tabs -->
    <nav v-if="loggedIn && !currentDetail" class="bili-tabs">
      <button
        class="bili-tab-pill"
        :class="{ active: activeTab === 'search' }"
        @click="selectTab('search')"
      >
        <i class="pi pi-search"></i>
        <span>搜索</span>
      </button>
      <button
        class="bili-tab-pill"
        :class="{ active: activeTab === 'library' }"
        @click="selectTab('library')"
      >
        <i class="pi pi-heart"></i>
        <span>收藏夹</span>
      </button>
    </nav>

    <div class="bili-body">
      <!-- Login gate: QR code -->
      <div v-if="!loggedIn" class="bili-login-gate">
        <div class="bili-qr-card">
          <div class="bili-qr-brand">
            <i class="pi pi-video"></i>
          </div>
          <h3 class="bili-qr-title">哔哩哔哩登录</h3>
          <div
            class="qr-wrapper"
            :class="{ expired: qrStatus === 'expired' }"
          >
            <img
              v-if="qrImage && qrStatus !== 'expired' && qrStatus !== 'loading'"
              :src="qrImage"
              alt="哔哩哔哩登录二维码"
              class="qr-image"
            />
            <div
              v-else-if="qrStatus === 'loading' || loginChecking"
              class="qr-placeholder"
            >
              <i class="pi pi-spin pi-spinner" style="font-size: 36px; color: #999"></i>
            </div>
            <div v-else class="qr-placeholder">
              <i class="pi pi-qrcode" style="font-size: 48px; color: #ccc"></i>
            </div>
            <div v-if="qrStatus === 'expired'" class="qr-expired-overlay" @click="startQrLogin">
              <i class="pi pi-refresh" style="font-size: 28px"></i>
              <span>点击刷新</span>
            </div>
          </div>
          <p class="qr-status" :class="{ success: qrStatus === 'success' }">
            <i
              v-if="qrStatus === 'scanned'"
              class="pi pi-check-circle"
              style="margin-right: 6px; color: #2ecc71"
            ></i>
            <i
              v-if="qrStatus === 'success'"
              class="pi pi-check-circle"
              style="margin-right: 6px; color: #2ecc71"
            ></i>
            {{ qrStatusText }}
          </p>
          <button
            v-if="qrStatus === 'expired' || qrStatus === 'error' || qrStatus === 'idle'"
            class="bili-action-btn"
            @click="startQrLogin"
          >
            <i class="pi pi-refresh" style="margin-right: 6px"></i>
            重新生成二维码
          </button>
          <p v-if="loginError && qrStatus !== 'success'" class="qr-error">{{ loginError }}</p>
        </div>
      </div>

      <!-- Playlist detail sub-view -->
      <div v-else-if="currentDetail" class="detail-view">
        <div v-if="detailLoading && detailTracks.length === 0" class="bili-placeholder">
          <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #999"></i>
          <p class="placeholder-title">正在加载视频</p>
          <p class="placeholder-hint">请稍候...</p>
        </div>
        <template v-else>
          <div class="detail-playlist-header">
            <img
              v-if="currentDetail.playlist.cover"
              :src="currentDetail.playlist.cover"
              class="detail-playlist-cover"
              alt="cover"
            />
            <div v-else class="detail-playlist-cover-placeholder">
              <i class="pi pi-video"></i>
            </div>
            <div class="detail-playlist-info">
              <h2 class="detail-playlist-name">{{ currentDetail.playlist.name }}</h2>
              <p class="detail-playlist-desc">共 {{ detailTracks.length }} 个视频</p>
              <div class="detail-playlist-actions">
                <button
                  type="button"
                  class="bili-action-btn"
                  :disabled="detailLoading || detailTracks.length === 0"
                  @click="detailTracks.length > 0 && playTrack(detailTracks[0], detailTracks)"
                >
                  <i class="pi pi-play"></i>
                  <span>播放全部</span>
                </button>
                <button
                  type="button"
                  class="bili-ghost-btn"
                  :disabled="detailLoading"
                  title="刷新"
                  @click="refreshDetail"
                >
                  <i class="pi" :class="detailLoading ? 'pi-spin pi-spinner' : 'pi-refresh'"></i>
                  <span>刷新</span>
                </button>
              </div>
            </div>
          </div>

          <div v-if="detailError" class="bili-placeholder detail-placeholder">
            <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
            <p class="placeholder-title">加载失败</p>
            <p class="placeholder-hint">{{ detailError }}</p>
            <button type="button" class="bili-action-btn" @click="refreshDetail">重试</button>
          </div>

          <div v-else-if="detailTracks.length === 0" class="bili-placeholder detail-placeholder">
            <i class="pi pi-wave-pulse" style="font-size: 40px; color: #ccc"></i>
            <p class="placeholder-title">暂无视频</p>
            <p class="placeholder-hint">这个收藏夹目前没有可展示的视频</p>
          </div>

          <div v-else class="track-table-wrapper">
            <table class="track-table">
              <thead>
                <tr>
                  <th class="col-cover-header"></th>
                  <th class="col-index">#</th>
                  <th class="col-info">标题</th>
                  <th class="col-album">收藏夹</th>
                  <th class="col-duration">时长</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(track, index) in detailTracks"
                  :key="track.id"
                  class="track-row"
                  :class="{ 'track-playing': currentTrack?.id === track.id }"
                  @click="onDetailTrackClick(track)"
                  @dblclick="onDetailTrackClick(track)"
                >
                  <td class="col-cover">
                    <img v-if="track.cover" :src="track.cover" class="cover-img" alt="cover" />
                    <div v-else class="cover-placeholder">
                      <i class="pi pi-wave-pulse" style="font-size: 18px; color: #bbb"></i>
                    </div>
                  </td>
                  <td class="col-index">
                    <span v-if="currentTrack?.id === track.id" class="playing-indicator">
                      <i class="pi pi-volume-up" style="font-size: 12px; color: #00a1d6"></i>
                    </span>
                    <span v-else>{{ index + 1 }}</span>
                  </td>
                  <td class="col-info">
                    <div class="track-title">{{ track.title }}</div>
                    <div class="track-artist">{{ track.artist }}</div>
                  </td>
                  <td class="col-album">{{ track.album }}</td>
                  <td class="col-duration">{{ formatTime(track.duration) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>

      <!-- Search tab -->
      <div v-else-if="activeTab === 'search'" class="search-view">
        <div v-if="searchLoading && searchOffset === 0" class="bili-placeholder">
          <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #999"></i>
          <p class="placeholder-title">正在搜索</p>
        </div>
        <div v-else-if="searchError" class="bili-placeholder">
          <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
          <p class="placeholder-title">搜索失败</p>
          <p class="placeholder-hint">{{ searchError }}</p>
          <button type="button" class="bili-action-btn" @click="performSearch(searchQuery)">
            重试
          </button>
        </div>
        <div
          v-else-if="!isSearching && searchResults.length === 0"
          class="bili-placeholder"
        >
          <i class="pi pi-search" style="font-size: 40px; color: #ccc"></i>
          <p class="placeholder-title">搜索哔哩哔哩视频</p>
          <p class="placeholder-hint">在上方搜索框输入关键词，点击结果以音频方式播放</p>
        </div>
        <div v-else-if="searchResults.length === 0" class="bili-placeholder">
          <i class="pi pi-search" style="font-size: 40px; color: #ccc"></i>
          <p class="placeholder-title">无搜索结果</p>
          <p class="placeholder-hint">换个关键词试试吧</p>
        </div>
        <div v-else class="search-results-content">
          <p class="search-result-count">
            共找到 {{ searchTotal }} 个结果
          </p>
          <div class="track-table-wrapper">
            <table class="track-table">
              <thead>
                <tr>
                  <th class="col-cover-header"></th>
                  <th class="col-index">#</th>
                  <th class="col-info">标题</th>
                  <th class="col-album">UP 主</th>
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
                      <i class="pi pi-volume-up" style="font-size: 12px; color: #00a1d6"></i>
                    </span>
                    <span v-else>{{ index + 1 + searchOffset }}</span>
                  </td>
                  <td class="col-info">
                    <div class="track-title">{{ track.title }}</div>
                    <div class="track-artist">{{ track.artist }}</div>
                  </td>
                  <td class="col-album">{{ track.album }}</td>
                  <td class="col-duration">{{ formatTime(track.duration) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="searchTotal > SEARCH_PAGE_SIZE" class="search-paginator">
            <button
              type="button"
              class="pager-btn"
              :disabled="searchOffset <= 0"
              @click="goSearchPage(searchOffset - SEARCH_PAGE_SIZE)"
            >
              上一页
            </button>
            <span class="pager-text">{{ currentPage }} / {{ totalPageCount }}</span>
            <button
              type="button"
              class="pager-btn"
              :disabled="searchOffset + SEARCH_PAGE_SIZE >= searchTotal"
              @click="goSearchPage(searchOffset + SEARCH_PAGE_SIZE)"
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      <!-- Library / favorites tab -->
      <div v-else-if="activeTab === 'library'" class="library-view">
        <div class="library-head">
          <div class="library-head-info">
            <h3 class="library-head-title">收藏夹</h3>
            <p class="library-head-count">共 {{ playlists.length }} 个文件夹</p>
          </div>
          <div class="library-head-actions">
            <button
              type="button"
              class="bili-ghost-btn"
              :disabled="libraryLoading"
              title="刷新收藏夹"
              @click="loadLibrary(true)"
            >
              <i class="pi" :class="libraryLoading ? 'pi-spin pi-spinner' : 'pi-refresh'"></i>
              <span>刷新</span>
            </button>
            <button type="button" class="bili-ghost-btn danger" title="退出登录" @click="handleLogout">
              <i class="pi pi-sign-out"></i>
              <span>退出</span>
            </button>
          </div>
        </div>

        <div v-if="libraryLoading && playlists.length === 0" class="bili-placeholder">
          <i class="pi pi-spin pi-spinner" style="font-size: 40px; color: #999"></i>
          <p class="placeholder-title">正在加载收藏夹</p>
          <p class="placeholder-hint">请稍候...</p>
        </div>
        <div v-else-if="libraryError" class="bili-placeholder">
          <i class="pi pi-exclamation-triangle" style="font-size: 40px; color: #e74c3c"></i>
          <p class="placeholder-title">加载失败</p>
          <p class="placeholder-hint">{{ libraryError }}</p>
          <button type="button" class="bili-action-btn" @click="loadLibrary(true)">重试</button>
        </div>
        <div v-else-if="playlists.length === 0" class="bili-placeholder">
          <i class="pi pi-folder" style="font-size: 40px; color: #ccc"></i>
          <p class="placeholder-title">暂无收藏夹</p>
          <p class="placeholder-hint">在哔哩哔哩 App 中收藏视频后即可在此查看</p>
        </div>
        <div v-else class="playlist-grid">
          <div
            v-for="playlist in playlists"
            :key="String(playlist.id)"
            class="playlist-grid-card"
            :class="{ pinned: pinnedPlaylistIds.includes(String(playlist.id)) }"
            @click="openPlaylist(playlist, false)"
          >
            <div class="playlist-grid-cover-wrap">
              <img
                v-if="playlist.cover"
                :src="playlist.cover"
                class="playlist-grid-cover"
                alt=""
              />
              <div v-else class="playlist-grid-cover-placeholder">
                <i class="pi pi-video" style="font-size: 28px; color: #bbb"></i>
              </div>
              <button
                class="pin-btn"
                :class="{ pinned: pinnedPlaylistIds.includes(String(playlist.id)) }"
                :disabled="pinningPlaylistId === String(playlist.id)"
                :title="
                  pinnedPlaylistIds.includes(String(playlist.id)) ? '取消置顶' : '置顶收藏夹'
                "
                @click.stop="togglePinnedPlaylist(playlist)"
              >
                <i
                  v-if="pinningPlaylistId === String(playlist.id)"
                  class="pi pi-spin pi-spinner"
                  style="font-size: 14px"
                ></i>
                <i
                  v-else
                  :class="
                    pinnedPlaylistIds.includes(String(playlist.id))
                      ? 'pi pi-bookmark-fill'
                      : 'pi pi-bookmark'
                  "
                  style="font-size: 14px"
                ></i>
              </button>
            </div>
            <div class="playlist-grid-name">{{ playlist.name }}</div>
            <div class="playlist-grid-count">{{ playlist.trackCount }} 个视频</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bili-page {
  --bili-accent: #00a1d6;
  --bili-accent-soft: rgba(0, 161, 214, 0.12);
  --bili-accent-ring: rgba(0, 161, 214, 0.16);
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background:
    radial-gradient(circle at 30% 10%, rgba(0, 161, 214, 0.1), transparent 28%),
    radial-gradient(circle at 78% 12%, rgba(148, 210, 255, 0.12), transparent 30%),
    linear-gradient(180deg, rgba(252, 253, 255, 0.96), rgba(244, 250, 253, 0.92));
}

/* ===== Header ===== */
.bili-header {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 64px;
  padding: 12px 0 14px;
  flex-shrink: 0;
  margin: 20px clamp(36px, 6vw, 84px) 0;
}

.bili-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.bili-title-wrap {
  min-width: 0;
}

.bili-content-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 800;
  color: var(--te-neutral-900, #242946);
  margin: 0;
}

.bili-title-icon {
  color: var(--bili-accent);
  font-size: 20px;
}

.bili-content-subtitle {
  font-size: 12px;
  font-weight: 500;
  color: #666b78;
  margin: 4px 0 0;
}

.bili-header-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  flex: 0 1 auto;
  min-width: 0;
}

.bili-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid #eef1f6;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.58);
  box-shadow: 0 12px 28px rgba(34, 42, 68, 0.06);
  color: #4b5563;
  cursor: pointer;
  font-size: 16px;
  flex-shrink: 0;
  transition:
    background 0.18s,
    color 0.18s,
    transform 0.18s var(--te-ease-soft, ease);
}

.bili-icon-btn:hover {
  background: var(--bili-accent-soft);
  color: var(--bili-accent);
  transform: translateY(-1px);
}

.btn-back {
  color: var(--bili-accent);
}

.bili-search-box {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 16px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid #eef1f6;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  transition:
    border-color 0.2s,
    background 0.2s,
    box-shadow 0.2s;
  width: clamp(220px, 30vw, 380px);
  flex-shrink: 0;
}

.bili-search-box.focused {
  border-color: rgba(0, 161, 214, 0.42);
  background: rgba(255, 255, 255, 0.62);
  box-shadow: 0 0 0 4px var(--bili-accent-ring);
}

.bili-search-icon {
  font-size: 14px;
  color: #999;
  flex-shrink: 0;
  margin-right: 8px;
  transition: color 0.2s;
}

.bili-search-box.focused .bili-search-icon {
  color: var(--bili-accent);
}

.bili-search-input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: #27304f;
  flex: 1;
  min-width: 0;
  height: 100%;
}

.bili-search-input::placeholder {
  color: #bbb;
}

.bili-search-spinner {
  font-size: 14px;
  color: var(--bili-accent);
  flex-shrink: 0;
  margin-left: 6px;
}

.bili-search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: var(--bili-accent-soft);
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  margin-left: 6px;
  transition: background 0.15s;
}

.bili-search-clear i {
  font-size: 10px;
  color: #666;
}

.bili-search-clear:hover {
  background: rgba(0, 161, 214, 0.2);
}

.bili-local-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid #eef1f6;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 12px 28px rgba(34, 42, 68, 0.06);
  color: #4b5563;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.18s,
    color 0.18s,
    transform 0.18s var(--te-ease-soft, ease);
}

.bili-local-btn:hover {
  background: var(--bili-accent-soft);
  color: var(--bili-accent);
  transform: translateY(-1px);
}

.bili-local-btn i {
  font-size: 15px;
}

.bili-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid #eef1f6;
  box-shadow: 0 12px 28px rgba(34, 42, 68, 0.06);
}

.bili-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bili-avatar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bili-accent-soft);
  color: var(--bili-accent);
  font-size: 16px;
}

/* ===== Tabs ===== */
.bili-tabs {
  display: flex;
  gap: 8px;
  padding: 0 clamp(36px, 6vw, 84px) 14px;
  margin-top: -8px;
  flex-shrink: 0;
}

.bili-tab-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 16px;
  border: 1px solid #eef1f6;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 10px 24px rgba(34, 42, 68, 0.05);
  color: rgba(64, 73, 108, 0.68);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s,
    box-shadow 0.2s;
}

.bili-tab-pill:hover {
  background: var(--bili-accent-soft);
  color: var(--bili-accent);
}

.bili-tab-pill.active {
  background: var(--bili-accent);
  color: #fff;
  box-shadow: 0 14px 30px rgba(0, 161, 214, 0.24);
}

/* ===== Body ===== */
.bili-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px clamp(36px, 6vw, 84px) 34px;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 161, 214, 0.28) transparent;
}

.bili-page.has-player .bili-body {
  padding-bottom: 126px;
}

/* ===== Login gate / QR ===== */
.bili-login-gate {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 24px;
}

.bili-qr-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: min(360px, 100%);
  padding: 32px 28px;
  border: 1px solid #eef1f6;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
}

.bili-qr-brand {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--bili-accent-soft);
  color: var(--bili-accent);
  font-size: 28px;
}

.bili-qr-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: #242946;
}

.qr-wrapper {
  position: relative;
  width: 200px;
  height: 200px;
  border: 1px solid #eef1f6;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
}

.qr-wrapper.expired {
  cursor: pointer;
}

.qr-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.qr-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-expired-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.88);
  color: #999;
  font-size: 13px;
}

.qr-expired-overlay:hover {
  color: var(--bili-accent);
}

.qr-status {
  font-size: 14px;
  color: #666;
  margin: 0;
  display: flex;
  align-items: center;
  text-align: center;
}

.qr-status.success {
  color: #2ecc71;
}

.qr-error {
  margin: 0;
  color: #e74c3c;
  font-size: 12px;
  text-align: center;
  line-height: 1.5;
}

.bili-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 20px;
  border: none;
  border-radius: 8px;
  background: var(--bili-accent);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 12px 24px rgba(0, 161, 214, 0.2);
  transition:
    transform 0.2s var(--te-ease-soft, ease),
    box-shadow 0.2s,
    opacity 0.2s;
}

.bili-action-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 16px 32px rgba(0, 161, 214, 0.26);
}

.bili-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.bili-ghost-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid #eef1f6;
  border-radius: 8px;
  background: #fff;
  color: #4b5563;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(34, 42, 68, 0.05);
  transition:
    background 0.18s,
    color 0.18s;
}

.bili-ghost-btn:hover:not(:disabled) {
  background: var(--bili-accent-soft);
  color: var(--bili-accent);
}

.bili-ghost-btn.danger:hover:not(:disabled) {
  background: rgba(231, 76, 60, 0.1);
  color: #e74c3c;
}

.bili-ghost-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* ===== Placeholder ===== */
.bili-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  gap: 12px;
  text-align: center;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #eef1f6;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
}

.detail-placeholder {
  min-height: 420px;
}

.placeholder-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--te-neutral-900, #242946);
  margin: 0;
}

.placeholder-hint {
  font-size: 13px;
  color: #999;
  margin: 0;
}

/* ===== Detail playlist header ===== */
.detail-view {
  min-height: 100%;
}

.detail-playlist-header {
  display: flex;
  align-items: flex-end;
  gap: 24px;
  min-height: 176px;
  padding: 18px;
  border: 1px solid #eef1f6;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  margin-bottom: 18px;
}

.detail-playlist-cover,
.detail-playlist-cover-placeholder {
  width: 132px;
  height: 132px;
  border-radius: 8px;
  object-fit: cover;
  box-shadow: 0 24px 55px rgba(0, 161, 214, 0.18);
  flex-shrink: 0;
}

.detail-playlist-cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--bili-accent);
  font-size: 56px;
  background: var(--bili-accent-soft);
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
  color: var(--te-neutral-900, #242946);
  margin: 0 0 12px 0;
  line-height: 1.2;
}

.detail-playlist-desc {
  font-size: 14px;
  color: #666;
  margin: 0 0 24px 0;
}

.detail-playlist-actions {
  display: flex;
  gap: 10px;
}

/* ===== Track table ===== */
.search-result-count {
  margin: 0 0 14px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(82, 90, 122, 0.62);
}

.track-table-wrapper {
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid #eef1f6;
  background: #fff;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
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
  height: 36px;
  padding: 0 12px;
  text-align: left;
  color: rgba(82, 90, 122, 0.54);
  font-size: 11px;
  font-weight: 700;
  background: #fbfcff;
  border-bottom: 1px solid #eef1f6;
}

.track-row {
  cursor: pointer;
  transition:
    background 0.18s,
    box-shadow 0.18s;
}

.track-row td {
  padding: 10px 12px;
  font-size: 14px;
  color: rgba(54, 62, 96, 0.74);
  border-bottom: 1px solid #f0f2f7;
  vertical-align: middle;
}

.track-row:hover {
  background: #f3fbfe;
  box-shadow: inset 3px 0 0 rgba(0, 161, 214, 0.4);
}

.track-row:hover td {
  border-bottom-color: rgba(0, 161, 214, 0.18);
}

.track-playing {
  background: #eaf7fd !important;
  box-shadow: inset 3px 0 0 var(--bili-accent);
}

.track-playing td {
  border-bottom-color: rgba(0, 161, 214, 0.2) !important;
}

.cover-img,
.cover-placeholder {
  width: 36px;
  height: 36px;
  border-radius: 8px;
}

.cover-img {
  display: block;
  object-fit: cover;
}

.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bili-accent-soft);
}

.col-cover,
.col-cover-header {
  width: 60px;
  flex-shrink: 0;
}

.col-cover-header {
  text-align: left;
  padding-left: 12px !important;
}

.col-index {
  width: 40px;
  color: rgba(82, 90, 122, 0.58) !important;
  font-size: 13px !important;
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
  font-weight: 800;
  color: #222744;
}

.track-playing .track-title {
  color: var(--bili-accent);
}

.track-artist {
  margin-top: 2px;
  font-size: 12px;
  color: rgba(82, 90, 122, 0.58);
}

.col-album {
  width: 180px;
  color: rgba(82, 90, 122, 0.58) !important;
  font-size: 13px !important;
}

.col-duration {
  width: 80px;
  color: rgba(82, 90, 122, 0.58) !important;
  font-size: 12px !important;
}

/* ===== Paginator ===== */
.search-paginator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 24px;
}

.pager-btn {
  min-height: 34px;
  padding: 0 16px;
  border: 1px solid #eef1f6;
  border-radius: 8px;
  background: #fff;
  color: rgba(52, 61, 87, 0.86);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(34, 42, 68, 0.05);
  transition:
    transform 0.2s var(--te-ease-soft, ease),
    background 0.2s,
    opacity 0.2s;
}

.pager-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: var(--bili-accent-soft);
  color: var(--bili-accent);
}

.pager-btn:disabled {
  cursor: not-allowed;
  opacity: 0.46;
}

.pager-text {
  min-width: 72px;
  text-align: center;
  color: rgba(80, 88, 116, 0.64);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* ===== Library / playlist grid ===== */
.library-view {
  min-height: 100%;
}

.library-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.library-head-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: #242946;
}

.library-head-count {
  margin: 5px 0 0;
  font-size: 12px;
  font-weight: 700;
  color: rgba(80, 88, 116, 0.62);
}

.library-head-actions {
  display: flex;
  gap: 10px;
}

.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 18px;
}

.playlist-grid-card {
  cursor: pointer;
  padding: 12px;
  border: 1px solid #eef1f6;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 14px 32px rgba(34, 42, 68, 0.07);
  transition:
    transform 0.24s var(--te-ease-soft, ease),
    box-shadow 0.24s;
}

.playlist-grid-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 18px 38px rgba(34, 42, 68, 0.1);
}

.playlist-grid-card.pinned {
  border-color: rgba(0, 161, 214, 0.4);
  box-shadow: 0 14px 32px rgba(0, 161, 214, 0.12);
}

.playlist-grid-cover-wrap {
  position: relative;
  width: 100%;
}

.playlist-grid-cover,
.playlist-grid-cover-placeholder {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  object-fit: cover;
  box-shadow: 0 16px 30px rgba(0, 161, 214, 0.13);
}

.playlist-grid-cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bili-accent-soft);
}

.pin-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.88);
  color: rgba(0, 161, 214, 0.5);
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(34, 42, 68, 0.12);
  transition:
    color 0.2s,
    background 0.2s,
    transform 0.15s;
}

.pin-btn:hover:not(:disabled) {
  background: var(--bili-accent);
  color: #fff;
  transform: scale(1.1);
}

.pin-btn.pinned {
  color: var(--bili-accent);
  background: rgba(255, 255, 255, 0.95);
}

.pin-btn.pinned:hover:not(:disabled) {
  background: var(--bili-accent);
  color: #fff;
}

.pin-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.playlist-grid-name {
  margin-top: 11px;
  font-size: 13px;
  font-weight: 700;
  color: #242946;
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
  color: rgba(80, 88, 116, 0.58);
}

@media (max-width: 900px) {
  .bili-header,
  .bili-body,
  .bili-tabs {
    margin-left: 24px;
    margin-right: 24px;
    padding-left: 0;
    padding-right: 0;
  }

  .bili-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .bili-header-right {
    width: 100%;
    justify-content: flex-start;
  }

  .bili-search-box {
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
</style>
