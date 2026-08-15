import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const {
  PORTABLE_DATA_DIR,
  PORTABLE_LAUNCH_FLAG,
  PORTABLE_MARKER_FILE,
  defaultHasFile,
  defaultProbeWritable,
  detectPortableRequest,
  getCategorizedDataPath,
  isPortableMode,
  resolvePathPolicy
} = await import(new URL('./pathPolicy.ts', import.meta.url).href)

const { DATA_ROOT_CATEGORIES } = await import(
  new URL('../../shared/pathPolicy.ts', import.meta.url).href
)

function makeTempRoot(t: test.TestContext, label: string): string {
  const root = mkdtempSync(join(tmpdir(), `twilight-${label}-`))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('standard: no portable signal resolves to standardRoot with category dirs', (t) => {
  const standardRoot = makeTempRoot(t, 'standard')
  const policy = resolvePathPolicy({
    argv: [],
    exeDir: join(standardRoot, 'app'),
    standardUserData: standardRoot
  })

  assert.equal(policy.mode, 'standard')
  assert.equal(policy.portableRequested, false)
  assert.equal(policy.detectionSource, 'none')
  assert.equal(policy.dataRoot, standardRoot)
  assert.equal(policy.standardRoot, standardRoot)
  assert.equal(policy.fallbackReason, null)
  assert.equal(policy.writable, true)
  for (const category of DATA_ROOT_CATEGORIES) {
    assert.equal(policy.categories[category], join(standardRoot, category))
    assert.equal(policy.writableCategories[category], true)
    assert.ok(existsSync(policy.categories[category]), `category dir created: ${category}`)
  }
})

test('standard: normal install into Program Files-like dir is not portable', (t) => {
  const standardRoot = makeTempRoot(t, 'progfiles')
  const exeDir = join(standardRoot, 'Twilight Echo')
  const policy = resolvePathPolicy({
    argv: ['C:\\Program Files\\Twilight Echo\\Twilight Echo.exe'],
    exeDir,
    standardUserData: join(standardRoot, 'user-data')
  })
  assert.equal(policy.mode, 'standard')
})

test('portable: launch arg --portable enables portable mode', (t) => {
  const standardRoot = makeTempRoot(t, 'arg')
  const exeDir = join(standardRoot, 'app')
  const policy = resolvePathPolicy({
    argv: ['app.exe', PORTABLE_LAUNCH_FLAG],
    exeDir,
    standardUserData: join(standardRoot, 'user-data')
  })
  assert.equal(policy.mode, 'portable')
  assert.equal(policy.detectionSource, 'launch-arg')
  assert.equal(policy.dataRoot, join(exeDir, PORTABLE_DATA_DIR))
  for (const category of DATA_ROOT_CATEGORIES) {
    assert.equal(policy.categories[category], join(exeDir, PORTABLE_DATA_DIR, category))
    assert.ok(existsSync(policy.categories[category]))
  }
})

test('portable: .portable marker file next to exe enables portable mode', (t) => {
  const standardRoot = makeTempRoot(t, 'marker')
  const exeDir = join(standardRoot, 'app')
  mkdirSync(exeDir, { recursive: true })
  writeFileSync(join(exeDir, PORTABLE_MARKER_FILE), '')
  const policy = resolvePathPolicy({
    argv: [],
    exeDir,
    standardUserData: join(standardRoot, 'user-data')
  })
  assert.equal(policy.mode, 'portable')
  assert.equal(policy.detectionSource, 'marker-file')
})

test('portable: existing data/ dir next to exe enables portable mode', (t) => {
  const standardRoot = makeTempRoot(t, 'markerdir')
  const exeDir = join(standardRoot, 'app')
  mkdirSync(join(exeDir, PORTABLE_DATA_DIR), { recursive: true })
  const policy = resolvePathPolicy({
    argv: [],
    exeDir,
    standardUserData: join(standardRoot, 'user-data')
  })
  assert.equal(policy.mode, 'portable')
  assert.equal(policy.detectionSource, 'marker-directory')
})

test('portable: explicit build form wins over every other signal', (t) => {
  const standardRoot = makeTempRoot(t, 'explicit')
  const exeDir = join(standardRoot, 'app')
  mkdirSync(exeDir, { recursive: true })
  writeFileSync(join(exeDir, PORTABLE_MARKER_FILE), '')
  const policy = resolvePathPolicy({
    argv: ['app.exe', PORTABLE_LAUNCH_FLAG],
    exeDir,
    standardUserData: join(standardRoot, 'user-data'),
    forcePortable: true
  })
  assert.equal(policy.mode, 'portable')
  assert.equal(policy.detectionSource, 'explicit-build')
})

test('detection precedence: launch arg beats marker-file, marker-file beats marker-directory', (t) => {
  const root = makeTempRoot(t, 'precedence')
  const exeDir = join(root, 'app')
  mkdirSync(exeDir, { recursive: true })
  writeFileSync(join(exeDir, PORTABLE_MARKER_FILE), '')
  mkdirSync(join(exeDir, PORTABLE_DATA_DIR), { recursive: true })

  assert.equal(
    detectPortableRequest({
      argv: ['app.exe', PORTABLE_LAUNCH_FLAG],
      exeDir,
      standardUserData: root
    }).source,
    'launch-arg'
  )
  assert.equal(
    detectPortableRequest({ argv: [], exeDir, standardUserData: root }).source,
    'marker-file'
  )
})

test('fallback: unwritable portable data dir falls back to standard and records reason', (t) => {
  const standardRoot = makeTempRoot(t, 'fallback')
  const exeDir = join(standardRoot, 'app')
  const portableDataRoot = join(exeDir, PORTABLE_DATA_DIR)
  const policy = resolvePathPolicy({
    argv: ['app.exe', PORTABLE_LAUNCH_FLAG],
    exeDir,
    standardUserData: join(standardRoot, 'user-data'),
    probeWritable: (dir) => !dir.startsWith(portableDataRoot)
  })
  assert.equal(policy.mode, 'fallback')
  assert.equal(policy.portableRequested, true)
  assert.equal(policy.detectionSource, 'launch-arg')
  assert.equal(policy.fallbackReason, 'data-dir-not-writable')
  assert.equal(policy.dataRoot, join(standardRoot, 'user-data'))
  for (const category of DATA_ROOT_CATEGORIES) {
    assert.equal(policy.categories[category], join(standardRoot, 'user-data', category))
  }
})

test('fallback: portable root writable but a category is not -> category-not-writable', (t) => {
  const standardRoot = makeTempRoot(t, 'catfallback')
  const exeDir = join(standardRoot, 'app')
  const portableDataRoot = join(exeDir, PORTABLE_DATA_DIR)
  const policy = resolvePathPolicy({
    argv: ['app.exe', PORTABLE_LAUNCH_FLAG],
    exeDir,
    standardUserData: join(standardRoot, 'user-data'),
    probeWritable: (dir) => !dir.startsWith(join(portableDataRoot, 'logs'))
  })
  assert.equal(policy.mode, 'fallback')
  assert.equal(policy.fallbackReason, 'category-not-writable')
  assert.equal(policy.dataRoot, join(standardRoot, 'user-data'))
})

test('fallback: portable requested but exe dir unresolvable', (t) => {
  const standardRoot = makeTempRoot(t, 'noexe')
  const policy = resolvePathPolicy({
    argv: ['app.exe', PORTABLE_LAUNCH_FLAG],
    exeDir: null,
    standardUserData: join(standardRoot, 'user-data')
  })
  assert.equal(policy.mode, 'fallback')
  assert.equal(policy.fallbackReason, 'exe-dir-unresolvable')
  assert.equal(policy.detectionSource, 'launch-arg')
  assert.equal(policy.dataRoot, join(standardRoot, 'user-data'))
})

test('unicode and space paths resolve and create category dirs on disk', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'twilight 数据 根-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const standardUserData = join(root, '用户 数据')
  const exeDir = join(root, '便携 应用')
  const policy = resolvePathPolicy({
    argv: ['app.exe', PORTABLE_LAUNCH_FLAG],
    exeDir,
    standardUserData
  })
  assert.equal(policy.mode, 'portable')
  assert.equal(policy.dataRoot, join(exeDir, PORTABLE_DATA_DIR))
  for (const category of DATA_ROOT_CATEGORIES) {
    const dir = join(exeDir, PORTABLE_DATA_DIR, category)
    assert.equal(policy.categories[category], dir)
    assert.ok(existsSync(dir), `created: ${dir}`)
  }
})

