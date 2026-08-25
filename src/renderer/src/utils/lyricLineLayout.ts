import { clamp } from './lyricMotion.ts'

/**
 * Pure geometry for the lyric stack (report sections 1, 3 and 4).
 *
 * Targets follow the Windows baseline table: ordinary current lines sit at
 * scale 1.00 / alpha 0.85, ordinary non-current lines at 0.98 / 0.175,
 * auxiliary rows at 0.70 / 0.50 when current and 0.63 / 0.175 when not.
 * Stacking multiplies each row's measured height by its target scale, and the
 * blur target grows with the effective layout distance to the current line.
 *
 * The cascade delay counts effective layout rows below the anchor:
 * delay = max(N - 1, 0) * 0.05s, so the anchor and its neighbour leave
 * immediately and every further layer steps 50ms. Rows above the anchor
 * depart without delay.
 */

/** Ordinary-line targets. */
export const LYRIC_SCALE_CURRENT = 1.0
export const LYRIC_SCALE_INACTIVE = 0.98
export const LYRIC_ALPHA_CURRENT = 0.85
export const LYRIC_ALPHA_INACTIVE = 0.175

/** Auxiliary/background-row targets. */
export const LYRIC_SCALE_AUX_CURRENT = 0.7
export const LYRIC_SCALE_AUX_INACTIVE = 0.63
export const LYRIC_ALPHA_AUX_CURRENT = 0.5
export const LYRIC_ALPHA_AUX_INACTIVE = 0.175

/** Cropped or force-hidden rows keep their branch scale but fade to zero. */
export const LYRIC_ALPHA_HIDDEN = 0

/** Blur target: min((d - 0.25) * 1.25, 6) over the effective distance d. */
export const LYRIC_BLUR_DISTANCE_BASE = 0.25
export const LYRIC_BLUR_PER_DISTANCE = 1.25
export const LYRIC_BLUR_MAX = 6.0
/** Below this radius the renderer skips the blur filter entirely. */
export const LYRIC_BLUR_CUTOFF = 0.1

/** Cascade step in seconds; the effective distance is counted in layout rows. */
export const LYRIC_CASCADE_STEP_SECONDS = 0.05

/** Layout visibility margin around the viewport, in px. */
export const LYRIC_CULL_MARGIN_PX = 80

export const LYRIC_ALIGN_POSITION = 0.35
export const LYRIC_INTERLUDE_DOTS_GAP_PX = 40
export const LYRIC_INTERLUDE_DOTS_OFFSET_PX = 10

export type LyricAlignAnchor = 'top' | 'center' | 'bottom'

export interface LyricLayoutLine {
  index: number
  height: number
  /** Auxiliary rows use the reduced target set. */
  isBackground?: boolean
}

export interface LyricLayoutOptions {
  lines: readonly LyricLayoutLine[]
  /** Index the view is anchored to. */
  scrollToIndex: number
  /** Active-queue lines: full targets and zero blur. */
  hot?: ReadonlySet<number>
  viewportHeight: number
  /** Fraction of the visible area the anchor sits at. */
  alignPosition?: number
  alignAnchor?: LyricAlignAnchor
  /** Manual browse displacement, in pixels. */
  scrollOffset?: number
  /** Space covered by an overlay such as the player bar. */
  bottomReservedPx?: number
  isPlaying?: boolean
  /** Suppresses the cascade and the depth blur so a scrub lands immediately. */
  isSeeking?: boolean
  /** Manual interaction also drops the blur targets to zero. */
  isManualBrowse?: boolean
  enableScale?: boolean
  enableBlur?: boolean
  hidePassedLines?: boolean
  /**
   * Line indices the focus window keeps. Everything else collapses out of the
   * flow, so the kept lines sit together instead of floating in the gaps.
   * `null` keeps the whole timeline.
   */
  focusWindow?: ReadonlySet<number> | null
  /** Multiplier for lines outside the active queue, 0-1. */
  inactiveDim?: number
  /** Scales the inactive shrink, 0-1 of the built-in amount. */
  scaleIntensity?: number
  /** Scales the depth blur, 0-1 of the built-in amount. */
  blurIntensity?: number
  /** Multiplier on the cascade step. 1 is the built-in rhythm. */
  cascadeSpeedFactor?: number
  /** Present and at least the minimum duration. */
  interludeAfterIndex?: number | null
  interludeDotsHeight?: number
}

export interface LyricLineTarget {
  index: number
  top: number
  /** Ratio, 0-1. */
  scale: number
  opacity: number
  blur: number
  /** Seconds. Feeds `LyricSpring.setTarget(target, delay)`. */
  delay: number
}

