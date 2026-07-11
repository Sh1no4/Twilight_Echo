import { randomUUID } from 'node:crypto'

export type RemoteMediaKind = 'audio' | 'image'

export interface RemoteMediaGrant {
  source: string
  kind: RemoteMediaKind
}

export interface RemoteMediaGrantServiceOptions {
  now?: () => number
  createToken?: () => string
}

export interface RemoteMediaRequestHandlerOptions {
  grants?: RemoteMediaGrantService
  fetch: (source: string, init: RequestInit) => Promise<Response>
}

interface StoredGrant extends RemoteMediaGrant {
  lastAccessAt: number
}

const AUDIO_IDLE_TTL_MS = 30 * 60 * 1000
const IMAGE_IDLE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_IMAGE_RESPONSE_BYTES = 25 * 1024 * 1024
const MAX_AUDIO_RESPONSE_BYTES = 1024 * 1024 * 1024

export class RemoteMediaGrantService {
  private readonly grants = new Map<string, StoredGrant>()
  private readonly now: () => number
  private readonly createToken: () => string

  constructor(options: RemoteMediaGrantServiceOptions = {}) {
    this.now = options.now ?? Date.now
    this.createToken = options.createToken ?? randomUUID
  }

  grant(source: string, kind: RemoteMediaKind): string {
    const normalized = normalizeRemoteMediaSource(source)
    const token = this.createToken()
    if (!token || /[/?#]/.test(token)) throw new Error('Remote media grant token is invalid')
    this.grants.set(token, { source: normalized, kind, lastAccessAt: this.now() })
    return `twilight-media://${kind}/${token}`
  }

  resolve(url: string, expectedKind?: RemoteMediaKind): RemoteMediaGrant {
    const { token, kind } = parseGrantToken(url)
    const grant = this.grants.get(token)
    if (!grant) throw new Error('Remote media grant is unknown')
    if (grant.kind !== kind) throw new Error('Remote media grant kind is not authorized')
    if (expectedKind && grant.kind !== expectedKind) {
      throw new Error('Remote media grant kind is not authorized')
    }
    if (this.now() - grant.lastAccessAt > ttlFor(grant.kind)) {
      this.grants.delete(token)
      throw new Error('Remote media grant has expired')
    }
    grant.lastAccessAt = this.now()
    return { source: grant.source, kind: grant.kind }
  }

  revokeAll(): void {
    this.grants.clear()
  }
}

export const remoteMediaGrants = new RemoteMediaGrantService()

export function createRemoteMediaRequestHandler(
  options: RemoteMediaRequestHandlerOptions
): (request: Request) => Promise<Response> {
  const grants = options.grants ?? remoteMediaGrants
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return failedRemoteMediaResponse(405, 'Method not allowed')
    }

    let grant: RemoteMediaGrant
    try {
      grant = grants.resolve(request.url)
    } catch {
      return failedRemoteMediaResponse(403, 'Remote media authorization failed')
    }

    const range = request.headers.get('range')
    if (range && !isSingleByteRange(range)) {
      return failedRemoteMediaResponse(416, 'Requested range is not supported')
    }

    let upstream: Response
    try {
      upstream = await options.fetch(grant.source, {
        method: request.method,
        headers: range ? { Range: range } : undefined,
        credentials: 'omit',
        redirect: 'manual'
      })
    } catch {
      return failedRemoteMediaResponse(502, 'Remote media request failed')
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      return failedRemoteMediaResponse(502, 'Remote media redirect was rejected')
    }
    if (!upstream.ok && upstream.status !== 206) {
      return failedRemoteMediaResponse(502, 'Remote media request failed')
    }
    if (!isExpectedMediaType(upstream.headers.get('content-type'), grant.kind)) {
      return failedRemoteMediaResponse(415, 'Remote media type is not authorized')
    }

    const maximumBytes = maxResponseBytesFor(grant.kind)
    const contentLength = parseContentLength(upstream.headers.get('content-length'))
    if (contentLength !== null && contentLength > maximumBytes) {
      return failedRemoteMediaResponse(413, 'Remote media response is too large')
    }

    return new Response(limitResponseBody(upstream.body, maximumBytes), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: filteredResponseHeaders(upstream.headers)
    })
  }
}

