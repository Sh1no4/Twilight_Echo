import { ipcMain } from 'electron'
import { runtime } from '../core/runtime'
import { OpraCatalog } from '../opraCatalog'
import { getOpraDatabaseCachePath } from '../core/settings'

function requireOpraCatalog(): OpraCatalog {
  if (!runtime.opraCatalog) {
    runtime.opraCatalog = new OpraCatalog(getOpraDatabaseCachePath())
  }
  return runtime.opraCatalog
}

export function setupOpraIpc(): void {
  runtime.opraCatalog = new OpraCatalog(getOpraDatabaseCachePath())
  void runtime.opraCatalog.loadFromCache()

  ipcMain.handle('opra:search', async (_event, query: string) => {
    return await requireOpraCatalog().search(typeof query === 'string' ? query : '')
  })

  ipcMain.handle('opra:getProfile', async (_event, eqId: string) => {
    return await requireOpraCatalog().getProfile(typeof eqId === 'string' ? eqId : '')
  })

  ipcMain.handle('opra:refresh', async () => {
    return await requireOpraCatalog().refresh()
  })

  ipcMain.handle('opra:getStatus', async () => {
    return requireOpraCatalog().getStatus()
  })
}
