/**
 * Stage 1 — dynamic runtime capability manifest (shared protocol)
 *
 * The WindowAPI parity contract (`./windowApiParity.ts`) records how every
 * Electron `window.api` surface.method is transported under Tauri
 * (`tauri-invoke` / `tauri-native` / `tauri-stub` / `tauri-reject` /
 * `tauri-unmigrated`). This module turns that static contract plus runtime
 * facts into a *method-level* capability manifest:
 *
 * - Electron is the full-featured baseline: every method is `supported` and
 *   every component is `healthy` (`buildElectronBaselineManifest`).
 * - Tauri derives each method's state from its transport wiring
 *   (`buildRuntimeManifest`), then merges in the component-health probes the
 *   Rust `runtime_get_manifest` command returns (audio sidecar, plugin sidecar,
 *   provider gateway, font backend, authorized resources).
 * - `web` (plain browser, no bridge) reports every method `unsupported`.
 *
 * The renderer keeps the nine coarse-grained capability rows for display; this
 * module aggregates the method-level states back into those rows
 * (`runtimeCapabilitiesForManifest`), so the About page can show *specific*
 * missing methods and reasons instead of a static snapshot.
 *
 * The module is import-safe: it only imports from `./windowApiParity.ts` and
 * uses no browser/Node globals, so the same file type-checks under both
 * tsconfig.node.json and tsconfig.web.json and runs in plain `node --test`.
 */

import {
  getMainWindowApiMethods,
  getWindowApiMethod,
  type TauriTransport,
  type WindowApiPlatform
} from './windowApiParity.ts'

/** Bump when the manifest shape or the transport→state mapping changes. */
export const RUNTIME_MANIFEST_PROTOCOL_VERSION = 1

/** Host kinds the renderer can run under. `web` = plain browser (no bridge). */
export type RuntimeKind = 'electron' | 'tauri' | 'web'

/** Per-method capability state, derived from backend wiring + platform. */
export type RuntimeMethodState =
  | 'supported'
  | 'unavailable'
  | 'unsupported'
  | 'platform-inapplicable'

export interface RuntimeMethodCapability {
  surface: string
  method: string
  state: RuntimeMethodState
  /** Stable machine-readable reason, e.g. `transport-not-migrated`. */
  reasonCode: string
  /** Whether the method may become available without an app restart. */
  recoverable: boolean
  /** The backend that (would) serve this method, e.g. `tauri-command`. */
  backend: string
  /** ISO-8601 time the state was last checked. */
  checkedAt: string
  details?: string
}

export interface RuntimeSurfaceCapability {
  surface: string
  methods: RuntimeMethodCapability[]
}

export type RuntimeComponentState = 'healthy' | 'degraded' | 'unavailable' | 'unknown'

export const RUNTIME_COMPONENT_IDS = [
  'audioSidecar',
  'pluginSidecar',
  'providerGateway',
  'fontBackend',
  'authorizedResources'
] as const

export type RuntimeComponentId = (typeof RUNTIME_COMPONENT_IDS)[number]

export interface RuntimeComponentHealth {
  component: RuntimeComponentId
  state: RuntimeComponentState
  reasonCode: string
  message?: string
  checkedAt: string
}

export interface RuntimeManifest {
  protocolVersion: number
  runtimeKind: RuntimeKind
  os: string
  arch: string
  version: string
  checkedAt: string
  surfaces: RuntimeSurfaceCapability[]
  components: RuntimeComponentHealth[]
}

/**
 * The Rust `runtime_get_manifest` command payload: runtime facts + component
 * probes. Per-method states are derived on the renderer from the parity
 * contract so the transport mapping stays in a single source of truth.
 */
export interface RuntimeManifestProbe {
  os: string
  arch: string
  version: string
  checkedAt: string
  components: RuntimeComponentHealth[]
}

