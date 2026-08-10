import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDisplacementPixels,
  CARD_DISPLACEMENT_BUCKET,
  clearDisplacementMapCache,
  DEFAULT_RIM_FRACTION,
  getDisplacementMapUrl,
  NEUTRAL_BYTE,
  PLAYBAR_DISPLACEMENT_BUCKET,
  rimDisplacement,
  rimMagnitude,
  roundedRectSDF,
  smoothStep
} from './liquidGlassDisplacement.ts'

test('smoothStep clamps to its edges and eases between them', () => {
  assert.equal(smoothStep(0, 1, -5), 0)
  assert.equal(smoothStep(0, 1, 0), 0)
  assert.equal(smoothStep(0, 1, 1), 1)
  assert.equal(smoothStep(0, 1, 5), 1)
  assert.equal(smoothStep(0, 1, 0.5), 0.5)

  // eased, not linear
  assert.ok(smoothStep(0, 1, 0.25) < 0.25)
  assert.ok(smoothStep(0, 1, 0.75) > 0.75)
})

test('smoothStep handles an inverted edge pair', () => {
  assert.equal(smoothStep(0.8, 0, 0.9), 0)
  assert.equal(smoothStep(0.8, 0, -0.1), 1)
})

test('roundedRectSDF is negative inside and positive outside', () => {
  assert.ok(roundedRectSDF(0, 0, 0.3, 0.2, 0.1) < 0, 'center is inside')
  assert.ok(roundedRectSDF(5, 5, 0.3, 0.2, 0.1) > 0, 'far corner is outside')
})

test('roundedRectSDF is symmetric across both axes', () => {
  const base = roundedRectSDF(0.17, 0.09, 0.3, 0.2, 0.6)
  assert.equal(roundedRectSDF(-0.17, 0.09, 0.3, 0.2, 0.6), base)
  assert.equal(roundedRectSDF(0.17, -0.09, 0.3, 0.2, 0.6), base)
  assert.equal(roundedRectSDF(-0.17, -0.09, 0.3, 0.2, 0.6), base)
})

test('rim magnitude peaks at the border and vanishes toward the middle', () => {
  assert.equal(rimMagnitude(0, DEFAULT_RIM_FRACTION), 1, 'border refracts fully')
  assert.equal(rimMagnitude(1, DEFAULT_RIM_FRACTION), 1, 'other border too')
  assert.equal(rimMagnitude(0.5, DEFAULT_RIM_FRACTION), 0, 'middle is clean')
})

test('rim magnitude decreases monotonically from border to middle', () => {
  let previous = Infinity
  for (let i = 0; i <= 20; i++) {
    const value = rimMagnitude(i / 40, DEFAULT_RIM_FRACTION)
    assert.ok(value <= previous + 1e-12, `not monotonic at ${i / 40}: ${value} > ${previous}`)
    previous = value
  }
})

test('rim magnitude stays within [0, 1] and is symmetric', () => {
  for (let i = 0; i <= 50; i++) {
    const u = i / 50
    const value = rimMagnitude(u, DEFAULT_RIM_FRACTION)
    assert.ok(value >= 0 && value <= 1, `out of range at ${u}: ${value}`)
    assert.ok(
      Math.abs(value - rimMagnitude(1 - u, DEFAULT_RIM_FRACTION)) < 1e-12,
      `asymmetric at ${u}`
    )
  }
})

test('a wider rim fraction refracts further inward', () => {
  const probe = 0.25
  assert.ok(
    rimMagnitude(probe, 0.8) > rimMagnitude(probe, 0.2),
    'wider rim reaches deeper into the surface'
  )
})

test('rim displacement points inward on every side', () => {
  assert.ok(rimDisplacement(0.02, 0.5).x > 0, 'left edge pushes right')
  assert.ok(rimDisplacement(0.98, 0.5).x < 0, 'right edge pushes left')
  assert.ok(rimDisplacement(0.5, 0.02).y > 0, 'top edge pushes down')
  assert.ok(rimDisplacement(0.5, 0.98).y < 0, 'bottom edge pushes up')
})

test('rim displacement is zero at the exact center', () => {
  const center = rimDisplacement(0.5, 0.5)
  assert.equal(center.x, 0)
  assert.equal(center.y, 0)
})

test('rim displacement is antisymmetric about the center', () => {
  const a = rimDisplacement(0.2, 0.3)
  const b = rimDisplacement(0.8, 0.7)
  assert.ok(Math.abs(a.x + b.x) < 1e-12, 'x mirrors')
  assert.ok(Math.abs(a.y + b.y) < 1e-12, 'y mirrors')
})

test('pixel buffer has RGBA length and is fully opaque', () => {
  const w = 24
  const h = 16
  const pixels = buildDisplacementPixels(w, h)

  assert.equal(pixels.length, w * h * 4)
  assert.ok(pixels instanceof Uint8ClampedArray)
  for (let p = 3; p < pixels.length; p += 4) {
    assert.equal(pixels[p], 255, `alpha at byte ${p}`)
  }
})

test('G and B channels carry the same Y offset', () => {
  const pixels = buildDisplacementPixels(20, 20)
  for (let p = 0; p < pixels.length; p += 4) {
    assert.equal(pixels[p + 1], pixels[p + 2], `G/B mismatch at byte ${p}`)
  }
})

