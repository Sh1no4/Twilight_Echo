<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMusicStore } from '../stores/useMusicStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import type { Track } from '../types/music'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  selectView: [category: string, filter: string | null]
  enterStreaming: []
}>()

interface SubItem {
  key: string
  label: string
}

interface MenuItem {
  key: string
  label: string
  icon: string
  children: SubItem[]
}

const menuItems: MenuItem[] = [
  {
    key: 'allSongs',
    label: '所有歌曲',
    icon: 'pi pi-wave-pulse',
    children: [
      { key: 'all', label: '全部' }
    ]
  },
  {
    key: 'artists',
    label: '艺术家',
    icon: 'pi pi-user',
    children: []
  },
  {
    key: 'albums',
    label: '专辑',
    icon: 'pi pi-images',
    children: []
  },
  {
    key: 'playlists',
    label: '歌单',
    icon: 'pi pi-bookmark',
    children: []
  }
]

const activeKey = ref('allSongs')
const activeChildKey = ref('all')
const scanning = ref(false)

const { addTracks, artists, albums, playlists } = useMusicStore()
const { currentTrack } = usePlayerStore()

const menuBottom = computed(() => currentTrack.value ? '72px' : '0')

function buildArtistChildren(): SubItem[] {
  return artists.value.map((a) => ({ key: `artist:${a.name}`, label: `${a.name} (${a.trackCount})` }))
}

function buildAlbumChildren(): SubItem[] {
  return albums.value.map((a) => ({ key: `album:${a.name}`, label: `${a.name} (${a.trackCount})` }))
}

function buildPlaylistChildren(): SubItem[] {
  const items: SubItem[] = playlists.value.map((p) => ({ key: `playlist:${p.name}`, label: p.name }))
  items.push({ key: 'addFolder', label: '添加文件夹' })
  return items
}

function selectItem(key: string): void {
  activeKey.value = key
  const children =
    key === 'artists' ? buildArtistChildren() :
    key === 'albums' ? buildAlbumChildren() :
    key === 'playlists' ? buildPlaylistChildren() :
    menuItems.find((m) => m.key === key)?.children ?? []

  if (children.length > 0) {
    activeChildKey.value = children[0].key
  }

  emit('selectView', key, null)
}

async function addFolder(): Promise<void> {
  if (scanning.value) return
  scanning.value = true
  try {
    const folderPath = await window.api.dialog.openFolder()
    if (!folderPath) return
    const files: Track[] = await window.api.fs.scanMusicFiles(folderPath)
    if (files.length > 0) {
      await addTracks(files)
    }
  } finally {
    scanning.value = false
  }
}

async function handleImportClick(): Promise<void> {
  await addFolder()
}
</script>

<template>
  <div class="side-menu" :class="{ open }" :style="{ bottom: menuBottom }">
    <nav class="menu-items">
      <div class="menu-nav">
        <div
          v-for="item in menuItems"
          :key="item.key"
          class="menu-item"
          :class="{ active: activeKey === item.key }"
          @click="selectItem(item.key)"
        >
          <i class="item-icon" :class="item.icon"></i>
          <span class="item-label">{{ item.label }}</span>
        </div>
      </div>
      <div class="menu-bottom">
        <div class="menu-separator"></div>
        <div class="menu-item menu-item-streaming" @click="emit('enterStreaming')">
          <i class="pi pi-cloud" style="font-size: 16px; color: #666; width: 20px; text-align: center; flex-shrink: 0"></i>
          <span class="item-label">流媒体</span>
        </div>
        <div class="menu-item menu-item-import" @click="handleImportClick()">
          <i class="pi pi-plus" style="font-size: 16px; color: #666; width: 20px; text-align: center; flex-shrink: 0"></i>
          <span class="item-label">导入歌曲</span>
        </div>
        <span v-if="scanning" class="scanning-text">正在扫描...</span>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.side-menu {
  position: fixed;
  top: 32px;
  left: 0;
  bottom: 0;
  width: 0;
  background: #fff;
  border-right: 1px solid #e8e8e8;
  z-index: 1000;
  overflow: hidden;
  transition: width 0.25s ease;
}

.side-menu.open {
  width: 25vw;
  min-width: 150px;
  max-width: 270px;
}

.menu-items {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px 8px;
  width: 25vw;
  min-width: 150px;
  max-width: 270px;
}

.menu-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.menu-bottom {
  flex-shrink: 0;
}

.menu-item {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 12px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s;
  white-space: nowrap;
  gap: 12px;
}

.menu-item:hover {
  background: #f0f0f0;
}

.menu-item.active {
  background: #e8f0fe;
}

.menu-item.active .item-icon {
  color: #1a73e8;
}

.item-icon {
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

.item-label {
  font-size: 14px;
  color: #333;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.open .item-label {
  opacity: 1;
}

.context-menu {
  position: fixed;
  top: 40px;
  left: 0;
  min-width: 150px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 1001;
  padding: 4px 0;
  overflow: hidden;
  max-height: 320px;
  overflow-y: auto;
}

.context-item {
  padding: 8px 16px;
  font-size: 13px;
  color: #333;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.context-item:hover {
  background: #f0f0f0;
}

.context-item.active {
  color: #1a73e8;
  background: #e8f0fe;
  font-weight: 500;
}

.menu-separator {
  height: 1px;
  background: #e8e8e8;
  margin: 8px 12px;
}

.menu-item-streaming {
  color: #1a73e8;
}

.menu-item-streaming:hover {
  background: #e8f0fe;
}

.menu-item-import {
  color: #1a73e8;
}

.menu-item-import:hover {
  background: #e8f0fe;
}

.scanning-text {
  font-size: 12px;
  color: #999;
  padding: 4px 12px;
}

.scanning-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid #ccc;
  border-top-color: #1a73e8;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>