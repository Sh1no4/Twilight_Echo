import assert from 'node:assert/strict'
import test from 'node:test'
import { isAmlTtml, parseAmlTtml } from './amllTtml.ts'

test('parses a basic AMLL line', () => {
  const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p begin="00:01.00" end="00:02.00" ttm:agent="v1"><span begin="00:01.00" end="00:01.50">Hello</span><span begin="00:01.50" end="00:02.00"> world</span><span ttm:role="x-translation">你好</span></p></body></tt>`
  assert.equal(isAmlTtml(ttml), true)
  const lines = parseAmlTtml(ttml)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].text, 'Hello world')
  assert.equal(lines[0].voices?.[0].translation?.text, '你好')
  assert.equal(lines[0].voices?.[0].words?.length, 2)
})

test('accepts AMLL bare decimal-second timestamps', () => {
  const lines = parseAmlTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0.115" end="2.813"><span begin="0.115" end="0.594">I</span> <span begin="0.594" end="0.768">promise</span></p></body></tt>`
  )

  assert.equal(lines.length, 1)
  assert.equal(lines[0]?.time, 0.115)
  assert.equal(lines[0]?.text, 'I promise')
})

test('restores missing English spaces for TTML spans and their word timeline', () => {
  const lines = parseAmlTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p begin="00:01.00" end="00:04.00"><span begin="00:01.00" end="00:01.40">Living</span><span begin="00:01.40" end="00:01.70">in</span><span begin="00:01.70" end="00:02.20">winter,</span><span begin="00:02.20" end="00:02.40">I</span><span begin="00:02.40" end="00:02.70">am</span><span begin="00:02.70" end="00:03.10">your</span><span begin="00:03.10" end="00:03.80">summer</span><span ttm:role="x-translation"><span>住在冬日</span><span>我是你的夏天</span></span></p></body></tt>`
  )

  assert.equal(lines[0]?.text, 'Living in winter, I am your summer')
  assert.equal(lines[0]?.voices?.[0].translation?.text, '住在冬日我是你的夏天')
  assert.deepEqual(
    lines[0]?.voices?.[0].words?.map((word) => word.text),
    ['Living', ' ', 'in', ' ', 'winter,', ' ', 'I', ' ', 'am', ' ', 'your', ' ', 'summer']
  )
})

test('keeps explicit XML spaces while preserving syllable spans inside one word', () => {
  const lines = parseAmlTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="00:01.00" end="00:03.00"><span begin="00:01.00" end="00:01.30">Living</span> <span begin="00:01.30" end="00:01.60">in</span> <span begin="00:01.60" end="00:01.90">win</span><span begin="00:01.90" end="00:02.10">ter,</span> <span begin="00:02.10" end="00:02.30">I</span> <span begin="00:02.30" end="00:02.50">am</span> <span begin="00:02.50" end="00:02.80">your</span> <span begin="00:02.80" end="00:03.00">summer</span></p></body></tt>`
  )

  assert.equal(lines[0]?.text, 'Living in winter, I am your summer')
  assert.deepEqual(
    lines[0]?.voices?.[0].words?.map((word) => word.text),
    ['Living', ' ', 'in', ' ', 'win', 'ter,', ' ', 'I', ' ', 'am', ' ', 'your', ' ', 'summer']
  )
})

test('does not add spaces inside contractions, hyphenated words, or CJK text', () => {
  const lines = parseAmlTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="00:01.00" end="00:03.00"><span begin="00:01.00" end="00:01.30">you</span><span begin="00:01.30" end="00:01.50">'ll</span><span begin="00:01.50" end="00:01.80">be</span><span begin="00:01.80" end="00:02.00">well</span><span begin="00:02.00" end="00:02.10">-</span><span begin="00:02.10" end="00:02.40">known</span><span begin="00:02.40" end="00:02.70">世</span><span begin="00:02.70" end="00:03.00">界</span></p></body></tt>`
  )

  assert.equal(lines[0]?.text, "you'll be well-known世界")
  assert.deepEqual(
    lines[0]?.voices?.[0].words?.map((word) => word.text),
    ['you', "'ll", ' ', 'be', ' ', 'well', '-', 'known', '世', '界']
  )
})

