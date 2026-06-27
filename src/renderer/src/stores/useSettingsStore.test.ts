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
