import { ref, computed } from 'vue'
import type { Track } from '../types/music'

const tracks = ref<Track[]>([])

export function useMusicStore() {
  async function saveLibrary(): Promise<void> {
    const plain = JSON.parse(JSON.stringify(tracks.value))
    await window.api.data.saveMusicLibrary(plain)
  }

  async function loadLibrary(): Promise<void> {
    const saved = await window.api.data.loadMusicLibrary()
    if (saved.length > 0) {
      tracks.value = saved as Track[]
    }
  }

  async function addTracks(newTracks: Track[]): Promise<void> {
    const existingPaths = new Set(tracks.value.map((t) => t.filePath))
    const unique = newTracks.filter((t) => !existingPaths.has(t.filePath))
    if (unique.length > 0) {
      tracks.value = [...tracks.value, ...unique]
      await saveLibrary()
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
    playlists,
    addTracks,
    removeTrack,
    clearTracks,
    createPlaylist,
    addToPlaylist,
    removeFromPlaylist,
    getPlaylistTracks,
    saveLibrary,
    loadLibrary
  }
}
