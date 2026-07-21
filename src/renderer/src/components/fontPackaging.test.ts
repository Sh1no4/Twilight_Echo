import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('renderer CSS packages Inter + Plus Jakarta Sans + MiSans and excludes legacy families', () => {
  const base = readFileSync(new URL('../assets/base.css', import.meta.url), 'utf8')
  const fonts = readFileSync(new URL('../assets/fonts.css', import.meta.url), 'utf8')
  const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const settings = readFileSync(new URL('./SettingsPage.vue', import.meta.url), 'utf8')
  const settingsCss = readFileSync(new URL('./settings-page/SettingsPage.css', import.meta.url), 'utf8')
  const combined = `${base}\n${fonts}\n${indexHtml}\n${settings}\n${settingsCss}`

  assert.match(fonts, /font-family: 'Inter'/)
  assert.match(fonts, /font-family: 'Plus Jakarta Sans'/)
  assert.match(fonts, /url\(['"]?\/font\/Inter/)
  assert.match(fonts, /url\(['"]?\/font\/PlusJakartaSans/)
  assert.match(base, /--te-font-sans:[\s\S]*Inter/)
  assert.match(base, /--te-font-sans:[\s\S]*MiSans/)
  assert.match(base, /--te-font-display:[\s\S]*Plus Jakarta Sans/)
  assert.match(base, /--te-font-display:[\s\S]*MiSans/)
  assert.match(indexHtml, /\/font\/misans\/misans\.css/)

  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
  const fontDir = join(repoRoot, 'resources/font')
  const misansDir = join(fontDir, 'misans')
  assert.equal(existsSync(join(fontDir, 'Inter-latin-wght-normal.woff2')), true)
  assert.equal(existsSync(join(fontDir, 'PlusJakartaSans-latin-wght-normal.woff2')), true)
  assert.equal(existsSync(join(misansDir, 'misans.css')), true)
  assert.equal(existsSync(join(misansDir, 'LICENSE')), true)
  const misansCss = readFileSync(join(misansDir, 'misans.css'), 'utf8')
  assert.match(misansCss, /font-family:\s*MiSans/)
  assert.match(misansCss, /url\(['"]?\.\//)
  const woff2 = readdirSync(misansDir).filter((n) => n.endsWith('.woff2'))
  assert.ok(woff2.length >= 100, `expected MiSans subset files, got ${woff2.length}`)

  // Historical / rejected families must stay out of renderer CSS.
  assert.doesNotMatch(combined, /Outfit|Noto Sans SC|Nunito/)
})
