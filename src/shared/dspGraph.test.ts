import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDspFactoryScene,
  createLegacyDspGraph,
  DSP_FACTORY_SCENE_TEMPLATES,
  normalizeDspScenes,
  resolveDspScene,
  type DspScene
} from './dspGraph.ts'

test('legacy DSP settings migrate into the fixed legacy graph order', () => {
  const graph = createLegacyDspGraph({
    dspEnabled: true,
    eqEnabled: true,
    convolverEnabled: true,
    convolverIrPath: 'room.wav',
    crossfeedEnabled: true,
    crossfeedStrength: 0.5
  })
  assert.deepEqual(
    graph.nodes.slice(0, 4).map((node) => node.type),
    ['replayGain', 'equalizer', 'convolver', 'crossfeed']
  )
  assert.equal(graph.nodes[1]?.enabled, true)
  assert.equal(graph.nodes[2]?.enabled, true)
})

test('scene resolver prefers a manual pin and otherwise uses priority then specificity', () => {
  const scenes = normalizeDspScenes([
    { id: 'default', name: 'Default', enabled: true, priority: 0, rules: {}, graph: { nodes: [] } },
    {
      id: 'dac',
      name: 'DAC',
      enabled: true,
      priority: 1,
      rules: { deviceIds: ['dac-1'] },
      graph: { nodes: [] }
    }
  ]) as DspScene[]
  const context = {
    deviceId: 'dac-1',
    backend: 'wasapi',
    channelLayout: 'stereo' as const,
    sourceKind: 'pcm' as const,
    sampleRate: 96000
  }
  assert.equal(resolveDspScene(scenes, context).scene?.id, 'dac')
  assert.equal(resolveDspScene(scenes, context, 'default').scene?.id, 'default')
})

test('DSD resolution reports a PCM fallback requirement without applying it', () => {
  const scenes = normalizeDspScenes([
    {
      id: 'eq',
      name: 'EQ',
      enabled: true,
      priority: 0,
      rules: {},
      graph: { nodes: [{ id: 'eq', type: 'equalizer', enabled: true, params: {} }] }
    }
  ])
  const resolution = resolveDspScene(scenes, {
    deviceId: 'dac-1',
    backend: 'asio',
    channelLayout: 'stereo',
    sourceKind: 'dsd',
    sampleRate: 2822400
  })
  assert.equal(resolution.requiresPcmFallback, true)
})

test('factory DSP templates provide editable professional starting points', () => {
  assert.deepEqual(
    DSP_FACTORY_SCENE_TEMPLATES.map((template) => template.id),
    [
      'transparent',
      'headphoneCrossfeed',
      'headphoneCorrection',
      'roomCorrection',
      'speakerCalibration51',
      'speakerCalibration71'
    ]
  )

  const transparent = createDspFactoryScene('transparent', 'transparent')
  assert.deepEqual(
    transparent.graph.nodes.map((node) => node.type),
    ['meter']
  )

  const crossfeed = createDspFactoryScene('headphoneCrossfeed', 'headphones')
  assert.equal(crossfeed.rules.channelLayouts?.[0], 'stereo')
  assert.equal(crossfeed.graph.nodes[0]?.type, 'crossfeed')
  assert.equal(crossfeed.graph.nodes[0]?.enabled, true)

  const room = createDspFactoryScene('roomCorrection', 'room')
  assert.equal(room.graph.nodes[0]?.type, 'convolver')
  assert.equal(room.graph.nodes[0]?.enabled, false)

  const surround = createDspFactoryScene('speakerCalibration71', 'surround')
  const strip = surround.graph.nodes.find((node) => node.type === 'channelStrip')
  assert.equal(surround.rules.channelLayouts?.[0], '7.1')
  assert.equal(strip?.enabled, false)
  assert.equal((strip?.params.channels as unknown[])?.length, 8)
  ;(strip?.params.channels as Array<Record<string, unknown>>)[0].gainDb = 3
  const freshSurround = createDspFactoryScene('speakerCalibration71', 'fresh-surround')
  const freshStrip = freshSurround.graph.nodes.find((node) => node.type === 'channelStrip')
  assert.equal((freshStrip?.params.channels as Array<Record<string, unknown>>)[0].gainDb, 0)
})
