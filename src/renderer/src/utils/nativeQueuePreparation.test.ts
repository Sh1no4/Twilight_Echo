import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../types/music'

const { prepareNativeQueue } = (await import(
  new URL('./nativeQueuePreparation.ts', import.meta.url).href
)) as typeof import('./nativeQueuePreparation')

function createTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'local:one',
    title: 'One',
    artist: 'Artist',
    album: 'Album',
    filePath: 'D:\\Music\\one.flac',
    fileName: 'one.flac',
    duration: 180,
    size: 1,
    cover: null,
    lyrics: null,
    source: 'local',
    format: 'flac',
    ...overrides
  }
}

test('uses only the resolved current stream when a restored companion is unauthorized', async () => {
  const current = createTrack({ id: 'ncm:current', filePath: 'ncm:current', source: 'ncm' })
  const staleLocal = createTrack({ id: 'local:stale', filePath: 'D:\\Old\\stale.flac' })

  const prepared = await prepareNativeQueue({
    queue: [staleLocal, current],
    currentTrack: current,
    currentTarget: 'https://media.example/current.flac',
    currentIndex: 1,
    isAudioFileAuthorized: async (filePath) => filePath !== staleLocal.filePath
  })

  assert.deepEqual(prepared, {
    items: [
      {
        id: 'ncm:current',
        duration: 180,
        source: 'https://media.example/current.flac',
        format: 'flac',
        sampleRate: undefined,
        bitrate: undefined,
        bitDepth: undefined
      }
    ],
    startIndex: 0,
    delegated: false
  })
})

test('preserves a fully authorized local queue and its renderer index', async () => {
  const first = createTrack()
  const second = createTrack({ id: 'local:two', filePath: 'D:\\Music\\two.flac' })

  const prepared = await prepareNativeQueue({
    queue: [first, second],
    currentTrack: second,
    currentTarget: second.filePath,
    currentIndex: 1,
    isAudioFileAuthorized: async () => true
  })

  assert.equal(prepared?.delegated, true)
  assert.equal(prepared?.startIndex, 1)
  assert.deepEqual(
    prepared?.items.map((item) => item.source),
    [first.filePath, second.filePath]
  )
})

test('uses a singleton when a provider companion has not resolved its placeholder', async () => {
  const current = createTrack({ id: 'ncm:current', filePath: 'ncm:current', source: 'ncm' })
  const unresolved = createTrack({ id: 'ncm:next', filePath: 'ncm:next', source: 'ncm' })

  const prepared = await prepareNativeQueue({
    queue: [current, unresolved],
    currentTrack: current,
    currentTarget: 'https://media.example/current.flac',
    currentIndex: 0,
    isAudioFileAuthorized: async () => true
  })

  assert.equal(prepared?.delegated, false)
  assert.equal(prepared?.items.length, 1)
  assert.equal(prepared?.items[0].source, 'https://media.example/current.flac')
})

test('rejects an unsafe current target instead of issuing a native queue request', async () => {
  const current = createTrack({ source: 'ncm', filePath: 'ncm:current' })

  const prepared = await prepareNativeQueue({
    queue: [current],
    currentTrack: current,
    currentTarget: 'https://user:secret@media.example/current.flac',
    currentIndex: 0,
    isAudioFileAuthorized: async () => true
  })

  assert.equal(prepared, null)
})

test('uses the current-only queue when companion authorization throws', async () => {
  const current = createTrack({ id: 'ncm:current', filePath: 'ncm:current', source: 'ncm' })
  const companion = createTrack({ id: 'local:companion', filePath: 'D:\\Music\\companion.flac' })

  const prepared = await prepareNativeQueue({
    queue: [current, companion],
    currentTrack: current,
    currentTarget: 'https://media.example/current.flac',
    currentIndex: 0,
    isAudioFileAuthorized: async () => {
      throw new Error('IPC unavailable')
    }
  })

  assert.equal(prepared?.delegated, false)
  assert.deepEqual(
    prepared?.items.map((item) => item.source),
    ['https://media.example/current.flac']
  )
})


test('forwards library ReplayGain and R128 tags into native queue items', async () => {
  const track = createTrack({
    replayGainTrackGainDb: -6.5,
    replayGainAlbumGainDb: -7.1,
    replayGainTrackPeak: 0.98,
    replayGainAlbumPeak: 0.99,
    r128TrackGainDb: -5.2,
    r128AlbumGainDb: -5.8
  })

  const prepared = await prepareNativeQueue({
    queue: [track],
    currentTrack: track,
    currentTarget: track.filePath,
    currentIndex: 0,
    isAudioFileAuthorized: async () => true
  })

  assert.equal(prepared?.items.length, 1)
  assert.equal(prepared?.items[0].replayGainTrackGainDb, -6.5)
  assert.equal(prepared?.items[0].replayGainAlbumGainDb, -7.1)
  assert.equal(prepared?.items[0].replayGainTrackPeak, 0.98)
  assert.equal(prepared?.items[0].replayGainAlbumPeak, 0.99)
  assert.equal(prepared?.items[0].r128TrackGainDb, -5.2)
  assert.equal(prepared?.items[0].r128AlbumGainDb, -5.8)
})
