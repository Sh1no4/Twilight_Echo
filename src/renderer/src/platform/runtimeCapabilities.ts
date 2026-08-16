/**
 * Runtime capability matrix
 *
 * Twilight Echo runs on two hosts: the original Electron main process and the
 * emerging Tauri runtime. Electron is the full-featured baseline — every
 * capability in the matrix is implemented there. The Tauri runtime is migrated
 * capability-by-capability, so the renderer must be able to tell a real empty
 * result (e.g. Electron with no plugins installed) apart from a surface the
 * current runtime has not implemented yet (e.g. Tauri plugins).
 *
 * Stage 0 decision (recorded per plan): formal full-feature verification uses
 * Electron as the baseline until Tauri reaches the agreed capability threshold.
 * The Electron matrix below is therefore all `supported`; the Tauri matrix lists
 * only what tauriHostBridge actually implements, and the UI consults this module
 * instead of trusting a business empty array.
 */

import {
  buildElectronBaselineManifest,
  buildRuntimeManifest,
  type RuntimeEnvironmentInfo,
  type RuntimeKind,
  type RuntimeManifest,
  type RuntimeManifestProbe
} from '../../../shared/runtimeManifest.ts'

export const RUNTIME_CAPABILITY_IDS = [
  'settings',
  'data',
  'plugins',
  'providers',
  'extensions',
  'fonts',
  'themes',
  'localLibrary',
  'audioEngine'
] as const

export type RuntimeCapabilityId = (typeof RUNTIME_CAPABILITY_IDS)[number]

export type CapabilityStatus = 'supported' | 'partial' | 'unsupported'

export interface CapabilityState {
  id: RuntimeCapabilityId
  status: CapabilityStatus
  /** Stable machine-readable status code, e.g. `runtime-not-supported`. */
  code: string
  /** Human-readable status in the UI locale. */
  message: string
}

export type RuntimeCapabilities = Record<RuntimeCapabilityId, CapabilityState>

/** Error code shared by every capability error thrown for an unimplemented surface. */
export const UNSUPPORTED_CAPABILITY_CODE = 'runtime-not-supported'

/** Thrown by tauriHostBridge stubs instead of returning a fake business result. */
export class RuntimeCapabilityError extends Error {
  readonly capability: RuntimeCapabilityId
  readonly surface?: string
  readonly method?: string
  readonly reasonCode: string
  readonly recoverable: boolean
  readonly code: string

  constructor(
    capability: RuntimeCapabilityId,
    message?: string,
    details: {
      surface?: string
      method?: string
      reasonCode?: string
      recoverable?: boolean
    } = {}
  ) {
    super(message ?? `当前运行时不支持「${CAPABILITY_LABELS[capability]}」`)
    this.name = 'RuntimeCapabilityError'
    this.capability = capability
    this.surface = details.surface
    this.method = details.method
    this.reasonCode = details.reasonCode ?? UNSUPPORTED_CAPABILITY_CODE
    this.recoverable = details.recoverable ?? false
    this.code = this.reasonCode
  }
}

