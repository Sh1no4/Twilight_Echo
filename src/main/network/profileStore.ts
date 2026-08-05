import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { normalizeRemotePath, redactProfile } from './networkPath.ts'
import { NetworkSourceFailure } from './errors.ts'
import type { NetworkAuth } from './adapters/types.ts'
import type {
  NetworkProtocol,
  NetworkSourceProfileInput,
  NetworkSourceProfile,
  NetworkSourceProfileSummary
} from '../../shared/networkSources.ts'

export type { NetworkSourceProfileInput } from '../../shared/networkSources.ts'

/** 凭据加密接缝：生产用 secureStorage，测试注入假 codec。 */
export interface CredentialCodec {
  encrypt(plain: string): string
  decrypt(encrypted: string): string
}

export interface NetworkProfileStore {
  listProfiles(): Promise<NetworkSourceProfileSummary[]>
  getProfile(id: string): Promise<NetworkSourceProfile>
  createProfile(input: NetworkSourceProfileInput): Promise<NetworkSourceProfileSummary>
  updateProfile(
    id: string,
    patch: Partial<NetworkSourceProfileInput>
  ): Promise<NetworkSourceProfileSummary>
  deleteProfile(id: string): Promise<void>
  resolveAuth(id: string): Promise<NetworkAuth>
}

const SUPPORTED_PROTOCOLS: ReadonlySet<NetworkProtocol> = new Set([
  'webdav',
  'ftp',
  'ftps',
  'sftp',
  'scp',
  'smb',
  'nfs',
  'dlna'
])

const MAX_BOOKMARKS = 50

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') throw new NetworkSourceFailure('invalidProfile', '名称必须是字符串')
  const name = value.trim()
  if (!name || name.length > 64) throw new NetworkSourceFailure('invalidProfile', '名称长度需在 1–64 之间')
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new NetworkSourceFailure('invalidProfile', '名称包含非法字符')
  }
  return name
}

function normalizeHost(value: unknown): string {
  if (typeof value !== 'string') throw new NetworkSourceFailure('invalidProfile', '地址必须是字符串')
  const host = value.trim().replace(/^https?:\/\//i, '')
  if (!host || host.length > 253 || /[\u0000-\u001f\u007f]/.test(host)) {
    throw new NetworkSourceFailure('invalidProfile', '地址不合法')
  }
  return host
}

function normalizePort(value: unknown): number | null {
  if (value == null || value === '') return null
  const port = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new NetworkSourceFailure('invalidProfile', '端口需在 1–65535 之间')
  }
  return port
}

function normalizeUsername(value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new NetworkSourceFailure('invalidProfile', '用户名不合法')
  }
  return value.trim()
}

function validateAuth(auth: NetworkSourceProfileInput['auth']): void {
  if (auth.kind === 'anonymous') return
  if (auth.kind !== 'password') throw new NetworkSourceFailure('invalidProfile', '暂不支持该认证方式')
  if (typeof auth.password !== 'string' || auth.password.length > 512) {
    throw new NetworkSourceFailure('invalidProfile', '密码不合法')
  }
}

function normalizeBookmarks(value: unknown): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new NetworkSourceFailure('invalidProfile', '书签格式不合法')
  const bookmarks = value.slice(0, MAX_BOOKMARKS).map((item) => normalizeRemotePath(String(item)))
  return [...new Set(bookmarks)]
}

export function validateProfileInput(input: NetworkSourceProfileInput): void {
  if (!SUPPORTED_PROTOCOLS.has(input.protocol)) {
    throw new NetworkSourceFailure('invalidProfile', '不支持的协议')
  }
  normalizeName(input.name)
  normalizeHost(input.host)
  normalizePort(input.port)
  normalizeRemotePath(input.rootPath)
  normalizeUsername(input.username)
  validateAuth(input.auth)
  normalizeBookmarks(input.bookmarks)
}

interface PersistedFile {
  profiles: NetworkSourceProfile[]
}

