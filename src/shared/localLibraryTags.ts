export interface LocalLibraryTagPatch {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  track?: number
  disc?: number
  year?: number
  genre?: string
  coverData?: Uint8Array
}

export interface LocalLibraryTagWriteItem extends LocalLibraryTagPatch {
  filePath: string
}

export interface LocalLibraryTagWriteRequest {
  items: LocalLibraryTagWriteItem[]
}

export interface LocalLibraryTagRestoreRequest {
  filePaths?: string[]
  fromJournal?: boolean
}

export interface LocalLibraryTagFailure {
  filePath: string
  message: string
}

export type LocalLibraryTagOperationStatus = 'success' | 'failed' | 'rolledBack' | 'notAttempted'

export interface LocalLibraryTagOperationResult {
  filePath: string
  status: LocalLibraryTagOperationStatus
  message?: string
}

export interface LocalLibraryTagWriteResult {
  items: LocalLibraryTagOperationResult[]
}

export interface LocalLibraryTagRestoreResult {
  items: LocalLibraryTagOperationResult[]
}
