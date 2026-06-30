<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch, defineAsyncComponent } from 'vue'
import TitleBar from './components/TitleBar.vue'
import SideMenu from './components/SideMenu.vue'
import SongList from './components/SongList.vue'
import LocalDashboard from './components/LocalDashboard.vue'
import PlayerBar from './components/PlayerBar.vue'
import PlayingMusic from './components/PlayingMusic.vue'
import StreamingPage from './components/StreamingPage.vue'
const LoginPage = defineAsyncComponent(() => import('./components/LoginPage.vue'))
const SettingsPage = defineAsyncComponent(() => import('./components/SettingsPage.vue'))
const PluginPage = defineAsyncComponent(() => import('./components/PluginPage.vue'))
const EqualizerPage = defineAsyncComponent(() => import('./components/EqualizerPage.vue'))
const PluginExtensionPage = defineAsyncComponent(() => import('./components/PluginExtensionPage.vue'))
import { useMusicStore } from './stores/useMusicStore'
import { useNcmStore } from './stores/useNcmStore'
import { setupListeningStatsTracking } from './stores/useListeningStatsStore'
import { usePlayerStore } from './stores/usePlayerStore'
import { useSettingsStore } from './stores/useSettingsStore'
import { setupPluginThemeRuntime } from './extensions/themeRuntime'
import { useExtensionRegistry, type UiContribution } from './extensions/registry'
import { syncPluginProviders } from './providers'
import type { PlaybackSession } from './types/music'
import type { PlaybackResumeMode } from './types/settings'

const menuOpen = ref(false)
const showPlayingPage = ref(false)
const showStreamingPage = ref(false)
const showLoginPage = ref(false)
const loginPageMode = ref<'login' | 'profile'>('login')
const showSettingsPage = ref(false)
const showPluginPage = ref(false)
const showEqualizerPage = ref(false)
const activePluginPage = ref<UiContribution | null>(null)
type SettingsSection =
  | 'general'
  | 'playback'
  | 'dsp'
  | 'cache'
  | 'performance'
  | 'appearance'
  | 'shortcuts'
  | 'about'
type TitleSurface = 'default' | 'settings' | 'streaming'
const settingsInitialSection = ref<SettingsSection>('general')

const activeCategory = ref('dashboard')
const activeFilter = ref<string | null>(null)
const songlistTransitionName = ref<'page-down' | 'page-up'>('page-down')
const songlistOrder = ['dashboard', 'allSongs', 'artists', 'albums', 'playlists', 'folders'] as const

const coverOrigin = ref({ x: 48, y: window.innerHeight - 36, w: 48, h: 48 })

const streamingMenuOpen = ref(false)
const localMenuOpenBeforeStreaming = ref(false)
const titleMenuOpen = computed(() =>
  showPluginPage.value ? false : showStreamingPage.value ? streamingMenuOpen.value : menuOpen.value
)
const showStreamingSurface = computed(
  () =>
    showStreamingPage.value &&
    !showPlayingPage.value &&
    !showLoginPage.value &&
    !showSettingsPage.value &&
    !showEqualizerPage.value &&
    !showPluginPage.value &&
    !activePluginPage.value
)

function toggleMenu(): void {
  if (showLoginPage.value) return
  if (showSettingsPage.value) {
    closeSettingsPage()
    return
  }
  if (showPluginPage.value) return
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

function onSelectView(category: string, filter: string | null): void {
  const currentIndex = songlistOrder.indexOf(activeCategory.value as (typeof songlistOrder)[number])
  const nextIndex = songlistOrder.indexOf(category as (typeof songlistOrder)[number])
  if (currentIndex !== -1 && nextIndex !== -1) {
    songlistTransitionName.value = nextIndex > currentIndex ? 'page-down' : 'page-up'
  }
  activeCategory.value = category
  activeFilter.value = filter
  showPluginPage.value = false
  activePluginPage.value = null
}

function closePluginPage(): void {
  activePluginPage.value = null
}

function handleTitleBack(): void {
  if (activePluginPage.value) {
    closePluginPage()
    return
  }
  closePlayingPage()
}

function onSelectPluginPage(page: UiContribution): void {
  menuOpen.value = false
  showPlayingPage.value = false
  showStreamingPage.value = false
  showLoginPage.value = false
  showSettingsPage.value = false
  showEqualizerPage.value = false
  showPluginPage.value = false
  activePluginPage.value = page
}

function openPlayingPage(rect: { x: number; y: number; w: number; h: number }): void {
  coverOrigin.value = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, w: rect.w, h: rect.h }
  showPlayingPage.value = true
}

