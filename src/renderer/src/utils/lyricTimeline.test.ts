import assert from 'node:assert/strict'
import test from 'node:test'
import type { LyricLine } from './lyrics.ts'
import {
  buildLyricTimeline,
  findLyricInterlude,
  isDisplayableInterlude,
  isNonDynamicTimeline,
  LYRIC_INTERLUDE_BEFORE_FIRST,
  LYRIC_INTERLUDE_LEAD_IN_SECONDS,
  LYRIC_INTERLUDE_MIN_GAP_SECONDS,
  LYRIC_TRAILING_LINE_SECONDS,
  type LyricInterludeQuery
} from './lyricTimeline.ts'

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

/** 0-2s, 5-7s, 20-22s: a short gap then a long one. */
const LINES: LyricLine[] = [
  line({
    time: 0,
    words: [
      { text: 'a', time: 0, endTime: 1 },
      { text: 'b', time: 1, endTime: 2 }
    ]
  }),
  line({ time: 5, words: [{ text: 'c', time: 5, endTime: 7 }] }),
  line({ time: 20, words: [{ text: 'd', time: 20, endTime: 22 }] })
]

function query(scrollToIndex: number, hasActiveLine = false): LyricInterludeQuery {
  return { scrollToIndex, hasActiveLine }
}

test('line ends come from word timing, the next line, then a trailing fallback', () => {
  const timeline = buildLyricTimeline(LINES)
  assert.equal(timeline[0].endTime, 2, 'word end wins over the next line start')
  assert.equal(timeline[1].endTime, 7)
  assert.equal(timeline[2].endTime, 22)

  const wordless = buildLyricTimeline([line({ time: 3 }), line({ time: 9 })])
  assert.equal(wordless[0].endTime, 9, 'without words, the next line start is the end')
  assert.equal(
    wordless[1].endTime,
    9 + LYRIC_TRAILING_LINE_SECONDS,
    'a trailing line gets the fallback span'
  )
})

test('a held tail keeps its line hot into the next one, producing the hand-off', () => {
  const timeline = buildLyricTimeline([
    line({ time: 0, words: [{ text: 'held', time: 0, endTime: 8 }] }),
    line({ time: 5, words: [{ text: 'next', time: 5, endTime: 9 }] })
  ])
  assert.equal(timeline[0].endTime, 8, 'the tail is not truncated at its successor')
})

test('untimed lines are marked and never carry a span', () => {
  const timeline = buildLyricTimeline([
    line({ time: 0, words: [{ text: 'a', time: 0, endTime: 2 }] }),
    line({ time: null, timed: false, text: 'plain' }),
    line({ time: 5 })
  ])
  assert.equal(timeline[1].timed, false)
  assert.equal(timeline[1].endTime, null)
})

test('a gap of exactly 7 seconds is not an interlude; anything longer is', () => {
  const timeline = buildLyricTimeline([
    line({ time: 0, words: [{ text: 'a', time: 0, endTime: 2 }] }),
    line({ time: 9, words: [{ text: 'b', time: 9, endTime: 11 }] })
  ])
  // gap is exactly 7.0: strictly greater is required.
  assert.equal(findLyricInterlude(timeline, query(0), 5), null)

  const longer = buildLyricTimeline([
    line({ time: 0, words: [{ text: 'a', time: 0, endTime: 2 }] }),
    line({ time: 9.0001, words: [{ text: 'b', time: 9.0001, endTime: 11 }] })
  ])
  const interlude = findLyricInterlude(longer, query(0), 5)
  assert.ok(interlude)
  assert.ok(interlude.gap > LYRIC_INTERLUDE_MIN_GAP_SECONDS)
  assert.ok(isDisplayableInterlude(interlude))
})

test('interlude records use the lead-in start and the next line start as end', () => {
  const timeline = buildLyricTimeline(LINES)
  // 7s -> 20s is a 13s gap.
  const interlude = findLyricInterlude(timeline, query(1), 10)
  assert.ok(interlude)
  assert.equal(interlude.afterIndex, 1)
  assert.equal(interlude.start, 7 + LYRIC_INTERLUDE_LEAD_IN_SECONDS)
  assert.equal(interlude.end, 20)
  assert.equal(LYRIC_INTERLUDE_LEAD_IN_SECONDS, 0.5)
  assert.ok(isDisplayableInterlude(interlude))
})

test('the lead-in before the first line is its own interlude', () => {
  const timeline = buildLyricTimeline([line({ time: 10, words: [] })])
  const interlude = findLyricInterlude(timeline, query(0), 2)

  assert.ok(interlude)
  assert.equal(interlude.afterIndex, LYRIC_INTERLUDE_BEFORE_FIRST)
  assert.equal(interlude.end, 10)
  assert.equal(interlude.gap, 10)
  assert.ok(isDisplayableInterlude(interlude))
})

test('nothing is an interlude while a line is still presented', () => {
  const timeline = buildLyricTimeline(LINES)
  assert.equal(findLyricInterlude(timeline, query(0, true), 3), null)
  assert.equal(isDisplayableInterlude(null), false)
})

test('voice word timings extend a grouped duet and make it dynamic', () => {
  const grouped = line({
    time: 10,
    text: 'lead',
    voices: [
      {
        voiceKey: 'lead',
        role: 'lead',
        lane: 'start',
        time: 10,
        text: 'lead',
        words: [
          { text: 'le', time: 10, endTime: 10.5 },
          { text: 'ad', time: 10.5, endTime: 11 }
        ]
      },
      {
        voiceKey: 'harmony',
        role: 'harmony',
        lane: 'end',
        time: 10.5,
        text: 'held harmony',
        words: [{ text: 'held harmony', time: 10.5, endTime: 13 }]
      }
    ]
  })
  const timeline = buildLyricTimeline([grouped, line({ time: 12 })])
  assert.equal(timeline[0].endTime, 13, 'the harmony tail must not be cut at the next row')
  assert.ok(!isNonDynamicTimeline([grouped]))
})

test('line-only lyrics are reported as non-dynamic', () => {
  assert.ok(isNonDynamicTimeline([line({ time: 0 }), line({ time: 5 })]))
  assert.ok(isNonDynamicTimeline([line({ time: 0, words: [{ text: 'a', time: 0, endTime: 1 }] })]))
  assert.ok(!isNonDynamicTimeline(LINES), 'word-level timing makes a timeline dynamic')
})

test('an empty timeline is inert', () => {
  assert.deepEqual(buildLyricTimeline([]), [])
  assert.equal(findLyricInterlude([], query(0), 5), null)
})
