/**
 * 数据根目录与分类目录路径策略（Stage 1）。
 *
 * 纯函数/可注入实现：本模块不 import electron，所有外部事实（argv、exe 目录、
 * standard 用户目录、文件系统探针）都由调用方传入。Electron 适配器位于
 * `src/main/core/settings.ts` 模块作用域，Tauri 侧在 `src-tauri` 中实现同样的
 * 解析规则。这样单元测试可以脱离 Electron 运行，且 Electron/Tauri 行为一致。
 */
import { accessSync, constants, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DATA_ROOT_CATEGORIES,
  type DataRootCategory,
  type DataRootDiagnostics,
  type DataRootDetectionSource,
  type DataRootFallbackReason
} from '../../shared/pathPolicy.ts'

export const PORTABLE_LAUNCH_FLAG = '--portable'
export const PORTABLE_MARKER_FILE = '.portable'
export const PORTABLE_DATA_DIR = 'data'

export interface PathPolicyInput {
  /** 进程启动参数（Electron: process.argv）。 */
  argv: readonly string[]
  /** 可执行文件所在目录；不可解析时传 null。 */
  exeDir: string | null
  /** 普通安装模式的用户数据根（Electron: app.getPath('userData')）。 */
  standardUserData: string
  /** 显式 Portable 发行形态（打包产物强制 portable）。 */
  forcePortable?: boolean
  portableFlag?: string
  markerFileName?: string
  dataDirName?: string
  /** 探针注入点，默认走真实文件系统。 */
  hasFile?: (filePath: string) => boolean
  hasDirectory?: (dirPath: string) => boolean
  ensureDirectory?: (dirPath: string) => boolean
  probeWritable?: (dirPath: string) => boolean
}

export interface PathPolicy extends DataRootDiagnostics {}

