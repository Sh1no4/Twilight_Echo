/**
 * 旧数据迁移引擎（Stage 2，Electron 主进程侧）。
 *
 * 纯函数/可注入实现：本模块不 import electron，文件系统操作、时间、路径策略
 * 全部由调用方传入，单元测试可脱离 Electron 运行（与 `pathPolicy.ts` 同一套
 * DI 约定）。
 *
 * 执行模型：`detect -> stage copy -> validate -> manifest -> atomic switch`
 *
 * 1. `detect`：读取 legacy 数据根下的 `migration-manifest.json`；`completed`
 *    清单直接返回（幂等门）；standard/fallback 模式永不迁移（返回 not-needed）。
 * 2. `stage copy -> validate`：每个文件先复制到 `{target}.migrating`，校验
 *    sha256 与源一致后 `rename` 原子落位；中途崩溃只留下可重做的暂存文件，
 *    不会损坏源数据。
 * 3. `manifest -> atomic switch`：先写 `pending` 清单作为崩溃日志，全部条目
 *    处理完后写 `completed` / `failed` 终态清单；`completed` 才代表"迁移完成"。
 * 4. 幂等重试：`pending` / `failed` / 缺失清单时逐条续跑，已落位的文件在重跑
 *    时自然变成 `skipped-exists`。
 *
 * 迁移源（legacy 数据根）在迁移期间与完成后都保留原样，作为只读备份；清理
 * 是后续独立操作。
 */
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DATA_MIGRATION_ENGINE_VERSION,
  DATA_MIGRATION_SCHEMA_VERSION,
  MIGRATION_MANIFEST_FILE,
  type DataMigrationDiagnostics,
  type DataMigrationEntry,
  type DataMigrationManifest,
  isDataMigrationManifest
} from '../../shared/dataMigration.ts'
import type { DataRootCategory } from '../../shared/pathPolicy.ts'
import { getCategorizedAppPath, type PathPolicy } from './pathPolicy.ts'

/** 暂存文件后缀（`{target}.migrating`）。 */
export const MIGRATION_STAGING_SUFFIX = '.migrating'

export const MAX_MIGRATION_ENTRIES = 50000

export type MigrationFileKind = 'file' | 'directory' | 'symlink' | 'other'

export interface MigrationFs {
  ensureDirectory(path: string): boolean
  readFileBytes(path: string): Buffer | null
  writeFileBytes(path: string, data: Buffer): boolean
  fileSize(path: string): number
  copyFile(source: string, target: string): boolean
  rename(source: string, target: string): boolean
  remove(path: string): boolean
  listDir(path: string): string[] | null
  stat(path: string): { kind: MigrationFileKind } | null
  checksum(data: Buffer): string
}

export interface MigrationInventoryItem {
  category: DataRootCategory
  /** 相对 legacy 数据根的源路径（如 `music-library.json`、`plugins`）。 */
  legacyRelative: string
  /** portable 模式下相对分类目录家的路径（可空数组表示分类目录本身）。 */
  portableSegments: readonly string[]
  kind: 'file' | 'directory'
  /** 可丢弃内容（缓存/日志/暂存），默认不迁移。 */
  discardable?: boolean
}

/**
 * 持久数据清单：settings、音乐库、播放状态、歌单、歌词管理、收藏、主题、
 * 插件状态与插件数据。tag-backups 与 plugins/plugin-data 目录递归展开为逐文件条目。
 */
