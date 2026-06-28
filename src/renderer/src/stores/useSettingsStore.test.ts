import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('background settings updates are applied optimistically and protected from stale snapshots', () => {
  const source = readFileSync(new URL('./useSettingsStore.ts', import.meta.url), 'utf8')

  assert.match(source, /let settingsUpdateQueue: Promise<void> = Promise\.resolve\(\)/)
  assert.match(source, /let pendingSettingsUpdates = 0/)
  assert.match(source, /let settingsUpdateSequence = 0/)
  assert.match(source, /if \(pendingSettingsUpdates > 0\) return/)
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(patch, 'appBackground'\)/)
  assert.match(source, /applyDomSettings\(\)/)
  assert.match(source, /if \(sequence === settingsUpdateSequence\) \{\s*applySnapshot\(snapshot\)\s*\}/)
})

test('background image import accepts ArrayBuffer views from Electron IPC', () => {
  const source = readFileSync(new URL('../../../main/index.ts', import.meta.url), 'utf8')

  assert.match(source, /function normalizeBackgroundImageImportData\(data: unknown\): Buffer \| null/)
  assert.match(source, /if \(Buffer\.isBuffer\(data\)\) return data/)
  assert.match(source, /if \(data instanceof ArrayBuffer\) return Buffer\.from\(data\)/)
  assert.match(source, /if \(ArrayBuffer\.isView\(data\)\) \{/)
  assert.match(source, /Buffer\.from\(data\.buffer, data\.byteOffset, data\.byteLength\)/)
  assert.match(source, /const buffer = normalizeBackgroundImageImportData\(data\)/)
})

test('background protocol accepts chromium-normalized trailing slash urls', () => {
  const source = readFileSync(new URL('../../../main/index.ts', import.meta.url), 'utf8')

  assert.ok(source.includes("const normalizedName = fileName.replace(/^\\/+|\\/+$/g, '')"))
  assert.ok(source.includes("const safeName = normalizedName.replace(/[^a-zA-Z0-9._-]/g, '')"))
  assert.ok(source.includes('safeName !== normalizedName'))
})

test('settings page quotes background image handles when building css url values', () => {
  const source = readFileSync(new URL('../components/SettingsPage.vue', import.meta.url), 'utf8')

  assert.match(source, /function toBackgroundImageStyle\(image: string\): string/)
  assert.ok(source.includes('return image ? `url("${image.replace(/"/g, \'\\\\"\')}")` : \'none\''))
  assert.match(source, /backgroundImage: toBackgroundImageStyle\(settings\.appBackground\.global\.image\)/)
  assert.match(source, /backgroundImage: toBackgroundImageStyle\(settings\.appBackground\.pages\[page\.value\]\.image\)/)
})

test('settings page sends plain app background objects through Electron IPC', () => {
  const source = readFileSync(new URL('../components/SettingsPage.vue', import.meta.url), 'utf8')

  assert.match(source, /function cloneAppBackground\(\): AppBackgroundSettings/)
  assert.match(source, /global: \{ \.\.\.background\.global \}/)
  assert.match(source, /local: \{ \.\.\.background\.pages\.local \}/)
  assert.match(source, /settings: \{ \.\.\.background\.pages\.settings \}/)
  assert.match(source, /streaming: \{ \.\.\.background\.pages\.streaming \}/)
  assert.match(source, /player: \{ \.\.\.background\.pages\.player \}/)
  assert.doesNotMatch(source, /\.\.\.settings\.value\.appBackground/)
  assert.doesNotMatch(source, /\.\.\.settings\.value\.appBackground\.pages/)
})
