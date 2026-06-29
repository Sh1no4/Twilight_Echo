import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('./EqualizerPage.vue', import.meta.url), 'utf8')

test('graphic equalizer preamp and band sliders support 0.1 dB adjustments', () => {
  assert.match(
    source,
    /<input type="range" min="-24" max="24" step="0\.1" :value="audioProcessing\.eqPreamp"/
  )
  assert.match(
    source,
    /<input type="range" min="-12" max="12" step="0\.1" :value="band\.gain"/
  )
})
