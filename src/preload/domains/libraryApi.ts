import { ipcRenderer } from 'electron'
import type {
  DuplicateDetectionReadApi,
  DuplicateDetectionResult,
  LibraryChange,
  LocalLibraryRemoveRequest,
  LocalLibraryRemoveResult,
  LocalLibraryResetResult,
  LocalLibraryRestoreRequest,
  LocalLibraryRestoreResult,
  LocalLibraryScanProgress,
  LocalLibraryScanStatus,
  LocalLibraryScanUpdate,
  LocalLibraryTagRestoreRequest,
  LocalLibraryTagRestoreResult,
  LocalLibraryTagWriteRequest,
  LocalLibraryTagWriteResult,
  LibraryWatcherStatusSnapshot
} from '../types'

const duplicateDetectionApi: DuplicateDetectionReadApi = {
  detectDuplicates: (): Promise<DuplicateDetectionResult> =>
    ipcRenderer.invoke('library:detectDuplicates')
}

export const libraryAndFileSystemApi = {
  library: {
    removeTracks: (request: LocalLibraryRemoveRequest): Promise<LocalLibraryRemoveResult> =>
      ipcRenderer.invoke('library:removeTracks', request),
    restoreExclusions: (request: LocalLibraryRestoreRequest): Promise<LocalLibraryRestoreResult> =>
      ipcRenderer.invoke('library:restoreExclusions', request),
    reset: (): Promise<LocalLibraryResetResult> => ipcRenderer.invoke('library:reset'),
    ...duplicateDetectionApi,
    writeTags: (request: LocalLibraryTagWriteRequest): Promise<LocalLibraryTagWriteResult> =>
      ipcRenderer.invoke('library:writeTags', request),
    restoreTags: (request: LocalLibraryTagRestoreRequest): Promise<LocalLibraryTagRestoreResult> =>
      ipcRenderer.invoke('library:restoreTags', request),
    scanStartup: (): Promise<LocalLibraryScanUpdate> => ipcRenderer.invoke('library:scanStartup'),
    scanFull: (): Promise<LocalLibraryScanUpdate> => ipcRenderer.invoke('library:scanFull'),
    getScanStatus: (): Promise<LocalLibraryScanStatus> =>
      ipcRenderer.invoke('library:getScanStatus'),
    getWatcherStatus: (): Promise<LibraryWatcherStatusSnapshot> =>
      ipcRenderer.invoke('library:getWatcherStatus'),
    pauseScan: (): Promise<boolean> => ipcRenderer.invoke('library:pauseScan'),
    resumeScan: (): Promise<boolean> => ipcRenderer.invoke('library:resumeScan'),
    cancelScan: (): Promise<boolean> => ipcRenderer.invoke('library:cancelScan'),
    onChanged: (cb: (change: LibraryChange | undefined) => void): (() => void) => {
      const handler = (_event, change: LibraryChange | undefined): void => cb(change)
      ipcRenderer.on('library:changed', handler)
      return () => ipcRenderer.removeListener('library:changed', handler)
    },
    onCoversMissing: (cb: (info: { dirtyCount: number }) => void): (() => void) => {
      const handler = (_event, info: { dirtyCount: number }): void => cb(info)
      ipcRenderer.on('library:covers-missing', handler)
      return () => ipcRenderer.removeListener('library:covers-missing', handler)
    },
    onScanProgress: (cb: (progress: LocalLibraryScanProgress) => void): (() => void) => {
      const handler = (_event, progress: LocalLibraryScanProgress): void => cb(progress)
      ipcRenderer.on('library:scan-progress', handler)
      return () => ipcRenderer.removeListener('library:scan-progress', handler)
    },
    onScanStatus: (cb: (status: LocalLibraryScanStatus) => void): (() => void) => {
      const handler = (_event, status: LocalLibraryScanStatus): void => cb(status)
      ipcRenderer.on('library:scan-status', handler)
      return () => ipcRenderer.removeListener('library:scan-status', handler)
    }
  },
  fs: {
    scanMusicFiles: (folderPath: string): Promise<unknown[]> =>
      ipcRenderer.invoke('fs:scanMusicFiles', folderPath),
    readAudioFile: (filePath: string): Promise<{ buffer: ArrayBuffer; mimeType: string }> =>
      ipcRenderer.invoke('fs:readAudioFile', filePath),
    getAudioFileUrl: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('fs:getAudioFileUrl', filePath),
    isAudioFileAuthorized: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('fs:isAudioFileAuthorized', filePath),
    onScanProgress: (cb: (progress: { current: number; total: number }) => void): (() => void) => {
      const handler = (_event, data: { current: number; total: number }): void => cb(data)
      ipcRenderer.on('fs:scanProgress', handler)
      return () => ipcRenderer.removeListener('fs:scanProgress', handler)
    }
  }
}
