import { existsSync, watch } from 'fs'
import { join, extname } from 'path'
import { runtime } from '../core/runtime'
import {
  isActiveLibraryPathExcluded,
  isLibraryPathMutationInProgress
} from './libraryRepository.ts'

// ── Library folder watchers ───────────────────────────────────────
const LIBRARY_DEPENDENCY_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.wav',
  '.ape',
  '.m4a',
  '.ogg',
  '.opus',
  '.wma',
  '.aac',
  '.dsf',
  '.dff',
  '.iso',
  '.cue'
])
const libraryWatchers = new Map<
  string,
  {
    watcher: ReturnType<(typeof import('fs'))['watch']>
    debounce: NodeJS.Timeout | null
    changes: Map<string, { kind: 'add' | 'remove'; path: string }>
  }
>()

// Once-per-session flag: prevents repeated library:covers-missing notifications

function notifyLibraryChanged(change?: {
  kind: 'add' | 'remove' | 'unknown'
  path?: string
}): void {
  runtime.mainWindow?.webContents.send('library:changed', change)
}

function createFolderWatcher(folder: string): void {
  if (libraryWatchers.has(folder)) return
  try {
    const watcher = watch(folder, { recursive: true }, (_eventType, filename) => {
      if (!filename) return
      const ext = extname(filename).toLowerCase()
      if (!LIBRARY_DEPENDENCY_EXTENSIONS.has(ext)) return
      const fullPath = join(folder, filename)
      if (isActiveLibraryPathExcluded(fullPath) || isLibraryPathMutationInProgress(fullPath)) return
      const entry = libraryWatchers.get(folder)
      if (!entry) return
      // Determine kind using existsSync (rename events are ambiguous)
      const kind: 'add' | 'remove' = existsSync(fullPath) ? 'add' : 'remove'
      // Dedupe by kind:path — same event (rename+change) coalesces to 1
      const key = fullPath.replace(/\//g, '\\').toLocaleLowerCase('en-US')
      entry.changes.set(key, { kind, path: fullPath })
      if (entry.debounce) clearTimeout(entry.debounce)
      entry.debounce = setTimeout(() => {
        entry.debounce = null
        const changes = Array.from(entry.changes.values())
        entry.changes.clear()
        const coordinator = runtime.localLibraryIndexCoordinator
        if (coordinator) {
          coordinator.enqueueWatcherChanges(changes)
        } else if (changes.length === 1) {
          notifyLibraryChanged(changes[0])
        } else if (changes.length > 1) {
          notifyLibraryChanged({ kind: 'unknown' })
        }
      }, runtime.libraryWatcherDebounceMs)
    })
    libraryWatchers.set(folder, { watcher, debounce: null, changes: new Map() })
  } catch (error) {
    console.warn('[library] unable to watch a configured library folder:', watcherErrorCode(error))
  }
}

function removeFolderWatcher(folder: string): void {
  const entry = libraryWatchers.get(folder)
  if (!entry) return
  if (entry.debounce) clearTimeout(entry.debounce)
  entry.changes.clear()
  try {
    entry.watcher.close()
  } catch (error) {
    console.warn('[library] unable to close a library folder watcher:', watcherErrorCode(error))
  }
  libraryWatchers.delete(folder)
}

export function applyLibraryWatchers(folders: string[], enabled: boolean): void {
  // Remove watchers for folders no longer in the list
  for (const folder of libraryWatchers.keys()) {
    if (!folders.includes(folder)) removeFolderWatcher(folder)
  }
  if (!enabled) {
    // Remove all watchers when monitoring is disabled
    for (const folder of libraryWatchers.keys()) removeFolderWatcher(folder)
    return
  }
  // Add watchers for new folders
  for (const folder of folders) {
    if (!libraryWatchers.has(folder)) createFolderWatcher(folder)
  }
}

function watcherErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown'
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'unknown'
}
// ── end Library folder watchers ───────────────────────────────────