export const RUNTIME_REASON_CODES = {
  SUPPORTED: 'runtime-supported',
  TRANSPORT_STUBBED: 'transport-stubbed',
  TRANSPORT_REJECTED: 'transport-rejected',
  TRANSPORT_NOT_MIGRATED: 'transport-not-migrated',
  RUNTIME_NOT_SUPPORTED: 'runtime-not-supported',
  PLATFORM_INAPPLICABLE: 'platform-inapplicable',
  COMPONENT_HEALTHY: 'component-healthy',
  COMPONENT_DEGRADED: 'component-degraded',
  COMPONENT_UNAVAILABLE: 'component-unavailable',
  COMPONENT_UNKNOWN: 'component-unknown'
} as const

export const RUNTIME_BACKENDS = {
  ELECTRON_IPC: 'electron-ipc',
  TAURI_COMMAND: 'tauri-command',
  TAURI_NATIVE_API: 'tauri-native-api',
  TAURI_STUB: 'tauri-stub',
  TAURI_REJECT: 'tauri-reject',
  TAURI_UNMIGRATED: 'tauri-unmigrated',
  NONE: 'none'
} as const

function platformApplies(platform: WindowApiPlatform, isWindows: boolean): boolean {
  switch (platform) {
    case 'all':
      return true
    case 'win32':
      return isWindows
    case 'darwin':
      return !isWindows
    case 'linux':
      return !isWindows
  }
}

/** Map a Tauri bridge transport to a four-state method capability state. */
export function methodStateForTransport(
  transport: TauriTransport,
  opts: { isWindows?: boolean; platform?: WindowApiPlatform } = {}
): RuntimeMethodState {
  const isWindows = opts.isWindows ?? true
  if (opts.platform && !platformApplies(opts.platform, isWindows)) {
    return 'platform-inapplicable'
  }
  switch (transport) {
    case 'tauri-invoke':
    case 'tauri-native':
      return 'supported'
    case 'tauri-stub':
    case 'tauri-reject':
      return 'unavailable'
    case 'tauri-unmigrated':
      return 'unsupported'
  }
}

function backendForTransport(transport: TauriTransport): string {
  switch (transport) {
    case 'tauri-invoke':
      return RUNTIME_BACKENDS.TAURI_COMMAND
    case 'tauri-native':
      return RUNTIME_BACKENDS.TAURI_NATIVE_API
    case 'tauri-stub':
      return RUNTIME_BACKENDS.TAURI_STUB
    case 'tauri-reject':
      return RUNTIME_BACKENDS.TAURI_REJECT
    case 'tauri-unmigrated':
      return RUNTIME_BACKENDS.TAURI_UNMIGRATED
  }
}

function reasonForMethodState(state: RuntimeMethodState, transport: TauriTransport): string {
  switch (state) {
    case 'supported':
      return RUNTIME_REASON_CODES.SUPPORTED
    case 'unavailable':
      return transport === 'tauri-reject'
        ? RUNTIME_REASON_CODES.TRANSPORT_REJECTED
        : RUNTIME_REASON_CODES.TRANSPORT_STUBBED
    case 'unsupported':
      return RUNTIME_REASON_CODES.TRANSPORT_NOT_MIGRATED
    case 'platform-inapplicable':
      return RUNTIME_REASON_CODES.PLATFORM_INAPPLICABLE
  }
}

/** Human-readable method state, used by the About page detail rows. */
export function methodStateMessage(
  state: RuntimeMethodState,
  transport?: TauriTransport
): string {
  switch (state) {
    case 'supported':
      return '已支持'
    case 'unavailable':
      return transport === 'tauri-reject'
        ? '接口已声明，当前不可用'
        : '接口已声明，等待后端接通'
    case 'unsupported':
      return '尚未迁移'
    case 'platform-inapplicable':
      return '当前平台不适用'
  }
}

