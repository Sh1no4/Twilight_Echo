import assert from 'node:assert/strict'
import test from 'node:test'
import { extractChecksumFromBody, pickWindowsAsset } from './appUpdateHelpers.ts'

test('pickWindowsAsset prefers setup.exe over plain exe', () => {
  const picked = pickWindowsAsset([
    { name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt' },
    { name: 'TwilightEcho-1.0.1.exe', browser_download_url: 'https://example.com/a.exe' },
    {
      name: 'TwilightEcho-1.0.1-setup.exe',
      browser_download_url: 'https://example.com/setup.exe'
    }
  ])
  assert.equal(picked?.name, 'TwilightEcho-1.0.1-setup.exe')
})

test('extractChecksumFromBody finds hash next to asset name', () => {
  const body = `
## Checksums
abc123 is wrong
deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  TwilightEcho-1.0.1-setup.exe
`
  const hash = extractChecksumFromBody(body, 'TwilightEcho-1.0.1-setup.exe')
  assert.equal(hash, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
})

test('extractChecksumFromBody returns undefined when missing', () => {
  assert.equal(extractChecksumFromBody('no hashes here', 'a-setup.exe'), undefined)
})
