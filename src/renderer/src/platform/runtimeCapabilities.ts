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
  readonly code: string

  constructor(capability: RuntimeCapabilityId, message?: string) {
    super(message ?? `当前运行时不支持「${CAPABILITY_LABELS[capability]}」`)
    this.name = 'RuntimeCapabilityError'
    this.capability = capability
    this.code = UNSUPPORTED_CAPABILITY_CODE
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

const CAPABILITY_LABELS: Record<RuntimeCapabilityId, string> = {
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

function unsupported(id: RuntimeCapabilityId): CapabilityState {
  return {
    id,
    status: 'unsupported',
    code: UNSUPPORTED_CAPABILITY_CODE,
    message: `当前运行时不支持「${CAPABILITY_LABELS[id]}」`
  }
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
  // settings_get / settings_update are real Tauri commands.
  settings: supported('settings'),
  // loadMusicLibrary / saveMusicLibrary are real; playback session and
  // playlists remain stub shapes until their commands are migrated.
  data: partial('data', '音乐库已支持；播放状态与歌单待迁移'),
  plugins: partial('plugins', '已支持插件安装/启停/卸载/日志与市场索引'),
  providers: partial('providers', '已支持调用/取消与健康记录；网易云网关在 Tauri 不可用'),
  extensions: partial('extensions', '已支持扩展列表；命令执行与主题样式读取接口已接通'),
  fonts: unsupported('fonts'),
  // getBootstrap / getSystemTone are real; library edits return an empty
  // default snapshot until the theme persistence commands are migrated.
  themes: partial('themes', '启动主题已支持；主题库编辑待迁移'),
  // Startup scan surfaces exist but report an idle/noop state; no real scan
  // runs until the library scan command is migrated.
  localLibrary: partial('localLibrary', '本地音乐库尚未接入真实扫描'),
  // Getters return standby defaults to keep polling loops crash-free; the
  // native engine itself only runs under Electron.
  audioEngine: partial('audioEngine', '音频引擎仅在完整运行时中可用')
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
