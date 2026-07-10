import { ref, shallowRef, type Ref } from 'vue'
import type { Track } from '../types/music'
import { syncPluginProviders, useMediaProviders } from '../providers/index.ts'
import { enrichLocalTracksFromProviders } from '../utils/libraryMetadataEnrichment.ts'
import { getLogicalTrackKey } from '../utils/logicalTrackIdentity.ts'
import {
  buildLogicalTracks,
  getTrackSource,
  type LogicalTrack
} from '../utils/logicalTrackModel.ts'
import { repairMovedLocalTracks } from '../utils/libraryRepair.ts'
import {
  enrichLocalTrackMetadata,
  type MetadataMatchConfidence
} from '../utils/musicMetadataMatching.ts'
import { useSettingsStore } from './useSettingsStore.ts'

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

interface ManualMetadataMatchOptions {
  confidence: MetadataMatchConfidence
  score: number
}

interface LibraryRepairReport {
  checkedAt: string
  repairedCount: number
  unresolvedCount: number
  repairedTrackIds: string[]
  unresolvedTrackIds: string[]
}

interface DerivedTrackGroup {
  tracks: Track[]
  cover: string | null
}

const DEFAULT_FAVORITE_PLAYLIST_NAME = '我收藏的音乐'

const tracks = shallowRef<Track[]>([])
const scannedFolders = ref<string[]>([])
const isScanning = ref(false)
const artists = shallowRef<LibraryItem[]>([])
const albums = shallowRef<LibraryItem[]>([])
const folders = shallowRef<LibraryItem[]>([])
const playlists = ref<Playlist[]>([])
const libraryRepairReport = ref<LibraryRepairReport | null>(null)
const trackById = new Map<string, Track>()
const trackByPath = new Map<string, Track>()
const trackIndexById = new Map<string, number>()
let derivedCollectionsInitialized = false
let tracksRevision = 0
let localLogicalTrackMapRevision = -1
let localLogicalTrackMapCache = new Map<string, LogicalTrack>()
let playlistIdentityCache: {
  playlist: Playlist
  trackIds: string[]
  snapshots: Record<string, Track> | undefined
  tracksRevision: number
  ids: Set<string>
  logicalKeys: Set<string>
} | null = null

// Rebuild coalescing state — module-level so it persists across useMusicStore() calls.
let rebuildScheduled = false
let rebuildCount = 0

// Save debounce state — module-level so it persists across useMusicStore() calls.
let saveLibraryTimer: ReturnType<typeof setTimeout> | null = null
const pendingSaveResolvers: Array<() => void> = []

// Background post-load state — tracks the in-flight repair + enrichment promise
// so callers (and tests) can await it without blocking the initial track render.
let librarySettlementToken = 0
let librarySettlementInFlight: Promise<void> | null = null

