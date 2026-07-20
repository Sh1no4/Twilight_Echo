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

  function startSideMenuMonitor(): void {
    if (document.hidden) return
    if (sideMenuMonitorFrame !== null) return

    const tick = (): void => {
      measureSideMenuClearance()
      if (
        options.showLocalSidebar.value &&
        options.hasPlayerBar.value &&
        (options.menuOpen.value || sideMenuBottomOffset.value > 0)
      ) {
        sideMenuMonitorFrame = requestAnimationFrame(tick)
        return
      }
      sideMenuMonitorFrame = null
    }

    sideMenuMonitorFrame = requestAnimationFrame(tick)
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

  document.addEventListener('visibilitychange', onDocumentVisibilityChange)

  return {
    sideMenuBottomOffset,
    startSideMenuMonitor,
    stopSideMenuMonitor,
    resetSideMenuClearance,
    measureSideMenuClearance,
    dispose: () => document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
  }
}
