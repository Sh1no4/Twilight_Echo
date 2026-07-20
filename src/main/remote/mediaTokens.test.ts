import assert from 'node:assert/strict'
import test from 'node:test'
import { MediaStreamGrantStore, guessAudioContentType } from './mediaTokens.ts'

test('MediaStreamGrantStore issues and resolves tokens until expiry', () => {
  let now = 1_000
  const store = new MediaStreamGrantStore({ now: () => now, ttlMs: 1_000 })
  const token = store.issue('/music/a.flac', { contentType: 'audio/flac', title: 'A' })
  const grant = store.resolve(token)
  assert.ok(grant)
  assert.equal(grant!.filePath, '/music/a.flac')
  assert.equal(grant!.contentType, 'audio/flac')
  now = 2_100
  assert.equal(store.resolve(token), null)
})

test('MediaStreamGrantStore clear revokes all grants', () => {
  const store = new MediaStreamGrantStore()
  const token = store.issue('/x.mp3')
  store.clear()
  assert.equal(store.resolve(token), null)
})

test('guessAudioContentType maps common extensions', () => {
  assert.equal(guessAudioContentType('a.FLAC'), 'audio/flac')
  assert.equal(guessAudioContentType('b.mp3'), 'audio/mpeg')
  assert.equal(guessAudioContentType('c.m4a'), 'audio/mp4')
  assert.equal(guessAudioContentType('d.unknown'), 'application/octet-stream')
})
