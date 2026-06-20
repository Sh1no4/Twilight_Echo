/**
 * Cover image loader.
 *
 * Track.cover stores a lightweight handle ("cover://<hash>.jpg") that Chromium
 * loads directly from disk via a custom protocol — no IPC, no base64, no LRU
 * cache needed. The browser manages decode caching natively.
 *
 * Backward compatible: data: URLs (old library) and http(s): URLs (plugins)
 * pass through directly.
 */

import { ref, type Ref, watch, type ComputedRef } from 'vue'

/**
 * Resolve a cover handle to a displayable image src.
 * - `null` / empty → returns null
 * - `cover://...` → returned as-is (Chromium handles via custom protocol)
 * - `data:...` / `http(s):...` → returned as-is
 */
export function resolveCover(handle: string | null | undefined): Promise<string | null> {
  if (!handle) return Promise.resolve(null)
  return Promise.resolve(handle)
}

/**
 * Vue composable: reactively resolve a cover handle.
 * Returns a ref that updates when the input changes.
 */
export function useCover(
  handleRef: ComputedRef<string | null | undefined> | Ref<string | null | undefined>
): Ref<string | null> {
  const resolved = ref<string | null>(null)

  watch(
    () => handleRef.value,
    (handle) => {
      resolved.value = handle ?? null
    },
    { immediate: true }
  )

  return resolved
}

/** Clear the cover cache (no-op — browser manages caching now). */
export function clearCoverCache(): void {
  // No-op: cover:// protocol is handled by Chromium's network stack
}