const PERSISTENT_MIGRATION_INVENTORY: readonly MigrationInventoryItem[] = [
  {
    category: 'config',
    legacyRelative: 'settings.json',
    portableSegments: ['settings.json'],
    kind: 'file'
  },
  {
    category: 'database',
    legacyRelative: 'music-library.json',
    portableSegments: ['music-library.json'],
    kind: 'file'
  },
  {
    category: 'database',
    legacyRelative: 'ncm-cookie.json',
    portableSegments: ['ncm-cookie.json'],
    kind: 'file'
  },
  {
    category: 'database',
    legacyRelative: 'playback-session.json',
    portableSegments: ['playback-session.json'],
    kind: 'file'
  },
  {
    category: 'database',
    legacyRelative: 'playlists.json',
    portableSegments: ['playlists.json'],
    kind: 'file'
  },
  {
    category: 'database',
    legacyRelative: 'lyrics-management.json',
    portableSegments: ['lyrics-management.json'],
    kind: 'file'
  },
  {
    category: 'database',
    legacyRelative: 'playback-bookmarks.json',
    portableSegments: ['playback-bookmarks.json'],
    kind: 'file'
  },
  {
    category: 'database',
    legacyRelative: 'themes.json',
    portableSegments: ['themes.json'],
    kind: 'file'
  },
  {
    category: 'database',
    legacyRelative: 'tag-backups',
    portableSegments: ['tag-backups'],
    kind: 'directory'
  },
  {
    category: 'database',
    legacyRelative: 'theme-assets',
    portableSegments: ['theme-assets'],
    kind: 'directory'
  },
  {
    category: 'plugins',
    legacyRelative: 'plugin-state.json',
    portableSegments: ['plugin-state.json'],
    kind: 'file'
  },
  { category: 'plugins', legacyRelative: 'plugins', portableSegments: [], kind: 'directory' },
  {
    category: 'plugin-data',
    legacyRelative: 'plugin-data',
    portableSegments: [],
    kind: 'directory'
  }
]

/** 可丢弃内容：缓存、日志、插件暂存。默认跳过，只记录，不迁移。 */
const DISCARDABLE_MIGRATION_INVENTORY: readonly MigrationInventoryItem[] = [
  {
    category: 'cache',
    legacyRelative: 'music-cache',
    portableSegments: ['music-cache'],
    kind: 'directory',
    discardable: true
  },
  {
    category: 'cache',
    legacyRelative: 'plugin-staging',
    portableSegments: ['plugin-staging'],
    kind: 'directory',
    discardable: true
  },
  {
    category: 'logs',
    legacyRelative: 'logs',
    portableSegments: [],
    kind: 'directory',
    discardable: true
  }
]

export const MIGRATION_INVENTORY: readonly MigrationInventoryItem[] = [
  ...PERSISTENT_MIGRATION_INVENTORY,
  ...DISCARDABLE_MIGRATION_INVENTORY
]

export interface DataMigrationOptions {
  /** 当前路径策略。只有 `portable` 模式会真正迁移。 */
  policy: PathPolicy
  /** legacy 数据根（迁移源），通常为 `policy.standardRoot`。 */
  legacyRoot: string
  fs?: Partial<MigrationFs>
  now?: () => string
  maxEntries?: number
}

function defaultChecksum(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function defaultStat(path: string): { kind: MigrationFileKind } | null {
  try {
    const info = lstatSync(path)
    if (info.isSymbolicLink()) return { kind: 'symlink' }
    if (info.isFile()) return { kind: 'file' }
    if (info.isDirectory()) return { kind: 'directory' }
    return { kind: 'other' }
  } catch {
    return null
  }
}

function defaultFileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return -1
  }
}

export function defaultMigrationFs(): MigrationFs {
  return {
    ensureDirectory: (path) => {
      try {
        mkdirSync(path, { recursive: true })
        return true
      } catch {
        return false
      }
    },
    readFileBytes: (path) => {
      try {
        return readFileSync(path)
      } catch {
        return null
      }
    },
    writeFileBytes: (path, data) => {
      try {
        writeFileSync(path, data)
        return true
      } catch {
        return false
      }
    },
    fileSize: defaultFileSize,
    copyFile: (source, target) => {
      try {
        copyFileSync(source, target)
        return true
      } catch {
        return false
      }
    },
    rename: (source, target) => {
      try {
        renameSync(source, target)
        return true
      } catch {
        return false
      }
    },
    remove: (path) => {
      try {
        rmSync(path, { force: true, recursive: true })
        return true
      } catch {
        return false
      }
    },
    listDir: (path) => {
      try {
        return readdirSync(path)
      } catch {
        return null
      }
    },
    stat: defaultStat,
    checksum: defaultChecksum
  }
}

/** 计算单条目的目标路径：portable 落到分类目录，standard/fallback 沿用 legacy 扁平路径。 */
function entryTargetPath(policy: PathPolicy, item: MigrationInventoryItem): string {
  return getCategorizedAppPath(policy, item.category, item.portableSegments, item.legacyRelative)
}

function normalizeRelative(relative: string): string {
  return relative.replaceAll('\\', '/')
}

