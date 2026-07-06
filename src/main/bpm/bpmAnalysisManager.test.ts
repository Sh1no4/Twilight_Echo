import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { BPM_ANALYSIS_ALGORITHM_VERSION, BpmAnalysisCache } from './bpmCache.ts'
import { BpmAnalysisManager } from './bpmAnalysisManager.ts'

test('BpmAnalysisManager skips remote URLs', async () => {
  const manager = new BpmAnalysisManager({
    cache: new BpmAnalysisCache(join(tmpdir(), `bpm-skip-${Date.now()}.json`)),
    analyzeFile: async () => {
      throw new Error('should not analyze remote URLs')
    }
  })

  const result = await manager.requestAnalysis({
    trackId: 'ncm:1',
    filePath: 'https://example.test/audio.flac',
    referenceBpm: 200
  })

  assert.equal(result.status, 'skipped')
})

test('BpmAnalysisManager deduplicates concurrent file analysis', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'twilight-bpm-manager-'))
  const filePath = join(dir, 'song.wav')
  await writeFile(filePath, 'fake', 'utf-8')
  let analyzeCount = 0
  const manager = new BpmAnalysisManager({
    cache: new BpmAnalysisCache(join(dir, 'bpm-analysis-cache.json')),
    analyzeFile: async () => {
      analyzeCount += 1
      return {
        bpm: 200,
        confidence: 0.9,
        source: 'analyzed',
        analyzedAt: '2026-01-01T00:00:00.000Z',
        algorithmVersion: BPM_ANALYSIS_ALGORITHM_VERSION
      }
    }
  })

  const [first, second] = await Promise.all([
    manager.requestAnalysis({ trackId: 'local:1', filePath }),
    manager.requestAnalysis({ trackId: 'local:1', filePath })
  ])

  assert.equal(first.status, 'completed')
  assert.equal(second.status, 'completed')
  assert.equal(analyzeCount, 1)
  await rm(dir, { recursive: true, force: true })
})

test('BpmAnalysisManager suppresses immediate retries after analysis failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'twilight-bpm-manager-fail-'))
  const filePath = join(dir, 'song.wav')
  await writeFile(filePath, 'fake', 'utf-8')
  let analyzeCount = 0
  const manager = new BpmAnalysisManager({
    cache: new BpmAnalysisCache(join(dir, 'bpm-analysis-cache.json')),
    failureCooldownMs: 60_000,
    now: () => 1000,
    analyzeFile: async () => {
      analyzeCount += 1
      throw new Error('decode failed')
    }
  })

  assert.equal((await manager.requestAnalysis({ trackId: 'local:1', filePath })).status, 'failed')
  assert.equal((await manager.requestAnalysis({ trackId: 'local:1', filePath })).status, 'skipped')
  assert.equal(analyzeCount, 1)
  await rm(dir, { recursive: true, force: true })
})
