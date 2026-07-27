'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { BUDGETS, assertRendererBudgets, parseArgs } = require('./verify-renderer-budgets.cjs')

test('renderer budgets validate chunks and reject oversized fonts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-renderer-budget-'))
  try {
    const assets = path.join(root, 'assets')
    fs.mkdirSync(assets, { recursive: true })
    fs.mkdirSync(path.join(root, '.vite'), { recursive: true })
    fs.writeFileSync(path.join(root, 'index.html'), '<div id="app"></div>')
    fs.writeFileSync(
      path.join(root, '.vite', 'manifest.json'),
      '{"index.html":{"file":"assets/app.js"}}'
    )
    fs.writeFileSync(path.join(assets, 'app.js'), Buffer.alloc(BUDGETS.jsChunk))
    fs.writeFileSync(path.join(assets, 'app.css'), Buffer.alloc(BUDGETS.cssChunk))
    assert.equal(assertRendererBudgets(root).fontBytes, 0)
    fs.mkdirSync(path.join(root, 'font', 'misans', 'full'), { recursive: true })
    fs.writeFileSync(path.join(root, 'font', 'misans', 'full', 'MiSans-Regular.woff2'), '')
    fs.writeFileSync(path.join(root, 'font', 'misans', 'full', 'misans-full.css'), '')
    fs.writeFileSync(path.join(root, 'font', 'misans', 'full', 'README.md'), '')
    assert.equal(assertRendererBudgets(root).fontBytes, 0)
    fs.writeFileSync(path.join(root, 'font.woff2'), Buffer.alloc(BUDGETS.fonts + 1))
    assert.throws(() => assertRendererBudgets(root), /fonts are/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('renderer budget verifier fails closed for missing entrypoint, manifest, JS, or CSS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-renderer-budget-missing-'))
  try {
    assert.throws(() => assertRendererBudgets(root), /entrypoint/)
    fs.writeFileSync(path.join(root, 'index.html'), '')
    assert.throws(() => assertRendererBudgets(root), /manifest/)
    fs.mkdirSync(path.join(root, '.vite'))
    fs.writeFileSync(path.join(root, '.vite', 'manifest.json'), '{}')
    assert.throws(() => assertRendererBudgets(root), /empty/)
    fs.writeFileSync(path.join(root, '.vite', 'manifest.json'), '{"index.html":{}}')
    assert.throws(() => assertRendererBudgets(root), /JavaScript/)
    fs.mkdirSync(path.join(root, 'assets'))
    fs.writeFileSync(path.join(root, 'assets', 'app.js'), '')
    assert.throws(() => assertRendererBudgets(root), /CSS/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('renderer budget arguments require a renderer directory', () => {
  assert.throws(() => parseArgs([]), /renderer-dir/)
})
