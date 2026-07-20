import { computed, ref, type Ref } from 'vue'
import type { UiContribution } from '../extensions/registry'

export type SettingsSection =
  | 'general'
  | 'playback'
  | 'dsp'
  | 'cache'
  | 'performance'
  | 'appearance'
  | 'shortcuts'
  | 'about'

const songlistOrder = ['dashboard', 'allSongs', 'artists', 'albums', 'genres', 'playlists', 'folders', 'recent'] as const

export function useAppNavigation() {
  const menuOpen = ref(false)
  const showPlayingPage = ref(false)
  const showStreamingPage = ref(false)
  const showLoginPage = ref(false)
  const loginPageMode = ref<'login' | 'profile'>('login')
  const loginInitialProviderId = ref<string | null>(null)
  const showSettingsPage = ref(false)
  const showPluginPage = ref(false)
  const showEqualizerPage = ref(false)
  const showDspRackPage = ref(false)
  const activePluginPage = ref<UiContribution | null>(null)
  const settingsInitialSection = ref<SettingsSection>('general')
  const activeCategory = ref('dashboard')
  const activeFilter = ref<string | null>(null)
  const songlistTransitionName = ref<'page-down' | 'page-up'>('page-down')
  const streamingMenuOpen = ref(false)
  const localMenuOpenBeforeStreaming = ref(false)

  const showStreamingSurface = computed(
    () =>
      showStreamingPage.value &&
      !showPlayingPage.value &&
      !showLoginPage.value &&
      !showSettingsPage.value &&
      !showEqualizerPage.value &&
      !showDspRackPage.value &&
      !showPluginPage.value &&
      !activePluginPage.value
  )

  const localViewVisible = computed(
    () =>
      !showPlayingPage.value &&
      !showStreamingPage.value &&
      !showLoginPage.value &&
      !showSettingsPage.value &&
      !showEqualizerPage.value &&
      !showDspRackPage.value &&
      !showPluginPage.value &&
      !activePluginPage.value
  )

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

  function openPlayingPage(): void {
    showPlayingPage.value = true
  }

  function closePlayingPage(): void {
    showPlayingPage.value = false
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

  function openLoginPage(initialProviderId: string | null = null): void {
    menuOpen.value = false
    showPlayingPage.value = false
    showStreamingPage.value = false
    showSettingsPage.value = false
    showEqualizerPage.value = false
    activePluginPage.value = null
    loginPageMode.value = 'login'
    loginInitialProviderId.value = initialProviderId
    showLoginPage.value = true
  }

  function closeLoginPage(): void {
    showLoginPage.value = false
    loginInitialProviderId.value = null
    showStreamingPage.value = true
  }

  function openSettingsPage(section: SettingsSection = 'general'): void {
    settingsInitialSection.value = section
    showPlayingPage.value = false
    showPluginPage.value = false
    showEqualizerPage.value = false
    showDspRackPage.value = false
    activePluginPage.value = null
    showSettingsPage.value = true
  }

  function closeSettingsPage(): void {
    showSettingsPage.value = false
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
    showDspRackPage.value = false
    activePluginPage.value = null
    showPluginPage.value = true
  }

  function hidePluginPage(): void {
    showPluginPage.value = false
  }

  function openEqualizerPage(): void {
    showSettingsPage.value = false
    showPluginPage.value = false
    showDspRackPage.value = false
    activePluginPage.value = null
    showEqualizerPage.value = true
  }

  function closeEqualizerPage(): void {
    showEqualizerPage.value = false
  }

  function openDspRackPage(): void {
    showSettingsPage.value = false
    showPluginPage.value = false
    showEqualizerPage.value = false
    activePluginPage.value = null
    showDspRackPage.value = true
  }

  function closeDspRackPage(): void {
    showDspRackPage.value = false
  }

  function closeMissingPluginPage(pages: UiContribution[]): void {
    const active = activePluginPage.value
    if (!active) return
    const stillRegistered = pages.some(
      (page) => page.pluginId === active.pluginId && page.id === active.id
    )
    if (!stillRegistered) {
      activePluginPage.value = null
    }
  }

  function createToggleMenuHandler(): () => void {
    return () => {
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
  }

  function createToggleSettingsHandler(): () => void {
    return () => {
      if (showSettingsPage.value) {
        closeSettingsPage()
        return
      }
      openSettingsPage()
    }
  }

  function createTogglePluginHandler(): () => void {
    return () => {
      if (showPluginPage.value) {
        hidePluginPage()
        return
      }
      openPluginPage()
    }
  }

  return {
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
    activePluginPage: activePluginPage as Ref<UiContribution | null>,
    settingsInitialSection,
    activeCategory,
    activeFilter,
    songlistTransitionName,
    streamingMenuOpen,
    localMenuOpenBeforeStreaming,
    showStreamingSurface,
    localViewVisible,
    toggleStreamingMenu,
    collapseMenu,
    onSelectView,
    closePluginPage,
    onSelectPluginPage,
    openPlayingPage,
    closePlayingPage,
    enterStreamingMode,
    returnToLocalMode,
    openLoginPage,
    closeLoginPage,
    openSettingsPage,
    closeSettingsPage,
    openPlaybackSettings,
    openDspSettings,
    openPluginPage,
    hidePluginPage,
    openEqualizerPage,
    closeEqualizerPage,
    openDspRackPage,
    closeDspRackPage,
    closeMissingPluginPage,
    createToggleMenuHandler,
    createToggleSettingsHandler,
    createTogglePluginHandler
  }
}
