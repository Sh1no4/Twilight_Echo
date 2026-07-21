import { app } from 'electron'
import { mkdirSync, readdirSync, existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join, extname } from 'path'
import { runtime } from '../core/runtime'
import { redactSensitiveText } from '../security/secureStorage.ts'
import { getMusicCacheStorageDirectories } from './musicCacheLayout.ts'

export function ensureMusicCacheDirectories(rootPath: string): void {
  if (!rootPath) return
  mkdirSync(rootPath, { recursive: true })
  for (const directory of getMusicCacheStorageDirectories(rootPath)) {
    mkdirSync(directory, { recursive: true })
  }
}

export function getMusicCacheRoot(): string {
  const root = runtime.appSettings.musicCachePath || join(app.getPath('userData'), 'music-cache')
  ensureMusicCacheDirectories(root)
  return root
}

export function getNcmCacheDir(): string {
  const dir = join(getMusicCacheRoot(), 'ncm-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function inferNcmCacheExtension(
  url: string,
  contentType?: string | null,
  fileName?: string
): string {
  const nameExt = fileName ? extname(fileName).toLowerCase() : ''
  if (nameExt && /^[a-z0-9.]+$/i.test(nameExt)) return nameExt

  const mime = (contentType || '').toLowerCase()
  if (mime.includes('flac')) return '.flac'
  if (mime.includes('wav')) return '.wav'
  if (mime.includes('aac')) return '.aac'
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a'
  if (mime.includes('ogg')) return '.ogg'

  try {
    const parsed = new URL(url)
    const pathExt = extname(parsed.pathname).toLowerCase()
    if (pathExt && /^[a-z0-9.]+$/i.test(pathExt)) return pathExt
  } catch {
    /* keep fallback */
  }

  return '.mp3'
}

export function getCachedNcmSong(songId: number): string | null {
  const dir = getNcmCacheDir()
  const prefix = `${songId}.`
  const file = readdirSync(dir).find((name) => name.startsWith(prefix))
  if (!file) return null
  const fullPath = join(dir, file)
  return existsSync(fullPath) ? fullPath : null
}

export async function cacheNcmSong(
  songId: number,
  url: string,
  fileName?: string
): Promise<string | null> {
  if (!Number.isFinite(songId) || songId <= 0 || !isSafeRemoteMediaUrl(url)) return null

  const cached = getCachedNcmSong(songId)
  if (cached) return cached

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    // NetEase CDN edges reject bare Node fetch without a browser-like UA/Referer
    // (same constraint as the twilight-media proxy and native FFmpeg open path).
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: 'https://music.163.com/'
      }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ext = inferNcmCacheExtension(url, res.headers.get('content-type'), fileName)
    const target = join(getNcmCacheDir(), `${songId}${ext}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    await writeFile(target, buffer)
    return target
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('网易云歌曲缓存失败：', songId, redactSensitiveText(message))
    return null
  } finally {
    clearTimeout(timer)
  }
}

function isSafeRemoteMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    if (parsed.username || parsed.password) return false
    const hostname = parsed.hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]'
    ) {
      return false
    }
    if (isPrivateIpv4(hostname)) return false
    return true
  } catch {
    return false
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10))
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false
  }
  const [a, b] = parts
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}
