import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { NetworkSourceFailure } from './errors.ts'
import type { NetworkSourceSession } from './adapters/types.ts'
import type { NetworkEntry } from '../../shared/networkSources.ts'

/**
 * 把远程条目下载到 network-cache。
 * 缓存键使用条目稳定 id（协议+profile+路径哈希），文件名不信任远程名。
 */
export async function downloadEntryToCache(deps: {
  session: NetworkSourceSession
  entry: NetworkEntry
  cacheRoot: string
  signal?: AbortSignal
}): Promise<string> {
  const { session, entry, cacheRoot, signal } = deps
  const extension = entry.name.includes('.') ? extname(entry.name) : ''
  const target = join(cacheRoot, `${entry.id}${extension}`)
  await mkdir(cacheRoot, { recursive: true })

  try {
    const info = await stat(target)
    if (entry.sizeBytes == null || info.size === entry.sizeBytes) return target
  } catch {
    // 未缓存，继续下载
  }

  const temp = `${target}.part`
  try {
    let partialSize = 0
    try {
      partialSize = (await stat(temp)).size
    } catch {
      // 无部分文件，从头下载
    }
    if (entry.sizeBytes != null && partialSize >= entry.sizeBytes) {
      await rename(temp, target)
      return target
    }
    const stream = await session.readStream(entry.path, signal, { start: partialSize })
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(temp, { flags: 'a' })
      stream.on('error', reject)
      out.on('error', reject)
      out.on('finish', resolve)
      stream.pipe(out)
    })
    await rename(temp, target)
    return target
  } catch (err) {
    if (err instanceof NetworkSourceFailure) throw err
    throw new NetworkSourceFailure('network', `网络文件下载失败：${(err as Error).message}`)
  }
}

export function networkCacheDir(musicCacheRoot: string): string {
  return join(musicCacheRoot, 'network-cache')
}

export async function getDirectorySize(directory: string): Promise<number> {
  let total = 0
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const target = join(directory, entry.name)
      if (entry.isDirectory()) {
        total += await getDirectorySize(target)
      } else {
        const info = await stat(target)
        total += info.size
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return total
}

export async function clearDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
}
