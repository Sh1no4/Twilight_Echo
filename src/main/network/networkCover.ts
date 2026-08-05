import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ENTRY_ID_PATTERN = /^[0-9a-f]{64}$/

/**
 * 读取 cover-cache 中按条目 id 命名的封面并返回 data URL。
 * entryId 必须是 64 位十六进制（条目稳定 id），防止路径穿越。
 */
export async function readCoverDataUrl(
  entryId: string,
  coverCacheRoot: string
): Promise<string | null> {
  if (!ENTRY_ID_PATTERN.test(entryId)) return null
  const candidates: Array<{ extension: string; mime: string }> = [
    { extension: 'jpg', mime: 'image/jpeg' },
    { extension: 'png', mime: 'image/png' }
  ]
  for (const candidate of candidates) {
    try {
      const data = await readFile(join(coverCacheRoot, `${entryId}.${candidate.extension}`))
      return `data:${candidate.mime};base64,${data.toString('base64')}`
    } catch {
      // 尝试下一个扩展名
    }
  }
  return null
}
