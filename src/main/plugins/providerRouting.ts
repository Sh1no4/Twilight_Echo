import type {
  TwilightMediaProviderMethod,
  TwilightMediaProviderRegistration
} from './types'

const PROVIDER_METHOD_CAPABILITIES: Partial<
  Record<TwilightMediaProviderMethod, TwilightMediaProviderRegistration['capabilities'][number]>
> = {
  getPlaybackUrl: 'playbackUrl',
  getLyrics: 'lyrics',
  searchSongs: 'search',
  searchPlaylists: 'search',
  searchArtists: 'search',
  fetchPlaylistTracks: 'playlist',
  checkLogin: 'login',
  getProfile: 'login',
  logout: 'login',
  openOfficialLogin: 'login',
  getQrLogin: 'login',
  getQrKey: 'login',
  getQrImage: 'login',
  checkQrLogin: 'login',
  fetchUserLibrary: 'library',
  fetchLikedTracks: 'library',
  fetchRecommendSongs: 'library',
  fetchRecommendPlaylists: 'library',
  fetchPersonalFm: 'library',
  fetchPrivateContent: 'library',
  fetchArtistTopSongs: 'library',
  fetchArtistPlaylists: 'library',
  fetchUserPlaylistsByUid: 'library',
  fetchUserFollows: 'library',
  fetchUserFolloweds: 'library',
  likeTrack: 'library',
  isTrackLiked: 'library'
}

export function providerSupportsMethod(
  provider: TwilightMediaProviderRegistration,
  method: TwilightMediaProviderMethod
): boolean {
  const requiredCapability = PROVIDER_METHOD_CAPABILITIES[method]
  return !requiredCapability || provider.capabilities.includes(requiredCapability)
}

export function findProviderRoute<T extends { providers: TwilightMediaProviderRegistration[] }>(
  runningPlugins: Iterable<T>,
  providerId: string,
  method: TwilightMediaProviderMethod
): T | null {
  const normalizedProviderId = providerId.trim().toLowerCase()
  for (const running of runningPlugins) {
    if (
      running.providers.some(
        (provider) =>
          provider.id === normalizedProviderId && providerSupportsMethod(provider, method)
      )
    ) {
      return running
    }
  }
  return null
}
