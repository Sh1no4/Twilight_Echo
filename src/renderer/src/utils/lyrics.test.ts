import assert from 'node:assert/strict'
import test from 'node:test'

const { buildLyricLines, findActiveLyricIndex, parsePlainLyrics, parseTimedLrc } = (await import(
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

test('findActiveLyricIndex uses timed lyric boundaries', () => {
  const lines = buildLyricLines('[00:01.00]First\n[00:03.00]Second\n[00:03.00]Echo', null)

  assert.equal(findActiveLyricIndex(lines, 0.5), -1)
  assert.equal(findActiveLyricIndex(lines, 1), 0)
  assert.equal(findActiveLyricIndex(lines, 2.5), 0)
  assert.equal(findActiveLyricIndex(lines, 3), 2)
  assert.equal(findActiveLyricIndex(lines, 10), 2)
})

test('findActiveLyricIndex ignores untimed lyrics', () => {
  const lines = buildLyricLines('First plain line\nSecond plain line', null)

  assert.equal(findActiveLyricIndex(lines, 10), -1)
})

test('findActiveLyricIndex handles large lyric files quickly', () => {
  const lines = Array.from({ length: 10000 }, (_, index) => ({
    time: index * 0.75,
    text: `Line ${index}`,
    translation: null,
    timed: true
  }))

  const start = performance.now()
  for (let i = 0; i < 10000; i++) {
    assert.equal(findActiveLyricIndex(lines, 5000), 6666)
  }
  const elapsed = performance.now() - start

  assert.ok(elapsed < 80, `active lyric lookup took ${elapsed.toFixed(2)}ms, expected < 80ms`)
})