export function useMusicStore(): {
  tracks: Ref<Track[]>
  artists: Ref<LibraryItem[]>
  albums: Ref<LibraryItem[]>
  folders: Ref<LibraryItem[]>
  playlists: Ref<Playlist[]>
  libraryRepairReport: Ref<LibraryRepairReport | null>
  addTracks: (newTracks: Track[], options?: AddTracksOptions) => Promise<void>
  removeTrack: (id: string) => void
  clearTrackMetadataMatch: (trackId: string) => boolean
  applyTrackMetadataMatch: (
    trackId: string,
    providerTrack: Track,
    options: ManualMetadataMatchOptions
  ) => boolean
  clearTracks: () => void
  createPlaylist: (name: string) => string
  addToPlaylist: (playlistName: string, trackId: string, trackSnapshot?: Track) => void
  removeFromPlaylist: (playlistName: string, trackId: string) => void
  replaceTrackReference: (oldTrackId: string, replacementTrack: Track) => number
  applyBpmAnalysis: (trackId: string, filePath: string, analysis: Track['bpmAnalysis']) => boolean
  clearBpmAnalysis: () => boolean
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
  whenLibrarySettled: () => Promise<void>
  handleLibraryChange: (
    change: { kind: 'add' | 'remove' | 'unknown'; path?: string } | undefined
  ) => Promise<void>
  refreshLibraryIndex: () => void
  scannedFolders: Ref<string[]>
  isScanning: Ref<boolean>
  addFolder: (path: string) => void
  removeFolder: (path: string) => void
  syncFolders: (folders: string[]) => void
  flushRebuild: () => void
  getRebuildCount: () => number
} {
  function setTracks(nextTracks: Track[], options: { rebuildIndexes?: boolean } = {}): void {
    tracks.value = nextTracks
    tracksRevision++
    if (options.rebuildIndexes !== false) {
      rebuildTrackLookupIndexes(nextTracks)
    }
  }

  function rebuildTrackLookupIndexes(nextTracks: Track[] = tracks.value): void {
    trackById.clear()
    trackByPath.clear()
    trackIndexById.clear()
    nextTracks.forEach((track, index) => {
      trackById.set(track.id, track)
      trackByPath.set(track.filePath, track)
      trackIndexById.set(track.id, index)
    })
  }

  function replaceTrackAtIndex(index: number, nextTrack: Track): void {
    const current = tracks.value[index]
    if (!current) return
    const nextTracks = tracks.value.slice()
    nextTracks[index] = nextTrack
    setTracks(nextTracks, { rebuildIndexes: false })
    trackById.delete(current.id)
    trackByPath.delete(current.filePath)
    trackIndexById.delete(current.id)
    trackById.set(nextTrack.id, nextTrack)
    trackByPath.set(nextTrack.filePath, nextTrack)
    trackIndexById.set(nextTrack.id, index)
  }

  function rebuildDerivedCollections(): void {
    rebuildTrackLookupIndexes()
    const artistMap = new Map<string, DerivedTrackGroup>()
    const albumMap = new Map<string, DerivedTrackGroup>()
    const folderMap = new Map<string, DerivedTrackGroup>()

    function addToGroup(map: Map<string, DerivedTrackGroup>, key: string, track: Track): void {
      let group = map.get(key)
      if (!group) {
        group = { tracks: [], cover: null }
        map.set(key, group)
      }
      group.tracks.push(track)
      if (!group.cover && track.cover) group.cover = track.cover
    }

    for (const track of tracks.value) {
      const artistName = track.artist || '未知艺术家'
      addToGroup(artistMap, artistName, track)

      const albumName = track.album || '未知专辑'
      addToGroup(albumMap, albumName, track)

      const dir =
        track.dir ||
        track.filePath.slice(
          0,
          Math.max(track.filePath.lastIndexOf('\\'), track.filePath.lastIndexOf('/'))
        )
      if (dir) {
        addToGroup(folderMap, dir, track)
      }
    }

    artists.value = Array.from(artistMap.entries())
      .map(([name, group]) => ({
        name,
        trackCount: group.tracks.length,
        tracks: group.tracks,
        cover: group.cover
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))

    albums.value = Array.from(albumMap.entries())
      .map(([name, group]) => ({
        name,
        trackCount: group.tracks.length,
        tracks: group.tracks,
        cover: group.cover,
        artist: group.tracks[0].artist || '未知艺术家'
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))

    folders.value = scannedFolders.value
      .map((folderPath) => {
        const normalized = folderPath.replace(/[\\/]+$/, '')
        const group = folderMap.get(folderPath) || folderMap.get(normalized)
        const items = group?.tracks ?? []
        const name = normalized.split(/[\\/]/).pop() || folderPath
        return {
          name,
          path: folderPath,
          trackCount: items.length,
          tracks: items,
          cover: group?.cover ?? null
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
    // Set tracks immediately so the UI renders local music without waiting for
    // file-system repair scans (can take 30s+ for large libraries) or provider
    // metadata enrichment (can take 30s+ if the provider is unreachable).
    setTracks(loadedTracks)
    rebuildDerivedCollections()
    // Repair + enrichment run in the background. Results are merged back by
    // track id so concurrently-added/removed tracks are safe. A token guards
    // against stale results from a previous loadLibrary call.
    const token = ++librarySettlementToken
    librarySettlementInFlight = (async () => {
      // Stage 1: repair moved/missing local files (scans file system — slow)
      const repairedTracks = await repairMovedTracksFromScannedFolders(loadedTracks)
      if (token !== librarySettlementToken) return
      if (repairedTracks !== loadedTracks) {
        const repairedById = new Map(repairedTracks.map((t) => [t.id, t]))
        setTracks(tracks.value.map((t) => repairedById.get(t.id) ?? t))
        rebuildDerivedCollections()
      }
      // Stage 2: enrich metadata from providers (network calls — slow)
      const enriched = await enrichTracksFromProviders(repairedTracks)
      if (token !== librarySettlementToken) return
      if (enriched !== repairedTracks) {
        const enrichedById = new Map(enriched.map((t) => [t.id, t]))
        setTracks(tracks.value.map((t) => enrichedById.get(t.id) ?? t))
        rebuildDerivedCollections()
      }
    })().finally(() => {
      if (token === librarySettlementToken) librarySettlementInFlight = null
    })
  }

  function whenLibrarySettled(): Promise<void> {
    return librarySettlementInFlight ?? Promise.resolve()
  }

  async function repairMovedTracksFromScannedFolders(loadedTracks: Track[]): Promise<Track[]> {
    if (scannedFolders.value.length === 0 || loadedTracks.length === 0) {
      libraryRepairReport.value = null
      return loadedTracks
    }
    try {
      const scanned = (
        await Promise.all(
          scannedFolders.value.map((folder) => window.api.fs.scanMusicFiles(folder))
        )
      ).flat() as Track[]
      const scannedPaths = new Set(scanned.map((track) => track.filePath))
      const repaired = repairMovedLocalTracks({
        existingTracks: loadedTracks,
        scannedTracks: scanned,
        fileExists: (path) => scannedPaths.has(path)
      })
      libraryRepairReport.value = {
        checkedAt: new Date().toISOString(),
        repairedCount: repaired.repairedTracks.length,
        unresolvedCount: repaired.unresolvedTracks.length,
        repairedTrackIds: repaired.repairedTracks.map((track) => track.id),
        unresolvedTrackIds: repaired.unresolvedTracks.map((track) => track.id)
      }
      if (repaired.repairedTracks.length === 0) return loadedTracks
      const repairedById = new Map(repaired.repairedTracks.map((track) => [track.id, track]))
      const nextTracks = loadedTracks.map((track) => repairedById.get(track.id) ?? track)
      void scheduleSaveLibrary()
      return nextTracks
    } catch {
      libraryRepairReport.value = null
      return loadedTracks
    }
  }

  async function handleLibraryChange(
    change: { kind: 'add' | 'remove' | 'unknown'; path?: string } | undefined
  ): Promise<void> {
    try {
      // Single file removal
      if (change?.kind === 'remove' && change.path) {
        const track = trackByPath.get(change.path)
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
          // If path already exists (content change / tag edit):
          // remove old track first, then add new (remove-then-add)
          const oldTrack = trackByPath.get(change.path)
          if (oldTrack) {
            removeTrack(oldTrack.id)
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
      if (trackByPath.has(track.filePath)) continue
      trackByPath.set(track.filePath, track)
      trackById.set(track.id, track)
      unique.push(track)
    }
    if (unique.length === 0) return

    const enriched = await enrichTracksFromProviders(unique)
    for (const track of enriched) {
      trackById.set(track.id, track)
      trackByPath.set(track.filePath, track)
    }
    setTracks([...tracks.value, ...enriched])
    if (!options.deferRebuild) {
      scheduleRebuild()
    }
    if (!isScanning.value) {
      void scheduleSaveLibrary()
    }
  }

  function removeTrack(id: string): void {
    const track = trackById.get(id)
    if (!track) return
    trackByPath.delete(track.filePath)
    trackById.delete(id)
    setTracks(tracks.value.filter((t) => t.id !== id))
    scheduleRebuild()
  }

  function clearTrackMetadataMatch(trackId: string): boolean {
    const index = trackIndexById.get(trackId) ?? -1
    if (index < 0 || !tracks.value[index].metadataMatch) return false

    const nextTrack = {
      ...tracks.value[index],
      metadataMatch: null
    }
    replaceTrackAtIndex(index, nextTrack)
    void scheduleSaveLibrary()
    return true
  }

  function applyTrackMetadataMatch(
    trackId: string,
    providerTrack: Track,
    options: ManualMetadataMatchOptions
  ): boolean {
    const index = trackIndexById.get(trackId) ?? -1
    if (index < 0 || getTrackSource(tracks.value[index]) !== 'local') return false

    const { settings } = useSettingsStore()
    const nextTrack = enrichLocalTrackMetadata(
      tracks.value[index],
      {
        track: providerTrack,
        confidence: options.confidence,
        score: options.score
      },
      settings.value.cachePolicy
    )
    replaceTrackAtIndex(index, nextTrack)
    void scheduleSaveLibrary()
    return true
  }

  function clearTracks(): void {
    rebuildScheduled = false
    setTracks([])
    rebuildDerivedCollections()
  }

  function createPlaylist(name: string): string {
    const existing = playlists.value.find((p) => p.name === name)
    if (existing) return existing.id
    const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    playlists.value = [
      ...playlists.value,
      {
        id,
        name,
        trackIds: [],
        createdAt: new Date().toISOString()
      }
    ]
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
      const { settings } = useSettingsStore()
      const cachePolicy = settings.value.cachePolicy
      if (!cachePolicy.cover && !cachePolicy.lyrics && !cachePolicy.metadata) return inputTracks
      await syncPluginProviders()
      const providers = useMediaProviders()
      const enriched = await enrichLocalTracksFromProviders(
        inputTracks,
        {
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
        },
        {
          cachePolicy
        }
      )
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

  function getPlaylistIdentity(playlist: Playlist): { ids: Set<string>; logicalKeys: Set<string> } {
    if (
      playlistIdentityCache &&
      playlistIdentityCache.playlist === playlist &&
      playlistIdentityCache.trackIds === playlist.trackIds &&
      playlistIdentityCache.snapshots === playlist.trackSnapshots &&
      playlistIdentityCache.tracksRevision === tracksRevision
    ) {
      return playlistIdentityCache
    }

    const ids = new Set<string>()
    const logicalKeys = new Set<string>()
    for (const trackId of playlist.trackIds) {
      ids.add(trackId)
      const snapshot = getPlaylistTrackSnapshot(playlist, trackId)
      if (snapshot) logicalKeys.add(getLogicalTrackKey(snapshot))
    }
    playlistIdentityCache = {
      playlist,
      trackIds: playlist.trackIds,
      snapshots: playlist.trackSnapshots,
      tracksRevision,
      ids,
      logicalKeys
    }
    return playlistIdentityCache
  }

  function resolvePlaylistTrack(
    playlist: Playlist,
    trackId: string,
    getLocalLogicalTracks: () => Map<string, LogicalTrack>
  ): Track | undefined {
    const exact = trackById.get(trackId)
    if (exact) return exact
    const snapshot = playlist.trackSnapshots?.[trackId]
    if (!snapshot) return undefined
    const key = getLogicalTrackKey(snapshot)
    return getLocalLogicalTracks().get(key)?.preferredTrack ?? snapshot
  }

  function getLocalLogicalTrackMap(): Map<string, LogicalTrack> {
    if (localLogicalTrackMapRevision === tracksRevision) {
      return localLogicalTrackMapCache
    }

    const result = new Map<string, LogicalTrack>()
    const localInputs = (function* () {
      for (const track of tracks.value) {
        if (getTrackSource(track) !== 'local') continue
        yield {
          track,
          source: 'local' as const,
          sourceName: '本地音乐',
          providerAvailable: true
        }
      }
    })()

    for (const logicalTrack of buildLogicalTracks(localInputs)) {
      if (!result.has(logicalTrack.id)) result.set(logicalTrack.id, logicalTrack)
    }
    localLogicalTrackMapCache = result
    localLogicalTrackMapRevision = tracksRevision
    return result
  }

  function isFavoriteTrack(track: Track): boolean {
    const playlist = getDefaultFavoritePlaylist()
    if (!playlist) return false
    const identity = getPlaylistIdentity(playlist)
    return identity.ids.has(track.id) || identity.logicalKeys.has(getLogicalTrackKey(track))
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
    const keptTrackIds = new Set(nextTrackIds)
    const removed = new Set(playlist.trackIds.filter((trackId) => !keptTrackIds.has(trackId)))
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
      if (oldTrack) trackByPath.delete(oldTrack.filePath)
      trackById.delete(oldTrackId)
      trackById.set(replacementTrack.id, replacementTrack)
      trackByPath.set(replacementTrack.filePath, replacementTrack)
      setTracks(tracks.value.map((track) => (track.id === oldTrackId ? replacementTrack : track)))
      libraryChanged = true
      replacementCount++
    }

    for (const playlist of playlists.value) {
      if (!playlist.trackIds.includes(oldTrackId)) continue
      const nextTrackIds: string[] = []
      const seenTrackIds = new Set<string>()
      for (const trackId of playlist.trackIds) {
        const nextTrackId = trackId === oldTrackId ? replacementTrack.id : trackId
        if (seenTrackIds.has(nextTrackId)) continue
        seenTrackIds.add(nextTrackId)
        nextTrackIds.push(nextTrackId)
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

  function applyBpmAnalysis(
    trackId: string,
    filePath: string,
    analysis: Track['bpmAnalysis']
  ): boolean {
    if (!analysis) return false
    const fallbackTrackId = filePath ? trackByPath.get(filePath)?.id : undefined
    const index =
      trackIndexById.get(trackId) ??
      (fallbackTrackId ? trackIndexById.get(fallbackTrackId) : undefined) ??
      -1
    if (index < 0) return false
    const nextTrack = {
      ...tracks.value[index],
      bpmAnalysis: analysis
    }
    replaceTrackAtIndex(index, nextTrack)

    let playlistsChanged = false
    for (const playlist of playlists.value) {
      const snapshot = playlist.trackSnapshots?.[trackId] ?? playlist.trackSnapshots?.[nextTrack.id]
      if (!snapshot) continue
      playlist.trackSnapshots = {
        ...(playlist.trackSnapshots ?? {}),
        [nextTrack.id]: toPlaylistTrackSnapshot({
          ...snapshot,
          bpmAnalysis: analysis
        })
      }
      playlistsChanged = true
    }

    void scheduleSaveLibrary()
    if (playlistsChanged) void savePlaylists()
    return true
  }

  function clearBpmAnalysis(): boolean {
    let libraryChanged = false
    const nextTracks = tracks.value.map((track) => {
      if (!track.bpmAnalysis) return track
      const { bpmAnalysis: _bpmAnalysis, ...nextTrack } = track
      libraryChanged = true
      return nextTrack
    })
    if (libraryChanged) {
      setTracks(nextTracks)
      scheduleRebuild()
      void scheduleSaveLibrary()
    }

    let playlistsChanged = false
    for (const playlist of playlists.value) {
      if (!playlist.trackSnapshots) continue
      let snapshotChanged = false
      const nextSnapshots: Record<string, Track> = {}
      for (const [trackId, snapshot] of Object.entries(playlist.trackSnapshots)) {
        if (snapshot.bpmAnalysis) {
          const { bpmAnalysis: _bpmAnalysis, ...nextSnapshot } = snapshot
          nextSnapshots[trackId] = nextSnapshot
          snapshotChanged = true
        } else {
          nextSnapshots[trackId] = snapshot
        }
      }
      if (snapshotChanged) {
        playlist.trackSnapshots = nextSnapshots
        playlistsChanged = true
      }
    }
    if (playlistsChanged) void savePlaylists()
    return libraryChanged || playlistsChanged
  }

  function getPlaylistTracks(playlistName: string): Track[] {
    const pl = playlists.value.find((p) => p.name === playlistName)
    if (!pl) return []
    let localLogicalTracks: Map<string, LogicalTrack> | null = null
    const getLocalLogicalTracks = (): Map<string, LogicalTrack> => {
      localLogicalTracks ??= getLocalLogicalTrackMap()
      return localLogicalTracks
    }
    return pl.trackIds
      .map((trackId) => resolvePlaylistTrack(pl, trackId, getLocalLogicalTracks))
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

  if (!derivedCollectionsInitialized) {
    rebuildDerivedCollections()
    derivedCollectionsInitialized = true
  }

  return {
    tracks,
    artists,
    albums,
    folders,
    playlists,
    libraryRepairReport,
    addTracks,
    removeTrack,
    clearTrackMetadataMatch,
    applyTrackMetadataMatch,
    clearTracks,
    createPlaylist,
    addToPlaylist,
    removeFromPlaylist,
    replaceTrackReference,
    applyBpmAnalysis,
    clearBpmAnalysis,
    isFavoriteTrack,
    addFavoriteTrack,
    removeFavoriteTrack,
    deletePlaylist,
    getPlaylistTracks,
    savePlaylists,
    loadPlaylists,
    saveLibrary,
    loadLibrary,
    whenLibrarySettled,
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
      setTracks(
        tracks.value.filter((t) =>
          folderPrefixes.some(
            (prefix) => t.filePath.startsWith(prefix) || t.filePath === prefix.slice(0, -1)
          )
        )
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
