export interface PluginDependencyRecord {
  id: string
  name: string
  version: string
  enabled: boolean
  status: 'installed' | 'enabled' | 'disabled' | 'invalid' | 'failed'
  dependencies?: Record<string, string>
}

export interface PluginStartupPlan<T extends PluginDependencyRecord> {
  ordered: T[]
  failures: Map<string, string>
}

export function planPluginStartup<T extends PluginDependencyRecord>(
  descriptors: T[]
): PluginStartupPlan<T> {
  const recordsById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]))
  const enabled = descriptors
    .filter((descriptor) => descriptor.enabled && descriptor.status !== 'invalid')
    .sort((left, right) => left.id.localeCompare(right.id))
  const enabledById = new Map(enabled.map((descriptor) => [descriptor.id, descriptor]))
  const failures = new Map<string, string>()

  for (const descriptor of enabled) {
    const dependencyError = validatePluginDependencies(descriptor, recordsById)
    if (dependencyError) failures.set(descriptor.id, dependencyError)
  }

  propagateDependencyFailures(enabled, failures)

  const ordered: T[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []

  const visit = (descriptor: T): void => {
    if (failures.has(descriptor.id) || visited.has(descriptor.id)) return
    if (visiting.has(descriptor.id)) {
      const cycleStart = stack.indexOf(descriptor.id)
      const cycle = [...stack.slice(Math.max(0, cycleStart)), descriptor.id]
      const message = `插件依赖存在循环：${cycle.join(' -> ')}`
      for (const id of cycle) failures.set(id, message)
      return
    }

    visiting.add(descriptor.id)
    stack.push(descriptor.id)
    for (const dependencyId of Object.keys(descriptor.dependencies ?? {}).sort()) {
      const dependency = enabledById.get(dependencyId)
      if (dependency) visit(dependency)
    }
    stack.pop()
    visiting.delete(descriptor.id)
    visited.add(descriptor.id)
    if (!failures.has(descriptor.id)) ordered.push(descriptor)
  }

  for (const descriptor of enabled) visit(descriptor)
  propagateDependencyFailures(enabled, failures)

  return {
    ordered: ordered.filter((descriptor) => !failures.has(descriptor.id)),
    failures
  }
}

export function validatePluginDependencies<T extends PluginDependencyRecord>(
  descriptor: T,
  recordsById: Map<string, T>
): string | null {
  for (const [dependencyId, range] of Object.entries(descriptor.dependencies ?? {}).sort()) {
    const dependency = recordsById.get(dependencyId)
    if (!dependency) return `缺少依赖插件 ${dependencyId}@${range}`
    if (dependency.status === 'invalid') return `依赖插件 ${dependencyId} 无效`
    if (!isCompatibleDependencyRange(range, dependency.version)) {
      return `依赖插件 ${dependencyId} 版本 ${dependency.version} 不满足 ${range}`
    }
    if (!dependency.enabled) return `依赖插件 ${dependencyId} 未启用`
  }
  return null
}

function isCompatibleDependencyRange(range: string, version: string): boolean {
  const trimmed = range.trim()
  if (trimmed === '*' || trimmed === '') return true
  if (trimmed.startsWith('^')) return version.split('.')[0] === trimmed.slice(1).split('.')[0]
  if (trimmed.startsWith('~')) {
    const [major, minor] = version.split('.')
    const [requiredMajor, requiredMinor] = trimmed.slice(1).split('.')
    return major === requiredMajor && minor === requiredMinor
  }
  if (trimmed.startsWith('>=')) {
    return compareSemver(version, trimmed.slice(2).trim()) >= 0
  }
  return trimmed === version
}

function compareSemver(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1
    if (leftParts[index] < rightParts[index]) return -1
  }
  return 0
}

function propagateDependencyFailures<T extends PluginDependencyRecord>(
  enabled: T[],
  failures: Map<string, string>
): void {
  let changed = true
  while (changed) {
    changed = false
    for (const descriptor of enabled) {
      if (failures.has(descriptor.id)) continue
      for (const dependencyId of Object.keys(descriptor.dependencies ?? {})) {
        const dependencyFailure = failures.get(dependencyId)
        if (dependencyFailure) {
          failures.set(descriptor.id, `依赖插件 ${dependencyId} 启动条件失败：${dependencyFailure}`)
          changed = true
          break
        }
      }
    }
  }
}
