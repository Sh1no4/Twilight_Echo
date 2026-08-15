/**
 * 旧数据迁移的共享契约（Stage 2）。
 *
 * 目标：把 legacy 扁平数据根（如 `%APPDATA%\TwilightEcho`）迁移到分类目录，
 * 采用 `detect -> stage copy -> validate -> manifest -> atomic switch`：
 *
 * - 迁移源始终是 legacy 数据根；迁移期间与完成后都不删除、不移动源数据，
 *   旧目录作为只读备份保留，清理是后续独立操作。
 * - `standard` / `fallback` 模式沿用扁平路径（迁移目标就是源路径本身），
 *   视为 `not-needed`，不写入任何清单文件。
 * - `portable` 模式把 legacy 数据补齐到 `data/{category}/` 分类目录；目标已有
 *   相同内容则跳过，内容不同则记录冲突，绝不静默覆盖。
 * - 幂等：`completed` 清单存在时不再执行；`pending` / `failed` / 缺失清单时
 *   基于清单逐条续跑（已完成的条目在重跑时自然变成 skipped-exists）。
 * - 完整性：每个文件用 sha256 校验，先写 `*.migrating` 暂存再原子改名落位。
 *
 * 本模块只定义类型、常量与守卫，不 import node 内置模块；Electron 与
 * Tauri 的诊断结果共享这套表示。
 */
import { DATA_ROOT_CATEGORIES, type DataRootCategory, type DataRootMode } from './pathPolicy.ts'

/** 清单文件本身的 schema 版本。 */
export const DATA_MIGRATION_SCHEMA_VERSION = 1

/**
 * 迁移器版本。每次迁移规则（清单、分类、校验方式）变化时递增；版本不符的
 * 旧清单会被视为不存在而重新执行幂等迁移，用于让已迁移用户按新规则补缺。
 */
export const DATA_MIGRATION_ENGINE_VERSION = 1

/** 迁移清单文件名，写入 legacy 数据根（迁移源）。 */
export const MIGRATION_MANIFEST_FILE = 'migration-manifest.json'

/** 迁移整体状态。 */
export type DataMigrationStatus = 'not-needed' | 'pending' | 'completed' | 'failed'

/** 单条数据项迁移结果。 */
export type DataMigrationEntryStatus =
  | 'pending'
  | 'copied'
  | 'skipped-exists'
  | 'skipped-conflict'
  | 'skipped-source-missing'
  | 'skipped-discardable'
  | 'failed'

export interface DataMigrationEntry {
  /** 归入的目标分类目录。 */
  category: DataRootCategory
  /** 相对 legacy 数据根的源路径（如 `music-library.json`、`plugins`）。 */
  sourceRelative: string
  /** 迁移目标绝对路径。 */
  targetPath: string
  kind: 'file' | 'directory'
  status: DataMigrationEntryStatus
  /** 源文件字节数；目录为 0。 */
  size: number
  /** 源文件 sha256 hex（目录条目为 undefined）。 */
  checksum?: string
  /** 冲突 / 失败原因（机器可读 short code）。 */
  error?: string
  /** 该条目属于可丢弃内容（缓存/日志），默认不迁移。 */
  discardable?: boolean
}

export interface DataMigrationManifest {
  schemaVersion: number
  engineVersion: number
  /** 迁移发生时的路径模式（只有 portable 才会真正迁移）。 */
  mode: DataRootMode
  /** legacy 数据根（迁移源）。 */
  sourceRoot: string
  status: DataMigrationStatus
  startedAt: string
  completedAt?: string
  /** 上次失败摘要，便于诊断。 */
  failure?: string
  entries: DataMigrationEntry[]
}

/** 暴露给 settings 诊断快照的迁移摘要。 */
export interface DataMigrationDiagnostics {
  status: DataMigrationStatus
  mode: DataRootMode
  sourceRoot: string
  engineVersion: number
  /** legacy 数据根下的清单文件绝对路径；未写入时为 null。 */
  manifestFile: string | null
  /** 实际复制（copied）的字节总数。 */
  migratedBytes: number
  copiedEntries: number
  conflictEntries: number
  failedEntries: number
  /** 上次失败摘要（仅 failed 时有值）。 */
  failure?: string
}

const DATA_MIGRATION_STATUSES: readonly DataMigrationStatus[] = [
  'not-needed',
  'pending',
  'completed',
  'failed'
]

const DATA_MIGRATION_ENTRY_STATUSES: readonly DataMigrationEntryStatus[] = [
  'pending',
  'copied',
  'skipped-exists',
  'skipped-conflict',
  'skipped-source-missing',
  'skipped-discardable',
  'failed'
]

export function isDataMigrationEntry(value: unknown): value is DataMigrationEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (
    typeof record.category !== 'string' ||
    !DATA_ROOT_CATEGORIES.includes(record.category as DataRootCategory)
  ) {
    return false
  }
  if (typeof record.sourceRelative !== 'string' || typeof record.targetPath !== 'string') {
    return false
  }
  if (record.kind !== 'file' && record.kind !== 'directory') return false
  if (typeof record.status !== 'string') return false
  if (!DATA_MIGRATION_ENTRY_STATUSES.includes(record.status as DataMigrationEntryStatus)) {
    return false
  }
  if (typeof record.size !== 'number' || !Number.isSafeInteger(record.size) || record.size < 0) {
    return false
  }
  if (record.checksum !== undefined && typeof record.checksum !== 'string') return false
  if (record.error !== undefined && typeof record.error !== 'string') return false
  return true
}

export function isDataMigrationManifest(value: unknown): value is DataMigrationManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== DATA_MIGRATION_SCHEMA_VERSION) return false
  if (record.engineVersion !== DATA_MIGRATION_ENGINE_VERSION) return false
  if (typeof record.mode !== 'string') return false
  if (!['standard', 'portable', 'fallback'].includes(record.mode)) return false
  if (typeof record.sourceRoot !== 'string') return false
  if (typeof record.status !== 'string') return false
  if (!DATA_MIGRATION_STATUSES.includes(record.status as DataMigrationStatus)) return false
  if (typeof record.startedAt !== 'string') return false
  if (record.completedAt !== undefined && typeof record.completedAt !== 'string') return false
  if (record.failure !== undefined && typeof record.failure !== 'string') return false
  if (!Array.isArray(record.entries)) return false
  return record.entries.every(isDataMigrationEntry)
}

export function isDataMigrationDiagnostics(value: unknown): value is DataMigrationDiagnostics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.status !== 'string') return false
  if (!DATA_MIGRATION_STATUSES.includes(record.status as DataMigrationStatus)) return false
  if (typeof record.mode !== 'string') return false
  if (!['standard', 'portable', 'fallback'].includes(record.mode)) return false
  if (typeof record.sourceRoot !== 'string') return false
  if (typeof record.engineVersion !== 'number') return false
  if (record.manifestFile !== null && typeof record.manifestFile !== 'string') return false
  for (const key of [
    'migratedBytes',
    'copiedEntries',
    'conflictEntries',
    'failedEntries'
  ] as const) {
    if (typeof record[key] !== 'number' || !Number.isSafeInteger(record[key])) return false
  }
  if (record.failure !== undefined && typeof record.failure !== 'string') return false
  return true
}
