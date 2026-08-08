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
    if (entry.sizeBytes != null && partialSize > entry.sizeBytes) {
      await rm(temp, { force: true })
      partialSize = 0
    }
    if (entry.sizeBytes != null && partialSize === entry.sizeBytes) {
      await rename(temp, target)
      return target
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal?.aborted) throw new NetworkSourceFailure('timeout', '网络文件下载已取消')
      const start = attempt === 0 ? partialSize : 0
      if (start === 0 && attempt > 0) await rm(temp, { force: true })
      const stream = await session.readStream(entry.path, signal, { start })
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(temp, { flags: start > 0 ? 'a' : 'w' })
        const onAbort = (): void => {
          out.destroy(new Error('download aborted'))
          const destroyable = stream as NodeJS.ReadableStream & {
            destroy?: (error?: Error) => void
          }
          destroyable.destroy?.(new Error('download aborted'))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        stream.on('error', reject)
        out.on('error', reject)
        out.on('finish', resolve)
        out.on('close', () => signal?.removeEventListener('abort', onAbort))
        stream.pipe(out)
      })
      const completedSize = (await stat(temp)).size
      if (entry.sizeBytes == null || completedSize === entry.sizeBytes) {
        await rename(temp, target)
        return target
      }
      // A server that ignored Range returns the whole object. Reset once and
      // retry from byte zero; never publish a concatenated/corrupt cache.
      if (start > 0 && completedSize > entry.sizeBytes) continue
      throw new NetworkSourceFailure(
        'network',
        `网络文件大小不匹配：预期 ${entry.sizeBytes}，实际 ${completedSize}`
      )
    }
    throw new NetworkSourceFailure('network', '网络文件无法完成下载')
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
