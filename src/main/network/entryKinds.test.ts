import assert from 'node:assert/strict'
import test from 'node:test'
import { AUDIO_EXTENSIONS, entryKind } from './entryKinds.ts'

test('entryKind classifies audio by extension and mime, directories and files otherwise', () => {
  assert.equal(entryKind('song.flac', {}), 'audio')
  assert.equal(entryKind('song.mp3', {}), 'audio')
  assert.equal(entryKind('album', { directory: true }), 'directory')
  assert.equal(entryKind('notes.txt', {}), 'file')
  assert.equal(entryKind('song', { mime: 'audio/flac' }), 'audio')
  assert.ok(AUDIO_EXTENSIONS.has('dsf'))
})
