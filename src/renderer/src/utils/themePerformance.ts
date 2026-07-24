export const THEME_PERFORMANCE_BUDGETS_MS = {
  preview: 32,
  apply: 100
} as const

export type ThemePerformanceOperation = 'preview' | 'apply' | 'resource-decode'

export interface ThemePerformanceMetricSnapshot {
  samplesMs: number[]
  count: number
  p95Ms: number | null
  budgetMs: number | null
  withinBudget: boolean | null
}

export type ThemePerformanceSnapshot = Record<
  ThemePerformanceOperation,
  ThemePerformanceMetricSnapshot
>

export interface ThemePerformanceRecorder {
  record(operation: ThemePerformanceOperation, durationMs: number): ThemePerformanceSnapshot
  snapshot(): ThemePerformanceSnapshot
  reset(): ThemePerformanceSnapshot
}

const OPERATIONS: ThemePerformanceOperation[] = ['preview', 'apply', 'resource-decode']

export function nearestRankPercentile(samples: readonly number[], quantile: number): number | null {
  if (samples.length === 0) return null
  if (!Number.isFinite(quantile) || quantile <= 0 || quantile > 1) {
    throw new RangeError('quantile must be greater than 0 and at most 1')
  }
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]
}

export function createThemePerformanceRecorder(maxSamples = 120): ThemePerformanceRecorder {
  if (!Number.isInteger(maxSamples) || maxSamples < 1) {
    throw new RangeError('maxSamples must be a positive integer')
  }
  const samples = new Map<ThemePerformanceOperation, number[]>(
    OPERATIONS.map((operation) => [operation, []])
  )

  function snapshot(): ThemePerformanceSnapshot {
    return Object.fromEntries(
      OPERATIONS.map((operation) => {
        const current = [...(samples.get(operation) ?? [])]
        const p95Ms = nearestRankPercentile(current, 0.95)
        const budgetMs =
          operation === 'resource-decode' ? null : THEME_PERFORMANCE_BUDGETS_MS[operation]
        return [
          operation,
          {
            samplesMs: current,
            count: current.length,
            p95Ms,
            budgetMs,
            withinBudget: p95Ms === null || budgetMs === null ? null : p95Ms < budgetMs
          }
        ]
      })
    ) as ThemePerformanceSnapshot
  }

  return {
    record(operation, durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) return snapshot()
      const current = samples.get(operation) ?? []
      current.push(durationMs)
      if (current.length > maxSamples) current.splice(0, current.length - maxSamples)
      samples.set(operation, current)
      return snapshot()
    },
    snapshot,
    reset() {
      for (const operation of OPERATIONS) samples.set(operation, [])
      return snapshot()
    }
  }
}
