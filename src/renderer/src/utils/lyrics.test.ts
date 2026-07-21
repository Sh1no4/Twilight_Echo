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
    { time: null, text: 'First plain line', translation: null, romanization: null, timed: false },
    { time: null, text: 'Second plain line', translation: null, romanization: null, timed: false }
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
    romanization: null,
    timed: true
  }))

  const start = performance.now()
  for (let i = 0; i < 10000; i++) {
    assert.equal(findActiveLyricIndex(lines, 5000), 6666)
  }
  const elapsed = performance.now() - start

  assert.ok(elapsed < 80, `active lyric lookup took ${elapsed.toFixed(2)}ms, expected < 80ms`)
})

test('parseTimedLrc keeps Enhanced LRC word timings', async () => {
  const { findActiveWordIndex } = (await import(
    new URL('./lyrics.ts', import.meta.url).href
  )) as typeof import('./lyrics')
  const lines = parseTimedLrc('[00:10.00]<00:10.00>Hel<00:10.40>lo <00:10.80>world')
  assert.equal(lines.length, 1)
  assert.equal(lines[0]?.text, 'Hello world')
  assert.deepEqual(
    lines[0]?.words?.map((word) => ({ time: word.time, text: word.text })),
    [
      { time: 10, text: 'Hel' },
      { time: 10.4, text: 'lo ' },
      { time: 10.8, text: 'world' }
    ]
  )
  assert.equal(findActiveWordIndex(lines[0]?.words ?? [], 10.5), 1)
})

test('parseTimedLrc parses NetEase YRC word lyrics', () => {
  const lines = parseTimedLrc('[10000,2000](10000,400,0)Hel(10400,400,0)lo (10800,400,0)world')
  assert.equal(lines.length, 1)
  assert.equal(lines[0]?.time, 10)
  assert.equal(lines[0]?.text, 'Hello world')
  assert.equal(lines[0]?.words?.length, 3)
  assert.equal(lines[0]?.words?.[1]?.endTime, 10.8)
})

test('parseTimedLrc flattens NetEase lyric/new JSON credit lines into readable text', () => {
  const payload = [
    '{"t":-1,"c":[{"tx":"作词: "},{"tx":"ACO"}]}',
    '{"t":-1,"c":[{"tx":"作曲: "},{"tx":"ACO"}]}',
    '[10000,2000](10000,400,0)バケット(10400,400,0)ソーダ'
  ].join('\n')

  const lines = parseTimedLrc(payload)
  assert.equal(lines[0]?.text, '作词: ACO')
  assert.equal(lines[1]?.text, '作曲: ACO')
  assert.equal(lines[2]?.text, 'バケットソーダ')
  assert.equal(lines[2]?.time, 10)
  assert.ok(!lines.some((line) => line.text.includes('"tx"')))
})

test('parsePlainLyrics flattens NetEase JSON credit lines when lyrics are untimed', () => {
  assert.deepEqual(
    parsePlainLyrics(
      '{"t":-1,"c":[{"tx":"作词: "},{"tx":"ACO"}]}\n{"t":-1,"c":[{"tx":"作曲: "},{"tx":"ACO"}]}'
    ),
    ['作词: ACO', '作曲: ACO']
  )
})

test('buildLyricLines shows NetEase credits without raw JSON when only metadata is present', () => {
  const lines = buildLyricLines(
    '{"t":-1,"c":[{"tx":"作词: "},{"tx":"ACO"}]}\n{"t":-1,"c":[{"tx":"作曲: "},{"tx":"ACO"}]}',
    null
  )
  assert.deepEqual(
    lines.map((line) => line.text),
    ['作词: ACO', '作曲: ACO']
  )
  assert.ok(!lines.some((line) => line.text.includes('{"t"')))
})
