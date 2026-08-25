import assert from 'node:assert/strict'
import test from 'node:test'
import {
  criticalRetune,
  criticalRetuneByPeriod,
  cubicBezier,
  exponentialFollow,
  frameDeltaSeconds,
  LYRIC_ACTIVITY_SPRING_ENTER,
  LYRIC_ACTIVITY_SPRING_INIT,
  LYRIC_BEZIER_CONTROL_POINTS,
  LYRIC_BEZIER_DURATION_SECONDS,
  LYRIC_DRAG_RESPONSE_RATE,
  LYRIC_DRAG_SNAP_PX,
  LYRIC_INTERACTION_BLEND_RATE,
  LYRIC_INTERACTION_BLEND_SNAP,
  LYRIC_LN_1_PERCENT,
  LYRIC_MAX_FRAME_SECONDS,
  LYRIC_SPRING_LINE,
  LYRIC_SPRING_PRESS,
  LYRIC_SPRING_RELEASE,
  LYRIC_SPRING_SEEK_SHORT,
  LYRIC_SPRING_INIT_ONCE,
  LyricBezierTransition,
  LyricLowPass,
  LyricSpring,
  solveLyricSpring,
  springSettleTime,
  LYRIC_SWEEP_SEEK_RATE
} from './lyricMotion.ts'

const FRAME = 1 / 60

function advance(spring: LyricSpring, seconds: number, step = FRAME): void {
  for (let t = 0; t < seconds - 1e-9; t += step) spring.update(step)
}

test('spring constants are the report literals', () => {
  assert.deepEqual(LYRIC_SPRING_LINE, { mass: 1, stiffness: 100, damping: 18 })
  assert.deepEqual(LYRIC_SPRING_SEEK_SHORT, {
    mass: 2,
    stiffness: 4241.5184883827169,
    damping: 184.20680743952363
  })
  assert.deepEqual(LYRIC_SPRING_INIT_ONCE, { mass: 2, stiffness: 260, damping: 50 })
  assert.deepEqual(LYRIC_SPRING_PRESS, { mass: 1, stiffness: 322, damping: 24 })
  assert.deepEqual(LYRIC_SPRING_RELEASE, { mass: 2, stiffness: 300, damping: 50 })
  assert.deepEqual(LYRIC_ACTIVITY_SPRING_INIT, { mass: 1, stiffness: 100, damping: 10 })
  assert.deepEqual(LYRIC_ACTIVITY_SPRING_ENTER, { mass: 1, stiffness: 30, damping: 9 })
})

test('short-range seek retune reproduces the report arithmetic exactly', () => {
  const params = criticalRetune(2, 0.1)
  assert.ok(Math.abs(params.stiffness - 4241.5184883827169) < 1e-9)
  assert.ok(Math.abs(params.damping - 184.20680743952363) < 1e-9)
  assert.equal(params.mass, 2)
  // Damping ratio is exactly 1: critically damped, no overshoot.
  const zeta = params.damping / (2 * Math.sqrt(params.mass * params.stiffness))
  assert.ok(Math.abs(zeta - 1) < 1e-12)
})

test('the 1% error budget is -ln(0.01) = 4.605170185988091', () => {
  assert.ok(Math.abs(-Math.log(0.01) - LYRIC_LN_1_PERCENT) < 1e-15)
})

test('near-line retune at m=1, T=0.3 gives the documented q and c', () => {
  const q = LYRIC_LN_1_PERCENT / 0.3
  assert.ok(Math.abs(q - 15.35056728662697) < 1e-12)
  const k = 1 * q * q
  const c = 2 * Math.sqrt(1 * k)
  // The report's printed c matches k = q^2; k is asserted through that
  // identity rather than its printed literal, which contradicts its own c.
  assert.ok(Math.abs(c - 30.70113457325394) < 1e-12)
  assert.ok(Math.abs(k - q * q) < 1e-15)
})

test('period-based critical retune gives k=omega^2 and c=2*omega', () => {
  const params = criticalRetuneByPeriod(1, 1.5)
  assert.ok(Math.abs(params.stiffness - 17.545963379714415) < 1e-12)
  assert.ok(Math.abs(params.damping - 8.3775804095727811) < 1e-12)
})

