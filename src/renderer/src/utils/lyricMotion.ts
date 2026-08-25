export interface LyricSpringParams {
  mass: number
  stiffness: number
  damping: number
}

/**
 * LyricsBlossom motion core. Every value and threshold here mirrors the
 * reverse-engineered Windows baseline configuration, so the constants are kept
 * verbatim (including full double precision) rather than derived or rounded:
 * tests assert them as documentation anchors.
 */

/** Ordinary line Y and overall-scale spring: slightly underdamped (zeta = 0.9). */
export const LYRIC_SPRING_LINE: LyricSpringParams = { mass: 1, stiffness: 100, damping: 18 }

/**
 * Short-range seek spring: critically damped to settle within T = 0.1s at 1%
 * error. Written verbatim from the report: k = 2*46.051701859880907^2,
 * c = 2*sqrt(2*4241.5184883827169).
 */
export const LYRIC_SPRING_SEEK_SHORT: LyricSpringParams = {
  mass: 2,
  stiffness: 4241.5184883827169,
  damping: 184.20680743952363
}

/** One-shot initialization values; immediately retuned by the seek classifier. */
export const LYRIC_SPRING_INIT_ONCE: LyricSpringParams = {
  mass: 2,
  stiffness: 260,
  damping: 50
}

/** Click press spring: target 0.95, more elastic. */
export const LYRIC_SPRING_PRESS: LyricSpringParams = { mass: 1, stiffness: 322, damping: 24 }

/** Click release spring: target 1.0, brakes harder. */
export const LYRIC_SPRING_RELEASE: LyricSpringParams = { mass: 2, stiffness: 300, damping: 50 }

/** Activity spring initial values (`LineRenderState+0x318`). */
export const LYRIC_ACTIVITY_SPRING_INIT: LyricSpringParams = {
  mass: 1,
  stiffness: 100,
  damping: 10
}

/** Activity spring when an auxiliary/special line enters the active state. */
export const LYRIC_ACTIVITY_SPRING_ENTER: LyricSpringParams = { mass: 1, stiffness: 30, damping: 9 }

/** Opacity and blur share one curve and one duration. */
export const LYRIC_BEZIER_CONTROL_POINTS = { x1: 0.33, y1: 0, x2: 0.2, y2: 0.1 }
export const LYRIC_BEZIER_DURATION_SECONDS = 0.12

/** Target changes below these deltas do not restart the bezier transitions. */
export const LYRIC_OPACITY_RESTART_THRESHOLD = 0.0002
export const LYRIC_BLUR_RESTART_THRESHOLD = 0.01

/** Manual-drag offset follow: truncated first-order low-pass at 64 s^-1. */
export const LYRIC_DRAG_RESPONSE_RATE = 64
/** Drag offset snaps once the remaining error is under half a pixel. */
export const LYRIC_DRAG_SNAP_PX = 0.5
/** Wheel/touch input accumulates as 2 * deviceScale * delta. */
export const LYRIC_DRAG_INPUT_GAIN = 2

/** Interaction de-blend: truncated low-pass at 14 s^-1, snapping at 0.002. */
export const LYRIC_INTERACTION_BLEND_RATE = 14
export const LYRIC_INTERACTION_BLEND_SNAP = 0.002

/** Seek karaoke-sweep catch-up: exact exponential follow at 12 s^-1. */
export const LYRIC_SWEEP_SEEK_RATE = 12

/** Post-seek karaoke edge convergence threshold, in px. */
export const LYRIC_SWEEP_SEEK_SNAP_PX = 0.5

/** Frame time rules: first/invalid frame 1/60, clamped to at most 0.1s. */
export const LYRIC_FIRST_FRAME_SECONDS = 1 / 60
export const LYRIC_MAX_FRAME_SECONDS = 0.1

/** Settle gate for position/velocity/acceleration, per the report. */
const SETTLE_EPSILON = 0.01

