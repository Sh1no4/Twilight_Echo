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
import PlayerBar from './components/PlayerBar.vue'
const LocalDashboard = defineAsyncComponent(() => import('./components/LocalDashboard.vue'))
const SongList = defineAsyncComponent(() => import('./components/SongList.vue'))
const PlayingMusic = defineAsyncComponent(() => import('./components/PlayingMusic.vue'))
const StreamingPage = defineAsyncComponent(() => import('./components/StreamingPage.vue'))
const RadioPodcastPage = defineAsyncComponent(() => import('./components/RadioPodcastPage.vue'))
const LoginPage = defineAsyncComponent(() => import('./components/LoginPage.vue'))
const SettingsPage = defineAsyncComponent(() => import('./components/SettingsPage.vue'))
const ThemeStudioPage = defineAsyncComponent(() => import('./components/ThemeStudioPage.vue'))
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
import { useThemeStore } from './stores/useThemeStore'
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
  showRadioPodcastPage,
  showLoginPage,
  loginPageMode,
  loginInitialProviderId,
  showSettingsPage,
  showThemeStudioPage,
  themeStudioInitialDomain,
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
  enterRadioPodcastMode,
  closeRadioPodcastPage,
  returnToLocalMode,
  openLoginPage,
  closeLoginPage,
  closeSettingsPage,
  openThemeStudioPage,
  closeThemeStudioPage,
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

function handleStreamingLogin(providerId?: string | null): void {
  openLoginPage(providerId ?? null)
}

function handleTitleLogin(providerId?: string | null): void {
  openLoginPage(providerId ?? 'ncm')
}

function handleLoginSuccess(): void {
  if (loginInitialProviderId.value === 'ncm') {
    streamingInitialTab.value = 'library'
  }
  closeLoginPage()
}

const {
  loadLibrary,
  loadPlaylists,
  flushSaveLibrary,
  flushPlaylists,
  handleLibraryChange,
  startStartupLibraryScan,
  applyLibraryScanProgress,
  applyLibraryScanStatus
} = useMusicStore()
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
  coverThemeColor,
  themeCoverUrl,
  themeCoverIdentity,
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
  rehydrateCurrentTrackFromLibrary,
  visualizerActive
} = usePlayerStore()
const { setAdaptiveMedia } = useThemeStore()

watch(
  [themeCoverIdentity, coverThemeColor, themeCoverUrl],
  ([identity, accentColor, coverUrl]) => {
    void setAdaptiveMedia({ identity, accentColor, coverUrl })
  },
  { immediate: true }
)

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
    !showThemeStudioPage.value &&
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
    !showRadioPodcastPage.value &&
    !showLoginPage.value &&
    !showSettingsPage.value &&
    !showThemeStudioPage.value &&
    !showEqualizerPage.value &&
    !showDspRackPage.value &&
    !showPluginPage.value
)

const sideMenuActiveKey = computed(() =>
  activePluginPage.value
    ? `plugin:${activePluginPage.value.pluginId}:${activePluginPage.value.id}`
    : activeCategory.value
)
const mainContentMinHeight = computed(() => '100vh')

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
const {
  sideMenuBottomOffset,
  startSideMenuMonitor,
  stopSideMenuMonitor,
  resetSideMenuClearance,
  dispose: disposeSideMenuClearance
} = useSideMenuClearance({ showLocalSidebar, hasPlayerBar, menuOpen })

let removePlaybackSessionSaveListener: (() => void) | null = null
let removeLibraryChangedListener: (() => void) | null = null
let removeCoversMissingListener: (() => void) | null = null
let removeLibraryScanProgressListener: (() => void) | null = null
let removeLibraryScanStatusListener: (() => void) | null = null
let quitFlushHandler: (() => void) | null = null
let pageHideFlushHandler: (() => void) | null = null
let removeVisibilityListener: (() => void) | null = null

function syncDocumentVisibility(): void {
  document.body.classList.toggle('te-background-animations-paused', document.hidden)
}

function reportStartupDataError(scope: string, error: unknown): void {
  console.error(`[persistence] Failed to load ${scope}:`, error)
}

async function flushPlaylistsForExit(): Promise<void> {
  try {
    const persisted = await flushPlaylists()
    if (!persisted) {
      throw new Error('Playlist persistence did not finish before exit')
    }
  } catch (error) {
    console.error('[persistence] Failed to flush playlists before exit:', error)
    throw error
  }
}

