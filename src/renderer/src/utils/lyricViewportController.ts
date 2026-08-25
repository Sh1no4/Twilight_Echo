import {
  requestAnimationFrameWithFallback,
  type AnimationFrameFallbackScheduler
} from './animationFrameFallback.ts'
import {
  computeLyricLayout,
  isLyricLineInSight,
  LYRIC_ALIGN_POSITION,
  LYRIC_ALPHA_AUX_CURRENT,
  LYRIC_ALPHA_AUX_INACTIVE,
  LYRIC_BLUR_CUTOFF,
  type LyricAlignAnchor,
  type LyricLayoutLine
} from './lyricLineLayout.ts'
import {
  clamp,
  criticalRetune,
  criticalRetuneByPeriod,
  frameDeltaSeconds,
  LYRIC_ACTIVITY_SPRING_ENTER,
  LYRIC_ACTIVITY_SPRING_INIT,
  LYRIC_BLUR_RESTART_THRESHOLD,
  LYRIC_DRAG_INPUT_GAIN,
  LYRIC_DRAG_RESPONSE_RATE,
  LYRIC_DRAG_SNAP_PX,
  LYRIC_INTERACTION_BLEND_RATE,
  LYRIC_INTERACTION_BLEND_SNAP,
  LYRIC_LN_1_PERCENT,
  LYRIC_MAX_FRAME_SECONDS,
  LYRIC_OPACITY_RESTART_THRESHOLD,
  LYRIC_SPRING_INIT_ONCE,
  LYRIC_SPRING_LINE,
  LYRIC_SPRING_PRESS,
  LYRIC_SPRING_RELEASE,
  LYRIC_SPRING_SEEK_SHORT,
  LYRIC_TARGET_SCALE_CHANGE_GATE,
  LYRIC_TARGET_Y_CHANGE_GATE,
  LyricBezierTransition,
  LyricLowPass,
  LyricSpring,
  type LyricSpringParams
} from './lyricMotion.ts'
import {
  createLyricActiveLineSelector,
  type LyricActiveLineReading,
  type LyricActiveLineSelector
} from './lyricActiveLineSelector.ts'
import {
  findLyricInterlude,
  type LyricInterlude,
  type LyricTimelineEntry
} from './lyricTimeline.ts'

/**
 * Owns lyric motion (report sections 1-7 and 12). Each line is absolutely
 * positioned and carries its own springs: Y and overall scale on the shared
 * line spring with cascade delays, opacity and blur on 0.12s beziers, a press
 * scale spring per row, and an activity spring for auxiliary rows. One rAF
 * loop advances every channel, detects seeks from the playback clock,
 * advances the active-line selector and pre-tunes the upcoming line's springs
 * so it glides into focus just before it is sung.
 *
 * Manual browsing never touches the springs while it lasts: the drag offset
 * lives in its own low-pass and is folded into the Y springs only when the
 * browse ends. The interaction blend fades the depth blur out while the user
 * is reading, and back in afterwards.
 */

const FRAME_FALLBACK_MS = 120

/** Manual browsing releases back to follow after this long untouched. */
export const LYRIC_MANUAL_BROWSE_RESET_MS = 1500

/** Playback-clock discontinuity gates (report section 2.1), all strict. */
export const LYRIC_SEEK_DISCONTINUITY_SECONDS = 1.5
export const LYRIC_SEEK_BACKWARD_SECONDS = 1.0
export const LYRIC_SEEK_OLD_TIME_FLOOR_SECONDS = 5.0
export const LYRIC_SEEK_OLD_TIME_RATIO = 0.1
export const LYRIC_SEEK_HARD_GAP_SECONDS = 2.0

/** Seek classification gates (report section 2.3), strict. */
export const LYRIC_SEEK_LINE_DISTANCE = 3
export const LYRIC_SEEK_TIME_DISTANCE_SECONDS = 2.0

/** Near-line retune windows (report section 2.5), strict. */
export const LYRIC_RETUNE_NEAR_SECONDS = 1.1
export const LYRIC_RETUNE_PREDICT_WINDOW_SECONDS = 0.8
export const LYRIC_RETUNE_BUDGET_SLACK_SECONDS = 0.05
export const LYRIC_RETUNE_MIN_SECONDS = 0.3
/** The loop may idle once the next line is this far away. */
export const LYRIC_LOOP_IDLE_MARGIN_SECONDS = 1.35

