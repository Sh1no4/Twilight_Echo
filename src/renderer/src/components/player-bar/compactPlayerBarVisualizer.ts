export const COMPACT_VISUALIZER_BAND_COUNT = 160
export const COMPACT_WAVEFORM_BAND_COUNT = COMPACT_VISUALIZER_BAND_COUNT

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Re-sample the engine's linear FFT bins onto a dense low-frequency curve. Keep
 * the signal's real energy instead of normalizing every frame to full height:
 * quiet passages should stay close to the progress rail, while isolated peaks
 * are allowed to rise above the skyline.
 */
export function compactVisualizerBands(
  spectrum: readonly number[],
  bandCount = COMPACT_VISUALIZER_BAND_COUNT
): number[] {
  const count = Math.max(2, Math.trunc(bandCount))
  if (spectrum.length === 0) return Array.from({ length: count }, () => 0)

  const sampled = Array.from({ length: count }, (_, index) => {
    const ratio = index / Math.max(1, count - 1)
    const sourcePosition = Math.pow(ratio, 1.72) * Math.max(0, spectrum.length - 1)
    const left = Math.floor(sourcePosition)
    const right = Math.min(spectrum.length - 1, left + 1)
    const fraction = sourcePosition - left
    return clampUnit(
      clampUnit(spectrum[left] ?? 0) * (1 - fraction) + clampUnit(spectrum[right] ?? 0) * fraction
    )
  })

  const peak = Math.max(...sampled)
  if (peak < 0.002) return sampled

  const adaptiveGain = Math.min(2.2, 0.86 / Math.max(0.24, peak))
  return sampled.map((value, index) => {
    const previous = sampled[Math.max(0, index - 1)] ?? value
    const next = sampled[Math.min(sampled.length - 1, index + 1)] ?? value
    const softened = previous * 0.16 + value * 0.68 + next * 0.16
    const gated = Math.max(0, softened - 0.025) * adaptiveGain
    return clampUnit(Math.pow(gated, 1.42))
  })
}

/** Build a time-domain envelope used only to add short transient detail. */
export function compactWaveformBands(
  waveform: readonly number[],
  bandCount = COMPACT_WAVEFORM_BAND_COUNT
): number[] {
  const count = Math.max(2, Math.trunc(bandCount))
  if (waveform.length === 0) return Array.from({ length: count }, () => 0)

  const finiteWaveform = waveform.map((value) => (Number.isFinite(value) ? value : 0))
  const center = finiteWaveform.reduce((sum, value) => sum + value, 0) / finiteWaveform.length
  const envelope = Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * finiteWaveform.length) / count)
    const end = Math.max(start + 1, Math.floor(((index + 1) * finiteWaveform.length) / count))
    const samples = finiteWaveform
      .slice(start, Math.min(finiteWaveform.length, end))
      .map((value) => clampUnit(Math.abs(value - center)))
    const peak = Math.max(0, ...samples)

    // A max envelope makes nearly every 2-3 sample segment equally tall. The
    // centre sample keeps the waveform's valleys, while a small peak blend
    // still lets narrow transients show through.
    const sourcePosition = ((index + 0.5) / count) * Math.max(0, finiteWaveform.length - 1)
    const left = Math.floor(sourcePosition)
    const right = Math.min(finiteWaveform.length - 1, left + 1)
    const fraction = sourcePosition - left
    const representative = clampUnit(
      Math.abs(
        (finiteWaveform[left] ?? 0) * (1 - fraction) +
          (finiteWaveform[right] ?? 0) * fraction -
          center
      )
    )
    return representative * 0.84 + peak * 0.16
  })

  const peak = Math.max(...envelope)
  const floor = Math.min(...envelope)
  const range = peak - floor
  if (peak < 0.002 || range < 0.0005) return envelope

  return envelope.map((value, index) => {
    const previous = envelope[Math.max(0, index - 1)] ?? value
    const next = envelope[Math.min(envelope.length - 1, index + 1)] ?? value
    const softened = previous * 0.05 + value * 0.9 + next * 0.05
    return clampUnit((softened - floor) / range)
  })
}

/** Blend FFT energy with a small amount of waveform detail for the rendered skyline. */
export function compactSkylineBands(
  spectrum: readonly number[],
  waveform: readonly number[],
  bandCount = COMPACT_VISUALIZER_BAND_COUNT
): number[] {
  const spectral = compactVisualizerBands(spectrum, bandCount)
  const transients = compactWaveformBands(waveform, bandCount)
  const finiteWaveform = waveform.map((value) => (Number.isFinite(value) ? value : 0))
  const waveformCenter =
    finiteWaveform.reduce((sum, value) => sum + value, 0) / Math.max(1, finiteWaveform.length)
  const waveformPeak = clampUnit(
    Math.max(0, ...finiteWaveform.map((value) => Math.abs(value - waveformCenter)))
  )

  return spectral.map((value, index) => {
    const transient = Math.pow(transients[index] ?? 0, 2.4) * waveformPeak * 0.16
    return clampUnit(Math.max(value, value * 0.9 + transient))
  })
}
