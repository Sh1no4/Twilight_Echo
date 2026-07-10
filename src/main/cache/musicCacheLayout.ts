import { lstat, mkdir, readdir, rm } from 'fs/promises'
import { join, resolve } from 'path'

export const MANAGED_MUSIC_CACHE_DIRECTORY_NAMES = [
  'renderer-cache',
  'audio-engine-cache',
  'ncm-cache',
  'cover-cache'
] as const

export function getManagedMusicCacheDirectories(rootPath: string): string[] {
  const root = resolve(rootPath)
  return MANAGED_MUSIC_CACHE_DIRECTORY_NAMES.map((name) => join(root, name))
}

export async function getManagedMusicCacheSize(rootPath: string): Promise<number> {
  const sizes = await Promise.all(
    getManagedMusicCacheDirectories(rootPath).map((directory) => getPathSize(directory))
  )
  return sizes.reduce((total, size) => total + size, 0)
}

export async function clearManagedMusicCache(rootPath: string): Promise<void> {
  const root = resolve(rootPath)
  const directories = getManagedMusicCacheDirectories(root)
  await mkdir(root, { recursive: true })
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })))
}

async function getPathSize(targetPath: string): Promise<number> {
  try {
    const info = await lstat(targetPath)
    if (info.isSymbolicLink()) return 0
    if (!info.isDirectory()) return info.size

    const entries = await readdir(targetPath)
    const sizes = await Promise.all(entries.map((entry) => getPathSize(join(targetPath, entry))))
    return sizes.reduce((total, size) => total + size, 0)
  } catch {
    return 0
  }
}
