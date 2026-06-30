<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useMusicStore } from '../stores/useMusicStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import type { Track } from '../types/music'
import CoverImg from './CoverImg.vue'
import { filterLocalGridItems } from '../utils/localLibrarySearch'

type LocalTransitionName = 'local-page-down' | 'local-page-up'
type IdleDeadlineLike = {
  didTimeout: boolean
  timeRemaining: () => number
}
type RequestIdleCallbackLike = (
  callback: (deadline: IdleDeadlineLike) => void,
  options?: { timeout?: number }
) => number
type CancelIdleCallbackLike = (handle: number) => void
type WindowWithIdleCallback = Window & {
  requestIdleCallback?: RequestIdleCallbackLike
  cancelIdleCallback?: CancelIdleCallbackLike
}

type GridItem = {
  id?: string
  name: string
  trackCount?: number
  cover?: string | null
  path?: string
  trackIds?: string[]
  isDefault?: boolean
}

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

const searchQuery = ref('')
const debouncedSearchQuery = ref('')
const searchInputFocused = ref(false)
let searchDebounceTimer: number | null = null

watch(searchQuery, (value) => {
  if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = window.setTimeout(() => {
    debouncedSearchQuery.value = value
    searchDebounceTimer = null
  }, 180)
})

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

const GRID_BATCH_SIZE = 16
const GRID_IDLE_BATCH_SIZE = 24
const renderedGridCount = ref(GRID_BATCH_SIZE)
let gridRenderIdleId: number | null = null
let gridRenderTimer: number | null = null
let lastGridRenderKey = ''

const currentGridItems = computed<GridItem[]>(() => {
  if (props.category === 'artists') return artists.value
  if (props.category === 'albums') return albums.value
  if (props.category === 'playlists') return playlists.value
  if (props.category === 'folders') return folders.value
  return []
})

const filteredGridItems = computed(() => filterLocalGridItems(currentGridItems.value, debouncedSearchQuery.value))
const visibleGridItems = computed(() => filteredGridItems.value.slice(0, renderedGridCount.value))
const gridTotalCount = computed(() => filteredGridItems.value.length)
const visibleArtists = computed(() => (props.category === 'artists' ? visibleGridItems.value : []))
const visibleAlbums = computed(() => (props.category === 'albums' ? visibleGridItems.value : []))
const visiblePlaylists = computed(() =>
  props.category === 'playlists' ? visibleGridItems.value : []
)
const visibleFolders = computed(() => (props.category === 'folders' ? visibleGridItems.value : []))
const localTransitionName = computed<LocalTransitionName>(() =>
  props.transitionName === 'page-up' ? 'local-page-up' : 'local-page-down'
)
const viewKey = computed(() =>
  showGrid.value ? `grid-${props.category}` : `table-${props.category}-${props.filter ?? 'root'}`
)
const isSwitching = ref(false)

function stopGridRendering(): void {
  if (gridRenderIdleId !== null) {
    const idleWindow = window as WindowWithIdleCallback
    idleWindow.cancelIdleCallback?.(gridRenderIdleId)
    gridRenderIdleId = null
  }
  if (gridRenderTimer !== null) {
    window.clearTimeout(gridRenderTimer)
    gridRenderTimer = null
  }
}

function scheduleGridPump(callback: () => void): void {
  const idleWindow = window as WindowWithIdleCallback
  if (idleWindow.requestIdleCallback) {
    gridRenderIdleId = idleWindow.requestIdleCallback(
      () => {
        gridRenderIdleId = null
        callback()
      },
      { timeout: 180 }
    )
    return
  }

  gridRenderTimer = window.setTimeout(() => {
    gridRenderTimer = null
    callback()
  }, 48)
}

function pumpGridRendering(total: number): void {
  if (!showGrid.value) {
    stopGridRendering()
    return
  }

  renderedGridCount.value = Math.min(renderedGridCount.value + GRID_IDLE_BATCH_SIZE, total)
  if (renderedGridCount.value < total) {
    scheduleGridPump(() => pumpGridRendering(total))
  }
}

function startGridRendering(total: number, deferRest = false): void {
  stopGridRendering()
  renderedGridCount.value = Math.min(GRID_BATCH_SIZE, total)
  if (total <= GRID_BATCH_SIZE || deferRest || isSwitching.value) return

  scheduleGridPump(() => pumpGridRendering(total))
}

