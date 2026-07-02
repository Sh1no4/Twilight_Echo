import { ref, shallowRef, type Ref } from 'vue'
import type { Track } from '../types/music'
import { syncPluginProviders, useMediaProviders } from '../providers/index.ts'
import { enrichLocalTracksFromProviders } from '../utils/libraryMetadataEnrichment.ts'
import { getLogicalTrackKey } from '../utils/logicalTrackIdentity.ts'
import { repairMovedLocalTracks } from '../utils/libraryRepair.ts'

interface Playlist {
  id: string
  name: string
  trackIds: string[]
  trackSnapshots?: Record<string, Track>
  isDefault?: boolean
  createdAt: string
}

interface LibraryItem {
  name: string
  trackCount: number
  tracks: Track[]
  cover: string | null
  artist?: string
  path?: string
}

interface AddTracksOptions {
  deferRebuild?: boolean
}

const DEFAULT_FAVORITE_PLAYLIST_NAME = '我收藏的音乐'

const tracks = shallowRef<Track[]>([])
const scannedFolders = ref<string[]>([])
const isScanning = ref(false)
const artists = shallowRef<LibraryItem[]>([])
const albums = shallowRef<LibraryItem[]>([])
const folders = shallowRef<LibraryItem[]>([])
const playlists = ref<Playlist[]>([])
const trackById = new Map<string, Track>()
const trackPathSet = new Set<string>()

// Rebuild coalescing state — module-level so it persists across useMusicStore() calls.
let rebuildScheduled = false
let rebuildCount = 0

// Save debounce state — module-level so it persists across useMusicStore() calls.
let saveLibraryTimer: ReturnType<typeof setTimeout> | null = null
const pendingSaveResolvers: Array<() => void> = []

