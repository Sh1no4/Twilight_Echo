import { requestAnimationFrameWithFallback } from './animationFrameFallback.ts'

export interface LyricViewport {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
  getBoundingClientRect?: () => { top: number }
}

export interface LyricViewportRow {
  offsetTop: number
  offsetHeight: number
  offsetParent: LyricViewportRow | LyricViewport | null
  getBoundingClientRect?: () => { top: number }
}

export interface LyricViewportControllerOptions {
  /** Resolves after Vue has committed the full lyric timeline and layout is measurable. */
  afterLayout: () => Promise<void>
  onManualBrowseChange: (active: boolean) => void
  getActiveIndex?: () => number
  scrollDurationMs?: number
  resizeScrollDurationMs?: number
  anchorRatio?: number
  /**
   * Vertical space at the bottom of the viewport that is covered by an overlay
   * (e.g. the player bar) and therefore must not count as visible lyric area.
   * Measured lazily so window/bar resize is picked up on the next follow.
   */
  getBottomReservedPx?: () => number
}

export interface LyricFollowOptions {
  durationMs?: number
}

const DEFAULT_SCROLL_DURATION_MS = 420
const DEFAULT_RESIZE_SCROLL_DURATION_MS = 260
const DEFAULT_ANCHOR_RATIO = 0.58
const FRAME_FALLBACK_MS = 120

/**
 * Keeps lyric-following ownership in one place. Every asynchronous layout
 * pass carries the active track and request token, so stale work cannot move a
 * newly mounted track's viewport.
 */
