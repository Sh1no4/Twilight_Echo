import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import extract from 'extract-zip'
import { isCompatibleTwilightRange, validatePluginManifest } from './manifest.ts'
import type {
  TwilightPluginDescriptor,
  TwilightPluginIndexEntry,
  TwilightPluginManifest
} from './types'

interface PluginIndexRaw {
  schemaVersion: number
  plugins: unknown[]
}

export interface PluginIndexServiceOptions {
  appVersion: string
  localIndexPath: string
  remoteIndexUrl?: string
  cacheIndexPath?: string
  bundledPluginIds?: string[]
  fetchImpl?: typeof fetch
  indexSizeLimitBytes?: number
  packageSizeLimitBytes?: number
  timeoutMs?: number
}

export type PluginIndexSourceKind = 'github' | 'custom' | 'bundled'
export type PluginIndexLoadedFrom = 'remote' | 'cache' | 'bundled'

export interface PluginIndexStatus {
  sourceUrl: string
  sourceKind: PluginIndexSourceKind
  loadedFrom: PluginIndexLoadedFrom
  lastFetchedAt: string | null
  stale: boolean
  error: string | null
}

export interface DownloadedPluginPackage {
  entry: TwilightPluginIndexEntry
  packagePath: string
  cleanup: () => Promise<void>
}

export const DEFAULT_PLUGIN_INDEX_URL =
  'https://raw.githubusercontent.com/asenyarzc-cpu/Twilight-Echo-plugins/main/plugins.json'

const INDEX_SCHEMA_VERSION = 1
const DEFAULT_INDEX_SIZE_LIMIT_BYTES = 1024 * 1024
const DEFAULT_PACKAGE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10000
const SHA256_PATTERN = /^[a-f0-9]{64}$/i

export class PluginIndexService {
  private readonly appVersion: string
  private readonly localIndexPath: string
  private readonly remoteIndexUrl?: string
  private readonly cacheIndexPath?: string
  private readonly bundledPluginIds: Set<string>
  private readonly fetchImpl: typeof fetch
  private readonly indexSizeLimitBytes: number
  private readonly packageSizeLimitBytes: number
  private readonly timeoutMs: number
  private cachedEntries: TwilightPluginIndexEntry[] | null = null
  private currentBaseUrl: string
  private status: PluginIndexStatus

  constructor(options: PluginIndexServiceOptions) {
    this.appVersion = options.appVersion
    this.localIndexPath = options.localIndexPath
    this.remoteIndexUrl = options.remoteIndexUrl?.trim() || undefined
    this.cacheIndexPath = options.cacheIndexPath
    this.bundledPluginIds = new Set(options.bundledPluginIds ?? [])
    this.fetchImpl = options.fetchImpl ?? fetch
    this.indexSizeLimitBytes = options.indexSizeLimitBytes ?? DEFAULT_INDEX_SIZE_LIMIT_BYTES
    this.packageSizeLimitBytes = options.packageSizeLimitBytes ?? DEFAULT_PACKAGE_SIZE_LIMIT_BYTES
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.currentBaseUrl = this.remoteIndexUrl || pathToFileURL(this.localIndexPath).toString()
    this.status = {
      sourceUrl: this.currentBaseUrl,
      sourceKind: this.remoteIndexUrl ? sourceKindForUrl(this.remoteIndexUrl) : 'bundled',
      loadedFrom: this.remoteIndexUrl ? 'remote' : 'bundled',
      lastFetchedAt: null,
      stale: false,
      error: null
    }
  }

