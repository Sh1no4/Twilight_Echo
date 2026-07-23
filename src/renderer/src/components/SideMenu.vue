<script setup lang="ts">
import { ref } from 'vue'
import ImportDialog from './ImportDialog.vue'
import PuzzleIcon from './icons/PuzzleIcon.vue'
import type { UiContribution } from '../extensions/registry'

const props = defineProps<{
  open: boolean
  activeKey: string
  pluginPages?: UiContribution[]
  localItems?: UiContribution[]
}>()

const emit = defineEmits<{
  selectView: [category: string, filter: string | null]
  selectPluginPage: [page: UiContribution]
  enterStreaming: []
  enterRadioPodcast: []
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
  { key: 'genres', label: '流派', icon: 'pi pi-tags' },
  { key: 'playlists', label: '歌单', icon: 'pi pi-list-check' },
  { key: 'folders', label: '文件夹', icon: 'pi pi-folder-open' },
  { key: 'recent', label: '最近播放', icon: 'pi pi-history' }
]

const scanning = ref(false)
const showImportDialog = ref(false)

// removed menuStyle

function selectItem(key: string): void {
  emit('selectView', key, null)
}

function selectPluginPage(page: UiContribution): void {
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
          :class="{ active: props.activeKey === item.key }"
          @click="selectItem(item.key)"
        >
          <i class="item-icon" :class="item.icon"></i>
          <span class="item-label">{{ item.label }}</span>
        </div>
      </div>
      <div class="menu-bottom">
        <div v-if="(props.localItems?.length ?? 0) > 0" class="menu-separator"></div>
        <div
          v-for="item in props.localItems ?? []"
          :key="`local:${item.pluginId}:${item.id}`"
          class="menu-item menu-item-plugin"
          :class="{ active: props.activeKey === `plugin:${item.pluginId}:${item.id}` }"
          @click="selectPluginPage(item)"
        >
          <i v-if="item.icon" class="item-icon" :class="item.icon"></i>
          <PuzzleIcon v-else class="item-icon" />
          <span class="item-label">{{ item.title }}</span>
        </div>
        <div class="menu-separator"></div>
        <div
          v-for="page in props.pluginPages ?? []"
          :key="`${page.pluginId}:${page.id}`"
          class="menu-item menu-item-plugin"
          :class="{ active: props.activeKey === `plugin:${page.pluginId}:${page.id}` }"
          @click="selectPluginPage(page)"
        >
          <i v-if="page.icon" class="item-icon" :class="page.icon"></i>
          <PuzzleIcon v-else class="item-icon" />
          <span class="item-label">{{ page.title }}</span>
        </div>
        <div v-if="(props.pluginPages?.length ?? 0) > 0" class="menu-separator"></div>
        <div class="menu-item menu-item-streaming" @click="emit('enterStreaming')">
          <i class="item-icon pi pi-globe"></i>
          <span class="item-label">流媒体</span>
        </div>
        <div class="menu-item menu-item-radio" @click="emit('enterRadioPodcast')">
          <i class="item-icon pi pi-wifi"></i>
          <span class="item-label">电台 / 播客</span>
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
  background: color-mix(in srgb, var(--te-navigation-bg) var(--te-surface-opacity), transparent);
  border-right: 1px solid var(--te-navigation-border);
  z-index: 1000;
  overflow: hidden;
  box-shadow: var(--te-navigation-shadow);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  transform: translate3d(-100%, 0, 0);
  transform-origin: left center;
  will-change: transform;
  transition:
    transform 0.32s var(--te-ease-soft),
    box-shadow 0.32s var(--te-ease-soft);
  font-family: var(--te-font-sans);
}

.side-menu.open {
  transform: translate3d(0, 0, 0);
}

:global(html[data-theme='dark'] .side-menu) {
  border-right-color: var(--te-navigation-border);
  background-color: color-mix(
    in srgb,
    var(--te-navigation-bg) var(--te-surface-opacity),
    transparent
  );
  background-image: var(--te-local-bg-image);
  background-position: left center;
  background-size: cover;
  background-repeat: no-repeat;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
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
  padding: 16px 12px 16px 4px;
}

.menu-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.menu-bottom {
  flex-shrink: 0;
  margin-top: auto;
  padding-top: 8px;
}

.menu-item {
  position: relative;
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 12px 0 16px;
  margin-left: 8px;
  cursor: pointer;
  border-radius: var(--te-radius-global);
  gap: 14px;
  white-space: nowrap;
  color: var(--te-chrome-text, var(--te-navigation-text));
  transition:
    background 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.menu-item:hover {
  background: var(--te-navigation-hover);
  color: var(--te-navigation-hover-text);
  transform: translateX(3px);
}

.menu-item.active {
  background: var(--te-navigation-active);
  color: var(--te-navigation-active-text);
  font-weight: 600;
}

.menu-item.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 10px;
  bottom: 10px;
  width: 4px;
  border-radius: 0 4px 4px 0;
  background: var(--te-navigation-indicator);
  opacity: 0.8;
  box-shadow: 0 0 8px color-mix(in srgb, var(--te-navigation-indicator) 50%, transparent);
}

.item-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--te-navigation-icon);
  font-size: 16px;
  transition:
    color 0.2s,
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.menu-item:hover .item-icon {
  transform: scale(1.1);
  color: var(--te-navigation-hover-text);
}

.menu-item.active .item-icon,
.menu-item-streaming .item-icon,
.menu-item-import .item-icon {
  color: inherit;
}

.item-label {
  font-size: 14px;
  font-weight: 500;
  color: currentColor;
  opacity: 0;
  letter-spacing: 0.3px;
  transition: opacity 0.2s ease;
}

.open .item-label {
  opacity: 1;
}

.menu-separator {
  height: 1px;
  margin: 12px 10px 12px 16px;
  background: linear-gradient(to right, var(--te-navigation-border), transparent);
}

.menu-item-streaming,
.menu-item-import {
  color: var(--te-chrome-text, var(--te-navigation-text));
}

.menu-item-streaming:hover,
.menu-item-import:hover {
  background: var(--te-navigation-hover);
}

.scanning-text {
  display: block;
  padding: 8px 16px;
  color: var(--te-navigation-icon);
  font-size: 12px;
  font-weight: 500;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.scanning-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--te-navigation-border);
  border-top-color: var(--te-primary-500);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
</style>