function closePlayingPage(): void {
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
  localMenuOpenBeforeStreaming.value = menuOpen.value
  menuOpen.value = false
  showPlayingPage.value = false
  showSettingsPage.value = false
  showEqualizerPage.value = false
  showPluginPage.value = false
  activePluginPage.value = null
  showStreamingPage.value = true
}

function returnToLocalMode(): void {
  showStreamingPage.value = false
  streamingMenuOpen.value = false
  menuOpen.value = localMenuOpenBeforeStreaming.value
}

async function openLoginPage(): Promise<void> {
  menuOpen.value = false
  showPlayingPage.value = false
  showStreamingPage.value = false
  showSettingsPage.value = false
  showEqualizerPage.value = false
  activePluginPage.value = null
  loginPageMode.value = 'login'
  showLoginPage.value = true
}

function closeLoginPage(): void {
  showLoginPage.value = false
  showStreamingPage.value = true
}

function openSettingsPage(section: SettingsSection = 'general'): void {
  settingsInitialSection.value = section
  showPlayingPage.value = false
  showPluginPage.value = false
  showEqualizerPage.value = false
  activePluginPage.value = null
  showSettingsPage.value = true
}

function closeSettingsPage(): void {
  showSettingsPage.value = false
}

function toggleSettingsPage(): void {
  if (showSettingsPage.value) {
    closeSettingsPage()
    return
  }
  openSettingsPage()
}

function openPlaybackSettings(): void {
  openSettingsPage('playback')
}

function openDspSettings(): void {
  openSettingsPage('dsp')
}

function openPluginPage(): void {
  menuOpen.value = false
  showSettingsPage.value = false
  showEqualizerPage.value = false
  activePluginPage.value = null
  showPluginPage.value = true
}

function hidePluginPage(): void {
  showPluginPage.value = false
}

function togglePluginPage(): void {
  if (showPluginPage.value) {
    hidePluginPage()
    return
  }
  openPluginPage()
}

function openEqualizerPage(): void {
  showSettingsPage.value = false
  showPluginPage.value = false
  activePluginPage.value = null
  showEqualizerPage.value = true
}

function closeEqualizerPage(): void {
  showEqualizerPage.value = false
}

const { loadLibrary, loadPlaylists } = useMusicStore()
const { checkLogin } = useNcmStore()
const { currentTrack, currentTime, isPlaying, restorePlaybackSession, createPlaybackSession } =
  usePlayerStore()
const { loadSettings, settings } = useSettingsStore()
const { uiContributions, syncExtensions } = useExtensionRegistry()
const STREAMING_ACCOUNT_PAGE_KEYS = new Set(['com.twilightecho.provider.ytmusic:ytmusic-account'])
const sidebarPages = computed(() =>
  uiContributions.value.filter(
    (contribution) =>
      contribution.kind === 'sidebarPage' &&
      !STREAMING_ACCOUNT_PAGE_KEYS.has(`${contribution.pluginId}:${contribution.id}`)
  )
)
const localSidebarItems = computed(() =>
  uiContributions.value.filter((contribution) => contribution.kind === 'localSidebarItem')
)
const hasPlayerBar = computed(
  () =>
    !showLoginPage.value &&
    !showSettingsPage.value &&
    !showEqualizerPage.value &&
    !showPluginPage.value &&
    !activePluginPage.value &&
    !!currentTrack.value
)
const showLocalSidebar = computed(
  () =>
    !showPlayingPage.value &&
    !showStreamingPage.value &&
    !showLoginPage.value &&
    !showSettingsPage.value &&
    !showEqualizerPage.value &&
    !showPluginPage.value
)
const localViewVisible = computed(
  () =>
    !showPlayingPage.value &&
    !showStreamingPage.value &&
    !showLoginPage.value &&
    !showSettingsPage.value &&
    !showEqualizerPage.value &&
    !showPluginPage.value &&
    !activePluginPage.value
)

