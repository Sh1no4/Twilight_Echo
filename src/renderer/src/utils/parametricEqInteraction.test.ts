import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PARAMETRIC_EQ_MAX_FREQUENCY,
  PARAMETRIC_EQ_MAX_GAIN,
  PARAMETRIC_EQ_MAX_Q,
  PARAMETRIC_EQ_MIN_FREQUENCY,
  PARAMETRIC_EQ_MIN_GAIN,
  PARAMETRIC_EQ_MIN_Q,
  adjustQByWheel,
  createParametricBand,
  displayBandGain,
  filterUsesGain,
  frequencyToPercent,
  gainToPercent,
  percentToFrequency,
  percentToGain,
  spectrumToPath
} from './parametricEqInteraction.ts'

test('frequency mapping is logarithmic, reversible, and boundary-clamped', () => {
  assert.equal(frequencyToPercent(PARAMETRIC_EQ_MIN_FREQUENCY), 0)
  assert.equal(frequencyToPercent(PARAMETRIC_EQ_MAX_FREQUENCY), 100)
  assert.ok(Math.abs(percentToFrequency(-20) - PARAMETRIC_EQ_MIN_FREQUENCY) < 1e-9)
  assert.ok(Math.abs(percentToFrequency(100) - PARAMETRIC_EQ_MAX_FREQUENCY) < 1e-6)

  for (const frequency of [20, 63, 250, 1000, 4000, 16000, 20000]) {
    const roundTrip = percentToFrequency(frequencyToPercent(frequency))
    assert.ok(Math.abs(roundTrip - frequency) / frequency < 1e-9)
  }
})

test('gain mapping is reversible and uses the visible graph boundaries', () => {
  assert.equal(gainToPercent(PARAMETRIC_EQ_MAX_GAIN), 0)
  assert.equal(gainToPercent(0), 50)
  assert.equal(gainToPercent(PARAMETRIC_EQ_MIN_GAIN), 100)
  assert.equal(percentToGain(0), PARAMETRIC_EQ_MAX_GAIN)
  assert.equal(percentToGain(50), 0)
  assert.equal(percentToGain(100), PARAMETRIC_EQ_MIN_GAIN)
})

test('wheel Q adjustment is multiplicative, supports fine mode, and clamps safely', () => {
  assert.ok(adjustQByWheel(1, -120) > 1)
  assert.ok(adjustQByWheel(1, 120) < 1)
  assert.ok(Math.abs(adjustQByWheel(1, -120, true) - 1) < Math.abs(adjustQByWheel(1, -120) - 1))
  assert.equal(adjustQByWheel(PARAMETRIC_EQ_MAX_Q, -100000), PARAMETRIC_EQ_MAX_Q)
  assert.equal(adjustQByWheel(PARAMETRIC_EQ_MIN_Q, 100000), PARAMETRIC_EQ_MIN_Q)
})

test('new bands and gain display preserve filter semantics', () => {
  assert.deepEqual(createParametricBand(999.6, 3.26), {
    frequency: 1000,
    gain: 3.3,
    q: 1,
    filterType: 'peak',
    enabled: true
  })
  assert.equal(filterUsesGain('peak'), true)
  assert.equal(filterUsesGain('lowShelf'), true)
  assert.equal(filterUsesGain('lowPass'), false)
  assert.equal(displayBandGain({ frequency: 1000, gain: 9, q: 1, filterType: 'lowPass' }), 0)
})

test('spectrum path is bounded, deterministic, and log-frequency sampled', () => {
  const spectrum = Array.from({ length: 64 }, (_, index) => index / 63)
  const path = spectrumToPath(spectrum, 48000, 32)
  assert.ok(path.startsWith('M0.00,'))
  assert.equal(path.split('L').length, 32)
  assert.match(path, /L100\.00,/)
  assert.equal(spectrumToPath([], 48000), '')
  assert.equal(spectrumToPath(spectrum, 0), '')
})
