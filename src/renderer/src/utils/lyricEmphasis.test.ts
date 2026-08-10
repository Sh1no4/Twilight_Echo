import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEmphasisAnimation,
  buildFadeGradient,
  buildKaraokeMaskPlan,
  buildWordFloatAnimation,
  computeEmphasisStrength,
  cubicBezier,
  EMPHASIS_AMOUNT_CAP,
  EMPHASIS_BLUR_CAP,
  EMPHASIS_FRAME_COUNT,
  makeEmphasisEasing,
  maskAlphaForScale,
  shouldEmphasize,
  shouldEmphasizeChunk,
  type WordMeasurement
} from './lyricEmphasis.ts'
import { chunkAndSplitLyricWords, resolveLyricWordTimings } from './lyricWordChunks.ts'

function offsets(frames: Keyframe[]): number[] {
  return frames.map((frame) => frame.offset as number)
}

function maskX(frame: Keyframe): number {
  return Number.parseFloat(String(frame.maskPosition).split('px')[0])
}

test('the emphasis envelope rises and falls back to rest', () => {
  const easing = makeEmphasisEasing()

  assert.ok(Math.abs(easing(0)) < 1e-6, 'starts at rest')
  assert.ok(Math.abs(easing(1)) < 1e-6, 'returns to rest')
  assert.ok(easing(0.5) > 0.9, 'peaks near the midpoint')
  assert.ok(easing(0.25) < easing(0.5), 'rises into the peak')
  assert.ok(easing(0.75) < easing(0.5), 'falls away from the peak')
})

test('cubic bezier solves the identity and endpoint cases', () => {
  const linear = cubicBezier(0, 0, 1, 1)
  for (const x of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(linear(x) - x) < 1e-4, `linear curve should pass through ${x}`)
  }

  const eased = cubicBezier(0.2, 0.4, 0.58, 1)
  assert.equal(eased(0), 0)
  assert.equal(eased(1), 1)
  assert.ok(eased(-1) === 0 && eased(2) === 1, 'out-of-range input is clamped')
})

test('a word is emphasised only when held, and Latin needs a sane length', () => {
  assert.ok(!shouldEmphasize({ text: 'go', time: 0, endTime: 0.5 }), 'short notes just fill')
  assert.ok(shouldEmphasize({ text: 'love', time: 0, endTime: 2 }), 'a held Latin word qualifies')
  assert.ok(!shouldEmphasize({ text: 'a', time: 0, endTime: 2 }), 'a single Latin letter does not')
  assert.ok(
    !shouldEmphasize({ text: 'unbelievable', time: 0, endTime: 2 }),
    'a long Latin word reads as a phrase'
  )
  assert.ok(shouldEmphasize({ text: '爱', time: 0, endTime: 2 }), 'one held CJK glyph qualifies')
})

test('a group is emphasised when any of its syllables is held', () => {
  // "lo" + "ve" is one visual word; neither half is long enough alone, but the
  // merged span is.
  const chunks = chunkAndSplitLyricWords(
    resolveLyricWordTimings([
      { text: 'lo', time: 0, endTime: 0.6 },
      { text: 've', time: 0.6, endTime: 1.4 }
    ])
  )
  assert.equal(chunks.length, 1)
  assert.ok(shouldEmphasizeChunk(chunks[0]))

  const brief = chunkAndSplitLyricWords(
    resolveLyricWordTimings([
      { text: 'go', time: 0, endTime: 0.2 },
      { text: 'es', time: 0.2, endTime: 0.4 }
    ])
  )
  assert.ok(!shouldEmphasizeChunk(brief[0]))
})

test('emphasis strength grows with the hold but is capped', () => {
  const brief = computeEmphasisStrength(1000)
  const long = computeEmphasisStrength(4000)
  assert.ok(long.amount > brief.amount, 'a longer hold pushes harder')
  assert.ok(long.blur > brief.blur)

  const extreme = computeEmphasisStrength(120_000, true)
  assert.equal(extreme.amount, EMPHASIS_AMOUNT_CAP, 'amount must not run away')
  assert.equal(extreme.blur, EMPHASIS_BLUR_CAP, 'glow must not run away')
})

