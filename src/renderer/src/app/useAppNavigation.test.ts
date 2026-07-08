import assert from 'node:assert/strict'
import test from 'node:test'

const { useAppNavigation } = (await import(
  new URL('./useAppNavigation.ts', import.meta.url).href
)) as typeof import('./useAppNavigation')

test('streaming mode preserves and restores local menu state', () => {
  const navigation = useAppNavigation()

  navigation.menuOpen.value = true
  navigation.enterStreamingMode()

  assert.equal(navigation.showStreamingPage.value, true)
  assert.equal(navigation.menuOpen.value, false)
  assert.equal(navigation.localMenuOpenBeforeStreaming.value, true)

  navigation.returnToLocalMode()

  assert.equal(navigation.showStreamingPage.value, false)
  assert.equal(navigation.streamingMenuOpen.value, false)
  assert.equal(navigation.menuOpen.value, true)
})

test('settings, plugin, equalizer, and extension pages are mutually exclusive', () => {
  const navigation = useAppNavigation()
  const page = {
    pluginId: 'com.example.tool',
    id: 'tool-page',
    kind: 'sidebarPage',
    title: 'Tool',
    command: 'tool.open'
  } as const

  navigation.enterStreamingMode()
  navigation.openSettingsPage('dsp')
  assert.equal(navigation.showSettingsPage.value, true)
  assert.equal(navigation.showStreamingPage.value, true)
  assert.equal(navigation.showPluginPage.value, false)

  navigation.openPluginPage()
  assert.equal(navigation.showPluginPage.value, true)
  assert.equal(navigation.showSettingsPage.value, false)
  assert.equal(navigation.showEqualizerPage.value, false)

  navigation.openEqualizerPage()
  assert.equal(navigation.showEqualizerPage.value, true)
  assert.equal(navigation.showPluginPage.value, false)

  navigation.onSelectPluginPage(page)
  assert.deepEqual(navigation.activePluginPage.value, page)
  assert.equal(navigation.showStreamingPage.value, false)
  assert.equal(navigation.showEqualizerPage.value, false)
  assert.equal(navigation.showPluginPage.value, false)
})

test('active plugin extension page closes when its contribution disappears', () => {
  const navigation = useAppNavigation()
  const page = {
    pluginId: 'com.example.tool',
    id: 'tool-page',
    kind: 'sidebarPage',
    title: 'Tool',
    command: 'tool.open'
  } as const

  navigation.onSelectPluginPage(page)
  navigation.closeMissingPluginPage([])

  assert.equal(navigation.activePluginPage.value, null)
})

test('login page can open with an initial streaming provider', () => {
  const navigation = useAppNavigation()

  navigation.enterStreamingMode()
  navigation.openLoginPage('ncm')

  assert.equal(navigation.showLoginPage.value, true)
  assert.equal(navigation.showStreamingPage.value, false)
  assert.equal(navigation.loginInitialProviderId.value, 'ncm')

  navigation.closeLoginPage()

  assert.equal(navigation.showLoginPage.value, false)
  assert.equal(navigation.showStreamingPage.value, true)
  assert.equal(navigation.loginInitialProviderId.value, null)
})
