import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  buildVisualizerQualityString,
  formatVisualizerBitrate
} from './audioVisualizerFormatting.ts'

test('visualizer bitrate formatting converts bps to kbps', () => {
  assert.equal(formatVisualizerBitrate(1737220), '1737 kbps')
})

test('visualizer bitrate formatting keeps existing kbps values', () => {
  assert.equal(formatVisualizerBitrate(320), '320 kbps')
})

test('visualizer quality string includes normalized bitrate and source fields', () => {
  assert.equal(
    buildVisualizerQualityString({
      format: 'flac',
      bitDepth: 24,
      sampleRate: 44100,
      bitrate: 1737220
    }),
    'FLAC / 24-bit / 44.1kHz / 1737kbps'
  )
})

test('audio visualizer renderer avoids random low-frequency texture', () => {
  const visualizer = readFileSync(
    new URL('../../../../resources/audio-visualizer/index.html', import.meta.url),
    'utf8'
  )
  const panel = readFileSync(new URL('./AudioVisualizerPanel.vue', import.meta.url), 'utf8')

  assert.doesNotMatch(visualizer, /subBinTexture/)
  assert.doesNotMatch(panel, /subBinTexture/)
  assert.doesNotMatch(visualizer, /applyVisualizerSpectralContrast/)
  assert.doesNotMatch(panel, /applyVisualizerSpectralContrast/)
  assert.doesNotMatch(visualizer, /spectralTilt/)
  assert.doesNotMatch(panel, /spectralTilt/)
  assert.doesNotMatch(visualizer, /spectrumValueToAmplitude/)
  assert.doesNotMatch(panel, /spectrumValueToAmplitude/)
})

