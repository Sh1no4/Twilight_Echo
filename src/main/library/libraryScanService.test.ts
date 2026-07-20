import assert from 'node:assert/strict'
import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type {
  LocalLibraryScanWorkerMessage,
  LocalLibraryScanWorkerRequest,
  LocalLibraryWorkerScanRequest
} from '../../shared/localLibraryScan.ts'
import type { LocalMusicLibraryDocument } from '../../shared/localLibrary.ts'
import { persistLocalLibraryFileIndex, loadLocalLibraryFileIndex } from './fileIndex.ts'
import { LocalLibraryIndexCoordinator } from './libraryIndexCoordinator.ts'
import type { LocalLibraryScanRunner } from './libraryScanServiceClient.ts'
import { loadMusicLibraryDocument, persistMusicLibraryDocument } from './libraryRepository.ts'

const WORKER_MESSAGE_TIMEOUT_MS = 30_000
const WORKER_TERMINATION_TIMEOUT_MS = 5_000

test('scan worker parses metadata out of process and returns a complete identity snapshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-scan-worker-'))
  const filePath = join(root, 'Artist - Song.mp3')
  writeFileSync(filePath, 'not-real-mp3')
  const child = await startWorker()
  try {
    const response = await sendScan(child, {
      ...baseRequest(root),
      mode: 'full'
    })

    assert.notEqual(child.pid, process.pid)
    assert.equal(response.ok, true)
    if (!response.ok) return
    assert.equal(response.value.completeIdentitySnapshot, true)
    assert.equal(response.value.parsedFileCount, 1)
    assert.equal(response.value.identities[0].filePath, filePath)
    assert.equal((response.value.parsedTracks[0] as { title?: unknown }).title, 'Song')
  } finally {
    await terminateWorker(child)
    rmSync(root, { recursive: true, force: true })
  }
})

test('scan worker tracks sibling CUE dependencies across startup and watcher scans', async () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-scan-worker-cue-'))
  const filePath = join(root, 'disc.mp3')
  const cuePath = join(root, 'disc.cue')
  writeFileSync(filePath, 'not-real-mp3')
  const child = await startWorker()
  try {
    const initial = await sendScan(child, { ...baseRequest(root), mode: 'full' })
    assert.equal(initial.ok, true)
    if (!initial.ok) return
    const initialIdentity = initial.value.identities[0]
    assert.equal(initialIdentity.cueSignature, undefined)

    writeFileSync(cuePath, 'FILE "disc.mp3" MP3\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n')
    const added = await sendScan(child, {
      ...baseRequest(root),
      knownIdentities: [initialIdentity],
      knownTrackPaths: [filePath],
      mode: 'watch',
      changes: [{ kind: 'add', path: cuePath }]
    })
    assert.equal(added.ok, true)
    if (!added.ok) return
    assert.equal(added.value.parsedFileCount, 1)
    assert.equal(typeof added.value.identities[0].cueSignature, 'string')
    const addedIdentity = added.value.identities[0]

    const unchanged = await sendScan(child, {
      ...baseRequest(root),
      knownIdentities: [addedIdentity],
      knownTrackPaths: [filePath],
      mode: 'startup'
    })
    assert.equal(unchanged.ok, true)
    if (!unchanged.ok) return
    assert.equal(unchanged.value.parsedFileCount, 0)
    assert.equal(unchanged.value.skippedUnchanged, 1)

    writeFileSync(
      cuePath,
      'FILE "disc.mp3" MP3\nTRACK 01 AUDIO\nTITLE "Changed and longer"\nINDEX 01 00:00:00\n'
    )
    const changed = await sendScan(child, {
      ...baseRequest(root),
      knownIdentities: [addedIdentity],
      knownTrackPaths: [filePath],
      mode: 'watch',
      changes: [{ kind: 'add', path: cuePath }]
    })
    assert.equal(changed.ok, true)
    if (!changed.ok) return
    assert.equal(changed.value.parsedFileCount, 1)
    assert.notEqual(changed.value.identities[0].cueSignature, addedIdentity.cueSignature)

    rmSync(cuePath, { force: true })
    const removed = await sendScan(child, {
      ...baseRequest(root),
      knownIdentities: changed.value.identities,
      knownTrackPaths: [filePath],
      mode: 'watch',
      changes: [{ kind: 'remove', path: cuePath }]
    })
    assert.equal(removed.ok, true)
    if (!removed.ok) return
    assert.equal(removed.value.parsedFileCount, 1)
    assert.equal(removed.value.identities[0].cueSignature, undefined)
    assert.deepEqual(removed.value.removedFilePaths, [])
  } finally {
    await terminateWorker(child)
    rmSync(root, { recursive: true, force: true })
  }
})

test('scan worker fails closed instead of treating an unreadable root as an empty library', async () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-scan-worker-missing-'))
  const missingRoot = join(root, 'offline-volume')
  const child = await startWorker()
  try {
    const response = await sendScan(child, {
      ...baseRequest(missingRoot),
      mode: 'startup'
    })

    assert.equal(response.ok, false)
    if (response.ok) return
    assert.match(response.error, /enumeration was incomplete/)
    assert.doesNotMatch(response.error, /offline-volume/)
  } finally {
    await terminateWorker(child)
    rmSync(root, { recursive: true, force: true })
  }
})

