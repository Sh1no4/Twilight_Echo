import type { DspChannelLayout } from '../../../shared/dspGraph.ts'

/**
 * Standard downmix presets for the channelMatrix DSP node.
 *
 * Matrices are square (N x N for the node's layout), row-major with
 * `matrix[output * channelCount + input]`. Channel order follows the engine
 * convention (see audio-engine/vst3/Vst3Runtime.cpp — VST3 7.1 "music"
 * arrangement, sides before rears):
 *
 *   mono:   [M]
 *   stereo: [L, R]
 *   5.1:    [L, R, C, LFE, Ls, Rs]
 *   7.1:    [L, R, C, LFE, Ls, Rs, Lrs, Rrs]
 *
 * Downmix presets keep the node layout unchanged: the downmixed signal is
 * written to the leading output rows (L/R, or M-style dual mono) and all
 * remaining output rows are zeroed. All coefficients are within the DSP
 * contract's ±4 clamp.
 */

export type ChannelMatrixPresetId =
  | 'identity'
  | 'downmix51ToStereo'
  | 'downmix71ToStereo'
  | 'stereoToMono'

export interface ChannelMatrixPreset {
  id: ChannelMatrixPresetId
  label: string
}

/** ITU-R BS.775 center/surround downmix coefficient (-3 dB). */
export const ITU_DOWNMIX_COEFFICIENT = 0.7071

export const CHANNEL_MATRIX_CHANNEL_COUNTS: Record<DspChannelLayout, number> = {
  mono: 1,
  stereo: 2,
  '5.1': 6,
  '7.1': 8
}

const PRESET_LABELS: Record<ChannelMatrixPresetId, string> = {
  identity: 'Identity (passthrough)',
  downmix51ToStereo: 'ITU 5.1 → Stereo',
  downmix71ToStereo: 'ITU 7.1 → Stereo',
  stereoToMono: 'Stereo → Mono (0.5/0.5)'
}

const PRESET_IDS_BY_LAYOUT: Record<DspChannelLayout, ChannelMatrixPresetId[]> = {
  mono: ['identity'],
  stereo: ['identity', 'stereoToMono'],
  '5.1': ['identity', 'downmix51ToStereo'],
  '7.1': ['identity', 'downmix71ToStereo']
}

export function identityChannelMatrix(channelCount: number): number[] {
  return Array.from({ length: channelCount * channelCount }, (_, index) =>
    index % (channelCount + 1) === 0 ? 1 : 0
  )
}

function zeroMatrix(channelCount: number): number[] {
  return Array.from({ length: channelCount * channelCount }, () => 0)
}

function setCell(
  matrix: number[],
  channelCount: number,
  output: number,
  input: number,
  value: number
): void {
  matrix[output * channelCount + input] = value
}

/** Presets that can be applied to a node using the given layout. */
export function channelMatrixPresetsForLayout(layout: DspChannelLayout): ChannelMatrixPreset[] {
  return PRESET_IDS_BY_LAYOUT[layout].map((id) => ({ id, label: PRESET_LABELS[id] }))
}

/**
 * Build the full row-major matrix for a preset applied to the given layout.
 * Returns null when the preset id is unknown or does not apply to the layout.
 */
export function channelMatrixPresetMatrix(
  presetId: string,
  layout: DspChannelLayout
): number[] | null {
  const applicable = PRESET_IDS_BY_LAYOUT[layout]
  if (!applicable.includes(presetId as ChannelMatrixPresetId)) return null
  const channelCount = CHANNEL_MATRIX_CHANNEL_COUNTS[layout]
  const k = ITU_DOWNMIX_COEFFICIENT

  switch (presetId as ChannelMatrixPresetId) {
    case 'identity':
      return identityChannelMatrix(channelCount)
    case 'stereoToMono': {
      // Dual-mono: both outputs receive (L + R) / 2.
      const matrix = zeroMatrix(channelCount)
      for (let output = 0; output < channelCount; output += 1) {
        setCell(matrix, channelCount, output, 0, 0.5)
        setCell(matrix, channelCount, output, 1, 0.5)
      }
      return matrix
    }
    case 'downmix51ToStereo': {
      // Inputs: [L, R, C, LFE, Ls, Rs]
      // L' = L + 0.7071·C + 0.7071·Ls ; R' = R + 0.7071·C + 0.7071·Rs
      const matrix = zeroMatrix(channelCount)
      setCell(matrix, channelCount, 0, 0, 1)
      setCell(matrix, channelCount, 0, 2, k)
      setCell(matrix, channelCount, 0, 4, k)
      setCell(matrix, channelCount, 1, 1, 1)
      setCell(matrix, channelCount, 1, 2, k)
      setCell(matrix, channelCount, 1, 5, k)
      return matrix
    }
    case 'downmix71ToStereo': {
      // Inputs: [L, R, C, LFE, Ls, Rs, Lrs, Rrs]
      // L' = L + 0.7071·C + 0.7071·Ls + 0.7071·Lrs
      // R' = R + 0.7071·C + 0.7071·Rs + 0.7071·Rrs
      const matrix = zeroMatrix(channelCount)
      setCell(matrix, channelCount, 0, 0, 1)
      setCell(matrix, channelCount, 0, 2, k)
      setCell(matrix, channelCount, 0, 4, k)
      setCell(matrix, channelCount, 0, 6, k)
      setCell(matrix, channelCount, 1, 1, 1)
      setCell(matrix, channelCount, 1, 2, k)
      setCell(matrix, channelCount, 1, 5, k)
      setCell(matrix, channelCount, 1, 7, k)
      return matrix
    }
    default:
      return null
  }
}
