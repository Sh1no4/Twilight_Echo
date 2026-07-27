import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('./EqualizerPage.vue', import.meta.url), 'utf8')

test('graphic equalizer preamp and band sliders support 0.1 dB adjustments', () => {
  assert.match(
    source,
    /<input[\s\S]*?type="range"[\s\S]*?min="-24"[\s\S]*?max="24"[\s\S]*?step="0\.1"[\s\S]*?:value="audioProcessing\.eqPreamp"/
  )
  assert.match(
    source,
    /<input[\s\S]*?type="range"[\s\S]*?min="-12"[\s\S]*?max="12"[\s\S]*?step="0\.1"[\s\S]*?:value="band\.gain"/
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
