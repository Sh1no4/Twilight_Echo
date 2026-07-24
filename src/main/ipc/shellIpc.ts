import { shell, type IpcMain } from 'electron'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'
import { resolveAuthorizedOpenPath, resolveAuthorizedShowItemPath } from '../security/localPaths.ts'
import { normalizeIpcString } from '../security/ipcValidation.ts'

const MAX_EXTERNAL_URL_LENGTH = 8192
const MAX_LOCAL_PATH_LENGTH = 4096

function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  if (Buffer.byteLength(url, 'utf-8') > MAX_EXTERNAL_URL_LENGTH) return false
  if (/[\0\r\n]/.test(url)) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function isSafeLocalPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  const normalized = path.trim()
  if (!normalized) return false
  if (normalized.length > MAX_LOCAL_PATH_LENGTH) return false
  const hasUrlScheme = /^[a-z][a-z0-9+.-]*:/i.test(normalized)
  const isWindowsDrivePath = /^[a-zA-Z]:[\\/]/.test(normalized)
  if (hasUrlScheme && !isWindowsDrivePath) return false
  return true
}

function normalizeLocalPath(path: unknown, field: string): string {
  const normalized = normalizeIpcString(path, field, MAX_LOCAL_PATH_LENGTH)
  if (!isSafeLocalPath(normalized)) throw new Error(`${field} is not a safe local path`)
  return normalized
}

export function registerShellIpc(ipcMain: IpcMain): void {
  ipcMain.handle('shell:openPath', async (event, targetPath: string) => {
    assertTrustedIpcSender(event, 'shell IPC')
    const resolvedPath = await resolveAuthorizedOpenPath(
      normalizeLocalPath(targetPath, 'open path')
    )
    return await shell.openPath(resolvedPath)
  })
  ipcMain.handle('shell:openExternal', async (event, url: string) => {
    assertTrustedIpcSender(event, 'shell IPC')
    if (!isSafeExternalUrl(url)) return
    await shell.openExternal(url)
  })
  ipcMain.handle('shell:showItemInFolder', async (event, filePath: string) => {
    assertTrustedIpcSender(event, 'shell IPC')
    const resolvedPath = await resolveAuthorizedShowItemPath(
      normalizeLocalPath(filePath, 'show item path')
    )
    shell.showItemInFolder(resolvedPath)
  })
}