export interface LyricLayoutResult {
  lines: LyricLineTarget[]
  /** Vertical position for the interlude dots, or `null` when not shown. */
  interludeDotsTop: number | null
  /** `[min, max]` manual browse range. */
  scrollBoundary: [number, number]
  /** Total content height, used for the bottom spacer. */
  contentBottom: number
}

/** Blur target from effective layout distance; current lines pass 0. */
export function lyricBlurTarget(distance: number): number {
  return Math.max(
    0,
    Math.min((distance - LYRIC_BLUR_DISTANCE_BASE) * LYRIC_BLUR_PER_DISTANCE, LYRIC_BLUR_MAX)
  )
}

/** Cascade delay from effective layout distance below the anchor. */
export function lyricCascadeDelay(distance: number, speedFactor = 1): number {
  return Math.max(distance - 1, 0) * LYRIC_CASCADE_STEP_SECONDS * Math.max(0, speedFactor)
}

/** True when a line's box intersects the viewport, with the cull margin. */
export function isLyricLineInSight(
  top: number,
  height: number,
  viewportHeight: number,
  margin = LYRIC_CULL_MARGIN_PX
): boolean {
  return !(top > viewportHeight + margin || top + height < -margin)
}

export function computeLyricLayout(options: LyricLayoutOptions): LyricLayoutResult {
  const {
    lines,
    scrollToIndex: requestedScrollIndex,
    hot: providedHot,
    viewportHeight,
    alignPosition = LYRIC_ALIGN_POSITION,
    alignAnchor = 'center',
    scrollOffset = 0,
    bottomReservedPx = 0,
    isPlaying = true,
    isSeeking = false,
    isManualBrowse = false,
    enableScale = true,
    enableBlur = true,
    hidePassedLines = false,
    focusWindow = null,
    inactiveDim = 1,
    scaleIntensity = 1,
    blurIntensity = 1,
    cascadeSpeedFactor = 1,
    interludeAfterIndex = null,
    interludeDotsHeight = 0
  } = options

  const visibleHeight = Math.max(0, viewportHeight - Math.max(0, bottomReservedPx))
  const hot = providedHot ?? new Set<number>()
  const dim = clamp(inactiveDim, 0, 1)
  const scaleAmount = clamp(scaleIntensity, 0, 1)
  const blurAmount = clamp(blurIntensity, 0, 1)
  const blurSuppressed = isSeeking || isManualBrowse

  const isFocusHidden = (lineIndex: number): boolean =>
    focusWindow != null && isPlaying && !focusWindow.has(lineIndex)

  // Resolve the anchor by line index; array position and line index are not
  // interchangeable when the caller hands us a sparse set of rows.
  let anchorPosition = lines.findIndex((line) => line.index === requestedScrollIndex)
  if (anchorPosition < 0) {
    anchorPosition = lines.findIndex((line) => line.index >= requestedScrollIndex)
    if (anchorPosition < 0) anchorPosition = Math.max(0, lines.length - 1)
  }
  const scrollToIndex = lines[anchorPosition]?.index ?? requestedScrollIndex

  // Per-row target scale, needed before stacking because the next row's top
  // is this row's top plus its scaled height.
  const targetScale = (position: number): number => {
    const line = lines[position]
    if (!line) return LYRIC_SCALE_INACTIVE
    const active = hot.has(line.index)
    if (line.isBackground) {
      if (!enableScale) return LYRIC_SCALE_INACTIVE
      if (active) return LYRIC_SCALE_AUX_CURRENT
      // Intensity 1 keeps the documented 0.63; 0 removes the shrink entirely.
      return (
        LYRIC_SCALE_AUX_CURRENT - (LYRIC_SCALE_AUX_CURRENT - LYRIC_SCALE_AUX_INACTIVE) * scaleAmount
      )
    }
    if (!enableScale || !isPlaying) return LYRIC_SCALE_CURRENT
    if (active) return LYRIC_SCALE_CURRENT
    return LYRIC_SCALE_CURRENT - (LYRIC_SCALE_CURRENT - LYRIC_SCALE_INACTIVE) * scaleAmount
  }

  // Rows that take part in the flow: focus-hidden rows and background rows
  // outside the active set collapse while playing.
  const isParticipating = (position: number): boolean => {
    const line = lines[position]
    if (!line) return false
    if (isFocusHidden(line.index)) return false
    if (line.isBackground && isPlaying && !hot.has(line.index)) return false
    return true
  }

  // Effective layout distance between each participating row and the anchor,
  // counting only rows that actually take space.
  const participating: number[] = []
  for (let position = 0; position < lines.length; position += 1) {
    if (isParticipating(position)) participating.push(position)
  }
  let anchorListIndex = participating.indexOf(anchorPosition)
  if (anchorListIndex < 0) {
    // Anchor itself collapsed (e.g. a background row before it turns hot):
    // measure from its nearest surviving neighbour.
    let nearest = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let listIndex = 0; listIndex < participating.length; listIndex += 1) {
      const distance = Math.abs(participating[listIndex] - anchorPosition)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = listIndex
      }
    }
    anchorListIndex = nearest
  }
  const listIndexOf = new Map<number, number>()
  participating.forEach((position, listIndex) => listIndexOf.set(position, listIndex))
  const effectiveDistance = (position: number): number => {
    const listIndex = listIndexOf.get(position)
    if (listIndex == null || anchorListIndex < 0) return 0
    return Math.abs(listIndex - anchorListIndex)
  }

  // Height of everything above the anchor, at target scale.
  let stackedAbove = 0
  for (let position = 0; position < anchorPosition; position += 1) {
    if (!isParticipating(position)) continue
    const line = lines[position]
    if (!line) continue
    stackedAbove += line.height * targetScale(position)
  }

  let curPos = -scrollOffset - stackedAbove + visibleHeight * clamp(alignPosition, 0, 1)

  const anchorLine = lines[anchorPosition]
  if (anchorLine) {
    const anchorScaledHeight = anchorLine.height * targetScale(anchorPosition)
    if (alignAnchor === 'center') curPos -= anchorScaledHeight / 2
    else if (alignAnchor === 'bottom') curPos -= anchorScaledHeight
  }

  const scrollBoundaryMin = -stackedAbove

  const results: LyricLineTarget[] = []
  let interludeDotsTop: number | null = null
  let dotsPlaced = false

  for (let position = 0; position < lines.length; position += 1) {
    const line = lines[position]
    if (!line) continue
    const lineIndex = line.index
    const active = hot.has(lineIndex)
    const focusHidden = isFocusHidden(lineIndex)
    const auxiliary = Boolean(line.isBackground)

    if (
      !dotsPlaced &&
      interludeAfterIndex != null &&
      (lineIndex === scrollToIndex + 1 || (lineIndex === scrollToIndex && interludeAfterIndex < 0))
    ) {
      dotsPlaced = true
      interludeDotsTop = curPos + LYRIC_INTERLUDE_DOTS_OFFSET_PX
      curPos += interludeDotsHeight + LYRIC_INTERLUDE_DOTS_GAP_PX
    }

    // A background row outside the active set collapses while playing: the
    // supporting-voice content hides itself in CSS, so the row is not rendered.
    const collapsedBackground = auxiliary && isPlaying && !active

    let opacity: number
    if (focusHidden) {
      opacity = LYRIC_ALPHA_HIDDEN
    } else if (hidePassedLines && isPlaying && lineIndex < scrollToIndex) {
      opacity = LYRIC_ALPHA_HIDDEN
    } else if (collapsedBackground) {
      opacity = LYRIC_ALPHA_HIDDEN
    } else if (active) {
      opacity = auxiliary ? LYRIC_ALPHA_AUX_CURRENT : LYRIC_ALPHA_CURRENT
    } else {
      const base = auxiliary ? LYRIC_ALPHA_AUX_INACTIVE : LYRIC_ALPHA_INACTIVE
      opacity = base * dim
    }

    let blur = 0
    if (enableBlur && !blurSuppressed && !active && !focusHidden) {
      blur = lyricBlurTarget(effectiveDistance(position)) * blurAmount
    }

    // Rows above the anchor depart without delay; below, the cascade steps
    // 50ms per effective layout row past the first.
    let delay = 0
    if (!isSeeking && position > anchorPosition) {
      delay = lyricCascadeDelay(effectiveDistance(position), cascadeSpeedFactor)
    }

    results.push({
      index: lineIndex,
      top: curPos,
      scale: targetScale(position),
      opacity,
      blur,
      delay
    })

    if (isParticipating(position)) curPos += line.height * targetScale(position)
  }

  return {
    lines: results,
    interludeDotsTop,
    scrollBoundary: [
      scrollBoundaryMin,
      Math.max(scrollBoundaryMin, curPos + scrollOffset - visibleHeight / 2)
    ],
    contentBottom: curPos
  }
}
