<script setup lang="ts">
import { useNcmStore } from '../stores/useNcmStore'
import { usePlayerStore } from '../stores/usePlayerStore'

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
}>()

const { isLoggedIn, profile } = useNcmStore()
const { currentTrack, dominantColor } = usePlayerStore()

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
      'title-bar-streaming': titleSurface === 'streaming'
    }"
    :style="{ '--accent-color': dominantColor }"
  >
    <div v-if="glass && !streaming" class="title-bar-playing-backdrop" aria-hidden="true">
      <img
        v-if="currentTrack?.cover"
        :key="currentTrack.cover"
        :src="currentTrack.cover"
        class="title-bar-cover-bg"
        alt=""
      />
      <div class="title-bar-cover-scrim" />
    </div>
    <div v-if="!glass || streaming" class="title-bar-start no-drag">
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
      <button
        v-if="streaming"
        class="login-btn"
        :title="isLoggedIn ? profile?.nickname || '个人详情' : '网易云登录'"
        @click="$emit('login')"
      >
        <img
          v-if="isLoggedIn && profile?.avatarUrl"
          :src="profile.avatarUrl"
          class="user-avatar"
          alt=""
        />
        <i v-else class="pi pi-user"></i>
      </button>
    </div>
    <div v-if="glass && !streaming" class="title-bar-start no-drag">
      <button class="back-btn" title="返回" @click="$emit('back')">
        <i class="pi pi-chevron-down"></i>
      </button>
      <button class="settings-btn" title="设置" @click="$emit('settings')">
        <i class="pi pi-cog"></i>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.62), rgba(248, 245, 255, 0.4)),
    rgba(255, 255, 255, 0.46);
  user-select: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.62);
  box-shadow: 0 12px 40px rgba(86, 70, 160, 0.1);
  backdrop-filter: blur(22px) saturate(155%);
  -webkit-backdrop-filter: blur(22px) saturate(155%);
  transition:
    background 0.3s,
    border-color 0.3s,
    box-shadow 0.3s;
}

.title-bar-glass {
  background: transparent;
  border-bottom-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.title-bar.title-bar-settings {
  background: rgba(255, 255, 255, 0.96);
  border-bottom-color: transparent;
  box-shadow: none;
}

.title-bar.title-bar-streaming {
  background: #fafbfe;
  border-bottom-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.title-bar-playing-backdrop {
  display: none;
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: #05070b;
}

.title-bar-cover-bg {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  object-fit: cover;
  object-position: center;
  filter: blur(58px) saturate(1.28) brightness(0.42);
  transform: scale(1.06);
  transform-origin: center;
}

.title-bar-cover-scrim {
  position: fixed;
  inset: 0;
  background:
    linear-gradient(
      180deg,
      rgba(5, 7, 11, 0.34) 0%,
      rgba(5, 7, 11, 0.64) 42%,
      rgba(5, 7, 11, 0.86) 100%
    ),
    color-mix(in srgb, var(--accent-color, #7c4dff) 8%, transparent);
  backdrop-filter: blur(10px);
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

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 100%;
  border: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
  padding: 0;
  flex-shrink: 0;
  font-size: 14px;
}

.back-btn:hover {
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
    color 0.3s;
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
