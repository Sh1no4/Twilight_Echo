import { MediaProviderRegistry } from './mediaProvider'
import { createNcmMediaProvider } from './ncmProvider'

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
  mediaProviders.register(createNcmMediaProvider())
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
        mediaProviders.register({
          id: provider.id,
          name: provider.name,
          source: 'plugin',
          capabilities: provider.capabilities,
          isEnabled: () => true,
          getPlaybackUrl: provider.capabilities.includes('playbackUrl')
            ? async (track, options) =>
                (await api.call(provider.id, 'getPlaybackUrl', [track, options])) as string | null
            : undefined,
          getLyrics: provider.capabilities.includes('lyrics')
            ? async (track) =>
                (await api.call(provider.id, 'getLyrics', [track])) as {
                  lyrics: string | null
                  translatedLyrics: string | null
                }
            : undefined,
          searchSongs: provider.capabilities.includes('search')
            ? async (keywords, limit, offset) =>
                (await api.call(provider.id, 'searchSongs', [keywords, limit, offset])) as {
                  items: import('../types/music').Track[]
                  total: number
                }
            : undefined,
          searchPlaylists: provider.capabilities.includes('playlist')
            ? async (keywords, limit, offset) =>
                (await api.call(provider.id, 'searchPlaylists', [keywords, limit, offset])) as {
                  items: { id: string | number; name: string; cover: string | null; trackCount: number }[]
                  total: number
                }
            : undefined,
          searchArtists: provider.capabilities.includes('search')
            ? async (keywords, limit, offset) =>
                (await api.call(provider.id, 'searchArtists', [keywords, limit, offset])) as {
                  items: {
                    id: string | number
                    name: string
                    picUrl: string | null
                    albumSize?: number
                    musicSize?: number
                  }[]
                  total: number
                }
            : undefined,
          fetchPlaylistTracks: provider.capabilities.includes('playlist')
            ? async (playlistId, force) =>
                (await api.call(provider.id, 'fetchPlaylistTracks', [playlistId, force])) as import('../types/music').Track[]
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
export * from './ncmProvider'
export * from './ncmTrack'
