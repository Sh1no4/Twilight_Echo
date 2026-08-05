import assert from 'node:assert/strict'
import test from 'node:test'
import { hasControlCharacters } from './textValidation.ts'

test('hasControlCharacters detects C0 controls and DEL but not normal text', () => {
  assert.equal(hasControlCharacters('plain text'), false)
  assert.equal(hasControlCharacters('a\u0000b'), true)
  assert.equal(hasControlCharacters('a\rb'), true)
  assert.equal(hasControlCharacters('a\u001fb'), true)
  assert.equal(hasControlCharacters('a\u007fb'), true)
})
