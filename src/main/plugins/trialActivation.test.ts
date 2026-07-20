import assert from 'node:assert/strict'
import test from 'node:test'
import { trialStagedPluginCandidate } from './trialActivation.ts'

test('disabled staged JS candidates still activate and deactivate before commit', async () => {
  const events: string[] = []
  await trialStagedPluginCandidate({
    candidate: { id: 'com.example.js', main: 'index.mjs', type: ['provider'], enabled: false },
    listActiveDescriptors: async () => [],
    startJavaScriptCandidate: async () => {
      events.push('activate')
    },
    stopJavaScriptCandidate: async () => {
      events.push('deactivate')
    },
    syncDspChain: async () => {
      events.push('dsp')
    }
  })
  assert.deepEqual(events, ['activate', 'deactivate'])
})

test('disabled staged DSP candidates enter then leave the trial chain', async () => {
  const chains: Array<Array<{ id: string; enabled: boolean }>> = []
  const active = { id: 'com.example.active', type: ['dsp'], enabled: true }
  const candidate = { id: 'com.example.disabled', type: ['dsp'], enabled: false }
  await trialStagedPluginCandidate({
    candidate,
    listActiveDescriptors: async () => [active],
    startJavaScriptCandidate: async () => {
      throw new Error('DSP candidates must not start a JS host')
    },
    stopJavaScriptCandidate: async () => {
      throw new Error('DSP candidates must not stop a JS host')
    },
    syncDspChain: async (descriptors) => {
      chains.push(descriptors.map(({ id, enabled }) => ({ id, enabled })))
    }
  })
  assert.deepEqual(chains, [
    [
      { id: 'com.example.active', enabled: true },
      { id: 'com.example.disabled', enabled: true }
    ],
    [{ id: 'com.example.active', enabled: true }]
  ])
})

test('pure themes do not receive an executable trial', async () => {
  const events: string[] = []
  await trialStagedPluginCandidate({
    candidate: { id: 'com.example.theme', type: ['theme'], enabled: false },
    listActiveDescriptors: async () => [],
    startJavaScriptCandidate: async () => {
      events.push('activate')
    },
    stopJavaScriptCandidate: async () => {
      events.push('deactivate')
    },
    syncDspChain: async () => {
      events.push('dsp')
    }
  })
  assert.deepEqual(events, [])
})
