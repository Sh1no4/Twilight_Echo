<script setup lang="ts">
import { ref } from 'vue'
import ImportDialog from './ImportDialog.vue'
import type { UiContribution } from '../extensions/registry'

const props = defineProps<{
  open: boolean
  pluginPages?: UiContribution[]
}>()

const emit = defineEmits<{
  selectView: [category: string, filter: string | null]
  selectPluginPage: [page: UiContribution]
  enterStreaming: []
}>()


interface MenuItem {
  key: string
  label: string
  icon: string
}

const menuItems: MenuItem[] = [
  { key: 'dashboard', label: '首页', icon: 'pi pi-home' },
  { key: 'allSongs', label: '所有歌曲', icon: 'pi pi-headphones' },
  { key: 'artists', label: '艺术家', icon: 'pi pi-microphone' },
  { key: 'albums', label: '专辑', icon: 'pi pi-clone' },
  { key: 'playlists', label: '歌单', icon: 'pi pi-list-check' },
  { key: 'folders', label: '文件夹', icon: 'pi pi-folder-open' }
]

const activeKey = ref('dashboard')
const scanning = ref(false)
const showImportDialog = ref(false)

// removed menuStyle

function selectItem(key: string): void {
  activeKey.value = key
  emit('selectView', key, null)
}

function selectPluginPage(page: UiContribution): void {
  activeKey.value = `plugin:${page.pluginId}:${page.id}`
  emit('selectPluginPage', page)
}

function handleImportClick(): void {
  showImportDialog.value = true
}
</script>

<template>
  <div class="side-menu" :class="{ open }">
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
        <div
          v-for="page in props.pluginPages ?? []"
          :key="`${page.pluginId}:${page.id}`"
          class="menu-item menu-item-plugin"
          :class="{ active: activeKey === `plugin:${page.pluginId}:${page.id}` }"
          @click="selectPluginPage(page)"
        >
          <i class="item-icon" :class="page.icon || 'pi pi-box'"></i>
          <span class="item-label">{{ page.title }}</span>
        </div>
        <div v-if="(props.pluginPages?.length ?? 0) > 0" class="menu-separator"></div>
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
  background: #ffffff;
  border-right: 1px solid rgba(17, 24, 39, 0.06);
  z-index: 1000;
  overflow: hidden;
  box-shadow: 8px 0 24px rgba(15, 23, 42, 0.04);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transform: translate3d(-100%, 0, 0);
  transform-origin: left center;
  will-change: transform;
  transition:
    transform 0.32s var(--te-ease-soft),
    box-shadow 0.32s;
}

.side-menu.open {
  transform: translate3d(0, 0, 0);
}

.side-menu .menu-items {
  transform: translate3d(-8px, 0, 0);
  opacity: 0;
  transform-origin: left center;
  transition:
    transform 0.28s var(--te-ease-soft),
    opacity 0.2s ease;
}

.side-menu.open .menu-items {
  transform: translate3d(0, 0, 0);
  opacity: 1;
}

.menu-items {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-width: 132px;
  max-width: 216px;
  padding: 14px 9px 14px 1px;
}

.menu-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.menu-bottom {
  flex-shrink: 0;
  margin-top: auto;
}

.menu-item {
  position: relative;
  display: flex;
  align-items: center;
  height: 42px;
  padding: 0 12px 0 18px;
  cursor: pointer;
  border-radius: 11px;
  gap: 12px;
  white-space: nowrap;
  color: #111827;
  transition:
    background 0.18s,
    color 0.18s;
}

.menu-item:hover {
  background: #f3f4f6;
}

.menu-item.active {
  background: #e8e8e8;
  color: #0f172a;
  box-shadow: none;
}

.menu-item.active::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 10px;
  bottom: 10px;
  width: 4px;
  border-radius: 0 999px 999px 0;
  background: #020617;
}

.item-icon {
  width: 17px;
  height: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #4b5563;
  font-size: 16px;
  transition: color 0.15s;
}

.menu-item.active .item-icon,
.menu-item-streaming .item-icon,
.menu-item-import .item-icon {
  color: #111827;
}

.item-label {
  font-size: 14px;
  font-weight: 700;
  color: currentColor;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.open .item-label {
  opacity: 1;
}

.menu-separator {
  height: 1px;
  margin: 10px 10px 8px 14px;
  background: #e5e7eb;
}

.menu-item-streaming,
.menu-item-import {
  color: #111827;
}

.menu-item-streaming:hover,
.menu-item-import:hover {
  background: #f3f4f6;
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
