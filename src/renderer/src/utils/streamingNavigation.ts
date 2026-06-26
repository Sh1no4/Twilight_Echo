export function shouldShowBilibiliViewForSidebarProvider(provider: string): boolean {
  return provider === 'bili'
}

export function isSidebarItemActiveForProvider({
  itemProvider,
  itemKey,
  activeProvider,
  activeTab,
  showBilibiliView
}: {
  itemProvider: string
  itemKey: string
  activeProvider: string
  activeTab: string
  showBilibiliView: boolean
}): boolean {
  if (itemProvider === 'bili') {
    return showBilibiliView
  }
  if (showBilibiliView) return false
  if (itemProvider === 'ncm') {
    return activeProvider === 'ncm' && activeTab === itemKey
  }
  return activeProvider === itemProvider
}