function flushPendingPersistenceForExit(): void {
  flushSaveLibrary()
  // Browser lifecycle events cannot wait for a Promise. The app-close IPC
  // callback below awaits this same flush before the main process closes.
  void flushPlaylistsForExit().catch(() => {
    // The failure was logged by flushPlaylistsForExit. pagehide is only a
    // best-effort path; it cannot certify a successful application close.
  })
}

onMounted(async () => {
  syncDocumentVisibility()
  document.addEventListener('visibilitychange', syncDocumentVisibility)
  removeVisibilityListener = () =>
    document.removeEventListener('visibilitychange', syncDocumentVisibility)
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
      removePlaybackSessionSaveListener = window.api.app.onSavePlaybackSession(async () => {
        // This callback is awaited by the main-process close coordinator. It
        // closes the 250ms playlist debounce window before renderer teardown.
        await flushPlaylistsForExit()
        await playbackSessionPersistence.savePlaybackSessionForQuit()
      })
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
  // Session restore often finishes before library rows are available; re-apply
  // embedded covers/lyrics so playbar/home art and now-playing lyrics hydrate.
  rehydrateCurrentTrackFromLibrary()
  removeLibraryChangedListener = window.api.library.onChanged((change) => {
    handleLibraryChange(change).catch((error) => {
      console.error('[library] Failed to apply an incremental scan update:', error)
    })
  })
  removeLibraryScanProgressListener = window.api.library.onScanProgress(applyLibraryScanProgress)
  removeLibraryScanStatusListener = window.api.library.onScanStatus(applyLibraryScanStatus)
  void window.api.library
    .getScanStatus()
    .then(applyLibraryScanStatus)
    .catch((error) => {
      console.error('[library] Failed to read background scan status:', error)
    })
  void startStartupLibraryScan().catch((error) => {
    console.error('[library] Startup reconciliation failed:', error)
  })

  // Ensure extensions are loaded before wiring listeners that depend on them.
  await extensionsPromise
  await playlistsPromise

  // Notify user when covers are missing (independent of library:changed to avoid reload loop)
  removeCoversMissingListener = window.api.library.onCoversMissing((info) => {
    console.warn(`??? ${info.dirtyCount} ?????,???????????`)
  })
  // Lifecycle events are best-effort; the close IPC callback above provides
  // the awaitable completion barrier for application shutdown.
  quitFlushHandler = flushPendingPersistenceForExit
  pageHideFlushHandler = flushPendingPersistenceForExit
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
    document.body.classList.toggle(
      'te-settings-surface',
      visible || showPluginPage.value || showThemeStudioPage.value
    )
  },
  { immediate: true }
)

watch(
  showPluginPage,
  (visible) => {
    document.body.classList.toggle(
      'te-settings-surface',
      visible || showSettingsPage.value || showThemeStudioPage.value
    )
  },
  { immediate: true }
)

watch(
  showThemeStudioPage,
  (visible) => {
    document.body.classList.toggle(
      'te-settings-surface',
      visible || showSettingsPage.value || showPluginPage.value
    )
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
  removeLibraryScanProgressListener?.()
  removeLibraryScanProgressListener = null
  removeLibraryScanStatusListener?.()
  removeLibraryScanStatusListener = null
  removeCoversMissingListener?.()
  removeCoversMissingListener = null
  if (quitFlushHandler) window.removeEventListener('beforeunload', quitFlushHandler)
  if (pageHideFlushHandler) window.removeEventListener('pagehide', pageHideFlushHandler)
  quitFlushHandler = null
  pageHideFlushHandler = null
  stopSideMenuMonitor()
  disposeSideMenuClearance()
  removeVisibilityListener?.()
  removeVisibilityListener = null
  document.body.classList.remove('te-background-animations-paused')
  document.body.classList.remove('te-settings-surface')
  document.body.classList.remove('te-streaming-surface')
})