function makePendingEntry(
  item: MigrationInventoryItem,
  sourceRelative: string,
  kind: 'file' | 'directory',
  targetPath: string
): DataMigrationEntry {
  return {
    category: item.category,
    sourceRelative,
    targetPath,
    kind,
    status: 'pending',
    size: 0,
    discardable: item.discardable
  }
}

/** 递归把目录条目展开为逐文件条目（跳过符号链接，避免逃逸与循环）。 */
function expandDirectoryItem(
  policy: PathPolicy,
  item: MigrationInventoryItem,
  legacyRoot: string,
  fs: MigrationFs,
  out: DataMigrationEntry[],
  maxEntries: number
): void {
  const sourceDir = join(legacyRoot, item.legacyRelative)
  const targetHome = entryTargetPath(policy, item)
  const walk = (relative: string): boolean => {
    if (out.length >= maxEntries) return false
    const dirPath = relative ? join(sourceDir, relative) : sourceDir
    const names = fs.listDir(dirPath)
    if (names === null) return out.length < maxEntries
    for (const name of names) {
      if (out.length >= maxEntries) return false
      const childRelative = relative ? `${relative}/${name}` : name
      const childPath = join(dirPath, name)
      const info = fs.stat(childPath)
      if (info === null || info.kind === 'symlink') continue
      if (info.kind === 'directory') {
        if (!walk(childRelative)) return false
        continue
      }
      if (info.kind === 'file') {
        out.push(
          makePendingEntry(
            item,
            normalizeRelative(join(item.legacyRelative, childRelative)),
            'file',
            join(targetHome, childRelative)
          )
        )
      }
    }
    return out.length < maxEntries
  }
  walk('')
}

/** 展开整个迁移清单为待处理条目（每个目录递归为逐文件条目）。 */
function expandInventory(
  policy: PathPolicy,
  legacyRoot: string,
  fs: MigrationFs,
  maxEntries: number
): DataMigrationEntry[] {
  const entries: DataMigrationEntry[] = []
  for (const item of MIGRATION_INVENTORY) {
    if (entries.length >= maxEntries) {
      entries.push({
        category: item.category,
        sourceRelative: item.legacyRelative,
        targetPath: entryTargetPath(policy, item),
        kind: item.kind,
        status: 'failed',
        size: 0,
        error: 'too-many-entries'
      })
      continue
    }
    const sourceInfo = fs.stat(join(legacyRoot, item.legacyRelative))
    if (sourceInfo === null || sourceInfo.kind === 'symlink') {
      entries.push(
        makePendingEntry(item, item.legacyRelative, item.kind, entryTargetPath(policy, item))
      )
      continue
    }
    if (item.kind === 'file') {
      if (sourceInfo.kind !== 'file') {
        entries.push({
          category: item.category,
          sourceRelative: item.legacyRelative,
          targetPath: entryTargetPath(policy, item),
          kind: 'file',
          status: 'failed',
          size: 0,
          error: 'source-unexpected-type'
        })
      } else {
        entries.push(
          makePendingEntry(item, item.legacyRelative, 'file', entryTargetPath(policy, item))
        )
      }
      continue
    }
    if (sourceInfo.kind !== 'directory') {
      entries.push({
        category: item.category,
        sourceRelative: item.legacyRelative,
        targetPath: entryTargetPath(policy, item),
        kind: 'directory',
        status: 'failed',
        size: 0,
        error: 'source-unexpected-type'
      })
      continue
    }
    expandDirectoryItem(policy, item, legacyRoot, fs, entries, maxEntries)
  }
  return entries
}

