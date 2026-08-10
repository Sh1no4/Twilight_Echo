/**
 * Pointer-reactive specular highlight for the liquid glass material.
 *
 * Cards use a single document-level listener writing shared CSS variables, so cost
 * is O(1) in listeners regardless of how many cards are mounted — the album grid
 * renders in batches up to the full library, so per-element listeners are not an
 * option. A single global light source is also the physically plausible model.
 *
 * The playbar computes its own element-relative offset, since it is one surface and
 * can afford the higher fidelity.
 *
 * Per the chosen design this drives highlight angle only — no elastic scale or
 * translate, which would shift a fixed-layout playbar and jitter neighbouring
 * content.
 */

export interface PointerRect {
  left: number
  top: number
  width: number
  height: number
}

export interface PointerOffset {
  /** Horizontal offset from the surface center, in percent of its width. */
  x: number
  /** Vertical offset from the surface center, in percent of its height. */
  y: number
}

/** Base angle of the specular gradient, in degrees, with no pointer influence. */
export const BASE_HIGHLIGHT_ANGLE = 135
/** How strongly horizontal pointer offset rotates the gradient. */
const ANGLE_GAIN = 1.2
/** Offsets are clamped so an off-screen pointer cannot swing the highlight wildly. */
const MAX_OFFSET_PERCENT = 100

function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(MAX_OFFSET_PERCENT, Math.max(-MAX_OFFSET_PERCENT, value))
}

/**
 * Pointer position relative to a surface center, as a percentage of its size.
 * Returns zero for a degenerate rect rather than dividing by zero.
 */
export function resolvePointerOffset(
  pointerX: number,
  pointerY: number,
  rect: PointerRect
): PointerOffset {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }

  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  return {
    x: clampOffset(((pointerX - centerX) / rect.width) * 100),
    y: clampOffset(((pointerY - centerY) / rect.height) * 100)
  }
}

/**
 * Pointer offset against the viewport, used as the shared light source for cards.
 */
export function resolveViewportPointerOffset(
  pointerX: number,
  pointerY: number,
  viewportWidth: number,
  viewportHeight: number
): PointerOffset {
  return resolvePointerOffset(pointerX, pointerY, {
    left: 0,
    top: 0,
    width: viewportWidth,
    height: viewportHeight
  })
}

/** Specular gradient angle in degrees for a given horizontal offset. */
export function resolveHighlightAngle(offsetX: number): number {
  return BASE_HIGHLIGHT_ANGLE + clampOffset(offsetX) * ANGLE_GAIN
}

export interface LiquidGlassPointerVariables {
  '--te-lg-angle': string
  '--te-lg-pointer-x': string
  '--te-lg-pointer-y': string
}

export function pointerCssVariables(offset: PointerOffset): LiquidGlassPointerVariables {
  return {
    '--te-lg-angle': `${resolveHighlightAngle(offset.x).toFixed(2)}deg`,
    '--te-lg-pointer-x': offset.x.toFixed(2),
    '--te-lg-pointer-y': offset.y.toFixed(2)
  }
}

/** Static values used when motion is reduced or pointer following is off. */
export function staticPointerCssVariables(): LiquidGlassPointerVariables {
  return pointerCssVariables({ x: 0, y: 0 })
}

export interface FrameCoalescer<T> {
  /** Queue a payload; only the most recent one survives until the next frame. */
  schedule: (payload: T) => void
  hasPending: () => boolean
  /** Drop any queued payload without running the callback. */
  cancel: () => void
}

interface FrameCoalescerOptions {
  requestFrame?: (callback: () => void) => number
  cancelFrame?: (handle: number) => void
}

/**
 * Coalesces bursts of updates into one callback per animation frame, latest wins.
 * Pointer events fire far faster than frames; without this the hot path would write
 * style on every event.
 */
export function createFrameCoalescer<T>(
  flush: (payload: T) => void,
  options: FrameCoalescerOptions = {}
): FrameCoalescer<T> {
  const requestFrame =
    options.requestFrame ??
    (typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback: () => void): number => setTimeout(callback, 16) as unknown as number)
  const cancelFrame =
    options.cancelFrame ??
    (typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : (handle: number): void => clearTimeout(handle as unknown as NodeJS.Timeout))

  let handle: number | null = null
  let pending: { payload: T } | null = null

  return {
    schedule(payload: T): void {
      pending = { payload }
      if (handle !== null) return
      handle = requestFrame(() => {
        handle = null
        const next = pending
        pending = null
        if (next) flush(next.payload)
      })
    },
    hasPending(): boolean {
      return pending !== null
    },
    cancel(): void {
      if (handle !== null) {
        cancelFrame(handle)
        handle = null
      }
      pending = null
    }
  }
}