test('audio visualizer display mapping uses deterministic low-frequency shelf contour', () => {
  const visualizer = readFileSync(
    new URL('../../../../resources/audio-visualizer/index.html', import.meta.url),
    'utf8'
  )

  assert.match(visualizer, /const SPECTRUM_BAR_COUNT = 140/)
  assert.match(visualizer, /const SPECTRUM_DISPLAY_GAIN = 1;/)
  assert.match(visualizer, /const SPECTRUM_DISPLAY_GAMMA = 0\.78/)
  assert.match(visualizer, /const SPECTRUM_DISPLAY_HEADROOM = 0\.97/)
  assert.match(visualizer, /const SPECTRUM_TARGET_PEAK_LEVEL = 0\.95/)
  assert.match(visualizer, /const SPECTRUM_MAX_ADAPTIVE_GAIN = 2\.35/)
  assert.match(visualizer, /const SPECTRUM_FRAME_CONTRAST_MIX = 0\.46/)
  assert.match(visualizer, /const SPECTRUM_CONTRAST_FLOOR = 0\.16/)
  assert.match(visualizer, /const SPECTRUM_CONTRAST_POWER = 0\.68/)
  assert.match(visualizer, /let lowFrequencyContourPhase = 0/)
  assert.match(visualizer, /function updateLowFrequencyContourPhase\(rawBars, deltaSeconds\)/)
  assert.match(visualizer, /function visualizerDisplayLevel\(value\)/)
  assert.match(visualizer, /function frameContrastFloor\(values, count\)/)
  assert.match(visualizer, /function expandFrameContrast\(level, floor, peak\)/)
  assert.match(
    visualizer,
    /return Math\.pow\(level, SPECTRUM_DISPLAY_GAMMA\) \* SPECTRUM_DISPLAY_HEADROOM/
  )
  assert.match(visualizer, /function buildLogFrequencyBinCenters\(barCount, sampleRate, fftSize\)/)
  assert.match(visualizer, /function applyLowFrequencyShelfContour\(rawBars, binCenters, contourPhase\)/)
  assert.match(visualizer, /LOW_FREQUENCY_CONTOUR_BASE_DEPTH/)
  assert.match(visualizer, /LOW_FREQUENCY_CONTOUR_FLAT_RANGE/)
  assert.match(visualizer, /const tertiary = Math\.sin\(\(barIndex \+ 1\) \* 2\.37 \+ phase \* 0\.9\)/)
  assert.match(
    visualizer,
    /sourceLevels = applyLowFrequencyShelfContour\(rawComputedBars, binCenters, contourPhase\)/
  )
  assert.match(
    visualizer,
    /sourceLevels = applyLowFrequencyShelfContour\(rawPrecomputedBars, binCenters, contourPhase\)/
  )
  assert.match(visualizer, /lowFrequencyContourPhase: contourPhase/)
  assert.match(visualizer, /const adaptiveDisplayGain = peakSourceLevel > 0/)
  assert.match(visualizer, /const sourceFloorLevel = frameContrastFloor\(sourceLevels, barCount\)/)
  assert.match(visualizer, /const sourceLevel = expandFrameContrast\(/)
  assert.match(visualizer, /sourceFloorLevel,/)
  assert.match(
    visualizer,
    /const val = visualizerDisplayLevel\(sourceLevel\) \* 255/
  )
  assert.doesNotMatch(visualizer, /Math\.random/)
})

test('audio visualizer panel requests precomputed bars instead of posting full spectrum payloads', () => {
  const panel = readFileSync(new URL('./AudioVisualizerPanel.vue', import.meta.url), 'utf8')

  assert.match(panel, /const VISUALIZER_BAR_COUNT = 140/)
  assert.match(panel, /const VISUALIZER_ANALYSIS_POINTS = 4096/)
  assert.match(panel, /visualizerBarCount: VISUALIZER_BAR_COUNT/)
  assert.match(panel, /v\.visualizerBars/)
  assert.match(panel, /bars,/)
  assert.doesNotMatch(panel, /Float32Array\.from\(v\.spectrum\)/)
  assert.doesNotMatch(panel, /data: spectrum/)
})

test('audio visualizer panel keeps fullscreen spectrum responsive while posting bars only', () => {
  const panel = readFileSync(new URL('./AudioVisualizerPanel.vue', import.meta.url), 'utf8')

  assert.match(panel, /const VISUALIZER_ANALYSIS_POINTS = 4096/)
  assert.match(panel, /spectrumPoints: VISUALIZER_ANALYSIS_POINTS/)
  assert.match(panel, /const VISUALIZER_POLL_INTERVAL_MS = 50/)
  assert.match(panel, /visualizerBarCount: VISUALIZER_BAR_COUNT/)
  assert.doesNotMatch(panel, /data: spectrum/)
})

test('audio visualizer render loops are bounded and avoid per-frame bar allocations', () => {
  const visualizer = readFileSync(
    new URL('../../../../resources/audio-visualizer/index.html', import.meta.url),
    'utf8'
  )

  assert.match(visualizer, /let playheadAnimationFrame = 0/)
  assert.match(visualizer, /function startPlayheadLoop\(\)/)
  assert.match(visualizer, /if \(playheadAnimationFrame !== 0\) return/)
  assert.match(visualizer, /playheadAnimationFrame = requestAnimationFrame\(updatePlayhead\)/)
  assert.match(visualizer, /function stopPlayheadLoop\(\)/)
  assert.match(visualizer, /cancelAnimationFrame\(playheadAnimationFrame\)/)
  assert.doesNotMatch(
    visualizer,
    /function renderSpectrumFrame\(now\) \{[\s\S]*let sourceLevels = new Float32Array/
  )
  assert.doesNotMatch(
    visualizer,
    /function renderSpectrumFrame\(now\) \{[\s\S]*const displayDebugBars = new Float32Array/
  )
})

test('audio visualizer left artwork scales up within viewport bounds', () => {
  const visualizer = readFileSync(
    new URL('../../../../resources/audio-visualizer/index.html', import.meta.url),
    'utf8'
  )

  assert.match(visualizer, /--left-panel-offset: clamp\(18px, 2\.4vw, 42px\)/)
  assert.match(visualizer, /--radar-size: min\(100%, calc\(100vh - 230px\)\)/)
  assert.match(visualizer, /--album-art-scale: 66%/)
  assert.match(visualizer, /padding-inline: clamp\(12px, 1\.6vw, 28px\) var\(--left-panel-offset\)/)
  assert.match(visualizer, /width: var\(--radar-size\)/)
  assert.match(visualizer, /max-width: 600px/)
  assert.match(visualizer, /width: var\(--album-art-scale\)/)
  assert.doesNotMatch(visualizer, /width: 59\.5%/)
})