/** Delayed-target change gates: Y in pixels, scale as a ratio. */
export const LYRIC_TARGET_Y_CHANGE_GATE = 0.1
export const LYRIC_TARGET_SCALE_CHANGE_GATE = 0.01

/** `-ln(0.01)`, the 1% error budget shared by the retune formulas. */
export const LYRIC_LN_1_PERCENT = 4.605170185988091

/**
 * Retune a mass-damper-spring to be critically damped with `epsilon`
 * remaining error at time `T`:
 *
 *   q = -ln(epsilon) / T
 *   k = m * q^2
 *   c = 2 * sqrt(m * k)
 */
export function criticalRetune(
  mass: number,
  settleSeconds: number,
  epsilon = 0.01
): LyricSpringParams {
  const q = -Math.log(epsilon) / settleSeconds
  const stiffness = mass * q * q
  return { mass, stiffness, damping: 2 * Math.sqrt(mass * stiffness) }
}

/** Critically damped params from an explicit period: k = omega^2, c = 2*omega. */
export function criticalRetuneByPeriod(mass: number, period: number): LyricSpringParams {
  const omega = (2 * Math.PI) / period
  return { mass, stiffness: omega * omega, damping: 2 * omega }
}

/** Anticipation settle time from damping ratio and undamped period. */
export function springSettleTime(zeta: number, period: number, epsilon = 0.00073): number {
  const omega0 = (2 * Math.PI) / period
  if (zeta >= 1) return -Math.log(epsilon) / (omega0 * zeta)
  if (zeta <= 0) return Number.POSITIVE_INFINITY
  return Math.log(Math.sqrt(1 - zeta * zeta) / epsilon) / (omega0 * zeta)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

/**
 * Analytical spring solver, closed form. The report deliberately evaluates the
 * solution at elapsed time rather than integrating per frame, so any frame
 * rate yields the same trajectory. The velocity companion is exact, not a
 * numerical derivative, because retargets and retunes must carry true state.
 */
export function solveLyricSpring(
  from: number,
  velocity: number,
  to: number,
  params: LyricSpringParams
): { position: (t: number) => number; velocity: (t: number) => number } {
  const { mass, stiffness, damping } = params
  const delta = to - from
  const omega0 = Math.sqrt(stiffness / mass)
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))

  if (zeta >= 1) {
    const omega = omega0 * Math.sqrt(zeta * zeta - 1)
    if (omega === 0) {
      // Critically damped: repeated root -omega0.
      const leftover = omega0 * delta - velocity
      const position = (t: number): number => to - (delta + t * leftover) * Math.exp(-omega0 * t)
      const vel = (t: number): number =>
        (omega0 * (delta + t * leftover) - leftover) * Math.exp(-omega0 * t)
      return { position, velocity: vel }
    }
    // Over damped: two real roots r1 (slow) and r2 (fast).
    const r1 = -zeta * omega0 + omega
    const r2 = -zeta * omega0 - omega
    const b = (-velocity - r1 * delta) / (r2 - r1)
    const a = delta - b
    const position = (t: number): number => to - (a * Math.exp(r1 * t) + b * Math.exp(r2 * t))
    const vel = (t: number): number => -(a * r1 * Math.exp(r1 * t) + b * r2 * Math.exp(r2 * t))
    return { position, velocity: vel }
  }

  // Under damped: decaying oscillation.
  const omegaD = omega0 * Math.sqrt(1 - zeta * zeta)
  const b = (zeta * omega0 * delta - velocity) / omegaD
  const position = (t: number): number =>
    to - (delta * Math.cos(omegaD * t) + b * Math.sin(omegaD * t)) * Math.exp(-zeta * omega0 * t)
  const vel = (t: number): number => {
    const decay = Math.exp(-zeta * omega0 * t)
    const dOscillation = -delta * omegaD * Math.sin(omegaD * t) + b * omegaD * Math.cos(omegaD * t)
    const oscillation = delta * Math.cos(omegaD * t) + b * Math.sin(omegaD * t)
    return -(dOscillation * decay - oscillation * zeta * omega0 * decay)
  }
  return { position, velocity: vel }
}

