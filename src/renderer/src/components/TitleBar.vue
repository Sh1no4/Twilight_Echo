<script setup lang="ts">
import { useNcmStore } from '../stores/useNcmStore'

defineProps<{
  menuOpen: boolean
  glass?: boolean
  streaming?: boolean
}>()

defineEmits<{
  toggleMenu: []
  collapseMenu: []
  back: []
  login: []
  settings: []
}>()

const { isLoggedIn, profile } = useNcmStore()

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
  <div class="title-bar drag-region" :class="{ 'title-bar-glass': glass }">
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
    <button
      v-if="menuOpen && !glass"
      class="collapse-btn no-drag"
      title="收起菜单"
      @click="$emit('collapseMenu')"
    >
      <img src="/icons/arrow-left.svg" alt="鏀惰捣" />
    </button>
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
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.2), rgba(17, 24, 39, 0.1)),
    rgba(17, 24, 39, 0.18);
  border-bottom-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 42px rgba(17, 24, 39, 0.16);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
}

.title-bar-start {
  display: flex;
  height: 100%;
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
  background: rgba(255, 255, 255, 0.1);
}

.title-bar-glass .login-btn {
  color: #fff;
}

.title-bar-glass .login-btn:hover {
  background: rgba(255, 255, 255, 0.1);
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
  background: rgba(255, 255, 255, 0.1);
}

.collapse-btn {
  position: fixed;
  left: calc(var(--te-menu-width) - 28px);
  top: 0;
  width: 28px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--te-neutral-700);
  cursor: pointer;
  padding: 0;
  transition: background 0.15s;
}

.collapse-btn:hover {
  background: rgba(124, 77, 255, 0.1);
}

.collapse-btn img {
  width: 16px;
  height: 16px;
  filter: brightness(0.5);
}

.title-bar-controls {
  display: flex;
  height: 100%;
  margin-left: auto;
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
