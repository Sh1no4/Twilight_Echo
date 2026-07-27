import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHANNEL_MATRIX_CHANNEL_COUNTS,
  channelMatrixPresetMatrix,
  channelMatrixPresetsForLayout,
  identityChannelMatrix,
  ITU_DOWNMIX_COEFFICIENT
} from './channelMatrixPresets.ts'
import type { DspChannelLayout } from '../../../shared/dspGraph.ts'

const layouts: DspChannelLayout[] = ['mono', 'stereo', '5.1', '7.1']
const k = ITU_DOWNMIX_COEFFICIENT

function cell(matrix: number[], channelCount: number, output: number, input: number): number {
  return matrix[output * channelCount + input] ?? Number.NaN
}

test('every layout offers identity plus at most one downmix preset', () => {
  for (const layout of layouts) {
    const presets = channelMatrixPresetsForLayout(layout)
    assert.ok(presets.length >= 1)
    assert.equal(presets[0].id, 'identity')
    for (const preset of presets) {
      assert.equal(typeof preset.label, 'string')
      assert.ok(preset.label.length > 0)
    }
  }
})

test('preset matrices are square in the layout channel count and within the ±4 clamp', () => {
  for (const layout of layouts) {
    const channelCount = CHANNEL_MATRIX_CHANNEL_COUNTS[layout]
    for (const preset of channelMatrixPresetsForLayout(layout)) {
      const matrix = channelMatrixPresetMatrix(preset.id, layout)
      assert.ok(matrix, `${preset.id} should apply to ${layout}`)
      assert.equal(matrix.length, channelCount * channelCount)
      for (const value of matrix) {
        assert.ok(Number.isFinite(value))
        assert.ok(value >= -4 && value <= 4)
      }
    }
  }
})

test('identity preset matches identityChannelMatrix', () => {
  for (const layout of layouts) {
    const channelCount = CHANNEL_MATRIX_CHANNEL_COUNTS[layout]
    assert.deepEqual(
      channelMatrixPresetMatrix('identity', layout),
      identityChannelMatrix(channelCount)
    )
  }
})

test('stereo → mono writes 0.5/0.5 into both output rows', () => {
  const matrix = channelMatrixPresetMatrix('stereoToMono', 'stereo')
  assert.ok(matrix)
  assert.deepEqual(matrix, [0.5, 0.5, 0.5, 0.5])
})

test('ITU 5.1 → stereo lands on the [L, R, C, LFE, Ls, Rs] channel order', () => {
  const matrix = channelMatrixPresetMatrix('downmix51ToStereo', '5.1')
  assert.ok(matrix)
  const n = 6
  // L' = L + k·C + k·Ls
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((input) => cell(matrix, n, 0, input)),
    [1, 0, k, 0, k, 0]
  )
  // R' = R + k·C + k·Rs
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((input) => cell(matrix, n, 1, input)),
    [0, 1, k, 0, 0, k]
  )
  // Remaining output rows (C, LFE, Ls, Rs) are silent.
  for (let output = 2; output < n; output += 1) {
    for (let input = 0; input < n; input += 1) {
      assert.equal(cell(matrix, n, output, input), 0)
    }
  }
})

test('ITU 7.1 → stereo includes side and rear surrounds at 0.7071 each', () => {
  const matrix = channelMatrixPresetMatrix('downmix71ToStereo', '7.1')
  assert.ok(matrix)
  const n = 8
  // Order: [L, R, C, LFE, Ls, Rs, Lrs, Rrs]
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((input) => cell(matrix, n, 0, input)),
    [1, 0, k, 0, k, 0, k, 0]
  )
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((input) => cell(matrix, n, 1, input)),
    [0, 1, k, 0, 0, k, 0, k]
  )
  for (let output = 2; output < n; output += 1) {
    for (let input = 0; input < n; input += 1) {
      assert.equal(cell(matrix, n, output, input), 0)
    }
  }
})

test('presets that do not apply to a layout return null', () => {
  assert.equal(channelMatrixPresetMatrix('downmix51ToStereo', 'stereo'), null)
  assert.equal(channelMatrixPresetMatrix('downmix71ToStereo', '5.1'), null)
  assert.equal(channelMatrixPresetMatrix('stereoToMono', 'mono'), null)
  assert.equal(channelMatrixPresetMatrix('bogus', 'stereo'), null)
})
