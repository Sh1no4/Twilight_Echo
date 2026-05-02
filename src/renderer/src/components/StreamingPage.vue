<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Track } from '../types/music'
import { useNcmStore, type NcmPlaylistSummary } from '../stores/useNcmStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import Card from 'primevue/card'
import Avatar from 'primevue/avatar'
import Button from 'primevue/button'
import Divider from 'primevue/divider'

type StreamingTab = 'home' | 'playlists' | 'library'
type DetailView =
  | { type: 'liked' }
  | { type: 'playlist'; playlist: NcmPlaylistSummary }

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
  fetchLikedTracks
} = useNcmStore()

const { currentTrack, playTrack, formatTime } = usePlayerStore()

const profileSignature = computed(() => profile.value?.signature?.trim() || '暂无个人简介')

const headerTitle = computed(() => {
  if (currentDetail.value?.type === 'liked') return '我收藏的歌曲'
  if (currentDetail.value?.type === 'playlist') return currentDetail.value.playlist.name
  return currentView.value?.label ?? '流媒体'
})

const headerSubtitle = computed(() => {
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

function selectTab(key: StreamingTab): void {
  if (activeTab.value !== key) {
    resetDetail()
  }
  activeTab.value = key
  emit('toggleMenu')
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
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : '加载收藏歌曲失败'
    detailTracks.value = []
  } finally {
    detailLoading.value = false
  }
}

async function openPlaylist(playlist: NcmPlaylistSummary, force = false): Promise<void> {
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
      return
    }
    if (activeTab.value === 'library') {
      await ensureLibraryLoaded(true)
    }
  }
)

onMounted(async () => {
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

    <div v-if="menuOpen" class="streaming-overlay" :style="{ bottom: props.hasPlayer ? '72px' : '0px' }" @click="emit('toggleMenu')"></div>

    <div class="streaming-content">
      <div class="streaming-content-header">
        <div class="streaming-header-left">
          <button v-if="currentDetail" class="btn-back" title="返回" @click="goBack">
            <i class="pi pi-arrow-left"></i>
          </button>
          <div>
            <h2 class="streaming-content-title">{{ headerTitle }}</h2>
            <p class="streaming-content-subtitle">{{ headerSubtitle }}</p>
          </div>
        </div>
      </div>

      <div class="streaming-content-body">
        <div v-if="activeTab === 'home'" class="streaming-placeholder">
          <i class="pi pi-home" style="font-size: 48px; color: #ccc"></i>
          <p class="placeholder-title">流媒体主页</p>
          <p class="placeholder-hint">
            {{ isLoggedIn ? '打开音乐库查看我收藏的歌曲和歌单' : '点击左上角头像登录网易云音乐' }}
          </p>
        </div>

        <div v-else-if="activeTab === 'playlists'" class="streaming-placeholder">
          <i class="pi pi-bookmark" style="font-size: 48px; color: #ccc"></i>
          <p class="placeholder-title">歌单页暂不展示个人歌单</p>
          <p class="placeholder-hint">你创建的歌单已经移动到音乐库页面下方列表</p>
        </div>

        <div v-else-if="!isLoggedIn" class="streaming-placeholder">
          <i class="pi pi-user" style="font-size: 48px; color: #ccc"></i>
          <p class="placeholder-title">请先登录网易云音乐</p>
          <p class="placeholder-hint">登录后即可加载我收藏的歌曲和在线歌单</p>
        </div>

        <div v-else-if="rootLoading" class="streaming-placeholder">
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
          <div v-if="detailLoading" class="streaming-placeholder detail-placeholder">
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

          <div v-else-if="detailTracks.length === 0" class="streaming-placeholder detail-placeholder">
            <i class="pi pi-wave-pulse" style="font-size: 40px; color: #ccc"></i>
            <p class="placeholder-title">暂无歌曲</p>
            <p class="placeholder-hint">这个页面目前没有可展示的歌曲</p>
          </div>

          <div v-else class="track-table-wrapper">
            <table class="track-table">
              <thead>
                <tr>
                  <th class="col-cover"></th>
                  <th class="col-index">#</th>
                  <th class="col-info">标题</th>
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
                  <td class="col-album">{{ track.album }}</td>
                  <td class="col-duration">{{ formatTime(track.duration) }}</td>
                </tr>
              </tbody>
            </table>
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
              @click="openPlaylist(playlist)"
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
    </div>
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
  bottom: 72px;
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

.col-cover {
  width: 52px;
  padding-right: 0 !important;
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
</style>