/** 单个文件的暂存复制 -> 校验 -> 原子落位（目标优先，绝不静默覆盖）。 */
function reconcileFileEntry(
  entry: DataMigrationEntry,
  legacyRoot: string,
  fs: MigrationFs
): DataMigrationEntry {
  const sourcePath = join(legacyRoot, entry.sourceRelative)
  const sourceInfo = fs.stat(sourcePath)
  if (sourceInfo === null || sourceInfo.kind === 'symlink') {
    return { ...entry, status: 'skipped-source-missing', size: 0 }
  }
  const sourceData = fs.readFileBytes(sourcePath)
  if (sourceData === null) {
    return { ...entry, status: 'skipped-source-missing', size: 0 }
  }
  const size = sourceData.length
  const checksum = fs.checksum(sourceData)
  if (entry.discardable) {
    return { ...entry, status: 'skipped-discardable', size, checksum }
  }

  const targetStat = fs.stat(entry.targetPath)
  if (targetStat !== null) {
    if (targetStat.kind === 'directory') {
      return { ...entry, status: 'skipped-conflict', size, checksum, error: 'target-is-directory' }
    }
    if (targetStat.kind === 'file') {
      const targetSize = fs.fileSize(entry.targetPath)
      const targetData = targetSize === size ? fs.readFileBytes(entry.targetPath) : null
      if (targetData !== null && fs.checksum(targetData) === checksum) {
        return { ...entry, status: 'skipped-exists', size, checksum }
      }
      return { ...entry, status: 'skipped-conflict', size, checksum, error: 'content-differs' }
    }
    return { ...entry, status: 'skipped-conflict', size, checksum, error: 'target-unexpected-type' }
  }

  const stagingPath = entry.targetPath + MIGRATION_STAGING_SUFFIX
  fs.remove(stagingPath)
  if (!fs.ensureDirectory(dirname(entry.targetPath))) {
    return { ...entry, status: 'failed', size, checksum, error: 'target-dir-uncreatable' }
  }
  if (!fs.copyFile(sourcePath, stagingPath)) {
    return { ...entry, status: 'failed', size, checksum, error: 'copy-failed' }
  }
  const stagedData = fs.readFileBytes(stagingPath)
  if (stagedData === null || fs.checksum(stagedData) !== checksum) {
    fs.remove(stagingPath)
    return { ...entry, status: 'failed', size, checksum, error: 'checksum-mismatch' }
  }
  if (!fs.rename(stagingPath, entry.targetPath)) {
    fs.remove(stagingPath)
    return { ...entry, status: 'failed', size, checksum, error: 'rename-failed' }
  }
  return { ...entry, status: 'copied', size, checksum }
}

/** 逐条处理条目：pending 才执行，其余（missing/failed/discardable）已是终态。 */
function reconcileEntries(
  entries: DataMigrationEntry[],
  legacyRoot: string,
  fs: MigrationFs
): DataMigrationEntry[] {
  return entries.map((entry) => {
    if (entry.status !== 'pending') return entry
    if (entry.kind === 'directory') {
      const info = fs.stat(join(legacyRoot, entry.sourceRelative))
      return info !== null && info.kind === 'directory'
        ? entry
        : { ...entry, status: 'skipped-source-missing', size: 0 }
    }
    return reconcileFileEntry(entry, legacyRoot, fs)
  })
}

/** 目录（递归）内是否至少有一个文件；空目录不算持久数据源。 */
function directoryHasFiles(dirPath: string, fs: MigrationFs): boolean {
  const names = fs.listDir(dirPath)
  if (names === null) return false
  for (const name of names) {
    const child = join(dirPath, name)
    const info = fs.stat(child)
    if (info === null || info.kind === 'symlink') continue
    if (info.kind === 'file') return true
    if (info.kind === 'directory' && directoryHasFiles(child, fs)) return true
  }
  return false
}

/**
 * portable 模式下 legacy 根是否存在任何持久数据源。文件条目要求存在文件；
 * 目录条目要求目录内递归至少有一个文件——路径策略会在 legacy 根创建空的
 * 分类目录（config/database/plugins/...），空目录不算数据，避免误触发迁移。
 */
function hasPersistentSource(legacyRoot: string, fs: MigrationFs): boolean {
  return MIGRATION_INVENTORY.some((item) => {
    if (item.discardable) return false
    const info = fs.stat(join(legacyRoot, item.legacyRelative))
    if (info === null || info.kind === 'symlink') return false
    if (item.kind === 'file') return info.kind === 'file'
    return info.kind === 'directory' && directoryHasFiles(join(legacyRoot, item.legacyRelative), fs)
  })
}

/** 读取 legacy 数据根下的迁移清单；不存在 / 版本不符 / 源根不符时返回 null。 */
export function loadMigrationManifest(
  legacyRoot: string,
  fs: MigrationFs
): DataMigrationManifest | null {
  const manifestPath = join(legacyRoot, MIGRATION_MANIFEST_FILE)
  const data = fs.readFileBytes(manifestPath)
  if (data === null) return null
  try {
    const parsed: unknown = JSON.parse(data.toString('utf8'))
    if (!isDataMigrationManifest(parsed)) return null
    if (parsed.sourceRoot !== legacyRoot) return null
    return parsed
  } catch {
    return null
  }
}