export function protectProviderMedia<T>(
  value: T,
  method: string,
  grants: RemoteMediaGrantService = remoteMediaGrants
): T {
  if (typeof value === 'string') {
    return (method === 'getPlaybackUrl' ? grantIfRemote(value, 'audio', grants) : value) as T
  }
  return protectValue(value, method, grants) as T
}

function protectValue(value: unknown, method: string, grants: RemoteMediaGrantService): unknown {
  if (Array.isArray(value)) return value.map((entry) => protectValue(entry, method, grants))
  if (!value || typeof value !== 'object') return value

  const protectedValue: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && isImageField(key, method)) {
      protectedValue[key] = grantIfRemote(entry, 'image', grants)
    } else if (typeof entry === 'string' && isAudioField(key)) {
      protectedValue[key] = grantIfRemote(entry, 'audio', grants)
    } else {
      protectedValue[key] = protectValue(entry, method, grants)
    }
  }
  return protectedValue
}

function isImageField(key: string, method: string): boolean {
  return (
    key === 'cover' ||
    key === 'coverUrl' ||
    key === 'imageUrl' ||
    key === 'picUrl' ||
    key === 'avatarUrl' ||
    key === 'coverImgUrl' ||
    key === 'blurPicUrl' ||
    (key === 'url' && method === 'getQrImage')
  )
}

function isAudioField(key: string): boolean {
  return key === 'streamUrl' || key === 'audioUrl'
}

function grantIfRemote(source: string, kind: RemoteMediaKind, grants: RemoteMediaGrantService): string {
  return /^https?:\/\//i.test(source.trim()) ? grants.grant(source, kind) : source
}

function normalizeRemoteMediaSource(source: string): string {
  let parsed: URL
  try {
    parsed = new URL(source)
  } catch {
    throw new Error('Remote media source is invalid')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Remote media source protocol is not authorized')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Remote media source must not include credentials')
  }
  return parsed.toString()
}

function parseGrantToken(url: string): { token: string; kind: RemoteMediaKind } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Remote media grant URL is invalid')
  }
  const token = parsed.pathname.replace(/^\/+/, '')
  const kind = parsed.hostname
  if (
    parsed.protocol !== 'twilight-media:' ||
    (kind !== 'audio' && kind !== 'image') ||
    !token ||
    token.includes('/') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Remote media grant URL is invalid')
  }
  return { token, kind }
}

function ttlFor(kind: RemoteMediaKind): number {
  return kind === 'audio' ? AUDIO_IDLE_TTL_MS : IMAGE_IDLE_TTL_MS
}

function isSingleByteRange(value: string): boolean {
  return /^bytes=(?:\d+-\d*|\d*-\d+)$/i.test(value)
}

function isExpectedMediaType(contentType: string | null, kind: RemoteMediaKind): boolean {
  const normalized = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (kind === 'image') return normalized.startsWith('image/')
  return (
    normalized.startsWith('audio/') ||
    normalized === 'application/ogg' ||
    normalized === 'application/octet-stream'
  )
}

function parseContentLength(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function maxResponseBytesFor(kind: RemoteMediaKind): number {
  return kind === 'audio' ? MAX_AUDIO_RESPONSE_BYTES : MAX_IMAGE_RESPONSE_BYTES
}

function filteredResponseHeaders(headers: Headers): Headers {
  const filtered = new Headers()
  for (const name of ['accept-ranges', 'cache-control', 'content-length', 'content-range', 'content-type']) {
    const value = headers.get(name)
    if (value) filtered.set(name, value)
  }
  return filtered
}

function limitResponseBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number
): ReadableStream<Uint8Array> | null {
  if (!body) return null
  const reader = body.getReader()
  let bytesRead = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read()
      if (next.done) {
        controller.close()
        return
      }
      bytesRead += next.value.byteLength
      if (bytesRead > maximumBytes) {
        await reader.cancel('Remote media response exceeded its size limit')
        controller.error(new Error('Remote media response exceeded its size limit'))
        return
      }
      controller.enqueue(next.value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    }
  })
}

function failedRemoteMediaResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  })
}
