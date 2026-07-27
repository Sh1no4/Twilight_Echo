export type AppUpdateCheckError = 'network' | 'no-asset' | 'no-checksum' | 'unsupported-platform'

export type AppUpdateCheckResult = {
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  releaseNotes?: string
  assetName?: string
  assetSize?: number
  hasChecksum?: boolean
  error?: AppUpdateCheckError | string
}

export type AppUpdateProgressPhase =
  | 'idle'
  | 'resolving'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error'

export type AppUpdateProgress = {
  phase: AppUpdateProgressPhase
  percent: number
  receivedBytes: number
  totalBytes: number
  assetName?: string
  installerPath?: string
  message?: string
  error?: string
}

export type AppUpdateDownloadResult =
  | {
      ok: true
      installerPath: string
      assetName: string
      verified: boolean
      sha256?: string
    }
  | {
      ok: false
      error: string
      cancelled?: boolean
    }

export type AppUpdateInstallResult =
  | { ok: true }
  | { ok: false; error: string; installerPath?: string | null }