watch(
  [() => props.category, () => props.filter, gridTotalCount],
  () => {
    if (!showGrid.value) {
      stopGridRendering()
      return
    }

    const nextGridRenderKey = viewKey.value
    const deferRest = lastGridRenderKey !== '' && lastGridRenderKey !== nextGridRenderKey
    lastGridRenderKey = nextGridRenderKey
    startGridRendering(gridTotalCount.value, deferRest)
  },
  { immediate: true, flush: 'post' }
)

function onViewBeforeLeave(): void {
  isSwitching.value = true
  stopGridRendering()
}

function finishViewSwitch(): void {
  isSwitching.value = false
  if (showGrid.value) {
    startGridRendering(gridTotalCount.value)
  } else {
    requestAnimationFrame(updateViewportHeight)
  }
}

function formatDuration(seconds: number): string {
  if (!seconds) return '00:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function onRowClick(track: Track, event: MouseEvent): void {
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

function handleRemoveFromCurrentPlaylist(): void {
  const playlistName = currentPlaylistName.value
  if (!playlistName || !selectedTrack.value) return
  removeFromPlaylist(playlistName, selectedTrack.value.id)
  closeContextMenu()
}

// Create Playlist Dialog
const showCreatePlaylistDialog = ref(false)
const newPlaylistName = ref('')
const createPlaylistForTrack = ref<Track | null>(null)

function openCreatePlaylistDialog(track?: Track): void {
  createPlaylistForTrack.value = track ?? null
  newPlaylistName.value = ''
  showCreatePlaylistDialog.value = true
  closeContextMenu()
}

function handleCreatePlaylist(): void {
  const name = newPlaylistName.value.trim()
  if (!name) return
  createPlaylist(name)
  if (createPlaylistForTrack.value) {
    addToPlaylist(name, createPlaylistForTrack.value.id)
  }
  showCreatePlaylistDialog.value = false
  createPlaylistForTrack.value = null
  newPlaylistName.value = ''
}

function handleCreatePlaylistFromMenu(): void {
  openCreatePlaylistDialog(selectedTrack.value ?? undefined)
}

function handleDeletePlaylist(playlistId: string, event: MouseEvent): void {
  event.stopPropagation()
  deletePlaylist(playlistId)
}

onUnmounted(() => {
  window.removeEventListener('click', closeContextMenu)
  stopGridRendering()
})

// Virtual Scrolling
const containerRef = ref<HTMLElement | null>(null)
const tbodyRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const tableOffsetTop = ref(0)
const rowHeight = 68 // Calculated height of one row including vertical gap

const virtualScrollTop = computed(() => Math.max(0, scrollTop.value - tableOffsetTop.value))

const visibleRange = computed(() => {
  const start = Math.floor(virtualScrollTop.value / rowHeight)
  const count = Math.ceil(viewportHeight.value / rowHeight) + 6 // +6 buffer
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

let pointerMoveRafId: number | null = null
let lastPointerEvent: PointerEvent | null = null

function flushPointerMove(): void {
  const event = lastPointerEvent
  pointerMoveRafId = null
  if (!event) return
  const row = event.currentTarget as HTMLElement
  const rect = row.getBoundingClientRect()
  row.style.setProperty('--track-pointer-x', `${event.clientX - rect.left}px`)
  row.style.setProperty('--track-pointer-y', `${event.clientY - rect.top}px`)
}

function onRowPointerMove(event: PointerEvent): void {
  lastPointerEvent = event
  if (pointerMoveRafId === null) {
    pointerMoveRafId = requestAnimationFrame(flushPointerMove)
  }
}

function updateViewportHeight(): void {
  if (containerRef.value) {
    viewportHeight.value = containerRef.value.clientHeight
  }
  if (containerRef.value && tbodyRef.value) {
    tableOffsetTop.value = tbodyRef.value.offsetTop
  } else {
    tableOffsetTop.value = 0
  }
}

function resetScrollAndMeasure(): void {
  if (containerRef.value) {
    containerRef.value.scrollTop = 0
  }
  scrollTop.value = 0
  requestAnimationFrame(updateViewportHeight)
}

onMounted(() => {
  window.addEventListener('click', closeContextMenu)
  updateViewportHeight()
  window.addEventListener('resize', updateViewportHeight)
})

onUnmounted(() => {
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('resize', updateViewportHeight)
  if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer)
  if (pointerMoveRafId !== null) cancelAnimationFrame(pointerMoveRafId)
})

watch([() => props.category, () => props.filter, debouncedSearchQuery], resetScrollAndMeasure, { flush: 'post' })

watch(
  debouncedSearchQuery,
  () => {
    if (showTable.value) {
      resetScrollAndMeasure()
    }
  },
  { flush: 'post' }
)
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

<style scoped>
.local-page-down-enter-active,
.local-page-down-leave-active,
.local-page-up-enter-active,
.local-page-up-leave-active {
  transition:
    transform 0.24s var(--te-ease-soft),
    opacity 0.18s ease;
  will-change: transform;
}

.local-page-down-enter-from {
  transform: translate3d(0, -26px, 0);
  opacity: 0;
}

.local-page-down-leave-to {
  transform: translate3d(0, 18px, 0);
  opacity: 0;
}

.local-page-up-enter-from {
  transform: translate3d(0, 26px, 0);
  opacity: 0;
}

.local-page-up-leave-to {
  transform: translate3d(0, -18px, 0);
  opacity: 0;
}

.song-list {
  display: grid;
  position: relative;
  padding: 30px min(4.4vw, 48px) 132px;
  overflow-y: auto;
  overflow-x: hidden;
  background:
    radial-gradient(circle at 18% 7%, rgba(124, 77, 255, 0.045), transparent 34%),
    radial-gradient(circle at 53% 12%, rgba(255, 126, 182, 0.04), transparent 32%),
    radial-gradient(circle at 86% 12%, rgba(104, 132, 255, 0.038), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(255, 255, 255, 0.9));
  width: 100%;
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: rgba(124, 77, 255, 0.28) transparent;
}

.song-list::-webkit-scrollbar {
  width: 10px;
}

.song-list::-webkit-scrollbar-track {
  background: transparent;
}

.song-list::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 999px;
  background: rgba(124, 77, 255, 0.24);
  background-clip: content-box;
}

.song-list > * {
  grid-area: 1 / 1;
}

.grid-view,
.table-view {
  position: relative;
  min-width: 0;
  transform-origin: top center;
}

.grid-view::before,
.table-view::before {
  content: '';
  position: absolute;
  inset: -30px -28px auto;
  height: 230px;
  pointer-events: none;
  z-index: -1;
  background:
    radial-gradient(circle at 16% 40%, rgba(124, 77, 255, 0.035), transparent 46%),
    radial-gradient(circle at 52% 24%, rgba(255, 126, 182, 0.035), transparent 40%),
    radial-gradient(circle at 86% 18%, rgba(94, 118, 255, 0.032), transparent 42%);
}

.song-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 56px;
  margin-bottom: 18px;
  flex-wrap: wrap;
  padding: 0 32px;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 250px;
  flex: 1 1 0;
}

