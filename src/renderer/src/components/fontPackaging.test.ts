import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('renderer CSS does not request fonts excluded from packaged output', () => {
  const base = readFileSync(new URL('../assets/base.css', import.meta.url), 'utf8')
  const settings = readFileSync(new URL('./SettingsPage.vue', import.meta.url), 'utf8')
  const settingsCss = readFileSync(new URL('./settings-page/SettingsPage.css', import.meta.url), 'utf8')
  const combined = `${base}\n${settings}\n${settingsCss}`
  assert.doesNotMatch(combined, /url\(['"]?\/font\//)
  assert.doesNotMatch(combined, /Outfit|Noto Sans SC/)
})
