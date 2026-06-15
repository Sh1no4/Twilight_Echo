import { MediaProviderRegistry } from './mediaProvider'
import type {
  MediaProviderArtistSummary,
  MediaProviderPlaylistSummary,
  MediaProviderProfile,
  MediaProviderSearchResult,
  MediaProviderUserSummary
} from './mediaProvider'
import type { Track } from '../types/music'

const mediaProviders = new MediaProviderRegistry()
let defaultsRegistered = false
let pluginProvidersSyncing: Promise<void> | null = null

export function useMediaProviders(): MediaProviderRegistry {
  registerDefaultProviders()
  void syncPluginProviders()
  return mediaProviders
}

export function registerDefaultProviders(): void {
  if (defaultsRegistered) return
  defaultsRegistered = true
}

export async function syncPluginProviders(): Promise<void> {
  if (pluginProvidersSyncing) return pluginProvidersSyncing
  const api = window.api?.providers
  if (!api) return

  pluginProvidersSyncing = (async () => {
    try {
      const providers = await api.list()
      const activePluginProviderIds = new Set(providers.map((provider) => provider.id))
      mediaProviders.unregisterWhere(
        (provider) => provider.source === 'plugin' && !activePluginProviderIds.has(provider.id)
      )
      for (const provider of providers) {
        if (mediaProviders.get(provider.id)) continue
        const callProvider = <T>(method: string, args: unknown[] = []): Promise<T> =>
          api.call(provider.id, method as never, args) as Promise<T>
        mediaProviders.register({
          id: provider.id,
          name: provider.name,
          source: 'plugin',
          capabilities: provider.capabilities,
          isEnabled: () => true,
          getPlaybackUrl: provider.capabilities.includes('playbackUrl')
            ? (track, options) => callProvider<string | null>('getPlaybackUrl', [track, options])
            : undefined,
          getLyrics: provider.capabilities.includes('lyrics')
            ? (track) =>
                callProvider<{
                  lyrics: string | null
                  translatedLyrics: string | null
                }>('getLyrics', [track])
            : undefined,
          searchSongs: provider.capabilities.includes('search')
            ? (keywords, limit, offset) =>
                callProvider<MediaProviderSearchResult<Track>>('searchSongs', [
                  keywords,
                  limit,
                  offset
                ])
            : undefined,
          searchPlaylists: provider.capabilities.includes('playlist')
            ? (keywords, limit, offset) =>
                callProvider<MediaProviderSearchResult<MediaProviderPlaylistSummary>>(
                  'searchPlaylists',
                  [keywords, limit, offset]
                )
            : undefined,
          searchArtists: provider.capabilities.includes('search')
            ? (keywords, limit, offset) =>
                callProvider<MediaProviderSearchResult<MediaProviderArtistSummary>>(
                  'searchArtists',
                  [keywords, limit, offset]
                )
            : undefined,
          fetchPlaylistTracks: provider.capabilities.includes('playlist')
            ? (playlistId, force) =>
                callProvider<Track[]>('fetchPlaylistTracks', [playlistId, force])
            : undefined,
          checkLogin: provider.capabilities.includes('login')
            ? () => callProvider<{ loggedIn: boolean; profile: MediaProviderProfile | null }>('checkLogin')
            : undefined,
          getProfile: provider.capabilities.includes('login')
            ? () => callProvider<MediaProviderProfile | null>('getProfile')
            : undefined,
          logout: provider.capabilities.includes('login')
            ? () => callProvider<void>('logout')
            : undefined,
          getQrKey: provider.capabilities.includes('login')
            ? () => callProvider<string | null>('getQrKey')
            : undefined,
          getQrImage: provider.capabilities.includes('login')
            ? (key) => callProvider<string | null>('getQrImage', [key])
            : undefined,
          checkQrLogin: provider.capabilities.includes('login')
            ? (key) => callProvider<{ code: number }>('checkQrLogin', [key])
            : undefined,
          fetchUserLibrary: provider.capabilities.includes('library')
            ? (force) =>
                callProvider<{
                  likedPlaylist: MediaProviderPlaylistSummary | null
                  playlists: MediaProviderPlaylistSummary[]
                }>('fetchUserLibrary', [force])
            : undefined,
          fetchLikedTracks: provider.capabilities.includes('library')
            ? (force) => callProvider<Track[]>('fetchLikedTracks', [force])
            : undefined,
          fetchRecommendSongs: provider.capabilities.includes('library')
            ? () => callProvider<Track[]>('fetchRecommendSongs')
            : undefined,
          fetchRecommendPlaylists: provider.capabilities.includes('library')
            ? () => callProvider<MediaProviderPlaylistSummary[]>('fetchRecommendPlaylists')
            : undefined,
          fetchPersonalFm: provider.capabilities.includes('library')
            ? () => callProvider<Track[]>('fetchPersonalFm')
            : undefined,
          fetchPrivateContent: provider.capabilities.includes('library')
            ? () => callProvider<Track[]>('fetchPrivateContent')
            : undefined,
          fetchArtistTopSongs: provider.capabilities.includes('search')
            ? (artistId) => callProvider<Track[]>('fetchArtistTopSongs', [artistId])
            : undefined,
          fetchArtistPlaylists: provider.capabilities.includes('playlist')
            ? (artistId) =>
                callProvider<MediaProviderPlaylistSummary[]>('fetchArtistPlaylists', [artistId])
            : undefined,
          fetchUserPlaylistsByUid: provider.capabilities.includes('library')
            ? (uid) =>
                callProvider<MediaProviderPlaylistSummary[]>('fetchUserPlaylistsByUid', [uid])
            : undefined,
          fetchUserFollows: provider.capabilities.includes('library')
            ? (uid, limit, offset) =>
                callProvider<MediaProviderUserSummary[]>('fetchUserFollows', [
                  uid,
                  limit,
                  offset
                ])
            : undefined,
          fetchUserFolloweds: provider.capabilities.includes('library')
            ? (uid, limit, offset) =>
                callProvider<MediaProviderUserSummary[]>('fetchUserFolloweds', [
                  uid,
                  limit,
                  offset
                ])
            : undefined,
          likeTrack: provider.capabilities.includes('library')
            ? (trackId, like) => callProvider<void>('likeTrack', [trackId, like])
            : undefined,
          isTrackLiked: provider.capabilities.includes('library')
            ? (trackId) => callProvider<boolean>('isTrackLiked', [trackId])
            : undefined
        })
      }
    } finally {
      pluginProvidersSyncing = null
    }
  })()

  return pluginProvidersSyncing
}

export * from './mediaProvider'
export * from './ncmTrack'
