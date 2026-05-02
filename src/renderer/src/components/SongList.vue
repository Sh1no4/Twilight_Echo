<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMusicStore } from '../stores/useMusicStore'
import { usePlayerStore } from '../stores/usePlayerStore'

const props = defineProps<{
  category: string
  filter: string | null
  hasPlayer: boolean
}>()

const emit = defineEmits<{
  selectView: [category: string, filter: string | null]
}>()

const { tracks, artists, albums, playlists, getPlaylistTracks, removeTrack } = useMusicStore()
const { currentTrack, playTrack } = usePlayerStore()

const displayTracks = computed(() => {
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function onRowClick(track: (typeof tracks.value)[number], _index: number, event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (target.closest('.btn-remove')) return
  playTrack(track, displayTracks.value)
}

function onRowDblClick(track: (typeof tracks.value)[number]): void {
  playTrack(track, displayTracks.value)
}
</script>

<template>
  <div class="song-list" :style="{ height: props.hasPlayer ? 'calc(100vh - 32px - 72px)' : 'calc(100vh - 32px)' }">
    <!-- Grid View: Artists / Albums / Playlists -->
    <Transition :name="viewTransitionName">
    <div v-if="showGrid" class="grid-view" key="grid">
      <div class="song-list-header">
        <h2 class="song-list-title">{{ viewTitle }}</h2>
        <span class="song-count">{{ category === 'artists' ? artists.length : category === 'albums' ? albums.length : playlists.length }} 项</span>
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
        <div
          v-if="category === 'artists'"
          v-for="artist in artists"
          :key="artist.name"
          class="artist-card"
          @click="emit('selectView', 'artists', `artist:${artist.name}`)"
        >
          <img v-if="artist.cover" :src="artist.cover" class="artist-cover" alt="cover" />
          <div v-else class="artist-cover-placeholder"><i class="pi pi-user" style="font-size: 28px; color: #bbb"></i></div>
          <div class="artist-name">{{ artist.name }}</div>
          <div class="artist-count">{{ artist.trackCount }} 首</div>
        </div>
        <!-- Album Cards -->
        <div
          v-if="category === 'albums'"
          v-for="album in albums"
          :key="album.name"
          class="album-card"
          @click="emit('selectView', 'albums', `album:${album.name}`)"
        >
          <img v-if="album.cover" :src="album.cover" class="album-cover" alt="cover" />
          <div v-else class="album-cover-placeholder"><i class="pi pi-images" style="font-size: 28px; color: #bbb"></i></div>
          <div class="album-name">{{ album.name }}</div>
          <div class="album-count">{{ album.trackCount }} 首</div>
        </div>
        <!-- Playlist Cards -->
        <div
          v-if="category === 'playlists'"
          v-for="playlist in playlists"
          :key="playlist.name"
          class="playlist-card"
          @click="emit('selectView', 'playlists', `playlist:${playlist.name}`)"
        >
          <div class="playlist-cover-placeholder"><i class="pi pi-list" style="font-size: 32px; color: #ccc"></i></div>
          <div class="playlist-name">{{ playlist.name }}</div>
          <div class="playlist-count">{{ playlist.trackIds.size }} 首</div>
        </div>
      </div>
    </div>
    </Transition>

    <!-- Table View: Track listing -->
    <Transition :name="viewTransitionName">
    <div v-if="showTable" class="table-view" key="table">
      <div class="song-list-header">
        <div class="header-left">
          <button v-if="category !== 'allSongs'" class="btn-back" title="返回" @click="emit('selectView', category, null)">
            <i class="pi pi-arrow-left"></i>
          </button>
          <h2 class="song-list-title">{{ viewTitle }}</h2>
        </div>
        <span class="song-count">{{ displayTracks.length }} 首</span>
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
              <th class="col-cover"></th>
              <th class="col-index">#</th>
              <th class="col-info">标题</th>
              <th class="col-album">专辑</th>
              <th class="col-size">大小</th>
              <th class="col-action"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(track, index) in displayTracks"
              :key="track.id"
              class="track-row"
              :class="{ 'track-playing': currentTrack?.id === track.id }"
              @click="onRowClick(track, index, $event)"
              @dblclick="onRowDblClick(track)"
            >
              <td class="col-cover">
                <img
                  v-if="track.cover"
                  :src="track.cover"
                  class="cover-img"
                  alt="cover"
                />
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
              <td class="col-size">{{ formatSize(track.size) }}</td>
              <td class="col-action">
                <button class="btn-remove" title="移除" @click="removeTrack(track.id)">
                  &times;
                </button>
              </td>
            </tr>
          </tbody>
        </table>
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
  transition: transform 0.35s ease, opacity 0.35s ease;
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
  padding: 32px 40px;
  overflow-y: auto;
  background: #fff;
}

.song-list > * {
  grid-area: 1 / 1;
}

.song-list-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 28px;
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
  transition: background 0.15s, color 0.15s;
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
  font-size: 14px;
  color: #888;
  flex-shrink: 0;
}

/* Grid View */
.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

/* Artist Card */
.artist-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px;
  border-radius: 12px;
  background: #f9f9f9;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.artist-card:hover {
  background: #f0f0f0;
  transform: translateY(-2px);
}
.artist-cover {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 12px;
  margin-bottom: 10px;
}
.artist-cover-placeholder {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12px;
  background: #eee;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}
.artist-name {
  font-size: 14px;
  font-weight: 500;
  color: #1a1a1a;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  margin-bottom: 2px;
}
.artist-count {
  font-size: 12px;
  color: #999;
}

/* Album Card */
.album-card {
  display: flex;
  flex-direction: column;
  padding: 0;
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.1s;
}
.album-card:hover {
  transform: translateY(-2px);
}
.album-cover {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 12px;
  margin-bottom: 8px;
}
.album-cover-placeholder {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 12px;
  background: #eee;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}
.album-name {
  font-size: 14px;
  font-weight: 500;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}
.album-count {
  font-size: 12px;
  color: #999;
}

/* Playlist Card */
.playlist-card {
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-radius: 10px;
  background: #f9f9f9;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.playlist-card:hover {
  background: #f0f0f0;
  transform: translateY(-2px);
}
.playlist-cover-placeholder {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 6px;
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
}
.playlist-name {
  font-size: 14px;
  font-weight: 500;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}
.playlist-count {
  font-size: 12px;
  color: #999;
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
  width: 140px;
  font-size: 13px !important;
  color: #666 !important;
}
.col-size {
  width: 80px;
  font-size: 12px !important;
  color: #aaa !important;
}
.col-action {
  width: 40px;
  text-align: center;
}
.btn-remove {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 20px;
  color: #ccc;
  padding: 0;
  line-height: 1;
  transition: color 0.15s;
}
.btn-remove:hover {
  color: #e53935;
}
</style>
