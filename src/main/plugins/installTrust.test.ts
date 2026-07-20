import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  bindFinalPluginPackageEvidence,
  buildPluginInstallConfirmationDetail,
  runFinalPluginPackageTrustBoundary
} from './installTrust.ts'
import type {
  TwilightPluginInstallEvidence,
  TwilightPluginManifest,
  TwilightPluginVerification
} from './types.ts'

const manifest: TwilightPluginManifest = {
  id: 'com.example.install-tool',
  name: 'Install Tool',
  version: '1.0.0',
  description: 'Install confirmation test',
  author: 'Example Publisher',
  license: 'Apache-2.0',
  type: ['tool'],
  main: 'index.mjs',
  engines: { twilightEcho: '>=0.20.0' },
  apiVersion: 1,
  permissions: ['network', 'filesystem:write']
}

const verification: TwilightPluginVerification = {
  level: 'publisher-signed',
  official: false,
  officialSource: true,
  indexClaimed: true,
  signatureStatus: 'valid',
  keyId: 'release-2026',
  publisher: 'Example Publisher',
  keyFingerprintSha256: 'f'.repeat(64),
  revalidateAt: '2027-01-01T00:00:00.000Z',
  reason: '签名有效，但当前条目来自缓存'
}

test('install confirmation exposes origin, cache, expiry, hash, signature, permissions, and code risk', () => {
  const evidence: TwilightPluginInstallEvidence = {
    sourceLabel: 'https://plugins.example/package.tep',
    indexSourceUrl: 'https://plugins.example/plugins.json',
    configuredIndexUrl: 'https://plugins.example/plugins.json',
    loadedFrom: 'cache',
    fetchedAt: '2026-07-15T08:00:00.000Z',
    expiresAt: '2026-07-16T08:00:00.000Z',
    stale: true,
    expired: true,
    originVerified: true,
    cacheFormat: 'envelope-v1',
    expectedPackageSha256: 'a'.repeat(64),
    packageSha256: 'a'.repeat(64),
    checksumVerified: true,
    manifestVerified: true,
    verification
  }

  const detail = buildPluginInstallConfirmationDetail(manifest, evidence)

  assert.match(detail, /索引来源：https:\/\/plugins\.example\/plugins\.json/)
  assert.match(detail, /缓存回退/)
  assert.match(detail, /stale\/回退，已过期，来源已绑定/)
  assert.match(detail, /envelope-v1/)
  assert.match(detail, new RegExp(`索引期望 SHA-256：${'a'.repeat(64)}`))
  assert.match(detail, new RegExp(`实际包 SHA-256：${'a'.repeat(64)}`))
  assert.match(detail, /发布者签名：签名有效/)
  assert.match(detail, new RegExp(`签名公钥 SHA-256 指纹：${'f'.repeat(64)}`))
  assert.match(detail, /权限：network, filesystem:write/)
  assert.match(detail, /插件可执行任意代码/)
  assert.match(detail, /签名和哈希只能验证来源与完整性，不能证明代码安全/)
})

test('local directory confirmation never invents checksum or signature verification', () => {
  const detail = buildPluginInstallConfirmationDetail(manifest, {
    sourceLabel: 'D:\\plugins\\install-tool',
    indexSourceUrl: null,
    configuredIndexUrl: null,
    loadedFrom: 'local',
    fetchedAt: null,
    expiresAt: null,
    stale: false,
    expired: false,
    originVerified: false,
    cacheFormat: null,
    expectedPackageSha256: null,
    packageSha256: null,
    checksumVerified: false,
    manifestVerified: true,
    verification: null
  })

  assert.match(detail, /索引期望 SHA-256：未提供/)
  assert.match(detail, /实际包 SHA-256：不适用（目录安装）/)
  assert.match(detail, /SHA-256 校验：未提供独立期望值/)
  assert.match(detail, /发布者签名：不适用（本地安装）/)
  assert.doesNotMatch(detail, /官方验证链完整/)
})

test('manager package boundary rejects A/B replacement before inspection or confirmation', async () => {
  const packageABytes = Buffer.from('package A bytes')
  const packageBBytes = Buffer.from('package B bytes')
  const packageA = createHash('sha256').update(packageABytes).digest('hex')
  const packageB = createHash('sha256').update(packageBBytes).digest('hex')
  const root = await mkdtemp(join(tmpdir(), 'twilight-install-boundary-'))
  const sourcePath = join(root, 'package-b.tep')
  const stagingRoot = join(root, 'staging')
  await writeFile(sourcePath, packageBBytes)
  await mkdir(stagingRoot)
  const evidence: TwilightPluginInstallEvidence = {
    sourceLabel: 'https://plugins.example/package.tep',
    indexSourceUrl: 'https://plugins.example/plugins.json',
    configuredIndexUrl: 'https://plugins.example/plugins.json',
    loadedFrom: 'remote',
    fetchedAt: '2026-07-16T08:00:00.000Z',
    expiresAt: '2026-07-17T08:00:00.000Z',
    stale: false,
    expired: false,
    originVerified: true,
    cacheFormat: null,
    expectedPackageSha256: packageA,
    packageSha256: packageA,
    checksumVerified: true,
    manifestVerified: true,
    verification
  }
  let inspected = false
  let confirmationRequested = false

  await assert.rejects(
    () =>
      runFinalPluginPackageTrustBoundary({
        sourcePath,
        stagingRoot,
        evidence,
        inspectStagedPackage: async () => {
          inspected = true
          return manifest
        },
        requestConfirmation: async () => {
          confirmationRequested = true
          return true
        }
      }),
    new RegExp(`expected ${packageA}, actual ${packageB}`)
  )
  assert.equal(inspected, false)
  assert.equal(confirmationRequested, false)
  await assert.rejects(() => access(join(stagingRoot, 'candidate.tep')))
})

