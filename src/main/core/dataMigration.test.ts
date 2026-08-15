import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const { MIGRATION_MANIFEST_FILE } = await import(
  new URL('../../shared/dataMigration.ts', import.meta.url).href
)

const {
  MIGRATION_INVENTORY,
  MIGRATION_STAGING_SUFFIX,
  defaultMigrationFs,
  loadMigrationManifest,
  runDataMigration
} = await import(new URL('./dataMigration.ts', import.meta.url).href)

const { PORTABLE_DATA_DIR, PORTABLE_LAUNCH_FLAG, resolvePathPolicy } = await import(
  new URL('./pathPolicy.ts', import.meta.url).href
)

function makeTempRoot(t: test.TestContext, label: string): string {
  const root = mkdtempSync(join(tmpdir(), `twilight-${label}-`))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function standardPolicy(_t: test.TestContext, root: string) {
  return resolvePathPolicy({
    argv: [],
    exeDir: join(root, 'app'),
    standardUserData: root
  })
}

function portablePolicy(_t: test.TestContext, root: string, exeDir: string) {
  return resolvePathPolicy({
    argv: ['app.exe', PORTABLE_LAUNCH_FLAG],
    exeDir,
    standardUserData: root
  })
}

function dataDirFor(_policy: unknown, exeDir: string): string {
  return join(exeDir, PORTABLE_DATA_DIR)
}

test('standard mode reports not-needed and never writes a manifest', (t) => {
  const root = makeTempRoot(t, 'standard-noop')
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ theme: 'dark' }))

  const policy = standardPolicy(t, root)
  assert.equal(policy.mode, 'standard')

  const diagnostics = runDataMigration({ policy, legacyRoot: root })
  assert.equal(diagnostics.status, 'not-needed')
  assert.equal(diagnostics.mode, 'standard')
  assert.equal(diagnostics.manifestFile, null)
  assert.equal(diagnostics.copiedEntries, 0)
  assert.equal(diagnostics.migratedBytes, 0)
  assert.ok(!existsSync(join(root, MIGRATION_MANIFEST_FILE)), 'no manifest written')
})

test('fallback mode reports not-needed (legacy flat paths stay in place)', (t) => {
  const root = makeTempRoot(t, 'fallback-noop')
  const exeDir = join(root, 'app')
  writeFileSync(join(root, 'settings.json'), '{}')

  const policy = resolvePathPolicy({
    argv: ['app.exe', PORTABLE_LAUNCH_FLAG],
    exeDir,
    standardUserData: join(root, 'user-data'),
    probeWritable: () => false
  })
  assert.equal(policy.mode, 'fallback')

  const diagnostics = runDataMigration({ policy, legacyRoot: join(root, 'user-data') })
  assert.equal(diagnostics.status, 'not-needed')
  assert.equal(diagnostics.manifestFile, null)
})

test('portable full migration copies persistent data into categorized dirs', (t) => {
  const root = makeTempRoot(t, 'full')
  const exeDir = join(root, 'app')
  writeFileSync(join(root, 'settings.json'), '{"theme":"dark"}')
  writeFileSync(join(root, 'music-library.json'), '{"tracks":[]}')
  writeFileSync(join(root, 'plugin-state.json'), '{"enabled":[]}')
  mkdirSync(join(root, 'plugins', 'demo'), { recursive: true })
  writeFileSync(join(root, 'plugins', 'demo', 'index.js'), 'console.log(1)')
  mkdirSync(join(root, 'plugin-data', 'demo'), { recursive: true })
  writeFileSync(join(root, 'plugin-data', 'demo', 'cache.json'), '{}')

  const policy = portablePolicy(t, root, exeDir)
  assert.equal(policy.mode, 'portable')

  const diagnostics = runDataMigration({ policy, legacyRoot: root })
  assert.equal(diagnostics.status, 'completed')
  assert.equal(diagnostics.copiedEntries, 5)
  assert.equal(diagnostics.migratedBytes, 59)
  assert.equal(diagnostics.conflictEntries, 0)
  assert.equal(diagnostics.failedEntries, 0)
  assert.equal(diagnostics.manifestFile, join(root, MIGRATION_MANIFEST_FILE))

  const data = dataDirFor(policy, exeDir)
  assert.equal(readFileSync(join(data, 'config', 'settings.json'), 'utf8'), '{"theme":"dark"}')
  assert.equal(readFileSync(join(data, 'database', 'music-library.json'), 'utf8'), '{"tracks":[]}')
  assert.equal(readFileSync(join(data, 'plugins', 'plugin-state.json'), 'utf8'), '{"enabled":[]}')
  assert.equal(readFileSync(join(data, 'plugins', 'demo', 'index.js'), 'utf8'), 'console.log(1)')
  assert.equal(readFileSync(join(data, 'plugin-data', 'demo', 'cache.json'), 'utf8'), '{}')

  // 源数据原样保留（只读备份）。
  assert.equal(readFileSync(join(root, 'settings.json'), 'utf8'), '{"theme":"dark"}')

  // 暂存文件全部清理。
  const staging = join(data, 'config', 'settings.json') + MIGRATION_STAGING_SUFFIX
  assert.ok(!existsSync(staging), 'staging file cleaned up')

  const manifest = loadMigrationManifest(root, defaultMigrationFs())
  assert.ok(manifest)
  assert.equal(manifest.status, 'completed')
})