test('getCategorizedDataPath: standard stays flat, portable goes to category dir', (t) => {
  const standardRoot = makeTempRoot(t, 'routing')
  const exeDir = join(standardRoot, 'app')

  const standard = resolvePathPolicy({ argv: [], exeDir, standardUserData: standardRoot })
  assert.equal(
    getCategorizedDataPath(standard, 'database', 'music-library.json'),
    join(standardRoot, 'music-library.json')
  )
  assert.equal(
    getCategorizedDataPath(standard, 'config', 'settings.json'),
    join(standardRoot, 'settings.json')
  )
  assert.equal(
    getCategorizedDataPath(standard, 'cache', 'music-cache'),
    join(standardRoot, 'music-cache')
  )
  assert.equal(isPortableMode(standard), false)

  const portable = resolvePathPolicy({
    argv: [PORTABLE_LAUNCH_FLAG],
    exeDir,
    standardUserData: standardRoot
  })
  assert.equal(
    getCategorizedDataPath(portable, 'database', 'music-library.json'),
    join(exeDir, PORTABLE_DATA_DIR, 'database', 'music-library.json')
  )
  assert.equal(
    getCategorizedDataPath(portable, 'config', 'settings.json'),
    join(exeDir, PORTABLE_DATA_DIR, 'config', 'settings.json')
  )
  assert.equal(
    getCategorizedDataPath(portable, 'cache', 'music-cache'),
    join(exeDir, PORTABLE_DATA_DIR, 'cache', 'music-cache')
  )
  assert.equal(
    getCategorizedDataPath(portable, 'database', 'opra', 'database_v1.jsonl'),
    join(exeDir, PORTABLE_DATA_DIR, 'database', 'opra', 'database_v1.jsonl')
  )
  assert.equal(isPortableMode(portable), true)
})

