import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizePlaylistSources, formatPlaylistSourceSummary } from './playlistSourceSummary.ts'
import type { Track } from '../types/music'

const baseTrack: Track = {
  id: 'local:base',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  filePath: 'D:\\Music\\Song.flac',
  fileName: 'Song.flac',
  duration: 180,
  size: 1,
  cover: null,
  lyrics: null,
  source: 'local'
}

test('summarizePlaylistSources counts local and generic provider prefixes', () => {
  const summary = summarizePlaylistSources({
    trackIds: ['local:one', 'ncm:two', 'bili:three', 'ytm:four'],
    trackSnapshots: {
      'local:one': { ...baseTrack, id: 'local:one', source: 'local' },
      'ncm:two': { ...baseTrack, id: 'ncm:two', filePath: 'ncm:two', source: 'ncm' },
      'bili:three': { ...baseTrack, id: 'bili:three', filePath: 'bili:three', source: 'bili' },
      'ytm:four': { ...baseTrack, id: 'ytm:four', filePath: 'ytm:four', source: 'ytm' }
    }
  })

  assert.deepEqual(summary, {
    total: 4,
    local: 1,
    provider: 3,
    providers: [
      { source: 'bili', count: 1 },
      { source: 'ncm', count: 1 },
      { source: 'ytm', count: 1 }
    ]
  })
})

test('formatPlaylistSourceSummary exposes mixed-source visibility without platform-specific labels', () => {
  assert.equal(
    formatPlaylistSourceSummary({
      total: 4,
      local: 1,
      provider: 3,
      providers: [
        { source: 'bili', count: 1 },
        { source: 'ncm', count: 1 },
        { source: 'ytm', count: 1 }
      ]
    }),
    '本地 1 · Provider 3 · bili/ncm/ytm'
  )
})

test('formatPlaylistSourceSummary stays quiet for empty playlists', () => {
  assert.equal(
    formatPlaylistSourceSummary({
      total: 0,
      local: 0,
      provider: 0,
      providers: []
    }),
    ''
  )
})
