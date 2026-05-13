<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import TitleBar from './components/TitleBar.vue'
import SideMenu from './components/SideMenu.vue'
import SongList from './components/SongList.vue'
import PlayerBar from './components/PlayerBar.vue'
import PlayingMusic from './components/PlayingMusic.vue'
import StreamingPage from './components/StreamingPage.vue'
import LoginPage from './components/LoginPage.vue'
import SettingsPage from './components/SettingsPage.vue'
import { useMusicStore } from './stores/useMusicStore'
import { useNcmStore } from './stores/useNcmStore'
import { usePlayerStore } from './stores/usePlayerStore'

const menuOpen = ref(false)
const showPlayingPage = ref(false)
const showStreamingPage = ref(false)
const showLoginPage = ref(false)
const loginPageMode = ref<'login' | 'profile'>('login')
const showSettingsPage = ref(false)

const activeCategory = ref('allSongs')
const activeFilter = ref<string | null>(null)
const songlistTransitionName = ref('page-down')

const coverOrigin = ref({ x: 48, y: window.innerHeight - 36, w: 48, h: 48 })

const streamingMenuOpen = ref(false)
const titleMenuOpen = computed(() =>
  showStreamingPage.value ? streamingMenuOpen.value : menuOpen.value
)

function toggleMenu(): void {
  if (showLoginPage.value) return
  if (showStreamingPage.value) {
    toggleStreamingMenu()
    return
  }
  menuOpen.value = !menuOpen.value
}

function toggleStreamingMenu(): void {
  streamingMenuOpen.value = !streamingMenuOpen.value
}

function collapseMenu(): void {
  if (showStreamingPage.value) {
    streamingMenuOpen.value = false
    return
  }
  menuOpen.value = false
}

function getDepth(filter: string | null): number {
  if (filter) return 1
  return 0
}

function onSelectView(category: string, filter: string | null): void {
  const oldDepth = getDepth(activeFilter.value)
  const newDepth = getDepth(filter)
  songlistTransitionName.value = newDepth >= oldDepth ? 'page-down' : 'page-up'
  activeCategory.value = category
  activeFilter.value = filter
}

function openPlayingPage(rect: { x: number; y: number; w: number; h: number }): void {
  coverOrigin.value = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, w: rect.w, h: rect.h }
  songlistTransitionName.value = 'page-down'
  showPlayingPage.value = true
}

function closePlayingPage(): void {
  songlistTransitionName.value = 'page-up'
  showPlayingPage.value = false
}

function handleCoverClick(rect: { x: number; y: number; w: number; h: number }): void {
  if (showPlayingPage.value) {
    closePlayingPage()
  } else {
    openPlayingPage(rect)
  }
}

function enterStreamingMode(): void {
  menuOpen.value = false
  showPlayingPage.value = false
  showSettingsPage.value = false
  showStreamingPage.value = true
}

async function openLoginPage(): Promise<void> {
  // 检查是否已登录
  const { isLoggedIn } = useNcmStore()
  if (isLoggedIn.value) {
    // 已登录则打开个人详情页
    menuOpen.value = false
    showPlayingPage.value = false
    showStreamingPage.value = false
    showSettingsPage.value = false
    loginPageMode.value = 'profile'
    showLoginPage.value = true
    return
  }

  // 未登录则走登录流程，但先二次验证 cookie 状态
  try {
    const cookie = await window.api.data.loadCookie()
    if (cookie) {
      const data = (await window.api.ncm.request(
        `/login/status?timestamp=${Date.now()}`,
        cookie
      )) as Record<string, any>
      const profileData = data.data?.profile || data.profile
      if ((data.data?.code === 200 || data.code === 200) && profileData) {
        enterStreamingMode()
        return
      }
    }
  } catch {
    /* 检查失败则继续显示登录页 */
  }

  menuOpen.value = false
  showPlayingPage.value = false
  showStreamingPage.value = false
  showSettingsPage.value = false
  loginPageMode.value = 'login'
  showLoginPage.value = true
}

function closeLoginPage(): void {
  showLoginPage.value = false
  showStreamingPage.value = true
}

function openSettingsPage(): void {
  showSettingsPage.value = true
}

function closeSettingsPage(): void {
  showSettingsPage.value = false
}

const { loadLibrary } = useMusicStore()
const { checkLogin } = useNcmStore()
const { currentTrack } = usePlayerStore()
const hasPlayerBar = computed(() => !showLoginPage.value && !!currentTrack.value)
const mainContentMinHeight = computed(() =>
  hasPlayerBar.value ? 'calc(100vh - 32px - 96px)' : 'calc(100vh - 32px)'
)

onMounted(() => {
  loadLibrary()
  checkLogin()
})

const coverTransformOrigin = computed(() => `${coverOrigin.value.x}px ${coverOrigin.value.y}px`)
</script>

