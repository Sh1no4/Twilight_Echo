import assert from 'node:assert/strict'
import test from 'node:test'

const { buildLyricLines, parsePlainLyrics, parseTimedLrc } = (await import(
  new URL('./lyrics.ts', import.meta.url).href
)) as typeof import('./lyrics')

test('parseTimedLrc parses timestamped LRC lines', () => {
  assert.deepEqual(parseTimedLrc('[00:01.20]First line\n[00:03.50][00:04.00]Repeat'), [
    { time: 1.2, text: 'First line' },
    { time: 3.5, text: 'Repeat' },
    { time: 4, text: 'Repeat' }
  ])
})

test('parsePlainLyrics keeps untimed embedded lyrics visible', () => {
  assert.deepEqual(parsePlainLyrics('[ti:Song]\nFirst plain line\n\nSecond plain line'), [
    'First plain line',
    'Second plain line'
  ])
})

test('buildLyricLines falls back to plain lyrics when no timed lines exist', () => {
  assert.deepEqual(buildLyricLines('First plain line\nSecond plain line', null), [
    { time: null, text: 'First plain line', translation: null, timed: false },
    { time: null, text: 'Second plain line', translation: null, timed: false }
  ])
})