export function createLyricViewportController(options: LyricViewportControllerOptions) {
  const rows = new Map<number, LyricViewportRow>()
  const scrollDurationMs = options.scrollDurationMs ?? DEFAULT_SCROLL_DURATION_MS
  const resizeScrollDurationMs = options.resizeScrollDurationMs ?? DEFAULT_RESIZE_SCROLL_DURATION_MS
  const anchorRatio = options.anchorRatio ?? DEFAULT_ANCHOR_RATIO

  let viewport: LyricViewport | null = null
  let activeTrackId = ''
  let activation = 0
  let followRequest = 0
  let manualBrowse = false
  let cancelAnimation: (() => void) | null = null
  let cancelResize: (() => void) | null = null

  const isCurrent = (token: number, request: number): boolean =>
    token === activation && request === followRequest && Boolean(activeTrackId)

  function setManualBrowse(next: boolean): void {
    if (manualBrowse === next) return
    manualBrowse = next
    options.onManualBrowseChange(next)
  }

  function cancelFollow(): void {
    followRequest += 1
    cancelAnimation?.()
    cancelAnimation = null
  }

  function maxScrollTop(): number {
    return viewport ? Math.max(0, viewport.scrollHeight - viewport.clientHeight) : 0
  }

  function targetTop(index: number): number | null {
    const row = rows.get(index)
    if (!viewport || !row) return null

    const clientHeight = Math.max(
      0,
      viewport.clientHeight - Math.max(0, options.getBottomReservedPx?.() ?? 0)
    )
    let offsetTop = 0
    let current: LyricViewportRow | LyricViewport | null = row
    while (current && current !== viewport) {
      const currentRow = current as LyricViewportRow
      offsetTop += currentRow.offsetTop
      current = currentRow.offsetParent
    }
    if (current === viewport) {
      return Math.min(
        maxScrollTop(),
        Math.max(0, offsetTop - Math.max(0, clientHeight - row.offsetHeight) * anchorRatio)
      )
    }

    // Positioned lyric containers can sit outside the offset-parent chain.
    const viewportRect = viewport.getBoundingClientRect?.()
    const rowRect = row.getBoundingClientRect?.()
    if (
      viewportRect &&
      rowRect &&
      Number.isFinite(viewportRect.top) &&
      Number.isFinite(rowRect.top)
    ) {
      const rowTop = viewport.scrollTop + rowRect.top - viewportRect.top
      return Math.min(
        maxScrollTop(),
        Math.max(0, rowTop - Math.max(0, clientHeight - row.offsetHeight) * anchorRatio)
      )
    }

    return null
  }

  function animateTo(top: number, durationMs: number): void {
    if (!viewport) return
    cancelAnimation?.()
    cancelAnimation = null

    const startTop = viewport.scrollTop
    const distance = top - startTop
    if (durationMs <= 0 || Math.abs(distance) < 0.5) {
      viewport.scrollTop = top
      return
    }

    const startedAt = performance.now()
    const step = (now: number): void => {
      cancelAnimation = null
      if (!viewport) return
      const progress = Math.min(1, (now - startedAt) / durationMs)
      const eased = 1 - Math.pow(1 - progress, 3)
      viewport.scrollTop = startTop + distance * eased
      if (progress < 1) cancelAnimation = requestAnimationFrameWithFallback(step, FRAME_FALLBACK_MS)
      else viewport.scrollTop = top
    }
    cancelAnimation = requestAnimationFrameWithFallback(step, FRAME_FALLBACK_MS)
  }

  async function focusWhenReady(
    token: number,
    request: number,
    index: number,
    durationMs: number
  ): Promise<void> {
    await options.afterLayout()
    if (!isCurrent(token, request) || manualBrowse || !viewport) return
    const top = targetTop(index)
    if (top != null) animateTo(top, durationMs)
  }

  function attach(element: LyricViewport | null): void {
    viewport = element
  }

  function detach(element?: LyricViewport | null): void {
    if (!element || viewport === element) viewport = null
  }

  function activate(trackId: string): void {
    if (trackId === activeTrackId) return
    activation += 1
    cancelFollow()
    rows.clear()
    activeTrackId = trackId
    setManualBrowse(false)
    if (viewport) viewport.scrollTop = 0
  }

  function registerRow(index: number, row: LyricViewportRow | null): void {
    if (row) {
      rows.set(index, row)
      return
    }

    const current = rows.get(index)
    // Vue can run an older callback after a replacement ref has registered.
    if (
      current &&
      'isConnected' in current &&
      (current as LyricViewportRow & { isConnected?: unknown }).isConnected === true
    ) {
      return
    }
    rows.delete(index)
  }

  function follow(index: number, followOptions: LyricFollowOptions = {}): Promise<void> {
    if (!activeTrackId || index < 0 || manualBrowse) return Promise.resolve()
    cancelFollow()
    const token = activation
    const request = followRequest
    return focusWhenReady(token, request, index, followOptions.durationMs ?? scrollDurationMs)
  }

  function recenter(durationMs = resizeScrollDurationMs): Promise<void> {
    const index = options.getActiveIndex?.() ?? -1
    return index >= 0 ? follow(index, { durationMs }) : Promise.resolve()
  }

  function beginManualBrowse(): void {
    if (!activeTrackId || !viewport) return
    cancelFollow()
    setManualBrowse(true)
  }

  function releaseManualBrowse(): void {
    if (!manualBrowse) return
    setManualBrowse(false)
    void recenter(0)
  }

  function onResize(): void {
    if (manualBrowse || cancelResize) return
    cancelResize = requestAnimationFrameWithFallback(() => {
      cancelResize = null
      if (!manualBrowse) void recenter()
    }, FRAME_FALLBACK_MS)
  }

  function dispose(): void {
    activation += 1
    cancelFollow()
    cancelResize?.()
    cancelResize = null
    rows.clear()
    viewport = null
    activeTrackId = ''
    setManualBrowse(false)
  }

  return {
    activate,
    attach,
    detach,
    dispose,
    beginManualBrowse,
    follow,
    isManualBrowsing: () => manualBrowse,
    onResize,
    recenter,
    registerRow,
    releaseManualBrowse,
    trackId: () => activeTrackId
  }
}