<template>
  <TitleBar
    :glass="showPlayingPage"
    :streaming="showStreamingPage"
    :menu-open="titleMenuOpen"
    @toggle-menu="toggleMenu"
    @collapse-menu="collapseMenu"
    @back="closePlayingPage"
    @login="openLoginPage"
    @settings="openSettingsPage"
  />
  <SideMenu
    v-if="!showPlayingPage && !showStreamingPage && !showLoginPage && !showSettingsPage"
    :open="menuOpen"
    @select-view="onSelectView"
    @enter-streaming="enterStreamingMode"
  />
  <div
    class="main-content"
    :class="{ 'menu-open': menuOpen && !showPlayingPage && !showStreamingPage && !showLoginPage }"
    :style="{ minHeight: mainContentMinHeight }"
  >
    <Transition :name="songlistTransitionName">
      <SongList
        v-if="!showPlayingPage && !showStreamingPage && !showLoginPage"
        :key="'songlist-' + activeCategory + (activeFilter ?? '')"
        :category="activeCategory"
        :filter="activeFilter"
        :has-player="hasPlayerBar"
        @select-view="onSelectView"
      />
    </Transition>
    <Transition name="playing-page">
      <PlayingMusic
        v-if="showPlayingPage"
        :style="{ transformOrigin: coverTransformOrigin }"
        @back="closePlayingPage"
      />
    </Transition>
    <StreamingPage
      v-if="showStreamingPage"
      :menu-open="streamingMenuOpen"
      :has-player="hasPlayerBar"
      @toggle-menu="toggleStreamingMenu"
      @back-to-local="showStreamingPage = false"
    />
    <Transition name="login-page">
      <LoginPage
        v-if="showLoginPage"
        :force-profile="loginPageMode === 'profile'"
        @back="closeLoginPage"
        @login-success="closeLoginPage"
      />
    </Transition>
    <Transition name="login-page">
      <SettingsPage v-if="showSettingsPage" @back="closeSettingsPage" />
    </Transition>
  </div>
  <PlayerBar v-if="hasPlayerBar" :glass="showPlayingPage" @click-cover="handleCoverClick" />
</template>

<style>
body {
  background: transparent;
}

.main-content {
  display: grid;
  margin-left: 0;
  min-height: calc(100vh - 32px - 96px);
  transition: margin-left 0.32s var(--te-ease-soft);
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.main-content::before,
.main-content::after {
  content: '';
  position: fixed;
  pointer-events: none;
  z-index: -1;
  border-radius: 999px;
  filter: blur(2px);
}

.main-content::before {
  width: 42vw;
  height: 42vw;
  min-width: 360px;
  min-height: 360px;
  right: -12vw;
  top: 5vh;
  background:
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.96), transparent 28%),
    radial-gradient(circle at 46% 48%, rgba(124, 77, 255, 0.055), transparent 62%),
    radial-gradient(circle at 66% 62%, rgba(255, 126, 182, 0.045), transparent 70%);
  opacity: 0.56;
  animation: light-orbit 12s var(--te-ease-soft) infinite alternate;
}

.main-content::after {
  width: 34vw;
  height: 26vw;
  min-width: 300px;
  min-height: 220px;
  left: 10vw;
  bottom: 6vh;
  background:
    radial-gradient(circle at 40% 45%, rgba(34, 211, 238, 0.05), transparent 62%),
    radial-gradient(circle at 72% 48%, rgba(168, 133, 247, 0.055), transparent 68%);
  opacity: 0.5;
  animation: light-float 16s var(--te-ease-soft) infinite alternate;
}

.main-content > * {
  grid-area: 1 / 1;
}

.main-content.menu-open {
  margin-left: var(--te-menu-width);
}

@keyframes light-orbit {
  from {
    transform: translate3d(0, 0, 0) rotate(0deg);
  }
  to {
    transform: translate3d(-26px, 18px, 0) rotate(8deg);
  }
}

@keyframes light-float {
  from {
    transform: translate3d(-16px, 10px, 0) scale(1);
  }
  to {
    transform: translate3d(20px, -10px, 0) scale(1.05);
  }
}

/* SongList internal view transitions (grid ↔ table) */
.page-down-enter-active,
.page-down-leave-active,
.page-up-enter-active,
.page-up-leave-active {
  transition:
    transform 0.36s var(--te-ease-enter),
    opacity 0.28s ease;
}
.page-down-enter-active,
.page-up-enter-active {
  z-index: 1;
}
.page-down-leave-active,
.page-up-leave-active {
  z-index: 0;
}

/* page-down: navigating deeper — old slides UP, new slides UP from BELOW */
.page-down-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
.page-down-enter-from {
  transform: translateY(100%);
  opacity: 0;
}

/* page-up: navigating back — old slides DOWN, new slides DOWN from ABOVE */
.page-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
.page-up-enter-from {
  transform: translateY(-100%);
  opacity: 0;
}

/* PlayingMusic open/close — expands from / shrinks to cover position */
.playing-page-enter-active {
  transition:
    transform 0.5s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.35s ease,
    border-radius 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
.playing-page-leave-active {
  transition:
    transform 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.3s ease,
    border-radius 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.playing-page-enter-from {
  transform: scale(0) !important;
  border-radius: 50%;
  opacity: 0;
}

.playing-page-leave-to {
  transform: scale(0) !important;
  border-radius: 50%;
  opacity: 0;
}

/* Login page transition */
.login-page-enter-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.login-page-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.login-page-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.login-page-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