function defaultComponents(
  runtimeKind: RuntimeKind,
  checkedAt: string
): RuntimeComponentHealth[] {
  if (runtimeKind === 'electron') {
    return RUNTIME_COMPONENT_IDS.map((component) => ({
      component,
      state: 'healthy' as const,
      reasonCode: RUNTIME_REASON_CODES.COMPONENT_HEALTHY,
      checkedAt
    }))
  }
  return [
    {
      component: 'audioSidecar',
      state: 'unavailable',
      reasonCode: RUNTIME_REASON_CODES.COMPONENT_UNAVAILABLE,
      message: '音频引擎尚未在 Tauri 中提供',
      checkedAt
    },
    {
      component: 'pluginSidecar',
      state: 'unavailable',
      reasonCode: RUNTIME_REASON_CODES.COMPONENT_UNAVAILABLE,
      message: '插件独立 sidecar 尚未提供',
      checkedAt
    },
    {
      component: 'providerGateway',
      state: 'unavailable',
      reasonCode: RUNTIME_REASON_CODES.COMPONENT_UNAVAILABLE,
      message: 'Provider 网关未探测',
      checkedAt
    },
    {
      component: 'fontBackend',
      state: 'unavailable',
      reasonCode: RUNTIME_REASON_CODES.COMPONENT_UNAVAILABLE,
      message: '字体枚举尚未在 Tauri 中提供',
      checkedAt
    },
    {
      component: 'authorizedResources',
      state: 'unavailable',
      reasonCode: RUNTIME_REASON_CODES.COMPONENT_UNAVAILABLE,
      message: '资源授权未探测',
      checkedAt
    }
  ]
}

export interface RuntimeManifestInput {
  runtimeKind: RuntimeKind
  os: string
  arch: string
  version: string
  checkedAt: string
  components?: RuntimeComponentHealth[]
  isWindows?: boolean
}

/** Build the full method-level manifest from the parity contract + runtime facts. */
export function buildRuntimeManifest(input: RuntimeManifestInput): RuntimeManifest {
  const isWindows = input.isWindows ?? true
  const checkedAt = input.checkedAt
  const bySurface = new Map<string, RuntimeSurfaceCapability>()

  for (const key of getMainWindowApiMethods()) {
    const dot = key.indexOf('.')
    const surface = key.slice(0, dot)
    const method = key.slice(dot + 1)
    const record = getWindowApiMethod(surface, method)
    if (!record) continue

    let capability: RuntimeMethodCapability
    if (input.runtimeKind === 'electron') {
      capability = {
        surface,
        method,
        state: 'supported',
        reasonCode: RUNTIME_REASON_CODES.SUPPORTED,
        recoverable: false,
        backend: RUNTIME_BACKENDS.ELECTRON_IPC,
        checkedAt
      }
    } else if (input.runtimeKind === 'web') {
      capability = {
        surface,
        method,
        state: 'unsupported',
        reasonCode: RUNTIME_REASON_CODES.RUNTIME_NOT_SUPPORTED,
        recoverable: false,
        backend: RUNTIME_BACKENDS.NONE,
        checkedAt
      }
    } else {
      const state = methodStateForTransport(record.tauriTransport, {
        isWindows,
        platform: record.platform
      })
      capability = {
        surface,
        method,
        state,
        reasonCode: reasonForMethodState(state, record.tauriTransport),
        recoverable: state === 'unavailable',
        backend: backendForTransport(record.tauriTransport),
        checkedAt,
        ...(record.platform && record.platform !== 'all'
          ? { details: `平台 ${record.platform} 不适用` }
          : {})
      }
    }

    let bucket = bySurface.get(surface)
    if (!bucket) {
      bucket = { surface, methods: [] }
      bySurface.set(surface, bucket)
    }
    bucket.methods.push(capability)
  }

  return {
    protocolVersion: RUNTIME_MANIFEST_PROTOCOL_VERSION,
    runtimeKind: input.runtimeKind,
    os: input.os,
    arch: input.arch,
    version: input.version,
    checkedAt,
    surfaces: [...bySurface.values()],
    components: input.components ?? defaultComponents(input.runtimeKind, checkedAt)
  }
}

