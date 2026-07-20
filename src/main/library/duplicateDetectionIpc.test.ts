import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDuplicateDetectionIpcHandlers } from './duplicateDetectionIpc.ts'

test('duplicate IPC only reads authorized library files and returns a serializable review result', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'twilight-duplicate-ipc-'))
  const exactA = join(directory, 'exact-a.wav')
  const exactB = join(directory, 'exact-b.wav')
  const metadataA = join(directory, 'metadata-a.wav')
  const metadataB = join(directory, 'metadata-b.wav')
  const exactBytes = Buffer.from('same audio bytes')
  const metadataBytesA = Buffer.from('same-size-A')
  const metadataBytesB = Buffer.from('same-size-B')
  const event = { sender: 'trusted-renderer' }
  try {
    writeFileSync(exactA, exactBytes)
    writeFileSync(exactB, exactBytes)
    writeFileSync(metadataA, metadataBytesA)
    writeFileSync(metadataB, metadataBytesB)
    const original = new Map(
      [exactA, exactB, metadataA, metadataB].map((filePath) => [filePath, readFileSync(filePath)])
    )
    const authorizedPaths = new Set(original.keys())
    const calls: string[] = []
    const handlers = createDuplicateDetectionIpcHandlers({
      assertTrustedSender: (actualEvent) => assert.equal(actualEvent, event),
      loadTracks: () => [
        track('exact-a', exactA, exactBytes.length, 180),
        track('exact-b', exactB, exactBytes.length, 181),
        track('metadata-a', metadataA, metadataBytesA.length, 240),
        track('metadata-b', metadataB, metadataBytesB.length, 240),
        { id: '', filePath: join(directory, 'ignored.wav') }
      ],
      authorizeAudioFile: async (filePath) => {
        calls.push(filePath)
        if (!authorizedPaths.has(filePath)) throw new Error('outside the authorized library')
        return filePath
      }
    })

    const result = await handlers.detect(event)
    assert.deepEqual(
      result.groups.map((group) => group.kind),
      ['contentHash', 'metadataCandidate']
    )
    assert.deepEqual(
      result.suggestions.map((suggestion) => suggestion.action),
      ['mergeSuggestion', 'mark']
    )
    assert.ok(result.suggestions.every((suggestion) => suggestion.keepId === null))
    assert.deepEqual(structuredClone(result), result)
    assert.equal(calls.length, 4)
    for (const [filePath, contents] of original) {
      assert.deepEqual(readFileSync(filePath), contents)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('duplicate IPC rejects an untrusted sender before loading library data', async () => {
  const handlers = createDuplicateDetectionIpcHandlers({
    assertTrustedSender: () => {
      throw new Error('unexpected renderer')
    },
    loadTracks: () => {
      assert.fail('untrusted requests must not load the library')
    },
    authorizeAudioFile: async () => {
      assert.fail('untrusted requests must not authorize a media path')
    }
  })

  await assert.rejects(() => handlers.detect({ sender: 'untrusted' }), /unexpected renderer/)
})

test('duplicate IPC hashes the resolved authorized file, never the renderer-supplied alias', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'twilight-duplicate-authorized-hash-'))
  const filePath = join(directory, 'actual.wav')
  const event = { sender: 'trusted-renderer' }
  try {
    writeFileSync(filePath, Buffer.from('same bytes for the authorized fixture'))
    const requestedPaths: string[] = []
    const hashedPaths: string[] = []
    const handlers = createDuplicateDetectionIpcHandlers({
      assertTrustedSender: (actualEvent) => assert.equal(actualEvent, event),
      loadTracks: () => [
        track('alias-a', 'E:/untrusted/alias-a.wav', 35, 120),
        track('alias-b', 'E:/untrusted/alias-b.wav', 35, 121)
      ],
      authorizeAudioFile: async (requestedPath) => {
        requestedPaths.push(requestedPath)
        return filePath
      },
      hashContent: async (authorizedPath) => {
        hashedPaths.push(authorizedPath)
        return await (await import('./duplicateDetection.ts')).contentHash(authorizedPath)
      }
    })

    const result = await handlers.detect(event)
    assert.deepEqual(
      result.groups.map((group) => group.kind),
      ['contentHash']
    )
    assert.deepEqual(requestedPaths, ['E:/untrusted/alias-a.wav', 'E:/untrusted/alias-b.wav'])
    assert.deepEqual(hashedPaths, [filePath, filePath])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function track(
  id: string,
  filePath: string,
  size: number,
  duration: number
): Record<string, unknown> {
  return {
    id,
    filePath,
    title: `Title ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    size,
    duration,
    sampleRate: 44_100,
    bitrate: 1_000,
    format: 'wav'
  }
}
