import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

test('BPM analysis IPC uses userData cache and broadcasts completed analysis', () => {
  const source = readFileSync(new URL('./bpmIpc.ts', import.meta.url), 'utf8')
  const lifecycle = readFileSync(new URL('../app/lifecycle.ts', import.meta.url), 'utf8')
  const runtime = readFileSync(new URL('../core/runtime.ts', import.meta.url), 'utf8')

  assert.match(source, /BPM_ANALYSIS_CACHE_FILE = 'bpm-analysis-cache\.json'/)
  assert.match(source, /function getBpmAnalysisCachePath\(\): string/)
  assert.match(source, /new BpmAnalysisManager/)
  assert.match(source, /runtime\.audioAnalysisService/)
  assert.match(source, /service\.analyzeBpm/)
  assert.match(source, /priority: request\.priority \?\? 10/)
  assert.match(source, /cancelBySource\(filePath, 'bpm'\)/)
  assert.match(source, /cancelAll\('bpm'\)/)
  assert.match(source, /ipcMain\.handle\(\s*'bpmAnalysis:request'/)
  assert.match(source, /ipcMain\.handle\('bpmAnalysis:getCacheSize'/)
  assert.match(source, /ipcMain\.handle\('bpmAnalysis:clearCache'/)
  assert.match(source, /ipcMain\.handle\('bpmAnalysis:cancel'/)
  assert.match(source, /webContents\.send\('bpmAnalysis:completed'/)
  assert.match(lifecycle, /setupBpmAnalysisIpc\(\)/)
  assert.match(runtime, /bpmAnalysisManager: null as BpmAnalysisManager \| null/)
})