const sideMenuActiveKey = computed(() =>
  activePluginPage.value
    ? `plugin:${activePluginPage.value.pluginId}:${activePluginPage.value.id}`
    : activeCategory.value
)
const mainContentMinHeight = computed(() =>
  showPluginPage.value
    ? '100vh'
    : hasPlayerBar.value
      ? 'calc(100vh - 32px)'
      : 'calc(100vh - 32px)'
)
const sideMenuBottomOffset = ref(0)
const sideMenuOverlapGap = 10
const PLAYBACK_SESSION_AUTOSAVE_DEBOUNCE_MS = 1200
const PLAYBACK_SESSION_POSITION_AUTOSAVE_MS = 15000

let sideMenuMonitorFrame: number | null = null
let playbackSessionAutosaveTimer: number | null = null
let lastPlaybackSessionPositionSaveAt = 0
let removePlaybackSessionSaveListener: (() => void) | null = null
let removeLibraryChangedListener: (() => void) | null = null

async function restoreSavedPlaybackSession(mode: PlaybackResumeMode): Promise<void> {
  if (mode === 'off') {
    await window.api.data.clearPlaybackSession()
    return
  }

  const session = await window.api.data.loadPlaybackSession()
  if (!session?.track?.id) return

  await syncPluginProviders()

  const restoredSession: PlaybackSession = {
    ...session,
    mode,
    position: mode === 'trackAndPosition' ? session.position : 0
  }
  restorePlaybackSession(restoredSession)
}

async function savePlaybackSessionForQuit(): Promise<void> {
  clearPlaybackSessionAutosave()
  await savePlaybackSessionSnapshot()
}

async function savePlaybackSessionSnapshot(): Promise<void> {
  const mode = settings.value.playbackResumeMode
  if (mode === 'off') {
    await window.api.data.clearPlaybackSession()
    return
  }

  const session = createPlaybackSession(mode)
  if (!session) {
    await window.api.data.clearPlaybackSession()
    return
  }

  await window.api.data.savePlaybackSession(session)
}

function clearPlaybackSessionAutosave(): void {
  if (playbackSessionAutosaveTimer !== null) {
    window.clearTimeout(playbackSessionAutosaveTimer)
    playbackSessionAutosaveTimer = null
  }
}

function schedulePlaybackSessionAutosave(delay = PLAYBACK_SESSION_AUTOSAVE_DEBOUNCE_MS): void {
  clearPlaybackSessionAutosave()
  playbackSessionAutosaveTimer = window.setTimeout(() => {
    playbackSessionAutosaveTimer = null
    lastPlaybackSessionPositionSaveAt = Date.now()
    void savePlaybackSessionSnapshot().catch((err) => {
      console.warn('自动保存播放会话失败：', err)
    })
  }, delay)
}

function setSideMenuBottomOffset(offset: number): void {
  const nextOffset = Math.max(0, Math.round(offset))
  if (sideMenuBottomOffset.value !== nextOffset) {
    sideMenuBottomOffset.value = nextOffset
  }
}