/**
 * One animation channel. A retarget carries the current velocity into the new
 * solver, a delayed retarget replaces any pending one and resets the full
 * delay, and the settle gate matches the report's literal comparison (the
 * velocity and acceleration terms are not wrapped in abs).
 */
export class LyricSpring {
  private positionValue: number
  private targetValue: number
  private elapsed = 0
  private params: LyricSpringParams
  private solve: (t: number) => number
  private solveVelocity: (t: number) => number
  private pending: { target: number; remainingDelay: number } | undefined
  private settled = true

  constructor(position = 0, params: LyricSpringParams = LYRIC_SPRING_LINE) {
    this.positionValue = position
    this.targetValue = position
    this.params = params
    this.solve = () => this.targetValue
    this.solveVelocity = () => 0
  }

  get position(): number {
    return this.positionValue
  }

  get target(): number {
    return this.targetValue
  }

  get velocity(): number {
    return this.solveVelocity(this.elapsed)
  }

  getPendingTarget(): number | null {
    return this.pending?.target ?? null
  }

  hasPendingWork(): boolean {
    return this.pending !== undefined || !this.settled
  }

  arrived(): boolean {
    return this.settled && this.pending === undefined
  }

  /** Jump without animating; clears velocity and any queued work. */
  setPosition(position: number): void {
    this.positionValue = position
    this.targetValue = position
    this.elapsed = 0
    this.pending = undefined
    this.settled = true
    this.solve = () => this.targetValue
    this.solveVelocity = () => 0
  }

  /** Change mass/stiffness/damping while keeping position and velocity. */
  retune(params: LyricSpringParams): void {
    this.params = params
    const velocity = this.velocity
    this.elapsed = 0
    const solved = solveLyricSpring(this.positionValue, velocity, this.targetValue, params)
    this.solve = solved.position
    this.solveVelocity = solved.velocity
    this.settled = false
  }

  getParams(): LyricSpringParams {
    return this.params
  }

  /**
   * Retarget. `changeGate` decides whether the target counts as moved; the
   * comparison runs against the last scheduled target, pending or applied. A
   * positive `delay` queues the retarget, replacing any pending one and
   * resetting the full delay.
   */
  setTarget(target: number, delay = 0, changeGate = 0): void {
    const reference = this.pending ? this.pending.target : this.targetValue
    if (Math.abs(target - reference) <= changeGate) return
    if (delay > 0) {
      this.pending = { target, remainingDelay: delay }
      return
    }
    this.applyTarget(target)
  }

  private applyTarget(target: number): void {
    const velocity = this.velocity
    this.targetValue = target
    this.elapsed = 0
    const solved = solveLyricSpring(this.positionValue, velocity, target, this.params)
    this.solve = solved.position
    this.solveVelocity = solved.velocity
    this.settled = false
  }

  /**
   * Advance by `dt` seconds. The old solver keeps evaluating while a delayed
   * target waits; on the expiry frame the old spring is first solved to the
   * current moment, then the new solver takes over from that state, and the
   * in-frame remainder past zero is not compensated.
   */
  update(dt: number): void {
    this.elapsed += dt
    this.positionValue = this.solve(this.elapsed)

    if (this.pending) {
      this.pending.remainingDelay -= dt
      if (this.pending.remainingDelay <= 0) {
        const target = this.pending.target
        this.pending = undefined
        this.applyTarget(target)
      }
      return
    }

    if (
      Math.abs(this.targetValue - this.positionValue) < SETTLE_EPSILON &&
      this.velocity < SETTLE_EPSILON &&
      this.solveAcceleration() < SETTLE_EPSILON
    ) {
      this.positionValue = this.targetValue
      this.elapsed = 0
      this.solve = () => this.targetValue
      this.solveVelocity = () => 0
      this.settled = true
    }
  }

  private solveAcceleration(): number {
    const h = 1e-3
    const v = this.solveVelocity
    return (v(this.elapsed + h) - v(this.elapsed - h)) / (2 * h)
  }
}

