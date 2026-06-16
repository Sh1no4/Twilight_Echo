export const TWILIGHT_PLUGIN_API_VERSION = 1 as const
export const TAE_DSP_PLUGIN_ABI_VERSION = 1 as const

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

export interface TwilightPluginIndexEntry extends TwilightPluginManifest {
  sourceUrl: string
  checksumSha256: string
  repository?: string
  homepage?: string
  tags?: string[]
  verified?: boolean
  installState?: TwilightPluginIndexInstallState
  installedVersion?: string
}

export type TwilightPluginIndexInstallState =
  | 'not-installed'
  | 'installed'
  | 'update-available'
  | 'incompatible'
  | 'built-in-blocked'

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
}

export interface PlaylistSummary {
  id: string | number
  name: string
  cover?: string | null
  trackCount?: number
  creatorName?: string
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

export interface TwilightMediaProviderRegistration {
  id: string
  name: string
  capabilities: TwilightMediaProviderCapability[]
  getPlaybackUrl?(track: Track, options?: { force?: boolean }): Promise<string | null>
  getLyrics?(track: Track): Promise<{ lyrics: string | null; translatedLyrics: string | null }>
  searchSongs?(keywords: string, limit?: number, offset?: number): Promise<{ items: Track[]; total: number }>
  searchPlaylists?(
    keywords: string,
    limit?: number,
    offset?: number
  ): Promise<{ items: PlaylistSummary[]; total: number }>
  searchArtists?(
    keywords: string,
    limit?: number,
    offset?: number
  ): Promise<{ items: ArtistSummary[]; total: number }>
  fetchPlaylistTracks?(playlistId: string | number, force?: boolean): Promise<Track[]>
  checkLogin?(): Promise<{ loggedIn: boolean; profile: ProviderProfile | null }>
  getProfile?(): Promise<ProviderProfile | null>
  logout?(): Promise<void>
  getQrLogin?(): Promise<QrLoginRequest | null>
  getQrKey?(): Promise<string | null>
  getQrImage?(key: string): Promise<string | null>
  checkQrLogin?(key: string): Promise<{ code: number }>
  fetchUserLibrary?(force?: boolean): Promise<{ likedPlaylist: PlaylistSummary | null; playlists: PlaylistSummary[] }>
  fetchLikedTracks?(force?: boolean): Promise<Track[]>
  fetchRecommendSongs?(): Promise<Track[]>
  fetchRecommendPlaylists?(): Promise<PlaylistSummary[]>
  fetchPersonalFm?(): Promise<Track[]>
  fetchPrivateContent?(): Promise<Track[]>
  fetchArtistTopSongs?(artistId: string | number): Promise<Track[]>
  fetchArtistPlaylists?(artistId: string | number): Promise<PlaylistSummary[]>
  fetchUserPlaylistsByUid?(uid: string | number): Promise<PlaylistSummary[]>
  fetchUserFollows?(uid: string | number, limit?: number, offset?: number): Promise<UserSummary[]>
  fetchUserFolloweds?(uid: string | number, limit?: number, offset?: number): Promise<UserSummary[]>
  likeTrack?(trackId: string | number, like: boolean): Promise<void>
  isTrackLiked?(trackId: string | number | undefined): Promise<boolean> | boolean
}

export type TwilightMediaProviderMethod = Exclude<
  keyof TwilightMediaProviderRegistration,
  'id' | 'name' | 'capabilities'
>

export interface TwilightProvidersApi {
  register(provider: TwilightMediaProviderRegistration): Promise<void>
}

export type TwilightUiContributionKind = 'sidebarPage' | 'playerBarButton' | 'settingsPanel'

export interface TwilightUiContribution {
  id: string
  kind: TwilightUiContributionKind
  title: string
  description?: string
  icon?: string
  command?: string
}

export interface TwilightUiApi {
  register(contribution: TwilightUiContribution): Promise<void>
  onCommand(command: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): void
}

export interface TwilightThemeContribution {
  id: string
  name: string
  description?: string
  variables?: Record<string, string>
  stylesheet?: string
}

export interface TwilightThemesApi {
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
