import assert from 'node:assert/strict'
import test from 'node:test'
import { isSafeExternalUrl } from './externalUrl.ts'

test('external URL guard allows https by default and rejects http without allowlist', () => {
  assert.equal(isSafeExternalUrl('https://example.com/path?q=1'), true)
  assert.equal(isSafeExternalUrl('http://example.com/path'), false)
  assert.equal(isSafeExternalUrl('ftp://example.com'), false)
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false)
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
  assert.equal(isSafeExternalUrl('not a url'), false)
})

test('http is allowed only for explicitly allowlisted hosts', () => {
  assert.equal(isSafeExternalUrl('http://music.163.com/login', ['music.163.com']), true)
  assert.equal(isSafeExternalUrl('http://sub.music.163.com/x', ['music.163.com']), true)
  assert.equal(isSafeExternalUrl('http://evil.com/x', ['music.163.com']), false)
  assert.equal(isSafeExternalUrl('http://music.163.com.evil.com/x', ['music.163.com']), false)
})

test('external URL guard rejects oversized and control-character URLs', () => {
  assert.equal(isSafeExternalUrl(`https://example.com/${'a'.repeat(9000)}`), false)
  assert.equal(isSafeExternalUrl('https://example.com/a\r\nb'), false)
  assert.equal(isSafeExternalUrl(42), false)
  assert.equal(isSafeExternalUrl(null), false)
})