export interface RuntimeEnvironmentInfo {
  os?: string
  arch?: string
  version?: string
}

/** Electron baseline: the same protocol, every method supported, every component healthy. */
export function buildElectronBaselineManifest(
  env: RuntimeEnvironmentInfo,
  checkedAt: string
): RuntimeManifest {
  return buildRuntimeManifest({
    runtimeKind: 'electron',
    os: env.os ?? 'unknown',
    arch: env.arch ?? 'unknown',
    version: env.version ?? 'unknown',
    checkedAt
  })
}

/* ── Nine-capability aggregation (display layer) ───────────────────────── */

export type AggregateCapabilityStatus = 'supported' | 'partial' | 'unsupported'

export interface AggregateCapabilityState {
  id: string
  status: AggregateCapabilityStatus
  code: string
  message: string
}

export type AggregateCapabilities = Record<string, AggregateCapabilityState>

/** Capability id → WindowAPI surfaces whose methods contribute to it. */
export const RUNTIME_CAPABILITY_SURFACES: Record<string, readonly string[]> = {
  settings: ['settings'],
  data: ['data'],
  plugins: ['plugins'],
  providers: ['providers', 'providerDownloads'],
  extensions: ['extensions'],
  fonts: ['fonts'],
  themes: ['themes'],
  localLibrary: ['library', 'fs'],
  audioEngine: ['audioEngine', 'bpmAnalysis', 'loudnessAnalysis']
}

/** Aggregate the method-level manifest back into the nine display capabilities. */
export function runtimeCapabilitiesForManifest(manifest: RuntimeManifest): AggregateCapabilities {
  const bySurface = new Map(manifest.surfaces.map((surface) => [surface.surface, surface]))
  const out: AggregateCapabilities = {}
  for (const [id, surfaceNames] of Object.entries(RUNTIME_CAPABILITY_SURFACES)) {
    const methods: RuntimeMethodCapability[] = []
    for (const name of surfaceNames) {
      const bucket = bySurface.get(name)
      if (bucket) methods.push(...bucket.methods)
    }
    if (methods.length === 0) {
      out[id] = { id, status: 'unsupported', code: 'runtime-not-supported', message: '无相关能力' }
      continue
    }
    const supported = methods.filter((method) => method.state === 'supported')
    if (supported.length === methods.length) {
      out[id] = { id, status: 'supported', code: 'runtime-supported', message: '已支持' }
    } else if (supported.length > 0) {
      const unavailable = methods.filter((method) => method.state === 'unavailable').length
      const unsupported = methods.filter((method) => method.state === 'unsupported').length
      const inapplicable = methods.filter(
        (method) => method.state === 'platform-inapplicable'
      ).length
      const parts: string[] = []
      if (unavailable > 0) parts.push(`${unavailable} 项暂不可用`)
      if (unsupported > 0) parts.push(`${unsupported} 项未支持`)
      if (inapplicable > 0) parts.push(`${inapplicable} 项平台不适用`)
      out[id] = { id, status: 'partial', code: 'runtime-partial', message: parts.join('，') }
    } else {
      out[id] = {
        id,
        status: 'unsupported',
        code: 'runtime-not-supported',
        message: '当前运行时不支持'
      }
    }
  }
  return out
}

/** Non-supported methods feeding one capability, for the About page details. */
export function missingMethodsForCapability(
  manifest: RuntimeManifest,
  capabilityId: string
): RuntimeMethodCapability[] {
  const surfaceNames = RUNTIME_CAPABILITY_SURFACES[capabilityId] ?? []
  const bySurface = new Map(manifest.surfaces.map((surface) => [surface.surface, surface]))
  const missing: RuntimeMethodCapability[] = []
  for (const name of surfaceNames) {
    const bucket = bySurface.get(name)
    if (!bucket) continue
    for (const method of bucket.methods) {
      if (method.state !== 'supported') missing.push(method)
    }
  }
  return missing
}
