import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSyllableGroups,
  LyricSweepChannel,
  SWEEP_EXPAND_CAP,
  SWEEP_FACTOR_DEFAULT,
  SWEEP_FACTOR_FEW_GROUPS,
  SWEEP_FACTOR_LAST_GROUP,
  SWEEP_FACTOR_SHORT_BYTES,
  SWEEP_LEAD_PX,
  SWEEP_SEEK_MIN_STEP_PX,
  SWEEP_SENTINEL_DURATION_SECONDS
} from './lyricSyllableSweep.ts'
import { LYRIC_SWEEP_SEEK_RATE } from './lyricMotion.ts'

const FRAME = 1 / 60

function word(text: string, time: number, endTime: number) {
  return { text, time, endTime }
}

function groups(words: { text: string; time: number; endTime: number; width: number }[]) {
  return buildSyllableGroups(
    words.map(({ text, time, endTime }) => word(text, time, endTime)),
    words.map(({ width }) => width)
  )
}

test('words sharing a time range merge into one group', () => {
  const built = groups([
    { text: 'lo', time: 0, endTime: 1, width: 20 },
    { text: 've', time: 0, endTime: 1, width: 20 },
    { text: 'so', time: 1, endTime: 2, width: 15 }
  ])
  assert.equal(built.length, 2)
  assert.deepEqual(built[0].wordIndices, [0, 1])
  assert.equal(built[0].endWidth, 40)
  assert.equal(built[1].startWidth, 40)
  assert.equal(built[1].endWidth, 55)
})

test('leading factors follow the documented priority', () => {
  // A 3-byte Chinese char group, a short Latin group, and the last group.
  const built = groups([
    { text: '你', time: 0, endTime: 1, width: 30 },
    { text: 'go', time: 1, endTime: 2, width: 25 },
    { text: 'now', time: 2, endTime: 3, width: 35 }
  ])
  assert.equal(built[0].factor, SWEEP_FACTOR_DEFAULT, 'a 3-byte char is not short')
  assert.equal(built[1].factor, SWEEP_FACTOR_SHORT_BYTES, '2 non-space bytes is short')
  assert.equal(built[2].factor, SWEEP_FACTOR_LAST_GROUP, 'the last group always wins')

  // A whole line with fewer than 3 groups: every non-last group takes 0.50.
  const few = groups([
    { text: '你', time: 0, endTime: 1, width: 30 },
    { text: '好', time: 1, endTime: 2, width: 30 }
  ])
  assert.equal(few[0].factor, SWEEP_FACTOR_FEW_GROUPS)
  assert.equal(few[1].factor, SWEEP_FACTOR_LAST_GROUP)
  assert.equal(SWEEP_FACTOR_DEFAULT, 0.12)
  assert.equal(SWEEP_FACTOR_SHORT_BYTES, 0.25)
  assert.equal(SWEEP_FACTOR_FEW_GROUPS, 0.5)
  assert.equal(SWEEP_FACTOR_LAST_GROUP, 1)
})

test('group targets are cumulative width plus 30 * factor', () => {
  const built = groups([
    { text: 'abcd', time: 0, endTime: 1, width: 40 },
    { text: 'ef', time: 1, endTime: 2, width: 10 }
  ])
  assert.equal(SWEEP_LEAD_PX, 30)
  assert.ok(Math.abs(built[0].target - (40 + 30 * 0.5)) < 1e-9)
  assert.ok(Math.abs(built[1].target - (50 + 30 * 1)) < 1e-9)
})

test('the first keyframe after the sentinel runs 0.25s', () => {
  const built = groups([
    { text: 'abcd', time: 0, endTime: 4, width: 40 },
    { text: 'ef', time: 4, endTime: 8, width: 10 }
  ])
  const channel = new LyricSweepChannel(built)
  assert.equal(SWEEP_SENTINEL_DURATION_SECONDS, 0.25)

  // Half of the sentinel duration: exactly half of the first target.
  channel.update(0, 0.125)
  const boundary = channel.boundary
  assert.ok(
    Math.abs(boundary - (built[0].target + 0) / 2) < 1e-9,
    `boundary ${boundary} should be half of ${built[0].target}`
  )
})

test('normal keyframes run over the group span, linearly', () => {
  const built = groups([
    { text: 'abcd', time: 0, endTime: 1, width: 40 },
    { text: 'efgh', time: 1, endTime: 2, width: 40 },
    { text: 'ijkl', time: 2, endTime: 3, width: 40 }
  ])
  const channel = new LyricSweepChannel(built)

  // Run the sentinel keyframe to completion inside group 0.
  for (let t = 0; t < 0.3; t += FRAME) channel.update(t, FRAME)
  const from = channel.boundary

  // 30 frames into group 1 (0.5s): linear progress over the stretched span.
  channel.update(1.0, FRAME)
  for (let t = 1.0 + FRAME; t < 1.5 - 1e-9; t += FRAME) channel.update(t, FRAME)
  const base = built[1].endWidth - from
  const full = built[1].target - from
  const duration = 1 * Math.min(full / base, 3)
  const expectedMid = from + full * ((30 * FRAME) / duration)
  assert.ok(
    Math.abs(channel.boundary - expectedMid) < 0.01,
    `mid ${channel.boundary} vs ${expectedMid}`
  )
})

