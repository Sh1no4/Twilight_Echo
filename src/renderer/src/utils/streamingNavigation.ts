export type StreamingTabKey = 'home' | 'discover' | 'library' | 'recent'

export interface StreamingNavigationProvider {
  id: string
  name: string
  capabilities: string[]
  ui?: {
    icon?: string
    streamingLibraryTab?: boolean
    unifiedLibrary?: boolean
  }
}

export interface StreamingSidebarItem {
  key: string
  provider: string
  label: string
  icon: string
  tab?: StreamingTabKey
}

const NCM_PROVIDER_ID = 'ncm'

export function getUnifiedLibraryProviders({
  ncmAvailable,
  providers
}: {
  ncmAvailable: boolean
  providers: StreamingNavigationProvider[]
}): Array<{ id: string; name: string; icon: string }> {
  const list: Array<{ id: string; name: string; icon: string }> = []
  if (ncmAvailable) {
    list.push({ id: NCM_PROVIDER_ID, name: '网易云音乐', icon: 'pi pi-cloud' })
  }
  for (const provider of providers) {
    if (provider.id === NCM_PROVIDER_ID) continue
    if (provider.capabilities.includes('library') && provider.ui?.unifiedLibrary === true) {
      list.push({
        id: provider.id,
        name: provider.name,
        icon: provider.ui?.icon || 'pi pi-music'
      })
    }
  }
  return list
}

export function buildStreamingSidebarItems({
  ncmAvailable,
  providers
}: {
  ncmAvailable: boolean
  providers: StreamingNavigationProvider[]
}): StreamingSidebarItem[] {
  const items: StreamingSidebarItem[] = []
  if (ncmAvailable) {
    items.push({
      key: 'home',
      provider: NCM_PROVIDER_ID,
      label: '主页',
      icon: 'pi pi-sparkles',
      tab: 'home'
    })
    items.push({
      key: 'discover',
      provider: NCM_PROVIDER_ID,
      label: '发现歌单',
      icon: 'pi pi-th-large',
      tab: 'discover'
    })
  }
  if (getUnifiedLibraryProviders({ ncmAvailable, providers }).length > 0) {
    items.push({
      key: 'library',
      provider: NCM_PROVIDER_ID,
      label: '音乐库',
      icon: 'pi pi-heart',
      tab: 'library'
    })
    items.push({
      key: 'recent',
      provider: NCM_PROVIDER_ID,
      label: '最近播放',
      icon: 'pi pi-history',
      tab: 'recent'
    })
  }
  for (const provider of providers) {
    if (provider.id === NCM_PROVIDER_ID) continue
    if (
      provider.capabilities.includes('library') &&
      provider.ui?.unifiedLibrary !== true &&
      provider.ui?.streamingLibraryTab !== false
    ) {
      items.push({
        key: `${provider.id}-library`,
        provider: provider.id,
        label: provider.name,
        icon: provider.ui?.icon || 'pi pi-music'
      })
    }
  }
  return items
}

export function getFirstVisibleStreamingTab(items: StreamingSidebarItem[]): StreamingTabKey | null {
  return items.find((item) => item.tab)?.tab ?? null
}

export function hasStreamingSidebarEntries(items: StreamingSidebarItem[]): boolean {
  return items.length > 0
}

export function isSidebarItemActiveForProvider({
  itemProvider,
  itemKey,
  activeProvider,
  activeTab
}: {
  itemProvider: string
  itemKey: string
  activeProvider: string
  activeTab: string
}): boolean {
  if (itemProvider === 'ncm') {
    return activeProvider === 'ncm' && activeTab === itemKey
  }
  return activeProvider === itemProvider
}
