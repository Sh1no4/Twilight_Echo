<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  nextTick,
  watch,
  defineAsyncComponent
} from 'vue'
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
const DspRackPage = defineAsyncComponent(() => import('./components/DspRackPage.vue'))
const PluginExtensionPage = defineAsyncComponent(
  () => import('./components/PluginExtensionPage.vue')
)
import { useMusicStore } from './stores/useMusicStore'
import { useNcmStore } from './stores/useNcmStore'
import { setupListeningStatsTracking } from './stores/useListeningStatsStore'
import { usePlayerStore } from './stores/usePlayerStore'
import { useSettingsStore } from './stores/useSettingsStore'
import { setupPluginThemeRuntime } from './extensions/themeRuntime'
import { useExtensionRegistry } from './extensions/registry'
import { syncPluginProviders } from './providers'
import { useAppNavigation } from './app/useAppNavigation'
import { createPlaybackSessionPersistence } from './app/usePlaybackSessionPersistence'
import { useSideMenuClearance } from './app/useSideMenuClearance'
import { useMiniPlayerSync } from './app/useMiniPlayerSync'

type TitleSurface = 'default' | 'settings' | 'streaming'
type StreamingInitialTab = 'home' | 'library' | 'recent'

const navigation = useAppNavigation()
const {
  menuOpen,
  showPlayingPage,
  showStreamingPage,
  showLoginPage,
  loginPageMode,
  loginInitialProviderId,
  showSettingsPage,
  showPluginPage,
  showEqualizerPage,
  showDspRackPage,
  activePluginPage,
  settingsInitialSection,
  activeCategory,
  activeFilter,
  songlistTransitionName,
  streamingMenuOpen,
  showStreamingSurface,
  localViewVisible,
  toggleStreamingMenu,
  collapseMenu,
  onSelectView,
  closePluginPage,
  onSelectPluginPage,
  openPlayingPage: showPlaying,
  closePlayingPage,
  enterStreamingMode,
  returnToLocalMode,
  openLoginPage,
  closeLoginPage,
  closeSettingsPage,
  openPlaybackSettings,
  openDspSettings,
  hidePluginPage,
  openEqualizerPage,
  closeEqualizerPage,
  openDspRackPage,
  closeDspRackPage,
  closeMissingPluginPage
} = navigation
const toggleMenu = navigation.createToggleMenuHandler()
const toggleSettingsPage = navigation.createToggleSettingsHandler()
const togglePluginPage = navigation.createTogglePluginHandler()

const coverOrigin = ref({ x: 48, y: window.innerHeight - 36, w: 48, h: 48 })
const streamingInitialTab = ref<StreamingInitialTab | null>(null)
const titleMenuOpen = computed(() =>
  showPluginPage.value ? false : showStreamingPage.value ? streamingMenuOpen.value : menuOpen.value
)

function handleTitleBack(): void {
  if (activePluginPage.value) {
    closePluginPage()
    return
  }
  closePlayingPage()
}

function openPlayingPage(rect: { x: number; y: number; w: number; h: number }): void {
  coverOrigin.value = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, w: rect.w, h: rect.h }
  showPlaying()
}

function handleCoverClick(rect: { x: number; y: number; w: number; h: number }): void {
  if (showPlayingPage.value) {
    closePlayingPage()
  } else {
    openPlayingPage(rect)
  }
}

function enterStreamingLogin(): void {
  streamingInitialTab.value = 'library'
  enterStreamingMode()
  if (!ncmLoggedIn.value) {
    openLoginPage('ncm')
  }
}

function handleLoginSuccess(): void {
  if (loginInitialProviderId.value === 'ncm') {
    streamingInitialTab.value = 'library'
  }
  closeLoginPage()
}

const { loadLibrary, loadPlaylists, flushSaveLibrary, handleLibraryChange } = useMusicStore()
const { checkLogin, isLoggedIn: ncmLoggedIn } = useNcmStore()
const {
  currentTrack,
  currentTime,
  duration,
  isPlaying,
  isLoading,
  volume,
  playMode,
  dominantColor,
  queue,
  queueIndex,
  togglePlay,
  next,
  prev,
  seek,
  setVolume,
  cyclePlayMode,
  restorePlaybackSession,
  createPlaybackSession,
  visualizerActive
} = usePlayerStore()

useMiniPlayerSync({
  currentTrack,
  isPlaying,
  isLoading,
  currentTime,
  duration,
  volume,
  playMode,
  dominantColor,
  queue,
  queueIndex,
  togglePlay,
  next,
  prev,
  seek,
  setVolume,
  cyclePlayMode
})
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
    !showDspRackPage.value &&
    !showPluginPage.value &&
    !activePluginPage.value &&
    !visualizerActive.value &&
    !!currentTrack.value
)
const showLocalSidebar = computed(
  () =>
    !showPlayingPage.value &&
    !showStreamingPage.value &&
    !showLoginPage.value &&
    !showSettingsPage.value &&
    !showEqualizerPage.value &&
    !showDspRackPage.value &&
    !showPluginPage.value
)

const sideMenuActiveKey = computed(() =>
  activePluginPage.value
    ? `plugin:${activePluginPage.value.pluginId}:${activePluginPage.value.id}`
    : activeCategory.value
)
const mainContentMinHeight = computed(() =>
  showPluginPage.value ? '100vh' : hasPlayerBar.value ? 'calc(100vh - 32px)' : 'calc(100vh - 32px)'
)

