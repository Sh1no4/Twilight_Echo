import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseArgs, runBenchmark } from './playback-queue-virtualization-benchmark.ts'

test('production queue benchmark rejects incomplete input', () => {
  assert.throws(() => parseArgs([]), /--output is required/)
  assert.throws(() => parseArgs(['--output', 'out.json', '--sizes', '0']), /positive integer/)
})

test('production Track snapshots strip heavy fields and keep first/middle/last windows bounded', () => {
  const root = mkdtempSync(join(tmpdir(), 'twilight-production-queue-benchmark-'))
  try {
    const result = runBenchmark({
      output: join(root, 'result.json'),
      sizes: [50, 200],
      iterations: 2,
      lyricsBytes: 256,
      tempoSegments: 4
    })
    for (const scenario of result.scenarios) {
      assert.ok(scenario.sourceHeavyBytes > 0)
      assert.equal(scenario.snapshotHeavyBytes, 0)
      assert.equal(scenario.windows.length, 3)
      assert.ok(scenario.windows.every((window) => window.rows <= scenario.limits.mountedRows))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
