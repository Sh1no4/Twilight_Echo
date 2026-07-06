import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('local library scan normalizes common bpm metadata into Track bpm', () => {
  const source = readFileSync(new URL('./scan.ts', import.meta.url), 'utf8')

  assert.match(source, /function normalizeBpm\(/)
  assert.match(source, /const bpm = normalizeBpm\(common\.bpm\)/)
  assert.match(source, /if \(bpm !== undefined\) track\.bpm = bpm/)
})
