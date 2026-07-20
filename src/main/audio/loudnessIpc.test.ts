import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

test('loudness IPC wires priorities and cancellation to the isolated analysis pool', () => {
  const source = readFileSync(new URL('./loudnessIpc.ts', import.meta.url), 'utf8')
  const manager = readFileSync(new URL('../audioEngineManager.ts', import.meta.url), 'utf8')
  const lifecycle = readFileSync(new URL('../app/lifecycle.ts', import.meta.url), 'utf8')
  const runtime = readFileSync(new URL('../core/runtime.ts', import.meta.url), 'utf8')

  assert.match(source, /runtime\.audioAnalysisService/)
  assert.match(source, /service\.analyzeLoudness/)
  assert.match(source, /priority: request\.priority \?\? 50/)
  assert.match(source, /cancelBySource\(filePath, 'loudness'\)/)
  assert.match(source, /cancelAll\('loudness'\)/)
  assert.match(source, /ipcMain\.handle\(\s*'loudnessAnalysis:request'/)
  assert.match(source, /ipcMain\.handle\('loudnessAnalysis:cancel'/)
  assert.match(manager, /requestAnalysis\(\{ trackId, filePath: source, priority: 100 \}\)/)
  assert.match(lifecycle, /setupLoudnessAnalysisIpc\(\)/)
  assert.match(runtime, /loudnessAnalysisManager: null as LoudnessAnalysisManager \| null/)
})
