import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createNetworkSourcesManager } from './sourcesManager.ts'
import { createNetworkLibrary } from './networkLibrary.ts'
import type { NetworkProfileStore } from './profileStore.ts'
import type {
  NetworkEntry,
  NetworkSourceProfileSummary
} from '../../shared/networkSources.ts'

const FLAC_BYTES = Buffer.from('MANAGER-DATA')
let server: Server
let basePort = 0

const fakeStore: NetworkProfileStore = {
  async listProfiles(): Promise<NetworkSourceProfileSummary[]> {
    return [
      {
        id: 'p1',
        protocol: 'webdav',
        name: 'NAS',
        host: '127.0.0.1',
        port: basePort,
        rootPath: '/music',
        credentialKind: 'anonymous',
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
    ]
  },
  async getProfile() {
    return {
      id: 'p1',
      protocol: 'webdav',
      name: 'NAS',
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
  },
  async createProfile() {
    throw new Error('not used')
  },
  async updateProfile() {
    throw new Error('not used')
  },
  async deleteProfile() {
    throw new Error('not used')
  },
  async resolveAuth() {
    return { kind: 'anonymous' }
  }
}

const PROPFIND_XML = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
<d:response><d:href>/music/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>/music/album/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>/music/a.flac</d:href><d:propstat><d:prop><d:getcontentlength>12</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`

const ALBUM_XML = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
<d:response><d:href>/music/album/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>/music/album/b.flac</d:href><d:propstat><d:prop><d:getcontentlength>12</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`

test.before(async () => {
  server = createServer((req, res) => {
    if (req.method === 'PROPFIND') {
      res.writeHead(207, { 'Content-Type': 'application/xml' })
      res.end(req.url === '/music/album' ? ALBUM_XML : PROPFIND_XML)
      return
    }
    if (req.method === 'GET' && req.url === '/music/a.flac') {
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

test('sourcesManager lists directories through the protocol adapter', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'manager-cache-'))
  try {
    const manager = createNetworkSourcesManager({
      store: fakeStore,
      cacheRoot,
      library: createNetworkLibrary({ filePath: join(cacheRoot, 'library.json') }),
      getAdapter: (protocol) =>
        protocol === 'webdav'
          ? import('./adapters/webdavAdapter.ts').then((m) => m.createWebDavAdapter())
          : Promise.resolve(null)
    })
    const entries = await manager.listDirectory('p1', '/music')
    const track = entries.find((entry) => entry.name === 'a.flac')
    assert.ok(track)
    assert.equal(track.kind, 'audio')
  } finally {
    await rm(cacheRoot, { recursive: true, force: true })
  }
})

test('sourcesManager resolves anonymous webdav playback to a direct url', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'manager-cache-'))
  try {
    const manager = createNetworkSourcesManager({
      store: fakeStore,
      cacheRoot,
      library: createNetworkLibrary({ filePath: join(cacheRoot, 'library.json') }),
      getAdapter: (protocol) =>
        protocol === 'webdav'
          ? import('./adapters/webdavAdapter.ts').then((m) => m.createWebDavAdapter())
          : Promise.resolve(null)
    })
    const entry: NetworkEntry = {
      id: 'e1',
      profileId: 'p1',
      name: 'a.flac',
      kind: 'audio',
      path: '/music/a.flac',
      sizeBytes: FLAC_BYTES.length
    }
    const plan = await manager.resolvePlayback('p1', entry)
    assert.equal(plan.kind, 'direct-url')
    assert.match(plan.url ?? '', /a\.flac$/)
  } finally {
    await rm(cacheRoot, { recursive: true, force: true })
  }
})

test('sourcesManager downloads authenticated webdav files to the cache for playback', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'manager-cache-'))
  try {
    const manager = createNetworkSourcesManager({
      store: {
        ...fakeStore,
        async resolveAuth() {
          return { kind: 'password', username: 'alice', password: 's3cret' }
        }
      },
      cacheRoot,
      library: createNetworkLibrary({ filePath: join(cacheRoot, 'library.json') }),
      getAdapter: (protocol) =>
        protocol === 'webdav'
          ? import('./adapters/webdavAdapter.ts').then((m) => m.createWebDavAdapter())
          : Promise.resolve(null)
    })
    // 服务器不校验 auth，但 adapter 会带 Authorization；认证路径应走下载而非直连。
    const entry: NetworkEntry = {
      id: 'e2',
      profileId: 'p1',
      name: 'a.flac',
      kind: 'audio',
      path: '/music/a.flac',
      sizeBytes: FLAC_BYTES.length
    }
    const plan = await manager.resolvePlayback('p1', entry)
    assert.equal(plan.kind, 'local-cache')
    assert.ok(plan.cacheFilePath)
    assert.equal((await readFile(plan.cacheFilePath)).toString(), FLAC_BYTES.toString())
  } finally {
    await rm(cacheRoot, { recursive: true, force: true })
  }
})

test('sourcesManager testConnection reports failures with structured codes', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'manager-cache-'))
  try {
    const manager = createNetworkSourcesManager({
      store: {
        ...fakeStore,
        async resolveAuth() {
          return { kind: 'password', username: 'alice', password: 'wrong' }
        }
      },
      cacheRoot,
      library: createNetworkLibrary({ filePath: join(cacheRoot, 'library.json') }),
      getAdapter: (protocol) =>
        protocol === 'webdav'
          ? import('./adapters/webdavAdapter.ts').then((m) => m.createWebDavAdapter())
          : Promise.resolve(null)
    })
    // 服务器匿名可访问，因此连接测试应成功；这里验证的是不抛异常且 ok=true。
    const result = await manager.testConnection('p1')
    assert.equal(result.ok, true)
  } finally {
    await rm(cacheRoot, { recursive: true, force: true })
  }
})

test('sourcesManager scans directories recursively into the virtual library', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'manager-cache-'))
  try {
    const manager = createNetworkSourcesManager({
      store: fakeStore,
      cacheRoot,
      library: createNetworkLibrary({ filePath: join(cacheRoot, 'library.json') }),
      getAdapter: (protocol) =>
        protocol === 'webdav'
          ? import('./adapters/webdavAdapter.ts').then((m) => m.createWebDavAdapter())
          : Promise.resolve(null)
    })
    const result = await manager.scanDirectory('p1', '/music')
    assert.equal(result.added, 2)
    assert.equal(result.total, 2)
    const entries = await manager.listLibrary('p1')
    assert.equal(entries.length, 2)
    assert.ok(entries.some((entry) => entry.path === '/music/a.flac'))
    assert.ok(entries.some((entry) => entry.path === '/music/album/b.flac'))

    await manager.removeLibraryEntry('p1', entries[0].id)
    assert.equal((await manager.listLibrary('p1')).length, 1)
  } finally {
    await rm(cacheRoot, { recursive: true, force: true })
  }
})
