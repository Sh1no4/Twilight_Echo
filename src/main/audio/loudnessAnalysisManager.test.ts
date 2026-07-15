import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { LOUDNESS_ANALYSIS_ALGORITHM_VERSION, LoudnessAnalysisCache } from './loudnessCache.ts'
import { LoudnessAnalysisManager } from './loudnessAnalysisManager.ts'

test('LoudnessAnalysisManager skips remote URLs', async () => {
  const manager = new LoudnessAnalysisManager({
    cache: new LoudnessAnalysisCache(join(tmpdir(), `loudness-skip-${Date.now()}.json`)),
    analyzeFile: async () => {
      throw new Error('should not analyze remote URLs')
    }
  })

  const result = await manager.requestAnalysis({
    trackId: 'ncm:1',
    filePath: 'https://example.test/audio.flac'
  })

  assert.equal(result.status, 'skipped')
})

test('LoudnessAnalysisManager deduplicates concurrent file analysis', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'twilight-loudness-manager-'))
  const filePath = join(dir, 'song.wav')
  await writeFile(filePath, 'fake', 'utf-8')
  let analyzeCount = 0
  const manager = new LoudnessAnalysisManager({
    cache: new LoudnessAnalysisCache(join(dir, 'loudness-analysis-cache.json')),
    analyzeFile: async () => {
      analyzeCount += 1
      return {
        integratedLufs: -16,
        truePeakDb: -1.5,
        source: 'analyzed',
        analyzedAt: '2026-01-01T00:00:00.000Z',
        algorithmVersion: LOUDNESS_ANALYSIS_ALGORITHM_VERSION
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
  assert.equal((await manager.requestAnalysis({ trackId: 'local:1', filePath })).status, 'cached')
  assert.equal(analyzeCount, 1)
  await rm(dir, { recursive: true, force: true })
})

test('LoudnessAnalysisManager suppresses immediate retries after analysis failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'twilight-loudness-manager-fail-'))
  const filePath = join(dir, 'song.wav')
  await writeFile(filePath, 'fake', 'utf-8')
  let analyzeCount = 0
  const manager = new LoudnessAnalysisManager({
    cache: new LoudnessAnalysisCache(join(dir, 'loudness-analysis-cache.json')),
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

test('LoudnessAnalysisManager.peekCached returns cache hits without re-analyzing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'twilight-loudness-peek-'))
  const filePath = join(dir, 'song.wav')
  await writeFile(filePath, 'fake', 'utf-8')
  let analyzeCount = 0
  const manager = new LoudnessAnalysisManager({
    cache: new LoudnessAnalysisCache(join(dir, 'loudness-analysis-cache.json')),
    analyzeFile: async () => {
      analyzeCount += 1
      return {
        integratedLufs: -20,
        truePeakDb: -3,
        source: 'analyzed',
        analyzedAt: '2026-01-01T00:00:00.000Z',
        algorithmVersion: LOUDNESS_ANALYSIS_ALGORITHM_VERSION
      }
    }
  })

  assert.equal(await manager.peekCached({ trackId: 'local:1', filePath }), null)
  assert.equal((await manager.requestAnalysis({ trackId: 'local:1', filePath })).status, 'completed')
  const cached = await manager.peekCached({ trackId: 'local:1', filePath })
  assert.equal(cached?.integratedLufs, -20)
  assert.equal(analyzeCount, 1)
  await rm(dir, { recursive: true, force: true })
})


test('LoudnessAnalysisManager.cancel skips pending analysis without writing cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'twilight-loudness-cancel-'))
  const filePath = join(dir, 'song.wav')
  await writeFile(filePath, 'fake', 'utf-8')
  let analyzeStarted = 0
  let releaseAnalyze = null
  const gate = new Promise((resolve) => {
    releaseAnalyze = resolve
  })
  const manager = new LoudnessAnalysisManager({
    cache: new LoudnessAnalysisCache(join(dir, 'loudness-analysis-cache.json')),
    analyzeFile: async () => {
      analyzeStarted += 1
      await gate
      return {
        integratedLufs: -18,
        truePeakDb: -2,
        source: 'analyzed',
        analyzedAt: '2026-01-01T00:00:00.000Z',
        algorithmVersion: LOUDNESS_ANALYSIS_ALGORITHM_VERSION
      }
    }
  })

  const pending = manager.requestAnalysis({ trackId: 'local:1', filePath })
  await new Promise((resolve) => setTimeout(resolve, 20))
  manager.cancel(filePath)
  releaseAnalyze()
  const result = await pending
  assert.equal(result.status, 'skipped')
  if (result.status === 'skipped') assert.equal(result.reason, 'cancelled')
  assert.equal(analyzeStarted, 1)
  assert.equal(await manager.peekCached({ trackId: 'local:1', filePath }), null)
  await rm(dir, { recursive: true, force: true })
})
