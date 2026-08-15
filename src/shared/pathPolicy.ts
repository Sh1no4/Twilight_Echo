/**
 * 数据根目录与路径分类的共享契约（Stage 1）。
 *
 * Electron 与 Tauri 共用这里的模式识别结果与分类目录名称，保证两端的
 * standard / portable / fallback 语义一致：
 *
 * - `standard`：普通安装版使用用户目录（userData / app_data_dir），既有扁平路径
 *   （settings.json 等仍在根目录）保持不动，分类目录作为新数据的基础设施预创建。
 * - `portable`：仅由显式 Portable 发行形态、稳定启动参数（`--portable`）或 exe
 *   同级标记（`.portable` 文件 / 已存在的 `data/` 目录）启用；数据写入 exe 同级
 *   `data/` 下的分类目录。
 * - `fallback`：Portable 被请求但数据目录不可解析或不可写，明确回退到 standard
 *   并记录原因，绝不静默丢数据。
 */

export const DATA_ROOT_CATEGORIES = [
  'config',
  'database',
  'plugins',
  'plugin-data',
  'cache',
  'logs',
  'backups'
] as const

export type DataRootCategory = (typeof DATA_ROOT_CATEGORIES)[number]

export type DataRootMode = 'standard' | 'portable' | 'fallback'

/** Portable 模式是通过哪个信号启用的；`none` 表示普通 standard。 */
export type DataRootDetectionSource =
  | 'explicit-build'
  | 'launch-arg'
  | 'marker-file'
  | 'marker-directory'
  | 'none'

/** 回退到 standard 的具体原因。 */
export type DataRootFallbackReason =
  | 'exe-dir-unresolvable'
  | 'data-dir-not-writable'
  | 'category-not-writable'

/** 路径解析的只读诊断快照，Electron/Tauri 的 settings 快照都会携带。 */
export interface DataRootDiagnostics {
  mode: DataRootMode
  /** 用户/发行形态是否请求了 portable（fallback 时与 mode 不一致）。 */
  portableRequested: boolean
  detectionSource: DataRootDetectionSource
  /** 实际使用的数据根目录：portable 为 exe 同级 data/，standard/fallback 为 standardRoot。 */
  dataRoot: string
  /** 普通安装模式的用户目录根。 */
  standardRoot: string
  /** 每个分类目录的解析结果。 */
  categories: Record<DataRootCategory, string>
  /** dataRoot 是否可写（经可写性探测）。 */
  writable: boolean
  /** 每个分类目录是否创建成功且可写。 */
  writableCategories: Record<DataRootCategory, boolean>
  fallbackReason: DataRootFallbackReason | null
}
