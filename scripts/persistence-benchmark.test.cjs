'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { parseArgs, runBenchmark } = require('./persistence-benchmark.cjs')

test('argument parser rejects incomplete full benchmark invocation', () => {
  assert.throws(() => parseArgs([]), /--output is required/)
  assert.throws(() => parseArgs(['--output', 'out.json', '--iterations', '0']), /positive integer/)
})

test('benchmark verifies equivalent JSON and SQLite hydrated persistence documents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twilight-persistence-benchmark-test-'))
  const output = path.join(root, 'result.json')
  try {
    const result = runBenchmark({
      output,
      workDir: path.join(root, 'work'),
      sizes: [12],
      playlistCount: 3,
      playlistSize: 5,
      sessionSize: 30,
      statsSize: 10,
      iterations: 2
    })
    const scenario = result.scenarios[0]
    assert.equal(scenario.workload.localTracks, 12)
    assert.equal(scenario.json.metrics.parseLoad.samplesMs.length, 2)
    assert.equal(scenario.sqlite.metrics.parseLoad.samplesMs.length, 2)
    assert.equal(scenario.sqlite.metrics.serializeFull, null)
    assert.ok(scenario.json.primaryDiskBytes > 0)
    assert.ok(scenario.sqlite.primaryDiskBytes > 0)
    assert.match(scenario.sqlite.serializeFullNote, /seedFull/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
