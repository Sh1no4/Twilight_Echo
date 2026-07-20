import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { reactive } from 'vue'

const { MediaProviderRegistry, getProviderLocalId, getTrackProviderId, toProviderIpcArgs } = (await import(
  new URL('./mediaProvider.ts', import.meta.url).href
)) as typeof import('./mediaProvider')

const { getNcmSongId } = (await import(
  new URL('./ncmTrack.ts', import.meta.url).href
)) as typeof import('./ncmTrack')

test('extracts provider prefixes from source or track id', () => {
  assert.equal(getTrackProviderId({ id: 'bili:BV1xx', source: undefined }), 'bili')
  assert.equal(getTrackProviderId({ id: 'ignored:123', source: 'ncm' }), 'ncm')
  assert.equal(getTrackProviderId({ id: 'D:\\Music\\track.flac', source: undefined }), null)
  assert.equal(getTrackProviderId({ id: '/Users/me/Music/track.flac', source: undefined }), null)
  assert.equal(getProviderLocalId('bili:BV1xx', 'bili'), 'BV1xx')
  assert.equal(getProviderLocalId('ncm:12345', 'bili'), null)
})

test('resolveLyricsAcrossProviders fans out to NCM for local tracks', async () => {
  const registry = new MediaProviderRegistry()
  let ncmSearchCalls = 0
  let ncmLyricCalls = 0
  registry.register({
    id: 'ncm',
    name: 'NetEase',
    source: 'plugin',
    capabilities: ['search', 'lyrics'],
    searchSongs: async (keywords) => {
      ncmSearchCalls += 1
      assert.match(keywords, /Moon River/i)
      return {
        total: 1,
        items: [
          {
            id: 'ncm:99',
            title: 'Moon River',
            artist: 'Audrey',
            album: 'Online',
            filePath: 'ncm:99',
            fileName: 'Moon River',
            duration: 180,
            size: 0,
            cover: null,
            lyrics: null,
            source: 'ncm'
          }
        ]
      }
    },
    getLyrics: async (track) => {
      ncmLyricCalls += 1
      assert.equal(track.id, 'ncm:99')
      return {
        lyrics: '[00:01.00]Provider lyric',
        translatedLyrics: '[00:01.00]翻译',
        wordLyrics: null
      }
    }
  })

  const result = await registry.resolveLyricsAcrossProviders({
    id: 'local:abc',
    title: 'Moon River',
    artist: 'Audrey',
    album: 'Local',
    filePath: 'D:\\Music\\Moon River.flac',
    fileName: 'Moon River.flac',
    duration: 181,
    size: 1,
    cover: null,
    lyrics: null,
    source: 'local'
  })

  assert.equal(ncmSearchCalls, 1)
  assert.equal(ncmLyricCalls, 1)
  assert.equal(result.lyrics, '[00:01.00]Provider lyric')
  assert.equal(result.translatedLyrics, '[00:01.00]翻译')
})

test('resolves playback through the matching provider', async () => {
  const registry = new MediaProviderRegistry()
  registry.register({
    id: 'bili',
    name: 'Bilibili',
    source: 'plugin',
    capabilities: ['playbackUrl'],
    getPlaybackUrl: async (track) => `https://example.test/${track.id}.mp3`
  })

  assert.equal(
    await registry.resolvePlaybackUrl({
      id: 'bili:BV1xx',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      filePath: 'bili:BV1xx',
      fileName: 'Song',
      duration: 1,
      size: 0,
      cover: null,
      lyrics: null,
      source: 'bili'
    }),
    'https://example.test/bili:BV1xx.mp3'
  )
})

test('normalizes NetEase song ids from legacy and prefixed tracks', () => {
  assert.equal(getNcmSongId({ id: 'ncm:123', ncmSongId: undefined }), 123)
  assert.equal(getNcmSongId({ id: 'ncm:123', ncmSongId: 456 }), 456)
  assert.equal(getNcmSongId({ id: 'bili:123', ncmSongId: undefined }), null)
})

test('normalizes reactive provider call args before IPC', () => {
  const track = reactive({
    id: 'bili:BV1xx:123',
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    filePath: 'bili:BV1xx:123',
    fileName: 'Song',
    duration: 1,
    size: 0,
    cover: null,
    lyrics: null,
    source: 'bili',
    nested: reactive({ value: 'ok' })
  })

  assert.throws(() => structuredClone([track]), /could not be cloned/i)
  const args = toProviderIpcArgs([track])
  assert.deepEqual(structuredClone(args), args)
  assert.equal((args[0] as { nested: { value: string } }).nested.value, 'ok')
})