test('keeps auxiliary word timing and background voices', () => {
  const lines = parseAmlTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p begin="00:01.00" end="00:03.00" ttm:agent="v1"><span begin="00:01.00" end="00:02.00">Lead</span><span ttm:role="x-translation"><span begin="00:01.00" end="00:02.00">译</span></span><span ttm:role="x-bg" begin="00:02.00" end="00:03.00"><span begin="00:02.00" end="00:03.00">(bg)</span><span ttm:role="x-translation">背景</span></span></p></body></tt>`
  )
  assert.equal(lines.length, 1)
  assert.equal(lines[0].voices?.length, 2)
  assert.equal(lines[0].voices?.[0].translation?.words?.length, 1)
  assert.equal(lines[0].voices?.[1].role, 'background')
  assert.equal(lines[0].voices?.[1].text, '(bg)')
  assert.equal(lines[0].voices?.[1].translation?.text, '背景')
})

test('associates Apple-style head metadata by lyric key', () => {
  const lines = parseAmlTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata><iTunesTranslation itunes:key="L1">译文</iTunesTranslation><iTunesTransliteration itunes:key="L1">roman</iTunesTransliteration></metadata></head><body><p begin="00:01.00" end="00:02.00" itunes:key="L1"><span begin="00:01.00" end="00:02.00">原文</span></p></body></tt>`
  )
  assert.equal(lines[0].voices?.[0].translation?.text, '译文')
  assert.equal(lines[0].voices?.[0].romanization?.text, 'roman')
})

test('keeps call-and-response agents on separate rows despite partial overlap', () => {
  const lines = parseAmlTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p begin="00:01.00" end="00:03.00" ttm:agent="v1">First call</p><p begin="00:02.00" end="00:04.00" ttm:agent="v2">Later response</p></body></tt>`
  )

  assert.equal(lines.length, 2)
  assert.deepEqual(
    lines.map((line) => [line.text, line.voices?.[0].lane]),
    [
      ['First call', 'start'],
      ['Later response', 'end']
    ]
  )
})

test('keeps each singer on a stable Apple Music style lane across separate rows', () => {
  const lines = parseAmlTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p begin="00:01.00" end="00:02.00" ttm:agent="v1">First singer</p><p begin="00:02.00" end="00:03.00" ttm:agent="v2">Second singer</p><p begin="00:03.00" end="00:04.00" ttm:agent="v1">First singer again</p></body></tt>`
  )

  assert.deepEqual(
    lines.map((line) => line.voices?.[0].lane),
    ['start', 'end', 'start']
  )
})

test('keeps single-singer TTML centered', () => {
  const lines = parseAmlTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p begin="00:01.00" end="00:02.00" ttm:agent="v1">First line</p><p begin="00:02.00" end="00:03.00" ttm:agent="v1">Second line</p></body></tt>`
  )

  assert.deepEqual(
    lines.map((line) => line.voices?.[0].lane),
    ['center', 'center']
  )
})

test('keeps a background voice on its singer lane', () => {
  const lines = parseAmlTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p begin="00:01.00" end="00:03.00" ttm:agent="v1">Lead<span ttm:role="x-bg" begin="00:02.00" end="00:03.00">(background)</span></p><p begin="00:04.00" end="00:05.00" ttm:agent="v2">Other singer</p></body></tt>`
  )

  assert.deepEqual(
    lines[0].voices?.map((voice) => voice.lane),
    ['start', 'start']
  )
})

test('groups different agents only when they start nearly together', () => {
  const lines = parseAmlTtml(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p begin="00:01.00" end="00:03.00" ttm:agent="v1">First voice</p><p begin="00:01.18" end="00:03.20" ttm:agent="v2">Second voice</p></body></tt>`
  )

  assert.equal(lines.length, 1)
  assert.deepEqual(
    lines[0].voices?.map((voice) => voice.lane),
    ['start', 'end']
  )
})
