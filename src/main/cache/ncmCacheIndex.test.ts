import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNcmCacheIndexFromNames, parseNcmCacheFileSongId } from './ncmCacheIndex.ts'

test('ncm cache index parses song ids from finished file names', () => {
  assert.equal(parseNcmCacheFileSongId('123.flac'), 123)
  assert.equal(parseNcmCacheFileSongId('7.mp3'), 7)
  assert.equal(parseNcmCacheFileSongId('987654321.m4a'), 987654321)
})

test('ncm cache index rejects in-flight .part files and malformed names', () => {
  assert.equal(parseNcmCacheFileSongId('123.flac.abc123.part'), null)
  assert.equal(parseNcmCacheFileSongId('123.part'), null)
  assert.equal(parseNcmCacheFileSongId('song-123.flac'), null)
  assert.equal(parseNcmCacheFileSongId('.mp3'), null)
  assert.equal(parseNcmCacheFileSongId('0.flac'), null)
  assert.equal(parseNcmCacheFileSongId('-12.flac'), null)
  assert.equal(parseNcmCacheFileSongId(''), null)
  assert.equal(parseNcmCacheFileSongId('9'.repeat(30) + '.flac'), null)
})

test('ncm cache index keeps the first entry when duplicate finished files exist', () => {
  const index = buildNcmCacheIndexFromNames([
    '5.flac',
    '5.flac.bak-copy.part',
    '5.mp3',
    'readme.txt',
    '6.flac.deadbeef.part'
  ])
  assert.equal(index.get(5), '5.flac')
  assert.equal(index.has(6), false, 'orphan .part residue must never be indexed')
  assert.equal(index.size, 1)
})

test('ncm cache index treats numeric prefixes as distinct song ids', () => {
  const index = buildNcmCacheIndexFromNames(['12.flac', '123.flac', '1234.mp3'])
  assert.equal(index.get(12), '12.flac')
  assert.equal(index.get(123), '123.flac')
  assert.equal(index.get(1234), '1234.mp3')
})
