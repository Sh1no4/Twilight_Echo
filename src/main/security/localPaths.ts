import { app } from 'electron'
import { stat } from 'fs/promises'
import { dirname, extname, relative, resolve } from 'path'
import { runtime } from '../core/runtime'
import { getDefaultCachePath } from '../core/settings'
import {
  resolvePlayableAudioFile,
  SUPPORTED_EXTENSIONS
} from '../library/scan'

const savedLibraryRoots = new Set<string>()
const userSelectedRoots = new Set<string>()

function isPathInside(basePath: string, targetPath: string): boolean {
  const base = resolve(basePath)
  const target = resolve(targetPath)
  const rel = relative(base, target)
  return rel === '' || (!!rel && !rel.startsWith('..') && !rel.startsWith('/') && !rel.startsWith('\\'))
}

function libraryRoots(): string[] {
  return [
    ...runtime.appSettings.libraryFolders,
    ...savedLibraryRoots,
    ...userSelectedRoots
  ].filter((folder) => typeof folder === 'string' && folder)
}

function appManagedRoots(): string[] {
  const cachePath = runtime.appSettings.musicCachePath || getDefaultCachePath()
  return [
    app.getPath('userData'),
    cachePath
  ].filter(Boolean)
}

export function isInLibraryRoot(targetPath: string): boolean {
  if (typeof targetPath !== 'string' || !targetPath) return false
  return libraryRoots().some((root) => isPathInside(root, targetPath))
}

export function trustLibraryRoots(folders: unknown): void {
  savedLibraryRoots.clear()
  if (!Array.isArray(folders)) return
  for (const folder of folders) {
    if (typeof folder === 'string' && folder) {
      savedLibraryRoots.add(resolve(folder))
    }
  }
}

export function trustUserSelectedFolder(folder: string): void {
  if (typeof folder === 'string' && folder) {
    userSelectedRoots.add(resolve(folder))
  }
}

export function isInAppManagedRoot(targetPath: string): boolean {
  if (typeof targetPath !== 'string' || !targetPath) return false
  return appManagedRoots().some((root) => isPathInside(root, targetPath))
}

export function isAllowedLocalAudioPath(targetPath: string): boolean {
  return isInLibraryRoot(targetPath) || isInAppManagedRoot(targetPath)
}

export async function resolveAuthorizedAudioFile(filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('音频路径无效')
  }
  const resolvedPath = await resolvePlayableAudioFile(filePath)
  if (!isAllowedLocalAudioPath(resolvedPath)) {
    throw new Error('音频路径不在已授权目录内')
  }
  return resolvedPath
}

export async function resolveAuthorizedLibraryDirectory(dirPath: string): Promise<string> {
  if (typeof dirPath !== 'string' || !dirPath) {
    throw new Error('目录路径无效')
  }
  const resolvedPath = resolve(dirPath)
  const dirStat = await stat(resolvedPath)
  if (!dirStat.isDirectory()) {
    throw new Error('路径不是目录')
  }
  if (!isInLibraryRoot(resolvedPath)) {
    throw new Error('目录不在音乐库内')
  }
  return resolvedPath
}

export async function resolveAuthorizedOpenPath(targetPath: string): Promise<string> {
  if (typeof targetPath !== 'string' || !targetPath) {
    throw new Error('路径无效')
  }
  const resolvedPath = resolve(targetPath)
  const targetStat = await stat(resolvedPath)
  if (targetStat.isDirectory()) {
    if (isInLibraryRoot(resolvedPath) || isInAppManagedRoot(resolvedPath)) {
      return resolvedPath
    }
    throw new Error('目录不在已授权目录内')
  }
  if (!isInLibraryRoot(resolvedPath)) {
    throw new Error('文件不在音乐库内')
  }
  if (!SUPPORTED_EXTENSIONS.includes(extname(resolvedPath).toLowerCase())) {
    throw new Error('只能打开音乐库内的音频文件')
  }
  return resolvedPath
}

export async function resolveAuthorizedShowItemPath(filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('路径无效')
  }
  const resolvedPath = resolve(filePath)
  const targetStat = await stat(resolvedPath)
  const checkedPath = targetStat.isDirectory() ? resolvedPath : dirname(resolvedPath)
  if (!isInLibraryRoot(checkedPath) && !isInAppManagedRoot(checkedPath)) {
    throw new Error('路径不在已授权目录内')
  }
  return resolvedPath
}
