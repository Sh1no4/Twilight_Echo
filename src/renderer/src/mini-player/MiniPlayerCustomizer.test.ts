import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./MiniPlayerCustomizer.vue', import.meta.url), 'utf8')

test('mini player customizer exposes four controlled tabs and no global api calls', () => {
  for (const tab of ['theme', 'background', 'appearance', 'layout']) {
    assert.match(source, new RegExp(`'${tab}'`))
  }
  assert.doesNotMatch(source, /window\.api/)
  assert.match(source, /pickBackgroundImage/)
  assert.match(source, /update:settings/)
})

test('mini player customizer includes every approved control family', () => {
  for (const field of [
    'kind',
    'solidColor',
    'gradientStart',
    'gradientEnd',
    'gradientAngle',
    'imageFit',
    'blur',
    'brightness',
    'saturation',
    'opacity',
    'overlayColor',
    'overlayOpacity',
    'accentMode',
    'accentColor',
    'textMode',
    'primaryTextColor',
    'mutedTextColor',
    'surfaceOpacity',
    'glassBlur',
    'cornerRadius',
    'borderWidth',
    'borderColor',
    'shadowStrength',
    'preference'
  ]) {
    assert.match(source, new RegExp(field))
  }
})

test('mini player customizer uses semantic controls and automatic persistence actions', () => {
  assert.match(source, /type="color"/)
  assert.match(source, /type="range"/)
  assert.match(source, /type="checkbox"/)
  assert.match(source, /@change="emit\('flush'\)"/)
  assert.match(source, /@click="emit\('undo'\)"/)
  assert.match(source, /@click="emit\('reset'\)"/)
  assert.doesNotMatch(source, />\s*应用\s*</)
})
