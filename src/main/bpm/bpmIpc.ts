import { app, ipcMain } from 'electron'
import { join } from 'path'

import { runtime } from '../core/runtime'
import { BpmAnalysisCache } from './bpmCache.ts'
import {
  BpmAnalysisManager,
  type BpmAnalysisRequest,
  type BpmAnalysisRequestResult
} from './bpmAnalysisManager.ts'
import { resolveAuthorizedAudioFile } from '../security/localPaths.ts'
import { normalizeFiniteNumber, normalizeIpcString } from '../security/ipcValidation.ts'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'

const BPM_ANALYSIS_MAX_SECONDS = 180
const BPM_ANALYSIS_CACHE_FILE = 'bpm-analysis-cache.json'
const MAX_BPM_TRACK_ID_LENGTH = 512
const MAX_BPM_FILE_PATH_LENGTH = 4096

export function setupBpmAnalysisIpc(): void {
  runtime.bpmAnalysisManager = new BpmAnalysisManager({
    cache: new BpmAnalysisCache(getBpmAnalysisCachePath()),
    analyzeFile: async (request) => {
      const service = runtime.audioAnalysisService
      if (!service) throw new Error('audio analysis service is unavailable')
      return await service.analyzeBpm(
        request.filePath,
        JSON.stringify({
          maxAnalysisSeconds: BPM_ANALYSIS_MAX_SECONDS,
          referenceBpm: request.referenceBpm
        }),
        { priority: request.priority ?? 10 }
      )
    },
    cancelFile: (filePath) => {
      if (filePath) runtime.audioAnalysisService?.cancelBySource(filePath, 'bpm')
      else runtime.audioAnalysisService?.cancelAll('bpm')
    },
    onComplete: (event) => {
      runtime.mainWindow?.webContents.send('bpmAnalysis:completed', event)
    }
  })

  ipcMain.handle(
    'bpmAnalysis:request',
    async (_event, raw: unknown): Promise<BpmAnalysisRequestResult> => {
      assertTrustedIpcSender(_event, 'BPM IPC')
      const request = await normalizeBpmAnalysisRequest(raw)
      if (!request) return { status: 'skipped', reason: 'invalid-request' }
      return runtime.bpmAnalysisManager!.requestAnalysis(request)
    }
  )

  ipcMain.handle('bpmAnalysis:getCacheSize', async (event) => {
    assertTrustedIpcSender(event, 'BPM IPC')
    return await new BpmAnalysisCache(getBpmAnalysisCachePath()).getSize()
  })

  ipcMain.handle('bpmAnalysis:clearCache', async (event) => {
    assertTrustedIpcSender(event, 'BPM IPC')
    return await new BpmAnalysisCache(getBpmAnalysisCachePath()).clear()
  })

  ipcMain.handle('bpmAnalysis:cancel', async (event, filePath?: unknown) => {
    assertTrustedIpcSender(event, 'BPM IPC')
    const manager = runtime.bpmAnalysisManager
    if (!manager) return
    if (typeof filePath === 'string' && filePath.trim()) {
      try {
        manager.cancel(
          await resolveAuthorizedAudioFile(
            normalizeIpcString(filePath, 'BPM file path', MAX_BPM_FILE_PATH_LENGTH)
          )
        )
      } catch {
        manager.cancel(filePath.trim())
      }
      return
    }
    manager.cancel()
  })
}

function getBpmAnalysisCachePath(): string {
  return join(app.getPath('userData'), BPM_ANALYSIS_CACHE_FILE)
}

async function normalizeBpmAnalysisRequest(raw: unknown): Promise<BpmAnalysisRequest | null> {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  let trackId: string
  let filePath: string
  try {
    trackId = normalizeIpcString(value.trackId, 'BPM track id', MAX_BPM_TRACK_ID_LENGTH)
    filePath = await resolveAuthorizedAudioFile(
      normalizeIpcString(value.filePath, 'BPM file path', MAX_BPM_FILE_PATH_LENGTH)
    )
  } catch {
    return null
  }
  const rawReferenceBpm = Number(value.referenceBpm)
  const referenceBpm =
    value.referenceBpm != null && Number.isFinite(rawReferenceBpm)
      ? normalizeFiniteNumber(rawReferenceBpm, 'reference BPM', 120, 30, 300)
      : undefined
  return { trackId, filePath, referenceBpm, priority: 10 }
}
