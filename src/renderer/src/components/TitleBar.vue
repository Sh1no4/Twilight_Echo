<script setup lang="ts">
import { ref } from 'vue'
import { useNcmStore } from '../stores/useNcmStore'
import PuzzleIcon from './icons/PuzzleIcon.vue'

withDefaults(
  defineProps<{
    menuOpen: boolean
    glass?: boolean
    streaming?: boolean
    titleSurface?: 'default' | 'settings' | 'streaming'
  }>(),
  {
    titleSurface: 'default'
  }
)

defineEmits<{
  toggleMenu: []
  collapseMenu: []
  back: []
  login: []
  settings: []
  plugins: []
}>()

const { isLoggedIn, profile } = useNcmStore()
const avatarLoadFailed = ref(false)

function minimize(): void {
  window.api.window.minimize()
}

function toggleMaximize(): void {
  window.api.window.toggleMaximize()
}

function close(): void {
  window.api.window.close()
}
</script>

<template>
  <div
    class="title-bar drag-region"
    :class="{
      'title-bar-glass': glass,
      'title-bar-settings': titleSurface === 'settings',
      'title-bar-streaming': titleSurface === 'streaming',
      'title-bar-menu-open': menuOpen
    }"
  >
    <div class="title-bar-background" aria-hidden="true"></div>
    <div v-if="!glass" class="title-bar-start no-drag">
      <button class="menu-btn" title="菜单" @click="$emit('toggleMenu')">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <button class="settings-btn" title="设置" @click="$emit('settings')">
        <i class="pi pi-cog"></i>
      </button>
      <button class="plugins-btn" title="扩展中心" @click="$emit('plugins')">
        <PuzzleIcon />
      </button>
      <button
        v-if="streaming"
        class="login-btn"
        :title="isLoggedIn ? profile?.nickname || '个人详情' : '网易云登录'"
        @click="$emit('login')"
      >
        <img
          v-if="isLoggedIn && profile?.avatarUrl && !avatarLoadFailed"
          :src="profile.avatarUrl"
          class="user-avatar"
          alt=""
          @error="avatarLoadFailed = true"
        />
        <i v-else class="pi pi-user"></i>
      </button>
    </div>
    <div class="title-bar-controls no-drag">
      <button class="control-btn minimize" title="最小化" @click="minimize">
        <svg width="14" height="14" viewBox="0 0 10 10">
          <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button class="control-btn maximize" title="最大化/还原" @click="toggleMaximize">
        <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
          <rect x="2.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" />
        </svg>
      </button>
      <button class="control-btn close" title="关闭" @click="close">
        <i class="pi pi-times" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  --title-bar-bg-color: var(--te-local-bg);
  --title-bar-bg-image: var(--te-local-bg-image);
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  background: transparent !important;
  user-select: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  overflow: hidden;
  border-bottom: 0;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transition:
    border-color 0.3s,
    box-shadow 0.3s;
}

.title-bar-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0;
  pointer-events: none;
  background-color: var(--title-bar-bg-color);
  background-image: var(--title-bar-bg-image);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}

.title-bar::before {
  display: none;
}

.title-bar-glass {
  --title-bar-bg-color: transparent;
  --title-bar-bg-image: none;
  background: transparent;
  border-bottom-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.title-bar.title-bar-settings {
  --title-bar-bg-color: var(--te-settings-bg);
  --title-bar-bg-image: var(--te-settings-bg-image);
  background: transparent !important;
  border-bottom-color: transparent;
  box-shadow: none;
}

.title-bar.title-bar-settings::before {
  display: none;
}

.title-bar.title-bar-streaming {
  --title-bar-bg-color: var(--te-streaming-bg);
  --title-bar-bg-image: var(--te-streaming-bg-image);
  background: transparent !important;
  border-bottom-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.title-bar.title-bar-menu-open:not(.title-bar-glass):not(.title-bar-settings) {
  background: transparent;
}

.title-bar.title-bar-streaming.title-bar-menu-open:not(.title-bar-glass):not(.title-bar-settings) {
  background: transparent !important;
}

.title-bar.title-bar-menu-open:not(.title-bar-glass):not(.title-bar-settings)::before {
  transform: none;
}

.title-bar.title-bar-glass {
  background: transparent;
  border-bottom-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.title-bar.title-bar-glass::before,
.title-bar.title-bar-settings::before {
  transform: translate3d(-100%, 0, 0);
}

:global(html[data-theme='dark'] .title-bar) {
  background: transparent !important;
}

:global(html[data-theme='dark'] .title-bar.title-bar-streaming),
:global(html[data-theme='dark'] .title-bar.title-bar-streaming.title-bar-menu-open:not(.title-bar-glass):not(.title-bar-settings)) {
  background: transparent !important;
}

:global(html[data-theme='dark'] .title-bar.title-bar-settings),
:global(html[data-theme='dark'] .title-bar.title-bar-glass) {
  background: transparent !important;
}

.title-bar-start {
  display: flex;
  height: 100%;
  position: relative;
  z-index: 1;
}

.menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--te-neutral-900);
  cursor: pointer;
  transition: background 0.15s;
  padding: 0;
  flex-shrink: 0;
}

.menu-btn:hover {
  background: rgba(124, 77, 255, 0.1);
}

.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--te-neutral-900);
  cursor: pointer;
  transition: background 0.15s;
  padding: 0;
  flex-shrink: 0;
  font-size: 14px;
}

.settings-btn:hover {
  background: rgba(124, 77, 255, 0.1);
}

.plugins-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--te-neutral-900);
  cursor: pointer;
  transition: background 0.15s;
  padding: 0;
  flex-shrink: 0;
  font-size: 17px;
}

.plugins-btn:hover {
  background: rgba(124, 77, 255, 0.1);
}

.login-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--te-neutral-900);
  cursor: pointer;
  transition: background 0.15s;
  padding: 0;
  flex-shrink: 0;
  font-size: 14px;
}

.login-btn:hover {
  background: rgba(124, 77, 255, 0.1);
}

.user-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
}

.title-bar-glass .settings-btn {
  color: #fff;
}

.title-bar-glass .settings-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.title-bar-glass .login-btn {
  color: #fff;
}

.title-bar-glass .login-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.title-bar-controls {
  display: flex;
  height: 100%;
  margin-left: auto;
  position: relative;
  z-index: 1;
}

.control-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--te-neutral-900);
  font-size: 16px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.3s,
    transform 0.24s var(--te-ease-soft);
}

.control-btn:active {
  transform: scale(0.88);
  transition-duration: 0.1s;
}

.title-bar-glass .control-btn {
  color: #fff;
}

.title-bar-glass .control-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.title-bar-glass .control-btn.maximize:hover {
  background: rgba(255, 255, 255, 0.1);
}

.control-btn:hover {
  background: rgba(124, 77, 255, 0.1);
}

.control-btn.maximize:hover {
  background: rgba(124, 77, 255, 0.12);
}

.control-btn.close:hover {
  background: #e81123;
  color: #fff;
}
</style>
