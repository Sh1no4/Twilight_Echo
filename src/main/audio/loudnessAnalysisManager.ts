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
  priority?: number
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
  cancelFile?: (filePath?: string) => void
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
  private readonly cancelFile?: LoudnessAnalysisManagerOptions['cancelFile']
  private readonly failureCooldownMs: number
  private readonly now: () => number
  private readonly onComplete?: LoudnessAnalysisManagerOptions['onComplete']
  private inFlight = new Map<string, Promise<LoudnessAnalysisRequestResult>>()
  private failures = new Map<string, { failedAt: number; reason: string }>()
  private activeGenerations = new Map<string, number>()
  private nextGeneration = 0

  constructor(options: LoudnessAnalysisManagerOptions) {
    this.cache = options.cache
    this.analyzeFile = options.analyzeFile
    this.cancelFile = options.cancelFile
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
    const existing = this.inFlight.get(request.filePath)
    if (existing) return existing

    const failure = this.failures.get(request.filePath)
    if (failure && this.now() - failure.failedAt < this.failureCooldownMs) {
      return Promise.resolve({ status: 'skipped', reason: failure.reason })
    }

    const generation = ++this.nextGeneration
    this.activeGenerations.set(request.filePath, generation)
    const task = this.run(request, generation).finally(() => {
      this.inFlight.delete(request.filePath)
      if (this.activeGenerations.get(request.filePath) === generation) {
        this.activeGenerations.delete(request.filePath)
      }
    })
    this.inFlight.set(request.filePath, task)
    return task
  }

  /** Invalidate the active generation before terminating its isolated worker. */
  cancel(filePath?: string): void {
    if (filePath) {
      this.activeGenerations.delete(filePath)
      this.cancelFile?.(filePath)
      return
    }
    this.activeGenerations.clear()
    this.cancelFile?.()
  }

  clearFailures(): void {
    this.failures.clear()
  }

  private async run(
    request: LoudnessAnalysisRequest,
    generation: number
  ): Promise<LoudnessAnalysisRequestResult> {
    if (!this.isCurrent(request.filePath, generation)) {
      return { status: 'skipped', reason: 'cancelled' }
    }

    let identity: LoudnessAnalysisCacheIdentity
    try {
      const fileStat = await stat(request.filePath)
      if (!this.isCurrent(request.filePath, generation)) {
        return { status: 'skipped', reason: 'cancelled' }
      }
      if (!fileStat.isFile()) return { status: 'skipped', reason: 'not-file' }
      identity = buildIdentity(request, fileStat.size, fileStat.mtimeMs)
    } catch (error) {
      if (!this.isCurrent(request.filePath, generation)) {
        return { status: 'skipped', reason: 'cancelled' }
      }
      return { status: 'skipped', reason: error instanceof Error ? error.message : String(error) }
    }

    // Identity hit skips remeasure (path|size|mtime|algo|target|ceiling).
    const cached = await this.cache.get(identity)
    if (!this.isCurrent(request.filePath, generation)) {
      return { status: 'skipped', reason: 'cancelled' }
    }
    if (cached) return { status: 'cached', analysis: cached }

    let cacheCandidate: LoudnessAnalysisResult | null = null
    try {
      if (!this.isCurrent(request.filePath, generation)) {
        return { status: 'skipped', reason: 'cancelled' }
      }
      const analysis = await this.analyzeFile(request)
      if (!this.isCurrent(request.filePath, generation)) {
        return { status: 'skipped', reason: 'cancelled' }
      }
      if (!analysis) {
        this.failures.set(request.filePath, { failedAt: this.now(), reason: 'no-analysis' })
        return { status: 'failed', reason: 'no-analysis' }
      }
      if (analysis.available === false) {
        return { status: 'unavailable', reason: 'ebur128-unavailable' }
      }
      cacheCandidate = analysis
      await this.cache.set(identity, analysis)
      if (!this.isCurrent(request.filePath, generation)) {
        return await this.finishCancelledCacheWrite(identity, analysis)
      }
      this.onComplete?.({ trackId: request.trackId, filePath: request.filePath, analysis })
      return { status: 'completed', analysis }
    } catch (error) {
      if (!this.isCurrent(request.filePath, generation)) {
        return await this.finishCancelledCacheWrite(identity, cacheCandidate ?? undefined)
      }
      const reason = error instanceof Error ? error.message : String(error)
      this.failures.set(request.filePath, { failedAt: this.now(), reason })
      return { status: 'failed', reason }
    }
  }

  private isCurrent(filePath: string, generation: number): boolean {
    return this.activeGenerations.get(filePath) === generation
  }

  private async finishCancelledCacheWrite(
    identity: LoudnessAnalysisCacheIdentity,
    analysis?: LoudnessAnalysisResult
  ): Promise<LoudnessAnalysisRequestResult> {
    if (!analysis) return { status: 'skipped', reason: 'cancelled' }
    try {
      await this.cache.deleteIfMatches(identity, analysis)
      return { status: 'skipped', reason: 'cancelled' }
    } catch (error) {
      return {
        status: 'failed',
        reason: `cancelled-cache-rollback-failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      }
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
