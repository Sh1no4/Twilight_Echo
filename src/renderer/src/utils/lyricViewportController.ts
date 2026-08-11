import {
  requestAnimationFrameWithFallback,
  type AnimationFrameFallbackScheduler
} from './animationFrameFallback.ts'
import {
  computeLyricLayout,
  isLyricLineInSight,
  LYRIC_ALIGN_POSITION,
  LYRIC_SCALE_ACTIVE,
  type LyricAlignAnchor,
  type LyricLayoutLine
} from './lyricLineLayout.ts'
import {
  LYRIC_BG_SCALE_SPRING,
  LYRIC_POS_Y_SPRING,
  LYRIC_SCALE_SPRING,
  LyricSpring
} from './lyricSpring.ts'

/**
 * Owns lyric motion. The previous implementation animated `viewport.scrollTop`,
 * which forced every line to share one position and made Apple's cascade
 * mathematically impossible: a single scalar cannot express lines arriving at
 * different times. `scrollTop` also clamps at both ends and quantises to whole
 * pixels, so a spring driving it could never overshoot.
 *
 * Here each line is absolutely positioned and owns a `posY` and a `scale` spring.
 * One rAF loop advances them all. Manual browsing moves a `scrollOffset` that
 * feeds the layout instead of touching native scroll, so the container can stay
 * `overflow: hidden` and wheel handlers can stay passive.
 */

const FRAME_FALLBACK_MS = 120

/** Manual browsing releases back to follow after this long untouched. */
export const LYRIC_MANUAL_BROWSE_RESET_MS = 5000

export interface LyricRowElement {
  offsetHeight: number
  style: {
    setProperty(property: string, value: string): void
    removeProperty(property: string): void
  }
  isConnected?: boolean
}

export interface LyricStageElement {
  clientHeight: number
  clientWidth: number
}

export interface LyricViewportControllerOptions {
  /** Resolves once Vue has committed the timeline and rows are measurable. */
  afterLayout: () => Promise<void>
  onManualBrowseChange: (active: boolean) => void
  getActiveIndex?: () => number
  /** Presented (hot plus held) lines. Falls back to the active index. */
  getBufferedIndices?: () => ReadonlySet<number>
  alignPosition?: number
  alignAnchor?: LyricAlignAnchor
  /**
   * Vertical space at the bottom covered by an overlay such as the player bar,
   * which must not count as visible lyric area.
   */
  getBottomReservedPx?: () => number
  /** Motion preference. `false` snaps and skips blur, for reduced motion. */
  isSpringEnabled?: () => boolean
  isBlurEnabled?: () => boolean
  isScaleEnabled?: () => boolean
  isPlaying?: () => boolean
  isNonDynamic?: () => boolean
  getInterludeAfterIndex?: () => number | null
  getInterludeDotsHeight?: () => number
  /** Called with the dots position each frame, or `null` when hidden. */
  onInterludeDotsTop?: (top: number | null) => void
  frameScheduler?: AnimationFrameFallbackScheduler
}

export interface LyricFollowOptions {
  mode?: 'spring' | 'snap' | 'resize'
}

interface RowState {
  element: LyricRowElement
  posY: LyricSpring
  scale: LyricSpring
  height: number
  isBackground: boolean
  lastTop: number | null
  lastScale: number | null
  lastOpacity: number | null
  lastBlur: number | null
  inSight: boolean
}