/** Auxiliary-row activity exit: critically damped over the queue budget. */
const ACTIVITY_EXIT_PERIOD_SECONDS = 0.6

export interface LyricRowElement {
  offsetHeight: number
  scrollHeight?: number
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
  /** Timeline entries for the active track. */
  getTimeline: () => readonly LyricTimelineEntry[]
  /** Continuous playback position estimate, in seconds. */
  getPlaybackTime: () => number
  /** Whether playback is running; idles the steady loop when not. */
  isPlaying: () => boolean
  /** Fires with the active queue whenever the selector promotes or drops. */
  onActiveLinesChange?: (queue: readonly number[]) => void
  /** Fires when a new interlude record is discovered, or null when none. */
  onInterlude?: (interlude: LyricInterlude | null) => void
  /** Called with the dots position each layout, or `null` when hidden. */
  onInterludeDotsTop?: (top: number | null) => void
  alignPosition?: number
  /** Read per layout; takes precedence over `alignPosition`. */
  getAlignPosition?: () => number
  alignAnchor?: LyricAlignAnchor
  /** Vertical space covered by an overlay such as the player bar. */
  getBottomReservedPx?: () => number
  /** Visual breathing room between rows, in px. */
  getRowGapPx?: () => number
  /** Device scale feeding the manual-drag input gain. */
  getDeviceScale?: () => number
  /** Motion preference. `false` snaps and skips blur, for reduced motion. */
  isSpringEnabled?: () => boolean
  isBlurEnabled?: () => boolean
  isScaleEnabled?: () => boolean
  /** Line indices the focus window keeps, or `null` for the whole timeline. */
  getFocusWindow?: () => ReadonlySet<number> | null
  /** Opacity multiplier for lines outside the active queue, 0-1. */
  getInactiveDim?: () => number
  getScaleIntensity?: () => number
  getBlurIntensity?: () => number
  getCascadeSpeedFactor?: () => number
  shouldHidePassedLines?: () => boolean
  getInterludeAfterIndex?: () => number | null
  getInterludeDotsHeight?: () => number
  frameScheduler?: AnimationFrameFallbackScheduler
  /** Active-queue cap for the selector; clamped to 0..3. */
  maxActiveLines?: number
}

interface RowState {
  element: LyricRowElement
  posY: LyricSpring
  scale: LyricSpring
  alpha: LyricBezierTransition
  blur: LyricBezierTransition
  /** Auxiliary rows blend their opacity through the activity spring. */
  activity: LyricSpring | null
  activityTouched: boolean
  clickScale: LyricSpring
  pressed: boolean
  height: number
  isBackground: boolean
  lastTop: number | null
  lastScale: number | null
  lastOpacity: number | null
  lastBlur: number | null
  lastPress: number | null
  lastIntrinsicHeight: number | null
  ready: boolean
  inSight: boolean
}