.title-group {
  display: flex;
  align-items: baseline;
  gap: 14px;
  min-width: 0;
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
    transform 0.18s var(--te-ease-soft),
    box-shadow 0.18s;
  flex-shrink: 0;
}

.btn-back:hover {
  background: rgba(124, 77, 255, 0.16);
  color: #5f36df;
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(124, 77, 255, 0.16);
}

.song-list-title {
  font-family: var(--te-font-rounded);
  font-size: 28px;
  font-weight: 900;
  color: var(--te-neutral-900);
  margin: 0;
  letter-spacing: 0;
  white-space: nowrap;
}
.header-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 18px;
  flex: 1.2 1 420px;
  min-width: 320px;
}

/* Card Grid Layout */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(166px, 1fr));
  gap: 16px;
  width: 100%;
}

/* Unified Card Component Styles */
.artist-card,
.album-card,
.playlist-card {
  display: flex;
  flex-direction: column;
  padding: 14px;
  border-radius: 16px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.56), rgba(248, 245, 255, 0.34)),
    rgba(255, 255, 255, 0.34);
  cursor: pointer;
  transition:
    transform 0.26s var(--te-ease-soft),
    background 0.26s,
    box-shadow 0.26s,
    border-color 0.26s;
  border: 1px solid rgba(255, 255, 255, 0.62);
  box-shadow: 0 18px 50px rgba(86, 70, 160, 0.1);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  overflow: hidden;
  position: relative;
}

.artist-card::before,
.album-card::before,
.playlist-card::before {
  content: '';
  position: absolute;
  inset: -40% -25% auto auto;
  width: 120px;
  height: 120px;
  pointer-events: none;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(124, 77, 255, 0.22), transparent 66%);
  opacity: 0;
  transition:
    opacity 0.26s,
    transform 0.26s var(--te-ease-soft);
}