function measureSideMenuClearance(): void {
  if (!showLocalSidebar.value || !hasPlayerBar.value) {
    setSideMenuBottomOffset(0)
    return
  }

  const sideMenu = document.querySelector<HTMLElement>('.side-menu')
  const playerBar = document.querySelector<HTMLElement>('.player-bar-shell')

  if (!sideMenu || !playerBar) {
    setSideMenuBottomOffset(0)
    return
  }

  const sideMenuRect = sideMenu.getBoundingClientRect()
  const playerBarRect = playerBar.getBoundingClientRect()
  const overlapsHorizontally =
    playerBarRect.left < sideMenuRect.right && playerBarRect.right > sideMenuRect.left
  const overlapsVertically =
    playerBarRect.top < sideMenuRect.bottom && playerBarRect.bottom > sideMenuRect.top

  if (!overlapsHorizontally || !overlapsVertically) {
    setSideMenuBottomOffset(0)
    return
  }

  setSideMenuBottomOffset(window.innerHeight - playerBarRect.top + sideMenuOverlapGap)
}

function stopSideMenuMonitor(): void {
  if (sideMenuMonitorFrame !== null) {
    cancelAnimationFrame(sideMenuMonitorFrame)
    sideMenuMonitorFrame = null
  }
}

function startSideMenuMonitor(): void {
  if (sideMenuMonitorFrame !== null) return

  const tick = (): void => {
    measureSideMenuClearance()
    if (
      showLocalSidebar.value &&
      hasPlayerBar.value &&
      (menuOpen.value || sideMenuBottomOffset.value > 0)
    ) {
      sideMenuMonitorFrame = requestAnimationFrame(tick)
      return
    }
    sideMenuMonitorFrame = null
  }

  sideMenuMonitorFrame = requestAnimationFrame(tick)
}

onMounted(async () => {
  setupPluginThemeRuntime()
  setupListeningStatsTracking()
  removePlaybackSessionSaveListener = window.api.app.onSavePlaybackSession(
    savePlaybackSessionForQuit
  )
  const loadedSettings = await loadSettings()
  await loadLibrary()
  await loadPlaylists()
  if (loadedSettings.autoCheckLogin) {
    await checkLogin()
  }
  await syncExtensions()
  if (loadedSettings.startupHomePage === 'streaming') {
    enterStreamingMode()
  }
  await restoreSavedPlaybackSession(loadedSettings.playbackResumeMode)
  removeLibraryChangedListener = window.api.library.onChanged(() => {
    loadLibrary().catch(() => {})
  })
})

watch(
  [showLocalSidebar, hasPlayerBar, menuOpen],
  () => {
    if (
      showLocalSidebar.value &&
      hasPlayerBar.value &&
      (menuOpen.value || sideMenuBottomOffset.value > 0)
    ) {
      nextTick(startSideMenuMonitor)
      return
    }

    stopSideMenuMonitor()
    setSideMenuBottomOffset(0)
  },
  { immediate: true, flush: 'post' }
)

watch(
  [() => currentTrack.value?.id, () => settings.value.playbackResumeMode],
  ([trackId]) => {
    if (!trackId || settings.value.playbackResumeMode === 'off') {
      schedulePlaybackSessionAutosave()
      return
    }

    lastPlaybackSessionPositionSaveAt = Date.now()
    schedulePlaybackSessionAutosave()
  },
  { flush: 'post' }
)

watch(
  [currentTime, isPlaying],
  ([, playing]) => {
    if (!playing || !currentTrack.value || settings.value.playbackResumeMode !== 'trackAndPosition') {
      return
    }

    const now = Date.now()
    if (now - lastPlaybackSessionPositionSaveAt < PLAYBACK_SESSION_POSITION_AUTOSAVE_MS) return
    lastPlaybackSessionPositionSaveAt = now
    schedulePlaybackSessionAutosave()
  },
  { flush: 'post' }
)

watch(
  showSettingsPage,
  (visible) => {
    document.body.classList.toggle('te-settings-surface', visible || showPluginPage.value)
  },
  { immediate: true }
)

watch(
  showPluginPage,
  (visible) => {
    document.body.classList.toggle('te-settings-surface', visible || showSettingsPage.value)
  },
  { immediate: true }
)

watch(
  showStreamingSurface,
  (visible) => {
    document.body.classList.toggle('te-streaming-surface', visible)
  },
  { immediate: true }
)

