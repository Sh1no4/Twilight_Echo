import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { PluginIndexService } from './indexService.ts'
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

async function createIndexFixture(options: {
  manifest?: typeof baseManifest
  sourceUrl?: string
  checksumSha256?: string
} = {}): Promise<{ root: string; indexPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'twilight-index-test-'))
  const packageRoot = join(root, 'plugin')
  const packageDir = join(root, 'packages')
  await mkdir(packageRoot, { recursive: true })
  await mkdir(packageDir, { recursive: true })
  const manifest = options.manifest ?? baseManifest
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
            ...manifest,
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
  return { root, indexPath }
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
