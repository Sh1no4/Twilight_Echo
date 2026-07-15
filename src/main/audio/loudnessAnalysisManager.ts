import { stat } from 'fs/promises'

import {
  LOUDNESS_ANALYSIS_ALGORITHM_VERSION,
  LOUDNORM_DEFAULT_TARGET_LUFS,
  LOUDNORM_DEFAULT_TRUE_PEAK_CEILING_DB,
  LoudnessAnalysisCache,
  type LoudnessAnalysisCacheIdentity,
  type LoudnessAnalysisResult
} from './loudnessCache.ts'

export interface LoudnessAnalysisRequest {
  trackId: string
  filePath: string
  targetLufs?: number
  truePeakCeilingDb?: number
}

export type LoudnessAnalysisRequestResult =
  | { status: 'completed'; analysis: LoudnessAnalysisResult }
  | { status: 'cached'; analysis: LoudnessAnalysisResult }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }
  | { status: 'unavailable'; reason: string }

export interface LoudnessAnalysisManagerOptions {
  cache: LoudnessAnalysisCache
  analyzeFile: (request: LoudnessAnalysisRequest) => Promise<LoudnessAnalysisResult | null>
  failureCooldownMs?: number
  now?: () => number
  onComplete?: (event: {
    trackId: string
    filePath: string
    analysis: LoudnessAnalysisResult
  }) => void
}

export class LoudnessAnalysisManager {
  private readonly cache: LoudnessAnalysisCache
  private readonly analyzeFile: LoudnessAnalysisManagerOptions['analyzeFile']
  private readonly failureCooldownMs: number
  private readonly now: () => number
  private readonly onComplete?: LoudnessAnalysisManagerOptions['onComplete']
  private inFlight = new Map<string, Promise<LoudnessAnalysisRequestResult>>()
  private failures = new Map<string, { failedAt: number; reason: string }>()
  private queue: Promise<unknown> = Promise.resolve()
  private cancelled = new Set<string>()

  constructor(options: LoudnessAnalysisManagerOptions) {
    this.cache = options.cache
    this.analyzeFile = options.analyzeFile
    this.failureCooldownMs = options.failureCooldownMs ?? 10 * 60 * 1000
    this.now = options.now ?? Date.now
    this.onComplete = options.onComplete
  }

  async peekCached(request: LoudnessAnalysisRequest): Promise<LoudnessAnalysisResult | null> {
    if (!isLocalFilePath(request.filePath)) return null
    try {
      const fileStat = await stat(request.filePath)
      if (!fileStat.isFile()) return null
      const identity = buildIdentity(request, fileStat.size, fileStat.mtimeMs)
      return await this.cache.get(identity)
    } catch {
      return null
    }
  }

  requestAnalysis(request: LoudnessAnalysisRequest): Promise<LoudnessAnalysisRequestResult> {
    if (!isLocalFilePath(request.filePath)) {
      return Promise.resolve({ status: 'skipped', reason: 'not-local-file' })
    }
    this.cancelled.delete(request.filePath)
    const existing = this.inFlight.get(request.filePath)
    if (existing) return existing

    const failure = this.failures.get(request.filePath)
    if (failure && this.now() - failure.failedAt < this.failureCooldownMs) {
      return Promise.resolve({ status: 'skipped', reason: failure.reason })
    }

    const task = this.enqueue(() => this.run(request)).finally(() => {
      this.inFlight.delete(request.filePath)
    })
    this.inFlight.set(request.filePath, task)
    return task
  }

  /** Mark a path as cancelled; in-flight work may still finish but will not write cache. */
  cancel(filePath?: string): void {
    if (filePath) {
      this.cancelled.add(filePath)
      return
    }
    for (const path of this.inFlight.keys()) this.cancelled.add(path)
  }

  clearFailures(): void {
    this.failures.clear()
  }

  private enqueue(task: () => Promise<LoudnessAnalysisRequestResult>): Promise<LoudnessAnalysisRequestResult> {
    // Serial queue (concurrency 1) keeps analysis off the realtime path.
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async run(request: LoudnessAnalysisRequest): Promise<LoudnessAnalysisRequestResult> {
    if (this.cancelled.has(request.filePath)) {
      this.cancelled.delete(request.filePath)
      return { status: 'skipped', reason: 'cancelled' }
    }

    let identity: LoudnessAnalysisCacheIdentity
    try {
      const fileStat = await stat(request.filePath)
      if (!fileStat.isFile()) return { status: 'skipped', reason: 'not-file' }
      identity = buildIdentity(request, fileStat.size, fileStat.mtimeMs)
    } catch (error) {
      return { status: 'skipped', reason: error instanceof Error ? error.message : String(error) }
    }

    // Identity hit skips remeasure (path|size|mtime|algo|target|ceiling).
    const cached = await this.cache.get(identity)
    if (cached) return { status: 'cached', analysis: cached }

    try {
      const analysis = await this.analyzeFile(request)
      if (this.cancelled.has(request.filePath)) {
        this.cancelled.delete(request.filePath)
        return { status: 'skipped', reason: 'cancelled' }
      }
      if (!analysis) {
        this.failures.set(request.filePath, { failedAt: this.now(), reason: 'no-analysis' })
        return { status: 'failed', reason: 'no-analysis' }
      }
      if (analysis.available === false) {
        return { status: 'unavailable', reason: 'ebur128-unavailable' }
      }
      await this.cache.set(identity, analysis)
      this.onComplete?.({ trackId: request.trackId, filePath: request.filePath, analysis })
      return { status: 'completed', analysis }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.failures.set(request.filePath, { failedAt: this.now(), reason })
      return { status: 'failed', reason }
    }
  }
}

function buildIdentity(
  request: LoudnessAnalysisRequest,
  size: number,
  mtimeMs: number
): LoudnessAnalysisCacheIdentity {
  return {
    filePath: request.filePath,
    size,
    mtimeMs,
    algorithmVersion: LOUDNESS_ANALYSIS_ALGORITHM_VERSION,
    targetLufs: request.targetLufs ?? LOUDNORM_DEFAULT_TARGET_LUFS,
    truePeakCeilingDb: request.truePeakCeilingDb ?? LOUDNORM_DEFAULT_TRUE_PEAK_CEILING_DB
  }
}

function isLocalFilePath(value: string): boolean {
  if (!value || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) return false
  return true
}
