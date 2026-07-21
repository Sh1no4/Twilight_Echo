export const TWILIGHT_PLUGIN_API_VERSION = 1 as const
export const TAE_DSP_PLUGIN_ABI_VERSION = 1 as const
export const TAE_DSP_PLUGIN_ABI_VERSION_V2 = 2 as const

export type NativeDspChannelLayout = 'mono' | 'stereo' | '5.1' | '7.1'

export type TwilightPluginType = 'provider' | 'tool' | 'ui' | 'theme' | 'dsp'

export type TwilightPluginPermission =
  | 'network'
  | 'filesystem:read'
  | 'filesystem:write'
  | 'player:control'
  | 'player:observe'
  | 'library:read'
  | 'library:write'
  | 'settings'
  | 'clipboard'
  | 'ui:inject'
  | 'dsp:native'

export interface TwilightPluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  license: string
  type: TwilightPluginType[]
  main?: string
  binary?: Record<string, string>
  dependencies?: Record<string, string>
  engines: {
    twilightEcho: string
  }
  apiVersion: number
  permissions: TwilightPluginPermission[]
  contributes?: unknown
  homepage?: string
  repository?: string
  icon?: string
  signature?: unknown
}

export type TwilightPluginStatus = 'installed' | 'enabled' | 'disabled' | 'invalid' | 'failed'
export type TwilightPluginSource = 'directory' | 'tep' | 'bundled' | 'index'

export interface TwilightPluginDescriptor extends TwilightPluginManifest {
  status: TwilightPluginStatus
  enabled: boolean
  builtIn: boolean
  error: string | null
  isDsp: boolean
  source: TwilightPluginSource | 'scan'
  installedAt: string | null
  updatedAt: string | null
  paths: {
    root: string
    versionRoot: string
    manifestPath: string
    dataDir: string
    logPath: string
  }
}

export interface TwilightPluginInstallResult {
  plugin: TwilightPluginDescriptor
  warning: string
}

export interface TwilightPluginPublisherSignature {
  schemaVersion: 1
  algorithm: 'ed25519'
  keyId: string
  value: string
}

export type TwilightPluginSignatureStatus =
  | 'missing'
  | 'malformed'
  | 'unsupported'
  | 'unknown-key'
  | 'revoked-key'
  | 'key-not-yet-valid'
  | 'key-expired'
  | 'invalid-key'
  | 'invalid'
  | 'valid'
  | 'trust-store-error'

export type TwilightPluginVerificationLevel =
  | 'official'
  | 'publisher-signed'
  | 'index-declared'
  | 'unverified'

export interface TwilightPluginVerification {
  level: TwilightPluginVerificationLevel
  official: boolean
  officialSource: boolean
  indexClaimed: boolean
  signatureStatus: TwilightPluginSignatureStatus
  keyId: string | null
  publisher: string | null
  keyFingerprintSha256: string | null
  revalidateAt: string | null
  reason: string
}

export interface TwilightPluginIndexEntry extends TwilightPluginManifest {
  sourceUrl: string
  checksumSha256: string
  repository?: string
  homepage?: string
  tags?: string[]
  publisherSignature?: TwilightPluginPublisherSignature
  /** Publisher/index metadata only. Never use this field as an official trust decision. */
  verified?: boolean
  verification: TwilightPluginVerification
  installState?: TwilightPluginIndexInstallState
  installedVersion?: string
}

export type TwilightPluginIndexInstallState =
  | 'not-installed'
  | 'installed'
  | 'update-available'
  | 'incompatible'
  | 'built-in-blocked'

export type TwilightPluginIndexSourceKind = 'github' | 'custom' | 'bundled'
export type TwilightPluginIndexLoadedFrom = 'remote' | 'cache' | 'bundled'
export type TwilightPluginIndexCacheFormat = 'envelope-v1' | 'legacy'

