import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SOFTWARE_VOLUME,
  DSD_OUTPUT_MODE_OPTIONS,
  GAPLESS_BLOCKED_REASONS,
  HIFI_STATUS_COPY,
  LOUDNORM_TARGET_LUFS,
  LOUDNORM_TRUE_PEAK_CEILING_DB,
  UNITY_SOFTWARE_VOLUME,
  VOLUME_NORMALIZATION_OPTIONS,
  dsdOutputModeValues,
  gaplessBlockedReasonCopy,
  gaplessRuntimeStatusCopy,
  isDsdOutputMode,
  isGaplessBlockedReason,
  isVolumeNormalizationMode,
  labelForVolumeNormalization,
  loudnormStatusCopy,
  requiresMeasuredLoudnorm,
  volumeNormalizationValues
} from './audioProcessingOptions.ts'

test('volume normalization options always include distinct loudnorm (never track-only)', () => {
  const values = volumeNormalizationValues()
  assert.deepEqual(values, ['off', 'track', 'album', 'loudnorm'])
  assert.equal(VOLUME_NORMALIZATION_OPTIONS.length, 4)
  assert.ok(VOLUME_NORMALIZATION_OPTIONS.some((option) => option.value === 'loudnorm'))
  assert.ok(labelForVolumeNormalization('loudnorm').toLowerCase().includes('loudnorm'))
  assert.equal(requiresMeasuredLoudnorm('loudnorm'), true)
  assert.equal(requiresMeasuredLoudnorm('track'), false)
  assert.equal(isVolumeNormalizationMode('loudnorm'), true)
  assert.equal(isVolumeNormalizationMode('track_alias'), false)
})

test('DSD output mode options cover native and foo_dsd_asio proxy routes', () => {
  assert.deepEqual(dsdOutputModeValues(), ['auto', 'pcm', 'dop', 'native', 'foo_dsd_asio'])
  assert.equal(DSD_OUTPUT_MODE_OPTIONS.length, 5)
  assert.equal(isDsdOutputMode('dop'), true)
  assert.equal(isDsdOutputMode('native-dsd'), false)
  assert.equal(isDsdOutputMode('foo_dsd_asio'), true)
})

test('loudnorm defaults and unity volume contract stay Stage-1 honest', () => {
  assert.equal(LOUDNORM_TARGET_LUFS, -23)
  assert.equal(LOUDNORM_TRUE_PEAK_CEILING_DB, -1)
  assert.equal(DEFAULT_SOFTWARE_VOLUME, 0.7)
  assert.equal(UNITY_SOFTWARE_VOLUME, 1)
  assert.notEqual(DEFAULT_SOFTWARE_VOLUME, UNITY_SOFTWARE_VOLUME)
  assert.match(HIFI_STATUS_COPY.volumeNotUnityHint, /70%/)
  assert.match(HIFI_STATUS_COPY.loudnormActive, /EBU R128/)
  assert.equal(loudnormStatusCopy('cached'), HIFI_STATUS_COPY.loudnormCached)
  assert.equal(loudnormStatusCopy('measuring'), HIFI_STATUS_COPY.loudnormMeasuring)
  assert.equal(loudnormStatusCopy('idle'), '')
})

test('gapless runtime status distinguishes intent, active, preload, and blocked reasons', () => {
  assert.deepEqual(GAPLESS_BLOCKED_REASONS, [
    'disabled',
    'dsd_path',
    'typed_passthrough',
    'crossfade',
    'format_mismatch'
  ])
  assert.equal(isGaplessBlockedReason('crossfade'), true)
  assert.equal(isGaplessBlockedReason('unknown'), false)
  assert.equal(gaplessBlockedReasonCopy('crossfade'), HIFI_STATUS_COPY.gaplessBlockedCrossfade)
  assert.equal(gaplessBlockedReasonCopy('dsd_path'), HIFI_STATUS_COPY.gaplessBlockedDsd)
  assert.equal(gaplessRuntimeStatusCopy({ intentEnabled: false }), HIFI_STATUS_COPY.gaplessOff)
  assert.equal(
    gaplessRuntimeStatusCopy({
      intentEnabled: true,
      gaplessBlockedReason: 'crossfade'
    }),
    HIFI_STATUS_COPY.gaplessBlockedCrossfade
  )
  assert.equal(
    gaplessRuntimeStatusCopy({
      intentEnabled: true,
      gaplessActive: true,
      preloadReady: true
    }),
    HIFI_STATUS_COPY.gaplessPreload
  )
  assert.equal(
    gaplessRuntimeStatusCopy({
      intentEnabled: true,
      gaplessActive: true,
      preloadReady: false
    }),
    HIFI_STATUS_COPY.gaplessActive
  )
  assert.equal(gaplessRuntimeStatusCopy({ intentEnabled: true }), HIFI_STATUS_COPY.gaplessOn)
})
