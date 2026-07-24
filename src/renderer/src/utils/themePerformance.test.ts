import assert from 'node:assert/strict'
import test from 'node:test'
import {
  THEME_PERFORMANCE_BUDGETS_MS,
  createThemePerformanceRecorder,
  nearestRankPercentile
} from './themePerformance.ts'

test('theme performance uses nearest-rank p95 and the release budgets', () => {
  const samples = Array.from({ length: 20 }, (_, index) => index + 1)
  assert.equal(nearestRankPercentile(samples, 0.95), 19)

  const recorder = createThemePerformanceRecorder()
  for (const duration of samples) recorder.record('preview', duration)
  const snapshot = recorder.snapshot()

  assert.equal(snapshot.preview.p95Ms, 19)
  assert.equal(snapshot.preview.budgetMs, THEME_PERFORMANCE_BUDGETS_MS.preview)
  assert.equal(snapshot.preview.withinBudget, true)
})

test('theme performance retains a bounded window and reports strict budget failures', () => {
  const recorder = createThemePerformanceRecorder(3)
  recorder.record('apply', 20)
  recorder.record('apply', 40)
  recorder.record('apply', 80)
  const snapshot = recorder.record('apply', 100)

  assert.deepEqual(snapshot.apply.samplesMs, [40, 80, 100])
  assert.equal(snapshot.apply.p95Ms, 100)
  assert.equal(snapshot.apply.withinBudget, false)
})

test('resource decode timing is recorded separately without an invented budget', () => {
  const recorder = createThemePerformanceRecorder()
  recorder.record('resource-decode', 12.5)
  recorder.record('preview', Number.NaN)
  const snapshot = recorder.snapshot()

  assert.equal(snapshot['resource-decode'].p95Ms, 12.5)
  assert.equal(snapshot['resource-decode'].budgetMs, null)
  assert.equal(snapshot['resource-decode'].withinBudget, null)
  assert.equal(snapshot.preview.count, 0)
})
