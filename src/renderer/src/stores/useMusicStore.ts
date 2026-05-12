import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { Track } from '../types/music'

const tracks = ref<Track[]>([])
const scannedFolders = ref<string[]>([])
const isScanning = ref(false)

export function useMusicStore(): {
  tracks: Ref<Track[]>
  artists: ComputedRef<any[]>
  albums: ComputedRef<any[]>
  folders: ComputedRef<any[]>
  playlists: Ref<{ name: string; trackIds: Set<string> }[]>
  addTracks: (newTracks: Track[]) => Promise<void>
  removeTrack: (id: string) => void
  clearTracks: () => void
  createPlaylist: (name: string) => void
  addToPlaylist: (playlistName: string, trackId: string) => void
  removeFromPlaylist: (playlistName: string, trackId: string) => void
  getPlaylistTracks: (playlistName: string) => Track[]
  saveLibrary: () => Promise<void>
  loadLibrary: () => Promise<void>
  scannedFolders: Ref<string[]>
  isScanning: Ref<boolean>
  addFolder: (path: string) => void
  removeFolder: (path: string) => void
} {
  async function saveLibrary(): Promise<void> {
    const plainTracks = JSON.parse(JSON.stringify(tracks.value))
    const plainFolders = JSON.parse(JSON.stringify(scannedFolders.value))
    await window.api.data.saveMusicLibrary({ tracks: plainTracks, folders: plainFolders })
  }

  async function loadLibrary(): Promise<void> {
    const saved = await window.api.data.loadMusicLibrary()
    if (saved) {
      if (Array.isArray(saved)) {
        // Legacy support
        tracks.value = saved as Track[]
      } else {
        tracks.value = (saved.tracks || []) as Track[]
        scannedFolders.value = (saved.folders || []) as string[]
      }
    }
  }

  async function addTracks(newTracks: Track[]): Promise<void> {
    const existingPaths = new Set(tracks.value.map((t) => t.filePath))
    const unique = newTracks.filter((t) => !existingPaths.has(t.filePath))
    if (unique.length > 0) {
      tracks.value = [...tracks.value, ...unique]
      if (!isScanning.value) {
        await saveLibrary()
      }
    }
  }

  function removeTrack(id: string): void {
    tracks.value = tracks.value.filter((t) => t.id !== id)
  }

  function clearTracks(): void {
    tracks.value = []
  }

  const artists = computed(() => {
    const map = new Map<string, Track[]>()
    for (const t of tracks.value) {
      const name = t.artist || '未知艺术家'
      if (!map.has(name)) map.set(name, [])
      map.get(name)!.push(t)
    }
    return Array.from(map.entries())
      .map(([name, items]) => ({
        name,
        trackCount: items.length,
        tracks: items,
        cover: items.find((t) => t.cover)?.cover ?? null
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  })

  const albums = computed(() => {
    const map = new Map<string, Track[]>()
    for (const t of tracks.value) {
      const name = t.album || '未知专辑'
      if (!map.has(name)) map.set(name, [])
      map.get(name)!.push(t)
    }
    return Array.from(map.entries())
      .map(([name, items]) => ({
        name,
        trackCount: items.length,
        tracks: items,
        cover: items.find((t) => t.cover)?.cover ?? null,
        artist: items[0].artist || '未知艺术家'
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  })

  const folders = computed(() => {
    return scannedFolders.value
      .map((folderPath) => {
        const items = tracks.value.filter((t) => {
          const dir = t.dir || t.filePath.slice(0, Math.max(t.filePath.lastIndexOf('\\'), t.filePath.lastIndexOf('/')))
          return dir === folderPath || t.filePath.startsWith(folderPath + '\\') || t.filePath.startsWith(folderPath + '/')
        })
        const normalized = folderPath.replace(/[\\/]+$/, '')
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
  })

  const playlists = ref<{ name: string; trackIds: Set<string> }[]>([])

  function createPlaylist(name: string): void {
    if (!playlists.value.find((p) => p.name === name)) {
      playlists.value = [...playlists.value, { name, trackIds: new Set() }]
    }
  }

  function addToPlaylist(playlistName: string, trackId: string): void {
    const pl = playlists.value.find((p) => p.name === playlistName)
    if (pl) pl.trackIds.add(trackId)
  }

  function removeFromPlaylist(playlistName: string, trackId: string): void {
    const pl = playlists.value.find((p) => p.name === playlistName)
    if (pl) pl.trackIds.delete(trackId)
  }

  function getPlaylistTracks(playlistName: string): Track[] {
    const pl = playlists.value.find((p) => p.name === playlistName)
    if (!pl) return []
    return tracks.value.filter((t) => pl.trackIds.has(t.id))
  }

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
    getPlaylistTracks,
    saveLibrary,
    loadLibrary,
    scannedFolders,
    isScanning,
    addFolder(path: string): void {
      if (!scannedFolders.value.includes(path)) {
        scannedFolders.value.push(path)
        saveLibrary()
      }
    },
    removeFolder(path: string): void {
      scannedFolders.value = scannedFolders.value.filter((f) => f !== path)
      saveLibrary()
    }
  }
}
