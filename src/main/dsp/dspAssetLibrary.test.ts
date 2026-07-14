import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DspAssetLibrary } from './dspAssetLibrary.ts'

test('resolves only managed VST3 state-bearing assets for the isolated host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-dsp-assets-'))
  try {
    const assets = new DspAssetLibrary(root)
    await assets.initialize()

    const preset = await assets.importBuffer({
      kind: 'vst3Preset',
      fileName: 'fixture.vstpreset',
      data: Buffer.from('preset-state')
    })
    const componentState = await assets.importBuffer({
      kind: 'vst3State',
      fileName: 'fixture.vststate',
      data: Buffer.from('component-state')
    })
    const impulseResponse = await assets.importBuffer({
      kind: 'impulseResponse',
      fileName: 'fixture.wav',
      data: Buffer.from('not-decoded-in-this-unit-test')
    })

    const presetResolution = assets.resolveVst3State(preset.id)
    assert.equal(presetResolution.kind, 'vst3Preset')
    assert.equal(presetResolution.reason, '')
    assert.match(presetResolution.path ?? '', /files[\\/]vst3Preset[\\/]/)

    const componentResolution = assets.resolveVst3State(componentState.id)
    assert.equal(componentResolution.kind, 'vst3State')
    assert.equal(componentResolution.reason, '')
    assert.match(componentResolution.path ?? '', /files[\\/]vst3State[\\/]/)

    const rejected = assets.resolveVst3State(impulseResponse.id)
    assert.deepEqual(rejected, {
      path: null,
      kind: null,
      reason: 'The selected asset is not a VST3 preset or component state'
    })

    await rm(componentResolution.path ?? '', { force: true })
    assert.deepEqual(assets.resolveVst3State(componentState.id), {
      path: null,
      kind: null,
      reason: 'The managed VST3 state file is missing'
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