export function defaultHasFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export function defaultHasDirectory(dirPath: string): boolean {
  try {
    return statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

export function defaultEnsureDirectory(dirPath: string): boolean {
  try {
    mkdirSync(dirPath, { recursive: true })
    return true
  } catch {
    return false
  }
}

/**
 * 默认可写性探测：目录存在后尝试写入并删除一个探针文件。
 * Windows 上 ACL 只读目录在 `accessSync(W_OK)` 下不可靠，写入探测最接近真实结果。
 */
export function defaultProbeWritable(dirPath: string): boolean {
  try {
    mkdirSync(dirPath, { recursive: true })
    const probeFile = join(dirPath, `.twilight-write-probe-${process.pid}`)
    writeFileSync(probeFile, '', { flag: 'w' })
    rmSync(probeFile, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * 判定是否请求 Portable 模式及来源。优先级：显式发行形态 > 启动参数 > exe 同级
 * `.portable` 标记文件 > exe 同级已存在的 `data/` 目录。
 */
export function detectPortableRequest(input: PathPolicyInput): {
  portable: boolean
  source: DataRootDetectionSource
} {
  if (input.forcePortable) return { portable: true, source: 'explicit-build' }
  const flag = input.portableFlag ?? PORTABLE_LAUNCH_FLAG
  if (input.argv.includes(flag)) return { portable: true, source: 'launch-arg' }
  if (input.exeDir) {
    const hasFile = input.hasFile ?? defaultHasFile
    if (hasFile(join(input.exeDir, input.markerFileName ?? PORTABLE_MARKER_FILE))) {
      return { portable: true, source: 'marker-file' }
    }
    const hasDirectory = input.hasDirectory ?? defaultHasDirectory
    if (hasDirectory(join(input.exeDir, input.dataDirName ?? PORTABLE_DATA_DIR))) {
      return { portable: true, source: 'marker-directory' }
    }
  }
  return { portable: false, source: 'none' }
}

function buildCategories(root: string): Record<DataRootCategory, string> {
  const categories = {} as Record<DataRootCategory, string>
  for (const category of DATA_ROOT_CATEGORIES) {
    categories[category] = join(root, category)
  }
  return categories
}

interface WritableProbeResult {
  writable: boolean
  writableCategories: Record<DataRootCategory, boolean>
  failedCategories: DataRootCategory[]
}

function ensureAndProbe(
  root: string,
  categories: Record<DataRootCategory, string>,
  ensureDirectory: (dir: string) => boolean,
  probeWritable: (dir: string) => boolean
): WritableProbeResult {
  ensureDirectory(root)
  const writableCategories = {} as Record<DataRootCategory, boolean>
  const failedCategories: DataRootCategory[] = []
  for (const category of DATA_ROOT_CATEGORIES) {
    const ok = ensureDirectory(categories[category]) && probeWritable(categories[category])
    writableCategories[category] = ok
    if (!ok) failedCategories.push(category)
  }
  return { writable: probeWritable(root), writableCategories, failedCategories }
}

/**
 * 解析路径策略。调用顺序：检测模式 -> 构建分类目录 -> 创建目录 -> 探测可写性 ->
 * portable 不可用时回退到 standard（记录原因）。
 */
export function resolvePathPolicy(input: PathPolicyInput): PathPolicy {
  const ensureDirectory = input.ensureDirectory ?? defaultEnsureDirectory
  const probeWritable = input.probeWritable ?? defaultProbeWritable
  const standardRoot = resolve(input.standardUserData)
  const standardCategories = buildCategories(standardRoot)
  const standardProbe = ensureAndProbe(
    standardRoot,
    standardCategories,
    ensureDirectory,
    probeWritable
  )

  const { portable, source } = detectPortableRequest(input)

  if (!portable) {
    return {
      mode: 'standard',
      portableRequested: false,
      detectionSource: 'none',
      dataRoot: standardRoot,
      standardRoot,
      categories: standardCategories,
      writable: standardProbe.writable,
      writableCategories: standardProbe.writableCategories,
      fallbackReason: null
    }
  }

  if (!input.exeDir) {
    return {
      mode: 'fallback',
      portableRequested: true,
      detectionSource: source,
      dataRoot: standardRoot,
      standardRoot,
      categories: standardCategories,
      writable: standardProbe.writable,
      writableCategories: standardProbe.writableCategories,
      fallbackReason: 'exe-dir-unresolvable'
    }
  }

  const exeDir = resolve(input.exeDir)
  const dataRoot = join(exeDir, input.dataDirName ?? PORTABLE_DATA_DIR)
  const portableCategories = buildCategories(dataRoot)
  const portableProbe = ensureAndProbe(dataRoot, portableCategories, ensureDirectory, probeWritable)

  if (portableProbe.writable && portableProbe.failedCategories.length === 0) {
    return {
      mode: 'portable',
      portableRequested: true,
      detectionSource: source,
      dataRoot,
      standardRoot,
      categories: portableCategories,
      writable: true,
      writableCategories: portableProbe.writableCategories,
      fallbackReason: null
    }
  }

  const fallbackReason: DataRootFallbackReason = portableProbe.writable
    ? 'category-not-writable'
    : 'data-dir-not-writable'
  return {
    mode: 'fallback',
    portableRequested: true,
    detectionSource: source,
    dataRoot: standardRoot,
    standardRoot,
    categories: standardCategories,
    writable: standardProbe.writable,
    writableCategories: standardProbe.writableCategories,
    fallbackReason
  }
}

export function isPortableMode(policy: PathPolicy): boolean {
  return policy.mode === 'portable'
}

/**
 * 解析具体数据文件路径。portable 模式落到 `data/{category}/` 分类目录；
 * standard/fallback 沿用既有扁平路径（`standardRoot/…`），保证旧安装不被移动。
 */
export function getCategorizedDataPath(
  policy: PathPolicy,
  category: DataRootCategory,
  ...segments: string[]
): string {
  const base = policy.mode === 'portable' ? policy.categories[category] : policy.standardRoot
  return segments.length > 0 ? join(base, ...segments) : base
}

/**
 * 解析分类目录下的应用数据路径，与 `getCategorizedDataPath` 互补：
 *
 * - `portable`：`data/{category}/{portableSegments…}`，与 `getCategorizedDataPath`
 *   一致，但允许目标就是分类目录本身（`portableSegments` 为空数组，例如
 *   plugins 目录、plugin-data 目录、logs 目录）。
 * - `standard` / `fallback`：`{standardRoot}/{legacyRelative}`，沿用 legacy
 *   扁平布局（例如 `standardRoot/plugins`、`standardRoot/logs/plugins`），
 *   保证旧安装路径不变。
 *
 * 迁移引擎与插件/主题路径路由使用同一入口，保证"迁移目标"与"应用实际读取
 * 路径"永远一致。
 */
export function getCategorizedAppPath(
  policy: PathPolicy,
  category: DataRootCategory,
  portableSegments: readonly string[],
  legacyRelative: string
): string {
  if (policy.mode === 'portable') {
    return portableSegments.length > 0
      ? join(policy.categories[category], ...portableSegments)
      : policy.categories[category]
  }
  return legacyRelative ? join(policy.standardRoot, legacyRelative) : policy.standardRoot
}
