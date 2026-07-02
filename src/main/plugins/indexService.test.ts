import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import {
  DEFAULT_PLUGIN_INDEX_URL,
  PluginIndexService,
  resolvePluginIndexUrl
} from './indexService.ts'
import type { TwilightPluginDescriptor } from './types.ts'

const require = createRequire(import.meta.url)
const { createZip } = require('../../../packages/create-twilight-plugin/lib/zip.cjs') as {
  createZip: (root: string, outputFile: string) => Promise<{ fileCount: number; outputFile: string }>
}

const baseManifest = {
  id: 'com.example.index-tool',
  name: 'Index Tool',
  version: '1.0.0',
  description: 'A test index plugin',
  author: 'Example',
  license: 'Apache-2.0',
  type: ['tool'],
  main: 'index.mjs',
  engines: {
    twilightEcho: '>=0.20.0'
  },
  apiVersion: 1,
  permissions: ['player:observe']
}

test('loads a valid plugin index and describes install state', async () => {
  const fixture = await createIndexFixture()
  const service = new PluginIndexService({
    appVersion: '0.20.0',
    localIndexPath: fixture.indexPath
  })

  const entries = await service.list()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, baseManifest.id)
  assert.equal(
    service.describeInstallState(entries[0], []),
    'not-installed'
  )
  assert.equal(
    service.describeInstallState(entries[0], [descriptor({ version: '1.0.0' })]),
    'installed'
  )
  assert.equal(
    service.describeInstallState(entries[0], [descriptor({ version: '0.9.0' })]),
    'update-available'
  )
})

test('rejects invalid sourceUrl protocols and escaping paths', async () => {
  await assert.rejects(
    async () => {
      const fixture = await createIndexFixture({ sourceUrl: 'ftp://example.test/plugin.tep' })
      await new PluginIndexService({
        appVersion: '0.20.0',
        localIndexPath: fixture.indexPath
      }).list()
    },
    /sourceUrl/
  )

  await assert.rejects(
    async () => {
      const fixture = await createIndexFixture({ sourceUrl: '../outside.tep' })
      await new PluginIndexService({
        appVersion: '0.20.0',
        localIndexPath: fixture.indexPath
      }).list()
    },
    /索引目录外/
  )
})

test('rejects checksum mismatch during package download', async () => {
  const fixture = await createIndexFixture({ checksumSha256: '0'.repeat(64) })
  const service = new PluginIndexService({
    appVersion: '0.20.0',
    localIndexPath: fixture.indexPath
  })

  await assert.rejects(() => service.downloadPackage(baseManifest.id), /checksum/)
})

test('rejects index packages whose manifest does not match the index entry', async () => {
  const fixture = await createIndexFixture({
    manifest: {
      ...baseManifest,
      id: 'com.example.package-tool',
      name: 'Package Tool'
    },
    indexManifest: baseManifest
  })
  const service = new PluginIndexService({
    appVersion: '0.20.0',
    localIndexPath: fixture.indexPath
  })

  await assert.rejects(() => service.downloadPackage(baseManifest.id), /manifest/i)
})

test('blocks incompatible and bundled index plugins', async () => {
  const incompatible = await createIndexFixture({
    manifest: {
      ...baseManifest,
      id: 'com.example.future',
      engines: { twilightEcho: '>=9.0.0' }
    }
  })
  const service = new PluginIndexService({
    appVersion: '0.20.0',
    localIndexPath: incompatible.indexPath
  })
  const [entry] = await service.list()
  assert.equal(service.describeInstallState(entry, []), 'incompatible')
  await assert.rejects(() => service.downloadPackage(entry.id), /不兼容/)

  const bundled = await createIndexFixture({
    manifest: {
      ...baseManifest,
      id: 'com.twilightecho.provider.ncm',
      name: 'NCM'
    }
  })
  await assert.rejects(
    () =>
      new PluginIndexService({
        appVersion: '0.20.0',
        localIndexPath: bundled.indexPath,
        bundledPluginIds: ['com.twilightecho.provider.ncm']
      }).list(),
    /自带插件/
  )
})