function manifestPathFor(legacyRoot: string): string {
  return join(legacyRoot, MIGRATION_MANIFEST_FILE)
}

function writeManifest(
  legacyRoot: string,
  fs: MigrationFs,
  manifest: DataMigrationManifest
): boolean {
  return fs.writeFileBytes(
    manifestPathFor(legacyRoot),
    Buffer.from(JSON.stringify(manifest, null, 2))
  )
}

function notNeededDiagnostics(policy: PathPolicy, legacyRoot: string): DataMigrationDiagnostics {
  return {
    status: 'not-needed',
    mode: policy.mode,
    sourceRoot: legacyRoot,
    engineVersion: DATA_MIGRATION_ENGINE_VERSION,
    manifestFile: null,
    migratedBytes: 0,
    copiedEntries: 0,
    conflictEntries: 0,
    failedEntries: 0
  }
}

export function diagnosticsFromManifest(manifest: DataMigrationManifest): DataMigrationDiagnostics {
  let migratedBytes = 0
  let copiedEntries = 0
  let conflictEntries = 0
  let failedEntries = 0
  for (const entry of manifest.entries) {
    if (entry.status === 'copied') {
      migratedBytes += entry.size
      copiedEntries += 1
    } else if (entry.status === 'skipped-conflict') {
      conflictEntries += 1
    } else if (entry.status === 'failed') {
      failedEntries += 1
    }
  }
  return {
    status: manifest.status,
    mode: manifest.mode,
    sourceRoot: manifest.sourceRoot,
    engineVersion: manifest.engineVersion,
    manifestFile: manifestPathFor(manifest.sourceRoot),
    migratedBytes,
    copiedEntries,
    conflictEntries,
    failedEntries,
    failure: manifest.failure
  }
}

function finalStatus(entries: DataMigrationEntry[]): {
  status: 'completed' | 'failed'
  failure?: string
} {
  const failures = entries.filter((entry) => entry.status === 'failed')
  if (failures.length === 0) return { status: 'completed' }
  return { status: 'failed', failure: `${failures.length} entries failed` }
}

/**
 * 执行数据迁移并返回诊断摘要。幂等：`completed` 清单已存在时直接返回；
 * 中途中断 / failed 时逐条续跑。
 */
export function runDataMigration(options: DataMigrationOptions): DataMigrationDiagnostics {
  const { policy, legacyRoot } = options
  const fs: MigrationFs = { ...defaultMigrationFs(), ...options.fs }
  const now = options.now ?? (() => new Date().toISOString())
  const maxEntries = options.maxEntries ?? MAX_MIGRATION_ENTRIES

  // standard/fallback：应用读取路径就是 legacy 扁平路径，迁移目标等于源，无需迁移。
  if (policy.mode !== 'portable') {
    return notNeededDiagnostics(policy, legacyRoot)
  }

  const existing = loadMigrationManifest(legacyRoot, fs)
  if (existing?.status === 'completed') {
    return diagnosticsFromManifest(existing)
  }

  const planned = expandInventory(policy, legacyRoot, fs, maxEntries)

  // portable 但 legacy 根没有任何持久数据：不需要迁移，也不写清单。
  if (!hasPersistentSource(legacyRoot, fs)) {
    return notNeededDiagnostics(policy, legacyRoot)
  }

  const startedAt = now()
  const pendingManifest: DataMigrationManifest = {
    schemaVersion: DATA_MIGRATION_SCHEMA_VERSION,
    engineVersion: DATA_MIGRATION_ENGINE_VERSION,
    mode: policy.mode,
    sourceRoot: legacyRoot,
    status: 'pending',
    startedAt,
    entries: planned
  }
  writeManifest(legacyRoot, fs, pendingManifest)

  const reconciled = reconcileEntries(planned, legacyRoot, fs)
  const terminal = finalStatus(reconciled)
  const finalManifest: DataMigrationManifest = {
    ...pendingManifest,
    status: terminal.status,
    completedAt: now(),
    failure: terminal.failure,
    entries: reconciled
  }
  writeManifest(legacyRoot, fs, finalManifest)

  return diagnosticsFromManifest(finalManifest)
}