/** Hidden windows pause rAF, so animating is pointless and drags on timers. */
function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function createLyricViewportController(options: LyricViewportControllerOptions) {
  const rows = new Map<number, RowState>()
  const fallbackAlignPosition = options.alignPosition ?? LYRIC_ALIGN_POSITION
  const alignAnchor = options.alignAnchor ?? 'center'
  const scheduler = options.frameScheduler

  let stage: LyricStageElement | null = null
  let activeTrackId = ''
  let activation = 0
  let manualBrowse = false
  let manualBrowseTimer: number | null = null
  let targetOffset = 0
  let dragOffset = 0
  const dragLowPass = new LyricLowPass(0)
  const blendLowPass = new LyricLowPass(0)
  let scrollBoundary: [number, number] = [0, 0]
  let cancelFrame: (() => void) | null = null
  let cancelWake: (() => void) | null = null
  let cancelResize: (() => void) | null = null
  let lastFrameNow: number | null = null
  let hasCommittedLayout = false
  let initOncePending = false
  let selector: LyricActiveLineSelector = createLyricActiveLineSelector({
    maxActiveLines: options.maxActiveLines
  })
  let activeQueue: number[] = []
  let anchorIndex = -1
  let lastAnchorIndex = -1
  let lastPlaybackTime: number | null = null
  let lastInterludeKey: string | null = null
  let interludeDotsTop: number | null = null
  let seekHandling = false
  let lastSeekKind: 'none' | 'forced' | 'short' | 'large' = 'none'

  const springEnabled = (): boolean => options.isSpringEnabled?.() ?? true
  const playing = (): boolean => options.isPlaying?.() ?? true

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

  function deviceScale(): number {
    const provided = options.getDeviceScale?.()
    if (provided != null && Number.isFinite(provided) && provided > 0) return provided
    if (typeof window !== 'undefined' && window.devicePixelRatio > 0) return window.devicePixelRatio
    return 1
  }

  function layoutLines(): LyricLayoutLine[] {
    const indices = [...rows.keys()].sort((left, right) => left - right)
    return indices.map((index) => {
      const row = rows.get(index) as RowState
      // Culled rows use `content-visibility: hidden`, which applies size
      // containment; feeding the collapsed height back would pack lines.
      if (row.inSight) {
        const measured = Math.max(row.element.offsetHeight, row.element.scrollHeight ?? 0)
        if (measured > 0) row.height = measured
      }
      return {
        index,
        height: row.height + Math.max(0, options.getRowGapPx?.() ?? 0),
        isBackground: row.isBackground
      }
    })
  }

  function anchorForLayout(): number {
    if (anchorIndex >= 0) return anchorIndex
    if (lastAnchorIndex >= 0) return lastAnchorIndex
    return 0
  }

  /**
   * Recompute targets and hand each line its own spring targets plus cascade
   * delay. `snap` writes positions directly; `keepParamsForIndex` leaves one
   * row's pre-tuned spring alone (the pre-timed arrival); `isSeek` suppresses
   * the cascade and the depth blur the way a scrub lands. Snapping alone is
   * not a scrub: a geometry-driven snap keeps its layout-distance blur.
   */
  function applyLayout(
    snap: boolean,
    keepParamsForIndex: number | null = null,
    isSeek = false
  ): void {
    if (!stage || rows.size === 0) return

    if (initOncePending) {
      initOncePending = false
      for (const row of rows.values()) {
        row.posY.retune(LYRIC_SPRING_INIT_ONCE)
        row.scale.retune(LYRIC_SPRING_INIT_ONCE)
      }
    }

    const result = computeLyricLayout({
      lines: layoutLines(),
      scrollToIndex: anchorForLayout(),
      hot: new Set(activeQueue),
      viewportHeight: stage.clientHeight,
      alignPosition: options.getAlignPosition?.() ?? fallbackAlignPosition,
      alignAnchor,
      scrollOffset: 0,
      bottomReservedPx: Math.max(0, options.getBottomReservedPx?.() ?? 0),
      isPlaying: playing(),
      isSeeking: isSeek,
      isManualBrowse: manualBrowse,
      enableScale: options.isScaleEnabled?.() ?? true,
      enableBlur: options.isBlurEnabled?.() ?? true,
      hidePassedLines: options.shouldHidePassedLines?.() ?? false,
      focusWindow: options.getFocusWindow?.() ?? null,
      inactiveDim: options.getInactiveDim?.() ?? 1,
      scaleIntensity: options.getScaleIntensity?.() ?? 1,
      blurIntensity: options.getBlurIntensity?.() ?? 1,
      cascadeSpeedFactor: options.getCascadeSpeedFactor?.() ?? 1,
      interludeAfterIndex: options.getInterludeAfterIndex?.() ?? null,
      interludeDotsHeight: options.getInterludeDotsHeight?.() ?? 0
    })

    scrollBoundary = result.scrollBoundary
    const dotsTopChanged = interludeDotsTop !== result.interludeDotsTop
    interludeDotsTop = result.interludeDotsTop
    if (dotsTopChanged) options.onInterludeDotsTop?.(interludeDotsTop)

    const snapNow = snap || !hasCommittedLayout || !springEnabled() || isDocumentHidden()

    for (const target of result.lines) {
      const row = rows.get(target.index)
      if (!row) continue

      // A seek layout owns its retuned params; ordinary layouts bring every
      // row except a pre-timed arrival back to the shared line spring.
      if (!snapNow && !isSeek && target.index !== keepParamsForIndex) {
        restoreLineParams(row)
      }

      if (snapNow) {
        row.posY.setPosition(target.top)
        row.scale.setPosition(target.scale)
        row.alpha.snap(target.opacity)
        row.blur.snap(manualBrowse || !springEnabled() ? 0 : target.blur)
        if (row.activity) row.activity.setPosition(activeQueue.includes(target.index) ? 1 : 0)
      } else {
        row.posY.setTarget(target.top, target.delay, LYRIC_TARGET_Y_CHANGE_GATE)
        row.scale.setTarget(target.scale, 0, LYRIC_TARGET_SCALE_CHANGE_GATE)
        row.alpha.setTarget(target.opacity, LYRIC_OPACITY_RESTART_THRESHOLD)
        const blurTarget = manualBrowse ? 0 : target.blur
        row.blur.setTarget(blurTarget, LYRIC_BLUR_RESTART_THRESHOLD)
        if (row.activity) retuneActivity(row, activeQueue.includes(target.index))
      }
    }

    if (snapNow) {
      commitRows()
      hasCommittedLayout = true
    }
    if (springEnabled()) scheduleFrame()
  }

  /** Ordinary transitions run on the shared line spring (100/18). */
  function restoreLineParams(row: RowState): void {
    if (sameParams(row.posY.getParams(), LYRIC_SPRING_LINE)) return
    row.posY.retune(LYRIC_SPRING_LINE)
    row.scale.retune(LYRIC_SPRING_LINE)
  }

  function sameParams(left: LyricSpringParams, right: LyricSpringParams): boolean {
    return (
      left.mass === right.mass &&
      left.stiffness === right.stiffness &&
      left.damping === right.damping
    )
  }

  /**
   * Auxiliary-row activity spring: enter on 30/9, exit critically damped over
   * the queue transition budget, initial transition on 100/10.
   */
  function retuneActivity(row: RowState, active: boolean): void {
    const spring = row.activity
    if (!spring) return
    const target = active ? 1 : 0
    if (spring.target === target) return
    if (!row.activityTouched) {
      spring.retune(LYRIC_ACTIVITY_SPRING_INIT)
      row.activityTouched = true
    } else if (active) {
      spring.retune(LYRIC_ACTIVITY_SPRING_ENTER)
    } else {
      spring.retune(criticalRetuneByPeriod(1, ACTIVITY_EXIT_PERIOD_SECONDS))
    }
    spring.setTarget(target)
  }

  /** Write channel positions to the DOM. */
  function commitRows(): boolean {
    if (!stage) return true
    const viewportHeight = stage.clientHeight
    const dim = clamp(options.getInactiveDim?.() ?? 1, 0, 1)
    let settled = true

    for (const row of rows.values()) {
      if (!row.ready) {
        row.ready = true
        row.element.style.setProperty('--lyric-line-ready', '1')
      }

      const top = row.posY.position - dragOffset
      const scale = row.scale.position * row.clickScale.position
      // Auxiliary rows blend their opacity through the activity spring
      // between the auxiliary inactive and current targets.
      const alpha = row.activity
        ? LYRIC_ALPHA_AUX_INACTIVE * dim +
          (LYRIC_ALPHA_AUX_CURRENT - LYRIC_ALPHA_AUX_INACTIVE * dim) * row.activity.position
        : row.alpha.current
      const blur = row.blur.current * (1 - blendLowPass.current)
      if (!row.posY.arrived() || !row.scale.arrived() || !row.alpha.arrived()) settled = false
      if (row.activity && !row.activity.arrived()) settled = false
      if (row.clickScale.hasPendingWork()) settled = false

      const inSight = isLyricLineInSight(top, row.height, viewportHeight)
      if (inSight !== row.inSight) {
        row.inSight = inSight
        row.element.style.setProperty('--lyric-line-in-sight', inSight ? '1' : '0')
      }

      if (row.lastTop !== top) {
        row.lastTop = top
        row.element.style.setProperty('--lyric-line-top', `${top.toFixed(2)}px`)
      }
      if (row.lastScale !== scale) {
        row.lastScale = scale
        row.element.style.setProperty('--lyric-line-scale', scale.toFixed(5))
      }
      if (row.lastOpacity !== alpha) {
        row.lastOpacity = alpha
        row.element.style.setProperty('--lyric-line-opacity', alpha.toFixed(5))
      }
      const nextBlur = blur > LYRIC_BLUR_CUTOFF ? blur : 0
      if (row.lastBlur !== nextBlur) {
        row.lastBlur = nextBlur
        row.element.style.setProperty('--lyric-line-blur', `${nextBlur.toFixed(3)}px`)
      }
      const press = row.pressed ? clamp((1 - row.clickScale.position) / 0.05, 0, 1) * 0.08 : 0
      if (row.lastPress !== press) {
        row.lastPress = press
        row.element.style.setProperty('--lyric-line-press', press.toFixed(4))
      }
      if (row.lastIntrinsicHeight !== row.height && row.height > 0) {
        row.lastIntrinsicHeight = row.height
        row.element.style.setProperty('contain-intrinsic-size', `auto ${row.height.toFixed(2)}px`)
      }
    }

    return settled
  }

  /**
   * Pre-tune the upcoming line's springs so its arrival lands on cue
   * (report section 2.5).
   */
  function nearLineRetune(reading: LyricActiveLineReading, playTime: number): void {
    if (seekHandling || manualBrowse) return
    const targetIndex = reading.candidateIndex
    if (targetIndex < 0) return
    const row = rows.get(targetIndex)
    if (!row || row.isBackground) return
    const timeline = options.getTimeline()
    const entry = timeline[targetIndex]
    if (!entry?.timed || entry.time == null) return

    const delta = entry.time - playTime
    if (!(delta > 0)) return

    const mass = row.posY.getParams().mass
    if (delta < LYRIC_RETUNE_NEAR_SECONDS) {
      const settle = Math.max(LYRIC_RETUNE_MIN_SECONDS, 0.01)
      retuneRowSprings(row, criticalRetune(mass, settle))
      return
    }

    // Tier 2: the narrow prediction window 1.1 <= delta < 1.3.
    const remaining = delta - 0.5
    if (!(remaining < LYRIC_RETUNE_PREDICT_WINDOW_SECONDS)) return
    const params = row.posY.getParams()
    const zeta = params.damping / (2 * Math.sqrt(params.stiffness * params.mass))
    const previousStart = timeline[targetIndex - 1]?.time
    const lineGap =
      previousStart != null && entry.time > previousStart ? entry.time - previousStart : 0
    const f = clamp(zeta, 0.1, lineGap)
    const settleEstimate = LYRIC_LN_1_PERCENT / (Math.sqrt(params.stiffness / params.mass) * f)
    if (!(settleEstimate - remaining < -LYRIC_RETUNE_BUDGET_SLACK_SECONDS)) return
    const settle = Math.max(remaining - 0.4, LYRIC_RETUNE_MIN_SECONDS, 0.01)
    retuneRowSprings(row, criticalRetune(mass, settle))
  }

  function retuneRowSprings(row: RowState, params: LyricSpringParams): void {
    row.posY.retune(params)
    row.scale.retune(params)
  }

  /** Playback-clock discontinuity detection (report section 2.1), strict. */
  function detectDiscontinuity(now: number, last: number): boolean {
    const gap = Math.abs(now - last)
    return (
      gap > LYRIC_SEEK_DISCONTINUITY_SECONDS ||
      now < last - LYRIC_SEEK_BACKWARD_SECONDS ||
      (last > LYRIC_SEEK_OLD_TIME_FLOOR_SECONDS && now < last * LYRIC_SEEK_OLD_TIME_RATIO) ||
      gap > LYRIC_SEEK_HARD_GAP_SECONDS
    )
  }

  /**
   * Seek handling (report section 2.3): reset the selector, force a re-layout,
   * then classify. Short jumps retune to the 0.1s critical spring; large jumps
   * snap and restore the ordinary spring.
   */
  function handleSeek(newTime: number): void {
    const timeline = options.getTimeline()
    const oldIndex = anchorIndex
    const oldTime = lastPlaybackTime ?? newTime

    releaseManualBrowseInternal()
    const reading = selector.reset(timeline, newTime)
    lastPlaybackTime = newTime
    applyQueue(reading)

    const oldValid =
      oldIndex >= 0 && oldIndex < timeline.length && timeline[oldIndex]?.timed === true
    const newValid = reading.currentIndex >= 0 && reading.currentIndex < timeline.length
    const specialBoundary = Boolean(rows.get(reading.currentIndex)?.isBackground)

    if (!oldValid || !newValid || specialBoundary) {
      lastSeekKind = 'forced'
      applyLayout(true)
      return
    }

    const deltaLine = reading.currentIndex - oldIndex
    const deltaTime = newTime - oldTime
    const largeJump =
      Math.abs(deltaLine) > LYRIC_SEEK_LINE_DISTANCE ||
      Math.abs(deltaTime) > LYRIC_SEEK_TIME_DISTANCE_SECONDS

    if (!largeJump) {
      lastSeekKind = 'short'
      for (const row of rows.values()) retuneRowSprings(row, LYRIC_SPRING_SEEK_SHORT)
      applyLayout(false, null, true)
    } else {
      lastSeekKind = 'large'
      applyLayout(true)
      for (const row of rows.values()) retuneRowSprings(row, LYRIC_SPRING_LINE)
    }
  }

  function applyQueue(reading: LyricActiveLineReading): void {
    const changed = reading.queue.join(',') !== activeQueue.join(',')
    activeQueue = [...reading.queue]
    if (reading.currentIndex >= 0) lastAnchorIndex = reading.currentIndex
    anchorIndex = reading.currentIndex
    if (changed) options.onActiveLinesChange?.(activeQueue)
  }

  function updateInterlude(playTime: number): void {
    const timeline = options.getTimeline()
    const interlude = findLyricInterlude(
      timeline,
      { scrollToIndex: Math.max(0, lastAnchorIndex), hasActiveLine: activeQueue.length > 0 },
      playTime
    )
    const key = interlude ? `${interlude.afterIndex}:${interlude.start.toFixed(3)}` : null
    if (key !== lastInterludeKey) {
      lastInterludeKey = key
      options.onInterlude?.(interlude)
    }
  }

  function advanceChannels(dt: number): void {
    for (const row of rows.values()) {
      row.posY.update(dt)
      row.scale.update(dt)
      row.clickScale.update(dt)
      row.alpha.update(dt)
      row.blur.update(dt)
      row.activity?.update(dt)
    }
  }

  function hasPendingWork(): boolean {
    if (manualBrowse && Math.abs(targetOffset - dragOffset) > 1e-6) return true
    if (Math.abs((manualBrowse ? 1 : 0) - blendLowPass.current) > 1e-9) return true
    for (const row of rows.values()) {
      if (row.posY.hasPendingWork() || row.scale.hasPendingWork()) return true
      if (!row.alpha.arrived() || !row.blur.arrived()) return true
      if (row.activity?.hasPendingWork()) return true
      if (row.clickScale.hasPendingWork()) return true
    }
    return false
  }

  function stopFrameLoop(): void {
    cancelFrame?.()
    cancelFrame = null
    lastFrameNow = null
  }

  /** Wake the loop just before the retune/promotion windows re-open. */
  function scheduleWake(seconds: number): void {
    if (cancelWake) return
    const delayMs = Math.max(50, seconds * 1000)
    const onWake = (): void => {
      cancelWake = null
      scheduleFrame()
    }
    if (scheduler) {
      const handle = scheduler.scheduleTimeout(onWake, delayMs)
      cancelWake = () => scheduler?.clearTimeout(handle)
    } else if (typeof window !== 'undefined') {
      const handle = window.setTimeout(onWake, delayMs)
      cancelWake = () => window.clearTimeout(handle)
    }
  }

  function frame(now: number): void {
    cancelFrame = null
    if (isDocumentHidden()) {
      /*
       * Hidden windows throttle rAF to a crawl, but the selector is pure
       * state: keep the active queue honest with playback, then snap every
       * channel to its target so the page is coherent the moment it shows.
       */
      const playTime = options.getPlaybackTime()
      const reading = selector.advance(options.getTimeline(), playTime)
      lastPlaybackTime = playTime
      if (reading.changed) {
        applyQueue(reading)
        if (manualBrowse) releaseManualBrowseInternal()
      }
      updateInterlude(playTime)
      for (const row of rows.values()) row.clickScale.setPosition(row.clickScale.target)
      applyLayout(true)
      lastFrameNow = null
      return
    }

    const previousNow = lastFrameNow
    const hadPreviousFrame = previousNow != null
    const dt = frameDeltaSeconds(
      hadPreviousFrame ? (now - previousNow) / 1000 : 0,
      hadPreviousFrame
    )
    // A frame after an idle stop or a long stall cannot tell natural
    // progression from a discontinuity: resync instead of seeking.
    const isWakeFrame = !hadPreviousFrame || dt >= LYRIC_MAX_FRAME_SECONDS
    lastFrameNow = now

    const playTime = options.getPlaybackTime()
    let reading: LyricActiveLineReading

    if (
      !isWakeFrame &&
      lastPlaybackTime != null &&
      detectDiscontinuity(playTime, lastPlaybackTime)
    ) {
      seekHandling = true
      try {
        handleSeek(playTime)
        reading = selector.advance(options.getTimeline(), playTime)
        lastPlaybackTime = playTime
      } finally {
        seekHandling = false
      }
    } else {
      reading = selector.advance(options.getTimeline(), playTime)
      lastPlaybackTime = playTime
      if (reading.changed) {
        applyQueue(reading)
        // An active-line change during manual browsing folds the offset into
        // the Y springs and re-anchors, per the report.
        if (manualBrowse) releaseManualBrowseInternal()
        applyLayout(false, reading.promoted ? reading.currentIndex : null)
      }
    }

    updateInterlude(playTime)
    nearLineRetune(reading, playTime)

    if (manualBrowse) {
      dragOffset = dragLowPass.update(
        dt,
        clamp(targetOffset, scrollBoundary[0], scrollBoundary[1]),
        LYRIC_DRAG_RESPONSE_RATE,
        LYRIC_DRAG_SNAP_PX
      )
    }
    blendLowPass.update(
      dt,
      manualBrowse ? 1 : 0,
      LYRIC_INTERACTION_BLEND_RATE,
      LYRIC_INTERACTION_BLEND_SNAP
    )

    advanceChannels(dt)
    commitRows()

    if (hasPendingWork()) {
      scheduleFrame()
      return
    }

    const untilNext =
      reading.candidateStart == null ? Number.POSITIVE_INFINITY : reading.candidateStart - playTime
    if (playing() && untilNext <= LYRIC_LOOP_IDLE_MARGIN_SECONDS) {
      scheduleFrame()
    } else if (playing()) {
      stopFrameLoop()
      scheduleWake(untilNext - LYRIC_LOOP_IDLE_MARGIN_SECONDS)
    } else {
      stopFrameLoop()
    }
  }

  function scheduleFrame(): void {
    if (cancelFrame || !springEnabled()) return
    cancelFrame = requestAnimationFrameWithFallback(
      (now) => frame(now),
      FRAME_FALLBACK_MS,
      scheduler
    )
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
    stopFrameLoop()
    cancelWake?.()
    cancelWake = null
    clearManualBrowseTimer()
    rows.clear()
    selector = createLyricActiveLineSelector({ maxActiveLines: options.maxActiveLines })
    activeQueue = []
    anchorIndex = -1
    lastAnchorIndex = -1
    lastPlaybackTime = null
    lastInterludeKey = null
    targetOffset = 0
    dragOffset = 0
    dragLowPass.set(0)
    blendLowPass.set(0)
    hasCommittedLayout = false
    initOncePending = true
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
      if (isBackground && !existing.activity) {
        existing.activity = new LyricSpring(0, LYRIC_ACTIVITY_SPRING_INIT)
        existing.activityTouched = false
      } else if (!isBackground) {
        existing.activity = null
      }
      return
    }

    // A replacement row starts hidden until the next committed layout has
    // given it its own position so rapidly switching tracks cannot briefly
    // pile every new line together.
    element.style.setProperty('--lyric-line-ready', '0')

    rows.set(index, {
      element,
      posY: new LyricSpring(existing?.posY.position ?? 0, LYRIC_SPRING_LINE),
      scale: new LyricSpring(existing?.scale.position ?? 1, LYRIC_SPRING_LINE),
      alpha: new LyricBezierTransition(existing?.alpha.current ?? 0),
      blur: new LyricBezierTransition(existing?.blur.current ?? 0),
      activity: isBackground ? new LyricSpring(0, LYRIC_ACTIVITY_SPRING_INIT) : null,
      activityTouched: false,
      clickScale: new LyricSpring(1, LYRIC_SPRING_RELEASE),
      pressed: false,
      height: Math.max(element.offsetHeight, element.scrollHeight ?? 0, existing?.height ?? 0),
      isBackground,
      lastTop: null,
      lastScale: null,
      lastOpacity: null,
      lastBlur: null,
      lastPress: null,
      lastIntrinsicHeight: null,
      ready: false,
      inSight: true
    })
  }

  /** Manual browsing input: accumulate `2 * deviceScale * delta` (section 5). */
  function browseBy(deltaY: number): void {
    if (!activeTrackId || !stage) return
    setManualBrowse(true)
    targetOffset = clamp(
      targetOffset + LYRIC_DRAG_INPUT_GAIN * deviceScale() * deltaY,
      scrollBoundary[0],
      scrollBoundary[1]
    )
    applyLayout(false)
    armManualBrowseRelease()
    scheduleFrame()
  }

  function beginManualBrowse(): void {
    if (!activeTrackId || !stage) return
    setManualBrowse(true)
    applyLayout(false)
    armManualBrowseRelease()
    scheduleFrame()
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

  /**
   * End manual browsing: fold the drag offset into the Y springs, keep the
   * target row in view, clear the manual state and re-layout.
   */
  function releaseManualBrowseInternal(): void {
    if (!manualBrowse) return
    clearManualBrowseTimer()
    setManualBrowse(false)
    for (const row of rows.values()) {
      row.posY.setPosition(row.posY.position - dragOffset)
    }
    targetOffset = 0
    dragOffset = 0
    dragLowPass.set(0)
  }

  function releaseManualBrowse(): void {
    if (!manualBrowse) return
    releaseManualBrowseInternal()
    applyLayout(false)
    scheduleFrame()
  }

  /** Click press: shrink to 0.95 on the elastic spring (section 7). */
  function rowPointerDown(index: number): void {
    const row = rows.get(index)
    if (!row) return
    for (const [otherIndex, other] of rows) {
      if (otherIndex !== index && other.pressed) {
        other.pressed = false
        other.clickScale.retune(LYRIC_SPRING_RELEASE)
        other.clickScale.setTarget(1)
      }
    }
    row.pressed = true
    row.clickScale.retune(LYRIC_SPRING_PRESS)
    row.clickScale.setTarget(0.95)
    scheduleFrame()
  }

  /** Click release: back to 1.0 on the harder-braking spring. */
  function rowPointerUp(index: number): void {
    const row = rows.get(index)
    if (!row || !row.pressed) return
    row.pressed = false
    row.clickScale.retune(LYRIC_SPRING_RELEASE)
    row.clickScale.setTarget(1)
    scheduleFrame()
  }

  /** Explicit seek notification from the playback clock. */
  function notifySeek(timeSeconds: number): void {
    if (!activeTrackId) return
    handleSeek(timeSeconds)
    scheduleFrame()
  }

  function onResize(mode: 'spring' | 'snap' = 'spring'): void {
    if (manualBrowse || cancelResize) return
    const token = activation
    cancelResize = requestAnimationFrameWithFallback(
      () => {
        cancelResize = null
        if (!manualBrowse && token === activation && stage) {
          applyLayout(mode === 'snap')
        }
      },
      FRAME_FALLBACK_MS,
      scheduler
    )
  }

  async function recenter(mode: 'resize' | 'snap' = 'resize'): Promise<void> {
    if (!activeTrackId) return
    const token = activation
    await options.afterLayout()
    if (token !== activation || !stage) return
    applyLayout(mode === 'snap')
  }

  function dispose(): void {
    activation += 1
    stopFrameLoop()
    cancelWake?.()
    cancelWake = null
    cancelResize?.()
    cancelResize = null
    clearManualBrowseTimer()
    rows.clear()
    stage = null
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
    notifySeek,
    onResize,
    recenter,
    registerRow,
    releaseManualBrowse,
    rowPointerDown,
    rowPointerUp,
    isManualBrowsing: () => manualBrowse,
    trackId: () => activeTrackId,
    getActiveQueue: () => [...activeQueue],
    getCurrentIndex: () => anchorIndex,
    /** Test and diagnostic seams. */
    getLastSeekKind: () => lastSeekKind,
    getRowTop: (index: number) => rows.get(index)?.posY.position ?? null,
    getRowScale: (index: number) => rows.get(index)?.scale.position ?? null,
    getRowTargetTop: (index: number) => rows.get(index)?.posY.target ?? null,
    getRowSpringParams: (index: number) => rows.get(index)?.posY.getParams() ?? null,
    getDragOffset: () => dragOffset,
    getInteractionBlend: () => blendLowPass.current,
    getScrollBoundary: () => scrollBoundary,
    getInterludeDotsTop: () => interludeDotsTop
  }
}
