import assert from 'node:assert/strict'
import test from 'node:test'
import type { LyricLine } from './lyrics.ts'
import {
  anticipationSeconds,
  createLyricActiveLineSelector,
  LYRIC_ANTICIPATION_FIXED_SECONDS,
  LYRIC_MAX_ACTIVE_LINES_DEFAULT,
  LYRIC_MAX_ACTIVE_LINES_LIMIT
} from './lyricActiveLineSelector.ts'
import { buildLyricTimeline } from './lyricTimeline.ts'

function line(partial: Partial<LyricLine> & { time: number | null }): LyricLine {
  return {
    text: partial.text ?? 'line',
    translation: null,
    romanization: null,
    timed: partial.timed ?? partial.time != null,
    words: partial.words,
    voices: partial.voices,
    rowKey: partial.rowKey,
    time: partial.time
  }
}

/** Four evenly spaced lines: 0-2, 4-6, 8-10, 12-14. */
const LINES: LyricLine[] = [
  line({ time: 0, words: [{ text: 'a', time: 0, endTime: 2 }] }),
  line({ time: 4, words: [{ text: 'b', time: 4, endTime: 6 }] }),
  line({ time: 8, words: [{ text: 'c', time: 8, endTime: 10 }] }),
  line({ time: 12, words: [{ text: 'd', time: 12, endTime: 14 }] })
]

test('fixed-mode anticipation is 0.71023338004566794 seconds', () => {
  assert.ok(Math.abs(anticipationSeconds(null) - LYRIC_ANTICIPATION_FIXED_SECONDS) < 1e-12)
  assert.ok(Math.abs(anticipationSeconds(null) - 0.71023338004566794) < 1e-12)
})

test('adaptive anticipation spans the documented gap endpoints', () => {
  // gap <= 0.2 clamps x to 0: zeta 0.9, period 0.48.
  assert.ok(Math.abs(anticipationSeconds(0) - 0.5425783352790372) < 1e-12)
  assert.ok(Math.abs(anticipationSeconds(0.2) - 0.5425783352790372) < 1e-12)
  // gap >= 0.75 clamps x to 1: zeta 0.78, period 0.75.
  assert.ok(Math.abs(anticipationSeconds(0.75) - 1.0335443711876444) < 1e-12)
  assert.ok(Math.abs(anticipationSeconds(5) - 1.0335443711876444) < 1e-12)
  // The midpoint is continuous between the endpoints.
  const middle = anticipationSeconds(0.475)
  assert.ok(middle > 0.5425783352790372 && middle < 1.0335443711876444)
})

test('queue capacity is 2 by default and clamps to 0..3', () => {
  assert.equal(LYRIC_MAX_ACTIVE_LINES_DEFAULT, 2)
  assert.equal(createLyricActiveLineSelector({}).maxActiveLines, 2)
  assert.equal(createLyricActiveLineSelector({ maxActiveLines: 9 }).maxActiveLines, 3)
  assert.equal(createLyricActiveLineSelector({ maxActiveLines: -1 }).maxActiveLines, 0)
  assert.equal(LYRIC_MAX_ACTIVE_LINES_LIMIT, 3)
})

test('a line is promoted before it starts, inside the anticipation window', () => {
  const timeline = buildLyricTimeline(LINES)
  const selector = createLyricActiveLineSelector({ adaptive: false })

  selector.advance(timeline, 1)
  // 3.0 sits past line 0's end-overlap protection (2 + 0.5): queue empty,
  // and 3.0 + 0.71 < 4 so line 1 is not yet due.
  let reading = selector.advance(timeline, 3.0)
  assert.deepEqual(reading.queue, [])

  // 3.3 + 0.71023338 > 4: line 1 is promoted ahead of its 4s start.
  reading = selector.advance(timeline, 3.3)
  assert.deepEqual(reading.queue, [1])
  assert.ok(reading.promoted)
  assert.equal(reading.changed, true)
  assert.equal(reading.currentIndex, 1)
  assert.equal(reading.candidateIndex, 2)
})

test('end-overlap protection keeps a finished line in the queue for 0.5s', () => {
  const timeline = buildLyricTimeline(LINES)
  const selector = createLyricActiveLineSelector({ adaptive: false })

  selector.advance(timeline, 1)
  // Line 0 ended at 2 but stays until 2.5.
  let reading = selector.advance(timeline, 2.4)
  assert.deepEqual(reading.queue, [0])
  reading = selector.advance(timeline, 2.5)
  assert.deepEqual(reading.queue, [], 'protection expires at exactly end + 0.5')
})