export function useMusicStore(): {
  tracks: Ref<Track[]>
  artists: Ref<LibraryItem[]>
  albums: Ref<LibraryItem[]>
  folders: Ref<LibraryItem[]>
  playlists: Ref<Playlist[]>
  addTracks: (newTracks: Track[], options?: AddTracksOptions) => Promise<void>
  removeTrack: (id: string) => void
  clearTracks: () => void
  createPlaylist: (name: string) => string
  addToPlaylist: (playlistName: string, trackId: string, trackSnapshot?: Track) => void
  removeFromPlaylist: (playlistName: string, trackId: string) => void
  replaceTrackReference: (oldTrackId: string, replacementTrack: Track) => number
  isFavoriteTrack: (track: Track) => boolean
  addFavoriteTrack: (track: Track) => void
  removeFavoriteTrack: (track: Track) => void
  deletePlaylist: (playlistId: string) => void
  getPlaylistTracks: (playlistName: string) => Track[]
  savePlaylists: () => Promise<void>
  loadPlaylists: () => Promise<void>
  saveLibrary: () => Promise<void>
  scheduleSaveLibrary: () => Promise<void>
  flushSaveLibrary: () => void
  loadLibrary: () => Promise<void>
  handleLibraryChange: (change: { kind: 'add' | 'remove' | 'unknown'; path?: string } | undefined) => Promise<void>
  refreshLibraryIndex: () => void
  scannedFolders: Ref<string[]>
  isScanning: Ref<boolean>
  addFolder: (path: string) => void
  removeFolder: (path: string) => void
  syncFolders: (folders: string[]) => void
  flushRebuild: () => void
  getRebuildCount: () => number
} {
  function rebuildDerivedCollections(): void {
    trackById.clear()
    trackPathSet.clear()
    const artistMap = new Map<string, Track[]>()
    const albumMap = new Map<string, Track[]>()
    const folderMap = new Map<string, Track[]>()

    for (const track of tracks.value) {
      trackById.set(track.id, track)
      trackPathSet.add(track.filePath)
      const artistName = track.artist || '未知艺术家'
      if (!artistMap.has(artistName)) artistMap.set(artistName, [])
      artistMap.get(artistName)!.push(track)

      const albumName = track.album || '未知专辑'
      if (!albumMap.has(albumName)) albumMap.set(albumName, [])
      albumMap.get(albumName)!.push(track)

      const dir =
        track.dir ||
        track.filePath.slice(
          0,
          Math.max(track.filePath.lastIndexOf('\\'), track.filePath.lastIndexOf('/'))
        )
      if (dir) {
        if (!folderMap.has(dir)) folderMap.set(dir, [])
        folderMap.get(dir)!.push(track)
      }
    }

    artists.value = Array.from(artistMap.entries())
      .map(([name, items]) => ({
        name,
        trackCount: items.length,
        tracks: items,
        cover: items.find((t) => t.cover)?.cover ?? null
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))

    albums.value = Array.from(albumMap.entries())
      .map(([name, items]) => ({
        name,
        trackCount: items.length,
        tracks: items,
        cover: items.find((t) => t.cover)?.cover ?? null,
        artist: items[0].artist || '未知艺术家'
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))

    folders.value = scannedFolders.value
      .map((folderPath) => {
        const normalized = folderPath.replace(/[\\/]+$/, '')
        const items = folderMap.get(folderPath) || folderMap.get(normalized) || []
        const name = normalized.split(/[\\/]/).pop() || folderPath
        return {
          name,
          path: folderPath,
          trackCount: items.length,
          tracks: items,
          cover: items.find((t) => t.cover)?.cover ?? null
        }
      })
      .filter((f) => f.trackCount > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }

  async function doSaveLibrary(): Promise<void> {
    await window.api.data.saveMusicLibrary({
      tracks: tracks.value,
      folders: [...scannedFolders.value]
    })
    const resolvers = pendingSaveResolvers.splice(0)
    for (const resolve of resolvers) resolve()
  }

  async function saveLibrary(): Promise<void> {
    // Direct save: flush any pending timer and write immediately
    if (saveLibraryTimer !== null) {
      clearTimeout(saveLibraryTimer)
      saveLibraryTimer = null
    }
    await doSaveLibrary()
  }

  function scheduleSaveLibrary(): Promise<void> {
    return new Promise<void>((resolve) => {
      pendingSaveResolvers.push(resolve)
      if (saveLibraryTimer !== null) clearTimeout(saveLibraryTimer)
      saveLibraryTimer = setTimeout(() => {
        saveLibraryTimer = null
        void doSaveLibrary()
      }, 500)
    })
  }

  function flushSaveLibrary(): void {
    if (saveLibraryTimer !== null) {
      clearTimeout(saveLibraryTimer)
      saveLibraryTimer = null
    }
    // Best-effort synchronous save for quit-flush (beforeunload)
    void window.api.data.saveMusicLibrary({
      tracks: tracks.value,
      folders: [...scannedFolders.value]
    })
    const resolvers = pendingSaveResolvers.splice(0)
    for (const resolve of resolvers) resolve()
  }

  function scheduleRebuild(): void {
    if (rebuildScheduled) return
    rebuildScheduled = true
    queueMicrotask(() => {
      if (!rebuildScheduled) return
      rebuildScheduled = false
      rebuildDerivedCollections()
      rebuildCount++
    })
  }

  function flushRebuild(): void {
    if (rebuildScheduled) {
      rebuildScheduled = false
      rebuildDerivedCollections()
      rebuildCount++
    }
  }

  async function loadLibrary(): Promise<void> {
    const saved = await window.api.data.loadMusicLibrary()
    if (!saved) return

    let loadedTracks: Track[]
    if (Array.isArray(saved)) {
      loadedTracks = saved as Track[]
    } else {
      loadedTracks = (saved.tracks || []) as Track[]
      scannedFolders.value = (saved.folders || []) as string[]
    }
    const repairedTracks = await repairMovedTracksFromScannedFolders(loadedTracks)
    tracks.value = await enrichTracksFromProviders(repairedTracks)
    rebuildDerivedCollections()
  }

  async function repairMovedTracksFromScannedFolders(loadedTracks: Track[]): Promise<Track[]> {
    if (scannedFolders.value.length === 0 || loadedTracks.length === 0) return loadedTracks
    try {
      const scanned = (
        await Promise.all(scannedFolders.value.map((folder) => window.api.fs.scanMusicFiles(folder)))
      ).flat() as Track[]
      const scannedPaths = new Set(scanned.map((track) => track.filePath))
      const repaired = repairMovedLocalTracks({
        existingTracks: loadedTracks,
        scannedTracks: scanned,
        fileExists: (path) => scannedPaths.has(path)
      })
      if (repaired.repairedTracks.length === 0) return loadedTracks
      const repairedById = new Map(repaired.repairedTracks.map((track) => [track.id, track]))
      const nextTracks = loadedTracks.map((track) => repairedById.get(track.id) ?? track)
      void scheduleSaveLibrary()
      return nextTracks
    } catch {
      return loadedTracks
    }
  }

  async function handleLibraryChange(
    change: { kind: 'add' | 'remove' | 'unknown'; path?: string } | undefined
  ): Promise<void> {
    try {
      // Single file removal
      if (change?.kind === 'remove' && change.path) {
        const track = tracks.value.find((t) => t.filePath === change.path)
        if (track) {
          removeTrack(track.id)
          void scheduleSaveLibrary()
          return
        }
        // Track not found — fall through to full reload
      }

      // Single file addition or content change
      if (change?.kind === 'add' && change.path) {
        const lastSep = Math.max(change.path.lastIndexOf('\\'), change.path.lastIndexOf('/'))
        const dir = lastSep >= 0 ? change.path.slice(0, lastSep) : change.path
        const scanned = await window.api.fs.scanMusicFiles(dir)
        const newTracks = (scanned as Track[]).filter((t) => t.filePath === change.path)
        if (newTracks.length > 0) {
          // If path already in trackPathSet (content change / tag edit):
          // remove old track first, then add new (remove-then-add)
          if (trackPathSet.has(change.path)) {
            const oldTrack = tracks.value.find((t) => t.filePath === change.path)
            if (oldTrack) {
              removeTrack(oldTrack.id)
            }
          }
          await addTracks(newTracks)
          return
        }
        // No tracks found in scan — fall through to full reload
      }

      // Fallback: full reload for unknown/no-path/incremental failure
      await loadLibrary()
    } catch {
      // Incremental parse failed — fallback to full reload
      await loadLibrary()
    }
  }

  async function addTracks(newTracks: Track[], options: AddTracksOptions = {}): Promise<void> {
    const unique: Track[] = []
    for (const track of newTracks) {
      if (trackPathSet.has(track.filePath)) continue
      trackPathSet.add(track.filePath)
      trackById.set(track.id, track)
      unique.push(track)
    }
    if (unique.length === 0) return

    const enriched = await enrichTracksFromProviders(unique)
    tracks.value = [...tracks.value, ...enriched]
    if (!options.deferRebuild) {
      scheduleRebuild()
    }
    if (!isScanning.value) {
      void scheduleSaveLibrary()
    }
  }

  function removeTrack(id: string): void {
    const track = trackById.get(id)
    if (track) {
      trackPathSet.delete(track.filePath)
      trackById.delete(id)
    }
    tracks.value = tracks.value.filter((t) => t.id !== id)
    scheduleRebuild()
  }

  function clearTracks(): void {
    rebuildScheduled = false
    tracks.value = []
    rebuildDerivedCollections()
  }

  function createPlaylist(name: string): string {
    const existing = playlists.value.find((p) => p.name === name)
    if (existing) return existing.id
    const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    playlists.value = [...playlists.value, {
      id,
      name,
      trackIds: [],
      createdAt: new Date().toISOString()
    }]
    void savePlaylists()
    return id
  }

  function deletePlaylist(playlistId: string): void {
    const pl = playlists.value.find((p) => p.id === playlistId)
    if (pl?.isDefault) return
    playlists.value = playlists.value.filter((p) => p.id !== playlistId)
    void savePlaylists()
  }

  function addToPlaylist(playlistName: string, trackId: string, trackSnapshot?: Track): void {
    const pl = playlists.value.find((p) => p.name === playlistName)
    if (pl) {
      let changed = false
      if (!pl.trackIds.includes(trackId)) {
        pl.trackIds = [...pl.trackIds, trackId]
        changed = true
      }
      if (trackSnapshot) {
        pl.trackSnapshots = {
          ...(pl.trackSnapshots ?? {}),
          [trackId]: toPlaylistTrackSnapshot(trackSnapshot)
        }
        changed = true
      }
      if (!changed) return
      void savePlaylists()
    }
  }

  async function enrichTracksFromProviders(inputTracks: Track[]): Promise<Track[]> {
    try {
      await syncPluginProviders()
      const providers = useMediaProviders()
      const enriched = await enrichLocalTracksFromProviders(inputTracks, {
        searchSongs: async (query, limit, offset) => {
          const result = await providers.searchAllSongs({
            query,
            localTracks: [],
            limit,
            offset
          })
          const items = result.items.map((item) => item.track)
          return { items, total: items.length }
        }
      })
      if (enriched !== inputTracks) void scheduleSaveLibrary()
      return enriched
    } catch {
      return inputTracks
    }
  }

  function removeFromPlaylist(playlistName: string, trackId: string): void {
    const pl = playlists.value.find((p) => p.name === playlistName)
    if (pl) {
      pl.trackIds = pl.trackIds.filter((id) => id !== trackId)
      if (pl.trackSnapshots?.[trackId]) {
        const { [trackId]: _removed, ...remaining } = pl.trackSnapshots
        pl.trackSnapshots = Object.keys(remaining).length > 0 ? remaining : undefined
      }
      void savePlaylists()
    }
  }

  function getDefaultFavoritePlaylist(): Playlist | null {
    return (
      playlists.value.find((playlist) => playlist.isDefault) ??
      playlists.value.find((playlist) => playlist.name === DEFAULT_FAVORITE_PLAYLIST_NAME) ??
      null
    )
  }

  function getPlaylistTrackSnapshot(playlist: Playlist, trackId: string): Track | undefined {
    return trackById.get(trackId) ?? playlist.trackSnapshots?.[trackId]
  }

  function resolvePlaylistTrack(playlist: Playlist, trackId: string): Track | undefined {
    const exact = trackById.get(trackId)
    if (exact) return exact
    const snapshot = playlist.trackSnapshots?.[trackId]
    if (!snapshot) return undefined
    const key = getLogicalTrackKey(snapshot)
    return tracks.value.find((track) =>
      getTrackSource(track) === 'local' && getLogicalTrackKey(track) === key
    ) ?? snapshot
  }

  function getTrackSource(track: Pick<Track, 'id' | 'source'>): string {
    if (track.source) return track.source
    if (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)) return 'local'
    const separatorIndex = track.id.indexOf(':')
    return separatorIndex > 0 ? track.id.slice(0, separatorIndex) : 'local'
  }

  function isFavoriteTrack(track: Track): boolean {
    const playlist = getDefaultFavoritePlaylist()
    if (!playlist) return false
    const key = getLogicalTrackKey(track)
    return playlist.trackIds.some((trackId) => {
      if (trackId === track.id) return true
      const snapshot = getPlaylistTrackSnapshot(playlist, trackId)
      return !!snapshot && getLogicalTrackKey(snapshot) === key
    })
  }

  function addFavoriteTrack(track: Track): void {
    let playlist = getDefaultFavoritePlaylist()
    if (!playlist) {
      createPlaylist(DEFAULT_FAVORITE_PLAYLIST_NAME)
      playlist = getDefaultFavoritePlaylist()
    }
    if (!playlist || isFavoriteTrack(track)) return
    addToPlaylist(playlist.name, track.id, track)
  }

  function removeFavoriteTrack(track: Track): void {
    const playlist = getDefaultFavoritePlaylist()
    if (!playlist) return
    const key = getLogicalTrackKey(track)
    const nextTrackIds = playlist.trackIds.filter((trackId) => {
      if (trackId === track.id) return false
      const snapshot = getPlaylistTrackSnapshot(playlist, trackId)
      return !snapshot || getLogicalTrackKey(snapshot) !== key
    })
    if (nextTrackIds.length === playlist.trackIds.length) return
    const removed = new Set(playlist.trackIds.filter((trackId) => !nextTrackIds.includes(trackId)))
    playlist.trackIds = nextTrackIds
    if (playlist.trackSnapshots) {
      const snapshots = { ...playlist.trackSnapshots }
      for (const trackId of removed) delete snapshots[trackId]
      playlist.trackSnapshots = Object.keys(snapshots).length > 0 ? snapshots : undefined
    }
    void savePlaylists()
  }

  function replaceTrackReference(oldTrackId: string, replacementTrack: Track): number {
    if (!oldTrackId || oldTrackId === replacementTrack.id) return 0
    let replacementCount = 0
    let libraryChanged = false
    let playlistsChanged = false

    if (trackById.has(oldTrackId)) {
      const oldTrack = trackById.get(oldTrackId)
      if (oldTrack) trackPathSet.delete(oldTrack.filePath)
      trackById.delete(oldTrackId)
      trackById.set(replacementTrack.id, replacementTrack)
      trackPathSet.add(replacementTrack.filePath)
      tracks.value = tracks.value.map((track) =>
        track.id === oldTrackId ? replacementTrack : track
      )
      libraryChanged = true
      replacementCount++
    }

    for (const playlist of playlists.value) {
      if (!playlist.trackIds.includes(oldTrackId)) continue
      const nextTrackIds: string[] = []
      for (const trackId of playlist.trackIds) {
        const nextTrackId = trackId === oldTrackId ? replacementTrack.id : trackId
        if (!nextTrackIds.includes(nextTrackId)) nextTrackIds.push(nextTrackId)
      }
      playlist.trackIds = nextTrackIds
      const snapshots = { ...(playlist.trackSnapshots ?? {}) }
      delete snapshots[oldTrackId]
      snapshots[replacementTrack.id] = toPlaylistTrackSnapshot(replacementTrack)
      playlist.trackSnapshots = Object.keys(snapshots).length > 0 ? snapshots : undefined
      playlistsChanged = true
      replacementCount++
    }

    if (libraryChanged) {
      scheduleRebuild()
      void scheduleSaveLibrary()
    }
    if (playlistsChanged) void savePlaylists()
    return replacementCount
  }

  function getPlaylistTracks(playlistName: string): Track[] {
    const pl = playlists.value.find((p) => p.name === playlistName)
    if (!pl) return []
    return pl.trackIds
      .map((trackId) => resolvePlaylistTrack(pl, trackId))
      .filter((track): track is Track => !!track)
  }

  async function savePlaylists(): Promise<void> {
    const plain = JSON.parse(JSON.stringify(playlists.value))
    await window.api.data.savePlaylists(plain)
  }

  async function loadPlaylists(): Promise<void> {
    const saved = await window.api.data.loadPlaylists()
    const DEFAULT_PLAYLIST: Playlist = {
      id: 'pl_favorites',
      name: '我收藏的音乐',
      trackIds: [],
      isDefault: true,
      createdAt: new Date().toISOString()
    }

    if (!saved || !Array.isArray(saved) || saved.length === 0) {
      // First launch: create default playlist
      playlists.value = [DEFAULT_PLAYLIST]
      void savePlaylists()
      return
    }

    const loaded = saved as Playlist[]
    // Ensure default playlist exists
    if (!loaded.find((p) => p.isDefault)) {
      loaded.unshift(DEFAULT_PLAYLIST)
    }
    playlists.value = loaded
  }

  rebuildDerivedCollections()

  return {
    tracks,
    artists,
    albums,
    folders,
    playlists,
    addTracks,
    removeTrack,
    clearTracks,
    createPlaylist,
    addToPlaylist,
    removeFromPlaylist,
    replaceTrackReference,
    isFavoriteTrack,
    addFavoriteTrack,
    removeFavoriteTrack,
    deletePlaylist,
    getPlaylistTracks,
    savePlaylists,
    loadPlaylists,
    saveLibrary,
    loadLibrary,
    refreshLibraryIndex: rebuildDerivedCollections,
    scannedFolders,
    isScanning,
    addFolder(path: string): void {
      if (!scannedFolders.value.includes(path)) {
        scannedFolders.value.push(path)
        rebuildDerivedCollections()
        saveLibrary()
      }
    },
    removeFolder(path: string): void {
      scannedFolders.value = scannedFolders.value.filter((f) => f !== path)
      rebuildDerivedCollections()
      saveLibrary()
    },
    syncFolders(folders: string[]): void {
      scannedFolders.value = [...folders]
      const folderPrefixes = folders.map((f) => {
        const normalized = f.replace(/[\\/]+$/, '')
        return normalized + (normalized.includes('\\') ? '\\' : '/')
      })
      tracks.value = tracks.value.filter((t) =>
        folderPrefixes.some((prefix) => t.filePath.startsWith(prefix) || t.filePath === prefix.slice(0, -1))
      )
      rebuildDerivedCollections()
      saveLibrary()
    },
    flushRebuild,
    getRebuildCount: () => rebuildCount,
    scheduleSaveLibrary,
    flushSaveLibrary,
    handleLibraryChange
  }
}

function toPlaylistTrackSnapshot(track: Track): Track {
  if (track.source && track.source !== 'local') {
    const { streamUrl: _streamUrl, ...snapshot } = track
    return snapshot
  }
  return {
    ...track
  }
}
