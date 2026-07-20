import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertPlaylistCoverDimensions,
  assertPlaylistCoverFile,
  MAX_PLAYLIST_COVER_BYTES,
  readPlaylistImportFile
} from './playlistFileValidation.ts'
import { MAX_PLAYLIST_IMPORT_BYTES } from './playlistLifecycle.ts'

test('playlist import rejects an oversized file before File.text is called', async () => {
  let reads = 0
  const file = {
    size: MAX_PLAYLIST_IMPORT_BYTES + 1,
    async text(): Promise<string> {
      reads += 1
      return 'must not be read'
    }
  }

  await assert.rejects(readPlaylistImportFile(file), /8 MiB/)
  assert.equal(reads, 0)
})

test('playlist import reads a file at the configured byte limit', async () => {
  let reads = 0
  const file = {
    size: MAX_PLAYLIST_IMPORT_BYTES,
    async text(): Promise<string> {
      reads += 1
      return '#EXTM3U'
    }
  }

  assert.equal(await readPlaylistImportFile(file), '#EXTM3U')
  assert.equal(reads, 1)
})

test('playlist cover validation rejects unsupported media, oversized input, and unsafe dimensions', () => {
  assert.throws(() => assertPlaylistCoverFile({ type: 'image/gif', size: 1 }), /PNG, JPEG, or WebP/)
  assert.throws(
    () => assertPlaylistCoverFile({ type: 'image/png', size: MAX_PLAYLIST_COVER_BYTES + 1 }),
    /6 MiB/
  )
  assert.throws(() => assertPlaylistCoverDimensions(4_001, 4_000), /16 megapixels/)
  assert.doesNotThrow(() => {
    assertPlaylistCoverFile({ type: 'image/webp', size: MAX_PLAYLIST_COVER_BYTES })
    assertPlaylistCoverDimensions(4_000, 4_000)
  })
})
