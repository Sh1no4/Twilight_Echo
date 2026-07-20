import { BrowserWindow, ipcMain } from 'electron'
import { getMusicCacheRoot } from '../cache/ncmCache.ts'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'
import type {
  OfflineDownloadRequest,
  OfflinePlayablePathRequest
} from '../../shared/offlineDownloads.ts'
import { OfflineDownloadService } from './offlineDownloadService.ts'
import { authorizeOfflineDownloadRequest } from './offlineRequestAuthorization.ts'

let service: OfflineDownloadService | null = null

export async function setupOfflineDownloadIpc(): Promise<OfflineDownloadService> {
  if (service) return service
  service = new OfflineDownloadService({
    rootPath: getMusicCacheRoot(),
    emit: (record) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
      window?.webContents.send('offline:changed', record)
    }
  })
  await service.initialize()
  ipcMain.handle('offline:list', async (event) => {
    assertTrustedIpcSender(event, 'offline downloads IPC')
    return service!.list()
  })
  ipcMain.handle('offline:queue', async (event, request: OfflineDownloadRequest) => {
    assertTrustedIpcSender(event, 'offline downloads IPC')
    return service!.queue(authorizeOfflineDownloadRequest(request))
  })
  ipcMain.handle('offline:queueMany', async (event, requests: OfflineDownloadRequest[]) => {
    assertTrustedIpcSender(event, 'offline downloads IPC')
    return service!.queueMany(requests.map((request) => authorizeOfflineDownloadRequest(request)))
  })
  ipcMain.handle('offline:cancel', async (event, id: string) => {
    assertTrustedIpcSender(event, 'offline downloads IPC')
    return service!.cancel(id)
  })
  ipcMain.handle('offline:unpin', async (event, id: string) => {
    assertTrustedIpcSender(event, 'offline downloads IPC')
    return service!.unpin(id)
  })
  ipcMain.handle('offline:getPlayablePath', async (event, providerId: string, trackId: string) => {
    assertTrustedIpcSender(event, 'offline downloads IPC')
    return service!.getPlayablePath(providerId, trackId)
  })
  ipcMain.handle(
    'offline:getPlayablePaths',
    async (event, requests: OfflinePlayablePathRequest[]) => {
      assertTrustedIpcSender(event, 'offline downloads IPC')
      return service!.getPlayablePaths(requests)
    }
  )
  return service
}

export function getOfflineDownloadService(): OfflineDownloadService | null {
  return service
}

export function destroyOfflineDownloadIpc(): void {
  service?.shutdown()
  service = null
}
