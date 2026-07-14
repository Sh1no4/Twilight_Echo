import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { DspAsset } from '../../shared/dspGraph.ts'
import type { DspAssetLibrary } from './dspAssetLibrary.ts'
import { importCorrectionProfileFile, parseCorrectionProfileText } from './correctionProfile.ts'

test('imports Equalizer APO parametric filters with channel masks', () => {
  const profile = parseCorrectionProfileText(`
# Equalizer APO
Device: Speakers
Channel: L, R
Preamp: -4.5 dB
Filter 1: ON PK Fc 105 Hz Gain 3.2 dB Q 1.41
Filter 2: OFF LS Fc 80 Hz Gain -1.5 dB Q 0.70
Filter 3: ON NO Fc 8000 Hz Q 4.00
`)

  assert.equal(profile.format, 'equalizerApo')
  assert.equal(profile.preampDb, -4.5)
  assert.deepEqual(profile.bands, [
    { frequency: 105, gain: 3.2, q: 1.41, filterType: 'peak', enabled: true, channelMask: 3 },
    { frequency: 80, gain: -1.5, q: 0.7, filterType: 'lowShelf', enabled: false, channelMask: 3 },
    { frequency: 8000, gain: 0, q: 4, filterType: 'notch', enabled: true, channelMask: 3 }
  ])
})

test('recognizes a REW filter settings file', () => {
  const profile = parseCorrectionProfileText(`
Filter Settings file
Room EQ Wizard V5.31
Preamp: -2.0 dB
Filter 1: ON HS Fc 6500 Hz Gain 1.5 dB Q 0.80
`)

  assert.equal(profile.format, 'rew')
  assert.equal(profile.bands[0].filterType, 'highShelf')
})

test('recognizes AutoEq parametric text', () => {
  const profile = parseCorrectionProfileText(`
# AutoEq: Example Headphone ParametricEQ
Preamp: -6.1 dB
Filter 1: ON PK Fc 60 Hz Gain 4.0 dB Q 0.75
Filter 2: ON PK Fc 2200 Hz Gain -2.5 dB Q 1.20
`)

  assert.equal(profile.format, 'autoeq')
  assert.equal(profile.bands.length, 2)
  assert.equal(profile.bands[1].gain, -2.5)
})

test('rejects unsupported and ambiguous correction text', () => {
  assert.throws(
    () => parseCorrectionProfileText('GraphicEQ: 20 0; 100 3; 1000 -2'),
    /仅可导入参数 EQ/
  )
  assert.throws(() => parseCorrectionProfileText('Filter 1: ON PK Fc 1000 Hz Q 1.00'), /需要 Gain/)
  assert.throws(() => parseCorrectionProfileText('Include: arbitrary.txt'), /仅可导入参数 EQ/)
})

test('validates a correction before delegating storage to the managed asset library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-correction-profile-'))
  try {
    const sourcePath = join(root, 'headphone.txt')
    await writeFile(
      sourcePath,
      '# Equalizer APO\nPreamp: -3 dB\nFilter 1: ON PK Fc 1000 Hz Gain 2 dB Q 1.2\n',
      'utf8'
    )
    let importCalls = 0
    const assets: Pick<DspAssetLibrary, 'importFile'> = {
      importFile: async () => {
        importCalls += 1
        return {
          id: 'correctionProfile:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          kind: 'correctionProfile',
          name: 'headphone',
          fileName: 'headphone.txt',
          sha256: 'a'.repeat(64),
          byteSize: 1,
          mediaType: 'text/plain',
          createdAt: '2026-01-01T00:00:00.000Z',
          referenceCount: 0
        } satisfies DspAsset
      }
    }
    const imported = await importCorrectionProfileFile(sourcePath, assets)

    assert.equal(imported.asset.kind, 'correctionProfile')
    assert.equal(imported.profile.bands.length, 1)
    assert.equal(importCalls, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
