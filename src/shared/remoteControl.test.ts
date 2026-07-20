import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEmptyRemotePlaybackSnapshot,
  isPrivateOrLocalIp,
  parseRemotePlayerCommand
} from './remoteControl.ts'

test('parseRemotePlayerCommand accepts known actions', () => {
  assert.deepEqual(parseRemotePlayerCommand({ action: 'playPause' }), { action: 'playPause' })
  assert.deepEqual(parseRemotePlayerCommand({ action: 'play' }), { action: 'play' })
  assert.deepEqual(parseRemotePlayerCommand({ action: 'pause' }), { action: 'pause' })
  assert.deepEqual(parseRemotePlayerCommand({ action: 'previous' }), { action: 'previous' })
  assert.deepEqual(parseRemotePlayerCommand({ action: 'next' }), { action: 'next' })
  assert.deepEqual(parseRemotePlayerCommand({ action: 'seek', positionSeconds: 12.5 }), {
    action: 'seek',
    positionSeconds: 12.5
  })
  assert.deepEqual(parseRemotePlayerCommand({ action: 'setVolume', volume: 0.4 }), {
    action: 'setVolume',
    volume: 0.4
  })
  assert.deepEqual(parseRemotePlayerCommand({ action: 'jumpQueue', index: 3 }), {
    action: 'jumpQueue',
    index: 3
  })
})

test('parseRemotePlayerCommand rejects invalid payloads', () => {
  assert.equal(parseRemotePlayerCommand(null), null)
  assert.equal(parseRemotePlayerCommand({ action: 'explode' }), null)
  assert.equal(parseRemotePlayerCommand({ action: 'seek', positionSeconds: -1 }), null)
  assert.equal(parseRemotePlayerCommand({ action: 'setVolume', volume: 'loud' }), null)
  assert.equal(parseRemotePlayerCommand({ action: 'jumpQueue', index: 1.5 }), null)
  assert.equal(parseRemotePlayerCommand({ action: 'jumpQueue', index: -2 }), null)
})

test('parseRemotePlayerCommand clamps volume into [0,1]', () => {
  assert.deepEqual(parseRemotePlayerCommand({ action: 'setVolume', volume: 2 }), {
    action: 'setVolume',
    volume: 1
  })
  assert.deepEqual(parseRemotePlayerCommand({ action: 'setVolume', volume: -3 }), {
    action: 'setVolume',
    volume: 0
  })
})

test('isPrivateOrLocalIp recognizes LAN ranges', () => {
  assert.equal(isPrivateOrLocalIp('127.0.0.1'), true)
  assert.equal(isPrivateOrLocalIp('::1'), true)
  assert.equal(isPrivateOrLocalIp('10.0.0.8'), true)
  assert.equal(isPrivateOrLocalIp('192.168.1.20'), true)
  assert.equal(isPrivateOrLocalIp('172.16.0.1'), true)
  assert.equal(isPrivateOrLocalIp('172.31.255.1'), true)
  assert.equal(isPrivateOrLocalIp('169.254.1.1'), true)
  assert.equal(isPrivateOrLocalIp('8.8.8.8'), false)
  assert.equal(isPrivateOrLocalIp('172.32.0.1'), false)
  assert.equal(isPrivateOrLocalIp('11.0.0.1'), false)
})

test('createEmptyRemotePlaybackSnapshot fills defaults', () => {
  const snap = createEmptyRemotePlaybackSnapshot({ title: 'Demo' })
  assert.equal(snap.title, 'Demo')
  assert.equal(snap.state, 'stopped')
  assert.equal(snap.volume, 1)
  assert.equal(snap.queueIndex, -1)
})
