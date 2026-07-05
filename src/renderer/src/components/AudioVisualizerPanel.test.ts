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

  assert.match(visualizer, /const SPECTRUM_DISPLAY_GAMMA = 0\.7/)
  assert.match(visualizer, /function visualizerDisplayLevel\(value\)/)
  assert.match(visualizer, /return Math\.pow\(level, SPECTRUM_DISPLAY_GAMMA\)/)
  assert.match(visualizer, /function applyLowFrequencyShelfContour\(rawBars, binCenters\)/)
  assert.match(visualizer, /LOW_FREQUENCY_CONTOUR_FLAT_RANGE/)
  assert.match(visualizer, /rawComputedBars = applyLowFrequencyShelfContour\(rawComputedBars, binCenters\)/)
  assert.match(
    visualizer,
    /visualizerDisplayLevel\(rawComputedBars \? rawComputedBars\[i\] : 0\) \* 255/
  )
  assert.doesNotMatch(visualizer, /Math\.random/)
})
