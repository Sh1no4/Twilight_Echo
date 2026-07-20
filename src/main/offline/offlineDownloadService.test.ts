import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { clearManagedMusicCache } from '../cache/musicCacheLayout.ts'
import {
  OfflineDownloadService,
  type OfflinePublishFaultContext,
  type OfflinePublishFaultPoint
} from './offlineDownloadService.ts'

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'twilight-offline-download-'))
}

async function waitForStatus(
  service: OfflineDownloadService,
  id: string,
  statuses: string[]
): Promise<Awaited<ReturnType<OfflineDownloadService['list']>>['records'][number]> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const record = (await service.list()).records.find((item) => item.id === id)
    if (record && statuses.includes(record.status)) return record
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Download ${id} did not reach ${statuses.join(', ')}`)
}

const CRASH_RECOVERY_REQUEST = {
  providerId: 'crash-fixture',
  trackId: 'crash-fixture:1',
  title: 'Crash recovery fixture',
  quality: 'lossless',
  url: 'https://media.example/crash-recovery.mp3'
}

async function runPublishCrashRecovery(
  root: string,
  point: OfflinePublishFaultPoint,
  options: {
    corruptPublishedFinal?: boolean
    expectNew: boolean
    inspectCrashState(context: OfflinePublishFaultContext): Promise<void>
  }
): Promise<void> {
  const original = new TextEncoder().encode('previous verified offline pin')
  const replacement = new TextEncoder().encode('new verified offline pin')
  const initial = new OfflineDownloadService({
    rootPath: root,
    fetch: async () =>
      new Response(original, {
        headers: { 'content-length': String(original.byteLength), 'content-type': 'audio/mpeg' }
      })
  })
  await initial.initialize()
  const first = await initial.queue(CRASH_RECOVERY_REQUEST)
  await waitForStatus(initial, first.id, ['completed'])

  let reached!: (context: OfflinePublishFaultContext) => void
  const faultReached = new Promise<OfflinePublishFaultContext>((resolveFault) => {
    reached = resolveFault
  })
  const crashing = new OfflineDownloadService({
    rootPath: root,
    fetch: async () =>
      new Response(replacement, {
        headers: {
          'content-length': String(replacement.byteLength),
          'content-type': 'audio/mpeg'
        }
      }),
    testPublishFault: async (currentPoint, context) => {
      if (currentPoint !== point) return
      if (options.corruptPublishedFinal) await writeFile(context.finalPath, 'corrupt final bytes')
      reached(context)
      throw new Error(`simulated process loss at ${point}`)
    }
  })
  await crashing.initialize()
  await crashing.queue(CRASH_RECOVERY_REQUEST)
  const context = await faultReached
  await options.inspectCrashState(context)
  await new Promise((resolveTick) => setTimeout(resolveTick, 20))

  const restarted = new OfflineDownloadService({ rootPath: root })
  await restarted.initialize()
  const recovered = await waitForStatus(restarted, first.id, ['completed'])
  const playable = await restarted.getPlayablePath(
    CRASH_RECOVERY_REQUEST.providerId,
    CRASH_RECOVERY_REQUEST.trackId
  )
  assert.ok(playable)
  assert.deepEqual(
    new Uint8Array(await readFile(playable!)),
    options.expectNew ? replacement : original
  )
  assert.match(
    recovered.error ?? '',
    options.expectNew ? /recovered a verified offline publish/i : /previous complete verified pin/i
  )
  const transactionArtifacts = (await readdir(join(root, 'offline-pinned'))).filter(
    (name) => name.endsWith('.part') || name.endsWith('.replaced') || name.endsWith('.publish.json')
  )
  assert.deepEqual(transactionArtifacts, [])
}

test('publish restart before moving the old pin keeps the verified prior artifact', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  await runPublishCrashRecovery(root, 'beforeOldMove', {
    expectNew: false,
    async inspectCrashState(context) {
      await access(context.journalPath)
      await assert.rejects(access(context.backupPath))
      assert.equal(await readFile(context.finalPath, 'utf8'), 'previous verified offline pin')
    }
  })
})

test('publish restart after moving the old pin restores its verified rollback copy', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  await runPublishCrashRecovery(root, 'afterOldMove', {
    expectNew: false,
    async inspectCrashState(context) {
      await access(context.journalPath)
      await access(context.backupPath)
      await assert.rejects(access(context.finalPath))
    }
  })
})

test('publish restart after the new file lands commits it before clearing rollback material', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  await runPublishCrashRecovery(root, 'afterNewPublish', {
    expectNew: true,
    async inspectCrashState(context) {
      await access(context.journalPath)
      await access(context.backupPath)
      assert.equal(await readFile(context.finalPath, 'utf8'), 'new verified offline pin')
    }
  })
})

test('publish restart rejects a corrupt new final and restores the verified old pin', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  await runPublishCrashRecovery(root, 'afterNewPublish', {
    corruptPublishedFinal: true,
    expectNew: false,
    async inspectCrashState(context) {
      await access(context.journalPath)
      await access(context.backupPath)
      assert.equal(await readFile(context.finalPath, 'utf8'), 'corrupt final bytes')
    }
  })
})

test('publish recovery rejects journal-supplied paths outside the controlled pin directory', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const original = new TextEncoder().encode('safe pinned bytes')
  const service = new OfflineDownloadService({
    rootPath: root,
    fetch: async () =>
      new Response(original, {
        headers: { 'content-length': String(original.byteLength), 'content-type': 'audio/mpeg' }
      })
  })
  await service.initialize()
  const queued = await service.queue(CRASH_RECOVERY_REQUEST)
  await waitForStatus(service, queued.id, ['completed'])
  const outside = join(root, 'outside.mp3')
  await writeFile(outside, 'outside sentinel')
  await writeFile(
    join(root, 'offline-pinned', `.${queued.id}.publish.json`),
    JSON.stringify({
      version: 1,
      id: queued.id,
      finalFileName: '..\\outside.mp3',
      newSha256: '0'.repeat(64),
      newBytes: 1,
      completedAt: '2026-07-18T00:00:00.000Z',
      prior: null
    })
  )

  const restarted = new OfflineDownloadService({ rootPath: root })
  await restarted.initialize()
  assert.equal(await readFile(outside, 'utf8'), 'outside sentinel')
  const playable = await restarted.getPlayablePath(
    CRASH_RECOVERY_REQUEST.providerId,
    CRASH_RECOVERY_REQUEST.trackId
  )
  assert.ok(playable)
  assert.deepEqual(new Uint8Array(await readFile(playable!)), original)
})

test('a second operation for the same pin cannot race its publish transaction', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new OfflineDownloadService({
    rootPath: root,
    fetch: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
  })
  t.after(() => service.shutdown())
  await service.initialize()
  const first = await service.queue(CRASH_RECOVERY_REQUEST)
  await waitForStatus(service, first.id, ['downloading'])
  await assert.rejects(service.queue(CRASH_RECOVERY_REQUEST), /already in progress/i)
  await service.cancel(first.id)
  await waitForStatus(service, first.id, ['cancelled'])
})

test('offline pin streams to a temporary file, atomically publishes hash-verified media, and survives cache clear', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const bytes = new TextEncoder().encode('verified offline media')
  const service = new OfflineDownloadService({
    rootPath: root,
    fetch: async () =>
      new Response(bytes, {
        headers: { 'content-length': String(bytes.byteLength), 'content-type': 'audio/mpeg' }
      })
  })
  await service.initialize()
  const queued = await service.queue({
    providerId: 'demo',
    trackId: 'demo:42',
    title: 'Safe pin',
    quality: 'lossless',
    url: 'https://media.example/42.mp3'
  })
  const completed = await waitForStatus(service, queued.id, ['completed'])
  assert.equal(completed.quality, 'lossless')
  assert.equal(completed.bytesDownloaded, bytes.byteLength)
  const playable = await service.getPlayablePath('demo', 'demo:42')
  assert.ok(playable)
  assert.deepEqual(new Uint8Array(await readFile(playable!)), bytes)
  await clearManagedMusicCache(root)
  assert.deepEqual(
    new Uint8Array(await readFile(playable!)),
    bytes,
    'cache cleanup must preserve explicit pins'
  )
})

test('offline service restores interrupted work as an observable retryable failure', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const pinned = join(root, 'offline-pinned')
  await mkdir(pinned, { recursive: true })
  const orphanPart = join(pinned, '.orphan.part')
  const partNamedDirectory = join(pinned, '.directory.part')
  const ordinaryPart = join(pinned, 'ordinary.part')
  await writeFile(orphanPart, 'partial bytes')
  await mkdir(partNamedDirectory)
  await writeFile(join(partNamedDirectory, 'keep.txt'), 'do not recurse')
  await writeFile(ordinaryPart, 'user file')
  await writeFile(
    join(pinned, 'offline-downloads.json'),
    JSON.stringify({
      version: 1,
      records: [
        {
          id: 'x',
          providerId: 'demo',
          trackId: 'demo:1',
          title: 'Interrupted',
          quality: 'auto',
          pinned: true,
          status: 'downloading',
          bytesDownloaded: 4,
          totalBytes: 8,
          sha256: null,
          fileName: null,
          downloadedAt: null,
          expiresAt: null,
          error: null,
          retryCount: 0,
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
  )
  const service = new OfflineDownloadService({ rootPath: root })
  await service.initialize()
  const [record] = (await service.list()).records
  assert.equal(record.status, 'failed')
  assert.match(record.error ?? '', /interrupted/i)
  assert.match(record.error ?? '', /Removed 1 incomplete temporary file/i)
  await assert.rejects(access(orphanPart))
  await access(join(partNamedDirectory, 'keep.txt'))
  await access(ordinaryPart)
})

test('declared Content-Length must exactly match streamed bytes before publication', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new OfflineDownloadService({
    rootPath: root,
    fetch: async () =>
      new Response(new TextEncoder().encode('short'), {
        headers: { 'content-length': '100', 'content-type': 'audio/mpeg' }
      })
  })
  await service.initialize()
  const queued = await service.queue({
    providerId: 'demo',
    trackId: 'demo:truncated',
    title: 'Truncated',
    quality: 'auto',
    url: 'https://media.example/truncated.mp3'
  })
  const failed = await waitForStatus(service, queued.id, ['failed'])
  assert.equal(failed.bytesDownloaded, 5)
  assert.equal(failed.totalBytes, 100)
  assert.match(failed.error ?? '', /Content-Length declared 100 bytes/i)
  assert.equal(await service.getPlayablePath('demo', 'demo:truncated'), null)
})

test('a truncated refresh never replaces the previous complete playable pin', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const original = new TextEncoder().encode('original complete offline media')
  let body = original
  let declaredLength = original.byteLength
  const service = new OfflineDownloadService({
    rootPath: root,
    fetch: async () =>
      new Response(body, {
        headers: { 'content-length': String(declaredLength), 'content-type': 'audio/mpeg' }
      })
  })
  await service.initialize()
  const request = {
    providerId: 'demo',
    trackId: 'demo:stable',
    title: 'Stable pin',
    quality: 'lossless',
    url: 'https://media.example/stable.mp3'
  }
  const first = await service.queue(request)
  await waitForStatus(service, first.id, ['completed'])
  const originalPath = await service.getPlayablePath(request.providerId, request.trackId)
  assert.ok(originalPath)

  body = new TextEncoder().encode('short')
  declaredLength = 100
  const refresh = await service.queue(request)
  const restored = await waitForStatus(service, refresh.id, ['completed'])
  assert.match(restored.error ?? '', /previous complete pin was kept/i)
  const playable = await service.getPlayablePath(request.providerId, request.trackId)
  assert.equal(playable, originalPath)
  assert.deepEqual(new Uint8Array(await readFile(playable!)), original)
})

test('restart recovery keeps a prior verified pin when a refresh was interrupted', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const original = new TextEncoder().encode('verified before interrupted refresh')
  const service = new OfflineDownloadService({
    rootPath: root,
    fetch: async () =>
      new Response(original, {
        headers: {
          'content-length': String(original.byteLength),
          'content-type': 'audio/mpeg'
        }
      })
  })
  await service.initialize()
  const queued = await service.queue({
    providerId: 'demo',
    trackId: 'demo:restart-refresh',
    title: 'Restart refresh',
    quality: 'lossless',
    url: 'https://media.example/restart-refresh.mp3'
  })
  const completed = await waitForStatus(service, queued.id, ['completed'])
  const statePath = join(root, 'offline-pinned', 'offline-downloads.json')
  const partialPath = join(root, 'offline-pinned', '.refresh.part')
  await writeFile(partialPath, 'incomplete refresh')
  await writeFile(
    statePath,
    JSON.stringify({
      version: 1,
      records: [
        {
          ...completed,
          status: 'downloading',
          bytesDownloaded: 4,
          totalBytes: 100,
          error: null
        }
      ]
    })
  )

  const restarted = new OfflineDownloadService({ rootPath: root })
  await restarted.initialize()
  const [recovered] = (await restarted.list()).records
  assert.equal(recovered.status, 'completed')
  assert.match(recovered.error ?? '', /previous complete verified pin was kept/i)
  await assert.rejects(access(partialPath))
  const playable = await restarted.getPlayablePath('demo', 'demo:restart-refresh')
  assert.ok(playable)
  assert.deepEqual(new Uint8Array(await readFile(playable!)), original)
})

test('cancelled streaming download has no playable partial file and integrity failures are quarantined', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  let release!: () => void
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('partial'))
      new Promise<void>((resolve) => {
        release = resolve
      }).then(() => controller.close())
    }
  })
  const service = new OfflineDownloadService({
    rootPath: root,
    fetch: async () => new Response(body, { headers: { 'content-type': 'audio/mpeg' } })
  })
  await service.initialize()
  const queued = await service.queue({
    providerId: 'demo',
    trackId: 'demo:cancel',
    title: 'Cancel',
    quality: 'auto',
    url: 'https://media.example/cancel.mp3'
  })
  await waitForStatus(service, queued.id, ['downloading'])
  await service.cancel(queued.id)
  release()
  await waitForStatus(service, queued.id, ['cancelled'])
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(
    (await service.list()).records.find((record) => record.id === queued.id)?.status,
    'cancelled'
  )
  assert.deepEqual(
    (await readdir(join(root, 'offline-pinned'))).filter((name) => name.endsWith('.part')),
    []
  )
  assert.equal(await service.getPlayablePath('demo', 'demo:cancel'), null)

  const verified = new OfflineDownloadService({
    rootPath: root,
    fetch: async () =>
      new Response(new TextEncoder().encode('complete'), {
        headers: { 'content-type': 'audio/mpeg' }
      })
  })
  const complete = await verified.queue({
    providerId: 'demo',
    trackId: 'demo:tamper',
    title: 'Tamper',
    quality: 'auto',
    url: 'https://media.example/tamper.mp3'
  })
  await waitForStatus(verified, complete.id, ['completed'])
  const path = await verified.getPlayablePath('demo', 'demo:tamper')
  await writeFile(path!, 'tampered')
  assert.equal(await verified.getPlayablePath('demo', 'demo:tamper'), null)
  assert.equal((await waitForStatus(verified, complete.id, ['failed'])).status, 'failed')
  const retried = await verified.queue({
    providerId: 'demo',
    trackId: 'demo:tamper',
    title: 'Tamper',
    quality: 'auto',
    url: 'https://media.example/tamper.mp3'
  })
  assert.equal((await waitForStatus(verified, retried.id, ['completed'])).status, 'completed')
})

test('expired pins remain visible but cannot bypass normal online playback', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new OfflineDownloadService({
    rootPath: root,
    fetch: async () =>
      new Response(new TextEncoder().encode('expired'), {
        headers: { 'content-type': 'audio/mpeg' }
      })
  })
  await service.initialize()
  const queued = await service.queue({
    providerId: 'demo',
    trackId: 'demo:expired',
    title: 'Expired',
    quality: 'auto',
    url: 'https://media.example/expired.mp3',
    expiresAt: '2020-01-01T00:00:00.000Z'
  })
  const record = await waitForStatus(service, queued.id, ['expired'])
  assert.equal(record.status, 'expired')
  assert.equal(await service.getPlayablePath('demo', 'demo:expired'), null)
})

test('batch playable-path lookup verifies every pin and rejects tampered or expired entries', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new OfflineDownloadService({
    rootPath: root,
    fetch: async (input) => {
      const bytes = new TextEncoder().encode(new URL(String(input)).pathname)
      return new Response(bytes, {
        headers: { 'content-length': String(bytes.byteLength), 'content-type': 'audio/mpeg' }
      })
    }
  })
  await service.initialize()
  const requests = [
    {
      providerId: 'demo',
      trackId: 'demo:good',
      title: 'Good',
      quality: 'auto',
      url: 'https://media.example/good.mp3'
    },
    {
      providerId: 'demo',
      trackId: 'demo:tampered',
      title: 'Tampered',
      quality: 'auto',
      url: 'https://media.example/tampered.mp3'
    },
    {
      providerId: 'demo',
      trackId: 'demo:expired-batch',
      title: 'Expired',
      quality: 'auto',
      url: 'https://media.example/expired.mp3',
      expiresAt: '2020-01-01T00:00:00.000Z'
    }
  ]
  const queued = await service.queueMany(requests)
  await Promise.all(
    queued.map((record) => waitForStatus(service, record.id, ['completed', 'expired']))
  )
  const tamperedPath = await service.getPlayablePath('demo', 'demo:tampered')
  assert.ok(tamperedPath)
  await writeFile(tamperedPath!, 'tampered after publication')

  const paths = await service.getPlayablePaths(
    requests.map(({ providerId, trackId }) => ({ providerId, trackId }))
  )
  assert.ok(paths[0])
  assert.equal(paths[1], null)
  assert.equal(paths[2], null)
  assert.equal((await waitForStatus(service, queued[1].id, ['failed'])).status, 'failed')
})

test('1000 queued pins stay responsive and leave no refed timeout handle', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new OfflineDownloadService({
    rootPath: root,
    fetch: async () => await new Promise<Response>(() => {})
  })
  t.after(() => service.shutdown())
  await service.initialize()
  const started = performance.now()
  await service.queueMany(
    Array.from({ length: 1000 }, (_, index) => ({
      providerId: 'benchmark',
      trackId: `benchmark:${index}`,
      title: `Track ${index}`,
      quality: 'auto',
      url: `https://media.example/${index}.mp3`
    }))
  )
  const elapsed = performance.now() - started
  assert.equal((await service.list()).records.length, 1000)
  assert.ok(elapsed < 5000, `1000 pin state writes took ${elapsed.toFixed(1)}ms`)
})
