import { pathToFileURL } from 'url'
import { deletePluginSetting, getPluginSetting, setPluginSetting } from './plugins/settingsStore'
import { initProxy } from './plugins/proxyBootstrap'
import { redactSensitiveText } from './security/secureStorage.ts'
import type {
  PluginHostApiResult,
  PluginHostRequest,
  PluginHostResponse,
  TwilightMediaProviderMethod,
  TwilightPluginPermission
} from './plugins/types'

type ParentPort = {
  postMessage: (message: PluginHostResponse | Extract<PluginHostResponse, { kind: 'api-call' }>) => void
  on: (event: 'message', listener: (event: { data: PluginHostRequest | PluginHostApiResult }) => void) => void
}

type PluginModule = {
  activate?: (context: TwilightPluginContext) => Promise<void> | void
  deactivate?: () => Promise<void> | void
  default?: PluginModule
}

type ProviderHandler = Partial<Record<TwilightMediaProviderMethod, (...args: unknown[]) => Promise<unknown> | unknown>>
type CommandHandler = (...args: unknown[]) => Promise<unknown> | unknown

interface TwilightPluginContext {
  apiVersion: number
  storagePath: string
  logger: {
    debug: (message: string) => void
    info: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void
  }
  settings: {
    get: (key?: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
  }
  twilight: {
    events: {
      on: (eventName: string, callback: (payload: unknown) => void) => () => void
    }
    player: {
      getPlaybackInfo: () => Promise<unknown>
      play: () => Promise<void>
      pause: () => Promise<void>
      togglePause: () => Promise<void>
      stop: () => Promise<void>
      next: () => Promise<void>
      previous: () => Promise<void>
    }
    providers: {
      register: (provider: {
        id: string
        name: string
        capabilities: string[]
        ui?: Record<string, unknown>
        health?: Record<string, unknown>
      } & ProviderHandler) => Promise<void>
    },
    ui: {
      register: (contribution: {
        id: string
        kind: 'sidebarPage' | 'playerBarButton' | 'settingsPanel' | 'localSidebarItem' | 'streamingHome'
        title: string
        description?: string
        icon?: string
        command?: string
        /** @deprecated The host never executes plugin-provided HTML. */
        renderMode?: 'command' | 'html'
        autoLoad?: boolean
      }) => Promise<void>
      onCommand: (command: string, handler: CommandHandler) => () => void
    }
    themes: {
      register: (theme: {
        id: string
        name: string
        description?: string
        variables?: Record<string, string>
        stylesheet?: string
      }) => Promise<void>
    }
    internal?: {
      ncm?: {
        request: (path: string, cookie?: string) => Promise<unknown>
        officialLogin: () => Promise<string>
        getCachedSong: (songId: number) => Promise<string | null>
        cacheSong: (songId: number, url: string, fileName?: string) => Promise<string | null>
      }
    }
  }
}

const INTERNAL_NCM_PLUGIN_ID = 'com.twilightecho.provider.ncm'
const PROVIDER_METHODS: TwilightMediaProviderMethod[] = [
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
  'fetchRecommendSongs',
  'fetchRecommendPlaylists',
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
  'followArtist',
  'followUser',
  'likeTrack',
  'isTrackLiked'
]

const maybeParentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
if (!maybeParentPort) {
  throw new Error('Twilight plugin host must run as an Electron utilityProcess')
}
const parentPort = maybeParentPort

let activePlugin: PluginModule | null = null
const eventHandlers = new Map<string, Set<(payload: unknown) => void>>()
const providerHandlers = new Map<string, ProviderHandler>()
const commandHandlers = new Map<string, CommandHandler>()
const pendingApiCalls = new Map<
  string,
  {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }
>()

parentPort.on('message', (event) => {
  const message = event.data
  if (message.kind === 'activate') {
    void activatePlugin(message)
  } else if (message.kind === 'deactivate') {
    void deactivatePlugin(message.requestId)
  } else if (message.kind === 'event') {
    emitPluginEvent(message.name, message.payload)
  } else if (message.kind === 'provider-call') {
    void callProviderHandler(message)
  } else if (message.kind === 'ui-command') {
    void callCommandHandler(message)
  } else if (message.kind === 'api-result') {
    resolveApiResult(message)
  }
})

async function activatePlugin(message: Extract<PluginHostRequest, { kind: 'activate' }>): Promise<void> {
  try {
    // Initialize proxy before loading any plugin code — plugins that access
    // blocked external APIs (YouTube, etc.) need the proxy tunnel active.
    await initProxy()
    const module = (await import(pathToFileURL(message.mainPath).href)) as PluginModule
    activePlugin = module.default && (module.default.activate || module.default.deactivate)
      ? module.default
      : module
    if (typeof activePlugin.activate !== 'function') {
      throw new Error('插件入口必须导出 activate(context)')
    }
    await activePlugin.activate(
      createContext(message.pluginId, message.apiVersion, message.dataDir, message.manifest.permissions)
    )
    post({ kind: 'activated', pluginId: message.pluginId })
  } catch (error) {
    reportError(error)
  }
}

async function deactivatePlugin(requestId: string): Promise<void> {
  try {
    if (activePlugin && typeof activePlugin.deactivate === 'function') {
      await activePlugin.deactivate()
    }
  } catch (error) {
    reportError(error)
  } finally {
    activePlugin = null
    eventHandlers.clear()
    providerHandlers.clear()
    commandHandlers.clear()
    post({ kind: 'deactivated', requestId })
  }
}

function createContext(
  pluginId: string,
  apiVersion: number,
  storagePath: string,
  permissions: TwilightPluginPermission[]
): TwilightPluginContext {
  const twilight: TwilightPluginContext['twilight'] = {
    events: {
      on: (eventName, callback) => {
        const handlers = eventHandlers.get(eventName) ?? new Set()
        handlers.add(callback)
        eventHandlers.set(eventName, handlers)
        post({ kind: 'api-event-subscribe', eventName })
        return () => handlers.delete(callback)
      }
    },
    player: {
      getPlaybackInfo: () => callPlayerApi('getPlaybackInfo'),
      play: () => callPlayerApi('play').then(() => undefined),
      pause: () => callPlayerApi('pause').then(() => undefined),
      togglePause: () => callPlayerApi('togglePause').then(() => undefined),
      stop: () => callPlayerApi('stop').then(() => undefined),
      next: () => callPlayerApi('next').then(() => undefined),
      previous: () => callPlayerApi('previous').then(() => undefined)
    },
    providers: {
      register: async (provider) => {
        const handlers: ProviderHandler = {}
        for (const method of PROVIDER_METHODS) {
          if (typeof provider[method] === 'function') {
            handlers[method] = provider[method]
          }
        }
        providerHandlers.set(provider.id.trim().toLowerCase(), handlers)
        await callProviderApi('register', {
          id: provider.id,
          name: provider.name,
          capabilities: provider.capabilities,
          ui: provider.ui,
          health: provider.health
        })
      }
    },
    ui: {
      register: (contribution) => callUiApi('registerUi', contribution).then(() => undefined),
      onCommand: (command, handler) => {
        const normalized = command.trim()
        if (!normalized) throw new Error('UI command is required')
        commandHandlers.set(normalized, handler)
        return () => commandHandlers.delete(normalized)
      }
    },
    themes: {
      register: async () => {
        throw new Error('Themes must be declared in plugin.json contributes.themes')
      }
    }
  }

  if (pluginId === INTERNAL_NCM_PLUGIN_ID) {
    twilight.internal = {
      ncm: {
        request: (path, cookie) => callInternalNcmApi('ncmRequest', [path, cookie]),
        officialLogin: () => callInternalNcmApi('ncmOfficialLogin', []) as Promise<string>,
        getCachedSong: (songId) => callInternalNcmApi('ncmGetCachedSong', [songId]) as Promise<string | null>,
        cacheSong: (songId, url, fileName) =>
          callInternalNcmApi('ncmCacheSong', [songId, url, fileName]) as Promise<string | null>
      }
    }
  }

  return {
    apiVersion,
    storagePath,
    logger: {
      debug: (message) => log('debug', message),
      info: (message) => log('info', message),
      warn: (message) => log('warn', message),
      error: (message) => log('error', message)
    },
    settings: createSettingsApi(storagePath, permissions),
    twilight
  }
}

function createSettingsApi(
  storagePath: string,
  permissions: TwilightPluginPermission[]
): TwilightPluginContext['settings'] {
  return {
    get: (key) => {
      requireLocalPermission(permissions, 'settings')
      return getPluginSetting(storagePath, key)
    },
    set: (key, value) => {
      requireLocalPermission(permissions, 'settings')
      return setPluginSetting(storagePath, key, value)
    },
    delete: (key) => {
      requireLocalPermission(permissions, 'settings')
      return deletePluginSetting(storagePath, key)
    }
  }
}

function requireLocalPermission(
  permissions: TwilightPluginPermission[],
  permission: TwilightPluginPermission
): void {
  if (!permissions.includes(permission)) {
    throw new Error(`插件未声明 ${permission} 权限`)
  }
}

function callPlayerApi(method: Extract<PluginHostResponse, { kind: 'api-call' }>['method']): Promise<unknown> {
  return callApi('player', method, [])
}

function callProviderApi(
  method: Extract<PluginHostResponse, { kind: 'api-call' }>['method'],
  provider: unknown
): Promise<unknown> {
  return callApi('providers', method, [provider])
}

function callUiApi(
  method: Extract<PluginHostResponse, { kind: 'api-call' }>['method'],
  contribution: unknown
): Promise<unknown> {
  return callApi('extensions', method, [contribution])
}

function callInternalNcmApi(
  method: Extract<PluginHostResponse, { kind: 'api-call' }>['method'],
  args: unknown[]
): Promise<unknown> {
  return callApi('internal', method, args)
}

function callApi(
  namespace: Extract<PluginHostResponse, { kind: 'api-call' }>['namespace'],
  method: Extract<PluginHostResponse, { kind: 'api-call' }>['method'],
  args: unknown[]
): Promise<unknown> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  post({
    kind: 'api-call',
    requestId,
    namespace,
    method,
    args
  })
  return new Promise((resolve, reject) => {
    pendingApiCalls.set(requestId, { resolve, reject })
  })
}

