import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { AudioEngineManager } from '../audioEngineManager.ts'
import { BpmAnalysisManager, type BpmAnalysisRequest } from '../bpm/bpmAnalysisManager.ts'
import { BpmAnalysisCache } from '../bpm/bpmCache.ts'
import {
  importCorrectionProfileFile,
  parseCorrectionProfileFile
} from '../dsp/correctionProfile.ts'
import { DspAssetLibrary, type DspAssetImportOptions } from '../dsp/dspAssetLibrary.ts'
import {
  collectDspAssetIds,
  createDspProfile,
  exportDspProfileArchive,
  importDspProfileArchive
} from '../dsp/dspProfileArchive.ts'
import { Vst3CatalogService, type Vst3ModuleScanner } from '../dsp/vst3Catalog.ts'
import type { ImportedFrequencyResponse } from '../../shared/frequencyResponse.ts'
import { clampNumber } from '../../shared/utils.ts'
import type {
  DspAsset,
  DspAssetKind,
  DspCorrectionImportResult,
  DspCorrectionProfile,
  DspProfile,
  Vst3CatalogState
} from '../../shared/dspGraph.ts'
import {

  AudioDiagnosticRecorder,
  type AudioDiagnosticEnvironment,
  type AudioDiagnosticSnapshot
} from './audioDiagnostics.ts'
import { importFrequencyResponseFromDialog } from './importFrequencyResponse.ts'
import {
  LoudnessAnalysisManager,
  type LoudnessAnalysisRequest
} from './loudnessAnalysisManager.ts'
import { LoudnessAnalysisCache } from './loudnessCache.ts'

const DSP_ASSET_KINDS: ReadonlySet<string> = new Set([
  'impulseResponse',
  'correctionProfile',
  'vst3Preset',
  'vst3State'
])

