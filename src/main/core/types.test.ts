import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('PLAYER_SHORTCUTS includes hardware media-key accelerators', async () => {
  const source = await readFile(new URL('./types.ts', import.meta.url), 'utf8')
  assert.match(source, /MediaPlayPause/)
  assert.match(source, /MediaNextTrack/)
  assert.match(source, /MediaPreviousTrack/)
})
