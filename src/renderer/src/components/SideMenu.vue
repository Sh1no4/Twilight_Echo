<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayerStore } from '../stores/usePlayerStore'
import ImportDialog from './ImportDialog.vue'

defineProps<{
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
    children: [{ key: 'all', label: '全部' }]
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
  },
  {
    key: 'folders',
    label: '文件夹',
    icon: 'pi pi-folder',
    children: []
  }
]

const activeKey = ref('allSongs')
const scanning = ref(false)
const showImportDialog = ref(false)

const { currentTrack } = usePlayerStore()

const menuBottom = computed(() => (currentTrack.value ? '96px' : '0'))

function selectItem(key: string): void {
  activeKey.value = key
  emit('selectView', key, null)
}

async function handleImportClick(): Promise<void> {
  showImportDialog.value = true
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
          <i
            class="pi pi-cloud"
            style="font-size: 16px; color: #666; width: 20px; text-align: center; flex-shrink: 0"
          ></i>
          <span class="item-label">流媒体</span>
        </div>
        <div class="menu-item menu-item-import" @click="handleImportClick()">
          <i
            class="pi pi-plus"
            style="font-size: 16px; color: #666; width: 20px; text-align: center; flex-shrink: 0"
          ></i>
          <span class="item-label">导入歌曲</span>
        </div>
        <span v-if="scanning" class="scanning-text">正在扫描...</span>
      </div>
    </nav>
    <ImportDialog :show="showImportDialog" @close="showImportDialog = false" />
  </div>
</template>

<style scoped>
.side-menu {
  position: fixed;
  top: 32px;
  left: 0;
  bottom: 0;
  width: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(248, 245, 255, 0.54)),
    rgba(255, 255, 255, 0.58);
  border-right: 1px solid rgba(255, 255, 255, 0.64);
  z-index: 1000;
  overflow: hidden;
  box-shadow: 22px 0 70px rgba(86, 70, 160, 0.12);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
  transition:
    width 0.32s var(--te-ease-soft),
    box-shadow 0.32s;
}

.side-menu.open {
  width: var(--te-menu-width);
  min-width: 132px;
  max-width: 216px;
}

.menu-items {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 10px 6px 10px 4px;
  width: var(--te-menu-width);
  min-width: 132px;
  max-width: 216px;
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
  height: 38px;
  padding: 0 10px;
  cursor: pointer;
  border-radius: 12px;
  transition:
    background 0.18s,
    transform 0.18s var(--te-ease-soft),
    box-shadow 0.18s;
  white-space: nowrap;
  gap: 10px;
}

.menu-item:hover {
  background: rgba(124, 77, 255, 0.09);
  transform: translateX(2px);
}

.menu-item.active {
  background:
    linear-gradient(90deg, rgba(124, 77, 255, 0.17), rgba(255, 126, 182, 0.08)),
    rgba(255, 255, 255, 0.42);
  box-shadow:
    inset 3px 0 0 rgba(124, 77, 255, 0.78),
    0 12px 30px rgba(124, 77, 255, 0.1);
}

.menu-item.active .item-icon {
  color: var(--te-primary-500);
}

.item-icon {
  font-size: 16px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--te-neutral-700);
  transition: color 0.15s;
}

.item-label {
  font-size: 13px;
  color: var(--te-neutral-900);
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
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid rgba(255, 255, 255, 0.64);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(86, 70, 160, 0.18);
  z-index: 1001;
  padding: 4px 0;
  overflow: hidden;
  max-height: 320px;
  overflow-y: auto;
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
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
  background: rgba(124, 77, 255, 0.1);
}

.context-item.active {
  color: var(--te-primary-500);
  background: rgba(124, 77, 255, 0.12);
  font-weight: 500;
}

.menu-separator {
  height: 1px;
  background: rgba(209, 213, 219, 0.5);
  margin: 8px 12px;
}

.menu-item-streaming {
  color: var(--te-primary-500);
}

.menu-item-streaming:hover {
  background: rgba(124, 77, 255, 0.1);
}

.menu-item-import {
  color: var(--te-primary-500);
}

.menu-item-import:hover {
  background: rgba(124, 77, 255, 0.1);
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
  border-top-color: var(--te-primary-500);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
