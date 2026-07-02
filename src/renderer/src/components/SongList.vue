<script setup lang="ts">
import { computed } from 'vue'
import { useMusicStore } from '../stores/useMusicStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import type { Track } from '../types/music'
import CoverImg from './CoverImg.vue'
import { formatDuration } from './song-list/formatDuration'
import type { GridItem } from './song-list/types'
import { useSongListContextMenu } from './song-list/useSongListContextMenu'
import { useSongListGridRendering } from './song-list/useSongListGridRendering'
import { useSongListSearch } from './song-list/useSongListSearch'
import { useSongListVirtualScroll } from './song-list/useSongListVirtualScroll'

const props = defineProps<{
  category: string
  filter: string | null
  hasPlayer: boolean
  transitionName: 'page-down' | 'page-up'
}>()

const emit = defineEmits<{
  selectView: [category: string, filter: string | null]
}>()

const {
  tracks,
  artists,
  albums,
  playlists,
  folders,
  getPlaylistTracks,
  removeTrack,
  addToPlaylist,
  removeFromPlaylist,
  createPlaylist,
  deletePlaylist
} = useMusicStore()
const { currentTrack, playTrack } = usePlayerStore()

const { searchQuery, debouncedSearchQuery, searchInputFocused } = useSongListSearch()

const baseDisplayTracks = computed(() => {
  if (props.category === 'allSongs') return tracks.value
  if (props.filter) {
    if (props.filter.startsWith('artist:')) {
      const name = props.filter.slice(7)
      return artists.value.find((artist) => artist.name === name)?.tracks ?? []
    }
    if (props.filter.startsWith('album:')) {
      const name = props.filter.slice(6)
      return albums.value.find((album) => album.name === name)?.tracks ?? []
    }
    if (props.filter.startsWith('playlist:')) {
      const name = props.filter.slice(9)
      return getPlaylistTracks(name)
    }
    if (props.filter.startsWith('folder:')) {
      const path = props.filter.slice(7)
      const folder = folders.value.find((f) => f.path === path)
      return folder?.tracks ?? []
    }
  }
  return []
})