test('a seek mid-song anchors the queue at the singing line', () => {
  const timeline = buildLyricTimeline(LINES)
  const selector = createLyricActiveLineSelector({ adaptive: false })

  // At 8.5 line 2 sings; line 1 (4-6) lost its protection long ago; line 3
  // (12-14) is far ahead, so the queue holds only line 2.
  const reading = selector.advance(timeline, 8.5)
  assert.deepEqual(reading.queue, [2])
  assert.equal(reading.candidateIndex, 3)
})

test('overlapping lines coexist in the queue', () => {
  const overlap = [
    line({ time: 0, words: [{ text: 'a', time: 0, endTime: 5 }] }),
    line({ time: 3, words: [{ text: 'b', time: 3, endTime: 8 }] }),
    line({ time: 10, words: [{ text: 'c', time: 10, endTime: 12 }] })
  ]
  const timeline = buildLyricTimeline(overlap)
  const selector = createLyricActiveLineSelector({ adaptive: false })

  // A seek into the overlap: line 0 still sings and line 1 has started, so
  // both are seeded together.
  const reading = selector.advance(timeline, 4.2)
  assert.ok(reading.queue.includes(0))
  assert.ok(reading.queue.includes(1))
  assert.equal(reading.currentIndex, 1)
})

test('a promoted candidate replaces the outgoing line when it cannot append', () => {
  // Line 0 holds until its protection expires; line 1 is promoted early via
  // anticipation (start 5.5 > now), which replaces instead of appending.
  const held = [
    line({ time: 0, words: [{ text: 'a', time: 0, endTime: 5 }] }),
    line({ time: 5.5, words: [{ text: 'b', time: 5.5, endTime: 8 }] })
  ]
  const heldTimeline = buildLyricTimeline(held)
  const heldSelector = createLyricActiveLineSelector({ adaptive: false })
  heldSelector.advance(heldTimeline, 1)
  const reading = heldSelector.advance(heldTimeline, 5.0)
  // 5.0 + 0.71 >= 5.5: line 1 replaces line 0 before line 0's protection
  // (5.5) has expired, because line 1 has not started yet.
  assert.deepEqual(reading.queue, [1])
  assert.ok(reading.demoted, 'the outgoing line left the queue')
})

test('a long gap empties the queue and exposes the upcoming line start', () => {
  const timeline = buildLyricTimeline(LINES)
  const selector = createLyricActiveLineSelector({ adaptive: false })

  selector.advance(timeline, 4.5)
  const reading = selector.advance(timeline, 6.5)
  assert.deepEqual(reading.queue, [], 'line 1 ended and line 2 is not yet due')
  assert.equal(reading.currentIndex, -1)
  assert.equal(reading.candidateIndex, 2)
  assert.equal(reading.nextLineStart, 8)
})

test('backwards playback resets the selector', () => {
  const timeline = buildLyricTimeline(LINES)
  const selector = createLyricActiveLineSelector({ adaptive: false })

  selector.advance(timeline, 8.5)
  const reading = selector.advance(timeline, 1)
  assert.deepEqual(reading.queue, [0])
  assert.equal(reading.changed, true)
})

test('the queue keeps at most maxActiveLines entries', () => {
  const dense = [
    line({ time: 0, words: [{ text: 'a', time: 0, endTime: 10 }] }),
    line({ time: 1, words: [{ text: 'b', time: 1, endTime: 10 }] }),
    line({ time: 2, words: [{ text: 'c', time: 2, endTime: 10 }] }),
    line({ time: 3, words: [{ text: 'd', time: 3, endTime: 10 }] })
  ]
  const timeline = buildLyricTimeline(dense)
  const selector = createLyricActiveLineSelector({ adaptive: false })

  const reading = selector.advance(timeline, 5)
  assert.ok(reading.queue.length <= 2, `queue holds ${reading.queue.length}, expected at most 2`)
  assert.equal(reading.currentIndex, 3)
})

test('state snapshots copy the queue', () => {
  const timeline = buildLyricTimeline(LINES)
  const selector = createLyricActiveLineSelector({ adaptive: false })
  selector.advance(timeline, 4.5)
  const state = selector.getState()
  assert.deepEqual(state.queue, [1])
  assert.equal(state.candidateIndex, 2)
})
