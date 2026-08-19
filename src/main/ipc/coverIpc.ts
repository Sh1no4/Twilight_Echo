import type { IpcMain } from 'electron'
import {
  cacheCoverFromBuffer,
  isCoverCacheFileName,
  readCoverCacheFileBytes
} from '../library/coverCache'
import { grantRemoteImageUrl } from '../security/remoteMediaGrants.ts'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'

const MAX_DATA_URL_BYTES = 8 * 1024 * 1024
const MAX_COVER_INPUT_BYTES = 16 * 1024 * 1024

export type CoverIpcResult = Uint8Array | string | null

export function registerCoverIpc(ipcMain: IpcMain): void {
  ipcMain.handle('cover:get', async (event, handle: string): Promise<CoverIpcResult> => {
    assertTrustedIpcSender(event, 'cover IPC')
    if (!handle || typeof handle !== 'string') return null
    // Pass through existing data: URLs (e.g. from plugins)
    if (handle.startsWith('data:')) return normalizeCoverDataUrl(handle)
    if (!handle.startsWith('cover://')) return null
    const fileName = handle.slice('cover://'.length).split(/[?#]/, 1)[0]
    if (!fileName || fileName.includes('/') || !isCoverCacheFileName(fileName)) return null
    return await readCoverCacheFileBytes(fileName)
  })

  ipcMain.handle('cover:cache', async (event, input: unknown): Promise<string | null> => {
    assertTrustedIpcSender(event, 'cover IPC')
    const data = normalizeCoverBuffer(input)
    if (!data || data.byteLength === 0 || data.byteLength > MAX_COVER_INPUT_BYTES) return null
    return cacheCoverFromBuffer(data)
  })

  // Re-issue an image grant for a durable http(s) cover origin (session restore /
  // listening-stats rows whose previous twilight-media token has expired).
  ipcMain.handle('cover:grantRemote', async (event, source: string): Promise<string> => {
    assertTrustedIpcSender(event, 'cover IPC')
    const raw = typeof source === 'string' ? source.trim() : ''
    if (!raw || raw.length > 4096) throw new Error('Remote cover source is invalid')
    return grantRemoteImageUrl(raw)
  })
}

function normalizeCoverDataUrl(handle: string): string | null {
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(handle)) return null
  if (Buffer.byteLength(handle, 'utf-8') > MAX_DATA_URL_BYTES) return null
  return handle
}

function normalizeCoverBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}