test('downloads a valid package after checksum validation', async () => {
  const fixture = await createIndexFixture()
  const service = new PluginIndexService({
    appVersion: '0.20.0',
    localIndexPath: fixture.indexPath
  })
  const downloaded = await service.downloadPackage(baseManifest.id)
  try {
    assert.equal(downloaded.entry.id, baseManifest.id)
    assert.equal((await readFile(downloaded.packagePath)).byteLength > 0, true)
  } finally {
    await downloaded.cleanup()
  }
})

test('uses the default GitHub index URL unless an override is provided', () => {
  assert.equal(resolvePluginIndexUrl(undefined), DEFAULT_PLUGIN_INDEX_URL)
  assert.equal(resolvePluginIndexUrl('  '), DEFAULT_PLUGIN_INDEX_URL)
  assert.equal(resolvePluginIndexUrl('https://example.test/plugins.json'), 'https://example.test/plugins.json')
})

test('loads remote index, records source status, and writes cache', async () => {
  const fixture = await createIndexFixture()
  const cachePath = join(fixture.root, 'cache', 'plugins.json')
  const remoteUrl = 'https://raw.githubusercontent.com/asenyarzc-cpu/Twilight-Echo-plugins/main/plugins.json'
  const service = new PluginIndexService({
    appVersion: '0.20.0',
    localIndexPath: fixture.indexPath,
    remoteIndexUrl: remoteUrl,
    cacheIndexPath: cachePath,
    fetchImpl: createFetch({
      [remoteUrl]: await readFile(fixture.indexPath)
    })
  })

  const entries = await service.list()
  const cachedRaw = JSON.parse(await readFile(cachePath, 'utf-8')) as { plugins: unknown[] }

  assert.equal(entries[0].id, baseManifest.id)
  assert.equal(cachedRaw.plugins.length, 1)
  assert.deepEqual(service.getStatus(), {
    sourceUrl: remoteUrl,
    sourceKind: 'github',
    loadedFrom: 'remote',
    lastFetchedAt: service.getStatus().lastFetchedAt,
    stale: false,
    error: null
  })
  assert.match(service.getStatus().lastFetchedAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
})

test('falls back to cached remote index when refresh fails', async () => {
  const fixture = await createIndexFixture()
  const cachePath = join(fixture.root, 'cache', 'plugins.json')
  const remoteUrl = 'https://example.test/plugins.json'
  await mkdir(join(fixture.root, 'cache'), { recursive: true })
  await writeFile(cachePath, await readFile(fixture.indexPath), 'utf-8')
  const service = new PluginIndexService({
    appVersion: '0.20.0',
    localIndexPath: fixture.indexPath,
    remoteIndexUrl: remoteUrl,
    cacheIndexPath: cachePath,
    fetchImpl: async () => new Response('unavailable', { status: 503 })
  })

  const entries = await service.refresh()
  const status = service.getStatus()

  assert.equal(entries[0].id, baseManifest.id)
  assert.equal(status.sourceUrl, remoteUrl)
  assert.equal(status.sourceKind, 'custom')
  assert.equal(status.loadedFrom, 'cache')
  assert.equal(status.stale, true)
  assert.match(status.error ?? '', /HTTP 503/)
})

test('falls back to bundled index when remote and cache fail', async () => {
  const fixture = await createIndexFixture()
  const cachePath = join(fixture.root, 'missing', 'plugins.json')
  const remoteUrl = 'https://example.test/plugins.json'
  const service = new PluginIndexService({
    appVersion: '0.20.0',
    localIndexPath: fixture.indexPath,
    remoteIndexUrl: remoteUrl,
    cacheIndexPath: cachePath,
    fetchImpl: async () => {
      throw new Error('network down')
    }
  })

  const entries = await service.refresh()
  const status = service.getStatus()

  assert.equal(entries[0].id, baseManifest.id)
  assert.equal(status.loadedFrom, 'bundled')
  assert.equal(status.stale, true)
  assert.match(status.error ?? '', /network down/)
})

test('loads remote https indexes and resolves relative package URLs', async () => {
  const fixture = await createIndexFixture()
  const indexContent = await readFile(fixture.indexPath, 'utf-8')
  const packageBuffer = await readFile(fixture.packagePath)
  const requested: string[] = []
  const service = new PluginIndexService({
    appVersion: '0.20.0',
    localIndexPath: fixture.indexPath,
    remoteIndexUrl: 'https://example.test/plugins.json',
    fetchImpl: async (url) => {
      requested.push(String(url))
      return responseFor(String(url).endsWith('/plugins.json') ? indexContent : packageBuffer)
    }
  })

  const downloaded = await service.downloadPackage(baseManifest.id)
  try {
    assert.equal(downloaded.entry.id, baseManifest.id)
    assert.deepEqual(requested, [
      'https://example.test/plugins.json',
      `https://example.test/packages/${baseManifest.id}-${baseManifest.version}.tep`
    ])
  } finally {
    await downloaded.cleanup()
  }
})

test('allows localhost http indexes and rejects non-local http indexes', async () => {
  const fixture = await createIndexFixture()
  const indexContent = await readFile(fixture.indexPath, 'utf-8')
  const localhostService = new PluginIndexService({
    appVersion: '0.20.0',
    localIndexPath: fixture.indexPath,
    remoteIndexUrl: 'http://127.0.0.1/plugins.json',
    fetchImpl: async () => responseFor(indexContent)
  })
  assert.equal((await localhostService.list()).length, 1)

  const externalHttpService = new PluginIndexService({
    appVersion: '0.20.0',
    localIndexPath: fixture.indexPath,
    remoteIndexUrl: 'http://example.test/plugins.json',
    fetchImpl: async () => responseFor(indexContent)
  })
  await assert.rejects(() => externalHttpService.list(), /https|本机 http/)
})

test('bundled plugin index does not carry third-party tep packages', async () => {
  const pluginIndexRoot = new URL('../../../resources/plugin-index/', import.meta.url)
  const packageFiles = await listFiles(pluginIndexRoot)
  const tepFiles = packageFiles.filter((file) => extname(file).toLowerCase() === '.tep')

  assert.deepEqual(
    tepFiles,
    [],
    'third-party .tep packages belong in D:\\Twilight-Echo-plugins, not the app repository'
  )
})

async function createIndexFixture(options: {
  manifest?: typeof baseManifest
  indexManifest?: typeof baseManifest
  sourceUrl?: string
  checksumSha256?: string
} = {}): Promise<{ root: string; indexPath: string; packagePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'twilight-index-test-'))
  const packageRoot = join(root, 'plugin')
  const packageDir = join(root, 'packages')
  await mkdir(packageRoot, { recursive: true })
  await mkdir(packageDir, { recursive: true })
  const manifest = options.manifest ?? baseManifest
  const indexManifest = options.indexManifest ?? manifest
  await writeFile(join(packageRoot, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  await writeFile(join(packageRoot, 'index.mjs'), 'export function activate() {}', 'utf-8')
  const packageFileName = `${manifest.id}-${manifest.version}.tep`
  const packagePath = join(packageDir, packageFileName)
  await createZip(packageRoot, packagePath)
  const buffer = await readFile(packagePath)
  const checksumSha256 =
    options.checksumSha256 ?? createHash('sha256').update(buffer).digest('hex')
  const indexPath = join(root, 'plugins.json')
  await writeFile(
    indexPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        plugins: [
          {
            ...indexManifest,
            sourceUrl: options.sourceUrl ?? `packages/${packageFileName}`,
            checksumSha256,
            repository: 'https://example.test/repo',
            homepage: 'https://example.test/plugin',
            tags: ['test'],
            verified: true
          }
        ]
      },
      null,
      2
    ),
    'utf-8'
  )
  return { root, indexPath, packagePath }
}

function responseFor(body: string | Buffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => {
      const buffer = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    }
  } as Response
}

function descriptor(overrides: Partial<TwilightPluginDescriptor> = {}): TwilightPluginDescriptor {
  return {
    ...baseManifest,
    status: 'disabled',
    enabled: false,
    builtIn: false,
    error: null,
    isDsp: false,
    source: 'index',
    installedAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
    paths: {
      root: '',
      versionRoot: '',
      manifestPath: '',
      dataDir: '',
      logPath: ''
    },
    ...overrides
  } as TwilightPluginDescriptor
}

function createFetch(responses: Record<string, Buffer>): typeof fetch {
  return async (url) => {
    const key = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    const buffer = responses[key]
    if (!buffer) return new Response('not found', { status: 404 })
    return new Response(new Uint8Array(buffer))
  }
}

async function listFiles(root: URL): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, root)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(child)))
    } else {
      files.push(child.pathname)
    }
  }
  return files
}
