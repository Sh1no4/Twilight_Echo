<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useMusicStore } from '../stores/useMusicStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import type { Track } from '../types/music'

const props = defineProps<{
  category: string
  filter: string | null
  hasPlayer: boolean
}>()

const emit = defineEmits<{
  selectView: [category: string, filter: string | null]
}>()

const { tracks, artists, albums, playlists, getPlaylistTracks, removeTrack, addToPlaylist } =
  useMusicStore()
const { currentTrack, playTrack } = usePlayerStore()

const searchQuery = ref('')
const searchInputFocused = ref(false)

const baseDisplayTracks = computed(() => {
  if (props.category === 'allSongs') return tracks.value
  if (props.filter) {
    if (props.filter.startsWith('artist:')) {
      const name = props.filter.slice(7)
      return tracks.value.filter((t) => (t.artist || '未知艺术家') === name)
    }
    if (props.filter.startsWith('album:')) {
      const name = props.filter.slice(6)
      return tracks.value.filter((t) => (t.album || '未知专辑') === name)
    }
    if (props.filter.startsWith('playlist:')) {
      const name = props.filter.slice(9)
      return getPlaylistTracks(name)
    }
  }
  return []
})

const viewTitle = computed(() => {
  if (props.category === 'allSongs') return '所有歌曲'
  if (props.category === 'artists') {
    if (props.filter && props.filter.startsWith('artist:')) return props.filter.slice(7)
    return '艺术家'
  }
  if (props.category === 'albums') {
    if (props.filter && props.filter.startsWith('album:')) return props.filter.slice(6)
    return '专辑'
  }
  if (props.category === 'playlists') {
    if (props.filter && props.filter.startsWith('playlist:')) return props.filter.slice(9)
    return '歌单'
  }
  return '我的音乐'
})

const displayTracks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return baseDisplayTracks.value
  return baseDisplayTracks.value.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q)
  )
})

const showGrid = computed(() => {
  if (props.category === 'allSongs') return false
  return !props.filter
})

const showTable = computed(() => {
  if (props.category === 'allSongs') return true
  return !!props.filter
})

const viewTransitionName = ref('view-down')

watch([showGrid, showTable], ([newGrid, newTable], [oldGrid, oldTable]) => {
  if (oldGrid && newTable) {
    viewTransitionName.value = 'view-down'
  } else if (oldTable && newGrid) {
    viewTransitionName.value = 'view-up'
  }
})

function formatDuration(seconds: number): string {
  if (!seconds) return '00:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function onRowClick(track: Track, _index: number, event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (target.closest('.btn-remove')) return
  playTrack(track, displayTracks.value)
}

function onRowDblClick(track: Track): void {
  playTrack(track, displayTracks.value)
}

// Context Menu
const showContextMenu = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const selectedTrack = ref<Track | null>(null)
const showPlaylistSubmenu = ref(false)

function onContextMenu(event: MouseEvent, track: Track): void {
  event.preventDefault()
  selectedTrack.value = track
  menuX.value = event.clientX
  menuY.value = event.clientY
  showContextMenu.value = true
  showPlaylistSubmenu.value = false

  // Adjust position if menu goes off screen
  nextTick(() => {
    const menu = document.querySelector('.context-menu') as HTMLElement
    if (menu) {
      const rect = menu.getBoundingClientRect()
      if (rect.right > window.innerWidth) {
        menuX.value -= rect.width
      }
      if (rect.bottom > window.innerHeight) {
        menuY.value -= rect.height
      }
    }
  })
}

function closeContextMenu(): void {
  showContextMenu.value = false
  showPlaylistSubmenu.value = false
}

function handleDelete(): void {
  if (selectedTrack.value) {
    removeTrack(selectedTrack.value.id)
    closeContextMenu()
  }
}

async function handleOpenFolder(): Promise<void> {
  if (selectedTrack.value) {
    await window.api.shell.showItemInFolder(selectedTrack.value.filePath)
    closeContextMenu()
  }
}

function handleAddToPlaylist(playlistName: string): void {
  if (selectedTrack.value) {
    addToPlaylist(playlistName, selectedTrack.value.id)
    closeContextMenu()
  }
}