test('expandable groups stretch the duration, capped at 3x', () => {
  const built = groups([
    { text: 'abcd', time: 0, endTime: 1, width: 40 },
    { text: 'efgh', time: 1, endTime: 2, width: 40 },
    { text: 'ijkl', time: 2, endTime: 3, width: 40 }
  ])
  const channel = new LyricSweepChannel(built)

  // Finish the first two groups' keyframes.
  for (let t = 0; t < 2.0; t += FRAME) channel.update(t, FRAME)

  // The last group: base distance = 120 - boundary, full = 150 - boundary.
  // duration = 1 * min(full / base, 3) > 1: at 1s in, the boundary has not
  // reached the target yet.
  for (let t = 2.0; t < 3.0 - 1e-9; t += FRAME) channel.update(t, FRAME)
  assert.ok(
    channel.boundary < built[2].target,
    'the stretched keyframe must still be running at the group end'
  )
  for (let t = 3.0; t < 4.5; t += FRAME) channel.update(t, FRAME)
  assert.ok(Math.abs(channel.boundary - built[2].target) < 1e-6, 'the keyframe lands on the target')
  assert.equal(SWEEP_EXPAND_CAP, 3)
})

test('zero-span groups fall back to a 1s duration', () => {
  const built = groups([
    { text: 'abcd', time: 0, endTime: 1, width: 40 },
    { text: 'efgh', time: 1, endTime: 1, width: 40 },
    { text: 'ijkl', time: 1, endTime: 2, width: 40 }
  ])
  // The zero-span group merges nothing; its keyframe duration falls back.
  const channel = new LyricSweepChannel(built)
  for (let t = 0; t < 1.0; t += FRAME) channel.update(t, FRAME)
  channel.update(1.0, FRAME)
  // One frame in: the boundary moved a tiny fraction of the 1s fallback.
  const start = channel.boundary
  channel.update(1.0 + FRAME, FRAME)
  assert.ok(
    channel.boundary - start < (built[1].target - start) * 0.05,
    'a zero-span group must not jump to its target'
  )
})

test('before the first group and past the last, the boundary clamps', () => {
  const built = groups([
    { text: 'abcd', time: 2, endTime: 4, width: 40 },
    { text: 'efgh', time: 4, endTime: 6, width: 40 },
    { text: 'ijkl', time: 6, endTime: 8, width: 40 }
  ])
  const channel = new LyricSweepChannel(built)

  assert.equal(channel.update(1.0, FRAME), 0, 'before the first group the boundary is 0')
  // Past the last group without ever entering it: the final tail directly.
  const fresh = new LyricSweepChannel(built)
  assert.equal(fresh.update(9.0, FRAME), 120 + 30, 'past the end the tail applies directly')
})

test('after a seek the boundary follows the instant position at 12 s^-1', () => {
  const built = groups([
    { text: 'abcd', time: 0, endTime: 4, width: 40 },
    { text: 'efgh', time: 4, endTime: 8, width: 40 },
    { text: 'ijkl', time: 8, endTime: 12, width: 40 }
  ])
  const channel = new LyricSweepChannel(built)
  for (let t = 0; t < 4.0; t += FRAME) channel.update(t, FRAME)

  // Seek into group 1: the instant position is 40 + (55 - 40) * 0.75.
  channel.markSeek(7.0)
  const instant = channel.instantBoundary(7.0)
  const expected = 40 + (built[1].target - 40) * 0.75
  assert.ok(Math.abs(instant - expected) < 1e-9)

  // A wide gap keeps the exact exponential low-pass shape.
  const before = channel.boundary
  assert.ok(Math.abs(instant - before) > SWEEP_SEEK_MIN_STEP_PX)
  channel.update(7.0, 0.1)
  const after = channel.boundary
  const alpha = 1 - Math.exp(-LYRIC_SWEEP_SEEK_RATE * 0.1)
  assert.ok(Math.abs(after - (before + (instant - before) * alpha)) < 1e-9)

  // Catching up continues across frames until the next group boundary.
  for (let t = 7.0; t < 7.9; t += FRAME) channel.update(t, FRAME)
  const nextInstant = channel.instantBoundary(7.9)
  assert.ok(
    Math.abs(channel.boundary - nextInstant) < 1.0,
    `boundary ${channel.boundary} should track ${nextInstant}`
  )

  // Crossing into group 2 resumes the keyframe machine.
  channel.update(8.0, FRAME)
  const keyframeBoundary = channel.boundary
  channel.update(8.0 + FRAME, FRAME)
  assert.ok(channel.boundary !== keyframeBoundary)
})

test('a narrow seek gap still lands through the per-frame travel floor', () => {
  const built = groups([
    { text: 'abcd', time: 0, endTime: 4, width: 40 },
    { text: 'efgh', time: 4, endTime: 8, width: 40 }
  ])
  const channel = new LyricSweepChannel(built)
  for (let t = 0; t < 4.0; t += FRAME) channel.update(t, FRAME)

  // Track a moving instant, then seek a hair forward: the remaining gap is
  // narrower than the travel floor, so one frame lands the boundary instead
  // of stalling on the exponential tail.
  channel.markSeek(7.5)
  for (let t = 7.5; t < 7.9; t += FRAME) channel.update(t, FRAME)
  channel.markSeek(7.9)
  const instant = channel.instantBoundary(7.9)
  channel.update(7.9, 0.1)
  assert.ok(
    Math.abs(channel.boundary - instant) < 1e-9,
    `boundary ${channel.boundary} should land on ${instant}`
  )
})

test('finished reports the tail landing', () => {
  const built = groups([
    { text: 'abcd', time: 0, endTime: 1, width: 40 },
    { text: 'efgh', time: 1, endTime: 2, width: 40 },
    { text: 'ijkl', time: 2, endTime: 3, width: 40 }
  ])
  const channel = new LyricSweepChannel(built)
  assert.ok(!channel.finished(2.5))
  for (let t = 0; t < 4.0; t += FRAME) channel.update(t, FRAME)
  assert.ok(channel.finished(3.5))
})
