export const NCM_CLOUD_TRANSFER_PROGRESS_CHANNEL = 'ncmCloud:progress' as const

export type NcmCloudTransferKind = 'upload' | 'download'
export type NcmCloudTransferStage =
  | 'queued'
  | 'hashing'
  | 'metadata'
  | 'authorizing'
  | 'uploading'
  | 'importing'
  | 'downloading'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface NcmCloudSelectedFile {
  handle: string
  name: string
  size: number
  format: string | null
}

export interface NcmCloudTransferProgress {
  transferId: string
  kind: NcmCloudTransferKind
  stage: NcmCloudTransferStage
  fileName: string
  handle?: string
  cloudSongId?: string | number
  bytesTransferred: number
  bytesTotal: number | null
  percent: number | null
  message: string
  error?: string
}

export interface NcmCloudUploadResult {
  transferId: string
  handle: string
  fileName: string
  accepted: true
}

export interface NcmCloudDownloadRequest {
  cloudSongId: string | number
  fileName: string
}

export interface NcmCloudDownloadResult {
  transferId: string
  fileName: string
  accepted: boolean
  cancelled: boolean
}
