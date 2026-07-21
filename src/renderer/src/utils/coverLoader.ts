/**
 * Cover image loader.
 *
 * Track.cover stores a lightweight handle:
 * - `cover://<hash>.jpg` — Chromium loads cached local art via custom protocol
 * - `data:` — legacy embedded library covers
 * - `twilight-media://image/<token>` — in-memory remote-media grant (session-scoped)
 * - `http(s):` — rare pass-through when protection did not rewrite the field
 *
 * Remote provider covers are protected in main with a grant *and* a durable
 * `coverSource` (http/https). After process restart the grant map is empty, so
 * display paths re-issue a grant from `coverSource` before setting <img src>.
 */

import { ref, type Ref, watch, type ComputedRef } from 'vue'

const remoteCoverGrantCache = new Map<string, string>()
const remoteCoverGrantInflight = new Map<string, Promise<string | null>>()

function isTwilightMediaImageHandle(handle: string): boolean {
  return /^twilight-media:\/\/image\//i.test(handle.trim())
}

function isDurableRemoteCoverSource(source: string): boolean {
  return /^https?:\/\//i.test(source.trim())
}

/**
 * Resolve a cover handle to a displayable image src.
 * - `null` / empty → returns null (or re-grants from durableSource when present)
 * - `cover://...` / `data:` / `blob:` → returned as-is
 * - durable `coverSource` (http/https) → re-granted twilight-media URL (survives restart)
 * - bare http(s) `cover` (legacy stats) → re-granted for CSP (img-src has no https)
 * - live `twilight-media:` without durable origin → returned as-is
 */
export async function resolveCover(
  handle: string | null | undefined,
  durableSource?: string | null
): Promise<string | null> {
  const source =
    typeof durableSource === 'string' && isDurableRemoteCoverSource(durableSource)
      ? durableSource.trim()
      : null

  const trimmedHandle =
    typeof handle === 'string' && handle.trim() ? handle.trim() : null

  // Prefer the durable origin whenever it exists. Session restore / listening
  // stats keep coverSource across restarts while twilight-media tokens do not.
  // If re-grant fails (preload race, IPC error), fall back to a still-live handle
  // so covers do not blank out entirely.
  if (source) {
    const granted = await grantRemoteCoverForDisplay(source)
    if (granted) return granted
    if (trimmedHandle && isDisplayableCoverHandle(trimmedHandle)) {
      return trimmedHandle
    }
    return null
  }

  if (!trimmedHandle) return null

  // Local / data URLs never need a grant.
  if (isLocalCoverHandle(trimmedHandle)) {
    return trimmedHandle
  }

  // Bare http(s) cover (legacy listening stats / older sessions): CSP blocks
  // direct https images, so re-grant into twilight-media.
  if (isDurableRemoteCoverSource(trimmedHandle)) {
    const granted = await grantRemoteCoverForDisplay(trimmedHandle)
    if (granted) return granted
    return null
  }

  // Live grant from the current process (no durable origin recorded yet).
  if (isTwilightMediaImageHandle(trimmedHandle)) {
    return trimmedHandle
  }

  return trimmedHandle
}

function isLocalCoverHandle(handle: string): boolean {
  return (
    /^cover:/i.test(handle) ||
    /^data:/i.test(handle) ||
    /^background:/i.test(handle) ||
    /^blob:/i.test(handle)
  )
}

function isDisplayableCoverHandle(handle: string): boolean {
  return isLocalCoverHandle(handle) || isTwilightMediaImageHandle(handle)
}

async function grantRemoteCoverForDisplay(source: string): Promise<string | null> {
  const normalized = source.trim()
  if (!normalized) return null
  return ensureCachedRemoteGrant(normalized)
}

/** Drop a single origin from the grant cache so the next resolve re-issues a token. */
export function invalidateRemoteCoverGrant(source: string): void {
  const normalized = source.trim()
  if (!normalized) return
  remoteCoverGrantCache.delete(normalized)
  remoteCoverGrantInflight.delete(normalized)
}

async function ensureCachedRemoteGrant(source: string): Promise<string | null> {
  const normalized = source.trim()
  if (!normalized) return null
  const existing = remoteCoverGrantCache.get(normalized)
  if (existing) return existing

  const inflight = remoteCoverGrantInflight.get(normalized)
  if (inflight) return inflight

  const request = (async () => {
    try {
      const api = (
        globalThis as {
          window?: { api?: { data?: { grantRemoteCover?: (src: string) => Promise<string> } } }
        }
      ).window?.api?.data
      if (!api?.grantRemoteCover) return null
      const granted = await api.grantRemoteCover(normalized)
      if (typeof granted === 'string' && granted.trim()) {
        const token = granted.trim()
        remoteCoverGrantCache.set(normalized, token)
        // Bound memory — drop oldest entries when the cache grows large.
        if (remoteCoverGrantCache.size > 256) {
          const first = remoteCoverGrantCache.keys().next().value
          if (first) remoteCoverGrantCache.delete(first)
        }
        return token
      }
      return null
    } catch {
      return null
    } finally {
      remoteCoverGrantInflight.delete(normalized)
    }
  })()

  remoteCoverGrantInflight.set(normalized, request)
  return request
}

/** Clear re-grant cache (tests / after clear-cache). */
export function clearRemoteCoverGrantCache(): void {
  remoteCoverGrantCache.clear()
  remoteCoverGrantInflight.clear()
}

/**
 * Vue composable: reactively resolve a cover handle (and optional durable origin).
 * Returns a ref that updates when either input changes.
 */
export function useCover(
  handleRef: ComputedRef<string | null | undefined> | Ref<string | null | undefined>,
  sourceRef?: ComputedRef<string | null | undefined> | Ref<string | null | undefined>
): Ref<string | null> {
  const resolved = ref<string | null>(null)
  let requestId = 0

  watch(
    () => [handleRef.value, sourceRef?.value] as const,
    ([handle, source]) => {
      const id = ++requestId
      // Always paint a displayable handle immediately so track switches do not
      // keep the previous cover while an async re-grant is in flight.
      if (
        handle &&
        (/^cover:/i.test(handle) ||
          /^data:/i.test(handle) ||
          /^twilight-media:/i.test(handle) ||
          /^blob:/i.test(handle) ||
          /^background:/i.test(handle))
      ) {
        resolved.value = handle
      } else if (!handle && !source) {
        resolved.value = null
      }

      void resolveCover(handle, source).then((next) => {
        if (id !== requestId) return
        resolved.value = next
      })
    },
    { immediate: true }
  )

  return resolved
}

/** Clear the cover cache (no-op for cover:// — browser manages caching now). */
export function clearCoverCache(): void {
  clearRemoteCoverGrantCache()
}