test('vanished watcher additions remove the persisted Track and file index through the coordinator', async () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-scan-worker-vanished-'))
  const libraryFile = join(root, 'music-library.json')
  const filePath = join(root, 'vanished.flac')
  const track = createTrack('vanished', filePath)
  persistMusicLibraryDocument(libraryFile, createDocument(1, root, [track]))
  persistLocalLibraryFileIndex(libraryFile, {
    version: 1,
    libraryRevision: 1,
    updatedAt: new Date(0).toISOString(),
    entries: [{ filePath, size: 1, mtimeMs: 1 }]
  })

  const child = await startWorker()
  const runner = createWorkerRunner(child)
  const coordinator = new LocalLibraryIndexCoordinator({
    libraryFilePath: libraryFile,
    scanRunner: runner,
    enqueueTransaction: async (operation) => await operation(),
    loadDocument: () => loadMusicLibraryDocument(libraryFile),
    persistDocument: (document) => persistMusicLibraryDocument(libraryFile, document),
    resolveRoots: async (folders) => [...folders],
    getCoverCacheDir: () => join(root, 'covers'),
    watcherDebounceMs: 25
  })
  try {
    const completed = once(coordinator, 'watch-result')
    coordinator.enqueueWatcherChanges([{ kind: 'add', path: filePath }])
    const [result] = await completed

    assert.deepEqual(result.removedFilePaths, [filePath])
    assert.deepEqual(result.library.tracks, [])
    assert.deepEqual(loadMusicLibraryDocument(libraryFile).document.tracks, [])
    assert.deepEqual(loadLocalLibraryFileIndex(libraryFile).document.entries, [])
  } finally {
    coordinator.destroy()
    runner.destroy()
    rmSync(root, { recursive: true, force: true })
  }
})

async function startWorker(): Promise<ChildProcess> {
  const child = fork(fileURLToPath(new URL('./libraryScanService.ts', import.meta.url)), [], {
    execArgv: ['--experimental-strip-types'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  try {
    await waitForMessage(child, (message) => message.kind === 'ready')
    return child
  } catch (error) {
    await terminateWorker(child)
    throw error
  }
}

async function terminateWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return

  const exited = once(child, 'exit')
  child.kill()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, WORKER_TERMINATION_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function sendScan(
  child: ChildProcess,
  request: LocalLibraryWorkerScanRequest
): Promise<Extract<LocalLibraryScanWorkerMessage, { kind: 'response' }>> {
  const requestId = `scan-${Date.now()}-${Math.random()}`
  const response = waitForMessage(
    child,
    (message): message is Extract<LocalLibraryScanWorkerMessage, { kind: 'response' }> =>
      message.kind === 'response' && message.requestId === requestId
  )
  child.send({ kind: 'scan', requestId, request } satisfies LocalLibraryScanWorkerRequest)
  return await response
}

function createWorkerRunner(child: ChildProcess): LocalLibraryScanRunner {
  return {
    async scan(_jobId, request) {
      const response = await sendScan(child, request)
      if (!response.ok) throw new Error(response.error)
      return response.value
    },
    pause(requestId) {
      child.send({ kind: 'pause', requestId } satisfies LocalLibraryScanWorkerRequest)
    },
    resume(requestId) {
      child.send({ kind: 'resume', requestId } satisfies LocalLibraryScanWorkerRequest)
    },
    cancel(requestId) {
      child.send({ kind: 'cancel', requestId } satisfies LocalLibraryScanWorkerRequest)
    },
    destroy() {
      child.kill()
    }
  }
}

async function waitForMessage<T extends LocalLibraryScanWorkerMessage>(
  child: ChildProcess,
  predicate: (message: LocalLibraryScanWorkerMessage) => message is T,
  timeoutMs?: number
): Promise<T>
async function waitForMessage(
  child: ChildProcess,
  predicate: (message: LocalLibraryScanWorkerMessage) => boolean,
  timeoutMs?: number
): Promise<LocalLibraryScanWorkerMessage>
async function waitForMessage(
  child: ChildProcess,
  predicate: (message: LocalLibraryScanWorkerMessage) => boolean,
  timeoutMs = WORKER_MESSAGE_TIMEOUT_MS
): Promise<LocalLibraryScanWorkerMessage> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('scan worker response timed out')), timeoutMs)
    const onMessage = (rawMessage: unknown): void => {
      const message = rawMessage as LocalLibraryScanWorkerMessage
      if (predicate(message)) finish(null, message)
    }
    const onExit = (code: number | null): void =>
      finish(new Error(`scan worker exited before responding (${code ?? 'unknown'})`))
    const finish = (error: Error | null, message?: LocalLibraryScanWorkerMessage): void => {
      clearTimeout(timeout)
      child.off('message', onMessage)
      child.off('exit', onExit)
      if (error) reject(error)
      else resolve(message!)
    }
    child.on('message', onMessage)
    child.on('exit', onExit)
  })
}

function createDocument(
  revision: number,
  root: string,
  tracks: Array<Record<string, unknown>>
): LocalMusicLibraryDocument {
  return { version: 2, revision, folders: [root], tracks, exclusions: [] }
}

function createTrack(id: string, filePath: string): Record<string, unknown> {
  return {
    id,
    title: id,
    artist: 'Test',
    album: 'Test',
    filePath,
    fileName: filePath.split(/[\\/]/).pop() ?? filePath,
    duration: 1,
    size: 1,
    cover: null,
    lyrics: null,
    source: 'local'
  }
}

function baseRequest(root: string): LocalLibraryWorkerScanRequest {
  return {
    mode: 'startup',
    roots: [root],
    knownIdentities: [],
    knownTrackPaths: [],
    excludedPaths: [],
    coverCacheDir: join(root, 'covers')
  }
}