watch(sidebarPages, (pages) => {
  const active = activePluginPage.value
  if (!active) return
  const stillRegistered = pages.some(
    (page) => page.pluginId === active.pluginId && page.id === active.id
  )
  if (!stillRegistered) {
    activePluginPage.value = null
  }
})

onBeforeUnmount(() => {
  clearPlaybackSessionAutosave()
  removePlaybackSessionSaveListener?.()
  removePlaybackSessionSaveListener = null
  removeLibraryChangedListener?.()
  removeLibraryChangedListener = null
  stopSideMenuMonitor()
  document.body.classList.remove('te-settings-surface')
  document.body.classList.remove('te-streaming-surface')
})

const coverTransformOrigin = computed(() => `${coverOrigin.value.x}px ${coverOrigin.value.y}px`)
const titleSurface = computed<TitleSurface>(() => {
  if (showPlayingPage.value) return 'default'
  if (showSettingsPage.value) return 'settings'
  if (showPluginPage.value) return 'settings'
  if (showStreamingPage.value) return 'streaming'
  if (activePluginPage.value) return 'settings'
  return 'default'
})
</script>

<template>
  <TitleBar
    :glass="showPlayingPage"
    :streaming="showStreamingPage && !showPlayingPage"
    :title-surface="titleSurface"
    :menu-open="titleMenuOpen"
    @toggle-menu="toggleMenu"
    @collapse-menu="collapseMenu"
    @back="handleTitleBack"
    @login="openLoginPage"
    @settings="toggleSettingsPage"
    @plugins="togglePluginPage"
  />
  <SideMenu
    v-if="showLocalSidebar"
    :open="menuOpen"
    :active-key="sideMenuActiveKey"
    :plugin-pages="sidebarPages"
    :local-items="localSidebarItems"
    @select-view="onSelectView"
    @select-plugin-page="onSelectPluginPage"
    @enter-streaming="enterStreamingMode"
  />
  <div
    class="main-content"
    :class="{
      'menu-open': menuOpen && showLocalSidebar,
      'playing-open': showPlayingPage,
      'plugin-open': showPluginPage
    }"
    :style="{ minHeight: mainContentMinHeight }"
  >
    <Transition :name="songlistTransitionName">
      <LocalDashboard
        v-if="localViewVisible && activeCategory === 'dashboard'"
        @open-dsp="openDspSettings"
      />
      <SongList
        v-else-if="localViewVisible"
        :category="activeCategory"
        :filter="activeFilter"
        :has-player="hasPlayerBar"
        :transition-name="songlistTransitionName"
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
      @back-to-local="returnToLocalMode"
      @login="openLoginPage"
    />
    <Transition name="login-page">
      <LoginPage
        v-if="showLoginPage"
        :force-profile="loginPageMode === 'profile'"
        @back="closeLoginPage"
        @login-success="closeLoginPage"
      />
    </Transition>
    <Transition name="settings-page">
      <PluginPage v-if="showPluginPage" @back="hidePluginPage" />
    </Transition>
    <Transition name="settings-page">
      <SettingsPage
        v-if="showSettingsPage"
        :initial-section="settingsInitialSection"
        @back="closeSettingsPage"
        @open-equalizer="openEqualizerPage"
      />
    </Transition>
    <Transition name="login-page">
      <EqualizerPage v-if="showEqualizerPage" @back="closeEqualizerPage" />
    </Transition>
    <Transition name="login-page">
      <PluginExtensionPage
        v-if="activePluginPage"
        :page="activePluginPage"
        @back="closePluginPage"
      />
    </Transition>
  </div>
  <PlayerBar
    v-if="hasPlayerBar"
    :glass="showPlayingPage"
    @click-cover="handleCoverClick"
    @open-settings="openPlaybackSettings"
    @open-dsp="openDspSettings"
  />
</template>

<style>
body {
  background: transparent;
}