test('portable with empty legacy root reports not-needed and writes no manifest', (t) => {
  const root = makeTempRoot(t, 'empty')
  const exeDir = join(root, 'app')
  const policy = portablePolicy(t, root, exeDir)
  assert.equal(policy.mode, 'portable')

  const diagnostics = runDataMigration({ policy, legacyRoot: root })
  assert.equal(diagnostics.status, 'not-needed')
  assert.equal(diagnostics.manifestFile, null)
  assert.ok(!existsSync(join(root, MIGRATION_MANIFEST_FILE)))
})

test('discardable content (cache/logs) is skipped, not copied', (t) => {
  const root = makeTempRoot(t, 'discardable')
  const exeDir = join(root, 'app')
  writeFileSync(join(root, 'settings.json'), '{}')
  mkdirSync(join(root, 'music-cache'), { recursive: true })
  writeFileSync(join(root, 'music-cache', 'song.bin'), 'BINARY')
  mkdirSync(join(root, 'plugin-staging'), { recursive: true })
  writeFileSync(join(root, 'plugin-staging', 'pkg.zip'), 'ZIP')
  mkdirSync(join(root, 'logs'), { recursive: true })
  writeFileSync(join(root, 'logs', 'main.log'), 'LOG')

  const policy = portablePolicy(t, root, exeDir)
  const diagnostics = runDataMigration({ policy, legacyRoot: root })

  const data = dataDirFor(policy, exeDir)
  assert.ok(!existsSync(join(data, 'cache', 'music-cache', 'song.bin')))
  assert.ok(!existsSync(join(data, 'cache', 'plugin-staging', 'pkg.zip')))
  assert.ok(!existsSync(join(data, 'logs', 'main.log')))

  const manifest = loadMigrationManifest(root, defaultMigrationFs())
  assert.ok(manifest)
  const discardableEntries = manifest.entries.filter((entry) => entry.discardable)
  assert.ok(discardableEntries.length > 0)
  for (const entry of discardableEntries) {
    assert.equal(entry.status, 'skipped-discardable')
  }
  // 持久数据仍然迁移。
  assert.ok(existsSync(join(data, 'config', 'settings.json')))
  assert.equal(diagnostics.status, 'completed')
})

test('existing identical target is skipped (skipped-exists)', (t) => {
  const root = makeTempRoot(t, 'exists')
  const exeDir = join(root, 'app')
  writeFileSync(join(root, 'settings.json'), '{"a":1}')
  writeFileSync(join(root, 'music-library.json'), '{"b":2}')

  const policy = portablePolicy(t, root, exeDir)
  const data = dataDirFor(policy, exeDir)
  mkdirSync(join(data, 'config'), { recursive: true })
  writeFileSync(join(data, 'config', 'settings.json'), '{"a":1}')

  const diagnostics = runDataMigration({ policy, legacyRoot: root })
  assert.equal(diagnostics.status, 'completed')
  assert.equal(diagnostics.copiedEntries, 1) // 只有 music-library.json 真正复制
  assert.equal(diagnostics.migratedBytes, 7) // {"b":2}

  const manifest = loadMigrationManifest(root, defaultMigrationFs())
  assert.ok(manifest)
  const settings = manifest.entries.find((e) => e.sourceRelative === 'settings.json')
  assert.equal(settings?.status, 'skipped-exists')
  const library = manifest.entries.find((e) => e.sourceRelative === 'music-library.json')
  assert.equal(library?.status, 'copied')
})

test('differing existing target records a conflict and is never overwritten', (t) => {
  const root = makeTempRoot(t, 'conflict')
  const exeDir = join(root, 'app')
  const sourceContent = '{"version":2,"user":"echo"}'
  writeFileSync(join(root, 'settings.json'), sourceContent)

  const policy = portablePolicy(t, root, exeDir)
  const data = dataDirFor(policy, exeDir)
  mkdirSync(join(data, 'config'), { recursive: true })
  const targetContent = '{"version":1}'
  writeFileSync(join(data, 'config', 'settings.json'), targetContent)

  const diagnostics = runDataMigration({ policy, legacyRoot: root })
  assert.equal(diagnostics.status, 'completed')
  assert.equal(diagnostics.conflictEntries, 1)
  assert.equal(diagnostics.copiedEntries, 0)

  // 源与目标都不被改动。
  assert.equal(readFileSync(join(root, 'settings.json'), 'utf8'), sourceContent)
  assert.equal(readFileSync(join(data, 'config', 'settings.json'), 'utf8'), targetContent)

  const manifest = loadMigrationManifest(root, defaultMigrationFs())
  assert.ok(manifest)
  const settings = manifest.entries.find((e) => e.sourceRelative === 'settings.json')
  assert.equal(settings?.status, 'skipped-conflict')
  assert.equal(settings?.error, 'content-differs')
})

