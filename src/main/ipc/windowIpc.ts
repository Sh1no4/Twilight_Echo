import { BrowserWindow, type IpcMain } from 'electron'
import { shouldAcceptIpcEvent } from '../security/electronSecurity.ts'

export function registerWindowIpc(ipcMain: IpcMain): void {
  ipcMain.on('window:minimize', (event) => {
    if (!shouldAcceptIpcEvent(event, 'window control IPC')) return
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:toggleMaximize', (event) => {
    if (!shouldAcceptIpcEvent(event, 'window control IPC')) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    if (!shouldAcceptIpcEvent(event, 'window control IPC')) return
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}
