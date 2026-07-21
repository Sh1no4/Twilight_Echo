import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./radioMediaIpc.ts', import.meta.url), 'utf8')

test('podcast IPC no longer exposes offline pinEpisode', () => {
  assert.doesNotMatch(source, /podcast:pinEpisode/)
  assert.doesNotMatch(source, /getOfflineDownloadService/)
  assert.doesNotMatch(source, /authorizeOfflineDownloadRequest/)
  assert.match(source, /podcast:refreshAll/)
})