/** Capture a snapshot field without throwing (mirrors engineIpc.captureDiagnosticValue). */
async function captureDiagnosticValue<T>(
  read: () => T | Promise<T>
): Promise<T | { error: string }> {
  try {
    return await read()
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** A callback used to forward analysis completion events out of the service slice. */
export type AnalysisEventEmitter = (
  surface: 'bpmAnalysis' | 'loudnessAnalysis',
  name: string,
  payload: unknown
) => void

/**
 * Stage 6B — VST3 catalog, DSP asset library, BPM/loudness analysis and audio
 * diagnostics.
 *
 * Each of these services in Electron is a pure Node + fs module (the only
 * Electron dependency in the wiring is `app.getPath('userData')` and the native
 * `requireAudioEngine()`/dialog flows, which in Tauri are already the sidecar's
 * own manager and the renderer-side @tauri-apps/plugin-dialog). This slice
 * reinstanties them inside the audio sidecar root and exposes them as callable
 * methods on the same JSON-lines protocol.
 *
 * Dialog-backed entrypoints (`selectVst3SearchPath`, `selectImpulseResponse`,
 * the asset/profile import dialogs and `exportDiagnostics` save dialog) keep
 * their dialogs in the renderer bridge via plugin-dialog; the chosen path is
 * passed into these methods as an argument. All other state lives here.
 */
export class AudioSliceServices {
  private manager: AudioEngineManager | null = null
  private emitAnalysis: AnalysisEventEmitter = () => undefined

  private vst3Catalog: Vst3CatalogService | null = null
  private dspAssets: DspAssetLibrary | null = null
  private bpmManager: BpmAnalysisManager | null = null
  private bpmCache: BpmAnalysisCache | null = null
  private loudnessManager: LoudnessAnalysisManager | null = null
  private loudnessCache: LoudnessAnalysisCache | null = null
  private diagnostics: AudioDiagnosticRecorder | null = null

  /** Instantiate the slice once we know where user data lives and the manager is ready. */
  setup(dataDir: string, manager: AudioEngineManager, emitAnalysis: AnalysisEventEmitter): void {
    this.manager = manager
    this.emitAnalysis = emitAnalysis

    const vst3Root = join(dataDir, 'dsp-vst3')
    const scanner: Vst3ModuleScanner = {
      scan: (modulePath) => manager.scanVst3Module(modulePath)
    }
    this.vst3Catalog = new Vst3CatalogService(vst3Root, scanner)
    this.vst3Catalog.initialize().catch((error: unknown) => {
      console.error('[audio-slice] 初始化 VST3 目录失败：', error)
    })

    const assetRoot = join(dataDir, 'dsp-assets')
    this.dspAssets = new DspAssetLibrary(assetRoot)
    this.dspAssets.initialize().catch((error: unknown) => {
      console.error('[audio-slice] 初始化 DSP 资产库失败：', error)
    })

    const bpmCachePath = join(dataDir, 'bpm-analysis-cache.json')
    this.bpmCache = new BpmAnalysisCache(bpmCachePath)
    this.bpmManager = new BpmAnalysisManager({
      cache: this.bpmCache,
      analyzeFile: async (request) => {
        const engine = this.manager
        if (!engine) throw new Error('audio engine is unavailable')
        return await engine.analyzeBpm(request.filePath, {
          maxAnalysisSeconds: 180,
          referenceBpm: request.referenceBpm
        })
      },
      onComplete: (event) => this.emitAnalysis('bpmAnalysis', 'completed', event)
    })

    const loudnessCachePath = join(dataDir, 'loudness-analysis-cache.json')
    this.loudnessCache = new LoudnessAnalysisCache(loudnessCachePath)
    this.loudnessManager = new LoudnessAnalysisManager({
      cache: this.loudnessCache,
      analyzeFile: async (request) => {
        const engine = this.manager
        if (!engine) throw new Error('audio engine is unavailable')
        return await engine.analyzeLoudness(request.filePath, { maxAnalysisSeconds: 0 })
      },
      onComplete: (event) => this.emitAnalysis('loudnessAnalysis', 'completed', event)
    })

    const environment: AudioDiagnosticEnvironment = {
      appName: 'twilight-echo',
      appVersion: process.env.TWILIGHT_APP_VERSION ?? '0.0.0',
      packaged: process.env.TWILIGHT_PACKAGED === '1',
      platform: process.platform,
      architecture: process.arch,
      osRelease: (process as { release?: { name?: string } }).release?.name ?? '',
      locale: process.env.LANG ?? '',
      processVersions: {
        node: process.versions.node,
        modules: process.versions.modules ?? ''
      }
    }
    this.diagnostics = new AudioDiagnosticRecorder({
      directory: join(dataDir, 'logs'),
      environment
    })
  }

  private requireVst3(): Vst3CatalogService {
    if (!this.vst3Catalog) throw new Error('VST3 目录服务尚未初始化')
    return this.vst3Catalog
  }

  private requireDspAssets(): DspAssetLibrary {
    if (!this.dspAssets) throw new Error('DSP 资产库尚未初始化')
    return this.dspAssets
  }

  // ── VST3 catalog ──────────────────────────────────────────────────────────

  async vst3GetState(): Promise<Vst3CatalogState> {
    return this.requireVst3().getState()
  }

  async vst3SetEnabled(enabled: boolean): Promise<Vst3CatalogState> {
    return this.requireVst3().setEnabled(enabled === true)
  }

  async vst3SetSearchPaths(paths: unknown): Promise<Vst3CatalogState> {
    const list = Array.isArray(paths)
      ? paths.filter((item): item is string => typeof item === 'string')
      : []
    return this.requireVst3().setSearchPaths(list)
  }

  async vst3Scan(): Promise<Vst3CatalogState> {
    return this.requireVst3().scan()
  }

  async vst3ClearQuarantine(id: string): Promise<Vst3CatalogState> {
    const catalog = this.requireVst3()
    return catalog.clearQuarantine(id)
  }

  // ── DSP asset library ─────────────────────────────────────────────────────

  async dspList(): Promise<DspAsset[]> {
    return this.requireDspAssets().list()
  }

  async dspImportAsset(kind: unknown, sourcePath: string): Promise<DspAsset | null> {
    const assetKind = typeof kind === 'string' && DSP_ASSET_KINDS.has(kind) ? (kind as DspAssetKind) : null
    if (!assetKind) throw new Error('DSP 资产类型无效')
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) return null
    const options: DspAssetImportOptions = { kind: assetKind, sourcePath }
    if (assetKind === 'correctionProfile') {
      const imported = await importCorrectionProfileFile(sourcePath, this.requireDspAssets())
      return imported.asset
    }
    return this.requireDspAssets().importFile(options)
  }

  async dspImportCorrectionProfile(sourcePath: string): Promise<DspCorrectionImportResult | null> {
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) return null
    return importCorrectionProfileFile(sourcePath, this.requireDspAssets())
  }

  async dspImportFrequencyResponse(filePath: string): Promise<ImportedFrequencyResponse | null> {
    if (typeof filePath !== 'string' || !filePath) return null
    return importFrequencyResponseFromDialog(
      { canceled: false, filePaths: [filePath] },
      async (path) => await readFile(path, 'utf-8'),
      async (path) => (await stat(path)).size
    )
  }

  async dspGetCorrectionProfile(assetId: string): Promise<DspCorrectionProfile> {
    if (!/^correctionProfile:[a-f0-9]{64}$/.test(assetId)) {
      throw new Error('DSP 校正资料标识无效')
    }
    const assets = this.requireDspAssets()
    const asset = await assets.get(assetId)
    if (!asset || asset.kind !== 'correctionProfile') throw new Error('DSP 校正资料不存在')
    return parseCorrectionProfileFile(await assets.getPath(assetId))
  }

  async dspDeleteAsset(assetId: string): Promise<DspAsset[]> {
    if (!/^[a-zA-Z]+:[a-f0-9]{64}$/.test(assetId)) throw new Error('DSP 资料标识无效')
    await this.requireDspAssets().remove(assetId)
    return this.requireDspAssets().list()
  }

  async dspExportProfile(name: string | null, outputPath: unknown): Promise<DspProfile | null> {
    const engine = this.manager
    if (!engine) throw new Error('audio engine is unavailable')
    const scenes = engine.getDspSceneState().scenes
    const pinnedSceneId = engine.getDspSceneState().pinnedSceneId
    if (typeof outputPath !== 'string' || !outputPath) return null
    const profile = createDspProfile({
      name: typeof name === 'string' && name ? name : 'DSP Profile',
      scenes,
      pinnedSceneId,
      assetIds: collectDspAssetIds(scenes)
    })
    await exportDspProfileArchive({ outputPath, profile }, this.requireDspAssets())
    return profile
  }

  async dspImportProfile(filePath: unknown): Promise<DspProfile | null> {
    const engine = this.manager
    if (!engine) throw new Error('audio engine is unavailable')
    if (typeof filePath !== 'string' || !filePath) return null
    const imported = await importDspProfileArchive(filePath, this.requireDspAssets())
    await engine.setDspScenes(imported.profile.scenes, imported.profile.pinnedSceneId)
    return imported.profile
  }

  // ── BPM analysis ──────────────────────────────────────────────────────────

  async bpmRequest(request: unknown): Promise<unknown> {
    if (!this.bpmManager) throw new Error('BPM 分析服务尚未初始化')
    const normalized = normalizeBpmRequest(request)
    if (!normalized) return { status: 'skipped', reason: 'invalid-request' }
    return this.bpmManager.requestAnalysis(normalized)
  }

  async bpmGetCacheSize(): Promise<number> {
    if (!this.bpmCache) throw new Error('BPM 分析服务尚未初始化')
    return this.bpmCache.getSize()
  }

  async bpmClearCache(): Promise<number> {
    if (!this.bpmCache) throw new Error('BPM 分析服务尚未初始化')
    return this.bpmCache.clear()
  }

  bpmCancel(filePath?: string): void {
    this.bpmManager?.cancel(typeof filePath === 'string' && filePath ? filePath : undefined)
  }

  // ── Loudness analysis ─────────────────────────────────────────────────────

  async loudnessRequest(request: unknown): Promise<unknown> {
    if (!this.loudnessManager) throw new Error('响度分析服务尚未初始化')
    const normalized = normalizeLoudnessRequest(request)
    if (!normalized) return { status: 'skipped', reason: 'invalid-request' }
    return this.loudnessManager.requestAnalysis(normalized)
  }

  async loudnessGetCacheSize(): Promise<number> {
    if (!this.loudnessCache) throw new Error('响度分析服务尚未初始化')
    return this.loudnessCache.getSize()
  }

  async loudnessClearCache(): Promise<number> {
    if (!this.loudnessCache) throw new Error('响度分析服务尚未初始化')
    return this.loudnessCache.clear()
  }

  loudnessGetStatus(): { status: string; source: string | null } {
    return this.manager?.getLoudnormStatus() ?? { status: 'idle', source: null }
  }

  loudnessCancel(filePath?: string): void {
    this.loudnessManager?.cancel(typeof filePath === 'string' && filePath ? filePath : undefined)
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  /** Build a diagnostics snapshot from the live manager (mirrors captureAudioDiagnosticSnapshot). */
  async diagSnapshot(): Promise<AudioDiagnosticSnapshot> {
    const engine = this.manager
    if (!engine) throw new Error('audio engine is unavailable')
    const engineProcessing = engine.getAudioProcessing()
    return {
      playback: await captureDiagnosticValue(() => engine.getPlaybackInfo()),
      outputState: await captureDiagnosticValue(() => engine.getAudioOutputState()),
      outputConfig: engine.getOutputConfig?.() ?? {},
      effectiveOutputConfig: engine.getEffectiveOutputConfig?.() ?? {},
      outputConfigApplyStatus: engine.getOutputConfigApplyStatus?.() ?? {},
      configuredProcessing: engineProcessing,
      effectiveProcessing: engineProcessing,
      engineProcessing,
      headphoneCompensation: {},
      dspSceneState: engine.getDspSceneState?.() ?? {},
      dspGraphStatus: await captureDiagnosticValue(() => engine.getDspGraphStatus()),
      diagnosis: { unavailable: true }
    }
  }

  async diagExport(filePath: unknown): Promise<{ filePath: string | null }> {
    const recorder = this.diagnostics
    if (!recorder) throw new Error('音频诊断记录器尚未初始化')
    if (typeof filePath !== 'string' || !filePath) return { filePath: null }
    recorder.record('diagnostic-export-requested')
    const snapshot = await this.diagSnapshot()
    await recorder.exportReport(filePath, snapshot)
    return { filePath }
  }
}

function normalizeBpmRequest(raw: unknown): BpmAnalysisRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.trackId !== 'string' || typeof value.filePath !== 'string') return null
  const referenceBpm = Number(value.referenceBpm)
  return {
    trackId: value.trackId,
    filePath: value.filePath,
    referenceBpm:
      value.referenceBpm != null && Number.isFinite(referenceBpm)
        ? clampNumber(referenceBpm, 30, 300, 120)
        : undefined,
    priority: 10
  }
}

function normalizeLoudnessRequest(raw: unknown): LoudnessAnalysisRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.trackId !== 'string' || typeof value.filePath !== 'string') return null
  return { trackId: value.trackId, filePath: value.filePath, priority: 10 }
}
