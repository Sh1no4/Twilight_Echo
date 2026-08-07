import type {
  TwilightMediaProviderMethod,
  TwilightMediaProviderRegistration
} from './types'

export const TWILIGHT_MEDIA_PROVIDER_METHODS = [
  'getPlaybackUrl',
  'getLyrics',
  'searchSongs',
  'searchPlaylists',
  'searchArtists',
  'fetchPlaylistTracks',
  'checkLogin',
  'getProfile',
  'logout',
  'openOfficialLogin',
  'sendCaptcha',
  'loginByPhonePassword',
  'loginByPhoneCaptcha',
  'loginByEmailPassword',
  'getQrLogin',
  'getQrKey',
  'getQrImage',
  'checkQrLogin',
  'fetchUserLibrary',
  'fetchLikedTracks',
  'fetchLikedTracksPage',
  'fetchCloudSongsPage',
  'prepareCloudUpload',
  'completeCloudUpload',
  'getCloudDownloadUrl',
  'fetchRecommendSongs',
  'fetchRecommendPlaylists',
  'fetchPlaylistCategories',
  'fetchDiscoveryPlaylists',
  'fetchHighQualityPlaylists',
  'fetchPersonalFm',
  'fetchPrivateContent',
  'fetchArtistTopSongs',
  'fetchArtistAlbums',
  'fetchArtistIntro',
  'fetchArtistFollowState',
  'fetchAlbumTracks',
  'fetchArtistPlaylists',
  'fetchUserPlaylistsByUid',
  'fetchUserFollows',
  'fetchUserFolloweds',
  'fetchPlayRecords',
  'fetchRecentSongs',
  'fetchIntelligenceList',
  'followArtist',
  'followUser',
  'likeTrack',
  'isTrackLiked',
  'createPlaylist',
  'deletePlaylist',
  'addTracksToPlaylist',
  'removeTracksFromPlaylist'
] as const satisfies readonly TwilightMediaProviderMethod[]

export function isTwilightMediaProviderMethod(
  method: string
): method is TwilightMediaProviderMethod {
  return (TWILIGHT_MEDIA_PROVIDER_METHODS as readonly string[]).includes(method)
}

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
  sendCaptcha: 'login',
  loginByPhonePassword: 'login',
  loginByPhoneCaptcha: 'login',
  loginByEmailPassword: 'login',
  getQrLogin: 'login',
  getQrKey: 'login',
  getQrImage: 'login',
  checkQrLogin: 'login',
  fetchUserLibrary: 'library',
  fetchLikedTracks: 'library',
  fetchLikedTracksPage: 'library',
  fetchCloudSongsPage: 'library',
  prepareCloudUpload: 'library',
  completeCloudUpload: 'library',
  getCloudDownloadUrl: 'library',
  fetchRecommendSongs: 'library',
  fetchRecommendPlaylists: 'library',
  fetchPlaylistCategories: 'playlist',
  fetchDiscoveryPlaylists: 'playlist',
  fetchHighQualityPlaylists: 'playlist',
  fetchPersonalFm: 'library',
  fetchPrivateContent: 'library',
  fetchArtistTopSongs: 'library',
  fetchArtistAlbums: 'library',
  fetchArtistIntro: 'library',
  fetchArtistFollowState: 'library',
  fetchAlbumTracks: 'playlist',
  fetchArtistPlaylists: 'library',
  fetchUserPlaylistsByUid: 'library',
  fetchUserFollows: 'library',
  fetchUserFolloweds: 'library',
  fetchPlayRecords: 'library',
  fetchRecentSongs: 'library',
  fetchIntelligenceList: 'playlist',
  followArtist: 'library',
  followUser: 'library',
  likeTrack: 'library',
  isTrackLiked: 'library',
  createPlaylist: 'library',
  deletePlaylist: 'library',
  addTracksToPlaylist: 'library',
  removeTracksFromPlaylist: 'library'
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
  const candidates = [...runningPlugins]
  for (const running of candidates.reverse()) {
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

export function dedupeProviderRegistrations<T extends { providers: TwilightMediaProviderRegistration[] }>(
  runningPlugins: Iterable<T>
): TwilightMediaProviderRegistration[] {
  const providers = new Map<string, TwilightMediaProviderRegistration>()
  for (const running of runningPlugins) {
    for (const provider of running.providers) {
      providers.set(provider.id, provider)
    }
  }
  return [...providers.values()]
}
