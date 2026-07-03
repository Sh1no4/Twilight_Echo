const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const extract = require('extract-zip')
const { initCommand, packCommand } = require('../lib/cli.cjs')
const { validatePluginManifest } = require('../lib/manifest.cjs')

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'twilight-plugin-cli-'))
}

test('init creates a valid tool plugin scaffold', async () => {
  const root = await tempDir()
  const target = path.join(root, 'my-tool')
  await initCommand([target, '--type', 'tool', '--id', 'com.example.my-tool', '--name', 'My Tool'])

  const manifest = validatePluginManifest(
    JSON.parse(await fs.readFile(path.join(target, 'plugin.json'), 'utf-8'))
  )
  assert.equal(manifest.id, 'com.example.my-tool')
  assert.deepEqual(manifest.type, ['tool'])
  assert.equal(await exists(path.join(target, 'src', 'index.mts')), true)
  assert.match(await fs.readFile(path.join(target, 'package.json'), 'utf-8'), /create-twilight-plugin/)
})

test('init creates provider, ui-tool, and theme manifests', async () => {
  for (const type of ['provider', 'ui-tool', 'theme']) {
    const root = await tempDir()
    const target = path.join(root, type)
    await initCommand([target, '--type', type, '--id', `com.example.${type}`])
    const manifest = validatePluginManifest(
      JSON.parse(await fs.readFile(path.join(target, 'plugin.json'), 'utf-8'))
    )
    assert.equal(manifest.id, `com.example.${type}`)
    if (type === 'theme') {
      assert.equal(manifest.main, undefined)
      assert.equal(await exists(path.join(target, 'theme.css')), true)
      assert.equal(await exists(path.join(target, 'src', 'index.mts')), false)
      assert.equal(Array.isArray(manifest.contributes?.themes), true)
    }
  }
})

test('pack creates a tep for declarative theme plugins without a JS build', async () => {
  const root = await tempDir()
  const target = path.join(root, 'my-theme')
  await initCommand([target, '--type', 'theme', '--id', 'com.example.theme-pack'])

  const outDir = path.join(root, 'packed')
  const result = await packCommand([target, '--out', outDir])
  assert.equal(path.extname(result.outputFile), '.tep')

  const extracted = path.join(root, 'extracted-theme')
  await fs.mkdir(extracted, { recursive: true })
  await extract(result.outputFile, { dir: extracted })
  const manifest = JSON.parse(await fs.readFile(path.join(extracted, 'plugin.json'), 'utf-8'))
  assert.equal(manifest.main, undefined)
  assert.equal(await exists(path.join(extracted, 'theme.css')), true)
  assert.equal(await exists(path.join(extracted, 'src', 'index.mts')), false)
})

test('pack creates a tep with plugin.json at root and excludes node_modules', async () => {
  const root = await tempDir()
  const target = path.join(root, 'my-tool')
  await initCommand([target, '--type', 'tool', '--id', 'com.example.packable'])
  await fs.mkdir(path.join(target, 'dist'), { recursive: true })
  await fs.writeFile(path.join(target, 'dist', 'index.mjs'), 'export function activate() {}', 'utf-8')
  await fs.mkdir(path.join(target, 'node_modules', 'ignored'), { recursive: true })
  await fs.writeFile(path.join(target, 'node_modules', 'ignored', 'file.js'), 'ignored', 'utf-8')

  const outDir = path.join(root, 'packed')
  const result = await packCommand([target, '--out', outDir])
  assert.equal(path.extname(result.outputFile), '.tep')

  const extracted = path.join(root, 'extracted')
  await fs.mkdir(extracted, { recursive: true })
  await extract(result.outputFile, { dir: extracted })
  assert.equal(await exists(path.join(extracted, 'plugin.json')), true)
  assert.equal(await exists(path.join(extracted, 'node_modules')), false)
})

test('pack accepts flags before the plugin directory', async () => {
  const root = await tempDir()
  const target = path.join(root, 'my-tool')
  await initCommand([target, '--type', 'tool', '--id', 'com.example.flag-order'])
  await fs.mkdir(path.join(target, 'dist'), { recursive: true })
  await fs.writeFile(path.join(target, 'dist', 'index.mjs'), 'export function activate() {}', 'utf-8')

  const outDir = path.join(root, 'packed')
  const result = await packCommand(['--out', outDir, target])
  assert.match(result.outputFile, /com\.example\.flag-order-1\.0\.0\.tep$/)
  assert.equal(await exists(result.outputFile), true)
})

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
