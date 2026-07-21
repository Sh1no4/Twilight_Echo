import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./radioMediaIpc.ts', import.meta.url), 'utf8')

test('podcast:pinEpisode aligns track-id length with offline SAFE_TRACK_ID (768)', () => {
  assert.match(source, /'podcast:pinEpisode'/)
  assert.match(
    source,
    /normalizeIpcString\(trackId,\s*'podcast track id',\s*768\)/
  )
  assert.match(source, /MAX_OFFLINE_TRACK_ID_LENGTH \(768\)/)
  assert.match(source, /remoteMediaGrants\.grant\(episode\.mediaUrl,\s*'audio'\)/)
  assert.doesNotMatch(
    source,
    /normalizeIpcString\(trackId,\s*'podcast track id',\s*600\)/,
    'pinEpisode must not use the old 600-char cap (offline accepts up to 768)'
  )
})