test('map center is neutral so the middle of a surface is not displaced', () => {
  const size = 32
  const pixels = buildDisplacementPixels(size, size)
  const mid = ((size / 2) * size + size / 2) * 4

  assert.ok(Math.abs(pixels[mid] - NEUTRAL_BYTE) <= 2, `R center ${pixels[mid]}`)
  assert.ok(Math.abs(pixels[mid + 1] - NEUTRAL_BYTE) <= 2, `G center ${pixels[mid + 1]}`)
})

test('map carries strong displacement at the border', () => {
  const size = 64
  const pixels = buildDisplacementPixels(size, size)
  const y = size / 2

  const leftR = pixels[(y * size + 0) * 4]
  const rightR = pixels[(y * size + (size - 1)) * 4]

  // border must deviate hard from neutral, or nothing visibly refracts
  assert.ok(leftR - NEUTRAL_BYTE > 100, `left border R was ${leftR}`)
  assert.ok(NEUTRAL_BYTE - rightR > 100, `right border R was ${rightR}`)
})

test('displacement is strongest at the border and weakest at the center', () => {
  const size = 64
  const pixels = buildDisplacementPixels(size, size)
  const y = size / 2
  const deviation = (x: number): number => {
    const value = pixels[(y * size + Math.trunc(x)) * 4]
    assert.equal(typeof value, 'number', `no pixel at x=${x}`)
    return Math.abs(value - NEUTRAL_BYTE)
  }

  assert.ok(deviation(0) > deviation(size / 6), 'border beats inner rim')
  assert.ok(deviation(size / 6) > deviation(size / 2), 'inner rim beats center')
})

test('map is symmetric left-to-right and top-to-bottom', () => {
  const size = 32
  const pixels = buildDisplacementPixels(size, size)
  const at = (x: number, y: number, channel: number): number => pixels[(y * size + x) * 4 + channel]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // R mirrors with inverted sign around neutral. Neutral is 128 while the byte
      // midpoint is 127.5, so quantization allows one unit of slack.
      const left = at(x, y, 0) - NEUTRAL_BYTE
      const right = at(size - 1 - x, y, 0) - NEUTRAL_BYTE
      assert.ok(Math.abs(left + right) <= 1, `R asymmetry at ${x},${y}: ${left} vs ${right}`)
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const top = at(x, y, 1) - NEUTRAL_BYTE
      const bottom = at(x, size - 1 - y, 1) - NEUTRAL_BYTE
      assert.ok(Math.abs(top + bottom) <= 1, `G asymmetry at ${x},${y}: ${top} vs ${bottom}`)
    }
  }
})

test('non-square buckets are supported for the wide playbar strip', () => {
  const pixels = buildDisplacementPixels(64, 8)
  assert.equal(pixels.length, 64 * 8 * 4)

  // The short axis still refracts on a wide strip. On an 8px axis the first pixel
  // center already sits ~6% inward, so the peak is below the full-border value.
  const midX = 32
  const topG = pixels[(0 * 64 + midX) * 4 + 1]
  const bottomG = pixels[(7 * 64 + midX) * 4 + 1]
  assert.ok(topG - NEUTRAL_BYTE > 80, `top edge G was ${topG}`)
  assert.ok(NEUTRAL_BYTE - bottomG > 80, `bottom edge G was ${bottomG}`)

  // and the long axis refracts independently of the short one
  const midY = 4
  const leftR = pixels[(midY * 64 + 0) * 4]
  assert.ok(leftR - NEUTRAL_BYTE > 80, `left edge R was ${leftR}`)
})

test('invalid sizes are rejected rather than producing a broken map', () => {
  assert.throws(() => buildDisplacementPixels(0, 10), /invalid displacement map size/)
  assert.throws(() => buildDisplacementPixels(10, 0), /invalid displacement map size/)
  assert.throws(() => buildDisplacementPixels(-4, 4), /invalid displacement map size/)
  assert.throws(() => buildDisplacementPixels(4.5, 4), /invalid displacement map size/)
})

test('bucket presets are sane and distinct', () => {
  assert.ok(CARD_DISPLACEMENT_BUCKET.width > 0 && CARD_DISPLACEMENT_BUCKET.height > 0)
  assert.ok(
    PLAYBAR_DISPLACEMENT_BUCKET.width > PLAYBAR_DISPLACEMENT_BUCKET.height,
    'playbar bucket is a wide strip'
  )
  assert.notEqual(
    `${CARD_DISPLACEMENT_BUCKET.width}x${CARD_DISPLACEMENT_BUCKET.height}`,
    `${PLAYBAR_DISPLACEMENT_BUCKET.width}x${PLAYBAR_DISPLACEMENT_BUCKET.height}`
  )
})

test('map url generation degrades to empty string without a DOM', () => {
  clearDisplacementMapCache()
  // node test env has no document; callers are expected to skip the filter
  assert.equal(typeof globalThis.document, 'undefined')
  assert.equal(getDisplacementMapUrl(CARD_DISPLACEMENT_BUCKET), '')
})
