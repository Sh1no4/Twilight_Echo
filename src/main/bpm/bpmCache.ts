import { existsSync } from 'fs'
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { dirname } from 'path'

export const BPM_ANALYSIS_ALGORITHM_VERSION = 1

export interface BpmTempoSegment {
  startMs: number
  endMs: number
  bpm: number
  confidence: number
}

export interface BpmAnalysisResult {
  bpm: number
  confidence: number
  source: 'analyzed'
  analyzedAt: string
  algorithmVersion: number
  variableTempo?: boolean
  bpmRange?: [number, number]
  tempoMap?: BpmTempoSegment[]
}

export interface BpmAnalysisCacheIdentity {
  filePath: string
  size: number
  mtimeMs: number
  algorithmVersion?: number
}

interface BpmAnalysisCacheFile {
  version: 1
  entries: Record<string, BpmAnalysisResult>
}

export function buildBpmAnalysisCacheKey(identity: BpmAnalysisCacheIdentity): string {
  const algorithmVersion = identity.algorithmVersion ?? BPM_ANALYSIS_ALGORITHM_VERSION
  return [
    identity.filePath.toLowerCase(),
    Math.floor(identity.size),
    Math.floor(identity.mtimeMs),
    algorithmVersion
  ].join('|')
}

export class BpmAnalysisCache {
  private readonly cachePath: string

  constructor(cachePath: string) {
    this.cachePath = cachePath
  }

  async get(identity: BpmAnalysisCacheIdentity): Promise<BpmAnalysisResult | null> {
    const file = await this.read()
    const result = file.entries[buildBpmAnalysisCacheKey(identity)]
    return isBpmAnalysisResult(result) ? result : null
  }

  async set(identity: BpmAnalysisCacheIdentity, analysis: BpmAnalysisResult): Promise<void> {
    const file = await this.read()
    file.entries[buildBpmAnalysisCacheKey(identity)] = analysis
    await mkdir(dirname(this.cachePath), { recursive: true })
    await writeFile(this.cachePath, JSON.stringify(file), 'utf-8')
  }

  async getSize(): Promise<number> {
    try {
      return (await stat(this.cachePath)).size
    } catch {
      return 0
    }
  }

  async clear(): Promise<number> {
    await rm(this.cachePath, { force: true })
    return 0
  }

  private async read(): Promise<BpmAnalysisCacheFile> {
    if (!existsSync(this.cachePath)) return { version: 1, entries: {} }
    try {
      const parsed = JSON.parse(await readFile(this.cachePath, 'utf-8')) as Partial<BpmAnalysisCacheFile>
      if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
        return { version: 1, entries: {} }
      }
      return { version: 1, entries: parsed.entries as Record<string, BpmAnalysisResult> }
    } catch {
      return { version: 1, entries: {} }
    }
  }
}

export function isBpmAnalysisResult(value: unknown): value is BpmAnalysisResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<BpmAnalysisResult>
  return (
    result.source === 'analyzed' &&
    typeof result.bpm === 'number' &&
    Number.isFinite(result.bpm) &&
    typeof result.confidence === 'number' &&
    Number.isFinite(result.confidence) &&
    typeof result.analyzedAt === 'string' &&
    typeof result.algorithmVersion === 'number'
  )
}