const playbackSessionPersistence = createPlaybackSessionPersistence({
  settings,
  currentTrack,
  currentTime,
  isPlaying,
  restorePlaybackSession,
  createPlaybackSession,
  syncPluginProviders,
  dataApi: window.api.data
})
const { sideMenuBottomOffset, startSideMenuMonitor, stopSideMenuMonitor, resetSideMenuClearance } =
  useSideMenuClearance({ showLocalSidebar, hasPlayerBar, menuOpen })

let removePlaybackSessionSaveListener: (() => void) | null = null
let removeLibraryChangedListener: (() => void) | null = null
let removeCoversMissingListener: (() => void) | null = null
let quitFlushHandler: (() => void) | null = null
let pageHideFlushHandler: (() => void) | null = null

function reportStartupDataError(scope: string, error: unknown): void {
  console.error(`[persistence] Failed to load ${scope}:`, error)
}

onMounted(async () => {
  setupPluginThemeRuntime()
  setupListeningStatsTracking({ currentTrack, isPlaying, currentTime, duration })
  const loadedSettings = await loadSettings()

  // Enter streaming mode immediately if configured — must not block on
  // library/login/extensions which can take 30s+ (provider timeouts).
  if (loadedSettings.startupHomePage === 'streaming') {
    enterStreamingMode()
  }

  // Restore the session before loading the potentially large music library.
  // The main-process data handlers use synchronous file reads, so issuing the
  // library request first can delay the home page's current-track state.
  const playbackSessionSetupPromise = playbackSessionPersistence
    .restoreSavedPlaybackSession(loadedSettings.playbackResumeMode)
    .catch((error) => {
      reportStartupDataError('playback session', error)
    })
    .finally(() => {
      removePlaybackSessionSaveListener = window.api.app.onSavePlaybackSession(
        playbackSessionPersistence.savePlaybackSessionForQuit
      )
      playbackSessionPersistence.startAutosaveWatchers()
    })
  // Run independent startup operations in parallel so none blocks the others.
  const libraryPromise = loadLibrary().catch((error) =>
    reportStartupDataError('music library', error)
  )
  const playlistsPromise = loadPlaylists().catch((error) =>
    reportStartupDataError('playlists', error)
  )
  const extensionsPromise = syncExtensions()
  if (loadedSettings.autoCheckLogin) {
    void checkLogin()
  }

  // The session restore starts alongside the library load so the home surface
  // can receive the actual current track without waiting for a full scan.
  await libraryPromise
  await playbackSessionSetupPromise

  // Ensure extensions are loaded before wiring listeners that depend on them.
  await extensionsPromise
  await playlistsPromise

  removeLibraryChangedListener = window.api.library.onChanged((change) => {
    handleLibraryChange(change).catch(() => {})
  })
  // Notify user when covers are missing (independent of library:changed to avoid reload loop)
  removeCoversMissingListener = window.api.library.onCoversMissing((info) => {
    console.warn(`??? ${info.dirtyCount} ?????,???????????`)
  })
  // Quit-flush: save pending debounced library writes before window closes
  quitFlushHandler = (): void => flushSaveLibrary()
  pageHideFlushHandler = (): void => flushSaveLibrary()
  window.addEventListener('beforeunload', quitFlushHandler)
  window.addEventListener('pagehide', pageHideFlushHandler)
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

    resetSideMenuClearance()
  },
  { immediate: true, flush: 'post' }
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

watch(sidebarPages, (pages) => closeMissingPluginPage(pages))

onBeforeUnmount(() => {
  playbackSessionPersistence.stop()
  removePlaybackSessionSaveListener?.()
  removePlaybackSessionSaveListener = null
  removeLibraryChangedListener?.()
  removeLibraryChangedListener = null
  removeCoversMissingListener?.()
  removeCoversMissingListener = null
  if (quitFlushHandler) window.removeEventListener('beforeunload', quitFlushHandler)
  if (pageHideFlushHandler) window.removeEventListener('pagehide', pageHideFlushHandler)
  quitFlushHandler = null
  pageHideFlushHandler = null
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
    @enter-streaming="enterStreamingLogin"
  />
  <div
    class="main-content"
    :class="{
      'menu-open': menuOpen && showLocalSidebar,
      'playing-open': showPlayingPage,
      'plugin-open': showPluginPage,
      'dsp-rack-open': showDspRackPage
    }"
    :style="{ minHeight: mainContentMinHeight }"
  >
    <Transition :name="songlistTransitionName">
      <LocalDashboard
        v-if="localViewVisible && activeCategory === 'dashboard'"
        @select-view="onSelectView"
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
      :initial-tab="streamingInitialTab ?? undefined"
      @toggle-menu="toggleStreamingMenu"
      @back-to-local="returnToLocalMode"
      @login="openLoginPage"
    />
    <Transition name="login-page">
      <LoginPage
        v-if="showLoginPage"
        :force-profile="loginPageMode === 'profile'"
        :initial-provider-id="loginInitialProviderId"
        @back="closeLoginPage"
        @login-success="handleLoginSuccess"
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
        @open-dsp-rack="openDspRackPage"
      />
    </Transition>
    <Transition name="settings-page">
      <DspRackPage v-if="showDspRackPage" @back="closeDspRackPage" />
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
    @open-equalizer="openEqualizerPage"
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

.main-content.dsp-rack-open {
  height: calc(100vh - 32px);
  min-height: 0 !important;
}

.main-content.dsp-rack-open > .dsp-rack-page {
  height: 100%;
  min-height: 0;
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
