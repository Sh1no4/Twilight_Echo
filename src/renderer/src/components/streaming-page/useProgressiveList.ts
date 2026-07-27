import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'

// Progressive prefix rendering for long track lists: mount a bounded window and
// grow it while a sentinel row is within reach, instead of materializing
// thousands of rows in one shot. The window is always a prefix of the source,
// so row indices passed to selection/playback handlers stay valid.
export function useProgressiveList<T>(
  source: () => readonly T[],
  options: { initial?: number; step?: number } = {}
): {
  visibleItems: ComputedRef<T[]>
  hasMoreToRender: ComputedRef<boolean>
  sentinelRef: (el: unknown) => void
} {
  const initial = options.initial ?? 80
  const step = options.step ?? 80
  const visibleCount = ref(initial)
  const items = computed(source)

  watch(items, (next, prev) => {
    // A different list (new detail view) restarts the window; appends and
    // removals keep it, since the rendered prefix is still the same list.
    if (next[0] !== prev?.[0]) visibleCount.value = initial
  })

  const visibleItems = computed(() => items.value.slice(0, visibleCount.value))
  const hasMoreToRender = computed(() => visibleCount.value < items.value.length)

  let observer: IntersectionObserver | null = null
  let observed: Element | null = null

  function disconnect(): void {
    observer?.disconnect()
    observer = null
    observed = null
  }

  function sentinelRef(el: unknown): void {
    const element = el instanceof Element ? el : null
    if (element === observed) return
    disconnect()
    if (!element || typeof IntersectionObserver === 'undefined') return
    observed = element
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        visibleCount.value = Math.min(items.value.length, visibleCount.value + step)
        // Re-observe so the observer reports fresh state even when the sentinel
        // is still within range after the newly grown rows land.
        if (observer && observed) {
          observer.unobserve(observed)
          observer.observe(observed)
        }
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(element)
  }

  onBeforeUnmount(disconnect)

  return { visibleItems, hasMoreToRender, sentinelRef }
}
