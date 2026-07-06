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
}

export type BpmAnalysisRequestResult =
  | { status: 'completed'; analysis: BpmAnalysisResult }
  | { status: 'cached'; analysis: BpmAnalysisResult }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

export interface BpmAnalysisManagerOptions {
  cache: BpmAnalysisCache
  analyzeFile: (request: BpmAnalysisRequest) => Promise<BpmAnalysisResult | null>
  failureCooldownMs?: number
  now?: () => number
  onComplete?: (event: { trackId: string; filePath: string; analysis: BpmAnalysisResult }) => void
}

export class BpmAnalysisManager {
  private readonly cache: BpmAnalysisCache
  private readonly analyzeFile: BpmAnalysisManagerOptions['analyzeFile']
  private readonly failureCooldownMs: number
  private readonly now: () => number
  private readonly onComplete?: BpmAnalysisManagerOptions['onComplete']
  private inFlight = new Map<string, Promise<BpmAnalysisRequestResult>>()
  private failures = new Map<string, { failedAt: number; reason: string }>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: BpmAnalysisManagerOptions) {
    this.cache = options.cache
    this.analyzeFile = options.analyzeFile
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

    const task = this.enqueue(() => this.run(request)).finally(() => {
      this.inFlight.delete(request.filePath)
    })
    this.inFlight.set(request.filePath, task)
    return task
  }

  private enqueue(task: () => Promise<BpmAnalysisRequestResult>): Promise<BpmAnalysisRequestResult> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async run(request: BpmAnalysisRequest): Promise<BpmAnalysisRequestResult> {
    let identity: BpmAnalysisCacheIdentity
    try {
      const fileStat = await stat(request.filePath)
      if (!fileStat.isFile()) return { status: 'skipped', reason: 'not-file' }
      identity = {
        filePath: request.filePath,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        algorithmVersion: BPM_ANALYSIS_ALGORITHM_VERSION
      }
    } catch (error) {
      return { status: 'skipped', reason: error instanceof Error ? error.message : String(error) }
    }

    const cached = await this.cache.get(identity)
    if (cached) return { status: 'cached', analysis: cached }

    try {
      const analysis = await this.analyzeFile(request)
      if (!analysis) {
        this.failures.set(request.filePath, { failedAt: this.now(), reason: 'no-analysis' })
        return { status: 'failed', reason: 'no-analysis' }
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

function isLocalFilePath(value: string): boolean {
  if (!value || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) return false
  return true
}
