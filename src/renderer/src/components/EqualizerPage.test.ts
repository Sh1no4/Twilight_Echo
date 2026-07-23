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

test('theme modes change only equalizer presentation and use stable chart classes', () => {
  assert.equal(source.match(/class="equalizer-spectrum-line"/g)?.length, 2)
  assert.equal(source.match(/class="equalizer-spectrum-area"/g)?.length, 2)
  assert.match(source, /class="frequency-guide"/)
  assert.match(source, /data-te-equalizer-panel='tinted'/)
  assert.match(source, /data-te-equalizer-slider='solid'/)
  assert.match(source, /data-te-equalizer-knob='dot'/)
  assert.match(source, /data-te-equalizer-spectrum='area'/)
  assert.match(source, /data-te-equalizer-button='outline'/)
  assert.match(source, /data-te-visible-equalizer-grid='false'/)
  assert.match(source, /data-te-visible-equalizer-frequency-guides='false'/)
  assert.match(source, /data-te-visible-equalizer-spectrum='false'/)
})