onUnmounted(() => {
  window.removeEventListener('click', closeContextMenu)
})

// Virtual Scrolling
const containerRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const rowHeight = 84 // Calculated height of one row

const visibleRange = computed(() => {
  const start = Math.floor(scrollTop.value / rowHeight)
  const count = Math.ceil(viewportHeight.value / rowHeight) + 5 // +5 buffer
  return {
    start: Math.max(0, start),
    end: Math.min(displayTracks.value.length, start + count)
  }
})

const visibleTracks = computed(() => {
  return displayTracks.value.slice(visibleRange.value.start, visibleRange.value.end)
})

const totalHeight = computed(() => displayTracks.value.length * rowHeight)
const paddingTop = computed(() => visibleRange.value.start * rowHeight)

function onScroll(e: Event): void {
  const target = e.target as HTMLElement
  scrollTop.value = target.scrollTop
}

const updateViewportHeight = (): void => {
  if (containerRef.value) {
    viewportHeight.value = containerRef.value.clientHeight
  }
}

onMounted(() => {
  window.addEventListener('click', closeContextMenu)
  updateViewportHeight()
  window.addEventListener('resize', updateViewportHeight)
})

onUnmounted(() => {
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('resize', updateViewportHeight)
})

watch(displayTracks, () => {
  // Reset scroll on filter change
  if (containerRef.value) {
    containerRef.value.scrollTop = 0
    scrollTop.value = 0
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="song-list"
    :style="{ height: props.hasPlayer ? 'calc(100vh - 32px - 72px)' : 'calc(100vh - 32px)' }"
    @scroll="onScroll"
  >
    <!-- Grid View: Artists / Albums / Playlists -->
    <Transition :name="viewTransitionName">
      <div v-if="showGrid" key="grid" class="grid-view">
        <div class="song-list-header">
          <h2 class="song-list-title">{{ viewTitle }}</h2>
          <div class="header-right">
            <div class="search-box" :class="{ focused: searchInputFocused }">
              <i class="pi pi-search search-icon"></i>
              <input
                v-model="searchQuery"
                type="text"
                class="search-input"
                placeholder="搜索歌曲、艺术家、专辑..."
                @focus="searchInputFocused = true"
                @blur="searchInputFocused = false"
              />
              <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
                <i class="pi pi-times"></i>
              </button>
            </div>
          </div>
        </div>
        <div v-if="category === 'artists' && artists.length === 0" class="empty-state">
          <p class="empty-text">暂无艺术家</p>
          <p class="empty-hint">通过歌单「添加文件夹」导入音乐</p>
        </div>
        <div v-else-if="category === 'albums' && albums.length === 0" class="empty-state">
          <p class="empty-text">暂无专辑</p>
          <p class="empty-hint">通过歌单「添加文件夹」导入音乐</p>
        </div>
        <div v-else-if="category === 'playlists' && playlists.length === 0" class="empty-state">
          <p class="empty-text">暂无歌单</p>
          <p class="empty-hint">通过歌单「添加文件夹」导入音乐</p>
        </div>
        <div v-else class="card-grid">
          <!-- Artist Cards -->
          <template v-if="category === 'artists'">
            <div
              v-for="artist in artists"
              :key="artist.name"
              class="artist-card"
              @click="emit('selectView', 'artists', `artist:${artist.name}`)"
            >
              <img v-if="artist.cover" :src="artist.cover" class="artist-cover" alt="cover" />
              <div v-else class="artist-cover-placeholder">
                <i class="pi pi-user" style="font-size: 28px; color: #bbb"></i>
              </div>
              <div class="artist-name">{{ artist.name }}</div>
              <div class="artist-count">{{ artist.trackCount }} 首</div>
            </div>
          </template>
          <!-- Album Cards -->
          <template v-if="category === 'albums'">
            <div
              v-for="album in albums"
              :key="album.name"
              class="album-card"
              @click="emit('selectView', 'albums', `album:${album.name}`)"
            >
              <img v-if="album.cover" :src="album.cover" class="album-cover" alt="cover" />
              <div v-else class="album-cover-placeholder">
                <i class="pi pi-images" style="font-size: 28px; color: #bbb"></i>
              </div>
              <div class="album-name">{{ album.name }}</div>
              <div class="album-count">{{ album.trackCount }} 首</div>
            </div>
          </template>
          <!-- Playlist Cards -->
          <template v-if="category === 'playlists'">
            <div
              v-for="playlist in playlists"
              :key="playlist.name"
              class="playlist-card"
              @click="emit('selectView', 'playlists', `playlist:${playlist.name}`)"
            >
              <div class="playlist-cover-placeholder">
                <i class="pi pi-list" style="font-size: 32px; color: #ccc"></i>
              </div>
              <div class="playlist-name">{{ playlist.name }}</div>
              <div class="playlist-count">{{ playlist.trackIds.size }} 首</div>
            </div>
          </template>
        </div>
      </div>
    </Transition>

    <!-- Table View: Track listing -->
    <Transition :name="viewTransitionName">
      <div v-if="showTable" key="table" class="table-view">
        <div class="song-list-header">
          <div class="header-left">
            <button
              v-if="category !== 'allSongs'"
              class="btn-back"
              title="返回"
              @click="emit('selectView', category, null)"
            >
              <i class="pi pi-arrow-left"></i>
            </button>
            <h2 class="song-list-title">{{ viewTitle }}</h2>
          </div>
          <div class="header-right">
            <div class="search-box" :class="{ focused: searchInputFocused }">
              <i class="pi pi-search search-icon"></i>
              <input
                v-model="searchQuery"
                type="text"
                class="search-input"
                placeholder="搜索歌曲、艺术家、专辑..."
                @focus="searchInputFocused = true"
                @blur="searchInputFocused = false"
              />
              <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
                <i class="pi pi-times"></i>
              </button>
            </div>
          </div>
        </div>
        <div v-if="displayTracks.length === 0" class="empty-state">
          <div class="empty-icon">
            <i class="pi pi-wave-pulse" style="font-size: 48px; color: #ccc"></i>
          </div>
          <p class="empty-text">暂无音乐</p>
          <p class="empty-hint">通过左侧菜单「歌单 → 添加文件夹」导入音乐</p>
        </div>
        <div v-else class="track-table-wrapper">
          <table class="track-table">
            <thead>
              <tr>
                <th class="col-cover-header">{{ displayTracks.length }} 首</th>
                <th class="col-index">#</th>
                <th class="col-info">标题</th>
                <th class="col-album">专辑</th>
                <th class="col-duration">时长</th>
              </tr>
            </thead>
            <tbody :style="{ height: totalHeight + 'px', position: 'relative', display: 'block' }">
              <div :style="{ height: paddingTop + 'px' }"></div>
              <tr
                v-for="(track, index) in visibleTracks"
                :key="track.id"
                class="track-row"
                :class="{ 'track-playing': currentTrack?.id === track.id }"
                :style="{ height: rowHeight + 'px', display: 'flex' }"
                @click="onRowClick(track, visibleRange.start + index, $event)"
                @dblclick="onRowDblClick(track)"
                @contextmenu="onContextMenu($event, track)"
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
                  <span v-else>{{ visibleRange.start + index + 1 }}</span>
                </td>
                <td class="col-info">
                  <div class="track-title">{{ track.title }}</div>
                  <div class="track-artist">{{ track.artist }}</div>
                  <div v-if="track.format || track.sampleRate" class="track-audio-data">
                    <div class="track-pills">
                      <span v-if="track.format" class="pill pill-format">{{
                        track.format.toUpperCase().replace(/^\./, '')
                      }}</span>
                      <span v-if="track.sampleRate" class="pill pill-rate"
                        >{{ (track.sampleRate / 1000).toFixed(1) }}kHz</span
                      >
                      <span v-if="track.bitDepth" class="pill pill-depth"
                        >{{ track.bitDepth }}bit</span
                      >
                      <span v-if="track.bitrate" class="pill pill-bitrate"
                        >{{ Math.round(track.bitrate / 1000) }}kbps</span
                      >
                    </div>
                  </div>
                </td>
                <td class="col-album">{{ track.album }}</td>
                <td class="col-duration">{{ formatDuration(track.duration) }}</td>
              </tr>
              <div
                :style="{
                  height: totalHeight - paddingTop - visibleTracks.length * rowHeight + 'px'
                }"
              ></div>
            </tbody>
          </table>

          <!-- Context Menu -->
          <div
            v-if="showContextMenu"
            class="context-menu"
            :style="{ top: menuY + 'px', left: menuX + 'px' }"
            @click.stop
          >
            <div class="menu-item" @click="handleDelete">
              <i class="pi pi-trash"></i>
              <span>删除</span>
            </div>
            <div class="menu-item" @click="handleOpenFolder">
              <i class="pi pi-folder-open"></i>
              <span>打开文件所在位置</span>
            </div>
            <div
              class="menu-item"
              @mouseenter="showPlaylistSubmenu = true"
              @mouseleave="showPlaylistSubmenu = false"
            >
              <i class="pi pi-plus"></i>
              <span>加入到歌单</span>
              <i class="pi pi-chevron-right submenu-icon"></i>

              <div v-if="showPlaylistSubmenu" class="submenu">
                <div v-if="playlists.length === 0" class="menu-item disabled">暂无歌单</div>
                <div
                  v-for="pl in playlists"
                  :key="pl.name"
                  class="menu-item"
                  @click="handleAddToPlaylist(pl.name)"
                >
                  {{ pl.name }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.view-down-enter-active,
.view-down-leave-active,
.view-up-enter-active,
.view-up-leave-active {
  position: relative;
  transition:
    transform 0.35s ease,
    opacity 0.35s ease;
}
.view-down-enter-active,
.view-up-enter-active {
  z-index: 1;
}
.view-down-leave-active,
.view-up-leave-active {
  z-index: 0;
}

/* view-down: drilling into detail — old slides UP, new slides UP from BELOW */
.view-down-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
.view-down-enter-from {
  transform: translateY(100%);
  opacity: 0;
}

/* view-up: going back — old slides DOWN, new slides DOWN from ABOVE */
.view-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
.view-up-enter-from {
  transform: translateY(-100%);
  opacity: 0;
}

.song-list {
  display: grid;
  position: relative;
  padding: 20px min(4vw, 40px);
  overflow-y: auto;
  overflow-x: hidden;
  background: #fff;
  width: 100%;
  box-sizing: border-box;
}

.song-list > * {
  grid-area: 1 / 1;
}

.song-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
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
  transition:
    background 0.15s,
    color 0.15s;
  flex-shrink: 0;
}

.btn-back:hover {
  background: #f0f0f0;
  color: #1a1a1a;
}

.song-list-title {
  font-size: 24px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0;
}

.song-count {
  display: none; /* Moved to table header */
}
.header-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 1;
}

/* Card Grid Layout */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 24px;
  width: 100%;
}

