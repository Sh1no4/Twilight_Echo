import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverChromecastDevices } from './chromecastClient.ts'

test('discoverChromecastDevices returns an array even when no devices reply', async () => {
  // Use a very short timeout; empty LAN still yields [].
  const devices = await discoverChromecastDevices({ timeoutMs: 50 })
  assert.ok(Array.isArray(devices))
  for (const d of devices) {
    assert.equal(d.protocol, 'chromecast')
    assert.ok(d.id.startsWith('chromecast:'))
    assert.ok(d.host)
  }
})