  async list(forceRefresh = false): Promise<TwilightPluginIndexEntry[]> {
    if (!forceRefresh && this.cachedEntries) return this.cachedEntries
    const remoteUrl = this.remoteIndexUrl
    const localUrl = pathToFileURL(this.localIndexPath).toString()
    if (!remoteUrl) {
      const raw = await this.readIndexSource(this.localIndexPath)
      this.currentBaseUrl = localUrl
      this.cachedEntries = this.validateIndex(JSON.parse(raw), localUrl)
      this.status = {
        sourceUrl: localUrl,
        sourceKind: 'bundled',
        loadedFrom: 'bundled',
        lastFetchedAt: new Date().toISOString(),
        stale: false,
        error: null
      }
      return this.cachedEntries
    }

    try {
      const raw = await this.readIndexSource(remoteUrl)
      this.currentBaseUrl = remoteUrl
      this.cachedEntries = this.validateIndex(JSON.parse(raw), remoteUrl)
      await this.writeCache(raw)
      this.status = {
        sourceUrl: remoteUrl,
        sourceKind: sourceKindForUrl(remoteUrl),
        loadedFrom: 'remote',
        lastFetchedAt: new Date().toISOString(),
        stale: false,
        error: null
      }
      return this.cachedEntries
    } catch (remoteError) {
      const message = errorMessage(remoteError)
      if (!isRecoverableIndexError(message)) throw remoteError
      const cached = await this.tryReadCache(remoteUrl, message)
      if (cached) return cached
      const raw = await this.readIndexSource(this.localIndexPath)
      this.currentBaseUrl = localUrl
      this.cachedEntries = this.validateIndex(JSON.parse(raw), localUrl)
      this.status = {
        sourceUrl: remoteUrl,
        sourceKind: sourceKindForUrl(remoteUrl),
        loadedFrom: 'bundled',
        lastFetchedAt: null,
        stale: true,
        error: message
      }
    }
    return this.cachedEntries
  }

  async refresh(): Promise<TwilightPluginIndexEntry[]> {
    return this.list(true)
  }

  getStatus(): PluginIndexStatus {
    return { ...this.status }
  }

  async downloadPackage(id: string): Promise<DownloadedPluginPackage> {
    const entries = await this.list()
    const entry = entries.find((candidate) => candidate.id === id)
    if (!entry) throw new Error('插件索引中未找到该插件')
    if (this.bundledPluginIds.has(entry.id)) {
      throw new Error('索引不能安装或覆盖 Twilight Echo 自带插件')
    }
    if (!isCompatibleTwilightRange(entry.engines.twilightEcho, this.appVersion)) {
      throw new Error(`插件 ${entry.name} 不兼容当前 Twilight Echo ${this.appVersion}`)
    }
    const packageUrl = this.resolveSourceUrl(entry.sourceUrl, this.indexBaseUrl())
    const buffer = await this.readPackageSource(packageUrl)
    const checksum = createHash('sha256').update(buffer).digest('hex')
    if (checksum.toLowerCase() !== entry.checksumSha256.toLowerCase()) {
      throw new Error(`插件包 checksum 不匹配：${entry.id}`)
    }
    const tempRoot = await mkdtemp(join(tmpdir(), 'twilight-plugin-index-'))
    const packagePath = join(tempRoot, `${entry.id}-${entry.version}.tep`)
    try {
      await writeFile(packagePath, buffer)
      await this.validateDownloadedPackageManifest(entry, packagePath, tempRoot)
      return {
        entry,
        packagePath,
        cleanup: async () => {
          await rm(tempRoot, { recursive: true, force: true })
        }
      }
    } catch (error) {
      await rm(tempRoot, { recursive: true, force: true })
      throw error
    }
  }

  describeInstallState(
    entry: TwilightPluginIndexEntry,
    installed: TwilightPluginDescriptor[]
  ): 'not-installed' | 'installed' | 'update-available' | 'incompatible' | 'built-in-blocked' {
    if (this.bundledPluginIds.has(entry.id)) return 'built-in-blocked'
    if (!isCompatibleTwilightRange(entry.engines.twilightEcho, this.appVersion)) return 'incompatible'
    const descriptor = installed.find((plugin) => plugin.id === entry.id)
    if (!descriptor) return 'not-installed'
    if (compareSemver(entry.version, descriptor.version) > 0) return 'update-available'
    return 'installed'
  }

  private indexBaseUrl(): string {
    return this.currentBaseUrl
  }

