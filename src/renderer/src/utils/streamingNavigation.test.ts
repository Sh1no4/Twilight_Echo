import assert from 'node:assert/strict'
import test from 'node:test'

const { isSidebarItemActiveForProvider, shouldShowBilibiliViewForSidebarProvider } = (await import(
  new URL('./streamingNavigation.ts', import.meta.url).href
)) as typeof import('./streamingNavigation')

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
