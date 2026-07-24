const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const {
  PRESETS,
  createStressLibraryDocument,
  createThemeGoldenCases,
  parseArgs,
  seedStressLibrary
} = require('./theme-visual-regression.cjs')

test('theme golden matrix covers 90 no-cover combinations and seven built-in presets', () => {
  const cases = createThemeGoldenCases()
  const matrix = cases.filter((entry) => entry.kind === 'matrix')
  const presets = cases.filter((entry) => entry.kind === 'preset')

  assert.equal(cases.length, 97)
  assert.equal(new Set(cases.map((entry) => entry.id)).size, 97)
  assert.equal(matrix.length, 2 * 3 * 5 * 3)
  assert.equal(presets.length, PRESETS.length)
  assert.deepEqual(new Set(matrix.map((entry) => entry.scale)), new Set([1, 1.25, 1.5]))
  assert.ok(cases.every((entry) => entry.id.endsWith('no-cover')))
})

test('theme visual stress fixture writes an isolated 10k schema-v2 library', () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-theme-visual-'))
  try {
    const file = seedStressLibrary(root)
    const document = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(document.version, 2)
    assert.equal(document.tracks.length, 10_000)
    assert.equal(document.tracks[0].cover, '')
    assert.equal(document.tracks.at(-1).id, 'local:p7-stress:9999')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('theme visual runner parses explicit CDP, output, baseline, and viewport options', () => {
  const options = parseArgs([
    '--port',
    '9333',
    '--output',
    'output/current',
    '--baseline',
    'output/baseline',
    '--width',
    '1200',
    '--height',
    '800'
  ])
  assert.equal(options.port, 9333)
  assert.equal(options.width, 1200)
  assert.equal(options.height, 800)
  assert.match(options.outputDir, /output[\\/]current$/)
  assert.match(options.baselineDir, /output[\\/]baseline$/)
  assert.equal(createStressLibraryDocument(3).tracks.length, 3)
  assert.equal(parseArgs(['--help']).help, true)
})
