import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('main window keeps the responsive layout minimum size', async () => {
  const source = await readFile(new URL('./window.ts', import.meta.url), 'utf8')
  assert.match(source, /width:\s*1495/)
  assert.match(source, /height:\s*883/)
  assert.match(source, /minWidth:\s*1298/)
  assert.match(source, /minHeight:\s*692/)
})

test('windows main window wires the SMTC taskbar thumbnail buttons', async () => {
  const source = await readFile(new URL('./window.ts', import.meta.url), 'utf8')
  assert.match(source, /createSmtcButtons/)
  assert.match(source, /destroySmtcButtons/)
  assert.match(source, /integrations\/smtc/)
})