test('expired trust evidence is rejected before the install modal opens', async () => {
  const packageBytes = Buffer.from('verified package bytes')
  const packageHash = createHash('sha256').update(packageBytes).digest('hex')
  const root = await mkdtemp(join(tmpdir(), 'twilight-install-expired-before-modal-'))
  const sourcePath = join(root, 'package.tep')
  const stagingRoot = join(root, 'staging')
  await writeFile(sourcePath, packageBytes)
  await mkdir(stagingRoot)
  let confirmationRequested = false

  await assert.rejects(
    () =>
      runFinalPluginPackageTrustBoundary({
        sourcePath,
        stagingRoot,
        evidence: indexedEvidence(packageHash),
        inspectStagedPackage: async () => manifest,
        requestConfirmation: async () => {
          confirmationRequested = true
          return true
        },
        now: () => new Date('2026-07-16T09:00:00.000Z')
      }),
    /打开安装确认前.*重新下载并验证/
  )
  assert.equal(confirmationRequested, false)
})

test('crossing a trust deadline while the modal is open rejects accepted stale evidence', async () => {
  const packageBytes = Buffer.from('verified deferred modal package bytes')
  const packageHash = createHash('sha256').update(packageBytes).digest('hex')
  const root = await mkdtemp(join(tmpdir(), 'twilight-install-expired-after-modal-'))
  const sourcePath = join(root, 'package.tep')
  const stagingRoot = join(root, 'staging')
  await writeFile(sourcePath, packageBytes)
  await mkdir(stagingRoot)
  let now = new Date('2026-07-16T08:00:00.000Z')
  let resolveConfirmation!: (accepted: boolean) => void
  let signalOpened!: () => void
  const opened = new Promise<void>((resolve) => {
    signalOpened = resolve
  })

  const pending = runFinalPluginPackageTrustBoundary({
    sourcePath,
    stagingRoot,
    evidence: indexedEvidence(packageHash),
    inspectStagedPackage: async () => manifest,
    requestConfirmation: async () => {
      signalOpened()
      return await new Promise<boolean>((resolve) => {
        resolveConfirmation = resolve
      })
    },
    now: () => now
  })
  await opened
  now = new Date('2026-07-16T09:00:00.000Z')
  resolveConfirmation(true)

  await assert.rejects(pending, /确认安装后.*重新下载并验证/)
})

test('final package boundary ignores claimed verification and derives it from actual staged bytes', () => {
  const packageHash = 'c'.repeat(64)
  const evidence: TwilightPluginInstallEvidence = {
    sourceLabel: 'https://plugins.example/package.tep',
    indexSourceUrl: 'https://plugins.example/plugins.json',
    configuredIndexUrl: 'https://plugins.example/plugins.json',
    loadedFrom: 'remote',
    fetchedAt: '2026-07-16T08:00:00.000Z',
    expiresAt: '2026-07-17T08:00:00.000Z',
    stale: false,
    expired: false,
    originVerified: true,
    cacheFormat: null,
    expectedPackageSha256: packageHash.toUpperCase(),
    packageSha256: 'd'.repeat(64),
    checksumVerified: false,
    manifestVerified: true,
    verification
  }

  const finalized = bindFinalPluginPackageEvidence(evidence, packageHash)

  assert.equal(finalized.expectedPackageSha256, packageHash)
  assert.equal(finalized.packageSha256, packageHash)
  assert.equal(finalized.checksumVerified, true)
})

test('index evidence cannot claim checksum verification without an immutable expected hash', () => {
  assert.throws(
    () =>
      bindFinalPluginPackageEvidence(
        {
          sourceLabel: 'https://plugins.example/package.tep',
          indexSourceUrl: 'https://plugins.example/plugins.json',
          configuredIndexUrl: 'https://plugins.example/plugins.json',
          loadedFrom: 'remote',
          fetchedAt: '2026-07-16T08:00:00.000Z',
          expiresAt: '2026-07-17T08:00:00.000Z',
          stale: false,
          expired: false,
          originVerified: true,
          cacheFormat: null,
          expectedPackageSha256: null,
          packageSha256: 'e'.repeat(64),
          checksumVerified: true,
          manifestVerified: true,
          verification
        },
        'e'.repeat(64)
      ),
    /缺少期望 SHA-256/
  )
})

function indexedEvidence(packageHash: string): TwilightPluginInstallEvidence {
  return {
    sourceLabel: 'https://plugins.example/package.tep',
    indexSourceUrl: 'https://plugins.example/plugins.json',
    configuredIndexUrl: 'https://plugins.example/plugins.json',
    loadedFrom: 'remote',
    fetchedAt: '2026-07-16T08:00:00.000Z',
    expiresAt: '2026-07-16T09:00:00.000Z',
    stale: false,
    expired: false,
    originVerified: true,
    cacheFormat: null,
    expectedPackageSha256: packageHash,
    packageSha256: packageHash,
    checksumVerified: true,
    manifestVerified: true,
    verification: {
      ...verification,
      level: 'official',
      official: true,
      revalidateAt: '2026-07-16T10:00:00.000Z'
    }
  }
}
