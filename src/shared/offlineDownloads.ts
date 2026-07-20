/** Versioned contract for user-pinned online media. No remote URL is persisted. */
export type OfflineDownloadStatus =
  | 'queued'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'

export interface OfflineDownloadRequest {
  providerId: string
  trackId: string
  title: string
  quality: string
  url: string
  /** Optional provider URL/media expiry. It is display metadata, not a playback bypass. */
  expiresAt?: string | null
  expectedSha256?: string | null
}

/**
 * Renderer-to-main lookup key for a main-process verified offline pin. The
 * renderer never supplies or persists the filesystem path used for playback.
 */
export interface OfflinePlayablePathRequest {
  providerId: string
  trackId: string
}

export interface OfflineDownloadRecord {
  id: string
  providerId: string
  trackId: string
  title: string
  quality: string
  pinned: true
  status: OfflineDownloadStatus
  bytesDownloaded: number
  totalBytes: number | null
  sha256: string | null
  fileName: string | null
  downloadedAt: string | null
  expiresAt: string | null
  error: string | null
  retryCount: number
  updatedAt: string
}

export interface OfflineDownloadDocument {
  version: 1
  records: OfflineDownloadRecord[]
}

export interface OfflineStorageSummary {
  pinnedBytes: number
  availableBytes: number | null
  records: OfflineDownloadRecord[]
}

export function offlineTrackKey(providerId: string, trackId: string): string {
  return `${providerId.trim().toLowerCase()}:${trackId.trim()}`
}

export function isOfflineDownloadDocument(value: unknown): value is OfflineDownloadDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const document = value as Partial<OfflineDownloadDocument>
  return document.version === 1 && Array.isArray(document.records)
}
