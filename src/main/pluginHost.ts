import { pathToFileURL } from 'url'
import type {
  PluginHostApiResult,
  PluginHostRequest,
  PluginHostResponse,
  TwilightMediaProviderMethod
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

interface TwilightPluginContext {
  apiVersion: number
  storagePath: string
  logger: {
    debug: (message: string) => void
    info: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void
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
      } & ProviderHandler) => Promise<void>
    }
  }
}

const maybeParentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
if (!maybeParentPort) {
  throw new Error('Twilight plugin host must run as an Electron utilityProcess')
}
const parentPort = maybeParentPort

let activePlugin: PluginModule | null = null
const eventHandlers = new Map<string, Set<(payload: unknown) => void>>()
const providerHandlers = new Map<string, ProviderHandler>()
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
  } else if (message.kind === 'api-result') {
    resolveApiResult(message)
  }
})

async function activatePlugin(message: Extract<PluginHostRequest, { kind: 'activate' }>): Promise<void> {
  try {
    const module = (await import(pathToFileURL(message.mainPath).href)) as PluginModule
    activePlugin = module.default && (module.default.activate || module.default.deactivate)
      ? module.default
      : module
    if (typeof activePlugin.activate !== 'function') {
      throw new Error('插件入口必须导出 activate(context)')
    }
    await activePlugin.activate(createContext(message.apiVersion, message.dataDir))
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
    post({ kind: 'deactivated', requestId })
  }
}

function createContext(apiVersion: number, storagePath: string): TwilightPluginContext {
  return {
    apiVersion,
    storagePath,
    logger: {
      debug: (message) => log('debug', message),
      info: (message) => log('info', message),
      warn: (message) => log('warn', message),
      error: (message) => log('error', message)
    },
    twilight: {
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
          providerHandlers.set(provider.id.trim().toLowerCase(), {
            getPlaybackUrl: provider.getPlaybackUrl,
            getLyrics: provider.getLyrics,
            searchSongs: provider.searchSongs,
            searchPlaylists: provider.searchPlaylists,
            searchArtists: provider.searchArtists,
            fetchPlaylistTracks: provider.fetchPlaylistTracks
          })
          await callProviderApi('register', {
            id: provider.id,
            name: provider.name,
            capabilities: provider.capabilities
          })
        }
      }
    }
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

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  post({ kind: 'log', level, message })
}

function reportError(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error))
  post({ kind: 'host-error', message: err.message, stack: err.stack })
}

function post(message: PluginHostResponse): void {
  parentPort.postMessage(message)
}
