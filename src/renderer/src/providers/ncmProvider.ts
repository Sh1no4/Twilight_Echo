import { useNcmStore } from '../stores/useNcmStore'
import {
  type MediaProvider,
  type MediaProviderArtistSummary,
  type MediaProviderPlaylistSummary,
  type MediaProviderSearchResult
} from './mediaProvider'
import { getNcmSongId } from './ncmTrack'

export function createNcmMediaProvider(): MediaProvider {
  return {
    id: 'ncm',
    name: 'NetEase Cloud Music',
    source: 'internal',
    capabilities: ['search', 'playbackUrl', 'lyrics', 'cover', 'playlist', 'library', 'login'],
    isEnabled: () => useNcmStore().isLoggedIn.value,
    getPlaybackUrl: async (track, options) => {
      const songId = getNcmSongId(track)
      if (songId == null) throw new Error('Missing NetEase song ID, cannot play')
      return useNcmStore().getSongStreamUrl(songId, options?.force)
    },
    getLyrics: async (track) => {
      const songId = getNcmSongId(track)
      if (songId == null) return { lyrics: null, translatedLyrics: null }
      return useNcmStore().fetchLyric(songId)
    },
    searchSongs: async (keywords, limit, offset) => {
      const result = await useNcmStore().searchSongs(keywords, limit, offset)
      return { items: result.tracks, total: result.total }
    },
    searchPlaylists: async (keywords, limit, offset) => {
      const result = await useNcmStore().searchPlaylists(keywords, limit, offset)
      return { items: result.playlists, total: result.total }
    },
    searchArtists: async (keywords, limit, offset) => {
      const result = await useNcmStore().searchArtists(keywords, limit, offset)
      return { items: result.artists, total: result.total }
    },
    fetchPlaylistTracks: (playlistId, force) => useNcmStore().fetchPlaylistTracks(playlistId, force)
  }
}

export type NcmProviderPlaylistSummary = MediaProviderPlaylistSummary
export type NcmProviderArtistSummary = MediaProviderArtistSummary
export type NcmProviderSearchResult<T> = MediaProviderSearchResult<T>