/** Hidden windows pause rAF, so animating is pointless and drags on timers. */
function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function createLyricViewportController(options: LyricViewportControllerOptions) {
  const rows = new Map<number, RowState>()
  const alignPosition = options.alignPosition ?? LYRIC_ALIGN_POSITION
  const alignAnchor = options.alignAnchor ?? 'center'

  let stage: LyricStageElement | null = null
  let activeTrackId = ''
  let activation = 0
  let followRequest = 0
  let manualBrowse = false
  let manualBrowseTimer: number | null = null
  let scrollOffset = 0
  let scrollBoundary: [number, number] = [0, 0]
  let cancelFrame: (() => void) | null = null
  let cancelResize: (() => void) | null = null
  let lastFrameNow: number | null = null
  let interludeDotsTop: number | null = null

  const scheduler = options.frameScheduler
  const springEnabled = (): boolean => options.isSpringEnabled?.() ?? true

  const isCurrent = (token: number, request: number): boolean =>
    token === activation && request === followRequest && Boolean(activeTrackId)

  function setManualBrowse(next: boolean): void {
    if (manualBrowse === next) return
    manualBrowse = next
    options.onManualBrowseChange(next)
  }

  function clearManualBrowseTimer(): void {
    if (manualBrowseTimer == null) return
    if (scheduler) scheduler.clearTimeout(manualBrowseTimer)
    else if (typeof window !== 'undefined') window.clearTimeout(manualBrowseTimer)
    manualBrowseTimer = null
  }

  function bufferedIndices(): ReadonlySet<number> {
    const provided = options.getBufferedIndices?.()
    // An empty set is meaningful, not missing data: during an interlude nothing
    // is presented, and that is exactly when every line should soften.
    if (provided) return provided
    const active = options.getActiveIndex?.() ?? -1
    return active >= 0 ? new Set([active]) : new Set<number>()
  }

  function layoutLines(): LyricLayoutLine[] {
    const indices = [...rows.keys()].sort((left, right) => left - right)
    return indices.map((index) => {
      const row = rows.get(index) as RowState
      row.height = row.element.offsetHeight || row.height
      return { index, height: row.height, isBackground: row.isBackground }
    })
  }

  /** Recompute targets and hand each line its own spring target plus delay. */
  function applyLayout(force: boolean, isSeeking = false): void {
    if (!stage || rows.size === 0) return

    const result = computeLyricLayout({
      lines: layoutLines(),
      scrollToIndex: options.getActiveIndex?.() ?? 0,
      buffered: bufferedIndices(),
      viewportHeight: stage.clientHeight,
      viewportWidth: stage.clientWidth,
      alignPosition,
      alignAnchor,
      scrollOffset,
      bottomReservedPx: Math.max(0, options.getBottomReservedPx?.() ?? 0),
      isPlaying: options.isPlaying?.() ?? true,
      isSeeking: isSeeking || !springEnabled(),
      enableScale: options.isScaleEnabled?.() ?? true,
      enableBlur: options.isBlurEnabled?.() ?? true,
      isNonDynamic: options.isNonDynamic?.() ?? false,
      interludeAfterIndex: options.getInterludeAfterIndex?.() ?? null,
      interludeDotsHeight: options.getInterludeDotsHeight?.() ?? 0
    })

    scrollBoundary = result.scrollBoundary
    interludeDotsTop = result.interludeDotsTop
    options.onInterludeDotsTop?.(interludeDotsTop)

    const snap = force || !springEnabled() || isDocumentHidden()

    for (const target of result.lines) {
      const row = rows.get(target.index)
      if (!row) continue

      if (snap) {
        row.posY.setPosition(target.top)
        row.scale.setPosition(target.scale)
      } else {
        // The delay is the cascade: identical springs, staggered departures.
        row.posY.setTargetPosition(target.top, target.delay)
        row.scale.setTargetPosition(target.scale)
      }

      writeRowStatics(row, target.opacity, target.blur)
    }

    if (snap) commitRows()
    else scheduleFrame()
  }

  function writeRowStatics(row: RowState, opacity: number, blur: number): void {
    if (row.lastOpacity !== opacity) {
      row.lastOpacity = opacity
      row.element.style.setProperty('--lyric-line-opacity', opacity.toFixed(5))
    }
    const nextBlur = springEnabled() && (options.isBlurEnabled?.() ?? true) ? blur : 0
    if (row.lastBlur !== nextBlur) {
      row.lastBlur = nextBlur
      row.element.style.setProperty('--lyric-line-blur', `${nextBlur.toFixed(3)}px`)
    }
  }

  /** Write spring positions to the DOM, skipping lines outside the viewport. */
  function commitRows(): boolean {
    if (!stage) return true
    const viewportHeight = stage.clientHeight
    let settled = true

    for (const row of rows.values()) {
      row.element.style.setProperty('--lyric-line-ready', '1')
      const top = row.posY.getCurrentPosition()
      const scale = row.scale.getCurrentPosition()
      if (!row.posY.arrived() || !row.scale.arrived()) settled = false

      const inSight = isLyricLineInSight(top, row.height, viewportHeight)
      if (inSight !== row.inSight) {
        row.inSight = inSight
        row.element.style.setProperty('--lyric-line-in-sight', inSight ? '1' : '0')
      }
      if (!inSight) continue

      if (row.lastTop !== top || row.lastScale !== scale) {
        row.lastTop = top
        row.lastScale = scale
        row.element.style.setProperty('--lyric-line-top', `${top.toFixed(2)}px`)
        row.element.style.setProperty('--lyric-line-scale', (scale / 100).toFixed(5))
      }
    }

    return settled
  }

  function scheduleFrame(): void {
    if (cancelFrame || !springEnabled()) return
    cancelFrame = requestAnimationFrameWithFallback(
      (now) => {
        cancelFrame = null
        if (isDocumentHidden()) {
          for (const row of rows.values()) {
            row.posY.setPosition(row.posY.getTargetPosition())
            row.scale.setPosition(row.scale.getTargetPosition())
          }
          commitRows()
          lastFrameNow = null
          return
        }

        const delta = lastFrameNow == null ? 1 / 60 : Math.min(0.05, (now - lastFrameNow) / 1000)
        lastFrameNow = now
        for (const row of rows.values()) {
          row.posY.update(delta)
          row.scale.update(delta)
        }

        if (commitRows()) lastFrameNow = null
        else scheduleFrame()
      },
      FRAME_FALLBACK_MS,
      scheduler
    )
  }

  function cancelFollow(): void {
    followRequest += 1
    cancelFrame?.()
    cancelFrame = null
    lastFrameNow = null
  }

  function attach(element: LyricStageElement | null): void {
    stage = element
  }

  function detach(element?: LyricStageElement | null): void {
    if (!element || stage === element) stage = null
  }

  function activate(trackId: string): void {
    if (trackId === activeTrackId) return
    activation += 1
    cancelFollow()
    clearManualBrowseTimer()
    rows.clear()
    scrollOffset = 0
    activeTrackId = trackId
    setManualBrowse(false)
  }

  function registerRow(index: number, element: LyricRowElement | null, isBackground = false): void {
    if (!element) {
      const current = rows.get(index)
      // Vue can run an older ref callback after its replacement has registered.
      if (current && current.element.isConnected === true) return
      rows.delete(index)
      return
    }

    const existing = rows.get(index)
    if (existing && existing.element === element) {
      existing.isBackground = isBackground
      return
    }

    // A replacement row starts at the absolute-position default (y=0). Hide it
    // until the next committed layout has given it its own position so rapidly
    // switching tracks or seeking cannot briefly pile every new line together.
    element.style.setProperty('--lyric-line-ready', '0')

    rows.set(index, {
      element,
      posY: new LyricSpring(existing?.posY.getCurrentPosition() ?? 0, LYRIC_POS_Y_SPRING),
      scale: new LyricSpring(
        existing?.scale.getCurrentPosition() ?? LYRIC_SCALE_ACTIVE,
        isBackground ? LYRIC_BG_SCALE_SPRING : LYRIC_SCALE_SPRING
      ),
      height: element.offsetHeight || existing?.height || 0,
      isBackground,
      lastTop: null,
      lastScale: null,
      lastOpacity: null,
      lastBlur: null,
      inSight: true
    })
  }

  async function follow(index: number, followOptions: LyricFollowOptions = {}): Promise<void> {
    if (!activeTrackId || index < 0 || manualBrowse) return
    cancelFollow()
    const token = activation
    const request = followRequest
    const mode = followOptions.mode ?? 'spring'

    await options.afterLayout()
    if (!isCurrent(token, request) || manualBrowse || !stage) return
    applyLayout(mode === 'snap', mode === 'snap')
  }

  function recenter(mode: 'resize' | 'snap' = 'resize'): Promise<void> {
    const index = options.getActiveIndex?.() ?? -1
    // Plain/untimed lyrics intentionally have no active row. They still need a
    // committed layout, otherwise newly registered absolute rows would remain at
    // their default y=0 (and, during replacement, stay hidden forever).
    return follow(index >= 0 ? index : 0, { mode })
  }

  /**
   * Manual browsing. Takes a wheel or touch delta rather than reading native
   * scroll, which is what lets the stage stay `overflow: hidden` and the wheel
   * listener stay passive.
   */
  function browseBy(deltaY: number): void {
    if (!activeTrackId || !stage) return
    cancelFollow()
    setManualBrowse(true)
    scrollOffset = Math.min(scrollBoundary[1], Math.max(scrollBoundary[0], scrollOffset + deltaY))
    applyLayout(false)
    armManualBrowseRelease()
  }

  function armManualBrowseRelease(): void {
    clearManualBrowseTimer()
    const release = (): void => {
      manualBrowseTimer = null
      releaseManualBrowse()
    }
    manualBrowseTimer = scheduler
      ? scheduler.scheduleTimeout(release, LYRIC_MANUAL_BROWSE_RESET_MS)
      : typeof window !== 'undefined'
        ? window.setTimeout(release, LYRIC_MANUAL_BROWSE_RESET_MS)
        : null
  }

  function beginManualBrowse(): void {
    if (!activeTrackId || !stage) return
    cancelFollow()
    setManualBrowse(true)
    armManualBrowseRelease()
  }

  function releaseManualBrowse(): void {
    if (!manualBrowse) return
    clearManualBrowseTimer()
    setManualBrowse(false)
    scrollOffset = 0
    void recenter()
  }

  function onResize(): void {
    if (manualBrowse || cancelResize) return
    cancelResize = requestAnimationFrameWithFallback(
      () => {
        cancelResize = null
        if (!manualBrowse) void recenter()
      },
      FRAME_FALLBACK_MS,
      scheduler
    )
  }

  function dispose(): void {
    activation += 1
    cancelFollow()
    cancelResize?.()
    cancelResize = null
    clearManualBrowseTimer()
    rows.clear()
    stage = null
    scrollOffset = 0
    activeTrackId = ''
    setManualBrowse(false)
  }

  return {
    activate,
    attach,
    browseBy,
    beginManualBrowse,
    detach,
    dispose,
    follow,
    isManualBrowsing: () => manualBrowse,
    onResize,
    recenter,
    registerRow,
    releaseManualBrowse,
    trackId: () => activeTrackId,
    /** Test and diagnostic seams. */
    getRowTop: (index: number) => rows.get(index)?.posY.getCurrentPosition() ?? null,
    getRowScale: (index: number) => rows.get(index)?.scale.getCurrentPosition() ?? null,
    getRowTargetTop: (index: number) => rows.get(index)?.posY.getTargetPosition() ?? null,
    getScrollOffset: () => scrollOffset,
    getInterludeDotsTop: () => interludeDotsTop
  }
}