export function createNetworkProfileStore(deps: {
  filePath: string
  codec: CredentialCodec
}): NetworkProfileStore {
  const { filePath, codec } = deps

  async function load(): Promise<NetworkSourceProfile[]> {
    try {
      const raw = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as PersistedFile
      return Array.isArray(parsed.profiles) ? parsed.profiles : []
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new NetworkSourceFailure('network', '网络源配置读取失败')
    }
  }

  async function save(profiles: NetworkSourceProfile[]): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify({ profiles }, null, 2), 'utf8')
  }

  async function findProfile(id: string): Promise<NetworkSourceProfile> {
    const profile = (await load()).find((item) => item.id === id)
    if (!profile) throw new NetworkSourceFailure('notFound', '网络源不存在')
    return profile
  }

  function toCredential(auth: NetworkSourceProfileInput['auth']): NetworkSourceProfile['credential'] {
    if (auth.kind === 'anonymous') return { kind: 'anonymous', encryptedId: '' }
    return { kind: 'password', encryptedId: codec.encrypt(auth.password) }
  }

  return {
    async listProfiles(): Promise<NetworkSourceProfileSummary[]> {
      return (await load()).map(redactProfile)
    },
    async getProfile(id: string): Promise<NetworkSourceProfile> {
      return findProfile(id)
    },
    async createProfile(input: NetworkSourceProfileInput): Promise<NetworkSourceProfileSummary> {
      validateProfileInput(input)
      const profiles = await load()
      const profile: NetworkSourceProfile = {
        id: randomUUID(),
        protocol: input.protocol,
        name: normalizeName(input.name),
        host: normalizeHost(input.host),
        port: normalizePort(input.port),
        rootPath: normalizeRemotePath(input.rootPath),
        username: normalizeUsername(input.username),
        credential: toCredential(input.auth),
        options: {
          readOnly: input.readOnly !== false,
          connectTimeoutMs: 10_000,
          transferTimeoutMs: 60_000,
          maxConcurrentTransfers: 2
        },
        bookmarks: normalizeBookmarks(input.bookmarks),
        createdAt: Date.now(),
        lastConnectedAt: null
      }
      profiles.push(profile)
      await save(profiles)
      return redactProfile(profile)
    },
    async updateProfile(
      id: string,
      patch: Partial<NetworkSourceProfileInput>
    ): Promise<NetworkSourceProfileSummary> {
      const profiles = await load()
      const index = profiles.findIndex((item) => item.id === id)
      if (index < 0) throw new NetworkSourceFailure('notFound', '网络源不存在')
      const profile = profiles[index]
      const merged: NetworkSourceProfileInput = {
        protocol: patch.protocol ?? profile.protocol,
        name: patch.name ?? profile.name,
        host: patch.host ?? profile.host,
        port: patch.port ?? profile.port,
        rootPath: patch.rootPath ?? profile.rootPath,
        username: patch.username === undefined ? profile.username : patch.username,
        auth: patch.auth ?? (profile.credential.kind === 'anonymous'
          ? { kind: 'anonymous' }
          : { kind: 'password', password: '' }),
        readOnly: patch.readOnly ?? profile.options.readOnly,
        bookmarks: patch.bookmarks ?? profile.bookmarks
      }
      validateProfileInput(merged)
      const updated: NetworkSourceProfile = {
        ...profile,
        protocol: merged.protocol,
        name: normalizeName(merged.name),
        host: normalizeHost(merged.host),
        port: normalizePort(merged.port),
        rootPath: normalizeRemotePath(merged.rootPath),
        username: normalizeUsername(merged.username),
        credential: patch.auth ? toCredential(merged.auth) : profile.credential,
        options: { ...profile.options, readOnly: merged.readOnly !== false },
        bookmarks: normalizeBookmarks(merged.bookmarks)
      }
      profiles[index] = updated
      await save(profiles)
      return redactProfile(updated)
    },
    async deleteProfile(id: string): Promise<void> {
      const profiles = await load()
      const next = profiles.filter((item) => item.id !== id)
      if (next.length === profiles.length) throw new NetworkSourceFailure('notFound', '网络源不存在')
      await save(next)
    },
    async resolveAuth(id: string): Promise<NetworkAuth> {
      const profile = await findProfile(id)
      if (profile.credential.kind === 'anonymous') return { kind: 'anonymous' }
      return {
        kind: 'password',
        username: profile.username,
        password: codec.decrypt(profile.credential.encryptedId)
      }
    }
  }
}
