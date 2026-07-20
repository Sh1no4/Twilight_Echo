import { BrowserWindow } from 'electron'
import { SleepTimerService } from './sleepTimerCore.ts'

export { SleepTimerService, type SleepTimerServiceOptions } from './sleepTimerCore.ts'

export const sleepTimerService = new SleepTimerService({
  publish: (kind, state) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window || window.isDestroyed()) return
    window.webContents.send(`sleepTimer:${kind}`, state)
  }
})
