import assert from 'node:assert/strict'
import { chmod, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { flushFileToDisk, orderDownloadRoots, selectDownloadTargetRoot } from './downloadTargets.ts'

async function withTempDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'te-download-targets-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('flushing a finished part file succeeds on Windows read-only-handle semantics', async () => {
  await withTempDir(async (directory) => {
    const partFile = join(directory, 'track.m4a.part')
    await writeFile(partFile, 'payload')

    // Regression: the flush used to open the part file with 'r'. Windows maps fsync
    // to FlushFileBuffers, which rejects a handle without write access, so every
    // completed download failed with `EPERM: operation not permitted, fsync`.
    await flushFileToDisk(partFile)

    assert.equal(await readFile(partFile, 'utf8'), 'payload')
    const handle = await open(partFile, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  })
})

test('a filesystem that refuses to flush does not discard a verified download', async () => {
  await withTempDir(async (directory) => {
    const partFile = join(directory, 'readonly.m4a.part')
    await writeFile(partFile, 'payload')
    await chmod(partFile, 0o444)

    // Read-only files cannot be opened 'r+' on Windows; the payload is already
    // written and size-verified, so the missing durability barrier is tolerated.
    await flushFileToDisk(partFile)

    assert.equal(await readFile(partFile, 'utf8'), 'payload')
    await chmod(partFile, 0o644)
  })
})

test('a missing part file still surfaces as a real failure', async () => {
  await withTempDir(async (directory) => {
    await assert.rejects(() => flushFileToDisk(join(directory, 'absent.part')), /ENOENT/)
  })
})

test('the configured download directory outranks the music library', () => {
  assert.deepEqual(orderDownloadRoots('/downloads', ['/music', '/archive']), [
    '/downloads',
    '/music',
    '/archive'
  ])
})

test('an unset download directory falls back to the music library order', () => {
  assert.deepEqual(orderDownloadRoots(null, ['/music', '/archive']), ['/music', '/archive'])
  assert.deepEqual(orderDownloadRoots('   ', ['/music']), ['/music'])
})

test('a download directory that is also a library root stays a single candidate', () => {
  assert.deepEqual(orderDownloadRoots('/music', ['/music', '/archive']), ['/music', '/archive'])
})

test('download target selection defaults to the highest-priority root', () => {
  assert.equal(selectDownloadTargetRoot(undefined, ['/downloads', '/music']), '/downloads')
  assert.equal(selectDownloadTargetRoot('', ['/downloads', '/music']), '/downloads')
})

test('an explicit target root must match an authorized root', () => {
  assert.equal(selectDownloadTargetRoot('/music', ['/downloads', '/music']), '/music')
  assert.throws(
    () => selectDownloadTargetRoot('/elsewhere', ['/downloads', '/music']),
    /已授权的下载目录或本地音乐库根目录/
  )
})

test('downloads without any authorized root ask the user to configure one', () => {
  assert.throws(() => selectDownloadTargetRoot(undefined, []), /请先在设置中选择下载目录/)
})