  private async writeCache(raw: string): Promise<void> {
    if (!this.cacheIndexPath) return
    await mkdir(dirname(this.cacheIndexPath), { recursive: true })
    await writeFile(this.cacheIndexPath, raw, 'utf-8')
  }

  private async tryReadCache(
    remoteUrl: string,
    remoteError: string
  ): Promise<TwilightPluginIndexEntry[] | null> {
    if (!this.cacheIndexPath) return null
    try {
      const raw = await this.readIndexSource(this.cacheIndexPath)
      this.currentBaseUrl = remoteUrl
      this.cachedEntries = this.validateIndex(JSON.parse(raw), remoteUrl)
      this.status = {
        sourceUrl: remoteUrl,
        sourceKind: sourceKindForUrl(remoteUrl),
        loadedFrom: 'cache',
        lastFetchedAt: null,
        stale: true,
        error: remoteError
      }
      return this.cachedEntries
    } catch {
      return null
    }
  }

  private validateIndex(raw: unknown, baseUrl: string): TwilightPluginIndexEntry[] {
    if (!isPluginIndexRaw(raw)) throw new Error('插件索引必须是包含 schemaVersion 和 plugins 的对象')
    if (raw.schemaVersion !== INDEX_SCHEMA_VERSION) {
      throw new Error(`不支持的插件索引 schemaVersion：${raw.schemaVersion}`)
    }
    return raw.plugins.map((candidate, index) => this.validateEntry(candidate, index, baseUrl))
  }

  private validateEntry(raw: unknown, index: number, baseUrl: string): TwilightPluginIndexEntry {
    const manifest = validatePluginManifest(raw) as TwilightPluginManifest
    if (!isRecord(raw)) throw new Error(`插件索引第 ${index + 1} 项必须是对象`)
    const sourceUrl = requireString(raw, 'sourceUrl')
    this.resolveSourceUrl(sourceUrl, baseUrl)
    const checksumSha256 = requireString(raw, 'checksumSha256').toLowerCase()
    if (!SHA256_PATTERN.test(checksumSha256)) {
      throw new Error(`插件索引 ${manifest.id} checksumSha256 必须是 64 位 sha256`)
    }
    if (this.bundledPluginIds.has(manifest.id)) {
      throw new Error(`插件索引不能包含自带插件：${manifest.id}`)
    }
    return {
      ...manifest,
      sourceUrl,
      checksumSha256,
      repository: typeof raw.repository === 'string' ? raw.repository.trim() : manifest.repository,
      homepage: typeof raw.homepage === 'string' ? raw.homepage.trim() : manifest.homepage,
      tags: Array.isArray(raw.tags)
        ? raw.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
        : undefined,
      verified: raw.verified === true
    }
  }

  private async readIndexSource(source: string): Promise<string> {
    if (isHttpUrl(source)) {
      const buffer = await this.fetchBuffer(source, this.indexSizeLimitBytes)
      return buffer.toString('utf-8')
    }
    const filePath = source.startsWith('file://') ? fileUrlToPath(source) : resolve(source)
    const data = await readFile(filePath)
    if (data.byteLength > this.indexSizeLimitBytes) throw new Error('插件索引文件过大')
    return data.toString('utf-8')
  }

  private async readPackageSource(source: string): Promise<Buffer> {
    if (isHttpUrl(source)) return this.fetchBuffer(source, this.packageSizeLimitBytes)
    if (!source.startsWith('file://')) throw new Error('插件包 sourceUrl 协议不受支持')
    const filePath = fileUrlToPath(source)
    if (!existsSync(filePath)) throw new Error('插件包文件不存在')
    const data = await readFile(filePath)
    if (data.byteLength > this.packageSizeLimitBytes) throw new Error('插件包文件过大')
    return data
  }

