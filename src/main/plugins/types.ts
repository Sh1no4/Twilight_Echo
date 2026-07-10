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

export type TwilightPluginSource = 'directory' | 'tep' | 'bundled' | 'index'

export interface TwilightPluginStateRecord {
  enabled: boolean
  installedAt: string
  updatedAt: string
  source: TwilightPluginSource
  lastError?: string
  nativeDspParameters?: Record<string, number>
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

export interface TwilightPluginIndexEntry extends TwilightPluginManifest {
  sourceUrl: string
  checksumSha256: string
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
  ui?: TwilightProviderUiMetadata
  health?: TwilightMediaProviderHealth
}

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

/**
 * 插件通过 providers.register({ ui: {...} }) 声明的界面元数据。
 * 宿主根据这些信息自动渲染登录卡片、流媒体标签页等，无需修改主程序。
 */
export interface TwilightProviderUiMetadata {
  /** PrimeIcons 图标类名，如 'pi pi-cloud' */
  icon: string
  /** 品牌色（CSS 颜色），用于卡片渐变等 */
  color?: string
  /** 简短描述，显示在登录卡片上 */
  description?: string
  /** 登录流程类型 */
  authType: 'qr' | 'oauth' | 'cookie'
  /** 等待扫码/授权时的提示文案 */
  loginInstructions?: string
  /** 标准化的 QR/OAuth 状态码映射（authType 为 'qr' 或 'oauth' 时必填） */
  qrStatusCodes?: {
    /** 等待扫码/授权 */
    waiting: number
    /** 已扫码等待确认（无此状态则填 null） */
    scanned: number | null
    /** 过期 */
    expired: number
    /** 被拒绝（可选） */
    denied?: number
    /** 成功 */
    success: number
  }
  /** 是否显示"在浏览器中打开"按钮（OAuth 设备码流程） */
  showBrowserButton?: boolean
  /** 额外的登录操作按钮（如"使用官方网页登录"），点击时调用 provider 的指定方法 */
  loginExtraActions?: Array<{
    /** 按钮文字 */
    label: string
    /** PrimeIcons 图标类名 */
    icon: string
    /** provider 方法名 */
    method: string
  }>
  /** 流媒体首页推荐区块声明 */
  streamingSections?: TwilightProviderStreamingSection[]
  /** 是否在流媒体页显示"资料库"标签 */
  streamingLibraryTab?: boolean
  /** 是否在流媒体页显示"搜索"功能 */
  streamingSearch?: boolean
  /**
   * 是否接入统一的"音乐库"切换器（个人资料卡上的音源下拉）。
   * 设为 true 的 provider 会出现在音乐库下拉中，与网易云音乐并列切换，
   * 不再在侧边栏占据独立条目；未设置或为 false 的 provider 仍以独立
   * 侧边栏条目展示（如 Bilibili 收藏夹）。便于未来新音源插件直接接入。
   */
  unifiedLibrary?: boolean
}

/**
 * 流媒体首页推荐区块。插件声明后，宿主会自动调用对应 provider 方法获取歌曲列表并渲染。
 */
export interface TwilightProviderStreamingSection {
  /** 区块唯一 ID */
  id: string
  /** 区块标题 */
  title: string
  /** PrimeIcons 图标类名 */
  icon: string
  /** provider 方法名（需在 capabilities 中声明对应能力） */
  method: string
  /** 方法参数（可选） */
  args?: unknown[]
}

export interface TwilightQrLoginRequest {
  key: string
  qrContent?: string
  imageDataUrl?: string
  expiresInSeconds?: number
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
  | 'openOfficialLogin'
  | 'sendCaptcha'
  | 'loginByPhonePassword'
  | 'loginByPhoneCaptcha'
  | 'loginByEmailPassword'
  | 'getQrLogin'
  | 'getQrKey'
  | 'getQrImage'
  | 'checkQrLogin'
  | 'fetchUserLibrary'
  | 'fetchLikedTracks'
  | 'fetchLikedTracksPage'
  | 'fetchRecommendSongs'
  | 'fetchRecommendPlaylists'
  | 'fetchPersonalFm'
  | 'fetchPrivateContent'
  | 'fetchArtistTopSongs'
  | 'fetchArtistAlbums'
  | 'fetchArtistIntro'
  | 'fetchArtistFollowState'
  | 'fetchAlbumTracks'
  | 'fetchArtistPlaylists'
  | 'fetchUserPlaylistsByUid'
  | 'fetchUserFollows'
  | 'fetchUserFolloweds'
  | 'fetchPlayRecords'
  | 'fetchRecentSongs'
  | 'followArtist'
  | 'followUser'
  | 'likeTrack'
  | 'isTrackLiked'

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
  /** @deprecated 宿主始终按 command 渲染；'html' 仅作为 API v1 兼容输入保留。 */
  renderMode?: 'command' | 'html'
  /** 是否在页面打开时自动执行命令，默认 false。 */
  autoLoad?: boolean
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
      requestId: string
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
        | 'ncmOfficialLogin'
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
  | {
      kind: 'ui-command-result'
      requestId: string
      ok: true
      value: unknown
    }
  | {
      kind: 'ui-command-result'
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
