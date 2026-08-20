import { ref, type Ref } from 'vue'

export interface SideMenuClearanceOptions {
  showLocalSidebar: Ref<boolean>
  hasPlayerBar: Ref<boolean>
  menuOpen: Ref<boolean>
}

const SIDE_MENU_OVERLAP_GAP = 10

export function useSideMenuClearance(options: SideMenuClearanceOptions) {
  const sideMenuBottomOffset = ref(0)
  let sideMenuMonitorFrame: number | null = null
  let resizeObserver: ResizeObserver | null = null
  let playbarMutationObserver: MutationObserver | null = null
  let observedSideMenu: HTMLElement | null = null
  let observedPlayerBar: HTMLElement | null = null

  function setSideMenuBottomOffset(offset: number): void {
    const nextOffset = Math.max(0, Math.round(offset))
    if (sideMenuBottomOffset.value !== nextOffset) {
      sideMenuBottomOffset.value = nextOffset
    }
  }

  function measureSideMenuClearance(): void {
    if (!options.showLocalSidebar.value || !options.hasPlayerBar.value) {
      setSideMenuBottomOffset(0)
      return
    }

    const sideMenu = document.querySelector<HTMLElement>('.side-menu')
    const playerBar = document.querySelector<HTMLElement>('.player-bar-shell')

    if (!sideMenu || !playerBar) {
      setSideMenuBottomOffset(0)
      return
    }

    // An auto-hidden mini bar is translated out of view but keeps its layout box,
    // so its rect would still push the sidebar up. The shell flags the state.
    if (playerBar.dataset.tePlaybarHidden === 'true') {
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

    setSideMenuBottomOffset(window.innerHeight - playerBarRect.top + SIDE_MENU_OVERLAP_GAP)
  }

  function stopSideMenuMonitor(): void {
    if (sideMenuMonitorFrame !== null) {
      cancelAnimationFrame(sideMenuMonitorFrame)
      sideMenuMonitorFrame = null
    }
  }

  function observeGeometry(): void {
    const sideMenu = document.querySelector<HTMLElement>('.side-menu')
    const playerBar = document.querySelector<HTMLElement>('.player-bar-shell')
    if (sideMenu === observedSideMenu && playerBar === observedPlayerBar) return

    observedSideMenu = sideMenu
    observedPlayerBar = playerBar
    resizeObserver?.disconnect()
    playbarMutationObserver?.disconnect()

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => scheduleMeasure())
      if (sideMenu) resizeObserver.observe(sideMenu)
      if (playerBar) resizeObserver.observe(playerBar)
    }
    if (typeof MutationObserver !== 'undefined' && playerBar) {
      playbarMutationObserver = new MutationObserver(() => scheduleMeasure())
      playbarMutationObserver.observe(playerBar, {
        attributes: true,
        attributeFilter: ['class', 'data-te-playbar-hidden', 'data-te-playbar-visibility']
      })
    }
  }

  function scheduleMeasure(): void {
    if (document.hidden || sideMenuMonitorFrame !== null) return
    sideMenuMonitorFrame = requestAnimationFrame(() => {
      sideMenuMonitorFrame = null
      measureSideMenuClearance()
      observeGeometry()
    })
  }

  function startSideMenuMonitor(): void {
    if (document.hidden) return
    observeGeometry()
    scheduleMeasure()
  }

  function resetSideMenuClearance(): void {
    stopSideMenuMonitor()
    setSideMenuBottomOffset(0)
  }

  function onDocumentVisibilityChange(): void {
    if (document.hidden) {
      stopSideMenuMonitor()
      return
    }
    startSideMenuMonitor()
  }

  const onWindowResize = (): void => scheduleMeasure()
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', onWindowResize)
  }
  document.addEventListener('visibilitychange', onDocumentVisibilityChange)

  return {
    sideMenuBottomOffset,
    startSideMenuMonitor,
    stopSideMenuMonitor,
    resetSideMenuClearance,
    measureSideMenuClearance,
    dispose: () => {
      stopSideMenuMonitor()
      resizeObserver?.disconnect()
      playbarMutationObserver?.disconnect()
      resizeObserver = null
      playbarMutationObserver = null
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', onWindowResize)
      }
      document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
    }
  }
}
