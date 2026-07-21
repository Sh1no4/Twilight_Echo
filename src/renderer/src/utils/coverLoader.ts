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

  // Prefer the durable origin whenever it exists. Session restore / listening
  // stats keep coverSource across restarts while twilight-media tokens do not.
  if (source) {
    return grantRemoteCoverForDisplay(source)
  }

  if (!handle) return null
  const trimmed = handle.trim()
  if (!trimmed) return null

  // Local / data URLs never need a grant.
  if (
    /^cover:/i.test(trimmed) ||
    /^data:/i.test(trimmed) ||
    /^background:/i.test(trimmed) ||
    /^blob:/i.test(trimmed)
  ) {
    return trimmed
  }

  // Bare http(s) cover (legacy listening stats / older sessions): CSP blocks
  // direct https images, so re-grant into twilight-media.
  if (isDurableRemoteCoverSource(trimmed)) {
    return grantRemoteCoverForDisplay(trimmed)
  }

  // Live grant from the current process (no durable origin recorded yet).
  if (isTwilightMediaImageHandle(trimmed)) {
    return trimmed
  }

  return trimmed
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
      const hasDurable =
        typeof source === 'string' && isDurableRemoteCoverSource(source)
      // Optimistic: show a local/data/live grant immediately when no durable
      // re-grant is required. Durable sources always go through async grant.
      if (!hasDurable) {
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
