import {
  requestAnimationFrameWithFallback,
  type AnimationFrameFallbackScheduler
} from './animationFrameFallback.ts'
import { clamp, criticalRetuneByPeriod, frameDeltaSeconds, LyricSpring } from './lyricMotion.ts'
import type { LyricInterlude } from './lyricTimeline.ts'

/**
 * Interlude dots (report section 11). Three dots breathe through the gap
 * between lyrics: each dot enters at `(i + 1) * step` and exits at
 * `(i + 1) * step + tail`, where `step = max(D/n * 0.4, 0.4)` and
 * `tail = 2D/n`. Enter and leave run on springs critically damped over
 * T = 1.5s, and the shared gate `(1 - leave) * enter` drives the dot's
 * scale and its symmetric vertical spread around the midline.
 *
 * The report's trail (80-frame ring buffer) never fires for the default
 * three-dot layout — its own gate `(drawSize / n) * 0.4 < 0.1` contradicts
 * `drawSize > 1.2` — so it is intentionally not reproduced.
 */

export const INTERLUDE_DOT_COUNT = 3
export const INTERLUDE_DOT_STEP_RATIO = 0.4
export const INTERLUDE_DOT_STEP_FLOOR_SECONDS = 0.4
export const INTERLUDE_DOT_PEAK_GAIN = 0.14
export const INTERLUDE_DOT_SPREAD = 0.5

/** Enter/leave springs: critically damped over a 1.5s period. */
export const INTERLUDE_DOT_SPRING = criticalRetuneByPeriod(1, 1.5)

export interface InterludeDotState {
  /** Shared envelope: (1 - leave) * enter, 0..1. */
  gate: number
  scale: number
  /** Symmetric spread around the midline, in dot-size units. */
  verticalOffset: number
}

export interface LyricInterludeDotsOptions {
  getPlaybackTime: () => number
  /** Called with the per-dot render state; `null` hides the dots entirely. */
  onRender: (states: readonly InterludeDotState[] | null) => void
  frameScheduler?: AnimationFrameFallbackScheduler
}

/** Stagger timing for a gap of `duration` seconds over `count` dots. */
export function interludeDotSchedule(duration: number, count = INTERLUDE_DOT_COUNT) {
  const base = duration / count
  const step = Math.max(base * INTERLUDE_DOT_STEP_RATIO, INTERLUDE_DOT_STEP_FLOOR_SECONDS)
  const tail = (2 * duration) / count
  return { step, tail }
}

/** Peak scale from the interlude duration: 1 + 0.14 * clamp(D - 1, 0, 1). */
export function interludeDotPeakScale(duration: number): number {
  return 1 + INTERLUDE_DOT_PEAK_GAIN * clamp(duration - 1, 0, 1)
}

