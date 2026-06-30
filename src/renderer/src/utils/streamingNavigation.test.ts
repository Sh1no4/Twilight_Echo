import assert from 'node:assert/strict'
import test from 'node:test'

const {
  buildStreamingSidebarItems,
  getFirstVisibleStreamingTab,
  hasStreamingSidebarEntries,
  isSidebarItemActiveForProvider,
  shouldShowBilibiliViewForSidebarProvider
} = (await import(new URL('./streamingNavigation.ts', import.meta.url).href)) as typeof import(
  './streamingNavigation'
)

test('selecting a non-Bilibili sidebar item exits the dedicated Bilibili page', () => {
  assert.equal(shouldShowBilibiliViewForSidebarProvider('bili'), true)
  assert.equal(shouldShowBilibiliViewForSidebarProvider('ncm'), false)
  assert.equal(shouldShowBilibiliViewForSidebarProvider('ytmusic'), false)
})

test('dedicated Bilibili page suppresses stale NetEase sidebar active state', () => {
  assert.equal(
    isSidebarItemActiveForProvider({
      itemProvider: 'ncm',
      itemKey: 'home',
      activeProvider: 'ncm',
      activeTab: 'home',
      showBilibiliView: true
    }),
    false
  )
  assert.equal(
    isSidebarItemActiveForProvider({
      itemProvider: 'bili',
      itemKey: 'bili-library',
      activeProvider: 'ncm',
      activeTab: 'home',
      showBilibiliView: true
    }),
    true
  )
})

test('keeps shared music library visible when a unified provider is enabled without NetEase', () => {
  const items = buildStreamingSidebarItems({
    ncmAvailable: false,
    providers: [
      {
        id: 'ytmusic',
        name: 'YouTube Music',
        capabilities: ['library'],
        ui: { icon: 'pi pi-youtube', unifiedLibrary: true }
      }
    ]
  })

  assert.deepEqual(items, [
    {
      key: 'library',
      provider: 'ncm',
      label: '音乐库',
      icon: 'pi pi-heart',
      tab: 'library'
    }
  ])
  assert.equal(getFirstVisibleStreamingTab(items), 'library')
  assert.equal(hasStreamingSidebarEntries(items), true)
})

test('hides shared home and library when no enabled provider can back them', () => {
  const items = buildStreamingSidebarItems({
    ncmAvailable: false,
    providers: []
  })

  assert.deepEqual(items, [])
  assert.equal(getFirstVisibleStreamingTab(items), null)
  assert.equal(hasStreamingSidebarEntries(items), false)
})

test('keeps independent provider library entries outside the unified library', () => {
  const items = buildStreamingSidebarItems({
    ncmAvailable: false,
    providers: [
      {
        id: 'bili',
        name: 'Bilibili',
        capabilities: ['library'],
        ui: { icon: 'pi pi-video' }
      }
    ]
  })

  assert.deepEqual(items, [
    {
      key: 'bili-library',
      provider: 'bili',
      label: 'Bilibili',
      icon: 'pi pi-video'
    }
  ])
  assert.equal(getFirstVisibleStreamingTab(items), null)
  assert.equal(hasStreamingSidebarEntries(items), true)
})
