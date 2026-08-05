/**
 * 网络音乐源（Network Music Sources）共享类型。
 * 详见 docs/network-music-sources.md。
 */

export type NetworkProtocol =
  | 'webdav'
  | 'ftp'
  | 'ftps'
  | 'sftp'
  | 'scp'
  | 'smb'
  | 'nfs'
  | 'dlna'

export type NetworkCredentialKind = 'anonymous' | 'password' | 'privateKey'

/** 凭据引用：明文只存在于主进程内存；落盘为 secureStorage 密文（encryptedId）。 */
export interface NetworkCredentialRef {
  kind: NetworkCredentialKind
  encryptedId: string
}

export interface NetworkSourceProfile {
  id: string
  protocol: NetworkProtocol
  name: string
  host: string
  port: number | null
  rootPath: string
  username?: string
  credential: NetworkCredentialRef
  options: {
    readOnly: boolean
    connectTimeoutMs: number
    transferTimeoutMs: number
    maxConcurrentTransfers: number
  }
  bookmarks: string[]
  createdAt: number
  lastConnectedAt: number | null
}

/** 创建/更新 profile 的输入（凭据为明文，仅 IPC 入参；落盘前加密）。 */
export interface NetworkSourceProfileInput {
  protocol: NetworkProtocol
  name: string
  host: string
  port?: number | null
  rootPath: string
  username?: string
  auth: { kind: 'anonymous' } | { kind: 'password'; password: string }
  readOnly?: boolean
  bookmarks?: string[]
}

/** 渲染层可见的 profile 摘要：绝不包含凭据密文与口令。 */
export interface NetworkSourceProfileSummary {
  id: string
  protocol: NetworkProtocol
  name: string
  host: string
  port: number | null
  rootPath: string
  username?: string
  credentialKind: NetworkCredentialKind
  options: NetworkSourceProfile['options']
  bookmarks: string[]
  createdAt: number
  lastConnectedAt: number | null
}

export interface NetworkEntry {
  id: string
  profileId: string
  name: string
  kind: 'directory' | 'file' | 'audio' | 'playlist'
  path: string
  sizeBytes?: number
  mtimeMs?: number
  mimeType?: string
}

export interface NetworkPlaybackPlan {
  kind: 'local-cache' | 'direct-url'
  url?: string
  cacheFilePath?: string
  displayName: string
}

export type NetworkSourceErrorCode =
  | 'auth'
  | 'timeout'
  | 'network'
  | 'notFound'
  | 'denied'
  | 'invalidProfile'
  | 'unsupportedProtocol'

export interface NetworkSourceError {
  code: NetworkSourceErrorCode
  message: string
}

export type NetworkSourceEvent =
  | { type: 'profiles-changed' }
  | { type: 'connection-state'; profileId: string; state: 'connecting' | 'connected' | 'failed'; error?: NetworkSourceError }