function resolveApiResult(message: PluginHostApiResult): void {
  const pending = pendingApiCalls.get(message.requestId)
  if (!pending) return
  pendingApiCalls.delete(message.requestId)
  if (message.ok) {
    pending.resolve(message.value)
  } else {
    pending.reject(new Error(message.error))
  }
}

function emitPluginEvent(name: string, payload: unknown): void {
  const handlers = eventHandlers.get(name)
  if (!handlers) return
  for (const handler of handlers) {
    try {
      handler(payload)
    } catch (error) {
      reportError(error)
    }
  }
}

async function callProviderHandler(
  message: Extract<PluginHostRequest, { kind: 'provider-call' }>
): Promise<void> {
  try {
    const provider = providerHandlers.get(message.providerId)
    const handler = provider?.[message.method]
    if (typeof handler !== 'function') {
      throw new Error(`Provider ${message.providerId} does not implement ${message.method}`)
    }
    const value = await handler(...message.args)
    post({ kind: 'provider-result', requestId: message.requestId, ok: true, value })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    post({ kind: 'provider-result', requestId: message.requestId, ok: false, error: err.message })
  }
}

async function callCommandHandler(message: Extract<PluginHostRequest, { kind: 'ui-command' }>): Promise<void> {
  try {
    const handler = commandHandlers.get(message.command)
    if (!handler) throw new Error(`UI command is not registered: ${message.command}`)
    const value = await handler(...message.args)
    post({ kind: 'ui-command-result', requestId: message.requestId, ok: true, value })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    post({ kind: 'ui-command-result', requestId: message.requestId, ok: false, error: err.message })
    reportError(error)
  }
}

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  post({ kind: 'log', level, message: redactSensitiveText(message) })
}

function reportError(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error))
  post({
    kind: 'host-error',
    message: redactSensitiveText(err.message),
    stack: err.stack ? redactSensitiveText(err.stack) : undefined
  })
}

function post(message: PluginHostResponse): void {
  parentPort.postMessage(message)
}
