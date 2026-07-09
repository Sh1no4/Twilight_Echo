import { existsSync, watch } from 'fs'
import { join, extname } from 'path'
import { runtime } from '../core/runtime'

// ── Library folder watchers ───────────────────────────────────────
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ape', '.m4a', '.ogg', '.opus', '.wma', '.aac', '.dsf', '.dff', '.iso'])
const libraryWatchers = new Map<string, {
  watcher: ReturnType<typeof import('fs')['watch']>
  debounce: NodeJS.Timeout | null
  changes: Map<string, { kind: 'add' | 'remove'; path: string }>
}>()

// Once-per-session flag: prevents repeated library:covers-missing notifications

function notifyLibraryChanged(change?: { kind: 'add' | 'remove' | 'unknown'; path?: string }): void {
  runtime.mainWindow?.webContents.send('library:changed', change)
}

function createFolderWatcher(folder: string): void {
  if (libraryWatchers.has(folder)) return
  try {
    const watcher = watch(folder, { recursive: true }, (_eventType, filename) => {
      if (!filename) return
      const ext = extname(filename).toLowerCase()
      if (!AUDIO_EXTENSIONS.has(ext)) return
      const fullPath = join(folder, filename)
      const entry = libraryWatchers.get(folder)
      if (!entry) return
      // Determine kind using existsSync (rename events are ambiguous)
      const kind: 'add' | 'remove' = existsSync(fullPath) ? 'add' : 'remove'
      // Dedupe by kind:path — same event (rename+change) coalesces to 1
      const key = `${kind}:${fullPath}`
      entry.changes.set(key, { kind, path: fullPath })
      if (entry.debounce) clearTimeout(entry.debounce)
      entry.debounce = setTimeout(() => {
        entry.debounce = null
        const changes = Array.from(entry.changes.values())
        entry.changes.clear()
        if (changes.length === 1) {
          notifyLibraryChanged(changes[0])
        } else if (changes.length > 1) {
          notifyLibraryChanged({ kind: 'unknown' })
        }
      }, runtime.libraryWatcherDebounceMs)
    })
    libraryWatchers.set(folder, { watcher, debounce: null, changes: new Map() })
  } catch {
    // Folder may not exist yet or watching unsupported — skip silently
  }
}

function removeFolderWatcher(folder: string): void {
  const entry = libraryWatchers.get(folder)
  if (!entry) return
  if (entry.debounce) clearTimeout(entry.debounce)
  entry.changes.clear()
  try { entry.watcher.close() } catch { /* ignore */ }
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
// ── end Library folder watchers ───────────────────────────────────
