import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COMPACT_VISUALIZER_BAND_COUNT,
  COMPACT_WAVEFORM_BAND_COUNT,
  compactSkylineBands,
  compactVisualizerBands,
  compactWaveformBands
} from './compactPlayerBarVisualizer.ts'

test('compact visualizer produces a stable number of finite, clamped bands', () => {
  const bands = compactVisualizerBands([Number.NaN, -2, 0.25, 2, Number.POSITIVE_INFINITY])

  assert.equal(bands.length, COMPACT_VISUALIZER_BAND_COUNT)
  assert.ok(bands.every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
  assert.ok(bands.some((value) => value > 0))
})

test('compact waveform envelope preserves time-domain peaks regardless of sign', () => {
  const positive = compactWaveformBands([0, 0.1, 0.9, 0.2, 0, 0.4], 6)
  const negative = compactWaveformBands([0, -0.1, -0.9, -0.2, 0, -0.4], 6)

  assert.deepEqual(negative, positive)
  assert.equal(positive.length, 6)
  assert.ok(Math.max(...positive) > Math.min(...positive) + 0.5)
})

test('compact waveform and spectrum share the rendered skyline density', () => {
  assert.equal(compactWaveformBands([0, 0.5, -0.5]).length, COMPACT_WAVEFORM_BAND_COUNT)
  assert.equal(COMPACT_WAVEFORM_BAND_COUNT, COMPACT_VISUALIZER_BAND_COUNT)
  assert.equal(COMPACT_VISUALIZER_BAND_COUNT, 160)
})

test('compact waveform keeps valleys instead of flattening every segment to its peak', () => {
  const waveform = [0, 0, 1, 0, 0, 0, 0.8, 0, 0, 0, 0.6, 0]
  const bands = compactWaveformBands(waveform, 6)

  assert.ok(Math.max(...bands) > 0.9)
  assert.ok(bands.filter((value) => value < 0.2).length >= 2)
})

test('compact skyline keeps quiet energy low and isolated peaks prominent', () => {
  const quiet = compactSkylineBands([0.03, 0.04, 0.05, 0.04], [0, 0, 0, 0])
  const peaked = compactSkylineBands([0.03, 0.04, 1, 0.04], [0, 0.1, -0.8, 0])

  assert.equal(quiet.length, COMPACT_VISUALIZER_BAND_COUNT)
  assert.equal(peaked.length, COMPACT_VISUALIZER_BAND_COUNT)
  assert.ok(Math.max(...quiet) < 0.15)
  assert.ok(Math.max(...peaked) > 0.65)
  assert.ok(peaked.filter((value) => value > 0.5).length < peaked.length / 3)
})
