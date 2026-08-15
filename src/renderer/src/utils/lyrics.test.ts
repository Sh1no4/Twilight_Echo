import assert from 'node:assert/strict'
import test from 'node:test'

const {
  buildLyricLines,
  findActiveLyricIndex,
  getLyricWordProgress,
  hasLyricContent,
  parsePlainLyrics,
  parseTimedLrc
} = (await import(new URL('./lyrics.ts', import.meta.url).href)) as typeof import('./lyrics')

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

test('getLyricWordProgress maps timestamped words to a clamped karaoke fill', () => {
  const word = { time: 10, endTime: 10.4, text: 'Hel' }
  assert.equal(getLyricWordProgress(word, 10.5, 9.9), 0)
  assert.ok(Math.abs(getLyricWordProgress(word, 10.5, 10.2) - 0.5) < 1e-9)
  assert.equal(getLyricWordProgress(word, 10.5, 11), 1)
  assert.equal(getLyricWordProgress({ time: 12, endTime: null, text: 'tail' }, null, 12.2), 1)
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

test('buildLyricLines pairs YRC word lyrics with drifted tlyric translations', () => {
  // NetEase YRC line timestamps drift ~1s from the companion tlyric, so the
  // exact-millisecond join used to drop every translation for word lyrics.
  const yrc = [
    '[21990,540](21990,540,0)Yeah',
    '[25590,3060](25590,330,0)Who (25920,120,0)am (26040,300,0)I',
    '[28800,3090](28800,210,0)You (29010,660,0)decide'
  ].join('\n')
  const tlyric = ['[00:20.92]yeah', '[00:25.29]我是谁？', '[00:28.42]你来决定'].join('\n')
  const lines = buildLyricLines(yrc, tlyric)
  assert.equal(lines.length, 3)
  assert.equal(lines[0]?.translation, 'yeah')
  assert.equal(lines[1]?.translation, '我是谁？')
  assert.equal(lines[2]?.translation, '你来决定')
  assert.equal(lines[1]?.words?.length, 3)
})

test('buildLyricLines includes the exact 1500ms translation and romanization boundary', () => {
  const lines = buildLyricLines(
    '[10000,1000](10000,500,0)Line one',
    '[00:11.50]边界翻译',
    '[00:08.50]boundary romanization'
  )
  assert.equal(lines.length, 1)
  assert.equal(lines[0]?.translation, '边界翻译')
  assert.equal(lines[0]?.romanization, 'boundary romanization')
})

test('buildLyricLines does not pair a translation that is far away', () => {
  const lines = buildLyricLines('[10000,1000](10000,500,0)Line one', '[00:25.29]二十多秒后的翻译')
  assert.equal(lines.length, 1)
  assert.equal(lines[0]?.translation, null)
})

test('buildLyricLines keeps exact matches and only uses each layer line once', () => {
  const original = ['[00:10.00]<00:10.00>Hel<00:10.40>lo', '[00:12.00]Second'].join('\n')
  const translation = ['[00:10.02]你好', '[00:12.00]第二句'].join('\n')
  const lines = buildLyricLines(original, translation)
  // First line has no exact ms match; nearest is 10.02 within tolerance.
  assert.equal(lines[0]?.translation, '你好')
  // Second line is exact and must not steal/be stolen by the tolerant pass.
  assert.equal(lines[1]?.translation, '第二句')
})

test('hasLyricContent accepts only non-empty trimmed strings', () => {
  assert.equal(hasLyricContent('lyrics'), true)
  assert.equal(hasLyricContent('  lyrics  '), true)
  assert.equal(hasLyricContent(''), false)
  assert.equal(hasLyricContent('   '), false)
  assert.equal(hasLyricContent(null), false)
  assert.equal(hasLyricContent(undefined), false)
})