export function createLyricInterludeDots(options: LyricInterludeDotsOptions) {
  const count = INTERLUDE_DOT_COUNT
  let record: LyricInterlude | null = null
  let enterSprings: LyricSpring[] = []
  let leaveSprings: LyricSpring[] = []
  let entered: boolean[] = []
  let left: boolean[] = []
  let cancelFrame: (() => void) | null = null
  let cancelWake: (() => void) | null = null
  let lastFrameNow: number | null = null

  function springsActive(): boolean {
    return (
      enterSprings.some((spring) => spring.hasPendingWork()) ||
      leaveSprings.some((spring) => spring.hasPendingWork())
    )
  }

  /** Advance the state machine; exposed for tests. */
  function update(playTime: number, dt: number): InterludeDotState[] | null {
    if (!record) return null

    // Playback left the interlude behind: zero every channel.
    if (playTime < record.start - 0.05 || playTime > record.end + 2.5) {
      reset()
      return null
    }

    const duration = record.end - record.start
    const { step, tail } = interludeDotSchedule(duration, count)
    for (let index = 0; index < count; index += 1) {
      const enterTrigger = record.start + (index + 1) * step
      const leaveTrigger = enterTrigger + tail
      if (!entered[index] && playTime >= enterTrigger) {
        entered[index] = true
        enterSprings[index]?.setTarget(1)
      }
      if (!left[index] && playTime >= leaveTrigger) {
        left[index] = true
        leaveSprings[index]?.setTarget(1)
      }
      enterSprings[index]?.update(dt)
      leaveSprings[index]?.update(dt)
    }

    if (!record) return null
    const peakScale = interludeDotPeakScale(duration)
    const states: InterludeDotState[] = []
    for (let index = 0; index < count; index += 1) {
      const enter = enterSprings[index]?.position ?? 0
      const leave = leaveSprings[index]?.position ?? 0
      const gate = (1 - leave) * enter
      states.push({
        gate,
        scale: 1 + (peakScale - 1) * gate,
        verticalOffset: (index - (count - 1) * 0.5) * INTERLUDE_DOT_SPREAD * gate * (peakScale - 1)
      })
    }
    return states
  }

  function frame(now: number): void {
    cancelFrame = null
    const previousNow = lastFrameNow
    const dt = frameDeltaSeconds(
      previousNow != null ? (now - previousNow) / 1000 : 0,
      previousNow != null
    )
    lastFrameNow = now

    const playTime = options.getPlaybackTime()
    const states = update(playTime, dt)
    if (states) {
      options.onRender(states)
    }

    if (!record) {
      lastFrameNow = null
      return
    }
    if (springsActive()) {
      scheduleFrame()
      return
    }
    // Idle: wake at the next trigger (or let a later reset handle the rest).
    lastFrameNow = null
    const duration = record.end - record.start
    const { step, tail } = interludeDotSchedule(duration, count)
    for (let index = 0; index < count; index += 1) {
      const enterTrigger = record.start + (index + 1) * step
      const leaveTrigger = enterTrigger + tail
      const nextTrigger = !entered[index]
        ? enterTrigger
        : !left[index]
          ? leaveTrigger
          : Number.POSITIVE_INFINITY
      if (playTime < nextTrigger) {
        scheduleWake((nextTrigger - playTime) * 1000)
        return
      }
    }
  }

  function scheduleFrame(): void {
    if (cancelFrame) return
    cancelFrame = requestAnimationFrameWithFallback(
      (now) => frame(now),
      120,
      options.frameScheduler
    )
  }

  function scheduleWake(delayMs: number): void {
    if (cancelWake) return
    const onWake = (): void => {
      cancelWake = null
      scheduleFrame()
    }
    if (options.frameScheduler) {
      const handle = options.frameScheduler.scheduleTimeout(onWake, Math.max(50, delayMs))
      cancelWake = () => options.frameScheduler?.clearTimeout(handle)
    } else if (typeof window !== 'undefined') {
      const handle = window.setTimeout(onWake, Math.max(50, delayMs))
      cancelWake = () => window.clearTimeout(handle)
    }
  }

  /** Install a new interlude record; a different record restarts the dots. */
  function setInterlude(next: LyricInterlude | null): void {
    if (next == null) {
      if (record != null) reset()
      return
    }
    if (record && record.start === next.start && record.end === next.end) return
    reset()
    record = next
    entered = new Array<boolean>(count).fill(false)
    left = new Array<boolean>(count).fill(false)
    enterSprings = Array.from({ length: count }, () => new LyricSpring(0, INTERLUDE_DOT_SPRING))
    leaveSprings = Array.from({ length: count }, () => new LyricSpring(0, INTERLUDE_DOT_SPRING))
    scheduleFrame()
  }

  /** Zero every channel and stop rendering (seek, track change, teardown). */
  function reset(): void {
    record = null
    enterSprings = []
    leaveSprings = []
    entered = []
    left = []
    cancelFrame?.()
    cancelFrame = null
    cancelWake?.()
    cancelWake = null
    lastFrameNow = null
    options.onRender(null)
  }

  return { setInterlude, reset, update, interludeDotSchedule, interludeDotPeakScale }
}

export type LyricInterludeDots = ReturnType<typeof createLyricInterludeDots>
