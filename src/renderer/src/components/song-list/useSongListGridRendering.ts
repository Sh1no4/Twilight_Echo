import { computed, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import { filterLocalGridItems } from '../../utils/localLibrarySearch'
import type { GridItem, LocalTransitionName } from './types'

type IdleDeadlineLike = {
  didTimeout: boolean
  timeRemaining: () => number
}

type RequestIdleCallbackLike = (
  callback: (deadline: IdleDeadlineLike) => void,
  options?: { timeout?: number }
) => number

type CancelIdleCallbackLike = (handle: number) => void

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: RequestIdleCallbackLike
  cancelIdleCallback?: CancelIdleCallbackLike
}

type UseSongListGridRenderingOptions = {
  category: () => string
  filter: () => string | null
  transitionName: () => 'page-down' | 'page-up'
  debouncedSearchQuery: ComputedRef<string> | { value: string }
  currentGridItems: ComputedRef<GridItem[]>
  showGrid: ComputedRef<boolean>
  updateViewportHeight: () => void
}

const GRID_BATCH_SIZE = 16
const GRID_IDLE_BATCH_SIZE = 24

export function useSongListGridRendering({
  category,
  filter,
  transitionName,
  debouncedSearchQuery,
  currentGridItems,
  showGrid,
  updateViewportHeight
}: UseSongListGridRenderingOptions): {
  renderedGridCount: Ref<number>
  filteredGridItems: ComputedRef<GridItem[]>
  visibleGridItems: ComputedRef<GridItem[]>
  gridTotalCount: ComputedRef<number>
  visibleArtists: ComputedRef<GridItem[]>
  visibleAlbums: ComputedRef<GridItem[]>
  visiblePlaylists: ComputedRef<GridItem[]>
  visibleFolders: ComputedRef<GridItem[]>
  localTransitionName: ComputedRef<LocalTransitionName>
  viewKey: ComputedRef<string>
  isSwitching: Ref<boolean>
  onViewBeforeLeave: () => void
  finishViewSwitch: () => void
} {
  const renderedGridCount = ref(GRID_BATCH_SIZE)
  const isSwitching = ref(false)
  let gridRenderIdleId: number | null = null
  let gridRenderTimer: number | null = null
  let lastGridRenderKey = ''

  const filteredGridItems = computed(() =>
    filterLocalGridItems(currentGridItems.value, debouncedSearchQuery.value)
  )
  const visibleGridItems = computed(() => filteredGridItems.value.slice(0, renderedGridCount.value))
  const gridTotalCount = computed(() => filteredGridItems.value.length)
  const visibleArtists = computed(() => (category() === 'artists' ? visibleGridItems.value : []))
  const visibleAlbums = computed(() => (category() === 'albums' ? visibleGridItems.value : []))
  const visiblePlaylists = computed(() =>
    category() === 'playlists' ? visibleGridItems.value : []
  )
  const visibleFolders = computed(() => (category() === 'folders' ? visibleGridItems.value : []))
  const localTransitionName = computed<LocalTransitionName>(() =>
    transitionName() === 'page-up' ? 'local-page-up' : 'local-page-down'
  )
  const viewKey = computed(() =>
    showGrid.value ? `grid-${category()}` : `table-${category()}-${filter() ?? 'root'}`
  )

  function stopGridRendering(): void {
    if (gridRenderIdleId !== null) {
      const idleWindow = window as WindowWithIdleCallback
      idleWindow.cancelIdleCallback?.(gridRenderIdleId)
      gridRenderIdleId = null
    }
    if (gridRenderTimer !== null) {
      window.clearTimeout(gridRenderTimer)
      gridRenderTimer = null
    }
  }

  function scheduleGridPump(callback: () => void): void {
    const idleWindow = window as WindowWithIdleCallback
    if (idleWindow.requestIdleCallback) {
      gridRenderIdleId = idleWindow.requestIdleCallback(
        () => {
          gridRenderIdleId = null
          callback()
        },
        { timeout: 180 }
      )
      return
    }

    gridRenderTimer = window.setTimeout(() => {
      gridRenderTimer = null
      callback()
    }, 48)
  }

  function pumpGridRendering(total: number): void {
    if (!showGrid.value) {
      stopGridRendering()
      return
    }

    renderedGridCount.value = Math.min(renderedGridCount.value + GRID_IDLE_BATCH_SIZE, total)
    if (renderedGridCount.value < total) {
      scheduleGridPump(() => pumpGridRendering(total))
    }
  }

  function startGridRendering(total: number, deferRest = false): void {
    stopGridRendering()
    renderedGridCount.value = Math.min(GRID_BATCH_SIZE, total)
    if (total <= GRID_BATCH_SIZE || deferRest || isSwitching.value) return

    scheduleGridPump(() => pumpGridRendering(total))
  }

  watch(
    [category, filter, gridTotalCount],
    () => {
      if (!showGrid.value) {
        stopGridRendering()
        return
      }

      const nextGridRenderKey = viewKey.value
      const deferRest = lastGridRenderKey !== '' && lastGridRenderKey !== nextGridRenderKey
      lastGridRenderKey = nextGridRenderKey
      startGridRendering(gridTotalCount.value, deferRest)
    },
    { immediate: true, flush: 'post' }
  )

  function onViewBeforeLeave(): void {
    isSwitching.value = true
    stopGridRendering()
  }

  function finishViewSwitch(): void {
    isSwitching.value = false
    if (showGrid.value) {
      startGridRendering(gridTotalCount.value)
    } else {
      requestAnimationFrame(updateViewportHeight)
    }
  }

  onUnmounted(stopGridRendering)

  return {
    renderedGridCount,
    filteredGridItems,
    visibleGridItems,
    gridTotalCount,
    visibleArtists,
    visibleAlbums,
    visiblePlaylists,
    visibleFolders,
    localTransitionName,
    viewKey,
    isSwitching,
    onViewBeforeLeave,
    finishViewSwitch
  }
}
