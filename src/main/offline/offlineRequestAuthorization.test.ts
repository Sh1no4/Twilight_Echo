import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteMediaGrantService } from '../security/remoteMediaGrants.ts'
import { authorizeOfflineDownloadRequest } from './offlineRequestAuthorization.ts'

test('offline download authorization only accepts a live audio grant and never raw renderer HTTP', () => {
  const grants = new RemoteMediaGrantService({ createToken: () => 'download-token' })
  const url = grants.grant('https://cdn.example/track.flac', 'audio')
  assert.equal(
    authorizeOfflineDownloadRequest(
      { providerId: 'demo', trackId: 'demo:1', title: 'Track', quality: 'lossless', url },
      grants
    ).url,
    'https://cdn.example/track.flac'
  )
  assert.throws(
    () =>
      authorizeOfflineDownloadRequest(
        { providerId: 'demo', trackId: 'demo:1', title: 'Track', quality: 'lossless', url: 'https://attacker.example/file.mp3' },
        grants
      ),
    /grant/i
  )
  assert.throws(
    () =>
      authorizeOfflineDownloadRequest(
        { providerId: 'demo', trackId: 'demo:1', title: 'Track', quality: 'lossless', url: grants.grant('https://cdn.example/cover.jpg', 'image') },
        grants
      ),
    /authorized/i
  )
})

test('offline download authorization rejects radio provider before grant resolution', () => {
  const grants = new RemoteMediaGrantService({ createToken: () => 'download-token' })
  assert.throws(
    () =>
      authorizeOfflineDownloadRequest(
        {
          providerId: 'radio',
          trackId: 'radio:1',
          title: 'Live',
          quality: 'live',
          url: grants.grant('https://cdn.example/stream.mp3', 'audio')
        },
        grants
      ),
    /radio|cannot be pinned/i
  )
})
