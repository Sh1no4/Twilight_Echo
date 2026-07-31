import type { Track } from '../../types/music'

export type LocalTransitionName = 'local-page-down' | 'local-page-up'

export type GridItem = {
  id?: string
  name: string
  trackCount?: number
  cover?: string | null
  path?: string
  artist?: string
  tracks?: Track[]
  trackIds?: string[]
  trackSnapshots?: Record<string, Track>
  isDefault?: boolean
}

export type PlaylistActions = {
  removeTrack: (trackId: string) => void
  addToPlaylist: (playlistName: string, trackId: string, trackSnapshot?: Track) => void
  removeFromPlaylist: (playlistName: string, trackId: string) => void
  rematchTrack?: (track: Track) => Promise<void> | void
  rematchMetadata?: (track: Track) => Promise<void> | void
  clearMetadataMatch?: (track: Track) => Promise<void> | void
  createPlaylist: (name: string) => void
  deletePlaylist: (playlistId: string) => void
}

export type TrackPlayback = {
  playTrack: (track: Track, queue?: Track[]) => void
}
