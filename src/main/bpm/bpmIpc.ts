import { app, ipcMain } from 'electron'
import { join } from 'path'

import { runtime } from '../core/runtime'
import { BpmAnalysisCache } from './bpmCache.ts'
import {
  BpmAnalysisManager,
  type BpmAnalysisRequest,
  type BpmAnalysisRequestResult
} from './bpmAnalysisManager.ts'

const BPM_ANALYSIS_MAX_SECONDS = 180
const BPM_ANALYSIS_CACHE_FILE = 'bpm-analysis-cache.json'

export function setupBpmAnalysisIpc(): void {
  runtime.bpmAnalysisManager = new BpmAnalysisManager({
    cache: new BpmAnalysisCache(getBpmAnalysisCachePath()),
    analyzeFile: async (request) =>
      runtime.audioEngineManager?.analyzeBpm(request.filePath, {
        maxAnalysisSeconds: BPM_ANALYSIS_MAX_SECONDS,
        referenceBpm: request.referenceBpm
      }) ?? null,
    onComplete: (event) => {
      runtime.mainWindow?.webContents.send('bpmAnalysis:completed', event)
    }
  })

  ipcMain.handle('bpmAnalysis:request', async (_event, raw: unknown): Promise<BpmAnalysisRequestResult> => {
    const request = normalizeBpmAnalysisRequest(raw)
    if (!request) return { status: 'skipped', reason: 'invalid-request' }
    return runtime.bpmAnalysisManager!.requestAnalysis(request)
  })

  ipcMain.handle('bpmAnalysis:getCacheSize', async () => {
    return await new BpmAnalysisCache(getBpmAnalysisCachePath()).getSize()
  })

  ipcMain.handle('bpmAnalysis:clearCache', async () => {
    return await new BpmAnalysisCache(getBpmAnalysisCachePath()).clear()
  })
}

function getBpmAnalysisCachePath(): string {
  return join(app.getPath('userData'), BPM_ANALYSIS_CACHE_FILE)
}

function normalizeBpmAnalysisRequest(raw: unknown): BpmAnalysisRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const trackId = typeof value.trackId === 'string' ? value.trackId.trim() : ''
  const filePath = typeof value.filePath === 'string' ? value.filePath.trim() : ''
  if (!trackId || !filePath) return null
  const referenceBpm =
    typeof value.referenceBpm === 'number' && Number.isFinite(value.referenceBpm)
      ? value.referenceBpm
      : undefined
  return { trackId, filePath, referenceBpm }
}