test('completed manifest makes rerun idempotent and leaves files untouched', (t) => {
  const root = makeTempRoot(t, 'idempotent')
  const exeDir = join(root, 'app')
  writeFileSync(join(root, 'settings.json'), '{"x":1}')

  const policy = portablePolicy(t, root, exeDir)
  const first = runDataMigration({ policy, legacyRoot: root })
  assert.equal(first.status, 'completed')
  assert.equal(first.copiedEntries, 1)

  const data = dataDirFor(policy, exeDir)
  const target = join(data, 'config', 'settings.json')
  // 完成后再改动目标，重跑不应恢复、不应覆盖。
  writeFileSync(target, '{"tampered":true}')

  const second = runDataMigration({ policy, legacyRoot: root })
  assert.equal(second.status, 'completed')
  assert.equal(second.copiedEntries, 1)
  assert.equal(readFileSync(target, 'utf8'), '{"tampered":true}')
})

test('pending manifest resumes: pre-landed identical files become skipped-exists', (t) => {
  const root = makeTempRoot(t, 'resume')
  const exeDir = join(root, 'app')
  writeFileSync(join(root, 'settings.json'), '{"a":1}')
  writeFileSync(join(root, 'music-library.json'), '{"b":2}')

  const policy = portablePolicy(t, root, exeDir)
  const data = dataDirFor(policy, exeDir)
  // 模拟中断前 settings.json 已落位。
  mkdirSync(join(data, 'config'), { recursive: true })
  writeFileSync(join(data, 'config', 'settings.json'), '{"a":1}')
  writeFileSync(
    join(root, MIGRATION_MANIFEST_FILE),
    JSON.stringify({
      schemaVersion: 1,
      engineVersion: 1,
      mode: 'portable',
      sourceRoot: root,
      status: 'pending',
      startedAt: '2026-08-15T00:00:00.000Z',
      entries: []
    })
  )

  const diagnostics = runDataMigration({ policy, legacyRoot: root })
  assert.equal(diagnostics.status, 'completed')

  const manifest = loadMigrationManifest(root, defaultMigrationFs())
  assert.ok(manifest)
  assert.equal(manifest.status, 'completed')
  const settings = manifest.entries.find((e) => e.sourceRelative === 'settings.json')
  assert.equal(settings?.status, 'skipped-exists')
  const library = manifest.entries.find((e) => e.sourceRelative === 'music-library.json')
  assert.equal(library?.status, 'copied')
})

test('copy failure produces a failed manifest with per-entry error', (t) => {
  const root = makeTempRoot(t, 'copyfail')
  const exeDir = join(root, 'app')
  writeFileSync(join(root, 'settings.json'), '{}')

  const policy = portablePolicy(t, root, exeDir)
  const fs = { ...defaultMigrationFs(), copyFile: () => false }

  const diagnostics = runDataMigration({ policy, legacyRoot: root, fs })
  assert.equal(diagnostics.status, 'failed')
  assert.ok(diagnostics.failedEntries >= 1)
  assert.match(diagnostics.failure ?? '', /entries failed/)

  const manifest = loadMigrationManifest(root, defaultMigrationFs())
  assert.ok(manifest)
  assert.equal(manifest.status, 'failed')
  const settings = manifest.entries.find((e) => e.sourceRelative === 'settings.json')
  assert.equal(settings?.status, 'failed')
  assert.equal(settings?.error, 'copy-failed')
})

test('unicode and space paths migrate correctly', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'twilight 数据-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const exeDir = join(root, '便携 应用')
  const legacyRoot = join(root, '用户 数据')
  mkdirSync(legacyRoot, { recursive: true })
  writeFileSync(join(legacyRoot, 'settings.json'), '{"语言":"中文"}')
  mkdirSync(join(legacyRoot, 'plugins', '插件 空间'), { recursive: true })
  writeFileSync(join(legacyRoot, 'plugins', '插件 空间', '内容 文件.json'), '{}')

  const policy = resolvePathPolicy({
    argv: ['app.exe', PORTABLE_LAUNCH_FLAG],
    exeDir,
    standardUserData: legacyRoot
  })
  assert.equal(policy.mode, 'portable')

  const diagnostics = runDataMigration({ policy, legacyRoot })
  assert.equal(diagnostics.status, 'completed')

  const data = dataDirFor(policy, exeDir)
  assert.equal(readFileSync(join(data, 'config', 'settings.json'), 'utf8'), '{"语言":"中文"}')
  assert.equal(readFileSync(join(data, 'plugins', '插件 空间', '内容 文件.json'), 'utf8'), '{}')
})

