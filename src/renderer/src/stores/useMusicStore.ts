import { ref, type Ref } from 'vue'
import type { Track } from '../types/music'

interface Playlist {
  id: string
  name: string
  trackIds: string[]
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

const tracks = ref<Track[]>([])
const scannedFolders = ref<string[]>([])
const isScanning = ref(false)
const artists = ref<LibraryItem[]>([])
const albums = ref<LibraryItem[]>([])
const folders = ref<LibraryItem[]>([])
const playlists = ref<Playlist[]>([])
const trackById = new Map<string, Track>()

export function useMusicStore(): {
  tracks: Ref<Track[]>
  artists: Ref<LibraryItem[]>
  albums: Ref<LibraryItem[]>
  folders: Ref<LibraryItem[]>
  playlists: Ref<Playlist[]>
  addTracks: (newTracks: Track[]) => Promise<void>
  removeTrack: (id: string) => void
  clearTracks: () => void
  createPlaylist: (name: string) => string
  addToPlaylist: (playlistName: string, trackId: string) => void
  removeFromPlaylist: (playlistName: string, trackId: string) => void
  deletePlaylist: (playlistId: string) => void
  getPlaylistTracks: (playlistName: string) => Track[]
  savePlaylists: () => Promise<void>
  loadPlaylists: () => Promise<void>
  saveLibrary: () => Promise<void>
  loadLibrary: () => Promise<void>
  scannedFolders: Ref<string[]>
  isScanning: Ref<boolean>
  addFolder: (path: string) => void
  removeFolder: (path: string) => void
  syncFolders: (folders: string[]) => void
} {
  function rebuildDerivedCollections(): void {
    trackById.clear()
    const artistMap = new Map<string, Track[]>()
    const albumMap = new Map<string, Track[]>()
    const folderMap = new Map<string, Track[]>()

    for (const track of tracks.value) {
      trackById.set(track.id, track)
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

  async function saveLibrary(): Promise<void> {
    const plainTracks = JSON.parse(JSON.stringify(tracks.value))
    const plainFolders = JSON.parse(JSON.stringify(scannedFolders.value))
    await window.api.data.saveMusicLibrary({ tracks: plainTracks, folders: plainFolders })
  }

  async function loadLibrary(): Promise<void> {
    const saved = await window.api.data.loadMusicLibrary()
    if (!saved) return

    if (Array.isArray(saved)) {
      tracks.value = saved as Track[]
    } else {
      tracks.value = (saved.tracks || []) as Track[]
      scannedFolders.value = (saved.folders || []) as string[]
    }
    rebuildDerivedCollections()
  }

  async function addTracks(newTracks: Track[]): Promise<void> {
    const existingPaths = new Set(tracks.value.map((t) => t.filePath))
    const unique = newTracks.filter((t) => !existingPaths.has(t.filePath))
    if (unique.length === 0) return

    tracks.value = [...tracks.value, ...unique]
    rebuildDerivedCollections()
    if (!isScanning.value) {
      await saveLibrary()
    }
  }

  function removeTrack(id: string): void {
    tracks.value = tracks.value.filter((t) => t.id !== id)
    rebuildDerivedCollections()
  }

  function clearTracks(): void {
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

  function addToPlaylist(playlistName: string, trackId: string): void {
    const pl = playlists.value.find((p) => p.name === playlistName)
    if (pl && !pl.trackIds.includes(trackId)) {
      pl.trackIds = [...pl.trackIds, trackId]
      void savePlaylists()
    }
  }

  function removeFromPlaylist(playlistName: string, trackId: string): void {
    const pl = playlists.value.find((p) => p.name === playlistName)
    if (pl) {
      pl.trackIds = pl.trackIds.filter((id) => id !== trackId)
      void savePlaylists()
    }
  }

  function getPlaylistTracks(playlistName: string): Track[] {
    const pl = playlists.value.find((p) => p.name === playlistName)
    if (!pl) return []
    return pl.trackIds
      .map((trackId) => trackById.get(trackId))
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
    deletePlaylist,
    getPlaylistTracks,
    savePlaylists,
    loadPlaylists,
    saveLibrary,
    loadLibrary,
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
    }
  }
}
