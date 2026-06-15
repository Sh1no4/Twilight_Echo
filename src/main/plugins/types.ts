export const TWILIGHT_PLUGIN_API_VERSION = 1

export const PLUGIN_TYPES = ['provider', 'tool', 'ui', 'theme', 'dsp'] as const
export type TwilightPluginType = (typeof PLUGIN_TYPES)[number]

export const PLUGIN_PERMISSIONS = [
  'network',
  'filesystem:read',
  'filesystem:write',
  'player:control',
  'player:observe',
  'library:read',
  'library:write',
  'settings',
  'clipboard',
  'ui:inject',
  'dsp:native'
] as const
export type TwilightPluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

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

export type TwilightPluginSource = 'directory' | 'tep' | 'bundled'

export interface TwilightPluginStateRecord {
  enabled: boolean
  installedAt: string
  updatedAt: string
  source: TwilightPluginSource
  lastError?: string
}

export interface TwilightPluginPaths {
  root: string
  versionRoot: string
  manifestPath: string
  dataDir: string
  logPath: string
}

export interface TwilightPluginDescriptor {
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
  status: TwilightPluginStatus
  enabled: boolean
  builtIn: boolean
  error: string | null
  isDsp: boolean
  source: TwilightPluginSource | 'scan'
  installedAt: string | null
  updatedAt: string | null
  paths: TwilightPluginPaths
}

export interface TwilightPluginInstallResult {
  plugin: TwilightPluginDescriptor
  warning: string
}

export interface TwilightPluginUninstallOptions {
  removeData?: boolean
}

export type TwilightMediaProviderCapability =
  | 'search'
  | 'playbackUrl'
  | 'lyrics'
  | 'cover'
  | 'playlist'
  | 'library'
  | 'login'

export interface TwilightMediaProviderRegistration {
  id: string
  name: string
  capabilities: TwilightMediaProviderCapability[]
}

export type TwilightMediaProviderMethod =
  | 'getPlaybackUrl'
  | 'getLyrics'
  | 'searchSongs'
  | 'searchPlaylists'
  | 'searchArtists'
  | 'fetchPlaylistTracks'
  | 'checkLogin'
  | 'getProfile'
  | 'logout'
  | 'getQrKey'
  | 'getQrImage'
  | 'checkQrLogin'
  | 'fetchUserLibrary'
  | 'fetchLikedTracks'
  | 'fetchRecommendSongs'
  | 'fetchRecommendPlaylists'
  | 'fetchPersonalFm'
  | 'fetchPrivateContent'
  | 'fetchArtistTopSongs'
  | 'fetchArtistPlaylists'
  | 'fetchUserPlaylistsByUid'
  | 'fetchUserFollows'
  | 'fetchUserFolloweds'
  | 'likeTrack'
  | 'isTrackLiked'

export type TwilightUiContributionKind = 'sidebarPage' | 'playerBarButton' | 'settingsPanel'

export interface TwilightUiContribution {
  id: string
  kind: TwilightUiContributionKind
  title: string
  description?: string
  icon?: string
  command?: string
}

export interface TwilightThemeContribution {
  id: string
  name: string
  description?: string
  variables?: Record<string, string>
  stylesheet?: string
}

export interface TwilightPluginExtensionContribution {
  pluginId: string
  ui: TwilightUiContribution[]
  themes: TwilightThemeContribution[]
}

export type PluginHostRequest =
  | {
      kind: 'activate'
      pluginId: string
      manifest: TwilightPluginManifest
      mainPath: string
      dataDir: string
      apiVersion: number
    }
  | {
      kind: 'deactivate'
      requestId: string
    }
  | {
      kind: 'event'
      name: string
      payload: unknown
    }
  | {
      kind: 'provider-call'
      requestId: string
      providerId: string
      method: TwilightMediaProviderMethod
      args: unknown[]
    }
  | {
      kind: 'ui-command'
      command: string
      args: unknown[]
    }

export type PluginHostResponse =
  | {
      kind: 'activated'
      pluginId: string
    }
  | {
      kind: 'deactivated'
      requestId: string
    }
  | {
      kind: 'log'
      level: 'debug' | 'info' | 'warn' | 'error'
      message: string
    }
  | {
      kind: 'host-error'
      message: string
      stack?: string
    }
  | {
      kind: 'api-event-subscribe'
      eventName: string
    }
  | {
      kind: 'api-call'
      requestId: string
      namespace: 'player' | 'providers' | 'extensions' | 'internal'
      method:
        | 'getPlaybackInfo'
        | 'play'
        | 'pause'
        | 'togglePause'
        | 'stop'
        | 'next'
        | 'previous'
        | 'register'
        | 'registerUi'
        | 'registerTheme'
        | 'ncmRequest'
        | 'ncmGetCachedSong'
        | 'ncmCacheSong'
      args: unknown[]
    }
  | {
      kind: 'provider-result'
      requestId: string
      ok: true
      value: unknown
    }
  | {
      kind: 'provider-result'
      requestId: string
      ok: false
      error: string
    }

export type PluginHostApiResult =
  | {
      kind: 'api-result'
      requestId: string
      ok: true
      value: unknown
    }
  | {
      kind: 'api-result'
      requestId: string
      ok: false
      error: string
    }
