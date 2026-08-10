/**
 * Pointer-reactive specular highlight for the liquid glass material.
 *
 * Cards share one document-level listener, so cost stays O(1) in listeners no
 * matter how many cards are mounted — the album grid renders in batches up to the
 * full library, so per-element listeners are not an option. The listener resolves
 * the card under the pointer and writes element-scoped CSS variables, so only the
 * hovered card rotates its highlight; every other card keeps the static base
 * angle.
 *
 * The playbar computes its own element-relative offset, since it is one surface and
 * can afford the higher fidelity; it also only reacts while the pointer is over it.
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

/** Specular gradient angle in degrees for a given horizontal offset. */
export function resolveHighlightAngle(offsetX: number): number {
  return BASE_HIGHLIGHT_ANGLE + clampOffset(offsetX) * ANGLE_GAIN
}

export interface LiquidGlassPointerVariables {
  '--te-lg-angle': string
  '--te-lg-pointer-x': string
  '--te-lg-pointer-y': string
  '--te-lg-elastic-x': string
  '--te-lg-elastic-y': string
}

/** Maximum warp-layer shift toward the cursor at 100% elasticity. */
export const MAX_ELASTIC_SHIFT_PX = 10
/**
 * Pointer-driven glass repaint is deliberately capped below the display refresh
 * rate. Updating a blurred SVG-filtered surface every 16 ms starves scrolling on
 * dense card grids; 32 ms keeps the light responsive while leaving compositor
 * time for the actual UI.
 */
export const LIQUID_GLASS_POINTER_FRAME_INTERVAL_MS = 32

export function pointerCssVariables(
  offset: PointerOffset,
  elasticity = 0
): LiquidGlassPointerVariables {
  const factor = Math.max(0, Math.min(100, elasticity)) / 100
  return {
    '--te-lg-angle': `${resolveHighlightAngle(offset.x).toFixed(2)}deg`,
    '--te-lg-pointer-x': offset.x.toFixed(2),
    '--te-lg-pointer-y': offset.y.toFixed(2),
    '--te-lg-elastic-x': `${((offset.x / 100) * factor * MAX_ELASTIC_SHIFT_PX).toFixed(2)}px`,
    '--te-lg-elastic-y': `${((offset.y / 100) * factor * MAX_ELASTIC_SHIFT_PX).toFixed(2)}px`
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

export interface FrameCoalescerOptions {
  requestFrame?: (callback: () => void) => number
  cancelFrame?: (handle: number) => void
  /** Minimum time between flushes. Zero retains one update per animation frame. */
  minIntervalMs?: number
  /** Injectable clock for deterministic tests. */
  now?: () => number
}

/**
 * Coalesces bursts of updates into one callback per animation frame, latest wins.
 * Pointer events fire far faster than frames; without this the hot path would write
 * style on every event. Callers can additionally cap flush frequency when each
 * update invalidates an expensive blur/filter surface.
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
  const now =
    options.now ??
    (typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? () => performance.now()
      : () => Date.now())
  const minIntervalMs = Math.max(
    0,
    Number.isFinite(options.minIntervalMs) ? options.minIntervalMs! : 0
  )

  let handle: number | null = null
  let pending: { payload: T } | null = null
  let lastFlushAt = Number.NEGATIVE_INFINITY

  function flushFrame(): void {
    handle = null
    const next = pending
    if (!next) return

    const timestamp = now()
    if (timestamp - lastFlushAt < minIntervalMs) {
      // Preserve the latest input and wait for the next compositor frame instead
      // of using a timer that could contend with rendering work.
      handle = requestFrame(flushFrame)
      return
    }

    pending = null
    lastFlushAt = timestamp
    flush(next.payload)
  }

  return {
    schedule(payload: T): void {
      pending = { payload }
      if (handle !== null) return
      handle = requestFrame(flushFrame)
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
      // Re-enabling a surface should never wait behind an old interaction.
      lastFlushAt = Number.NEGATIVE_INFINITY
    }
  }
}