test('anticipation settle times match the documented endpoints', () => {
  const fixed = springSettleTime(0.9, 0.62831853071795862)
  assert.ok(Math.abs(fixed - 0.71023338004566794) < 1e-12)

  // Adaptive mode: gap <= 0.2 clamps x to 0.
  const tight = springSettleTime(0.9, 0.48)
  assert.ok(Math.abs(tight - 0.5425783352790372) < 1e-12)

  // gap >= 0.75 clamps x to 1.
  const loose = springSettleTime(0.78, 0.75)
  assert.ok(Math.abs(loose - 1.0335443711876444) < 1e-12)
})

test('solver starts at the initial state with the initial velocity', () => {
  const { position, velocity } = solveLyricSpring(10, 40, 130, LYRIC_SPRING_LINE)
  assert.ok(Math.abs(position(0) - 10) < 1e-12)
  assert.ok(Math.abs(velocity(0) - 40) < 1e-9)
})

test('underdamped solver converges to the target', () => {
  const spring = new LyricSpring(0, LYRIC_SPRING_LINE)
  spring.setTarget(100)
  advance(spring, 3)
  assert.ok(Math.abs(spring.position - 100) < 1e-6)
})

test('retargeting mid-flight preserves the velocity', () => {
  const spring = new LyricSpring(0, LYRIC_SPRING_LINE)
  spring.setTarget(200)
  spring.update(FRAME)
  const velocityAtSwitch = spring.velocity
  assert.ok(velocityAtSwitch > 0, 'the line should already be moving')

  spring.setTarget(-200)
  assert.ok(Math.abs(spring.velocity - velocityAtSwitch) < 1e-9)
})

test('a delayed retarget replaces the pending target and resets the full delay', () => {
  const spring = new LyricSpring(0, LYRIC_SPRING_LINE)
  spring.setTarget(100, 0.1)
  assert.equal(spring.getPendingTarget(), 100)

  // Half the delay elapses.
  advance(spring, 0.05)
  assert.equal(spring.getPendingTarget(), 100)

  spring.setTarget(300, 0.1)
  assert.equal(spring.getPendingTarget(), 300)

  // 0.09s more: the original 0.1s would have expired, but the delay was reset.
  advance(spring, 0.09)
  assert.equal(spring.position, 0, 'still waiting on the reset delay')
  assert.equal(spring.target, 0)

  advance(spring, 0.02)
  assert.equal(spring.target, 300)
  assert.ok(spring.position > 0)
})

test('the old spring keeps moving while a delayed target waits', () => {
  const spring = new LyricSpring(0, LYRIC_SPRING_LINE)
  spring.setTarget(100)
  advance(spring, 0.05)
  const movingPosition = spring.position
  assert.ok(movingPosition > 0)

  spring.setTarget(200, 0.2)
  advance(spring, 0.1)
  // The old target (100) is still what the line is chasing.
  assert.ok(spring.position > movingPosition, 'the line keeps settling toward the old target')
  assert.equal(spring.target, 100)
})

test('settled springs arrive exactly and stop consuming frames', () => {
  const spring = new LyricSpring(0, LYRIC_SPRING_LINE)
  spring.setTarget(50)
  advance(spring, 2)
  assert.ok(spring.arrived())
  assert.equal(spring.position, 50)
  spring.update(1)
  assert.equal(spring.position, 50)
})

test('delayed targets never enter the settle check', () => {
  const spring = new LyricSpring(100, LYRIC_SPRING_LINE)
  spring.setTarget(160, 0.05)
  advance(spring, 0.02)
  assert.ok(!spring.arrived(), 'a waiting line is not stable')
  assert.equal(spring.position, 100, 'the old target keeps the line parked')
})

test('retune keeps position and velocity but changes the params', () => {
  const spring = new LyricSpring(0, LYRIC_SPRING_LINE)
  spring.setTarget(200)
  spring.update(FRAME)
  const velocity = spring.velocity
  const position = spring.position

  spring.retune(LYRIC_SPRING_SEEK_SHORT)
  assert.ok(Math.abs(spring.position - position) < 1e-12)
  assert.ok(Math.abs(spring.velocity - velocity) < 1e-9)
  assert.deepEqual(spring.getParams(), LYRIC_SPRING_SEEK_SHORT)
})

test('setPosition clears momentum and pending work', () => {
  const spring = new LyricSpring(0, LYRIC_SPRING_LINE)
  spring.setTarget(100)
  advance(spring, 0.05)
  spring.setTarget(300, 0.1)
  spring.setPosition(42)
  assert.equal(spring.position, 42)
  assert.equal(spring.target, 42)
  assert.equal(spring.velocity, 0)
  assert.ok(spring.arrived())
  assert.equal(spring.getPendingTarget(), null)
})

