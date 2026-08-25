import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeLyricLayout,
  isLyricLineInSight,
  lyricBlurTarget,
  lyricCascadeDelay,
  LYRIC_ALPHA_AUX_CURRENT,
  LYRIC_ALPHA_AUX_INACTIVE,
  LYRIC_ALPHA_CURRENT,
  LYRIC_ALPHA_HIDDEN,
  LYRIC_ALPHA_INACTIVE,
  LYRIC_BLUR_CUTOFF,
  LYRIC_BLUR_MAX,
  LYRIC_CASCADE_STEP_SECONDS,
  LYRIC_CULL_MARGIN_PX,
  LYRIC_SCALE_AUX_CURRENT,
  LYRIC_SCALE_AUX_INACTIVE,
  LYRIC_SCALE_CURRENT,
  LYRIC_SCALE_INACTIVE,
  type LyricLayoutLine
} from './lyricLineLayout.ts'

const ROW_HEIGHT = 60

function rows(count: number, overrides: Record<number, Partial<LyricLayoutLine>> = {}) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    height: ROW_HEIGHT,
    ...overrides[index]
  }))
}

function layout(
  count: number,
  scrollToIndex: number,
  hot: number[],
  extra: Record<string, unknown> = {}
) {
  return computeLyricLayout({
    lines: rows(count),
    scrollToIndex,
    hot: new Set(hot),
    viewportHeight: 600,
    ...extra
  })
}

test('blur targets follow min((d - 0.25) * 1.25, 6) over distance', () => {
  const expected = [0.9375, 2.1875, 3.4375, 4.6875, 5.9375, 6]
  for (let d = 1; d <= 6; d += 1) {
    assert.ok(Math.abs(lyricBlurTarget(d) - expected[d - 1]) < 1e-12, `d=${d}`)
  }
  assert.equal(lyricBlurTarget(100), LYRIC_BLUR_MAX)
  assert.equal(lyricBlurTarget(0), 0, 'the current line is never blurred')
})

test('cascade delays step 50ms per effective row past the first', () => {
  assert.equal(lyricCascadeDelay(0), 0)
  assert.equal(lyricCascadeDelay(1), 0)
  assert.ok(Math.abs(lyricCascadeDelay(2) - 0.05) < 1e-12)
  assert.ok(Math.abs(lyricCascadeDelay(3) - 0.1) < 1e-12)
  assert.ok(Math.abs(lyricCascadeDelay(5) - 0.2) < 1e-12)
  assert.equal(LYRIC_CASCADE_STEP_SECONDS, 0.05)
})

test('ordinary lines carry the documented scale and alpha targets', () => {
  const result = layout(5, 2, [2])

  assert.ok(Math.abs(result.lines[2].scale - LYRIC_SCALE_CURRENT) < 1e-12)
  assert.ok(Math.abs(result.lines[2].opacity - LYRIC_ALPHA_CURRENT) < 1e-12)
  for (const index of [0, 1, 3, 4]) {
    assert.ok(Math.abs(result.lines[index].scale - LYRIC_SCALE_INACTIVE) < 1e-12)
    assert.ok(Math.abs(result.lines[index].opacity - LYRIC_ALPHA_INACTIVE) < 1e-12)
  }
  assert.equal(LYRIC_SCALE_CURRENT, 1.0)
  assert.equal(LYRIC_SCALE_INACTIVE, 0.98)
  assert.equal(LYRIC_ALPHA_CURRENT, 0.85)
  assert.equal(LYRIC_ALPHA_INACTIVE, 0.175)
})

test('auxiliary rows carry their own target set', () => {
  const lines = rows(4, {
    1: { isBackground: true },
    3: { isBackground: true }
  })
  const inactive = computeLyricLayout({
    lines,
    scrollToIndex: 0,
    hot: new Set([0]),
    viewportHeight: 600
  })
  // While playing, a non-hot background row collapses out of the flow.
  assert.ok(Math.abs(inactive.lines[1].opacity - LYRIC_ALPHA_HIDDEN) < 1e-12)

  const active = computeLyricLayout({
    lines,
    scrollToIndex: 1,
    hot: new Set([1]),
    viewportHeight: 600,
    isPlaying: true
  })
  assert.ok(Math.abs(active.lines[1].scale - LYRIC_SCALE_AUX_CURRENT) < 1e-12)
  assert.ok(Math.abs(active.lines[1].opacity - LYRIC_ALPHA_AUX_CURRENT) < 1e-12)

  const paused = computeLyricLayout({
    lines,
    scrollToIndex: 0,
    hot: new Set([0]),
    viewportHeight: 600,
    isPlaying: false
  })
  assert.ok(Math.abs(paused.lines[3].scale - LYRIC_SCALE_AUX_INACTIVE) < 1e-12)
  assert.ok(Math.abs(paused.lines[3].opacity - LYRIC_ALPHA_AUX_INACTIVE) < 1e-12)
  assert.equal(LYRIC_SCALE_AUX_CURRENT, 0.7)
  assert.equal(LYRIC_SCALE_AUX_INACTIVE, 0.63)
  assert.equal(LYRIC_ALPHA_AUX_CURRENT, 0.5)
  assert.equal(LYRIC_ALPHA_AUX_INACTIVE, 0.175)
})

test('stacking multiplies each row height by its target scale', () => {
  // Row 0 is hot at scale 1.0, rows below at 0.98.
  const result = layout(3, 0, [0])
  const gapBelowHot = result.lines[1].top - result.lines[0].top
  const gapBelowInactive = result.lines[2].top - result.lines[1].top
  assert.ok(Math.abs(gapBelowHot - ROW_HEIGHT * 1.0) < 1e-9)
  assert.ok(Math.abs(gapBelowInactive - ROW_HEIGHT * 0.98) < 1e-9)
})