.main-content {
  display: grid;
  margin-left: 0;
  width: 100%;
  min-height: calc(100vh - 32px - 96px);
  transform: translate3d(0, 0, 0);
  transition:
    transform 0.32s var(--te-ease-soft),
    width 0.32s var(--te-ease-soft);
  will-change: transform, width;
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
    radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.94), transparent 28%),
    radial-gradient(circle at 46% 48%, rgba(124, 77, 255, 0.04), transparent 62%),
    radial-gradient(circle at 66% 62%, rgba(255, 126, 182, 0.032), transparent 70%);
  opacity: 0.4;
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

body.te-no-blur .main-content::before,
body.te-no-blur .main-content::after,
body.te-no-blur .page-down-leave-to,
body.te-no-blur .page-down-enter-from,
body.te-no-blur .page-up-leave-to,
body.te-no-blur .page-up-enter-from,
body.te-no-blur .playing-page-enter-from,
body.te-no-blur .playing-page-leave-to,
body.te-no-blur .settings-page-enter-from,
body.te-no-blur .settings-page-leave-to,
body.te-no-blur .login-page-enter-from,
body.te-no-blur .login-page-leave-to {
  filter: none !important;
}

.main-content.menu-open {
  width: calc(100% - var(--te-menu-width));
  transform: translate3d(var(--te-menu-width), 0, 0);
}

.main-content.playing-open {
  overflow: visible;
}

.main-content.plugin-open {
  min-height: 100vh !important;
  height: 100vh;
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
    transform 0.42s var(--te-ease-soft),
    opacity 0.26s ease,
    filter 0.32s ease;
  will-change: transform, opacity, filter;
}
.page-down-enter-active,
.page-up-enter-active {
  z-index: 1;
}
.page-down-leave-active,
.page-up-leave-active {
  z-index: 0;
}

/* page-down: selected page is lower in the sidebar, new view rises from below */
.page-down-leave-to {
  transform: translateY(-34px) scale(0.992);
  opacity: 0;
  filter: blur(8px);
}
.page-down-enter-from {
  transform: translateY(46px) scale(0.992);
  opacity: 0;
  filter: blur(8px);
}

/* page-up: selected page is higher in the sidebar, new view drops from above */
.page-up-leave-to {
  transform: translateY(34px) scale(0.992);
  opacity: 0;
  filter: blur(8px);
}
.page-up-enter-from {
  transform: translateY(-46px) scale(0.992);
  opacity: 0;
  filter: blur(8px);
}

/* PlayingMusic open/close — expands from / shrinks to cover position */
.playing-page-enter-active {
  transition:
    transform 0.56s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.34s ease,
    filter 0.56s cubic-bezier(0.16, 1, 0.3, 1),
    border-radius 0.56s cubic-bezier(0.16, 1, 0.3, 1);
}
.playing-page-leave-active {
  transition:
    transform 0.42s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.26s ease,
    filter 0.42s cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 0.42s cubic-bezier(0.4, 0, 0.2, 1);
}

.playing-page-enter-from {
  transform: scale(0.12) !important;
  border-radius: 28px;
  opacity: 0;
  filter: blur(10px);
}

.playing-page-leave-to {
  transform: scale(0.12) !important;
  border-radius: 28px;
  opacity: 0;
  filter: blur(10px);
}

/* Settings and plugin pages: shared overlay transition */
.settings-page-enter-active {
  z-index: 70;
  transition:
    opacity 0.34s ease,
    transform 0.42s cubic-bezier(0.16, 1, 0.3, 1),
    filter 0.42s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: opacity, transform, filter;
}

.settings-page-leave-active {
  z-index: 69;
  pointer-events: none;
  transition:
    opacity 0.22s ease,
    transform 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    filter 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: opacity, transform, filter;
}

.settings-page-enter-from {
  opacity: 0;
  transform: translate3d(28px, 0, 0) scale(0.988);
  filter: blur(10px);
}

.settings-page-leave-to {
  opacity: 0;
  transform: translate3d(18px, 0, 0) scale(0.992);
  filter: blur(8px);
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
