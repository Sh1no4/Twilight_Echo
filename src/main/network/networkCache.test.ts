import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { downloadEntryToCache } from './networkCache.ts'
import { createWebDavAdapter } from './adapters/webdavAdapter.ts'
import { buildNetworkEntryId } from './networkPath.ts'
import type { NetworkEntry, NetworkSourceProfile } from '../../shared/networkSources.ts'

const FLAC_BYTES = Buffer.from('FLAC-CACHE-DATA-0123456789')
let server: Server
let getCount = 0
let basePort = 0

function makeProfile(): NetworkSourceProfile {
  return {
    id: 'p1',
    protocol: 'webdav',
    name: 'Cache NAS',
    host: '127.0.0.1',
    port: basePort,
    rootPath: '/music',
    credential: { kind: 'anonymous', encryptedId: '' },
    options: {
      readOnly: true,
      connectTimeoutMs: 5_000,
      transferTimeoutMs: 10_000,
      maxConcurrentTransfers: 2
    },
    bookmarks: [],
    createdAt: 1,
    lastConnectedAt: null
  }
}

function makeEntry(path = '/music/a.flac', sizeBytes = FLAC_BYTES.length): NetworkEntry {
  return {
    id: buildNetworkEntryId('webdav', 'p1', path),
    profileId: 'p1',
    name: 'a.flac',
    kind: 'audio',
    path,
    sizeBytes
  }
}

test.before(async () => {
  server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/music/a.flac') {
      getCount += 1
      res.writeHead(200, { 'Content-Length': FLAC_BYTES.length })
      res.end(FLAC_BYTES)
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  basePort = (server.address() as { port: number }).port
})

test.after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  )
})

test('downloadEntryToCache streams a remote file into a hashed cache path once', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'network-cache-'))
  try {
    const session = await createWebDavAdapter().createSession(makeProfile(), { kind: 'anonymous' })
    const first = await downloadEntryToCache({ session, entry: makeEntry(), cacheRoot })
    assert.equal((await readFile(first)).toString(), FLAC_BYTES.toString())
    assert.match(first, /[0-9a-f]{64}\.flac$/)

    const second = await downloadEntryToCache({ session, entry: makeEntry(), cacheRoot })
    assert.equal(second, first)
    assert.equal(getCount, 1, '已缓存文件不应重复下载')
    await session.close()
  } finally {
    await rm(cacheRoot, { recursive: true, force: true })
  }
})

test('downloadEntryToCache re-downloads when size mismatches the cache', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'network-cache-'))
  const before = getCount
  try {
    const session = await createWebDavAdapter().createSession(makeProfile(), { kind: 'anonymous' })
    await downloadEntryToCache({ session, entry: makeEntry(), cacheRoot })
    const staleEntry = { ...makeEntry(), sizeBytes: 9999 }
    await downloadEntryToCache({ session, entry: staleEntry, cacheRoot })
    assert.equal(getCount, before + 2)
    await session.close()
  } finally {
    await rm(cacheRoot, { recursive: true, force: true })
  }
})
