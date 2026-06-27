import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')

test('artist songs are fetched with the paged all-songs endpoint before top-song fallback', () => {
  const artistSongsIndex = source.indexOf('/artist/songs?id=')
  const topSongIndex = source.indexOf('/artist/top/song?id=')

  assert.notEqual(artistSongsIndex, -1)
  assert.notEqual(topSongIndex, -1)
  assert.ok(artistSongsIndex < topSongIndex)
  assert.match(source, /fetchPagedItems\(\{\s*makePath:[\s\S]*\/artist\/songs\?id=/)
  assert.doesNotMatch(source, /\/artist\/songs\?id=\$\{encodedId\}&order=hot&limit=50&offset=0/)
})

test('artist albums are fetched through the shared pagination helper', () => {
  assert.match(source, /fetchPagedItems\(\{\s*makePath:[\s\S]*\/artist\/album\?id=/)
  assert.doesNotMatch(source, /\/artist\/album\?id=\$\{encodeURIComponent\(String\(artistId\)\)\}&limit=100&offset=0/)
})
