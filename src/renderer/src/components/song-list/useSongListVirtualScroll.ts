import { computed, onMounted, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { Track } from '../../types/music'
import { getSongListVirtualRange } from './songListVirtualWindow'

type UseSongListVirtualScrollOptions = {
  displayTracks: ComputedRef<Track[]>
  resetSources: unknown[]
  shouldResetOnSearch: ComputedRef<boolean>
  debouncedSearchQuery: Ref<string>
}

const ROW_HEIGHT = 68

export function useSongListVirtualScroll({
  displayTracks,
  resetSources,
  shouldResetOnSearch,
  debouncedSearchQuery
}: UseSongListVirtualScrollOptions): {
  containerRef: Ref<HTMLElement | null>
  tbodyRef: Ref<HTMLElement | null>
  rowHeight: number
  visibleRange: ComputedRef<{ start: number; end: number }>
  visibleTracks: ComputedRef<Track[]>
  totalHeight: ComputedRef<number>
  paddingTop: ComputedRef<number>
  onScroll: (e: Event) => void
  onRowPointerMove: (event: PointerEvent) => void
  updateViewportHeight: () => void
  resetScrollAndMeasure: () => void
} {
  const containerRef = ref<HTMLElement | null>(null)
  const tbodyRef = ref<HTMLElement | null>(null)
  const scrollTop = ref(0)
  const viewportHeight = ref(0)
  const tableOffsetTop = ref(0)
  const rowHeight = ROW_HEIGHT
  let pointerMoveRafId: number | null = null
  let lastPointerEvent: PointerEvent | null = null

  const visibleRange = computed(() =>
    getSongListVirtualRange({
      trackCount: displayTracks.value.length,
      scrollTop: scrollTop.value,
      viewportHeight: viewportHeight.value,
      tableOffsetTop: tableOffsetTop.value,
      rowHeight
    })
  )

  const visibleTracks = computed(() => {
    return displayTracks.value.slice(visibleRange.value.start, visibleRange.value.end)
  })

  const totalHeight = computed(() => displayTracks.value.length * rowHeight)
  const paddingTop = computed(() => visibleRange.value.start * rowHeight)

  function onScroll(e: Event): void {
    const target = e.target as HTMLElement
    scrollTop.value = target.scrollTop
  }

  function flushPointerMove(): void {
    const event = lastPointerEvent
    pointerMoveRafId = null
    if (!event) return
    const row = event.currentTarget as HTMLElement
    const rect = row.getBoundingClientRect()
    row.style.setProperty('--track-pointer-x', `${event.clientX - rect.left}px`)
    row.style.setProperty('--track-pointer-y', `${event.clientY - rect.top}px`)
  }

  function onRowPointerMove(event: PointerEvent): void {
    lastPointerEvent = event
    if (pointerMoveRafId === null) {
      pointerMoveRafId = requestAnimationFrame(flushPointerMove)
    }
  }

  function updateViewportHeight(): void {
    if (containerRef.value) {
      viewportHeight.value = containerRef.value.clientHeight
    }
    if (containerRef.value && tbodyRef.value) {
      tableOffsetTop.value = tbodyRef.value.offsetTop
    } else {
      tableOffsetTop.value = 0
    }
  }

  function resetScrollAndMeasure(): void {
    if (containerRef.value) {
      containerRef.value.scrollTop = 0
    }
    scrollTop.value = 0
    requestAnimationFrame(updateViewportHeight)
  }

  onMounted(() => {
    updateViewportHeight()
    window.addEventListener('resize', updateViewportHeight)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', updateViewportHeight)
    if (pointerMoveRafId !== null) cancelAnimationFrame(pointerMoveRafId)
  })

  watch(resetSources, resetScrollAndMeasure, { flush: 'post' })

  watch(
    debouncedSearchQuery,
    () => {
      if (shouldResetOnSearch.value) {
        resetScrollAndMeasure()
      }
    },
    { flush: 'post' }
  )

  return {
    containerRef,
    tbodyRef,
    rowHeight,
    visibleRange,
    visibleTracks,
    totalHeight,
    paddingTop,
    onScroll,
    onRowPointerMove,
    updateViewportHeight,
    resetScrollAndMeasure
  }
}