.artist-card:hover,
.album-card:hover,
.playlist-card:hover {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.7), rgba(247, 242, 255, 0.48)),
    rgba(255, 255, 255, 0.46);
  transform: translateY(-6px) scale(1.01);
  box-shadow:
    0 24px 70px rgba(86, 70, 160, 0.18),
    0 0 0 1px rgba(124, 77, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.82);
}

.artist-card:hover::before,
.album-card:hover::before,
.playlist-card:hover::before {
  opacity: 1;
  transform: translate3d(-18px, 18px, 0);
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
  box-shadow: 0 18px 32px rgba(86, 70, 160, 0.14);
}

.artist-cover-placeholder,
.album-cover-placeholder {
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.88), transparent 34%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.18), rgba(34, 211, 238, 0.12));
  display: flex;
  align-items: center;
  justify-content: center;
}

.playlist-cover-placeholder {
  background:
    radial-gradient(circle at 72% 22%, rgba(255, 255, 255, 0.54), transparent 24%),
    linear-gradient(135deg, #7c4dff 0%, #c084fc 48%, #ff7eb6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Unified Text Styles */
.artist-name,
.album-name,
.playlist-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--te-neutral-900);
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
  color: var(--te-neutral-500);
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
  border-radius: 18px;
  background: var(--te-glass-bg);
  border: 1px solid rgba(255, 255, 255, 0.58);
  box-shadow: var(--te-glass-shadow);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
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
  padding: 18px 18px 18px;
  border-radius: 13px;
  border: 1px solid rgba(255, 255, 255, 0.52);
  background:
    radial-gradient(circle at 42% 2%, rgba(255, 126, 182, 0.025), transparent 36%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.18)),
    rgba(255, 255, 255, 0.16);
  box-shadow:
    0 26px 78px rgba(86, 70, 160, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.64);
  backdrop-filter: blur(30px) saturate(168%);
  -webkit-backdrop-filter: blur(30px) saturate(168%);
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
  background: var(--te-glass-bg);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  width: 100%;
  border-radius: 10px;
}
.track-table thead tr {
  display: flex;
}
.track-table th {
  text-align: left;
  padding: 0 14px 12px;
  font-size: 11px;
  font-weight: 800;
  color: rgba(52, 61, 87, 0.76);
  text-transform: none;
  letter-spacing: 0;
  border-bottom: 0;
}
.track-row td {
  position: relative;
  z-index: 1;
  padding: 0 14px;
  font-size: 13px;
  color: var(--te-neutral-700);
  border-bottom: 0;
  display: flex;
  align-items: center;
}
.track-row {
  --track-pointer-x: 50%;
  --track-pointer-y: 50%;
  position: relative;
  cursor: pointer;
  transition:
    background 0.22s,
    transform 0.24s var(--te-ease-soft),
    box-shadow 0.24s,
    filter 0.24s;
  width: 100%;
  border-radius: 10px;
  margin: 2px 0;
  isolation: isolate;
  transform-origin: center;
  z-index: 0;
}

.track-row::before,
.track-row::after {
  content: '';
  position: absolute;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.24s ease;
}

.track-row::before {
  z-index: -1;
  inset: 0;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.12)),
    linear-gradient(
      90deg,
      rgba(124, 77, 255, 0.03),
      rgba(255, 126, 182, 0.02),
      rgba(34, 211, 238, 0.03)
    );
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
}

.track-row::after {
  z-index: 2;
  inset: 0;
  padding: 1px;
  background: radial-gradient(
    circle 92px at var(--track-pointer-x) var(--track-pointer-y),
    rgba(124, 77, 255, 0.4) 0%,
    rgba(34, 211, 238, 0.3) 34%,
    rgba(255, 126, 182, 0.24) 55%,
    transparent 76%
  );
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask-composite: xor;
}
.virtual-spacer {
  display: flex;
  width: 100%;
  pointer-events: none;
}

.virtual-spacer td {
  flex: 1;
  padding: 0;
  border: 0;
}

.track-row:hover {
  background: transparent;
  transform: translateX(2px) scale(1.012);
  box-shadow: 0 16px 38px rgba(86, 70, 160, 0.08);
  filter: saturate(1.02);
  z-index: 3;
}

.track-row:hover::before,
.track-row:hover::after {
  opacity: 1;
}

.track-row:hover::before {
  background-size: 220% 100%;
  animation: hover-gradient-flow 4s linear infinite;
}