test('registry performs unified song search across local tracks and enabled providers', async () => {
  const registry = new MediaProviderRegistry()
  registry.register({
    id: 'ncm',
    name: 'NetEase',
    source: 'plugin',
    capabilities: ['search'],
    searchSongs: async () => ({
      items: [
        {
          id: 'ncm:1',
          title: 'Moon River',
          artist: 'Audrey',
          album: 'Album',
          filePath: 'ncm:1',
          fileName: 'Moon River',
          duration: 180,
          size: 0,
          cover: null,
          lyrics: null,
          source: 'ncm'
        }
      ],
      total: 1
    })
  })

  const result = await registry.searchAllSongs({
    query: 'moon',
    localTracks: [
      {
        id: 'local:1',
        title: 'Moon River',
        artist: 'Audrey',
        album: 'Album',
        filePath: 'D:\\Music\\Moon River.flac',
        fileName: 'Moon River.flac',
        duration: 181,
        size: 1,
        cover: null,
        lyrics: null,
        source: 'local',
        format: 'flac'
      }
    ]
  })

  assert.deepEqual(
    result.items.map((item) => item.track.id),
    ['local:1', 'ncm:1']
  )
  assert.equal(result.logicalItems.length, 1)
  assert.deepEqual(
    result.logicalItems[0].variants.map((variant) => variant.track.id),
    ['local:1', 'ncm:1']
  )
  assert.equal(result.health.ncm.available, true)
})

test('registry updates provider health without replacing method handlers', async () => {
  const registry = new MediaProviderRegistry()
  registry.register({
    id: 'ncm',
    name: 'NetEase',
    source: 'plugin',
    capabilities: ['playbackUrl'],
    health: {
      providerId: 'ncm',
      pluginId: 'com.twilightecho.provider.ncm',
      pluginStatus: 'enabled',
      available: true,
      totalCalls: 1,
      successfulCalls: 1,
      failedCalls: 0,
      successRate: 1,
      methodStats: {},
      lastError: null,
      lastCheckedAt: '2026-07-02T12:00:00.000Z'
    },
    getPlaybackUrl: async () => 'https://example.test/song.mp3'
  })

  const updated = registry.update('ncm', {
    health: {
      providerId: 'ncm',
      pluginId: 'com.twilightecho.provider.ncm',
      pluginStatus: 'enabled',
      available: false,
      totalCalls: 2,
      successfulCalls: 1,
      failedCalls: 1,
      successRate: 0.5,
      methodStats: {
        getPlaybackUrl: {
          totalCalls: 1,
          successfulCalls: 0,
          failedCalls: 1,
          successRate: 0,
          lastError: 'stream expired',
          lastCheckedAt: '2026-07-02T12:01:00.000Z'
        }
      },
      lastError: 'stream expired',
      lastCheckedAt: '2026-07-02T12:01:00.000Z'
    }
  })

  assert.equal(updated, true)
  assert.equal(registry.get('ncm')?.health?.available, false)
  assert.equal(registry.get('ncm')?.health?.methodStats?.getPlaybackUrl?.lastError, 'stream expired')
  assert.equal(
    await registry.get('ncm')?.getPlaybackUrl?.({
      id: 'ncm:1',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      filePath: 'ncm:1',
      fileName: 'Song',
      duration: 1,
      size: 0,
      cover: null,
      lyrics: null,
      source: 'ncm'
    }),
    'https://example.test/song.mp3'
  )
})

test('renderer provider sync carries host health into registered providers', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

  assert.match(source, /health: provider\.health/)
  assert.match(source, /isEnabled: \(\) => provider\.health\?\.available !== false/)
  assert.match(source, /mediaProviders\.update\(provider\.id/)
})

test('renderer provider calls refresh host health snapshots after IPC settles', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

  assert.match(source, /async function refreshPluginProviderHealth\(\): Promise<void>/)
  assert.match(source, /void refreshPluginProviderHealth\(\)/)
  assert.match(source, /finally \{\s*void refreshPluginProviderHealth\(\)\s*\}/)
})