const coverTransformOrigin = computed(() => `${coverOrigin.value.x}px ${coverOrigin.value.y}px`)
const titleSurface = computed<TitleSurface>(() => {
  if (showPlayingPage.value) return 'default'
  if (showSettingsPage.value) return 'settings'
  if (showThemeStudioPage.value) return 'settings'
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
    :hide-start="showThemeStudioPage"
    :title-surface="titleSurface"
    :menu-open="titleMenuOpen"
    @toggle-menu="toggleMenu"
    @collapse-menu="collapseMenu"
    @back="handleTitleBack"
    @login="handleTitleLogin"
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
    @enter-radio-podcast="enterRadioPodcastMode"
  />
  <div
    class="main-content"
    :class="{
      'menu-open': menuOpen && showLocalSidebar,
      'playing-open': showPlayingPage,
      'plugin-open': showPluginPage,
      'dsp-rack-open': showDspRackPage,
      'radio-podcast-open': showRadioPodcastPage
    }"
    :style="{ minHeight: mainContentMinHeight }"
  >
    <Transition :name="songlistTransitionName" mode="out-in">
      <LocalDashboard
        v-if="localViewVisible && activeCategory === 'dashboard'"
        key="local-dashboard"
        @select-view="onSelectView"
      />
      <SongList
        v-else-if="localViewVisible"
        key="local-songlist"
        :category="activeCategory"
        :filter="activeFilter"
        :has-player="hasPlayerBar"
        :transition-name="songlistTransitionName"
        @select-view="onSelectView"
        @customize-appearance="openThemeStudioPage('library')"
      />
    </Transition>
    <Transition name="playing-page">
      <PlayingMusic
        v-if="showPlayingPage"
        :style="{ transformOrigin: coverTransformOrigin }"
        @back="closePlayingPage"
        @customize-appearance="openThemeStudioPage('player')"
      />
    </Transition>
    <StreamingPage
      v-if="showStreamingPage"
      :menu-open="streamingMenuOpen"
      :has-player="hasPlayerBar"
      :initial-tab="streamingInitialTab ?? undefined"
      @toggle-menu="toggleStreamingMenu"
      @back-to-local="returnToLocalMode"
      @login="handleStreamingLogin"
    />
    <RadioPodcastPage v-if="showRadioPodcastPage" @back="closeRadioPodcastPage" />
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
        @open-theme-studio="openThemeStudioPage"
      />
    </Transition>
    <Transition name="settings-page">
      <ThemeStudioPage
        v-if="showThemeStudioPage"
        :initial-domain="themeStudioInitialDomain"
        @back="closeThemeStudioPage"
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
  box-sizing: border-box;
  margin-left: 0;
  width: 100%;
  min-height: 100vh;
  padding-left: 0;
  transform: translateZ(0);
  transition: padding-left 0.32s var(--te-ease-soft);
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

body.te-background-animations-paused .main-content::before,
body.te-background-animations-paused .main-content::after {
  animation-play-state: paused;
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
  padding-left: var(--te-menu-width);
}

.main-content.playing-open {
  overflow: visible;
}

.main-content.plugin-open {
  min-height: 100vh !important;
  height: 100vh;
}

.main-content.dsp-rack-open {
  height: 100vh;
  min-height: 0 !important;
}

.main-content.dsp-rack-open > .dsp-rack-page {
  height: 100%;
  min-height: 0;
}

.main-content.radio-podcast-open {
  height: 100vh;
  min-height: 0 !important;
}

.main-content.radio-podcast-open > .radio-podcast-page {
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

/* Local home ↔ list page transitions (must beat scoped component roots). */
.main-content > .page-down-enter-active,
.main-content > .page-down-leave-active,
.main-content > .page-up-enter-active,
.main-content > .page-up-leave-active,
.page-down-enter-active,
.page-down-leave-active,
.page-up-enter-active,
.page-up-leave-active {
  transition:
    transform 0.42s var(--te-ease-soft),
    opacity 0.26s ease,
    filter 0.32s ease !important;
  will-change: transform, opacity, filter;
}
.main-content > .page-down-enter-active,
.main-content > .page-up-enter-active,
.page-down-enter-active,
.page-up-enter-active {
  z-index: 1;
}
.main-content > .page-down-leave-active,
.main-content > .page-up-leave-active,
.page-down-leave-active,
.page-up-leave-active {
  z-index: 0;
}

/* page-down: selected page is lower in the sidebar, new view rises from below */
.main-content > .page-down-leave-to,
.page-down-leave-to {
  transform: translateY(-34px) scale(0.992);
  opacity: 0;
  filter: blur(8px);
}
.main-content > .page-down-enter-from,
.page-down-enter-from {
  transform: translateY(46px) scale(0.992);
  opacity: 0;
  filter: blur(8px);
}

/* page-up: selected page is higher in the sidebar, new view drops from above */
.main-content > .page-up-leave-to,
.page-up-leave-to {
  transform: translateY(34px) scale(0.992);
  opacity: 0;
  filter: blur(8px);
}
.main-content > .page-up-enter-from,
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
