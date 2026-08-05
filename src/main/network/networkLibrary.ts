import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { NetworkSourceFailure } from './errors.ts'
import type { NetworkEntry } from '../../shared/networkSources.ts'

interface LibraryProfileIndex {
  roots: string[]
  entries: NetworkEntry[]
}

type LibraryDocument = Record<string, LibraryProfileIndex>

export interface NetworkLibraryIndex {
  addEntries(
    profileId: string,
    root: string,
    entries: NetworkEntry[]
  ): Promise<{ added: number; total: number }>
  listEntries(profileId: string, query?: string): Promise<NetworkEntry[]>
  removeEntry(profileId: string, entryId: string): Promise<void>
  removeProfile(profileId: string): Promise<void>
}

/**
 * 网络源虚拟媒体库索引：只记录远程条目（不拷贝文件），支持根目录重扫替换。
 * 条目 id 为协议+profile+路径的稳定哈希，重扫不会产生重复。
 */
export function createNetworkLibrary(deps: { filePath: string }): NetworkLibraryIndex {
  const { filePath } = deps

  async function load(): Promise<LibraryDocument> {
    try {
      const raw = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as LibraryDocument
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new NetworkSourceFailure('network', '网络媒体库索引读取失败')
    }
  }

  async function save(document: LibraryDocument): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(document), 'utf8')
  }

  function belongsToRoot(entry: NetworkEntry, root: string): boolean {
    if (root === '/') return true
    const prefix = root.endsWith('/') ? root : `${root}/`
    return entry.path.startsWith(prefix)
  }

  return {
    async addEntries(profileId, root, entries) {
      const document = await load()
      const profile = document[profileId] ?? { roots: [], entries: [] }
      const kept = profile.entries.filter((entry) => !belongsToRoot(entry, root))
      const seen = new Set(kept.map((entry) => entry.id))
      let added = 0
      for (const entry of entries) {
        if (!seen.has(entry.id)) {
          kept.push(entry)
          seen.add(entry.id)
          added += 1
        }
      }
      const roots = [...new Set([...profile.roots, root])]
      document[profileId] = { roots, entries: kept }
      await save(document)
      return { added, total: kept.length }
    },
    async listEntries(profileId, query) {
      const document = await load()
      const profile = document[profileId]
      if (!profile) return []
      const normalized = query?.trim().toLowerCase() ?? ''
      if (!normalized) return [...profile.entries]
      return profile.entries.filter((entry) =>
        entry.name.toLowerCase().includes(normalized)
      )
    },
    async removeEntry(profileId, entryId) {
      const document = await load()
      const profile = document[profileId]
      if (!profile) return
      const next = profile.entries.filter((entry) => entry.id !== entryId)
      if (next.length === profile.entries.length) return
      document[profileId] = { ...profile, entries: next }
      await save(document)
    },
    async removeProfile(profileId) {
      const document = await load()
      if (!document[profileId]) return
      delete document[profileId]
      await save(document)
    }
  }
}
