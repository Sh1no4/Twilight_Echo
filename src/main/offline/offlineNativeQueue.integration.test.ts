import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { OfflineDownloadRecord } from '../../shared/offlineDownloads.ts'
import type { Track } from '../../renderer/src/types/music.ts'
import { preparePlayerNativeQueue } from '../../renderer/src/utils/nativeQueuePreparation.ts'
import { OfflineDownloadService } from './offlineDownloadService.ts'

function providerTrack(id: string, streamUrl: string): Track {
  return {
    id,
    title: id,
    artist: 'Artist',
    album: 'Album',
    filePath: id,
    fileName: `${id}.mp3`,
    duration: 120,
    size: 1,
    cover: null,
    lyrics: null,
    source: 'demo',
    streamUrl
  }
}

async function waitForSettled(
  service: OfflineDownloadService,
  id: string
): Promise<OfflineDownloadRecord> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = (await service.list()).records.find((candidate) => candidate.id === id)
    if (record && (record.status === 'completed' || record.status === 'expired')) return record
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Offline pin ${id} did not settle`)
}

test('PlayerStore boundary batch-resolves main-verified pins before the native queue, with safe online fallback', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-offline-native-queue-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new OfflineDownloadService({
    rootPath: root,
    fetch: async (input) => {
      const bytes = new TextEncoder().encode(`verified:${new URL(String(input)).pathname}`)
      return new Response(bytes, {
        headers: { 'content-length': String(bytes.byteLength), 'content-type': 'audio/mpeg' }
      })
    }
  })
  await service.initialize()
  const current = providerTrack('demo:current', 'https://online.example/current.mp3')
  const next = providerTrack('demo:next', 'https://online.example/next.mp3')
  const expired = providerTrack('demo:expired', 'https://online.example/expired.mp3')
  const queued = await service.queueMany([
    {
      providerId: 'demo',
      trackId: current.id,
      title: current.title,
      quality: 'lossless',
      url: 'https://media.example/current.mp3'
    },
    {
      providerId: 'demo',
      trackId: next.id,
      title: next.title,
      quality: 'lossless',
      url: 'https://media.example/next.mp3'
    },
    {
      providerId: 'demo',
      trackId: expired.id,
      title: expired.title,
      quality: 'lossless',
      url: 'https://media.example/expired.mp3',
      expiresAt: '2020-01-01T00:00:00.000Z'
    }
  ])
  await Promise.all(queued.map((record) => waitForSettled(service, record.id)))

  const preloadCalls: Array<Array<{ providerId: string; trackId: string }>> = []
  const nativeLoads: Array<{ sources: string[]; startIndex: number; delegated: boolean }> = []
  const boundary = {
    isAudioFileAuthorized: async (path: string) => path.includes('offline-pinned'),
    getOfflinePlayablePaths: async (requests: Array<{ providerId: string; trackId: string }>) => {
      preloadCalls.push(requests)
      return service.getPlayablePaths(requests)
    }
  }
  const loadLikePlayerStore = async (queue: Track[], currentTarget: string): Promise<void> => {
    const prepared = await preparePlayerNativeQueue(
      {
        queue,
        currentTrack: current,
        currentTarget,
        currentIndex: 0
      },
      boundary
    )
    assert.ok(prepared)
    nativeLoads.push({
      sources: prepared.items.map((item) => item.source),
      startIndex: prepared.startIndex,
      delegated: prepared.delegated
    })
  }

  // No provider URL is usable at this boundary: both items must be resolved
  // from main-verified pins for native next/continuous playback to work.
  await loadLikePlayerStore([current, next], current.filePath)
  assert.equal(preloadCalls.length, 1, 'the renderer queue must cross preload as one batch')
  assert.deepEqual(
    preloadCalls[0].map((request) => request.trackId),
    [current.id, next.id]
  )
  assert.match(nativeLoads[0].sources[0], /offline-pinned/)
  assert.match(nativeLoads[0].sources[1], /offline-pinned/)
  assert.equal(nativeLoads[0].delegated, true)

  const nextPath = await service.getPlayablePath('demo', next.id)
  assert.ok(nextPath)
  await writeFile(nextPath!, 'tampered')
  await loadLikePlayerStore([current, next, expired], current.streamUrl!)
  assert.match(nativeLoads[1].sources[0], /offline-pinned/)
  assert.equal(nativeLoads[1].sources[1], next.streamUrl, 'tampered pin must use the online target')
  assert.equal(nativeLoads[1].sources[2], expired.streamUrl)
})