/* Unified Card Component Styles */
.artist-card,
.album-card,
.playlist-card {
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-radius: 12px;
  background: #f9f9f9;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.artist-card:hover,
.album-card:hover,
.playlist-card:hover {
  background: #fff;
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  border-color: #eee;
}

/* Unified Cover Styles */
.artist-cover,
.artist-cover-placeholder,
.album-cover,
.album-cover-placeholder,
.playlist-cover-placeholder {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 8px;
  margin-bottom: 12px;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.artist-cover-placeholder,
.album-cover-placeholder {
  background: #eee;
  display: flex;
  align-items: center;
  justify-content: center;
}

.playlist-cover-placeholder {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Unified Text Styles */
.artist-name,
.album-name,
.playlist-name {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
  padding: 0 2px;
}

.artist-count,
.album-count,
.playlist-count {
  font-size: 12px;
  color: #999;
  padding: 0 2px;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
}
.empty-icon {
  margin-bottom: 16px;
}
.empty-text {
  font-size: 18px;
  color: #999;
  margin: 0 0 8px 0;
}
.empty-hint {
  font-size: 13px;
  color: #bbb;
  margin: 0;
}

/* Table View */
.track-table-wrapper {
  overflow-x: auto;
}
.track-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  display: block;
}
.track-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
  display: block;
  background: #fff;
  width: 100%;
}
.track-table thead tr {
  display: flex;
}
.track-table th {
  text-align: left;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #eee;
}
.track-row td {
  padding: 14px 12px;
  font-size: 14px;
  color: #333;
  border-bottom: 1px solid #f2f2f2;
  display: flex;
  align-items: center;
}
.track-row {
  cursor: pointer;
  transition: background 0.1s;
  width: 100%;
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
  flex-shrink: 0;
}
.col-cover,
.col-cover-header {
  width: 60px;
  flex-shrink: 0;
}
.col-cover-header {
  color: #888;
  font-size: 10px !important;
  display: flex;
  align-items: center;
  padding-left: 12px !important;
}
.playing-indicator {
  display: flex;
  align-items: center;
}
.col-info {
  flex: 1;
  line-height: 1.4;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start !important;
}
.track-title {
  font-size: 14px;
  font-weight: 500;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}
.track-playing .track-title {
  color: #1a73e8;
}
.track-artist {
  font-size: 12px;
  color: #999;
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}
.track-audio-data {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.meta-label {
  font-size: 10px;
  color: #bbb;
  font-weight: 500;
}
.col-album {
  width: 25%;
  max-width: 200px;
  min-width: 100px;
  font-size: 13px !important;
  color: #666 !important;
  flex-shrink: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 600px) {
  .col-album {
    display: none !important;
  }
}
.col-duration {
  width: 60px;
  text-align: right;
  font-size: 12px !important;
  color: #aaa !important;
  padding-right: 10px !important;
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
}

.track-pills {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.pill {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  text-transform: uppercase;
  line-height: 1.2;
}
.pill-format {
  background: #f0f0f0;
  color: #666;
}
.pill-rate {
  background: #e3f2fd;
  color: #1976d2;
}
.pill-depth {
  background: #f1f8e9;
  color: #558b2f;
}
.pill-bitrate {
  background: #fff3e0;
  color: #ef6c00;
}

/* Context Menu */
.context-menu {
  position: fixed;
  z-index: 1000;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  padding: 6px;
  min-width: 160px;
  border: 1px solid #eee;
}
.menu-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  font-size: 13px;
  color: #333;
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
}
.menu-item:hover {
  background: #f5f5f5;
}
.menu-item i {
  margin-right: 10px;
  font-size: 14px;
  color: #666;
}
.menu-item.disabled {
  color: #ccc;
  pointer-events: none;
}
.submenu-icon {
  margin-left: auto;
  margin-right: 0 !important;
  font-size: 10px !important;
  color: #999 !important;
}
.submenu {
  position: absolute;
  left: 100%;
  top: 0;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  padding: 6px;
  min-width: 120px;
  border: 1px solid #eee;
  margin-left: 2px;
}

/* Search Box */
.search-box {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 14px;
  border-radius: 18px;
  background: #f5f5f5;
  border: 1.5px solid transparent;
  transition:
    border-color 0.2s,
    background 0.2s,
    box-shadow 0.2s;
  min-width: 150px;
  max-width: 280px;
  flex: 1;
}
@media (max-width: 500px) {
  .search-box {
    max-width: none;
    width: 100%;
    order: 2;
  }
  .song-list-header {
    gap: 16px;
  }
}

.search-box.focused {
  border-color: #1a73e8;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.1);
}

.search-icon {
  font-size: 14px;
  color: #999;
  flex-shrink: 0;
  margin-right: 8px;
  transition: color 0.2s;
}

.search-box.focused .search-icon {
  color: #1a73e8;
}

.search-input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: #333;
  flex: 1;
  min-width: 0;
  height: 100%;
}

.search-input::placeholder {
  color: #bbb;
}

.search-clear {
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

.search-clear i {
  font-size: 10px;
  color: #666;
}

.search-clear:hover {
  background: #ccc;
}
</style>
