import { computed, ref, type Ref } from 'vue'
import type {
  MediaProviderPlaylistSummary,
  MediaProviderProfile,
  MediaProviderQrLogin
} from '../providers/mediaProvider'
import type { Track } from '../types/music'

export interface ProviderLoginState {
  loggedIn: boolean
  profile: MediaProviderProfile | null
}

/** 插件声明的 UI 元数据（镜像 preload 类型） */
export interface ProviderUiMetadata {
  icon: string
  color?: string
  description?: string
  authType: 'qr' | 'oauth' | 'cookie'
  loginInstructions?: string
  qrStatusCodes?: {
    waiting: number
    scanned: number | null
    expired: number
    denied?: number
    success: number
  }
  showBrowserButton?: boolean
  loginExtraActions?: Array<{
    label: string
    icon: string
    method: string
  }>
  streamingSections?: Array<{
    id: string
    title: string
    icon: string
    method: string
    args?: unknown[]
  }>
  streamingLibraryTab?: boolean
  streamingSearch?: boolean
}

export interface ProviderInfo {
  id: string
  name: string
  capabilities: string[]
  ui?: ProviderUiMetadata
}

export interface OnlineProviderStore {
  providers: Ref<ProviderInfo[]>
  syncProviders: () => Promise<void>
  hasProvider: (id: string) => boolean
  getProvider: (id: string) => ProviderInfo | undefined
  checkLogin: (id: string) => Promise<ProviderLoginState>
  getQrLogin: (id: string) => Promise<MediaProviderQrLogin | null>
  getQrImage: (id: string, key: string) => Promise<string | null>
  checkQrLogin: (id: string, key: string) => Promise<{ code: number; message?: string }>
  logout: (id: string) => Promise<void>
  callProvider: <T>(providerId: string, method: string, args?: unknown[]) => Promise<T>
  fetchUserLibrary: (id: string, force?: boolean) => Promise<{
    likedPlaylist: MediaProviderPlaylistSummary | null
    playlists: MediaProviderPlaylistSummary[]
  }>
  fetchPlaylistTracks: (id: string, playlistId: string | number, force?: boolean) => Promise<Track[]>
}

const providers = ref<ProviderInfo[]>([])
const providerIds = computed(() => new Set(providers.value.map((provider) => provider.id)))

async function callProvider<T>(providerId: string, method: string, args: unknown[] = []): Promise<T> {
  return (await window.api.providers.call(providerId, method as never, args)) as T
}

export function useProviderStore(): OnlineProviderStore {
  async function syncProviders(): Promise<void> {
    const list = await window.api.providers.list()
    providers.value = list.map((provider) => ({
      id: provider.id,
      name: provider.name,
      capabilities: provider.capabilities,
      ui: provider.ui as ProviderUiMetadata | undefined
    }))
  }

  function hasProvider(id: string): boolean {
    return providerIds.value.has(id)
  }

  function getProvider(id: string): ProviderInfo | undefined {
    return providers.value.find((item) => item.id === id)
  }

  async function checkLogin(id: string): Promise<ProviderLoginState> {
    const provider = providers.value.find((item) => item.id === id)
    if (!provider?.capabilities.includes('login')) {
      return { loggedIn: false, profile: null }
    }
    try {
      return await callProvider<ProviderLoginState>(id, 'checkLogin')
    } catch (error) {
      if (error instanceof Error && /does not implement checkLogin/i.test(error.message)) {
        return { loggedIn: false, profile: null }
      }
      throw error
    }
  }

  async function getQrLogin(id: string): Promise<MediaProviderQrLogin | null> {
    return callProvider<MediaProviderQrLogin | null>(id, 'getQrLogin')
  }

  async function getQrImage(id: string, key: string): Promise<string | null> {
    return callProvider<string | null>(id, 'getQrImage', [key])
  }

  async function checkQrLogin(
    id: string,
    key: string
  ): Promise<{ code: number; message?: string }> {
    return callProvider<{ code: number; message?: string }>(id, 'checkQrLogin', [key])
  }

  async function logout(id: string): Promise<void> {
    await callProvider<void>(id, 'logout')
  }

  async function fetchUserLibrary(
    id: string,
    force = false
  ): Promise<{
    likedPlaylist: MediaProviderPlaylistSummary | null
    playlists: MediaProviderPlaylistSummary[]
  }> {
    return callProvider<{
      likedPlaylist: MediaProviderPlaylistSummary | null
      playlists: MediaProviderPlaylistSummary[]
    }>(id, 'fetchUserLibrary', [force])
  }

  async function fetchPlaylistTracks(
    id: string,
    playlistId: string | number,
    force = false
  ): Promise<Track[]> {
    return callProvider<Track[]>(id, 'fetchPlaylistTracks', [playlistId, force])
  }

  return {
    providers,
    syncProviders,
    hasProvider,
    getProvider,
    checkLogin,
    getQrLogin,
    getQrImage,
    checkQrLogin,
    logout,
    callProvider,
    fetchUserLibrary,
    fetchPlaylistTracks
  }
}
