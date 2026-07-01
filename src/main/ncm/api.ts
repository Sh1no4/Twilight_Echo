import { app, BrowserWindow, session, shell, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { runtime } from '../core/runtime'
import { getCachedNcmSong, cacheNcmSong } from '../cache/ncmCache'

export const NCM_API_PORT = 3100
export const NCM_OFFICIAL_LOGIN_TIMEOUT_MS = 180000
export const NCM_API_REQUEST_TIMEOUT_MS = 25000

export function bundledPluginPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'plugins', name)
    : join(process.cwd(), 'resources', 'plugins', name)
}

export function bundledPluginIndexPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'plugin-index', 'plugins.json')
    : join(process.cwd(), 'resources', 'plugin-index', 'plugins.json')
}

export async function requestNcmApi(path: string, cookie?: string): Promise<unknown> {
  const sep = path.includes('?') ? '&' : '?'
  let url = `http://localhost:${NCM_API_PORT}${path}${sep}timestamp=${Date.now()}`
  const headers: Record<string, string> = {}
  if (cookie) {
    headers.Cookie = cookie
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .join('; ')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NCM_API_REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers })
    return await res.json()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('网易云请求失败：', path, message)
    return {
      code: -1,
      message
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function collectNcmOfficialCookie(partition: string): Promise<string> {
  const ses = session.fromPartition(partition)
  const cookies = await ses.cookies.get({ domain: '.music.163.com' })
  const names = new Set(['MUSIC_U', '__csrf', 'NMTID', 'MUSIC_A'])
  return cookies
    .filter((cookie) => names.has(cookie.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join(';')
}

export async function openNcmOfficialLogin(): Promise<string> {
  const partition = `persist:twilight-ncm-login-${Date.now()}`
  const ses = session.fromPartition(partition)
  await ses.clearStorageData().catch(() => undefined)

  return await new Promise<string>((resolveLogin, rejectLogin) => {
    const owner = runtime.mainWindow && !runtime.mainWindow.isDestroyed() ? runtime.mainWindow : undefined
    const loginWindow = new BrowserWindow({
      width: 920,
      height: 680,
      minWidth: 720,
      minHeight: 560,
      title: '网易云音乐登录',
      parent: owner,
      modal: false,
      show: false,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })

    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      ses.cookies.removeListener('changed', handleCookieChanged)
      loginWindow.removeAllListeners('closed')
    }
    const finish = (cookie: string): void => {
      if (settled) return
      settled = true
      cleanup()
      if (!loginWindow.isDestroyed()) loginWindow.close()
      resolveLogin(cookie)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (!loginWindow.isDestroyed()) loginWindow.close()
      rejectLogin(error)
    }
    const checkCookie = async (): Promise<void> => {
      const cookie = await collectNcmOfficialCookie(partition)
      if (cookie.includes('MUSIC_U=')) finish(cookie)
    }
    const handleCookieChanged = (): void => {
      void checkCookie().catch(() => undefined)
    }
    const timer = setTimeout(() => {
      fail(new Error('网易云官方登录超时'))
    }, NCM_OFFICIAL_LOGIN_TIMEOUT_MS)

    ses.cookies.on('changed', handleCookieChanged)
    loginWindow.once('closed', () => {
      if (!settled) {
        settled = true
        cleanup()
        rejectLogin(new Error('已取消网易云官方登录'))
      }
    })
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?music\.163\.com\//i.test(url)) return { action: 'allow' }
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    loginWindow.webContents.on('will-navigate', (event, url) => {
      if (/^https?:\/\/([^/]+\.)?music\.163\.com\//i.test(url)) return
      event.preventDefault()
      void shell.openExternal(url)
    })
    loginWindow.once('ready-to-show', () => loginWindow.show())
    loginWindow
      .loadURL('https://music.163.com/#/login')
      .then(() => checkCookie())
      .catch((error) => fail(error instanceof Error ? error : new Error(String(error))))
  })
}

export function setupNcmIpc(): void {
  ipcMain.handle('ncm:getPort', () => NCM_API_PORT)

  ipcMain.handle('ncm:getCachedSong', async (_event, songId: number) => {
    return getCachedNcmSong(Number(songId))
  })

  ipcMain.handle(
    'ncm:cacheSong',
    async (_event, songId: number, url: string, fileName?: string) => {
      return await cacheNcmSong(Number(songId), url, fileName)
    }
  )

  ipcMain.handle('ncm:request', async (_event, path: string, cookie?: string) => {
    return requestNcmApi(path, cookie)
  })
}

export async function setupNcmApi(): Promise<void> {
  try {
    const tokenPath = join(tmpdir(), 'anonymous_token')
    if (!existsSync(tokenPath)) {
      writeFileSync(tokenPath, '', 'utf-8')
    }
    const { serveNcmApi } = await import('@neteasecloudmusicapienhanced/api/server.js')
    const app = await serveNcmApi({
      port: NCM_API_PORT,
      checkVersion: false
    })
    runtime.ncmServer = app.server
    console.log(`网易云音乐服务已启动：http://localhost:${NCM_API_PORT}`)
  } catch (err) {
    console.error('网易云音乐服务启动失败：', err)
  }
}
