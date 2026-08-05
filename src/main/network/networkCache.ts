import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
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

  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    const stream = await session.readStream(entry.path, signal)
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(temp)
      stream.on('error', reject)
      out.on('error', reject)
      out.on('finish', resolve)
      stream.pipe(out)
    })
    await rename(temp, target)
    return target
  } catch (err) {
    await unlink(temp).catch(() => undefined)
    if (err instanceof NetworkSourceFailure) throw err
    throw new NetworkSourceFailure('network', `网络文件下载失败：${(err as Error).message}`)
  }
}
