import type { EqualizerBand, EqualizerFilterType } from '../types/settings'

export const PARAMETRIC_EQ_MIN_FREQUENCY = 20
export const PARAMETRIC_EQ_MAX_FREQUENCY = 20000
export const PARAMETRIC_EQ_MIN_GAIN = -18
export const PARAMETRIC_EQ_MAX_GAIN = 18
export const PARAMETRIC_EQ_MIN_Q = 0.1
export const PARAMETRIC_EQ_MAX_Q = 20
export const PARAMETRIC_EQ_MAX_BANDS = 32

const GAIN_FILTER_TYPES = new Set<EqualizerFilterType>(['peak', 'lowShelf', 'highShelf'])

export function clampEqValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function frequencyToPercent(frequency: number): number {
  const min = Math.log10(PARAMETRIC_EQ_MIN_FREQUENCY)
  const max = Math.log10(PARAMETRIC_EQ_MAX_FREQUENCY)
  const value = Math.log10(
    clampEqValue(frequency, PARAMETRIC_EQ_MIN_FREQUENCY, PARAMETRIC_EQ_MAX_FREQUENCY)
  )
  return ((value - min) / (max - min)) * 100
}

export function percentToFrequency(percent: number): number {
  const ratio = clampEqValue(percent, 0, 100) / 100
  const min = Math.log10(PARAMETRIC_EQ_MIN_FREQUENCY)
  const max = Math.log10(PARAMETRIC_EQ_MAX_FREQUENCY)
  return 10 ** (min + ratio * (max - min))
}

export function gainToPercent(gain: number): number {
  const ratio =
    (clampEqValue(gain, PARAMETRIC_EQ_MIN_GAIN, PARAMETRIC_EQ_MAX_GAIN) - PARAMETRIC_EQ_MIN_GAIN) /
    (PARAMETRIC_EQ_MAX_GAIN - PARAMETRIC_EQ_MIN_GAIN)
  return (1 - ratio) * 100
}

export function percentToGain(percent: number): number {
  const ratio = 1 - clampEqValue(percent, 0, 100) / 100
  const gain = PARAMETRIC_EQ_MIN_GAIN + ratio * (PARAMETRIC_EQ_MAX_GAIN - PARAMETRIC_EQ_MIN_GAIN)
  return Math.round(gain * 10) / 10
}

export function filterUsesGain(filterType: EqualizerFilterType): boolean {
  return GAIN_FILTER_TYPES.has(filterType)
}

export function displayBandGain(band: EqualizerBand): number {
  return filterUsesGain(band.filterType) ? band.gain : 0
}

export function adjustQByWheel(q: number, deltaY: number, fine = false): number {
  const sensitivity = fine ? 0.00045 : 0.0015
  const next = q * Math.exp(-deltaY * sensitivity)
  return Math.round(clampEqValue(next, PARAMETRIC_EQ_MIN_Q, PARAMETRIC_EQ_MAX_Q) * 100) / 100
}

export function createParametricBand(frequency: number, gain: number): EqualizerBand {
  return {
    frequency: Math.round(
      clampEqValue(frequency, PARAMETRIC_EQ_MIN_FREQUENCY, PARAMETRIC_EQ_MAX_FREQUENCY)
    ),
    gain: percentSafeGain(gain),
    q: 1,
    filterType: 'peak',
    enabled: true
  }
}

export function percentSafeGain(gain: number): number {
  return Math.round(clampEqValue(gain, -24, 24) * 10) / 10
}

export function spectrumToPath(
  spectrum: readonly number[],
  sampleRate: number,
  pointCount = 120
): string {
  if (spectrum.length < 2 || sampleRate <= 0) return ''
  const count = Math.max(16, Math.min(pointCount, 240))
  const nyquist = sampleRate * 0.5
  const maxFrequency = Math.min(PARAMETRIC_EQ_MAX_FREQUENCY, nyquist * 0.98)
  const points: string[] = []
  for (let index = 0; index < count; index += 1) {
    const x = (index / (count - 1)) * 100
    const frequency = percentToFrequency(x)
    const binPosition = clampEqValue(
      (frequency / nyquist) * (spectrum.length - 1),
      0,
      spectrum.length - 1
    )
    const low = Math.floor(binPosition)
    const high = Math.min(spectrum.length - 1, low + 1)
    const mix = binPosition - low
    const rawMagnitude = (spectrum[low] ?? 0) * (1 - mix) + (spectrum[high] ?? 0) * mix
    const magnitude = frequency > maxFrequency ? 0 : clampEqValue(rawMagnitude, 0, 1)
    const shaped = Math.sqrt(magnitude)
    const y = 96 - shaped * 70
    points.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return points.join(' ')
}
