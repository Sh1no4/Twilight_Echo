import { remoteMediaGrants, type RemoteMediaGrantService } from '../security/remoteMediaGrants.ts'
import type { OfflineDownloadRequest } from '../../shared/offlineDownloads.ts'

/**
 * Renderer-visible provider URLs are twilight-media grants. Resolve them only
 * at the download IPC boundary, so a renderer cannot turn the downloader into
 * an arbitrary HTTP client.
 */
export function authorizeOfflineDownloadRequest(
  request: OfflineDownloadRequest,
  grants: RemoteMediaGrantService = remoteMediaGrants
): OfflineDownloadRequest {
  if (request.providerId.trim().toLowerCase() === 'radio') {
    throw new Error('Live radio streams cannot be pinned offline')
  }
  const source = grants.resolve(request.url, 'audio').source
  return { ...request, url: source }
}