test('the anchor sits at the align position of the visible area', () => {
  const result = computeLyricLayout({
    lines: rows(8),
    scrollToIndex: 3,
    hot: new Set([3]),
    viewportHeight: 600,
    alignPosition: 0.5,
    alignAnchor: 'center'
  })
  // Center anchor: the anchor's scaled box is centered on the focus line.
  const anchor = result.lines[3]
  const focus = 600 * 0.5
  assert.ok(
    Math.abs(anchor.top + (ROW_HEIGHT * anchor.scale) / 2 - focus) < 1e-9,
    `anchor center ${anchor.top + (ROW_HEIGHT * anchor.scale) / 2} should sit at ${focus}`
  )
})

test('rows above the anchor depart without a delay', () => {
  const result = layout(8, 4, [4])
  for (let index = 0; index <= 4; index += 1) {
    assert.equal(result.lines[index].delay, 0, `line ${index} above the anchor must not wait`)
  }
  assert.equal(result.lines[5].delay, 0, 'the adjacent row is layer 1: immediate')
  assert.ok(Math.abs(result.lines[6].delay - 0.05) < 1e-12, 'layer 2 waits 50ms')
  assert.ok(Math.abs(result.lines[7].delay - 0.1) < 1e-12, 'layer 3 waits 100ms')
})

test('hidden rows collapse out of the flow entirely', () => {
  const focusWindow = new Set([3, 4, 5])
  const result = computeLyricLayout({
    lines: rows(8),
    scrollToIndex: 4,
    hot: new Set([4]),
    viewportHeight: 600,
    focusWindow
  })

  assert.equal(result.lines[0].opacity, LYRIC_ALPHA_HIDDEN)
  assert.equal(result.lines[7].opacity, LYRIC_ALPHA_HIDDEN)

  // The visible stack packs together: row 5 follows row 4 by one scaled row.
  const gap = result.lines[5].top - result.lines[4].top
  assert.ok(Math.abs(gap - ROW_HEIGHT * result.lines[4].scale) < 1e-9)
})

test('seeking and manual browsing clear the cascade delay and the blur', () => {
  const seeking = layout(6, 2, [2], { isSeeking: true })
  assert.ok(seeking.lines.every((line) => line.delay === 0))

  const browsing = layout(6, 2, [2], { isManualBrowse: true })
  assert.ok(browsing.lines.every((line) => line.blur === 0))
  assert.ok(browsing.lines.every((line) => line.blur < LYRIC_BLUR_CUTOFF))

  const playing = layout(6, 2, [2])
  assert.ok(playing.lines[4].blur > 0, 'the playing layout still blurs distant rows')
})

test('blur grows with effective distance and respects the intensity dial', () => {
  const full = layout(6, 0, [0])
  assert.ok(Math.abs(full.lines[1].blur - 0.9375) < 1e-12)
  assert.ok(Math.abs(full.lines[2].blur - 2.1875) < 1e-12)

  const dimmed = layout(6, 0, [0], { blurIntensity: 0.5 })
  assert.ok(Math.abs(dimmed.lines[1].blur - 0.46875) < 1e-12)
})

test('inactive dim scales the non-current alpha only', () => {
  const result = layout(4, 1, [1], { inactiveDim: 0.5 })
  assert.ok(Math.abs(result.lines[1].opacity - LYRIC_ALPHA_CURRENT) < 1e-12)
  assert.ok(Math.abs(result.lines[2].opacity - LYRIC_ALPHA_INACTIVE * 0.5) < 1e-12)
})

test('scale intensity shrinks the inactive scale toward flat', () => {
  const flat = layout(4, 1, [1], { scaleIntensity: 0 })
  assert.ok(Math.abs(flat.lines[2].scale - LYRIC_SCALE_CURRENT) < 1e-12)

  const half = layout(4, 1, [1], { scaleIntensity: 0.5 })
  assert.ok(Math.abs(half.lines[2].scale - (1 - 0.02 * 0.5)) < 1e-12)
})

test('hidePassedLines fades already sung rows', () => {
  const result = layout(4, 2, [2], { hidePassedLines: true })
  assert.equal(result.lines[0].opacity, LYRIC_ALPHA_HIDDEN)
  assert.equal(result.lines[1].opacity, LYRIC_ALPHA_HIDDEN)
  assert.ok(result.lines[2].opacity > 0)
  assert.ok(result.lines[3].opacity > 0)
})

test('isLyricLineInSight uses the 80px cull margin', () => {
  assert.ok(isLyricLineInSight(-79, 60, 600))
  assert.ok(!isLyricLineInSight(-141, 60, 600))
  assert.ok(isLyricLineInSight(679, 60, 600))
  assert.ok(!isLyricLineInSight(681, 60, 600))
  assert.equal(LYRIC_CULL_MARGIN_PX, 80)
})

test('the interlude dots reserve layout space after their line', () => {
  const result = computeLyricLayout({
    lines: rows(4),
    scrollToIndex: 1,
    hot: new Set([1]),
    viewportHeight: 600,
    interludeAfterIndex: 1,
    interludeDotsHeight: 24
  })
  assert.ok(result.interludeDotsTop != null)
  // The dots sit just below line 1, and line 2 starts after the reserved block.
  assert.ok(result.interludeDotsTop > result.lines[1].top)
  assert.ok(result.lines[2].top > result.lines[1].top + 24)
})

test('manual scroll offset shifts the whole stack', () => {
  const base = layout(4, 1, [1])
  const scrolled = layout(4, 1, [1], { scrollOffset: 120 })
  assert.ok(
    Math.abs(scrolled.lines[1].top - base.lines[1].top + 120) < 1e-9,
    'a positive offset pulls the stack down by the same amount'
  )
})