interface BezierPolynomial {
  a: number
  b: number
  c: number
}

function bezierPolynomial(p1: number, p2: number): BezierPolynomial {
  return { a: 3 * p1 - 3 * p2 + 1, b: 3 * p2 - 6 * p1, c: 3 * p1 }
}

function evalBezier(t: number, co: BezierPolynomial): number {
  return ((co.a * t + co.b) * t + co.c) * t
}

function evalBezierDerivative(t: number, co: BezierPolynomial): number {
  return (3 * co.a * t + 2 * co.b) * t + co.c
}

/** Cubic bezier evaluation with Newton-Raphson inversion, max 8 iterations. */
export function cubicBezier(p: number): number {
  const { x1, y1, x2, y2 } = LYRIC_BEZIER_CONTROL_POINTS
  const bounded = clamp(p, 0, 1)
  if (bounded <= 0) return 0
  if (bounded >= 1) return 1

  const xCo = bezierPolynomial(x1, x2)
  const yCo = bezierPolynomial(y1, y2)

  let t = bounded
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const x = evalBezier(t, xCo) - bounded
    if (Math.abs(x) < 1e-6) break
    const derivative = evalBezierDerivative(t, xCo)
    if (Math.abs(derivative) < 1e-6) break
    t = clamp(t - x / derivative, 0, 1)
  }
  return evalBezier(t, yCo)
}

/**
 * Timed A-to-B transition on the shared 0.12s bezier. Only a target change
 * above the gate restarts the animation; the current value is always the start
 * of the next leg.
 */
export class LyricBezierTransition {
  private value: number
  private from: number
  private to: number
  private elapsed = 0
  private duration: number

  constructor(value = 0, duration = LYRIC_BEZIER_DURATION_SECONDS) {
    this.value = value
    this.from = value
    this.to = value
    this.duration = duration
  }

  get current(): number {
    return this.value
  }

  get target(): number {
    return this.to
  }

  setTarget(target: number, restartGate = 0): void {
    if (Math.abs(target - this.to) <= restartGate) return
    this.from = this.value
    this.to = target
    this.elapsed = 0
  }

  snap(target: number): void {
    this.value = target
    this.from = target
    this.to = target
    this.elapsed = 0
  }

  update(dt: number): void {
    if (this.elapsed >= this.duration) {
      this.value = this.to
      return
    }
    this.elapsed += dt
    const p = clamp(this.elapsed / this.duration, 0, 1)
    this.value = lerp(this.from, this.to, cubicBezier(p))
  }

  arrived(): boolean {
    return this.elapsed >= this.duration
  }
}

/**
 * Truncated first-order low-pass: `a = min(dt*rate, 1)`, snapping to the
 * target once the remaining error is below `snap`. Used for the drag offset
 * and the interaction blend.
 */
export class LyricLowPass {
  private value: number

  constructor(initial = 0) {
    this.value = initial
  }

  get current(): number {
    return this.value
  }

  set(target: number): void {
    this.value = target
  }

  update(dt: number, target: number, rate: number, snap: number): number {
    const remaining = target - this.value
    if (Math.abs(remaining) < snap) {
      this.value = target
      return this.value
    }
    const alpha = Math.min(dt * rate, 1)
    this.value += remaining * alpha
    return this.value
  }
}

/** Exact exponential follow: `1 - e^(-rate*dt)`. Used after a seek. */
export function exponentialFollow(
  current: number,
  target: number,
  dt: number,
  rate: number
): number {
  const alpha = 1 - Math.exp(-rate * dt)
  return current + (target - current) * alpha
}

/** Frame-time rule from the report: fallback 1/60, clamped to 0.1s. */
export function frameDeltaSeconds(rawDelta: number, hasPreviousFrame: boolean): number {
  if (!hasPreviousFrame || !(rawDelta > 0)) return LYRIC_FIRST_FRAME_SECONDS
  return Math.min(rawDelta, LYRIC_MAX_FRAME_SECONDS)
}