test('the last word of a line is pushed harder and held longer', () => {
  const middle = computeEmphasisStrength(1500)
  const last = computeEmphasisStrength(1500, true)

  assert.ok(last.amount > middle.amount)
  assert.ok(last.blur > middle.blur)
  assert.ok(last.durationMs > middle.durationMs, 'the phrase-carrying word lingers')
})

test('a short hold is floored to the minimum emphasis duration', () => {
  assert.equal(computeEmphasisStrength(200).durationMs, 1000)
})

test('emphasis produces a full frame set that starts and ends at rest', () => {
  const strength = computeEmphasisStrength(2000)
  const plan = buildEmphasisAnimation(0, 4, strength, 0)

  assert.equal(plan.glow.length, EMPHASIS_FRAME_COUNT)
  assert.equal(plan.float.length, EMPHASIS_FRAME_COUNT)

  const glowOffsets = offsets(plan.glow)
  assert.ok(glowOffsets.every((offset, index) => index === 0 || offset > glowOffsets[index - 1]))
  assert.equal(glowOffsets[glowOffsets.length - 1], 1)

  const last = plan.glow[plan.glow.length - 1]
  assert.match(String(last.transform), /matrix3d\(1,/, 'the character returns to its own size')
  assert.match(String(last.textShadow), /rgba\(255, 255, 255, 0\.0000\)/, 'the glow fades out')
})

test('emphasis uses matrix3d so glyphs stay on the compositor', () => {
  const plan = buildEmphasisAnimation(0, 1, computeEmphasisStrength(2000), 0)
  for (const frame of plan.glow) {
    assert.match(String(frame.transform), /^matrix3d\(/)
  }
})

test('characters are staggered so the emphasis travels through the word', () => {
  const strength = computeEmphasisStrength(2000)
  const first = buildEmphasisAnimation(0, 4, strength, 0)
  const third = buildEmphasisAnimation(2, 4, strength, 0)

  assert.ok(
    (third.glowTiming.delay as number) > (first.glowTiming.delay as number),
    'later characters start later'
  )
})

test('characters drift outward from the centre of the word', () => {
  const strength = computeEmphasisStrength(3000)
  const left = buildEmphasisAnimation(0, 4, strength, 0)
  const right = buildEmphasisAnimation(3, 4, strength, 0)

  const peak = Math.floor(EMPHASIS_FRAME_COUNT / 2) - 1
  const leftShift = Number.parseFloat(
    String(left.glow[peak].transform).match(/translate\((-?[\d.]+)em/)?.[1] ?? '0'
  )
  const rightShift = Number.parseFloat(
    String(right.glow[peak].transform).match(/translate\((-?[\d.]+)em/)?.[1] ?? '0'
  )

  assert.ok(leftShift < 0, 'the leading character drifts left')
  assert.ok(rightShift > 0, 'the trailing character drifts right')
})

test('the emphasis float leads the glow and is additive', () => {
  const plan = buildEmphasisAnimation(0, 2, computeEmphasisStrength(2000), 1000)

  assert.ok(
    (plan.floatTiming.delay as number) < (plan.glowTiming.delay as number),
    'the lift begins before the glow'
  )
  assert.ok((plan.floatTiming.duration as number) > (plan.glowTiming.duration as number))
  assert.equal(plan.floatTiming.composite, 'add')
  assert.equal(plan.glowTiming.composite, 'replace')
})

test('every word lifts while sung, additively and offset from the line start', () => {
  const plan = buildWordFloatAnimation({ text: 'a', time: 2, endTime: 3 }, 1)

  assert.equal(plan.timing.delay, 1000, 'delay is relative to the line, not the track')
  assert.equal(plan.timing.composite, 'add')
  assert.equal(plan.timing.easing, 'ease-out')
  assert.match(String(plan.keyframes[1].transform), /translateY\(-0\.05em\)/)
})

test('a brief word still gets a full lift so it does not twitch', () => {
  const plan = buildWordFloatAnimation({ text: 'a', time: 0, endTime: 0.1 }, 0)
  assert.equal(plan.timing.duration, 1000)
})

test('background voices lift twice as far', () => {
  const main = buildWordFloatAnimation({ text: 'a', time: 0, endTime: 1 }, 0)
  const background = buildWordFloatAnimation({ text: 'a', time: 0, endTime: 1 }, 0, true)

  assert.match(String(main.keyframes[1].transform), /-0\.05em/)
  assert.match(String(background.keyframes[1].transform), /-0\.1em/)
})

test('the fade gradient is wider than the word so it can slide across', () => {
  const { gradient, totalAspect } = buildFadeGradient(0.5)
  assert.ok(totalAspect > 1, 'the mask must overhang the word')
  assert.match(gradient, /^linear-gradient\(to right,/)
  assert.match(gradient, /--lyric-bright-mask-alpha/)
  assert.match(gradient, /--lyric-dark-mask-alpha/)
})

const MEASURE: WordMeasurement[] = [
  { width: 40, height: 20, padding: 0 },
  { width: 60, height: 20, padding: 0 }
]

test('the karaoke sweep runs from fully hidden to fully revealed', () => {
  const words = resolveLyricWordTimings([
    { text: 'one', time: 0, endTime: 1 },
    { text: 'two', time: 1, endTime: 2 }
  ])
  const plan = buildKaraokeMaskPlan(words, MEASURE, 0, 0, 2)

  assert.ok(plan)
  assert.equal(plan.timing.duration, 2000, 'the sweep spans the whole line')
  assert.equal(plan.timing.fill, 'both')

  const positions = plan.keyframes.map(maskX)
  assert.ok(positions[0] < 0, 'the word starts covered')
  assert.equal(positions[positions.length - 1], 0, 'and ends fully uncovered')
})

test('sweep keyframes are monotonic and within the WAAPI range', () => {
  const words = resolveLyricWordTimings([
    { text: 'one', time: 0, endTime: 1 },
    { text: 'two', time: 1.5, endTime: 2 }
  ])
  const plan = buildKaraokeMaskPlan(words, MEASURE, 1, 0, 2)

  assert.ok(plan)
  const frameOffsets = offsets(plan.keyframes)
  assert.ok(
    frameOffsets.every((offset) => offset >= 0 && offset <= 1),
    'offsets must stay inside [0,1]'
  )
  assert.ok(
    frameOffsets.every((offset, index) => index === 0 || offset >= frameOffsets[index - 1]),
    'offsets must never go backwards'
  )
})

test('a gap between words keeps the edge moving instead of freezing', () => {
  // The pause from 1s to 1.5s must appear as its own hold frame, which is what
  // makes consecutive words hand the edge over without a stutter.
  const words = resolveLyricWordTimings([
    { text: 'one', time: 0, endTime: 1 },
    { text: 'two', time: 1.5, endTime: 2 }
  ])
  const plan = buildKaraokeMaskPlan(words, MEASURE, 0, 0, 2)

  assert.ok(plan)
  const holdFrames = plan.keyframes.filter((frame, index, all) => {
    if (index === 0) return false
    return maskX(frame) === maskX(all[index - 1])
  })
  assert.ok(holdFrames.length > 0, 'the pause should be represented explicitly')
})

test('an unmeasurable word yields no sweep rather than a broken one', () => {
  const words = resolveLyricWordTimings([{ text: 'one', time: 0, endTime: 1 }])
  assert.equal(buildKaraokeMaskPlan(words, [{ width: 0, height: 0, padding: 0 }], 0, 0, 1), null)
  assert.equal(buildKaraokeMaskPlan(words, MEASURE, 5, 0, 1), null, 'index out of range')
  assert.equal(
    buildKaraokeMaskPlan([{ text: 'x', time: 0, endTime: 0 }], MEASURE, 0, 0, 0),
    null,
    'a line with no duration at all'
  )
})

test('karaoke contrast follows how focused the line is', () => {
  const focused = maskAlphaForScale(100)
  const receding = maskAlphaForScale(97)

  assert.ok(focused.bright > receding.bright, 'a focused line has more contrast')
  assert.equal(receding.bright, 0.2)
  assert.ok(Math.abs(focused.bright - 1) < 1e-9)
  assert.ok(focused.dark > receding.dark)
  assert.equal(maskAlphaForScale(50).bright, 0.2, 'far lines clamp instead of inverting')
})