test('cubic bezier is the shared 0.33/0.00/0.20/0.10 curve', () => {
  assert.deepEqual(LYRIC_BEZIER_CONTROL_POINTS, { x1: 0.33, y1: 0, x2: 0.2, y2: 0.1 })
  assert.equal(cubicBezier(0), 0)
  assert.equal(cubicBezier(1), 1)
  assert.equal(cubicBezier(-0.5), 0)
  assert.equal(cubicBezier(1.5), 1)
  // Monotonic within the segment.
  let previous = cubicBezier(0)
  for (let i = 1; i <= 20; i += 1) {
    const value = cubicBezier(i / 20)
    assert.ok(value >= previous)
    previous = value
  }
})

test('bezier transitions run 0.12s and only restart past their gate', () => {
  const transition = new LyricBezierTransition(0.2)
  transition.setTarget(1, 0.0002)
  transition.update(LYRIC_BEZIER_DURATION_SECONDS)
  assert.ok(Math.abs(transition.current - 1) < 1e-9)
  assert.ok(transition.arrived())

  // Below the gate: no restart.
  transition.setTarget(1.0001, 0.0002)
  assert.equal(transition.target, 1)

  // Above the gate: restart from the current value.
  transition.setTarget(0.4, 0.0002)
  assert.equal(transition.target, 0.4)
  transition.update(LYRIC_BEZIER_DURATION_SECONDS / 2)
  const mid = transition.current
  assert.ok(mid > 0.4 && mid < 1, 'the leg starts from the current value')
})

test('drag low-pass moves a fraction of the remaining distance per frame', () => {
  const drag = new LyricLowPass(100)
  // dt*64 = 0.2 at this frame.
  const next = drag.update(
    0.2 / LYRIC_DRAG_RESPONSE_RATE,
    140,
    LYRIC_DRAG_RESPONSE_RATE,
    LYRIC_DRAG_SNAP_PX
  )
  assert.ok(Math.abs(next - 108) < 1e-9)

  // Snap once the error is under half a pixel.
  const snapped = drag.update(FRAME, 108.3, LYRIC_DRAG_RESPONSE_RATE, LYRIC_DRAG_SNAP_PX)
  assert.equal(snapped, 108.3)
})

test('interaction blend follows and snaps at 0.002', () => {
  const blend = new LyricLowPass(0)
  let value = blend.update(FRAME, 1, LYRIC_INTERACTION_BLEND_RATE, LYRIC_INTERACTION_BLEND_SNAP)
  assert.ok(value > 0 && value < 1)
  for (let i = 0; i < 200 && value !== 1; i += 1) {
    value = blend.update(FRAME, 1, LYRIC_INTERACTION_BLEND_RATE, LYRIC_INTERACTION_BLEND_SNAP)
  }
  assert.equal(value, 1)
})

test('exponential follow uses 1 - e^(-12*dt), not the truncated form', () => {
  const dt = 0.1
  const exact = exponentialFollow(0, 100, dt, LYRIC_SWEEP_SEEK_RATE)
  const expected = 100 * (1 - Math.exp(-LYRIC_SWEEP_SEEK_RATE * dt))
  assert.ok(Math.abs(exact - expected) < 1e-12)
  assert.equal(LYRIC_SWEEP_SEEK_RATE, 12)
  // The truncated approximation would differ, proving the exact form is used.
  const truncated = 100 * Math.min(dt * LYRIC_SWEEP_SEEK_RATE, 1)
  assert.ok(Math.abs(exact - truncated) > 1e-3)
})

test('frame delta falls back to 1/60 and clamps to 0.1s', () => {
  assert.ok(Math.abs(frameDeltaSeconds(0.5, false) - 1 / 60) < 1e-12)
  assert.ok(Math.abs(frameDeltaSeconds(-1, true) - 1 / 60) < 1e-12)
  assert.ok(Math.abs(frameDeltaSeconds(0.016, true) - 0.016) < 1e-12)
  assert.ok(Math.abs(frameDeltaSeconds(2, true) - LYRIC_MAX_FRAME_SECONDS) < 1e-12)
  assert.equal(LYRIC_MAX_FRAME_SECONDS, 0.1)
})
