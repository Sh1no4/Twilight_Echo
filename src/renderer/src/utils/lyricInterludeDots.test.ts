import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLyricInterludeDots,
  INTERLUDE_DOT_COUNT,
  INTERLUDE_DOT_PEAK_GAIN,
  INTERLUDE_DOT_SPREAD,
  INTERLUDE_DOT_SPRING,
  INTERLUDE_DOT_STEP_FLOOR_SECONDS,
  INTERLUDE_DOT_STEP_RATIO,
  interludeDotPeakScale,
  interludeDotSchedule,
  type InterludeDotState
} from './lyricInterludeDots.ts'

const FRAME = 1 / 60

/** Node has no `window`; the tests drive `update()` directly instead. */
function inertScheduler() {
  const frames = new Map<number, FrameRequestCallback>()
  const timeouts = new Map<number, () => void>()
  let handle = 0
  return {
    request: (callback: FrameRequestCallback) => {
      handle += 1
      frames.set(handle, callback)
      return handle
    },
    cancel: (target: number) => {
      frames.delete(target)
    },
    scheduleTimeout: (callback: () => void) => {
      handle += 1
      timeouts.set(handle, callback)
      return handle
    },
    clearTimeout: (target: number) => {
      timeouts.delete(target)
    },
    now: () => 0
  }
}

function harness() {
  const playhead = { value: 0 }
  const renders: (readonly InterludeDotState[] | null)[] = []
  const dots = createLyricInterludeDots({
    getPlaybackTime: () => playhead.value,
    onRender: (states) => renders.push(states),
    frameScheduler: inertScheduler()
  })
  return { playhead, renders, dots }
}

test('the schedule staggers dots at max(D/n*0.4, 0.4) with a 2D/n tail', () => {
  const { step, tail } = interludeDotSchedule(12, 3)
  assert.ok(Math.abs(step - 1.6) < 1e-12, `step ${step}`)
  assert.ok(Math.abs(tail - 8) < 1e-12, `tail ${tail}`)
  assert.equal(INTERLUDE_DOT_STEP_RATIO, 0.4)

  // Short durations floor the step at 0.4s.
  const floored = interludeDotSchedule(0.6, 3)
  assert.ok(Math.abs(floored.step - INTERLUDE_DOT_STEP_FLOOR_SECONDS) < 1e-12)
  assert.ok(Math.abs(floored.tail - 0.4) < 1e-12)
})

test('peak scale saturates at 1.14 for D >= 2', () => {
  assert.ok(Math.abs(interludeDotPeakScale(0.5) - 1) < 1e-12)
  assert.ok(Math.abs(interludeDotPeakScale(1) - 1) < 1e-12)
  assert.ok(Math.abs(interludeDotPeakScale(1.5) - (1 + INTERLUDE_DOT_PEAK_GAIN * 0.5)) < 1e-12)
  assert.ok(Math.abs(interludeDotPeakScale(2) - 1.14) < 1e-12)
  assert.ok(Math.abs(interludeDotPeakScale(20) - 1.14) < 1e-12)
})

test('the dot spring is critically damped over 1.5s', () => {
  assert.ok(Math.abs(INTERLUDE_DOT_SPRING.stiffness - 17.545963379714415) < 1e-12)
  assert.ok(Math.abs(INTERLUDE_DOT_SPRING.damping - 8.3775804095727811) < 1e-12)
  assert.equal(INTERLUDE_DOT_SPRING.mass, 1)
})

test('dots enter staggered and spread symmetrically around the midline', () => {
  const { playhead, dots } = harness()
  dots.setInterlude({ start: 3, end: 15, afterIndex: 0, gap: 12.5 })
  // D = 12: step = 1.6, tail = 8. Enter triggers at 4.6, 6.2, 7.8.
  playhead.value = 3.0
  assert.ok(dots.update(3.0, FRAME))
  // Run inside the window until the first two dots have entered.
  let states: readonly InterludeDotState[] | null = null
  for (let t = 3.0; t < 6.5; t += FRAME) states = dots.update(t, FRAME)
  assert.ok(states)
  assert.ok((states?.[0].gate ?? 0) > 0.5, 'dot 0 has entered')
  assert.ok((states?.[1].gate ?? 0) > 0, 'dot 1 has begun entering')
  assert.equal(states?.[2].gate ?? 1, 0, 'dot 2 has not entered yet')

  // Symmetric spread: dot 0 below, dot 2 above. Run until every enter spring
  // has settled but before the first leave trigger (4.6 + 8 = 12.6).
  for (let t = 6.5; t < 12.5; t += FRAME) states = dots.update(t, FRAME)
  assert.ok(states)
  const [first, , third] = states ?? []
  assert.ok((first?.verticalOffset ?? 0) < 0, 'dot 0 sits below the midline')
  assert.ok((third?.verticalOffset ?? 0) > 0, 'dot 2 sits above the midline')
  assert.ok(
    Math.abs((first?.verticalOffset ?? 0) + (third?.verticalOffset ?? 0)) < 1e-9,
    'the spread is symmetric'
  )
  assert.equal(INTERLUDE_DOT_SPREAD, 0.5)
})

test('gate scales each dot by (1 - leave) * enter with the peak gain', () => {
  const { dots } = harness()
  dots.setInterlude({ start: 0, end: 12, afterIndex: 0, gap: 12.5 })
  let states: readonly InterludeDotState[] | null = null
  for (let t = 0; t < 3; t += FRAME) states = dots.update(t, FRAME)
  assert.ok(states)
  const gate = states?.[0].gate ?? 0
  const scale = states?.[0].scale ?? 0
  assert.ok(Math.abs(scale - (1 + 0.14 * gate)) < 1e-12)
})

test('leaving the interlude range resets every channel', () => {
  const { dots } = harness()
  dots.setInterlude({ start: 0, end: 12, afterIndex: 0, gap: 12.5 })
  for (let t = 0; t < 5; t += FRAME) dots.update(t, FRAME)

  // Playback jumps far past the end: the dots reset entirely.
  assert.equal(dots.update(20, FRAME), null)
  assert.equal(dots.update(10, FRAME), null, 'the record is gone after the reset')

  // And before the start counts as leaving too.
  const second = harness()
  second.dots.setInterlude({ start: 4, end: 16, afterIndex: 0, gap: 12.5 })
  for (let t = 4; t < 8; t += FRAME) second.dots.update(t, FRAME)
  assert.equal(second.dots.update(1, FRAME), null)
})

test('a null record hides the dots without touching a live one', () => {
  const { dots, renders } = harness()
  dots.setInterlude(null)
  assert.equal(renders.length, 0)

  dots.setInterlude({ start: 0, end: 12, afterIndex: 0, gap: 12.5 })
  dots.setInterlude({ start: 0, end: 12, afterIndex: 0, gap: 12.5 })
  assert.equal(renders.length, 1, 'an identical record is not reinstalled')
  dots.setInterlude(null)
  assert.equal(renders.at(-1), null)
})

test('the default layout is three dots', () => {
  assert.equal(INTERLUDE_DOT_COUNT, 3)
})