export interface TwilightPluginIndexStatus {
  sourceUrl: string
  configuredSourceUrl: string
  sourceKind: TwilightPluginIndexSourceKind
  loadedFrom: TwilightPluginIndexLoadedFrom
  lastFetchedAt: string | null
  expiresAt: string | null
  loadedAt: string
  stale: boolean
  expired: boolean
  originVerified: boolean
  officialSource: boolean
  cacheFormat: TwilightPluginIndexCacheFormat | null
  trustStoreError: string | null
  error: string | null
}

export interface PluginPrivateSettings {
  get(key?: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

export interface PluginLogger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface TwilightPluginContext {
  apiVersion: number
  storagePath: string
  settings: PluginPrivateSettings
  logger: PluginLogger
  twilight: TwilightApi
}

export type TwilightEventName =
  | 'app:ready'
  | 'app:before-quit'
  | 'player:track-change'
  | 'player:play'
  | 'player:pause'
  | 'player:stop'
  | 'player:progress'
  | 'player:queue-change'
  | 'player:playback-info'
  | `audioEngine:${string}`

export interface TwilightEventsApi {
  on(eventName: TwilightEventName | string, callback: (payload: unknown) => void): () => void
}

export interface TwilightPlayerApi {
  getPlaybackInfo(): Promise<unknown>
  play(): Promise<void>
  pause(): Promise<void>
  togglePause(): Promise<void>
  stop(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
}

export type TwilightMediaProviderCapability =
  | 'search'
  | 'playbackUrl'
  | 'lyrics'
  | 'cover'
  | 'playlist'
  | 'library'
  | 'login'

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  filePath: string
  fileName: string
  duration: number
  size: number
  cover: string | null
  lyrics: string | null
  translatedLyrics?: string | null
  source?: string
  streamUrl?: string | null
  bpm?: number
}

export interface PlaylistSummary {
  id: string | number
  name: string
  cover?: string | null
  trackCount?: number
  creatorName?: string
  /** True when the signed-in user owns (created) the playlist. */
  owned?: boolean
}

export interface AlbumSummary {
  id: string | number
  name: string
  cover?: string | null
  trackCount?: number
  publishTime?: number
}

export interface ArtistSummary {
  id: string | number
  name: string
  cover?: string | null
}

export interface UserSummary {
  id: string | number
  name: string
  avatar?: string | null
  artistId?: string | number
  followed?: boolean
}

export interface ProviderProfile {
  userId?: string | number
  nickname?: string
  avatarUrl?: string | null
  [key: string]: unknown
}

export interface QrLoginRequest {
  key: string
  qrContent?: string
  imageDataUrl?: string
  expiresInSeconds?: number
}

/**
 * Appended to provider handler arguments by the host. Existing v1 handlers
 * can ignore it; new handlers should stop in-flight work when signal aborts.
 */
export interface TwilightProviderRequestContext {
  signal: AbortSignal
  /** Present for like/follow writes when a caller supplies or reuses a key. */
  idempotencyKey?: string
}

/** Context appended to a registered UI command handler. */
export interface TwilightUiCommandContext {
  signal: AbortSignal
}

export interface TwilightMediaProviderRegistration {
  id: string
  name: string
  capabilities: TwilightMediaProviderCapability[]
  health?: TwilightMediaProviderHealth
  getPlaybackUrl?(
    track: Track,
    options?: PlaybackUrlOptions,
    context?: TwilightProviderRequestContext
  ): Promise<string | null>
  getLyrics?(
    track: Track,
    context?: TwilightProviderRequestContext
  ): Promise<{ lyrics: string | null; translatedLyrics: string | null; wordLyrics?: string | null }>
  searchSongs?(
    keywords: string,
    limit?: number,
    offset?: number,
    context?: TwilightProviderRequestContext
  ): Promise<{ items: Track[]; total: number }>
  searchPlaylists?(
    keywords: string,
    limit?: number,
    offset?: number,
    context?: TwilightProviderRequestContext
  ): Promise<{ items: PlaylistSummary[]; total: number }>
  searchArtists?(
    keywords: string,
    limit?: number,
    offset?: number,
    context?: TwilightProviderRequestContext
  ): Promise<{ items: ArtistSummary[]; total: number }>
  fetchPlaylistTracks?(
    playlistId: string | number,
    force?: boolean,
    context?: TwilightProviderRequestContext
  ): Promise<Track[]>
  checkLogin?(context?: TwilightProviderRequestContext): Promise<{ loggedIn: boolean; profile: ProviderProfile | null }>
  getProfile?(context?: TwilightProviderRequestContext): Promise<ProviderProfile | null>
  logout?(context?: TwilightProviderRequestContext): Promise<void>
  getQrLogin?(context?: TwilightProviderRequestContext): Promise<QrLoginRequest | null>
  getQrKey?(context?: TwilightProviderRequestContext): Promise<string | null>
  getQrImage?(key: string, context?: TwilightProviderRequestContext): Promise<string | null>
  checkQrLogin?(key: string, context?: TwilightProviderRequestContext): Promise<{ code: number }>
  fetchUserLibrary?(force?: boolean, context?: TwilightProviderRequestContext): Promise<{
    likedPlaylist: PlaylistSummary | null
    playlists: PlaylistSummary[]
  }>
  fetchLikedTracks?(force?: boolean, context?: TwilightProviderRequestContext): Promise<Track[]>
  fetchLikedTracksPage?(offset?: number, limit?: number, force?: boolean, context?: TwilightProviderRequestContext): Promise<{
    tracks: Track[]
    total: number
    offset: number
    limit: number
    nextOffset: number
    hasMore: boolean
  }>
  fetchRecommendSongs?(context?: TwilightProviderRequestContext): Promise<Track[]>
  fetchRecommendPlaylists?(context?: TwilightProviderRequestContext): Promise<PlaylistSummary[]>
  fetchPersonalFm?(context?: TwilightProviderRequestContext): Promise<Track[]>
  fetchPrivateContent?(context?: TwilightProviderRequestContext): Promise<Track[]>
  fetchArtistTopSongs?(artistId: string | number, context?: TwilightProviderRequestContext): Promise<Track[]>
  fetchArtistAlbums?(artistId: string | number, context?: TwilightProviderRequestContext): Promise<AlbumSummary[]>
  fetchArtistIntro?(artistId: string | number, context?: TwilightProviderRequestContext): Promise<string>
  fetchArtistFollowState?(
    artistId: string | number,
    context?: TwilightProviderRequestContext
  ): Promise<boolean | null>
  fetchAlbumTracks?(albumId: string | number, context?: TwilightProviderRequestContext): Promise<Track[]>
  fetchArtistPlaylists?(
    artistId: string | number,
    context?: TwilightProviderRequestContext
  ): Promise<PlaylistSummary[]>
  fetchUserPlaylistsByUid?(
    uid: string | number,
    createdOnly?: boolean,
    context?: TwilightProviderRequestContext
  ): Promise<PlaylistSummary[]>
  fetchUserFollows?(
    uid: string | number,
    limit?: number,
    offset?: number,
    context?: TwilightProviderRequestContext
  ): Promise<UserSummary[]>
  fetchUserFolloweds?(
    uid: string | number,
    limit?: number,
    offset?: number,
    context?: TwilightProviderRequestContext
  ): Promise<UserSummary[]>
  followArtist?(
    artistId: string | number,
    follow: boolean,
    context?: TwilightProviderRequestContext
  ): Promise<void>
  followUser?(
    userId: string | number,
    follow: boolean,
    context?: TwilightProviderRequestContext
  ): Promise<void>
  likeTrack?(
    trackId: string | number,
    like: boolean,
    context?: TwilightProviderRequestContext
  ): Promise<void>
  isTrackLiked?(
    trackId: string | number | undefined,
    context?: TwilightProviderRequestContext
  ): Promise<boolean> | boolean
  createPlaylist?(
    name: string,
    options?: { privacy?: 0 | 10 },
    context?: TwilightProviderRequestContext
  ): Promise<PlaylistSummary>
  deletePlaylist?(
    playlistId: string | number,
    context?: TwilightProviderRequestContext
  ): Promise<void>
  addTracksToPlaylist?(
    playlistId: string | number,
    trackIds: Array<string | number>,
    context?: TwilightProviderRequestContext
  ): Promise<void>
  removeTracksFromPlaylist?(
    playlistId: string | number,
    trackIds: Array<string | number>,
    context?: TwilightProviderRequestContext
  ): Promise<void>
}

/**
 * Optional playback URL resolution hints. Providers that do not support a hint must ignore it.
 */
export interface PlaybackUrlOptions {
  force?: boolean
  quality?: string
}

export type TwilightMediaProviderMethod = Exclude<
  keyof TwilightMediaProviderRegistration,
  'id' | 'name' | 'capabilities' | 'health'
>

export interface TwilightMediaProviderHealth {
  providerId: string
  pluginId: string
  pluginStatus: TwilightPluginStatus
  available: boolean
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  successRate: number
  methodStats: Partial<Record<TwilightMediaProviderMethod, TwilightMediaProviderMethodHealth>>
  lastError: string | null
  lastCheckedAt: string | null
}

export interface TwilightMediaProviderMethodHealth {
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  successRate: number
  lastError: string | null
  lastCheckedAt: string | null
}

export interface TwilightProvidersApi {
  register(provider: TwilightMediaProviderRegistration): Promise<void>
}

export type TwilightUiContributionKind =
  | 'sidebarPage'
  | 'playerBarButton'
  | 'settingsPanel'
  | 'localSidebarItem'
  | 'streamingHome'

export interface TwilightUiContribution {
  id: string
  kind: TwilightUiContributionKind
  title: string
  description?: string
  icon?: string
  command?: string
  /** @deprecated The host renders command results as text/data and never executes HTML. */
  renderMode?: 'command' | 'html'
  autoLoad?: boolean
}

export interface TwilightPluginExtensionContribution {
  pluginId: string
  ui: TwilightUiContribution[]
  themes: TwilightThemeContribution[]
}

export interface TwilightUiApi {
  register(contribution: TwilightUiContribution): Promise<void>
  onCommand(
    command: string,
    handler: (...args: [...unknown[], TwilightUiCommandContext]) => unknown | Promise<unknown>
  ): void
}

export interface TwilightThemeContribution {
  id: string
  name: string
  description?: string
  variables?: Record<string, string>
  stylesheet?: string
}

export interface TwilightThemesApi {
  /** @deprecated Themes must be declared in plugin.json contributes.themes. This call rejects. */
  register(theme: TwilightThemeContribution): Promise<void>
}

export interface NativeDspParameterInfo {
  id: string
  name: string
  type: 'bool' | 'int' | 'float' | 'enum' | string
  defaultValue: number
  minValue: number
  maxValue: number
  step: number
  unit: string
  enumValues?: string[] | string | null
  currentValue: number
}

export interface NativeDspPluginStatus {
  id: string
  name?: string
  version?: string
  abiVersion?: 1 | 2
  graphPosition?: 'fixed-post-graph' | 'v2-sortable' | string
  supportedChannelLayouts?: number
  minimumSampleRate?: number
  maximumSampleRate?: number
  latencyFrames?: number
  tailFrames?: number
  enabled?: boolean
  loaded?: boolean
  active?: boolean
  bypassed?: boolean
  bypassReason?: string
  lastError?: string
  processCalls?: number
  overrunCount?: number
  lastProcessMs?: number
  maxProcessMs?: number
  parameters?: NativeDspParameterInfo[]
}

export interface TwilightApi {
  events: TwilightEventsApi
  player: TwilightPlayerApi
  providers: TwilightProvidersApi
  ui: TwilightUiApi
  themes: TwilightThemesApi
}

export type Activate = (context: TwilightPluginContext) => void | Promise<void>
export type Deactivate = () => void | Promise<void>