.track-row:hover::after {
  background:
    radial-gradient(
      circle 92px at var(--track-pointer-x) var(--track-pointer-y),
      rgba(124, 77, 255, 0.4) 0%,
      rgba(34, 211, 238, 0.3) 34%,
      rgba(255, 126, 182, 0.24) 55%,
      transparent 76%
    ),
    linear-gradient(
      90deg,
      rgba(124, 77, 255, 0.22),
      rgba(34, 211, 238, 0.16),
      rgba(255, 126, 182, 0.18),
      rgba(124, 77, 255, 0.22)
    );
  background-size:
    100% 100%,
    260% 100%;
  animation:
    pointer-border-pulse 1.7s ease-in-out infinite,
    border-gradient-flow 2.8s linear infinite;
}
.track-row:hover td {
  border-bottom-color: transparent;
}
.song-list.is-switching .track-row,
.song-list.is-switching .track-row::before,
.song-list.is-switching .track-row::after {
  transition: none !important;
  animation: none !important;
}

.song-list.is-switching .track-row:hover {
  transform: none;
  box-shadow: none;
  filter: none;
}

.song-list.is-switching .track-row:hover::before,
.song-list.is-switching .track-row:hover::after {
  opacity: 0;
}

.song-list.is-switching .track-playing::after {
  animation: none !important;
}

.track-playing {
  background: transparent !important;
  box-shadow: 0 20px 48px rgba(124, 77, 255, 0.12);
  transform: translateX(2px) scale(1.026);
  z-index: 4;
}
.track-playing td {
  border-bottom-color: transparent !important;
}

.track-playing::before {
  opacity: 1;
}

.track-playing::after {
  opacity: 1;
  background: linear-gradient(
    90deg,
    rgba(124, 77, 255, 0.88),
    rgba(34, 211, 238, 0.72),
    rgba(255, 126, 182, 0.82),
    rgba(124, 77, 255, 0.88)
  );
  background-size: 260% 100%;
  animation: border-gradient-flow 3.4s linear infinite;
}

.track-playing::before {
  border-color: rgba(124, 77, 255, 0.18);
  background: linear-gradient(rgba(255, 255, 255, 0.38), rgba(255, 255, 255, 0.2)); /* keep-white: decorative overlay */
}