  private async fetchBuffer(url: string, limitBytes: number): Promise<Buffer> {
    const parsed = new URL(url)
    if (!isAllowedHttpUrl(parsed)) throw new Error('插件索引只允许 https 或本机 http URL')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`插件索引请求失败：HTTP ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      if (buffer.byteLength > limitBytes) throw new Error('插件索引响应过大')
      return buffer
    } finally {
      clearTimeout(timer)
    }
  }

  private resolveSourceUrl(sourceUrl: string, baseUrl: string): string {
    const trimmed = sourceUrl.trim()
    if (!trimmed) throw new Error('插件索引 sourceUrl 不能为空')
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed) && !isHttpUrl(trimmed) && !trimmed.startsWith('file://')) {
      throw new Error('插件包 sourceUrl 协议不受支持')
    }
    if (isHttpUrl(trimmed)) {
      const parsed = new URL(trimmed)
      if (!isAllowedHttpUrl(parsed)) throw new Error('插件包 sourceUrl 协议不受支持')
      return parsed.toString()
    }
    if (trimmed.startsWith('file://')) return new URL(trimmed).toString()
    if (isAbsolute(trimmed)) return pathToFileURL(trimmed).toString()
    if (baseUrl.startsWith('file://')) {
      const basePath = fileUrlToPath(baseUrl)
      const resolved = resolve(dirname(basePath), trimmed)
      if (!isInsidePath(resolved, dirname(basePath))) {
        throw new Error('插件包 sourceUrl 不能指向索引目录外')
      }
      return pathToFileURL(resolved).toString()
    }
    return new URL(trimmed, baseUrl).toString()
  }

  private async validateDownloadedPackageManifest(
    entry: TwilightPluginIndexEntry,
    packagePath: string,
    tempRoot: string
  ): Promise<void> {
    const extractedRoot = join(tempRoot, 'manifest-check')
    await extract(packagePath, { dir: extractedRoot })
    const manifest = validatePluginManifest(
      JSON.parse(await readFile(join(extractedRoot, 'plugin.json'), 'utf-8'))
    )
    const mismatches = manifestComparisonKeys.filter((key) =>
      JSON.stringify(manifest[key]) !== JSON.stringify(entry[key])
    )
    if (mismatches.length > 0) {
      throw new Error(`插件包 manifest 与索引 entry 不一致：${entry.id} (${mismatches.join(', ')})`)
    }
  }
}

export function resolvePluginIndexUrl(value?: string): string {
  return value?.trim() || DEFAULT_PLUGIN_INDEX_URL
}

const manifestComparisonKeys: Array<keyof TwilightPluginManifest> = [
  'id',
  'name',
  'version',
  'description',
  'author',
  'license',
  'type',
  'main',
  'binary',
  'dependencies',
  'engines',
  'apiVersion',
  'permissions',
  'contributes',
  'icon',
  'signature'
]

function isPluginIndexRaw(value: unknown): value is PluginIndexRaw {
  return (
    isRecord(value) &&
    value.schemaVersion === INDEX_SCHEMA_VERSION &&
    Array.isArray(value.plugins)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`插件索引字段 ${key} 必须是非空字符串`)
  }
  return value.trim()
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://')
}

function isAllowedHttpUrl(url: URL): boolean {
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
}

function sourceKindForUrl(url: string): PluginIndexSourceKind {
  return url === DEFAULT_PLUGIN_INDEX_URL ? 'github' : 'custom'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecoverableIndexError(message: string): boolean {
  return !(
    message.includes('只允许 https 或本机 http URL') ||
    message.includes('协议不受支持') ||
    message.includes('schemaVersion') ||
    message.includes('插件索引必须是') ||
    message.includes('sourceUrl') ||
    message.includes('checksumSha256') ||
    message.includes('自带插件')
  )
}

function fileUrlToPath(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'file:') throw new Error('不是 file URL')
  return fileURLToPath(url)
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

function isInsidePath(child: string, parent: string): boolean {
  const pathBetween = relative(resolve(parent), resolve(child))
  return pathBetween === '' || (pathBetween !== '..' && !pathBetween.startsWith(`..${sep}`) && !isAbsolute(pathBetween))
}