test('fallback mode routes paths flat like standard', (t) => {
  const standardRoot = makeTempRoot(t, 'fallbackrouting')
  const exeDir = join(standardRoot, 'app')
  const fallback = resolvePathPolicy({
    argv: [PORTABLE_LAUNCH_FLAG],
    exeDir,
    standardUserData: join(standardRoot, 'user-data'),
    probeWritable: () => false
  })
  assert.equal(fallback.mode, 'fallback')
  assert.equal(
    getCategorizedDataPath(fallback, 'config', 'settings.json'),
    join(standardRoot, 'user-data', 'settings.json')
  )
})

test('defaultProbeWritable succeeds on a writable temp dir and defaultHasFile matches markers', (t) => {
  const root = makeTempRoot(t, 'probe')
  assert.equal(defaultProbeWritable(root), true)
  const marker = join(root, PORTABLE_MARKER_FILE)
  writeFileSync(marker, '')
  assert.equal(defaultHasFile(marker), true)
})

test('pathPolicy module stays free of electron imports (pure/injectable contract)', async () => {
  const source = await readFile(new URL('./pathPolicy.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from ['"]electron['"]/)
  assert.doesNotMatch(source, /require\(['"]electron['"]\)/)
  assert.match(source, /export function resolvePathPolicy/)
})