.cover-img {
  width: 34px;
  height: 34px;
  border-radius: 7px;
  object-fit: cover;
  box-shadow: 0 10px 22px rgba(86, 70, 160, 0.14);
}
.cover-placeholder {
  width: 34px;
  height: 34px;
  border-radius: 7px;
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.9), transparent 36%),
    linear-gradient(135deg, rgba(124, 77, 255, 0.18), rgba(34, 211, 238, 0.12));
  display: flex;
  align-items: center;
  justify-content: center;
}
.col-index {
  width: 46px;
  color: rgba(80, 88, 116, 0.62) !important;
  font-size: 13px !important;
  flex-shrink: 0;
}
.col-cover,
.col-cover-header {
  width: 56px;
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
  flex: 1.25;
  line-height: 1.4;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start !important;
}
.track-title-row {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.track-title {
  min-width: 0;
  width: 100%;
  font-family: var(--te-font-rounded);
  font-size: 14px;
  font-weight: 900;
  color: var(--te-neutral-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.track-playing .track-title {
  color: #6f4ee8;
}
.track-artist {
  font-family: var(--te-font-rounded);
  font-size: 12px;
  font-weight: 700;
  color: rgba(71, 80, 112, 0.7);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

/* Context Menu */
.context-menu {
  position: fixed;
  z-index: 1000;
  background: var(--te-glass-bg);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(86, 70, 160, 0.18);
  padding: 6px;
  min-width: 160px;
  border: 1px solid rgba(255, 255, 255, 0.68);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
}
.menu-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  font-size: 13px;
  color: #333;
  border-radius: 10px;
  cursor: pointer;
  position: relative;
  transition:
    background 0.15s,
    color 0.15s,
    transform 0.15s;
}
.menu-item:hover {
  background: rgba(124, 77, 255, 0.1);
  transform: translateX(2px);
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
  background: var(--te-glass-bg-strong);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(86, 70, 160, 0.18);
  padding: 6px;
  min-width: 120px;
  border: 1px solid rgba(255, 255, 255, 0.68);
  margin-left: 2px;
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
}

@keyframes border-gradient-flow {
  to {
    background-position: 260% 0;
  }
}

@keyframes hover-gradient-flow {
  to {
    background-position:
      100% 0,
      260% 0;
  }
}

@keyframes pointer-border-pulse {
  0%,
  100% {
    opacity: 0.72;
    filter: saturate(1.05);
  }
  50% {
    opacity: 1;
    filter: saturate(1.24);
  }
}

/* Search Box */
.search-box {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  background: var(--te-glass-bg);
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow: 0 14px 36px rgba(86, 70, 160, 0.08);
  backdrop-filter: blur(16px) saturate(145%);
  -webkit-backdrop-filter: blur(16px) saturate(145%);
  transition:
    border-color 0.2s,
    background 0.2s,
    box-shadow 0.2s;
  width: clamp(260px, 30vw, 390px);
  flex: 0 1 auto;
}
@media (max-width: 640px) {
  .search-box {
    max-width: none;
    width: 100%;
    order: 2;
  }
  .song-list-header {
    gap: 16px;
    padding: 0 10px;
  }

  .header-right {
    min-width: 0;
    flex-basis: 100%;
  }
}

.search-box.focused {
  border-color: rgba(124, 77, 255, 0.34);
  background: var(--te-glass-bg);
  box-shadow:
    0 0 0 4px rgba(124, 77, 255, 0.08),
    0 16px 42px rgba(86, 70, 160, 0.1);
}

.search-icon {
  font-size: 14px;
  color: #999;
  flex-shrink: 0;
  margin-right: 8px;
  transition: color 0.2s;
}

.search-box.focused .search-icon {
  color: var(--te-primary-500);
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
  background: rgba(124, 77, 255, 0.12);
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
  background: rgba(124, 77, 255, 0.2);
}

/* ── Create Playlist Card ── */
.create-playlist-card {
  border: 2px dashed rgba(255, 255, 255, 0.15);
  transition: border-color 0.2s, transform 0.15s;
}

.create-playlist-card:hover {
  border-color: rgba(124, 77, 255, 0.5);
  transform: translateY(-2px);
}

.create-placeholder {
  background: rgba(255, 255, 255, 0.03); /* keep-white: decorative overlay */
}

/* ── Default Playlist Cover ── */
.default-playlist-cover {
  background: linear-gradient(135deg, rgba(124, 77, 255, 0.15), rgba(214, 51, 108, 0.15));
}

/* ── Playlist Delete Button ── */
.playlist-delete-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s, background 0.2s;
  cursor: pointer;
  z-index: 2;
}

.playlist-card {
  position: relative;
}

.playlist-card:hover .playlist-delete-btn {
  opacity: 1;
}

.playlist-delete-btn:hover {
  background: rgba(220, 50, 50, 0.8);
}

/* ── Create Playlist Menu Item ── */
.create-playlist-menu-item {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  margin-bottom: 2px;
  padding-bottom: 10px;
}

.create-playlist-menu-item:hover {
  background: rgba(124, 77, 255, 0.1);
}

/* ── Create Playlist Dialog ── */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.create-playlist-dialog {
  background: var(--te-glass-bg-strong);
  border-radius: 16px;
  padding: 28px;
  width: 380px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(20px) saturate(150%);
}

.dialog-title {
  margin: 0 0 20px;
  font-size: 18px;
  font-weight: 700;
  color: #333;
}

.dialog-input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.03);
  color: #333;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.dialog-input:focus {
  border-color: rgba(124, 77, 255, 0.5);
  background: var(--te-subtle-bg);
}

.dialog-input::placeholder {
  color: rgba(0, 0, 0, 0.3);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.dialog-btn {
  padding: 8px 22px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, opacity 0.2s;
}

.dialog-btn.cancel {
  background: rgba(0, 0, 0, 0.05);
  color: #666;
}

.dialog-btn.cancel:hover {
  background: rgba(0, 0, 0, 0.1);
}

.dialog-btn.confirm {
  background: linear-gradient(135deg, #7c4dff, #d6336c);
  color: #fff;
}

.dialog-btn.confirm:hover {
  opacity: 0.9;
}

.dialog-btn.confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Dialog Transition ── */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.2s;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-active .create-playlist-dialog {
  transition: transform 0.25s var(--te-ease-soft, ease), opacity 0.2s;
}

.dialog-fade-leave-active .create-playlist-dialog {
  transition: transform 0.2s, opacity 0.15s;
}

.dialog-fade-enter-from .create-playlist-dialog {
  transform: scale(0.92) translateY(10px);
  opacity: 0;
}

.dialog-fade-leave-to .create-playlist-dialog {
  transform: scale(0.95);
  opacity: 0;
}

</style>
