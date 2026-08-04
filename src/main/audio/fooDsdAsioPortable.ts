import { access, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export interface FooDsdAsioPortableStatus {
  configuredPath: string
  rootPath: string
  foobarExecutable: string
  portableModeEnabled: boolean
  hasAsioDsdComponent: boolean
  hasSacdComponent: boolean
  matched: boolean
  message: string
}

const COMPONENT_BASES = [
  ['profile', 'user-components-x64'],
  ['profile', 'user-components'],
  ['user-components-x64'],
  ['user-components'],
  ['components']
]

const ASIO_DSD_COMPONENTS = [
  ['foo_out_asio+dsd', 'foo_out_asio+dsd.dll'],
  ['foo_out_asio_dsd', 'foo_out_asio_dsd.dll']
]

const SACD_COMPONENTS = [['foo_input_sacd', 'foo_input_sacd.dll']]

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function hasComponent(rootPath: string, componentPaths: string[][]): Promise<boolean> {
  for (const base of COMPONENT_BASES) {
    for (const component of componentPaths) {
      if (await fileExists(join(rootPath, ...base, ...component))) return true
    }
  }
  return false
}

async function candidateStartPath(configuredPath: string): Promise<string> {
  const normalized = resolve(configuredPath)
  if (normalized.toLowerCase().endsWith('foobar2000.exe') && (await fileExists(normalized))) {
    return dirname(normalized)
  }
  return normalized
}

async function findFoobarRoot(configuredPath: string): Promise<string> {
  const startPath = await candidateStartPath(configuredPath)
  if (!(await directoryExists(startPath))) return ''

  const queue: Array<{ path: string; depth: number }> = [{ path: startPath, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < 256) {
    const candidate = queue.shift()
    if (!candidate) break
    visited += 1
    if (await fileExists(join(candidate.path, 'foobar2000.exe'))) return candidate.path
    if (candidate.depth >= 3) continue

    let entries
    try {
      entries = await readdir(candidate.path, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      queue.push({ path: join(candidate.path, entry.name), depth: candidate.depth + 1 })
      if (queue.length + visited >= 256) break
    }
  }
  return ''
}

export async function inspectFooDsdAsioPortable(
  configuredPath: string
): Promise<FooDsdAsioPortableStatus> {
  const normalizedPath = typeof configuredPath === 'string' ? configuredPath.trim() : ''
  const empty: FooDsdAsioPortableStatus = {
    configuredPath: normalizedPath,
    rootPath: '',
    foobarExecutable: '',
    portableModeEnabled: false,
    hasAsioDsdComponent: false,
    hasSacdComponent: false,
    matched: false,
    message: '尚未选择 Foobar2000 便携版目录'
  }
  if (!normalizedPath) return empty

  const rootPath = await findFoobarRoot(normalizedPath)
  if (!rootPath) {
    return { ...empty, message: '所选目录内未找到 foobar2000.exe' }
  }

  const foobarExecutable = join(rootPath, 'foobar2000.exe')
  const portableModeEnabled = await access(join(rootPath, 'portable_mode_enabled'))
    .then(() => true)
    .catch(() => false)
  const [hasAsioDsdComponent, hasSacdComponent] = await Promise.all([
    hasComponent(rootPath, ASIO_DSD_COMPONENTS),
    hasComponent(rootPath, SACD_COMPONENTS)
  ])
  const matched = hasAsioDsdComponent && hasSacdComponent
  let message = '已找到 Foobar2000，但缺少 ASIO+DSD 和 SACD 组件'
  if (hasAsioDsdComponent && !hasSacdComponent) {
    message = '已找到 ASIO+DSD 组件，但缺少 foo_input_sacd'
  } else if (!hasAsioDsdComponent && hasSacdComponent) {
    message = '已找到 foo_input_sacd，但缺少 foo_out_asio+dsd'
  } else if (matched && portableModeEnabled) {
    message = '便携版 Foobar2000 的 SACD 与 ASIO+DSD 组件完整'
  } else if (matched) {
    message = 'Foobar2000 的 SACD 与 ASIO+DSD 组件完整，但未检测到便携模式标记'
  }

  return {
    configuredPath: normalizedPath,
    rootPath,
    foobarExecutable,
    portableModeEnabled,
    hasAsioDsdComponent,
    hasSacdComponent,
    matched,
    message
  }
}