const viewTitle = computed(() => {
  if (props.category === 'folders') {
    if (props.filter && props.filter.startsWith('folder:')) {
      return folders.value.find((f) => f.path === props.filter?.slice(7))?.name ?? '文件夹'
    }
    return '文件夹'
  }
  if (props.category === 'allSongs') return '本地音乐'
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

const currentPlaylistName = computed(() => {
  if (props.category !== 'playlists' || !props.filter?.startsWith('playlist:')) return null
  return props.filter.slice(9)
})

const isPlaylistDetail = computed(() => currentPlaylistName.value !== null)

const displayTracks = computed(() => {
  const q = debouncedSearchQuery.value.trim().toLowerCase()
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

const currentGridItems = computed<GridItem[]>(() => {
  if (props.category === 'artists') return artists.value
  if (props.category === 'albums') return albums.value
  if (props.category === 'playlists') return playlists.value
  if (props.category === 'folders') return folders.value
  return []
})

function onRowClick(track: Track, event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (target.closest('.btn-remove')) return
  playTrack(track, displayTracks.value)
}

function onRowDblClick(track: Track): void {
  playTrack(track, displayTracks.value)
}

const {
  showContextMenu,
  menuX,
  menuY,
  showPlaylistSubmenu,
  showCreatePlaylistDialog,
  newPlaylistName,
  onContextMenu,
  handleDelete,
  handleOpenFolder,
  handleAddToPlaylist,
  handleRemoveFromCurrentPlaylist,
  openCreatePlaylistDialog,
  handleCreatePlaylist,
  handleCreatePlaylistFromMenu,
  handleDeletePlaylist
} = useSongListContextMenu({
  currentPlaylistName,
  removeTrack,
  addToPlaylist,
  removeFromPlaylist,
  createPlaylist,
  deletePlaylist
})

const {
  containerRef,
  tbodyRef,
  rowHeight,
  visibleRange,
  visibleTracks,
  totalHeight,
  paddingTop,
  onScroll,
  onRowPointerMove,
  updateViewportHeight
} = useSongListVirtualScroll({
  displayTracks,
  resetSources: [() => props.category, () => props.filter, debouncedSearchQuery],
  shouldResetOnSearch: showTable,
  debouncedSearchQuery
})
void containerRef.value
void tbodyRef.value

const {
  renderedGridCount,
  gridTotalCount,
  visibleArtists,
  visibleAlbums,
  visiblePlaylists,
  visibleFolders,
  localTransitionName,
  viewKey,
  isSwitching,
  onViewBeforeLeave,
  finishViewSwitch
} = useSongListGridRendering({
  category: () => props.category,
  filter: () => props.filter,
  transitionName: () => props.transitionName,
  debouncedSearchQuery,
  currentGridItems,
  showGrid,
  updateViewportHeight
})
</script>

<template>
  <div
    ref="containerRef"
    class="song-list"
    :class="{ 'has-player': props.hasPlayer, 'is-switching': isSwitching }"
    :style="{ height: 'calc(100vh - 32px)' }"
    @scroll="onScroll"
  >
    <Transition
      :name="localTransitionName"
      mode="out-in"
      @before-leave="onViewBeforeLeave"
      @after-enter="finishViewSwitch"
      @enter-cancelled="finishViewSwitch"
      @leave-cancelled="finishViewSwitch"
    >
      <div :key="viewKey" :class="showGrid ? 'grid-view' : 'table-view'">
        <template v-if="showGrid">
          <div class="song-list-header">
            <h2 class="song-list-title">{{ viewTitle }}</h2>
            <div class="header-right">
              <div class="search-box" :class="{ focused: searchInputFocused }">
                <i class="pi pi-search search-icon"></i>
                <input
                  v-model="searchQuery"
                  type="text"
                  class="search-input"
                  placeholder="搜索歌曲、歌手、专辑或文件夹"
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
            <p class="empty-hint">点击下方卡片创建你的第一个歌单</p>
          </div>
          <div v-else class="card-grid">
            <!-- Artist Cards -->
            <template v-if="category === 'artists'">
              <div
                v-for="artist in visibleArtists"
                :key="artist.name"
                class="artist-card"
                @click="emit('selectView', 'artists', `artist:${artist.name}`)"
              >
                <CoverImg v-if="artist.cover" :cover="artist.cover" class="artist-cover" alt="cover" />
                <div v-else class="artist-cover-placeholder">
                  <i class="pi pi-user" style="font-size: 28px; color: #bbb"></i>
                </div>
                <div class="artist-name">{{ artist.name }}</div>
                <div class="artist-count">{{ artist.trackCount }} 首</div>
              </div>
              <div v-if="renderedGridCount < gridTotalCount" class="grid-loading-more">
                正在加载更多艺术家...
              </div>
            </template>
            <!-- Album Cards -->
            <template v-if="category === 'albums'">
              <div
                v-for="album in visibleAlbums"
                :key="album.name"
                class="album-card"
                @click="emit('selectView', 'albums', `album:${album.name}`)"
              >
                <CoverImg v-if="album.cover" :cover="album.cover" class="album-cover" alt="cover" />
                <div v-else class="album-cover-placeholder">
                  <i class="pi pi-images" style="font-size: 28px; color: #bbb"></i>
                </div>
                <div class="album-name">{{ album.name }}</div>
                <div class="album-count">{{ album.trackCount }} 首</div>
              </div>
            </template>
            <!-- Playlist Cards -->
            <template v-if="category === 'playlists'">
              <!-- Create Playlist Card -->
              <div class="playlist-card create-playlist-card" @click="openCreatePlaylistDialog()">
                <div class="playlist-cover-placeholder create-placeholder">
                  <i class="pi pi-plus" style="font-size: 32px; color: #999"></i>
                </div>
                <div class="playlist-name">创建歌单</div>
                <div class="playlist-count">点击创建新歌单</div>
              </div>
              <div
                v-for="playlist in visiblePlaylists"
                :key="playlist.id"
                class="playlist-card"
                @click="emit('selectView', 'playlists', `playlist:${playlist.name}`)"
              >
                <div class="playlist-cover-placeholder" :class="{ 'default-playlist-cover': playlist.isDefault }">
                  <i :class="playlist.isDefault ? 'pi pi-heart' : 'pi pi-list'" style="font-size: 32px; color: #ccc"></i>
                </div>
                <div class="playlist-name">{{ playlist.name }}</div>
                <div class="playlist-count">{{ playlist.trackIds?.length ?? 0 }} 首</div>
                <div
                  v-if="!playlist.isDefault"
                  class="playlist-delete-btn"
                  title="删除歌单"
                  @click="handleDeletePlaylist(playlist.id || '', $event)"
                >
                  <i class="pi pi-trash" style="font-size: 12px"></i>
                </div>
              </div>
            </template>
            <template v-if="category === 'folders'">
              <div
                v-for="folder in visibleFolders"
                :key="folder.path"
                class="playlist-card folder-card"
                @click="emit('selectView', 'folders', `folder:${folder.path}`)"
              >
                <CoverImg v-if="folder.cover" :cover="folder.cover" class="album-cover" alt="cover" />
                <div v-else class="playlist-cover-placeholder">
                  <i class="pi pi-folder" style="font-size: 32px; color: #fff"></i>
                </div>
                <div class="playlist-name">{{ folder.name }}</div>
                <div class="playlist-count">{{ folder.trackCount }} 首</div>
              </div>
            </template>
          </div>
        </template>
        <template v-else>
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
              <div class="title-group">
                <h2 class="song-list-title">{{ viewTitle }}</h2>
              </div>
            </div>
            <div class="header-right">
              <div class="search-box" :class="{ focused: searchInputFocused }">
                <i class="pi pi-search search-icon"></i>
                <input
                  v-model="searchQuery"
                  type="text"
                  class="search-input"
                  placeholder="搜索歌曲、歌手、专辑或文件夹"
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
            <p class="empty-text">暂无内容</p>
            <p class="empty-hint">通过左侧菜单「歌单 → 添加文件夹」导入音乐</p>
          </div>
          <div v-else class="track-table-wrapper">
            <table class="track-table">
              <thead>
                <tr>
                  <th class="col-cover-header"></th>
                  <th class="col-index">#</th>
                  <th class="col-info">标题</th>
                  <th class="col-album">专辑</th>
                  <th class="col-duration">时长</th>
                </tr>
              </thead>
              <tbody
                ref="tbodyRef"
                :style="{ height: totalHeight + 'px', position: 'relative', display: 'block' }"
              >
                <tr
                  class="virtual-spacer"
                  :style="{ height: paddingTop + 'px' }"
                  aria-hidden="true"
                >
                  <td colspan="5"></td>
                </tr>
                <tr
                  v-for="(track, index) in visibleTracks"
                  :key="track.id"
                  class="track-row"
                  :class="{ 'track-playing': currentTrack?.id === track.id }"
                  :style="{ height: rowHeight - 4 + 'px', display: 'flex' }"
                  @click="onRowClick(track, $event)"
                  @dblclick="onRowDblClick(track)"
                  @pointermove="onRowPointerMove"
                  @contextmenu="onContextMenu($event, track)"
                >
                  <td class="col-cover">
                    <CoverImg v-if="track.cover" :cover="track.cover" class="cover-img" alt="cover" />
                    <div v-else class="cover-placeholder">
                      <i class="pi pi-wave-pulse" style="font-size: 18px; color: #bbb"></i>
                    </div>
                  </td>
                  <td class="col-index">
                    <span v-if="currentTrack?.id === track.id" class="playing-indicator">
                      <i class="pi pi-volume-up" style="font-size: 12px; color: #1a73e8"></i>
                    </span>
                    <span v-else>{{ visibleRange.start + Number(index) + 1 }}</span>
                  </td>
                  <td class="col-info">
                    <div class="track-title-row">
                      <div class="track-title">{{ track.title }}</div>
                    </div>
                    <div class="track-artist">{{ track.artist }}</div>
                  </td>
                  <td class="col-album">{{ track.album }}</td>
                  <td class="col-duration">{{ formatDuration(track.duration) }}</td>
                </tr>
                <tr
                  class="virtual-spacer"
                  :style="{
                    height: totalHeight - paddingTop - visibleTracks.length * rowHeight + 'px'
                  }"
                  aria-hidden="true"
                >
                  <td colspan="5"></td>
                </tr>
              </tbody>
            </table>

            <!-- Context Menu -->
            <Teleport to="body">
            <div
              v-if="showContextMenu"
              class="context-menu"
              :style="{ top: menuY + 'px', left: menuX + 'px' }"
              @click.stop
            >
              <div class="menu-item" @click="handleDelete">
                <i class="pi pi-trash"></i>
                <span>{{ isPlaylistDetail ? '从本地库删除' : '删除' }}</span>
              </div>
              <div
                v-if="isPlaylistDetail"
                class="menu-item"
                @click="handleRemoveFromCurrentPlaylist"
              >
                <i class="pi pi-minus-circle"></i>
                <span>从歌单移除</span>
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
                  <div
                    class="menu-item create-playlist-menu-item"
                    @click="handleCreatePlaylistFromMenu"
                  >
                    <i class="pi pi-plus" style="font-size: 14px; margin-right: 6px"></i>
                    <span>创建新歌单</span>
                  </div>
                  <div v-if="playlists.length === 0" class="menu-item disabled">暂无歌单</div>
                  <div
                    v-for="pl in playlists"
                    :key="pl.id"
                    class="menu-item"
                    @click="handleAddToPlaylist(pl.name)"
                  >
                    {{ pl.name }}
                  </div>
                </div>
              </div>
            </div>
            </Teleport>
          </div>
        </template>
      </div>
    </Transition>

    <!-- Create Playlist Dialog -->
    <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="showCreatePlaylistDialog" class="dialog-overlay" @click.self="showCreatePlaylistDialog = false">
        <div class="create-playlist-dialog" @click.stop>
          <h3 class="dialog-title">创建歌单</h3>
          <input
            v-model="newPlaylistName"
            class="dialog-input"
            type="text"
            placeholder="请输入歌单名称"
            maxlength="50"
            autofocus
            @keyup.enter="handleCreatePlaylist"
          />
          <div class="dialog-actions">
            <button class="dialog-btn cancel" @click="showCreatePlaylistDialog = false">取消</button>
            <button
              class="dialog-btn confirm"
              :disabled="!newPlaylistName.trim()"
              @click="handleCreatePlaylist"
            >创建</button>
          </div>
        </div>
      </div>
    </Transition>
    </Teleport>
  </div>
</template>

<style scoped src="./song-list/SongList.css"></style>
