import assert from 'node:assert/strict'
import test from 'node:test'
import { MediaStreamGrantStore, guessAudioContentType } from './mediaTokens.ts'

test('MediaStreamGrantStore issues and resolves file tokens until expiry', () => {
  let now = 1_000
  const store = new MediaStreamGrantStore({ now: () => now, ttlMs: 1_000 })
  const token = store.issue('/music/a.flac', { contentType: 'audio/flac', title: 'A' })
  const grant = store.resolve(token)
  assert.ok(grant)
  assert.equal(grant!.kind, 'file')
  assert.equal(grant!.filePath, '/music/a.flac')
  assert.equal(grant!.contentType, 'audio/flac')
  now = 2_100
  assert.equal(store.resolve(token), null)
})

test('MediaStreamGrantStore issues remote proxy tokens', () => {
  const store = new MediaStreamGrantStore()
  const token = store.issueRemote('https://cdn.example/ep.mp3?sig=abc', {
    contentType: 'audio/mpeg',
    title: 'Episode'
  })
  const grant = store.resolve(token)
  assert.ok(grant)
  assert.equal(grant!.kind, 'remote')
  assert.equal(grant!.remoteUrl, 'https://cdn.example/ep.mp3?sig=abc')
  assert.equal(grant!.filePath, undefined)
  assert.equal(grant!.contentType, 'audio/mpeg')
  assert.equal(grant!.title, 'Episode')
})

test('MediaStreamGrantStore clear revokes all grants', () => {
  const store = new MediaStreamGrantStore()
  const token = store.issue('/x.mp3')
  const remote = store.issueRemote('https://x.example/a.mp3')
  store.clear()
  assert.equal(store.resolve(token), null)
  assert.equal(store.resolve(remote), null)
})

test('guessAudioContentType maps common extensions', () => {
  assert.equal(guessAudioContentType('a.FLAC'), 'audio/flac')
  assert.equal(guessAudioContentType('b.mp3'), 'audio/mpeg')
  assert.equal(guessAudioContentType('c.m4a'), 'audio/mp4')
  assert.equal(guessAudioContentType('https://cdn.example/ep.mp3?token=1'), 'audio/mpeg')
  assert.equal(guessAudioContentType('d.unknown'), 'application/octet-stream')
})
