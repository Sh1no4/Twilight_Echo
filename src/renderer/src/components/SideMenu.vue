<script setup lang="ts">
import { computed, ref } from 'vue'
import ImportDialog from './ImportDialog.vue'

const props = withDefaults(defineProps<{
  open: boolean
  bottomOffset?: number
}>(), {
  bottomOffset: 0
})

const emit = defineEmits<{
  selectView: [category: string, filter: string | null]
  enterStreaming: []
}>()

interface MenuItem {
  key: string
  label: string
  icon: string
}

const menuItems: MenuItem[] = [
  { key: 'allSongs', label: '所有歌曲', icon: 'pi pi-music' },
  { key: 'artists', label: '艺术家', icon: 'pi pi-microphone' },
  { key: 'albums', label: '专辑', icon: 'pi pi-clone' },
  { key: 'playlists', label: '歌单', icon: 'pi pi-list-check' },
  { key: 'folders', label: '文件夹', icon: 'pi pi-folder-open' }
]

const activeKey = ref('allSongs')
const scanning = ref(false)
const showImportDialog = ref(false)

const menuStyle = computed(() => ({
  '--menu-bottom-offset': `${Math.max(0, props.bottomOffset)}px`
}))

function selectItem(key: string): void {
  activeKey.value = key
  emit('selectView', key, null)
}

function handleImportClick(): void {
  showImportDialog.value = true
}
</script>

<template>
  <div class="side-menu" :class="{ open }" :style="menuStyle">
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
          <i class="item-icon pi pi-globe"></i>
          <span class="item-label">流媒体</span>
        </div>
        <div class="menu-item menu-item-import" @click="handleImportClick()">
          <i class="item-icon pi pi-plus"></i>
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
  width: var(--te-menu-width);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(248, 245, 255, 0.54)),
    rgba(255, 255, 255, 0.58);
  border-right: 1px solid rgba(255, 255, 255, 0.64);
  z-index: 1000;
  overflow: hidden;
  box-shadow: 22px 0 70px rgba(86, 70, 160, 0.12);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
  transform: translate3d(-100%, 0, 0);
  will-change: transform;
  transition:
    transform 0.32s var(--te-ease-soft),
    box-shadow 0.32s;
}

.side-menu.open {
  transform: translate3d(0, 0, 0);
}

.menu-items {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-width: 132px;
  max-width: 216px;
  padding: 10px 6px calc(10px + var(--menu-bottom-offset, 0px)) 4px;
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
  gap: 10px;
  white-space: nowrap;
  transition:
    background 0.18s,
    transform 0.18s var(--te-ease-soft),
    box-shadow 0.18s;
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

.item-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--te-neutral-700);
  font-size: 16px;
  transition: color 0.15s;
}

.menu-item.active .item-icon,
.menu-item-streaming .item-icon,
.menu-item-import .item-icon {
  color: var(--te-primary-500);
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

.menu-separator {
  height: 1px;
  margin: 8px 12px;
  background: rgba(209, 213, 219, 0.5);
}

.menu-item-streaming,
.menu-item-import {
  color: var(--te-primary-500);
}

.menu-item-streaming:hover,
.menu-item-import:hover {
  background: rgba(124, 77, 255, 0.1);
}

.scanning-text {
  display: block;
  padding: 4px 12px;
  color: #999;
  font-size: 12px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.scanning-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid #ccc;
  border-top-color: var(--te-primary-500);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
</style>
