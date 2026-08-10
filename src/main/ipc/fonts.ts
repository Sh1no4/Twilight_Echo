import type { IpcMain } from 'electron'
import { shouldAcceptIpcEvent } from '../security/electronSecurity.ts'
import { listInstalledFontFamilies } from './fontRegistry.ts'

export function registerFontsIpc(ipcMain: IpcMain): void {
  ipcMain.handle('fonts:listInstalled', async (event) => {
    if (!shouldAcceptIpcEvent(event, 'font list IPC')) return []
    try {
      return await listInstalledFontFamilies()
    } catch {
      return []
    }
  })
}
