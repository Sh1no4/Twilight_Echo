import { stat } from 'fs/promises'

import {
  BPM_ANALYSIS_ALGORITHM_VERSION,
  BpmAnalysisCache,
  type BpmAnalysisResult,
  type BpmAnalysisCacheIdentity
} from './bpmCache.ts'

export interface BpmAnalysisRequest {
  trackId: string
  filePath: string
  referenceBpm?: number
  priority?: number
}

export type BpmAnalysisRequestResult =
  | { status: 'completed'; analysis: BpmAnalysisResult }
  | { status: 'cached'; analysis: BpmAnalysisResult }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

export interface BpmAnalysisManagerOptions {
  cache: BpmAnalysisCache
  analyzeFile: (request: BpmAnalysisRequest) => Promise<BpmAnalysisResult | null>
  cancelFile?: (filePath?: string) => void
  failureCooldownMs?: number
  now?: () => number
  onComplete?: (event: { trackId: string; filePath: string; analysis: BpmAnalysisResult }) => void
}

export class BpmAnalysisManager {
  private readonly cache: BpmAnalysisCache
  private readonly analyzeFile: BpmAnalysisManagerOptions['analyzeFile']
  private readonly cancelFile?: BpmAnalysisManagerOptions['cancelFile']
  private readonly failureCooldownMs: number
  private readonly now: () => number
  private readonly onComplete?: BpmAnalysisManagerOptions['onComplete']
  private inFlight = new Map<string, Promise<BpmAnalysisRequestResult>>()
  private failures = new Map<string, { failedAt: number; reason: string }>()
  private activeGenerations = new Map<string, number>()
  private nextGeneration = 0

  constructor(options: BpmAnalysisManagerOptions) {
    this.cache = options.cache
    this.analyzeFile = options.analyzeFile
    this.cancelFile = options.cancelFile
    this.failureCooldownMs = options.failureCooldownMs ?? 10 * 60 * 1000
    this.now = options.now ?? Date.now
    this.onComplete = options.onComplete
  }

  requestAnalysis(request: BpmAnalysisRequest): Promise<BpmAnalysisRequestResult> {
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

  cancel(filePath?: string): void {
    if (filePath) {
      this.activeGenerations.delete(filePath)
      this.cancelFile?.(filePath)
      return
    }
    this.activeGenerations.clear()
    this.cancelFile?.()
  }

  private async run(
    request: BpmAnalysisRequest,
    generation: number
  ): Promise<BpmAnalysisRequestResult> {
    if (!this.isCurrent(request.filePath, generation)) {
      return { status: 'skipped', reason: 'cancelled' }
    }
    let identity: BpmAnalysisCacheIdentity
    let cacheCandidate: BpmAnalysisResult | null = null
    try {
      const fileStat = await stat(request.filePath)
      if (!this.isCurrent(request.filePath, generation)) {
        return { status: 'skipped', reason: 'cancelled' }
      }
      if (!fileStat.isFile()) return { status: 'skipped', reason: 'not-file' }
      identity = {
        filePath: request.filePath,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        algorithmVersion: BPM_ANALYSIS_ALGORITHM_VERSION
      }
    } catch (error) {
      if (!this.isCurrent(request.filePath, generation)) {
        return { status: 'skipped', reason: 'cancelled' }
      }
      return { status: 'skipped', reason: error instanceof Error ? error.message : String(error) }
    }

    const cached = await this.cache.get(identity)
    if (!this.isCurrent(request.filePath, generation)) {
      return { status: 'skipped', reason: 'cancelled' }
    }
    if (cached) return { status: 'cached', analysis: cached }

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
    identity: BpmAnalysisCacheIdentity,
    analysis?: BpmAnalysisResult
  ): Promise<BpmAnalysisRequestResult> {
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

function isLocalFilePath(value: string): boolean {
  if (!value || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) return false
  return true
}