test('directory expansion skips symlinks and nested dirs are flattened per-file', (t) => {
  const root = makeTempRoot(t, 'symlink')
  const exeDir = join(root, 'app')
  writeFileSync(join(root, 'settings.json'), '{}')
  mkdirSync(join(root, 'plugins', 'nested', 'deep'), { recursive: true })
  writeFileSync(join(root, 'plugins', 'nested', 'a.js'), 'a')
  writeFileSync(join(root, 'plugins', 'nested', 'deep', 'b.json'), 'b')

  const policy = portablePolicy(t, root, exeDir)
  const symlinkPath = join(root, 'plugins', 'nested', 'link.js')
  const fs = {
    ...defaultMigrationFs(),
    stat: (path: string) => {
      if (path === symlinkPath) return { kind: 'symlink' as const }
      return defaultMigrationFs().stat(path)
    }
  }

  const diagnostics = runDataMigration({ policy, legacyRoot: root, fs })
  assert.equal(diagnostics.status, 'completed')

  const data = dataDirFor(policy, exeDir)
  assert.equal(readFileSync(join(data, 'plugins', 'nested', 'a.js'), 'utf8'), 'a')
  assert.equal(readFileSync(join(data, 'plugins', 'nested', 'deep', 'b.json'), 'utf8'), 'b')
  assert.ok(!existsSync(join(data, 'plugins', 'nested', 'link.js')), 'symlink not copied')
})

test('maxEntries cap marks overflow entries as too-many-entries', (t) => {
  const root = makeTempRoot(t, 'cap')
  const exeDir = join(root, 'app')
  writeFileSync(join(root, 'settings.json'), '{}')
  const policy = portablePolicy(t, root, exeDir)

  const diagnostics = runDataMigration({ policy, legacyRoot: root, maxEntries: 0 })
  assert.equal(diagnostics.status, 'failed')
  const manifest = loadMigrationManifest(root, defaultMigrationFs())
  assert.ok(manifest)
  assert.ok(manifest.entries.some((entry) => entry.error === 'too-many-entries'))
})

test('dataMigration module stays free of electron imports (pure/injectable contract)', async () => {
  const source = await readFile(new URL('./dataMigration.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from ['"]electron['"]/)
  assert.doesNotMatch(source, /require\(['"]electron['"]\)/)
  assert.match(source, /export function runDataMigration/)
})

test('migration inventory covers the persistent legacy data set', () => {
  const legacyRelatives = MIGRATION_INVENTORY.map((item) => item.legacyRelative)
  for (const expected of [
    'settings.json',
    'music-library.json',
    'ncm-cookie.json',
    'playback-session.json',
    'playlists.json',
    'lyrics-management.json',
    'playback-bookmarks.json',
    'themes.json',
    'tag-backups',
    'theme-assets',
    'plugin-state.json',
    'plugins',
    'plugin-data'
  ]) {
    assert.ok(legacyRelatives.includes(expected), `inventory includes ${expected}`)
  }
})

test('startup lifecycle wires migration before data reads and records diagnostics', async () => {
  const source = await readFile(new URL('../app/lifecycle.ts', import.meta.url), 'utf8')
  assert.match(source, /import \{ runDataMigration \} from '\.\.\/core\/dataMigration\.ts'/)
  assert.match(source, /setDataMigrationDiagnostics\(/)
  assert.match(source, /runDataMigration\(\{[\s\S]*policy: runtime\.pathPolicy/)
  assert.match(source, /legacyRoot: runtime\.pathPolicy\.standardRoot/)
  const migrationLine = source.indexOf('runDataMigration')
  const setupDataIpcLine = source.indexOf('setupDataIpc()')
  assert.ok(migrationLine !== -1 && setupDataIpcLine !== -1)
  assert.ok(migrationLine < setupDataIpcLine, 'migration runs before setupDataIpc (data reads)')
})

test('settings snapshot exposes migration diagnostics alongside data root', async () => {
  const settingsSource = await readFile(new URL('./settings.ts', import.meta.url), 'utf8')
  assert.match(settingsSource, /export function setDataMigrationDiagnostics/)
  assert.match(settingsSource, /migration: dataMigrationDiagnostics/)
  const typesSource = await readFile(new URL('./types.ts', import.meta.url), 'utf8')
  assert.match(typesSource, /migration: DataMigrationDiagnostics \| null/)
})