export function isRuntimeCapabilityError(error: unknown): error is RuntimeCapabilityError {
  return (
    error instanceof Error && (error as RuntimeCapabilityError).code === UNSUPPORTED_CAPABILITY_CODE
  )
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/* ── Stage 1: three-state runtime kind + dynamic method-level manifest ─── */

/**
 * Distinguish the three host kinds explicitly. `isTauriRuntime()` (above)
 * only selects the Tauri transport — it no longer implies "not Tauri means
 * Electron". `window.api` is the Electron preload bridge; the Tauri bridge
 * also installs `window.api`, but Tauri is detected first by its internals
 * marker, so a plain browser (no preload, no internals) is reported as `web`.
 */
export function getRuntimeKind(): RuntimeKind {
  if (typeof window === 'undefined') return 'web'
  if ('__TAURI_INTERNALS__' in window) return 'tauri'
  if ('api' in window && window.api && typeof window.api === 'object') return 'electron'
  return 'web'
}

/** Best-effort OS/arch facts for the Electron baseline manifest. */
function runtimeEnvironmentInfo(): RuntimeEnvironmentInfo {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  let arch = 'unknown'
  if (/arm64|aarch64/i.test(userAgent)) arch = 'arm64'
  else if (/WOW64|Win64|x86_64|x64/i.test(userAgent)) arch = 'x64'
  return {
    os: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
    arch,
    version: 'unknown'
  }
}

let runtimeManifestPromise: Promise<RuntimeManifest> | null = null

/**
 * Load the runtime capability manifest once and reuse it.
 *
 * - Tauri invokes the `runtime_get_manifest` command (runtime facts + component
 *   probes) and derives per-method states from the parity contract via
 *   `buildRuntimeManifest`. `@tauri-apps/api/core` is imported lazily so this
 *   module stays import-safe under `node --test` and the `web` tsconfig.
 * - Electron builds the same protocol as a full-featured baseline with every
 *   method `supported` and every component `healthy`.
 * - A plain browser reports every method `unsupported`.
 */
export function loadRuntimeManifest(): Promise<RuntimeManifest> {
  runtimeManifestPromise ??= createRuntimeManifest()
  return runtimeManifestPromise
}

async function createRuntimeManifest(): Promise<RuntimeManifest> {
  const kind = getRuntimeKind()
  if (kind === 'tauri') {
    const { invoke } = await import('@tauri-apps/api/core')
    const probe = await invoke<RuntimeManifestProbe>('runtime_get_manifest')
    return buildRuntimeManifest({ runtimeKind: 'tauri', ...probe })
  }
  const checkedAt = new Date().toISOString()
  if (kind === 'electron') {
    return buildElectronBaselineManifest(runtimeEnvironmentInfo(), checkedAt)
  }
  return buildRuntimeManifest({
    runtimeKind: 'web',
    os: 'unknown',
    arch: 'unknown',
    version: 'unknown',
    checkedAt
  })
}

export function isRuntimeMethodSupported(
  manifest: RuntimeManifest,
  surface: string,
  method: string
): boolean {
  return manifest.surfaces
    .find((entry) => entry.surface === surface)
    ?.methods.some((entry) => entry.method === method && entry.state === 'supported') ?? false
}
export const CAPABILITY_LABELS: Record<RuntimeCapabilityId, string> = {
  settings: '设置',
  data: '数据',
  plugins: '插件',
  providers: '在线音源',
  extensions: '扩展',
  fonts: '字体',
  themes: '主题',
  localLibrary: '本地音乐库',
  audioEngine: '音频引擎'
}

function supported(id: RuntimeCapabilityId): CapabilityState {
  return { id, status: 'supported', code: 'runtime-supported', message: '已支持' }
}

function partial(id: RuntimeCapabilityId, message: string): CapabilityState {
  return { id, status: 'partial', code: 'runtime-partial', message }
}

const ELECTRON_CAPABILITIES: RuntimeCapabilities = {
  settings: supported('settings'),
  data: supported('data'),
  plugins: supported('plugins'),
  providers: supported('providers'),
  extensions: supported('extensions'),
  fonts: supported('fonts'),
  themes: supported('themes'),
  localLibrary: supported('localLibrary'),
  audioEngine: supported('audioEngine')
}

const TAURI_CAPABILITIES: RuntimeCapabilities = {
  // settings_get / settings_update / getCacheSize / clearCache / getShortcutStatuses
  // are real Tauri commands; change events are real. Dialog/background/backup
  // sub-surfaces still reject until their system-integration backends land.
  settings: partial('settings', '基础设置已支持；缓存目录/备份选择待接通'),
  // Music library, playback session, playlists, lyrics management and playback
  // bookmarks all persist through real versioned-envelope commands.
  data: partial('data', '音乐库与会话/歌单/歌词/书签持久化已支持'),
  plugins: partial('plugins', '已支持插件安装/启停/卸载/日志、市场索引与宿主 sidecar 激活'),
  providers: partial('providers', '已支持经插件宿主 sidecar 的调用/取消与健康记录（内置网易云插件在 Node 宿主中执行）'),
  extensions: partial('extensions', '已支持经宿主的命令执行与注册主题样式读取'),
  // Windows registry font enumeration is a real command; import/export/asset
  // dialog surfaces of themes still reject.
  fonts: partial('fonts', '系统字体枚举已支持'),
  // Theme library CRUD (save/delete/setActive/inheritance) and change events are
  // real; import/export/asset (zip boundary) still reject.
  themes: partial('themes', '主题库编辑已支持；导入导出与资源待接通'),
  // Startup/full scan now run in Rust with real metadata (lofty); incremental
  // added/updated/removed reconciliation, progress/status/change events,
  // remove/restore/reset, authorized reads (fs_read_audio_file), and the
  // cover:// disk cache (data.getCover) are wired. The OS-level watcher, tag
  // writer and duplicate detection still live under Electron only.
  localLibrary: partial('localLibrary', '本地曲库扫描、增量变更、授权读取与封面缓存已接通；文件监控与标签写入待接通'),
  // Stage 6A+6B wired the audio runtime through a Node sidecar: queue/play/
  // pause/stop/seek/next, volume/rate, output routing, DSP scenes, playback
  // events, the VST3 catalog, DSP asset import/export, BPM/loudness analysis
  // and diagnostics are all real. When the native addon is not bundled, the
  // engine honestly reports unavailable (structured native-unavailable) and
  // playback falls back to HTMLAudio.
  audioEngine: partial('audioEngine', '基础播放/输出/DSP 场景、VST3 目录、DSP 资产、BPM/响度分析与诊断导出已接通；原生引擎未随包时走 HTML 兜底并如实报告 unavailable')
}

export function getRuntimeCapabilities(isTauri: boolean = isTauriRuntime()): RuntimeCapabilities {
  return isTauri ? TAURI_CAPABILITIES : ELECTRON_CAPABILITIES
}

export function getCapabilityState(
  id: RuntimeCapabilityId,
  isTauri: boolean = isTauriRuntime()
): CapabilityState {
  return getRuntimeCapabilities(isTauri)[id]
}

export function isCapabilitySupported(
  id: RuntimeCapabilityId,
  isTauri: boolean = isTauriRuntime()
): boolean {
  return getCapabilityState(id, isTauri).status === 'supported'
}
